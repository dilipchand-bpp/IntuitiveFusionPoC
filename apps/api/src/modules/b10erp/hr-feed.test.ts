import { and, eq, like } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { checkDelegation } from '../../authz/delegation.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { HR_DOMAIN, fetchHrBatch } from './hr-feed.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const run = async (body: Json = {}) => {
  const r = await call('admin', 'POST', '/hr-feed/run', body);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
const overview = async () => (await call('admin', 'GET', '/hr-feed/overview')).json() as Json;
const userRow = (email: string) =>
  sys<Json[]>((tx) => tx.select().from(s.appUser).where(eq(s.appUser.email, email))).then((r) => r[0]);
const rolesOf = async (email: string) => {
  const u = await userRow(email);
  return u
    ? (
        await sys<Json[]>((tx) => tx.select().from(s.roleAssignment).where(eq(s.roleAssignment.userId, u.id)))
      ).map((r) => r.role as string)
    : [];
};
const em = (n: string) => `${n}@${HR_DOMAIN}`;
const outcomeOf = (r: Json, id: string) => (r.results as Json[]).find((x) => x.eventId === id)!;
const PASSWORD2 = 'Activation-pass-123';
const login = (email: string, password: string) =>
  env.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });

describe('FR-0815 HR feed: the simulated feed is synthetic and deterministic', () => {
  it('uses only synthetic addresses and the same events every time', async () => {
    const at = new Date('2026-10-02T00:00:00Z');
    for (const n of [1, 2, 3]) {
      const a = await fetchHrBatch(n, at, 'SIMULATED_HR');
      expect(JSON.stringify(await fetchHrBatch(n, at, 'SIMULATED_HR'))).toBe(JSON.stringify(a));
      const text = JSON.stringify(a);
      for (const m of text.match(/[\w.]+@[\w.-]+/g) ?? []) expect(m.endsWith(`@${HR_DOMAIN}`), m).toBe(true);
    }
  });
});

describe('FR-0815 HR feed: starters, leavers, role and delegate changes applied automatically and idempotently', () => {
  it('with the HR connector switched off, nothing is applied and a manual task says what to do by hand', async () => {
    const r = await run();
    expect(r).toMatchObject({ ok: false, reason: 'DISABLED', results: [] });
    expect(r.manualTaskId).toBeTruthy();
    const again = await run();
    expect(again.manualTaskId).toBe(r.manualTaskId);
    expect(await userRow(em('ava.lindqvist'))).toBeUndefined();
  });

  it('a feed that is down is handled the same way, then the connector is switched on', async () => {
    expect((await call('admin', 'PUT', '/connectors/HR', { enabled: true, mode: 'DOWN' })).statusCode).toBe(
      200,
    );
    expect(await run()).toMatchObject({ ok: false, reason: 'DOWN' });
    expect((await call('admin', 'PUT', '/connectors/HR', { mode: 'UP' })).statusCode).toBe(200);
    const o = await overview();
    expect(o.connector).toMatchObject({ enabled: true, mode: 'UP' });
    expect(o.nextBatch).toBe(1);
  });

  it('dry run shows what would change and changes nothing', async () => {
    const dry = await run({ dryRun: true });
    expect(dry).toMatchObject({ ok: true, dryRun: true, batchRef: 'HR-BATCH-0001' });
    expect(dry.results.map((r: Json) => r.outcome)).toEqual(['APPLIED', 'APPLIED', 'APPLIED', 'NEEDS_HUMAN']);
    expect(outcomeOf(dry, 'HR-0001').detail).toMatch(
      /Would create Ava Lindqvist as REQUESTER, pending activation/,
    );
    expect(await userRow(em('ava.lindqvist'))).toBeUndefined();
    expect((await overview()).batches).toHaveLength(0);
    expect((await overview()).nextBatch).toBe(1);
  });

  it('batch 1: starters are created pending activation; the ADMIN role is never granted by the feed', async () => {
    const r = await run();
    expect(r.counts).toMatchObject({ total: 4, APPLIED: 3, NEEDS_HUMAN: 1 });
    expect(outcomeOf(r, 'HR-0004')).toMatchObject({ outcome: 'NEEDS_HUMAN', type: 'STARTER' });
    expect(outcomeOf(r, 'HR-0004').detail).toMatch(/never grants it/);
    expect(await userRow(em('dev.admin'))).toBeUndefined();
    const ava = (await userRow(em('ava.lindqvist')))!;
    expect(ava).toMatchObject({ name: 'Ava Lindqvist', active: true });
    expect(ava.orgUnitId).toBe(uid('unit:Procurement'));
    expect(await rolesOf(em('ava.lindqvist'))).toEqual(['REQUESTER']);
    expect(await rolesOf(em('ben.okafor'))).toEqual(['CONTRACT_MGR']);
    // cannot sign in until the person uses the one-time link
    expect((await login(em('ava.lindqvist'), PASSWORD2)).statusCode).toBe(401);
    const link = outcomeOf(r, 'HR-0001').activationPath as string;
    expect(link).toMatch(/^\/activate\?token=/);
    const o = await overview();
    expect(o.starters.find((x: Json) => x.email === em('ava.lindqvist'))).toMatchObject({
      awaitingActivation: true,
    });
    // the activation flow that exists for staff
    for (const id of ['HR-0001', 'HR-0003']) {
      const token = (outcomeOf(r, id).activationPath as string).split('token=')[1]!;
      const a = await env.app.inject({
        method: 'POST',
        url: '/api/v1/supplier/activate',
        payload: { token, password: PASSWORD2 },
      });
      expect(a.statusCode, a.body).toBe(200);
    }
    expect((await login(em('ava.lindqvist'), PASSWORD2)).statusCode).toBe(200);
  });

  it('applying the same batch again changes nothing: every event is recognised as already handled', async () => {
    const before = await sys<Json[]>((tx) => tx.select().from(s.appUser));
    const again = await run({ batch: 1 });
    expect(again.counts).toMatchObject({ total: 4, DUPLICATE: 4 });
    expect(again.results.every((r: Json) => r.outcome === 'DUPLICATE')).toBe(true);
    expect(await sys<Json[]>((tx) => tx.select().from(s.appUser))).toHaveLength(before.length);
    expect((await overview()).batches).toHaveLength(1);
    expect((await overview()).events).toHaveLength(4);
  });

  it('batch 2: role change, refused ADMIN, leaver with a named backup, and a delegate change capped at the delegator limit', async () => {
    // the leaver has open work: a delegation, a request they manage and a contract they own
    const chloe = (await userRow(em('chloe.marsh')))!;
    const d = await env.draft();
    await sys(async (tx) => {
      await tx.insert(s.delegation).values({
        tenantId: TENANT_ID,
        scope: 'SOURCING_APPROVAL',
        role: 'EVALUATOR',
        userId: chloe.id,
        maxValue: '50000',
      });
      await tx
        .update(s.request)
        .set({ managerId: chloe.id })
        .where(eq(s.request.id, uid('request:itmsp')));
      await tx.update(s.contract).set({ ownerId: chloe.id }).where(eq(s.contract.id, d.id));
    });
    // chloe activated her account and is signed in when she leaves
    const li = await login(em('chloe.marsh'), PASSWORD2);
    expect(li.statusCode).toBe(200);
    const cookies = Object.fromEntries(li.cookies.map((c) => [c.name, c.value]));
    expect((await env.app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies })).statusCode).toBe(200);
    const dry = await run({ dryRun: true });
    expect(outcomeOf(dry, 'HR-0007').detail).toMatch(/would be switched off.*3 open items/);

    const r = await run();
    expect(r.batchRef).toBe('HR-BATCH-0002');
    expect(outcomeOf(r, 'HR-0005').outcome).toBe('APPLIED');
    expect(await rolesOf(em('ben.okafor'))).toEqual(['PROCUREMENT']);
    expect(outcomeOf(r, 'HR-0006')).toMatchObject({ outcome: 'NEEDS_HUMAN' });
    expect(await rolesOf(em('ava.lindqvist'))).not.toContain('ADMIN');

    // leaver: switched off, link dead, work listed for the named backup
    expect(outcomeOf(r, 'HR-0007')).toMatchObject({ outcome: 'APPLIED', type: 'LEAVER' });
    expect((await userRow(em('chloe.marsh')))!.active).toBe(false);
    // her session ended at once, and she cannot sign in again
    expect((await env.app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies })).statusCode).toBe(401);
    expect((await login(em('chloe.marsh'), PASSWORD2)).statusCode).toBe(401);
    const o = await overview();
    const items = o.reassignments.filter((x: Json) => x.leaver === 'Chloe Marsh');
    expect(items.map((x: Json) => x.kind).sort()).toEqual(['CONTRACT', 'DELEGATION', 'REQUEST']);
    expect(items.every((x: Json) => x.backup === 'Ben Okafor' && x.status === 'OPEN')).toBe(true);
    const gone = await sys<Json[]>((tx) =>
      tx.select().from(s.delegation).where(eq(s.delegation.userId, chloe.id)),
    );
    expect(gone.every((x) => x.active === false)).toBe(true);
    const ben = (await userRow(em('ben.okafor')))!;
    const told = await sys<Json[]>((tx) =>
      tx.select().from(s.notification).where(eq(s.notification.userId, ben.id)),
    );
    expect(told.some((n) => /Chloe Marsh has left/.test(n.title))).toBe(true);

    // the acting delegate: the feed asked for 400,000, the delegator holds 250,000
    expect(outcomeOf(r, 'HR-0008')).toMatchObject({ outcome: 'CAPPED' });
    expect(outcomeOf(r, 'HR-0008').detail).toMatch(/limited to 250000.*asked for 400000/);
    const ava = (await userRow(em('ava.lindqvist')))!;
    const check = await sys<Json>((tx) =>
      checkDelegation(
        tx,
        { tenantId: TENANT_ID, userId: ava.id, roles: ['DELEGATE'] },
        'SOURCING_APPROVAL',
        249_000,
      ),
    );
    expect(check).toMatchObject({ allowed: true, limit: 250_000 });
    const over = await sys<Json>((tx) =>
      checkDelegation(
        tx,
        { tenantId: TENANT_ID, userId: ava.id, roles: ['DELEGATE'] },
        'SOURCING_APPROVAL',
        260_000,
      ),
    );
    expect(over).toMatchObject({ allowed: false, code: 'DELEGATION_EXCEEDED' });
    expect(await rolesOf(em('ava.lindqvist'))).toEqual(expect.arrayContaining(['REQUESTER', 'DELEGATE']));
    const dlg = o.delegations[0];
    expect(dlg).toMatchObject({
      delegate: 'Ava Lindqvist',
      requestedLimit: 400_000,
      appliedLimit: 250_000,
      status: 'ACTIVE',
    });
    // the exception list names what needs a person
    expect(o.exceptions.map((e: Json) => e.eventId).sort()).toEqual(['HR-0004', 'HR-0006', 'HR-0008']);
  });

  it('a time-bound delegation ends on its end date: the limit stops applying', async () => {
    const ava = (await userRow(em('ava.lindqvist')))!;
    env.clock.set('2026-10-20T09:00:00Z'); // 14 days start + 4 days past the end
    const r = await call('admin', 'POST', '/hr-feed/sync-delegations');
    expect(r.json()).toMatchObject({ started: 0, expired: 1 });
    const check = await sys<Json>((tx) =>
      checkDelegation(
        tx,
        { tenantId: TENANT_ID, userId: ava.id, roles: ['DELEGATE'] },
        'SOURCING_APPROVAL',
        1_000,
      ),
    );
    expect(check).toMatchObject({ allowed: false });
    expect((await overview()).delegations[0].status).toBe('EXPIRED');
    expect((await call('admin', 'POST', '/hr-feed/sync-delegations')).json()).toMatchObject({
      started: 0,
      expired: 0,
    });
    env.clock.set('2026-10-02T00:00:00Z');
  });

  it('batch 3: an unknown leaver, a repeated starter and a SUPPLIER role are refused or ignored; a future delegation is scheduled', async () => {
    const r = await run();
    expect(r.batchRef).toBe('HR-BATCH-0003');
    expect(outcomeOf(r, 'HR-0009')).toMatchObject({ outcome: 'REFUSED' });
    expect(outcomeOf(r, 'HR-0010')).toMatchObject({ outcome: 'NO_CHANGE' });
    expect(outcomeOf(r, 'HR-0011')).toMatchObject({ outcome: 'REFUSED' });
    expect(await rolesOf(em('ben.okafor'))).toEqual(['PROCUREMENT']);
    expect(outcomeOf(r, 'HR-0012').outcome).toBe('APPLIED');
    const o = await overview();
    const sched = o.delegations.find((x: Json) => x.eventId === 'HR-0012');
    expect(sched).toMatchObject({ delegate: 'Ben Okafor', status: 'SCHEDULED', appliedLimit: 100_000 });
    expect(
      await sys<Json[]>((tx) =>
        tx.select().from(s.delegation).where(eq(s.delegation.scope, 'CONTRACT_SIGNING')),
      ),
    ).toHaveLength(
      1, // only the seeded one: nothing exists before the start date
    );
    expect(o.nextBatch).toBeNull();
    const none = await call('admin', 'POST', '/hr-feed/run', {});
    expect(none.statusCode).toBe(409);
    expect(none.json().code).toBe('NO_NEW_BATCH');
    // the delegation starts when its date comes
    env.clock.set('2026-10-10T09:00:00Z');
    expect((await call('admin', 'POST', '/hr-feed/sync-delegations')).json()).toMatchObject({ started: 1 });
    const ben = (await userRow(em('ben.okafor')))!;
    expect(
      await sys<Json>((tx) =>
        checkDelegation(
          tx,
          { tenantId: TENANT_ID, userId: ben.id, roles: ['DELEGATE'] },
          'CONTRACT_SIGNING',
          100_000,
          null,
        ),
      ),
    ).toMatchObject({ allowed: true, limit: 100_000 });
    env.clock.set('2026-10-02T00:00:00Z');
  });

  it('every applied change is audited with source HR, and the feed run itself', async () => {
    const rows = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.tenantId, TENANT_ID), like(s.auditEvent.action, 'hr.%'))),
    );
    const actions = rows.map((r) => r.action as string);
    for (const a of [
      'hr.starter',
      'hr.role_change',
      'hr.leaver',
      'hr.delegate_change',
      'hr.delegation_start',
      'hr.delegation_end',
      'hr.feed_run',
    ])
      expect(actions, a).toContain(a);
    expect(rows.every((r) => (r.after as Json).source === 'HR')).toBe(true);
  });

  it('reassignments are closed by an administrator, once; only administrators can use the feed at all', async () => {
    const item = (await overview()).reassignments[0];
    const done = await call('admin', 'POST', `/hr-feed/reassignments/${item.id}/done`);
    expect(done.json()).toMatchObject({ status: 'DONE' });
    expect((await call('admin', 'POST', `/hr-feed/reassignments/${item.id}/done`)).statusCode).toBe(409);
    for (const who of ['requester', 'procurement', 'finance', 'exec', 'legal']) {
      expect((await call(who, 'GET', '/hr-feed/overview')).statusCode, who).toBe(403);
      expect((await call(who, 'POST', '/hr-feed/run', {})).statusCode, who).toBe(403);
    }
  });
});
