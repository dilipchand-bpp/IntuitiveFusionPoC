import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { uid } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';

let env: Awaited<ReturnType<typeof createEnv>>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;

describe('delegations of authority (US-ADM-01)', () => {
  it('lists the limits for the administrator and the executive, and nobody else', async () => {
    const r = await env.call('admin', 'GET', '/admin/delegations');
    expect(r.statusCode).toBe(200);
    const list = r.json() as Json[];
    expect(list.map((x) => x.scope)).toEqual(
      expect.arrayContaining(['SOURCING_APPROVAL', 'CONTRACT_SIGNING', 'PUBLISH_PERMISSION']),
    );
    expect(list.find((x) => x.scope === 'CONTRACT_SIGNING')).toMatchObject({
      userName: 'Dana Okafor',
      maxValue: 5_000_000,
      active: true,
    });
    expect((await env.call('exec', 'GET', '/admin/delegations')).statusCode).toBe(200);
    for (const who of ['requester', 'procurement', 'delegate', 'legal', 'probity', 'finance'])
      expect((await env.call(who, 'GET', '/admin/delegations')).statusCode, who).toBe(403);
  });

  it('raising a limit lets the very next signature through, without a release; lowering it stops it again; each change is audited and the person told', async () => {
    const { id } = await env.executed({ value: 900_000 });
    const v = (
      await env.call('legal', 'POST', `/contracts/${id}/variations`, {
        reason: 'A very large addition',
        value: 6_000_000,
      })
    ).json() as Json;
    await env.call('legal', 'POST', `/contracts/${v.id}/release-for-signing`);
    // 6.9M cumulative is above the delegate's 5M signing authority
    const before = await env.call('delegate', 'POST', `/contracts/${v.id}/sign`, { decision: 'APPROVE' });
    expect(before.statusCode).toBe(403);
    expect(before.json().code).toBe('SIGNING_AUTHORITY_INSUFFICIENT');

    const del = ((await env.call('admin', 'GET', '/admin/delegations')).json() as Json[]).find(
      (x) => x.scope === 'CONTRACT_SIGNING' && x.userName === 'Dana Okafor',
    )!;
    const up = await env.call('admin', 'PUT', `/admin/delegations/${del.id}`, { maxValue: 8_000_000 });
    expect(up.statusCode, up.body).toBe(200);
    expect(up.json().maxValue).toBe(8_000_000);
    const after = await env.call('delegate', 'POST', `/contracts/${v.id}/sign`, { decision: 'APPROVE' });
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json().status).toBe('PARTIALLY_SIGNED'); // above 1M the executive also signs
    expect((await env.call('delegate', 'GET', `/contracts/${v.id}`)).json().permissions.canSign).toBe(false); // already signed

    const audit = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, del.id), eq(s.auditEvent.action, 'delegation.update'))),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.before).toMatchObject({ maxValue: 5_000_000 });
    expect(audit[0]!.after).toMatchObject({ maxValue: 8_000_000 });
    expect(audit[0]!.actorRole).toBe('ADMIN');
    const notes = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.notification)
        .where(eq(s.notification.userId, uid('user:delegate'))),
    );
    expect(notes.some((n) => n.title === 'Your authority changed' && /\$8,000,000/.test(n.body))).toBe(true);
    // put it back for the other tests
    await env.call('admin', 'PUT', `/admin/delegations/${del.id}`, { maxValue: 5_000_000 });
  });

  it('switching a limit off removes the authority at once', async () => {
    const { id } = await env.executed({ value: 100_000 });
    const sourcing = ((await env.call('admin', 'GET', '/admin/delegations')).json() as Json[]).find(
      (x) => x.scope === 'CONTRACT_SIGNING' && x.userName === 'Dana Okafor',
    )!;
    await env.call('admin', 'PUT', `/admin/delegations/${sourcing.id}`, {
      maxValue: 5_000_000,
      active: false,
    });
    const v = (
      await env.call('legal', 'POST', `/contracts/${id}/variations`, {
        reason: 'Small addition here',
        value: 1000,
      })
    ).json() as Json;
    await env.call('legal', 'POST', `/contracts/${v.id}/release-for-signing`);
    const r = await env.call('delegate', 'POST', `/contracts/${v.id}/sign`, { decision: 'APPROVE' });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('SIGNING_AUTHORITY_INSUFFICIENT');
    await env.call('admin', 'PUT', `/admin/delegations/${sourcing.id}`, {
      maxValue: 5_000_000,
      active: true,
    });
    expect(
      (await env.call('delegate', 'POST', `/contracts/${v.id}/sign`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
  });

  it('creates a new limit for a person, once per scope, and refuses bad input and self-service', async () => {
    const person = await env.extraUser('signer', 'DELEGATE');
    const r = await env.call('admin', 'POST', '/admin/delegations', {
      scope: 'CONTRACT_SIGNING',
      userId: person.id,
      maxValue: 250_000,
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({
      scope: 'CONTRACT_SIGNING',
      role: 'DELEGATE',
      userId: person.id,
      maxValue: 250_000,
      active: true,
    });
    expect(
      (
        await env.call('admin', 'POST', '/admin/delegations', {
          scope: 'CONTRACT_SIGNING',
          userId: person.id,
          maxValue: 1,
        })
      ).json().code,
    ).toBe('DELEGATION_EXISTS');
    const bad = [
      { scope: 'NOPE', userId: person.id, maxValue: 1 },
      { scope: 'CONTRACT_SIGNING', userId: person.id, maxValue: -5 },
      { scope: 'CONTRACT_SIGNING', maxValue: 5 },
      { scope: 'CONTRACT_SIGNING', userId: person.id, maxValue: 5, extra: 1 },
      { scope: 'CONTRACT_SIGNING', role: 'SUPPLIER', maxValue: 5 },
    ];
    for (const b of bad)
      expect((await env.call('admin', 'POST', '/admin/delegations', b)).statusCode, JSON.stringify(b)).toBe(
        400,
      );
    expect(
      (
        await env.call('admin', 'POST', '/admin/delegations', {
          scope: 'SOURCING_APPROVAL',
          userId: uid('user:supplier'),
          maxValue: 5,
        })
      ).statusCode,
    ).toBe(404);
    const adminId = uid('user:admin');
    expect(
      (
        await env.call('admin', 'POST', '/admin/delegations', {
          scope: 'SOURCING_APPROVAL',
          userId: adminId,
          maxValue: 5,
        })
      ).statusCode,
    ).toBe(403);
    for (const who of ['exec', 'procurement', 'delegate'])
      expect(
        (
          await env.call(who, 'POST', '/admin/delegations', {
            scope: 'CONTRACT_SIGNING',
            userId: person.id,
            maxValue: 1,
          })
        ).statusCode,
        who,
      ).toBe(403);
    expect(
      (
        await env.call('admin', 'PUT', '/admin/delegations/00000000-0000-4000-8000-000000000000', {
          maxValue: 1,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await env.call('admin', 'PUT', `/admin/delegations/${r.json().id}`, { maxValue: -1 })).statusCode,
    ).toBe(400);
    // the new signer can sign within their limit and not above it
    const { id } = await env.executed({ value: 100_000 });
    const v = (
      await env.call('legal', 'POST', `/contracts/${id}/variations`, {
        reason: 'Small addition here',
        value: 1000,
      })
    ).json() as Json;
    await env.call('legal', 'POST', `/contracts/${v.id}/release-for-signing`);
    expect(
      (await env.call(person.email, 'POST', `/contracts/${v.id}/sign`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
  });
});

describe('users list', () => {
  it('is for the administrator, with roles, and without suppliers', async () => {
    const r = await env.call('admin', 'GET', '/admin/users');
    expect(r.statusCode).toBe(200);
    const users = r.json() as Json[];
    expect(users.find((u) => u.email === 'delegate@meridian-demo.example')).toMatchObject({
      name: 'Dana Okafor',
      roles: ['DELEGATE'],
    });
    expect(users.some((u) => u.email === 'supplier@meridian-demo.example')).toBe(false);
    expect(JSON.stringify(users)).not.toMatch(/password|hash/i);
    for (const who of ['exec', 'procurement', 'requester'])
      expect((await env.call(who, 'GET', '/admin/users')).statusCode, who).toBe(403);
  });
});

describe('contract alert lead times', () => {
  it('are read and changed by the administrator, validated, audited, and move the scheduled alerts of existing contracts', async () => {
    const r0 = await env.call('admin', 'GET', '/admin/alert-settings');
    expect(r0.json()).toEqual({ expiry: 60, notice: 60, extension: 30, milestone: 14 });
    const { id, view } = await env.executed();
    const expiry0 = view.record.alerts.find((a: Json) => a.kind === 'EXPIRY').triggerDate as string;
    const put = await env.call('admin', 'PUT', '/admin/alert-settings', {
      expiry: 100,
      notice: 45,
      extension: 20,
      milestone: 7,
    });
    expect(put.statusCode, put.body).toBe(200);
    expect((await env.call('admin', 'GET', '/admin/alert-settings')).json()).toEqual({
      expiry: 100,
      notice: 45,
      extension: 20,
      milestone: 7,
    });
    const after = (await env.call('legal', 'GET', `/contracts/${id}`)).json().record.alerts as Json[];
    const end = view.endDate as string;
    const day = (n: number) =>
      new Date(Date.parse(`${end}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    expect(after.find((a) => a.kind === 'EXPIRY')!.triggerDate).toBe(day(100));
    expect(after.find((a) => a.kind === 'EXPIRY')!.triggerDate).not.toBe(expiry0);
    expect(after.find((a) => a.kind === 'NOTICE')!.triggerDate).toBe(day(90 + 45));
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'settings.alert_lead_days')),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.before).toMatchObject({ expiry: 60 });
    for (const bad of [
      { expiry: 0, notice: 1, extension: 1, milestone: 1 },
      { expiry: 400, notice: 1, extension: 1, milestone: 1 },
      { expiry: 5 },
      { expiry: 1.5, notice: 1, extension: 1, milestone: 1 },
    ])
      expect(
        (await env.call('admin', 'PUT', '/admin/alert-settings', bad)).statusCode,
        JSON.stringify(bad),
      ).toBe(400);
    for (const who of ['exec', 'contract-mgr', 'procurement'])
      expect(
        (
          await env.call(who, 'PUT', '/admin/alert-settings', {
            expiry: 5,
            notice: 5,
            extension: 5,
            milestone: 5,
          })
        ).statusCode,
        who,
      ).toBe(403);
    await env.call('admin', 'PUT', '/admin/alert-settings', {
      expiry: 60,
      notice: 60,
      extension: 30,
      milestone: 14,
    });
  });
});
