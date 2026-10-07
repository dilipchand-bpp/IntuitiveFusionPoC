/**
 * SEC-AC09: the policy administration API, the "what can this person see" simulator and the per-record policy guard.
 * The engine is in policy-engine.ts; read the header there for what is and is not covered.
 */
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLE_NAMES } from '@if/shared';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  accessPolicy,
  accessTag,
  appUser,
  contract,
  evaluation,
  plan,
  request,
  roleAssignment,
  tender,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { baseVisibleRequests } from '../reporting/scope.js';
import {
  decide,
  expiredOrOff,
  explain,
  loadPolicies,
  resourcesFor,
  auditDecision,
  type PolicyAction,
  type PolicyRow,
  type PolicyUser,
} from './policy-engine.js';
import { UUID } from './util.js';

export const POLICY_READERS = ['ADMIN', 'PROBITY', 'EXEC'] as const;
const tag = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}$/, 'Lower-case letters, digits and dashes, for example hr-sensitive');

const selectorSchema = z
  .object({
    entityType: z.literal('request').optional(),
    businessUnit: z.string().trim().min(1).max(60).optional(),
    minValue: z.number().min(0).max(1e10).optional(),
    supplierId: z.string().uuid().optional(),
    tag: tag.optional(),
  })
  .strict();
const conditionsSchema = z
  .object({
    timeWindow: z
      .object({
        startHour: z.number().int().min(0).max(23),
        endHour: z.number().int().min(1).max(24),
        timeZone: z.string().max(60).optional(),
      })
      .strict()
      .optional(),
    requiresMfa: z.boolean().optional(),
  })
  .strict();
const createBody = z
  .object({
    name: z.string().trim().min(3).max(120),
    effect: z.enum(['DENY', 'ALLOW']),
    subjectType: z.enum(['ROLE', 'USER']),
    subject: z.string().trim().min(2).max(60),
    action: z.enum(['view', 'edit', 'approve', 'export']),
    selector: selectorSchema.default({}),
    conditions: conditionsSchema.default({}),
    reason: z.string().trim().min(5).max(500),
    priority: z.number().int().min(1).max(1000).default(100),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();
const reasonBody = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
const simulateBody = z
  .object({
    userId: z.string().uuid(),
    requestId: z.string().uuid(),
    action: z.enum(['view', 'edit', 'approve', 'export']),
    mfaVerified: z.boolean().optional(),
  })
  .strict();

const statusOf = (p: PolicyRow, now: Date) => expiredOrOff(p, now) ?? 'ACTIVE';

/** The procurement a per-record route is about, or null when the record belongs to none. */
async function requestIdFor(tx: Tx, tenantId: string, entity: string, id: string): Promise<string | null> {
  if (!UUID.test(id)) return null;
  if (entity === 'requests') return id;
  if (entity === 'plans') {
    const [r] = await tx
      .select({ r: plan.requestId })
      .from(plan)
      .where(and(eq(plan.id, id), eq(plan.tenantId, tenantId)));
    return r?.r ?? null;
  }
  if (entity === 'tenders') {
    const [r] = await tx
      .select({ r: tender.requestId })
      .from(tender)
      .where(and(eq(tender.id, id), eq(tender.tenantId, tenantId)));
    return r?.r ?? null;
  }
  if (entity === 'evaluations') {
    const [e] = await tx
      .select({ t: evaluation.tenderId })
      .from(evaluation)
      .where(and(eq(evaluation.id, id), eq(evaluation.tenantId, tenantId)));
    const tid = e?.t ?? id;
    const [r] = await tx
      .select({ r: tender.requestId })
      .from(tender)
      .where(and(eq(tender.id, tid), eq(tender.tenantId, tenantId)));
    return r?.r ?? null;
  }
  if (entity === 'contracts') {
    const [c] = await tx
      .select({ t: contract.tenderId })
      .from(contract)
      .where(and(eq(contract.id, id), eq(contract.tenantId, tenantId)));
    if (!c?.t) return null;
    const [r] = await tx
      .select({ r: tender.requestId })
      .from(tender)
      .where(and(eq(tender.id, c.t), eq(tender.tenantId, tenantId)));
    return r?.r ?? null;
  }
  return null;
}

export function actionFor(method: string, url: string): PolicyAction {
  if (url.includes('/export')) return 'export';
  if (method === 'GET' || method === 'HEAD') return 'view';
  if (/\/(approve|decision|sign|publish-permission|probity-signoff|submit-for-approval)(\/|$)/.test(url))
    return 'approve';
  return 'edit';
}

/** A global preHandler: the policy check for per-record routes and exports, before the route's own guard runs. */
export function installPolicyGuard(app: FastifyInstance, d: GuardDeps): void {
  const ENTITY = /^\/api\/v1\/(requests|plans|tenders|evaluations|contracts)\/:([A-Za-z]+)/;
  app.addHook('preHandler', async (req) => {
    const a = req.auth;
    const url = req.routeOptions?.url ?? '';
    if (!a || !url.startsWith('/api/v1/')) return;
    const isExport = url.includes('/export');
    const m = ENTITY.exec(url);
    if (!m && !isExport) return;
    const action = actionFor(req.method, url);
    const user: PolicyUser = { id: a.user.id, roles: a.user.roles, mfaVerified: a.mfaState === 'VERIFIED' };
    const now = d.clock.now();
    const verdict = await withContext(d.database, a.ctx, async (tx) => {
      const policies = (await loadPolicies(tx, a.user.tenantId)).filter((p) => p.action === action);
      if (policies.length === 0) return null;
      let rid: string | null = null;
      if (m)
        rid = await requestIdFor(
          tx,
          a.user.tenantId,
          m[1]!,
          String((req.params as Record<string, string>)[m[2]!] ?? ''),
        );
      else {
        const named = Object.values((req.params ?? {}) as Record<string, unknown>).find(
          (v) => typeof v === 'string' && UUID.test(v),
        ) as string | undefined;
        if (named) rid = await requestIdFor(tx, a.user.tenantId, 'requests', named);
      }
      let res = null;
      if (rid) {
        const [row] = await tx
          .select()
          .from(request)
          .where(and(eq(request.id, rid), eq(request.tenantId, a.user.tenantId)));
        if (row)
          res =
            (
              await resourcesFor(
                tx,
                a.user.tenantId,
                [row],
                policies.some((p) => (p.selector as { supplierId?: string }).supplierId),
              )
            )?.get(rid) ?? null;
      }
      const dec = decide(policies, user, action, res, now, true);
      return dec.kind === 'DENY_OVERRIDE' ? { dec, rid } : null;
    });
    if (!verdict) return;
    // written in its own transaction: the request ends in an error, which would roll a same-transaction record back
    await withContext(d.database, a.ctx, (tx) =>
      auditDecision(tx, a.ctx, verdict.dec, action, verdict.rid, false),
    );
    throw new AppError(403, 'POLICY_DENIED', 'An access policy does not allow this');
  });
}

export function registerPolicyRoutes(app: FastifyInstance, p: string, d: GuardDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const names = async (tx: Tx, tenantId: string) =>
    new Map(
      (
        await tx
          .select({ id: appUser.id, name: appUser.name })
          .from(appUser)
          .where(eq(appUser.tenantId, tenantId))
      ).map((u) => [u.id, u.name] as const),
    );

  const view = (r: PolicyRow, who: Map<string, string>, now: Date) => ({
    id: r.id,
    name: r.name,
    effect: r.effect,
    subjectType: r.subjectType,
    subject: r.subject,
    subjectLabel: r.subjectType === 'USER' ? (who.get(r.subject) ?? r.subject) : r.subject,
    action: r.action,
    selector: r.selector,
    conditions: r.conditions,
    reason: r.reason,
    priority: r.priority,
    status: statusOf(r, now),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdBy: who.get(r.createdBy) ?? null,
    createdAt: r.createdAt.toISOString(),
    disabledReason: r.disabledReason,
    deletedReason: r.deletedReason,
  });

  reg('GET', '/access/policies');
  app.get(`${p}/access/policies`, { preHandler: guard(d, [...POLICY_READERS]) }, async (req) => {
    const a = req.auth!;
    const q = parse(
      z.object({ includeInactive: z.enum(['true', 'false']).default('false') }).strict(),
      req.query,
    );
    return withContext(d.database, a.ctx, async (tx) => {
      const now = d.clock.now();
      const rows = await tx
        .select()
        .from(accessPolicy)
        .where(eq(accessPolicy.tenantId, a.user.tenantId))
        .orderBy(desc(accessPolicy.createdAt));
      const who = await names(tx, a.user.tenantId);
      const items = rows
        .map((r) => view(r, who, now))
        .filter((r) => q.includeInactive === 'true' || r.status === 'ACTIVE');
      return { items, canEdit: a.user.roles.includes('ADMIN') };
    });
  });

  reg('POST', '/access/policies');
  app.post(`${p}/access/policies`, { preHandler: guard(d, ['ADMIN']) }, async (req, reply) => {
    const a = req.auth!;
    const b = parse(createBody, req.body);
    if (b.subjectType === 'ROLE' && !(ROLE_NAMES as readonly string[]).includes(b.subject))
      throw new AppError(400, 'VALIDATION_FAILED', 'Request validation failed', [
        { field: 'subject', message: 'Not a role name' },
      ]);
    if (b.expiresAt && new Date(b.expiresAt) <= d.clock.now())
      throw new AppError(400, 'VALIDATION_FAILED', 'Request validation failed', [
        { field: 'expiresAt', message: 'Must be in the future' },
      ]);
    return withContext(d.database, a.ctx, async (tx) => {
      if (b.subjectType === 'USER') {
        const [u] = await tx
          .select({ id: appUser.id })
          .from(appUser)
          .where(and(eq(appUser.id, b.subject), eq(appUser.tenantId, a.user.tenantId)));
        if (!u)
          throw new AppError(400, 'VALIDATION_FAILED', 'Request validation failed', [
            { field: 'subject', message: 'No such person' },
          ]);
      }
      const [row] = await tx
        .insert(accessPolicy)
        .values({
          tenantId: a.user.tenantId,
          name: b.name,
          effect: b.effect,
          subjectType: b.subjectType,
          subject: b.subject,
          action: b.action,
          selector: b.selector,
          conditions: b.conditions,
          reason: b.reason,
          priority: b.priority,
          expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
          createdBy: a.user.id,
          createdAt: d.clock.now(),
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'policy.create',
        entityType: 'access_policy',
        entityId: row!.id,
        after: {
          name: b.name,
          effect: b.effect,
          subjectType: b.subjectType,
          subject: b.subject,
          action: b.action,
          selector: b.selector,
          conditions: b.conditions,
          priority: b.priority,
          expiresAt: b.expiresAt ?? null,
          reason: b.reason,
        },
      });
      reply.status(201);
      return view(row!, await names(tx, a.user.tenantId), d.clock.now());
    });
  });

  const load = async (tx: Tx, tenantId: string, id: string) => {
    const [row] = await tx
      .select()
      .from(accessPolicy)
      .where(and(eq(accessPolicy.id, id), eq(accessPolicy.tenantId, tenantId)));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Policy not found');
    return row;
  };
  const idParam = z.object({ id: z.string().uuid() });

  reg('POST', '/access/policies/{id}/disable');
  app.post(`${p}/access/policies/:id/disable`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const { reason } = parse(reasonBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const row = await load(tx, a.user.tenantId, id);
      if (row.deletedAt || !row.active) throw new AppError(409, 'INVALID_STATE', 'The policy is already off');
      const [u] = await tx
        .update(accessPolicy)
        .set({ active: false, disabledBy: a.user.id, disabledAt: d.clock.now(), disabledReason: reason })
        .where(eq(accessPolicy.id, id))
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'policy.disable',
        entityType: 'access_policy',
        entityId: id,
        after: { name: row.name, reason },
      });
      return view(u!, await names(tx, a.user.tenantId), d.clock.now());
    });
  });

  reg('DELETE', '/access/policies/{id}');
  app.delete(`${p}/access/policies/:id`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const { reason } = parse(reasonBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const row = await load(tx, a.user.tenantId, id);
      if (row.deletedAt) throw new AppError(409, 'INVALID_STATE', 'The policy is already deleted');
      const [u] = await tx
        .update(accessPolicy)
        .set({ active: false, deletedBy: a.user.id, deletedAt: d.clock.now(), deletedReason: reason })
        .where(eq(accessPolicy.id, id))
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'policy.delete',
        entityType: 'access_policy',
        entityId: id,
        after: { name: row.name, reason },
      });
      return view(u!, await names(tx, a.user.tenantId), d.clock.now());
    });
  });

  // ------------------------------------------------------------------ tags a policy can select on
  reg('GET', '/access/tags');
  app.get(`${p}/access/tags`, { preHandler: guard(d, [...POLICY_READERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select({
          id: accessTag.id,
          requestId: accessTag.requestId,
          tag: accessTag.tag,
          number: request.number,
          title: request.title,
        })
        .from(accessTag)
        .innerJoin(request, eq(request.id, accessTag.requestId))
        .where(eq(accessTag.tenantId, a.user.tenantId));
      return { items: rows };
    });
  });
  reg('POST', '/access/tags');
  app.post(`${p}/access/tags`, { preHandler: guard(d, ['ADMIN']) }, async (req, reply) => {
    const a = req.auth!;
    const b = parse(z.object({ requestId: z.string().uuid(), tag }).strict(), req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [r] = await tx
        .select({ id: request.id })
        .from(request)
        .where(and(eq(request.id, b.requestId), eq(request.tenantId, a.user.tenantId)));
      if (!r) throw new AppError(404, 'NOT_FOUND', 'Procurement not found');
      const [dup] = await tx
        .select({ id: accessTag.id })
        .from(accessTag)
        .where(and(eq(accessTag.requestId, b.requestId), eq(accessTag.tag, b.tag)));
      if (dup) throw new AppError(409, 'ALREADY_TAGGED', 'The procurement already has that tag');
      const [row] = await tx
        .insert(accessTag)
        .values({
          tenantId: a.user.tenantId,
          requestId: b.requestId,
          tag: b.tag,
          createdBy: a.user.id,
          createdAt: d.clock.now(),
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'config.access_tag_add',
        entityType: 'request',
        entityId: b.requestId,
        after: { tag: b.tag },
      });
      reply.status(201);
      return { id: row!.id, requestId: b.requestId, tag: b.tag };
    });
  });
  reg('DELETE', '/access/tags/{id}');
  app.delete(`${p}/access/tags/:id`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(accessTag)
        .where(and(eq(accessTag.id, id), eq(accessTag.tenantId, a.user.tenantId)));
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Tag not found');
      await tx.delete(accessTag).where(eq(accessTag.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'config.access_tag_remove',
        entityType: 'request',
        entityId: row.requestId,
        after: { tag: row.tag },
      });
      return { removed: true };
    });
  });

  // ------------------------------------------------------------------ "what can this person see"
  reg('POST', '/access/policies/simulate');
  app.post(`${p}/access/policies/simulate`, { preHandler: guard(d, [...POLICY_READERS]) }, async (req) => {
    const a = req.auth!;
    const b = parse(simulateBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const now = d.clock.now();
      const [u] = await tx
        .select({ id: appUser.id, name: appUser.name })
        .from(appUser)
        .where(and(eq(appUser.id, b.userId), eq(appUser.tenantId, a.user.tenantId)));
      if (!u) throw new AppError(404, 'NOT_FOUND', 'Person not found');
      const [row] = await tx
        .select()
        .from(request)
        .where(and(eq(request.id, b.requestId), eq(request.tenantId, a.user.tenantId)));
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Procurement not found');
      const roles = (
        await tx
          .select({ role: roleAssignment.role })
          .from(roleAssignment)
          .where(
            and(
              eq(roleAssignment.userId, b.userId),
              or(isNull(roleAssignment.expiresAt), gt(roleAssignment.expiresAt, now)),
            ),
          )
      ).map((r) => r.role);
      const user: PolicyUser = { id: u.id, roles, mfaVerified: b.mfaVerified ?? false };
      // the role rules: for view this is the real scope rule; for the other actions the route guards decide, not a list
      const base = (
        await baseVisibleRequests(tx, { user: { id: u.id, tenantId: a.user.tenantId, roles } as never })
      ).rows;
      const defaultAllowed = b.action === 'view' ? base.some((r) => r.id === row.id) : true;
      const all = await tx.select().from(accessPolicy).where(eq(accessPolicy.tenantId, a.user.tenantId));
      const res = (await resourcesFor(tx, a.user.tenantId, [row], true)).get(row.id)!;
      const live = all.filter((x) => !expiredOrOff(x, now));
      const dec = decide(live, user, b.action, res, now, defaultAllowed);
      return {
        person: { id: u.id, name: u.name, roles },
        procurement: {
          id: row.id,
          number: row.number,
          title: row.title,
          businessUnit: row.businessUnit,
          value: res.value,
          tags: res.tags,
        },
        action: b.action,
        mfaVerified: user.mfaVerified,
        defaultAllowed,
        defaultNote:
          b.action === 'view'
            ? 'Role rules: who may see this procurement without any policy.'
            : 'Role rules for this action are enforced by each route, so the simulator assumes they allow it and shows only what the policies change.',
        decision: dec.allowed ? 'ALLOW' : 'DENY',
        decidedBy: dec.kind,
        policy: dec.policy
          ? {
              id: dec.policy.id,
              name: dec.policy.name,
              effect: dec.policy.effect,
              reason: dec.policy.reason,
              priority: dec.policy.priority,
            }
          : null,
        evaluated: all.map((x) => ({
          id: x.id,
          name: x.name,
          effect: x.effect,
          ...explain(x, user, b.action, res, now),
        })),
      };
    });
  });

  return done;
}
