import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import {
  ERP_PROVIDERS,
  canonicalDataset,
  fetchErpSource,
  financialYearOf,
  mapDynamics,
  mapErp,
  mapOracle,
  mapSap,
  validateNormalised,
  type ErpProvider,
  type Normalised,
} from './erp-source.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const putConnector = async (body: Json) => {
  const r = await call('admin', 'PUT', '/connectors/ERP', body);
  expect(r.statusCode, r.body).toBe(200);
};
const sync = async (body: Json = {}, who = 'finance') => {
  const r = await call(who, 'POST', '/erp/sync', body);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
const overview = async () => (await call('finance', 'GET', '/erp/overview')).json() as Json;

/** A shape-free view of what a mapper produced: codes and values, never provider keys. */
function plain(n: Normalised) {
  const code = new Map(n.costCentres.map((k) => [k.externalId, k.code]));
  const org = new Map(n.orgUnits.map((o) => [o.externalId, o.name]));
  return {
    orgs: n.orgUnits.map((o) => o.name).sort(),
    centres: n.costCentres
      .map((k) => `${k.code}|${k.name}|${org.get(k.orgUnitExternalId ?? '')}|${k.ownerName}|${k.active}`)
      .sort(),
    budgets: n.budgets
      .map(
        (b) =>
          `${code.get(b.costCentreExternalId)}|${b.financialYear}|${b.category}|${b.amount}|${b.currency}`,
      )
      .sort(),
    ledger: n.ledger
      .map(
        (l) =>
          `${code.get(l.costCentreExternalId)}|${l.postingDate}|${l.financialYear}|${l.account}|${l.amount}|${l.kind}`,
      )
      .sort(),
  };
}

describe('NFR-C02 the three ERP mappers (SAP, Oracle, Dynamics) normalise different shapes', () => {
  it('each provider uses its own field names, dates and money formats', async () => {
    const sap = (await fetchErpSource('SAP', 1)) as Json;
    const ora = (await fetchErpSource('ORACLE', 1)) as Json;
    const dyn = (await fetchErpSource('DYNAMICS', 1)) as Json;
    // SAP: abbreviated German fields, YYYYMMDD dates, money as formatted text, padded cost centre keys
    expect(sap.COST_CENTERS[0]).toMatchObject({ KOSTL: '0000FAC100', KTEXT: 'Facilities Operations' });
    expect(sap.LEDGER[0].BUDAT).toMatch(/^\d{8}$/);
    expect(sap.BUDGET[1].WTGES).toMatch(/^[\d,]+\.\d{2}$/);
    // Oracle: REST collections, numeric ids, ISO dates, money in minor units, debit and credit
    expect(ora.costCenters.items[0]).toMatchObject({
      CostCenterCode: 'FAC-100',
      CostCenterId: expect.any(Number),
    });
    expect(ora.budgets.items[1].BudgetAmountMinor).toBe(120_000_000);
    expect(ora.journals.items[0]).toHaveProperty('EnteredDr');
    // Dynamics: OData value collections, dimension values, ISO timestamps, suspension flags
    expect(dyn.LedgerDimensionValues.value[0]).toMatchObject({
      DimensionValue: 'FAC-100',
      IsSuspended: false,
    });
    expect(dyn.GeneralJournalAccountEntries.value[0].AccountingDate).toMatch(/T00:00:00Z$/);
    // no field name is shared between the three payloads
    expect(Object.keys(sap)).not.toEqual(Object.keys(ora));
    expect(Object.keys(ora)).not.toEqual(Object.keys(dyn));
  });

  it('SAP mapper: reads formatted money, YYYYMMDD dates, lock and deletion flags', async () => {
    const n = mapSap((await fetchErpSource('SAP', 3)) as never);
    expect(validateNormalised(n)).toEqual([]);
    const fac = n.costCentres.find((k) => k.code === 'FAC-100')!;
    expect(fac).toMatchObject({ externalId: '0000FAC100', name: 'Facilities Operations', active: true });
    expect(n.costCentres.find((k) => k.code === 'FIN-100')!.active).toBe(false); // LOCK_ALL = X at revision 3
    const b = n.budgets.find((x) => x.financialYear === 'FY2027' && x.costCentreExternalId === '0000FAC100')!;
    expect(b).toMatchObject({ amount: 1_350_000, category: 'OPEX', currency: 'AUD' }); // revision 2 raised it
    const l = n.ledger.find((x) => x.externalId === 'L-FAC-100-2026-1')!;
    expect(l).toMatchObject({
      postingDate: '2026-07-31',
      financialYear: 'FY2027',
      kind: 'ACTUAL',
      amount: 48_000,
    });
    expect(n.ledger.find((x) => x.externalId === 'L-FAC-100-2026-C1')!.kind).toBe('COMMITMENT');
  });

  it('Oracle mapper: reads minor units, debit less credit, fiscal-year codes and the enabled flag', async () => {
    const raw = (await fetchErpSource('ORACLE', 1)) as Json;
    const n = mapOracle(raw as never);
    expect(validateNormalised(n)).toEqual([]);
    const k = n.costCentres.find((x) => x.code === 'IT-100')!;
    expect(k.externalId).toMatch(/^4000\d\d$/);
    expect(n.budgets.find((x) => x.category === 'CAPEX')).toMatchObject({
      financialYear: 'FY2027',
      amount: 500_000,
    });
    // credits reduce an amount: a posting with a credit nets down
    raw.journals.items[0].EnteredCr = 1_000_00;
    const credited = mapOracle(raw as never);
    expect(credited.ledger[0]!.amount).toBe(n.ledger[0]!.amount - 1000);
    raw.costCenters.items[0].EnabledFlag = false;
    expect(mapOracle(raw as never).costCentres[0]!.active).toBe(false);
  });

  it('Dynamics mapper: reads OData collections, dimension values and posting layers', async () => {
    const n = mapDynamics((await fetchErpSource('DYNAMICS', 1)) as never);
    expect(validateNormalised(n)).toEqual([]);
    expect(n.costCentres.find((k) => k.code === 'EXE-100')).toMatchObject({
      externalId: 'EXE-100',
      ownerName: 'Elena Petrova',
    });
    expect(n.orgUnits.find((o) => o.externalId === 'MER')!.parentExternalId).toBeNull();
    expect(n.ledger.filter((l) => l.kind === 'COMMITMENT')).toHaveLength(11); // PostingLayer Encumbrance
    expect(n.budgets[0]!.financialYear).toBe('FY2026');
  });

  it('all three mappers give the same business content for the same synthetic ERP, at every revision', async () => {
    for (const rev of [1, 2, 3]) {
      const out: Record<string, ReturnType<typeof plain>> = {};
      for (const p of ERP_PROVIDERS) out[p] = plain(mapErp(p, (await fetchErpSource(p, rev)) as never));
      expect(out.ORACLE!.centres, `rev ${rev} oracle`).toEqual(out.SAP!.centres);
      expect(out.DYNAMICS!.centres, `rev ${rev} dynamics`).toEqual(out.SAP!.centres);
      expect(out.ORACLE!.budgets).toEqual(out.SAP!.budgets);
      expect(out.DYNAMICS!.budgets).toEqual(out.SAP!.budgets);
      expect(out.ORACLE!.ledger).toEqual(out.SAP!.ledger);
      expect(out.DYNAMICS!.ledger).toEqual(out.SAP!.ledger);
      expect(out.ORACLE!.orgs.slice().sort()).toEqual(out.SAP!.orgs.slice().sort());
      expect(out.SAP!.centres.length).toBeGreaterThanOrEqual(11);
    }
  });

  it('is deterministic, names the financial year from the posting date, and the revisions differ as described', async () => {
    expect(JSON.stringify(await fetchErpSource('SAP', 2))).toBe(
      JSON.stringify(await fetchErpSource('SAP', 2)),
    );
    expect(financialYearOf('2026-06-30')).toBe('FY2026');
    expect(financialYearOf('2026-07-01')).toBe('FY2027');
    const r1 = canonicalDataset(1);
    const r2 = canonicalDataset(2);
    expect(r1.centres.some((c) => c.code === 'OPS-200')).toBe(true);
    expect(r2.centres.some((c) => c.code === 'OPS-200')).toBe(false);
    expect(r2.centres.some((c) => c.code === 'FAC-300')).toBe(true);
  });

  it('a payload that repeats an id is refused before anything is imported', () => {
    const n = mapSap({
      ORG_UNITS: [{ ORGEH: 'A' }, { ORGEH: 'A' }],
      COST_CENTERS: [],
      BUDGET: [],
      LEDGER: [],
    });
    expect(validateNormalised(n)).toContain('organisation units has a repeated external id');
  });
});

describe('NFR-C02 ERP sync: upsert by external id, idempotent, changes reported', () => {
  it('the first run imports everything and is recorded in the generic sync runs', async () => {
    const before = await overview();
    expect(before.costCentres).toHaveLength(0);
    expect(before.connector).toMatchObject({ provider: 'SIMULATED_ERP', mode: 'UP' });
    const r = await sync();
    expect(r).toMatchObject({ ok: true, status: 'OK', provider: 'SAP', revision: 1, simulated: true });
    expect(r.counts.costCentres).toMatchObject({ added: 11, changed: 0, removed: 0, unchanged: 0 });
    expect(r.counts.orgUnits.added).toBe(9);
    expect(r.counts.budgets.added).toBe(23);
    expect(r.counts.ledger.added).toBe(44);
    const ov = await overview();
    expect(ov.costCentres).toHaveLength(11);
    expect(ov.lastRun).toMatchObject({ status: 'OK', provider: 'SAP', revision: 1 });
    const runs = (await call('finance', 'GET', '/connectors/sync-runs?kind=ERP')).json() as Json[];
    expect(runs[0]).toMatchObject({
      connector: 'ERP',
      direction: 'IN',
      status: 'OK',
      expected: 87,
      received: 87,
    });
  });

  it('a second run changes nothing: every record is reported as unchanged', async () => {
    const r = await sync();
    for (const k of ['costCentres', 'orgUnits', 'budgets', 'ledger'])
      expect(r.counts[k], k).toMatchObject({ added: 0, changed: 0, removed: 0 });
    expect(r.totals).toMatchObject({ added: 0, changed: 0, removed: 0, unchanged: 87 });
    const rows = await sys<unknown[]>((tx) => tx.select().from(s.costCentre));
    expect(rows).toHaveLength(11); // no duplicates
  });

  it('a dry run shows what would change and writes nothing, not even the source revision', async () => {
    const dry = await sync({ dryRun: true, revision: 2 });
    expect(dry).toMatchObject({ dryRun: true, ok: true, syncRunId: null });
    expect(dry.counts.budgets).toMatchObject({ changed: 1, added: 2, removed: 2 });
    const ov = await overview();
    expect(ov.connector.simulatedRevision).toBe(1);
    expect(ov.costCentres.find((c: Json) => c.code === 'OPS-200')).toBeTruthy();
    const again = await sync();
    expect(again.totals).toMatchObject({ added: 0, changed: 0, removed: 0 });
  });

  it('changes at the source are applied and counted as added, changed and removed (revision 2)', async () => {
    const r = await sync({ revision: 2 });
    expect(r.counts.costCentres).toMatchObject({ added: 1, changed: 1, removed: 1 });
    expect(r.counts.budgets).toMatchObject({ added: 2, changed: 1, removed: 2 });
    expect(r.counts.ledger).toMatchObject({ added: 5, changed: 0, removed: 4 });
    const ov = await overview();
    const codes = ov.costCentres.map((c: Json) => c.code);
    expect(codes).toContain('FAC-300');
    expect(codes).not.toContain('OPS-200'); // retired, not shown
    expect(ov.costCentres.find((c: Json) => c.code === 'PRC-100').name).toBe(
      'Procurement and Contracts Office',
    );
    expect(ov.costCentres.find((c: Json) => c.code === 'FAC-100').budget).toBe(1_350_000);
    // the retired record is kept (soft removal), not deleted
    const kept = await sys<Json[]>((tx) =>
      tx.select().from(s.costCentre).where(eq(s.costCentre.code, 'OPS-200')),
    );
    expect(kept[0]!.removedAt).toBeTruthy();
    const history = (await call('exec', 'GET', '/erp/history')).json() as Json[];
    expect(history.map((h) => h.revision)).toEqual(expect.arrayContaining([1, 2]));
  });

  it('a record that comes back at the source is restored, and a suspension is a change (revision 3)', async () => {
    const r = await sync({ revision: 3 });
    expect(r.counts.costCentres).toMatchObject({ added: 1, changed: 1, removed: 0 });
    expect(r.counts.budgets.added).toBe(2);
    expect(r.counts.ledger.added).toBe(4);
    const ov = await overview();
    expect(ov.costCentres.find((c: Json) => c.code === 'OPS-200')).toBeTruthy();
    expect(ov.costCentres.find((c: Json) => c.code === 'FIN-100').active).toBe(false);
    const selectable = (await call('requester', 'GET', '/erp/cost-centres')).json() as Json[];
    expect(selectable.map((c) => c.code)).toContain('FAC-100');
    expect(selectable.map((c) => c.code)).not.toContain('FIN-100'); // suspended cost centres cannot be chosen
  });

  it('the provider comes from the ERP connector: switching to Oracle and Dynamics maps the same business data', async () => {
    for (const provider of ['ORACLE', 'DYNAMICS'] as ErpProvider[]) {
      await putConnector({ provider });
      const r = await sync({ revision: 1 });
      expect(r).toMatchObject({ ok: true, provider });
      // different native keys: the old records are retired and the new ones added, so the data is never doubled
      expect(r.counts.costCentres.added).toBe(11);
      expect(r.counts.costCentres.removed).toBeGreaterThan(0);
      const ov = await overview();
      expect(ov.costCentres).toHaveLength(11);
      const fac = ov.costCentres.find((c: Json) => c.code === 'FAC-100');
      expect(fac.externalId).toBe(provider === 'ORACLE' ? '400001' : 'FAC-100');
      expect(fac.budget).toBe(1_200_000);
    }
    await putConnector({ provider: 'SAP' });
    expect((await sync({ revision: 1 })).provider).toBe('SAP');
  });

  it('a procurement platform in the ERP slot is refused: it is not an ERP feed', async () => {
    await putConnector({ provider: 'COUPA' });
    const r = await call('finance', 'POST', '/erp/sync', {});
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('UNSUPPORTED_PROVIDER');
    await putConnector({ provider: 'SAP' });
  });

  it('only administrators and finance run it; procurement and executives only read', async () => {
    expect((await call('procurement', 'POST', '/erp/sync', {})).statusCode).toBe(403);
    expect((await call('exec', 'POST', '/erp/sync', {})).statusCode).toBe(403);
    for (const who of ['admin', 'finance', 'procurement', 'exec'])
      expect((await call(who, 'GET', '/erp/overview')).statusCode, who).toBe(200);
    for (const who of ['requester', 'legal', 'supplier'])
      expect((await call(who, 'GET', '/erp/overview')).statusCode, who).toBe(403);
    expect((await call('finance', 'GET', '/erp/ledger?costCentre=FAC-100&limit=10')).json()).toHaveLength(4);
    const audit = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.tenantId, TENANT_ID), eq(s.auditEvent.action, 'erp.sync'))),
    );
    expect(audit.length).toBeGreaterThanOrEqual(6);
  });
});

describe('NFR-C02 the budget check prefers an imported ERP budget line and shows its source', () => {
  it('uses the imported budget for the unit (and says so); the tenant settings would have cleared it', async () => {
    // Facilities: budget 1.8M less 279,000 posted and committed = 1,521,000; the tenant settings say 2,000,000
    const ok = await call('requester', 'POST', '/erp/budget-check', {
      businessUnit: 'Facilities',
      amount: 1_000_000,
    });
    expect(ok.json()).toMatchObject({ status: 'CLEARED', available: 1_521_000, simulated: true });
    expect(ok.json().source).toMatchObject({
      kind: 'ERP_IMPORT',
      provider: 'SAP',
      financialYear: 'FY2027',
      costCentres: ['FAC-100', 'FAC-200'],
    });
    expect(ok.json().source.label).toMatch(/SAP S\/4HANA budget for FY2027/);
    const over = await call('requester', 'POST', '/erp/budget-check', {
      businessUnit: 'Facilities',
      amount: 1_700_000,
    });
    expect(over.json()).toMatchObject({ status: 'EXCEEDED', available: 1_521_000 });
  });

  it('a cost centre can be chosen directly', async () => {
    const r = await call('finance', 'POST', '/erp/budget-check', { costCentre: 'it-100', amount: 3_000_000 });
    // 3.0M OPEX + 0.5M CAPEX less 465,000
    expect(r.json()).toMatchObject({ status: 'CLEARED', available: 3_035_000 });
    expect(r.json().source.costCentres).toEqual(['IT-100']);
    expect((await call('finance', 'POST', '/erp/budget-check', { amount: 5 })).statusCode).toBe(400);
  });

  it('falls back to the existing logic for a unit with nothing imported, and says the settings answered', async () => {
    const r = await call('requester', 'POST', '/erp/budget-check', {
      businessUnit: 'Legal',
      amount: 100_000,
    });
    expect(r.json().source.kind).toBe('ERP_IMPORT'); // Legal is imported: 350,000 less 54,250
    const none = await call('requester', 'POST', '/erp/budget-check', {
      businessUnit: 'Unit Without Budget',
      amount: 1,
    });
    expect(none.json()).toMatchObject({ status: 'UNAVAILABLE' });
    expect(none.json().source.kind).toBe('TENANT_CONFIG');
  });

  it('submission of a request uses the imported budget: over the ERP line is blocked, with the source in the conversation', async () => {
    const conv = (await call('requester', 'POST', '/assistant/conversations', { purpose: 'INTAKE' })).json()
      .id as string;
    const chat = async (text: string) => {
      const r = await call('requester', 'POST', `/assistant/conversations/${conv}/messages`, { text });
      expect(r.statusCode, r.body).toBe(201);
      return r.json() as Json;
    };
    await chat('Run an RFx for facilities cleaning - three-year term, about $1.7M');
    const second = await chat('Facilities');
    expect(JSON.stringify(second)).toMatch(
      /Source: SAP S\/4HANA budget for FY2027, cost centres FAC-100, FAC-200/,
    );
    const done = await chat('Sofia Rossi');
    const submit = await call('requester', 'POST', `/requests/${done.requestId}/submit`);
    expect(submit.statusCode).toBe(422); // the tenant settings (2M) alone would have cleared it
    expect(submit.json().code).toBe('BUDGET_EXCEEDED');
  });

  it('an ERP outage: imported budgets are not trusted unconfirmed, a manual task is queued, and a later sync closes it (NFR-AV04)', async () => {
    await putConnector({ mode: 'DOWN' });
    const check = await call('requester', 'POST', '/erp/budget-check', {
      businessUnit: 'Facilities',
      amount: 1_000,
    });
    expect(check.json()).toMatchObject({ status: 'UNAVAILABLE', available: null });
    expect(check.json().source.kind).toBe('ERP_UNAVAILABLE');
    const failed = await sync();
    expect(failed).toMatchObject({ ok: false, status: 'FAILED', reason: 'DOWN' });
    expect(failed.manualTaskId).toBeTruthy();
    const again = await sync(); // no second task for the same outage
    expect(again.manualTaskId).toBe(failed.manualTaskId);
    const tasks = (await call('finance', 'GET', '/manual-tasks?status=OPEN')).json() as Json[];
    expect(tasks.filter((t) => t.connector === 'ERP')).toHaveLength(1);
    // what was imported stays in use and visible
    expect((await overview()).costCentres).toHaveLength(11);
    await putConnector({ mode: 'UP' });
    const ok = await sync();
    expect(ok.ok).toBe(true);
    const closed = (await call('finance', 'GET', '/manual-tasks?status=SUPERSEDED')).json() as Json[];
    expect(closed.some((t) => t.id === failed.manualTaskId)).toBe(true);
  });
});
