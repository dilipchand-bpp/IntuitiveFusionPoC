/**
 * CP-07 historical import against the real API and database: upload, mapping, dry run (read-only), commit effects, rollback
 * exactness, role guards, tenant isolation and audit. The pure parts are in cphist-parse.test.ts.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { withContext } from '../../db/client.js';
import { TENANT_ID } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import {
  CATALOGUE_PLANTED,
  CONTRACT_PLANTED,
  SPEND_PLANTED,
  SUPPLIER_PLANTED,
  cataloguePrices,
  legacyContractRegister,
  sampleCsv,
  sampleXlsx,
  spendExtract,
  supplierExtract,
  type SampleFile,
} from './samples.js';
import { writeZip } from './zip.js';

let env: Awaited<ReturnType<typeof createEnv>>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64');

const upload = (
  who: string,
  entity: string,
  file: SampleFile,
  kind: 'xlsx' | 'csv' = 'xlsx',
  over: Json = {},
) =>
  env.call(who, 'POST', '/history-import/uploads', {
    entity,
    filename: `${file.key}.${kind}`,
    sourceSystem: file.sourceSystem,
    contentBase64: b64(kind === 'xlsx' ? sampleXlsx(file) : Buffer.from(sampleCsv(file))),
    ...over,
  });
const counts = async () =>
  sys<Json>(async (tx) => ({
    contracts: (await tx.select().from(s.contract)).length,
    suppliers: (await tx.select().from(s.supplier)).length,
    alerts: (await tx.select().from(s.alert)).length,
    clauses: (await tx.select().from(s.clause)).length,
    catalogue: (await tx.select().from(s.catalogueItem)).length,
    spend: (await tx.select().from(s.histSpendLine)).length,
  }));
const planted = (f: SampleFile) => new Set(Object.values(f.planted).flat());

async function loadAll(file: SampleFile, entity: string, rule: 'SKIP' | 'MERGE' = 'SKIP') {
  const up = await upload('admin', entity, file);
  expect(up.statusCode, up.body).toBe(201);
  const id = up.json().id as string;
  const dry = await env.call('admin', 'POST', `/history-import/batches/${id}/dry-run`, {
    duplicateRule: rule,
  });
  expect(dry.statusCode, dry.body).toBe(200);
  const done = await env.call('admin', 'POST', `/history-import/batches/${id}/commit`, { confirm: true });
  expect(done.statusCode, done.body).toBe(200);
  return { id, up: up.json() as Json, dry: dry.json() as Json, done: done.json() as Json };
}

describe('CP-07 uploads: formats, hostile files and the upload gate', () => {
  it('CP-07 an .xlsx and a .csv of the legacy register both upload, with a suggested mapping that is complete', async () => {
    const f = legacyContractRegister();
    for (const kind of ['xlsx', 'csv'] as const) {
      const r = await upload('admin', 'CONTRACTS', f, kind);
      expect(r.statusCode, r.body).toBe(201);
      const b = r.json();
      expect(b).toMatchObject({
        entity: 'CONTRACTS',
        rowCount: 200,
        status: 'UPLOADED',
        fileKind: kind === 'xlsx' ? 'XLSX' : 'CSV',
      });
      expect(b.suggestion.engine).toBe('rules-simulated-v1');
      expect(b.suggestion.missingRequired).toEqual([]);
      expect(b.mapping.end_date).toBe('Expiry Date');
      expect(b.preview).toHaveLength(5);
    }
  });

  it('CP-07 hostile uploads are refused with a reason: zip bomb, oversized, not a workbook, bad base64, infected', async () => {
    const f = legacyContractRegister();
    const bomb = writeZip([
      { name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(30 * 1024 * 1024, 0x20) },
    ]);
    const call = (over: Json) => upload('admin', 'CONTRACTS', f, 'xlsx', over);
    const r1 = await call({ filename: 'bomb.xlsx', contentBase64: b64(bomb) });
    expect(r1.statusCode).toBe(422);
    expect(r1.json().code).toBe('FILE_UNSAFE');
    const r2 = await call({
      filename: 'big.csv',
      contentBase64: b64(Buffer.alloc(10 * 1024 * 1024 + 10, 0x41)),
    });
    expect(r2.statusCode).toBe(422);
    expect(r2.json().code).toBe('FILE_TOO_LARGE');
    const r3 = await call({
      filename: 'x.xlsx',
      contentBase64: b64(writeZip([{ name: 'a.txt', data: Buffer.from('hi there') }])),
    });
    expect(r3.json().code).toBe('FILE_TYPE_UNSUPPORTED');
    const r4 = await call({ contentBase64: 'not base64 at all!!' });
    expect(r4.statusCode).toBe(422);
    const r5 = await call({ filename: 'setup.exe', contentBase64: b64(Buffer.from('a,b\n1,2\n')) });
    expect(r5.statusCode).toBe(400); // the upload gate (SEC-AP04): a program name
    const r6 = await upload('admin', 'SUPPLIERS', supplierExtract(), 'csv', {
      contentBase64: b64(
        'company,abn\nAcme,X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\n',
      ),
    });
    expect(r6.statusCode).toBe(422);
    expect(r6.json().code).toBe('VIRUS_DETECTED');
  });

  it('CP-07 a workbook with macros uploads, the macro is ignored, and the warning is on the batch', async () => {
    const { buildWorkbook } = await import('./sheet.js');
    const wb = buildWorkbook(
      'Data',
      [
        ['Supplier', 'ABN'],
        ['Macro Pty Ltd', ''],
      ],
      { macros: true },
    );
    const r = await env.call('admin', 'POST', '/history-import/uploads', {
      entity: 'SUPPLIERS',
      filename: 'macro.xlsm',
      sourceSystem: 'Macro source',
      contentBase64: b64(wb),
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().parseWarnings.join(' ')).toContain('macros');
  });

  it('CP-07 templates and samples download as real files, per entity, as csv and xlsx', async () => {
    const { parseTable } = await import('./sheet.js');
    for (const e of ['CONTRACTS', 'SUPPLIERS', 'SPEND', 'CATALOGUE']) {
      const c = await env.call('admin', 'GET', `/history-import/templates/${e}?format=csv`);
      expect(c.statusCode).toBe(200);
      expect(c.headers['content-type']).toContain('text/csv');
      const x = await env.call('contract-mgr', 'GET', `/history-import/templates/${e}?format=xlsx`);
      expect(x.headers['content-type']).toContain('spreadsheetml');
      expect(parseTable(x.rawPayload, 't.xlsx').rows).toHaveLength(1);
    }
    const list = (await env.call('admin', 'GET', '/history-import/samples')).json() as Json[];
    expect(list.map((x) => x.key).sort()).toEqual([
      'catalogue-prices',
      'legacy-contract-register',
      'spend-extract',
      'supplier-extract',
    ]);
    const sample = await env.call('admin', 'GET', '/history-import/samples/legacy-contract-register.xlsx');
    expect(parseTable(sample.rawPayload, 's.xlsx').rows).toHaveLength(200);
    expect((await env.call('admin', 'GET', '/history-import/samples/nothing-here.xlsx')).statusCode).toBe(
      404,
    );
  });
});

describe('CP-07 role guards', () => {
  it('CP-07 only administrators and contract managers prepare an import; only administrators load or reverse it', async () => {
    const f = supplierExtract();
    for (const who of ['requester', 'procurement', 'finance', 'exec', 'legal', 'delegate'])
      expect((await upload(who, 'SUPPLIERS', f)).statusCode, who).toBe(403);
    expect((await env.call('requester', 'GET', '/history-import/batches')).statusCode).toBe(403);
    expect((await env.call('requester', 'GET', '/history-import/templates/CONTRACTS')).statusCode).toBe(403);
    const up = await upload('contract-mgr', 'SUPPLIERS', f);
    expect(up.statusCode).toBe(201);
    const id = up.json().id;
    expect(
      (await env.call('contract-mgr', 'POST', `/history-import/batches/${id}/dry-run`, {})).statusCode,
    ).toBe(200);
    expect(
      (await env.call('contract-mgr', 'POST', `/history-import/batches/${id}/commit`, { confirm: true }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await env.call('contract-mgr', 'POST', `/history-import/batches/${id}/rollback`, {
          reason: 'no reason',
        })
      ).statusCode,
    ).toBe(403);
    // spend views are open to the finance and executive readers, not to a requester
    expect((await env.call('finance', 'GET', '/history-import/spend')).statusCode).toBe(200);
    expect((await env.call('requester', 'GET', '/history-import/spend')).statusCode).toBe(403);
  });
});

describe('CP-07 mapping: saved per source system, edited, and reset by a change', () => {
  it('CP-07 a mapping is edited (and checked), saved for the source system, and used on the next upload from it', async () => {
    const f = supplierExtract();
    const up = (await upload('admin', 'SUPPLIERS', f, 'csv', { sourceSystem: 'Mapping test ERP' })).json();
    expect(up.status).toBe('UPLOADED');
    const bad = await env.call('admin', 'PUT', `/history-import/batches/${up.id}/mapping`, {
      mapping: { company: 'Nope' },
    });
    expect(bad.statusCode).toBe(422);
    const dup = await env.call('admin', 'PUT', `/history-import/batches/${up.id}/mapping`, {
      mapping: { company: 'Name 1', abn: 'Name 1' },
    });
    expect(dup.statusCode).toBe(422);
    const ok = await env.call('admin', 'PUT', `/history-import/batches/${up.id}/mapping`, {
      mapping: { company: 'Name 1', abn: 'ABN', city: 'City', state: 'Region', email: null },
      duplicateRule: 'MERGE',
      saveForSource: true,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'MAPPED', savedForSource: true, duplicateRule: 'MERGE' });
    expect(ok.json().mapping.email).toBeNull();
    const saved = (
      await env.call('admin', 'GET', '/history-import/mappings?entity=SUPPLIERS')
    ).json() as Json[];
    expect(saved.find((m) => m.sourceSystem === 'Mapping test ERP')!.mapping.company).toBe('Name 1');
    // the next file from the same system starts from the saved mapping
    const again = (
      await upload('admin', 'SUPPLIERS', f, 'xlsx', { sourceSystem: 'Mapping test ERP' })
    ).json();
    expect(again).toMatchObject({ status: 'MAPPED', duplicateRule: 'MERGE' });
    expect(again.suggestion.usedSavedMapping).toBeTruthy();
    expect(again.mapping.email).toBeNull();
    // a changed mapping clears the dry run
    await env.call('admin', 'POST', `/history-import/batches/${again.id}/dry-run`, {});
    const changed = await env.call('admin', 'PUT', `/history-import/batches/${again.id}/mapping`, {
      mapping: again.mapping,
    });
    expect(changed.json()).toMatchObject({ status: 'MAPPED', summary: null });
    // delete
    const row = saved.find((m) => m.sourceSystem === 'Mapping test ERP')!;
    expect((await env.call('admin', 'DELETE', `/history-import/mappings/${row.id}`)).statusCode).toBe(204);
    expect((await env.call('admin', 'DELETE', `/history-import/mappings/${row.id}`)).statusCode).toBe(404);
  });
});

describe('CP-07 dry run is read-only and reports what a load would do', () => {
  it('CP-07 the dry run of the 200-row register writes nothing to contracts, suppliers, alerts or spend, and finds every planted problem', async () => {
    const f = legacyContractRegister();
    const up = (await upload('admin', 'CONTRACTS', f, 'xlsx', { sourceSystem: 'Dry run ERP' })).json();
    const before = await counts();
    const r = await env.call('admin', 'POST', `/history-import/batches/${up.id}/dry-run`, {});
    expect(r.statusCode, r.body).toBe(200);
    expect(await counts()).toEqual(before);
    const b = r.json();
    expect(b.status).toBe('DRY_RUN');
    const P = CONTRACT_PLANTED;
    const sum = b.summary;
    expect(sum.total).toBe(200);
    // the clash with CT-2026-0001 is found against the seeded contract
    expect(sum.duplicates).toBe(P.duplicateInFile.length + P.duplicateExisting.length);
    expect(sum.valid + sum.errors + sum.duplicates).toBe(200);
    expect(sum.valid).toBe(200 - planted(f).size);
    expect(sum.errorsByRule).toMatchObject({
      ABN_CHECKSUM: 4,
      DATE_ORDER: 1,
      DATE_FORMAT: 3,
      ALLOWED_VALUE: 1,
      AMOUNT_FORMAT: 1,
      AMOUNT_RANGE: 1,
      INTEGER: 1,
      DUPLICATE_EXISTING: 1,
      DUPLICATE_IN_FILE: 1,
    });
    expect(sum.suppliers.wouldCreate).toBeGreaterThan(20);
    expect(sum.reminders.contractsWithReminders + sum.reminders.endedOrTerminated).toBe(sum.valid);
    expect(sum.variants.length).toBeGreaterThan(0);
    // rows: the problems come back with the rule that found them
    const bad = b.rows.find((x: Json) => x.rowNo === P.badAbn[0]);
    expect(bad.issues[0]).toMatchObject({ rule: 'ABN_CHECKSUM', field: 'supplier_abn' });
    expect(b.rowsTotal).toBeGreaterThan(planted(f).size);
    // paging
    const page = (
      await env.call('admin', 'GET', `/history-import/batches/${up.id}?rows=all&limit=10&offset=190`)
    ).json();
    expect(page.rows).toHaveLength(10);
    expect(page.rows[9].rowNo).toBe(200);
    // the downloadable error report
    const csv = await env.call('admin', 'GET', `/history-import/batches/${up.id}/errors.csv`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    for (const rule of [
      'ABN_CHECKSUM',
      'DATE_FORMAT',
      'DATE_ORDER',
      'REQUIRED',
      'DUPLICATE_EXISTING',
      'DUPLICATE_IN_FILE',
      'SUPPLIER_VARIANT',
    ])
      expect(csv.body, rule).toContain(rule);
    expect(csv.body.split('\n').length).toBeGreaterThan(planted(f).size);
    // not loaded: commit refuses a batch that has not been dry-run on its current mapping, and requires confirmation
    const fresh = (await upload('admin', 'CONTRACTS', f, 'csv', { sourceSystem: 'Dry run ERP 2' })).json();
    expect(
      (
        await env.call('admin', 'POST', `/history-import/batches/${fresh.id}/commit`, { confirm: true })
      ).json().code,
    ).toBe('DRY_RUN_REQUIRED');
    expect((await env.call('admin', 'POST', `/history-import/batches/${up.id}/commit`, {})).statusCode).toBe(
      400,
    );
  });
});

describe('CP-07 suppliers: skip or merge duplicates, then rollback', () => {
  it('CP-07 the supplier extract loads valid rows, skips duplicates by rule, merges on MERGE, and rolls back exactly', async () => {
    const f = supplierExtract();
    // one supplier already on file with a placeholder ABN, to be merged into
    const row3 = f.rows[2]!;
    const existingId = await sys<string>(async (tx) => {
      const [x] = await tx
        .insert(s.supplier)
        .values({ tenantId: TENANT_ID, company: String(row3[1]), abn: '00000000000' })
        .returning();
      return x!.id;
    });
    const before = await counts();
    const skip = await loadAll(f, 'SUPPLIERS', 'SKIP');
    const P = SUPPLIER_PLANTED;
    expect(skip.dry.summary.errors).toBe(P.badAbn.length + P.missingName.length + P.badEmail.length);
    const created = skip.done.commitSummary;
    expect(created).toMatchObject({ reconciles: true, merged: 0, entity: 'SUPPLIERS' });
    expect(created.loaded + created.skippedDuplicates + created.skippedErrors).toBe(33);
    expect((await counts()).suppliers).toBe(before.suppliers + created.suppliersCreated);
    // the one on file was skipped under SKIP: its ABN is still the placeholder
    expect(
      (await sys<Json[]>((tx) => tx.select().from(s.supplier).where(eq(s.supplier.id, existingId))))[0]!.abn,
    ).toBe('00000000000');
    // rollback removes exactly the suppliers the batch created
    const rb = await env.call('admin', 'POST', `/history-import/batches/${skip.id}/rollback`, {
      reason: 'Loaded the wrong extract',
    });
    expect(rb.statusCode, rb.body).toBe(200);
    expect(rb.json().status).toBe('ROLLED_BACK');
    expect(rb.json().commitSummary.rollback).toMatchObject({ suppliersDeleted: created.suppliersCreated });
    expect(await counts()).toEqual(before);

    // MERGE: the same file now fills the placeholder ABN of the supplier already on file
    const merge = await loadAll(f, 'SUPPLIERS', 'MERGE');
    expect(merge.done.commitSummary.merged).toBeGreaterThanOrEqual(1);
    const after = (
      await sys<Json[]>((tx) => tx.select().from(s.supplier).where(eq(s.supplier.id, existingId)))
    )[0]!;
    expect(after.abn).toBe(String(row3[2]));
    const rb2 = await env.call('admin', 'POST', `/history-import/batches/${merge.id}/rollback`, {
      reason: 'Undo the merge',
    });
    expect(rb2.statusCode, rb2.body).toBe(200);
    expect(
      (await sys<Json[]>((tx) => tx.select().from(s.supplier).where(eq(s.supplier.id, existingId))))[0]!.abn,
    ).toBe('00000000000');
    expect(await counts()).toEqual(before);
    // a rolled-back batch cannot be committed or rolled back again
    expect(
      (
        await env.call('admin', 'POST', `/history-import/batches/${merge.id}/rollback`, {
          reason: 'again please',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await env.call('admin', 'POST', `/history-import/batches/${merge.id}/commit`, { confirm: true }))
        .statusCode,
    ).toBe(409);
  });
});

describe('CP-07 contracts: commit effects and rollback exactness (NFR-L04)', () => {
  let batchId = '';
  let before: Json;
  let seedContract: Json;
  let commitSummary: Json;
  const f = legacyContractRegister();

  it('CP-07 commit loads the valid rows as executed, locked, imported contracts with suppliers, clauses, owners and key-date reminders', async () => {
    before = await counts();
    seedContract = (
      await sys<Json[]>((tx) => tx.select().from(s.contract).where(eq(s.contract.number, 'CT-2026-0001')))
    )[0]!;
    const r = await loadAll(f, 'CONTRACTS');
    batchId = r.id;
    commitSummary = r.done.commitSummary;
    const valid = 200 - planted(f).size;
    expect(commitSummary).toMatchObject({
      loaded: valid,
      contractsCreated: valid,
      reconciles: true,
      skippedErrors: 200 - valid - 2,
      skippedDuplicates: 2,
    });
    const mine = await sys<Json[]>((tx) =>
      tx.select().from(s.contract).where(eq(s.contract.sourceSystem, f.sourceSystem)),
    );
    expect(mine).toHaveLength(valid);
    expect(mine.every((c) => c.status === 'EXECUTED' && c.locked === true && c.deletedAt === null)).toBe(
      true,
    );
    // dates in every source format became real dates
    expect(mine.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.startDate) && c.endDate > c.startDate)).toBe(true);
    // supplier name variants are one supplier each, not one per spelling
    expect((await counts()).suppliers).toBe(before.suppliers + commitSummary.suppliersCreated);
    const apex = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.supplier)
        .where(sql`lower(${s.supplier.company}) like 'apex cleaning%'`),
    );
    expect(apex.length).toBeLessThanOrEqual(2); // "Apex Cleaning" and the look-alike "Apex Cleaning Services"
    // reminders through the existing alert mechanism
    const ids = mine.map((c) => c.id);
    const alerts = await sys<Json[]>((tx) =>
      tx.select().from(s.alert).where(inArray(s.alert.contractId, ids)),
    );
    const live = mine.filter((c) => c.endDate >= '2026-10-02');
    expect(live.length).toBeGreaterThan(20);
    const scheduled = alerts.filter((a) => a.status === 'SCHEDULED');
    expect(new Set(scheduled.map((a) => a.contractId)).size).toBeGreaterThan(10);
    expect(scheduled.some((a) => a.kind === 'EXPIRY')).toBe(true);
    expect(scheduled.some((a) => a.kind === 'NOTICE')).toBe(true);
    expect(scheduled.every((a) => a.triggerDate >= '2026-10-02')).toBe(true);
    // ended contracts have no live reminders
    const ended = new Set(mine.filter((c) => c.endDate < '2026-10-02').map((c) => c.id));
    expect(alerts.filter((a) => ended.has(a.contractId) && a.status === 'SCHEDULED')).toHaveLength(0);
    // clauses from the wording, and an owner from the register
    expect(
      (await sys<Json[]>((tx) => tx.select().from(s.clause).where(inArray(s.clause.contractId, ids)))).length,
    ).toBeGreaterThan(20);
    expect(mine.some((c) => c.ownerId !== null)).toBe(true);
    // visible through the normal contract list, flagged as imported
    const list = (await env.call('legal', 'GET', '/contracts')).json();
    const items: Json[] = Array.isArray(list) ? list : list.items;
    expect(items.filter((c) => c.sourceSystem === f.sourceSystem).length).toBeGreaterThanOrEqual(valid);
    // the existing contract with the clashing number was not touched
    const same = (
      await sys<Json[]>((tx) => tx.select().from(s.contract).where(eq(s.contract.number, 'CT-2026-0001')))
    )[0]!;
    expect(same.version).toBe(seedContract.version);
    // the batch report keeps the row outcomes
    const rep = (
      await env.call('admin', 'GET', `/history-import/batches/${batchId}?rows=all&limit=1000`)
    ).json();
    expect(rep.rows.filter((x: Json) => x.status === 'LOADED')).toHaveLength(valid);
    expect(rep.rows.filter((x: Json) => x.status === 'DUPLICATE')).toHaveLength(0);
    expect(rep.rollback.possible).toBe(true);
  });

  it('CP-07 a loaded batch cannot be loaded twice, and a second import of the same register finds every number already there', async () => {
    expect(
      (await env.call('admin', 'POST', `/history-import/batches/${batchId}/commit`, { confirm: true }))
        .statusCode,
    ).toBe(409);
    const again = (await upload('admin', 'CONTRACTS', f, 'csv', { sourceSystem: 'Second pass' })).json();
    const dry = (await env.call('admin', 'POST', `/history-import/batches/${again.id}/dry-run`, {})).json();
    expect(dry.summary.valid).toBe(0);
    expect(dry.summary.duplicates).toBeGreaterThan(150);
    expect(
      (
        await env.call('admin', 'POST', `/history-import/batches/${again.id}/commit`, { confirm: true })
      ).json().code,
    ).toBe('NOTHING_TO_LOAD');
  });

  it('CP-07 rollback is refused once an imported contract has been touched, and says which', async () => {
    const mine = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.contract)
        .where(and(eq(s.contract.sourceSystem, f.sourceSystem), isNull(s.contract.deletedAt))),
    );
    const target = mine.find((c) => c.endDate > '2028-06-01')!;
    const custom = await env.call('contract-mgr', 'POST', `/contracts/${target.id}/alerts`, {
      instruction: 'alert me 2 months before expiry',
    });
    expect(custom.statusCode, custom.body).toBe(201);
    const view = (await env.call('admin', 'GET', `/history-import/batches/${batchId}`)).json();
    expect(view.rollback.possible).toBe(false);
    const blocked = await env.call('admin', 'POST', `/history-import/batches/${batchId}/rollback`, {
      reason: 'Trying anyway',
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('ROLLBACK_BLOCKED');
    expect(JSON.stringify(blocked.json().errors)).toContain(target.number);
    expect(await counts()).toMatchObject({
      contracts: before.contracts + (commitSummary.contractsCreated as number),
    });
    // put it right (the extra reminder is removed by the system under test conditions), then the rollback goes through
    await sys((tx) =>
      tx.delete(s.alert).where(and(eq(s.alert.contractId, target.id), eq(s.alert.origin, 'USER'))),
    );
  });

  it('CP-07 rollback removes exactly what the batch created: contracts are logically deleted, reminders cancelled, nothing else changes', async () => {
    const mine = await sys<Json[]>((tx) =>
      tx.select().from(s.contract).where(eq(s.contract.sourceSystem, f.sourceSystem)),
    );
    const ids = mine.map((c) => c.id);
    const othersBefore = await sys<Json[]>((tx) =>
      tx
        .select({ id: s.contract.id, v: s.contract.version, d: s.contract.deletedAt })
        .from(s.contract)
        .where(sql`${s.contract.sourceSystem} is distinct from ${f.sourceSystem}`),
    );
    const rb = await env.call('admin', 'POST', `/history-import/batches/${batchId}/rollback`, {
      reason: 'Wrong register',
    });
    expect(rb.statusCode, rb.body).toBe(200);
    const sum = rb.json().commitSummary.rollback;
    expect(sum.contractsDeleted).toBe(mine.length);
    const after = await sys<Json[]>((tx) => tx.select().from(s.contract).where(inArray(s.contract.id, ids)));
    // signed contracts stay: still in the table, logically deleted (NFR-L04), so they show in the deleted list
    expect(after).toHaveLength(mine.length);
    expect(after.every((c) => c.deletedAt !== null && c.locked === true)).toBe(true);
    const deleted = (await env.call('legal', 'GET', '/contracts/deleted')).json() as Json[];
    expect(deleted.filter((d) => ids.includes(d.id))).toHaveLength(mine.length);
    expect(deleted.find((d) => ids.includes(d.id))!.reason).toContain('Wrong register');
    const alerts = await sys<Json[]>((tx) =>
      tx.select().from(s.alert).where(inArray(s.alert.contractId, ids)),
    );
    expect(alerts.filter((a) => a.status === 'SCHEDULED')).toHaveLength(0);
    // other contracts are exactly as they were
    const othersAfter = await sys<Json[]>((tx) =>
      tx
        .select({ id: s.contract.id, v: s.contract.version, d: s.contract.deletedAt })
        .from(s.contract)
        .where(sql`${s.contract.sourceSystem} is distinct from ${f.sourceSystem}`),
    );
    expect(othersAfter).toEqual(othersBefore);
    // suppliers that no retained contract refers to are gone; those a retained contract needs are kept and reported
    expect(sum.suppliersDeleted + sum.suppliersKept).toBe(commitSummary.suppliersCreated);
    expect(sum.suppliersKept).toBeGreaterThan(0);
    // the register can be imported again: deleted contracts do not block their numbers
    const re = (await upload('admin', 'CONTRACTS', f, 'csv', { sourceSystem: 'Third pass' })).json();
    const dry = (await env.call('admin', 'POST', `/history-import/batches/${re.id}/dry-run`, {})).json();
    expect(dry.summary.valid).toBe(200 - planted(f).size);
  });
});

describe('CP-07 historical spend reaches the analytics store and the spend report', () => {
  it('CP-07 loaded spend shows in the analytics-store view and the main spend report, and rollback takes it out again', async () => {
    const f = spendExtract();
    const before = (await env.call('finance', 'GET', '/reports/spend')).json();
    expect(before.historical.lines).toBe(0);
    const r = await loadAll(f, 'SPEND');
    const P = SPEND_PLANTED;
    const sum = r.done.commitSummary;
    expect(sum.spendLines).toBe(300 - planted(f).size + P.credit.length);
    expect(sum).toMatchObject({ reconciles: true, skippedDuplicates: 1 });
    const view = (await env.call('finance', 'GET', '/history-import/spend')).json();
    expect(view.store).toBe('analytics');
    expect(view.lines).toBe(sum.spendLines);
    expect(view.total).toBeCloseTo(sum.spendTotal, 2);
    expect(view.byFinancialYear.length).toBeGreaterThanOrEqual(4);
    expect(view.byFinancialYear.every((y: Json) => /^FY\d\d\/\d\d$/.test(y.year))).toBe(true);
    expect(view.byCategory.length).toBeGreaterThan(5);
    expect(view.to <= '2026-10-02').toBe(true);
    const report = (await env.call('exec', 'GET', '/reports/spend')).json();
    expect(report.historical.total).toBeCloseTo(sum.spendTotal, 2);
    expect(report.historical.lines).toBe(sum.spendLines);
    // the dry run reported the same total before anything was loaded
    expect(r.dry.summary.spend.total).toBeCloseTo(sum.spendTotal, 2);
    // loading it again finds every line already there
    const again = (await upload('admin', 'SPEND', f, 'csv', { sourceSystem: 'Spend again' })).json();
    const dry = (await env.call('admin', 'POST', `/history-import/batches/${again.id}/dry-run`, {})).json();
    expect(dry.summary.valid).toBe(0);
    // rollback
    const rb = await env.call('admin', 'POST', `/history-import/batches/${r.id}/rollback`, {
      reason: 'Wrong period',
    });
    expect(rb.statusCode, rb.body).toBe(200);
    expect(rb.json().commitSummary.rollback.spendLinesDeleted).toBe(sum.spendLines);
    expect((await env.call('finance', 'GET', '/history-import/spend')).json().lines).toBe(0);
    expect((await env.call('exec', 'GET', '/reports/spend')).json().historical.lines).toBe(0);
  });
});

describe('CP-07 catalogue prices: need their suppliers, merge by SKU, and put prices back', () => {
  it('CP-07 catalogue rows for unknown suppliers are errors; after the suppliers load, prices load, MERGE reprices, rollback restores', async () => {
    const f = cataloguePrices();
    const suppliers = await loadAll(supplierExtract(), 'SUPPLIERS');
    const up = (await upload('admin', 'CATALOGUE', f, 'xlsx')).json();
    const dry = (await env.call('admin', 'POST', `/history-import/batches/${up.id}/dry-run`, {})).json();
    const P = CATALOGUE_PLANTED;
    expect(dry.summary.errorsByRule.SUPPLIER_NOT_FOUND).toBe(P.unknownSupplier.length);
    expect(dry.summary.errors).toBe(P.unknownSupplier.length + P.badPrice.length + P.missingSku.length);
    const done = (
      await env.call('admin', 'POST', `/history-import/batches/${up.id}/commit`, { confirm: true })
    ).json();
    expect(done.commitSummary).toMatchObject({ reconciles: true, skippedDuplicates: 1 });
    const n = done.commitSummary.catalogueCreated as number;
    expect(n).toBe(30 - 4);
    expect((await sys<Json[]>((tx) => tx.select().from(s.catalogueItem))).length).toBeGreaterThanOrEqual(n);
    // a repriced list under MERGE changes the prices; the old ones are kept in the ledger
    const cheaper: SampleFile = {
      ...f,
      rows: f.rows.map((r) => [
        r[0]!,
        r[1]!,
        r[2]!,
        typeof r[3] === 'number' ? r[3] + 100 : r[3]!,
        r[4]!,
        r[5]!,
        r[6]!,
      ]),
    };
    const up2 = (
      await upload('admin', 'CATALOGUE', cheaper, 'csv', { sourceSystem: 'Price list v2' })
    ).json();
    const dry2 = (
      await env.call('admin', 'POST', `/history-import/batches/${up2.id}/dry-run`, { duplicateRule: 'MERGE' })
    ).json();
    expect(dry2.summary.wouldMerge).toBeGreaterThan(5);
    const done2 = (
      await env.call('admin', 'POST', `/history-import/batches/${up2.id}/commit`, { confirm: true })
    ).json();
    expect(done2.commitSummary.catalogueUpdated).toBeGreaterThan(5);
    const item = (
      await sys<Json[]>((tx) =>
        tx
          .select()
          .from(s.catalogueItem)
          .where(eq(s.catalogueItem.sku, String(f.rows[0]![1]))),
      )
    )[0]!;
    expect(Number(item.unitPrice)).toBe(Number(f.rows[0]![3]) + 100);
    const rb = await env.call('admin', 'POST', `/history-import/batches/${up2.id}/rollback`, {
      reason: 'Prices were a draft',
    });
    expect(rb.statusCode, rb.body).toBe(200);
    expect(rb.json().commitSummary.rollback.cataloguePricesRestored).toBe(
      done2.commitSummary.catalogueUpdated,
    );
    const back = (
      await sys<Json[]>((tx) =>
        tx
          .select()
          .from(s.catalogueItem)
          .where(eq(s.catalogueItem.sku, String(f.rows[0]![1]))),
      )
    )[0]!;
    expect(Number(back.unitPrice)).toBe(Number(f.rows[0]![3]));
    // suppliers cannot be rolled back while a catalogue item from elsewhere uses one of them
    const [made] = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.histCreated)
        .where(
          and(
            eq(s.histCreated.batchId, suppliers.id),
            eq(s.histCreated.entityType, 'SUPPLIER'),
            eq(s.histCreated.action, 'CREATED'),
          ),
        )
        .limit(1),
    );
    const [stray] = await sys<Json[]>((tx) =>
      tx
        .insert(s.catalogueItem)
        .values({
          tenantId: TENANT_ID,
          supplierId: made!.entityId,
          sku: 'STRAY-1',
          name: 'Entered by hand',
          category: 'x',
          unitPrice: '1',
          createdAt: new Date(),
        })
        .returning(),
    );
    const blocked = await env.call('admin', 'POST', `/history-import/batches/${suppliers.id}/rollback`, {
      reason: 'Too late now',
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('ROLLBACK_BLOCKED');
    await sys((tx) => tx.delete(s.catalogueItem).where(eq(s.catalogueItem.id, stray!.id)));
    // roll the catalogue back first, then the suppliers
    expect(
      (
        await env.call('admin', 'POST', `/history-import/batches/${up.id}/rollback`, {
          reason: 'Cleaning up',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await env.call('admin', 'POST', `/history-import/batches/${suppliers.id}/rollback`, {
          reason: 'Cleaning up',
        })
      ).statusCode,
    ).toBe(200);
  });
});

describe('CP-07 contract files go to the OCR module', () => {
  it('CP-07 a zip of contract files is handed to POST /contract-ingest/uploads; where that route does not exist the batch says so', async () => {
    const zip = writeZip([
      { name: 'agreement-1.pdf', data: Buffer.from('%PDF-1.7\nSynthetic agreement text') },
    ]);
    const r = await env.call('admin', 'POST', '/history-import/uploads', {
      entity: 'CONTRACT_FILES',
      filename: 'old-contracts.zip',
      sourceSystem: 'Shared drive',
      contentBase64: b64(zip),
    });
    expect(r.statusCode, r.body).toBe(201);
    const b = r.json();
    expect(b).toMatchObject({ entity: 'CONTRACT_FILES', fileKind: 'ZIP' });
    const hasOcr = env.app.hasRoute({ method: 'POST', url: '/api/v1/contract-ingest/uploads' });
    if (!hasOcr) {
      expect(b.ocr.available).toBe(false);
      expect(b.ocr.message).toContain('OCR capability not available');
    } else {
      expect(b.ocr).toBeTruthy(); // accepted (with its batch id) or refused with the module's own reason
      expect(b.ocr.available).toBe(true);
    }
    // it is listed with the others and has no rows to check or load
    expect((await env.call('admin', 'POST', `/history-import/batches/${b.id}/dry-run`, {})).statusCode).toBe(
      409,
    );
    expect((await env.call('admin', 'GET', `/history-import/batches/${b.id}`)).statusCode).toBe(200);
    // not a zip
    const bad = await env.call('admin', 'POST', '/history-import/uploads', {
      entity: 'CONTRACT_FILES',
      filename: 'x.zip',
      sourceSystem: 'Shared drive',
      contentBase64: b64('this is not a zip file'),
    });
    expect(bad.statusCode).toBe(422);
  });
});

describe('CP-07 tenant isolation and audit', () => {
  it('CP-07 another tenant sees none of the batches, rows, ledger, mappings or spend lines, and cannot write into this tenant', async () => {
    const other = randomUUID();
    await sys((tx) =>
      tx.insert(s.tenant).values({
        id: other,
        slug: `other-${other.slice(0, 6)}`,
        name: 'Other organisation',
        sector: 'PUBLIC',
      } as never),
    );
    const ctx = { tenantId: other, userId: null, role: 'ADMIN' as const };
    const seen = await withContext(env.database, ctx, async (tx) => ({
      batches: (await tx.select().from(s.histBatch)).length,
      rows: (await tx.select().from(s.histRow)).length,
      ledger: (await tx.select().from(s.histCreated)).length,
      mappings: (await tx.select().from(s.histMapping)).length,
      spend: (await tx.select().from(s.histSpendLine)).length,
    }));
    expect(seen).toEqual({ batches: 0, rows: 0, ledger: 0, mappings: 0, spend: 0 });
    const mine = (await sys<Json[]>((tx) => tx.select().from(s.histBatch))).length;
    expect(mine).toBeGreaterThan(5);
    await expect(
      withContext(env.database, ctx, (tx) =>
        tx.insert(s.histMapping).values({
          tenantId: TENANT_ID,
          entity: 'SUPPLIERS',
          sourceSystem: 'x',
          mapping: {},
          createdBy: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    ).rejects.toThrow();
    // by id through the API an unknown batch is 404
    expect((await env.call('admin', 'GET', `/history-import/batches/${randomUUID()}`)).statusCode).toBe(404);
  });

  it('CP-07 every step is in the audit trail with who did it', async () => {
    for (const a of ['upload', 'mapping', 'dry_run', 'commit', 'rollback', 'errors_export', 'ocr_handoff']) {
      const rows = await sys<Json[]>((tx) =>
        tx
          .select()
          .from(s.auditEvent)
          .where(eq(s.auditEvent.action, `history_import.${a}`)),
      );
      expect(rows.length, a).toBeGreaterThan(0);
    }
    const c = (
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'history_import.commit')),
      )
    )[0]!;
    expect(c.actorRole).toBe('ADMIN');
    expect(c.after).toMatchObject({ status: 'COMMITTED' });
    const rb = (
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'history_import.rollback')),
      )
    )[0]!;
    expect(rb.after.reason).toBeTruthy();
    // each contract removed by a rollback is audited like any logical delete
    expect(
      (
        await sys<Json[]>((tx) =>
          tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'contract.delete')),
        )
      ).length,
    ).toBeGreaterThan(100);
  });
});
