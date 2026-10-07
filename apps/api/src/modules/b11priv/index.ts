import type { FastifyInstance } from 'fastify';
import { withSystem, type Database } from '../../db/client.js';
import { tenant } from '../../db/schema.js';
import { runReminders } from './breach.js';
import { runScan } from './classification.js';
import { setOutboundClock } from './outbound.js';
import { escalateOverdue } from './privacy.js';
import { runRetention } from './retention.js';
import { registerIncidentRoutes } from './routes-incidents.js';
import { registerPrivacyRoutes, type PrivacyDeps } from './routes-privacy.js';
import { registerResidencyRoutes } from './routes-residency.js';

export interface B11bDeps extends PrivacyDeps {
  /** Minutes between scheduled runs; omit to run only on request (tests, one-shot scripts). */
  schedulerMinutes?: number | undefined;
}

/** One scheduled pass for every tenant: retention, classification, overdue privacy requests and breach deadlines. */
export async function runScheduled(database: Database): Promise<void> {
  await withSystem(database, async (tx) => {
    const tenants = await tx.select({ id: tenant.id }).from(tenant);
    for (const t of tenants) {
      await runRetention(tx, t.id, null, 'SCHEDULED');
      await runScan(tx, t.id, null, 'SCHEDULED');
      await escalateOverdue(tx, t.id, null);
      await runReminders(tx, t.id, null);
    }
  });
}

/** B11b: residency and egress (NFR-R02, SEC-D09, SEC-D05), AI conversation retention (SEC-D06), classification (SEC-D07), Privacy Act (SEC-D08), content safety (SEC-AP08), breach response (SEC-IR05), hosting topology design (SEC-D11). */
export function registerB11b(app: FastifyInstance, p: string, d: B11bDeps): Set<string> {
  setOutboundClock(d.clock);
  const done = new Set<string>();
  for (const f of [registerResidencyRoutes, registerPrivacyRoutes, registerIncidentRoutes])
    for (const k of f(app, p, d)) done.add(k);
  if (d.schedulerMinutes) {
    const h = setInterval(
      () => void runScheduled(d.database).catch(() => undefined),
      d.schedulerMinutes * 60_000,
    );
    h.unref();
    app.addHook('onClose', async () => clearInterval(h));
  }
  return done;
}
