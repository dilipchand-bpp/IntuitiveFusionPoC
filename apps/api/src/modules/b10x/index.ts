import type { FastifyInstance } from 'fastify';
import type { GuardDeps } from '../../auth/guard.js';
import { registerContinuity } from './continuity-routes.js';
import { registerDocRepo } from './docrepo-routes.js';
import { registerEsign } from './esign-routes.js';

export interface B10xDeps extends GuardDeps {
  schedulerMinutes?: number | undefined;
}

/** B10c: e-signature envelopes (NFR-C04), the document repository (NFR-C06) and business-continuity alerts (FR-0860). */
export function registerB10x(app: FastifyInstance, p: string, d: B10xDeps): Set<string> {
  const done = new Set<string>();
  for (const f of [registerEsign, registerDocRepo, registerContinuity])
    for (const k of f(app, p, d)) done.add(k);
  return done;
}
