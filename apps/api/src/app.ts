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
import { registerAdminRoutes } from './modules/admin/routes.js';
import { registerSecurityRoutes } from './auth/security-routes.js';
import { registerSettingsRoutes } from './modules/settings/routes.js';
import { registerIntakeExtras } from './modules/intake/extras-routes.js';
import { registerEsgRoutes } from './modules/plan/esg.js';
import { registerMigrationRoutes } from './modules/migration/routes.js';
import { registerHistoryImportRoutes } from './modules/cphist/routes.js';
import { registerTenderB8 } from './modules/b8/tender-b8.js';
import { AnalyticsStore } from './analytics/store.js';
import { registerAnalytics } from './modules/b9/analytics-routes.js';
import { registerSearch } from './modules/b9/search.js';
import { registerArtefacts, runDue as runArtefactsDue } from './modules/b9/artefacts.js';
import { registerActionItems } from './modules/b9/action-items.js';
import { registerBuying } from './modules/b9/buying.js';
import { registerNotesGrc } from './modules/b9/notes-grc.js';
import { registerDashboardPrefs } from './modules/b9/dashboard-routes.js';
import { registerFx } from './modules/b9/fx-routes.js';
import { registerProgress } from './modules/b9/progress.js';
import { registerApprovalLinks } from './modules/b8/approval-links.js';
import { registerSupplierB8Routes } from './modules/b8/supplier-b8.js';
import { registerAssistantRoutes } from './modules/assistant/routes.js';
import { registerCollabRoutes } from './modules/collab/routes.js';
import { registerReportingRoutes } from './modules/reporting/routes.js';
import { registerContractRoutes } from './modules/contract/routes.js';
import { registerEvaluationRoutes } from './modules/evaluation/routes.js';
import { registerPlanRoutes } from './modules/plan/routes.js';
import { AppError } from './http/errors.js';
import { registerShellRoutes } from './modules/shell.js';
import { SealedStore } from './modules/tender/files.js';
import { TenderService } from './modules/tender/service.js';
import { registerTenderRoutes } from './modules/tender/routes.js';
import { registerSupplierDirectory } from './modules/tender/supplier-directory.js';
import { registerSupplierRoutes } from './modules/tender/supplier-routes.js';
import { registerTenderB2 } from './modules/tender/b2-routes.js';
import { registerB10ai } from './modules/b10ai/index.js';
import { registerConnectors } from './modules/b10conn/routes.js';
import { registerB10b } from './modules/b10erp/index.js';
import { registerB10x } from './modules/b10x/index.js';
import { registerB11a } from './modules/b11enc/routes.js';
import { Tenancy, installThrottle, registerB11d } from './modules/b11prod/index.js';
import { installUploadGate } from './modules/b11enc/upload-gate.js';
import { KeyVault } from './modules/b11enc/vault.js';
import { registerB11b } from './modules/b11priv/index.js';
import { installB11auditHooks, registerB11audit } from './modules/b11audit/index.js';
import { registerCpAgent } from './modules/cpagent/index.js';
import { registerCpOcr } from './modules/cpocr/routes.js';
import { registerCpDraft } from './modules/cpdraft/index.js';
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
  /** The separate store reports read from (NFR-P05). Defaults to a new in-memory one. */
  analytics?: AnalyticsStore;
  /** Milliseconds between Procurement Copilot timer ticks (BCP). Off in tests unless a test sets it. */
  copilotTickMs?: number;
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
  // HSTS for a year with sub-domains (SEC-D01); browsers ignore it over plain http, so it is safe to send in development too
  await app.register(helmet, {
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: config.NODE_ENV === 'production' },
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  const audit = new AuditService(deps.clock);
  const idp = deps.idp ?? new MockIdentityProvider(deps.database, deps.clock, config.DEFAULT_TENANT_SLUG);
  const sessions = new SessionService(deps.database, deps.clock, idp, config.SESSION_SECRET);
  const guardDeps: GuardDeps = { database: deps.database, clock: deps.clock, audit, sessions };
  // every upload is scanned by one hook added to every route registered after this line (SEC-AP04)
  installUploadGate(app, { database: deps.database, audit, clock: deps.clock });

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
    if (status >= 500) (globalThis as { __lastErr?: unknown }).__lastErr = err;
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
  // Per-tenant request throttling and usage metering: signed-in calls take a token from their own tenant's bucket (NFR-SC01)
  const tenancy = new Tenancy(deps.database, deps.clock);
  installThrottle(app, tenancy, API_PREFIX);
  if (config.NODE_ENV !== 'test') tenancy.start();
  app.addHook('onClose', async () => tenancy.stop());
  // B11c hooks (access log, access policy guard, compliance re-check after settings changes) go in before the routes they watch
  const b11cDeps = { ...guardDeps, schedulerMinutes: deps.alertSchedulerMinutes };
  const accessRecorder = installB11auditHooks(app, b11cDeps);
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

  const authDeps = {
    ...guardDeps,
    config,
    idp,
    loginRateLimitMax: deps.loginRateLimitMax ?? 10,
  };
  const implemented = registerAuthRoutes(app, API_PREFIX, authDeps);
  for (const k of registerSecurityRoutes(app, API_PREFIX, authDeps)) implemented.add(k);
  implemented.add('GET /health');
  for (const k of registerShellRoutes(app, API_PREFIX, guardDeps)) implemented.add(k);
  const ai = deps.ai ?? new MockAiProvider();
  const erp = deps.erp ?? new MockErpBudgetService();
  for (const k of registerIntakeRoutes(app, API_PREFIX, { ...guardDeps, ai, erp })) implemented.add(k);
  for (const k of registerPlanRoutes(app, API_PREFIX, { ...guardDeps, ai })) implemented.add(k);
  const store = new SealedStore(config.STORAGE_DIR, config.SESSION_SECRET);
  store.useVault(new KeyVault(deps.database, deps.clock)); // new files are sealed per tenant with envelope encryption (SEC-D04)
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
  for (const k of registerTenderB2(app, API_PREFIX, {
    ...guardDeps,
    store,
    config,
    publicRateLimitMax: deps.loginRateLimitMax ?? 20,
  }))
    implemented.add(k);
  for (const k of registerSupplierDirectory(app, API_PREFIX, {
    ...guardDeps,
    store,
    config,
    publicRateLimitMax: deps.loginRateLimitMax ?? 20,
  }))
    implemented.add(k);
  if (deps.alertSchedulerMinutes) {
    // Tenders close on their own when their time comes, even if nobody opens a page (the pages also close what is due)
    const closer = new TenderService(deps.clock, guardDeps.audit, store);
    const h = setInterval(
      () => void closer.closeDue(deps.database).catch(() => undefined),
      deps.alertSchedulerMinutes * 60_000,
    );
    h.unref();
    app.addHook('onClose', async () => clearInterval(h));
  }
  for (const k of registerEvaluationRoutes(app, API_PREFIX, { ...guardDeps, store })) implemented.add(k);
  for (const k of registerContractRoutes(app, API_PREFIX, {
    ...guardDeps,
    schedulerMinutes: deps.alertSchedulerMinutes,
    store,
    sessionSecret: config.SESSION_SECRET,
  }))
    implemented.add(k);
  for (const k of registerReportingRoutes(app, API_PREFIX, guardDeps)) implemented.add(k);
  for (const k of registerCollabRoutes(app, API_PREFIX, guardDeps)) implemented.add(k);
  for (const k of registerAssistantRoutes(app, API_PREFIX, guardDeps)) implemented.add(k);
  for (const k of registerTenderB8(app, API_PREFIX, {
    ...guardDeps,
    store,
    witnessRateLimitMax: deps.loginRateLimitMax ?? 10,
  }))
    implemented.add(k);
  for (const k of registerSupplierB8Routes(app, API_PREFIX, guardDeps)) implemented.add(k);
  for (const k of registerApprovalLinks(app, API_PREFIX, guardDeps)) implemented.add(k);
  for (const k of registerProgress(app, API_PREFIX, guardDeps)) implemented.add(k);
  for (const k of registerFx(app, API_PREFIX, guardDeps)) implemented.add(k);
  for (const k of registerDashboardPrefs(app, API_PREFIX, guardDeps)) implemented.add(k);
  for (const k of registerBuying(app, API_PREFIX, guardDeps)) implemented.add(k);
  for (const k of registerActionItems(app, API_PREFIX, guardDeps)) implemented.add(k);
  for (const k of registerArtefacts(app, API_PREFIX, guardDeps)) implemented.add(k);
  for (const k of registerSearch(app, API_PREFIX, guardDeps)) implemented.add(k);
  if (deps.alertSchedulerMinutes) {
    // batched artefacts are brought up to date on the same schedule as the alerts
    const h = setInterval(
      () =>
        void runArtefactsDue(deps.database, { audit, clock: deps.clock }, deps.clock.now()).catch(
          () => undefined,
        ),
      deps.alertSchedulerMinutes * 60_000,
    );
    h.unref();
    app.addHook('onClose', async () => clearInterval(h));
  }
  for (const k of registerNotesGrc(app, API_PREFIX, {
    ...guardDeps,
    defaultTenantSlug: config.DEFAULT_TENANT_SLUG,
  }))
    implemented.add(k);
  const analytics = deps.analytics ?? (await AnalyticsStore.open());
  if (!deps.analytics) app.addHook('onClose', async () => analytics.close());
  for (const k of registerAnalytics(app, API_PREFIX, { ...guardDeps, analytics })) implemented.add(k);
  for (const k of registerAdminRoutes(app, API_PREFIX, guardDeps)) implemented.add(k);
  for (const k of registerIntakeExtras(app, API_PREFIX, guardDeps)) implemented.add(k);
  for (const k of registerEsgRoutes(app, API_PREFIX, guardDeps)) implemented.add(k);
  for (const k of registerMigrationRoutes(app, API_PREFIX, guardDeps)) implemented.add(k);
  // CP-07 historical import: spreadsheet imports, saved mappings, dry run, commit and rollback (extends the CSV migration above)
  for (const k of registerHistoryImportRoutes(app, API_PREFIX, { ...guardDeps, analytics }))
    implemented.add(k);
  for (const k of registerSettingsRoutes(app, API_PREFIX, {
    ...guardDeps,
    schedulerMinutes: deps.alertSchedulerMinutes,
  }))
    implemented.add(k);
  for (const k of registerB10ai(app, API_PREFIX, guardDeps)) implemented.add(k);
  if (config.NODE_ENV === 'production' && !config.SECRET_STORE_KEY)
    throw new Error('SECRET_STORE_KEY is required in production (the local secret store has no key)');
  for (const k of registerConnectors(app, API_PREFIX, {
    ...guardDeps,
    secretKeyMaterial: config.SECRET_STORE_KEY ?? config.SESSION_SECRET,
    defaultTenantSlug: config.DEFAULT_TENANT_SLUG,
    schedulerMinutes: deps.alertSchedulerMinutes,
  }))
    implemented.add(k);
  for (const k of registerB10x(app, API_PREFIX, {
    ...guardDeps,
    schedulerMinutes: deps.alertSchedulerMinutes,
  }))
    implemented.add(k);
  for (const k of registerB10b(app, API_PREFIX, {
    ...guardDeps,
    defaultTenantSlug: config.DEFAULT_TENANT_SLUG,
    schedulerMinutes: deps.alertSchedulerMinutes,
  }))
    implemented.add(k);
  for (const k of registerB11a(app, API_PREFIX, {
    ...guardDeps,
    store,
    config,
    keyMaterial: config.SECRET_STORE_KEY ?? config.SESSION_SECRET,
  }))
    implemented.add(k);
  for (const k of registerB11b(app, API_PREFIX, {
    ...guardDeps,
    defaultTenantSlug: config.DEFAULT_TENANT_SLUG,
    schedulerMinutes: deps.alertSchedulerMinutes,
  }))
    implemented.add(k);
  for (const k of registerB11d(app, API_PREFIX, {
    ...guardDeps,
    ai,
    config,
    tenancy,
    schedulerMinutes: deps.alertSchedulerMinutes,
    operatorRateLimitMax: deps.loginRateLimitMax ?? 30,
  }))
    implemented.add(k);
  for (const k of registerB11audit(app, API_PREFIX, b11cDeps, accessRecorder)) implemented.add(k);
  // BCP cpdraft: drafting from voice or text and plain-language adjustment (CP-04, CP-05)
  for (const k of registerCpDraft(app, API_PREFIX, guardDeps)) implemented.add(k);
  // BCP cpocr: contract OCR and extraction (CP-07)
  for (const k of registerCpOcr(app, API_PREFIX, guardDeps)) implemented.add(k);
  // BCP: the Procurement Copilot runtime; it calls the routes above through app.inject as the person who started a run
  for (const k of registerCpAgent(app, API_PREFIX, {
    ...guardDeps,
    tickMs: deps.copilotTickMs ?? (config.NODE_ENV === 'test' ? 0 : config.COPILOT_TICK_SECONDS * 1000),
  }).done)
    implemented.add(k);
  registerSpecStubs(app, API_PREFIX, guardDeps, implemented);
  return app;
}
