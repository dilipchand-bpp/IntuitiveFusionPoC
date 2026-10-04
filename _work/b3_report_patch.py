p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\evaluation\report.ts'
s = open(p, encoding='utf8').read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a
    s = s.replace(a, b)


rep("""    comments: string[];
  }>;
}
""", """    comments: string[];
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
    suppliers: Array<{ displayName: string; rank: number | null; weightedScore: number; shortlisted: boolean }>;
  }>;
  /** Conflict re-declarations after supplier identities were known (FR-0325). */
  redeclaration?: { done: string[]; outstanding: string[] };
  substitutions?: Array<{ departing: string; incoming: string; reason: string }>;
  /** Best and final offer rounds (FR-0290). */
  bafo?: Array<{ round: number; status: string; offers: number; accepted: string[] }>;
  clarifications?: { open: number; answered: number };
}
""")

rep("""  { key: 'summary', label: 'Summary' },
  { key: 'process', label: 'Process followed' },
  { key: 'ranking', label: 'Ranking' },
  { key: 'commentary', label: 'Commentary by supplier' },
  { key: 'recommendation', label: 'Recommendation' },""", """  { key: 'summary', label: 'Summary' },
  { key: 'process', label: 'Process followed' },
  { key: 'compliance', label: 'Compliance checks' },
  { key: 'stages', label: 'Stages' },
  { key: 'ranking', label: 'Ranking' },
  { key: 'distribution', label: 'How the panel scored' },
  { key: 'commercial', label: 'Total cost and value for money' },
  { key: 'commentary', label: 'Commentary by supplier' },
  { key: 'negotiation', label: 'Clarifications and best and final offers' },
  { key: 'recommendation', label: 'Recommendation' },""")

# the text for each new section, and a recommendation that can use value for money
rep("""  const recommendation = top
    ? `The panel recommends ${top.name}, the highest ranked compliant supplier (${n1(top.score)} out of 100). The recommendation is subject to approval by a delegate with the necessary authority, supplier due diligence, and conflict-of-interest checks having been completed.`
    : 'The panel makes no award recommendation because no supplier is compliant. Procurement should consider re-approaching the market.';

  return { summary, process, ranking, commentary, recommendation };""", """  const gate = i.gate ?? [];
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
      ].join('\\n\\n')
    : '';

  const stages = (i.stages ?? []).length
    ? [
        ...(i.stages ?? []).map(
          (st) =>
            `Stage ${st.stage}: ${st.suppliers.length ? st.suppliers.map((x) => `${x.rank ?? 'not ranked'}. ${x.displayName} (${n1(x.weightedScore)})${x.shortlisted ? ', shortlisted' : ''}`).join('; ') : 'no outcome recorded'}.`,
        ),
        `Stage ${i.stage ?? (i.stages ?? []).length + 1} (this evaluation): ${ranked.map((x) => `${x.rank}. ${x.name} (${n1(x.score)})`).join('; ') || 'no supplier ranked'}.`,
      ].join('\\n\\n')
    : '';

  const distribution = i.suppliers.some((x) => (x.spread ?? []).length)
    ? i.suppliers
        .map(
          (sup) =>
            `${sup.name}. ${(sup.spread ?? []).map((x) => `${crit.get(x.criterionId)?.name ?? 'Criterion'}: lowest ${n1(x.min)}, average ${n1(x.mean)}, highest ${n1(x.max)} (${x.n} scorer${x.n === 1 ? '' : 's'}); agreed ${n1(sup.items.find((y) => y.criterionId === x.criterionId)?.consensus ?? 0)}`).join('; ')}.`,
        )
        .join('\\n\\n')
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
      ].join('\\n\\n')
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
    .join('\\n\\n');

  const withVfm = priced.filter((x) => x.rank !== null && x.valueForMoney !== null && x.valueForMoney !== undefined);
  const vfmTop = withVfm.length === ranked.length && withVfm.length > 1
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
    process: [process, ...processExtra].join('\\n\\n'),
    compliance,
    stages,
    ranking,
    distribution,
    commercial,
    commentary,
    negotiation,
    recommendation,
  };""")
open(p, 'w', encoding='utf8').write(s)
print('ok')
