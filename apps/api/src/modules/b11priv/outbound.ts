/**
 * The single gate every outbound path goes through (SEC-D05 egress and SEC-D09 / NFR-R02 residency).
 *
 * `checkOutbound` evaluates the egress allow-list and then the region policy for one transfer. A refusal is recorded
 * (a row for the residency page and an audit event) in the CALLER'S transaction and returned, never thrown, so that a
 * route can commit the record and then answer 422. `assertOutbound` throws the refusal after recording it; use it only
 * where the transaction is allowed to roll back or is wrapped in `refusable`.
 */
import { systemClock, type Clock } from '@if/shared';
import { AuditService } from '../../audit/audit-service.js';
import { withContext, type Database, type RequestContext, type Tx } from '../../db/client.js';
import { outboundRefusal } from '../../db/schema.js';
import { loadSettings, type Settings } from '../settings/settings.js';
import { OutboundRefusal, egressDecision } from './egress.js';
import { PURPOSES, regionDecision, type Purpose } from './region.js';

let clock: Clock = systemClock;
/** The application's clock, set when the app is built, so refusals are stamped with the injected clock (tests). */
export function setOutboundClock(c: Clock): void {
  clock = c;
}
export const outboundNow = (): Date => clock.now();
export const outboundClock = (): Clock => clock;

export interface OutboundTarget {
  /** A human label for the destination (provider or model name). */
  label: string;
  /** The simulated endpoint host; checked against the egress allow-list. Omit for an in-process destination. */
  host?: string | null;
  /** The country or region code where the destination processes or stores the data. Omit when it is not a transfer. */
  region?: string | null;
}

export interface OutboundRequest {
  purpose: Purpose;
  target: OutboundTarget;
  actorId?: string | null;
  /** Pass settings you already loaded to save a query. */
  settings?: Settings;
}

async function record(
  tx: Tx,
  tenantId: string,
  actorId: string | null,
  e: OutboundRefusal,
  settings: Settings,
) {
  const at = clock.now();
  await tx.insert(outboundRefusal).values({
    tenantId,
    kind: e.detail.kind,
    purpose: e.detail.purpose,
    target: e.detail.target,
    region: e.detail.region,
    electedCountry: settings.residency.country,
    reason: e.message,
    actorId,
    createdAt: at,
  });
  const ctx: RequestContext = { tenantId, userId: actorId, role: actorId ? null : 'SYSTEM' };
  await new AuditService(clock).record(tx, ctx, {
    action: e.detail.kind === 'EGRESS' ? 'egress.blocked' : 'residency.refused',
    entityType: 'tenant',
    entityId: tenantId,
    result: 'DENIED',
    after: {
      purpose: e.detail.purpose,
      target: e.detail.target,
      region: e.detail.region,
      electedCountry: settings.residency.country,
    },
  });
}

/** Returns the refusal (already recorded) or null when the transfer is allowed. */
export async function checkOutbound(
  tx: Tx,
  tenantId: string,
  req: OutboundRequest,
): Promise<OutboundRefusal | null> {
  const s = req.settings ?? (await loadSettings(tx, tenantId));
  const label = PURPOSES[req.purpose];
  let refusal: OutboundRefusal | null = null;
  if (req.target.host) {
    const d = egressDecision(s.egress.allowedHosts, req.target.host);
    if (!d.allowed)
      refusal = new OutboundRefusal(
        'EGRESS_BLOCKED',
        `Outbound call refused (${label} to ${d.host}): the host is not on the egress allow-list`,
        { kind: 'EGRESS', purpose: req.purpose, target: d.host, region: req.target.region ?? null },
      );
  }
  if (!refusal && req.target.region) {
    const d = regionDecision(s.residency, req.purpose, req.target.region);
    if (!d.allowed)
      refusal = new OutboundRefusal('RESIDENCY_VIOLATION', d.reason!, {
        kind: 'RESIDENCY',
        purpose: req.purpose,
        target: req.target.label,
        region: d.region,
      });
  }
  if (refusal) await record(tx, tenantId, req.actorId ?? null, refusal, s);
  return refusal;
}

/** Records and throws. See the note at the top of the file about the transaction. */
export async function assertOutbound(tx: Tx, tenantId: string, req: OutboundRequest): Promise<void> {
  const r = await checkOutbound(tx, tenantId, req);
  if (r) throw r;
}

/**
 * Runs a request handler's transaction so that a refusal recorded inside it is COMMITTED and the 422 is raised afterwards.
 * Anything the handler wrote before the refusal is kept, so check first and write after.
 */
export async function refusable<T>(
  database: Database,
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const out = await withContext(database, ctx, async (tx) => {
    try {
      return { ok: true as const, value: await fn(tx) };
    } catch (e) {
      if (e instanceof OutboundRefusal) return { ok: false as const, error: e };
      throw e;
    }
  });
  if (!out.ok) throw out.error;
  return out.value;
}
