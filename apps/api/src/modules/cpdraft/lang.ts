/**
 * Reading free text for the drafting module (CP-04). Fixed rules, no model: the same words always give the same facts, and
 * every fact keeps the span of text it came from so the draft can say where each field came from.
 */
import { matchCategory, parseBusinessUnit, type CategoryRule } from '../intake/extract.js';

export interface Span {
  quote: string;
  span: [number, number];
}
export interface Flag extends Span {
  code: FlagCode;
}
export type FlagCode =
  | 'DATA_RESIDENCY'
  | 'SECURITY_CERT'
  | 'CLEARANCE'
  | 'PRIVACY'
  | 'CLOUD'
  | 'AFTER_HOURS'
  | 'URGENT'
  | 'SOLE_SOURCE'
  | 'INCUMBENT'
  | 'SUSTAINABILITY'
  | 'LOCAL_SME'
  | 'WHS'
  | 'ACCESSIBILITY'
  | 'INSURANCE'
  | 'MODERN_SLAVERY'
  | 'SERVICE_LEVEL'
  | 'CONTINUITY'
  | 'INTEGRATION'
  | 'TRAINING';

// ------------------------------------------------------------------------------------------------ spoken numbers
const UNITS_W: Record<string, number> = {
  zero: 0,
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
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS_W: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const NUMBER_WORD = new RegExp(
  `\\b(?:${[...Object.keys(UNITS_W), ...Object.keys(TENS_W), 'hundred', 'thousand', 'million'].join('|')})\\b`,
  'i',
);
const COUNT_UNIT =
  /^(?:per ?cent|percent|dollars?|sites?|locations?|offices?|buildings?|users?|staff|seats?|devices?|laptops?|printers?|vehicles?|licen[cs]es?|floors?|years?|months?|weeks?|days?|hours?|guards?|cleaners?|points?|%)\b/i;

/** "four hundred and fifty thousand dollars" -> "$450,000"; "sixty percent" -> "60%". Dictation often returns words, not digits. */
export function normaliseSpoken(input: string): string {
  const tokens = input.split(/(\s+)/);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const bare = tok.toLowerCase().replace(/[.,;:!?]+$/, '');
    if (!(
      bare in UNITS_W ||
      bare in TENS_W ||
      bare === 'hundred' ||
      bare === 'thousand' ||
      bare === 'million' ||
      bare === 'a'
    )) {
      out.push(tok);
      continue;
    }
    // collect a run of number words (with "and" and hyphenated tens such as "twenty-five")
    let j = i;
    let total = 0;
    let current = 0;
    let used = 0;
    let trailing = '';
    let sawWord = false;
    for (; j < tokens.length; j += 2) {
      const raw = tokens[j]!;
      const w = raw.toLowerCase();
      const clean = w.replace(/[.,;:!?]+$/, '');
      const parts = clean.split('-');
      const isNum = parts.every((p) => p in UNITS_W || p in TENS_W);
      if (isNum && parts.length <= 2) {
        current += parts.reduce((n, p) => n + (UNITS_W[p] ?? TENS_W[p] ?? 0), 0);
        sawWord = true;
      } else if (clean === 'hundred' && sawWord) current = (current || 1) * 100;
      else if (clean === 'thousand' && sawWord) {
        total += (current || 1) * 1000;
        current = 0;
      } else if (clean === 'million' && sawWord) {
        total += (current || 1) * 1_000_000;
        current = 0;
      } else if (clean === 'a' && !sawWord && /^(hundred|thousand|million)\b/i.test(tokens[j + 2] ?? '')) {
        // "a hundred", "a thousand"
        continue;
      } else if (clean === 'and' && sawWord && NUMBER_WORD.test(tokens[j + 2] ?? '')) {
        continue;
      } else break;
      used = j;
      trailing = /[.,;:!?]+$/.exec(w)?.[0] ?? '';
      if (trailing) break;
    }
    if (!sawWord) {
      out.push(tok);
      continue;
    }
    const value = total + current;
    const next = (tokens[used + 2] ?? '').toLowerCase();
    const words = (used - i) / 2 + 1;
    // a lone small number word ("one supplier") is left as written unless a unit follows it
    if (value < 10 && words === 1 && !COUNT_UNIT.test(next)) {
      out.push(tok);
      continue;
    }
    out.push(String(value) + trailing);
    i = used;
  }
  return out
    .join('')
    .replace(/(\d)\s*(?:per ?cent|percent)\b/gi, '$1%')
    .replace(/(\d[\d,]*(?:\.\d+)?)\s*(?:aud\s+)?dollars?\b/gi, '$$$1');
}

// ------------------------------------------------------------------------------------------------ money, term, quantity
export interface Money extends Span {
  value: number;
  /** The text gave a yearly or monthly figure; `value` is already the total over the term when a term is known. */
  basis?: 'ANNUAL' | 'MONTHLY';
  raw: number;
}
const MULT: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mil: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};
const MONEY = /(?:\$|aud\s*)\s*(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand|mil|bn|m|b|k)?(?![a-z0-9])/gi;
const MONEY_PLAIN = /\b(\d[\d,]*(?:\.\d+)?)\s*(million|thousand|k)\b/gi;

export function parseAmount(s: string): number | null {
  const m = /^\s*(?:\$|aud\s*)?\s*(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand|mil|bn|m|b|k)?\s*$/i.exec(
    s,
  );
  if (!m) return null;
  const base = Number(m[1]!.replace(/,/g, ''));
  return Math.round(base * (m[2] ? (MULT[m[2].toLowerCase()] ?? 1) : 1));
}

export function findMoney(text: string, termMonths?: number | null): Money | null {
  const all: Array<{ m: RegExpExecArray; value: number }> = [];
  for (const re of [MONEY, MONEY_PLAIN]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const unit = (m[2] ?? '').toLowerCase();
      const value = Math.round(Number(m[1]!.replace(/,/g, '')) * (unit ? (MULT[unit] ?? 1) : 1));
      if (value > 0) all.push({ m, value });
    }
  }
  // unit prices ("$80 per site", "$120 an hour") are not the budget
  const total = all.filter(
    ({ m }) =>
      !/^\s*(?:per|a|an|each|\/)\s*(?:hour|hr|site|user|seat|device|unit|licen[cs]e|head|guard|visit|sqm|m2|kg|day)\b/i.test(
        text.slice(m.index + m[0].length, m.index + m[0].length + 24),
      ),
  );
  const pool = total.length ? total : [];
  if (!pool.length) return null;
  const hinted =
    pool.find(({ m }) =>
      /budget|up to|about|around|approx|cap|capped|worth|value|spend|cost/i.test(
        text.slice(Math.max(0, m.index - 30), m.index),
      ),
    ) ?? pool[0]!;
  const { m, value } = hinted;
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
  const annual =
    /^\s*(?:per|a|each|every|\/)\s*(?:year|annum|yr)\b|^\s*(?:p\.a\.|pa\b|annually|yearly)/i.test(after);
  const monthly = /^\s*(?:per|a|each|every|\/)\s*month\b|^\s*monthly/i.test(after);
  const end = m.index + m[0].length;
  const base: Money = { quote: m[0].trim(), span: [m.index, end], value, raw: value };
  if (annual && termMonths) return { ...base, basis: 'ANNUAL', value: Math.round((value * termMonths) / 12) };
  if (monthly && termMonths) return { ...base, basis: 'MONTHLY', value: value * termMonths };
  if (annual) return { ...base, basis: 'ANNUAL' };
  if (monthly) return { ...base, basis: 'MONTHLY' };
  return base;
}

const NUM_WORD_VAL: Record<string, number> = { ...UNITS_W, ...TENS_W };
export interface Term extends Span {
  months: number;
}
/** "3 years", "over three years", "18-month", "36 months" -> months. */
export function findTerm(text: string): Term | null {
  const re = /\b(\d+(?:\.\d+)?|[a-z]+)[-\s]?(years?|yrs?|months?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[1]!.toLowerCase();
    const n = /^\d/.test(raw) ? Number(raw) : NUM_WORD_VAL[raw];
    if (n === undefined || !(n > 0)) continue;
    const before = text.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
    if (/\b(?:per|every|each|a|an)\s*$/.test(before)) continue;
    if (/^\s*(?:old|ago|experience)/i.test(text.slice(m.index + m[0].length))) continue;
    const months = /^y/i.test(m[2]!) ? Math.round(n * 12) : Math.round(n);
    if (months < 1 || months > 360) continue;
    return { months, quote: m[0], span: [m.index, m.index + m[0].length] };
  }
  return null;
}

export const QUANTITY_UNITS = [
  'sites',
  'locations',
  'offices',
  'buildings',
  'branches',
  'users',
  'staff',
  'employees',
  'seats',
  'devices',
  'laptops',
  'printers',
  'vehicles',
  'licences',
  'licenses',
  'floors',
  'guards',
  'cleaners',
  'schools',
  'hospitals',
  'stores',
  'rooms',
  'workstations',
  'desktops',
  'phones',
  'sites',
  'FTE',
  'hours',
] as const;
const UNIT_RE = QUANTITY_UNITS.join('|');
export interface Quantity extends Span {
  n: number;
  unit: string;
}
export function findQuantity(text: string): Quantity | null {
  const m = new RegExp(`(?<![$\\d.,])\\b(\\d[\\d,]*)\\s+(${UNIT_RE})\\b`, 'i').exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  if (!(n > 0)) return null;
  const unit = m[2]!.toLowerCase() === 'fte' ? 'FTE' : m[2]!.toLowerCase();
  return { n, unit, quote: m[0], span: [m.index, m.index + m[0].length] };
}

// ------------------------------------------------------------------------------------------------ dates
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
const MON = MONTH_NAMES.map((m) => m.slice(0, 3));
const MONTH_RE = `(${MONTH_NAMES.join('|')}|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)`;
const monthIndex = (s: string) => MON.indexOf(s.toLowerCase().slice(0, 3));
const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const lastDay = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
export const addMonthsIso = (iso: string, months: number): string => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = m - 1 + months;
  const yy = y + Math.floor(t / 12);
  const mm = ((t % 12) + 12) % 12;
  return isoOf(yy, mm, Math.min(d, lastDay(yy, mm)));
};
export const addDaysIso = (iso: string, days: number): string => {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
};
/** Whole months from a start date to an inclusive end date (1 Mar 2027 to 28 Feb 2030 is 36). */
export const monthsBetween = (a: string, b: string): number => {
  const [y1, m1, d1] = a.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = addDaysIso(b, 1).split('-').map(Number) as [number, number, number];
  let n = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) n -= 1;
  return Math.max(1, n);
};
/** The inclusive end date of a term that starts on `start`. */
export const endOfTerm = (start: string, months: number): string =>
  addDaysIso(addMonthsIso(start, months), -1);

export interface ParsedDate {
  iso: string;
  /** The text was a month, not a day ("March 2027"). */
  monthOnly: boolean;
  index: number;
  length: number;
}
const todayIso = (today: Date) => today.toISOString().slice(0, 10);

/** One date expression at the start of `s` or anywhere in it (when `anywhere`). `role` decides month-only dates: start of the month for a start, end of it for an end. */
export function parseDate(
  s: string,
  today: Date,
  role: 'START' | 'END' = 'START',
  anywhere = true,
): ParsedDate | null {
  const ty = today.getUTCFullYear();
  const tm = today.getUTCMonth();
  const td = today.getUTCDate();
  const res: Array<() => ParsedDate | null> = [];
  const at = (re: RegExp) => {
    const m = re.exec(s);
    return m && (anywhere || m.index === 0) ? m : null;
  };
  const mk = (m: RegExpExecArray, y: number, m0: number, d: number | null): ParsedDate => ({
    iso: isoOf(y, m0, d ?? (role === 'END' ? lastDay(y, m0) : 1)),
    monthOnly: d === null,
    index: m.index,
    length: m[0].length,
  });
  res.push(() => {
    const m = at(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    return m ? { iso: m[0], monthOnly: false, index: m.index, length: m[0].length } : null;
  });
  res.push(() => {
    const m = at(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/); // Australian day first
    return m ? mk(m, Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
  });
  res.push(() => {
    const m = at(
      new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b(?:,?\\s+(\\d{4}))?`, 'i'),
    );
    if (!m) return null;
    const m0 = monthIndex(m[2]!);
    let y = m[3] ? Number(m[3]) : ty;
    if (!m[3] && (m0 < tm || (m0 === tm && Number(m[1]) < td))) y += 1;
    return mk(m, y, m0, Number(m[1]));
  });
  res.push(() => {
    const m = at(
      new RegExp(
        `\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b(?!\\s*(?:months?|years?|weeks?))`,
        'i',
      ),
    );
    if (!m || Number(m[2]) > 31) return null;
    const m0 = monthIndex(m[1]!);
    let y = m[3] ? Number(m[3]) : ty;
    if (!m[3] && (m0 < tm || (m0 === tm && Number(m[2]) < td))) y += 1;
    return mk(m, y, m0, Number(m[2]));
  });
  res.push(() => {
    const m = at(
      new RegExp(
        `(?:\\b(next|this|early|late|mid|end of|start of)\\s+)?\\b${MONTH_RE}(?:\\s+(\\d{4}))?\\b`,
        'i',
      ),
    );
    if (!m) return null;
    const m0 = monthIndex(m[2]!);
    if (m0 < 0) return null;
    let y: number;
    if (m[3]) y = Number(m[3]);
    else if ((m[1] ?? '').toLowerCase() === 'next') y = m0 > tm ? ty : ty + 1;
    else y = m0 >= tm ? ty : ty + 1;
    // "may" as a verb: only a month when capitalised, qualified or followed by a year
    if (m[2]!.toLowerCase() === 'may' && !m[3] && !m[1] && !/May/.test(m[0])) return null;
    return mk(m, y, m0, null);
  });
  res.push(() => {
    const m = at(
      /\bin\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(days?|weeks?|months?)\b/i,
    );
    if (!m) return null;
    const n = /^\d/.test(m[1]!) ? Number(m[1]) : (NUM_WORD_VAL[m[1]!.toLowerCase()] ?? 0);
    const base = todayIso(today);
    const iso = /^d/i.test(m[2]!)
      ? addDaysIso(base, n)
      : /^w/i.test(m[2]!)
        ? addDaysIso(base, n * 7)
        : addMonthsIso(base, n);
    return { iso, monthOnly: false, index: m.index, length: m[0].length };
  });
  res.push(() => {
    const m = at(/\bnext\s+(week|month|quarter|year)\b/i);
    if (!m) return null;
    const base = todayIso(today);
    const w = m[1]!.toLowerCase();
    const iso =
      w === 'week'
        ? addDaysIso(base, 7)
        : w === 'month'
          ? addMonthsIso(base, 1)
          : w === 'quarter'
            ? addMonthsIso(base, 3)
            : addMonthsIso(base, 12);
    return { iso, monthOnly: false, index: m.index, length: m[0].length };
  });
  res.push(() => {
    const m = at(/\b(today|tomorrow|immediately)\b/i);
    if (!m) return null;
    return {
      iso: m[1]!.toLowerCase() === 'tomorrow' ? addDaysIso(todayIso(today), 1) : todayIso(today),
      monthOnly: false,
      index: m.index,
      length: m[0].length,
    };
  });
  let best: ParsedDate | null = null;
  for (const f of res) {
    const r = f();
    if (r && (!best || r.index < best.index || (r.index === best.index && r.length > best.length))) best = r;
  }
  return best;
}

export interface DatesFound {
  start?: Span & { iso: string };
  end?: Span & { iso: string };
  close?: Span & { iso: string };
}
/** Reads start, end and closing dates from a text, by the words in front of each date expression. */
export function findDates(text: string, today: Date): DatesFound {
  const out: DatesFound = {};
  const cues: Array<[keyof DatesFound, RegExp, 'START' | 'END']> = [
    [
      'close',
      /\b(?:clos(?:e|es|ing)|submissions? (?:due|close)|responses? (?:due|close))\s*(?:on|at|by|:)?\s*$/i,
      'END',
    ],
    [
      'start',
      /\b(?:start|starting|starts|commenc\w*|begin\w*|go[- ]?live|kick[- ]?off|from|effective)\s*(?:date)?\s*(?:on|in|at|from|:|is)?\s*$/i,
      'START',
    ],
    [
      'end',
      /\b(?:end|ending|ends|finish\w*|complet\w*|until|expir\w*|deliver\w*|due|by|before|through)\s*(?:date)?\s*(?:on|in|by|:|is)?\s*$/i,
      'END',
    ],
  ];
  // find every candidate expression by scanning the text piece by piece
  const seen = new Set<number>();
  let offset = 0;
  while (offset < text.length) {
    const rest = text.slice(offset);
    const p = parseDate(rest, today, 'START', true);
    if (!p) break;
    const start = offset + p.index;
    if (!seen.has(start)) {
      seen.add(start);
      const before = text.slice(Math.max(0, start - 40), start);
      const cue = cues.find(([, re]) => re.test(before));
      const role = cue?.[2] ?? 'START';
      const q = parseDate(text.slice(start, start + p.length + 12), today, role, false) ?? p;
      const quote = text.slice(start, start + p.length);
      const slot: keyof DatesFound = cue?.[0] ?? (out.start ? 'end' : 'start');
      if (!out[slot]) out[slot] = { iso: q.iso, quote, span: [start, start + p.length] };
    }
    offset = offset + p.index + Math.max(1, p.length);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ categories and flags
export interface CategoryHit {
  category: string;
  unspsc: string;
  title: string;
  critical?: boolean;
  sensitiveData?: boolean;
  quote: string;
  span: [number, number];
}
const EXTRA_CATEGORIES: Array<Omit<CategoryHit, 'quote' | 'span'> & { keywords: RegExp }> = [
  {
    category: 'Print and imaging services',
    unspsc: '44100000',
    title: 'Managed print service',
    keywords: /\bprint(?:ing|ers?)?\b|\bmfd\b|photocop|imaging/i,
  },
  {
    category: 'Telecommunications',
    unspsc: '81161700',
    title: 'Telecommunications services',
    keywords: /telecom|mobile (?:plan|fleet|service)s?|\bvoip\b|phone (?:system|service)s?|carriage/i,
    critical: false,
  },
  {
    category: 'Vehicles and fleet',
    unspsc: '25100000',
    title: 'Fleet vehicles',
    keywords: /\bfleet\b|vehicles?|\bcars?\b|\butes?\b/i,
  },
  {
    category: 'Training services',
    unspsc: '86101700',
    title: 'Training services',
    keywords: /\btraining\b|\bworkshops?\b|capability uplift/i,
  },
  {
    category: 'Waste management',
    unspsc: '76121500',
    title: 'Waste management services',
    keywords: /\bwaste\b|recycl|rubbish|skip bins?/i,
  },
  {
    category: 'Travel services',
    unspsc: '90121500',
    title: 'Travel management services',
    keywords: /\btravel\b|accommodation|airfares?/i,
  },
  {
    category: 'Furniture',
    unspsc: '56100000',
    title: 'Furniture supply',
    keywords: /furniture|desks?|chairs?|workstations?/i,
  },
  {
    category: 'Marketing and communications',
    unspsc: '82101500',
    title: 'Marketing services',
    keywords: /marketing|advertis|campaign|communications? (?:agency|services?)/i,
  },
  {
    category: 'Software licences',
    unspsc: '43230000',
    title: 'Software licences',
    keywords: /licen[cs]es?|subscription|software/i,
    critical: true,
    sensitiveData: true,
  },
];

export function findCategory(text: string): CategoryHit | null {
  const base: CategoryRule | null = matchCategory(text);
  const extra = EXTRA_CATEGORIES.find((c) => c.keywords.test(text));
  // a more specific word of ours ("print", "fleet") wins over the broad keywords of the shared rules ("it", "software")
  const specific = extra && !['Software licences'].includes(extra.category) ? extra : null;
  const pick = specific ?? base ?? extra ?? null;
  if (!pick) return null;
  const re = 'keywords' in pick ? pick.keywords : null;
  const g = re ? new RegExp(re.source, re.flags.replace('g', '')).exec(text) : null;
  const rule = pick as {
    category: string;
    unspsc: string;
    title: string;
    critical?: boolean;
    sensitiveData?: boolean;
  };
  return {
    category: rule.category,
    unspsc: rule.unspsc,
    title: rule.title,
    ...(rule.critical !== undefined ? { critical: rule.critical } : {}),
    ...(rule.sensitiveData !== undefined ? { sensitiveData: rule.sensitiveData } : {}),
    quote: g?.[0] ?? '',
    span: g ? [g.index, g.index + g[0].length] : [0, 0],
  };
}

const FLAG_RULES: Array<[FlagCode, RegExp]> = [
  [
    'DATA_RESIDENCY',
    /(?:hosted|stored|held|processed|kept|located|resident|data)[^.;]{0,40}\b(?:in|within|inside|on)\s+(?:australia|australian (?:soil|shores|data cent\w+)|aus)\b|data (?:sovereignty|residency)|onshore (?:hosting|data)|australian[- ]hosted/i,
  ],
  [
    'SECURITY_CERT',
    /iso\s?27001|soc\s?2|\birap\b|essential eight|pen(?:etration)?[- ]test|security accreditation/i,
  ],
  [
    'CLEARANCE',
    /security clearance|baseline vetting|\bnv[12]\b|police checks?|background checks?|working with children/i,
  ],
  [
    'PRIVACY',
    /personal (?:data|information)|patient|health records?|customer data|\bpii\b|privacy|sensitive data/i,
  ],
  ['CLOUD', /\b(?:cloud|saas|paas|iaas|hosted|hosting)\b/i],
  ['AFTER_HOURS', /24\s?[x/]\s?7|24 hours|around the clock|after[- ]hours|on[- ]call|weekend cover/i],
  ['URGENT', /\burgent(?:ly)?\b|\basap\b|as soon as possible|immediately|tight deadline|critical deadline/i],
  [
    'SOLE_SOURCE',
    /sole[- ]source|single[- ]source|only one supplier|direct (?:award|negotiation)|no tender/i,
  ],
  [
    'INCUMBENT',
    /incumbent|existing (?:supplier|provider|vendor|contract)|\brenew(?:al)?\b|re-?tender|replac\w+ (?:the )?(?:current|existing)/i,
  ],
  ['SUSTAINABILITY', /sustainab|carbon|net[- ]zero|recycl|emissions|environmental(?:ly)?|green\b/i],
  [
    'LOCAL_SME',
    /\bSMEs?\b|small business(?:es)?|local (?:business(?:es)?|suppliers?|content|jobs?)|indigenous|first nations/i,
  ],
  ['WHS', /\bwhs\b|work health|safety|hazards?/i],
  ['ACCESSIBILITY', /accessib|\bwcag\b/i],
  ['INSURANCE', /insurance|indemnity/i],
  ['MODERN_SLAVERY', /modern slavery/i],
  [
    'SERVICE_LEVEL',
    /\d{2,3}(?:\.\d+)?\s*%\s*(?:uptime|availability|sla)|(?:within|inside)\s+\d+\s*(?:minutes|mins|hours|hrs)|response times?|service levels?\b/i,
  ],
  ['CONTINUITY', /disaster recovery|\bdr\b|business continuity|backups?\b|failover/i],
  ['INTEGRATION', /integrat|\bapis?\b|\bsso\b|single sign[- ]on|\berp\b/i],
  ['TRAINING', /training|upskill|handover|knowledge transfer/i],
];
export function findFlags(text: string): Flag[] {
  const out: Flag[] = [];
  for (const [code, re] of FLAG_RULES) {
    const m = new RegExp(re.source, re.flags.replace('g', '')).exec(text);
    if (m) out.push({ code, quote: m[0], span: [m.index, m.index + m[0].length] });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the whole text
export interface Facts {
  text: string;
  subject?: Span & { phrase: string };
  category?: CategoryHit;
  money?: Money;
  term?: Term;
  dates: DatesFound;
  quantity?: Quantity;
  businessUnit?: Span & { value: string };
  owner?: Span & { value: string };
  supplyLocation?: Span & { value: 'LOCAL' | 'OFFSHORE' };
  dataSensitivity?: Span & { value: 'SENSITIVE' };
  suppliers: Array<Span & { name: string }>;
  flags: Flag[];
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const sentenceCase = cap;

/** "We need a managed print service for 40 sites ..." -> "managed print service". */
function findSubject(text: string): (Span & { phrase: string }) | undefined {
  const m =
    /\b(?:need|needs|require|requires|want|looking for|looking to (?:buy|procure|engage|appoint)|seek|seeking|to (?:buy|procure|engage|appoint|source|purchase)|buy|procure|purchase|engage|appoint|source|tender for|rfx for|rfp for|rft for|quote for)\s+(?:a|an|the|some|new)?\s*([^,.;:]+?)(?=\s+(?:for|over|about|at|with|to be|starting|from|that|which|where|must|should|including|across|by|in|of the)\b|[,.;:]|$)/i.exec(
      text,
    );
  if (!m) return undefined;
  const phrase = m[1]!.trim();
  if (phrase.length < 3 || phrase.length > 80 || /^\d/.test(phrase)) return undefined;
  const start = m.index + m[0].lastIndexOf(m[1]!);
  return { phrase, quote: m[1]!, span: [start, start + m[1]!.length] };
}

export function extractFacts(rawText: string, today: Date, knownSuppliers: readonly string[] = []): Facts {
  const text = normaliseSpoken(rawText).replace(/\s+/g, ' ').trim();
  const f: Facts = { text, dates: {}, suppliers: [], flags: [] };
  const subject = findSubject(text);
  if (subject) f.subject = subject;
  const category = findCategory(text);
  if (category) f.category = category;
  const term = findTerm(text);
  if (term) f.term = term;
  const money = findMoney(text, term?.months ?? null);
  if (money) f.money = money;
  f.dates = findDates(text, today);
  const qty = findQuantity(text);
  if (qty) f.quantity = qty;
  const unit = parseBusinessUnit(text);
  if (unit) {
    const idx = text.toLowerCase().indexOf(unit.toLowerCase());
    f.businessUnit = { value: unit, quote: unit, span: [Math.max(0, idx), Math.max(0, idx) + unit.length] };
  }
  const owner = /contract owner (?:is|will be|:)?\s*([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+){0,2})/.exec(text);
  if (owner)
    f.owner = {
      value: owner[1]!.trim(),
      quote: owner[0],
      span: [owner.index, owner.index + owner[0].length],
    };
  f.flags = findFlags(text);
  const loc = /\boffshore|overseas|international supplier/i.exec(text);
  const local = /\blocal\b|onshore|australian supplier/i.exec(text);
  if (loc)
    f.supplyLocation = { value: 'OFFSHORE', quote: loc[0], span: [loc.index, loc.index + loc[0].length] };
  else if (local)
    f.supplyLocation = {
      value: 'LOCAL',
      quote: local[0],
      span: [local.index, local.index + local[0].length],
    };
  const residency = f.flags.find((x) => x.code === 'DATA_RESIDENCY');
  if (!f.supplyLocation && residency)
    f.supplyLocation = { value: 'LOCAL', quote: residency.quote, span: residency.span };
  const priv = f.flags.find((x) => x.code === 'PRIVACY');
  if (priv) f.dataSensitivity = { value: 'SENSITIVE', quote: priv.quote, span: priv.span };
  for (const name of knownSuppliers) {
    const i = text.toLowerCase().indexOf(name.toLowerCase());
    const short = name.replace(/\s+(pty|ltd|limited|inc|group|services)\b.*$/i, '').trim();
    const j = i < 0 && short.length >= 5 ? text.toLowerCase().indexOf(short.toLowerCase()) : -1;
    const at = i >= 0 ? i : j;
    if (at >= 0)
      f.suppliers.push({
        name,
        quote: text.slice(at, at + (i >= 0 ? name.length : short.length)),
        span: [at, at + (i >= 0 ? name.length : short.length)],
      });
  }
  return f;
}
