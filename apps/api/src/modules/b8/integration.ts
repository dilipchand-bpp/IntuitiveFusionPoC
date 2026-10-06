/**
 * What leaves the platform for another system. Each event is written first, with a key that makes it safe to send twice,
 * then delivered; a failed delivery stays on record and can be retried (FR-0390; the general retry and reconciliation
 * come in batch B10, NFR-AV03). The only target today is the customer's legal platform.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import { SimulatedLegalPlatform, type LegalPlatformGateway } from '../../adapters/legal-platform.js';
import type { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import { contract, integrationEvent, legalMatter } from '../../db/schema.js';
import { loadSettings } from '../settings/settings.js';

export interface IntegrationDeps {
  clock: Clock;
  audit: AuditService;
  legal?: LegalPlatformGateway;
}
type EventRow = typeof integrationEvent.$inferSelect;

export const eventView = (e: EventRow) => ({
  id: e.id,
  kind: e.kind,
  target: e.target,
  status: e.status,
  attempts: e.attempts,
  lastError: e.lastError,
  createdAt: e.createdAt.toISOString(),
  deliveredAt: e.deliveredAt?.toISOString() ?? null,
});

/** Tries to deliver one event now. Safe to call again on a failed one. */
export async function deliver(
  tx: Tx,
  d: IntegrationDeps,
  ctx: RequestContext,
  e: EventRow,
): Promise<EventRow> {
  if (e.status === 'DELIVERED') return e;
  const s = await loadSettings(tx, e.tenantId);
  const gateway = d.legal ?? new SimulatedLegalPlatform();
  const at = d.clock.now();
  try {
    if (e.kind !== 'MATTER_INITIATED') throw new Error(`No delivery is defined for ${e.kind}`);
    const p = e.payload as {
      matterId: string;
      title: string;
      contractNumber: string | null;
      priority: string;
    };
    const res = await gateway.initiate(p, {
      platform: s.legalPlatform.name,
      outage: s.legalPlatform.simulateOutage,
    });
    await tx
      .update(legalMatter)
      .set({ externalRef: res.externalRef, updatedAt: at })
      .where(eq(legalMatter.id, p.matterId));
    const [row] = await tx
      .update(integrationEvent)
      .set({
        status: 'DELIVERED',
        attempts: e.attempts + 1,
        lastError: null,
        deliveredAt: at,
        payload: { ...p, externalRef: res.externalRef },
      })
      .where(eq(integrationEvent.id, e.id))
      .returning();
    await d.audit.record(tx, ctx, {
      action: 'integration.delivered',
      entityType: 'integration_event',
      entityId: e.id,
      after: { kind: e.kind, externalRef: res.externalRef },
    });
    return row!;
  } catch (err) {
    const [row] = await tx
      .update(integrationEvent)
      .set({
        status: 'FAILED',
        attempts: e.attempts + 1,
        lastError: err instanceof Error ? err.message : 'Delivery failed',
      })
      .where(eq(integrationEvent.id, e.id))
      .returning();
    await d.audit.record(tx, ctx, {
      action: 'integration.failed',
      entityType: 'integration_event',
      entityId: e.id,
      result: 'FAILED',
      after: { kind: e.kind, error: row!.lastError },
    });
    return row!;
  }
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
  const [c] = m.contractId
    ? await tx.select({ n: contract.number }).from(contract).where(eq(contract.id, m.contractId))
    : [];
  const [row] = await tx
    .insert(integrationEvent)
    .values({
      tenantId: m.tenantId,
      kind: 'MATTER_INITIATED',
      target: s.legalPlatform.name,
      idempotencyKey: `matter:${m.id}`,
      payload: { matterId: m.id, title: m.title, contractNumber: c?.n ?? null, priority: m.priority },
      createdAt: d.clock.now(),
    })
    .onConflictDoNothing()
    .returning();
  return row ? deliver(tx, d, ctx, row) : null;
}

export async function retryFailed(
  tx: Tx,
  d: IntegrationDeps,
  ctx: RequestContext,
  tenantId: string,
  id?: string,
) {
  const rows = await tx
    .select()
    .from(integrationEvent)
    .where(
      and(
        eq(integrationEvent.tenantId, tenantId),
        inArray(integrationEvent.status, ['FAILED', 'PENDING']),
        ...(id ? [eq(integrationEvent.id, id)] : []),
      ),
    )
    .orderBy(desc(integrationEvent.createdAt));
  const out: EventRow[] = [];
  for (const r of rows) out.push(await deliver(tx, d, ctx, r));
  return out;
}
