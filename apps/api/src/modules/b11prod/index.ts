/**
 * Batch B11d registration: signature levels (NFR-L03), outside content (NFR-R03), ESG plan targets (NFR-R05), tenants and
 * usage (NFR-SC01). The throttle hook itself is installed earlier in app.ts, straight after the session is resolved.
 */
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '@if/shared';
import type { AiProvider } from '../../adapters/ai-provider.js';
import type { GuardDeps } from '../../auth/guard.js';
import { registerContentRoutes } from './content-routes.js';
import { registerEidasRoutes } from './eidas-routes.js';
import { registerEsgTargetRoutes } from './esg-routes.js';
import { registerTenancyRoutes } from './tenancy-routes.js';
import type { Tenancy } from './tenancy.js';

export { Tenancy, installThrottle } from './tenancy.js';

export interface B11dDeps extends GuardDeps {
  ai: AiProvider;
  config: AppConfig;
  tenancy: Tenancy;
  schedulerMinutes?: number | undefined;
  operatorRateLimitMax: number;
}

export function registerB11d(app: FastifyInstance, p: string, d: B11dDeps): Set<string> {
  const done = new Set<string>();
  for (const k of registerEidasRoutes(app, p, d)) done.add(k);
  for (const k of registerContentRoutes(app, p, d)) done.add(k);
  for (const k of registerEsgTargetRoutes(app, p, d)) done.add(k);
  for (const k of registerTenancyRoutes(app, p, d)) done.add(k);
  return done;
}
