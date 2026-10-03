/** Builds the evaluation report text from a locked evaluation (US-EVL-05). Deterministic: no AI, same inputs, same report. */

export interface ReportInput {
  title: string;
  number: string;
  type: string;
  generatedAt: Date;
  varianceLimitPct: number;
  panel: Array<{
    name: string;
    stream: string;
    outcome: 'NO_CONFLICT' | 'CONFLICT_REMOVED' | 'CONFLICT_REVIEWED';
  }>;
  criteria: Array<{ id: string; name: string; weight: number; stream: string; passFail: boolean }>;
  suppliers: Array<{
    name: string;
    score: number;
    rank: number | null;
    compliant: boolean;
    items: Array<{
      criterionId: string;
      consensus: number;
      flagged: boolean;
      variance: number | null;
      rationale: string | null;
    }>;
    comments: string[];
  }>;
}

export const REPORT_SECTIONS = [
  { key: 'summary', label: 'Summary' },
  { key: 'process', label: 'Process followed' },
  { key: 'ranking', label: 'Ranking' },
  { key: 'commentary', label: 'Commentary by supplier' },
  { key: 'recommendation', label: 'Recommendation' },
] as const;

const n1 = (v: number) => v.toFixed(1);
const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export function buildReport(i: ReportInput): Record<string, string> {
  const ranked = i.suppliers.filter((s) => s.rank !== null).sort((a, b) => a.rank! - b.rank!);
  const top = ranked[0];
  const flagged = i.suppliers.flatMap((s) =>
    s.items.filter((x) => x.flagged).map((x) => ({ s: s.name, ...x })),
  );
  const crit = new Map(i.criteria.map((c) => [c.id, c]));
  const removed = i.panel.filter((p) => p.outcome === 'CONFLICT_REMOVED');
  const reviewed = i.panel.filter((p) => p.outcome === 'CONFLICT_REVIEWED');
  const active = i.panel.filter((p) => p.outcome !== 'CONFLICT_REMOVED');

  const summary = [
    `${i.suppliers.length} submitted response(s) to ${i.number} ${i.title} were evaluated by a panel of ${active.length}.`,
    top
      ? `${top.name} ranked first with a weighted score of ${n1(top.score)} out of 100.`
      : 'No supplier met the mandatory requirements, so none is ranked.',
    `This report was generated on ${stamp(i.generatedAt)} from the locked consensus scores.`,
  ].join('\n\n');

  const process = [
    `Each of the ${active.length} panel member(s) declared before seeing any supplier identity or bid file that they had no conflict of interest.${removed.length ? ` ${removed.length} member(s) declared a conflict that a delegate found material, and were removed from the evaluation.` : ''}${reviewed.length ? ` ${reviewed.length} member(s) declared a conflict that a delegate reviewed and allowed to continue.` : ''}`,
    `Scoring was independent: each evaluator scored without sight of anyone else's scores. Technical evaluators did not have access to pricing, and commercial evaluators did not have access to technical responses. Criteria and weights: ${i.criteria.map((c) => (c.weight > 0 ? `${c.name} ${c.weight}%` : c.name)).join('; ')}.`,
    `Consensus was moderated by the chair. Differences above ${i.varianceLimitPct}% were flagged and needed a recorded rationale before the scores could be locked. ${flagged.length ? `${flagged.length} score(s) were flagged and resolved.` : 'No score was flagged.'}`,
    ...flagged.map(
      (f) =>
        `Flagged: ${f.s}, ${crit.get(f.criterionId)?.name ?? 'criterion'} (${f.variance === null ? 'n/a' : `${n1(f.variance)}%`} difference). Consensus ${n1(f.consensus)}. Rationale: ${f.rationale ?? 'not recorded'}`,
    ),
  ].join('\n\n');

  const ranking = i.suppliers
    .slice()
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.score - a.score)
    .map((s) =>
      s.rank === null
        ? `Not ranked: ${s.name} did not meet a mandatory (pass or fail) requirement.`
        : `${s.rank}. ${s.name}: ${n1(s.score)} out of 100`,
    )
    .join('\n\n');

  const commentary = i.suppliers
    .map((s) => {
      const lines = s.items
        .map((x) => `${crit.get(x.criterionId)?.name ?? 'Criterion'}: ${n1(x.consensus)} out of 10`)
        .join('; ');
      const said = s.comments.length
        ? `Evaluator comments: ${s.comments.join(' | ')}`
        : 'No evaluator comments were recorded.';
      return `${s.name}. ${lines}. ${said}`;
    })
    .join('\n\n');

  const recommendation = top
    ? `The panel recommends ${top.name}, the highest ranked compliant supplier (${n1(top.score)} out of 100). The recommendation is subject to approval by a delegate with the necessary authority, supplier due diligence, and conflict-of-interest checks having been completed.`
    : 'The panel makes no award recommendation because no supplier is compliant. Procurement should consider re-approaching the market.';

  return { summary, process, ranking, commentary, recommendation };
}
