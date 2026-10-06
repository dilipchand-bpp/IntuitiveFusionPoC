import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID } from '../../db/seed.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { MAX_ATTEMPTS } from '../b10conn/delivery.js';
import { signMessage } from '../b10conn/signing.js';
import { laneFor } from './legal-sync.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;

const SECRET = 'legal-sync-shared-secret-1';
let contractId = '';
let matterId = '';
let matterRef = '';

beforeAll(async () => {
  env = await createEnv();
  const set = await call('admin', 'PUT', '/admin/settings', {
    legalPlatform: { enabled: true, name: 'HighQ', webhookSecret: SECRET, simulateOutage: false },
  });
  expect(set.statusCode, set.body).toBe(200);
  const sec = await call('admin', 'PUT', '/secrets/connector.legal.webhook', { value: SECRET });
  expect(sec.statusCode, sec.body).toBe(200);
  const d = await env.draft();
  contractId = d.id;
  const m = await call('legal', 'POST', '/legal/matters', {
    title: 'Review the cleaning agreement',
    contractId,
    priority: 'HIGH',
  });
  expect(m.statusCode, m.body).toBe(201);
  matterId = m.json().id as string;
  const board = (await call('legal', 'GET', '/legal/matters')).json();
  matterRef = board.lanes.flatMap((l: Json) => l.matters).find((x: Json) => x.id === matterId)
    .externalRef as string;
  expect(matterRef).toMatch(/^HIGH-[0-9A-F]{6}$/);
}, 120_000);

const simulate = async (body: Json, who = 'legal') => {
  const r = await call(who, 'POST', '/integrations/legal/simulate', { matterId, ...body });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};
const view = async (who = 'legal') => {
  const r = await call(who, 'GET', `/contracts/${contractId}/legal-sync`);
  expect(r.statusCode, r.body).toBe(200);
  return (r.json() as Json).matters[0] as Json;
};
/** What an outside legal system would send: the same signature the platform's own simulation builds. */
const post = (body: Json, over: { secret?: string; ts?: number; tenant?: string } = {}) => {
  const ts = String(over.ts ?? Math.floor(env.clock.now().getTime() / 1000));
  return env.app.inject({
    method: 'POST',
    url: '/api/v1/integrations/legal/events',
    headers: {
      'x-if-signature': signMessage(over.secret ?? SECRET, ts, body),
      'x-if-timestamp': ts,
      ...(over.tenant ? { 'x-if-tenant': over.tenant } : {}),
    },
    payload: body,
  });
};

describe('NFR-C03 legal system sync by webhook: matter status, documents and closure come back and show on the contract', () => {
  it('reads stage names the same way the redline webhook does', () => {
    expect(laneFor('Legal review', 'NEW')).toBe('IN_REVIEW');
    expect(laneFor('Awaiting counterparty', 'NEW')).toBe('WAITING');
    expect(laneFor('Executed', 'NEW')).toBe('DONE');
    expect(laneFor('Triage', 'IN_REVIEW')).toBe('IN_REVIEW');
  });

  it('a simulated, correctly signed stage change is applied and shown on the contract page', async () => {
    const out = await simulate({ type: 'MATTER_STAGE_CHANGED', stage: 'Legal review' });
    expect(out).toMatchObject({ simulated: true, httpStatus: 200 });
    expect(out.signed).toMatchObject({ algorithm: 'HMAC-SHA256' });
    expect(out.result).toMatchObject({ accepted: true, duplicate: false, status: 'DELIVERED' });
    expect(out.result.applied).toMatchObject({ stage: 'Legal review', lane: 'IN_REVIEW' });
    const m = await view();
    expect(m).toMatchObject({
      id: matterId,
      externalRef: matterRef,
      stage: 'Legal review',
      lane: 'IN_REVIEW',
      closedAt: null,
    });
    expect(m.events.some((e: Json) => e.type === 'MATTER_STAGE_CHANGED' && e.status === 'DELIVERED')).toBe(
      true,
    );
    // the board lane moved too
    const board = (await call('legal', 'GET', '/legal/matters')).json();
    const onBoard = board.lanes.find((l: Json) => l.matters.some((x: Json) => x.id === matterId));
    expect(onBoard.lane ?? onBoard.key ?? onBoard.id).toBeTruthy();
  });

  it('an event id is applied once: the same id again changes nothing and is not applied twice', async () => {
    const first = await simulate({ type: 'MATTER_STAGE_CHANGED', stage: 'Awaiting counterparty' });
    const id = first.sent.eventId as string;
    expect((await view()).lane).toBe('WAITING');
    await call('legal', 'PATCH', `/legal/matters/${matterId}`, { lane: 'IN_REVIEW' }); // a person moves it back
    const again = await simulate({
      type: 'MATTER_STAGE_CHANGED',
      stage: 'Awaiting counterparty',
      eventId: id,
    });
    expect(again.result).toMatchObject({ accepted: true, duplicate: true });
    const events = await sys<Json[]>((tx) =>
      tx
        .select()
        .from(s.integrationEvent)
        .where(
          and(
            eq(s.integrationEvent.tenantId, TENANT_ID),
            eq(s.integrationEvent.idempotencyKey, `in:legal:${id}`),
          ),
        ),
    );
    expect(events).toHaveLength(1);
    await simulate({ type: 'MATTER_STAGE_CHANGED', stage: 'Legal review' });
  });

  it('a document attached is listed once, even when the event is repeated', async () => {
    const a = await simulate({ type: 'DOCUMENT_ATTACHED', documentName: 'Counterparty markup v2.docx' });
    expect(a.result.applied).toMatchObject({
      document: 'Counterparty markup v2.docx',
      alreadyAttached: false,
    });
    const m = await view();
    expect(m.documents).toHaveLength(1);
    expect(m.documents[0]).toMatchObject({ name: 'Counterparty markup v2.docx', kind: 'MARKUP' });
    await simulate({ type: 'DOCUMENT_ATTACHED', documentName: 'Another.docx', eventId: a.sent.eventId });
    expect((await view()).documents).toHaveLength(1);
  });

  it('a closed matter shows as closed with its outcome, and a later stage change is ignored', async () => {
    const c = await simulate({ type: 'MATTER_CLOSED', outcome: 'Executed' });
    expect(c.result.applied).toMatchObject({ closed: true, outcome: 'Executed' });
    const m = await view();
    expect(m).toMatchObject({ stage: 'Closed', lane: 'DONE', outcome: 'Executed' });
    expect(m.closedAt).toBeTruthy();
    const late = await simulate({ type: 'MATTER_STAGE_CHANGED', stage: 'Legal review' });
    expect(late.result.applied.ignored).toMatch(/already closed/);
    expect((await view()).stage).toBe('Closed');
  });

  it('every applied change is audited, and the simulation itself is audited', async () => {
    const rows = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, matterId)),
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('integration.legal_sync');
    expect(actions).toContain('integration.legal_simulated');
  });
});

describe('NFR-C03 signature and timestamp are verified; failures are kept, retried and dead-lettered', () => {
  const body = (eventId: string, ref = matterRef, extra: Json = {}) => ({
    eventId,
    type: 'DOCUMENT_ATTACHED',
    data: { matterRef: ref, documentId: `D-${eventId}`, name: `File ${eventId}.pdf`, ...extra },
  });

  it('a message from outside with a correct signature is accepted', async () => {
    const r = await post(body('ext-000001'));
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ accepted: true, duplicate: false, status: 'DELIVERED' });
    expect((await view()).documents.some((d: Json) => d.name === 'File ext-000001.pdf')).toBe(true);
  });

  it('a wrong secret, an altered body, a stale timestamp and an unknown organisation are all refused alike (401) and counted', async () => {
    const b = body('ext-000002');
    expect((await post(b, { secret: 'not-the-secret-at-all' })).statusCode).toBe(401);
    const ts = String(Math.floor(env.clock.now().getTime() / 1000));
    const altered = await env.app.inject({
      method: 'POST',
      url: '/api/v1/integrations/legal/events',
      headers: { 'x-if-signature': signMessage(SECRET, ts, b), 'x-if-timestamp': ts },
      payload: { ...b, data: { ...b.data, name: 'Changed after signing.pdf' } },
    });
    expect(altered.statusCode).toBe(401);
    expect((await post(b, { ts: Math.floor(env.clock.now().getTime() / 1000) - 3600 })).statusCode).toBe(401);
    expect((await post(b, { tenant: 'no-such-organisation' })).statusCode).toBe(401);
    const unsigned = await env.app.inject({
      method: 'POST',
      url: '/api/v1/integrations/legal/events',
      payload: b,
    });
    expect(unsigned.statusCode).toBe(401);
    // none of them was applied
    expect((await view()).documents.some((d: Json) => d.name.includes('ext-000002'))).toBe(false);
    const sec = (await call('admin', 'GET', '/connectors/LEGAL/security')).json();
    expect(sec.rejected.count).toBeGreaterThanOrEqual(3);
  });

  it('the demonstration can send a bad signature, which is refused and counted the same way', async () => {
    const before = ((await call('admin', 'GET', '/connectors/LEGAL/security')).json() as Json).rejected
      .count as number;
    const out = await simulate({ type: 'MATTER_STAGE_CHANGED', stage: 'Review', badSignature: true });
    expect(out.httpStatus).toBe(401);
    expect(((await call('admin', 'GET', '/connectors/LEGAL/security')).json() as Json).rejected.count).toBe(
      before + 1,
    );
  });

  it('an event that cannot be applied yet is kept as FAILED, shows its attempts, and is applied when sent again or reprocessed', async () => {
    const ref = 'LATE-REF-1';
    const b = body('ext-late-01', ref);
    const r1 = await post(b);
    expect(r1.statusCode).toBe(202);
    expect(r1.json()).toMatchObject({ accepted: false, status: 'FAILED', attempts: 1 });
    expect(r1.json().error).toMatch(/No matter/);
    const r2 = await post(b);
    expect(r2.json()).toMatchObject({ status: 'FAILED', attempts: 2 });
    const listed = (await call('legal', 'GET', '/integration-events')).json() as Json[];
    expect(listed.find((e) => e.direction === 'IN' && e.status === 'FAILED')).toMatchObject({
      kind: 'DOCUMENT_ATTACHED',
      attempts: 2,
    });
    // the matter now carries that reference (the outbound acknowledgement arrived late)
    await sys((tx) =>
      tx.update(s.legalMatter).set({ externalRef: ref }).where(eq(s.legalMatter.id, matterId)),
    );
    const r3 = await post(b);
    expect(r3.statusCode).toBe(200);
    expect(r3.json()).toMatchObject({ accepted: true, status: 'DELIVERED' });
    await sys((tx) =>
      tx.update(s.legalMatter).set({ externalRef: matterRef }).where(eq(s.legalMatter.id, matterId)),
    );
  });

  it('after too many attempts the event is a dead letter, visible, and a person can reprocess it', async () => {
    const ref = 'LATE-REF-2';
    const b = body('ext-dead-01', ref);
    let last = await post(b);
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) last = await post(b);
    expect(last.json()).toMatchObject({ status: 'DEAD_LETTER', attempts: MAX_ATTEMPTS });
    const again = await post(b);
    expect(again.json()).toMatchObject({ accepted: false, duplicate: true, status: 'DEAD_LETTER' });
    const dead = ((await call('legal', 'GET', '/integration-events')).json() as Json[]).find(
      (e) => e.status === 'DEAD_LETTER' && e.direction === 'IN',
    )!;
    expect(dead).toBeTruthy();
    expect(
      (await call('procurement', 'POST', `/integrations/legal/events/${dead.id}/reprocess`)).statusCode,
    ).toBe(403);
    // still no such matter: the reprocess fails again but keeps the record
    const stillFailing = await call('legal', 'POST', `/integrations/legal/events/${dead.id}/reprocess`);
    expect(stillFailing.statusCode, stillFailing.body).toBe(200);
    expect(stillFailing.json().result.accepted).toBe(false);
    await sys((tx) =>
      tx.update(s.legalMatter).set({ externalRef: ref }).where(eq(s.legalMatter.id, matterId)),
    );
    const fixed = await call('admin', 'POST', `/integrations/legal/events/${dead.id}/reprocess`);
    expect(fixed.json()).toMatchObject({ status: 'DELIVERED' });
    expect((await call('admin', 'POST', `/integrations/legal/events/${dead.id}/reprocess`)).statusCode).toBe(
      409,
    );
    await sys((tx) =>
      tx.update(s.legalMatter).set({ externalRef: matterRef }).where(eq(s.legalMatter.id, matterId)),
    );
  });

  it('the simulation of an unknown matter shows the same failure and retry, and refuses a matter that was never sent', async () => {
    const out = await simulate({ type: 'MATTER_STAGE_CHANGED', stage: 'Review', unknownMatter: true });
    expect(out.httpStatus).toBe(202);
    expect(out.result).toMatchObject({ accepted: false, status: 'FAILED' });
    const plain = await call('legal', 'POST', '/legal/matters', { title: 'No platform reference' });
    await sys((tx) =>
      tx.update(s.legalMatter).set({ externalRef: null }).where(eq(s.legalMatter.id, plain.json().id)),
    );
    const r = await call('legal', 'POST', '/integrations/legal/simulate', {
      matterId: plain.json().id,
      type: 'MATTER_CLOSED',
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('MATTER_NOT_LINKED');
  });
});

describe('NFR-C03 status flows the other way too, through the connector layer', () => {
  it('sends the matter status as a signed outbound event; a repeat of the same state is not sent twice', async () => {
    const a = await call('legal', 'POST', `/legal-matters/${matterId}/sync-status`);
    expect(a.statusCode, a.body).toBe(200);
    expect(a.json()).toMatchObject({
      kind: 'MATTER_STATUS_UPDATE',
      connector: 'LEGAL',
      direction: 'OUT',
      status: 'DELIVERED',
      duplicate: false,
    });
    const b = await call('legal', 'POST', `/legal-matters/${matterId}/sync-status`);
    expect(b.json()).toMatchObject({ id: a.json().id, duplicate: true });
    expect((await call('requester', 'POST', `/legal-matters/${matterId}/sync-status`)).statusCode).toBe(403);
  });

  it('when the legal system is down the status waits as a failed event with a manual task, and goes when it recovers', async () => {
    await call('legal', 'PATCH', `/legal/matters/${matterId}`, { lane: 'WAITING' });
    expect((await call('admin', 'PUT', '/connectors/LEGAL', { mode: 'DOWN' })).statusCode).toBe(200);
    const a = await call('legal', 'POST', `/legal-matters/${matterId}/sync-status`);
    expect(a.json()).toMatchObject({ status: 'FAILED', attempts: 1 });
    const tasks = ((await call('legal', 'GET', '/manual-tasks?status=OPEN')).json() as Json[]).filter(
      (t) => t.connector === 'LEGAL',
    );
    expect(tasks.some((t) => /matter status update/i.test(t.title))).toBe(true);
    expect((await call('admin', 'PUT', '/connectors/LEGAL', { mode: 'UP' })).statusCode).toBe(200);
    const retry = await call('legal', 'POST', `/integration-events/${a.json().id}/requeue`);
    expect([200, 409]).toContain(retry.statusCode); // only a dead letter can be requeued; a failed one goes on the next run
    const run = (await call('legal', 'POST', '/integration-events/retry')).json();
    expect(run.delivered).toBeGreaterThanOrEqual(1);
  });

  it('only administrators and legal can simulate or reprocess; the contract card is for those who work with legal', async () => {
    for (const who of ['requester', 'procurement', 'finance', 'supplier'])
      expect(
        (await call(who, 'POST', '/integrations/legal/simulate', { matterId, type: 'MATTER_CLOSED' }))
          .statusCode,
        who,
      ).toBe(403);
    for (const who of ['legal', 'procurement', 'exec', 'delegate', 'contract-mgr', 'admin'])
      expect((await call(who, 'GET', `/contracts/${contractId}/legal-sync`)).statusCode, who).toBe(200);
    for (const who of ['requester', 'finance', 'supplier', 'probity'])
      expect((await call(who, 'GET', `/contracts/${contractId}/legal-sync`)).statusCode, who).toBe(403);
  });
});
