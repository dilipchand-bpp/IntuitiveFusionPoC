/**
 * Column mapping suggestion (CP-07): which column of the file is which field. SIMULATED and rule-based (engine label
 * `rules-simulated-v1`): header similarity against a synonym list (exact, same words in another order, one contains the other,
 * a typo), adjusted by what the column's values look like (dates, amounts, ABNs, short codes, long text). The user always
 * has the last word: the suggestion is only a starting point they can edit and save per source system.
 */
import type { HistEntity } from '../../db/schema-cpd.js';
import { levenshtein } from '../b8/rules.js';
import { FIELDS, requiredFields, type FieldDef } from './fields.js';
import { abnState, parseAmountLoose, parseDateLoose } from './normalise.js';

export const MAPPING_ENGINE = 'rules-simulated-v1';
export const MIN_SCORE = 0.6;

export type Mapping = Record<string, string | null>;

export interface Suggestion {
  engine: typeof MAPPING_ENGINE;
  mapping: Mapping;
  confidence: Record<string, number>;
  alternatives: Record<string, Array<{ header: string; score: number }>>;
  unmapped: string[];
  missingRequired: string[];
}

const words = (h: string) =>
  h
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

function headerScore(header: string, f: FieldDef): number {
  const h = words(header);
  if (h.length === 0) return 0;
  const hs = h.join(' ');
  let best = 0;
  for (const syn of [f.label, f.key.replace(/_/g, ' '), ...f.synonyms]) {
    const s = words(syn);
    const ss = s.join(' ');
    if (!ss) continue;
    let sc = 0;
    if (hs === ss) sc = 1;
    else if (h.length === s.length && h.every((w) => s.includes(w))) sc = 0.95;
    else if (s.every((w) => h.includes(w))) sc = 0.6 + 0.3 * (s.length / h.length);
    else if (h.every((w) => s.includes(w))) sc = 0.6 + 0.3 * (h.length / s.length);
    else if (hs.length >= 4 && ss.length >= 4) {
      const sim = 1 - levenshtein(hs, ss) / Math.max(hs.length, ss.length);
      if (sim >= 0.78) sc = sim * 0.85;
    }
    if (sc > best) best = sc;
  }
  return best;
}

interface ColumnProfile {
  n: number;
  date: number;
  amount: number;
  abn: number;
  avgLen: number;
  short: number;
  values: string[];
}
function profile(values: string[]): ColumnProfile {
  const v = values.filter((x) => x !== '').slice(0, 60);
  const n = Math.max(1, v.length);
  return {
    n: v.length,
    date: v.filter((x) => parseDateLoose(x) !== null).length / n,
    amount: v.filter((x) => parseAmountLoose(x) !== null).length / n,
    abn:
      v.filter(
        (x) => abnState(x) !== 'EMPTY' && /^[\d\s-]{11,14}$/.test(x) && x.replace(/\D/g, '').length === 11,
      ).length / n,
    avgLen: v.reduce((s, x) => s + x.length, 0) / n,
    short: v.filter((x) => x.length <= 24 && /\d/.test(x)).length / n,
    values: v,
  };
}

function adjust(f: FieldDef, p: ColumnProfile): number {
  if (p.n === 0) return -0.3;
  let a = 0;
  if (f.type === 'date') a += p.date >= 0.6 ? 0.12 * p.date : -0.5;
  else if (p.date >= 0.8 && f.type !== 'text') a -= 0.4;
  else if (p.date >= 0.8) a -= 0.25;
  if (f.type === 'amount') a += p.amount >= 0.6 && p.date < 0.5 ? 0.1 : -0.4;
  else if (f.type === 'int') a += p.amount >= 0.6 ? 0.03 : -0.4;
  if (f.type === 'abn') a += p.abn >= 0.5 ? 0.25 : p.abn > 0 ? 0 : -0.3;
  else if (p.abn >= 0.6) a -= 0.4;
  if (f.type === 'enum' && f.allowed) {
    const allowed = new Set(f.allowed.map((x) => x.toUpperCase()));
    const share =
      p.values.filter((x) => allowed.has(x.toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()))
        .length / Math.max(1, p.values.length);
    a += share >= 0.6 ? 0.1 : -0.15;
  }
  if (f.key === 'contract_number' || f.key === 'sku') a += p.short >= 0.6 ? 0.08 : -0.1;
  if (f.key === 'text') a += p.avgLen > 60 ? 0.1 : -0.3;
  if (f.key === 'title' || f.key === 'description' || f.key === 'name') a += p.avgLen > 150 ? -0.2 : 0;
  return a;
}

/** The suggested mapping for a file, with confidence per field and the runners-up. */
export function suggestMapping(entity: HistEntity, headers: string[], rows: string[][]): Suggestion {
  const fields = FIELDS[entity];
  const profiles = headers.map((_, c) => profile(rows.map((r) => r[c] ?? '')));
  const cand: Array<{ field: FieldDef; col: number; score: number }> = [];
  const alternatives: Suggestion['alternatives'] = {};
  for (const f of fields) {
    const list: Array<{ header: string; score: number }> = [];
    headers.forEach((h, col) => {
      const base = headerScore(h, f);
      if (base <= 0) return;
      const score = Math.max(0, Math.min(1, base + adjust(f, profiles[col]!)));
      list.push({ header: h, score: Math.round(score * 100) / 100 });
      if (score >= MIN_SCORE) cand.push({ field: f, col, score });
    });
    alternatives[f.key] = list.sort((a, b) => b.score - a.score).slice(0, 3);
  }
  cand.sort(
    (a, b) => b.score - a.score || Number(b.field.required) - Number(a.field.required) || a.col - b.col,
  );
  const mapping: Mapping = Object.fromEntries(fields.map((f) => [f.key, null]));
  const confidence: Record<string, number> = {};
  const usedCol = new Set<number>();
  for (const c of cand) {
    if (mapping[c.field.key] !== null || usedCol.has(c.col)) continue;
    mapping[c.field.key] = headers[c.col]!;
    confidence[c.field.key] = Math.round(c.score * 100) / 100;
    usedCol.add(c.col);
  }
  return {
    engine: MAPPING_ENGINE,
    mapping,
    confidence,
    alternatives,
    unmapped: headers.filter((_, i) => !usedCol.has(i)),
    missingRequired: requiredFields(entity).filter((k) => mapping[k] === null),
  };
}

/** A saved mapping applied to a new file: kept where its header is in the file (ignoring case), with what could not be found. */
export function applySavedMapping(
  saved: Mapping,
  headers: string[],
): { mapping: Mapping; missingHeaders: string[] } {
  const byLower = new Map(headers.map((h) => [h.toLowerCase().trim(), h]));
  const mapping: Mapping = {};
  const missingHeaders: string[] = [];
  for (const [field, header] of Object.entries(saved)) {
    if (!header) {
      mapping[field] = null;
      continue;
    }
    const hit = byLower.get(header.toLowerCase().trim());
    mapping[field] = hit ?? null;
    if (!hit) missingHeaders.push(header);
  }
  return { mapping, missingHeaders };
}

/** Checks a mapping a person edited: only known fields, only headers that exist, no column used twice. Returns the problems. */
export function checkMapping(
  entity: HistEntity,
  mapping: Mapping,
  headers: string[],
): Array<{ field: string; message: string }> {
  const out: Array<{ field: string; message: string }> = [];
  const known = new Set(FIELDS[entity].map((f) => f.key));
  const have = new Set(headers);
  const used = new Map<string, string>();
  for (const [field, header] of Object.entries(mapping)) {
    if (!known.has(field)) {
      out.push({ field, message: `"${field}" is not a field of this import` });
      continue;
    }
    if (header === null || header === '') continue;
    if (!have.has(header)) out.push({ field, message: `The file has no column "${header}"` });
    else if (used.has(header))
      out.push({ field, message: `Column "${header}" is already used for ${used.get(header)}` });
    else used.set(header, field);
  }
  for (const k of requiredFields(entity))
    if (!mapping[k])
      out.push({
        field: k,
        message: `${FIELDS[entity].find((f) => f.key === k)!.label} must be mapped to a column`,
      });
  return out;
}
