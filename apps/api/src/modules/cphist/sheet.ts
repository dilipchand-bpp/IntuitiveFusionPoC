/**
 * Reading a spreadsheet upload (CP-07): .xlsx by reading the zip and its XML parts directly (no spreadsheet library, so
 * nothing with a known advisory is pulled in), and CSV with delimiter detection. What is read is always a VALUE:
 *   - formulas are never evaluated; a formula cell yields the value the file stored for it (and is counted and reported);
 *   - macros (xl/vbaProject.bin) are never opened or run; their presence is reported;
 *   - external links, embedded objects and images are ignored;
 *   - a document type declaration or entity definition in any part makes the file unsafe and it is refused.
 * Limits (file size, expanded size, rows, columns, cell length) keep a hostile file from costing more than a normal one.
 */
import { ZipError, listZip, readNamed, writeZip, type ZipEntry } from './zip.js';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 5000;
export const MAX_COLUMNS = 80;
const MAX_CELL_CHARS = 4000;

export type SheetErrorCode =
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE_UNSUPPORTED'
  | 'FILE_UNSAFE'
  | 'FILE_DAMAGED'
  | 'TOO_MANY_ROWS'
  | 'TOO_MANY_COLUMNS'
  | 'NO_DATA';

export class SheetError extends Error {
  constructor(
    readonly code: SheetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SheetError';
  }
}

export interface ParsedTable {
  kind: 'XLSX' | 'CSV';
  sheetName: string | null;
  sheets: string[];
  headers: string[];
  /** Every row has exactly `headers.length` cells, all text (dates read from date-formatted cells are yyyy-mm-dd). */
  rows: string[][];
  warnings: string[];
}

// ------------------------------------------------------------------ XML helpers (a tolerant reader for the few tags we need)
const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITY[e.toLowerCase()] ?? '';
  });
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"|([A-Za-z_][\w:.-]*)\s*=\s*'([^']*)'/g))
    out[(m[1] ?? m[3])!] = unescapeXml((m[2] ?? m[4])!);
  return out;
}

function assertSafeXml(name: string, xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new SheetError(
      'FILE_UNSAFE',
      `The workbook part "${name}" declares entities, which is not accepted`,
    );
}

/** The visible text of a shared-string item or inline string: every <t>, in order, leaving out phonetic runs. */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let s = '';
  for (const m of clean.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) s += unescapeXml(m[1] ?? '');
  return s;
}

const colIndex = (ref: string): number => {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.toUpperCase().charCodeAt(0) - 64);
  return n - 1;
};

const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54,
  55, 56, 57, 58,
]);
function isDateFormatCode(code: string): boolean {
  const c = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '');
  return /[dmyhs]/i.test(c) && !/^(general|0|#)/i.test(c.trim());
}

/** An Excel serial day number as yyyy-mm-dd (the 1900 system, with its phantom 29 Feb 1900; or the 1904 system). */
export function excelSerialToIso(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const whole = Math.floor(serial);
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const adjust = date1904 ? whole : whole >= 61 ? whole : whole + 1;
  const d = new Date(base + adjust * 86_400_000);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ .xlsx
function readXlsx(buf: Buffer, wantedSheet?: string): ParsedTable {
  let entries: ZipEntry[];
  try {
    entries = listZip(buf);
  } catch (e) {
    if (e instanceof ZipError)
      throw new SheetError(e.code === 'ZIP_INVALID' ? 'FILE_DAMAGED' : 'FILE_UNSAFE', e.message);
    throw e;
  }
  const budget = { used: 0 };
  const get = (name: string): string | null => {
    try {
      const b = readNamed(buf, entries, name, budget);
      if (!b) return null;
      const text = b.toString('utf8');
      assertSafeXml(name, text);
      return text;
    } catch (e) {
      if (e instanceof ZipError)
        throw new SheetError(e.code === 'ZIP_INVALID' ? 'FILE_DAMAGED' : 'FILE_UNSAFE', e.message);
      throw e;
    }
  };
  const warnings: string[] = [];
  const workbook = get('xl/workbook.xml');
  if (!workbook)
    throw new SheetError('FILE_TYPE_UNSUPPORTED', 'This zip file is not an Excel workbook (.xlsx)');

  const macros = entries.some((e) => /(^|\/)vbaProject\.bin$/i.test(e.name));
  if (macros) warnings.push('The workbook contains macros. They were ignored and never run.');
  if (entries.some((e) => /^xl\/externalLinks\//i.test(e.name)))
    warnings.push(
      'The workbook links to other files. The links were ignored; only the stored values were read.',
    );

  const date1904 = /<workbookPr\b[^>]*date1904\s*=\s*"(?:1|true)"/i.test(workbook);
  const rels = new Map<string, string>();
  const relsXml = get('xl/_rels/workbook.xml.rels') ?? '';
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const a = attrs(m[0]);
    if (a.Id && a.Target) rels.set(a.Id, a.Target);
  }
  const sheetsMeta: Array<{ name: string; target: string | null; hidden: boolean }> = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const a = attrs(m[0]);
    const rid = a['r:id'] ?? a.id ?? '';
    let target = rels.get(rid) ?? null;
    if (target) target = target.startsWith('/') ? target.slice(1) : `xl/${target}`.replace(/xl\/\.\.\//, '');
    sheetsMeta.push({ name: a.name ?? 'Sheet', target, hidden: /hidden/i.test(a.state ?? '') });
  }
  const visible = sheetsMeta.filter((s) => s.target && /worksheets?\//i.test(s.target) && !s.hidden);
  if (visible.length === 0) throw new SheetError('NO_DATA', 'The workbook has no worksheet with data');
  const pick = wantedSheet
    ? visible.find((s) => s.name.toLowerCase() === wantedSheet.toLowerCase())
    : visible[0];
  if (!pick) throw new SheetError('NO_DATA', `There is no sheet called "${wantedSheet}" in the workbook`);
  if (visible.length > 1 && !wantedSheet)
    warnings.push(`The workbook has ${visible.length} sheets; the first ("${pick.name}") was read.`);

  // shared strings
  let shared: string[] = [];
  const sst = get('xl/sharedStrings.xml');
  if (sst) {
    shared = [];
    for (const m of sst.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
      shared.push(textOf(m[1] ?? ''));
      if (shared.length > 400_000)
        throw new SheetError('FILE_UNSAFE', 'The workbook has too many shared strings');
    }
  }
  // which cell formats are dates
  const dateXf: boolean[] = [];
  const styles = get('xl/styles.xml');
  if (styles) {
    const custom = new Map<number, string>();
    for (const m of styles.matchAll(/<numFmt\b[^>]*\/?>/g)) {
      const a = attrs(m[0]);
      if (a.numFmtId && a.formatCode) custom.set(Number(a.numFmtId), a.formatCode);
    }
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
    for (const m of xfs.matchAll(/<xf\b[^>]*?\/?>/g)) {
      const id = Number(attrs(m[0]).numFmtId ?? 0);
      dateXf.push(BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormatCode(custom.get(id)!)));
    }
  }

  const sheetXml = get(pick.target!);
  if (sheetXml === null)
    throw new SheetError('FILE_DAMAGED', `The sheet "${pick.name}" is missing from the file`);
  let formulas = 0;
  let formulaNoValue = 0;
  let errorCells = 0;
  const grid: string[][] = [];
  let maxCol = 0;
  let rowSeq = 0;
  for (const rm of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ra = attrs(rm[1]!);
    const rowIdx = ra.r ? Number(ra.r) - 1 : rowSeq;
    rowSeq = rowIdx + 1;
    if (rowIdx >= MAX_ROWS + 60)
      throw new SheetError('TOO_MANY_ROWS', `The sheet has more than ${MAX_ROWS} rows`);
    const body = rm[2] ?? '';
    const cells: string[] = [];
    let colSeq = 0;
    for (const cm of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = attrs(cm[1]!);
      const ci = ca.r ? colIndex(ca.r) : colSeq;
      colSeq = ci + 1;
      if (ci >= MAX_COLUMNS + 20)
        throw new SheetError('TOO_MANY_COLUMNS', `The sheet has more than ${MAX_COLUMNS} columns`);
      const inner = cm[2] ?? '';
      const hasFormula = /<f\b/.test(inner);
      if (hasFormula) formulas += 1;
      const vm = /<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/.exec(inner);
      const v = vm ? unescapeXml(vm[1] ?? '') : null;
      let val = '';
      const t = ca.t ?? 'n';
      if (t === 's') val = v !== null ? (shared[Number(v)] ?? '') : '';
      else if (t === 'inlineStr') val = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? '');
      else if (t === 'str') val = v ?? '';
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (t === 'e') {
        val = '';
        errorCells += 1;
      } else if (t === 'd') val = (v ?? '').slice(0, 10);
      else if (v !== null && v.trim() !== '') {
        const n = Number(v);
        if (Number.isFinite(n)) {
          const xf = ca.s !== undefined ? Number(ca.s) : -1;
          if (xf >= 0 && dateXf[xf]) val = excelSerialToIso(n, date1904) ?? String(n);
          else val = String(Math.round(n * 1e8) / 1e8);
        } else val = v;
      }
      if (hasFormula && v === null) formulaNoValue += 1;
      if (val.length > MAX_CELL_CHARS) val = val.slice(0, MAX_CELL_CHARS);
      cells[ci] = val;
      if (val !== '' && ci + 1 > maxCol) maxCol = ci + 1;
    }
    for (let i = 0; i < cells.length; i++) cells[i] ??= '';
    grid[rowIdx] = cells;
  }
  if (formulas > 0)
    warnings.push(
      `${formulas} formula cell(s) were read as the values stored in the file; no formula was calculated.${
        formulaNoValue > 0 ? ` ${formulaNoValue} had no stored value and are empty.` : ''
      }`,
    );
  if (errorCells > 0) warnings.push(`${errorCells} cell(s) held a spreadsheet error value and are empty.`);
  const table = tableFrom(
    grid.filter((r) => r !== undefined),
    maxCol,
    warnings,
  );
  return { kind: 'XLSX', sheetName: pick.name, sheets: visible.map((s) => s.name), ...table, warnings };
}

/** Header row detection and clean-up shared by both file kinds. */
function tableFrom(
  grid: string[][],
  width: number,
  warnings: string[],
): { headers: string[]; rows: string[][] } {
  const nonEmpty = (r: string[]) => r.filter((c) => (c ?? '').trim() !== '').length;
  let h = -1;
  for (let i = 0; i < Math.min(grid.length, 12); i++)
    if (nonEmpty(grid[i]!) >= Math.min(2, Math.max(1, width))) {
      h = i;
      break;
    }
  if (h < 0) throw new SheetError('NO_DATA', 'The file has no header row and no data rows');
  if (h > 0) warnings.push(`${h} line(s) above the header row were ignored.`);
  const head = grid[h]!;
  const cols = Math.max(head.length, width);
  if (cols > MAX_COLUMNS)
    throw new SheetError('TOO_MANY_COLUMNS', `The file has more than ${MAX_COLUMNS} columns`);
  const seen = new Map<string, number>();
  const headers: string[] = [];
  let last = cols;
  while (last > 0 && (head[last - 1] ?? '').trim() === '') last--;
  for (let i = 0; i < last; i++) {
    let name = (head[i] ?? '').replace(/\s+/g, ' ').trim() || `Column ${i + 1}`;
    const k = name.toLowerCase();
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n > 1) name = `${name} (${n})`;
    headers.push(name);
  }
  const rows: string[][] = [];
  for (const r of grid.slice(h + 1)) {
    const row = headers.map((_, i) => (r?.[i] ?? '').toString().trim());
    if (row.some((c) => c !== '')) rows.push(row);
    if (rows.length > MAX_ROWS)
      throw new SheetError('TOO_MANY_ROWS', `The file has more than ${MAX_ROWS} data rows`);
  }
  if (rows.length === 0) throw new SheetError('NO_DATA', 'The file has a header row but no data rows');
  return { headers, rows };
}

// ------------------------------------------------------------------ CSV
function decodeText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
    return buf.subarray(3).toString('utf8');
  return buf.toString('utf8');
}

/** RFC 4180 reader with a chosen delimiter. */
export function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 60)
        throw new SheetError('TOO_MANY_ROWS', `The file has more than ${MAX_ROWS} rows`);
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  let best = ',';
  let bestN = -1;
  for (const d of [',', ';', '\t', '|']) {
    let n = 0;
    let q = false;
    for (const ch of first) {
      if (ch === '"') q = !q;
      else if (!q && ch === d) n++;
    }
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

function readCsv(buf: Buffer): ParsedTable {
  const text = decodeText(buf);
  const delim = detectDelimiter(text);
  const warnings: string[] = [];
  if (delim !== ',') warnings.push(`The file uses "${delim === '\t' ? 'tab' : delim}" as its separator.`);
  const grid = parseDelimited(text, delim).map((r) => r.map((c) => c.slice(0, MAX_CELL_CHARS)));
  const width = grid.reduce((n, r) => Math.max(n, r.length), 0);
  const t = tableFrom(grid, width, warnings);
  return { kind: 'CSV', sheetName: null, sheets: [], ...t, warnings };
}

// ------------------------------------------------------------------ entry point
export function sniffKind(bytes: Buffer, filename: string): 'XLSX' | 'CSV' | 'ZIP' | 'XLS' | 'UNKNOWN' {
  const isZip =
    bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
  if (isZip) return /\.(xlsx|xlsm)$/i.test(filename) ? 'XLSX' : /\.zip$/i.test(filename) ? 'ZIP' : 'XLSX';
  if (bytes.length > 8 && bytes.readUInt32BE(0) === 0xd0cf11e0) return 'XLS';
  const head = bytes.subarray(0, 8192);
  if (head.includes(0) && !(head[0] === 0xff && head[1] === 0xfe)) return 'UNKNOWN';
  return 'CSV';
}

/** Reads an uploaded .xlsx or .csv into a header row and text rows. Throws SheetError. */
export function parseTable(bytes: Buffer, filename: string, sheet?: string): ParsedTable {
  if (bytes.length === 0) throw new SheetError('NO_DATA', 'The file is empty');
  if (bytes.length > MAX_FILE_BYTES)
    throw new SheetError('FILE_TOO_LARGE', `The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  const kind = sniffKind(bytes, filename);
  if (kind === 'XLS')
    throw new SheetError(
      'FILE_TYPE_UNSUPPORTED',
      'Old .xls files are not read. Save the sheet as .xlsx or CSV and upload that.',
    );
  if (kind === 'ZIP' || kind === 'UNKNOWN')
    throw new SheetError('FILE_TYPE_UNSUPPORTED', 'Upload an .xlsx workbook or a .csv file.');
  return kind === 'XLSX' ? readXlsx(bytes, sheet) : readCsv(bytes);
}

// ------------------------------------------------------------------ writing a workbook (templates and samples)
export type Cell = string | number | { date: string } | null;
const xmlEsc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number): string => {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};
const isoToSerial = (iso: string): number =>
  Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);

/** A one-sheet .xlsx with real date cells (a dd/mm/yyyy cell format), shared strings and deflated parts, like a spreadsheet application writes. */
export function buildWorkbook(sheetName: string, rows: Cell[][], opts: { macros?: boolean } = {}): Buffer {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const sid = (s: string) => {
    let i = index.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      index.set(s, i);
    }
    return i;
  };
  const body = rows
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">${r
          .map((c, ci) => {
            const ref = `${colName(ci)}${ri + 1}`;
            if (c === null || c === '') return '';
            if (typeof c === 'number') return `<c r="${ref}"><v>${c}</v></c>`;
            if (typeof c === 'object') return `<c r="${ref}" s="1"><v>${isoToSerial(c.date)}</v></c>`;
            return `<c r="${ref}" t="s"><v>${sid(c)}</v></c>`;
          })
          .join('')}</row>`,
    )
    .join('');
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const parts: Array<[string, string | Buffer]> = [
    [
      '[Content_Types].xml',
      `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${
        opts.macros ? '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>' : ''
      }<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `${head}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="${xmlEsc(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    ],
    [
      'xl/styles.xml',
      `${head}<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    ],
    [
      'xl/sharedStrings.xml',
      `${head}<sst xmlns="${NS}" count="${strings.length}" uniqueCount="${strings.length}">${strings
        .map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`)
        .join('')}</sst>`,
    ],
    [
      'xl/worksheets/sheet1.xml',
      `${head}<worksheet xmlns="${NS}"><sheetData>${body}</sheetData></worksheet>`,
    ],
  ];
  if (opts.macros) parts.push(['xl/vbaProject.bin', Buffer.from('MACRO-PLACEHOLDER-NOT-CODE')]);
  return writeZip(
    parts.map(([name, data]) => ({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8') })),
  );
}
