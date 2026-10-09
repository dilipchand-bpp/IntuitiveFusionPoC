/**
 * Reading messy cell text into clean values (CP-07). Pure functions, each tested on its own.
 * Dates are Australian: 3/4/2022 is 3 April, never 4 March.
 */
import { abnValid } from '../b11priv/classify.js';
import { excelSerialToIso } from './sheet.js';

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function real(y: number, m: number, d: number): string | null {
  if (y < 1000 || y > 9999) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** Two-digit years: 00 to 49 are 2000 to 2049, 50 to 99 are 1950 to 1999. */
const fullYear = (y: string) =>
  y.length === 4 ? Number(y) : Number(y) < 50 ? 2000 + Number(y) : 1900 + Number(y);

/** A real calendar date as yyyy-mm-dd from the formats found in legacy registers, or null. */
export function parseDateLoose(input: string | undefined | null): string | null {
  const t = (input ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(t))) return real(+m[1]!, +m[2]!, +m[3]!);
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(t)))
    return real(fullYear(m[3]!), +m[2]!, +m[1]!);
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4}|\d{2})$/.exec(t))) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    return mo ? real(fullYear(m[3]!), mo, +m[1]!) : null;
  }
  if ((m = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(t))) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    return mo ? real(+m[3]!, mo, +m[2]!) : null;
  }
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(t))) return real(+m[1]!, +m[2]!, +m[3]!);
  // a date typed into a cell that is not date-formatted arrives as its serial number
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (n >= 20_000 && n <= 80_000) return excelSerialToIso(n);
  }
  return null;
}

const CURRENCY_WORDS = /AUD|USD|NZD|EUR|GBP|AU\$|US\$|NZ\$|A\$|[$€£]/gi;

/** "$1,200,000", "AUD 90000.50", "(1,200.00)" -> a number (negative for brackets or a leading minus); null when it is not an amount. */
export function parseAmountLoose(input: string | undefined | null): number | null {
  let t = (input ?? '').trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  t = t.replace(CURRENCY_WORDS, '').replace(/[\s\u00a0']/g, '');
  if (t.startsWith('-')) {
    neg = !neg;
    t = t.slice(1);
  } else if (t.endsWith('-')) {
    neg = !neg;
    t = t.slice(0, -1);
  }
  t = t.replace(/,/g, '');
  if (!/^\d{1,12}(\.\d{1,4})?$/.test(t)) return null;
  const n = Number(t);
  return neg ? -n : n;
}

export const abnDigits = (s: string | undefined | null) => (s ?? '').replace(/[\s-]/g, '');
export const ABN_PLACEHOLDER = '00000000000';

export type AbnState = 'EMPTY' | 'VALID' | 'BAD_FORMAT' | 'BAD_CHECKSUM';
export function abnState(s: string | undefined | null): AbnState {
  const d = abnDigits(s);
  if (!d) return 'EMPTY';
  if (!/^\d{11}$/.test(d)) return 'BAD_FORMAT';
  return abnValid(d) ? 'VALID' : 'BAD_CHECKSUM';
}

export function parseIntLoose(input: string | undefined | null): number | null {
  const t = (input ?? '').trim();
  if (!/^\d{1,4}(\.0+)?$/.test(t)) return null;
  return Math.trunc(Number(t));
}

export const normaliseStatus = (s: string | undefined | null) =>
  (s ?? '').trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
