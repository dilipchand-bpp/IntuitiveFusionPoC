/**
 * Sign-in security beyond the password (SEC-A01, SEC-A02, SEC-A04):
 *  - authenticator-app MFA: enrol, confirm, remove, and the code check that completes a password sign-in;
 *  - single sign-on through an OIDC-style ID token (simulated identity provider; the validation is the real work and
 *    stays when the provider is swapped in, docs/swap-points.md);
 *  - step-up: when the organisation requires it, an approval needs a fresh code from the authenticator app.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { guard } from './guard.js';
import type { AuthRouteDeps } from './routes.js';
import { startSession } from './routes.js';
import { mfaState, verifyMfaToken } from './mfa.js';
import { newSecret, openSecret, otpauthUrl, sealSecret, verifyTotp } from './totp.js';
import { appUser, userMfa } from '../db/schema.js';
import { withSystem } from '../db/client.js';
import { AppError, parse } from '../http/errors.js';
import { loadSettings } from '../modules/settings/settings.js';

const codeBody = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Six digits'),
  })
  .strict();
const verifyBody = z
  .object({
    mfaToken: z.string().min(20).max(300),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Six digits'),
  })
  .strict();
const ISSUER = 'https://sso.meridian-demo.example';
const AUDIENCE = 'intuitive-fusion';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** The paths a step-up code protects: every place a person approves, signs or gives permission. */
const STEP_UP_ROUTES = new Set([
  'POST /plans/:id/decision',
  'POST /evaluation-reports/:id/decision',
  'POST /contracts/:id/sign',
  'POST /tenders/:id/publish-permission',
  'POST /requests/:id/process-variations/:variationId/decision',
]);

export interface IdToken {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  name: string;
  nonce: string;
  iat: number;
  exp: number;
}

/** Signs an ID token the way the simulated identity provider does (HS256). A real provider signs with its own key. */
export function signIdToken(secret: string, claims: IdToken): string {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(claims);
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}

/** Checks signature, issuer, audience, expiry and nonce. Returns the claims or the reason it was refused. */
export function verifyIdToken(
  secret: string,
  token: string,
  nonce: string,
  now: Date,
): { ok: true; claims: IdToken } | { ok: false; reason: string } {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [head, body, sig] = parts as [string, string, string];
  const expected = Buffer.from(createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url'));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return { ok: false, reason: 'bad signature' };
  let c: IdToken;
  try {
    c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as IdToken;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (c.iss !== ISSUER) return { ok: false, reason: 'wrong issuer' };
  if (c.aud !== AUDIENCE) return { ok: false, reason: 'wrong audience' };
  if (c.exp * 1000 <= now.getTime()) return { ok: false, reason: 'expired' };
  if (c.nonce !== nonce) return { ok: false, reason: 'nonce mismatch' };
  return { ok: true, claims: c };
}

export function registerSecurityRoutes(app: FastifyInstance, p: string, d: AuthRouteDeps): Set<string> {
  const { config, audit, database } = d;
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const ssoSecret = `${config.SESSION_SECRET}:sso`;

  // ---------------------------------------------------------------- MFA enrolment
  reg('GET', '/auth/mfa');
  app.get(`${p}/auth/mfa`, { preHandler: guard(d, 'any') }, async (req) => {
    const a = req.auth!;
    const m = await mfaState(database, a.user.id);
    const s = await withSystem(database, (tx) => loadSettings(tx, a.user.tenantId));
    return {
      enrolled: Boolean(m?.confirmed),
      pending: Boolean(m && !m.confirmed),
      required: s.security.requireMfa && a.user.pool === 'STAFF',
      method: a.authMethod,
    };
  });

  reg('POST', '/auth/mfa/enroll');
  app.post(`${p}/auth/mfa/enroll`, { preHandler: guard(d, 'any') }, async (req) => {
    const a = req.auth!;
    const existing = await mfaState(database, a.user.id);
    if (existing?.confirmed)
      throw new AppError(
        409,
        'MFA_ALREADY_ENROLLED',
        'An authenticator app is already set up for this account',
      );
    const secret = newSecret();
    await withSystem(database, async (tx) => {
      await tx.delete(userMfa).where(eq(userMfa.userId, a.user.id));
      await tx.insert(userMfa).values({
        userId: a.user.id,
        tenantId: a.user.tenantId,
        secret: sealSecret(secret, config.SESSION_SECRET),
        confirmed: false,
      });
    });
    await audit.recordOutsideTx(database, a.ctx, {
      action: 'auth.mfa_enrol_started',
      entityType: 'app_user',
      entityId: a.user.id,
    });
    // the secret is shown once, to the person, to put into their authenticator app
    return { secret, otpauthUrl: otpauthUrl('Intuitive Fusion', a.user.email, secret) };
  });

  reg('POST', '/auth/mfa/confirm');
  app.post(`${p}/auth/mfa/confirm`, { preHandler: guard(d, 'any') }, async (req) => {
    const a = req.auth!;
    const { code } = parse(codeBody, req.body);
    const m = await mfaState(database, a.user.id);
    if (!m) throw new AppError(409, 'MFA_NOT_STARTED', 'Start the set-up first');
    if (m.confirmed)
      throw new AppError(409, 'MFA_ALREADY_ENROLLED', 'An authenticator app is already set up');
    const step = verifyTotp(openSecret(m.secret, config.SESSION_SECRET), code, d.clock.now(), m.lastStep);
    if (step === null) {
      await audit.recordOutsideTx(database, a.ctx, {
        action: 'auth.mfa_confirm_failed',
        entityType: 'app_user',
        entityId: a.user.id,
        result: 'DENIED',
      });
      throw new AppError(
        422,
        'MFA_CODE_INVALID',
        'That code is not right. Check the time on your phone and try the next code.',
      );
    }
    await withSystem(database, (tx) =>
      tx.update(userMfa).set({ confirmed: true, lastStep: step }).where(eq(userMfa.userId, a.user.id)),
    );
    await d.sessions.markMfaVerified(a.sessionId);
    await audit.recordOutsideTx(database, a.ctx, {
      action: 'auth.mfa_enrolled',
      entityType: 'app_user',
      entityId: a.user.id,
    });
    return { enrolled: true };
  });

  reg('DELETE', '/auth/mfa');
  app.delete(`${p}/auth/mfa`, { preHandler: guard(d, 'any') }, async (req, reply) => {
    const a = req.auth!;
    const { code } = parse(codeBody, req.body);
    const m = await mfaState(database, a.user.id);
    if (!m?.confirmed) throw new AppError(409, 'MFA_NOT_ENROLLED', 'No authenticator app is set up');
    const s = await withSystem(database, (tx) => loadSettings(tx, a.user.tenantId));
    if (s.security.requireMfa && a.user.pool === 'STAFF')
      throw new AppError(
        403,
        'MFA_REQUIRED',
        'Your organisation requires an authenticator app, so it cannot be removed',
      );
    if (verifyTotp(openSecret(m.secret, config.SESSION_SECRET), code, d.clock.now(), m.lastStep) === null)
      throw new AppError(422, 'MFA_CODE_INVALID', 'That code is not right');
    await withSystem(database, (tx) => tx.delete(userMfa).where(eq(userMfa.userId, a.user.id)));
    await audit.recordOutsideTx(database, a.ctx, {
      action: 'auth.mfa_removed',
      entityType: 'app_user',
      entityId: a.user.id,
    });
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------- the code check that completes a password sign-in
  reg('POST', '/auth/mfa/verify');
  app.post(
    `${p}/auth/mfa/verify`,
    { config: { rateLimit: { max: d.loginRateLimitMax, timeWindow: '15 minutes' } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = parse(verifyBody, req.body);
      const userId = verifyMfaToken(config.SESSION_SECRET, body.mfaToken, d.clock.now());
      const refuse = async (reason: string, uid: string | null, tenantId: string | null) => {
        if (tenantId)
          await audit.recordOutsideTx(
            database,
            { tenantId, userId: uid, role: 'SYSTEM', correlationId: req.id },
            {
              action: 'auth.mfa_failed',
              entityType: 'app_user',
              entityId: uid,
              after: { reason },
              result: 'DENIED',
            },
          );
        throw new AppError(401, 'MFA_FAILED', 'That code did not work. Sign in again.');
      };
      if (!userId) return refuse('token', null, null);
      const user = await d.idp.loadUser(userId);
      const m = await mfaState(database, userId);
      if (!user || !m?.confirmed) return refuse('no mfa', userId, user?.tenantId ?? null);
      const step = verifyTotp(
        openSecret(m.secret, config.SESSION_SECRET),
        body.code,
        d.clock.now(),
        m.lastStep,
      );
      if (step === null) return refuse('bad code', userId, user.tenantId);
      await withSystem(database, (tx) =>
        tx.update(userMfa).set({ lastStep: step }).where(eq(userMfa.userId, userId)),
      );
      return startSession(d, req, reply, user, { mfaState: 'VERIFIED', authMethod: 'PASSWORD' });
    },
  );

  // ---------------------------------------------------------------- single sign-on (simulated identity provider)
  reg('GET', '/auth/sso/config');
  app.get(`${p}/auth/sso/config`, async () => {
    const s = await withSystem(database, async (tx) => {
      const [t] = await tx.select({ id: appUser.tenantId }).from(appUser).limit(1);
      return t ? loadSettings(tx, t.id) : null;
    });
    return { available: true, simulated: true, issuer: ISSUER, enforced: Boolean(s?.security.enforceSso) };
  });

  // The identity provider's side of the exchange: in production the browser is redirected to the organisation's
  // provider, which authenticates the person and sends back an ID token. Here the portal issues one for a chosen demo
  // person, so everything after this (the validation and the session) is exactly what a real provider would meet.
  reg('POST', '/auth/sso/simulate');
  app.post(`${p}/auth/sso/simulate`, async (req) => {
    if (config.NODE_ENV === 'production') throw new AppError(404, 'NOT_FOUND', 'Not found');
    const body = parse(
      z
        .object({
          email: z.string().trim().toLowerCase().email().max(254),
          nonce: z.string().min(8).max(100),
        })
        .strict(),
      req.body,
    );
    const [u] = await withSystem(database, (tx) =>
      tx.select().from(appUser).where(eq(appUser.email, body.email)),
    );
    if (!u || !u.active) throw new AppError(401, 'SSO_FAILED', 'Single sign-on failed');
    const now = Math.floor(d.clock.now().getTime() / 1000);
    return {
      idToken: signIdToken(ssoSecret, {
        iss: ISSUER,
        aud: AUDIENCE,
        sub: u.id,
        email: u.email,
        name: u.name,
        nonce: body.nonce,
        iat: now,
        exp: now + 300,
      }),
    };
  });

  reg('POST', '/auth/sso/callback');
  app.post(
    `${p}/auth/sso/callback`,
    { config: { rateLimit: { max: d.loginRateLimitMax, timeWindow: '15 minutes' } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = parse(
        z.object({ idToken: z.string().min(20).max(4000), nonce: z.string().min(8).max(100) }).strict(),
        req.body,
      );
      const r = verifyIdToken(ssoSecret, body.idToken, body.nonce, d.clock.now());
      if (!r.ok) throw new AppError(401, 'SSO_FAILED', 'Single sign-on failed');
      // the person must already exist and be active: single sign-on proves who they are, it does not create accounts
      const user = await d.idp.loadUser(r.claims.sub);
      if (!user || user.email !== r.claims.email)
        throw new AppError(401, 'SSO_FAILED', 'Single sign-on failed');
      // the identity provider has already done its own multi-factor check, so no second code is asked for
      return startSession(d, req, reply, user, { mfaState: 'NOT_REQUIRED', authMethod: 'SSO' });
    },
  );

  // ---------------------------------------------------------------- step-up for approvals (SEC-A04)
  app.addHook('preHandler', async (req) => {
    const a = req.auth;
    if (!a || !STEP_UP_ROUTES.has(`${req.method} ${req.routeOptions.url?.replace(p, '')}`)) return;
    const s = await withSystem(database, (tx) => loadSettings(tx, a.user.tenantId));
    if (!s.security.stepUpApprovals || a.user.pool !== 'STAFF') return;
    const m = await mfaState(database, a.user.id);
    if (!m?.confirmed)
      throw new AppError(
        403,
        'MFA_ENROLMENT_REQUIRED',
        'Set up your authenticator app: this organisation needs a code for every approval',
      );
    const code = String(req.headers['x-step-up-code'] ?? '');
    const step = /^\d{6}$/.test(code)
      ? verifyTotp(openSecret(m.secret, config.SESSION_SECRET), code, d.clock.now(), m.lastStep - 1)
      : null;
    if (step === null) {
      await audit.recordOutsideTx(database, a.ctx, {
        action: 'auth.step_up_failed',
        entityType: 'route',
        after: { path: req.routeOptions.url },
        result: 'DENIED',
      });
      throw new AppError(
        401,
        'STEP_UP_REQUIRED',
        'Enter the 6-digit code from your authenticator app to approve',
      );
    }
    // the code may be used again within its own 30 seconds (an approval and its follow-up), never an older one
    await withSystem(database, (tx) =>
      tx
        .update(userMfa)
        .set({ lastStep: Math.max(m.lastStep, step) })
        .where(eq(userMfa.userId, a.user.id)),
    );
  });

  return done;
}
