/** Pure evaluation rules: who may see and score what, variance, weighted scores and ranking. No database in here. */

export type Stream = 'TECHNICAL' | 'COMMERCIAL' | 'OTHER';

/**
 * Stream isolation. A technical member scores technical criteria and the shared ("other") ones, and is blind to price.
 * A commercial member scores commercial and shared criteria. The chair (stream OTHER) sees and may score everything.
 */
export const canScoreCriterion = (member: Stream, criterion: Stream): boolean =>
  member === 'OTHER' || criterion === 'OTHER' || member === criterion;

/** Which bid files a member may open: technical members only technical files, commercial members only commercial files. */
export const canSeeFileSection = (member: Stream, section: Stream): boolean =>
  member === 'OTHER' || member === section;

export const SCORE_MIN = 0;
export const SCORE_MAX = 10;
export const SCORE_STEP = 0.5;

/** 0 to 10 in half points; pass/fail criteria accept only 0 (fail) or 10 (pass). */
export function validScore(v: number, passFail: boolean): boolean {
  if (!Number.isFinite(v) || v < SCORE_MIN || v > SCORE_MAX) return false;
  if (passFail) return v === 0 || v === SCORE_MAX;
  return Math.abs(v / SCORE_STEP - Math.round(v / SCORE_STEP)) < 1e-9;
}

/**
 * Disagreement between scorers as a percentage of the highest score: (max - min) / max. Fewer than two scorers means
 * there is nothing to disagree about (null). Two scorers on 8 and 5 differ by 37.5%.
 */
export function variancePct(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  if (hi === 0) return 0;
  return Math.round(((hi - lo) / hi) * 10_000) / 100;
}
export const isFlagged = (variance: number | null, limitPct: number): boolean =>
  variance !== null && variance > limitPct;

export interface CriterionDef {
  id: string;
  weight: number;
  passFail: boolean;
}

/** Weighted score out of 100 from consensus scores (0-10) and criterion weights. Pass/fail criteria carry no weight. */
export function weightedScore(
  criteria: readonly CriterionDef[],
  scores: ReadonlyMap<string, number>,
): number {
  const weighted = criteria.filter((c) => !c.passFail);
  const total = weighted.reduce((s, c) => s + c.weight, 0);
  if (total === 0) return 0;
  const got = weighted.reduce((s, c) => s + c.weight * ((scores.get(c.id) ?? 0) / SCORE_MAX), 0);
  return Math.round((got / total) * 10_000) / 100;
}

/** A supplier fails compliance when any pass/fail criterion has a consensus score of 0. */
export const complies = (criteria: readonly CriterionDef[], scores: ReadonlyMap<string, number>): boolean =>
  criteria.filter((c) => c.passFail).every((c) => (scores.get(c.id) ?? SCORE_MAX) > 0);

export interface RankInput {
  supplierId: string;
  score: number;
  compliant: boolean;
}
/** Competition ranking (1, 2, 2, 4). Non-compliant suppliers are not ranked. */
export function rank(entries: readonly RankInput[]): Array<RankInput & { rank: number | null }> {
  const ok = entries.filter((e) => e.compliant).sort((a, b) => b.score - a.score);
  const ranks = new Map<string, number>();
  ok.forEach((e, i) =>
    ranks.set(
      e.supplierId,
      i > 0 && ok[i - 1]!.score === e.score ? ranks.get(ok[i - 1]!.supplierId)! : i + 1,
    ),
  );
  return entries.map((e) => ({ ...e, rank: ranks.get(e.supplierId) ?? null }));
}

/** "Supplier A", "Supplier B" ... shown to a panel member until they have declared no conflict. */
export const anonymousName = (index: number): string =>
  `Supplier ${String.fromCharCode(65 + (index % 26))}${index >= 26 ? Math.floor(index / 26) : ''}`;
