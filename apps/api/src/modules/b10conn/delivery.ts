/**
 * Outbound delivery for any connector kind (NFR-AV03). An event is written first with a key that makes it safe to send twice,
 * then delivered through `callProvider`. A failure keeps the event, schedules the next attempt on an exponential backoff
 * (next_attempt_at) and, after MAX_ATTEMPTS, parks it as DEAD_LETTER where it stays visible until a person requeues it.
 * Every failure also queues a manual task so the user's work is never blocked (NFR-AV04). Every outbound message is signed
 * with the connector's secret (SEC-TP04).
 */
import { and, eq } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import { connector, integrationEvent, manualTask } from '../../db/schema.js';
import { providerEntry, type ConnectorKind } from './catalogue.js';
import { getConnector } from './connectors.js';
import { callProvider, type ResilienceDeps } from './resilience.js';
import { connectorSecret } from './secrets.js';
import { signedHeaders, verifyMessage } from './signing.js';

export const MAX_ATTEMPTS = 6;
/** Minutes to wait after the first, second, third ... failed attempt; the last value repeats. */
export const BACKOFF_MINUTES = [1, 5, 15, 60, 240] as const;

export interface DeliveryDeps extends ResilienceDeps {
  clock: Clock;
  audit: AuditService;
}
export type EventRow = typeof integrationEvent.$inferSelect;

export const nextAttemptFor = (failedAttempts: number, now: Date): Date | null =>
  failedAttempts >= MAX_ATTEMPTS
    ? null
    : new Date(
        now.getTime() + BACKOFF_MINUTES[Math.min(failedAttempts, BACKOFF_MINUTES.length) - 1]! * 60_000,
      );

export interface ManualSpec {
  title: string;
  instructions: string;
  summary: Record<string, unknown>;
}

/** What a person does by hand while the connector is down. */
export function manualSpecFor(e: EventRow, providerLabel: string): ManualSpec {
  const p = e.payload as Record<string, unknown>;
  if (e.kind === 'MATTER_INITIATED')
    return {
      title: `Raise the legal matter "${String(p.title ?? '')}" by hand`,
      instructions:
        `${providerLabel} cannot be reached, so this matter was not created there. Open ${providerLabel} yourself, ` +
        `create a matter with the title and priority below${p.contractNumber ? ` and link contract ${String(p.contractNumber)}` : ''}, ` +
        'then come back here, enter the reference it shows and choose "Mark done". If the system recovers first, ' +
        'the platform sends the matter itself and this task is closed as superseded.',
      summary: { matter: p.title, priority: p.priority, contract: p.contractNumber ?? null },
    };
  return {
    title:
      `Send ${e.kind.toLowerCase().replace(/_/g, ' ')} ${String(p.ref ?? '')} to ${providerLabel} by hand`
        .replace(/\s+/g, ' ')
        .trim(),
    instructions:
      `${providerLabel} cannot be reached. Enter this item in ${providerLabel} yourself using the details below, ` +
      'then enter the reference it shows and choose "Mark done". If the connection recovers first, the platform sends it itself and this task is closed as superseded.',
    summary: { kind: e.kind, ...p },
  };
}

export async function queueManualTask(tx: Tx, d: DeliveryDeps, ctx: RequestContext, e: EventRow) {
  const kind = (e.connectorKind ?? 'LEGAL') as ConnectorKind;
  const c = await getConnector(tx, e.tenantId, kind);
  const spec = manualSpecFor(e, providerEntry(kind, c?.provider ?? '')?.label ?? e.target);
  const [row] = await tx
    .insert(manualTask)
    .values({
      tenantId: e.tenantId,
      connectorKind: kind,
      title: spec.title,
      instructions: spec.instructions,
      payloadSummary: spec.summary,
      eventId: e.id,
      createdAt: d.clock.now(),
    })
    .onConflictDoNothing()
    .returning();
  if (row)
    await d.audit.record(tx, ctx, {
      action: 'connector.manual_task_queued',
      entityType: 'manual_task',
      entityId: row.id,
      after: { connector: kind, title: spec.title, eventId: e.id },
    });
  return row ?? null;
}

export async function recordFailure(
  tx: Tx,
  d: DeliveryDeps,
  ctx: RequestContext,
  e: EventRow,
  error: string,
): Promise<EventRow> {
  const at = d.clock.now();
  const attempts = e.attempts + 1;
  const dead = attempts >= MAX_ATTEMPTS;
  const [row] = await tx
    .update(integrationEvent)
    .set({
      status: dead ? 'DEAD_LETTER' : 'FAILED',
      attempts,
      lastError: error.slice(0, 500),
      nextAttemptAt: nextAttemptFor(attempts, at),
    })
    .where(eq(integrationEvent.id, e.id))
    .returning();
  await d.audit.record(tx, ctx, {
    action: dead ? 'integration.dead_letter' : 'integration.failed',
    entityType: 'integration_event',
    entityId: e.id,
    result: 'FAILED',
    after: {
      kind: e.kind,
      error: row!.lastError,
      attempts,
      nextAttemptAt: row!.nextAttemptAt?.toISOString() ?? null,
    },
  });
  await queueManualTask(tx, d, ctx, row!);
  return row!;
}

/** The other side took it: close the event and any manual task still open for it. */
export async function recordSuccess(
  tx: Tx,
  d: DeliveryDeps,
  ctx: RequestContext,
  e: EventRow,
  opts: { acknowledged: boolean; payload?: Record<string, unknown> },
): Promise<EventRow> {
  const at = d.clock.now();
  const [row] = await tx
    .update(integrationEvent)
    .set({
      status: 'DELIVERED',
      attempts: e.attempts + 1,
      lastError: null,
      deliveredAt: at,
      nextAttemptAt: null,
      remoteAckAt: opts.acknowledged ? at : e.remoteAckAt,
      ...(opts.payload ? { payload: opts.payload } : {}),
    })
    .where(eq(integrationEvent.id, e.id))
    .returning();
  const closed = await tx
    .update(manualTask)
    .set({ status: 'SUPERSEDED', completedAt: at })
    .where(and(eq(manualTask.eventId, e.id), eq(manualTask.status, 'OPEN')))
    .returning({ id: manualTask.id });
  await d.audit.record(tx, ctx, {
    action: 'integration.delivered',
    entityType: 'integration_event',
    entityId: e.id,
    after: { kind: e.kind, acknowledged: opts.acknowledged, supersededManualTasks: closed.length },
  });
  return row!;
}

/**
 * The simulated receiving system for the generic kinds (middleware, ERP, e-signature and so on). It insists on a signed
 * message, checks it the way a real receiver would (SEC-TP04), and may "lose" a message after acknowledging it so a missed
 * sync can be shown and repaired (connector config `simulateMissedSyncs`).
 */
export function simulatedReceive(input: {
  secret: string | null;
  headers: Record<string, string>;
  body: unknown;
  clock: Clock;
}): void {
  if (!input.headers['X-IF-Signature'])
    throw new Error('The receiving system refused the message: it was not signed. Set the connector secret.');
  const v = verifyMessage({
    secret: input.secret,
    signature: input.headers['X-IF-Signature'],
    timestamp: input.headers['X-IF-Timestamp'],
    body: input.body,
    clock: input.clock,
  });
  if (!v.ok) throw new Error(`The receiving system refused the message: ${v.reason}`);
}

/** Uses up one "lose the next message" from the connector's demonstration setting. */
async function takeLoss(tx: Tx, tenantId: string, kind: ConnectorKind): Promise<boolean> {
  const c = await getConnector(tx, tenantId, kind);
  const n = Number((c?.config as Record<string, unknown> | undefined)?.simulateMissedSyncs ?? 0);
  if (!c || !(n > 0)) return false;
  await tx
    .update(connector)
    .set({ config: { ...(c.config as object), simulateMissedSyncs: n - 1 } })
    .where(eq(connector.id, c.id));
  return true;
}

/** Delivers (or, with `resend`, sends again) an event of any generic kind. */
export async function deliverGeneric(
  tx: Tx,
  d: DeliveryDeps,
  ctx: RequestContext,
  e: EventRow,
  opts: { resend?: boolean } = {},
): Promise<EventRow> {
  if (e.status === 'DELIVERED' && !opts.resend) return e;
  const kind = (e.connectorKind ?? 'MIDDLEWARE') as ConnectorKind;
  const secret = await connectorSecret(tx, e.tenantId, kind);
  const outcome = await callProvider(
    tx,
    d,
    e.tenantId,
    kind,
    async () => {
      const headers = secret ? signedHeaders(secret, d.clock, e.payload) : ({} as Record<string, string>);
      simulatedReceive({ secret, headers, body: e.payload, clock: d.clock });
      return { stored: !(await takeLoss(tx, e.tenantId, kind)) };
    },
    { fallback: () => ({ stored: false }) },
  );
  if (!outcome.ok) {
    if (opts.resend) return e; // a repair that cannot be made leaves the record as it was
    return recordFailure(tx, d, ctx, e, outcome.error);
  }
  if (opts.resend) {
    if (!outcome.value.stored) return e;
    const [row] = await tx
      .update(integrationEvent)
      .set({ remoteAckAt: d.clock.now() })
      .where(eq(integrationEvent.id, e.id))
      .returning();
    return row!;
  }
  return recordSuccess(tx, d, ctx, e, { acknowledged: outcome.value.stored });
}

/** Writes an outbound event once per idempotency key and delivers it. A second call with the same key does nothing. */
export async function enqueueOutbound(
  tx: Tx,
  d: DeliveryDeps,
  ctx: RequestContext,
  input: { kind: ConnectorKind; eventKind: string; key: string; payload: Record<string, unknown> },
): Promise<{ event: EventRow; created: boolean }> {
  const c = await getConnector(tx, ctx.tenantId, input.kind);
  const [row] = await tx
    .insert(integrationEvent)
    .values({
      tenantId: ctx.tenantId,
      kind: input.eventKind,
      connectorKind: input.kind,
      direction: 'OUT',
      target: providerEntry(input.kind, c?.provider ?? '')?.label ?? c?.provider ?? input.kind,
      idempotencyKey: input.key,
      payload: input.payload,
      createdAt: d.clock.now(),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    const [existing] = await tx
      .select()
      .from(integrationEvent)
      .where(
        and(eq(integrationEvent.tenantId, ctx.tenantId), eq(integrationEvent.idempotencyKey, input.key)),
      );
    return { event: existing!, created: false };
  }
  return { event: row, created: true };
}
