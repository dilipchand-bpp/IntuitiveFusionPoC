import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { renderPdf, textWidth, wrapText, type PdfBlock } from './pdf.js';
import { buildXlsx } from './xlsx.js';

const doc = (blocks: PdfBlock[]) =>
  renderPdf({
    title: 'Test (report)',
    footer: 'Test report - generated 2026-10-02 00:00 UTC - version 3',
    created: new Date('2026-10-02T00:00:00Z'),
    blocks,
  });

/** Independent checks a PDF reader performs: header, every xref offset lands on "N 0 obj", stream lengths are exact. */
function checkStructure(buf: Buffer) {
  const s = buf.toString('latin1');
  expect(s.startsWith('%PDF-1.4')).toBe(true);
  expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  const start = Number(/startxref\n(\d+)\n%%EOF/.exec(s)![1]);
  expect(s.slice(start, start + 4)).toBe('xref');
  const m = /xref\n0 (\d+)\n/.exec(s.slice(start))!;
  const count = Number(m[1]);
  const lines = s
    .slice(start + m[0].length)
    .split('\n')
    .slice(0, count);
  expect(lines[0]).toBe('0000000000 65535 f ');
  for (let i = 1; i < count; i++) {
    const off = Number(lines[i]!.slice(0, 10));
    expect(s.slice(off, off + `${i} 0 obj`.length), `object ${i}`).toBe(`${i} 0 obj`);
    expect(lines[i]).toMatch(/^\d{10} 00000 n $/);
  }
  for (const sm of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const from = sm.index! + sm[0].length;
    expect(s.slice(from + Number(sm[1]), from + Number(sm[1]) + '\nendstream'.length)).toBe('\nendstream');
  }
  expect(Number(/\/Size (\d+)/.exec(s)![1])).toBe(count);
  return { text: s, objects: count - 1, pages: [...s.matchAll(/\/Type \/Page /g)].length };
}

describe('pdf writer', () => {
  it('produces a structurally valid file with the text, title, timestamp and version in it', () => {
    const r = checkStructure(
      doc([
        { type: 'title', text: 'Evaluation report' },
        { type: 'p', text: 'Brightwave ranked first (score 90.0).' },
      ]),
    );
    expect(r.pages).toBe(1);
    expect(r.text).toContain('(Evaluation report) Tj');
    expect(r.text).toContain('Brightwave ranked first \\(score 90.0\\).');
    expect(r.text).toContain('version 3');
    expect(r.text).toContain('Page 1 of 1');
    expect(r.text).toContain('/Title (Test \\(report\\))');
    expect(r.text).toContain('/CreationDate (D:20261002000000Z)');
  });

  it('flows long content onto more pages, and every page is numbered "of N"', () => {
    const blocks: PdfBlock[] = [];
    for (let i = 0; i < 80; i++)
      blocks.push({
        type: 'p',
        text: `Paragraph ${i}. ${'The panel agreed and recorded the reason. '.repeat(6)}`,
      });
    const r = checkStructure(doc(blocks));
    expect(r.pages).toBeGreaterThanOrEqual(3);
    for (let i = 1; i <= r.pages; i++) expect(r.text).toContain(`Page ${i} of ${r.pages}`);
  });

  it('wraps text inside the margins and splits a very long word instead of overflowing', () => {
    const lines = wrapText('word '.repeat(60) + 'x'.repeat(200), 10.5, 300);
    expect(lines.length).toBeGreaterThan(4);
    for (const l of lines) expect(textWidth(l, 10.5), l).toBeLessThanOrEqual(300 + 1);
  });

  it('handles tables, bullets, key/value lines, rules and awkward characters without corrupting the file', () => {
    const r = checkStructure(
      doc([
        { type: 'h2', text: 'Ranking' },
        {
          type: 'table',
          columns: [
            { label: 'Rank', width: 0.15 },
            { label: 'Supplier', width: 0.55 },
            { label: 'Score', width: 0.3, align: 'right' },
          ],
          rows: [
            ['1', 'Brightwave Cleaning Pty Ltd', '90.0'],
            ['2', 'Evergreen – “quoted” … 中文 (x)', '75.5'],
          ],
        },
        { type: 'bullet', text: 'A bullet with a backslash \\ and parentheses (inside).' },
        { type: 'kv', label: 'Generated', value: '2026-10-02 00:00 UTC' },
        { type: 'rule' },
        { type: 'space' },
      ]),
    );
    expect(r.text).toContain('\\(inside\\)');
    expect(r.text).toContain('Evergreen - "quoted" ... ?? (x)'.replace('(x)', '\\(x\\)'));
  });

  it('is deterministic for the same input', () => {
    const b: PdfBlock[] = [{ type: 'p', text: 'Same input, same bytes.' }];
    expect(doc(b).equals(doc(b))).toBe(true);
  });
});

describe('xlsx writer', () => {
  /** Reads the zip back the way a reader does: end record, central directory, local headers, CRCs. */
  function read(buf: Buffer) {
    const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const total = buf.readUInt16LE(end + 10);
    let p = buf.readUInt32LE(end + 16);
    const out = new Map<string, string>();
    for (let i = 0; i < total; i++) {
      expect(buf.readUInt32LE(p)).toBe(0x02014b50);
      const crc = buf.readUInt32LE(p + 16);
      const size = buf.readUInt32LE(p + 24);
      const nameLen = buf.readUInt16LE(p + 28);
      const off = buf.readUInt32LE(p + 42);
      const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      expect(buf.readUInt32LE(off)).toBe(0x04034b50);
      const dataStart = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
      const data = buf.subarray(dataStart, dataStart + size);
      expect(crc32(data), name).toBe(crc);
      out.set(name, data.toString('utf8'));
      p += 46 + nameLen;
    }
    return out;
  }
  it('is a valid archive with every part an Excel workbook needs, and the cells it was given', () => {
    const files = read(
      buildXlsx('Pricing', [
        ['Item', 'Year 1'],
        ['Cleaning & waste <all sites>', 120000.5],
      ]),
    );
    expect([...files.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('Cleaning &amp; waste &lt;all sites&gt;');
    expect(sheet).toContain('<c r="B2"><v>120000.5</v></c>');
    expect(files.get('xl/workbook.xml')).toContain('name="Pricing"');
  });
});
