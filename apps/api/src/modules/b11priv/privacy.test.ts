import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID, emailFor, uid } from '../../db/seed.js';
import { BRIGHT, createEnv, type Json } from '../contract/test-env.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const today = () => env.clock.now().toISOString().slice(0, 10);
const plusDays = (n: number) =>
  new Date(env.clock.now().getTime() + n * 86_400_000).toISOString().slice(0, 10);
const lodge = async (who: string, body: Json) => {
  const r = await call(who, 'POST', '/privacy/requests', body);
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as Json;
};

describe('SEC-D08 collection notices', () => {
  it('shows the notice text and version where personal information is collected, without signing in', async () => {
    for (const context of ['SUPPLIER_REGISTRATION', 'USER_ACTIVATION', 'REQUEST_INTAKE']) {
      const r = await env.app.inject({ method: 'GET', url: `/api/v1/privacy/notice?context=${context}` });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({
        context,
        version: '2026-10',
        text: expect.stringContaining('We collect'),
      });
      expect(r.json().collectedFor.length).toBeGreaterThan(10);
    }
  });

  it('records an acknowledgement per user, place and version, once', async () => {
    const first = await call('requester', 'POST', '/privacy/notice/ack', { context: 'REQUEST_INTAKE' });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ version: '2026-10', already: false });
    const again = await call('requester', 'POST', '/privacy/notice/ack', { context: 'REQUEST_INTAKE' });
    expect(again.statusCode).toBe(200);
    expect(again.json().already).toBe(true);
    const st = (await call('requester', 'GET', '/privacy/notice/status')).json() as Json;
    expect(st.acknowledged.REQUEST_INTAKE).toEqual(expect.any(String));
    expect(st.acknowledged.USER_ACTIVATION).toBeNull();
    // a supplier contact acknowledges at registration or activation, in the supplier pool
    expect(
      (await call('supplier', 'POST', '/privacy/notice/ack', { context: 'SUPPLIER_REGISTRATION' }))
        .statusCode,
    ).toBe(201);
    const rows = await sys<Json[]>((tx) => tx.select().from(s.privacyNoticeAck));
    expect(rows.length).toBe(2);
    // a new notice version needs a fresh acknowledgement
    const put = await call('admin', 'PUT', '/privacy/settings', {
      noticeVersion: '2026-11',
      noticeText: 'A new notice that says what we collect and why we collect it.',
      officerRole: 'ADMIN',
      responseDays: 30,
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(
      ((await call('requester', 'GET', '/privacy/notice/status')).json() as Json).acknowledged.REQUEST_INTAKE,
    ).toBeNull();
    await call('admin', 'PUT', '/privacy/settings', { ...(put.json() as Json), noticeVersion: '2026-10' });
  });
});

describe('SEC-D08 access requests: verified, assembled from the person’s own records, released by the officer', () => {
  let access: Json;
  it('anyone signed in can lodge a request about themselves; identity is verified because they are signed in; due in 30 days', async () => {
    access = await lodge('requester', {
      kind: 'ACCESS',
      details: 'Please send me everything you hold about me',
    });
    expect(access).toMatchObject({
      kind: 'ACCESS',
      status: 'RECEIVED',
      channel: 'SELF',
      identityVerified: true,
      dueDate: plusDays(30),
      overdue: false,
    });
    expect(access.number).toMatch(/^PRV-\d{4}$/);
    const mine = ((await call('requester', 'GET', '/privacy/requests/mine')).json() as Json).items;
    expect(mine.map((r: Json) => r.id)).toContain(access.id);
    expect(((await call('procurement', 'GET', '/privacy/requests/mine')).json() as Json).items).toEqual([]);
  });

  it('only the privacy officer roles see the queue', async () => {
    for (const who of ['admin', 'legal', 'probity'])
      expect((await call(who, 'GET', '/privacy/requests')).statusCode).toBe(200);
    for (const who of ['requester', 'procurement', 'exec', 'supplier'])
      expect((await call(who, 'GET', '/privacy/requests')).statusCode).toBe(403);
    const q = (await call('legal', 'GET', '/privacy/requests')).json() as Json;
    expect(q.summary.open).toBeGreaterThanOrEqual(1);
    expect(q.responseDays).toBe(30);
  });

  it('the export holds the person’s own records and not other people’s private notes', async () => {
    await sys(async (tx) => {
      await tx.insert(s.reviewNote).values([
        {
          tenantId: TENANT_ID,
          authorId: uid('user:requester'),
          supplierId: BRIGHT,
          text: 'My own private note about Brightwave',
          visibility: 'PRIVATE',
          createdAt: env.clock.now(),
        },
        {
          tenantId: TENANT_ID,
          authorId: uid('user:procurement'),
          supplierId: BRIGHT,
          text: 'SOMEONE ELSES private note',
          visibility: 'PRIVATE',
          createdAt: env.clock.now(),
        },
      ]);
      await tx.insert(s.notification).values({
        tenantId: TENANT_ID,
        userId: uid('user:requester'),
        title: 'A notification for me',
        body: 'Hello',
      });
    });
    await call('requester', 'POST', '/requests', { title: 'My own request' });
    // the person cannot download before the officer completes the request
    expect((await call('requester', 'GET', `/privacy/requests/${access.id}/export`)).statusCode).toBe(409);
    // nobody else can: it looks like a request that does not exist
    expect((await call('procurement', 'GET', `/privacy/requests/${access.id}/export`)).statusCode).toBe(404);
    const exp = await call('legal', 'GET', `/privacy/requests/${access.id}/export`);
    expect(exp.statusCode, exp.body).toBe(200);
    expect(exp.headers['content-disposition']).toContain(`privacy-access-${access.number}.json`);
    const f = exp.json() as Json;
    expect(f).toMatchObject({ format: 'if-privacy-access-export-v1', found: true });
    expect(f.profile).toMatchObject({ email: emailFor('requester') });
    expect(f.requestsRaised.map((r: Json) => r.title)).toContain('My own request');
    expect(f.notesWritten.map((n: Json) => n.text)).toEqual(['My own private note about Brightwave']);
    expect(JSON.stringify(f)).not.toContain('SOMEONE ELSES');
    expect(f.notifications.map((n: Json) => n.title)).toContain('A notification for me');
    expect(f.activity.length).toBeGreaterThan(0);
    expect(f.privacyNoticeAcknowledgements.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(f)).not.toMatch(/passwordHash|password_hash|argon2/);
  });

  it('the officer completes it (after the export), then the person downloads their own file', async () => {
    const assign = await call('legal', 'POST', `/privacy/requests/${access.id}/assign`, {});
    expect(assign.json()).toMatchObject({ status: 'IN_PROGRESS' });
    const done = await call('legal', 'POST', `/privacy/requests/${access.id}/complete`, {
      summary: 'Export prepared and sent to the requester',
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ status: 'COMPLETED' });
    const mine = await call('requester', 'GET', `/privacy/requests/${access.id}/export`);
    expect(mine.statusCode, mine.body).toBe(200);
    expect(mine.json().profile.email).toBe(emailFor('requester'));
    expect(
      (
        await call('legal', 'POST', `/privacy/requests/${access.id}/refuse`, {
          reason: 'Too late to refuse now',
        })
      ).statusCode,
    ).toBe(409);
    const ev = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'privacy.export_generated')),
    );
    expect(ev.length).toBeGreaterThanOrEqual(2);
  });
});

describe('SEC-D08 requests logged for a caller, and the identity step', () => {
  it('staff must record how identity was verified before an export is made', async () => {
    const r = await call('legal', 'POST', '/privacy/requests/log', {
      requesterName: 'Pat Caller',
      requesterEmail: 'pat.caller@example.test',
      kind: 'ACCESS',
      details: 'Pat rang and asked what we hold about them',
    });
    expect(r.statusCode, r.body).toBe(201);
    const v = r.json() as Json;
    expect(v).toMatchObject({ channel: 'STAFF_LOGGED', identityVerified: false });
    expect((await call('legal', 'GET', `/privacy/requests/${v.id}/export`)).json()).toMatchObject({
      code: 'IDENTITY_NOT_VERIFIED',
    });
    expect(
      (
        await call('legal', 'POST', `/privacy/requests/${v.id}/complete`, {
          summary: 'Done without checking',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await call('legal', 'POST', `/privacy/requests/${v.id}/verify`, { method: 'x' })).statusCode,
    ).toBe(400);
    const ver = await call('legal', 'POST', `/privacy/requests/${v.id}/verify`, {
      method: 'Called back on the number held on file and checked two details',
    });
    expect(ver.json()).toMatchObject({
      identityVerified: true,
      verificationMethod: expect.stringContaining('Called back'),
    });
    const exp = await call('legal', 'GET', `/privacy/requests/${v.id}/export`);
    expect(exp.statusCode).toBe(200);
    expect(exp.json()).toMatchObject({ found: false });
    expect(
      (
        await call('requester', 'POST', '/privacy/requests/log', {
          requesterName: 'X',
          requesterEmail: 'x@example.test',
          kind: 'ACCESS',
          details: 'Not allowed',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('a request logged with the check already done starts verified', async () => {
    const r = await call('probity', 'POST', '/privacy/requests/log', {
      requesterName: 'Sam Walker',
      requesterEmail: 'sam.walker@example.test',
      kind: 'ACCESS',
      details: 'Walk-in request',
      verificationMethod: 'Photo ID sighted at the front desk',
    });
    expect(r.json()).toMatchObject({
      identityVerified: true,
      verificationMethod: 'Photo ID sighted at the front desk',
    });
  });
});

describe('SEC-D08 correction requests: allowed fields only, applied with a before and after audit', () => {
  it('a supplier contact lodges a correction through the supplier portal and the officer applies it', async () => {
    const before = (
      await sys<Json[]>((tx) =>
        tx
          .select()
          .from(s.appUser)
          .where(eq(s.appUser.id, uid('user:supplier'))),
      )
    )[0]!;
    const noValue = await call('supplier', 'POST', '/privacy/requests', {
      kind: 'CORRECTION',
      details: 'My name is wrong',
    });
    expect(noValue.statusCode).toBe(422);
    const bad = await call('supplier', 'POST', '/privacy/requests', {
      kind: 'CORRECTION',
      details: 'Change my role',
      correctionField: 'role',
      correctionValue: 'ADMIN',
    });
    expect(bad.statusCode).toBe(400);
    const req = await lodge('supplier', {
      kind: 'CORRECTION',
      details: 'My surname is spelt wrongly',
      correctionField: 'name',
      correctionValue: 'Casey Supplier-Jones',
    });
    expect(req).toMatchObject({ kind: 'CORRECTION', identityVerified: true });
    expect(
      (await call('legal', 'POST', `/privacy/requests/${req.id}/complete`, { summary: 'Corrected' }))
        .statusCode,
    ).toBe(409);
    const applied = await call('legal', 'POST', `/privacy/requests/${req.id}/apply-correction`);
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json()).toMatchObject({ correctionApplied: true });
    const after = (
      await sys<Json[]>((tx) =>
        tx
          .select()
          .from(s.appUser)
          .where(eq(s.appUser.id, uid('user:supplier'))),
      )
    )[0]!;
    expect(after.name).toBe('Casey Supplier-Jones');
    const ev = (
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'privacy.correction_applied')),
      )
    ).at(-1)!;
    expect(ev.before).toEqual({ name: before.name });
    expect(ev.after).toEqual({ name: 'Casey Supplier-Jones' });
    expect((await call('legal', 'POST', `/privacy/requests/${req.id}/apply-correction`)).statusCode).toBe(
      409,
    );
    expect(
      (
        await call('legal', 'POST', `/privacy/requests/${req.id}/complete`, {
          summary: 'Name corrected on the account',
        })
      ).json(),
    ).toMatchObject({ status: 'COMPLETED' });
    expect((await call('legal', 'GET', `/privacy/requests/${req.id}/export`)).statusCode).toBe(409); // not an access request
  });

  it('an email correction cannot take another account’s address', async () => {
    const req = await lodge('procurement', {
      kind: 'CORRECTION',
      details: 'Use my other address',
      correctionField: 'email',
      correctionValue: emailFor('legal'),
    });
    const r = await call('legal', 'POST', `/privacy/requests/${req.id}/apply-correction`);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('EMAIL_IN_USE');
  });

  it('a refusal needs a reason and is kept with it', async () => {
    const req = await lodge('finance', { kind: 'ACCESS', details: 'Everything about my colleague too' });
    expect(
      (await call('probity', 'POST', `/privacy/requests/${req.id}/refuse`, { reason: 'short' })).statusCode,
    ).toBe(400);
    const r = await call('probity', 'POST', `/privacy/requests/${req.id}/refuse`, {
      reason: 'The request is about another person, not the requester',
    });
    expect(r.json()).toMatchObject({
      status: 'REFUSED',
      refusalReason: 'The request is about another person, not the requester',
    });
    const ev = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.action, 'privacy.request_refused'), eq(s.auditEvent.entityId, req.id))),
    );
    expect(ev.length).toBe(1);
  });
});

describe('SEC-D08 overdue requests are flagged and escalated to the privacy officer, using the Clock', () => {
  it('due dates use the response-days setting', async () => {
    expect(
      (
        await call('admin', 'PUT', '/privacy/settings', {
          ...((await call('admin', 'GET', '/privacy/settings')).json() as Json),
          responseDays: 10,
        })
      ).statusCode,
    ).toBe(200);
    const r = await lodge('evaluator-tech', { kind: 'ACCESS', details: 'A request with a short deadline' });
    expect(r.dueDate).toBe(plusDays(10));
    await call('admin', 'PUT', '/privacy/settings', {
      ...((await call('admin', 'GET', '/privacy/settings')).json() as Json),
      responseDays: 30,
    });
  });

  it('flags the overdue request and escalates each once; notifies the officer role', async () => {
    const r = await lodge('delegate', { kind: 'ACCESS', details: 'This one will be late' });
    expect((await call('legal', 'POST', '/privacy/requests/run-overdue')).json()).toEqual({ escalated: 0 });
    env.clock.advanceDays(31);
    const list = ((await call('legal', 'GET', '/privacy/requests')).json() as Json).items as Json[];
    const mine = list.find((x) => x.id === r.id)!;
    expect(mine).toMatchObject({ overdue: true, status: 'RECEIVED' });
    expect(mine.dueDate < today()).toBe(true);
    const first = (await call('legal', 'POST', '/privacy/requests/run-overdue')).json() as Json;
    expect(first.escalated).toBeGreaterThanOrEqual(1);
    expect((await call('legal', 'POST', '/privacy/requests/run-overdue')).json()).toEqual({ escalated: 0 });
    const notes = await sys<Json[]>((tx) =>
      tx.select().from(s.notification).where(eq(s.notification.event, 'PRIVACY_OVERDUE')),
    );
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes.every((n) => n.link === '/app/privacy/manage')).toBe(true);
    const ev = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'privacy.request_overdue_escalated')),
    );
    expect(ev.length).toBeGreaterThanOrEqual(1);
    const after = ((await call('legal', 'GET', '/privacy/requests')).json() as Json).items.find(
      (x: Json) => x.id === r.id,
    );
    expect(after.escalatedAt).toEqual(expect.any(String));
    expect(
      ((await call('legal', 'GET', '/privacy/requests')).json() as Json).summary.overdue,
    ).toBeGreaterThanOrEqual(1);
  });
});
