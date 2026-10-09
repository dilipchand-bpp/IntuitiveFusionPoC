import type { FastifyInstance } from 'fastify';
import { registerCopilotRuntime, type CopilotDeps } from './routes.js';

export { CopilotEngine } from './engine.js';
export { AGENTS, COPILOT_ROLES } from './agents.js';
export type { CopilotDeps } from './routes.js';

/** Batch BCP, agent runtime: runs, the tick engine, the specialist agents (CP-01, CP-02, CP-03, CP-06). */
export function registerCpAgent(app: FastifyInstance, p: string, d: CopilotDeps) {
  return registerCopilotRuntime(app, p, d);
}
