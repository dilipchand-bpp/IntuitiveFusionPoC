/** Test helper for the cpocr tests: builds a zip (stored or deflated entries, optionally lying about the size). Not a test file. */
import { deflateRawSync, crc32 } from 'node:zlib';

export function zip(entries: Array<{ name: string; data: Buffer; method?: 0 | 8; usize?: number }>): Buffer {
  const parts: Buffer[] = [];
  const cen: Buffer[] = [];
  let off = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const body = method === 8 ? deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc32(e.data), 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(e.usize ?? e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc32(e.data), 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(e.usize ?? e.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(off, 42);
    parts.push(lh, name, body);
    cen.push(ch, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(cen);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
