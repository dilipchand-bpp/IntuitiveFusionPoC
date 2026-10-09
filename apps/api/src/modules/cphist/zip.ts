/**
 * A small, defensive ZIP reader (CP-07). It reads the central directory, never extracts to disk, and refuses what a
 * hostile archive does: too many entries, encrypted or ZIP64 members, a member or the whole archive that expands past a
 * limit (a "zip bomb"), a compression ratio no honest file has, and sizes in the headers that do not match the data.
 * Only stored (0) and deflate (8) members are read. Used for .xlsx workbooks and for a zip of contract files.
 */
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export class ZipError extends Error {
  constructor(
    readonly code:
      | 'ZIP_INVALID'
      | 'ZIP_TOO_MANY_ENTRIES'
      | 'ZIP_TOO_LARGE'
      | 'ZIP_BOMB'
      | 'ZIP_ENCRYPTED'
      | 'ZIP_UNSUPPORTED',
    message: string,
  ) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipLimits {
  maxEntries: number;
  /** Largest a single member may be once expanded. */
  maxEntryBytes: number;
  /** Largest all the members read may be once expanded. */
  maxTotalBytes: number;
  /** A member that expands more than this many times its stored size (and is not small) is refused. */
  maxRatio: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 400,
  maxEntryBytes: 24 * 1024 * 1024,
  maxTotalBytes: 48 * 1024 * 1024,
  maxRatio: 120,
};

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  crc: number;
  offset: number;
  flags: number;
}

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

/** The members of the archive, from its central directory, with every size checked against the limits. */
export function listZip(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  if (buf.length < 22 || buf.readUInt32LE(0) !== LOC) throw new ZipError('ZIP_INVALID', 'Not a zip file');
  // the end-of-central-directory record is in the last 64 KB + 22 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('ZIP_INVALID', 'The zip directory is missing or damaged');
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
    throw new ZipError('ZIP_UNSUPPORTED', 'ZIP64 archives are not supported');
  if (total > limits.maxEntries)
    throw new ZipError(
      'ZIP_TOO_MANY_ENTRIES',
      `The archive has ${total} entries; at most ${limits.maxEntries}`,
    );
  if (cdOffset + cdSize > buf.length) throw new ZipError('ZIP_INVALID', 'The zip directory is damaged');
  const out: ZipEntry[] = [];
  let p = cdOffset;
  let declared = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN)
      throw new ZipError('ZIP_INVALID', 'The zip directory is damaged');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > buf.length) throw new ZipError('ZIP_INVALID', 'The zip directory is damaged');
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff)
      throw new ZipError('ZIP_UNSUPPORTED', 'ZIP64 archives are not supported');
    if (flags & 1) throw new ZipError('ZIP_ENCRYPTED', 'Encrypted zip files are not accepted');
    if (size > limits.maxEntryBytes)
      throw new ZipError('ZIP_TOO_LARGE', `"${name.slice(0, 60)}" expands to more than the limit`);
    if (size > 1_000_000 && size / Math.max(1, compressedSize) > limits.maxRatio)
      throw new ZipError('ZIP_BOMB', `"${name.slice(0, 60)}" has an implausible compression ratio`);
    declared += size;
    if (declared > limits.maxTotalBytes)
      throw new ZipError('ZIP_TOO_LARGE', 'The archive expands to more than the limit');
    out.push({ name, method, compressedSize, size, crc, offset, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Expands one member, never producing more than its declared size (and never more than the limit). */
export function readEntry(buf: Buffer, e: ZipEntry, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Buffer {
  const o = e.offset;
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== LOC)
    throw new ZipError('ZIP_INVALID', `"${e.name.slice(0, 60)}" is damaged`);
  const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  if (start + e.compressedSize > buf.length)
    throw new ZipError('ZIP_INVALID', `"${e.name.slice(0, 60)}" is truncated`);
  const raw = buf.subarray(start, start + e.compressedSize);
  let data: Buffer;
  if (e.method === 0) data = Buffer.from(raw);
  else if (e.method === 8) {
    try {
      // the cap is the declared size: a member that really expands further is a lie in its header, and is refused
      data = inflateRawSync(raw, { maxOutputLength: Math.min(e.size, limits.maxEntryBytes) + 1 });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (/larger than|maxOutputLength|buffer/i.test(msg))
        throw new ZipError('ZIP_BOMB', `"${e.name.slice(0, 60)}" expands past its declared size`);
      throw new ZipError('ZIP_INVALID', `"${e.name.slice(0, 60)}" cannot be read`);
    }
  } else
    throw new ZipError('ZIP_UNSUPPORTED', `"${e.name.slice(0, 60)}" uses an unsupported compression method`);
  if (data.length !== e.size)
    throw new ZipError('ZIP_INVALID', `"${e.name.slice(0, 60)}" has the wrong size`);
  if (crc32(data) !== e.crc) throw new ZipError('ZIP_INVALID', `"${e.name.slice(0, 60)}" fails its checksum`);
  return data;
}

/** Reads one named member (case-insensitive path), tracking the bytes expanded so far in `budget`. */
export function readNamed(
  buf: Buffer,
  entries: ZipEntry[],
  name: string,
  budget: { used: number },
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): Buffer | null {
  const e = entries.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!e) return null;
  budget.used += e.size;
  if (budget.used > limits.maxTotalBytes)
    throw new ZipError('ZIP_TOO_LARGE', 'The archive expands to more than the limit');
  return readEntry(buf, e, limits);
}

export interface ZipMember {
  name: string;
  data: Buffer;
  /** 8 (default) deflates; 0 stores. */
  method?: 0 | 8;
  /** Test hook: write a different uncompressed size in the headers than the data really has (a lying archive). */
  declaredSize?: number;
}

/** Writes a zip archive (deflate by default). Used for the generated samples and templates, and to build hostile archives in tests. */
export function writeZip(members: ZipMember[]): Buffer {
  const DOS_DATE = (2026 - 1980) * 512 + 1 * 32 + 1;
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const m of members) {
    const name = Buffer.from(m.name, 'utf8');
    const method = m.method ?? 8;
    const body = method === 8 ? deflateRawSync(m.data, { level: 6 }) : m.data;
    const crc = crc32(m.data);
    const size = m.declaredSize ?? m.data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(LOC, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    local.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(CEN, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
