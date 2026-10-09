/**
 * A defensive ZIP reader for contract uploads (CP-07). Zip files from outside are untrusted, so:
 *   - every entry name is checked: no "..", no absolute or drive paths, no NUL; one bad name refuses the whole archive;
 *   - limits on the number of entries, the size of each entry and of everything together, and on the compression ratio;
 *   - the declared sizes are not believed: an entry is inflated with a hard output cap, so an archive that lies about its size
 *     is refused as a zip bomb instead of filling memory;
 *   - nothing is ever written to disk, so a hostile name cannot reach the file system;
 *   - nested archives are not opened, encrypted entries are not read, CRCs are checked.
 * Only reads the central directory (the ZIP64 extension is not supported and is refused).
 */
import { crc32, inflateRawSync } from 'node:zlib';

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  /** Larger than this ratio of expanded to stored size, for an entry over one megabyte, is refused as a bomb. */
  maxRatio: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 100,
  maxEntryBytes: 15 * 1024 * 1024,
  maxTotalBytes: 60 * 1024 * 1024,
  maxRatio: 100,
};

export type ArchiveCode =
  'ZIP_INVALID' | 'ZIP_PATH_TRAVERSAL' | 'ZIP_BOMB' | 'ZIP_TOO_MANY_ENTRIES' | 'ZIP_TOO_LARGE';

export class ArchiveError extends Error {
  constructor(
    public readonly code: ArchiveCode,
    message: string,
  ) {
    super(message);
    this.name = 'ArchiveError';
  }
}

export interface ZipEntry {
  /** Normalised path inside the archive, forward slashes. */
  path: string;
  data: Buffer;
}
export interface ZipSkip {
  path: string;
  reason: string;
}

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;

/** The entry's name made safe to show, or an ArchiveError when it tries to leave the archive. */
export function safeEntryPath(raw: string): string {
  if (raw.includes('\u0000'))
    throw new ArchiveError('ZIP_PATH_TRAVERSAL', 'An entry name contains a NUL character.');
  const p = raw.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.startsWith('//'))
    throw new ArchiveError('ZIP_PATH_TRAVERSAL', 'An entry name is an absolute path.');
  const parts = p.split('/');
  if (parts.some((s) => s === '..'))
    throw new ArchiveError('ZIP_PATH_TRAVERSAL', 'An entry name leaves the archive (..).');
  return parts.filter((s) => s !== '' && s !== '.').join('/') + (p.endsWith('/') ? '/' : '');
}

export function readZip(
  buf: Buffer,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): { entries: ZipEntry[]; skipped: ZipSkip[] } {
  // end of central directory record: the last 22 bytes plus a comment of up to 65535 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--)
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new ArchiveError('ZIP_INVALID', 'This is not a valid zip file.');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff)
    throw new ArchiveError('ZIP_INVALID', 'Zip64 archives are not supported.');
  if (count > limits.maxEntries)
    throw new ArchiveError('ZIP_TOO_MANY_ENTRIES', `The zip has more than ${limits.maxEntries} entries.`);
  if (cdOffset + cdSize > buf.length) throw new ArchiveError('ZIP_INVALID', 'The zip directory is damaged.');

  interface Cen {
    name: string;
    method: number;
    flags: number;
    crc: number;
    csize: number;
    usize: number;
    offset: number;
  }
  const cens: Cen[] = [];
  let p = cdOffset;
  let declared = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN)
      throw new ArchiveError('ZIP_INVALID', 'The zip directory is damaged.');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const c: Cen = {
      name,
      flags: buf.readUInt16LE(p + 8),
      method: buf.readUInt16LE(p + 10),
      crc: buf.readUInt32LE(p + 16),
      csize: buf.readUInt32LE(p + 20),
      usize: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42),
    };
    // every name is validated, including the ones that will be skipped: one hostile name refuses the archive
    safeEntryPath(name);
    declared += c.usize;
    if (declared > limits.maxTotalBytes)
      throw new ArchiveError('ZIP_BOMB', 'The archive would expand to more than the allowed total size.');
    if (c.usize > 1024 * 1024 && c.csize > 0 && c.usize / c.csize > limits.maxRatio)
      throw new ArchiveError('ZIP_BOMB', 'An entry has an implausible compression ratio.');
    cens.push(c);
    p += 46 + nameLen + extraLen + commentLen;
  }

  const entries: ZipEntry[] = [];
  const skipped: ZipSkip[] = [];
  let total = 0;
  for (const c of cens) {
    const path = safeEntryPath(c.name);
    if (path.endsWith('/') || path === '' || JUNK.test(path)) continue;
    if (c.flags & 1) {
      skipped.push({ path, reason: 'encrypted entries are not read' });
      continue;
    }
    if (c.usize > limits.maxEntryBytes) {
      skipped.push({ path, reason: `larger than ${Math.round(limits.maxEntryBytes / 1048576)} MB` });
      continue;
    }
    if (c.offset + 30 > buf.length || buf.readUInt32LE(c.offset) !== LOC)
      throw new ArchiveError('ZIP_INVALID', 'A zip entry header is damaged.');
    const start = c.offset + 30 + buf.readUInt16LE(c.offset + 26) + buf.readUInt16LE(c.offset + 28);
    if (start + c.csize > buf.length)
      throw new ArchiveError('ZIP_INVALID', 'A zip entry runs past the end of the file.');
    const raw = buf.subarray(start, start + c.csize);
    let data: Buffer;
    if (c.method === 0) data = Buffer.from(raw);
    else if (c.method === 8) {
      try {
        // the cap is the declared size plus one byte: an entry that expands further than it said is a bomb
        data = inflateRawSync(raw, { maxOutputLength: c.usize + 1 });
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'ERR_BUFFER_TOO_LARGE')
          throw new ArchiveError('ZIP_BOMB', 'An entry expands to more than its declared size.');
        throw new ArchiveError('ZIP_INVALID', 'A zip entry could not be inflated.');
      }
    } else {
      skipped.push({ path, reason: `unsupported compression method ${c.method}` });
      continue;
    }
    if (data.length !== c.usize)
      throw new ArchiveError('ZIP_INVALID', 'A zip entry is not the size the directory says.');
    if (crc32(data) !== c.crc) throw new ArchiveError('ZIP_INVALID', 'A zip entry failed its checksum.');
    total += data.length;
    if (total > limits.maxTotalBytes)
      throw new ArchiveError('ZIP_TOO_LARGE', 'The archive expands to more than the allowed total size.');
    entries.push({ path, data });
  }
  return { entries, skipped };
}
