/**
 * Tenant endpoints (NFR-SC01): an administrator reads their own organisation's plan and use (`GET /usage`); a platform
 * operator, who is not a user of any tenant, lists and creates tenants and changes their usage plan with a token
 * (`X-Operator-Token`, compared in constant time with OPERATOR_TOKEN). With no OPERATOR_TOKEN configured the operator
 * endpoints do not exist (404).
 *
 * The operator routes are public as far as sessions go (no cookie, no CSRF); the token is their only credential, so they are
 * limited per client address like sign-in is, and every change is written to the audit log of the tenant it touches.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argon2Hash } from '@node-rs/argon2';
import { asc, eq, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '@if/shared';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, withSystem, type RequestContext } from '../../db/client.js';
import {
  appUser,
  connector,
  orgUnit,
  roleAssignment,
  tenant,
  tenantUsagePlan,
  usageCounter,
  usagePlan,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { DEFAULT_CONNECTORS } from '../b10conn/catalogue.js';
import type { Tenancy } from './tenancy.js';

export interface TenancyRouteDeps extends GuardDeps {
  config: AppConfig;
  tenancy: Tenancy;
  /** Requests per minute per client address for the operator routes (raised only by tests). */
  operatorRateLimitMax: number;
}

const createBody = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z][a-z0-9-]{2,40}$/,
        'Start with a letter; letters, digits and hyphens, 3 to 41 characters',
      ),
    name: z.string().trim().min(3).max(80),
    sector: z.enum(['PUBLIC', 'PRIVATE']).default('PRIVATE'),
    planKey: z.string().trim().min(2).max(40).default('STANDARD'),
    adminName: z.string().trim().min(2).max(80),
    adminEmail: z.string().trim().toLowerCase().email().max(254),
  })
  .strict();
const planBody = z.object({ planKey: z.string().trim().min(2).max(40) }).strict();
const idParam = z.object({ id: z.string().uuid() });

const sha = (s: string) => createHash('sha256').update(s).digest();

export function registerTenancyRoutes(app: FastifyInstance, p: string, d: TenancyRouteDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const { tenancy } = d;
  const operatorToken = d.config.OPERATOR_TOKEN;

  // ---------------------------------------------------------------- an administrator's own organisation
  reg('GET', '/usage');
  app.get(`${p}/usage`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const usage = await tenancy.usageFor(a.user.tenantId);
    const plans = await withContext(d.database, a.ctx, (tx) =>
      tx
        .select()
        .from(usagePlan)
        .where(or(isNull(usagePlan.tenantId), eq(usagePlan.tenantId, a.user.tenantId)))
        .orderBy(asc(usagePlan.requestsPerMinute)),
    );
    return {
      ...usage,
      plans: plans.map((x) => ({
        key: x.key,
        name: x.name,
        requestsPerMinute: x.requestsPerMinute,
        burst: x.burst,
        dailyRequests: x.dailyRequests,
        monthlyAiCalls: x.monthlyAiCalls,
        storageMb: x.storageMb,
        maxUsers: x.maxUsers,
        current: x.key === usage.plan.key,
      })),
      note: 'A plan is changed by the platform operator. Counts are batched and written every 30 seconds; this page writes them first.',
    };
  });

  // ---------------------------------------------------------------- the platform operator
  function checkToken(req: FastifyRequest): void {
    if (!operatorToken) throw new AppError(404, 'NOT_FOUND', 'Not found');
    const given = req.headers['x-operator-token'];
    // hash both sides so the comparison is the same length and takes the same time whatever is sent
    if (typeof given !== 'string' || !timingSafeEqual(sha(given), sha(operatorToken)))
      throw new AppError(401, 'OPERATOR_TOKEN_INVALID', 'The operator token is missing or wrong');
  }
  const opCfg = { config: { rateLimit: { max: d.operatorRateLimitMax, timeWindow: '1 minute' } } };
  const sysCtx = (tenantId: string, req: FastifyRequest): RequestContext => ({
    tenantId,
    userId: null,
    role: 'SYSTEM',
    correlationId: req.id,
  });

  async function planExists(
    tx: Parameters<Parameters<typeof withSystem>[1]>[0],
    key: string,
    tenantId: string | null,
  ) {
    const [row] = await tx.select().from(usagePlan).where(eq(usagePlan.key, key));
    return Boolean(row && (row.tenantId === null || row.tenantId === tenantId));
  }

  reg('GET', '/operator/tenants');
  app.get(`${p}/operator/tenants`, { ...opCfg, preHandler: guard(d, 'public') }, async (req) => {
    checkToken(req);
    await tenancy.flush();
    return withSystem(d.database, async (tx) => {
      const tenants = await tx.select().from(tenant).orderBy(asc(tenant.createdAt));
      const plans = await tx.select().from(usagePlan).orderBy(asc(usagePlan.requestsPerMinute));
      const assigned = await tx.select().from(tenantUsagePlan);
      const users = await tx
        .select({ t: appUser.tenantId, n: sql<number>`count(*)::int` })
        .from(appUser)
        .where(eq(appUser.active, true))
        .groupBy(appUser.tenantId);
      const day = d.clock.now().toISOString().slice(0, 10);
      const today = await tx.select().from(usageCounter).where(eq(usageCounter.day, day));
      return {
        tenants: tenants.map((t) => {
          const plan = assigned.find((x) => x.tenantId === t.id)?.planKey ?? null;
          const u = today.find((x) => x.tenantId === t.id);
          return {
            id: t.id,
            slug: t.slug,
            name: t.name,
            sector: t.sector,
            createdAt: t.createdAt.toISOString(),
            planKey: plan ?? 'ENTERPRISE',
            planAssigned: plan !== null,
            activeUsers: users.find((x) => x.t === t.id)?.n ?? 0,
            today: { requests: u?.requests ?? 0, throttled: u?.throttled ?? 0, aiCalls: u?.aiCalls ?? 0 },
          };
        }),
        plans: plans.map((x) => ({
          key: x.key,
          name: x.name,
          tenantId: x.tenantId,
          requestsPerMinute: x.requestsPerMinute,
          burst: x.burst,
          dailyRequests: x.dailyRequests,
          monthlyAiCalls: x.monthlyAiCalls,
          storageMb: x.storageMb,
          maxUsers: x.maxUsers,
        })),
      };
    });
  });

  reg('POST', '/operator/tenants');
  app.post(`${p}/operator/tenants`, { ...opCfg, preHandler: guard(d, 'public') }, async (req, reply) => {
    checkToken(req);
    const b = parse(createBody, req.body);
    const password = randomBytes(15).toString('base64url');
    const passwordHash = await argon2Hash(password);
    const now = d.clock.now();
    const out = await withSystem(d.database, async (tx) => {
      const [taken] = await tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, b.slug));
      if (taken)
        throw new AppError(409, 'TENANT_EXISTS', 'An organisation with that short name already exists');
      if (!(await planExists(tx, b.planKey, null)))
        throw new AppError(422, 'UNKNOWN_PLAN', `There is no usage plan called ${b.planKey}`);
      const [t] = await tx
        .insert(tenant)
        .values({ slug: b.slug, name: b.name, sector: b.sector, createdAt: now })
        .returning();
      const [unit] = await tx.insert(orgUnit).values({ tenantId: t!.id, name: 'Head office' }).returning();
      const [u] = await tx
        .insert(appUser)
        .values({
          tenantId: t!.id,
          email: b.adminEmail,
          name: b.adminName,
          orgUnitId: unit!.id,
          passwordHash,
        })
        .returning();
      await tx.insert(roleAssignment).values({ tenantId: t!.id, userId: u!.id, role: 'ADMIN' });
      await tx.insert(tenantUsagePlan).values({
        tenantId: t!.id,
        planKey: b.planKey,
        assignedAt: now,
        assignedBy: 'operator',
      });
      for (const c of DEFAULT_CONNECTORS)
        await tx.insert(connector).values({
          tenantId: t!.id,
          kind: c.kind,
          provider: c.provider,
          enabled: c.enabled,
          createdAt: now,
          updatedAt: now,
        });
      await d.audit.record(tx, sysCtx(t!.id, req), {
        action: 'tenant.create',
        entityType: 'tenant',
        entityId: t!.id,
        after: {
          slug: b.slug,
          name: b.name,
          plan: b.planKey,
          firstAdmin: b.adminEmail,
          by: 'platform operator',
        },
      });
      return { t: t!, u: u! };
    });
    return reply.status(201).send({
      tenant: { id: out.t.id, slug: out.t.slug, name: out.t.name, planKey: b.planKey },
      admin: { id: out.u.id, email: out.u.email, name: out.u.name },
      // shown once: only its hash is kept
      oneTimePassword: password,
      login: { tenant: out.t.slug, email: out.u.email },
      note: 'Give the one-time password to the administrator securely. It is not stored and cannot be shown again.',
    });
  });

  reg('PATCH', '/operator/tenants/{id}/plan');
  app.patch(`${p}/operator/tenants/:id/plan`, { ...opCfg, preHandler: guard(d, 'public') }, async (req) => {
    checkToken(req);
    const { id } = parse(idParam, req.params);
    const b = parse(planBody, req.body);
    const now = d.clock.now();
    const out = await withSystem(d.database, async (tx) => {
      const [t] = await tx.select().from(tenant).where(eq(tenant.id, id));
      if (!t) throw new AppError(404, 'NOT_FOUND', 'Organisation not found');
      if (!(await planExists(tx, b.planKey, id)))
        throw new AppError(422, 'UNKNOWN_PLAN', `There is no usage plan called ${b.planKey}`);
      const [before] = await tx.select().from(tenantUsagePlan).where(eq(tenantUsagePlan.tenantId, id));
      await tx
        .insert(tenantUsagePlan)
        .values({ tenantId: id, planKey: b.planKey, assignedAt: now, assignedBy: 'operator' })
        .onConflictDoUpdate({
          target: tenantUsagePlan.tenantId,
          set: { planKey: b.planKey, assignedAt: now, assignedBy: 'operator' },
        });
      await d.audit.record(tx, sysCtx(id, req), {
        action: 'tenant.plan_change',
        entityType: 'tenant',
        entityId: id,
        before: { plan: before?.planKey ?? null },
        after: { plan: b.planKey, by: 'platform operator' },
      });
      return t;
    });
    tenancy.invalidate(id);
    const plan = await tenancy.planFor(id);
    return { tenant: { id: out.id, slug: out.slug, name: out.name }, plan };
  });

  return done;
}
