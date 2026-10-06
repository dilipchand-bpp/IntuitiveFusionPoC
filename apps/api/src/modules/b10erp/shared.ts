/**
 * Small helpers shared by the B10b modules (ERP, legal status, HR feed, payments).
 *
 * SWAP POINT (docs/swap-points.md): `ensureSimulatedSecret` exists only for the simulation. A real connector's signing secret
 * is set by an administrator in the secret store (SEC-N03) and the simulated receiver is replaced by the real system, which
 * then verifies the same X-IF-Signature and X-IF-Timestamp headers (SEC-TP04).
 */
import { randomBytes } from 'node:crypto';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import { notification } from '../../db/schema.js';
import { connectorSecretName, readSecret, setSecret } from '../b10conn/secrets.js';

export interface SimDeps {
  clock: Clock;
  audit: AuditService;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

export const sysCtx = (tenantId: string): RequestContext => ({ tenantId, userId: null, role: 'SYSTEM' });

/**
 * The simulated systems sign and verify their messages, so a connector needs a secret. When none was set yet, a random one is
 * generated and stored (encrypted, versioned, audited without its value) so a demonstration works without a set-up step.
 * A secret that only existed as an older setting (the legal platform's) is copied into the store unchanged.
 */
export async function ensureSimulatedSecret(
  tx: Tx,
  d: SimDeps,
  ctx: RequestContext,
  kind: string,
  fallback?: string,
): Promise<string> {
  // the store is the source of truth: a legacy setting is copied into it (same value, so nothing already configured changes)
  const existing = await readSecret(tx, ctx.tenantId, connectorSecretName(kind));
  if (existing) return existing;
  const value = fallback || randomBytes(24).toString('base64url');
  await setSecret(tx, { audit: d.audit, now: d.clock.now() }, ctx, connectorSecretName(kind), value);
  return value;
}

export async function tell(
  tx: Tx,
  tenantId: string,
  userId: string,
  title: string,
  body: string,
  link: string,
  event?: string,
) {
  await tx.insert(notification).values({ tenantId, userId, title, body, link, ...(event ? { event } : {}) });
}

export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const r2 = (n: number) => Math.round(n * 100) / 100;
