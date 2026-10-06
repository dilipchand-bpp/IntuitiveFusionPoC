/**
 * What leaves the platform for another system. Each event is written first, with a key that makes it safe to send twice,
 * then delivered; a failed delivery stays on record and can be retried (FR-0390; the general retry and reconciliation
 * come in batch B10, NFR-AV03). Delivery now runs through the resilient layer in modules/b10conn: a failed delivery is
 * retried on a backoff, ends in a dead-letter state after too many attempts, and queues a manual task for a person (NFR-AV04).
 */
import { and, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import { SimulatedLegalPlatform, type LegalPlatformGateway } from '../../adapters/legal-platform.js';
import type { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import { contract, integrationEvent, legalMatter } from '../../db/schema.js';
import { loadSettings } from '../settings/settings.js';
import { getConnector } from '../b10conn/connectors.js';
import {
  deliverGeneric,
  recordFailure,
  recordSuccess,
  type DeliveryDeps,
  type EventRow,
} from '../b10conn/delivery.js';
import { callProvider } from '../b10conn/resilience.js';

export interface IntegrationDeps {
  clock: Clock;
  audit: AuditService;
  legal?: LegalPlatformGateway;
  sleep?: (ms: number) => Promise<void>;
}

export const eventView = (e: EventRow) => ({
  id: e.id,
  kind: e.kind,
  connector: e.connectorKind,
  direction: e.direction,
  target: e.target,
  status: e.status,
  attempts: e.attempts,
  lastError: e.lastError,
  createdAt: e.createdAt.toISOString(),
  deliveredAt: e.deliveredAt?.toISOString() ?? null,
  nextAttemptAt: e.nextAttemptAt?.toISOString() ?? null,
  acknowledgedAt: e.remoteAckAt?.toISOString() ?? null,
});

const dd = (d: IntegrationDeps): DeliveryDeps => ({
  clock: d.clock,
  audit: d.audit,
  ...(d.sleep ? { sleep: d.sleep } : {}),
});

/** Tries to deliver one event now. Safe to call again on a failed one. */
export async function deliver(
  tx: Tx,
  d: IntegrationDeps,
  ctx: RequestContext,
  e: EventRow,
  opts: { resend?: boolean } = {},
): Promise<EventRow> {
  if (e.status === 'DELIVERED' && !opts.resend) return e;
  if (e.kind !== 'MATTER_INITIATED') return deliverGeneric(tx, dd(d), ctx, e, opts);
  const s = await loadSettings(tx, e.tenantId);
  const gateway = d.legal ?? new SimulatedLegalPlatform();
  const at = d.clock.now();
  const p = e.payload as {
    matterId: string;
    title: string;
    contractNumber: string | null;
    priority: string;
  };
  const outcome = await callProvider(
    tx,
    dd(d),
    e.tenantId,
    'LEGAL',
    () => gateway.initiate(p, { platform: s.legalPlatform.name, outage: s.legalPlatform.simulateOutage }),
    { fallback: () => null },
  );
  if (!outcome.ok || !outcome.value) {
    if (opts.resend) return e;
    return recordFailure(tx, dd(d), ctx, e, outcome.ok ? 'Delivery failed' : outcome.error);
  }
  const res = outcome.value;
  await tx
    .update(legalMatter)
    .set({ externalRef: res.externalRef, updatedAt: at })
    .where(eq(legalMatter.id, p.matterId));
  return recordSuccess(tx, dd(d), ctx, e, {
    acknowledged: true,
    payload: { ...p, externalRef: res.externalRef },
  });
}

/** A new legal matter becomes a matter on the customer's legal platform, when the customer runs one. */
export async function raiseMatterEvent(
  tx: Tx,
  d: IntegrationDeps,
  ctx: RequestContext,
  m: typeof legalMatter.$inferSelect,
) {
  const s = await loadSettings(tx, m.tenantId);
  if (!s.legalPlatform.enabled) return null;
  // a legal connector that has been switched off means matters are not sent at all
  const conn = await getConnector(tx, m.tenantId, 'LEGAL');
  if (conn && !conn.enabled) return null;
  const [c] = m.contractId
    ? await tx.select({ n: contract.number }).from(contract).where(eq(contract.id, m.contractId))
    : [];
  const [row] = await tx
    .insert(integrationEvent)
    .values({
      tenantId: m.tenantId,
      kind: 'MATTER_INITIATED',
      connectorKind: 'LEGAL',
      target: s.legalPlatform.name,
      idempotencyKey: `matter:${m.id}`,
      payload: { matterId: m.id, title: m.title, contractNumber: c?.n ?? null, priority: m.priority },
      createdAt: d.clock.now(),
    })
    .onConflictDoNothing()
    .returning();
  return row ? deliver(tx, d, ctx, row) : null;
}

/**
 * Delivers what is waiting. A person pressing "retry" does not wait for the backoff; the scheduled run (`onlyDue`) does.
 * A dead-lettered event is only retried when asked for by id.
 */
export async function retryFailed(
  tx: Tx,
  d: IntegrationDeps,
  ctx: RequestContext,
  tenantId: string,
  id?: string,
  opts: { onlyDue?: Date } = {},
) {
  const rows = await tx
    .select()
    .from(integrationEvent)
    .where(
      and(
        eq(integrationEvent.tenantId, tenantId),
        eq(integrationEvent.direction, 'OUT'),
        inArray(integrationEvent.status, id ? ['FAILED', 'PENDING', 'DEAD_LETTER'] : ['FAILED', 'PENDING']),
        ...(id ? [eq(integrationEvent.id, id)] : []),
        ...(opts.onlyDue
          ? [or(isNull(integrationEvent.nextAttemptAt), lte(integrationEvent.nextAttemptAt, opts.onlyDue))!]
          : []),
      ),
    )
    .orderBy(desc(integrationEvent.createdAt));
  const out: EventRow[] = [];
  for (const r of rows) out.push(await deliver(tx, d, ctx, r));
  return out;
}
