import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, ROLE_NAMES, type RoleName } from '@if/shared';
import { buildApp } from '../app.js';
import type { Database } from '../db/client.js';
import { emailFor, seedDatabase, SEED_USERS } from '../db/seed.js';
import { loadSpec } from '../spec-routes.js';
import { freshDb, newClock } from '../test-helpers.js';

/**
 * Role x operation matrix. For EVERY operation in the OpenAPI contract and EVERY role (plus anonymous), the response
 * must be exactly what the contract's `x-roles` says: 401 anonymous, 403 wrong role, "not an auth error" for allowed roles.
 * Allowed roles reaching an unimplemented operation get 501 (coming soon); implemented ones get 2xx/4xx business results.
 */
const config = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'm'.repeat(40), API_PORT: '0' });
const PASSWORD = 'unit-test-password-123';
const roleUser: Record<RoleName, string> = Object.fromEntries(
  SEED_USERS.filter((u) => u.key !== 'evaluator-comm').map((u) => [u.role, u.key]),
) as never;

let app: FastifyInstance;
let database: Database;
const sessions = new Map<RoleName, { cookies: Record<string, string>; csrf: string }>();

beforeAll(async () => {
  database = await freshDb();
  const clock = newClock();
  await seedDatabase(database, { clock, password: PASSWORD });
  app = await buildApp(config, { database, clock, loginRateLimitMax: 10_000 });
  for (const role of ROLE_NAMES) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: emailFor(roleUser[role]), password: PASSWORD },
    });
    expect(res.statusCode, role).toBe(200);
    sessions.set(role, {
      cookies: Object.fromEntries(res.cookies.map((c) => [c.name, c.value])),
      csrf: res.json().csrfToken,
    });
  }
});

const spec = loadSpec();
const ops = Object.entries(spec.paths)
  .flatMap(([path, item]) =>
    Object.entries(item).map(([method, op]) => ({ method: method.toUpperCase(), path, op })),
  )
  // logout revokes the caller's session, so it must be the LAST call made with each role's session
  .sort((x, y) => Number(x.op.operationId === 'logout') - Number(y.op.operationId === 'logout'));
const fill = (path: string) =>
  '/api/v1' +
  path.replace(/\{(\w+)\}/g, (_m, name) =>
    name === 'key' || name === 'clauseId' ? 'x' : '3f2b8c1e-0000-4000-8000-000000000001',
  );
const call = (o: (typeof ops)[number], role: RoleName | null) => {
  const s = role ? sessions.get(role)! : null;
  return app.inject({
    method: o.method as 'GET',
    url: fill(o.path),
    cookies: s?.cookies,
    headers: s && o.method !== 'GET' ? { 'x-csrf-token': s.csrf } : {},
    ...(o.method === 'GET' ? {} : { payload: {} }),
  });
};

describe('contract facts', () => {
  it('the runtime copy of the OpenAPI document is identical to docs/api/openapi.json (no drift, ADR-0011)', () => {
    const docs = readFileSync(
      fileURLToPath(new URL('../../../../docs/api/openapi.json', import.meta.url)),
      'utf8',
    );
    const runtime = readFileSync(fileURLToPath(new URL('../../openapi.json', import.meta.url)), 'utf8');
    const norm = (x: string) => x.replaceAll(String.fromCharCode(13), '');
    expect(norm(runtime)).toBe(norm(docs));
  });
  it('covers all operations and all 12 roles', () => {
    expect(ops.length).toBeGreaterThanOrEqual(70);
    expect(ROLE_NAMES).toHaveLength(12);
  });
});

describe('authorisation matrix (every operation x every role)', () => {
  it('anonymous callers: 401 on every protected operation, never a business response', async () => {
    const failures: string[] = [];
    for (const o of ops) {
      if (o.op['x-roles'] === 'public') continue;
      const r = await call(o, null);
      if (r.statusCode !== 401) failures.push(`${o.method} ${o.path} -> ${r.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  for (const role of ROLE_NAMES) {
    it(`${role}: allowed exactly where the contract says, 403 everywhere else`, async () => {
      const failures: string[] = [];
      let allowed = 0;
      let denied = 0;
      for (const o of ops) {
        const x = o.op['x-roles'];
        if (x === 'public') continue;
        const shouldAllow = x === 'any-authenticated' || x.includes(role);
        const r = await call(o, role);
        if (shouldAllow) {
          allowed++;
          if (r.statusCode === 401 || r.statusCode === 403)
            failures.push(`ALLOWED but got ${r.statusCode}: ${o.method} ${o.path}`);
        } else {
          denied++;
          if (r.statusCode !== 403)
            failures.push(`should be 403 but got ${r.statusCode}: ${o.method} ${o.path}`);
          if (r.json().code !== 'FORBIDDEN') failures.push(`wrong error code on ${o.method} ${o.path}`);
        }
      }
      expect(failures).toEqual([]);
      expect(allowed + denied).toBeGreaterThan(60);
    });
  }

  it('state-changing calls without a CSRF token are refused even for permitted roles', async () => {
    const o = ops.find((x) => x.method === 'POST' && x.path === '/requests')!;
    // the role tests above end each session with logout, so sign in again here
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: emailFor('requester'), password: PASSWORD },
    });
    const cookies = Object.fromEntries(login.cookies.map((c) => [c.name, c.value]));
    const r = await app.inject({ method: 'POST', url: fill(o.path), cookies, payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('CSRF_INVALID');
  });

  it('the headline probity rules hold at the contract level', () => {
    const roles = (id: string) => ops.find((o) => o.op.operationId === id)!.op['x-roles'];
    expect(roles('adminListUsers')).toEqual(['ADMIN']);
    expect(roles('signContract')).toEqual(['DELEGATE', 'EXEC']); // not PROCUREMENT, not ADMIN
    expect(roles('reopenPlan')).toEqual(['PROCUREMENT']); // requesters cannot reopen
    expect(roles('openConsensus')).toEqual(['CHAIR']);
    expect(roles('exportAudit')).toEqual(['PROBITY', 'ADMIN']);
    expect(JSON.stringify(roles('getMyScores'))).not.toMatch(/ADMIN|PROCUREMENT/);
    for (const id of ['getEvaluation', 'getMyScores', 'saveScores']) expect(roles(id)).not.toContain('ADMIN');
  });

  it('suppliers can reach only supplier-portal operations (plus auth/notifications)', () => {
    const supplierOps = ops.filter(
      (o) => Array.isArray(o.op['x-roles']) && o.op['x-roles'].includes('SUPPLIER'),
    );
    expect(supplierOps.length).toBeGreaterThan(0);
    for (const o of supplierOps)
      expect(['SupplierPortal', 'Tenders', 'Auth', 'Notifications']).toContain(o.op.tags?.[0]);
  });
});
