/** Shared set-up for the contract API tests that need a seeded database, logged-in people and an executed contract. */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash as argon2Hash } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { loadConfig, type ManualClock } from '@if/shared';
import { buildApp } from '../../app.js';
import { withSystem, type Database } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { emailFor, seedDatabase, TENANT_ID, uid } from '../../db/seed.js';
import { freshDb, newClock } from '../../test-helpers.js';

export const PASSWORD = 'unit-test-password-123';
export const BRIGHT = uid('supplier:brightwave');
export const SEED_DATE = '2026-10-02T09:00:00Z';

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function createEnv() {
  const database: Database = await freshDb();
  const clock: ManualClock = newClock();
  await seedDatabase(database, { clock, password: PASSWORD });
  const dir = await mkdtemp(join(tmpdir(), 'if-env-'));
  const app: FastifyInstance = await buildApp(
    loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'e'.repeat(40), STORAGE_DIR: dir }),
    { database, clock, loginRateLimitMax: 100_000 },
  );
  const sessions = new Map<string, { cookies: Record<string, string>; csrf: string }>();

  async function call(
    key: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
    retry = true,
  ): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    if (!sessions.has(key)) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: key.includes('@') ? key : emailFor(key), password: PASSWORD },
      });
      expect(res.statusCode, `${key}: ${res.body}`).toBe(200);
      sessions.set(key, {
        cookies: Object.fromEntries(res.cookies.map((c) => [c.name, c.value])),
        csrf: res.json().csrfToken as string,
      });
    }
    const sess = sessions.get(key)!;
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      cookies: sess.cookies,
      headers: method === 'GET' ? {} : { 'x-csrf-token': sess.csrf },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    if (res.statusCode === 401 && retry) {
      sessions.delete(key); // time travel ends sessions
      return call(key, method, url, payload, false);
    }
    return res;
  }

  let seq = 0;
  /** An approved award for Brightwave (RFP, so the services template), returned as evaluation and request ids. */
  async function award(opts: { value?: number } = {}) {
    const n = (seq += 1);
    return withSystem(database, async (tx) => {
      const [req] = await tx
        .insert(s.request)
        .values({
          tenantId: TENANT_ID,
          number: `PR-ENV-${String(n).padStart(4, '0')}`,
          title: `Env fixture ${n}`,
          estimatedValue: String(opts.value ?? 120_000),
          termMonths: 24,
          requesterId: uid('user:requester'),
          phase: 'EVALUATION',
          status: 'IN_PROGRESS',
        })
        .returning();
      const [t] = await tx
        .insert(s.tender)
        .values({ tenantId: TENANT_ID, requestId: req!.id, type: 'RFP', status: 'EVALUATING' })
        .returning();
      await tx.insert(s.submission).values({
        tenantId: TENANT_ID,
        tenderId: t!.id,
        supplierId: BRIGHT,
        status: 'SUBMITTED',
        submittedAt: clock.now(),
      });
      const [ev] = await tx
        .insert(s.evaluation)
        .values({ tenantId: TENANT_ID, tenderId: t!.id, status: 'APPROVED' })
        .returning();
      const [crit] = await tx
        .insert(s.criterion)
        .values({
          tenantId: TENANT_ID,
          evaluationId: ev!.id,
          name: 'Quality',
          weight: '100',
          stream: 'TECHNICAL',
        })
        .returning();
      await tx.insert(s.consensusItem).values({
        tenantId: TENANT_ID,
        evaluationId: ev!.id,
        supplierId: BRIGHT,
        criterionId: crit!.id,
        consensusScore: '8.00',
      });
      return { evaluationId: ev!.id, tenderId: t!.id, requestId: req!.id };
    });
  }

  /** Draft by legal, one harmless edit, release, signed by the delegate: an executed, locked contract. */
  async function executed(opts: { value?: number } = {}) {
    const a = await award(opts);
    const c = await call('legal', 'POST', '/contracts', { evaluationId: a.evaluationId, supplierId: BRIGHT });
    expect(c.statusCode, c.body).toBe(201);
    const id = c.json().id as string;
    await call('legal', 'PUT', `/contracts/${id}/clauses/IP`, { text: 'Legal reviewed wording for IP.' });
    expect((await call('legal', 'POST', `/contracts/${id}/release-for-signing`)).statusCode).toBe(200);
    const signed = await call('delegate', 'POST', `/contracts/${id}/sign`, { decision: 'APPROVE' });
    expect(signed.statusCode, signed.body).toBe(200);
    return { id, view: signed.json() as Json, ...a };
  }

  async function draft(opts: { value?: number } = {}) {
    const a = await award(opts);
    const c = await call('legal', 'POST', '/contracts', { evaluationId: a.evaluationId, supplierId: BRIGHT });
    expect(c.statusCode, c.body).toBe(201);
    return { id: c.json().id as string, view: c.json() as Json, ...a };
  }

  async function extraUser(
    tag: string,
    role: s.Role,
    delegations: Array<{ scope: 'SOURCING_APPROVAL' | 'CONTRACT_SIGNING'; max: string }> = [],
  ) {
    const hash = await argon2Hash(PASSWORD);
    return withSystem(database, async (tx) => {
      const email = `${tag}-${(seq += 1)}@meridian-demo.example`;
      const [u] = await tx
        .insert(s.appUser)
        .values({ tenantId: TENANT_ID, email, name: `Extra ${tag}`, passwordHash: hash })
        .returning();
      await tx.insert(s.roleAssignment).values({ tenantId: TENANT_ID, userId: u!.id, role });
      for (const d of delegations)
        await tx
          .insert(s.delegation)
          .values({ tenantId: TENANT_ID, scope: d.scope, role, userId: u!.id, maxValue: d.max });
      return { email, id: u!.id };
    });
  }

  return { app, database, clock, call, award, executed, draft, extraUser, withSystem };
}
