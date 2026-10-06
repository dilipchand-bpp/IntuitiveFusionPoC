import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '@if/shared';
import { buildApp } from '../app.js';
import type { Database } from '../db/client.js';
import * as s from '../db/schema.js';
import { emailFor, seedDatabase, TENANT_ID, uid } from '../db/seed.js';
import { freshDb, newClock } from '../test-helpers.js';

const PASSWORD = 'unit-test-password-123';
let app: FastifyInstance;
let database: Database;

const session = async (key: string) => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: emailFor(key), password: PASSWORD },
  });
  return {
    cookies: Object.fromEntries(res.cookies.map((c) => [c.name, c.value])),
    csrf: res.json().csrfToken as string,
  };
};
const get = async (key: string, url: string) => {
  const sess = await session(key);
  return app.inject({ method: 'GET', url: `/api/v1${url}`, cookies: sess.cookies });
};

beforeAll(async () => {
  database = await freshDb();
  const clock = newClock();
  await seedDatabase(database, { clock, password: PASSWORD });
  app = await buildApp(loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'k'.repeat(40) }), {
    database,
    clock,
    loginRateLimitMax: 10_000,
  });
});

describe('GET /dashboard/kpis', () => {
  it('portfolio roles see the whole tenant: 4 active, AUD 6.648M in flight, cycle time from completed work', async () => {
    const r = await get('exec', '/dashboard/kpis');
    expect(r.statusCode).toBe(200);
    const k = r.json();
    expect(k.activeProcurements).toBe(4); // cleaning, itmsp, paper(draft), security  (landscape & uniforms are complete)
    expect(k.valueInFlight).toBe(1_200_000 + 4_800_000 + 8_000 + 640_000);
    expect(k.avgCycleDays).toBeGreaterThan(50);
    expect(k.byPhase.map((p: { phase: string }) => p.phase).sort()).toEqual([
      'EVALUATION',
      'INTAKE',
      'PLAN',
      'TENDER',
    ]);
    expect(k.recent).toHaveLength(5);
    expect(k.alertsDue).toBe(1); // landscape 60-day expiry reminder falls 14 days after the seed date
  });

  it('scope: a requester sees only their own requests; other roles see the tenant', async () => {
    await database.db.insert(s.request).values({
      tenantId: TENANT_ID,
      number: 'PR-2026-0099',
      title: 'Another user request',
      requesterId: uid('user:procurement'),
      estimatedValue: '1000.00',
      status: 'IN_PROGRESS',
      phase: 'PLAN',
    });
    expect((await get('requester', '/dashboard/kpis')).json().activeProcurements).toBe(4);
    expect((await get('procurement', '/dashboard/kpis')).json().activeProcurements).toBe(5);
    await database.db.delete(s.request).where(eq(s.request.number, 'PR-2026-0099'));
  });

  it('pending actions reflect the role: delegate sees plans awaiting approval, chair sees evaluations in progress', async () => {
    expect((await get('delegate', '/dashboard/kpis')).json().pendingMyAction).toBe(1);
    expect((await get('chair', '/dashboard/kpis')).json().pendingMyAction).toBe(1);
    // legal has the seeded contract in legal review; finance has nothing to act on
    expect((await get('legal', '/dashboard/kpis')).json().pendingMyAction).toBe(1);
    expect((await get('finance', '/dashboard/kpis')).json().pendingMyAction).toBe(0);
  });

  it('suppliers cannot read portfolio KPIs (403) and anonymous gets 401', async () => {
    expect((await get('supplier', '/dashboard/kpis')).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/dashboard/kpis' })).statusCode).toBe(401);
  });
});

describe('notifications', () => {
  it("returns only the caller's notifications, newest first", async () => {
    const r = await get('delegate', '/notifications');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveLength(1);
    expect(r.json()[0]).toMatchObject({ title: 'Plan awaiting your approval', read: false });
    expect((await get('finance', '/notifications')).json()).toEqual([]);
  });

  it('marks one read; another user\'s notification looks like "not found" (no existence leak)', async () => {
    const [mine] = (await get('chair', '/notifications')).json();
    const sess = await session('chair');
    const ok = await app.inject({
      method: 'POST',
      url: `/api/v1/notifications/${mine.id}/read`,
      cookies: sess.cookies,
      headers: { 'x-csrf-token': sess.csrf },
    });
    expect(ok.statusCode).toBe(204);
    expect((await get('chair', '/notifications')).json()[0].read).toBe(true);

    const other = await session('legal');
    const stolen = await app.inject({
      method: 'POST',
      url: `/api/v1/notifications/${mine.id}/read`,
      cookies: other.cookies,
      headers: { 'x-csrf-token': other.csrf },
    });
    expect(stolen.statusCode).toBe(404);
    const row = await database.db
      .select()
      .from(s.notification)
      .where(eq(s.notification.userId, uid('user:legal')));
    expect(row.every((n) => n.read === false)).toBe(true);
  });

  it('rejects a malformed id', async () => {
    const sess = await session('legal');
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/not-a-uuid/read',
      cookies: sess.cookies,
      headers: { 'x-csrf-token': sess.csrf },
    });
    expect(r.statusCode).toBe(400);
  });
});
