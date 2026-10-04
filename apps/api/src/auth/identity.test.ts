import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as s from '../db/schema.js';
import { emailFor, uid } from '../db/seed.js';
import { createEnv, PASSWORD, SEED_DATE, type Json } from '../modules/contract/test-env.js';
import { DEFAULTS } from '../modules/settings/settings.js';
import { signIdToken } from './security-routes.js';
import {
  base32Decode,
  base32Encode,
  codeAt,
  newSecret,
  openSecret,
  sealSecret,
  stepOf,
  verifyTotp,
} from './totp.js';

// RFC 6238 appendix B, SHA-1: the secret is the ASCII string "12345678901234567890"
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('authenticator-app codes (RFC 6238)', () => {
  it('matches the published test vectors', () => {
    const at = (t: number) => codeAt(RFC_SECRET, Math.floor(t / 30));
    expect(at(59)).toBe('287082'); // 94287082, last six digits
    expect(at(1111111109)).toBe('081804');
    expect(at(1234567890)).toBe('005924');
    expect(at(2000000000)).toBe('279037');
  });

  it('base32 round-trips, and a secret is sealed so a copy of the database cannot make codes', () => {
    const bytes = Buffer.from('hello authenticator');
    expect(base32Decode(base32Encode(bytes)).toString()).toBe('hello authenticator');
    const secret = newSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const sealed = sealSecret(secret, 'server-secret-one');
    expect(sealed).not.toContain(secret);
    expect(openSecret(sealed, 'server-secret-one')).toBe(secret);
    expect(() => openSecret(sealed, 'a-different-server-secret')).toThrow();
  });

  it('accepts one step either side, refuses anything older, and never accepts a code twice', () => {
    const now = new Date('2026-10-02T09:00:10Z');
    const step = stepOf(now);
    expect(verifyTotp(RFC_SECRET, codeAt(RFC_SECRET, step), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, codeAt(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, codeAt(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, codeAt(RFC_SECRET, step - 2), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, codeAt(RFC_SECRET, step), now, step)).toBeNull(); // already used
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
  });
});

let env: Awaited<ReturnType<typeof createEnv>>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);
const sys = <T>(fn: Parameters<typeof env.withSystem>[1]) => env.withSystem(env.database, fn) as Promise<T>;
// each test starts with nobody enrolled, so a person used in one test can still sign in with a password in the next
afterEach(async () => {
  await sys((tx) => tx.delete(s.userMfa));
});
const security = async (patch: Partial<typeof DEFAULTS.security>) => {
  const r = await env.call('admin', 'PUT', '/admin/settings', {
    security: { ...DEFAULTS.security, ...patch },
  });
  expect(r.statusCode, r.body).toBe(200);
};
const login = (key: string, password = PASSWORD) =>
  env.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: emailFor(key), password } });
const loginAs = (email: string) =>
  env.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PASSWORD } });
const cookiesOf = (r: Awaited<ReturnType<typeof login>>) =>
  Object.fromEntries(r.cookies.map((c) => [c.name, c.value]));
const nowCode = (secret: string, offset = 0) => codeAt(secret, stepOf(env.clock.now()) + offset);

describe('authenticator app (SEC-A01)', () => {
  it('a person enrols, and from then on a password alone does not open a session', async () => {
    const first = await login('finance');
    const csrf = first.json().csrfToken as string;
    const cookies = cookiesOf(first);
    const call = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
      env.app.inject({
        method,
        url: `/api/v1${url}`,
        cookies,
        headers: method === 'GET' ? {} : { 'x-csrf-token': csrf },
        ...(payload ? { payload: payload as object } : {}),
      });
    expect((await call('GET', '/auth/mfa')).json()).toMatchObject({
      enrolled: false,
      pending: false,
      required: false,
    });
    const enrol = (await call('POST', '/auth/mfa/enroll')).json();
    expect(enrol.otpauthUrl).toMatch(
      /^otpauth:\/\/totp\/Intuitive%20Fusion:finance%40meridian-demo\.example\?secret=[A-Z2-7]+/,
    );
    // the stored secret is sealed
    const stored = (await sys<Json[]>((tx) => tx.select().from(s.userMfa)))[0]!;
    expect(stored.secret).not.toContain(enrol.secret);
    expect((await call('POST', '/auth/mfa/confirm', { code: '000000' })).statusCode).toBe(422);
    const ok = await call('POST', '/auth/mfa/confirm', { code: nowCode(enrol.secret) });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await call('GET', '/auth/mfa')).json().enrolled).toBe(true);
    expect((await call('POST', '/auth/mfa/enroll')).statusCode).toBe(409);

    // the next sign-in: password right, but no session yet
    env.clock.advanceMs(60_000);
    const second = await login('finance');
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ mfaRequired: true });
    expect(second.json().mfaToken).toBeTruthy();
    expect(second.cookies).toHaveLength(0);
    const token = second.json().mfaToken as string;
    // wrong code, then the right one
    expect(
      (
        await env.app.inject({
          method: 'POST',
          url: '/api/v1/auth/mfa/verify',
          payload: { mfaToken: token, code: '123456' },
        })
      ).statusCode,
    ).toBe(401);
    const good = await env.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { mfaToken: token, code: nowCode(enrol.secret, 1) },
    });
    expect(good.statusCode, good.body).toBe(200);
    expect(good.json().user.email).toBe('finance@meridian-demo.example');
    expect(good.cookies.some((c) => c.name === 'if_session')).toBe(true);
    // a code works once
    const replay = await env.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { mfaToken: token, code: nowCode(enrol.secret, 1) },
    });
    expect(replay.statusCode).toBe(401);
    // the token alone is not a session, and it expires
    env.clock.advanceMs(6 * 60_000);
    const late = await env.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { mfaToken: token, code: nowCode(enrol.secret, 2) },
    });
    expect(late.statusCode).toBe(401);
    const failures = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'auth.mfa_failed')),
    );
    expect(failures.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(failures)).not.toContain(enrol.secret);
    // it can be removed with a current code
    const again = await env.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { mfaToken: (await login('finance')).json().mfaToken, code: nowCode(enrol.secret) },
    });
    expect(again.statusCode, again.body).toBe(200);
    const c2 = cookiesOf(again);
    const del = await env.app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/mfa',
      cookies: c2,
      headers: { 'x-csrf-token': again.json().csrfToken },
      payload: { code: nowCode(enrol.secret, 1) },
    });
    expect(del.statusCode, del.body).toBe(204);
    expect((await login('finance')).json().mfaRequired).toBe(false);
  });

  it('when the organisation requires it, staff can do nothing until they have set the app up', async () => {
    await security({ requireMfa: true });
    const r = await login('legal');
    expect(r.json()).toMatchObject({ mfaRequired: false, mfaEnrolmentRequired: true });
    const cookies = cookiesOf(r);
    const csrf = r.json().csrfToken as string;
    const get = (url: string) => env.app.inject({ method: 'GET', url: `/api/v1${url}`, cookies });
    const blocked = await get('/contracts');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('MFA_ENROLMENT_REQUIRED');
    expect((await get('/auth/me')).statusCode).toBe(200); // the set-up itself is reachable
    const enrol = (
      await env.app.inject({
        method: 'POST',
        url: '/api/v1/auth/mfa/enroll',
        cookies,
        headers: { 'x-csrf-token': csrf },
      })
    ).json();
    const done = await env.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/confirm',
      cookies,
      headers: { 'x-csrf-token': csrf },
      payload: { code: nowCode(enrol.secret) },
    });
    expect(done.statusCode).toBe(200);
    expect((await get('/contracts')).statusCode).toBe(200); // the same session is released
    const del = await env.app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/mfa',
      cookies,
      headers: { 'x-csrf-token': csrf },
      payload: { code: nowCode(enrol.secret, 1) },
    });
    expect(del.statusCode).toBe(403); // cannot be removed while it is required
    // suppliers are a separate pool and are not forced
    expect((await login('supplier')).json().mfaEnrolmentRequired).toBe(false);
    await security({ requireMfa: false });
  });
});

describe('single sign-on (SEC-A02, SEC-A04)', () => {
  const nonce = 'nonce-for-tests-1234';
  const simulate = async (email: string, n = nonce) =>
    env.app.inject({ method: 'POST', url: '/api/v1/auth/sso/simulate', payload: { email, nonce: n } });

  it('an ID token from the identity provider opens a session marked as single sign-on', async () => {
    expect((await env.app.inject({ method: 'GET', url: '/api/v1/auth/sso/config' })).json()).toMatchObject({
      available: true,
      simulated: true,
      enforced: false,
    });
    const t = (await simulate('exec@meridian-demo.example')).json().idToken as string;
    const r = await env.app.inject({
      method: 'POST',
      url: '/api/v1/auth/sso/callback',
      payload: { idToken: t, nonce },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().user).toMatchObject({ email: 'exec@meridian-demo.example', role: 'EXEC' });
    expect(r.cookies.some((c) => c.name === 'if_session')).toBe(true);
    const row = (await sys<Json[]>((tx) => tx.select().from(s.session)))
      .filter((x) => x.userId === uid('user:exec'))
      .at(-1)!;
    expect(row.authMethod).toBe('SSO');
  });

  it('refuses a token that is forged, expired, for another audience or issuer, replayed with another nonce, or for no one', async () => {
    const secret = 'e'.repeat(40) + ':sso';
    const base = {
      iss: 'https://sso.meridian-demo.example',
      aud: 'intuitive-fusion',
      sub: uid('user:exec'),
      email: 'exec@meridian-demo.example',
      name: 'Elena Petrova',
      nonce,
      iat: 1,
      exp: 9_999_999_999,
    };
    const post = (idToken: string, n = nonce) =>
      env.app.inject({ method: 'POST', url: '/api/v1/auth/sso/callback', payload: { idToken, nonce: n } });
    const good = (await simulate('exec@meridian-demo.example')).json().idToken as string;
    expect((await post(good + 'x')).statusCode).toBe(401); // tampered signature
    expect((await post(good, 'a-different-nonce-1234')).statusCode).toBe(401);
    expect((await post(signIdToken('some-other-key', base))).statusCode).toBe(401); // signed by someone else
    expect((await post(signIdToken(secret, { ...base, aud: 'another-app' }))).statusCode).toBe(401);
    expect((await post(signIdToken(secret, { ...base, iss: 'https://evil.example' }))).statusCode).toBe(401);
    expect((await post(signIdToken(secret, { ...base, exp: 1_000 }))).statusCode).toBe(401);
    expect(
      (await post(signIdToken(secret, { ...base, email: 'someone.else@meridian-demo.example' }))).statusCode,
    ).toBe(401); // does not match the account
    expect((await post(signIdToken(secret, { ...base, sub: uid('user:nobody') }))).statusCode).toBe(401);
    expect((await simulate('nobody@meridian-demo.example')).statusCode).toBe(401);
    expect((await post(signIdToken(secret, base))).statusCode).toBe(200); // the same claims, properly signed, are fine
  });

  it('when single sign-on is required staff cannot use passwords, which is recorded; suppliers can', async () => {
    await security({ enforceSso: true });
    const refused = await login('procurement');
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('SSO_REQUIRED');
    expect(refused.cookies).toHaveLength(0);
    expect(
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'auth.password_refused_sso_required')),
      ),
    ).toHaveLength(1);
    const t = (await simulate('procurement@meridian-demo.example')).json().idToken as string;
    expect(
      (
        await env.app.inject({
          method: 'POST',
          url: '/api/v1/auth/sso/callback',
          payload: { idToken: t, nonce },
        })
      ).statusCode,
    ).toBe(200);
    expect((await login('supplier')).statusCode).toBe(200);
    expect((await env.app.inject({ method: 'GET', url: '/api/v1/auth/sso/config' })).json().enforced).toBe(
      true,
    );
    await security({ enforceSso: false });
  });
});

describe('approvals need a fresh code from the authenticator app when required (SEC-A04)', () => {
  it('without a code an approval is refused; with one it goes through; people without the app are told to set it up', async () => {
    const r = await env.call('requester', 'POST', '/requests', {
      title: 'Step-up',
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: 40_000,
      termMonths: 12,
      businessUnit: 'Facilities',
      fields: { contractOwner: 'Sofia Rossi' },
    });
    await env.call('requester', 'POST', `/requests/${r.json().id}/submit`);
    const plan = (await env.call('procurement', 'GET', `/requests/${r.json().id}/plan`)).json();
    await env.call('procurement', 'POST', `/plans/${plan.id}/submit-for-approval`);
    await security({ stepUpApprovals: true });

    const first = await login('delegate');
    const cookies = cookiesOf(first);
    const csrf = first.json().csrfToken as string;
    const approve = (code?: string) =>
      env.app.inject({
        method: 'POST',
        url: `/api/v1/plans/${plan.id}/decision`,
        cookies,
        headers: { 'x-csrf-token': csrf, ...(code ? { 'x-step-up-code': code } : {}) },
        payload: { decision: 'APPROVE' },
      });
    expect((await approve()).json().code).toBe('MFA_ENROLMENT_REQUIRED'); // no app yet
    const enrol = (
      await env.app.inject({
        method: 'POST',
        url: '/api/v1/auth/mfa/enroll',
        cookies,
        headers: { 'x-csrf-token': csrf },
      })
    ).json();
    await env.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/confirm',
      cookies,
      headers: { 'x-csrf-token': csrf },
      payload: { code: nowCode(enrol.secret) },
    });
    const none = await approve();
    expect(none.statusCode).toBe(401);
    expect(none.json().code).toBe('STEP_UP_REQUIRED');
    expect((await approve('000000')).statusCode).toBe(401);
    env.clock.advanceMs(35_000);
    const ok = await approve(nowCode(enrol.secret));
    expect(ok.statusCode, ok.body).toBe(200);
    expect(
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'auth.step_up_failed')),
      ),
    ).not.toHaveLength(0);
    await security({ stepUpApprovals: false });
  });
});

describe('time-bound access (SEC-A05)', () => {
  it('access ends on the date without anyone doing anything, then the sweep tidies up and tells people', async () => {
    const probity = await env.extraUser('advisor', 'PROBITY');
    const first = await loginAs(probity.email.toLowerCase());
    const cookies = cookiesOf(first);
    const get = () => env.app.inject({ method: 'GET', url: '/api/v1/requests', cookies });
    expect((await get()).statusCode).toBe(200);
    const until = new Date(env.clock.now().getTime() + 10 * 86_400_000).toISOString();
    const set = await env.call('admin', 'PUT', `/admin/users/${probity.id}/role-expiry`, {
      role: 'PROBITY',
      expiresAt: until,
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().grants).toEqual([{ role: 'PROBITY', expiresAt: until, ended: false }]);
    expect((await get()).statusCode).toBe(200); // still inside the window
    env.clock.advanceMs(11 * 86_400_000 - 20 * 60_000); // the day the grant ends, session still alive
    env.clock.advanceMs(20 * 60_000);
    // the very next request is refused: the role has ended, nobody had to do anything
    expect((await get()).statusCode).toBe(401);
    // and signing in again is refused in the same words as a wrong password
    const again = await loginAs(probity.email.toLowerCase());
    expect(again.statusCode).toBe(401);
    expect(again.json().code).toBe('INVALID_CREDENTIALS');
    expect(
      (
        await sys<Json[]>((tx) =>
          tx.select().from(s.roleAssignment).where(eq(s.roleAssignment.userId, probity.id)),
        )
      ).length,
    ).toBe(1);
    const sweep = await env.call('admin', 'POST', '/admin/grants/sweep');
    expect(sweep.json().ended).toBe(1);
    expect(
      await sys<Json[]>((tx) =>
        tx.select().from(s.roleAssignment).where(eq(s.roleAssignment.userId, probity.id)),
      ),
    ).toHaveLength(0);
    expect((await env.call('admin', 'POST', '/admin/grants/sweep')).json().ended).toBe(0); // idempotent
    const events = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'grant.expired')),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.before).toMatchObject({ role: 'PROBITY' });
    const notes = await sys<Json[]>((tx) =>
      tx.select().from(s.notification).where(eq(s.notification.userId, probity.id)),
    );
    expect(notes.some((n) => n.title.includes('access has ended'))).toBe(true);
    expect(
      (await env.call('admin', 'GET', '/notifications'))
        .json()
        .some((n: Json) => n.title.includes('access ended')),
    ).toBe(true);
    expect(
      await sys<Json[]>((tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'grant.expiry_set')),
      ),
    ).toHaveLength(1);
  });

  it('only a future date, within two years, on someone else, and never for the administrator role', async () => {
    env.clock.set(SEED_DATE);
    const person = await env.extraUser('temp', 'FINANCE');
    const put = (body: Json, id = person.id) =>
      env.call('admin', 'PUT', `/admin/users/${id}/role-expiry`, body);
    expect((await put({ role: 'FINANCE', expiresAt: '2020-01-01T00:00:00.000Z' })).statusCode).toBe(422);
    expect((await put({ role: 'FINANCE', expiresAt: '2030-01-01T00:00:00.000Z' })).statusCode).toBe(422);
    expect((await put({ role: 'LEGAL', expiresAt: '2026-12-01T00:00:00.000Z' })).statusCode).toBe(404);
    expect(
      (await put({ role: 'ADMIN', expiresAt: '2026-12-01T00:00:00.000Z' }, uid('user:admin'))).statusCode,
    ).toBe(403); // yourself
    expect(
      (
        await env.call('requester', 'PUT', `/admin/users/${person.id}/role-expiry`, {
          role: 'FINANCE',
          expiresAt: null,
        })
      ).statusCode,
    ).toBe(403);
    expect((await put({ role: 'FINANCE', expiresAt: '2026-12-01T00:00:00.000Z' })).statusCode).toBe(200);
    expect((await put({ role: 'FINANCE', expiresAt: null })).json().grants).toEqual([]); // cleared
  });
});

describe('a supplier contact leaves (SEC-A06)', () => {
  const bright = uid('supplier:brightwave');
  it('procurement switches them off: sessions end, sign-in is refused, open links are void, and it is recorded', async () => {
    const sam = await login('supplier');
    const cookies = cookiesOf(sam);
    expect((await env.app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies })).statusCode).toBe(200);
    expect(
      (
        await env.call(
          'procurement',
          'POST',
          `/suppliers/${bright}/contacts/${uid('user:supplier')}/deprovision`,
          { reason: 'x' },
        )
      ).statusCode,
    ).toBe(400); // reason too short
    const r = await env.call(
      'procurement',
      'POST',
      `/suppliers/${bright}/contacts/${uid('user:supplier')}/deprovision`,
      { reason: 'Left the company' },
    );
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ active: false });
    expect((await env.app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies })).statusCode).toBe(401);
    expect((await login('supplier')).statusCode).toBe(401);
    expect(
      (
        await env.call(
          'procurement',
          'POST',
          `/suppliers/${bright}/contacts/${uid('user:supplier')}/deprovision`,
          { reason: 'Again' },
        )
      ).statusCode,
    ).toBe(409);
    const audit = await sys<Json[]>((tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'supplier.contact_deprovision')),
    );
    expect(audit[0]!.after).toMatchObject({ active: false, reason: 'Left the company' });
    expect(
      (
        await env.call('legal', 'POST', `/suppliers/${bright}/contacts/${uid('user:supplier')}/deprovision`, {
          reason: 'Not allowed',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('a replacement is added in the same step with their own one-time link', async () => {
    const added = await env.call('procurement', 'POST', `/suppliers/${bright}/contacts`, {
      name: 'Leaver Lee',
      email: 'leaver.lee@brightwave.example',
    });
    const leaverId = added.json().contact.id as string;
    const re = await env.call('procurement', 'POST', `/suppliers/${bright}/contacts/${leaverId}/reassign`, {
      name: 'Taker Tan',
      email: 'taker.tan@brightwave.example',
      reason: 'Lee moved to another role',
    });
    expect(re.statusCode, re.body).toBe(201);
    expect(re.json().replaced).toMatchObject({ name: 'Leaver Lee' });
    expect(re.json().activationPath).toMatch(/^\/supplier\/activate\?token=/);
    const users = await sys<Json[]>((tx) =>
      tx.select().from(s.appUser).where(eq(s.appUser.supplierId, bright)),
    );
    expect(users.find((u) => u.email === 'leaver.lee@brightwave.example')!.active).toBe(false);
    expect(users.find((u) => u.email === 'taker.tan@brightwave.example')!.active).toBe(true);
    expect(
      (
        await env.call('procurement', 'POST', `/suppliers/${bright}/contacts/${leaverId}/reassign`, {
          name: 'Another',
          email: 'another@brightwave.example',
          reason: 'Twice',
        })
      ).statusCode,
    ).toBe(409);
  });
});
