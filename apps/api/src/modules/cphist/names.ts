/**
 * Supplier name comparison for the historical import (CP-07). It builds on the duplicate-supplier rules of B8 (FR-0795:
 * `normaliseName` drops Pty, Ltd, Limited, punctuation and case) and adds what legacy registers need: "P/L", "I.T.", "Mgmt"
 * and a name that is the same business with a word more or less ("Apex Cleaning" and "Apex Cleaning Services").
 */
import { levenshtein, nameSimilarity, normaliseName } from '../b8/rules.js';

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bp\s*\/\s*l\b/gi, ' pty ltd '],
  [/\bmgmt\b/gi, 'management'],
  [/\bsvcs?\b/gi, 'services'],
  [/\bintl\b/gi, 'international'],
];

const clean = (s: string) => {
  let t = s.replace(/\b(?:[a-z]\.){2,}/gi, (m) => m.replace(/\./g, ''));
  for (const [re, to] of ABBREVIATIONS) t = t.replace(re, to);
  return t;
};

/** The comparison key of a supplier name: two spellings of the same business have the same key. */
export const nameKey = (s: string): string => normaliseName(clean(s));

const tokenMatch = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));

/** 0 to 1: how alike two names are, where one being the other with extra words counts as alike. */
export function nameAlike(a: string, b: string): number {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const base = Math.max(
    nameSimilarity(clean(a), clean(b)),
    1 - levenshtein(x, y) / Math.max(x.length, y.length),
  );
  const tx = x.split(' ');
  const ty = y.split(' ');
  const [short, long] = tx.length <= ty.length ? [tx, ty] : [ty, tx];
  const subset = short.length >= 2 && short.every((t) => long.some((u) => tokenMatch(t, u)));
  return Math.max(base, subset ? 0.86 : 0);
}
