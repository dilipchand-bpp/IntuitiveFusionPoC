/**
 * The scheduled delivery run, reconciliation of missed syncs (NFR-AV03) and the person's side of the manual fallback
 * (NFR-AV04). Every function here can be run twice: the second run finds nothing left to do.
 */
import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import type { Database, RequestContext, Tx } from '../../db/client.js';
import { withSystem } from '../../db/client.js';
import { integrationEvent, legalMatter, manualTask, syncRun } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { deliver, retryFailed, type IntegrationDeps } from '../b8/integration.js';
import type { ConnectorKind } from './catalogue.js';

const sys = (tenantId: string): RequestContext => ({ tenantId, userId: null, role: 'SYSTEM' });

/**
 * The scheduled run: every event whose next attempt is due, in every tenant. Events not yet due, delivered, or parked as
 * dead letters are left alone.
 */
export async function runDueDeliveries(database: Database, d: IntegrationDeps, limit = 200) {
  return withSystem(database, async (tx) => {
    const at = d.clock.now();
    const rows = await tx
      .select({ id: integrationEvent.id, tenantId: integrationEvent.tenantId })
      .from(integrationEvent)
      .where(
        and(
          eq(integrationEvent.direction, 'OUT'),
          inArray(integrationEvent.status, ['FAILED', 'PENDING']),
          or(isNull(integrationEvent.nextAttemptAt), lte(integrationEvent.nextAttemptAt, at))!,
        ),
      )
      .orderBy(asc(integrationEvent.createdAt))
      .limit(limit);
    let delivered = 0;
    for (const r of rows) {
      const out = await retryFailed(tx, d, sys(r.tenantId), r.tenantId, r.id, { onlyDue: at });
      delivered += out.filter((e) => e.status === 'DELIVERED').length;
    }
    return { attempted: rows.length, delivered };
  });
}

/** A dead-lettered event goes back in the queue with a fresh set of attempts, and is tried now. */
export async function requeue(tx: Tx, d: IntegrationDeps, ctx: RequestContext, id: string) {
  const [e] = await tx
    .select()
    .from(integrationEvent)
    .where(and(eq(integrationEvent.id, id), eq(integrationEvent.tenantId, ctx.tenantId)));
  if (!e || e.direction !== 'OUT') throw new AppError(404, 'NOT_FOUND', 'Event not found');
  if (e.status !== 'DEAD_LETTER')
    throw new AppError(409, 'NOT_DEAD_LETTER', 'Only an event that has run out of attempts can be requeued');
  const [reset] = await tx
    .update(integrationEvent)
    .set({ status: 'FAILED', attempts: 0, nextAttemptAt: d.clock.now() })
    .where(eq(integrationEvent.id, id))
    .returning();
  await d.audit.record(tx, ctx, {
    action: 'integration.requeue',
    entityType: 'integration_event',
    entityId: id,
    after: { kind: e.kind },
  });
  return deliver(tx, d, ctx, reset!);
}

/**
 * Compares what the platform sent with what the other side acknowledged for one connector, and sends again what is
 * missing under the same idempotency key, so the other side can never end up with two of anything.
 */
export async function reconcile(tx: Tx, d: IntegrationDeps, ctx: RequestContext, kind: ConnectorKind) {
  const startedAt = d.clock.now();
  const [run] = await tx
    .insert(syncRun)
    .values({
      tenantId: ctx.tenantId,
      connectorKind: kind,
      direction: 'OUT',
      startedAt,
      status: 'RUNNING',
      triggeredBy: ctx.userId,
    })
    .returning();
  const sent = await tx
    .select()
    .from(integrationEvent)
    .where(
      and(
        eq(integrationEvent.tenantId, ctx.tenantId),
        eq(integrationEvent.connectorKind, kind),
        eq(integrationEvent.direction, 'OUT'),
        eq(integrationEvent.status, 'DELIVERED'),
      ),
    )
    .orderBy(asc(integrationEvent.createdAt));
  const missing = sent.filter((e) => !e.remoteAckAt);
  let repaired = 0;
  for (const m of missing) {
    const after = await deliver(tx, d, ctx, m, { resend: true });
    if (after.remoteAckAt) repaired += 1;
  }
  const status =
    missing.length === 0
      ? 'OK'
      : repaired === missing.length
        ? 'REPAIRED'
        : repaired > 0
          ? 'PARTIAL'
          : 'FAILED';
  const [done] = await tx
    .update(syncRun)
    .set({
      finishedAt: d.clock.now(),
      status,
      expectedCount: sent.length,
      receivedCount: sent.length - missing.length,
      missing: missing.map((m) => m.idempotencyKey),
      repaired,
    })
    .where(eq(syncRun.id, run!.id))
    .returning();
  await d.audit.record(tx, ctx, {
    action: 'connector.reconcile',
    entityType: 'sync_run',
    entityId: run!.id,
    after: { kind, expected: sent.length, missing: missing.length, repaired, status },
  });
  return done!;
}

/** The person did the work by hand. The event is closed so the platform does not send it a second time. */
export async function completeManualTask(
  tx: Tx,
  d: IntegrationDeps,
  ctx: RequestContext,
  id: string,
  reference: string,
) {
  const [t] = await tx
    .select()
    .from(manualTask)
    .where(and(eq(manualTask.id, id), eq(manualTask.tenantId, ctx.tenantId)));
  if (!t) throw new AppError(404, 'NOT_FOUND', 'Task not found');
  if (t.status !== 'OPEN')
    throw new AppError(
      409,
      'TASK_CLOSED',
      t.status === 'DONE' ? 'This task is already done' : 'This task was superseded',
    );
  const at = d.clock.now();
  const [row] = await tx
    .update(manualTask)
    .set({ status: 'DONE', reference, completedBy: ctx.userId, completedAt: at })
    .where(eq(manualTask.id, id))
    .returning();
  if (t.eventId) {
    const [e] = await tx.select().from(integrationEvent).where(eq(integrationEvent.id, t.eventId));
    if (e && e.status !== 'DELIVERED') {
      const p = e.payload as { matterId?: string };
      await tx
        .update(integrationEvent)
        .set({
          status: 'DELIVERED',
          deliveredAt: at,
          remoteAckAt: at,
          nextAttemptAt: null,
          lastError: null,
          payload: { ...(e.payload as object), handledBy: 'MANUAL', externalRef: reference },
        })
        .where(eq(integrationEvent.id, e.id));
      if (e.kind === 'MATTER_INITIATED' && p.matterId)
        await tx
          .update(legalMatter)
          .set({ externalRef: reference, updatedAt: at })
          .where(eq(legalMatter.id, p.matterId));
    }
  }
  await d.audit.record(tx, ctx, {
    action: 'connector.manual_task_done',
    entityType: 'manual_task',
    entityId: id,
    after: { connector: t.connectorKind, reference },
  });
  return row!;
}
