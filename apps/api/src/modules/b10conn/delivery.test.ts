import { createHmac } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../audit/audit-service.js';
import * as s from '../../db/schema.js';
import { TENANT_ID } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { runDueDeliveries } from './dispatch.js';
import { MAX_ATTEMPTS, BACKOFF_MINUTES } from './delivery.js';
import { canonicalJson, signedHeaders, verifyMessage, signMessage } from './signing.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const put = async (kind: string, body: Json) => {
  const r = await call('admin', 'PUT', `/connectors/${kind}`, body);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
const secret = async (kind: string, value: string) => {
  const r = await call('admin', 'PUT', `/secrets/connector.${kind.toLowerCase()}.webhook`, { value });
  expect(r.statusCode, r.body).toBe(200);
};
const events = (kind: string) =>
  sys<Json[]>((tx) =>
    tx
      .select()
      .from(s.integrationEvent)
      .where(and(eq(s.integrationEvent.tenantId, TENANT_ID), eq(s.integrationEvent.connectorKind, kind)))
      .orderBy(asc(s.integrationEvent.createdAt), asc(s.integrationEvent.idempotencyKey)),
  );
const tasks = async (who = 'admin', status?: string) =>
  (await call(who, 'GET', `/manual-tasks${status ? `?status=${status}` : ''}`)).json() as Json[];
const setting = async (name: string, value: unknown) => {
  const r = await call('admin', 'PUT', '/admin/settings', { [name]: value });
  expect(r.statusCode, r.body).toBe(200);
};

const SECRET = 'middleware-leg-shared-secret-1';
const webhook = (
  body: Json,
  opts: { secret?: string; ts?: number; tamper?: Json; headers?: boolean } = {},
) => {
  const ts = String(opts.ts ?? Math.floor(env.clock.now().getTime() / 1000));
  const sig = createHmac('sha256', opts.secret ?? SECRET)
    .update(`${ts}.${canonicalJson(body)}`)
    .digest('hex');
  return env.app.inject({
    method: 'POST',
    url: '/api/v1/integrations/MIDDLEWARE/webhook',
    headers: opts.headers === false ? {} : { 'x-if-signature': sig, 'x-if-timestamp': ts },
    payload: opts.tamper ?? body,
  });
};

describe('SEC-TP04 middleware leg security: signed and authenticated delivery both ways', () => {
  it('signs a message over timestamp and body, and a receiver rejects a changed body, a wrong secret or an old timestamp', () => {
    const body = { b: 2, a: { y: 1, x: [3, 2] } };
    const h = signedHeaders(SECRET, env.clock, body);
    const ok = {
      secret: SECRET,
      signature: h['X-IF-Signature'],
      timestamp: h['X-IF-Timestamp'],
      clock: env.clock,
    };
    expect(verifyMessage({ ...ok, body: { a: { x: [3, 2], y: 1 }, b: 2 } })).toEqual({ ok: true }); // key order is irrelevant
    expect(verifyMessage({ ...ok, body: { ...body, b: 3 } })).toMatchObject({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
    expect(verifyMessage({ ...ok, body, secret: 'another-secret-entirely' })).toMatchObject({
      reason: 'BAD_SIGNATURE',
    });
    expect(verifyMessage({ ...ok, body, secret: null })).toMatchObject({ reason: 'NO_SECRET' });
    const old = String(Number(h['X-IF-Timestamp']) - 301);
    expect(
      verifyMessage({ ...ok, body, timestamp: old, signature: signMessage(SECRET, old, body) }),
    ).toMatchObject({
      reason: 'STALE_TIMESTAMP',
    });
    // 300 seconds is still inside the window
    const edge = String(Number(h['X-IF-Timestamp']) - 300);
    expect(
      verifyMessage({ ...ok, body, timestamp: edge, signature: signMessage(SECRET, edge, body) }),
    ).toEqual({ ok: true });
  });

  it('accepts a correctly signed webhook, and refuses a tampered body, a wrong secret, a stale timestamp, no signature and a replay', async () => {
    await secret('MIDDLEWARE', SECRET);
    const msg = {
      eventId: 'mw-evt-0001',
      type: 'ORDER_UPDATED',
      data: { order: 'PO-1', status: 'APPROVED' },
    };
    const ok = await webhook(msg);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({ accepted: true, eventId: 'mw-evt-0001' });
    const stored = (await events('MIDDLEWARE')).find(
      (e) => e.idempotencyKey === 'in:MIDDLEWARE:mw-evt-0001',
    )!;
    expect(stored).toMatchObject({ direction: 'IN', status: 'DELIVERED', kind: 'ORDER_UPDATED' });

    const fresh = {
      eventId: 'mw-evt-0002',
      type: 'ORDER_UPDATED',
      data: { order: 'PO-2', status: 'APPROVED' },
    };
    const tampered = await webhook(fresh, {
      tamper: { ...fresh, data: { order: 'PO-2', status: 'CANCELLED' } },
    });
    expect(tampered.statusCode).toBe(401);
    expect((await webhook(fresh, { secret: 'not-the-connector-secret-1' })).statusCode).toBe(401);
    const nowS = Math.floor(env.clock.now().getTime() / 1000);
    expect((await webhook(fresh, { ts: nowS - 400 })).statusCode).toBe(401);
    expect((await webhook(fresh, { ts: nowS + 400 })).statusCode).toBe(401);
    expect((await webhook(fresh, { headers: false })).statusCode).toBe(401);
    // none of the refused messages left a trace, and the genuine one still goes through afterwards
    expect((await events('MIDDLEWARE')).some((e) => e.idempotencyKey === 'in:MIDDLEWARE:mw-evt-0002')).toBe(
      false,
    );
    expect((await webhook(fresh, { ts: nowS - 299 })).statusCode).toBe(200);

    // a replay of an accepted event is refused, even with a fresh valid signature, and changes nothing
    const replay = await webhook(msg);
    expect(replay.statusCode).toBe(409);
    expect(replay.json().code).toBe('REPLAYED');
    expect(
      (await events('MIDDLEWARE')).filter((e) => e.idempotencyKey === 'in:MIDDLEWARE:mw-evt-0001'),
    ).toHaveLength(1);
    // an unknown organisation and the legal kind get no more than a refusal
    const unknown = await env.app.inject({
      method: 'POST',
      url: '/api/v1/integrations/MIDDLEWARE/webhook',
      headers: { 'x-if-tenant': 'nobody', 'x-if-signature': 'x', 'x-if-timestamp': String(nowS) },
      payload: fresh,
    });
    expect(unknown.statusCode).toBe(401);
  });

  it('shows the evidence: algorithm, replay window, the secret fingerprint and how many attempts were rejected', async () => {
    const v = (await call('procurement', 'GET', '/connectors/MIDDLEWARE/security')).json() as Json;
    expect(v).toMatchObject({
      kind: 'MIDDLEWARE',
      algorithm: 'HMAC-SHA256',
      replayWindowSeconds: 300,
      headers: ['X-IF-Signature', 'X-IF-Timestamp'],
    });
    expect(v.rejected.count).toBe(6); // tampered, wrong secret, two stale, unsigned, and the replay
    expect(v.rejected.lastReason).toBe('REPLAYED');
    expect(v.secret).toMatchObject({ set: true, name: 'connector.middleware.webhook' });
    expect(v.secret.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(v)).not.toContain(SECRET);
    expect(v.recentInbound.map((x: Json) => x.eventId)).toContain('mw-evt-0001');
    expect((await call('requester', 'GET', '/connectors/MIDDLEWARE/security')).statusCode).toBe(403);
    const trail = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'integration.webhook_rejected')),
    );
    expect(trail.length).toBe(v.rejected.count);
  });

  it('refuses to deliver outward without a secret to sign with, and delivers once one is set', async () => {
    const r = await call('procurement', 'POST', '/connectors/ESIGN/sync', { items: [{ ref: 'ENV-1' }] });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().events[0]).toMatchObject({ status: 'FAILED' });
    expect(r.json().events[0].lastError).toMatch(/not signed/);
    await secret('ESIGN', 'esign-connector-secret-000001');
    const retry = (await call('procurement', 'POST', '/integration-events/retry')).json() as Json;
    expect(retry.delivered).toBeGreaterThanOrEqual(1);
    const ev = (await events('ESIGN'))[0]!;
    expect(ev).toMatchObject({ status: 'DELIVERED' });
    expect(ev.remoteAckAt).not.toBeNull();
  });
});

describe('NFR-AV04 manual fallback when the legal system is down', () => {
  it('raises the matter anyway, queues a manual task with instructions, and a person completes it with a reference', async () => {
    await setting('legalPlatform', {
      enabled: true,
      name: 'HighQ',
      webhookSecret: '',
      simulateOutage: false,
    });
    await put('LEGAL', { mode: 'DOWN' });
    const m = await call('legal', 'POST', '/legal/matters', {
      title: 'Review the indemnity wording',
      priority: 'HIGH',
    });
    expect(m.statusCode, m.body).toBe(201); // the user's work is not blocked
    expect(m.json().integration).toBe('FAILED');
    const open = (await tasks('legal', 'OPEN')).filter((t) => t.connector === 'LEGAL');
    expect(open).toHaveLength(1);
    expect(open[0]!.title).toMatch(/Review the indemnity wording/);
    expect(open[0]!.instructions).toMatch(/HighQ|legal platform/i);
    expect(open[0]!.instructions).toMatch(/Mark done/);
    const conn = (await call('legal', 'GET', '/connectors'))
      .json()
      .connectors.find((c: Json) => c.kind === 'LEGAL');
    expect(conn.openManualTasks).toBe(1);
    expect(conn.health.state).toBe('DOWN');
    // only people who work the matter can close it; the executive can see it
    expect((await tasks('exec')).length).toBeGreaterThan(0);
    expect(
      (await call('exec', 'POST', `/manual-tasks/${open[0]!.id}/complete`, { reference: 'X-1' })).statusCode,
    ).toBe(403);
    expect((await call('legal', 'POST', `/manual-tasks/${open[0]!.id}/complete`, {})).statusCode).toBe(400);
    const done = await call('legal', 'POST', `/manual-tasks/${open[0]!.id}/complete`, {
      reference: 'HQ-MANUAL-77',
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ status: 'DONE', reference: 'HQ-MANUAL-77' });
    expect(
      (await call('legal', 'POST', `/manual-tasks/${open[0]!.id}/complete`, { reference: 'again' }))
        .statusCode,
    ).toBe(409);
    // the matter carries the reference the person typed, and the platform does not send it a second time
    const board = (await call('legal', 'GET', '/legal/matters')).json();
    const matter = board.lanes.flatMap((l: Json) => l.matters).find((x: Json) => x.id === m.json().id);
    expect(matter.externalRef).toBe('HQ-MANUAL-77');
    await put('LEGAL', { mode: 'UP' });
    expect((await call('legal', 'POST', '/integration-events/retry')).json().retried).toBe(0);
  });

  it('replays what was queued when the system recovers, and marks the manual task superseded', async () => {
    await put('LEGAL', { mode: 'DOWN' });
    const m = await call('legal', 'POST', '/legal/matters', { title: 'Check the termination clause' });
    expect(m.json().integration).toBe('FAILED');
    expect((await tasks('legal', 'OPEN')).filter((t) => t.connector === 'LEGAL')).toHaveLength(1);
    await put('LEGAL', { mode: 'UP' });
    const retry = (await call('legal', 'POST', '/integration-events/retry')).json() as Json;
    expect(retry).toMatchObject({ retried: 1, delivered: 1 });
    const sup = (await tasks('legal', 'SUPERSEDED')).filter((t) => t.connector === 'LEGAL');
    expect(sup).toHaveLength(1);
    expect(sup[0]!.title).toMatch(/termination clause/);
    expect((await tasks('legal', 'OPEN')).filter((t) => t.connector === 'LEGAL')).toHaveLength(0);
    const board = (await call('legal', 'GET', '/legal/matters')).json();
    const matter = board.lanes.flatMap((l: Json) => l.matters).find((x: Json) => x.id === m.json().id);
    expect(matter.externalRef).toMatch(/^HIGH-[0-9A-F]{6}$/);
  });

  it('queues the work by hand for an ERP sync too, whether the connector is down or its breaker is open', async () => {
    await secret('ERP', 'erp-connector-secret-0000001');
    await put('ERP', { mode: 'DOWN' });
    const r = (
      await call('finance', 'POST', '/connectors/ERP/sync', {
        items: [{ ref: 'COST-CENTRE-9', summary: 'New cost centre' }],
      })
    ).json() as Json;
    expect(r.delivered).toBe(0);
    const t = (await tasks('finance', 'OPEN')).find((x) => x.connector === 'ERP')!;
    expect(t.title).toMatch(/COST-CENTRE-9/);
    expect(t.summary).toMatchObject({ ref: 'COST-CENTRE-9' });
    await put('ERP', { mode: 'UP' });
    await call('admin', 'POST', '/integration-events/retry');
    expect((await tasks('finance', 'SUPERSEDED')).some((x) => x.connector === 'ERP')).toBe(true);
  });
});

describe('NFR-AV03 idempotent retried delivery and reconciliation of missed syncs', () => {
  it('sends each item once however many times it is asked, and keeps a delivery that fails to retry on a growing backoff until it is a dead letter', async () => {
    const first = (
      await call('procurement', 'POST', '/connectors/MIDDLEWARE/sync', {
        items: [{ ref: 'A-1' }, { ref: 'A-2' }],
      })
    ).json() as Json;
    expect(first).toMatchObject({ created: 2, duplicates: 0, delivered: 2 });
    const again = (
      await call('procurement', 'POST', '/connectors/MIDDLEWARE/sync', {
        items: [{ ref: 'A-1' }, { ref: 'A-2' }],
      })
    ).json() as Json;
    expect(again).toMatchObject({ created: 0, duplicates: 2 });
    expect(
      (await events('MIDDLEWARE')).filter((e) => e.direction === 'OUT' && e.kind === 'MIDDLEWARE_SYNC'),
    ).toHaveLength(2);

    await put('MIDDLEWARE', { mode: 'DOWN' });
    const t0 = env.clock.now().getTime();
    const sent = (
      await call('procurement', 'POST', '/connectors/MIDDLEWARE/sync', { items: [{ ref: 'B-1' }] })
    ).json() as Json;
    const ev = sent.events[0] as Json;
    expect(ev).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(new Date(ev.nextAttemptAt).getTime() - t0).toBeGreaterThanOrEqual(BACKOFF_MINUTES[0] * 60_000);
    const audit = new AuditService(env.clock);
    const run = () => runDueDeliveries(env.database, { clock: env.clock, audit });
    expect(await run()).toMatchObject({ attempted: 0 }); // not due yet
    // each failed attempt waits longer than the one before, and the last one is a dead letter
    let previousWait = 0;
    for (let n = 2; n <= MAX_ATTEMPTS; n += 1) {
      const row = (await events('MIDDLEWARE')).find((e) => e.idempotencyKey === 'sync:MIDDLEWARE:B-1')!;
      env.clock.set(row.nextAttemptAt);
      expect(await run()).toMatchObject({ attempted: 1, delivered: 0 });
      const after = (await events('MIDDLEWARE')).find((e) => e.idempotencyKey === 'sync:MIDDLEWARE:B-1')!;
      expect(after.attempts).toBe(n);
      if (after.nextAttemptAt) {
        const wait = after.nextAttemptAt.getTime() - env.clock.now().getTime();
        expect(wait).toBeGreaterThanOrEqual(previousWait);
        previousWait = wait;
      }
    }
    const dead = (await events('MIDDLEWARE')).find((e) => e.idempotencyKey === 'sync:MIDDLEWARE:B-1')!;
    expect(dead).toMatchObject({ status: 'DEAD_LETTER', attempts: MAX_ATTEMPTS, nextAttemptAt: null });
    expect(dead.lastError).toBeTruthy();
    expect(await run()).toMatchObject({ attempted: 0 }); // a dead letter is not tried again by the schedule
    // it stays visible, and a person can requeue it once the system is back
    const listed = (await call('admin', 'GET', '/integration-events')).json() as Json[];
    expect(listed.find((e) => e.id === dead.id)).toMatchObject({
      status: 'DEAD_LETTER',
      connector: 'MIDDLEWARE',
    });
    expect((await call('requester', 'POST', `/integration-events/${dead.id}/requeue`)).statusCode).toBe(403);
    expect(
      (
        await call(
          'admin',
          'POST',
          `/integration-events/${listed.find((e) => e.status === 'DELIVERED')!.id}/requeue`,
        )
      ).statusCode,
    ).toBe(409);
    await put('MIDDLEWARE', { mode: 'UP' });
    const rq = await call('admin', 'POST', `/integration-events/${dead.id}/requeue`);
    expect(rq.statusCode, rq.body).toBe(200);
    expect(rq.json()).toMatchObject({ status: 'DELIVERED' });
    expect((await tasks('admin', 'SUPERSEDED')).some((t) => t.connector === 'MIDDLEWARE')).toBe(true);
  });

  it('retries a failed item on request without waiting for the backoff, and a second retry does nothing', async () => {
    await put('MIDDLEWARE', { mode: 'DOWN' });
    await call('procurement', 'POST', '/connectors/MIDDLEWARE/sync', { items: [{ ref: 'C-1' }] });
    await put('MIDDLEWARE', { mode: 'UP' });
    const r1 = (await call('procurement', 'POST', '/integration-events/retry')).json() as Json;
    expect(r1).toMatchObject({ retried: 1, delivered: 1 });
    expect((await call('procurement', 'POST', '/integration-events/retry')).json().retried).toBe(0);
  });

  it('finds items the other side never recorded, sends them again under the same key, and a second run changes nothing', async () => {
    await secret('ERP', 'erp-connector-secret-0000002');
    const baseline = (await call('procurement', 'POST', '/connectors/ERP/reconcile')).json() as Json;
    expect(baseline).toMatchObject({ status: 'OK', missing: [], repaired: 0 });
    // the other side acknowledges the next two messages but loses them
    await put('ERP', { config: { simulateMissedSyncs: 2 } });
    const items = ['R-1', 'R-2', 'R-3', 'R-4'].map((ref) => ({ ref }));
    const sent = (await call('procurement', 'POST', '/connectors/ERP/sync', { items })).json() as Json;
    expect(sent.delivered).toBe(4);
    expect(sent.events.filter((e: Json) => e.acknowledgedAt === null)).toHaveLength(2);
    const r1 = (await call('procurement', 'POST', '/connectors/ERP/reconcile')).json() as Json;
    expect(r1.status).toBe('REPAIRED');
    expect(r1.missing).toHaveLength(2);
    expect(r1.missing.every((k: string) => k.startsWith('sync:ERP:R-'))).toBe(true);
    expect(r1).toMatchObject({ repaired: 2, received: r1.expected - 2 });
    const after1 = (await events('ERP')).map((e) => [e.idempotencyKey, e.attempts, e.remoteAckAt?.getTime()]);
    expect((await events('ERP')).every((e) => e.remoteAckAt)).toBe(true);
    const r2 = (await call('procurement', 'POST', '/connectors/ERP/reconcile')).json() as Json;
    expect(r2).toMatchObject({ status: 'OK', missing: [], repaired: 0, received: r1.expected });
    expect(
      (await events('ERP')).map((e) => [e.idempotencyKey, e.attempts, e.remoteAckAt?.getTime()]),
    ).toEqual(after1);
    expect((await events('ERP')).filter((e) => e.kind === 'ERP_SYNC')).toHaveLength(5);
  });

  it('cannot repair while the connector is down, says so, and repairs once it is back', async () => {
    await put('ERP', { config: { simulateMissedSyncs: 1 } });
    await call('procurement', 'POST', '/connectors/ERP/sync', { items: [{ ref: 'R-5' }] });
    await put('ERP', { mode: 'DOWN' });
    const down = (await call('admin', 'POST', '/connectors/ERP/reconcile')).json() as Json;
    expect(down).toMatchObject({ status: 'FAILED', repaired: 0 });
    expect(down.missing).toEqual(['sync:ERP:R-5']);
    await put('ERP', { mode: 'UP' });
    expect((await call('admin', 'POST', '/connectors/ERP/reconcile')).json()).toMatchObject({
      status: 'REPAIRED',
      repaired: 1,
    });
    const runs = (await call('legal', 'GET', '/connectors/sync-runs?kind=erp')).json() as Json[];
    expect(runs.length).toBeGreaterThanOrEqual(5);
    expect(runs.every((r) => r.connector === 'ERP')).toBe(true);
    expect(runs[0]).toMatchObject({ direction: 'OUT' });
    expect((await call('requester', 'GET', '/connectors/sync-runs')).statusCode).toBe(403);
    expect((await call('finance', 'POST', '/connectors/ERP/reconcile')).statusCode).toBe(403);
  });
});
