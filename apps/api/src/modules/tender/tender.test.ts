import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
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
let storage: string;

type Sess = { cookies: Record<string, string>; csrf: string };
const sessions = new Map<string, Sess>();
async function login(email: string, password: string): Promise<Sess> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode, res.body).toBe(200);
  return {
    cookies: Object.fromEntries(res.cookies.map((c) => [c.name, c.value])),
    csrf: res.json().csrfToken as string,
  };
}
async function sessionFor(key: string): Promise<Sess> {
  const email = key.includes('@') ? key : emailFor(key);
  const pw = key.includes('@') ? SUPPLIER_PW : PASSWORD;
  if (!sessions.has(key)) sessions.set(key, await login(email, pw));
  return sessions.get(key)!;
}
async function call(key: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  const sess = await sessionFor(key);
  return app.inject({
    method,
    url: `/api/v1${url}`,
    cookies: sess.cookies,
    headers: method === 'GET' ? {} : { 'x-csrf-token': sess.csrf },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}
const anon = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

// ---------------------------------------------------------------- fixtures
const PDF = Buffer.from('%PDF-1.7\nsample technical response');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]);
const b64 = (b: Buffer) => b.toString('base64');
const closeIn = (days: number) => new Date(clock.now().getTime() + days * DAY).toISOString();

let titleSeq = 0;
async function approvedRequest(value = 90_000): Promise<string> {
  const c = await call('requester', 'POST', '/requests', {
    title: `Tender fixture ${(titleSeq += 1)}`,
    category: 'Building cleaning (UNSPSC 76111500)',
    estimatedValue: value,
    termMonths: 24,
    businessUnit: 'Facilities',
    fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
  });
  expect(c.statusCode, c.body).toBe(201);
  const id = c.json().id as string;
  expect((await call('requester', 'POST', `/requests/${id}/submit`)).statusCode).toBe(200);
  const plan = (await call('procurement', 'GET', `/requests/${id}/plan`)).json();
  expect((await call('procurement', 'POST', `/plans/${plan.id}/submit-for-approval`)).statusCode).toBe(200);
  const ok = await call('delegate', 'POST', `/plans/${plan.id}/decision`, { decision: 'APPROVE' });
  expect(ok.statusCode, ok.body).toBe(200);
  return id;
}
type Tender = {
  id: string;
  status: string;
  version: number;
  fields: Array<{ key: string; value: string }>;
  permission: { granted: boolean; by?: string };
  questions: Array<Record<string, unknown>>;
  addenda: Array<{ number: number }>;
  invitations: Array<{ email: string; state: string }>;
  submissions: { count: number; sealed: boolean; items?: Array<{ company: string; receipt: string }> };
  permissions: Record<string, boolean>;
};
async function stagedTender(opts: { value?: number; type?: string; access?: string } = {}): Promise<Tender> {
  const rid = await approvedRequest(opts.value);
  const r = await call('procurement', 'POST', '/tenders', {
    requestId: rid,
    type: opts.type ?? 'RFT',
    access: opts.access ?? 'CLOSED',
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as Tender;
}
async function publishedTender(opts: { access?: string; days?: number } = {}): Promise<Tender> {
  const t = await stagedTender(opts.access ? { access: opts.access } : {});
  expect((await call('delegate', 'POST', `/tenders/${t.id}/publish-permission`, {})).statusCode).toBe(200);
  const p = await call('procurement', 'POST', `/tenders/${t.id}/publish`, {
    closesAt: closeIn(opts.days ?? 30),
  });
  expect(p.statusCode, p.body).toBe(200);
  return p.json() as Tender;
}

let abnCounter = 0;
/** A valid ABN that differs per call (the checksum is real, so compute the two check digits). */
function newAbn(): string {
  for (;;) {
    abnCounter += 1;
    const body = String(10_000_000 + abnCounter).padStart(9, '0');
    for (let c = 0; c < 100; c++) {
      const abn = `${String(c).padStart(2, '0')}${body}`;
      const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
      const sum = [...abn].reduce((acc, ch, i) => acc + (i === 0 ? Number(ch) - 1 : Number(ch)) * w[i]!, 0);
      if (abn[0] !== '0' && sum % 89 === 0) return abn;
    }
  }
}
interface Sup {
  key: string;
  email: string;
  abn: string;
  company: string;
}
/** Invites a new contact to the tender and registers them through the real link. */
async function invitedSupplier(tenderId: string, name: string): Promise<Sup> {
  const email = `${name}@bidder-${abnCounter + 1}.example`;
  const company = `${name} Pty Ltd`;
  const inv = await call('procurement', 'POST', `/tenders/${tenderId}/invitations`, {
    invitees: [{ email, company }],
  });
  expect(inv.statusCode, inv.body).toBe(201);
  const token = new URL(inv.json().invitations[0].registerPath, 'http://x').searchParams.get('token')!;
  const abn = newAbn();
  const reg = await anon('POST', '/supplier/register', {
    token,
    name: `${name} Contact`,
    email,
    company,
    abn,
    password: SUPPLIER_PW,
  });
  expect(reg.statusCode, reg.body).toBe(201);
  return { key: email, email, abn, company };
}
const upload = (key: string, tenderId: string, name: string, bytes: Buffer, section = 'TECHNICAL') =>
  call(key, 'POST', `/supplier/tenders/${tenderId}/submission/files`, {
    name,
    section,
    dataBase64: b64(bytes),
  });
async function fullBid(key: string, tenderId: string) {
  expect((await upload(key, tenderId, 'technical.pdf', PDF, 'TECHNICAL')).statusCode).toBe(201);
  expect((await upload(key, tenderId, 'pricing.xlsx', ZIP, 'COMMERCIAL')).statusCode).toBe(201);
}

beforeAll(async () => {
  database = await freshDb();
  clock = newClock();
  await seedDatabase(database, { clock, password: PASSWORD });
  storage = await mkdtemp(join(tmpdir(), 'if-tender-'));
  app = await buildApp(
    loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 't'.repeat(40), STORAGE_DIR: storage }),
    { database, clock, loginRateLimitMax: 10_000 },
  );
}, 120_000);

// =================================================================== US-TND-01
describe('US-TND-01 tender pack from the approved plan', () => {
  it('generates a staged pack with every section filled, from the plan, and never includes the budget', async () => {
    const t = await stagedTender({ type: 'RFP' });
    expect(t.status).toBe('STAGED');
    expect(t.fields).toHaveLength(9);
    for (const f of t.fields) expect(f.value.length, f.key).toBeGreaterThan(10);
    expect(t.fields.find((f) => f.key === 'requirements')!.value).toMatch(/Cleaning of all nominated sites/);
    expect(JSON.stringify(t.fields)).not.toMatch(/90,000|90000/);
    expect(t.permissions).toMatchObject({ canEdit: true, canPublish: false, canInvite: true });
    expect(t.permission.granted).toBe(false);
  });

  it('refuses a second pack for the same request, an unknown request, a request with no plan, and non-procurement roles', async () => {
    const t = await stagedTender();
    const view = (await call('procurement', 'GET', `/tenders/${t.id}`)).json();
    const dup = await call('procurement', 'POST', '/tenders', { requestId: view.requestId, type: 'RFT' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('TENDER_EXISTS');
    const none = await call('procurement', 'POST', '/tenders', { requestId: uid('nope'), type: 'RFT' });
    expect(none.statusCode).toBe(404);
    const c = await call('requester', 'POST', '/requests', {
      title: 'No plan yet',
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: 50_000,
      termMonths: 12,
      businessUnit: 'Facilities',
      fields: { contractOwner: 'Sofia Rossi' },
    });
    await call('requester', 'POST', `/requests/${c.json().id}/submit`);
    const np = await call('procurement', 'POST', '/tenders', { requestId: c.json().id, type: 'RFT' });
    expect(np.statusCode).toBe(409);
    expect(np.json().code).toBe('PLAN_REQUIRED');
    expect(
      (await call('requester', 'POST', '/tenders', { requestId: view.requestId, type: 'RFT' })).statusCode,
    ).toBe(403);
    expect(
      (await call('delegate', 'POST', '/tenders', { requestId: view.requestId, type: 'RFT' })).statusCode,
    ).toBe(403);
  });

  it('procurement and legal can edit while staged; a stale version is refused; published packs are locked (423)', async () => {
    const t = await stagedTender();
    const ok = await call('legal', 'PUT', `/tenders/${t.id}/fields/conditions`, {
      value: 'Edited by legal.',
      expectedVersion: t.version,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().fields.find((f: { key: string }) => f.key === 'conditions').value).toBe(
      'Edited by legal.',
    );
    const stale = await call('procurement', 'PUT', `/tenders/${t.id}/fields/scope`, {
      value: 'x',
      expectedVersion: t.version,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('VERSION_CONFLICT');
    const bad = await call('procurement', 'PUT', `/tenders/${t.id}/fields/nonsense`, {
      value: 'x',
      expectedVersion: ok.json().version,
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (await call('delegate', 'PUT', `/tenders/${t.id}/fields/scope`, { value: 'x', expectedVersion: 1 }))
        .statusCode,
    ).toBe(403);
    await call('delegate', 'POST', `/tenders/${t.id}/publish-permission`, {});
    const pub = await call('procurement', 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(30) });
    expect(pub.statusCode, pub.body).toBe(200);
    const locked = await call('procurement', 'PUT', `/tenders/${t.id}/fields/scope`, {
      value: 'late edit',
      expectedVersion: pub.json().version,
    });
    expect(locked.statusCode).toBe(423);
    expect(locked.json().code).toBe('TENDER_LOCKED');
  });
});

// =================================================================== US-TND-02
describe('US-TND-02 staged until a delegate gives permission', () => {
  it('a staged tender is invisible to suppliers even when they are invited, and Publish is refused without permission', async () => {
    const t = await stagedTender();
    const sup = await invitedSupplier(t.id, 'earlybird');
    const list = await call(sup.key, 'GET', '/supplier/tenders');
    expect(list.json()).toEqual([]);
    expect((await call(sup.key, 'GET', `/supplier/tenders/${t.id}`)).statusCode).toBe(404);
    const pub = await call('procurement', 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(30) });
    expect(pub.statusCode).toBe(409);
    expect(pub.json().code).toBe('PERMISSION_REQUIRED');
  });

  it('only a delegate can give permission, once, stamped; it is audited; procurement is told', async () => {
    const t = await stagedTender();
    expect((await call('procurement', 'POST', `/tenders/${t.id}/publish-permission`, {})).statusCode).toBe(
      403,
    );
    expect((await call('exec', 'POST', `/tenders/${t.id}/publish-permission`, {})).statusCode).toBe(403);
    const ok = await call('delegate', 'POST', `/tenders/${t.id}/publish-permission`, { comment: 'Go.' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().permission).toMatchObject({ granted: true });
    expect(ok.json().permission.by).toContain('PERMISSION TO PUBLISH');
    expect((await call('delegate', 'POST', `/tenders/${t.id}/publish-permission`, {})).json().code).toBe(
      'ALREADY_PERMITTED',
    );
    const rows = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, t.id), eq(s.auditEvent.action, 'tender.publish_permission'))),
    );
    expect(rows).toHaveLength(1);
  });

  it('the delegate cannot give permission above their publishing authority (403 with the limit)', async () => {
    const t = await stagedTender();
    const v = (await call('procurement', 'GET', `/tenders/${t.id}`)).json();
    await withSystem(database, (tx) =>
      tx.update(s.request).set({ estimatedValue: '9000000.00' }).where(eq(s.request.id, v.requestId)),
    );
    const no = await call('delegate', 'POST', `/tenders/${t.id}/publish-permission`, {});
    expect(no.statusCode).toBe(403);
    expect(no.json().code).toBe('DELEGATION_EXCEEDED');
    expect(no.json().title).toContain('$5,000,000');
  });

  it('publishing needs an approved plan (even with permission)', async () => {
    const rid = await approvedRequest(60_000);
    const t = (
      await call('procurement', 'POST', '/tenders', { requestId: rid, type: 'RFQ' })
    ).json() as Tender;
    await call('delegate', 'POST', `/tenders/${t.id}/publish-permission`, {});
    await call(
      'procurement',
      'POST',
      `/plans/${(await call('procurement', 'GET', `/requests/${rid}/plan`)).json().id}/reopen`,
      {
        reason: 'Scope changed after approval',
      },
    );
    const pub = await call('procurement', 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(30) });
    expect(pub.statusCode).toBe(409);
    expect(pub.json().code).toBe('PLAN_NOT_APPROVED');
  });

  it('statutory window (US-TND-04): 10 days is refused with the numbers; exactly 25 days publishes, visible to invited suppliers', async () => {
    const t = await stagedTender();
    await call('delegate', 'POST', `/tenders/${t.id}/publish-permission`, {});
    const sup = await invitedSupplier(t.id, 'windowco');
    const short = await call('procurement', 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(10) });
    expect(short.statusCode).toBe(422);
    expect(short.json().code).toBe('STATUTORY_WINDOW');
    expect(short.json().title).toMatch(/10 day.*at least 25/);
    const past = await call('procurement', 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(-1) });
    expect(past.statusCode).toBe(422);
    expect((await call(sup.key, 'GET', '/supplier/tenders')).json()).toEqual([]);
    const ok = await call('procurement', 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(25) });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().status).toBe('PUBLISHED');
    const mine = (await call(sup.key, 'GET', '/supplier/tenders')).json();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: t.id, status: 'PUBLISHED', submissionStatus: 'NOT_STARTED' });
    const again = await call('procurement', 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(30) });
    expect(again.statusCode).toBe(409);
  });
});

// =================================================================== US-SUP-01
describe('US-SUP-01 invitation and self-registration', () => {
  it('shows the one-time link once (only a hash is stored), pre-fills registration, and a used link stops working', async () => {
    const t = await stagedTender();
    const email = 'link@onetime.example';
    const inv = await call('procurement', 'POST', `/tenders/${t.id}/invitations`, {
      invitees: [{ email, company: 'Onetime Pty Ltd' }],
    });
    const path = inv.json().invitations[0].registerPath as string;
    const token = new URL(path, 'http://x').searchParams.get('token')!;
    const row = (
      await withSystem(database, (tx) =>
        tx.select().from(s.invitation).where(eq(s.invitation.tenderId, t.id)),
      )
    )[0]!;
    expect(row.tokenHash).not.toContain(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify((await call('procurement', 'GET', `/tenders/${t.id}`)).json())).not.toContain(
      token,
    );
    const info = await anon('GET', `/supplier/invitations/${token}`);
    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({ email, company: 'Onetime Pty Ltd' });
    expect((await anon('GET', `/supplier/invitations/${'x'.repeat(43)}`)).statusCode).toBe(404);
    const reg = await anon('POST', '/supplier/register', {
      token,
      name: 'Olive One',
      email,
      company: 'Onetime Pty Ltd',
      abn: newAbn(),
      password: SUPPLIER_PW,
    });
    expect(reg.statusCode, reg.body).toBe(201);
    expect(reg.json().sanctionsStatus).toBe('CLEAR'); // screened at registration (FR-0180)
    expect((await anon('GET', `/supplier/invitations/${token}`)).statusCode).toBe(404);
    const again = await anon('POST', '/supplier/register', {
      token,
      name: 'Olive Two',
      email: 'other@onetime.example',
      company: 'X Pty',
      abn: newAbn(),
      password: SUPPLIER_PW,
    });
    expect(again.statusCode).toBe(404);
    const me = await call(email, 'GET', '/auth/me');
    expect(me.json()).toMatchObject({ role: 'SUPPLIER', homePath: '/supplier' });
    const sess = await sessionFor(email);
    expect(Object.keys(sess.cookies)).toEqual(['if_supplier_session']);
  });

  it('rejects a bad ABN and a weak password with field errors; the same email twice gives one generic answer', async () => {
    const t = await stagedTender();
    const mk = async (email: string) => {
      const r = await call('procurement', 'POST', `/tenders/${t.id}/invitations`, {
        invitees: [{ email, company: 'Valid Pty Ltd' }],
      });
      return new URL(r.json().invitations[0].registerPath, 'http://x').searchParams.get('token')!;
    };
    const token = await mk('abn@check.example');
    const badAbn = await anon('POST', '/supplier/register', {
      token,
      name: 'A B',
      email: 'abn@check.example',
      company: 'Valid Pty Ltd',
      abn: '12345678901',
      password: SUPPLIER_PW,
    });
    expect(badAbn.statusCode).toBe(400);
    expect(badAbn.json().errors[0].field).toBe('abn');
    const weak = await anon('POST', '/supplier/register', {
      token,
      name: 'A B',
      email: 'abn@check.example',
      company: 'Valid Pty Ltd',
      abn: newAbn(),
      password: 'aaaaaaaaaaaaaaaa',
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().errors[0].field).toBe('password');
    const ok = await anon('POST', '/supplier/register', {
      token,
      name: 'A B',
      email: 'abn@check.example',
      company: 'Valid Pty Ltd',
      abn: newAbn(),
      password: SUPPLIER_PW,
    });
    expect(ok.statusCode).toBe(201);
    const token2 = await mk('second@check.example');
    const dupe = await anon('POST', '/supplier/register', {
      token: token2,
      name: 'C D',
      email: 'abn@check.example',
      company: 'Valid Pty Ltd',
      abn: newAbn(),
      password: SUPPLIER_PW,
    });
    expect(dupe.statusCode).toBe(409);
    expect(dupe.json().code).toBe('REGISTRATION_FAILED');
    expect(
      (
        await call('procurement', 'POST', `/tenders/${t.id}/invitations`, {
          invitees: [{ email: 'abn@check.example', company: 'X Pty' }],
        })
      ).json().code,
    ).toBe('ALREADY_INVITED');
  });

  it("an ABN that is already in the directory cannot be joined by self-registration (it would expose that company's tenders)", async () => {
    const t = await stagedTender();
    const inv = await call('procurement', 'POST', `/tenders/${t.id}/invitations`, {
      invitees: [{ email: 'imposter@elsewhere.example', company: 'Imposter Pty Ltd' }],
    });
    const token = new URL(inv.json().invitations[0].registerPath, 'http://x').searchParams.get('token')!;
    const seeded = (
      await withSystem(database, (tx) =>
        tx
          .select()
          .from(s.supplier)
          .where(eq(s.supplier.id, uid('supplier:brightwave'))),
      )
    )[0]!;
    const r = await anon('POST', '/supplier/register', {
      token,
      name: 'Imposter',
      email: 'imposter@elsewhere.example',
      company: 'Imposter Pty Ltd',
      abn: seeded.abn,
      password: SUPPLIER_PW,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('REGISTRATION_FAILED');
    // nothing was created, and the invitation is still unused
    const users = await withSystem(database, (tx) =>
      tx.select().from(s.appUser).where(eq(s.appUser.email, 'imposter@elsewhere.example')),
    );
    expect(users).toEqual([]);
    expect((await anon('GET', `/supplier/invitations/${token}`)).statusCode).toBe(200);
  });

  it('open-access tenders: a supplier can register without an invitation and sees open tenders only', async () => {
    const open = await publishedTender({ access: 'OPEN' });
    const closed = await publishedTender();
    const email = 'walkin@open.example';
    const reg = await anon('POST', '/supplier/register', {
      name: 'Wally Walkin',
      email,
      company: 'Walkin Pty Ltd',
      abn: newAbn(),
      password: SUPPLIER_PW,
    });
    expect(reg.statusCode, reg.body).toBe(201);
    const ids = (await call(email, 'GET', '/supplier/tenders')).json().map((x: { id: string }) => x.id);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(closed.id);
    expect((await call(email, 'GET', `/supplier/tenders/${closed.id}`)).statusCode).toBe(404);
  });
});

// =================================================================== US-SUP-02
describe('US-SUP-02 a supplier sees only the tender they are invited to (IDOR)', () => {
  it('another supplier gets a 404 (and an audit entry) for every supplier endpoint on a tender they are not part of', async () => {
    const a = await publishedTender();
    const b = await publishedTender();
    const supA = await invitedSupplier(a.id, 'alpha');
    const supB = await invitedSupplier(b.id, 'bravo');
    expect((await call(supA.key, 'GET', `/supplier/tenders/${a.id}`)).statusCode).toBe(200);
    // (open-access tenders are visible to every supplier by design, so check ours is in and the other closed one is out)
    const mine = (await call(supA.key, 'GET', '/supplier/tenders')).json().map((x: { id: string }) => x.id);
    expect(mine).toContain(a.id);
    expect(mine).not.toContain(b.id);
    const attempts = [
      call(supB.key, 'GET', `/supplier/tenders/${a.id}`),
      call(supB.key, 'POST', `/supplier/tenders/${a.id}/questions`, { text: 'Can I see this?' }),
      upload(supB.key, a.id, 'x.pdf', PDF),
      call(supB.key, 'POST', `/supplier/tenders/${a.id}/submission`),
      call(supB.key, 'GET', `/tenders/${a.id}/questions`),
      call(supB.key, 'POST', `/supplier/tenders/${a.id}/submission/withdraw`),
    ];
    for (const r of await Promise.all(attempts)) {
      expect(r.statusCode, r.body).toBe(404);
      expect(r.json().code).toBe('NOT_FOUND');
    }
    const denied = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, a.id), eq(s.auditEvent.action, 'access.denied'))),
    );
    expect(denied.length).toBeGreaterThanOrEqual(attempts.length);
    // a random id is indistinguishable from a real hidden one
    const ghost = await call(supB.key, 'GET', `/supplier/tenders/${uid('ghost')}`);
    expect(ghost.statusCode).toBe(404);
    expect(ghost.json().title).toBe((await call(supB.key, 'GET', `/supplier/tenders/${a.id}`)).json().title);
  });

  it('staff cannot use supplier endpoints and suppliers cannot use staff endpoints or other staff areas', async () => {
    const t = await publishedTender();
    const sup = await invitedSupplier(t.id, 'rolecheck');
    expect((await call('procurement', 'GET', '/supplier/tenders')).statusCode).toBe(403);
    expect((await call('procurement', 'GET', `/supplier/tenders/${t.id}`)).statusCode).toBe(403);
    expect((await call(sup.key, 'GET', '/tenders')).statusCode).toBe(403);
    expect((await call(sup.key, 'GET', `/tenders/${t.id}`)).statusCode).toBe(403);
    expect(
      (await call(sup.key, 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(30) })).statusCode,
    ).toBe(403);
    expect((await call(sup.key, 'GET', '/requests')).statusCode).toBe(403);
    expect((await anon('GET', '/supplier/tenders')).statusCode).toBe(401);
  });

  it('the seeded supplier sees the seeded published tender and its published Q&A, with no author', async () => {
    const list = (await call('supplier', 'GET', '/supplier/tenders')).json();
    const open = list.find((x: { status: string }) => x.status === 'PUBLISHED');
    expect(open).toBeTruthy();
    const view = (await call('supplier', 'GET', `/supplier/tenders/${open.id}`)).json();
    expect(view.questions).toHaveLength(1);
    expect(Object.keys(view.questions[0]).sort()).toEqual([
      'answer',
      'askedAt',
      'audience',
      'id',
      'status',
      'text',
    ]);
    expect(view.fields).toHaveLength(9);
  });
});

// =================================================================== US-TND-03
describe('US-TND-03 anonymised Q&A and addenda', () => {
  it('a question never reveals its author to anyone; answers reach everyone only through an addendum', async () => {
    const t = await publishedTender();
    const asker = await invitedSupplier(t.id, 'curious');
    const other = await invitedSupplier(t.id, 'bystander');
    const q = await call(asker.key, 'POST', `/supplier/tenders/${t.id}/questions`, {
      text: 'Is a site visit required?',
    });
    expect(q.statusCode, q.body).toBe(201);
    const qid = q.json().id as string;
    expect(q.json()).toEqual({ id: qid, status: 'OPEN' });

    const staffQs = await call('procurement', 'GET', `/tenders/${t.id}/questions`);
    expect(staffQs.json()).toHaveLength(1);
    const askerId = (
      await withSystem(database, (tx) => tx.select().from(s.appUser).where(eq(s.appUser.email, asker.email)))
    )[0]!.supplierId!;
    const viewJson = (await call('procurement', 'GET', `/tenders/${t.id}`)).json();
    const questionData = [
      staffQs.body,
      JSON.stringify(viewJson.questions),
      (await call('legal', 'GET', `/tenders/${t.id}/questions`)).body,
      JSON.stringify((await call('probity', 'GET', `/tenders/${t.id}`)).json().questions),
    ];
    for (const body of questionData) {
      expect(body).not.toContain(askerId);
      expect(body).not.toContain(asker.company);
      expect(body).not.toContain(asker.email);
      expect(body.toLowerCase()).not.toContain('askedbysupplier');
    }
    // the invitation list names every invitee equally (needed for late permissions and shortlisting); no other part of the view carries a supplier id
    const rest = { ...viewJson, invitations: undefined, bids: undefined };
    expect(JSON.stringify(rest)).not.toContain(askerId);
    // unanswered and unpublished: invisible to the other supplier
    expect((await call(other.key, 'GET', `/tenders/${t.id}/questions`)).json()).toEqual([]);

    const ans = await call('procurement', 'POST', `/tenders/${t.id}/questions/${qid}/answer`, {
      answer: 'A site visit is optional.',
    });
    expect(ans.statusCode, ans.body).toBe(200);
    expect(ans.json().status).toBe('ANSWERED');
    expect((await call(other.key, 'GET', `/supplier/tenders/${t.id}`)).json().questions).toEqual([]);

    const notReady = await call('procurement', 'POST', `/tenders/${t.id}/addenda`, {
      summary: 'Answers',
      questionIds: [uid('nonexistent')],
    });
    expect(notReady.statusCode).toBe(400);
    const add = await call('procurement', 'POST', `/tenders/${t.id}/addenda`, {
      summary: 'Answers to supplier questions.',
      questionIds: [qid],
    });
    expect(add.statusCode, add.body).toBe(201);
    expect(add.json().number).toBe(1);
    // identical information for every supplier
    for (const k of [asker.key, other.key]) {
      const v = (await call(k, 'GET', `/supplier/tenders/${t.id}`)).json();
      expect(v.questions).toEqual([
        expect.objectContaining({ id: qid, answer: 'A site visit is optional.', status: 'PUBLISHED' }),
      ]);
      expect(v.addenda).toEqual([expect.objectContaining({ number: 1, questionIds: [qid] })]);
      expect(JSON.stringify(v)).not.toContain(asker.company);
      const notes = (await call(k, 'GET', '/notifications')).json() as Array<{ title: string }>;
      expect(JSON.stringify(notes)).toContain('Addendum 1 issued');
    }
    const repeat = await call('procurement', 'POST', `/tenders/${t.id}/addenda`, {
      summary: 'Again',
      questionIds: [qid],
    });
    expect(repeat.statusCode).toBe(409);
    const edit = await call('procurement', 'POST', `/tenders/${t.id}/questions/${qid}/answer`, {
      answer: 'Changed my mind.',
    });
    expect(edit.statusCode).toBe(409);
    expect(edit.json().code).toBe('ALREADY_PUBLISHED');
  });

  it('an addendum may move the closing time, but never to leave less than the statutory window (FR-0210); the limit of 10 questions per supplier is enforced', async () => {
    const t = await publishedTender();
    const sup = await invitedSupplier(t.id, 'extender');
    const closes = new Date(
      t.fields ? (await call('procurement', 'GET', `/tenders/${t.id}`)).json().closesAt : '',
    ).getTime();
    const shorter = await call('procurement', 'POST', `/tenders/${t.id}/addenda`, {
      summary: 'Shorten it',
      newClosesAt: new Date(closes - 10 * DAY).toISOString(), // well under the 25-day minimum from publication
    });
    expect(shorter.statusCode).toBe(422);
    expect(shorter.json().code).toBe('STATUTORY_WINDOW');
    const later = new Date(closes + 3 * DAY).toISOString();
    const ok = await call('procurement', 'POST', `/tenders/${t.id}/addenda`, {
      summary: 'Closing extended by three days.',
      newClosesAt: later,
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect((await call(sup.key, 'GET', `/supplier/tenders/${t.id}`)).json().closesAt).toBe(later);
    for (let i = 0; i < 10; i++)
      expect(
        (
          await call(sup.key, 'POST', `/supplier/tenders/${t.id}/questions`, {
            text: `Question number ${i + 1}?`,
          })
        ).statusCode,
      ).toBe(201);
    expect(
      (await call(sup.key, 'POST', `/supplier/tenders/${t.id}/questions`, { text: 'One too many?' }))
        .statusCode,
    ).toBe(429);
  });

  it('serialiser guard: askedBySupplierId is written in exactly one route file and never read into a response', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (
          p.endsWith('.ts') &&
          !p.endsWith('.test.ts') &&
          readFileSync(p, 'utf8').includes('askedBySupplierId')
        )
          hits.push(relative(root, p).replace(/\\/g, '/'));
      }
    };
    walk(root);
    // schema (the column), seed (demo data), the supplier route that stores it, and the staff route that reads it only to
    // choose who receives a single-supplier answer (FR-0195). No response ever includes it.
    expect(hits.sort()).toEqual([
      'db/schema.ts',
      'db/seed.ts',
      'modules/tender/routes.ts',
      'modules/tender/serialisers.ts',
      'modules/tender/supplier-routes.ts',
    ]);
    // the serialiser file may only mention it in its explanatory comment, never in code
    for (const line of readFileSync(join(root, 'modules/tender/serialisers.ts'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('askedBySupplierId')))
      expect(line.trim(), line).toMatch(/^(\*|\/\/|\/\*)/);
    const sr = readFileSync(join(root, 'modules/tender/supplier-routes.ts'), 'utf8');
    for (const line of sr.split('\n').filter((l) => l.includes('askedBySupplierId')))
      expect(line, line).toMatch(/askedBySupplierId: a\.user\.supplierId|eq\(question\.askedBySupplierId/);
  });
});

// =================================================================== US-SUP-03
describe('US-SUP-03 upload, submit and receipt', () => {
  it('refuses disallowed, disguised, oversized, empty and infected files with clear messages, and stores nothing for them', async () => {
    const t = await publishedTender();
    const sup = await invitedSupplier(t.id, 'uploader');
    const cases: Array<[string, Buffer, number, string]> = [
      ['malware.exe', Buffer.from('MZ'), 400, 'FILE_NAME_INVALID'],
      ['bid.pdf.exe', PDF, 400, 'FILE_NAME_INVALID'],
      ['bid.exe.pdf', PDF, 400, 'FILE_NAME_INVALID'],
      ['notes.rtf', Buffer.from('{\\rtf1}'), 400, 'FILE_TYPE_NOT_ALLOWED'],
      ['fake.pdf', Buffer.from('not really a pdf'), 400, 'FILE_CONTENT_MISMATCH'],
      ['empty.pdf', Buffer.alloc(0), 400, 'VALIDATION_FAILED'],
      ['huge.pdf', Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]), 413, 'FILE_TOO_LARGE'],
      ['virus.txt', Buffer.from('X5O!P%@AP EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'), 400, 'FILE_INFECTED'],
    ];
    for (const [name, bytes, status, code] of cases) {
      const r = await upload(sup.key, t.id, name, bytes);
      expect(r.statusCode, `${name}: ${r.body}`).toBe(status);
      expect(r.json().code, name).toBe(code);
      expect(r.json().title.length, name).toBeGreaterThan(10);
    }
    expect((await call(sup.key, 'GET', `/supplier/tenders/${t.id}`)).json().submission.files).toEqual([]);
    const refused = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, t.id), eq(s.auditEvent.result, 'DENIED'))),
    );
    // every refusal is audited except the empty file, which is rejected earlier as malformed input
    expect(refused.length).toBeGreaterThanOrEqual(cases.length - 1);
  });

  it('stores a good file sealed (ciphertext on disk), records its checksum, and lets the supplier remove it', async () => {
    const t = await publishedTender();
    const sup = await invitedSupplier(t.id, 'sealer');
    const r = await upload(sup.key, t.id, 'Technical response.pdf', PDF);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({
      name: 'Technical response.pdf',
      section: 'TECHNICAL',
      scan: 'CLEAN',
      sizeBytes: PDF.length,
    });
    expect(r.json().sha256).toMatch(/^[0-9a-f]{64}$/);
    const row = (
      await withSystem(database, (tx) =>
        tx.select().from(s.fileObject).where(eq(s.fileObject.id, r.json().id)),
      )
    )[0]!;
    const onDisk = readFileSync(join(storage, row.storageKey));
    expect(onDisk.includes('%PDF')).toBe(false);
    expect(onDisk.length).toBeGreaterThan(PDF.length);
    const del = await call(sup.key, 'DELETE', `/supplier/tenders/${t.id}/submission/files/${r.json().id}`);
    expect(del.statusCode).toBe(204);
    expect(existsSync(join(storage, row.storageKey))).toBe(false);
    expect(
      (await call(sup.key, 'DELETE', `/supplier/tenders/${t.id}/submission/files/${r.json().id}`)).statusCode,
    ).toBe(404);
  });

  it("another supplier cannot delete or see someone else's file by id", async () => {
    const t = await publishedTender({ access: 'OPEN' });
    const a = await invitedSupplier(t.id, 'owner');
    const b = await invitedSupplier(t.id, 'intruder');
    const f = (await upload(a.key, t.id, 'mine.pdf', PDF)).json();
    expect(
      (await call(b.key, 'DELETE', `/supplier/tenders/${t.id}/submission/files/${f.id}`)).statusCode,
    ).toBe(404);
    expect((await call(b.key, 'GET', `/supplier/tenders/${t.id}`)).json().submission.files).toEqual([]);
    expect((await call(a.key, 'GET', `/supplier/tenders/${t.id}`)).json().submission.files).toHaveLength(1);
  });

  it('submission needs a technical and a commercial file, then issues a receipt with a manifest; the bid stays sealed from staff', async () => {
    const t = await publishedTender();
    const sup = await invitedSupplier(t.id, 'bidder');
    const empty = await call(sup.key, 'POST', `/supplier/tenders/${t.id}/submission`);
    expect(empty.statusCode).toBe(409);
    expect(empty.json().code).toBe('SUBMISSION_INCOMPLETE');
    await upload(sup.key, t.id, 'technical.pdf', PDF, 'TECHNICAL');
    const half = await call(sup.key, 'POST', `/supplier/tenders/${t.id}/submission`);
    expect(half.json().errors).toEqual([{ field: 'commercial', message: 'Add a commercial file' }]);
    await upload(sup.key, t.id, 'pricing.xlsx', ZIP, 'COMMERCIAL');
    const sub = await call(sup.key, 'POST', `/supplier/tenders/${t.id}/submission`);
    expect(sub.statusCode, sub.body).toBe(201);
    expect(sub.json().receipt).toMatch(/^RC-\d{4}-20261002-[0-9A-F]{8}$/);
    expect(sub.json().submittedAt).toBe(clock.now().toISOString());
    expect(
      sub
        .json()
        .files.map((f: { name: string }) => f.name)
        .sort(),
    ).toEqual(['pricing.xlsx', 'technical.pdf']);
    const view = (await call(sup.key, 'GET', `/supplier/tenders/${t.id}`)).json();
    expect(view.submission).toMatchObject({ status: 'SUBMITTED', receipt: sub.json().receipt });
    const second = await call(sup.key, 'POST', `/supplier/tenders/${t.id}/submission`);
    expect(second.json().code).toBe('ALREADY_SUBMITTED');
    expect((await upload(sup.key, t.id, 'more.pdf', PDF)).json().code).toBe('ALREADY_SUBMITTED');
    // staff: a count, no names, no files, before close
    const staff = (await call('procurement', 'GET', `/tenders/${t.id}`)).json() as Tender;
    expect(staff.submissions).toEqual({ count: 1, sealed: true });
    expect(
      (await call('procurement', 'GET', '/tenders')).json().find((x: { id: string }) => x.id === t.id).bids,
    ).toBe(1);
    const notes = JSON.stringify((await call(sup.key, 'GET', '/notifications')).json());
    expect(notes).toContain('Bid received');
  });

  it('withdraw allows a change before close and a resubmission gets a new receipt', async () => {
    const t = await publishedTender();
    const sup = await invitedSupplier(t.id, 'reviser');
    await fullBid(sup.key, t.id);
    const first = (await call(sup.key, 'POST', `/supplier/tenders/${t.id}/submission`)).json();
    clock.advanceMs(60_000);
    const w = await call(sup.key, 'POST', `/supplier/tenders/${t.id}/submission/withdraw`);
    expect(w.statusCode, w.body).toBe(200);
    expect(w.json().submission).toMatchObject({ status: 'DRAFT', receipt: null });
    expect((await call('procurement', 'GET', `/tenders/${t.id}`)).json().submissions.count).toBe(0);
    expect((await upload(sup.key, t.id, 'addition.pdf', PDF, 'OTHER')).statusCode).toBe(201);
    const second = (await call(sup.key, 'POST', `/supplier/tenders/${t.id}/submission`)).json();
    expect(second.receipt).not.toBe(first.receipt);
    expect(second.files).toHaveLength(3);
    expect((await call(sup.key, 'POST', `/supplier/tenders/${t.id}/submission/withdraw`)).statusCode).toBe(
      200,
    );
    expect((await call(sup.key, 'POST', `/supplier/tenders/${t.id}/submission/withdraw`)).json().code).toBe(
      'INVALID_STATE',
    );
  });
});

// =================================================================== RLS on bid files
describe('bid files are sealed in the database until close (row level security)', () => {
  it('the owner reads their own; other suppliers, administrators and staff read none before close; evaluating roles read submitted bids after close', async () => {
    const t = await publishedTender({ access: 'OPEN' });
    const a = await invitedSupplier(t.id, 'rlsa');
    const b = await invitedSupplier(t.id, 'rlsb');
    await fullBid(a.key, t.id);
    await call(a.key, 'POST', `/supplier/tenders/${t.id}/submission`);
    await fullBid(b.key, t.id); // started, never submitted
    const subs = await withSystem(database, (tx) =>
      tx.select().from(s.submission).where(eq(s.submission.tenderId, t.id)),
    );
    const userOf = async (email: string) =>
      (await withSystem(database, (tx) => tx.select().from(s.appUser).where(eq(s.appUser.email, email))))[0]!;
    const ua = await userOf(a.email);
    const ub = await userOf(b.email);
    const filesAs = (userId: string, role: s.Role) =>
      withContext(database, { tenantId: TENANT_ID, userId, role }, (tx) => tx.select().from(s.fileObject));
    const mine = (rows: Array<{ submissionId: string }>, sid: string | undefined) =>
      rows.filter((r) => r.submissionId === sid).length;
    const subA = subs.find((x) => x.supplierId === ua.supplierId)?.id;
    const subB = subs.find((x) => x.supplierId === ub.supplierId)?.id;

    expect(mine(await filesAs(ua.id, 'SUPPLIER'), subA)).toBe(2);
    expect(mine(await filesAs(ua.id, 'SUPPLIER'), subB)).toBe(0);
    expect(mine(await filesAs(ub.id, 'SUPPLIER'), subA)).toBe(0);
    for (const role of ['PROCUREMENT', 'EVALUATOR', 'CHAIR', 'PROBITY', 'LEGAL', 'ADMIN', 'EXEC'] as const)
      expect(
        (await filesAs(uid('user:procurement'), role)).filter(
          (f) => f.submissionId === subA || f.submissionId === subB,
        ),
        role,
      ).toHaveLength(0);

    clock.advanceMs(31 * DAY);
    sessions.clear();
    await withSystem(database, (tx) =>
      tx.update(s.tender).set({ status: 'CLOSED' }).where(eq(s.tender.id, t.id)),
    );
    for (const role of ['PROCUREMENT', 'PROBITY', 'LEGAL'] as const) {
      const rows = await filesAs(uid('user:procurement'), role);
      expect(mine(rows, subA), role).toBe(2); // submitted bid is readable once closed
      expect(mine(rows, subB), role).toBe(0); // never submitted: still not readable by anyone but its owner
    }
    // evaluators and the chair are NOT in that group: they need a panel seat and a declaration of no conflict, and then
    // only their stream's files (proved in the evaluation tests)
    for (const role of ['EVALUATOR', 'CHAIR'] as const)
      expect(mine(await filesAs(uid('user:procurement'), role), subA), role).toBe(0);
    expect(
      (await filesAs(uid('user:procurement'), 'ADMIN')).filter((f) => f.submissionId === subA),
    ).toHaveLength(0);
    expect(
      (await filesAs(uid('user:procurement'), 'EXEC')).filter((f) => f.submissionId === subA),
    ).toHaveLength(0);
  });
});

// =================================================================== US-SUP-04 (keep last: moves the clock)
describe('US-SUP-04 the portal locks at the closing time', () => {
  it('one millisecond before close a bid is accepted; at close nothing is, drafts are discarded, late attempts are notified, and the earlier submitted bid survives', async () => {
    const t = await publishedTender({ days: 30 });
    const closesAt = new Date(
      (await call('procurement', 'GET', `/tenders/${t.id}`)).json().closesAt,
    ).getTime();
    const early = await invitedSupplier(t.id, 'ontime');
    const dozy = await invitedSupplier(t.id, 'dozy');
    const never = await invitedSupplier(t.id, 'neversent');
    await fullBid(early.key, t.id);
    await fullBid(dozy.key, t.id); // everything uploaded but never submitted
    await upload(never.key, t.id, 'draft.pdf', PDF, 'TECHNICAL');
    const dozyDraft = (await withSystem(database, (tx) => tx.select().from(s.fileObject))).filter(
      (f) => f.name === 'technical.pdf',
    );
    expect(dozyDraft.length).toBeGreaterThan(0);

    // the last moment: still open
    clock.set(new Date(closesAt - 1));
    sessions.clear();
    const onTime = await call(early.key, 'POST', `/supplier/tenders/${t.id}/submission`);
    expect(onTime.statusCode, onTime.body).toBe(201);
    expect((await call('procurement', 'GET', `/tenders/${t.id}`)).json().status).toBe('PUBLISHED');
    expect((await call('procurement', 'GET', `/tenders/${t.id}`)).json().submissions.sealed).toBe(true);

    // the closing instant: locked
    clock.set(new Date(closesAt));
    sessions.clear();
    const keys = (await withSystem(database, (tx) => tx.select().from(s.fileObject))).map(
      (f) => f.storageKey,
    );
    const late = await call(dozy.key, 'POST', `/supplier/tenders/${t.id}/submission`);
    expect(late.statusCode, late.body).toBe(409);
    expect(late.json().code).toBe('BID_CLOSED');
    const upLate = await upload(dozy.key, t.id, 'late.pdf', PDF);
    expect(upLate.statusCode).toBe(409);
    expect(upLate.json().code).toBe('BID_CLOSED');
    expect(
      (
        await call(dozy.key, 'POST', `/supplier/tenders/${t.id}/questions`, { text: 'Can I still ask?' })
      ).json().code,
    ).toBe('BID_CLOSED');

    const dozySub = (
      await withSystem(database, (tx) =>
        tx.select().from(s.submission).where(eq(s.submission.tenderId, t.id)),
      )
    ).find((x) => x.status === 'REJECTED_LATE');
    expect(dozySub).toBeTruthy();
    const filesAfter = await withSystem(database, (tx) => tx.select().from(s.fileObject));
    expect(filesAfter.filter((f) => f.submissionId === dozySub!.id)).toEqual([]); // discarded
    const gone = keys.filter((k) => !filesAfter.some((f) => f.storageKey === k));
    expect(gone.length).toBeGreaterThanOrEqual(2);
    for (const k of gone) expect(existsSync(join(storage, k))).toBe(false);

    const notes = JSON.stringify((await call(dozy.key, 'GET', '/notifications')).json());
    expect(notes).toContain('Late submission not accepted');

    // the on-time supplier keeps a valid, submitted bid; the never-submitted draft is purged at close
    const ok = (await call(early.key, 'GET', `/supplier/tenders/${t.id}`)).json();
    expect(ok.status).toBe('CLOSED');
    expect(ok.canBid).toBe(false);
    expect(ok.submission).toMatchObject({ status: 'SUBMITTED', receipt: onTime.json().receipt });
    expect((await call(never.key, 'GET', `/supplier/tenders/${t.id}`)).json().submission.files).toEqual([]);
    expect(JSON.stringify((await call(never.key, 'GET', '/notifications')).json())).toContain(
      'your bid was not submitted',
    );

    // staff: closed automatically, audited, and now the receipts (not the files) are visible
    const staff = (await call('procurement', 'GET', `/tenders/${t.id}`)).json() as Tender;
    expect(staff.status).toBe('CLOSED');
    expect(staff.submissions.sealed).toBe(false);
    expect(staff.submissions.items).toHaveLength(1);
    expect(staff.submissions.items![0]!.receipt).toBe(onTime.json().receipt);
    const closeEvents = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, t.id), eq(s.auditEvent.action, 'tender.close'))),
    );
    expect(closeEvents).toHaveLength(1);
    const lateEvents = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, t.id), eq(s.auditEvent.action, 'submission.rejected_late'))),
    );
    expect(lateEvents.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify((await call('procurement', 'GET', '/notifications')).json())).toContain(
      'Tender closed',
    );
    expect(
      (
        await call('procurement', 'POST', `/tenders/${t.id}/addenda`, {
          summary: 'Too late to change anything',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call('procurement', 'POST', `/tenders/${t.id}/invitations`, {
          invitees: [{ email: 'late@invite.example', company: 'Late Pty Ltd' }],
        })
      ).statusCode,
    ).toBe(409);
  });
});
