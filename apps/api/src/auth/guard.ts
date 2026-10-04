import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Clock, RoleName } from '@if/shared';
import type { AuditService } from '../audit/audit-service.js';
import type { Database, RequestContext } from '../db/client.js';
import { AppError, forbidden } from '../http/errors.js';
import type { AuthenticatedUser } from './identity-provider.js';
import { COOKIE_NAMES, type MfaState, type SessionService } from './session-service.js';

export interface AuthContext {
  user: AuthenticatedUser;
  sessionId: string;
  csrfToken: string;
  ctx: RequestContext;
  mfaState: MfaState;
  authMethod: 'PASSWORD' | 'SSO';
}
declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
    authFailure: string | null;
  }
}

/** 'public' = no login; 'any' = any signed-in user; otherwise one of the listed roles is required. */
export type Access = 'public' | 'any' | readonly RoleName[];

export interface GuardDeps {
  database: Database;
  clock: Clock;
  audit: AuditService;
  sessions: SessionService;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXTERNAL_OK = [
  '/auth',
  '/notifications',
  '/probity',
  '/evaluations',
  '/evaluation-reports',
  '/settings',
];

/** Resolves the session (if any) for every request; enforcement happens per route in guard(). */
export function installAuth(app: FastifyInstance, deps: GuardDeps): void {
  app.decorateRequest('auth', null);
  app.decorateRequest('authFailure', null);
  app.addHook('onRequest', async (req) => {
    for (const pool of ['STAFF', 'SUPPLIER'] as const) {
      const raw = req.cookies?.[COOKIE_NAMES[pool]];
      if (!raw) continue;
      const r = await deps.sessions.resolve(raw, pool);
      if (r.ok) {
        req.auth = {
          user: r.user,
          sessionId: r.sessionId,
          csrfToken: deps.sessions.csrfFor(r.sessionId),
          mfaState: r.mfaState,
          authMethod: r.authMethod,
          ctx: { tenantId: r.user.tenantId, userId: r.user.id, role: r.user.role, correlationId: req.id },
        };
        return;
      }
      req.authFailure = r.reason;
    }
  });
}

export function guard(deps: GuardDeps, access: Access) {
  return async function accessGuard(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (access === 'public') return;
    if (!req.auth) {
      const expired = req.authFailure === 'IDLE' || req.authFailure === 'EXPIRED';
      throw new AppError(
        401,
        expired ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED',
        expired ? 'Your session has expired' : 'Authentication required',
      );
    }
    if (
      !SAFE.has(req.method) &&
      !deps.sessions.verifyCsrf(req.auth.sessionId, req.headers['x-csrf-token'] as string | undefined)
    ) {
      await deps.audit.recordOutsideTx(deps.database, req.auth.ctx, {
        action: 'access.denied',
        entityType: 'route',
        after: { method: req.method, path: req.routeOptions.url, reason: 'CSRF' },
        result: 'DENIED',
      });
      throw new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token');
    }
    // a person who must enrol in MFA can do nothing else until they have (SEC-A01)
    if (req.auth.mfaState === 'ENROLMENT_REQUIRED' && !req.routeOptions.url?.includes('/auth/'))
      throw new AppError(403, 'MFA_ENROLMENT_REQUIRED', 'Set up your authenticator app to continue');
    // an external advisor can reach only the evaluation, probity and sign-in routes (FR-0310)
    if (
      req.auth.user.external &&
      !EXTERNAL_OK.some((p) => (req.routeOptions.url ?? '').startsWith(`/api/v1${p}`))
    ) {
      await deps.audit.recordOutsideTx(deps.database, req.auth.ctx, {
        action: 'access.denied',
        entityType: 'route',
        after: { method: req.method, path: req.routeOptions.url, reason: 'EXTERNAL_SCOPE' },
        result: 'DENIED',
      });
      throw forbidden();
    }
    if (access === 'any') return;
    if (!req.auth.user.roles.some((r) => access.includes(r))) {
      await deps.audit.recordOutsideTx(deps.database, req.auth.ctx, {
        action: 'access.denied',
        entityType: 'route',
        after: { method: req.method, path: req.routeOptions.url },
        result: 'DENIED',
      });
      throw forbidden();
    }
  };
}
