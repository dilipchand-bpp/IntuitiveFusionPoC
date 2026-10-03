/**
 * CSV writer for exports (RFC 4180 quoting). Cells that a spreadsheet would read as a formula (start with = + - @ or a
 * control character) get a leading apostrophe, so an audit trail can never run code when opened in Excel.
 */
const needsQuote = /[",\r\n]/;

export function cell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return needsQuote.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const BOM = String.fromCharCode(0xfeff);

export function toCsv(header: string[], rows: unknown[][]): string {
  // BOM so that Excel opens UTF-8 correctly
  return `${BOM}${[header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
