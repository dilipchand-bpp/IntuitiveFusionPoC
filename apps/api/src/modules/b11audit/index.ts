import type { FastifyInstance } from 'fastify';
import { withSystem } from '../../db/client.js';
import type { GuardDeps } from '../../auth/guard.js';
import { registerAccessMonitor, installAccessLog } from './access-monitor.js';
import { registerAdminChain } from './admin-chain.js';
import { registerBank } from './bank.js';
import { registerCompliance, runChecks } from './compliance.js';
import { registerEvidencePack } from './evidence-pack.js';
import { configurePolicyRuntime } from './policy-engine.js';
import { installPolicyGuard, registerPolicyRoutes } from './policy-routes.js';
import { sysCtx } from './util.js';

export interface B11auditDeps extends GuardDeps {
  schedulerMinutes?: number | undefined;
}

/**
 * B11c hooks that must exist before the routes they watch: the access log (SEC-L06), the access policy guard (SEC-AC09) and the
 * compliance re-check after a change to the settings (SEC-L08). Call this before the route registrations.
 */
export function installB11auditHooks(app: FastifyInstance, d: B11auditDeps) {
  configurePolicyRuntime(d.audit, d.clock);
  const recorder = installAccessLog(app, d);
  installPolicyGuard(app, d);
  const inflight = new Set<Promise<unknown>>();
  app.addHook('onResponse', async (req, reply) => {
    if (
      req.method !== 'PUT' ||
      reply.statusCode !== 200 ||
      req.routeOptions?.url !== '/api/v1/admin/settings' ||
      !req.auth
    )
      return;
    const tenantId = req.auth.user.tenantId;
    // a compliance run after every settings change; it must never delay or fail the change that triggered it
    const p = withSystem(d.database, (tx) =>
      runChecks(tx, d, tenantId, sysCtx(tenantId), { auditAlways: false }),
    )
      .catch(() => undefined)
      .finally(() => inflight.delete(p));
    inflight.add(p);
  });
  app.addHook('onClose', async () => {
    await Promise.allSettled([...inflight]);
  });
  return recorder;
}

/** B11c: audit integrity and evidence, access monitoring, configuration compliance, access policies, bank details. */
export function registerB11audit(
  app: FastifyInstance,
  p: string,
  d: B11auditDeps,
  recorder: ReturnType<typeof installAccessLog>,
): Set<string> {
  const done = new Set<string>();
  for (const k of [
    ...registerAdminChain(app, p, d),
    ...registerEvidencePack(app, p, d),
    ...registerAccessMonitor(app, p, d, recorder, d.schedulerMinutes),
    ...registerCompliance(app, p, d, d.schedulerMinutes),
    ...registerPolicyRoutes(app, p, d),
    ...registerBank(app, p, d),
  ])
    done.add(k);
  return done;
}
