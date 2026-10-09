/**
 * Reads the few facts the agent can take from plain request text with fixed rules (rules-simulated-v1): value, term, category and
 * a title. It never invents a value: an amount that the text does not give stays missing, and the run asks a person.
 */
export interface ParsedRequest {
  title: string | null;
  category: string | null;
  estimatedValue: number | null;
  termMonths: number | null;
}

const WORD_NUMBERS: Record<string, number> = {
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
};

const CATEGORIES: Array<[RegExp, string]> = [
  [/\b(cleaning|janitorial)\b/i, 'Building cleaning (UNSPSC 76111500)'],
  [/\b(security guard|security services|guarding)\b/i, 'Security services (UNSPSC 92121500)'],
  [/\b(catering|food services)\b/i, 'Catering services (UNSPSC 90101600)'],
  [/\b(software|saas|licen[cs]es?|cloud|it services|managed services)\b/i, 'IT services (UNSPSC 81111500)'],
  [/\b(consult(ing|ancy|ants?)|advisory)\b/i, 'Professional consulting (UNSPSC 80101500)'],
  [/\b(construction|building works|refurbishment|fit-?out)\b/i, 'Construction services (UNSPSC 72101500)'],
  [/\b(laptops?|computers?|hardware|devices)\b/i, 'IT hardware (UNSPSC 43211500)'],
  [/\b(printing|stationery|office supplies)\b/i, 'Office supplies (UNSPSC 44121500)'],
  [/\b(vehicles?|fleet)\b/i, 'Fleet vehicles (UNSPSC 25101500)'],
];

export function parseRequestText(text: string): ParsedRequest {
  const t = text.replace(/\s+/g, ' ').trim();
  return { title: titleOf(t), category: categoryOf(t), estimatedValue: valueOf(t), termMonths: termOf(t) };
}

function valueOf(t: string): number | null {
  // an amount counts only when it is written as money: a dollar sign, or a unit or currency word beside it
  const re =
    /(?:(?:aud|usd|a\$|\$)\s?)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|m|mm|million|thousand|b)?\b|\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|m|million|thousand|dollars|aud)\b/gi;
  for (const m of t.matchAll(re)) {
    const num = Number((m[1] ?? m[3] ?? '').replace(/,/g, ''));
    const unit = (m[2] ?? m[4] ?? '').toLowerCase();
    if (!Number.isFinite(num) || num <= 0) continue;
    const mult =
      unit === 'k' || unit === 'thousand'
        ? 1_000
        : unit === 'm' || unit === 'mm' || unit === 'million'
          ? 1_000_000
          : 1;
    // "5 years" must not be read as money: only the units above or a currency marker reach here
    const v = Math.round(num * mult);
    if (v > 0) return v;
  }
  return null;
}

function termOf(t: string): number | null {
  const m = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)[\s-]*(year|yr|month)s?\b/i.exec(
    t,
  );
  if (!m) return null;
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : (WORD_NUMBERS[m[1]!.toLowerCase()] ?? 0);
  if (!n) return null;
  return /^y/i.test(m[2]!) ? n * 12 : n;
}

function categoryOf(t: string): string | null {
  for (const [re, label] of CATEGORIES) if (re.test(t)) return label;
  return null;
}

function titleOf(t: string): string | null {
  const first = t.split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]+$/, '') ?? '';
  const cleaned = first
    .replace(
      /^(please\s+)?(i|we)\s+(need|want|would like|require)\s+(to\s+(buy|procure|source|run)\s+)?/i,
      '',
    )
    .replace(/^(run|start)\s+(an?\s+)?(rfx|rfp|rft|rfq|tender)\s+for\s+/i, '')
    .trim();
  const s = (cleaned || first).slice(0, 80).trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
}
