import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { extractLegacy, parseAmount, parseCsv, parseDate, profileRow } from './rules.js';

describe('reading and profiling the extract (FR-0655, FR-0665)', () => {
  it('reads quoted fields, doubled quotes and line breaks inside quotes', () => {
    const t = parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\n2,"line\nbreak",z\n');
    expect(t).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'say "hi"'],
      ['2', 'line\nbreak', 'z'],
    ]);
    expect(parseCsv(String.fromCharCode(0xfeff) + 'h\nv')[0]).toEqual(['h']);
  });

  it('accepts ISO and Australian dates and refuses days that do not exist', () => {
    expect(parseDate('2027-12-31')).toBe('2027-12-31');
    expect(parseDate('31/12/2027')).toBe('2027-12-31');
    expect(parseDate('5/3/2026')).toBe('2026-03-05');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('2026-13-01')).toBeNull();
    expect(parseDate('next Tuesday')).toBeNull();
    expect(parseAmount('$1,200,000')).toBe(1_200_000);
    expect(parseAmount('AUD 90000.50')).toBe(90_000.5);
    expect(parseAmount('lots')).toBeNull();
  });

  it('itemises each problem by category and keeps warnings apart from exceptions', () => {
    const ok = profileRow(
      {
        contract_number: 'L-1',
        title: 'T',
        supplier: 'S',
        start_date: '2024-01-01',
        end_date: '2026-12-31',
        value: '1000',
      },
      new Set(),
    );
    expect(ok.issues).toEqual([]);
    expect(ok.warnings.length).toBe(2); // no owner; no notice period
    const bad = profileRow(
      {
        contract_number: 'L-1',
        title: '',
        supplier: 'S',
        start_date: 'soon',
        end_date: '2023-01-01',
        value: 'x',
        notice_months: 'six',
      },
      new Set(['l-1']),
    );
    expect(bad.issues.map((i) => i.category).sort()).toEqual([
      'Duplicate record',
      'Missing mandatory field',
      'Unparseable date',
      'Unparseable value',
      'Unparseable value',
    ]);
    expect(
      profileRow(
        {
          contract_number: 'L-2',
          title: 'T',
          supplier: 'S',
          start_date: '2024-05-01',
          end_date: '2024-05-01',
          value: '1',
        },
        new Set(),
      ).issues[0]!.category,
    ).toBe('Date order');
  });
});

describe('extraction from legacy contract text (FR-0675)', () => {
  it('finds the notice period, obligations, KPIs, SLAs and options', () => {
    const x = extractLegacy(
      'Either party may terminate on six months written notice. The Supplier shall provide monthly reports. The Supplier must hold current insurance. KPI: 95% of sites inspected each month. SLA: response within 4 hours. The Customer has two further 12-month options to extend.',
    );
    expect(x.noticeDays).toBe(180);
    expect(x.obligations).toEqual([
      'The Supplier shall provide monthly reports.',
      'The Supplier must hold current insurance.',
    ]);
    expect(x.kpis).toHaveLength(1);
    expect(x.slas).toHaveLength(1);
    expect(x.extensions).toEqual([12, 12]);
  });

  it('reads days and weeks, a single option in years, and says nothing when the text says nothing', () => {
    expect(extractLegacy('Termination for convenience on 90 days notice.').noticeDays).toBe(90);
    expect(extractLegacy('Notice of two weeks applies.').noticeDays).toBe(14);
    expect(extractLegacy('There is an option to extend for 2 years.').extensions).toEqual([24]);
    expect(extractLegacy('')).toEqual({
      noticeDays: null,
      obligations: [],
      kpis: [],
      slas: [],
      extensions: [],
    });
    expect(extractLegacy('A plain description.').noticeDays).toBeNull();
  });
});

let env: Awaited<ReturnType<typeof createEnv>>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;

const HEAD =
  'contract_number,title,supplier,start_date,end_date,value,procurement_ref,procurement_title,owner,notice_months,supplier_abn,text';
const TEXT =
  '"Either party may terminate on six months written notice. The Supplier shall deliver monthly service reports. KPI: 95% of sites inspected each month. SLA: respond within 4 hours. The Customer has two further 12-month options to extend."';
const CSV = [
  HEAD,
  `LEG-001,Legacy cleaning,Old Cleaners Pty Ltd,01/07/2022,31/12/2027,"$240,000",OLD-PR-77,Cleaning market approach,Sofia Rossi,,12345678901,${TEXT}`,
  'LEG-002,Legacy paper,Paper Pty Ltd,2023-01-01,2026-12-31,50000,,,,,,',
  'LEG-003,No supplier named,,2023-01-01,2026-12-31,50000,,,,,,',
  'LEG-004,Bad date,Date Pty Ltd,31/02/2023,2026-12-31,50000,,,,,,',
  'LEG-001,Duplicate number,Dup Pty Ltd,2023-01-01,2026-12-31,50000,,,,,,',
  'CT-2026-0001,Clashes with a live contract,Clash Pty Ltd,2023-01-01,2026-12-31,50000,,,,,,',
].join('\n');

describe('migrating legacy contracts (FR-0655 to FR-0675)', () => {
  let batch: Json;

  it('profiles the upload: valid rows, and an exception for each missing field, bad date and duplicate', async () => {
    const r = await env.call('admin', 'POST', '/migration/uploads', {
      filename: 'legacy.csv',
      sourceSystem: 'OldERP',
      csv: CSV,
    });
    expect(r.statusCode, r.body).toBe(201);
    batch = r.json();
    expect(batch).toMatchObject({
      total: 6,
      valid: 2,
      exceptions: 4,
      skipped: 0,
      loaded: 0,
      status: 'VALIDATED',
      canCutover: false,
    });
    const by = (n: string) =>
      batch.records.find((x: Json) => x.contractNumber === n && x.title !== 'Duplicate number');
    expect(by('LEG-003').issues[0]).toMatchObject({ category: 'Missing mandatory field', field: 'supplier' });
    expect(by('LEG-004').issues[0]).toMatchObject({ category: 'Unparseable date', field: 'start_date' });
    expect(batch.records.find((x: Json) => x.title === 'Duplicate number').issues[0].category).toBe(
      'Duplicate record',
    );
    expect(batch.records.find((x: Json) => x.contractNumber === 'CT-2026-0001').issues[0].category).toBe(
      'Duplicate record',
    );
    // what the contract text will give, shown before anything is loaded
    expect(by('LEG-001').extraction).toMatchObject({
      noticeDays: 180,
      obligations: 1,
      kpis: 1,
      slas: 1,
      extensions: [12, 12],
    });
    expect(by('LEG-002').warnings.join(' ')).toContain('90-day notice');
  });

  it('refuses a file without the required columns, and people outside administration and contract management', async () => {
    expect(
      (
        await env.call('admin', 'POST', '/migration/uploads', {
          filename: 'x.csv',
          sourceSystem: 'Old',
          csv: 'title,supplier\nA,B',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await env.call('requester', 'POST', '/migration/uploads', {
          filename: 'x.csv',
          sourceSystem: 'Old',
          csv: CSV,
        })
      ).statusCode,
    ).toBe(403);
    expect((await env.call('requester', 'GET', '/migration/batches')).statusCode).toBe(403);
  });

  it('the exceptions report itemises every issue and is itself audited', async () => {
    const res = await env.call('admin', 'GET', `/migration/batches/${batch.id}/exceptions.csv`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('Missing mandatory field');
    expect(res.body).toContain('Unparseable date');
    expect(res.body).toContain('Duplicate record');
    expect(res.body.split('\n').length).toBeGreaterThan(5);
    expect(
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'migration.exceptions_export')),
      ),
    ).toHaveLength(1);
  });

  it('cutover cannot be signed off with unreviewed exceptions, and only an administrator may do it', async () => {
    const blocked = await env.call('admin', 'POST', `/migration/batches/${batch.id}/cutover`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('EXCEPTIONS_UNREVIEWED');
    expect(
      (await env.call('contract-mgr', 'POST', `/migration/batches/${batch.id}/cutover`)).statusCode,
    ).toBe(403);
    // contract management can review
    expect((await env.call('contract-mgr', 'GET', `/migration/batches/${batch.id}`)).statusCode).toBe(200);
  });

  it('exceptions are corrected (and checked again) or set aside with a reason; then the batch can be cut over', async () => {
    const rec = (n: string, t?: string) =>
      batch.records.find((x: Json) => x.contractNumber === n && (!t || x.title === t));
    const fixed = await env.call('contract-mgr', 'PUT', `/migration/records/${rec('LEG-004').id}`, {
      fields: { start_date: '15/03/2023' },
    });
    expect(fixed.statusCode, fixed.body).toBe(200);
    expect(fixed.json()).toMatchObject({ status: 'VALID', issues: [] });
    // a correction that is still wrong stays an exception
    const still = await env.call('contract-mgr', 'PUT', `/migration/records/${rec('LEG-003').id}`, {
      fields: { supplier: '' },
    });
    expect(still.json().status).toBe('EXCEPTION');
    expect(
      (
        await env.call('contract-mgr', 'PUT', `/migration/records/${rec('LEG-003').id}`, {
          fields: { nonsense: 'x' },
        })
      ).statusCode,
    ).toBe(422);
    for (const [n, t] of [
      ['LEG-003', undefined],
      ['LEG-001', 'Duplicate number'],
      ['CT-2026-0001', undefined],
    ] as const) {
      const skipped = await env.call('contract-mgr', 'POST', `/migration/records/${rec(n, t).id}/skip`, {
        note: 'Not a real record',
      });
      expect(skipped.json().status).toBe('SKIPPED');
    }
    expect(
      (
        await env.call(
          'contract-mgr',
          'POST',
          `/migration/records/${rec('LEG-001', 'Legacy cleaning').id}/skip`,
          { note: 'x' },
        )
      ).statusCode,
    ).toBe(400); // a reason needs at least 3 characters
    const view = (await env.call('admin', 'GET', `/migration/batches/${batch.id}`)).json();
    expect(view).toMatchObject({ valid: 3, exceptions: 0, skipped: 3, canCutover: true });
  });

  it('cutover loads the valid records, reconciles to the source count, and flags and links what it loaded', async () => {
    const r = await env.call('admin', 'POST', `/migration/batches/${batch.id}/cutover`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      status: 'CUTOVER',
      loaded: 3,
      skipped: 3,
      reconciliation: { total: 6, loaded: 3, skipped: 3, reconciles: true },
    });
    const again = await env.call('admin', 'POST', `/migration/batches/${batch.id}/cutover`);
    expect(again.statusCode).toBe(409);

    const contracts = await sys<Json[]>((tx) =>
      tx.select().from(s.contract).where(eq(s.contract.sourceSystem, 'OldERP')),
    );
    expect(contracts.map((c) => c.number).sort()).toEqual(['LEG-001', 'LEG-002', 'LEG-004']);
    const leg1 = contracts.find((c) => c.number === 'LEG-001')!;
    expect(leg1).toMatchObject({
      status: 'EXECUTED',
      locked: true,
      noticeDays: 180,
      startDate: '2022-07-01',
      endDate: '2027-12-31',
    });

    // linked to its originating procurement, which is navigable from the request
    const requestRow = (
      await sys<Json[]>((tx) => tx.select().from(s.request).where(eq(s.request.number, 'OLD-PR-77')))
    )[0]!;
    expect(requestRow).toMatchObject({
      sourceSystem: 'OldERP',
      status: 'COMPLETE',
      title: 'Cleaning market approach',
    });
    const tn = (
      await sys<Json[]>((tx) => tx.select().from(s.tender).where(eq(s.tender.requestId, requestRow.id)))
    )[0]!;
    expect(leg1.tenderId).toBe(tn.id);
    const artefacts = (
      await env.call('procurement', 'GET', `/requests/${requestRow.id}/artefacts`)
    ).json() as Json[];
    expect(artefacts.map((a) => a.kind)).toEqual(['REQUEST', 'TENDER', 'CONTRACT']);

    // the record is complete: owner, extensions, clauses from the text, and alerts including the clause-derived notice alert
    const owner = (
      await sys<Json[]>((tx) => tx.select().from(s.appUser).where(eq(s.appUser.id, leg1.ownerId)))
    )[0]!;
    expect(owner.name).toBe('Sofia Rossi');
    expect(
      (
        await sys<Json[]>((tx) =>
          tx.select().from(s.contractExtension).where(eq(s.contractExtension.contractId, leg1.id)),
        )
      )
        .map((e) => e.months)
        .sort(),
    ).toEqual([12, 12]);
    const clauses = await sys<Json[]>((tx) =>
      tx.select().from(s.clause).where(eq(s.clause.contractId, leg1.id)),
    );
    expect(clauses.map((c) => c.clauseId).sort()).toEqual(['KPI-1', 'OBL-1', 'SLA-1']);
    const alerts = await sys<Json[]>((tx) =>
      tx.select().from(s.alert).where(eq(s.alert.contractId, leg1.id)),
    );
    // six months notice (180 days) plus the 60-day lead is 240 days, about eight months before the end of 2027
    expect(alerts.find((a) => a.kind === 'NOTICE')!.triggerDate).toBe('2027-05-05');
    expect(alerts.find((a) => a.kind === 'EXPIRY')!.triggerDate).toBe('2027-11-01');

    // an unknown supplier was created for review, not guessed
    const sup = (
      await sys<Json[]>((tx) => tx.select().from(s.supplier).where(eq(s.supplier.company, 'Paper Pty Ltd')))
    )[0]!;
    expect(sup).toMatchObject({ sanctionsStatus: 'PENDING', abn: '00000000000' });
    expect(
      (
        await sys<Json[]>((tx) =>
          tx.select().from(s.supplier).where(eq(s.supplier.company, 'Old Cleaners Pty Ltd')),
        )
      )[0]!.abn,
    ).toBe('12345678901');
  });

  it('migrated records answer search, reporting and access rules like native ones, and are marked as migrated', async () => {
    const found = (await env.call('procurement', 'GET', '/requests?q=OLD-PR')).json();
    expect(found.items).toHaveLength(1);
    expect(found.items[0]).toMatchObject({ number: 'OLD-PR-77', sourceSystem: 'OldERP' });
    // a requester sees only their own requests, migrated or not (the migrated one belongs to the person who ran the load)
    expect((await env.call('requester', 'GET', '/requests?q=OLD-PR')).json().items).toHaveLength(0);
    const list = (await env.call('legal', 'GET', '/contracts')).json();
    const items: Json[] = Array.isArray(list) ? list : list.items;
    expect(items.find((c) => c.number === 'LEG-001')).toMatchObject({
      sourceSystem: 'OldERP',
      status: 'EXECUTED',
    });
    expect(items.find((c) => c.number === 'CT-2026-0001')!.sourceSystem).toBeNull();
    // it shows in the executive's portfolio like any other procurement
    const dash = (await env.call('exec', 'GET', '/reports/procurements')).json();
    expect(dash.items.find((x: Json) => x.number === 'OLD-PR-77')).toMatchObject({ sourceSystem: 'OldERP' });
    // and a locked contract cannot be edited
    const leg = (
      await sys<Json[]>((tx) =>
        tx
          .select()
          .from(s.contract)
          .where(and(eq(s.contract.number, 'LEG-001'))),
      )
    )[0]!;
    expect(
      (await env.call('legal', 'PUT', `/contracts/${leg.id}/clauses/OBL-1`, { text: 'Changed' })).statusCode,
    ).toBe(423);
  });

  it('every step is in the audit trail with who did it', async () => {
    const actions = [
      'migration.upload',
      'migration.record_fix',
      'migration.record_skip',
      'migration.cutover',
    ];
    for (const a of actions) {
      const rows = await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, a)),
      );
      expect(rows.length, a).toBeGreaterThan(0);
    }
    const cut = (
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'migration.cutover')),
      )
    )[0]!;
    expect(cut.actorRole).toBe('ADMIN');
    expect(cut.after).toMatchObject({ loaded: 3, skipped: 3, total: 6, sourceSystem: 'OldERP' });
  });
});
