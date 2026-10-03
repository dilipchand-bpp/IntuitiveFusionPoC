/**
 * A small, dependency-free PDF writer for the documents this portal produces (evaluation report, demo bid documents).
 * Built-in Helvetica fonts, A4 pages, word wrapping, headings, bullets, key/value lines and simple tables, with a footer
 * on every page carrying the document name, page number, timestamp and version (US-TND-05).
 * Streams are left uncompressed on purpose: the files are small and stay inspectable.
 */

export type PdfBlock =
  | { type: 'title'; text: string }
  | { type: 'subtitle'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'kv'; label: string; value: string }
  | {
      type: 'table';
      columns: Array<{ label: string; width: number; align?: 'left' | 'right' }>;
      rows: string[][];
    }
  | { type: 'rule' }
  | { type: 'space'; height?: number };

export interface PdfDocument {
  title: string;
  footer: string;
  created: Date;
  blocks: PdfBlock[];
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const FOOTER_Y = 30;
const BODY_BOTTOM = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Helvetica glyph widths per 1000 em for ASCII 32..126 (standard AFM metrics).
const W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
  500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469,
  556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Replacements for typographic characters Helvetica/WinAnsi cannot print the usual way (by code point, never by literal). */
const SWAP: Record<number, string> = {
  0x2013: '-',
  0x2014: '-',
  0x2212: '-',
  0x2018: "'",
  0x2019: "'",
  0x201c: '"',
  0x201d: '"',
  0x2026: '...',
  0xa0: ' ',
  0x0d: ' ',
  0x09: ' ',
};
/** A few Latin-1 letters and symbols WinAnsi prints directly (middle dot, multiplication, accented letters, pound). */
const KEEP = new Set([0xb7, 0xd7, 0xe9, 0xe8, 0xe0, 0xfc, 0xf6, 0xe4, 0xa3]);

/** Characters the built-in fonts can print; everything else becomes "?" so a stray symbol never corrupts the file. */
function clean(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += c === 10 || (c >= 32 && c <= 126) || KEEP.has(c) ? ch : (SWAP[c] ?? '?');
  }
  return out;
}

export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? W[c - 32]! : 556;
  }
  return (w / 1000) * size * (bold ? 1.06 : 1);
}

/** Greedy word wrap to a width in points. Words longer than the line are split. */
export function wrapText(text: string, size: number, width: number, bold = false): string[] {
  const out: string[] = [];
  for (const para of clean(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      let w = word;
      while (textWidth(w, size, bold) > width && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && textWidth(w.slice(0, cut), size, bold) > width) cut--;
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const next = line ? `${line} ${w}` : w;
      if (line && textWidth(next, size, bold) > width) {
        out.push(line);
        line = w;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const n = (v: number) => (Math.round(v * 100) / 100).toString();

interface Page {
  ops: string[];
}

export function renderPdf(doc: PdfDocument): Buffer {
  const pages: Page[] = [{ ops: [] }];
  let y = PAGE_H - MARGIN;
  const cur = () => pages[pages.length - 1]!;
  const newPage = () => {
    pages.push({ ops: [] });
    y = PAGE_H - MARGIN;
  };
  const ensure = (h: number) => {
    if (y - h < BODY_BOTTOM) newPage();
  };
  const text = (s: string, x: number, yy: number, size: number, bold = false, gray = 0) =>
    cur().ops.push(`BT ${n(gray)} g /${bold ? 'F2' : 'F1'} ${size} Tf ${n(x)} ${n(yy)} Td (${esc(s)}) Tj ET`);
  const rect = (x: number, yy: number, w: number, h: number, gray: number) =>
    cur().ops.push(`${n(gray)} g ${n(x)} ${n(yy)} ${n(w)} ${n(h)} re f 0 g`);

  const paragraph = (
    s: string,
    size: number,
    opts: { bold?: boolean; indent?: number; gap?: number; gray?: number } = {},
  ) => {
    const lh = size * 1.4;
    const indent = opts.indent ?? 0;
    for (const line of wrapText(s, size, CONTENT_W - indent, opts.bold)) {
      ensure(lh);
      y -= lh;
      if (line) text(line, MARGIN + indent, y, size, opts.bold, opts.gray ?? 0);
    }
    y -= opts.gap ?? 4;
  };

  for (const b of doc.blocks) {
    switch (b.type) {
      case 'title':
        paragraph(b.text, 22, { bold: true, gap: 4 });
        break;
      case 'subtitle':
        paragraph(b.text, 11, { gray: 0.35, gap: 10 });
        break;
      case 'h2':
        ensure(40);
        y -= 8;
        paragraph(b.text, 14, { bold: true, gap: 3 });
        break;
      case 'p':
        paragraph(b.text, 10.5, { gap: 6 });
        break;
      case 'bullet': {
        const lines = wrapText(b.text, 10.5, CONTENT_W - 16);
        const lh = 10.5 * 1.4;
        lines.forEach((line, i) => {
          ensure(lh);
          y -= lh;
          if (i === 0) text('-', MARGIN + 4, y, 10.5);
          text(line, MARGIN + 16, y, 10.5);
        });
        y -= 3;
        break;
      }
      case 'kv': {
        const lh = 10.5 * 1.4;
        const lines = wrapText(b.value, 10.5, CONTENT_W - 130);
        lines.forEach((line, i) => {
          ensure(lh);
          y -= lh;
          if (i === 0) text(b.label, MARGIN, y, 10.5, true);
          text(line, MARGIN + 130, y, 10.5);
        });
        y -= 2;
        break;
      }
      case 'rule':
        ensure(10);
        y -= 6;
        cur().ops.push(`0.8 G ${n(MARGIN)} ${n(y)} m ${n(PAGE_W - MARGIN)} ${n(y)} l S 0 G`);
        y -= 6;
        break;
      case 'space':
        y -= b.height ?? 10;
        break;
      case 'table': {
        const size = 9.5;
        const lh = size * 1.35;
        const widths = b.columns.map((c) => c.width * CONTENT_W);
        const drawRow = (cells: string[], bold: boolean, shade: boolean) => {
          const wrapped = cells.map((c, i) => wrapText(c, size, widths[i]! - 8, bold));
          const rows = Math.max(...wrapped.map((w) => w.length));
          const h = rows * lh + 8;
          ensure(h);
          if (shade) rect(MARGIN, y - h, CONTENT_W, h, 0.93);
          let x = MARGIN;
          wrapped.forEach((lines, i) => {
            const col = b.columns[i]!;
            lines.forEach((line, k) => {
              const tw = textWidth(line, size, bold);
              const tx = col.align === 'right' ? x + widths[i]! - 4 - tw : x + 4;
              text(line, tx, y - 4 - lh * (k + 1) + 3, size, bold);
            });
            x += widths[i]!;
          });
          y -= h;
          cur().ops.push(`0.85 G ${n(MARGIN)} ${n(y)} m ${n(PAGE_W - MARGIN)} ${n(y)} l S 0 G`);
        };
        drawRow(
          b.columns.map((c) => c.label),
          true,
          true,
        );
        for (const r of b.rows) drawRow(r, false, false);
        y -= 8;
        break;
      }
    }
  }

  // footer on every page: name, page x of y, generated timestamp and version
  pages.forEach((p, i) => {
    const old = pages;
    void old;
    p.ops.push(`0.8 G ${n(MARGIN)} ${n(FOOTER_Y + 12)} m ${n(PAGE_W - MARGIN)} ${n(FOOTER_Y + 12)} l S 0 G`);
    p.ops.push(`BT 0.4 g /F1 8 Tf ${n(MARGIN)} ${n(FOOTER_Y)} Td (${esc(clean(doc.footer))}) Tj ET`);
    const label = `Page ${i + 1} of ${pages.length}`;
    p.ops.push(
      `BT 0.4 g /F1 8 Tf ${n(PAGE_W - MARGIN - textWidth(label, 8))} ${n(FOOTER_Y)} Td (${label}) Tj ET`,
    );
  });

  // ---- assemble the file with a correct cross-reference table
  const objs: Buffer[] = [];
  const add = (body: string | Buffer) => {
    objs.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body);
    return objs.length; // object number
  };
  const pageNums = pages.map((_, i) => 5 + i * 2);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Kids [${pageNums.map((p) => `${p} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  for (const p of pages) {
    const content = Buffer.from(p.ops.join('\n'), 'latin1');
    const pageNo = objs.length + 1;
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PAGE_W)} ${n(PAGE_H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageNo + 1} 0 R >>`,
    );
    add(
      Buffer.concat([
        Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'),
        content,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    );
  }
  const pdfDate = `D:${doc.created.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
  const info = add(
    `<< /Title (${esc(clean(doc.title))}) /Producer (Intuitive Fusion POC) /CreationDate (${pdfDate}) >>`,
  );

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%âãÏÓ\n', 'latin1')];
  const offsets: number[] = [];
  let pos = chunks[0]!.length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
    const tail = Buffer.from('\nendobj\n', 'latin1');
    chunks.push(head, o, tail);
    pos += head.length + o.length + tail.length;
  });
  const xref = [
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`),
  ].join('');
  chunks.push(
    Buffer.from(
      `${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`,
      'latin1',
    ),
  );
  return Buffer.concat(chunks);
}
