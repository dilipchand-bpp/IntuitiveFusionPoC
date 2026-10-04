/**
 * Legacy contract migration rules (FR-0655, FR-0665, FR-0675): reading the extract, profiling it for problems, and
 * extracting obligations, KPIs, SLAs, notice periods and options from the contract text. All pure functions, so each
 * rule is tested on its own.
 */

const BOM = String.fromCharCode(0xfeff);

/** RFC 4180 reader: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export const REQUIRED = ['contract_number', 'title', 'supplier', 'start_date', 'end_date', 'value'] as const;
export const OPTIONAL = [
  'procurement_ref',
  'procurement_title',
  'owner',
  'notice_months',
  'supplier_abn',
  'text',
] as const;
export const COLUMNS = [...REQUIRED, ...OPTIONAL] as const;
export type Column = (typeof COLUMNS)[number];
export type Raw = Partial<Record<Column, string>>;

export interface Issue {
  category:
    'Missing mandatory field' | 'Unparseable date' | 'Unparseable value' | 'Date order' | 'Duplicate record';
  field?: string;
  message: string;
}

/** A real calendar date as yyyy-mm-dd, from ISO or Australian dd/mm/yyyy; null when it is neither or not a real day. */
export function parseDate(s: string | undefined): string | null {
  const t = (s ?? '').trim();
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const au = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (au) [d, m, y] = [Number(au[1]), Number(au[2]), Number(au[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "$1,200,000", "1200000.50", "AUD 90000" -> a non-negative number; null when it is not an amount. */
export function parseAmount(s: string | undefined): number | null {
  const t = (s ?? '').replace(/AUD|\$|,|\s/gi, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
}

export interface Profiled {
  issues: Issue[];
  warnings: string[];
}

/** Profiles one row. `seen` holds contract numbers already in the system or earlier in the file (lower case). */
export function profileRow(raw: Raw, seen: ReadonlySet<string>): Profiled {
  const issues: Issue[] = [];
  const warnings: string[] = [];
  for (const f of REQUIRED)
    if (!raw[f]?.trim())
      issues.push({
        category: 'Missing mandatory field',
        field: f,
        message: `${f.replace('_', ' ')} is empty`,
      });
  const start = raw.start_date?.trim() ? parseDate(raw.start_date) : undefined;
  const end = raw.end_date?.trim() ? parseDate(raw.end_date) : undefined;
  if (raw.start_date?.trim() && !start)
    issues.push({
      category: 'Unparseable date',
      field: 'start_date',
      message: `"${raw.start_date}" is not a date (use yyyy-mm-dd or dd/mm/yyyy)`,
    });
  if (raw.end_date?.trim() && !end)
    issues.push({
      category: 'Unparseable date',
      field: 'end_date',
      message: `"${raw.end_date}" is not a date (use yyyy-mm-dd or dd/mm/yyyy)`,
    });
  if (start && end && end <= start)
    issues.push({
      category: 'Date order',
      field: 'end_date',
      message: 'The end date is not after the start date',
    });
  if (raw.value?.trim() && parseAmount(raw.value) === null)
    issues.push({
      category: 'Unparseable value',
      field: 'value',
      message: `"${raw.value}" is not an amount`,
    });
  if (raw.notice_months?.trim() && !/^\d{1,3}$/.test(raw.notice_months.trim()))
    issues.push({
      category: 'Unparseable value',
      field: 'notice_months',
      message: `"${raw.notice_months}" is not a number of months`,
    });
  const number = raw.contract_number?.trim();
  if (number && seen.has(number.toLowerCase()))
    issues.push({
      category: 'Duplicate record',
      field: 'contract_number',
      message: `Contract ${number} already exists or appears earlier in this file`,
    });
  if (!raw.owner?.trim()) warnings.push('No contract owner: alerts will go to contract managers.');
  if (!raw.text?.trim() && !raw.notice_months?.trim())
    warnings.push('No notice period or contract text: a 90-day notice period is assumed.');
  return { issues, warnings };
}

// ------------------------------------------------------------------ extraction from contract text (simulated AI)
const WORD: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  nine: 9,
  twelve: 12,
  eighteen: 18,
  twenty: 20,
  thirty: 30,
  sixty: 60,
  ninety: 90,
};
const num = (s: string): number => WORD[s.toLowerCase()] ?? Number(s);
const sentences = (t: string): string[] =>
  t
    .replace(/\s+/g, ' ')
    .split(/(?<=[.;])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

export interface Extraction {
  noticeDays: number | null;
  obligations: string[];
  kpis: string[];
  slas: string[];
  extensions: number[];
}

/**
 * Pulls structure out of free contract text. Deterministic stand-in for the language model (swap point: AiProvider):
 * the same text always gives the same result, and nothing is invented that the text does not say.
 */
export function extractLegacy(text: string | undefined): Extraction {
  const t = (text ?? '').trim();
  const out: Extraction = { noticeDays: null, obligations: [], kpis: [], slas: [], extensions: [] };
  if (!t) return out;
  const notice =
    /(?:terminat\w*|notice)[^.]{0,80}?\b(\d+|one|two|three|four|five|six|nine|twelve|thirty|sixty|ninety)[- ]?(month|week|day)s?\b/i.exec(
      t,
    );
  if (notice) {
    const n = num(notice[1]!);
    out.noticeDays = /month/i.test(notice[2]!) ? n * 30 : /week/i.test(notice[2]!) ? n * 7 : n;
  }
  for (const s of sentences(t)) {
    if (/\b(KPI|key performance indicator)s?\b/i.test(s)) out.kpis.push(s);
    else if (/\bSLA\b|service level|response time|resolution time/i.test(s)) out.slas.push(s);
    else if (/\b(shall|must|will)\b/i.test(s) && !/\boption\b/i.test(s)) out.obligations.push(s);
  }
  out.obligations = out.obligations.slice(0, 10);
  out.kpis = out.kpis.slice(0, 10);
  out.slas = out.slas.slice(0, 10);
  const multi =
    /\b(\d+|one|two|three|four)\s+(?:further\s+)?(\d+|six|twelve|eighteen)[- ]month\s+(?:option|extension|renewal)s?\b/i.exec(
      t,
    );
  if (multi) for (let i = 0; i < num(multi[1]!); i++) out.extensions.push(num(multi[2]!));
  else {
    const single =
      /option to (?:extend|renew)[^.]{0,40}?\b(\d+|six|twelve|eighteen|twenty)\s*(month|year)s?\b/i.exec(t);
    if (single) out.extensions.push(/year/i.test(single[2]!) ? num(single[1]!) * 12 : num(single[1]!));
  }
  return out;
}
