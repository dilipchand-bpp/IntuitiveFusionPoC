/**
 * Administration of people and configuration (M13): users and roles (US-ADM-01), the workflow library with one
 * editable simple workflow (US-ADM-02), and the read-only template library (US-ADM-03). Administrators change who can
 * do what, but hold no path to bid content: ADMIN is an exclusive role (SEC-AC13).
 */
import { randomBytes } from 'node:crypto';
import { hash as argon2Hash } from '@node-rs/argon2';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLE_NAMES, type RoleName } from '@if/shared';
import { guard } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  appUser,
  orgUnit,
  roleAssignment,
  session,
  supplierActivation,
  template,
  workflow,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { hashToken } from '../tender/routes.js';
import type { AdminDeps } from './routes.js';
import { sweepGrants } from './grants.js';

const uuid = z.string().uuid();
const STAFF_ROLES = ROLE_NAMES.filter((r) => r !== 'SUPPLIER') as [RoleName, ...RoleName[]];
const DAY = 86_400_000;

/** Roles a person may hold together. ADMIN stands alone so that no administrator can also read bids or approve. */
export function roleSetProblem(roles: readonly string[]): string | null {
  if (roles.length === 0) return 'Choose at least one role';
  if (roles.includes('ADMIN') && roles.length > 1)
    return 'Administrator cannot be combined with another role';
  return null;
}

const rolesField = z.array(z.enum(STAFF_ROLES)).min(1).max(5);
const createBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(200),
    roles: rolesField,
    orgUnitId: uuid.optional(),
  })
  .strict();
const updateBody = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    roles: rolesField.optional(),
    active: z.boolean().optional(),
    orgUnitId: uuid.nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change' });
const workflowBody = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    steps: z
      .array(z.object({ label: z.string().trim().min(1).max(60), mandatory: z.boolean() }).strict())
      .min(2)
      .max(12),
  })
  .strict();

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function registerAdminDirectory(
  app: FastifyInstance,
  p: string,
  d: AdminDeps,
  reg: (m: string, path: string) => void,
) {
  const uid = (req: { params: unknown }) => parse(z.object({ id: uuid }), req.params).id;

  async function userRows(tx: Tx, tenantId: string, onlyId?: string) {
    const users = await tx
      .select({ u: appUser, unit: orgUnit.name })
      .from(appUser)
      .leftJoin(orgUnit, eq(orgUnit.id, appUser.orgUnitId))
      .where(
        and(
          eq(appUser.tenantId, tenantId),
          isNull(appUser.supplierId),
          ...(onlyId ? [eq(appUser.id, onlyId)] : []),
        ),
      )
      .orderBy(asc(appUser.name));
    const roles = await tx.select().from(roleAssignment).where(eq(roleAssignment.tenantId, tenantId));
    const pending = await tx
      .select()
      .from(supplierActivation)
      .where(eq(supplierActivation.tenantId, tenantId));
    const now = d.clock.now();
    return users.map(({ u, unit }) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      orgUnit: unit,
      orgUnitId: u.orgUnitId,
      active: u.active,
      roles: roles.filter((r) => r.userId === u.id && (!r.expiresAt || r.expiresAt > now)).map((r) => r.role),
      // roles that end on a date, shown so an administrator can see when access stops (SEC-A05)
      grants: roles
        .filter((r) => r.userId === u.id && r.expiresAt)
        .map((r) => ({ role: r.role, expiresAt: r.expiresAt!.toISOString(), ended: r.expiresAt! <= now })),
      awaitingActivation: pending.some((x) => x.userId === u.id && !x.usedAt && x.expiresAt > now),
    }));
  }

  async function issueLink(tx: Tx, tenantId: string, userId: string, createdBy: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(d.clock.now().getTime() + 7 * DAY);
    await tx
      .insert(supplierActivation)
      .values({ tenantId, userId, tokenHash: hashToken(token), expiresAt, createdBy });
    return { activationPath: `/activate?token=${token}`, expiresAt: expiresAt.toISOString() };
  }

  async function adminCount(tx: Tx, tenantId: string, excluding?: string) {
    const rows = await tx
      .select({ userId: roleAssignment.userId })
      .from(roleAssignment)
      .innerJoin(appUser, eq(appUser.id, roleAssignment.userId))
      .where(
        and(
          eq(roleAssignment.tenantId, tenantId),
          eq(roleAssignment.role, 'ADMIN'),
          eq(appUser.active, true),
          ...(excluding ? [ne(appUser.id, excluding)] : []),
        ),
      );
    return new Set(rows.map((r) => r.userId)).size;
  }

  // ------------------------------------------------------------ users and roles (US-ADM-01)
  reg('GET', '/admin/users');
  app.get(`${p}/admin/users`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, (tx) => userRows(tx, a.user.tenantId));
  });

  reg('GET', '/admin/org-units');
  app.get(`${p}/admin/org-units`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) =>
      (
        await tx
          .select()
          .from(orgUnit)
          .where(eq(orgUnit.tenantId, a.user.tenantId))
          .orderBy(asc(orgUnit.name))
      ).map((o) => ({ id: o.id, name: o.name })),
    );
  });

  reg('POST', '/admin/users');
  app.post(`${p}/admin/users`, { preHandler: guard(d, ['ADMIN']) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(createBody, req.body);
    const problem = roleSetProblem(body.roles);
    if (problem) throw new AppError(422, 'ROLE_COMBINATION', problem, [{ field: 'roles', message: problem }]);
    const placeholder = await argon2Hash(randomBytes(32).toString('hex'));
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const [taken] = await tx
        .select({ id: appUser.id })
        .from(appUser)
        .where(and(eq(appUser.tenantId, a.user.tenantId), eq(appUser.email, body.email)));
      if (taken)
        throw new AppError(409, 'EMAIL_IN_USE', 'That email address already has an account', [
          { field: 'email', message: 'Use a different email address' },
        ]);
      if (body.orgUnitId) {
        const [ou] = await tx
          .select({ id: orgUnit.id })
          .from(orgUnit)
          .where(and(eq(orgUnit.id, body.orgUnitId), eq(orgUnit.tenantId, a.user.tenantId)));
        if (!ou) throw new AppError(404, 'NOT_FOUND', 'Organisation unit not found');
      }
      const now = d.clock.now();
      const [u] = await tx
        .insert(appUser)
        .values({
          tenantId: a.user.tenantId,
          email: body.email,
          name: body.name,
          passwordHash: placeholder,
          orgUnitId: body.orgUnitId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      for (const role of body.roles)
        await tx.insert(roleAssignment).values({ tenantId: a.user.tenantId, userId: u!.id, role });
      const link = await issueLink(tx, a.user.tenantId, u!.id, a.user.id);
      await d.audit.record(tx, a.ctx, {
        action: 'user.create',
        entityType: 'user',
        entityId: u!.id,
        after: { email: body.email, roles: body.roles, orgUnitId: body.orgUnitId ?? null },
      });
      return { user: (await userRows(tx, a.user.tenantId, u!.id))[0]!, ...link };
    });
    return reply.status(201).send(out);
  });

  reg('PUT', '/admin/users/{id}/role-expiry');
  app.put(`${p}/admin/users/:id/role-expiry`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const id = uid(req);
    const body = parse(
      z.object({ role: z.enum(STAFF_ROLES), expiresAt: z.string().datetime().nullable() }).strict(),
      req.body,
    );
    return withContext(d.database, a.ctx, async (tx) => {
      if (id === a.user.id) throw new AppError(403, 'FORBIDDEN', 'You cannot change your own access');
      const [g] = await tx
        .select()
        .from(roleAssignment)
        .where(
          and(
            eq(roleAssignment.userId, id),
            eq(roleAssignment.role, body.role),
            eq(roleAssignment.tenantId, a.user.tenantId),
          ),
        );
      if (!g) throw new AppError(404, 'NOT_FOUND', 'That person does not hold that role');
      if (body.role === 'ADMIN')
        throw new AppError(422, 'VALIDATION_FAILED', 'The administrator role cannot be time-bound', [
          { field: 'role', message: 'An administrator grant must not lapse on its own' },
        ]);
      const when = body.expiresAt ? new Date(body.expiresAt) : null;
      const now = d.clock.now();
      if (when && when <= now)
        throw new AppError(422, 'VALIDATION_FAILED', 'The end date must be in the future', [
          { field: 'expiresAt', message: 'Choose a later date' },
        ]);
      if (when && when.getTime() - now.getTime() > 2 * 365 * DAY)
        throw new AppError(422, 'VALIDATION_FAILED', 'At most two years ahead', [
          { field: 'expiresAt', message: 'A time-bound grant lasts at most two years' },
        ]);
      await tx
        .update(roleAssignment)
        .set({ expiresAt: when, grantedBy: a.user.id })
        .where(eq(roleAssignment.id, g.id));
      await d.audit.record(tx, a.ctx, {
        action: 'grant.expiry_set',
        entityType: 'app_user',
        entityId: id,
        before: { role: body.role, expiresAt: g.expiresAt?.toISOString() ?? null },
        after: { role: body.role, expiresAt: when?.toISOString() ?? null },
      });
      return (await userRows(tx, a.user.tenantId, id))[0]!;
    });
  });

  reg('POST', '/admin/grants/sweep');
  app.post(`${p}/admin/grants/sweep`, { preHandler: guard(d, ['ADMIN']) }, async () => ({
    ended: await sweepGrants(d.database, d.clock, d.audit, d.sessions),
  }));

  reg('PUT', '/admin/users/{id}');
  app.put(`${p}/admin/users/:id`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const id = uid(req);
    const body = parse(updateBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [cur] = (await userRows(tx, a.user.tenantId, id)) ?? [];
      if (!cur) throw new AppError(404, 'NOT_FOUND', 'User not found');
      const self = id === a.user.id;
      if (self && (body.roles || body.active === false))
        throw new AppError(
          403,
          'ROLE_SOD_VIOLATION',
          'You cannot change your own roles or switch yourself off',
        );
      if (body.roles) {
        const problem = roleSetProblem(body.roles);
        if (problem)
          throw new AppError(422, 'ROLE_COMBINATION', problem, [{ field: 'roles', message: problem }]);
      }
      const wasAdmin = cur.roles.includes('ADMIN');
      const staysAdmin = (body.roles ?? cur.roles).includes('ADMIN') && (body.active ?? cur.active);
      if (wasAdmin && !staysAdmin && (await adminCount(tx, a.user.tenantId, id)) === 0)
        throw new AppError(409, 'LAST_ADMIN', 'There must always be at least one active administrator');
      if (body.orgUnitId) {
        const [ou] = await tx
          .select({ id: orgUnit.id })
          .from(orgUnit)
          .where(and(eq(orgUnit.id, body.orgUnitId), eq(orgUnit.tenantId, a.user.tenantId)));
        if (!ou) throw new AppError(404, 'NOT_FOUND', 'Organisation unit not found');
      }
      const now = d.clock.now();
      await tx
        .update(appUser)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          ...(body.orgUnitId !== undefined ? { orgUnitId: body.orgUnitId } : {}),
          updatedAt: now,
        })
        .where(eq(appUser.id, id));
      if (body.roles) {
        await tx.delete(roleAssignment).where(eq(roleAssignment.userId, id));
        for (const role of body.roles)
          await tx.insert(roleAssignment).values({ tenantId: a.user.tenantId, userId: id, role });
      }
      // a change of roles or a switch-off ends their sessions: the next request signs them in again with the new rights
      let revoked = 0;
      if (body.roles || body.active === false) {
        const live = await tx
          .update(session)
          .set({ revokedAt: now })
          .where(and(eq(session.userId, id), isNull(session.revokedAt)))
          .returning({ id: session.id });
        revoked = live.length;
      }
      const after = (await userRows(tx, a.user.tenantId, id))[0]!;
      await d.audit.record(tx, a.ctx, {
        action: 'user.update',
        entityType: 'user',
        entityId: id,
        before: { name: cur.name, roles: cur.roles, active: cur.active, orgUnitId: cur.orgUnitId },
        after: {
          name: after.name,
          roles: after.roles,
          active: after.active,
          orgUnitId: after.orgUnitId,
          sessionsEnded: revoked,
        },
      });
      return after;
    });
  });

  reg('POST', '/admin/users/{id}/activation-link');
  app.post(
    `${p}/admin/users/:id/activation-link`,
    { preHandler: guard(d, ['ADMIN']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = uid(req);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const [cur] = await userRows(tx, a.user.tenantId, id);
        if (!cur) throw new AppError(404, 'NOT_FOUND', 'User not found');
        // earlier unused links stop working
        await tx
          .update(supplierActivation)
          .set({ usedAt: d.clock.now() })
          .where(and(eq(supplierActivation.userId, id), isNull(supplierActivation.usedAt)));
        const link = await issueLink(tx, a.user.tenantId, id, a.user.id);
        await d.audit.record(tx, a.ctx, {
          action: 'user.activation_link',
          entityType: 'user',
          entityId: id,
          after: { expiresAt: link.expiresAt },
        });
        return link;
      });
      return reply.status(201).send(out);
    },
  );

  // ------------------------------------------------------------ workflow library (US-ADM-02)
  type Step = { key: string; label: string; mandatory: boolean };
  const stepsOf = (v: unknown): Step[] =>
    ((v as Array<Partial<Step>>) ?? []).map((s) => ({
      key: s.key ?? slug(s.label ?? ''),
      label: s.label ?? '',
      mandatory: s.mandatory ?? true,
    }));

  reg('GET', '/admin/workflows');
  app.get(`${p}/admin/workflows`, { preHandler: guard(d, ['ADMIN', 'PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) =>
      (
        await tx
          .select()
          .from(workflow)
          .where(eq(workflow.tenantId, a.user.tenantId))
          .orderBy(asc(workflow.id))
      ).map((w) => ({
        id: w.id,
        name: w.name,
        tier: w.tier,
        editable: w.editable,
        steps: stepsOf(w.steps),
      })),
    );
  });

  reg('PUT', '/admin/workflows/{id}');
  app.put(`${p}/admin/workflows/:id`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const id = parse(z.object({ id: z.string().min(1).max(60) }), req.params).id;
    const body = parse(workflowBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [w] = await tx
        .select()
        .from(workflow)
        .where(and(eq(workflow.id, id), eq(workflow.tenantId, a.user.tenantId)));
      if (!w) throw new AppError(404, 'NOT_FOUND', 'Workflow not found');
      if (!w.editable)
        throw new AppError(
          409,
          'NOT_EDITABLE',
          'Only the simple workflow can be edited in this release; others are coming soon',
        );
      const steps = body.steps.map((s) => ({ key: slug(s.label), label: s.label, mandatory: s.mandatory }));
      const keys = new Set(steps.map((s) => s.key));
      if (keys.size !== steps.length || keys.has(''))
        throw new AppError(422, 'DUPLICATE_STEP', 'Each step needs its own name', [
          { field: 'steps', message: 'Step names must be different' },
        ]);
      // Policy checkpoints: an approval step is mandatory and stays in the workflow
      const before = stepsOf(w.steps);
      const approvals = before.filter((s) => s.mandatory && /approv/i.test(s.label));
      for (const need of approvals) {
        const kept = steps.find((s) => /approv/i.test(s.label));
        if (!kept || !kept.mandatory)
          throw new AppError(
            422,
            'CHECKPOINT_REQUIRED',
            `The mandatory checkpoint "${need.label}" cannot be removed or made optional`,
            [{ field: 'steps', message: `Keep "${need.label}" as a mandatory step` }],
          );
      }
      await tx
        .update(workflow)
        .set({ steps, ...(body.name ? { name: body.name } : {}) })
        .where(eq(workflow.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'workflow.update',
        entityType: 'workflow',
        after: {
          id,
          name: body.name ?? w.name,
          steps: steps.map((s) => `${s.label}${s.mandatory ? '' : ' (optional)'}`),
          before: before.map((s) => s.label),
        },
      });
      return { id, name: body.name ?? w.name, tier: w.tier, editable: w.editable, steps };
    });
  });

  // ------------------------------------------------------------ template library (US-ADM-03, read only)
  reg('GET', '/admin/templates');
  app.get(
    `${p}/admin/templates`,
    { preHandler: guard(d, ['ADMIN', 'PROCUREMENT', 'LEGAL']) },
    async (req) => {
      const a = req.auth!;
      return withContext(d.database, a.ctx, async (tx) => {
        const rows = await tx
          .select()
          .from(template)
          .where(eq(template.tenantId, a.user.tenantId))
          .orderBy(asc(template.type), asc(template.name));
        return rows.map((t) => {
          const body = (t.body ?? {}) as {
            appliesTo?: string[];
            clauses?: Array<{ id: string; title: string; mandatory: boolean }>;
            extensions?: number[];
          };
          return {
            id: t.id,
            type: t.type,
            name: t.name,
            version: t.version,
            status: t.status,
            appliesTo: body.appliesTo ?? [],
            clauses: (body.clauses ?? []).map((c) => ({ id: c.id, title: c.title, mandatory: c.mandatory })),
          };
        });
      });
    },
  );
}
