import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { AppConfig, Clock } from '@if/shared';
import { AuditService } from './audit/audit-service.js';
import { installAuth, type GuardDeps } from './auth/guard.js';
import { MockIdentityProvider, type IdentityProvider } from './auth/identity-provider.js';
import { registerAuthRoutes } from './auth/routes.js';
import { SessionService } from './auth/session-service.js';
import { MockAiProvider, type AiProvider } from './adapters/ai-provider.js';
import { MockErpBudgetService, type ErpBudgetService } from './adapters/erp.js';
import type { Database } from './db/client.js';
import { registerIdempotency } from './http/idempotency.js';
import { registerIntakeRoutes } from './modules/intake/routes.js';
import { registerReportingRoutes } from './modules/reporting/routes.js';
import { registerContractRoutes } from './modules/contract/routes.js';
import { registerEvaluationRoutes } from './modules/evaluation/routes.js';
import { registerPlanRoutes } from './modules/plan/routes.js';
import { AppError } from './http/errors.js';
import { registerShellRoutes } from './modules/shell.js';
import { SealedStore } from './modules/tender/files.js';
import { registerTenderRoutes } from './modules/tender/routes.js';
import { registerSupplierRoutes } from './modules/tender/supplier-routes.js';
import { registerSpecStubs } from './spec-routes.js';

export const API_PREFIX = '/api/v1';

export interface AppDeps {
  database: Database;
  clock: Clock;
  /** Override for tests; production uses the default (10 attempts per 15 minutes per IP). */
  loginRateLimitMax?: number;
  /** Minutes between background alert runs (production only; alerts also fire when the alert pages are read). */
  alertSchedulerMinutes?: number;
  idp?: IdentityProvider;
  ai?: AiProvider;
  erp?: ErpBudgetService;
}

const problem = (reply: FastifyReply, status: number, body: Record<string, unknown>) =>
  reply
    .status(status)
    .type('application/problem+json')
    .send({ type: 'about:blank', status, ...body });

/** Builds the API without listening, so tests can use app.inject(). */
export async function buildApp(config: AppConfig, deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: 'info',
            redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]'],
          },
    genReqId: (req) => (req.headers['x-correlation-id'] as string | undefined) ?? randomUUID(),
    requestIdHeader: false,
    trustProxy: config.NODE_ENV === 'production',
  });
  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  const audit = new AuditService(deps.clock);
  const idp = deps.idp ?? new MockIdentityProvider(deps.database, deps.clock, config.DEFAULT_TENANT_SLUG);
  const sessions = new SessionService(deps.database, deps.clock, idp, config.SESSION_SECRET);
  const guardDeps: GuardDeps = { database: deps.database, clock: deps.clock, audit, sessions };

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-correlation-id', req.id);
    reply.header('cache-control', 'no-store'); // API responses can contain personal / confidential data
  });

  // RFC 7807 problem+json for every error; never leak internals (Technical Specification 4.1, 7).
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof AppError) {
      return problem(reply, err.status, {
        title: err.message,
        code: err.code,
        correlationId: req.id,
        ...(err.fieldErrors.length ? { errors: err.fieldErrors } : {}),
      });
    }
    if (err.statusCode === 429) {
      return problem(reply, 429, { title: 'Too many requests', code: 'RATE_LIMITED', correlationId: req.id });
    }
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    return problem(reply, status, {
      title: status >= 500 ? 'Internal error' : 'Request could not be processed',
      code: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED',
      correlationId: req.id,
    });
  });
  app.setNotFoundHandler((req, reply) =>
    problem(reply, 404, { title: 'Not found', code: 'NOT_FOUND', correlationId: req.id }),
  );

  installAuth(app, guardDeps);
  // Retry-safe mutations: only for signed-in callers presenting a valid CSRF token (NFR-AV03).
  registerIdempotency(app, {
    database: deps.database,
    identify: (req) =>
      req.auth && sessions.verifyCsrf(req.auth.sessionId, req.headers['x-csrf-token'] as string | undefined)
        ? { tenantId: req.auth.user.tenantId, userId: req.auth.user.id }
        : null,
  });

  app.get('/health', async () => ({ status: 'ok', service: 'if-api', time: deps.clock.now().toISOString() }));
  app.get(`${API_PREFIX}/health`, async () => ({
    status: 'ok',
    version: '0.1.0',
    simulatedAi: config.AI_PROVIDER === 'mock',
  }));

  const implemented = registerAuthRoutes(app, API_PREFIX, {
    ...guardDeps,
    config,
    idp,
    loginRateLimitMax: deps.loginRateLimitMax ?? 10,
  });
  implemented.add('GET /health');
  for (const k of registerShellRoutes(app, API_PREFIX, guardDeps)) implemented.add(k);
  const ai = deps.ai ?? new MockAiProvider();
  const erp = deps.erp ?? new MockErpBudgetService();
  for (const k of registerIntakeRoutes(app, API_PREFIX, { ...guardDeps, ai, erp })) implemented.add(k);
  for (const k of registerPlanRoutes(app, API_PREFIX, { ...guardDeps, ai })) implemented.add(k);
  const store = new SealedStore(config.STORAGE_DIR, config.SESSION_SECRET);
  for (const k of registerTenderRoutes(app, API_PREFIX, {
    ...guardDeps,
    store,
    contactEmail: 'hello@intuitivefusion.example',
  }))
    implemented.add(k);
  for (const k of registerSupplierRoutes(app, API_PREFIX, {
    ...guardDeps,
    store,
    config,
    publicRateLimitMax: deps.loginRateLimitMax ?? 20,
  }))
    implemented.add(k);
  for (const k of registerEvaluationRoutes(app, API_PREFIX, { ...guardDeps, store })) implemented.add(k);
  for (const k of registerContractRoutes(app, API_PREFIX, {
    ...guardDeps,
    schedulerMinutes: deps.alertSchedulerMinutes,
  }))
    implemented.add(k);
  for (const k of registerReportingRoutes(app, API_PREFIX, guardDeps)) implemented.add(k);
  registerSpecStubs(app, API_PREFIX, guardDeps, implemented);
  return app;
}
