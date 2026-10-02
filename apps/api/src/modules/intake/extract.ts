/**
 * Deterministic text understanding for the SIMULATED assistant. Rule-based on purpose: tests are repeatable and no
 * data leaves the machine (ADR-0005). A real model replaces this behind the AiProvider interface.
 */
import type { FieldMap } from './fields.js';

export interface CategoryRule {
  category: string;
  unspsc: string;
  keywords: RegExp;
  /** Categories that raise governance attention (FR-0060 "category criticality"). */
  critical?: boolean;
  sensitiveData?: boolean;
  title: string;
}

export const CATEGORIES: readonly CategoryRule[] = [
  {
    category: 'IT managed services',
    unspsc: '81111800',
    keywords:
      /\b(managed )?it\b|software|cloud|cyber|network|helpdesk|infrastructure|saas|hosting|data ?centre/i,
    critical: true,
    sensitiveData: true,
    title: 'IT services',
  },
  {
    category: 'Health services',
    unspsc: '85100000',
    keywords: /health|medical|clinical|pathology|nursing/i,
    critical: true,
    sensitiveData: true,
    title: 'Health services',
  },
  {
    category: 'Building cleaning',
    unspsc: '76111500',
    keywords: /clean(ing|ers?)?|janitor/i,
    title: 'Facilities cleaning services',
  },
  {
    category: 'Security services',
    unspsc: '92121500',
    keywords: /security (guard|service)s?|guard(s|ing)?\b|patrol/i,
    title: 'Security guard services',
  },
  {
    category: 'Landscaping',
    unspsc: '70171700',
    keywords: /landscap|grounds|garden|lawn/i,
    title: 'Grounds and landscaping',
  },
  {
    category: 'Paper products',
    unspsc: '14111500',
    keywords: /\bpaper\b|stationery/i,
    title: 'Office paper supply',
  },
  {
    category: 'Apparel',
    unspsc: '53100000',
    keywords: /uniform|apparel|clothing/i,
    title: 'Staff uniforms supply',
  },
  {
    category: 'Catering',
    unspsc: '90101500',
    keywords: /cater|food|beverage|fruit|coffee/i,
    title: 'Catering services',
  },
  {
    category: 'Professional services',
    unspsc: '80101500',
    keywords: /consult|advisory|legal panel|audit services?/i,
    title: 'Professional services',
  },
  {
    category: 'Construction',
    unspsc: '72101500',
    keywords: /construction|building works|refurbish|fit-?out|renovat/i,
    title: 'Building works',
  },
];

const WORD_NUM: Record<string, number> = {
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
  twelve: 12,
  eighteen: 18,
  twenty: 20,
  thirty: 30,
  thirtysix: 36,
};
const num = (s: string): number | null => {
  const t = s.toLowerCase().replace(/[-\s]/g, '');
  if (WORD_NUM[t] !== undefined) return WORD_NUM[t]!;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** "$1.2M", "1,200,000", "about 50k", "AUD 640 thousand" -> dollars. Returns null when no amount is present. */
export function parseMoney(text: string): number | null {
  const m = text.match(
    /(?:\$|aud\s*)\s*([\d][\d,]*(?:\.\d+)?)\s*(m(?:illion)?|k|thousand|b(?:illion)?)?\b|\b([\d][\d,]*(?:\.\d+)?)\s*(m(?:illion)?|k|thousand)\b/i,
  );
  if (!m) {
    const plain = text.match(/\b(\d{1,3}(?:,\d{3})+|\d{5,})\b/);
    return plain ? Number(plain[1]!.replace(/,/g, '')) : null;
  }
  const raw = m[1] ?? m[3]!;
  const unit = (m[2] ?? m[4] ?? '').toLowerCase();
  const base = Number(raw.replace(/,/g, ''));
  const mult = unit.startsWith('b')
    ? 1e9
    : unit.startsWith('m')
      ? 1e6
      : unit === 'k' || unit === 'thousand'
        ? 1e3
        : 1;
  return Math.round(base * mult);
}

/** "three-year term", "36 months", "2 years", "18-month" -> months. */
export function parseTermMonths(text: string): number | null {
  const y = text.match(/\b([a-z]+|\d+(?:\.\d+)?)[-\s]?(?:year|yr)s?\b/i);
  if (y) {
    const n = num(y[1]!);
    if (n !== null && n > 0 && n <= 30) return Math.round(n * 12);
  }
  const mo = text.match(/\b([a-z]+|\d+)[-\s]?months?\b/i);
  if (mo) {
    const n = num(mo[1]!);
    if (n !== null && n > 0 && n <= 360) return n;
  }
  return null;
}

export const UNITS = [
  'Facilities',
  'Procurement',
  'Finance',
  'Legal',
  'Risk',
  'Executive',
  'Operations',
  'Human Resources',
  'Marketing',
];
/** "IT" is only a business unit in unit-like phrasing ("IT team", "owned by IT") or as a bare answer, never in "IT services". */
const IT_UNIT =
  /\bIT (?:team|department|unit|division|branch)\b|\b(?:owned by|from|for|within|in) IT\b(?! services?)|^\s*IT\s*\.?\s*$/;
// A unit is recognised when written as a proper name ("for Facilities") or after an explicit cue ("owned by facilities").
// Lower-case "facilities cleaning" is a kind of service, not the owning unit, so it is not matched.
const UNIT_PATTERNS = UNITS.map(
  (u) =>
    [
      u,
      new RegExp(String.raw`\b${u}\b`),
      new RegExp(
        String.raw`\b(?:owned by|from|within|unit is|department is|team is|belongs to)\s+${u}\b`,
        'i',
      ),
    ] as const,
);

export function parseBusinessUnit(text: string): string | null {
  if (IT_UNIT.test(text)) return 'IT';
  return UNIT_PATTERNS.find(([, proper, cued]) => proper.test(text) || cued.test(text))?.[0] ?? null;
}

/** Maps a typed answer such as "facilities" to the canonical unit name when it is one we know. */
export function canonicalUnit(answer: string): string | null {
  const a = answer.trim().replace(/\.$/, '');
  if (/^it$/i.test(a)) return 'IT';
  return UNITS.find((u) => u.toLowerCase() === a.toLowerCase()) ?? null;
}

/** A plausible short free-text answer: a few words, no sentence punctuation (so a pasted instruction is rejected). */
export const looksLikeShortAnswer = (answer: string): boolean => {
  const t = answer.trim();
  return t.length > 0 && t.length <= 60 && t.split(/\s+/).length <= 6 && !/[.;:!?]\s|[;:!?]$/.test(t);
};

export function matchCategory(text: string): CategoryRule | null {
  return CATEGORIES.find((c) => c.keywords.test(text)) ?? null;
}

export interface Extracted {
  fields: FieldMap;
  /** Keys the text actually mentioned (so a follow-up only overwrites what the user said). */
  mentioned: string[];
  category?: CategoryRule;
}

/** Pulls whatever structured facts the text contains. Never invents: absent facts stay absent. */
export function extractFromText(text: string): Extracted {
  const fields: FieldMap = {};
  const mentioned: string[] = [];
  const set = (k: string, v: string | number | null) => {
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      fields[k] = String(v);
      mentioned.push(k);
    }
  };
  const cat = matchCategory(text);
  if (cat) {
    set('category', `${cat.category} (UNSPSC ${cat.unspsc})`);
    set('title', cat.title);
  }
  set('estimatedValue', parseMoney(text));
  set('termMonths', parseTermMonths(text));
  const unit = parseBusinessUnit(text);
  if (unit) set('businessUnit', unit);
  const owner = text.match(
    /contract owner (?:is|will be|:)?\s*([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+){0,2}|the [\w\s]+? (?:manager|lead|director))/,
  );
  if (owner) set('contractOwner', owner[1]!.trim());
  if (/\boffshore|overseas|international supplier/i.test(text)) set('supplyLocation', 'OFFSHORE');
  else if (/\blocal|onshore|australian supplier/i.test(text)) set('supplyLocation', 'LOCAL');
  if (/personal (data|information)|patient|customer data|sensitive|classified|defence/i.test(text))
    set('dataSensitivity', 'SENSITIVE');
  const out: Extracted = { fields, mentioned };
  if (cat) out.category = cat;
  return out;
}
