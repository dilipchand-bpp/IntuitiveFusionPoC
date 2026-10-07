import { count, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../audit/audit-service.js';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { PLACEHOLDER } from './classification.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const startConversation = async () => {
  const c = await call('requester', 'POST', '/assistant/conversations', { purpose: 'INTAKE' });
  expect(c.statusCode, c.body).toBe(201);
  const id = c.json().id as string;
  const m = await call('requester', 'POST', `/assistant/conversations/${id}/messages`, {
    text: 'I need office cleaning for two years, about $90k',
  });
  expect(m.statusCode, m.body).toBe(201);
  return { id, requestId: m.json().requestId as string };
};
const messagesOf = async (id: string) =>
  ((await call('requester', 'GET', `/assistant/conversations/${id}`)).json() as Json).messages as Json[];
const auditCount = () =>
  sys<number>(async (tx) => Number((await tx.select({ n: count() }).from(s.auditEvent))[0]!.n));

describe('SEC-D06 AI conversations are held under the same retention and residency controls', () => {
  let a: { id: string; requestId: string };
  let held: { id: string; requestId: string };

  it('stamps every conversation with a retention class and the AI region', async () => {
    a = await startConversation();
    held = await startConversation();
    const meta = await sys<Json[]>((tx) => tx.select().from(s.conversationMeta));
    expect(meta.length).toBe(2);
    expect(meta[0]).toMatchObject({ retentionClass: 'AI_CONVERSATION', region: 'AU' });
    const r = (await call('admin', 'GET', '/privacy/retention')).json() as Json;
    expect(r).toMatchObject({
      aiConversationDays: 365,
      minimumDays: 30,
      aiRegion: 'AU',
      aiRegionAllowed: true,
    });
    expect(r.conversations).toMatchObject({ total: 2, stamped: 2, anonymised: 0 });
    expect(r.scope).toMatch(/Ask AI box answers and stores nothing/);
  });

  it('the retention setting has a floor of 30 days and is audited when it changes', async () => {
    const low = await call('admin', 'PUT', '/privacy/retention', { aiConversationDays: 10 });
    expect(low.statusCode).toBe(400);
    expect(
      (await call('admin', 'PUT', '/admin/settings', { retention: { aiConversationDays: 29 } })).statusCode,
    ).toBe(400);
    const ok = await call('admin', 'PUT', '/privacy/retention', {
      aiConversationDays: 30,
      reason: 'Shorter retention for the test',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().aiConversationDays).toBe(30);
    const ev = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'settings.retention')),
    );
    expect(ev.at(-1)!.after).toMatchObject({ retention: { aiConversationDays: 30 } });
    expect((await call('probity', 'PUT', '/privacy/retention', { aiConversationDays: 400 })).statusCode).toBe(
      403,
    );
    await call('admin', 'PUT', '/privacy/retention', { aiConversationDays: 365 });
  });

  it('nothing is purged before it is due (injected clock), and only an administrator runs the purge', async () => {
    expect((await call('probity', 'POST', '/privacy/retention/run')).statusCode).toBe(403);
    const r = await call('admin', 'POST', '/privacy/retention/run');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().result).toMatchObject({ expired: 0, anonymised: 0, retentionDays: 365 });
    expect((await messagesOf(a.id)).every((m) => m.text !== PLACEHOLDER)).toBe(true);
  });

  it('expired transcripts are anonymised; a request on legal hold is skipped and the reason recorded; audit events are never touched', async () => {
    const hold = await call('legal', 'POST', '/privacy/legal-holds', {
      entityType: 'REQUEST',
      entityId: held.requestId,
      reason: 'Dispute with the supplier; keep the intake record',
    });
    expect(hold.statusCode, hold.body).toBe(201);
    expect(
      (
        await call('requester', 'POST', '/privacy/legal-holds', {
          entityType: 'REQUEST',
          entityId: a.requestId,
          reason: 'Not allowed to hold',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('legal', 'POST', '/privacy/legal-holds', {
          entityType: 'REQUEST',
          entityId: held.requestId,
          reason: 'A second hold on the same',
        })
      ).statusCode,
    ).toBe(409);

    const before = await auditCount();
    env.clock.advanceDays(366);
    const run = await call('admin', 'POST', '/privacy/retention/run');
    expect(run.statusCode, run.body).toBe(200);
    const res = run.json().result as Json;
    expect(res).toMatchObject({ expired: 2, anonymised: 1, skippedHeld: 1, stampedNow: 0 });
    expect(res.messagesCleared).toBeGreaterThanOrEqual(2);
    expect(res.held[0]).toMatchObject({
      conversationId: held.id,
      via: 'REQUEST',
      reason: 'Dispute with the supplier; keep the intake record',
    });

    expect((await messagesOf(a.id)).every((m) => m.text === PLACEHOLDER)).toBe(true);
    expect((await messagesOf(held.id)).some((m) => m.text !== PLACEHOLDER)).toBe(true);
    // audit events only ever grow; the chain still verifies
    expect(await auditCount()).toBeGreaterThan(before);
    expect(await new AuditService(env.clock).verifyChain(env.database, TENANT_ID)).toMatchObject({
      ok: true,
    });
    const ev = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'retention.run')),
    );
    expect(ev.at(-1)!.after).toMatchObject({ anonymised: 1, skippedHeld: 1 });
    expect(ev.at(-1)!.after.held[0]).toMatchObject({ conversationId: held.id });
  });

  it('is safe to run again, and the held one is purged once the hold is released', async () => {
    const again = (await call('admin', 'POST', '/privacy/retention/run')).json().result as Json;
    expect(again).toMatchObject({ anonymised: 0, messagesCleared: 0, skippedHeld: 1 });
    const view = (await call('legal', 'GET', '/privacy/retention')).json() as Json;
    const open = view.holds.find((h: Json) => h.open)!;
    expect(open).toMatchObject({ entityType: 'REQUEST', entityId: held.requestId });
    const rel = await call('legal', 'POST', `/privacy/legal-holds/${open.id}/release`, {
      reason: 'Dispute settled',
    });
    expect(rel.statusCode, rel.body).toBe(200);
    expect(
      (await call('legal', 'POST', `/privacy/legal-holds/${open.id}/release`, { reason: 'Again please' }))
        .statusCode,
    ).toBe(409);
    const last = (await call('admin', 'POST', '/privacy/retention/run')).json().result as Json;
    expect(last).toMatchObject({ anonymised: 1, skippedHeld: 0 });
    expect((await messagesOf(held.id)).every((m) => m.text === PLACEHOLDER)).toBe(true);
    const runs = ((await call('admin', 'GET', '/privacy/retention')).json() as Json).runs as Json[];
    expect(runs.length).toBeGreaterThanOrEqual(4);
    expect(runs[0]).toMatchObject({ trigger: 'MANUAL', by: expect.any(String) });
  });

  it('a conversation that predates the stamp gets one, dated from when it was created, and is then purged', async () => {
    const old = new Date(env.clock.now().getTime() - 400 * 86_400_000);
    const id = await sys<string>(async (tx) => {
      const [c] = await tx
        .insert(s.conversation)
        .values({ tenantId: TENANT_ID, userId: uid('user:requester'), purpose: 'INTAKE', createdAt: old })
        .returning();
      await tx.insert(s.chatMessage).values({
        tenantId: TENANT_ID,
        conversationId: c!.id,
        role: 'USER',
        text: 'An old message',
        createdAt: old,
      });
      return c!.id;
    });
    const r = (await call('admin', 'POST', '/privacy/retention/run')).json().result as Json;
    expect(r).toMatchObject({ stampedNow: 1, anonymised: 1, messagesCleared: 1 });
    const meta = await sys<Json[]>((tx) =>
      tx.select().from(s.conversationMeta).where(eq(s.conversationMeta.conversationId, id)),
    );
    expect(meta[0]!.anonymisedAt).not.toBeNull();
  });

  it('the scheduled pass runs the same purge for every tenant', async () => {
    const { runScheduled } = await import('./index.js');
    await runScheduled(env.database);
    const runs = await sys<Json[]>((tx) =>
      tx.select().from(s.retentionRun).where(eq(s.retentionRun.trigger, 'SCHEDULED')),
    );
    expect(runs.length).toBeGreaterThanOrEqual(1);
  });

  it('refuses to store a conversation when the AI region is not an allowed region (ties to SEC-D09)', async () => {
    const put = await call('admin', 'PUT', '/admin/residency', {
      country: 'AU',
      allowedRegions: [],
      aiRegion: 'US',
      logRegion: 'AU',
      reason: 'Trial of a US AI region for the test',
    });
    expect(put.statusCode, put.body).toBe(200);
    const r = await call('requester', 'POST', '/assistant/conversations', { purpose: 'INTAKE' });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('RESIDENCY_VIOLATION');
    const m = await call('requester', 'POST', `/assistant/conversations/${a.id}/messages`, {
      text: 'It is now about $95k',
    });
    expect(m.statusCode).toBe(422);
    expect(
      ((await call('admin', 'GET', '/admin/residency')).json() as Json).refusals.residency,
    ).toBeGreaterThanOrEqual(2);
  });
});
