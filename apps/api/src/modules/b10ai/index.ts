import type { FastifyInstance } from 'fastify';
import { registerConfigRoutes, type ConfigDeps } from './config-routes.js';
import { registerPerformance } from './perf.js';
import { registerAiRoutes } from './routes.js';

/** B10: the AI model layer, configuration inventory and portability, browser baseline check, measured performance. */
export function registerB10ai(app: FastifyInstance, p: string, d: ConfigDeps): Set<string> {
  const done = new Set<string>();
  for (const f of [registerAiRoutes, registerConfigRoutes, registerPerformance])
    for (const k of f(app, p, d)) done.add(k);
  return done;
}
