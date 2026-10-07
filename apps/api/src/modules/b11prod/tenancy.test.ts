/**
 * NFR-SC01: multiple tenants with per-tenant request throttling and usage plans.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash as argon2Hash } from '@node-rs/argon2';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, type ManualClock } from '@if/shared';
import { buildApp } from '../../app.js';
import { withSystem, type Database } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { emailFor, seedDatabase, TENANT_ID } from '../../db/seed.js';
import { freshDb, newClock } from '../../test-helpers.js';
import { createEnv, PASSWORD, type Json } from '../contract/test-env.js';

const TOKEN = 'operator-token-for-tests-0123456789';
let app: FastifyInstance;
let database: Database;
let clock: ManualClock;

interface Sess {
  cookies: Record<string, string>;
  csrf: string;
}
async function login(email: string, tenant?: string, password = PASSWORD) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password, ...(tenant ? { tenant } : {}) },
  });
}
async function session(email: string, tenant?: string, password = PASSWORD): Promise<Sess> {
  const r = await login(email, tenant, password);
  expect(r.statusCode, r.body).toBe(200);
  return { cookies: Object.fromEntries(r.cookies.map((c) => [c.name, c.value])), csrf: r.json().csrfToken };
}
const api = (who: Sess, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    cookies: who.cookies,
    headers: method === 'GET' ? {} : { 'x-csrf-token': who.csrf },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
const op = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, token: string | null = TOKEN) =>
  app.inject({
    method,
    url: `/api/v1/operator${url}`,
    headers: token === null ? {} : { 'x-operator-token': token },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

let tenantB: { id: string; slug: string; adminEmail: string; password: string };
let aAdmin: Sess;
let bAdmin: Sess;
let aRequester: Sess;

beforeAll(async () => {
  database = await freshDb();
  clock = newClock();
  await seedDatabase(database, { clock, password: PASSWORD });
  const dir = await mkdtemp(join(tmpdir(), 'if-tenancy-'));
  app = await buildApp(
    loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 't'.repeat(40), STORAGE_DIR: dir, OPERATOR_TOKEN: TOKEN }),
    { database, clock, loginRateLimitMax: 100_000 },
  );
  aAdmin = await session(emailFor('admin'));
  aRequester = await session(emailFor('requester'));
}, 120_000);

const usageOf = async (who: Sess) => {
  const r = await api(who, 'GET', '/usage');
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Json;
};

describe('NFR-SC01 the operator interface is token-authenticated and off unless configured', () => {
  it('does not exist (404) when OPERATOR_TOKEN is not set', async () => {
    const plain = await createEnv();
    for (const [m, u] of [
      ['GET', '/api/v1/operator/tenants'],
      ['POST', '/api/v1/operator/tenants'],
      ['PATCH', '/api/v1/operator/tenants/3f2b8c1e-0000-4000-8000-000000000001/plan'],
    ] as const) {
      const r = await plain.app.inject({
        method: m,
        url: u,
        headers: { 'x-operator-token': TOKEN },
        payload: {},
      });
      expect(r.statusCode, `${m} ${u}`).toBe(404);
    }
  });
  it('the token must be at least 24 characters', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 't'.repeat(40), OPERATOR_TOKEN: 'too-short' }),
    ).toThrow(ConfigError);
    expect(loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 't'.repeat(40) }).OPERATOR_TOKEN).toBeUndefined();
  });
  it('refuses a missing, wrong, shorter or longer token with 401, and a session is not a substitute', async () => {
    expect((await op('GET', '/tenants', undefined, null)).statusCode).toBe(401);
    expect((await op('GET', '/tenants', undefined, 'x'.repeat(24))).statusCode).toBe(401);
    expect((await op('GET', '/tenants', undefined, 'short')).statusCode).toBe(401);
    expect((await op('GET', '/tenants', undefined, `${TOKEN}extra`)).statusCode).toBe(401);
    expect((await op('GET', '/tenants', undefined, TOKEN.toUpperCase())).statusCode).toBe(401);
    expect((await op('GET', '/tenants')).statusCode).toBe(200);
    const withAdminSession = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/tenants',
      cookies: aAdmin.cookies,
    });
    expect(withAdminSession.statusCode).toBe(401);
    expect((await op('GET', '/tenants', undefined, null)).json().code).toBe('OPERATOR_TOKEN_INVALID');
  });
});

describe('NFR-SC01 creating a tenant through the operator API', () => {
  it('creates the organisation, its first administrator with a one-time password shown once, and a usage plan', async () => {
    const bad = await op('POST', '/tenants', {
      slug: 'Bad Slug',
      name: 'x',
      adminName: 'A',
      adminEmail: 'nope',
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (
        await op('POST', '/tenants', {
          slug: 'beta-corp',
          name: 'Beta Corp',
          adminName: 'Bea Admin',
          adminEmail: 'bea@beta.example',
          planKey: 'NOPE',
        })
      ).json().code,
    ).toBe('UNKNOWN_PLAN');
    const r = await op('POST', '/tenants', {
      slug: 'beta-corp',
      name: 'Beta Corporation',
      sector: 'PRIVATE',
      adminName: 'Bea Admin',
      adminEmail: emailFor('admin'), // the same address as tenant A's administrator: addresses are per organisation
    });
    expect(r.statusCode, r.body).toBe(201);
    const j = r.json() as Json;
    expect(j.tenant).toMatchObject({ slug: 'beta-corp', name: 'Beta Corporation', planKey: 'STANDARD' });
    expect(j.oneTimePassword).toMatch(/^[\w-]{20}$/);
    expect(j.login).toEqual({ tenant: 'beta-corp', email: emailFor('admin') });
    tenantB = {
      id: j.tenant.id,
      slug: 'beta-corp',
      adminEmail: emailFor('admin'),
      password: j.oneTimePassword,
    };
    // only a hash is kept
    const [u] = await withSystem(database, (tx) =>
      tx
        .select()
        .from(s.appUser)
        .where(and(eq(s.appUser.tenantId, tenantB.id))),
    );
    expect(u!.passwordHash).not.toContain(tenantB.password);
    expect(u!.passwordHash.startsWith('$argon2')).toBe(true);
    const roles = await withSystem(database, (tx) =>
      tx.select().from(s.roleAssignment).where(eq(s.roleAssignment.tenantId, tenantB.id)),
    );
    expect(roles.map((x) => x.role)).toEqual(['ADMIN']);
    const conns = await withSystem(database, (tx) =>
      tx.select().from(s.connector).where(eq(s.connector.tenantId, tenantB.id)),
    );
    expect(conns.length).toBeGreaterThan(5);
    const audit = await withSystem(database, (tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.tenantId, tenantB.id)),
    );
    expect(audit.map((a) => a.action)).toContain('tenant.create');
    expect(JSON.stringify(audit)).not.toContain(tenantB.password);
    // a second tenant with the same short name is refused
    expect(
      (
        await op('POST', '/tenants', {
          slug: 'beta-corp',
          name: 'Another',
          adminName: 'Cy',
          adminEmail: 'cy@x.example',
        })
      ).json().code,
    ).toBe('TENANT_EXISTS');
    expect(
      (
        await op('POST', '/tenants', {
          slug: 'meridian-demo',
          name: 'Clash',
          adminName: 'Cy',
          adminEmail: 'cy@x.example',
        })
      ).statusCode,
    ).toBe(409);
  });

  it('lists tenants with their plan, users and use today', async () => {
    const r = await op('GET', '/tenants');
    expect(r.statusCode).toBe(200);
    const j = r.json() as Json;
    const a = j.tenants.find((t: Json) => t.slug === 'meridian-demo');
    const b = j.tenants.find((t: Json) => t.slug === 'beta-corp');
    expect(a).toMatchObject({ planKey: 'ENTERPRISE', planAssigned: false });
    expect(b).toMatchObject({ planKey: 'STANDARD', planAssigned: true, activeUsers: 1 });
    expect(a.activeUsers).toBeGreaterThan(5);
    expect(j.plans.map((p: Json) => p.key)).toEqual(['STARTER', 'STANDARD', 'ENTERPRISE']);
    expect(j.plans[0]).toMatchObject({ requestsPerMinute: 120, burst: 60, tenantId: null });
  });

  it('seeds exactly three platform plans and does not seed a second tenant by default', async () => {
    const plans = await withSystem(database, (tx) => tx.select().from(s.usagePlan));
    expect(plans.map((p) => p.key).sort()).toEqual(['ENTERPRISE', 'STANDARD', 'STARTER']);
    const fresh = await createEnv();
    const tenants = await fresh.withSystem(fresh.database, (tx) => tx.select().from(s.tenant));
    expect(tenants).toHaveLength(1);
  });
});

describe('NFR-SC01 signing in to a second tenant', () => {
  it('signs in with a tenant short name; the default tenant still works without one', async () => {
    const b = await login(tenantB.adminEmail, 'beta-corp', tenantB.password);
    expect(b.statusCode, b.body).toBe(200);
    expect(b.json().user).toMatchObject({ name: 'Bea Admin', role: 'ADMIN' });
    // the same address, no tenant named: the default organisation first, so existing clients are unaffected
    const a = await login(emailFor('admin'));
    expect(a.statusCode).toBe(200);
    expect(a.json().user.name).toBe('Noah Kim');
    // and the default tenant can be named
    expect((await login(emailFor('admin'), 'meridian-demo')).json().user.name).toBe('Noah Kim');
    bAdmin = {
      cookies: Object.fromEntries(b.cookies.map((c) => [c.name, c.value])),
      csrf: b.json().csrfToken,
    };
  });
  it('refuses the wrong tenant, an unknown tenant and the other tenant password, all with the same answer', async () => {
    const wrongTenant = await login(emailFor('admin'), 'beta-corp'); // tenant A's password in tenant B
    const unknown = await login(emailFor('admin'), 'nowhere-ltd');
    const swapped = await login(emailFor('requester'), 'beta-corp'); // a tenant A person has no account in B
    for (const r of [wrongTenant, unknown, swapped]) {
      expect(r.statusCode).toBe(401);
      expect(r.json().code).toBe('INVALID_CREDENTIALS');
    }
    expect(wrongTenant.json().title).toBe(unknown.json().title);
    expect((await login(tenantB.adminEmail, 'beta-corp', 'definitely-not-the-password')).statusCode).toBe(
      401,
    );
  });
  it('an optional tenant field does not break the older request shape, and an empty one is refused', async () => {
    expect((await login(emailFor('finance'))).statusCode).toBe(200);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: emailFor('finance'), password: PASSWORD, tenant: '' },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('NFR-SC01 one tenant cannot read another tenant data', () => {
  it('a user of tenant B cannot list, open or change tenant A requests, plans, contracts or suppliers', async () => {
    const created = await api(aRequester, 'POST', '/requests', {
      title: 'Tenant A private request',
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: 40_000,
      termMonths: 12,
      businessUnit: 'Facilities',
      fields: { contractOwner: 'Sofia Rossi' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const reqId = created.json().id as string;
    // a procurement officer in tenant B (the tenant has only an administrator until someone adds people)
    const hash = await argon2Hash(PASSWORD);
    const bProc = await withSystem(database, async (tx) => {
      const [u] = await tx
        .insert(s.appUser)
        .values({
          tenantId: tenantB.id,
          email: 'pat@beta.example',
          name: 'Pat Procurement',
          passwordHash: hash,
        })
        .returning();
      await tx.insert(s.roleAssignment).values({ tenantId: tenantB.id, userId: u!.id, role: 'PROCUREMENT' });
      return u!;
    });
    const b = await session(bProc.email, 'beta-corp');
    const mine = await api(b, 'POST', '/requests', { title: 'Tenant B request', estimatedValue: 1000 });
    expect(mine.statusCode, mine.body).toBe(201);
    const list = (await api(b, 'GET', '/requests')).json() as Json;
    const titles = (list.items ?? list).map((x: Json) => x.title);
    expect(titles).toContain('Tenant B request');
    expect(titles).not.toContain('Tenant A private request');
    expect((await api(b, 'GET', `/requests/${reqId}`)).statusCode).toBe(404);
    expect((await api(b, 'PATCH', `/requests/${reqId}`, { businessUnit: 'Hijacked' })).statusCode).toBe(404);
    expect((await api(b, 'GET', `/requests/${reqId}/plan`)).statusCode).toBe(404);
    expect((await api(b, 'GET', `/requests/${reqId}/content-hints`)).statusCode).toBe(404);
    // the same checks the other way round
    const aList = (await api(aRequester, 'GET', '/requests')).json() as Json;
    expect((aList.items ?? aList).map((x: Json) => x.title)).not.toContain('Tenant B request');
    // contracts and suppliers
    const [c] = await withSystem(database, (tx) =>
      tx.select().from(s.contract).where(eq(s.contract.tenantId, TENANT_ID)).limit(1),
    );
    expect(c).toBeTruthy();
    expect((await api(b, 'GET', `/contracts/${c!.id}`)).statusCode).toBe(404);
    const contracts = (await api(b, 'GET', '/contracts')).json() as Json;
    expect((contracts.items ?? contracts).length).toBe(0);
    const suppliers = await api(b, 'GET', '/suppliers');
    expect(suppliers.statusCode).toBe(200);
    expect(JSON.stringify(suppliers.json())).not.toContain('Brightwave');
    // the usage view is each tenant's own
    expect((await usageOf(bAdmin)).plan.key).toBe('STANDARD');
    expect((await usageOf(aAdmin)).plan.key).toBe('ENTERPRISE');
  });
});

describe('NFR-SC01 per-tenant throttling: one tenant being throttled does not touch another', () => {
  it('moves tenant A to STARTER (burst 60) and refuses its 61st request with 429, Retry-After and a problem naming the plan; tenant B carries on', async () => {
    const [a] = await withSystem(database, (tx) =>
      tx.select().from(s.tenant).where(eq(s.tenant.id, TENANT_ID)),
    );
    const patched = await op('PATCH', `/tenants/${a!.id}/plan`, { planKey: 'STARTER' });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().plan).toMatchObject({ key: 'STARTER', requestsPerMinute: 120, burst: 60 });
    const finance = await session(emailFor('finance'));
    let ok = 0;
    let first429: Awaited<ReturnType<typeof api>> | null = null;
    for (let i = 0; i < 70; i += 1) {
      const r = await api(finance, 'GET', '/auth/me');
      if (r.statusCode === 200) ok += 1;
      else {
        first429 ??= r;
        expect(r.statusCode).toBe(429);
      }
    }
    // the plan change gave a fresh bucket of 60; sign-in is not counted, so exactly 60 get through
    expect(ok).toBe(60);
    expect(first429).not.toBeNull();
    const body = first429!.json() as Json;
    expect(first429!.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(first429!.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    expect(body).toMatchObject({
      status: 429,
      code: 'TENANT_THROTTLED',
      limit: 'REQUESTS_PER_MINUTE',
      limitValue: 120,
      plan: { key: 'STARTER', name: 'Starter', requestsPerMinute: 120, burst: 60 },
      retryAfterSeconds: Number(first429!.headers['retry-after']),
    });
    expect(body.detail).toMatch(/Starter plan allows 120 requests a minute with a burst of 60/);
    expect(body.correlationId).toBeTruthy();

    // tenant B, at the same moment, is unaffected
    for (let i = 0; i < 40; i += 1) expect((await api(bAdmin, 'GET', '/auth/me')).statusCode).toBe(200);
    // and A's other people are throttled too (it is the tenant's allowance, not the person's)
    expect((await api(aAdmin, 'GET', '/auth/me')).statusCode).toBe(429);

    // health and sign-in are not counted against the tenant bucket
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/health', cookies: finance.cookies })).statusCode,
    ).toBe(200);
    expect((await login(emailFor('legal'))).statusCode).toBe(200);
  });

  it('the bucket refills with the injected clock, a little at a time', async () => {
    const finance = await session(emailFor('finance'));
    expect((await api(finance, 'GET', '/auth/me')).statusCode).toBe(429);
    clock.advanceMs(1_000); // 120 a minute = 2 a second
    expect((await api(finance, 'GET', '/auth/me')).statusCode).toBe(200);
    expect((await api(finance, 'GET', '/auth/me')).statusCode).toBe(200);
    const again = await api(finance, 'GET', '/auth/me');
    expect(again.statusCode).toBe(429);
    expect(again.headers['retry-after']).toBe('1');
    clock.advanceMs(35_000); // 70 tokens would be earned, but the bucket holds at the burst of 60
    let ok = 0;
    for (let i = 0; i < 70; i += 1) if ((await api(finance, 'GET', '/auth/me')).statusCode === 200) ok += 1;
    expect(ok).toBe(60);
  });

  it('counts the requests and the refusals per tenant and per day, and an administrator reads their own', async () => {
    clock.advanceMs(5_000); // tenant A's bucket is empty after the last test
    const a = await usageOf(aAdmin);
    expect(a.plan).toMatchObject({
      key: 'STARTER',
      requestsPerMinute: 120,
      burst: 60,
      dailyRequests: 20_000,
    });
    expect(a.today.day).toBe(clock.now().toISOString().slice(0, 10));
    expect(a.today.throttled).toBeGreaterThan(10);
    expect(a.today.requests).toBeGreaterThan(100);
    expect(a.bucket.capacity).toBe(60);
    expect(a.plans.find((p: Json) => p.current).key).toBe('STARTER');
    expect(a.users.active).toBeGreaterThan(5);
    expect(a.storage).toMatchObject({ estimate: true, limitMb: 1024 });
    const b = await usageOf(bAdmin);
    expect(b.today.throttled).toBe(0);
    expect(b.plan.key).toBe('STANDARD');
    expect(b.today.requests).toBeGreaterThanOrEqual(40);
    expect(b.today.requests).toBeLessThan(a.today.requests);
    // written to the usage_counter table, one row per tenant per day
    const rows = await withSystem(database, (tx) => tx.select().from(s.usageCounter));
    const ra = rows.find((r) => r.tenantId === TENANT_ID)!;
    const rb = rows.find((r) => r.tenantId === tenantB.id)!;
    expect(ra.throttled).toBe(a.today.throttled);
    expect(rb.requests).toBeGreaterThanOrEqual(40);
    // not for anyone but an administrator
    for (const who of ['requester', 'procurement', 'exec']) {
      // A is throttled right now, so move the bucket on before asking
      clock.advanceMs(2_000);
      const sess = await session(emailFor(who));
      expect((await api(sess, 'GET', '/usage')).statusCode, who).toBe(403);
    }
    expect((await app.inject({ method: 'GET', url: '/api/v1/usage' })).statusCode).toBe(401);
  });

  it('a request that is not signed in is not counted against any tenant', async () => {
    const before = (await usageOf(bAdmin)).today.requests;
    for (let i = 0; i < 5; i += 1) await app.inject({ method: 'GET', url: '/api/v1/health' });
    for (let i = 0; i < 5; i += 1) await app.inject({ method: 'GET', url: '/api/v1/auth/me' }); // 401, no session
    expect((await usageOf(bAdmin)).today.requests).toBe(before + 1); // only the usage read itself
  });
});

describe('NFR-SC01 usage plans are assigned by the operator and take effect at once', () => {
  it('moves tenant A back to ENTERPRISE and the bucket is full again; audits the change; refuses an unknown plan or another tenant plan', async () => {
    const a = await withSystem(database, (tx) =>
      tx.select().from(s.tenant).where(eq(s.tenant.id, TENANT_ID)),
    );
    expect((await op('PATCH', `/tenants/${a[0]!.id}/plan`, { planKey: 'NOPE' })).json().code).toBe(
      'UNKNOWN_PLAN',
    );
    expect(
      (await op('PATCH', '/tenants/3f2b8c1e-0000-4000-8000-000000000001/plan', { planKey: 'STARTER' }))
        .statusCode,
    ).toBe(404);
    expect((await op('PATCH', `/tenants/${a[0]!.id}/plan`, {})).statusCode).toBe(400);
    // a plan made for tenant B only is not available to A
    await withSystem(database, (tx) =>
      tx.insert(s.usagePlan).values({
        key: 'BETA_SPECIAL',
        tenantId: tenantB.id,
        name: 'Beta special',
        requestsPerMinute: 6000,
        burst: 6000,
        dailyRequests: 30,
        monthlyAiCalls: 2,
        storageMb: 100,
        maxUsers: 10,
      }),
    );
    expect((await op('PATCH', `/tenants/${a[0]!.id}/plan`, { planKey: 'BETA_SPECIAL' })).json().code).toBe(
      'UNKNOWN_PLAN',
    );
    const up = await op('PATCH', `/tenants/${a[0]!.id}/plan`, { planKey: 'ENTERPRISE' });
    expect(up.statusCode).toBe(200);
    const finance = await session(emailFor('finance'));
    for (let i = 0; i < 100; i += 1) expect((await api(finance, 'GET', '/auth/me')).statusCode).toBe(200);
    const audit = await withSystem(database, (tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'tenant.plan_change')),
    );
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit.find((e) => (e.after as Json).plan === 'STARTER')!.before).toMatchObject({ plan: null });
  });

  it('a daily allowance: after it is used the tenant gets 429 until midnight, with the plan named; another tenant is untouched', async () => {
    const used = (await usageOf(bAdmin)).today.requests as number; // on STANDARD; this read counts
    await withSystem(database, (tx) =>
      tx
        .update(s.usagePlan)
        .set({ dailyRequests: used + 5 })
        .where(eq(s.usagePlan.key, 'BETA_SPECIAL')),
    );
    const r = await op('PATCH', `/tenants/${tenantB.id}/plan`, { planKey: 'BETA_SPECIAL' });
    expect(r.statusCode, r.body).toBe(200);
    let refused: Awaited<ReturnType<typeof api>> | null = null;
    let allowed = 0;
    for (let i = 0; i < 30 && !refused; i += 1) {
      const x = await api(bAdmin, 'GET', '/auth/me');
      if (x.statusCode === 429) refused = x;
      else allowed += 1;
    }
    expect(allowed).toBe(5);
    expect(refused).not.toBeNull();
    expect(refused!.json()).toMatchObject({
      code: 'TENANT_THROTTLED',
      limit: 'DAILY_REQUESTS',
      limitValue: used + 5,
      plan: { key: 'BETA_SPECIAL' },
    });
    expect(refused!.json().detail).toMatch(/requests a day/);
    const now = clock.now();
    const secondsToMidnight =
      86_400 - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds());
    expect(Number(refused!.headers['retry-after'])).toBe(secondsToMidnight);
    // tenant A is unaffected by B running out of its day
    expect((await api(aAdmin, 'GET', '/auth/me')).statusCode).toBe(200);
    // the next day it starts again
    clock.advanceDays(1);
    const next = await session(tenantB.adminEmail, 'beta-corp', tenantB.password);
    expect((await api(next, 'GET', '/auth/me')).statusCode).toBe(200);
    bAdmin = next;
  });

  it('a monthly allowance of AI calls: assistant calls are refused when it is used up, other calls are not', async () => {
    const hash = await argon2Hash(PASSWORD);
    await withSystem(database, async (tx) => {
      const [u] = await tx
        .insert(s.appUser)
        .values({
          tenantId: tenantB.id,
          email: 'rae@beta.example',
          name: 'Rae Requester',
          passwordHash: hash,
        })
        .returning();
      await tx.insert(s.roleAssignment).values({ tenantId: tenantB.id, userId: u!.id, role: 'REQUESTER' });
    });
    await withSystem(database, (tx) =>
      tx.update(s.usagePlan).set({ dailyRequests: 100_000 }).where(eq(s.usagePlan.key, 'BETA_SPECIAL')),
    );
    await op('PATCH', `/tenants/${tenantB.id}/plan`, { planKey: 'BETA_SPECIAL' }); // reload the plan (2 AI calls a month)
    const rae = await session('rae@beta.example', 'beta-corp');
    const codes: number[] = [];
    for (let i = 0; i < 4; i += 1)
      codes.push((await api(rae, 'POST', '/assistant/conversations', { purpose: 'INTAKE' })).statusCode);
    expect(codes).toEqual([201, 201, 429, 429]);
    const refused = await api(rae, 'POST', '/assistant/conversations', { purpose: 'INTAKE' });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({
      code: 'TENANT_THROTTLED',
      limit: 'MONTHLY_AI_CALLS',
      limitValue: 2,
    });
    expect(refused.json().detail).toMatch(/2 AI calls a month/);
    expect((await api(rae, 'GET', '/auth/me')).statusCode).toBe(200); // everything else carries on
    const u = await usageOf(bAdmin);
    expect(u.month.aiCalls).toBe(2);
    expect(u.month.aiCallsRemaining).toBe(0);
  });
});
