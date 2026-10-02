import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_BID = 20;

interface Kind {
  type: string;
  /** Returns true when the first bytes really look like this kind of file (an extension alone proves nothing). */
  magic: (b: Buffer) => boolean;
}
const startsWith = (b: Buffer, sig: number[]) => sig.every((x, i) => b[i] === x);
const zip = (b: Buffer) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
/** Plain text: valid UTF-8 with no NUL bytes. */
const text = (b: Buffer) => !b.includes(0) && Buffer.from(b.toString('utf8'), 'utf8').equals(b);

/** The allow-list (US-SUP-03 AC2). Anything not listed here is refused. */
const ALLOWED: Record<string, Kind> = {
  pdf: { type: 'application/pdf', magic: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
  docx: {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    magic: zip,
  },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: zip },
  pptx: {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    magic: zip,
  },
  zip: { type: 'application/zip', magic: zip },
  csv: { type: 'text/csv', magic: text },
  txt: { type: 'text/plain', magic: text },
  png: { type: 'image/png', magic: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]) },
  jpg: { type: 'image/jpeg', magic: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  jpeg: { type: 'image/jpeg', magic: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
};
export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED);

/** Extensions that make a file dangerous when they appear anywhere in a name, e.g. "bid.exe.pdf" or "bid.pdf.exe". */
const DANGEROUS = new Set([
  'exe',
  'dll',
  'bat',
  'cmd',
  'com',
  'scr',
  'msi',
  'js',
  'mjs',
  'vbs',
  'ps1',
  'sh',
  'jar',
  'html',
  'htm',
  'svg',
  'php',
  'asp',
  'aspx',
  'jsp',
  'lnk',
  'hta',
  'reg',
  'iso',
  'apk',
]);

export type UploadCheck =
  | { ok: true; safeName: string; contentType: string; ext: string }
  | {
      ok: false;
      code:
        | 'FILE_NAME_INVALID'
        | 'FILE_TYPE_NOT_ALLOWED'
        | 'FILE_TOO_LARGE'
        | 'FILE_CONTENT_MISMATCH'
        | 'FILE_EMPTY';
      message: string;
    };

/** Decides whether an uploaded file may be accepted. Pure: nothing is written here. */
export function checkUpload(name: string, bytes: Buffer): UploadCheck {
  // Keep only the last path segment, then reject anything that is not a plain, readable file name.
  const base = name.replace(/\\/g, '/').split('/').pop()!.trim();
  // eslint-disable-next-line no-control-regex
  if (!base || base.length > 120 || /[\u0000-\u001f<>:"|?*]/.test(base) || base.startsWith('.'))
    return {
      ok: false,
      code: 'FILE_NAME_INVALID',
      message: 'The file name is not allowed. Use letters, numbers, spaces, dashes and one extension.',
    };
  const parts = base.toLowerCase().split('.');
  if (parts.length < 2)
    return {
      ok: false,
      code: 'FILE_TYPE_NOT_ALLOWED',
      message: 'The file has no extension, so its type cannot be checked.',
    };
  const ext = parts.pop()!;
  if (parts.slice(1).some((p) => DANGEROUS.has(p)) || DANGEROUS.has(ext) || DANGEROUS.has(parts[0] ?? ''))
    return {
      ok: false,
      code: 'FILE_NAME_INVALID',
      message: 'Files with a hidden or double extension that looks like a program are not accepted.',
    };
  const kind = ALLOWED[ext];
  if (!kind)
    return {
      ok: false,
      code: 'FILE_TYPE_NOT_ALLOWED',
      message: `.${ext} files are not accepted. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.`,
    };
  if (bytes.length === 0) return { ok: false, code: 'FILE_EMPTY', message: 'The file is empty.' };
  if (bytes.length > MAX_FILE_BYTES)
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: 'The file is larger than 10 MB. Split it or compress it.',
    };
  if (!kind.magic(bytes))
    return {
      ok: false,
      code: 'FILE_CONTENT_MISMATCH',
      message: `The contents do not look like a real .${ext} file.`,
    };
  return { ok: true, safeName: base, contentType: kind.type, ext };
}

/**
 * SWAP POINT (docs/swap-points.md): virus scanner. The stub only recognises the standard EICAR test string, so the
 * "infected file" path can be demonstrated and tested without real malware. A real adapter calls an AV service.
 */
export function scanBytes(bytes: Buffer): 'CLEAN' | 'INFECTED' {
  return bytes.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') ? 'INFECTED' : 'CLEAN';
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/**
 * Encrypted object store on local disk (stands in for S3 + KMS). Bid files are sealed with AES-256-GCM using a key
 * derived from the server secret, so a copy of the storage folder alone reveals nothing.
 */
export class SealedStore {
  private readonly key: Buffer;
  private readonly root: string;
  constructor(dir: string, secret: string) {
    this.root = resolve(dir);
    this.key = Buffer.from(hkdfSync('sha256', secret, 'if-bid-file-seal', 'v1', 32));
  }
  private path(storageKey: string) {
    const p = resolve(join(this.root, storageKey));
    if (!p.startsWith(this.root + sep)) throw new Error('storage key escapes the storage folder');
    return p;
  }
  async put(storageKey: string, bytes: Buffer): Promise<void> {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(bytes), c.final()]);
    const file = this.path(storageKey);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, Buffer.concat([iv, c.getAuthTag(), body]));
  }
  async get(storageKey: string): Promise<Buffer> {
    const raw = await readFile(this.path(storageKey));
    const d = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
  }
  async remove(storageKey: string): Promise<void> {
    await rm(this.path(storageKey), { force: true });
  }
}
