import { describe, expect, it } from 'vitest';
import { renderDocx } from './docx.js';
import type { PdfDocument } from './pdf.js';

/** Reads the stored entries of a zip (every entry is method 0) so the parts of the package can be inspected. */
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let o = 0;
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const size = buf.readUInt32LE(o + 18);
    const nameLen = buf.readUInt16LE(o + 26);
    const extraLen = buf.readUInt16LE(o + 28);
    const name = buf.subarray(o + 30, o + 30 + nameLen).toString('utf8');
    const start = o + 30 + nameLen + extraLen;
    out[name] = buf.subarray(start, start + size).toString('utf8');
    o = start + size;
  }
  return out;
}
/** A cheap well-formedness check: every opened tag is closed in order. */
function balanced(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (m[3] === '/' || xml[m.index! + 1] === '?') continue;
    if (m[1] === '/') {
      if (stack.pop() !== m[2]) return false;
    } else stack.push(m[2]!);
  }
  return stack.length === 0;
}

const doc: PdfDocument = {
  title: 'Evaluation report PR-1',
  footer: 'Evaluation report PR-1 - generated 2026-10-02 09:00 UTC - version 3',
  created: new Date('2026-10-02T09:00:00Z'),
  blocks: [
    { type: 'title', text: 'Evaluation report' },
    { type: 'subtitle', text: 'PR-1 Cleaning & "grounds" <services>' },
    { type: 'kv', label: 'Status', value: 'Approved' },
    { type: 'rule' },
    { type: 'h2', text: 'Ranking' },
    { type: 'p', text: 'Plain paragraph with a control char \u0001 inside.' },
    { type: 'bullet', text: 'A bullet' },
    {
      type: 'table',
      columns: [
        { label: 'Rank', width: 0.2 },
        { label: 'Score', width: 0.8, align: 'right' },
      ],
      rows: [
        ['1', '82.5'],
        ['2', '70.0'],
      ],
    },
    { type: 'space' },
  ],
};

describe('Word writer (US-TND-05)', () => {
  const parts = unzip(renderDocx(doc));
  it('is a package with the parts Word needs', () => {
    expect(Object.keys(parts).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/footer1.xml',
      'word/styles.xml',
    ]);
    for (const [name, xml] of Object.entries(parts)) expect(balanced(xml), name).toBe(true);
  });
  it('carries the text, the table and the styles', () => {
    const body = parts['word/document.xml']!;
    expect(body).toContain('Evaluation report');
    expect(body).toContain('w:pStyle w:val="Title"');
    expect(body).toContain('w:pStyle w:val="Heading2"');
    expect(body).toContain('<w:tbl>');
    expect(body).toContain('82.5');
    expect(body).toContain('<w:jc w:val="right"/>');
    expect(body).toContain('<w:tblHeader/>');
  });
  it('escapes markup and drops characters XML cannot hold', () => {
    const body = parts['word/document.xml']!;
    expect(body).toContain('Cleaning &amp; &quot;grounds&quot; &lt;services&gt;');
    expect(body).not.toContain('\u0001');
    expect(body).toContain('Plain paragraph with a control char  inside.');
  });
  it('puts the document name, timestamp, version and a page number field in the footer, and the creation time in the properties', () => {
    const footer = parts['word/footer1.xml']!;
    expect(footer).toContain('generated 2026-10-02 09:00 UTC - version 3');
    expect(footer).toContain(' PAGE ');
    expect(parts['docProps/core.xml']).toContain('2026-10-02T09:00:00Z');
  });
  it('is deterministic', () => {
    expect(renderDocx(doc).equals(renderDocx(doc))).toBe(true);
  });
});
