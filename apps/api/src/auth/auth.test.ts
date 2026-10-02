import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type ManualClock } from '@if/shared';
import { buildApp } from '../app.js';
import type { Database } from '../db/client.js';
import * as s from '../db/schema.js';
import { emailFor, seedDatabase, TENANT_ID, uid } from '../db/seed.js';
import { freshDb, newClock } from '../test-helpers.js';
import { IDLE_TIMEOUT_MS } from './session-service.js';

const PASSWORD = 'unit-test-password-123';
const config = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's'.repeat(40), API_PORT: '0' });

let database: Database;
let clock: ManualClock;
let app: FastifyInstance;

beforeAll(async () => {
  database = await freshDb();
  clock = newClock();
  await seedDatabase(database, { clock, password: PASSWORD });
  app = await buildApp(config, { database, clock, loginRateLimitMax: 1000 });
});

const login = (email: string, password = PASSWORD) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
const cookieOf = (res: Awaited<ReturnType<typeof login>>, name = 'if_session') =>
  res.cookies.find((c) => c.name === name);
const auditActions = async () =>
  (await database.db.select().from(s.auditEvent).orderBy(s.auditEvent.seq)).map((e) => e.action);

describe('login', () => {
  it('succeeds, sets an HttpOnly SameSite session cookie, and returns the user, home path and CSRF token', async () => {
    const res = await login(emailFor('delegate'));
    expect(res.statusCode).toBe(200);
    const c = cookieOf(res)!;
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(c.value).toMatch(/^[0-9a-f-]{36}\.[\w-]+$/);
    const body = res.json();
    expect(body.user).toMatchObject({
      role: 'DELEGATE',
      homePath: '/app/approvals',
      email: emailFor('delegate'),
    });
    expect(body.csrfToken).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/password|hash/i);
  });

  it('normalises the email (case / whitespace)', async () => {
    expect((await login(`  ${emailFor('legal').toUpperCase()} `)).statusCode).toBe(200);
  });

  it('unknown account, wrong password: identical status and message (no account enumeration)', async () => {
    const unknown = await login('nobody@meridian-demo.example');
    const wrong = await login(emailFor('finance'), 'wrong-password-123');
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    const strip = (r: typeof unknown) => ({ ...r.json(), correlationId: undefined });
    expect(strip(unknown)).toEqual(strip(wrong));
    expect(unknown.json().code).toBe('INVALID_CREDENTIALS');
    expect(cookieOf(wrong)).toBeUndefined();
  });

  it('validates input and does not echo values back', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'not-an-email', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_FAILED');
    expect(
      res
        .json()
        .errors.map((e: { field: string }) => e.field)
        .sort(),
    ).toEqual(['email', 'password']);
    expect(res.body).not.toContain('not-an-email');
  });

  it('writes audit events for success and failure, and never the password', async () => {
    await login(emailFor('contract-mgr'), 'definitely-wrong-1');
    await login(emailFor('contract-mgr'));
    const rows = await database.db.select().from(s.auditEvent);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('auth.login');
    expect(actions).toContain('auth.login_failed');
    expect(JSON.stringify(rows)).not.toContain('definitely-wrong-1');
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);
  });
});

describe('lockout', () => {
  it('locks after 5 failures; correct password then still fails; unlocks after 15 minutes; audited', async () => {
    const email = emailFor('requester');
    for (let i = 0; i < 5; i++) expect((await login(email, 'wrong-password-123')).statusCode).toBe(401);
    expect(await auditActions()).toContain('auth.account_locked');
    const locked = await login(email); // correct password, but locked
    expect(locked.statusCode).toBe(401);
    expect(locked.json().code).toBe('INVALID_CREDENTIALS');
    clock.advanceMs(14 * 60_000);
    expect((await login(email)).statusCode).toBe(401);
    clock.advanceMs(2 * 60_000);
    expect((await login(email)).statusCode).toBe(200);
  });

  it('a successful login resets the failure counter', async () => {
    const email = emailFor('exec');
    for (let i = 0; i < 4; i++) await login(email, 'wrong-password-123');
    expect((await login(email)).statusCode).toBe(200);
    for (let i = 0; i < 4; i++) await login(email, 'wrong-password-123');
    expect((await login(email)).statusCode).toBe(200); // would be locked if the counter had not reset
  });
});

describe('session', () => {
  const session = async (key: string) => {
    const res = await login(emailFor(key));
    return { cookie: cookieOf(res)!.value, csrf: res.json().csrfToken as string, name: cookieOf(res)!.name };
  };
  const me = (cookie: string, name = 'if_session') =>
    app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { [name]: cookie } });

  it('GET /auth/me returns the signed-in user; anonymous gets 401', async () => {
    const { cookie } = await session('probity');
    const res = await me(cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ role: 'PROBITY', homePath: '/app/audit' });
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
  });

  it('a tampered or forged cookie is rejected', async () => {
    const { cookie } = await session('probity');
    expect((await me(cookie.slice(0, -2) + 'xx')).statusCode).toBe(401);
    expect((await me(`${crypto.randomUUID()}.${cookie.split('.')[1]}`)).statusCode).toBe(401);
    expect((await me('garbage')).statusCode).toBe(401);
  });

  it('idle timeout: 30 minutes without activity ends the session (SESSION_EXPIRED)', async () => {
    const { cookie } = await session('finance');
    clock.advanceMs(IDLE_TIMEOUT_MS - 60_000);
    expect((await me(cookie)).statusCode).toBe(200); // activity resets the idle timer
    clock.advanceMs(IDLE_TIMEOUT_MS - 60_000);
    expect((await me(cookie)).statusCode).toBe(200);
    clock.advanceMs(IDLE_TIMEOUT_MS + 60_000);
    const res = await me(cookie);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('SESSION_EXPIRED');
  });

  it('absolute timeout: 8 hours ends the session even with continuous activity', async () => {
    const { cookie } = await session('legal');
    for (let i = 0; i < 16; i++) {
      clock.advanceMs(29 * 60_000);
      expect((await me(cookie)).statusCode).toBe(200);
    }
    clock.advanceMs(29 * 60_000); // total now > 8h
    expect((await me(cookie)).json().code).toBe('SESSION_EXPIRED');
  });

  it('logout revokes the session server-side (the old cookie stops working) and clears the cookie', async () => {
    const { cookie, csrf } = await session('chair');
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: { if_session: cookie },
      headers: { 'x-csrf-token': csrf },
    });
    expect(out.statusCode).toBe(204);
    expect((await me(cookie)).statusCode).toBe(401);
    expect(await auditActions()).toContain('auth.logout');
  });

  it('supplier users get a separate cookie and it only works as a supplier session (separate identity pools)', async () => {
    const res = await login(emailFor('supplier'));
    expect(cookieOf(res, 'if_session')).toBeUndefined();
    const sc = cookieOf(res, 'if_supplier_session')!;
    expect(sc).toBeDefined();
    expect((await me(sc.value, 'if_supplier_session')).statusCode).toBe(200);
    expect((await me(sc.value, 'if_session')).statusCode).toBe(401); // presented as a staff session: refused
    expect(res.json().user.homePath).toBe('/supplier');
  });

  it('a session row is stored server-side with the pool and expiry', async () => {
    const rows = await database.db
      .select()
      .from(s.session)
      .where(eq(s.session.userId, uid('user:supplier')));
    expect(rows[0]).toMatchObject({ pool: 'SUPPLIER', tenantId: TENANT_ID });
  });
});

describe('CSRF', () => {
  it('mutations without the CSRF token are refused and audited; with the token they succeed', async () => {
    const res = await login(emailFor('admin'));
    const cookies = { if_session: cookieOf(res)!.value };
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', cookies });
    expect(bad.statusCode).toBe(403);
    expect(bad.json().code).toBe('CSRF_INVALID');
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies,
      headers: { 'x-csrf-token': 'x'.repeat(43) },
    });
    expect(wrong.statusCode).toBe(403);
    const rows = await database.db
      .select()
      .from(s.auditEvent)
      .where(eq(s.auditEvent.action, 'access.denied'));
    expect(rows.some((r) => JSON.stringify(r.after).includes('CSRF'))).toBe(true);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies,
      headers: { 'x-csrf-token': res.json().csrfToken },
    });
    expect(ok.statusCode).toBe(204);
  });
  it("one session's CSRF token does not work for another session", async () => {
    const a = await login(emailFor('probity'));
    const b = await login(emailFor('finance'));
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: { if_session: cookieOf(a)!.value },
      headers: { 'x-csrf-token': b.json().csrfToken },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('forgot password', () => {
  it('returns the same 202 for existing and non-existing accounts', async () => {
    const real = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: emailFor('legal') },
    });
    const fake = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'ghost@meridian-demo.example' },
    });
    expect([real.statusCode, fake.statusCode]).toEqual([202, 202]);
    expect(real.json()).toEqual(fake.json());
  });
});

describe('access-denied report from the web guard', () => {
  it('is audited as DENIED with the path', async () => {
    const res = await login(emailFor('requester-2').replace('requester-2', 'finance'));
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/access-denied',
      cookies: { if_session: cookieOf(res)!.value },
      headers: { 'x-csrf-token': res.json().csrfToken },
      payload: { path: '/admin' },
    });
    const rows = await database.db
      .select()
      .from(s.auditEvent)
      .where(eq(s.auditEvent.entityType, 'web_route'));
    expect(rows[0]).toMatchObject({ action: 'access.denied', result: 'DENIED' });
    expect(rows[0]!.after).toEqual({ path: '/admin' });
  });
});

describe('security headers and caching', () => {
  it('API responses are never cached and set standard security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('rate limiting', () => {
  it('login is limited per client (default: 10 attempts / 15 min) with a problem+json 429', async () => {
    const limited = await buildApp(config, { database, clock });
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (
        await limited.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 'nobody@meridian-demo.example', password: 'wrong-password-123' },
        })
      ).statusCode;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});
