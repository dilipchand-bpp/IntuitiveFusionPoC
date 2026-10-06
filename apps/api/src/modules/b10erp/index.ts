/**
 * Batch B10b: ERP sync (NFR-C02), legal system status sync (NFR-C03), HR feed (FR-0815) and payment execution (FR-0875),
 * all built on the connector layer in modules/b10conn (registry, resilient calls, signed delivery, manual fallback tasks).
 *
 * SWAP POINT (docs/swap-points.md), summarised; each file's header has the detail:
 *   erp-source.ts   the ERP (SAP, Oracle, Dynamics) and its three mappers
 *   legal-sync.ts   the legal platform's webhook calls
 *   hr-feed.ts      the HR system's worker feed
 *   payments.ts     the finance system that executes payments and confirms them
 */
import { withSystem } from '../../db/client.js';
import { connector } from '../../db/schema.js';
import type { FastifyInstance } from 'fastify';
import type { GuardDeps } from '../../auth/guard.js';
import { settlePayments } from './payments.js';
import { registerErpRoutes } from './erp-routes.js';
import { registerHrRoutes } from './hr-routes.js';
import { registerLegalSync } from './legal-sync.js';
import { registerPayments } from './payments.js';
import { sysCtx } from './shared.js';

export interface B10bDeps extends GuardDeps {
  defaultTenantSlug: string;
  schedulerMinutes?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

export function registerB10b(app: FastifyInstance, p: string, d: B10bDeps): Set<string> {
  const done = new Set<string>();
  for (const f of [registerErpRoutes, registerLegalSync, registerHrRoutes, registerPayments])
    for (const k of f(app, p, d)) done.add(k);
  if (d.schedulerMinutes) {
    // payments whose order was delivered after a wait are brought up to date on the same schedule as the retry run
    const h = setInterval(
      () =>
        void withSystem(d.database, async (tx) => {
          const tenants = await tx.select({ t: connector.tenantId }).from(connector);
          for (const t of new Set(tenants.map((x) => x.t))) await settlePayments(tx, d, sysCtx(t));
        }).catch(() => undefined),
      d.schedulerMinutes * 60_000,
    );
    h.unref();
    app.addHook('onClose', async () => clearInterval(h));
  }
  return done;
}
