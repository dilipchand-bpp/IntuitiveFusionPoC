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
    /** Normalised total cost of ownership and value for money, when the supplier gave pricing (FR-0350). */
    tco?: number | null;
    priceScore?: number | null;
    valueForMoney?: number | null;
    /** How the panel's individual scores were spread per criterion (FR-0350). */
    spread?: Array<{ criterionId: string; min: number; mean: number; max: number; n: number }>;
  }>;
  mode?: 'SCORING' | 'RANKING';
  priceWeightPct?: number;
  /** Compliance gate results, one per supplier and check (FR-0265). */
  gate?: Array<{ supplier: string; label: string; result: string; detail: string; note: string | null }>;
  /** Earlier stages of a multi-stage evaluation (FR-0285, FR-0360), and this one's own number. */
  stage?: number;
  stages?: Array<{
    stage: number;
    suppliers: Array<{
      displayName: string;
      rank: number | null;
      weightedScore: number;
      shortlisted: boolean;
    }>;
  }>;
  /** Conflict re-declarations after supplier identities were known (FR-0325). */
  redeclaration?: { done: string[]; outstanding: string[] };
  substitutions?: Array<{ departing: string; incoming: string; reason: string }>;
  /** Best and final offer rounds (FR-0290). */
  bafo?: Array<{ round: number; status: string; offers: number; accepted: string[] }>;
  clarifications?: { open: number; answered: number };
}

export const REPORT_SECTIONS = [
  { key: 'summary', label: 'Summary' },
  { key: 'process', label: 'Process followed' },
  { key: 'compliance', label: 'Compliance checks' },
  { key: 'stages', label: 'Stages' },
  { key: 'ranking', label: 'Ranking' },
  { key: 'distribution', label: 'How the panel scored' },
  { key: 'commercial', label: 'Total cost and value for money' },
  { key: 'commentary', label: 'Commentary by supplier' },
  { key: 'negotiation', label: 'Clarifications and best and final offers' },
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

  const gate = i.gate ?? [];
  const compliance = gate.length
    ? [
        `Every response went through the mandatory pass or fail checks before scoring: ${[...new Set(gate.map((g) => g.label))].join('; ')}.`,
        ...i.suppliers.map((sup) => {
          const rows = gate.filter((g) => g.supplier === sup.name);
          const bad = rows.filter((g) => g.result !== 'PASS');
          return bad.length
            ? `${sup.name}: ${bad.map((g) => `${g.label} ${g.result === 'WAIVED' ? 'waived' : 'failed'} (${g.detail}${g.note ? `; ${g.note}` : ''})`).join('; ')}.`
            : `${sup.name}: passed all ${rows.length} checks.`;
        }),
      ].join('\n\n')
    : '';

  const stages = (i.stages ?? []).length
    ? [
        ...(i.stages ?? []).map(
          (st) =>
            `Stage ${st.stage}: ${st.suppliers.length ? st.suppliers.map((x) => `${x.rank ?? 'not ranked'}. ${x.displayName} (${n1(x.weightedScore)})${x.shortlisted ? ', shortlisted' : ''}`).join('; ') : 'no outcome recorded'}.`,
        ),
        `Stage ${i.stage ?? (i.stages ?? []).length + 1} (this evaluation): ${ranked.map((x) => `${x.rank}. ${x.name} (${n1(x.score)})`).join('; ') || 'no supplier ranked'}.`,
      ].join('\n\n')
    : '';

  const distribution = i.suppliers.some((x) => (x.spread ?? []).length)
    ? i.suppliers
        .map(
          (sup) =>
            `${sup.name}. ${(sup.spread ?? []).map((x) => `${crit.get(x.criterionId)?.name ?? 'Criterion'}: lowest ${n1(x.min)}, average ${n1(x.mean)}, highest ${n1(x.max)} (${x.n} scorer${x.n === 1 ? '' : 's'}); agreed ${n1(sup.items.find((y) => y.criterionId === x.criterionId)?.consensus ?? 0)}`).join('; ')}.`,
        )
        .join('\n\n')
    : '';

  const priced = i.suppliers.filter((x) => x.tco !== null && x.tco !== undefined);
  const money = (v: number) => `AUD ${Math.round(v).toLocaleString('en-AU')}`;
  const commercial = priced.length
    ? [
        `Total cost of ownership (price, implementation and running costs over the term) was normalised so the lowest scores 100.${i.mode === 'RANKING' ? ` The final ranking blends the panel's view (${100 - (i.priceWeightPct ?? 0)}%) with normalised cost (${i.priceWeightPct ?? 0}%).` : ''}`,
        ...priced.map(
          (x) =>
            `${x.name}: ${money(x.tco!)}, price score ${n1(x.priceScore ?? 0)}${x.valueForMoney !== null && x.valueForMoney !== undefined ? `, value for money ${n1(x.valueForMoney)}` : ''}.`,
        ),
      ].join('\n\n')
    : '';

  const negotiation = [
    i.clarifications && i.clarifications.open + i.clarifications.answered
      ? `${i.clarifications.answered} clarification request(s) were answered and ${i.clarifications.open} are still open.`
      : '',
    ...(i.bafo ?? []).map(
      (b) =>
        `Best and final offer round ${b.round} (${b.status.toLowerCase()}): ${b.offers} offer(s)${b.accepted.length ? `; accepted: ${b.accepted.join(', ')}` : ''}. Original bids are kept unchanged beside the new offers.`,
    ),
  ]
    .filter(Boolean)
    .join('\n\n');

  const withVfm = priced.filter(
    (x) => x.rank !== null && x.valueForMoney !== null && x.valueForMoney !== undefined,
  );
  const vfmTop =
    withVfm.length === ranked.length && withVfm.length > 1
      ? withVfm.slice().sort((a, b) => b.valueForMoney! - a.valueForMoney!)[0]
      : undefined;
  const recommendation = top
    ? [
        `The panel recommends ${top.name}, the highest ranked compliant supplier (${n1(top.score)} out of 100).`,
        vfmTop
          ? vfmTop.name === top.name
            ? `It also gives the best value for money (${n1(vfmTop.valueForMoney!)}) once total cost of ownership is taken into account.`
            : `Value for money, which weighs quality against total cost of ownership, is highest for ${vfmTop.name} (${n1(vfmTop.valueForMoney!)}) against ${n1(top.valueForMoney ?? 0)} for ${top.name}: the approver should weigh this.`
          : '',
        'The recommendation is subject to approval by a delegate with the necessary authority, supplier due diligence, and conflict-of-interest checks having been completed.',
      ]
        .filter(Boolean)
        .join(' ')
    : 'The panel makes no award recommendation because no supplier is compliant. Procurement should consider re-approaching the market.';

  const redecl = i.redeclaration;
  const processExtra = [
    redecl
      ? `After supplier identities were known, ${redecl.done.length} panel member(s) confirmed their declaration again${redecl.outstanding.length ? `; ${redecl.outstanding.length} had not yet done so (${redecl.outstanding.join(', ')})` : ''}.`
      : '',
    ...(i.substitutions ?? []).map(
      (x) =>
        `${x.departing} was replaced by ${x.incoming} (${x.reason === 'CONFLICT' ? 'material conflict' : 'other reason'}); the departing evaluator's marks were kept as history and left out of the averages.`,
    ),
    i.mode === 'RANKING' ? 'Evaluators ranked the suppliers rather than scoring every criterion.' : '',
  ].filter(Boolean);

  return {
    summary,
    process: [process, ...processExtra].join('\n\n'),
    compliance,
    stages,
    ranking,
    distribution,
    commercial,
    commentary,
    negotiation,
    recommendation,
  };
}
