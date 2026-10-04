import { describe, expect, it } from 'vitest';
import {
  MANDATORY_KINDS,
  MANDATORY_SPEND_PCTS,
  countdownAlerts,
  escalationFactor,
  evaluateRebate,
  envelopeState,
  extractTriggers,
  insuranceAlertDate,
  matchInvoice,
  measureVariation,
  nextSteps,
  planActivities,
  planTier,
  spendCrossings,
  type MatchInput,
} from './b5-rules.js';
import { addDays } from './dates.js';

const base = (over: Partial<MatchInput> = {}): MatchInput => ({
  invoiceDate: '2027-02-01',
  lines: [{ item: 'Cleaning hour', qty: 10, unitPrice: 50 }],
  rates: new Map([['Cleaning hour', 50]]),
  escalations: [],
  po: {
    number: 'PO-1',
    amount: 1000,
    lines: [{ item: 'Cleaning hour', qty: 20, unitPrice: 50 }],
    invoicedQty: new Map(),
    invoicedAmount: 0,
  },
  requirePo: true,
  ...over,
});
const codes = (i: MatchInput) => matchInvoice(i).map((f) => f.code);

describe('FR-0525 price escalation', () => {
  it('compounds the escalations that have taken effect and applies the cap to an index-linked step', () => {
    const rows = [
      { kind: 'SCHEDULED' as const, effectiveOn: '2027-07-01', pct: 3, capPct: null },
      { kind: 'CPI' as const, effectiveOn: '2028-07-01', pct: 6.2, capPct: 5 },
    ];
    expect(escalationFactor(rows, '2027-06-30')).toBe(1);
    expect(escalationFactor(rows, '2027-07-01')).toBe(1.03);
    expect(escalationFactor(rows, '2028-07-01')).toBe(1.0815); // 1.03 x 1.05: the index moved 6.2% but the cap is 5%
  });
});

describe('FR-0500 three-way match of purchase order, contract and invoice', () => {
  it('passes an invoice at the contracted rate within the purchase order', () => {
    expect(codes(base())).toEqual([]);
  });

  it('blocks an unapproved price increase', () => {
    const f = matchInvoice(base({ lines: [{ item: 'Cleaning hour', qty: 10, unitPrice: 55 }] }));
    expect(f.map((x) => x.code)).toContain('RATE_INCREASE');
    expect(f.find((x) => x.code === 'RATE_INCREASE')!.severity).toBe('BLOCK');
  });

  it('blocks an item that is not on the rate card, one not on the order, and an order price that was exceeded', () => {
    expect(codes(base({ lines: [{ item: 'Window clean', qty: 1, unitPrice: 10 }] }))).toEqual(
      expect.arrayContaining(['NOT_ON_CONTRACT', 'NOT_ON_PO']),
    );
    const po = base().po!;
    expect(
      codes(
        base({
          po: { ...po, lines: [{ item: 'Cleaning hour', qty: 20, unitPrice: 45 }] },
        }),
      ),
    ).toContain('PO_PRICE_MISMATCH');
  });

  it('blocks quantities and amounts above the purchase order, counting what was invoiced before', () => {
    const po = base().po!;
    const over = base({
      lines: [{ item: 'Cleaning hour', qty: 15, unitPrice: 50 }],
      po: { ...po, invoicedQty: new Map([['cleaning hour', 10]]), invoicedAmount: 500 },
    });
    expect(codes(over)).toEqual(expect.arrayContaining(['OVER_PO_QTY', 'OVER_PO_AMOUNT']));
  });

  it('needs a purchase order where the ERP is integrated, and only flags a missing rate card', () => {
    expect(codes(base({ po: null }))).toContain('NO_PO');
    expect(codes(base({ po: null, requirePo: false }))).toEqual([]);
    const f = matchInvoice(base({ rates: new Map() }));
    expect(f.map((x) => x.code)).toEqual(['NO_RATE_CARD']);
    expect(f[0]!.severity).toBe('FLAG');
  });

  it('FR-0525 allows the escalated price on or after the effective date and blocks one applied early or too high', () => {
    const esc = [{ kind: 'SCHEDULED' as const, effectiveOn: '2027-07-01', pct: 4, capPct: null }];
    const po = { ...base().po!, lines: [{ item: 'Cleaning hour', qty: 20, unitPrice: 60 }] };
    const at = (date: string, price: number) =>
      matchInvoice(
        base({
          invoiceDate: date,
          lines: [{ item: 'Cleaning hour', qty: 1, unitPrice: price }],
          escalations: esc,
          po,
        }),
      );
    expect(at('2027-07-01', 52)).toEqual([]);
    const early = at('2027-06-30', 52);
    expect(early[0]!.code).toBe('ESCALATION_OUTSIDE_FORMULA');
    expect(early[0]!.message).toContain('not due until 2027-07-01');
    expect(at('2027-08-01', 55)[0]!.code).toBe('ESCALATION_OUTSIDE_FORMULA');
  });
});

describe('FR-0520 rebates', () => {
  const r = {
    threshold: 100_000,
    ratePct: 2,
    periodStart: '2026-10-01',
    periodEnd: '2027-09-30',
    claimed: 0,
  };
  it('earns the rate on the period spend once the threshold is reached', () => {
    expect(evaluateRebate(r, 50_000, '2027-03-01')).toMatchObject({
      status: 'OPEN',
      earned: 0,
      flagged: false,
    });
    expect(evaluateRebate(r, 150_000, '2027-03-01')).toMatchObject({
      status: 'EARNED_TO_CLAIM',
      earned: 3000,
      flagged: false,
    });
  });
  it('flags a missed or under-claimed rebate once the period has ended', () => {
    const end = '2027-10-01';
    expect(evaluateRebate(r, 150_000, end)).toMatchObject({
      status: 'MISSED',
      flagged: true,
      shortfall: 3000,
    });
    expect(evaluateRebate({ ...r, claimed: 2000 }, 150_000, end)).toMatchObject({
      status: 'UNDER_CLAIMED',
      flagged: true,
      shortfall: 1000,
    });
    expect(evaluateRebate({ ...r, claimed: 3000 }, 150_000, end)).toMatchObject({
      status: 'CLAIMED',
      flagged: false,
    });
    expect(evaluateRebate(r, 50_000, end)).toMatchObject({ status: 'NOT_EARNED', flagged: false });
  });
});

describe('FR-0510 and FR-0580 fixed and configured alerts', () => {
  it('raises each spend notice once, the fixed 80, 90 and 100 and the configured percentage', () => {
    expect(MANDATORY_SPEND_PCTS).toEqual([80, 90, 100]);
    expect(spendCrossings(75, 70, new Set()).map((c) => `${c.kind}:${c.threshold}`)).toEqual([
      'CONFIGURED:70',
    ]);
    expect(spendCrossings(91, 70, new Set()).map((c) => `${c.kind}:${c.threshold}`)).toEqual([
      'MANDATORY:80',
      'MANDATORY:90',
      'CONFIGURED:70',
    ]);
    expect(spendCrossings(91, 70, new Set(['MANDATORY:80', 'MANDATORY:90', 'CONFIGURED:70']))).toEqual([]);
  });

  it('counts down 180, 90 and 60 days before expiry and before the extension decision closes', () => {
    const none = countdownAlerts(
      { endDate: '2028-10-01', noticeDays: 90, hasExtensions: false },
      '2026-10-02',
    );
    expect(none.map((a) => a.triggerDate)).toEqual([
      addDays('2028-10-01', -180),
      addDays('2028-10-01', -90),
      addDays('2028-10-01', -60),
    ]);
    const some = countdownAlerts(
      { endDate: '2028-10-01', noticeDays: 90, hasExtensions: true },
      '2026-10-02',
    );
    expect(some).toHaveLength(5); // one date is shared by both countdowns
    expect(some.some((a) => a.note.includes('extension decision closes in 180 days'))).toBe(true);
    // dates already past are not scheduled
    expect(
      countdownAlerts({ endDate: '2026-12-01', noticeDays: 90, hasExtensions: false }, '2026-10-02'),
    ).toHaveLength(1);
  });

  it('warns 30 days before a certificate expires, and the fixed kinds are the countdown and the insurance warning', () => {
    expect(insuranceAlertDate('2027-03-31')).toBe('2027-03-01');
    expect([...MANDATORY_KINDS]).toEqual(['COUNTDOWN', 'INSURANCE']);
  });
});

describe('FR-0530 triggers read from clause wording', () => {
  const c = { startDate: '2026-10-02', endDate: '2028-10-01' };
  const clauses = (text: string) => [{ clauseId: 'TERMINATION', title: 'Termination', text }];

  it('turns a six-month termination notice into an alert a month before the last day to give it', () => {
    const [p] = extractTriggers(
      clauses("Either party may terminate on six months' written notice."),
      c,
      '2026-10-02',
    );
    expect(p!.triggerDate).toBe(addDays('2028-04-01', -30));
    expect(p!.summary).toContain('6 months of termination notice');
    expect(p!.quote.toLowerCase()).toContain('six months');
  });

  it('reads a notice in days, a review cycle and an annual obligation; ignores dates in the past', () => {
    const d = extractTriggers(clauses('Terminate on 90 days written notice.'), c, '2026-10-02');
    expect(d[0]!.triggerDate).toBe(addDays(addDays('2028-10-01', -90), -30));
    const cyc = extractTriggers(
      [{ clauseId: 'SLA', title: 'Service levels', text: 'Performance is reviewed every 6 months.' }],
      c,
      '2027-01-01',
    );
    expect(cyc[0]!.summary).toContain('every 6 months');
    expect(cyc[0]!.triggerDate >= '2027-01-01').toBe(true);
    const yearly = extractTriggers(
      [
        {
          clauseId: 'LIABILITY',
          title: 'Insurance',
          text: 'The supplier provides a current insurance certificate annually.',
        },
      ],
      c,
      '2026-10-02',
    );
    expect(yearly[0]!.summary).toContain('Annual obligation');
    expect(extractTriggers(clauses('Terminate on 90 days written notice.'), c, '2029-01-01')).toEqual([]);
    expect(extractTriggers(clauses('Nothing to see here.'), c, '2026-10-02')).toEqual([]);
  });
});

describe('FR-0535 and FR-0540 measuring a variation', () => {
  it('cumulative measures every variation against the original value; incremental measures this change alone', () => {
    const cum = measureVariation('CUMULATIVE', { original: 1_000_000, earlier: 50_000, value: 70_000 });
    expect(cum).toMatchObject({ variancePct: 12, authorityValue: 1_120_000, cumulativeValue: 1_120_000 });
    const inc = measureVariation('INCREMENTAL', { original: 1_000_000, earlier: 50_000, value: 70_000 });
    expect(inc.variancePct).toBe(6.67); // 70,000 against the 1,050,000 the contract stood at
    expect(inc.authorityValue).toBe(70_000);
    expect(inc.cumulativeValue).toBe(1_120_000);
  });
});

describe('FR-0555 plans scale with size, term and risk', () => {
  const facts = {
    value: 200_000,
    termMonths: 12,
    highValueAud: 1_000_000,
    supplierRisk: 'LOW' as const,
    insuranceCurrent: true,
    highDeviations: 0,
  };
  it('rates a small low-risk contract standard and a large or risky one higher, with the reasons', () => {
    expect(planTier(facts).tier).toBe('STANDARD');
    const big = planTier({ ...facts, value: 2_000_000 });
    expect(big.tier).toBe('ELEVATED');
    expect(big.reasons[0]).toContain('high-value line');
    const risky = planTier({
      ...facts,
      value: 2_000_000,
      termMonths: 48,
      supplierRisk: 'HIGH',
      highDeviations: 1,
    });
    expect(risky.tier).toBe('HIGH');
    expect(risky.reasons.length).toBeGreaterThanOrEqual(4);
  });
  it('generates more activities as the tier rises', () => {
    const c = { startDate: '2026-10-02', endDate: '2029-10-01', termMonths: 36 };
    const n = (t: 'STANDARD' | 'ELEVATED' | 'HIGH') => planActivities(t, c, '2026-10-02').length;
    expect(n('STANDARD')).toBeLessThan(n('ELEVATED'));
    expect(n('ELEVATED')).toBeLessThan(n('HIGH'));
    expect(planActivities('HIGH', c, '2026-10-02').some((a) => a.title.startsWith('Test the exit'))).toBe(
      true,
    );
    expect(planActivities('STANDARD', c, '2026-10-02').every((a) => a.dueDate >= '2026-10-02')).toBe(true);
  });
});

describe('FR-0560 next steps near the end date', () => {
  const f = {
    today: '2027-06-01',
    endDate: '2027-10-01',
    noticeDays: 90,
    extensionsTotal: 1,
    extensionsExercised: 0,
    nextExtensionMonths: 12,
    extensionProcurementOpen: false,
    renewalProcurementOpen: false,
    spendPct: 55,
    overdueActivities: 0,
    hold: false,
  };
  it('suggests deciding the extension before the notice date', () => {
    const s = nextSteps(f);
    expect(s[0]).toMatchObject({ action: 'EXTEND' });
    expect(s[0]!.text).toContain('2027-07-03');
  });
  it('suggests a renewal when no extension is left, and flags a hold and heavy spend first', () => {
    const s = nextSteps({ ...f, extensionsExercised: 1, spendPct: 93, hold: true });
    expect(s.map((x) => x.action)).toEqual(expect.arrayContaining(['RENEW', 'VARY', 'RESOLVE']));
    expect(s[0]!.priority).toBe('HIGH');
    expect(nextSteps({ ...f, endDate: '2029-10-01' })).toEqual([]);
  });
});

describe('FR-0585 funding envelope', () => {
  it('reports what is left and when to seek further approval', () => {
    expect(envelopeState(100_000, 70_000, 80)).toMatchObject({
      remaining: 30_000,
      usedPct: 70,
      nearing: false,
    });
    expect(envelopeState(100_000, 85_000, 80).nearing).toBe(true);
    expect(envelopeState(100_000, 100_000, 80)).toMatchObject({ exhausted: true, remaining: 0 });
  });
});
