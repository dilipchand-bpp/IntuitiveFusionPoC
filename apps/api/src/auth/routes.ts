import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ROLE_HOME, type AppConfig } from '@if/shared';
import type { RequestContext } from '../db/client.js';
import { AppError, parse } from '../http/errors.js';
import { guard, type GuardDeps } from './guard.js';
import type { AuthenticatedUser, IdentityProvider } from './identity-provider.js';
import { withSystem } from '../db/client.js';
import { loadSettings } from '../modules/settings/settings.js';
import { mfaState, signMfaToken } from './mfa.js';
import { COOKIE_NAMES, type MfaState } from './session-service.js';

export interface AuthRouteDeps extends GuardDeps {
  config: AppConfig;
  idp: IdentityProvider;
  loginRateLimitMax: number;
}

const loginBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
});
const forgotBody = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

const publicUser = (u: AuthenticatedUser) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  roles: u.roles,
  orgUnit: u.orgUnitId ?? undefined,
  homePath: ROLE_HOME[u.role],
});

const cookieOpts = (config: AppConfig, expires?: Date) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.NODE_ENV === 'production',
  path: '/',
  ...(expires ? { expires } : {}),
});

/** Creates the session, sets the right cookie and returns the body every successful sign-in returns. */
export async function startSession(
  d: AuthRouteDeps,
  req: FastifyRequest,
  reply: FastifyReply,
  user: AuthenticatedUser,
  how: { mfaState: MfaState; authMethod: 'PASSWORD' | 'SSO' },
) {
  const { config, audit, database, sessions } = d;
  const created = await sessions.create(user, { ip: req.ip, userAgent: req.headers['user-agent'] }, how);
  await audit.recordOutsideTx(
    database,
    { tenantId: user.tenantId, userId: user.id, role: user.role, correlationId: req.id },
    {
      action: 'auth.login',
      entityType: 'session',
      entityId: created.id,
      after: { pool: user.pool, method: how.authMethod, mfa: how.mfaState },
    },
  );
  void reply.setCookie(COOKIE_NAMES[user.pool], created.cookieValue, cookieOpts(config));
  return {
    user: publicUser(user),
    expiresAt: created.expiresAt.toISOString(),
    mfaRequired: false,
    mfaEnrolmentRequired: how.mfaState === 'ENROLMENT_REQUIRED',
    csrfToken: sessions.csrfFor(created.id),
  };
}

export function registerAuthRoutes(app: FastifyInstance, p: string, d: AuthRouteDeps): Set<string> {
  const { config, idp, audit, database, sessions } = d;
  const systemCtx = (tenantId: string, userId: string | null, correlationId: string): RequestContext => ({
    tenantId,
    userId,
    role: 'SYSTEM',
    correlationId,
  });
  const registered = new Set<string>();
  const reg = (m: string, path: string) => registered.add(`${m} ${path}`);

  // POST /auth/login
  reg('POST', '/auth/login');
  app.post(
    `${p}/auth/login`,
    { config: { rateLimit: { max: d.loginRateLimitMax, timeWindow: '15 minutes' } } },
    async (req, reply: FastifyReply) => {
      const body = parse(loginBody, req.body);
      const result = await idp.authenticate(body.email, body.password);
      if (!result.ok) {
        if (result.tenantId) {
          const ctx = systemCtx(result.tenantId, result.userId, req.id);
          // The attempted email is never stored; only a hash, so the log cannot be mined for typo'd credentials.
          const emailHash = createHash('sha256').update(body.email.toLowerCase()).digest('hex').slice(0, 16);
          await audit.recordOutsideTx(database, ctx, {
            action: 'auth.login_failed',
            entityType: 'app_user',
            entityId: result.userId,
            after: { reason: result.reason, emailHash },
            result: 'DENIED',
          });
          if (result.justLocked)
            await audit.recordOutsideTx(database, ctx, {
              action: 'auth.account_locked',
              entityType: 'app_user',
              entityId: result.userId,
              after: { lockedMinutes: 15 },
              result: 'DENIED',
            });
        }
        // One message and status for unknown account, wrong password and locked account (no enumeration).
        throw new AppError(
          401,
          'INVALID_CREDENTIALS',
          'Invalid email or password, or the account is temporarily locked',
        );
      }
      const { user } = result;
      const settings = await withSystem(database, (tx) => loadSettings(tx, user.tenantId));
      // an organisation that has switched on single sign-on does not accept passwords from its staff (SEC-A04)
      if (settings.security.enforceSso && user.pool === 'STAFF') {
        await audit.recordOutsideTx(
          database,
          { tenantId: user.tenantId, userId: user.id, role: user.role, correlationId: req.id },
          {
            action: 'auth.password_refused_sso_required',
            entityType: 'app_user',
            entityId: user.id,
            result: 'DENIED',
          },
        );
        throw new AppError(
          403,
          'SSO_REQUIRED',
          'Your organisation requires single sign-on. Use the single sign-on button.',
        );
      }
      const mfa = await mfaState(database, user.id);
      if (mfa?.confirmed) {
        // password is right, but a one-time code from the authenticator app is still needed before any session exists
        return { mfaRequired: true, mfaToken: signMfaToken(config.SESSION_SECRET, user.id, d.clock.now()) };
      }
      const enrolmentRequired = settings.security.requireMfa && user.pool === 'STAFF';
      return startSession(d, req, reply, user, {
        mfaState: enrolmentRequired ? 'ENROLMENT_REQUIRED' : 'NOT_REQUIRED',
        authMethod: 'PASSWORD',
      });
    },
  );

  // POST /auth/logout
  reg('POST', '/auth/logout');
  app.post(`${p}/auth/logout`, { preHandler: guard(d, 'any') }, async (req, reply) => {
    const a = req.auth!;
    await sessions.revoke(a.sessionId);
    await audit.recordOutsideTx(database, a.ctx, {
      action: 'auth.logout',
      entityType: 'session',
      entityId: a.sessionId,
    });
    void reply.clearCookie(COOKIE_NAMES[a.user.pool], { path: '/' }).status(204);
    return reply.send();
  });

  // POST /auth/forgot-password  (always 202: never reveals whether the account exists)
  reg('POST', '/auth/forgot-password');
  app.post(
    `${p}/auth/forgot-password`,
    { config: { rateLimit: { max: d.loginRateLimitMax, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const body = parse(forgotBody, req.body);
      const emailHash = createHash('sha256').update(body.email.toLowerCase()).digest('hex').slice(0, 16);
      const { tenantId } = await idp.requestPasswordReset(body.email);
      if (tenantId) {
        await audit.recordOutsideTx(database, systemCtx(tenantId, null, req.id), {
          action: 'auth.password_reset_requested',
          entityType: 'app_user',
          after: { emailHash },
        });
      }
      return reply
        .status(202)
        .send({ message: 'If an account exists for that address, a reset link has been sent.' });
    },
  );

  // GET /auth/me
  reg('GET', '/auth/me');
  app.get(`${p}/auth/me`, { preHandler: guard(d, 'any') }, async (req) => ({
    ...publicUser(req.auth!.user),
    csrfToken: req.auth!.csrfToken,
  }));

  // POST /auth/access-denied  (the web route guard reports blocked page visits so they are audited: US-PLT-03)
  reg('POST', '/auth/access-denied');
  app.post(`${p}/auth/access-denied`, { preHandler: guard(d, 'any') }, async (req, reply) => {
    const body = parse(z.object({ path: z.string().max(200).startsWith('/') }), req.body);
    await audit.recordOutsideTx(database, req.auth!.ctx, {
      action: 'access.denied',
      entityType: 'web_route',
      after: { path: body.path },
      result: 'DENIED',
    });
    return reply.status(204).send();
  });

  return registered;
}
