import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type ManualClock } from '@if/shared';
import { buildApp } from '../../app.js';
import { withContext, withSystem, type Database } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { emailFor, seedDatabase, TENANT_ID, uid } from '../../db/seed.js';
import { freshDb, newClock } from '../../test-helpers.js';

const PASSWORD = 'unit-test-password-123';
const SUPPLIER_PW = 'Supplier-Test-Passw0rd-1';
const DAY = 86_400_000;
let app: FastifyInstance;
let database: Database;
let clock: ManualClock;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type Sess = { cookies: Record<string, string>; csrf: string };
const sessions = new Map<string, Sess>();
async function sessionFor(key: string, fresh = false): Promise<Sess> {
  if (!fresh && sessions.has(key)) return sessions.get(key)!;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: {
      email: key.includes('@') ? key : emailFor(key),
      password: key.includes('@') ? SUPPLIER_PW : PASSWORD,
    },
  });
  expect(res.statusCode, `${key}: ${res.body}`).toBe(200);
  const sess = {
    cookies: Object.fromEntries(res.cookies.map((c) => [c.name, c.value])),
    csrf: res.json().csrfToken as string,
  };
  sessions.set(key, sess);
  return sess;
}
async function call(key: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  const run = async (fresh: boolean) => {
    const sess = await sessionFor(key, fresh);
    return app.inject({
      method,
      url: `/api/v1${url}`,
      cookies: sess.cookies,
      headers: method === 'GET' ? {} : { 'x-csrf-token': sess.csrf },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  };
  const r = await run(false);
  return r.statusCode === 401 ? run(true) : r; // time travel ends sessions
}
const anon = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
const setting = async (name: string, value: unknown) => {
  const r = await call('admin', 'PUT', '/admin/settings', { [name]: value });
  expect(r.statusCode, r.body).toBe(200);
};

const PDF = Buffer.from('%PDF-1.7\nsample technical response');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]);
const b64 = (b: Buffer) => b.toString('base64');
const closeIn = (days: number) => new Date(clock.now().getTime() + days * DAY).toISOString();

let titleSeq = 0;
async function stagedTender(value = 90_000): Promise<Json> {
  const c = await call('requester', 'POST', '/requests', {
    title: `B8 tender fixture ${(titleSeq += 1)}`,
    category: 'Building cleaning (UNSPSC 76111500)',
    estimatedValue: value,
    termMonths: 24,
    businessUnit: 'Facilities',
    fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
  });
  expect(c.statusCode, c.body).toBe(201);
  const rid = c.json().id as string;
  expect((await call('requester', 'POST', `/requests/${rid}/submit`)).statusCode).toBe(200);
  const plan = (await call('procurement', 'GET', `/requests/${rid}/plan`)).json();
  expect((await call('procurement', 'POST', `/plans/${plan.id}/submit-for-approval`)).statusCode).toBe(200);
  expect(
    (await call('delegate', 'POST', `/plans/${plan.id}/decision`, { decision: 'APPROVE' })).statusCode,
  ).toBe(200);
  const t = await call('procurement', 'POST', '/tenders', { requestId: rid, type: 'RFT', access: 'CLOSED' });
  expect(t.statusCode, t.body).toBe(201);
  return t.json();
}
async function publish(t: Json, days = 30) {
  expect((await call('delegate', 'POST', `/tenders/${t.id}/publish-permission`, {})).statusCode).toBe(200);
  const p = await call('procurement', 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(days) });
  expect(p.statusCode, p.body).toBe(200);
  return p.json();
}

let abnCounter = 0;
function newAbn(): string {
  for (;;) {
    abnCounter += 1;
    const body = String(30_000_000 + abnCounter).padStart(9, '0');
    for (let c = 10; c < 100; c++) {
      const abn = `${c}${body}`;
      const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
      const sum = [...abn].reduce((acc, ch, i) => acc + (i === 0 ? Number(ch) - 1 : Number(ch)) * w[i]!, 0);
      if (sum % 89 === 0) return abn;
    }
  }
}
async function register(tenderId: string, name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, '')}@b8-bidder.example`;
  const inv = await call('procurement', 'POST', `/tenders/${tenderId}/invitations`, {
    invitees: [{ email, company: `${name} Pty Ltd` }],
  });
  expect(inv.statusCode, inv.body).toBe(201);
  const token = new URL(inv.json().invitations[0].registerPath, 'http://x').searchParams.get('token')!;
  const res = await anon('POST', '/supplier/register', {
    token,
    name: `${name} Contact`,
    email,
    company: `${name} Pty Ltd`,
    abn: newAbn(),
    password: SUPPLIER_PW,
  });
  expect(res.statusCode, res.body).toBe(201);
  return { key: email, supplierId: res.json().supplierId as string };
}
const upload = (key: string, tenderId: string, name: string, bytes: Buffer, section: string) =>
  call(key, 'POST', `/supplier/tenders/${tenderId}/submission/files`, {
    name,
    section,
    dataBase64: b64(bytes),
  });
const files = async (key: string, tenderId: string) => {
  expect((await upload(key, tenderId, 'technical.pdf', PDF, 'TECHNICAL')).statusCode).toBe(201);
  expect((await upload(key, tenderId, 'pricing.xlsx', ZIP, 'COMMERCIAL')).statusCode).toBe(201);
};
const cert = (limit: string, expiry: string) =>
  Buffer.from(
    `%PDF-1.7\nCertificate of currency\nInsurer: Harbour Mutual Insurance\nPolicy number: PL-48213\nPublic liability limit of liability ${limit}\nExpiry date: ${expiry}\n`,
  );
const sys = <T>(fn: Parameters<typeof withSystem>[1]) => withSystem(database, fn) as Promise<T>;

beforeAll(async () => {
  database = await freshDb();
  clock = newClock();
  await seedDatabase(database, { clock, password: PASSWORD });
  const storage = await mkdtemp(join(tmpdir(), 'if-b8-'));
  app = await buildApp(
    loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'c'.repeat(40), STORAGE_DIR: storage }),
    {
      database,
      clock,
      loginRateLimitMax: 10_000,
    },
  );
}, 120_000);

describe('FR-0130 interactive response schedules', () => {
  it('a bid is a form the supplier fills in: answers are checked, a bid with a required question blank is refused, and the answers are compared once the tender closes', async () => {
    const t = await stagedTender();
    const items = [
      {
        key: 'price',
        label: 'Total price for the term',
        section: 'COMMERCIAL',
        kind: 'NUMBER',
        required: true,
        unit: 'AUD',
      },
      {
        key: 'method',
        label: 'Describe your delivery method',
        section: 'TECHNICAL',
        kind: 'TEXT',
        required: true,
        maxLength: 200,
      },
      {
        key: 'insured',
        label: 'Do you hold public liability cover?',
        section: 'TECHNICAL',
        kind: 'YESNO',
        required: true,
      },
      { key: 'start', label: 'Earliest start date', section: 'TECHNICAL', kind: 'DATE', required: false },
      {
        key: 'tier',
        label: 'Service tier',
        section: 'COMMERCIAL',
        kind: 'CHOICE',
        required: false,
        options: ['Standard', 'Premium'],
      },
    ];
    expect((await call('requester', 'PUT', `/tenders/${t.id}/response-schedule`, { items })).statusCode).toBe(
      403,
    );
    const bad = await call('procurement', 'PUT', `/tenders/${t.id}/response-schedule`, {
      items: [{ ...items[4], options: ['One'] }],
    });
    expect(bad.statusCode).toBe(422);
    const dupe = await call('procurement', 'PUT', `/tenders/${t.id}/response-schedule`, {
      items: [items[0], items[0]],
    });
    expect(dupe.statusCode).toBe(422);
    const set = await call('procurement', 'PUT', `/tenders/${t.id}/response-schedule`, { items });
    expect(set.statusCode, set.body).toBe(200);
    await publish(t);
    // no longer editable once published
    expect(
      (await call('procurement', 'PUT', `/tenders/${t.id}/response-schedule`, { items })).statusCode,
    ).toBe(409);

    const a = await register(t.id, 'Alder');
    const b = await register(t.id, 'Birch');
    const form = (await call(a.key, 'GET', `/supplier/tenders/${t.id}/response`)).json();
    expect(form.items).toHaveLength(5);
    expect(form.missing.sort()).toEqual(['insured', 'method', 'price']);

    const wrong = await call(a.key, 'PUT', `/supplier/tenders/${t.id}/response`, {
      answers: { price: 'lots', insured: 'maybe', tier: 'Gold', ghost: 'x' },
    });
    expect(wrong.statusCode).toBe(422);
    expect((wrong.json().errors as Json[]).map((e) => e.field).sort()).toEqual([
      'ghost',
      'insured',
      'price',
      'tier',
    ]);

    await files(a.key, t.id);
    // files alone are not a bid any more: the required questions must be answered
    const early = await call(a.key, 'POST', `/supplier/tenders/${t.id}/submission`);
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe('RESPONSE_INCOMPLETE');
    expect((early.json().errors as Json[]).map((e) => e.field).sort()).toEqual([
      'insured',
      'method',
      'price',
    ]);

    const ok = await call(a.key, 'PUT', `/supplier/tenders/${t.id}/response`, {
      answers: {
        price: '$412,500',
        method: 'Day teams with a site supervisor.',
        insured: 'YES',
        tier: 'Premium',
      },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().answers.price).toBe('412500');
    expect(ok.json().missing).toEqual([]);
    expect((await call(a.key, 'POST', `/supplier/tenders/${t.id}/submission`)).statusCode).toBe(201);
    // a submitted bid cannot be edited without withdrawing it
    expect(
      (await call(a.key, 'PUT', `/supplier/tenders/${t.id}/response`, { answers: { price: '1' } }))
        .statusCode,
    ).toBe(409);

    await files(b.key, t.id);
    await call(b.key, 'PUT', `/supplier/tenders/${t.id}/response`, {
      answers: { price: '388000', method: 'Rotating crews.', insured: 'no' },
    });
    expect((await call(b.key, 'POST', `/supplier/tenders/${t.id}/submission`)).statusCode).toBe(201);

    // sealed until close
    const sealed = await call('procurement', 'GET', `/tenders/${t.id}/response-answers`);
    expect(sealed.statusCode).toBe(409);
    expect(sealed.json().code).toBe('TENDER_SEALED');
    clock.advanceDays(31);
    const open = (await call('procurement', 'GET', `/tenders/${t.id}/response-answers`)).json();
    expect(open.suppliers).toHaveLength(2);
    const price = open.rows.find((r: Json) => r.key === 'price');
    expect(price.lowest).toBe(388000);
    expect([...price.answers].sort()).toEqual(['388000', '412500']);
    // the other supplier cannot see any of it
    expect((await call(b.key, 'GET', `/tenders/${t.id}/response-answers`)).statusCode).toBe(403);
    expect((await call('requester', 'GET', `/tenders/${t.id}/response-answers`)).statusCode).toBe(403);
  });
});

describe('FR-0175 dual-witness opening of sealed bids', () => {
  const bidAndClose = async (t: Json) => {
    const a = await register(t.id, `Witness${(titleSeq += 1)}`);
    await files(a.key, t.id);
    expect((await call(a.key, 'POST', `/supplier/tenders/${t.id}/submission`)).statusCode).toBe(201);
    clock.advanceDays(31);
  };
  /** How many of this tender's bid files a procurement officer can read, straight from the database. */
  const fileCount = (tenderId: string) =>
    withContext(
      database,
      { tenantId: TENANT_ID, userId: uid('user:procurement'), role: 'PROCUREMENT' },
      async (tx) => {
        const r = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(s.fileObject)
          .innerJoin(s.submission, eq(s.submission.id, s.fileObject.submissionId))
          .where(eq(s.submission.tenderId, tenderId));
        return r[0]!.n;
      },
    );

  it('a tender at or above the value threshold, or asked for, stays shut after close until two different, independent people confirm', async () => {
    await setting('tenderRules', { dualWitnessThresholdAud: 50_000, witnessWindowMinutes: 30 });
    const t = await stagedTender(90_000); // over the threshold: sealed without being asked
    await publish(t);
    const row = await sys<Json[]>((tx) => tx.select().from(s.tender).where(eq(s.tender.id, t.id)));
    expect(row[0]!.dualWitness).toBe(true);
    await bidAndClose(t);

    const staff = (await call('procurement', 'GET', `/tenders/${t.id}`)).json();
    expect(staff.dualWitness).toBe(true);
    expect(staff.submissions.sealed).toBe(true);
    expect(staff.submissions.items).toBeUndefined();
    // sealed in the database as well, not only on the screen
    expect(await fileCount(t.id)).toBe(0);
    expect((await call('procurement', 'GET', `/tenders/${t.id}/response-answers`)).json().code).toBe(
      'BIDS_SEALED',
    );
    const blocked = await call('procurement', 'POST', `/tenders/${t.id}/evaluation`, {
      panel: [{ userId: uid('user:evaluator-tech'), stream: 'TECHNICAL' }],
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('BIDS_SEALED');

    expect(
      (await call('requester', 'POST', `/tenders/${t.id}/opening/witness`, { password: PASSWORD }))
        .statusCode,
    ).toBe(403);
    const wrong = await call('probity', 'POST', `/tenders/${t.id}/opening/witness`, {
      password: 'not-the-password',
    });
    expect(wrong.statusCode).toBe(401);
    const first = await call('probity', 'POST', `/tenders/${t.id}/opening/witness`, { password: PASSWORD });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().opened).toBe(false);
    const again = await call('probity', 'POST', `/tenders/${t.id}/opening/witness`, { password: PASSWORD });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ALREADY_WITNESSED');
    const state = (await call('legal', 'GET', `/tenders/${t.id}/opening`)).json();
    expect(state.witnesses).toHaveLength(1);
    expect(state.opened).toBe(false);

    const second = await call('legal', 'POST', `/tenders/${t.id}/opening/witness`, { password: PASSWORD });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().opened).toBe(true);
    expect(await fileCount(t.id)).toBeGreaterThan(0);
    const open = (await call('procurement', 'GET', `/tenders/${t.id}`)).json();
    expect(open.submissions.sealed).toBe(false);
    expect(open.submissions.items).toHaveLength(1);
    expect(
      (await call('procurement', 'POST', `/tenders/${t.id}/opening/witness`, { password: PASSWORD })).json()
        .code,
    ).toBe('ALREADY_OPENED');
    const log = (
      await sys<Json[]>((tx) => tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, t.id)))
    ).map((e) => e.action);
    expect(log).toContain('tender.witness');
    expect(log).toContain('tender.bids_opened');
  });

  it('the first witness counts only for the window: a second who comes too late does not open the bids', async () => {
    await setting('tenderRules', { dualWitnessThresholdAud: 50_000, witnessWindowMinutes: 30 });
    const t = await stagedTender(90_000);
    await publish(t);
    await bidAndClose(t);
    expect(
      (await call('probity', 'POST', `/tenders/${t.id}/opening/witness`, { password: PASSWORD })).json()
        .opened,
    ).toBe(false);
    clock.advanceMs(31 * 60_000);
    const late = await call('legal', 'POST', `/tenders/${t.id}/opening/witness`, { password: PASSWORD });
    expect(late.statusCode, late.body).toBe(200);
    expect(late.json().opened).toBe(false);
    expect(late.json().witnesses).toBe(1);
    // the first person can come back within the new window and complete it
    const done = await call('probity', 'POST', `/tenders/${t.id}/opening/witness`, { password: PASSWORD });
    expect(done.json().opened).toBe(true);
  });

  it('an ordinary tender below the threshold opens as before', async () => {
    await setting('tenderRules', { dualWitnessThresholdAud: 5_000_000, witnessWindowMinutes: 30 });
    const t = await stagedTender(90_000);
    await publish(t);
    await bidAndClose(t);
    const staff = (await call('procurement', 'GET', `/tenders/${t.id}`)).json();
    expect(staff.dualWitness).toBe(false);
    expect(staff.submissions.items).toHaveLength(1);
    expect(
      (await call('probity', 'POST', `/tenders/${t.id}/opening/witness`, { password: PASSWORD })).json().code,
    ).toBe('NOT_REQUIRED');
    // asking for it on the pack works too
    const t2 = await stagedTender(90_000);
    expect(
      (await call('procurement', 'PUT', `/tenders/${t2.id}/requirements`, { dualWitness: true })).statusCode,
    ).toBe(200);
    await publish(t2);
    await bidAndClose(t2);
    expect((await call('procurement', 'GET', `/tenders/${t2.id}`)).json().submissions.sealed).toBe(true);
  });
});

describe('FR-0185 insurance certificates are read and checked against the cover a tender requires', () => {
  it('reads the limit and expiry from a certificate, and blocks a bid when cover is below what the tender requires or has expired', async () => {
    const t = await stagedTender();
    expect(
      (await call('procurement', 'PUT', `/tenders/${t.id}/requirements`, { requiredCover: 20_000_000 }))
        .statusCode,
    ).toBe(200);
    await publish(t);
    const a = await register(t.id, 'Cedar');
    await files(a.key, t.id);

    // nothing on file yet
    const none = await call(a.key, 'POST', `/supplier/tenders/${t.id}/submission`);
    expect(none.statusCode).toBe(409);
    expect(none.json().code).toBe('INSURANCE_BELOW_REQUIRED');

    const up = await call(a.key, 'PUT', '/supplier/profile/insurance-certificate', {
      name: 'certificate.pdf',
      dataBase64: b64(cert('$10 million', '31 Dec 2027')),
    });
    expect(up.statusCode, up.body).toBe(200);
    expect(up.json().readable).toBe(true);
    expect(up.json().reading).toMatchObject({
      coverAud: 10_000_000,
      expiresOn: '2027-12-31',
      insurer: 'Harbour Mutual Insurance',
      policyNumber: 'PL-48213',
    });
    expect(up.json().model).toBe('rules-simulated-v1');
    const sup = await sys<Json[]>((tx) =>
      tx.select().from(s.supplier).where(eq(s.supplier.id, a.supplierId)),
    );
    expect(sup[0]!.insuranceStatus).toBe('CURRENT');
    expect(sup[0]!.insuranceExpiresOn).toBe('2027-12-31');

    const view = (await call(a.key, 'GET', `/supplier/tenders/${t.id}/response`)).json();
    expect(view.requiredCover).toBe(20_000_000);
    expect(view.cover.ok).toBe(false);
    const low = await call(a.key, 'POST', `/supplier/tenders/${t.id}/submission`);
    expect(low.statusCode).toBe(409);
    expect(low.json().code).toBe('INSURANCE_BELOW_REQUIRED');
    expect(low.json().title).toMatch(/below the 20,000,000/);

    // a better certificate lets the bid through
    expect(
      (
        await call(a.key, 'PUT', '/supplier/profile/insurance-certificate', {
          name: 'certificate.pdf',
          dataBase64: b64(cert('$25m', '2027-12-31')),
        })
      ).json().reading.coverAud,
    ).toBe(25_000_000);
    expect((await call(a.key, 'POST', `/supplier/tenders/${t.id}/submission`)).statusCode).toBe(201);
  });

  it('a certificate that cannot be read is not trusted, and an infected file is refused', async () => {
    const t = await stagedTender();
    await publish(t);
    const a = await register(t.id, 'Dogwood');
    const junk = await call(a.key, 'PUT', '/supplier/profile/insurance-certificate', {
      name: 'scan.pdf',
      dataBase64: b64(Buffer.from('%PDF-1.7\nA photograph of a building')),
    });
    expect(junk.statusCode).toBe(200);
    expect(junk.json().readable).toBe(false);
    expect(junk.json().applied).toBe(false);
    expect(junk.json().reading.notes.length).toBeGreaterThan(0);
    const eicar = await call(a.key, 'PUT', '/supplier/profile/insurance-certificate', {
      name: 'virus.pdf',
      dataBase64: b64(Buffer.from('%PDF-1.7\nEICAR-STANDARD-ANTIVIRUS-TEST-FILE')),
    });
    expect(eicar.statusCode).toBe(422);
    // expired cover does not satisfy a requirement
    const t2 = await stagedTender();
    expect(
      (await call('procurement', 'PUT', `/tenders/${t2.id}/requirements`, { requiredCover: 1_000_000 }))
        .statusCode,
    ).toBe(200);
    await publish(t2);
    const b = await register(t2.id, 'Elmwood');
    await files(b.key, t2.id);
    await call(b.key, 'PUT', '/supplier/profile/insurance-certificate', {
      name: 'old.pdf',
      dataBase64: b64(cert('$5 million', '2026-01-31')),
    });
    const exp = await call(b.key, 'POST', `/supplier/tenders/${t2.id}/submission`);
    expect(exp.statusCode).toBe(409);
    expect(exp.json().title).toMatch(/expired/);
  });
});
