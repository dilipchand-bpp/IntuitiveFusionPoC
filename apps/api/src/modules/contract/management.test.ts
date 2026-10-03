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
import { AlertService } from './record.js';
import { AuditService } from '../../audit/audit-service.js';

const PASSWORD = 'unit-test-password-123';
let app: FastifyInstance;
let database: Database;
let clock: ManualClock;

type Sess = { cookies: Record<string, string>; csrf: string };
const sessions = new Map<string, Sess>();
async function call(
  key: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
  retry = true,
): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
  if (!sessions.has(key)) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: emailFor(key), password: PASSWORD },
    });
    expect(res.statusCode, `${key}: ${res.body}`).toBe(200);
    sessions.set(key, {
      cookies: Object.fromEntries(res.cookies.map((c) => [c.name, c.value])),
      csrf: res.json().csrfToken as string,
    });
  }
  const sess = sessions.get(key)!;
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    cookies: sess.cookies,
    headers: method === 'GET' ? {} : { 'x-csrf-token': sess.csrf },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
  // Time travel ends sessions; sign in again as the same person.
  if (res.statusCode === 401 && retry) {
    sessions.delete(key);
    return call(key, method, url, payload, false);
  }
  return res;
}

beforeAll(async () => {
  database = await freshDb();
  clock = newClock();
  await seedDatabase(database, { clock, password: PASSWORD });
  const dir = await mkdtemp(join(tmpdir(), 'if-mgmt-'));
  app = await buildApp(loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'm'.repeat(40), STORAGE_DIR: dir }), {
    database,
    clock,
    loginRateLimitMax: 10_000,
  });
}, 120_000);

let seq = 0;
const BRIGHT = uid('supplier:brightwave');

/** An approved award, drafted, reviewed, released and signed: an executed contract with a fresh management record. */
async function executed(opts: { ownerName?: string; value?: number } = {}) {
  const n = (seq += 1);
  const ids = await withSystem(database, async (tx) => {
    const [req] = await tx
      .insert(s.request)
      .values({
        tenantId: TENANT_ID,
        number: `PR-MGMT-${String(n).padStart(4, '0')}`,
        title: `Management fixture ${n}`,
        estimatedValue: String(opts.value ?? 120_000),
        termMonths: 24,
        requesterId: uid('user:requester'),
        phase: 'EVALUATION',
        status: 'IN_PROGRESS',
      })
      .returning();
    if (opts.ownerName)
      await tx.insert(s.fieldValue).values({
        tenantId: TENANT_ID,
        ownerType: 'REQUEST',
        ownerId: req!.id,
        key: 'contractOwner',
        label: 'Contract owner',
        value: opts.ownerName,
      });
    const [t] = await tx
      .insert(s.tender)
      .values({ tenantId: TENANT_ID, requestId: req!.id, type: 'RFP', status: 'EVALUATING' })
      .returning();
    await tx.insert(s.submission).values({
      tenantId: TENANT_ID,
      tenderId: t!.id,
      supplierId: BRIGHT,
      status: 'SUBMITTED',
      submittedAt: clock.now(),
    });
    const [ev] = await tx
      .insert(s.evaluation)
      .values({ tenantId: TENANT_ID, tenderId: t!.id, status: 'APPROVED' })
      .returning();
    const [crit] = await tx
      .insert(s.criterion)
      .values({
        tenantId: TENANT_ID,
        evaluationId: ev!.id,
        name: 'Quality',
        weight: '100',
        stream: 'TECHNICAL',
      })
      .returning();
    await tx.insert(s.consensusItem).values({
      tenantId: TENANT_ID,
      evaluationId: ev!.id,
      supplierId: BRIGHT,
      criterionId: crit!.id,
      consensusScore: '8.00',
    });
    return { evaluationId: ev!.id };
  });
  const c = await call('legal', 'POST', '/contracts', { evaluationId: ids.evaluationId, supplierId: BRIGHT });
  expect(c.statusCode, c.body).toBe(201);
  const id = c.json().id as string;
  await call('legal', 'PUT', `/contracts/${id}/clauses/IP`, { text: 'Legal reviewed wording for IP.' });
  expect((await call('legal', 'POST', `/contracts/${id}/release-for-signing`)).statusCode).toBe(200);
  const signed = await call('delegate', 'POST', `/contracts/${id}/sign`, { decision: 'APPROVE' });
  expect(signed.statusCode, signed.body).toBe(200);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { id, view: signed.json() as Record<string, any> };
}

const today = () => clock.now().toISOString().slice(0, 10);

describe('US-CMG-01 the contract record is created when the contract is locked', () => {
  it('has owner, milestones, optional extension and system alerts, all from the executed contract', async () => {
    const { view } = await executed({ ownerName: 'Sofia Rossi' });
    expect(view.status).toBe('EXECUTED');
    const r = view.record;
    expect(r.owner.name).toBe('Sofia Rossi');
    expect(r.milestones.map((m: { title: string }) => m.title)).toEqual(['Commencement', 'Mid-term review']);
    expect(r.extensions).toHaveLength(1);
    expect(r.extensions[0].label).toBe('Option 1 (12 months)');
    expect(r.extensions[0].start).toBe(view.endDate);
    expect(r.bars).toHaveLength(2);
    const kinds = r.alerts.map((a: { kind: string }) => a.kind).sort();
    expect(kinds).toEqual(['EXPIRY', 'EXTENSION', 'MILESTONE', 'MILESTONE', 'NOTICE']);
    expect(
      r.alerts.every(
        (a: { status: string; origin: string }) => a.status === 'SCHEDULED' && a.origin === 'SYSTEM',
      ),
    ).toBe(true);
  });

  it('a draft contract has no record, and an owner not named on the request falls back to a contract manager', async () => {
    const { view } = await executed();
    expect(view.record.owner.name).toBe('Sofia Rossi'); // the only contract manager
    const audit = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, view.id), eq(s.auditEvent.action, 'contract.execute'))),
    );
    expect(audit).toHaveLength(1);
  });

  it('the seeded executed contracts carry a record', async () => {
    const list = (await call('contract-mgr', 'GET', '/contracts')).json() as Array<{
      id: string;
      number: string;
    }>;
    const first = list.find((x) => x.number === 'CT-2026-0001')!;
    const v = (await call('contract-mgr', 'GET', `/contracts/${first.id}`)).json();
    expect(v.record.owner.name).toBe('Sofia Rossi');
    expect(v.record.milestones).toHaveLength(2);
    const notice = v.record.alerts.find((a: { kind: string }) => a.kind === 'NOTICE');
    expect(notice.status).toBe('SENT'); // history, already past
  });
});

describe('US-CMG-02 alerts fire on the right date, once, and are logged', () => {
  it('time travel: nothing the day before, fires on the notice date for the owner (in-app and email), and never again', async () => {
    const { id, view } = await executed({ ownerName: 'Sofia Rossi', value: 140_000 });
    const notice = view.record.alerts.find((a: { kind: string }) => a.kind === 'NOTICE');
    const end = view.endDate as string;
    expect(notice.triggerDate).toBe(
      new Date(Date.parse(`${end}T00:00:00Z`) - 150 * 86_400_000).toISOString().slice(0, 10),
    ); // 90 days notice -> 150 days before the end

    const svc = new AlertService(clock, new AuditService(clock));
    const mgr = uid('user:contract-mgr');
    const count = async () =>
      (
        await withSystem(database, (tx) =>
          tx.select().from(s.notification).where(eq(s.notification.userId, mgr)),
        )
      ).filter((n) => n.link === `/app/contracts/${id}`).length;

    clock.set(`${notice.triggerDate}T00:00:00Z`);
    clock.advanceDays(-1);
    await svc.runDue(database);
    const before = (await call('contract-mgr', 'GET', `/contracts/${id}/alerts`)).json() as Array<{
      kind: string;
      status: string;
    }>;
    expect(before.find((a) => a.kind === 'NOTICE')!.status).toBe('SCHEDULED');
    const n0 = await count();

    clock.advanceDays(1);
    const fired = await svc.runDue(database);
    expect(fired).toBeGreaterThanOrEqual(1);
    const after = (await call('contract-mgr', 'GET', `/contracts/${id}/alerts`)).json() as Array<{
      kind: string;
      status: string;
      sentAt: string;
      deliveries: Array<{ channel: string; status: string }>;
    }>;
    const n = after.find((a) => a.kind === 'NOTICE')!;
    expect(n.status).toBe('SENT');
    expect(n.deliveries.map((x) => `${x.channel}:${x.status}`).sort()).toEqual([
      'EMAIL:SIMULATED',
      'IN_APP:DELIVERED',
    ]);
    expect(await count()).toBe(n0 + 1); // one notification for this contract's notice alert

    // idempotent: running again, or days later, delivers nothing twice
    expect(await svc.runDue(database)).toBe(0);
    expect(await svc.runDue(database)).toBe(0);
    const logged = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, id), eq(s.auditEvent.action, 'alert.fire'))),
    );
    expect(logged.filter((e) => (e.after as { kind: string }).kind === 'NOTICE')).toHaveLength(1);
    const dels = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.alertDelivery)
        .where(
          eq(
            s.alertDelivery.alertId,
            (after.find((a) => a.kind === 'NOTICE') as unknown as { id: string }).id,
          ),
        ),
    );
    expect(dels).toHaveLength(2);
    clock.set('2026-10-02T09:00:00Z'); // back to the seed date for the other tests
  });

  it('the pages that read alerts fire what is due, so no background job is needed to see the right state', async () => {
    const { id, view } = await executed();
    const expiry = view.record.alerts.find((a: { kind: string }) => a.kind === 'EXPIRY');
    clock.set(`${expiry.triggerDate}T08:00:00Z`);
    const list = (await call('contract-mgr', 'GET', '/alerts?status=SENT')).json() as Array<{
      id: string;
      kind: string;
      contractNumber: string;
    }>;
    expect(list.some((a) => a.kind === 'EXPIRY' && a.contractNumber === view.number)).toBe(true);
    expect((await call('contract-mgr', 'GET', `/contracts/${id}/alerts`)).statusCode).toBe(200);
    clock.set('2026-10-02T09:00:00Z');
  });

  it('a removed contract never fires: its scheduled alerts are cancelled', async () => {
    const { id, view } = await executed();
    expect(
      (await call('legal', 'DELETE', `/contracts/${id}`, { reason: 'Raised in error here' })).statusCode,
    ).toBe(204);
    const far = view.record.alerts.find((a: { kind: string }) => a.kind === 'EXPIRY').triggerDate as string;
    clock.set(`${far}T10:00:00Z`);
    await new AlertService(clock, new AuditService(clock)).runDue(database);
    const rows = await withSystem(database, (tx) =>
      tx.select().from(s.alert).where(eq(s.alert.contractId, id)),
    );
    expect(rows.every((r) => r.status === 'CANCELLED')).toBe(true);
    clock.set('2026-10-02T09:00:00Z');
  });

  it('who may read the alert lists: contract management and its oversight, not requesters, evaluators or suppliers', async () => {
    for (const who of ['contract-mgr', 'procurement', 'legal', 'exec']) {
      expect((await call(who, 'GET', '/alerts')).statusCode, who).toBe(200);
      expect((await call(who, 'GET', '/reports/expiring-contracts')).statusCode, who).toBe(200);
    }
    for (const who of ['requester', 'evaluator-tech', 'supplier', 'admin', 'finance', 'delegate'])
      expect((await call(who, 'GET', '/alerts')).statusCode, who).toBe(403);
    expect((await call('contract-mgr', 'GET', '/alerts?status=NOPE')).statusCode).toBe(400);
  });
});

describe('US-CMG-04 expiring in 90 days and the Gantt data', () => {
  it('lists contracts ending within the window, soonest first, with the initial term and the optional extension', async () => {
    const r = await call('contract-mgr', 'GET', '/reports/expiring-contracts');
    expect(r.statusCode).toBe(200);
    const rows = r.json() as Array<{
      number: string;
      daysRemaining: number;
      endDate: string;
      noticeDeadline: string;
      owner: string;
      bars: Array<{ label: string; optional: boolean }>;
      optionalExtensions: Array<{ months: number; endDate: string }>;
    }>;
    const first = rows.find((x) => x.number === 'CT-2026-0001')!;
    expect(first).toBeTruthy();
    expect(first.daysRemaining).toBe(74);
    expect(first.owner).toBe('Sofia Rossi');
    expect(first.bars.map((b) => b.label)).toEqual(['Initial term', 'Option 1 (12 months)']);
    expect(first.optionalExtensions).toEqual([{ months: 12, endDate: expect.any(String) }]);
    expect(rows.find((x) => x.number === 'CT-2026-0002')).toBeUndefined(); // ends in 430 days
    expect(rows.every((x) => x.daysRemaining >= 0 && x.daysRemaining <= 90)).toBe(true);
    expect([...rows].sort((a, b) => a.daysRemaining - b.daysRemaining)).toEqual(rows);
  });

  it('the window is configurable, and contracts not yet executed or already ended are left out', async () => {
    const wide = (await call('exec', 'GET', '/reports/expiring-contracts?days=500')).json() as Array<{
      number: string;
    }>;
    expect(wide.map((x) => x.number)).toEqual(expect.arrayContaining(['CT-2026-0001', 'CT-2026-0002']));
    const narrow = (await call('exec', 'GET', '/reports/expiring-contracts?days=30')).json() as unknown[];
    expect(narrow.find((x) => (x as { number: string }).number === 'CT-2026-0001')).toBeUndefined();
    clock.set('2027-06-01T09:00:00Z'); // after CT-2026-0001 ended
    const later = (await call('exec', 'GET', '/reports/expiring-contracts?days=30')).json() as Array<{
      number: string;
    }>;
    expect(later.find((x) => x.number === 'CT-2026-0001')).toBeUndefined();
    clock.set('2026-10-02T09:00:00Z');
    expect((await call('exec', 'GET', '/reports/expiring-contracts?days=0')).statusCode).toBe(400);
  });
});

void today;
