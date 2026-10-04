/**
 * Plain-language entry of scores and rankings (FR-0315). A simulated language model: fixed rules, no network, the same
 * text always gives the same reading. The reading is shown for confirmation before anything is saved, so a person
 * stays responsible for every score. A real model would replace `readScores` / `readOrder` behind the same shapes.
 */
import { SCORE_MAX, SCORE_STEP } from './scoring.js';

export interface CriterionRef {
  id: string;
  name: string;
  passFail: boolean;
}
export interface ReadScore {
  criterionId: string;
  score: number;
  comment: string;
  basis: string;
}

/** Words that stand for a score out of 10, strongest first so "very good" is read before "good". */
const WORDS: Array<[RegExp, number]> = [
  [/\b(outstanding|exceptional|excellent|superb|best)\b/, 9.5],
  [/\b(very (strong|good)|strong|impressive)\b/, 8.5],
  [/\b(good|solid|well|robust|capable|competitive)\b/, 7.5],
  [/\b(adequate|acceptable|average|satisfactory|fair|ok|okay|moderate)\b/, 5.5],
  [/\b(weak|poor|limited|thin|lacking|concerning|below)\b/, 3],
  [/\b(very (weak|poor)|unacceptable|inadequate|failed|absent)\b/, 1],
];
const PASS = /\b(pass(es|ed)?|meets?|compliant|complies|yes|satisfied)\b/;
const FAIL = /\b(fail(s|ed)?|does not meet|doesn't meet|non-?compliant|not compliant|no)\b/;

const round = (v: number) => Math.min(SCORE_MAX, Math.max(0, Math.round(v / SCORE_STEP) * SCORE_STEP));
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !['with', 'and', 'the', 'pass', 'fail', 'that', 'this'].includes(w));
const stem = (w: string) => w.slice(0, 5);

/** Which criterion a clause talks about: the one sharing the most word stems with it. */
function pickCriterion(clause: string, criteria: readonly CriterionRef[]): CriterionRef | null {
  const words = new Set(tokens(clause).map(stem));
  let best: CriterionRef | null = null;
  let bestN = 0;
  for (const c of criteria) {
    const n = tokens(c.name)
      .map(stem)
      .filter((w) => words.has(w)).length;
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

export function readScores(text: string, criteria: readonly CriterionRef[]) {
  const scores: ReadScore[] = [];
  const unmatched: string[] = [];
  const clauses = text
    .split(/[.;\n]| but | and (?=\w+ (?:is|are|was|were|has|have)\b)/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 1);
  for (const clause of clauses) {
    const c = pickCriterion(clause, criteria);
    if (!c) {
      unmatched.push(clause);
      continue;
    }
    if (scores.some((x) => x.criterionId === c.id)) continue; // the first statement about a criterion stands
    const low = clause.toLowerCase();
    const num = /(\d+(?:\.\d+)?)\s*(?:\/\s*10|out of 10|of 10)/.exec(low) ?? /\b(10|\d(?:\.\d)?)\b/.exec(low);
    let value: number | null = null;
    let basis = '';
    if (c.passFail) {
      if (FAIL.test(low) && !/\bnot fail/.test(low)) [value, basis] = [0, 'fail'];
      else if (PASS.test(low)) [value, basis] = [SCORE_MAX, 'pass'];
    } else if (num && Number(num[1]) <= SCORE_MAX) {
      [value, basis] = [round(Number(num[1])), `${num[1]} out of 10`];
    } else {
      for (const [re, v] of WORDS)
        if (re.test(low)) {
          [value, basis] = [v, re.exec(low)![0]];
          break;
        }
    }
    if (value === null) unmatched.push(clause);
    else scores.push({ criterionId: c.id, score: value, comment: clause, basis });
  }
  return { scores, unmatched };
}

export interface SupplierRef {
  supplierId: string;
  names: string[];
}

/**
 * Reads "Supplier B first, then A, then C" or "Evergreen, Brightwave, Northstar" as an order. Each supplier must be
 * named exactly once; anything else is reported back rather than guessed.
 */
export function readOrder(text: string, suppliers: readonly SupplierRef[]) {
  const low = text.toLowerCase();
  const hits: Array<{ at: number; supplierId: string }> = [];
  const missing: string[] = [];
  for (const s of suppliers) {
    let at = -1;
    for (const n of s.names) {
      const key = n.toLowerCase();
      // "Supplier B" may be written as just "B" when it stands alone
      const letter = /^supplier ([a-z]\d?)$/.exec(key)?.[1];
      const i = low.indexOf(key);
      const j = letter ? new RegExp(`(^|[^a-z])${letter}([^a-z]|$)`).exec(low)?.index : undefined;
      const found = i >= 0 ? i : j !== undefined ? j : -1;
      if (found >= 0 && (at < 0 || found < at)) at = found;
      const first = /^([a-z]+)/.exec(key)?.[1];
      if (at < 0 && first && first.length >= 5) {
        const k = low.indexOf(first);
        if (k >= 0) at = k;
      }
    }
    if (at < 0) missing.push(s.names[0] ?? s.supplierId);
    else hits.push({ at, supplierId: s.supplierId });
  }
  hits.sort((a, b) => a.at - b.at);
  return { order: hits.map((h) => h.supplierId), missing };
}

/** A position in an ordering of n suppliers as a score out of 10, in half points (first = 10, last = 0). */
export function positionScore(position: number, n: number): number {
  if (n <= 1) return SCORE_MAX;
  return round(((n - position) / (n - 1)) * SCORE_MAX);
}
