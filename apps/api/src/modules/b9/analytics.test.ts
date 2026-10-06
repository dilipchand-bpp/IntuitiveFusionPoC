import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { BRIGHT, createEnv, type Json } from '../contract/test-env.js';
import {
  DEFAULT_ASSUMPTIONS,
  categoryMap,
  categoryOf,
  commitmentFor,
  consolidation,
  duplicateContracts,
  fyOf,
  priceVariance,
  rateCardOptimisation,
  rollup,
  spreadByFy,
  type ContractFact,
} from './analytics-rules.js';

const fact = (over: Partial<ContractFact> = {}): ContractFact => ({
  id: 'c1',
  number: 'CT-1',
  title: 'Cleaning',
  supplierId: 's1',
  supplier: 'Alpha',
  category: 'Cleaning',
  businessUnit: 'Facilities',
  costCentre: 'CC-1',
  ownerId: null,
  docType: 'CONTRACT',
  value: 120_000,
  spent: 0,
  start: '2026-07-01',
  end: '2028-06-30',
  hasRateCard: false,
  ...over,
});

describe('FR-0845 commitments by financial year (the arithmetic)', () => {
  it('names financial years and strips the code from a category', () => {
    expect([fyOf('2026-06-30'), fyOf('2026-07-01')]).toEqual([2026, 2027]);
    expect(categoryOf('Building cleaning (UNSPSC 76111500)')).toBe('Building cleaning');
    expect(categoryOf(null)).toBe('Uncategorised');
  });
  it('spreads an amount over the days, by financial year, and the parts add up', () => {
    const m = spreadByFy('2026-10-03', '2028-06-30', 120_000);
    expect(m.get(2027)).toBeCloseTo((120_000 * 271) / 637, 2);
    expect(m.get(2028)).toBeCloseTo((120_000 * 366) / 637, 2);
    expect([...m.values()].reduce((n, v) => n + v, 0)).toBeCloseTo(120_000, 6);
    expect(spreadByFy('2027-01-01', '2026-01-01', 5).size).toBe(0);
  });
  it('a fixed contract commits what remains, with no range', () => {
    const c = commitmentFor(fact({ spent: 20_000 }), [], '2026-10-02')!;
    expect(c.basis).toBe('FIXED');
    const [y1, y2] = c.years;
    expect(y1!.committed + y2!.committed).toBeCloseTo(100_000, 1);
    expect(y1).toMatchObject({ low: y1!.committed, high: y1!.committed, expected: y1!.committed });
    expect(c.unknowns).toEqual([]);
  });
  it('a contract that has ended, or has no dates, commits nothing', () => {
    expect(commitmentFor(fact({ end: '2026-09-01' }), [], '2026-10-02')).toBeNull();
    expect(commitmentFor(fact({ start: null }), [], '2026-10-02')).toBeNull();
  });
  it('a ceiling commits nothing firm: its range runs from the spend so far up to the maximum, and says so', () => {
    const c = commitmentFor(
      fact({ docType: 'MASTER', value: 500_000, spent: 50_000, start: '2026-07-01', end: '2027-06-30' }),
      [],
      '2026-10-02',
    )!;
    expect(c.basis).toBe('CEILING');
    const y = c.years[0]!;
    expect(y.committed).toBe(0);
    expect(y.high).toBeCloseTo(450_000, 0);
    expect(y.low).toBeGreaterThan(0);
    expect(y.low).toBeLessThanOrEqual(y.expected);
    expect(y.expected).toBeLessThanOrEqual(y.high);
    expect(c.unknowns.join(' ')).toMatch(/maximum aggregate spend/);
    // with no spend at all, the expected figure is stated as an assumption
    const none = commitmentFor(
      fact({ docType: 'MASTER', value: 100_000, spent: 0, end: '2027-06-30' }),
      [],
      '2026-10-02',
    )!;
    expect(none.unknowns.join(' ')).toMatch(/half of what remains/);
    expect(none.years[0]!.low).toBe(0);
  });
  it('a rate-card contract is a ceiling too', () => {
    expect(commitmentFor(fact({ hasRateCard: true }), [], '2026-10-02')!.basis).toBe('CEILING');
  });
  it('licences give a range of ten per cent either way, and say why', () => {
    const c = commitmentFor(
      fact({ title: 'Software licences', value: 100_000, end: '2027-06-30' }),
      [],
      '2026-10-02',
    )!;
    const y = c.years[0]!;
    expect(y.low).toBeCloseTo(y.committed * 0.9, 1);
    expect(y.high).toBeCloseTo(y.committed * 1.1, 1);
    expect(c.unknowns[0]).toMatch(/number of licences/);
  });
  it('an option to extend is counted only in the top of the range, in the years after the end', () => {
    const base = commitmentFor(
      fact({ value: 120_000, end: '2027-06-30', start: '2026-07-01' }),
      [],
      '2026-10-02',
    )!;
    const withOpt = commitmentFor(
      fact({ value: 120_000, end: '2027-06-30', start: '2026-07-01' }),
      [{ contractId: 'c1', months: 12, exercised: false }],
      '2026-10-02',
    )!;
    expect(withOpt.years.map((y) => y.committed)).toEqual(base.years.map((y) => y.committed));
    expect(withOpt.years[1]!.high).toBeGreaterThan(base.years[1]!.high);
    expect(withOpt.years[1]!.committed).toBe(0);
    expect(withOpt.unknowns.join(' ')).toMatch(/option to extend by 12 months/);
    // an exercised one is already in the end date
    expect(
      commitmentFor(
        fact({ end: '2027-06-30', start: '2026-07-01' }),
        [{ contractId: 'c1', months: 12, exercised: true }],
        '2026-10-02',
      )!.unknowns,
    ).toEqual([]);
  });
  it('adds contracts up by a key', () => {
    const a = commitmentFor(fact({ id: 'a', businessUnit: 'IT' }), [], '2026-10-02')!;
    const b = commitmentFor(fact({ id: 'b', businessUnit: 'IT' }), [], '2026-10-02')!;
    const c = commitmentFor(fact({ id: 'c', businessUnit: 'Facilities' }), [], '2026-10-02')!;
    const rows = rollup([a, b, c], 'businessUnit');
    expect(rows.map((r) => r.key)).toEqual(['Facilities', 'IT']);
    expect(rows[1]!.years[0]!.committed).toBeCloseTo(a.years[0]!.committed * 2, 2);
  });
});

describe('FR-0840 spend optimisation (the rules)', () => {
  const cs = [
    fact({ id: 'a', number: 'CT-A', supplierId: 's1', supplier: 'Alpha', value: 240_000 }),
    fact({ id: 'b', number: 'CT-B', supplierId: 's2', supplier: 'Beta', value: 120_000 }),
    fact({
      id: 'c',
      number: 'CT-C',
      supplierId: 's1',
      supplier: 'Alpha',
      title: 'Cleaning north',
      value: 60_000,
      start: '2026-09-01',
      end: '2027-08-31',
    }),
    fact({
      id: 'd',
      number: 'CT-D',
      supplierId: 's3',
      supplier: 'Gamma',
      category: 'Landscaping',
      title: 'Grounds',
      value: 100_000,
      start: '2026-07-01',
      end: '2027-06-30',
    }),
  ];
  it('finds categories with several suppliers and estimates the saving from stated assumptions', () => {
    const r = consolidation(cs, DEFAULT_ASSUMPTIONS);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ category: 'Cleaning', lead: 'Alpha' });
    expect(r[0]!.addressable).toBeCloseTo(60_000, 0);
    expect(r[0]!.estimatedSaving).toBeCloseTo(4_800, 0);
  });
  it('flags the same supplier on overlapping contracts for the same category', () => {
    const d = duplicateContracts(cs);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ supplier: 'Alpha' });
    expect(d[0]!.overlapDays).toBeGreaterThan(300);
    expect(duplicateContracts([cs[0]!, { ...cs[2]!, start: '2029-01-01', end: '2029-06-01' }])).toEqual([]);
  });
  const rates = [
    {
      contractId: 'a',
      supplierId: 's1',
      supplier: 'Alpha',
      item: 'Cleaning hour',
      unit: 'hour',
      unitPrice: 50,
    },
    {
      contractId: 'b',
      supplierId: 's2',
      supplier: 'Beta',
      item: 'cleaning hour',
      unit: 'hour',
      unitPrice: 58,
    },
  ];
  const lines = [
    {
      contractId: 'a',
      supplierId: 's1',
      supplier: 'Alpha',
      item: 'Cleaning hour',
      qty: 100,
      unitPrice: 50,
      date: '2026-08-15',
      status: 'MATCHED',
    },
    {
      contractId: 'a',
      supplierId: 's1',
      supplier: 'Alpha',
      item: 'Cleaning hour',
      qty: 100,
      unitPrice: 58,
      date: '2026-09-10',
      status: 'BLOCKED',
    },
    {
      contractId: 'b',
      supplierId: 's2',
      supplier: 'Beta',
      item: 'Cleaning hour',
      qty: 200,
      unitPrice: 58,
      date: '2026-09-01',
      status: 'MATCHED',
    },
  ];
  const numbers = new Map([
    ['a', 'CT-A'],
    ['b', 'CT-B'],
  ]);
  it('compares rates for the same item across contracts and prices what was bought dearer', () => {
    const g = rateCardOptimisation(rates, lines, numbers, '2026-10-02');
    expect(g).toHaveLength(1);
    expect(g[0]!.lowest).toMatchObject({ supplier: 'Alpha', unitPrice: 50 });
    expect(g[0]!.others[0]).toMatchObject({ supplier: 'Beta', gapPct: 16 });
    expect(g[0]!.estimatedSaving).toBe(1_600); // 200 hours at 8 more; the blocked invoice is not counted
    expect(rateCardOptimisation([rates[0]!], lines, numbers, '2026-10-02')).toEqual([]);
  });
  it('flags invoice prices off the contract rate (a blocked one as stopped), and a price that drifts', () => {
    const v = priceVariance(rates, lines, numbers, DEFAULT_ASSUMPTIONS);
    const off = v.find((x) => x.kind === 'VS_CONTRACT_RATE')!;
    expect(off).toMatchObject({ blocked: true, variancePct: 16, impact: 800, supplier: 'Alpha' });
    expect(v.filter((x) => x.kind === 'DRIFT')).toEqual([]);
    const drift = priceVariance(
      [],
      [
        { ...lines[0]!, unitPrice: 50, date: '2026-01-01' },
        { ...lines[0]!, unitPrice: 60, date: '2026-06-01' },
      ],
      numbers,
      DEFAULT_ASSUMPTIONS,
    );
    expect(drift[0]).toMatchObject({ kind: 'DRIFT', variancePct: 20, blocked: false });
  });
  it('maps each category to the one thing to do about it', () => {
    const m = categoryMap(cs, new Map(), '2026-10-02');
    expect(m.find((x) => x.category === 'Cleaning')!.signal).toBe('MONITOR'); // two suppliers, nothing ending soon
    expect(
      categoryMap([fact({ end: '2026-12-31' })], new Map([['Cleaning', 2]]), '2026-10-02')[0]!.signal,
    ).toBe('RENEGOTIATE');
    const land = m.find((x) => x.category === 'Landscaping')!;
    expect(land).toMatchObject({ suppliers: 1, topSupplierSharePct: 100, tenders: 0, signal: 'MARKET_TEST' });
    expect(land.why).toMatch(/never/);
    expect(
      categoryMap(cs, new Map([['Landscaping', 3]]), '2026-10-02').find((x) => x.category === 'Landscaping')!
        .signal,
    ).not.toBe('MARKET_TEST');
    const three = categoryMap(
      [...cs, fact({ id: 'e', supplierId: 's9', supplier: 'Delta' })],
      new Map(),
      '2026-10-02',
    ).find((x) => x.category === 'Cleaning')!;
    expect(three.signal).toBe('CONSOLIDATE');
  });
});

// ------------------------------------------------------------------ through the API, from the separate store
let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

let seq = 0;
/** An executed contract (and the request and tender behind it) inserted directly, with optional rates, invoices and options. */
async function contractOf(o: {
  supplierId?: string;
  category: string;
  businessUnit?: string;
  costCentre?: string;
  value: number;
  start?: string;
  end?: string;
  title?: string;
  docType?: 'CONTRACT' | 'MASTER';
  owner?: string | null;
  rates?: Array<{ item: string; unitPrice: number }>;
  lines?: Array<{
    item: string;
    qty: number;
    unitPrice: number;
    date: string;
    status: 'MATCHED' | 'BLOCKED' | 'PAID';
  }>;
  extension?: number;
}) {
  seq += 1;
  return sys<{ id: string; number: string }>(async (tx) => {
    const [r] = await tx
      .insert(s.request)
      .values({
        tenantId: TENANT_ID,
        number: `PR-AN-${seq}`,
        title: `Analytics ${seq}`,
        category: o.category,
        businessUnit: o.businessUnit ?? 'Facilities',
        estimatedValue: String(o.value),
        requesterId: uid('user:requester'),
        phase: 'CONTRACT_MGMT',
        status: 'IN_PROGRESS',
      })
      .returning();
    if (o.costCentre)
      await tx.insert(s.fieldValue).values({
        tenantId: TENANT_ID,
        ownerType: 'REQUEST',
        ownerId: r!.id,
        key: 'costCentre',
        label: 'Cost centre',
        value: o.costCentre,
      });
    const [t] = await tx
      .insert(s.tender)
      .values({ tenantId: TENANT_ID, requestId: r!.id, type: 'RFP', status: 'AWARDED' })
      .returning();
    const [c] = await tx
      .insert(s.contract)
      .values({
        tenantId: TENANT_ID,
        number: `CT-AN-${seq}`,
        tenderId: t!.id,
        supplierId: o.supplierId ?? BRIGHT,
        status: 'EXECUTED',
        value: String(o.value),
        startDate: o.start ?? '2026-07-01',
        endDate: o.end ?? '2028-06-30',
        locked: true,
        ownerId: o.owner === undefined ? null : o.owner,
        docType: o.docType ?? 'CONTRACT',
        title: o.title ?? `Contract ${seq}`,
      })
      .returning();
    for (const rt of o.rates ?? [])
      await tx
        .insert(s.contractRate)
        .values({ tenantId: TENANT_ID, contractId: c!.id, item: rt.item, unitPrice: String(rt.unitPrice) });
    let n = 0;
    for (const l of o.lines ?? []) {
      n += 1;
      await tx.insert(s.invoice).values({
        tenantId: TENANT_ID,
        contractId: c!.id,
        number: `INV-AN-${seq}-${n}`,
        invoiceDate: l.date,
        amount: String(l.qty * l.unitPrice),
        lines: [{ item: l.item, qty: l.qty, unitPrice: l.unitPrice }],
        status: l.status,
        createdBy: uid('user:finance'),
        createdAt: new Date(`${l.date}T00:00:00Z`),
      });
    }
    if (o.extension)
      await tx
        .insert(s.contractExtension)
        .values({ tenantId: TENANT_ID, contractId: c!.id, months: o.extension, position: 1 });
    return { id: c!.id, number: c!.number };
  });
}
const supplierOf = (company: string, abn: string) =>
  sys<string>(
    async (tx) =>
      (
        await tx
          .insert(s.supplier)
          .values({ tenantId: TENANT_ID, company, abn, createdAt: new Date() })
          .returning()
      )[0]!.id,
  );

describe('NFR-P05 reports run on a separate analytics store', () => {
  it('a report reads the copy: a contract added afterwards does not appear until the copy is rebuilt, and every answer says how old it is', async () => {
    const t0 = env.clock.now();
    const first = await contractOf({
      category: 'Facilities (UNSPSC 1)',
      value: 120_000,
      costCentre: 'CC-100',
      title: 'First',
    });
    const a = (await call('finance', 'GET', '/reports/future-commitment')).json() as Json;
    expect(a.contracts.map((c: Json) => c.number)).toContain(first.number);
    expect(a.asOf).toBe(t0.toISOString());
    const late = await contractOf({ category: 'Facilities (UNSPSC 1)', value: 90_000, title: 'Late' });
    const b = (await call('finance', 'GET', '/reports/future-commitment')).json() as Json;
    expect(b.contracts.map((c: Json) => c.number)).not.toContain(late.number); // the main database has it; the copy does not yet
    expect((await call('requester', 'POST', '/analytics/refresh')).statusCode).toBe(403);
    const refreshed = await call('finance', 'POST', '/analytics/refresh');
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(refreshed.json().rows.fact_contract).toBeGreaterThanOrEqual(2);
    const c = (await call('finance', 'GET', '/reports/future-commitment')).json() as Json;
    expect(c.contracts.map((x: Json) => x.number)).toContain(late.number);
    // and a copy older than the tenant's limit is rebuilt by the next report
    const third = await contractOf({ category: 'Facilities (UNSPSC 1)', value: 80_000, title: 'Third' });
    env.clock.advanceMs(16 * 60_000);
    expect(
      ((await call('finance', 'GET', '/reports/future-commitment')).json() as Json).contracts.map(
        (x: Json) => x.number,
      ),
    ).toContain(third.number);
    const st = (await call('exec', 'GET', '/analytics/status')).json() as Json;
    expect(st).toMatchObject({ refreshEveryMinutes: 15 });
    expect(st.readsFromIt).toContain('Spend optimisation');
    env.clock.set(t0);
  });
});

describe('FR-0845 future commitment, through the API', () => {
  it('splits by business unit and cost centre with the arithmetic checked, states its unknowns, and is closed to people who may not see spend', async () => {
    const fixed = await contractOf({
      category: 'IT services (UNSPSC 2)',
      businessUnit: 'IT',
      costCentre: 'CC-200',
      value: 120_000,
      title: 'Fixed IT',
    });
    const ceiling = await contractOf({
      category: 'IT services (UNSPSC 2)',
      businessUnit: 'IT',
      costCentre: 'CC-200',
      value: 500_000,
      docType: 'MASTER',
      end: '2027-06-30',
      extension: 12,
      title: 'Master IT',
    });
    await call('finance', 'POST', '/analytics/refresh');
    const r = (await call('finance', 'GET', '/reports/future-commitment?by=businessUnit')).json() as Json;
    expect(r.years).toHaveLength(4);
    const f = r.contracts.find((c: Json) => c.number === fixed.number);
    expect(f.basis).toBe('FIXED');
    expect(f.years[0].committed).toBeCloseTo((120_000 * 271) / 637, 0);
    expect(f.years[0].committed + f.years[1].committed).toBeCloseTo(120_000, 0);
    const m = r.contracts.find((c: Json) => c.number === ceiling.number);
    expect(m.basis).toBe('CEILING');
    expect(m.years[0].committed).toBe(0);
    expect(m.years[0].high).toBeGreaterThan(m.years[0].expected);
    expect(m.unknowns.join(' ')).toMatch(/maximum aggregate spend/);
    expect(m.unknowns.join(' ')).toMatch(/option to extend by 12 months/);
    // the option is counted in the year after the end, in the top of the range only
    expect(m.years[1].high).toBeGreaterThan(0);
    expect(m.years[1].committed).toBe(0);
    const it = r.rows.find((x: Json) => x.key === 'IT');
    expect(it.years[0].committed).toBeCloseTo(f.years[0].committed, 0);
    expect(it.years[0].high).toBeCloseTo(f.years[0].high + m.years[0].high, 0);
    expect(r.stated).toHaveLength(3);

    const cc = (await call('finance', 'GET', '/reports/future-commitment?by=costCentre')).json() as Json;
    expect(cc.rows.map((x: Json) => x.key)).toEqual(
      expect.arrayContaining(['CC-200', 'CC-100', 'Not recorded']),
    );
    for (const who of ['requester', 'evaluator-tech', 'supplier', 'probity'])
      expect((await call(who, 'GET', '/reports/future-commitment')).statusCode, who).toBe(403);
    expect((await call('finance', 'GET', '/reports/future-commitment?years=20')).statusCode).toBe(400);
  });

  it('a contract manager sees only the contracts they own', async () => {
    const mine = await contractOf({
      category: 'Own (UNSPSC 3)',
      value: 60_000,
      owner: uid('user:contract-mgr'),
      title: 'Mine',
    });
    const theirs = await contractOf({
      category: 'Own (UNSPSC 3)',
      value: 70_000,
      owner: uid('user:legal'),
      title: 'Theirs',
    });
    await call('finance', 'POST', '/analytics/refresh');
    const nums = (
      (await call('contract-mgr', 'GET', '/reports/future-commitment')).json() as Json
    ).contracts.map((c: Json) => c.number);
    expect(nums).toContain(mine.number);
    expect(nums).not.toContain(theirs.number);
    expect(
      ((await call('exec', 'GET', '/reports/future-commitment')).json() as Json).contracts.map(
        (c: Json) => c.number,
      ),
    ).toContain(theirs.number);
  });
});

describe('FR-0840 spend optimisation, through the API', () => {
  it('finds consolidation, duplicate contracts, rate gaps, price variance and category opportunities from the invoices and rate cards', async () => {
    const zeta = await supplierOf('Zeta Facilities Pty Ltd', '88888888888');
    const A = await contractOf({
      category: 'Cleaning ops (UNSPSC 4)',
      value: 240_000,
      rates: [{ item: 'Ops hour', unitPrice: 50 }],
      lines: [
        { item: 'Ops hour', qty: 100, unitPrice: 50, date: '2026-08-15', status: 'MATCHED' },
        { item: 'Ops hour', qty: 100, unitPrice: 58, date: '2026-09-10', status: 'BLOCKED' },
      ],
    });
    await contractOf({
      category: 'Cleaning ops (UNSPSC 4)',
      value: 120_000,
      supplierId: zeta,
      rates: [{ item: 'Ops hour', unitPrice: 58 }],
      lines: [{ item: 'Ops hour', qty: 200, unitPrice: 58, date: '2026-09-01', status: 'MATCHED' }],
    });
    const dup = await contractOf({
      category: 'Cleaning ops (UNSPSC 4)',
      value: 60_000,
      start: '2026-09-01',
      end: '2027-08-31',
      title: 'Ops north',
    });
    await contractOf({
      category: 'Grounds ops (UNSPSC 5)',
      value: 100_000,
      supplierId: zeta,
      start: '2026-07-01',
      end: '2027-06-30',
      title: 'Grounds',
    });
    await call('finance', 'POST', '/analytics/refresh');
    const o = (await call('exec', 'GET', '/reports/optimisation')).json() as Json;
    expect(o.assumptions).toMatchObject({
      consolidationPct: 8,
      varianceThresholdPct: 5,
      driftThresholdPct: 10,
    });
    const cons = o.consolidation.find((c: Json) => c.category === 'Cleaning ops');
    expect(cons.suppliers.map((x: Json) => x.supplier)).toEqual(
      expect.arrayContaining(['Zeta Facilities Pty Ltd']),
    );
    expect(cons.estimatedSaving).toBeGreaterThan(0);
    expect(
      o.duplicates.some(
        (d: Json) =>
          [d.a.number, d.b.number].includes(dup.number) && [d.a.number, d.b.number].includes(A.number),
      ),
    ).toBe(true);
    const gap = o.rateCards.find((g: Json) => g.item === 'Ops hour');
    expect(gap.lowest.unitPrice).toBe(50);
    expect(gap.others[0]).toMatchObject({ unitPrice: 58, gapPct: 16 });
    expect(gap.estimatedSaving).toBe(1_600);
    const stopped = o.variance.find((v: Json) => v.kind === 'VS_CONTRACT_RATE' && v.blocked);
    expect(stopped).toMatchObject({ impact: 800, variancePct: 16 });
    expect(o.summary.overchargesStopped).toBeGreaterThanOrEqual(800);
    const grounds = o.categories.find((c: Json) => c.category === 'Grounds ops');
    expect(grounds).toMatchObject({ suppliers: 1, signal: 'MARKET_TEST' });
    // the assumptions can be changed, and the answer follows
    await call('admin', 'PUT', '/admin/settings', {
      analytics: { refreshMinutes: 15, consolidationPct: 16, varianceThresholdPct: 5, driftThresholdPct: 10 },
    });
    const o2 = (await call('exec', 'GET', '/reports/optimisation')).json() as Json;
    expect(o2.consolidation.find((c: Json) => c.category === 'Cleaning ops').estimatedSaving).toBeCloseTo(
      cons.estimatedSaving * 2,
      0,
    );
    for (const who of ['requester', 'supplier', 'legal'])
      expect((await call(who, 'GET', '/reports/optimisation')).statusCode, who).toBe(403);
  });
});

describe('the analytics store holds a copy, never the working data', () => {
  it('is rebuilt from the main database without changing it', async () => {
    const before = await sys<Json[]>((tx) =>
      tx.select().from(s.contract).where(eq(s.contract.tenantId, TENANT_ID)),
    );
    await call('finance', 'POST', '/analytics/refresh');
    const after = await sys<Json[]>((tx) =>
      tx.select().from(s.contract).where(eq(s.contract.tenantId, TENANT_ID)),
    );
    expect(after.map((c) => [c.id, c.version])).toEqual(before.map((c) => [c.id, c.version]));
  });
});
