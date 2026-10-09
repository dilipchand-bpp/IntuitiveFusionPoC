import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { withContext, type RequestContext } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { EICAR } from '../b11enc/test-kit.js';
import { buildSample } from './samples.js';
import { zip } from './test-kit.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const b64 = (b: Buffer) => b.toString('base64');
const file = (name: string, bytes: Buffer) => ({ name, contentBase64: b64(bytes) });
const sample = (key: string) => {
  const b = buildSample(key)!;
  return file(b.fileName, b.bytes);
};
async function upload(who: string, files: Array<{ name: string; contentBase64: string }>) {
  return call(who, 'POST', '/contract-ingest/uploads', { files });
}
async function ingestOne(key: string, who = 'legal') {
  const r = await upload(who, [sample(key)]);
  expect(r.statusCode, r.body).toBe(201);
  const b = r.json() as Json;
  return { batch: b, doc: b.documents[0] as Json };
}
const field = (doc: Json, k: string) => (doc.fields as Json[]).find((f) => f.key === k)!;

describe('CP-07 upload, role guards and the document view', () => {
  it('CP-07 a text-layer PDF is read for real and a batch with one READY document comes back', async () => {
    const { batch, doc } = await ingestOne('services-agreement');
    expect(batch.counts).toMatchObject({ documents: 1, ready: 1, needsReview: 0 });
    expect(doc).toMatchObject({
      status: 'READY',
      simulated: false,
      engine: 'pdf-text-layer (unpdf)',
      pageCount: 2,
      title: 'Facilities Management Services Agreement',
      supplier: 'Brightwave Cleaning Pty Ltd',
      endDate: '2028-06-30',
      missingMandatory: 0,
    });
    const full = (await call('contract-mgr', 'GET', `/contract-ingest/documents/${doc.id}`)).json() as Json;
    expect(full.pages).toHaveLength(2);
    const end = field(full, 'endDate');
    expect(full.pages[end.source.page - 1].text.slice(end.source.start, end.source.end)).toBe('30 June 2028');
    expect(full.matches.supplier.match).toMatchObject({ by: 'ABN', company: 'Brightwave Cleaning Pty Ltd' });
    const list = (await call('exec', 'GET', '/contract-ingest/batches')).json() as Json;
    expect(list.items.some((b: Json) => b.id === batch.id)).toBe(true);
    expect((await call('exec', 'GET', `/contract-ingest/batches/${batch.id}`)).statusCode).toBe(200);
  });

  it('CP-07 role guards: only legal, contract manager and procurement upload, review and commit; executives read; others are refused', async () => {
    const files = [sample('office-licence')];
    for (const who of ['requester', 'exec', 'finance', 'probity', 'delegate'])
      expect((await call(who, 'POST', '/contract-ingest/uploads', { files })).statusCode, who).toBe(403);
    for (const who of ['requester', 'delegate', 'admin'])
      expect((await call(who, 'GET', '/contract-ingest/batches')).statusCode, who).toBe(403);
    for (const who of ['exec', 'finance', 'probity'])
      expect((await call(who, 'GET', '/contract-ingest/report')).statusCode, who).toBe(200);
    const { doc } = await ingestOne('office-licence', 'procurement');
    expect(
      (await call('exec', 'POST', `/contract-ingest/documents/${doc.id}/review`, { accept: true }))
        .statusCode,
    ).toBe(403);
    expect((await call('exec', 'POST', `/contract-ingest/documents/${doc.id}/commit`, {})).statusCode).toBe(
      403,
    );
    expect(
      (await call('procurement', 'PUT', '/contract-ingest/clause-library', { clauses: [] })).statusCode,
    ).toBe(403);
    expect((await call('exec', 'PUT', '/contract-ingest/config', { reviewThreshold: 0.9 })).statusCode).toBe(
      403,
    );
    expect((await call('legal', 'POST', '/contract-ingest/uploads', { files: [] })).statusCode).toBe(400);
  });

  it('CP-07 unsupported content is skipped with a reason and a batch with nothing readable is refused', async () => {
    const r = await upload('legal', [
      file('notes.txt', Buffer.from('just some notes, not a contract at all')),
    ]);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('NO_DOCUMENTS');
    const mixed = await upload('legal', [
      sample('saas-subscription'),
      file('notes.txt', Buffer.from('just some notes, not a contract')),
    ]);
    expect(mixed.json().skipped[0]).toMatchObject({ name: 'notes.txt' });
    // a scan without a fixture cannot be read by the simulated engine: the document FAILS, with the reason
    const png = await upload('legal', [
      file('scan.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])),
    ]);
    expect(png.json().documents[0]).toMatchObject({ status: 'FAILED' });
    expect(png.json().documents[0].failure).toContain('SIMULATED');
  });
});

describe('CP-07 malware gate and zip safety on the upload route', () => {
  it('CP-07 an infected file is refused 422 VIRUS_DETECTED, nothing echoed, quarantined and audited', async () => {
    const bad = Buffer.from(`%PDF-1.7\n${EICAR}`);
    const r = await upload('legal', [file('contract.pdf', bad)]);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('VIRUS_DETECTED');
    expect(r.body).not.toContain('EICAR');
    const q = await sys<Array<{ source: string }>>((tx) =>
      tx.select().from(s.quarantineItem).where(eq(s.quarantineItem.tenantId, TENANT_ID)),
    );
    expect(q.some((x) => x.source.includes('/contract-ingest/uploads'))).toBe(true);
    expect((await upload('legal', [file('invoice.pdf.exe', Buffer.from('%PDF-1.7 x'))])).json().code).toBe(
      'FILE_NAME_INVALID',
    );
  });

  it('CP-07 every entry of a zip is scanned: an infected entry inside a compressed zip is caught', async () => {
    const z = zip([
      { name: 'ok.pdf', data: buildSample('saas-subscription')!.bytes },
      { name: 'bad.pdf', data: Buffer.from(`%PDF-1.7 ${EICAR}`) },
    ]);
    const r = await upload('legal', [file('bundle.zip', z)]);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('VIRUS_DETECTED');
    expect(
      (await upload('legal', [file('bundle.zip', zip([{ name: 'run.exe', data: Buffer.from('x') }]))]))
        .statusCode,
    ).toBe(422);
  });

  it('CP-07 a zip of contracts is read, each entry becomes a document, a sidecar is paired, junk is ignored', async () => {
    const png = buildSample('scanned-security')!.bytes;
    const z = zip([
      { name: 'batch/a.pdf', data: buildSample('office-licence')!.bytes },
      { name: 'batch/b.pdf', data: buildSample('scanned-it-support')!.bytes },
      { name: '__MACOSX/._a.pdf', data: Buffer.from('junk') },
      { name: 'batch/readme.txt', data: Buffer.from('not a contract, please ignore this file') },
      { name: 'batch/c.png', data: png.subarray(0, png.indexOf('IF-SIMULATED-OCR-BEGIN') - 1) },
      {
        name: 'batch/c.png.ocr.json',
        data: Buffer.from(
          JSON.stringify({
            simulated: true,
            pages: [{ text: 'SIDECAR AGREEMENT\nAgreement number: SC-2026-0001', confidence: 0.9 }],
          }),
        ),
      },
    ]);
    const r = await upload('legal', [file('contracts.zip', z)]);
    expect(r.statusCode, r.body).toBe(201);
    const b = r.json() as Json;
    expect(b.documents.map((x: Json) => x.entryPath).sort()).toEqual([
      'batch/a.pdf',
      'batch/b.pdf',
      'batch/c.png',
    ]);
    expect(b.skipped).toEqual([{ name: 'batch/readme.txt', reason: 'not a PDF, PNG, JPG or TIFF' }]);
    expect(b.documents.find((x: Json) => x.entryPath === 'batch/c.png')).toMatchObject({
      simulated: true,
      contractNumber: 'SC-2026-0001',
    });
  });

  it('CP-07 path traversal and zip bombs are refused 422 and audited; nothing is created', async () => {
    const before = (await call('legal', 'GET', '/contract-ingest/batches')).json().items.length;
    const trav = await upload('legal', [
      file('x.zip', zip([{ name: '../../evil.pdf', data: Buffer.from('x') }])),
    ]);
    expect([trav.statusCode, trav.json().code]).toEqual([422, 'ZIP_PATH_TRAVERSAL']);
    const bomb = await upload('legal', [
      file('b.zip', zip([{ name: 'big.pdf', data: Buffer.alloc(30 * 1024 * 1024) }])),
    ]);
    expect([bomb.statusCode, bomb.json().code]).toEqual([422, 'ZIP_BOMB']);
    const lie = await upload('legal', [
      file('l.zip', zip([{ name: 'liar.pdf', data: Buffer.alloc(3 * 1024 * 1024), usize: 50 }])),
    ]);
    expect(lie.json().code).toBe('ZIP_BOMB');
    expect((await call('legal', 'GET', '/contract-ingest/batches')).json().items.length).toBe(before);
    const audit = await sys<Array<{ action: string; result: string }>>((tx) =>
      tx
        .select({ action: s.auditEvent.action, result: s.auditEvent.result })
        .from(s.auditEvent)
        .where(eq(s.auditEvent.action, 'cpocr.archive_refused')),
    );
    expect(audit.length).toBeGreaterThanOrEqual(3);
    expect(audit.every((a) => a.result === 'DENIED')).toBe(true);
  });
});

describe('CP-07 low-confidence review gate, corrections and commit effects', () => {
  let doc: Json;
  it('CP-07 a scanned image with flagged fields cannot be committed until reviewed (409 REVIEW_REQUIRED)', async () => {
    ({ doc } = await ingestOne('scanned-security'));
    expect(doc).toMatchObject({ status: 'NEEDS_REVIEW', simulated: true, label: 'SIMULATED recognition' });
    expect(doc.needsReview).toBeGreaterThanOrEqual(10);
    const r = await call('legal', 'POST', `/contract-ingest/documents/${doc.id}/commit`, {});
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('REVIEW_REQUIRED');
    expect(r.json().errors.map((e: Json) => e.field)).toContain('endDate');
  });

  it('CP-07 a required field that was not found cannot be accepted, only entered; a bad value is refused', async () => {
    const acc = await call('legal', 'POST', `/contract-ingest/documents/${doc.id}/review`, { accept: true });
    expect(acc.statusCode).toBe(422);
    expect(acc.json().code).toBe('CANNOT_ACCEPT_MISSING');
    const bad = await call('legal', 'POST', `/contract-ingest/documents/${doc.id}/review`, {
      corrections: [{ key: 'endDate', value: '31 Feb 2027' }],
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe('CORRECTION_INVALID');
    const still = (await call('legal', 'GET', `/contract-ingest/documents/${doc.id}`)).json() as Json;
    expect(still.corrections).toEqual([]); // the failed review changed nothing
  });

  it('CP-07 corrections keep before and after, are audited, and the review then lets the commit through', async () => {
    const r = await call('legal', 'POST', `/contract-ingest/documents/${doc.id}/review`, {
      corrections: [
        { key: 'endDate', value: '28 February 2027', reason: 'garbled in the scan' },
        { key: 'title', value: 'Security Guard Services Agreement (Redgum)' },
      ],
      accept: true,
    });
    expect(r.statusCode, r.body).toBe(200);
    const v = r.json() as Json;
    expect(v.status).toBe('READY');
    expect(field(v, 'endDate')).toMatchObject({
      value: '2027-02-28',
      status: 'CORRECTED',
      confidence: 1,
      reviewed: true,
    });
    expect(v.corrections).toHaveLength(2);
    expect(v.corrections.find((c: Json) => c.fieldKey === 'endDate')).toMatchObject({
      before: { value: null, status: 'NOT_FOUND' },
      after: { value: '2027-02-28' },
      reason: 'garbled in the scan',
    });
    const audit = await sys<Array<{ action: string; before: unknown; after: unknown }>>((tx) =>
      tx
        .select({ action: s.auditEvent.action, before: s.auditEvent.before, after: s.auditEvent.after })
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.action, 'cpocr.field_correct'), eq(s.auditEvent.entityId, doc.id))),
    );
    expect(audit).toHaveLength(2);
    const endAudit = audit.find((a) => (a.after as Json).field === 'endDate')!;
    expect(endAudit.before).toMatchObject({ value: null });
    expect(endAudit.after).toMatchObject({ value: '2027-02-28', reason: 'garbled in the scan' });
  });

  it('CP-07 commit creates the supplier and the contract record with key dates, value, clauses and the reminders', async () => {
    const r = await call('contract-mgr', 'POST', `/contract-ingest/documents/${doc.id}/commit`, {});
    expect(r.statusCode, r.body).toBe(200);
    const c = r.json() as Json;
    expect(c).toMatchObject({
      mode: 'CREATE',
      contractNumber: 'SEC-2026-0019',
      supplier: { company: 'Redgum Security Services Pty Ltd', created: true },
    });
    expect(c.document.status).toBe('COMMITTED');
    const kinds = (c.reminders as Json[]).map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(['NOTICE', 'EXPIRY', 'COUNTDOWN']));
    const rows = await sys<{ ct: typeof s.contract.$inferSelect; sup: typeof s.supplier.$inferSelect }[]>(
      (tx) =>
        tx
          .select({ ct: s.contract, sup: s.supplier })
          .from(s.contract)
          .innerJoin(s.supplier, eq(s.supplier.id, s.contract.supplierId))
          .where(eq(s.contract.id, c.contractId)),
    );
    const { ct, sup } = rows[0]!;
    expect(ct).toMatchObject({
      status: 'EXECUTED',
      locked: true,
      startDate: '2026-03-01',
      endDate: '2027-02-28',
      noticeDays: 30,
      sourceSystem: 'Contract OCR (CP-07)',
      title: 'Security Guard Services Agreement (Redgum)',
    });
    expect(Number(ct.value)).toBe(96000);
    expect(sup).toMatchObject({ abn: '39100000003', tenantId: TENANT_ID });
    const alerts = await sys<Array<typeof s.alert.$inferSelect>>((tx) =>
      tx.select().from(s.alert).where(eq(s.alert.contractId, c.contractId)),
    );
    expect(alerts.find((a) => a.kind === 'NOTICE')!.triggerDate).toBe('2026-11-30'); // 2027-02-28 less (30 days notice + 60 days lead)
    expect(alerts.find((a) => a.kind === 'EXPIRY')!.triggerDate).toBe('2026-12-30');
    const clauses = await sys<Array<typeof s.clause.$inferSelect>>((tx) =>
      tx.select().from(s.clause).where(eq(s.clause.contractId, c.contractId)),
    );
    expect(clauses.map((x) => x.clauseId)).toEqual(
      expect.arrayContaining(['OCR-TERMINATION_CONVENIENCE', 'OCR-CONFIDENTIALITY', 'OCR-PAYMENT']),
    );
    // visible through the existing contract routes, and the commit is audited twice (document and contract)
    expect((await call('contract-mgr', 'GET', `/contracts/${c.contractId}`)).statusCode).toBe(200);
    const au = await sys<Array<{ action: string }>>((tx) =>
      tx
        .select({ action: s.auditEvent.action })
        .from(s.auditEvent)
        .where(eq(s.auditEvent.entityId, c.contractId)),
    );
    expect(au.map((x) => x.action)).toContain('contract.create_from_ocr');
    const again = await call('contract-mgr', 'POST', `/contract-ingest/documents/${doc.id}/commit`, {});
    expect([again.statusCode, again.json().code]).toEqual([409, 'ALREADY_COMMITTED']);
  });

  it('CP-07 committing a clean document matches the existing supplier by ABN and creates no second supplier', async () => {
    const { doc: d1 } = await ingestOne('services-agreement');
    const r = await call('legal', 'POST', `/contract-ingest/documents/${d1.id}/commit`, {});
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().supplier).toMatchObject({
      id: uid('supplier:brightwave'),
      created: false,
      matchedBy: 'ABN',
    });
    expect((r.json().reminders as Json[]).some((x) => x.kind === 'EXTENSION')).toBe(true); // the two extension options
    const ct = (
      await sys<Array<typeof s.contract.$inferSelect>>((tx) =>
        tx.select().from(s.contract).where(eq(s.contract.id, r.json().contractId)),
      )
    )[0]!;
    expect(ct.noticeDays).toBe(90);
    const exts = await sys<Array<{ months: number }>>((tx) =>
      tx
        .select({ months: s.contractExtension.months })
        .from(s.contractExtension)
        .where(eq(s.contractExtension.contractId, ct.id)),
    );
    expect(exts.map((e) => e.months)).toEqual([12, 12]);
  });
});

describe('CP-07 duplicate handling', () => {
  it('CP-07 the same file twice is flagged; committing it again needs a decision; a similar supplier name is never linked silently', async () => {
    const first = await ingestOne('saas-subscription');
    const second = await ingestOne('saas-subscription');
    expect(second.doc.duplicateOf).toBeTruthy();
    for (const d of [first.doc, second.doc]) {
      const rv = await call('legal', 'POST', `/contract-ingest/documents/${d.id}/review`, { accept: true });
      expect(rv.statusCode, rv.body).toBe(200);
    }
    const ok = await call('legal', 'POST', `/contract-ingest/documents/${first.doc.id}/commit`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().value).toMatchObject({ amount: 180000, currency: 'USD' });
    const dupFile = await call('legal', 'POST', `/contract-ingest/documents/${second.doc.id}/commit`, {});
    expect([dupFile.statusCode, dupFile.json().code]).toEqual([409, 'DUPLICATE_FILE']);
    // the same contract arriving as a different file: the contract number matches an existing record
    const viaLink = await call('legal', 'POST', `/contract-ingest/documents/${second.doc.id}/commit`, {
      mode: 'LINK',
    });
    expect(viaLink.statusCode, viaLink.body).toBe(200);
    expect(viaLink.json()).toMatchObject({
      mode: 'LINK',
      contractId: ok.json().contractId,
      changed: false,
      differences: [],
    });
    // a third copy with allowDuplicate becomes a record of its own with its own number
    const third = await ingestOne('saas-subscription');
    await call('legal', 'POST', `/contract-ingest/documents/${third.doc.id}/review`, { accept: true });
    const blocked = await call('legal', 'POST', `/contract-ingest/documents/${third.doc.id}/commit`, {
      mode: 'CREATE',
    });
    expect([blocked.statusCode, blocked.json().code]).toEqual([409, 'DUPLICATE_FILE']);
    const allowed = await call('legal', 'POST', `/contract-ingest/documents/${third.doc.id}/commit`, {
      allowDuplicate: true,
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(allowed.json().contractNumber).not.toBe(ok.json().contractNumber);
  });

  it('CP-07 an existing contract is linked, never rewritten (it is locked); there is no UPDATE mode', async () => {
    const { doc } = await ingestOne('services-agreement');
    const num = (
      await sys<Array<{ id: string }>>((tx) =>
        tx.select({ id: s.contract.id }).from(s.contract).where(eq(s.contract.number, 'CT-2026-0001')),
      )
    )[0]!.id;
    // an executed contract is locked (FR-0455): there is no mode that rewrites it
    expect(
      (
        await call('legal', 'POST', `/contract-ingest/documents/${doc.id}/commit`, {
          mode: 'UPDATE',
          contractId: num,
        })
      ).statusCode,
    ).toBe(400);
    const before = (
      await sys<Array<typeof s.contract.$inferSelect>>((tx) =>
        tx.select().from(s.contract).where(eq(s.contract.id, num)),
      )
    )[0]!;
    const link = await call('legal', 'POST', `/contract-ingest/documents/${doc.id}/commit`, {
      mode: 'LINK',
      contractId: num,
      allowDuplicate: true,
    });
    expect(link.statusCode, link.body).toBe(200);
    expect(link.json()).toMatchObject({ mode: 'LINK', changed: false });
    expect(link.json().differences.map((x: Json) => x.field)).toContain('endDate');
    const after = (
      await sys<Array<typeof s.contract.$inferSelect>>((tx) =>
        tx.select().from(s.contract).where(eq(s.contract.id, num)),
      )
    )[0]!;
    expect(after.endDate).toBe(before.endDate);
    expect(after.version).toBe(before.version);
  });

  it('CP-07 a supplier with a similar name asks for confirmation (409 SUPPLIER_CONFIRM_NEEDED)', async () => {
    const lines = [
      'NORTHSTAR CARE AGREEMENT',
      'Agreement number: NS-2026-0001',
      '1. Parties',
      'This agreement is made between Meridian Group (demo) (the Customer) and Northstar Property Care Services Pty Ltd (the Supplier).',
      '2. Term',
      'The agreement commences on 1 March 2026 and ends on 28 February 2027.',
      '3. Price',
      'The total contract value is AUD $50,000.',
    ];
    const { pdfFromLines } = await import('./samples.js');
    const r = await upload('legal', [file('ns.pdf', pdfFromLines(lines))]);
    const doc = r.json().documents[0] as Json;
    await call('legal', 'POST', `/contract-ingest/documents/${doc.id}/review`, { accept: true });
    const full = (await call('legal', 'GET', `/contract-ingest/documents/${doc.id}`)).json() as Json;
    expect(full.matches.supplier.match).toBeNull();
    expect(full.matches.supplier.similar[0].company).toBe('Northstar Property Care Pty Ltd');
    const c = await call('legal', 'POST', `/contract-ingest/documents/${doc.id}/commit`, {});
    expect([c.statusCode, c.json().code]).toEqual([409, 'SUPPLIER_CONFIRM_NEEDED']);
    const ok = await call('legal', 'POST', `/contract-ingest/documents/${doc.id}/commit`, {
      supplierId: uid('supplier:northstar'),
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().supplier).toMatchObject({
      id: uid('supplier:northstar'),
      created: false,
      matchedBy: 'CHOSEN',
    });
  });
});

describe('CP-07 configuration, clause library and the report', () => {
  it('CP-07 the review threshold is configurable and applies to new uploads', async () => {
    expect((await call('legal', 'GET', '/contract-ingest/config')).json().reviewThreshold).toBe(0.8);
    expect((await call('legal', 'PUT', '/contract-ingest/config', { reviewThreshold: 0.2 })).statusCode).toBe(
      400,
    );
    expect(
      (await call('legal', 'PUT', '/contract-ingest/config', { reviewThreshold: 0.95 })).statusCode,
    ).toBe(200);
    const { doc } = await ingestOne('scanned-it-support');
    expect(doc.status).toBe('NEEDS_REVIEW');
    expect((await call('legal', 'PUT', '/contract-ingest/config', { reviewThreshold: 0.8 })).statusCode).toBe(
      200,
    );
    const au = await sys<Array<{ before: unknown; after: unknown }>>((tx) =>
      tx
        .select({ before: s.auditEvent.before, after: s.auditEvent.after })
        .from(s.auditEvent)
        .where(eq(s.auditEvent.action, 'cpocr.config_update')),
    );
    expect(au.length).toBeGreaterThanOrEqual(2);
  });

  it('CP-07 managers replace the clause library; detection then follows the new library', async () => {
    const lib = (await call('procurement', 'GET', '/contract-ingest/clause-library')).json() as Json;
    expect(lib.source).toBe('DEFAULT');
    expect(lib.clauses.length).toBe(15);
    const custom = [
      {
        key: 'PRIVACY_BREACH',
        title: 'Privacy breach notice',
        mandatory: true,
        risk: 'HIGH',
        keywords: ['data breach', 'notifiable'],
        standardText: 'The Supplier must notify the Customer of any notifiable data breach within 24 hours.',
        active: true,
      },
    ];
    expect(
      (await call('legal', 'PUT', '/contract-ingest/clause-library', { clauses: custom })).statusCode,
    ).toBe(200);
    const { doc } = await ingestOne('office-licence');
    const full = (await call('legal', 'GET', `/contract-ingest/documents/${doc.id}`)).json() as Json;
    expect(full.clauses.map((c: Json) => c.key)).toEqual(['PRIVACY_BREACH']);
    expect(full.findings.map((f: Json) => f.clauseKey)).toContain('PRIVACY_BREACH');
    // restore the defaults so the report below sees the full library
    await sys((tx) => tx.delete(s.cpOcrClauseType).where(eq(s.cpOcrClauseType.tenantId, TENANT_ID)));
  });

  it('CP-07 the report across ingested contracts has the right numbers', async () => {
    const rep = (await call('exec', 'GET', '/contract-ingest/report?days=365&scope=all')).json() as Json;
    expect(rep.totals.documents).toBeGreaterThanOrEqual(5);
    expect(rep.totals.committed).toBeGreaterThanOrEqual(3);
    // Redgum (committed above) ends 2027-02-28 with a 30-day notice: due inside the year, deadline 2027-01-29
    const redgum = (rep.renewalsDue as Json[]).find(
      (r) => r.title === 'Security Guard Services Agreement (Redgum)',
    )!;
    expect(redgum).toMatchObject({
      endDate: '2027-02-28',
      noticeDeadline: '2027-01-29',
      status: 'COMMITTED',
    });
    expect(redgum.daysToEnd).toBe(
      Math.round(
        (Date.parse('2027-02-28') - Date.parse(env.clock.now().toISOString().slice(0, 10))) / 86400000,
      ),
    );
    // the services agreement is fixed at AUD 2.5m on a 1.25m contract: 200% of value
    const cap = (rep.liabilityCaps.items as Json[]).find(
      (c) => c.title === 'Facilities Management Services Agreement',
    )!;
    expect(cap).toMatchObject({
      basis: 'FIXED',
      capAmount: 2500000,
      capPercentOfValue: 200,
      belowValue: false,
    });
    expect(rep.liabilityCaps.summary.feesBased).toBeGreaterThanOrEqual(1); // the SaaS agreement
    const miss = (rep.missingClauses.byClause as Json[]).find((c) => c.key === 'INDEMNITY')!;
    expect(miss.mandatory).toBe(true);
    expect(miss.count).toBeGreaterThanOrEqual(1);
    const bw = (rep.concentration.bySupplier as Json[]).find(
      (x) => x.supplier === 'Brightwave Cleaning Pty Ltd',
    )!;
    expect(bw.totalValue).toBe(1250000);
    expect(rep.concentration.bySupplier[0].supplier).toBe('Brightwave Cleaning Pty Ltd');
    const sumShares = (rep.concentration.bySupplier as Json[]).reduce((n, x) => n + x.share, 0);
    expect(Math.round(sumShares)).toBe(100);
    expect(
      (await call('exec', 'GET', '/contract-ingest/report?scope=committed')).json().totals.needsReview,
    ).toBe(0);
  });

  it('CP-07 sample ingestion works through the same pipeline and a rejected document leaves the report', async () => {
    const r = await call('legal', 'POST', '/contract-ingest/samples', { keys: ['office-licence'] });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().origin).toBe('SAMPLE');
    const id = r.json().documents[0].id as string;
    expect(
      (await call('legal', 'POST', `/contract-ingest/documents/${id}/reject`, { reason: 'Not ours' })).json()
        .status,
    ).toBe('REJECTED');
    expect((await call('legal', 'POST', `/contract-ingest/documents/${id}/commit`, {})).statusCode).toBe(409);
    expect((await call('legal', 'POST', '/contract-ingest/samples', { keys: ['nope'] })).statusCode).toBe(
      404,
    );
    expect((await call('exec', 'GET', '/contract-ingest/samples')).json().samples).toHaveLength(5);
  });
});

describe('CP-07 tenant isolation', () => {
  it("CP-07 another organisation never sees this one's ingested documents, by route or by row level security", async () => {
    const { doc } = await ingestOne('office-licence');
    const B = randomUUID();
    const bUser = randomUUID();
    await sys(async (tx) => {
      await tx.insert(s.tenant).values({
        id: B,
        slug: `cp-ocr-b-${B.slice(0, 6)}`,
        name: 'Other Org',
        sector: 'PRIVATE',
        config: {},
      });
      await tx.insert(s.appUser).values({
        id: bUser,
        tenantId: B,
        email: `u@${B.slice(0, 6)}.example`,
        name: 'B User',
        passwordHash: 'x',
      });
      const [b] = await tx
        .insert(s.cpOcrBatch)
        .values({ tenantId: B, createdBy: bUser, fileCount: 1, createdAt: new Date() })
        .returning();
      await tx.insert(s.cpOcrDocument).values({
        tenantId: B,
        batchId: b!.id,
        fileName: 'b.pdf',
        kind: 'PDF',
        sizeBytes: 1,
        sha256: 'b'.repeat(64),
        engine: 'x',
        status: 'READY',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    const ctxA: RequestContext = { tenantId: TENANT_ID, userId: uid('user:legal'), role: 'LEGAL' };
    const seenByA = await withContext(env.database, ctxA, (tx) => tx.select().from(s.cpOcrDocument));
    expect(seenByA.length).toBeGreaterThan(0);
    expect(seenByA.every((x) => x.tenantId === TENANT_ID)).toBe(true);
    const ctxB: RequestContext = { tenantId: B, userId: bUser, role: 'LEGAL' };
    const seenByB = await withContext(env.database, ctxB, (tx) => tx.select().from(s.cpOcrDocument));
    expect(seenByB.map((x) => x.fileName)).toEqual(['b.pdf']);
    expect(seenByB.some((x) => x.id === doc.id)).toBe(false);
    // writing into the other tenant is refused by the policy
    await expect(
      withContext(env.database, ctxA, (tx) =>
        tx.insert(s.cpOcrBatch).values({ tenantId: B, createdBy: bUser, createdAt: new Date() }),
      ),
    ).rejects.toThrow();
    const bDocId = seenByB[0]!.id;
    const r = await call('legal', 'GET', `/contract-ingest/documents/${bDocId}`);
    expect(r.statusCode).toBe(404);
    expect((await call('legal', 'POST', `/contract-ingest/documents/${bDocId}/commit`, {})).statusCode).toBe(
      404,
    );
  });
});
