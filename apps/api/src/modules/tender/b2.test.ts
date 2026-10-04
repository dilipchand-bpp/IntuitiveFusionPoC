import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type ManualClock } from '@if/shared';
import { buildApp } from '../../app.js';
import { withSystem, type Database } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { emailFor, seedDatabase, TENANT_ID, uid } from '../../db/seed.js';
import { freshDb, newClock } from '../../test-helpers.js';
import { DEFAULTS } from '../settings/settings.js';
import { insuranceStatusFor } from './insurance.js';

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
  const email = key.includes('@') ? key : emailFor(key);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: key.includes('@') ? SUPPLIER_PW : PASSWORD },
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
/** One attempt with the cookies already held: no fresh sign-in, so a 401 is reported rather than hidden. */
async function callHeld(key: string, url: string) {
  const sess = await sessionFor(key);
  return app.inject({ method: 'GET', url: `/api/v1${url}`, cookies: sess.cookies });
}
const anon = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
const sys = <T>(fn: Parameters<typeof withSystem>[1]) => withSystem(database, fn) as Promise<T>;
const setting = async (name: string, value: unknown) => {
  const r = await call('admin', 'PUT', '/admin/settings', { [name]: value });
  expect(r.statusCode, r.body).toBe(200);
};
const emails = (kind?: string) =>
  sys<Json[]>((tx) => tx.select().from(s.outboundEmail)).then((rows) =>
    kind ? rows.filter((r) => r.kind === kind) : rows,
  );

const PDF = Buffer.from('%PDF-1.7\nsample technical response');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]);
const b64 = (b: Buffer) => b.toString('base64');
const closeIn = (days: number) => new Date(clock.now().getTime() + days * DAY).toISOString();

let titleSeq = 0;
async function approvedRequest(value = 90_000): Promise<string> {
  const c = await call('requester', 'POST', '/requests', {
    title: `B2 fixture ${(titleSeq += 1)}`,
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
  expect(
    (await call('delegate', 'POST', `/plans/${plan.id}/decision`, { decision: 'APPROVE' })).statusCode,
  ).toBe(200);
  return id;
}
async function publishedTender(value = 90_000, days = 30): Promise<Json> {
  const rid = await approvedRequest(value);
  const t = (
    await call('procurement', 'POST', '/tenders', { requestId: rid, type: 'RFT', access: 'CLOSED' })
  ).json();
  expect((await call('delegate', 'POST', `/tenders/${t.id}/publish-permission`, {})).statusCode).toBe(200);
  const p = await call('procurement', 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(days) });
  expect(p.statusCode, p.body).toBe(200);
  return p.json();
}

let abnCounter = 0;
function newAbn(): string {
  for (;;) {
    abnCounter += 1;
    const body = String(20_000_000 + abnCounter).padStart(9, '0');
    for (let c = 10; c < 100; c++) {
      const abn = `${c}${body}`;
      const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
      const sum = [...abn].reduce((acc, ch, i) => acc + (i === 0 ? Number(ch) - 1 : Number(ch)) * w[i]!, 0);
      if (sum % 89 === 0) return abn;
    }
  }
}
interface Sup {
  key: string;
  email: string;
  company: string;
  supplierId: string;
}
async function register(
  tenderId: string,
  name: string,
  extra: Json = {},
): Promise<Sup & { res: Awaited<ReturnType<typeof anon>> }> {
  const email = `${name.toLowerCase().replace(/\W+/g, '')}@b2-bidder.example`;
  const company = extra.company ?? `${name} Pty Ltd`;
  const inv = await call('procurement', 'POST', `/tenders/${tenderId}/invitations`, {
    invitees: [{ email, company }],
  });
  expect(inv.statusCode, inv.body).toBe(201);
  const token = new URL(inv.json().invitations[0].registerPath, 'http://x').searchParams.get('token')!;
  const { company: _c, ...rest } = extra;
  void _c;
  const res = await anon('POST', '/supplier/register', {
    token,
    name: `${name} Contact`,
    email,
    company,
    abn: newAbn(),
    password: SUPPLIER_PW,
    ...rest,
  });
  const supplierId = res.statusCode === 201 ? (res.json().supplierId as string) : '';
  return { key: email, email, company, supplierId, res };
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
  const sub = await call(key, 'POST', `/supplier/tenders/${tenderId}/submission`);
  expect(sub.statusCode, sub.body).toBe(201);
}
const restore = async () => {
  await setting('onboardingQuestions', []);
  await setting('publicRegisters', DEFAULTS.publicRegisters);
};

beforeAll(async () => {
  database = await freshDb();
  clock = newClock();
  await seedDatabase(database, { clock, password: PASSWORD });
  const storage = await mkdtemp(join(tmpdir(), 'if-b2-'));
  app = await buildApp(
    loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'b'.repeat(40), STORAGE_DIR: storage }),
    { database, clock, loginRateLimitMax: 10_000 },
  );
}, 120_000);

describe('questions answered to one supplier or to all (FR-0195)', () => {
  it('a single-supplier answer reaches only the supplier who asked, at once; a broadcast waits for the addendum and reaches everyone', async () => {
    const t = await publishedTender();
    const a = await register(t.id, 'Asker');
    const b = await register(t.id, 'Bystander');
    const q1 = (
      await call(a.key, 'POST', `/supplier/tenders/${t.id}/questions`, {
        text: 'Is parking provided on site?',
      })
    ).json();
    const q2 = (
      await call(b.key, 'POST', `/supplier/tenders/${t.id}/questions`, {
        text: 'Which insurance cover is required?',
      })
    ).json();
    const single = await call('procurement', 'POST', `/tenders/${t.id}/questions/${q1.id}/answer`, {
      answer: 'Yes, two bays.',
      audience: 'SINGLE',
    });
    expect(single.statusCode, single.body).toBe(200);
    expect(single.json()).toMatchObject({ status: 'PUBLISHED', audience: 'SINGLE' });
    expect(JSON.stringify(single.json())).not.toMatch(/askedBy|supplierId/);
    const seen = async (key: string) =>
      ((await call(key, 'GET', `/supplier/tenders/${t.id}`)).json().questions as Json[]).map((q) => q.text);
    expect(await seen(a.key)).toEqual(['Is parking provided on site?']);
    expect(await seen(b.key)).toEqual([]); // nothing of it reaches anyone else
    expect((await emails('ANSWER')).some((e) => e.toEmail === a.email)).toBe(true);
    expect((await emails('ANSWER')).some((e) => e.toEmail === b.email)).toBe(false);
    expect(
      (
        await call('procurement', 'POST', `/tenders/${t.id}/questions/${q1.id}/answer`, {
          answer: 'Changed',
          audience: 'SINGLE',
        })
      ).statusCode,
    ).toBe(409); // published answers do not change
    // a broadcast is held until an addendum publishes it to everyone
    expect(
      (
        await call('procurement', 'POST', `/tenders/${t.id}/questions/${q2.id}/answer`, {
          answer: 'Public liability of AUD 10 million.',
        })
      ).json(),
    ).toMatchObject({ status: 'ANSWERED', audience: 'ALL' });
    expect(await seen(b.key)).toEqual([]);
    expect(
      (
        await call('procurement', 'POST', `/tenders/${t.id}/addenda`, {
          summary: 'Insurance clarified.',
          questionIds: [q2.id],
        })
      ).statusCode,
    ).toBe(201);
    expect(await seen(a.key)).toEqual(['Is parking provided on site?', 'Which insurance cover is required?']);
    expect(await seen(b.key)).toEqual(['Which insurance cover is required?']);
    // staff see which is which, never who asked
    const staff = (await call('procurement', 'GET', `/tenders/${t.id}/questions`)).json() as Json[];
    expect(staff.map((q) => q.audience).sort()).toEqual(['ALL', 'SINGLE']);
    expect(JSON.stringify(staff)).not.toMatch(/askedBy|supplierId/);
  });
});

describe('addenda and date changes tell every bidder (FR-0210)', () => {
  it('the closing time can move either way inside the statutory window; invited and registered contacts are told by email and in the portal', async () => {
    const t = await publishedTender(90_000, 30);
    const reg = await register(t.id, 'Registered');
    const invited = await call('procurement', 'POST', `/tenders/${t.id}/invitations`, {
      invitees: [{ email: 'not.yet@b2-bidder.example', company: 'Not Yet Pty Ltd' }],
    });
    expect(invited.statusCode).toBe(201);
    const closes = new Date((await call('procurement', 'GET', `/tenders/${t.id}`)).json().closesAt).getTime();
    const tooSoon = await call('procurement', 'POST', `/tenders/${t.id}/addenda`, {
      summary: 'Bring it forward.',
      newClosesAt: new Date(closes - 8 * DAY).toISOString(),
    });
    expect(tooSoon.statusCode).toBe(422);
    expect(tooSoon.json().code).toBe('STATUTORY_WINDOW');
    expect(
      (
        await call('procurement', 'POST', `/tenders/${t.id}/addenda`, {
          summary: 'Bring it forward.',
          newClosesAt: new Date(closes - 2 * DAY).toISOString(),
        })
      ).statusCode,
    ).toBe(201); // 28 days from publication is fine
    expect(
      (
        await call('procurement', 'POST', `/tenders/${t.id}/addenda`, {
          summary: 'Same again.',
          newClosesAt: new Date(closes - 2 * DAY).toISOString(),
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await call('procurement', 'POST', `/tenders/${t.id}/addenda`, {
          summary: 'Back in the past.',
          newClosesAt: new Date(clock.now().getTime() - DAY).toISOString(),
        })
      ).statusCode,
    ).toBe(422);
    const sent = (await emails('DATES_CHANGED')).filter((e) => e.refId === t.id);
    expect(sent.map((e) => e.toEmail).sort()).toEqual([reg.email, 'not.yet@b2-bidder.example'].sort());
    expect(sent[0]!.body).toContain('new closing time');
    const notes = (await call(reg.key, 'GET', '/notifications')).json() as Json[];
    expect(notes.some((n) => n.title.includes('closing time changed'))).toBe(true);
    expect(
      (
        await sys<Json[]>((tx) =>
          tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'addendum.issue')),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe('invitations, the released pack and public notices (FR-0200, FR-0140, FR-0145)', () => {
  it('invitations are emailed without the one-time link; publishing releases the pack to every invitee and records what was released', async () => {
    const rid = await approvedRequest(60_000);
    const t = (
      await call('procurement', 'POST', '/tenders', { requestId: rid, type: 'RFT', access: 'CLOSED' })
    ).json();
    const inv = await call('procurement', 'POST', `/tenders/${t.id}/invitations`, {
      invitees: [{ email: 'early@b2-bidder.example', company: 'Early Pty Ltd' }],
    });
    const token = new URL(inv.json().invitations[0].registerPath, 'http://x').searchParams.get('token')!;
    const mail = (await emails('TENDER_INVITATION')).find((e) => e.toEmail === 'early@b2-bidder.example')!;
    expect(mail.subject).toContain('Invitation to respond');
    expect(mail.body).not.toContain(token); // the log never holds a usable link
    expect((await call('delegate', 'POST', `/tenders/${t.id}/publish-permission`, {})).statusCode).toBe(200);
    expect(
      (await call('procurement', 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(10) })).statusCode,
    ).toBe(422); // statutory minimum of 25 days
    expect(
      (await call('procurement', 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(30) })).statusCode,
    ).toBe(200);
    const released = (
      await sys<Json[]>((tx) =>
        tx
          .select()
          .from(s.auditEvent)
          .where(and(eq(s.auditEvent.action, 'tender.pack_release'), eq(s.auditEvent.entityId, t.id))),
      )
    )[0]!;
    expect(released.after.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      (await emails('TENDER_PUBLISHED')).some(
        (e) => e.toEmail === 'early@b2-bidder.example' && e.refId === t.id,
      ),
    ).toBe(true);
  });

  it("a public-sector tender at or above a register's value is routed to that register; below it, or a register switched off, is not", async () => {
    const big = await publishedTender(90_000);
    const notices = (await call('procurement', 'GET', `/tenders/${big.id}/notices`)).json() as Json[];
    expect(notices.map((n) => n.register)).toEqual(['AusTender']);
    expect(notices[0]!.reference).toMatch(/^AUSTENDER-\d{4}-PR-/);
    expect(notices[0]!.status).toBe('SIMULATED');
    const small = await publishedTender(60_000);
    expect((await call('procurement', 'GET', `/tenders/${small.id}/notices`)).json() as Json[]).toEqual([]);
    await setting(
      'publicRegisters',
      DEFAULTS.publicRegisters.map((r) => ({ ...r, enabled: true, minValueAud: 50_000 })),
    );
    const both = await publishedTender(60_000);
    expect(
      ((await call('procurement', 'GET', `/tenders/${both.id}/notices`)).json() as Json[])
        .map((n) => n.register)
        .sort(),
    ).toEqual(['AusTender', 'SAM.gov', 'TED']);
    await restore();
    expect(
      (
        await sys<Json[]>((tx) =>
          tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'tender.public_notice')),
        )
      ).length,
    ).toBeGreaterThanOrEqual(4);
    expect((await call('requester', 'GET', `/tenders/${big.id}/notices`)).statusCode).toBe(403);
  });

  it('closing less than the statutory minimum after publication is refused (FR-0145)', async () => {
    const rid = await approvedRequest(90_000);
    const t = (await call('procurement', 'POST', '/tenders', { requestId: rid, type: 'RFT' })).json();
    await call('delegate', 'POST', `/tenders/${t.id}/publish-permission`, {});
    const r = await call('procurement', 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(24) });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('STATUTORY_WINDOW');
    expect(
      (await call('procurement', 'POST', `/tenders/${t.id}/publish`, { closesAt: closeIn(25.5) })).statusCode,
    ).toBe(200);
  });
});

describe('a late submission can be permitted for one supplier (FR-0205)', () => {
  it('only after close, for an invited supplier, with a reason and an expiry; it ends when it expires, is withdrawn, or evaluation begins', async () => {
    const t = await publishedTender(90_000, 26);
    const a = await register(t.id, 'Lateco');
    const b = await register(t.id, 'Punctual');
    await fullBid(b.key, t.id);
    expect((await upload(a.key, t.id, 'technical.pdf', PDF)).statusCode).toBe(201); // started, never sent
    expect(
      (
        await call('procurement', 'POST', `/tenders/${t.id}/late-permissions`, {
          supplierId: a.supplierId,
          reason: 'Portal outage on the day',
          hours: 2,
        })
      ).statusCode,
    ).toBe(409); // not closed yet
    clock.advanceDays(27);
    expect((await upload(a.key, t.id, 'again.pdf', PDF)).statusCode).toBe(409); // the draft was discarded at close
    // who may grant it, and for whom
    expect(
      (
        await call('legal', 'POST', `/tenders/${t.id}/late-permissions`, {
          supplierId: a.supplierId,
          reason: 'Portal outage on the day',
          hours: 2,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('procurement', 'POST', `/tenders/${t.id}/late-permissions`, {
          supplierId: a.supplierId,
          reason: 'short',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call('procurement', 'POST', `/tenders/${t.id}/late-permissions`, {
          supplierId: uid('supplier:summit'),
          reason: 'They were never invited here',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await call('procurement', 'POST', `/tenders/${t.id}/late-permissions`, {
          supplierId: b.supplierId,
          reason: 'They already submitted on time',
        })
      ).statusCode,
    ).toBe(409);
    const g = await call('procurement', 'POST', `/tenders/${t.id}/late-permissions`, {
      supplierId: a.supplierId,
      reason: 'Portal outage on the day',
      hours: 2,
    });
    expect(g.statusCode, g.body).toBe(201);
    expect((await emails('LATE_PERMISSION')).some((e) => e.toEmail === a.email)).toBe(true);
    expect((await call(a.key, 'GET', `/supplier/tenders/${t.id}`)).json()).toMatchObject({
      canBid: true,
      lateAccess: true,
    });
    // the other supplier is not helped by it
    expect((await call(b.key, 'GET', `/supplier/tenders/${t.id}`)).json().lateAccess).toBe(false);
    await fullBid(a.key, t.id);
    const row = (
      await sys<Json[]>((tx) =>
        tx
          .select()
          .from(s.submission)
          .where(and(eq(s.submission.tenderId, t.id), eq(s.submission.supplierId, a.supplierId))),
      )
    )[0]!;
    expect(row.status).toBe('SUBMITTED');
    const list = (await call('procurement', 'GET', `/tenders/${t.id}/late-permissions`)).json() as Json[];
    expect(list[0]).toMatchObject({ company: a.company, active: true, reason: 'Portal outage on the day' });
    expect(
      (
        await sys<Json[]>((tx) =>
          tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'late_permission.grant')),
        )
      ).length,
    ).toBe(1);
  });

  it('a permission expires, can be withdrawn, and does not outlive the start of evaluation', async () => {
    const t = await publishedTender(90_000, 26);
    const a = await register(t.id, 'Expiring');
    const b = await register(t.id, 'Withdrawn');
    const c = await register(t.id, 'Evaluated');
    clock.advanceDays(27);
    for (const x of [a, b, c])
      expect(
        (
          await call('procurement', 'POST', `/tenders/${t.id}/late-permissions`, {
            supplierId: x.supplierId,
            reason: 'A good reason for extra time',
            hours: 1,
          })
        ).statusCode,
      ).toBe(201);
    const perm = (
      (await call('procurement', 'GET', `/tenders/${t.id}/late-permissions`)).json() as Json[]
    ).find((p) => p.company === b.company)!;
    expect(
      (await call('procurement', 'DELETE', `/tenders/${t.id}/late-permissions/${perm.id}`)).statusCode,
    ).toBe(204);
    expect(
      (await call('procurement', 'DELETE', `/tenders/${t.id}/late-permissions/${perm.id}`)).statusCode,
    ).toBe(404);
    expect((await upload(b.key, t.id, 'x.pdf', PDF)).statusCode).toBe(409);
    clock.advanceMs(2 * 3_600_000);
    expect((await upload(a.key, t.id, 'x.pdf', PDF)).statusCode).toBe(409); // an hour was given and it has passed
    // once evaluation has begun nobody can add a bid
    const d2 = await call('procurement', 'POST', `/tenders/${t.id}/late-permissions`, {
      supplierId: c.supplierId,
      reason: 'Granted again before evaluation',
      hours: 5,
    });
    expect(d2.statusCode).toBe(201);
    await sys((tx) => tx.update(s.tender).set({ status: 'EVALUATING' }).where(eq(s.tender.id, t.id)));
    expect((await upload(c.key, t.id, 'x.pdf', PDF)).statusCode).toBe(409);
  });
});

describe('supplier onboarding questions, privacy and sanctions screening (FR-0215, FR-0240, FR-0180)', () => {
  it("the organisation's own questions are asked, required ones enforced, and a flagged answer is passed to procurement", async () => {
    await setting('onboardingQuestions', [
      {
        id: 'modernSlavery',
        label: 'Do you have a modern slavery policy?',
        type: 'YESNO',
        mandatory: true,
        flagIf: 'NO',
      },
      {
        id: 'sustainability',
        label: 'Describe your sustainability practices',
        type: 'TEXT',
        mandatory: false,
      },
    ]);
    const t = await publishedTender();
    const qs = (await anon('GET', '/supplier/onboarding-questions')).json() as Json[];
    expect(qs.map((q) => q.id)).toEqual(['modernSlavery', 'sustainability']);
    const missing = await register(t.id, 'NoAnswers');
    expect(missing.res.statusCode).toBe(400);
    expect(JSON.stringify(missing.res.json())).toContain('Do you have a modern slavery policy? is required');
    const badAnswer = await register(t.id, 'Maybe', { answers: { modernSlavery: 'MAYBE' } });
    expect(badAnswer.res.statusCode).toBe(400);
    const ok = await register(t.id, 'Flagged', {
      answers: { modernSlavery: 'NO', sustainability: 'Recycling.' },
      privacy: { shareProfile: false, productUpdates: true },
    });
    expect(ok.res.statusCode, ok.res.body).toBe(201);
    const row = (
      await sys<Json[]>((tx) => tx.select().from(s.supplier).where(eq(s.supplier.id, ok.supplierId)))
    )[0]!;
    expect(row.onboarding).toMatchObject({ answers: { modernSlavery: 'NO' }, flagged: ['modernSlavery'] });
    expect(row.privacy).toEqual({ shareProfile: false, productUpdates: true });
    const notes = (await call('procurement', 'GET', '/notifications')).json() as Json[];
    expect(notes[0]!.title).toContain('screening question');
    expect((await emails('WELCOME')).some((e) => e.toEmail === ok.email)).toBe(true);
    // answering the other way is not flagged
    const fine = await register(t.id, 'Unflagged', { answers: { modernSlavery: 'YES' } });
    expect(
      (await sys<Json[]>((tx) => tx.select().from(s.supplier).where(eq(s.supplier.id, fine.supplierId))))[0]!
        .onboarding.flagged,
    ).toEqual([]);
    await setting('onboardingQuestions', []);
  });

  it('a screening match holds the account: no tender documents, no bidding, procurement alerted; a review releases or confirms it', async () => {
    const t = await publishedTender();
    const held = await register(t.id, 'Blocked Holdings', { company: 'Blocked Holdings Pty Ltd' });
    expect(held.res.statusCode).toBe(201);
    expect(held.res.json().sanctionsStatus).toBe('MATCH');
    expect((await call(held.key, 'GET', '/supplier/tenders')).json()).toMatchObject({
      code: 'SUPPLIER_QUARANTINED',
    });
    expect((await call(held.key, 'GET', `/supplier/tenders/${t.id}`)).statusCode).toBe(403);
    expect((await upload(held.key, t.id, 'x.pdf', PDF)).statusCode).toBe(403);
    expect((await emails('SANCTIONS_HOLD')).some((e) => e.toEmail === held.email)).toBe(true);
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'supplier.sanctions_match')),
    );
    expect(audit.length).toBeGreaterThan(0);
    expect(((await call('procurement', 'GET', '/notifications')).json() as Json[])[0]!.title).toContain(
      'screening match',
    );
    // review: the buyer confirms it, then later releases it
    expect(
      (
        await call('requester', 'POST', `/suppliers/${held.supplierId}/sanctions-review`, {
          decision: 'RELEASE',
          note: 'Cleared in error',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('procurement', 'POST', `/suppliers/${held.supplierId}/sanctions-review`, {
          decision: 'CONFIRM',
          note: 'Matches the list exactly',
        })
      ).json().sanctionsStatus,
    ).toBe('MATCH');
    expect((await call(held.key, 'GET', '/supplier/tenders')).statusCode).toBe(403);
    expect(
      (
        await call('procurement', 'POST', `/suppliers/${held.supplierId}/sanctions-review`, {
          decision: 'RELEASE',
          note: 'Different company, same name',
        })
      ).json().sanctionsStatus,
    ).toBe('CLEAR');
    expect((await call(held.key, 'GET', '/supplier/tenders')).statusCode).toBe(200);
    expect(
      (
        await call('procurement', 'POST', `/suppliers/${held.supplierId}/sanctions-review`, {
          decision: 'RELEASE',
          note: 'Nothing to release',
        })
      ).statusCode,
    ).toBe(409);
    const actions = (await sys<Json[]>((tx) => tx.select().from(s.auditEvent))).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['supplier.sanctions_confirm', 'supplier.sanctions_release']),
    );
    // a held supplier cannot be given extra time either
    const t2 = await publishedTender(90_000, 26);
    const held2 = await register(t2.id, 'Sanctioned Trading', { company: 'Sanctioned Trading Co' });
    clock.advanceDays(27);
    expect(
      (
        await call('procurement', 'POST', `/tenders/${t2.id}/late-permissions`, {
          supplierId: held2.supplierId,
          reason: 'They asked nicely enough',
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe("the supplier's own profile, insurance and contacts (FR-0250, FR-0245)", () => {
  it("insurance status follows the certificate end date and is shared with the buyer's onboarding checks; privacy changes are audited", async () => {
    expect(insuranceStatusFor(null, '2026-10-02')).toBe('UNKNOWN');
    expect(insuranceStatusFor('2026-10-02', '2026-10-02')).toBe('EXPIRED');
    expect(insuranceStatusFor('2026-10-20', '2026-10-02')).toBe('EXPIRING');
    expect(insuranceStatusFor('2027-10-02', '2026-10-02')).toBe('CURRENT');
    const t = await publishedTender(90_000, 26);
    const a = await register(t.id, 'Insured');
    const put = (expiresOn: string) =>
      call(a.key, 'PUT', '/supplier/profile/insurance', {
        insurer: 'Safe Insurance Ltd',
        policyNumber: 'POL-12345',
        coverAud: 10_000_000,
        expiresOn,
      });
    const soon = new Date(clock.now().getTime() + 20 * DAY).toISOString().slice(0, 10);
    const r = await put(soon);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      insuranceStatus: 'EXPIRING',
      insurance: { insurer: 'Safe Insurance Ltd', coverAud: 10_000_000 },
    });
    expect(
      (
        await call(a.key, 'PUT', '/supplier/profile/insurance', {
          insurer: 'X',
          policyNumber: 'P',
          coverAud: 1,
          expiresOn: 'soon',
        })
      ).statusCode,
    ).toBe(400);
    await fullBid(a.key, t.id);
    clock.advanceDays(27);
    const staff = (await call('procurement', 'GET', `/tenders/${t.id}`)).json();
    expect(staff.submissions.items[0]).toMatchObject({
      company: a.company,
      sanctionsStatus: 'CLEAR',
      insuranceStatus: 'EXPIRED',
    }); // the certificate ran out while the tender was open
    expect((await call('procurement', 'GET', `/suppliers/${a.supplierId}`)).json().insuranceStatus).toBe(
      'EXPIRING',
    ); // last recorded status at the time of the update
    const p = await call(a.key, 'PUT', '/supplier/profile/privacy', {
      shareProfile: false,
      productUpdates: false,
    });
    expect(p.json().privacy).toEqual({ shareProfile: false, productUpdates: false });
    const audit = (
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'supplier.privacy_update')),
      )
    )[0]!;
    expect(audit.before.privacy).toEqual({ shareProfile: true, productUpdates: false });
    expect((await call('procurement', 'GET', '/supplier/profile')).statusCode).toBe(403);
  });

  it("a supplier adds and removes its own colleagues; the removed person loses access at once, everyone is told, and nobody can touch another company's contacts", async () => {
    const t = await publishedTender();
    const a = await register(t.id, 'Teamco');
    const other = await register(t.id, 'Otherco');
    const add = await call(a.key, 'POST', '/supplier/contacts', {
      name: 'New Colleague',
      email: 'new.colleague@teamco.example',
    });
    expect(add.statusCode, add.body).toBe(201);
    const token = new URL(add.json().activationPath, 'http://x').searchParams.get('token')!;
    expect((await emails('CONTACT_ADDED')).some((e) => e.toEmail === 'new.colleague@teamco.example')).toBe(
      true,
    );
    expect((await emails('CONTACT_ADDED')).every((e) => !e.body.includes(token))).toBe(true);
    expect(
      (
        await call(a.key, 'POST', '/supplier/contacts', {
          name: 'Dup',
          email: 'new.colleague@teamco.example',
        })
      ).statusCode,
    ).toBe(409);
    expect((await anon('POST', '/supplier/activate', { token, password: SUPPLIER_PW })).statusCode).toBe(200);
    const profile = (await call(a.key, 'GET', '/supplier/profile')).json();
    expect(profile.contacts.map((c: Json) => c.email).sort()).toEqual(
      [a.email, 'new.colleague@teamco.example'].sort(),
    );
    const colleague = profile.contacts.find((c: Json) => c.email === 'new.colleague@teamco.example');
    expect((await call('new.colleague@teamco.example', 'GET', `/supplier/tenders/${t.id}`)).statusCode).toBe(
      200,
    ); // they see the same tender
    // nobody removes themselves, or another company's contact
    expect(
      (
        await call(
          a.key,
          'POST',
          `/supplier/contacts/${profile.contacts.find((c: Json) => c.email === a.email).id}/deprovision`,
          { reason: 'Leaving' },
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call(other.key, 'POST', `/supplier/contacts/${colleague.id}/deprovision`, {
          reason: 'Not yours to remove',
        })
      ).statusCode,
    ).toBe(404);
    const rm = await call(a.key, 'POST', `/supplier/contacts/${colleague.id}/deprovision`, {
      reason: 'Left the company',
    });
    expect(rm.statusCode, rm.body).toBe(200);
    expect((await callHeld('new.colleague@teamco.example', '/supplier/tenders')).statusCode).toBe(401); // sessions ended
    expect(
      (await anon('POST', '/auth/login', { email: 'new.colleague@teamco.example', password: SUPPLIER_PW }))
        .statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect((await emails('CONTACT_REMOVED')).some((e) => e.toEmail === 'new.colleague@teamco.example')).toBe(
      true,
    );
    expect(((await call('procurement', 'GET', '/notifications')).json() as Json[])[0]!.title).toBe(
      'A supplier contact was removed',
    );
    expect(
      (await call(a.key, 'POST', `/supplier/contacts/${colleague.id}/deprovision`, { reason: 'Again' }))
        .statusCode,
    ).toBe(409);
  });

  it('the email log shows what would have been sent, to administrators and procurement only', async () => {
    const log = (await call('admin', 'GET', '/admin/email-log')).json() as Json[];
    expect(log.length).toBeGreaterThan(5);
    expect(log[0]).toMatchObject({ status: 'SIMULATED' });
    expect((await call('procurement', 'GET', '/admin/email-log')).statusCode).toBe(200);
    expect((await call('requester', 'GET', '/admin/email-log')).statusCode).toBe(403);
  });
});

describe('the deviation register (FR-0125)', () => {
  it('suppliers propose contract changes; the register is sealed until close, then legal rates them; it exports to Excel and Word', async () => {
    const t = await publishedTender(90_000, 26);
    const a = await register(t.id, 'Proposer');
    const b = await register(t.id, 'Second');
    const p1 = await call(a.key, 'POST', `/supplier/tenders/${t.id}/deviations`, {
      clauseRef: '12.1 Liability',
      proposal: 'Cap liability at twice the annual fee.',
      reason: 'Our insurer requires it',
    });
    expect(p1.statusCode, p1.body).toBe(201);
    await call(a.key, 'POST', `/supplier/tenders/${t.id}/deviations`, {
      clauseRef: '8 Payment',
      proposal: 'Pay within 14 days.',
    });
    const gone = await call(b.key, 'POST', `/supplier/tenders/${t.id}/deviations`, {
      clauseRef: '4 Term',
      proposal: 'Allow an option to end after year one.',
    });
    expect(
      (await call(b.key, 'DELETE', `/supplier/tenders/${t.id}/deviations/${gone.json().id}`)).statusCode,
    ).toBe(204);
    expect(
      (await call(a.key, 'DELETE', `/supplier/tenders/${t.id}/deviations/${gone.json().id}`)).statusCode,
    ).toBe(404);
    await call(b.key, 'POST', `/supplier/tenders/${t.id}/deviations`, {
      clauseRef: '4 Term',
      proposal: 'Allow an option to end after year one.',
    });
    expect(
      (await call(a.key, 'POST', `/supplier/tenders/${t.id}/deviations`, { clauseRef: '', proposal: 'x' }))
        .statusCode,
    ).toBe(400);
    // a supplier sees only their own, without legal's view
    const mine = (await call(a.key, 'GET', `/supplier/tenders/${t.id}/deviations`)).json() as Json[];
    expect(mine).toHaveLength(2);
    expect(JSON.stringify(mine)).not.toMatch(/risk|legalComment|company/);
    // sealed while open
    expect((await call('legal', 'GET', `/tenders/${t.id}/deviations`)).json()).toEqual({
      sealed: true,
      items: [],
    });
    expect((await call('legal', 'GET', `/tenders/${t.id}/deviations/export.xlsx`)).statusCode).toBe(409);
    await fullBid(a.key, t.id);
    clock.advanceDays(27);
    expect(
      (
        await call(a.key, 'POST', `/supplier/tenders/${t.id}/deviations`, {
          clauseRef: '9',
          proposal: 'Too late to add this.',
        })
      ).statusCode,
    ).toBe(409);
    const reg = (await call('legal', 'GET', `/tenders/${t.id}/deviations`)).json();
    expect(reg.sealed).toBe(false);
    expect(reg.items.map((i: Json) => [i.company.split(' ')[0], i.clauseRef])).toEqual([
      ['Proposer', '12.1 Liability'],
      ['Proposer', '8 Payment'],
      ['Second', '4 Term'],
    ]);
    const first = reg.items[0];
    expect(
      (await call('procurement', 'PUT', `/tender-deviations/${first.id}`, { risk: 'HIGH' })).statusCode,
    ).toBe(403); // legal decides
    const rated = await call('legal', 'PUT', `/tender-deviations/${first.id}`, {
      risk: 'HIGH',
      comment: 'Unlimited liability is a condition of the template.',
      status: 'NEGOTIATE',
    });
    expect(rated.statusCode, rated.body).toBe(200);
    expect(rated.json()).toMatchObject({
      risk: 'HIGH',
      status: 'NEGOTIATE',
      legalComment: 'Unlimited liability is a condition of the template.',
    });
    expect((await call('legal', 'PUT', `/tender-deviations/${first.id}`, {})).statusCode).toBe(400);
    const xlsx = await call('legal', 'GET', `/tenders/${t.id}/deviations/export.xlsx`);
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect(xlsx.rawPayload.toString('latin1')).toContain('Cap liability at twice the annual fee.');
    const docx = await call('procurement', 'GET', `/tenders/${t.id}/deviations/export.docx`);
    expect(docx.statusCode).toBe(200);
    expect(docx.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect((await call('evaluator-tech', 'GET', `/tenders/${t.id}/deviations`)).statusCode).toBe(403);
    expect(
      (
        await sys<Json[]>((tx) =>
          tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'deviation.export')),
        )
      ).length,
    ).toBe(2);
    expect(
      (
        await sys<Json[]>((tx) =>
          tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'deviation.assess')),
        )
      )[0]!.after,
    ).toMatchObject({ risk: 'HIGH' });
  });
});

describe('multi-stage tendering (FR-0220, FR-0225, FR-0230)', () => {
  it('shortlisting makes a separate pack and round for the shortlisted, tells the others, and carries forward what a supplier does not replace', async () => {
    const t = await publishedTender(90_000, 26);
    const a = await register(t.id, 'Shortlisted');
    const b = await register(t.id, 'Unsuccessful');
    const c = await register(t.id, 'AlsoOut');
    for (const x of [a, b, c]) await fullBid(x.key, t.id);
    clock.advanceDays(27);
    // not before the evaluation of this stage is complete
    expect(
      (await call('procurement', 'POST', `/tenders/${t.id}/shortlist`, { supplierIds: [a.supplierId] }))
        .statusCode,
    ).toBe(409);
    await sys(async (tx) => {
      await tx.update(s.tender).set({ status: 'EVALUATING' }).where(eq(s.tender.id, t.id));
      await tx.insert(s.evaluation).values({
        tenantId: (await tx.select().from(s.tender).where(eq(s.tender.id, t.id)))[0]!.tenantId,
        tenderId: t.id,
        status: 'LOCKED',
      });
    });
    expect(
      (await call('requester', 'POST', `/tenders/${t.id}/shortlist`, { supplierIds: [a.supplierId] }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call('procurement', 'POST', `/tenders/${t.id}/shortlist`, {
          supplierIds: [uid('supplier:summit')],
        })
      ).statusCode,
    ).toBe(422); // did not bid here
    expect(
      (await call('procurement', 'POST', `/tenders/${t.id}/shortlist`, { supplierIds: [] })).statusCode,
    ).toBe(400);
    const sl = await call('procurement', 'POST', `/tenders/${t.id}/shortlist`, {
      supplierIds: [a.supplierId],
      note: 'Thank you for a strong response.',
    });
    expect(sl.statusCode, sl.body).toBe(201);
    expect(sl.json()).toMatchObject({ nextStage: 2, shortlisted: 1, unsuccessfulNotified: 2 });
    expect(
      (await call('procurement', 'POST', `/tenders/${t.id}/shortlist`, { supplierIds: [a.supplierId] }))
        .statusCode,
    ).toBe(409);

    // the others are told, the shortlisted one is told something different
    expect((await emails('SHORTLISTED')).map((e) => e.toEmail)).toContain(a.email);
    expect((await emails('UNSUCCESSFUL')).map((e) => e.toEmail).sort()).toEqual(
      expect.arrayContaining([b.email, c.email]),
    );
    expect((await emails('UNSUCCESSFUL')).find((e) => e.toEmail === b.email)!.body).toContain(
      'Thank you for a strong response.',
    );
    expect(((await call(b.key, 'GET', '/notifications')).json() as Json[])[0]!.title).toBe(
      'Outcome of your response',
    );

    // stage 2 is its own tender: staged, linked, with a copy of the pack that can be changed on its own
    const stages = (await call('procurement', 'GET', `/tenders/${t.id}/stages`)).json() as Json[];
    expect(stages.map((x) => [x.stage, x.current, x.status])).toEqual([
      [1, true, 'EVALUATING'],
      [2, false, 'STAGED'],
    ]);
    expect(stages[0]!.shortlisted).toEqual([a.supplierId]);
    const next = stages[1]!;
    const nextView = (await call('procurement', 'GET', `/tenders/${next.tenderId}`)).json();
    expect(nextView).toMatchObject({ stage: 2, parentTenderId: t.id });
    const parentView = (await call('procurement', 'GET', `/tenders/${t.id}`)).json();
    expect(nextView.fields.find((f: Json) => f.key === 'requirements').value).toBe(
      parentView.fields.find((f: Json) => f.key === 'requirements').value,
    );
    expect(
      (
        await call('procurement', 'PUT', `/tenders/${next.tenderId}/fields/requirements`, {
          value: 'Stage two requirements, revised.',
          expectedVersion: nextView.version,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call('procurement', 'GET', `/tenders/${t.id}`))
        .json()
        .fields.find((f: Json) => f.key === 'requirements').value,
    ).toBe(parentView.fields.find((f: Json) => f.key === 'requirements').value);

    // only the shortlisted supplier is invited; it goes through the same permission and publication
    expect((await call(a.key, 'GET', '/supplier/tenders')).json().map((x: Json) => x.id)).not.toContain(
      next.tenderId,
    ); // not yet published
    expect(
      (await call('delegate', 'POST', `/tenders/${next.tenderId}/publish-permission`, {})).statusCode,
    ).toBe(200);
    expect(
      (await call('procurement', 'POST', `/tenders/${next.tenderId}/publish`, { closesAt: closeIn(30) }))
        .statusCode,
    ).toBe(200);
    expect(((await call(a.key, 'GET', '/supplier/tenders')).json() as Json[]).map((x) => x.id)).toContain(
      next.tenderId,
    );
    expect(((await call(b.key, 'GET', '/supplier/tenders')).json() as Json[]).map((x) => x.id)).not.toContain(
      next.tenderId,
    );
    expect((await call(b.key, 'GET', `/supplier/tenders/${next.tenderId}`)).statusCode).toBe(404);

    // the shortlisted supplier replaces the technical response only: pricing is carried forward from stage one
    expect((await upload(a.key, next.tenderId, 'technical-round-two.pdf', PDF, 'TECHNICAL')).statusCode).toBe(
      201,
    );
    const submit = await call(a.key, 'POST', `/supplier/tenders/${next.tenderId}/submission`);
    expect(submit.statusCode, submit.body).toBe(201);
    const files = (await call(a.key, 'GET', `/supplier/tenders/${next.tenderId}`)).json().submission
      .files as Json[];
    expect(files.map((f) => [f.name, f.section, Boolean(f.carriedForward)]).sort()).toEqual(
      [
        ['pricing.xlsx', 'COMMERCIAL', true],
        ['technical-round-two.pdf', 'TECHNICAL', false],
      ].sort(),
    );
    // stage one's own record is untouched
    const stage1Files = (await call(a.key, 'GET', `/supplier/tenders/${t.id}`)).json().submission
      .files as Json[];
    expect(stage1Files.map((f) => f.name).sort()).toEqual(['pricing.xlsx', 'technical.pdf']);
    expect(
      (
        await sys<Json[]>((tx) =>
          tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'tender.shortlist')),
        )
      )[0]!.after,
    ).toMatchObject({ shortlisted: 1, unsuccessful: 2 });
  });
});

describe('tender administrators cannot evaluate (FR-0190)', () => {
  it('a procurement lead, a probity officer or an administrator cannot be put on an evaluation panel, even if they also hold the evaluator role; a clean panel can', async () => {
    const t = await publishedTender(90_000, 26);
    const a = await register(t.id, 'Panelled');
    await fullBid(a.key, t.id);
    clock.advanceDays(27);
    // two people who run or oversee tenders are also given the evaluator role
    await sys((tx) =>
      tx.insert(s.roleAssignment).values([
        { tenantId: TENANT_ID, userId: uid('user:procurement'), role: 'EVALUATOR' },
        { tenantId: TENANT_ID, userId: uid('user:probity'), role: 'EVALUATOR' },
      ]),
    );
    const tech = uid('user:evaluator-tech');
    const comm = uid('user:evaluator-comm');
    for (const bad of ['procurement', 'probity']) {
      const open = await call('procurement', 'POST', `/tenders/${t.id}/evaluation`, {
        panel: [
          { userId: uid(`user:${bad}`), stream: 'TECHNICAL' },
          { userId: comm, stream: 'COMMERCIAL' },
        ],
      });
      expect(open.statusCode, `${bad}: ${open.body}`).toBe(403);
      expect(open.json().code).toBe('ROLE_SOD_VIOLATION');
      expect(JSON.stringify(open.json())).toContain('FR-0190');
    }
    const ok = await call('procurement', 'POST', `/tenders/${t.id}/evaluation`, {
      panel: [
        { userId: tech, stream: 'TECHNICAL' },
        { userId: comm, stream: 'COMMERCIAL' },
      ],
    });
    expect(ok.statusCode, ok.body).toBe(201);
    // and later, adding one of them is refused as well
    const add = await call('procurement', 'POST', `/evaluations/${ok.json().id}/panel`, {
      userId: uid('user:probity'),
      stream: 'TECHNICAL',
    });
    expect(add.statusCode).toBe(403);
    expect(add.json().code).toBe('ROLE_SOD_VIOLATION');
  });
});
