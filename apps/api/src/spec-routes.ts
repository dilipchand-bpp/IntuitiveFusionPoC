import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { ROLE_NAMES, type RoleName } from '@if/shared';
import { guard, type Access, type GuardDeps } from './auth/guard.js';

interface SpecOperation {
  operationId: string;
  summary?: string;
  tags?: string[];
  'x-roles': 'public' | 'any-authenticated' | string[];
}
interface Spec {
  paths: Record<string, Record<string, SpecOperation>>;
}

/** apps/api/openapi.json is a verified copy of docs/api/openapi.json (drift test, ADR-0011). */
export const loadSpec = (): Spec =>
  JSON.parse(readFileSync(fileURLToPath(new URL('../openapi.json', import.meta.url)), 'utf8')) as Spec;

export const accessFor = (op: SpecOperation): Access =>
  op['x-roles'] === 'public'
    ? 'public'
    : op['x-roles'] === 'any-authenticated'
      ? 'any'
      : (op['x-roles'].filter((r): r is RoleName =>
          (ROLE_NAMES as readonly string[]).includes(r),
        ) as RoleName[]);

const toFastifyPath = (p: string) => p.replace(/\{(\w+)\}/g, ':$1');

/**
 * Registers every operation in the OpenAPI contract that has no real handler yet, behind its REAL access guard,
 * answering 501 NOT_IMPLEMENTED with a "coming soon" body. This gives the whole API surface correct 401/403
 * behaviour from day one (tested for every role x operation) and implements the "never blank" rule for stubs (M14).
 */
export function registerSpecStubs(
  app: FastifyInstance,
  prefix: string,
  deps: GuardDeps,
  implemented: Set<string>,
): number {
  const spec = loadSpec();
  let n = 0;
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(item)) {
      const key = `${method.toUpperCase()} ${path}`;
      if (implemented.has(key)) continue;
      app.route({
        method: method.toUpperCase() as 'GET',
        url: `${prefix}${toFastifyPath(path)}`,
        preHandler: guard(deps, accessFor(op)),
        handler: async (req, reply) =>
          reply.status(501).type('application/problem+json').send({
            type: 'about:blank',
            title: 'Coming soon',
            status: 501,
            code: 'NOT_IMPLEMENTED',
            correlationId: req.id,
            feature: op.operationId,
            featureStatus: 'COMING_SOON',
          }),
      });
      n++;
    }
  }
  return n;
}
