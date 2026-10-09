/**
 * Small pure helpers for reading contract text (CP-07): dates in the forms contracts use, amounts, number words, ABN check,
 * word similarity. No database, no network.
 */

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** One date as it is written in a contract: ISO, "1 July 2025", "1st July 2025" or "01/07/2025" (day first, as in Australia). */
export const DATE_RE_SRC =
  '(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\.?,?\\s+\\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}/\\d{1,2}/\\d{4})';

/** A real calendar date as yyyy-mm-dd, or null when the text is not a date or not a real day. */
export function parseDateText(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  let y: number;
  let m: number;
  let d: number;
  let hit: RegExpExecArray | null;
  if ((hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) [y, m, d] = [+hit[1]!, +hit[2]!, +hit[3]!];
  else if ((hit = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [d, m, y] = [+hit[1]!, +hit[2]!, +hit[3]!];
  else if ((hit = /^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]+)\.?,? (\d{4})$/.exec(s))) {
    [d, y] = [+hit[1]!, +hit[3]!];
    m = monthNumber(hit[2]!);
  } else if ((hit = /^([A-Za-z]+) (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(s))) {
    [d, y] = [+hit[2]!, +hit[3]!];
    m = monthNumber(hit[1]!);
  } else return null;
  if (!m || m < 1 || m > 12) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function monthNumber(name: string): number {
  const n = name.toLowerCase();
  const i = MONTH_NAMES.findIndex((x) => n.length >= 3 && x.startsWith(n));
  return i < 0 ? 0 : i + 1;
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  eighteen: 18,
  twenty: 20,
  'twenty-four': 24,
  thirty: 30,
  'thirty-six': 36,
  forty: 40,
  sixty: 60,
  ninety: 90,
};

/** The regular expression source for a count: digits or a number word. */
export const NUM_RE_SRC =
  '(?:\\d{1,4}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|eighteen|twenty-four|twenty|thirty-six|thirty|forty|sixty|ninety)';

export function numberFromText(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  return WORD_NUMBERS[s] ?? null;
}

/** "36 months" or "3 years" as whole months. */
export function monthsFrom(n: number, unit: string): number {
  return /^year/i.test(unit) ? n * 12 : n;
}

/** Days from a count and unit: a week is 7, a month is 30 (the contract record counts notice in days). */
export function daysFrom(n: number, unit: string): number {
  if (/^week/i.test(unit)) return n * 7;
  if (/^month/i.test(unit)) return n * 30;
  return n;
}

/** "1,250,000", "10 million", "2.5m", "60k" as a number. */
export function amountFromText(num: string, unit?: string | null): number | null {
  const n = Number(num.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const u = (unit ?? '').toLowerCase();
  const f = u === 'million' || u === 'm' ? 1_000_000 : u === 'k' || u === 'thousand' ? 1000 : 1;
  return Math.round(n * f * 100) / 100;
}

export const CURRENCY_RE_SRC = '(?:AUD|USD|NZD|EUR|GBP|SGD|JPY|A\\$|AU\\$|US\\$|NZ\\$|\\$)';
export const AMOUNT_RE_SRC = '([0-9][0-9,]*(?:\\.[0-9]{1,2})?)(?:\\s*(million|thousand|m|k)\\b)?';

/** Currency from the token(s) written before an amount. A bare "$" is Australian dollars. */
export function currencyFromToken(tok: string): { currency: string; bare: boolean } {
  const t = tok.toUpperCase();
  for (const c of ['AUD', 'USD', 'NZD', 'EUR', 'GBP', 'SGD', 'JPY'])
    if (t.includes(c)) return { currency: c, bare: false };
  if (t.includes('US$')) return { currency: 'USD', bare: false };
  if (t.includes('NZ$')) return { currency: 'NZD', bare: false };
  if (t.includes('A$') || t.includes('AU$')) return { currency: 'AUD', bare: false };
  return { currency: 'AUD', bare: true };
}

/** Australian Business Number check (weighted sum of the 11 digits, first digit less one, divisible by 89). */
export function isValidAbn(digits: string): boolean {
  const d = digits.replace(/\s+/g, '');
  if (!/^\d{11}$/.test(d)) return false;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = [...d].reduce((acc, ch, i) => acc + (i === 0 ? Number(ch) - 1 : Number(ch)) * w[i]!, 0);
  return sum % 89 === 0;
}

export const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

const ACRONYMS = new Set([
  'it',
  'ict',
  'hr',
  'ai',
  'gst',
  'pty',
  'ltd',
  'abn',
  'saas',
  'nsw',
  'wa',
  'sa',
  'act',
  'nt',
  'qld',
  'vic',
  'tas',
]);

/** ALL CAPITALS headings read as Title Case; anything else is left as written. */
export function titleCaseIfShouting(s: string): string {
  const t = collapse(s);
  if (t !== t.toUpperCase() || !/[A-Z]/.test(t)) return t;
  const small = new Set(['and', 'as', 'of', 'the', 'for', 'to', 'in', 'on', 'a', 'an', 'or']);
  return t
    .toLowerCase()
    .split(' ')
    .map((w, i) =>
      ACRONYMS.has(w) ? w.toUpperCase() : i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ');
}

const STOP = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'by',
  'with',
  'at',
  'as',
  'is',
  'are',
  'be',
  'will',
  'shall',
  'must',
  'may',
  'this',
  'that',
  'it',
  'its',
  'any',
  'each',
  'such',
  'from',
  'under',
  'which',
  'has',
  'have',
  'party',
  'parties',
]);

/** A rough stem so "terminates", "terminate" and "termination" count together. */
const stem = (w: string) =>
  w
    .replace(/(ations?|ation|ments?|ness|ings?|ies|ied|ing|ed|es|s)$/u, '')
    .replace(/(ate|e)$/u, '')
    .slice(0, 12);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\{\{[a-z_]+\}\}/g, ' ')
    .replace(/[^a-z0-9% ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w))
    .map(stem)
    .filter((w) => w.length > 1);
}

/** Cosine similarity of two texts over stemmed words (1 = the same words, 0 = nothing in common). */
export function similarity(a: string, b: string): number {
  const bag = (t: string[]) => {
    const m = new Map<string, number>();
    for (const w of t) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const x = bag(tokens(a));
  const y = bag(tokens(b));
  if (x.size === 0 || y.size === 0) return 0;
  let dot = 0;
  for (const [w, n] of x) dot += n * (y.get(w) ?? 0);
  const norm = (m: Map<string, number>) => Math.sqrt([...m.values()].reduce((s, n) => s + n * n, 0));
  return Math.round((dot / (norm(x) * norm(y))) * 1000) / 1000;
}

/** A company name without legal-form words and punctuation, for matching suppliers. */
export function normaliseCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(pty|ltd|limited|proprietary|inc|incorporated|llc|co|company|the|australia|group)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Dice coefficient over word sets, 0..1, for "similar company name". */
export function nameSimilarity(a: string, b: string): number {
  const x = new Set(normaliseCompany(a).split(' ').filter(Boolean));
  const y = new Set(normaliseCompany(b).split(' ').filter(Boolean));
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return (2 * shared) / (x.size + y.size);
}
