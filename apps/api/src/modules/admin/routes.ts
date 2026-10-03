/**
 * Administration endpoints (M12b, US-ADM-01): delegations of authority, a read-only user list for choosing delegates,
 * and the contract alert lead times. Administrators change policy here but have no path to bid content (SEC-AC13).
 * A change to a limit applies to the very next approval or signature because the checks read the table live.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLE_NAMES, type Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext } from '../../db/client.js';
import {
  appUser,
  contract,
  delegation,
  notification,
  orgUnit,
  roleAssignment,
  tenant,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { iso, leadsFrom } from '../contract/dates.js';
import { rescheduleAlerts } from '../contract/record.js';

export interface AdminDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
}

const uuid = z.string().uuid();
const SCOPES = ['SOURCING_APPROVAL', 'CONTRACT_SIGNING', 'PUBLISH_PERMISSION'] as const;
const STAFF_ROLES = ROLE_NAMES.filter((r) => r !== 'SUPPLIER');
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const SCOPE_LABEL: Record<(typeof SCOPES)[number], string> = {
  SOURCING_APPROVAL: 'sourcing approval',
  CONTRACT_SIGNING: 'contract signing',
  PUBLISH_PERMISSION: 'permission to publish',
};

const createBody = z
  .object({
    scope: z.enum(SCOPES),
    userId: uuid.optional(),
    role: z.enum(STAFF_ROLES as [string, ...string[]]).optional(),
    maxValue: z.number().min(0).max(1e10),
    division: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .refine((b) => b.userId || b.role, { message: 'Choose a person or a role', path: ['userId'] });
const updateBody = z
  .object({ maxValue: z.number().min(0).max(1e10), active: z.boolean().optional() })
  .strict();
const leadsBody = z
  .object({
    expiry: z.number().int().min(1).max(365),
    notice: z.number().int().min(1).max(365),
    extension: z.number().int().min(1).max(365),
    milestone: z.number().int().min(1).max(365),
  })
  .strict();

export function registerAdminRoutes(app: FastifyInstance, p: string, d: AdminDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);

  // ------------------------------------------------------------ users (read only, to choose delegates)
  reg('GET', '/admin/users');
  app.get(`${p}/admin/users`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const users = await tx
        .select({ u: appUser, unit: orgUnit.name })
        .from(appUser)
        .leftJoin(orgUnit, eq(orgUnit.id, appUser.orgUnitId))
        .where(and(eq(appUser.tenantId, a.user.tenantId), isNull(appUser.supplierId)))
        .orderBy(asc(appUser.name));
      const roles = await tx
        .select()
        .from(roleAssignment)
        .where(eq(roleAssignment.tenantId, a.user.tenantId));
      return users.map(({ u, unit }) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        orgUnit: unit,
        active: u.active,
        roles: roles.filter((r) => r.userId === u.id).map((r) => r.role),
      }));
    });
  });

  // ------------------------------------------------------------ delegations (US-ADM-01)
  async function rows(tx: Parameters<Parameters<typeof withContext>[2]>[0], tenantId: string) {
    const list = await tx
      .select({ d: delegation, name: appUser.name })
      .from(delegation)
      .leftJoin(appUser, eq(appUser.id, delegation.userId))
      .where(eq(delegation.tenantId, tenantId))
      .orderBy(asc(delegation.scope), asc(delegation.createdAt));
    return list.map(({ d: x, name }) => ({
      id: x.id,
      scope: x.scope,
      role: x.role,
      userId: x.userId,
      userName: name,
      maxValue: Number(x.maxValue),
      division: x.division,
      active: x.active,
    }));
  }

  reg('GET', '/admin/delegations');
  app.get(`${p}/admin/delegations`, { preHandler: guard(d, ['ADMIN', 'EXEC']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, (tx) => rows(tx, a.user.tenantId));
  });

  reg('POST', '/admin/delegations');
  app.post(`${p}/admin/delegations`, { preHandler: guard(d, ['ADMIN']) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(createBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      let role = body.role;
      if (body.userId) {
        if (body.userId === a.user.id)
          throw new AppError(403, 'ROLE_SOD_VIOLATION', 'You cannot grant authority to yourself');
        const [u] = await tx
          .select()
          .from(appUser)
          .where(and(eq(appUser.id, body.userId), eq(appUser.tenantId, a.user.tenantId)));
        if (!u || u.supplierId) throw new AppError(404, 'NOT_FOUND', 'Person not found');
        const held = (
          await tx
            .select({ role: roleAssignment.role })
            .from(roleAssignment)
            .where(eq(roleAssignment.userId, u.id))
        ).map((r) => r.role as string);
        role =
          role && held.includes(role)
            ? role
            : (held.find((r) => r === 'DELEGATE' || r === 'EXEC') ?? held[0]);
        if (!role) throw new AppError(422, 'NO_ROLE', 'That person holds no role');
        const [dup] = await tx
          .select({ id: delegation.id })
          .from(delegation)
          .where(
            and(
              eq(delegation.tenantId, a.user.tenantId),
              eq(delegation.scope, body.scope),
              eq(delegation.userId, u.id),
              eq(delegation.active, true),
            ),
          );
        if (dup)
          throw new AppError(
            409,
            'DELEGATION_EXISTS',
            'That person already has an active limit for this scope; change it instead',
          );
      }
      const [row] = await tx
        .insert(delegation)
        .values({
          tenantId: a.user.tenantId,
          scope: body.scope,
          role: role as (typeof delegation.$inferInsert)['role'],
          userId: body.userId ?? null,
          maxValue: body.maxValue.toFixed(2),
          division: body.division ?? null,
          active: true,
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'delegation.create',
        entityType: 'delegation',
        entityId: row!.id,
        after: { scope: body.scope, userId: body.userId ?? null, role, maxValue: body.maxValue },
      });
      if (body.userId)
        await tx.insert(notification).values({
          tenantId: a.user.tenantId,
          userId: body.userId,
          title: 'You hold new authority',
          body: `Your ${SCOPE_LABEL[body.scope]} limit is ${aud.format(body.maxValue)}`,
          link: '/app/dashboard',
        });
      return (await rows(tx, a.user.tenantId)).find((x) => x.id === row!.id)!;
    });
    return reply.status(201).send(out);
  });

  reg('PUT', '/admin/delegations/{id}');
  app.put(`${p}/admin/delegations/:id`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const id = parse(z.object({ id: uuid }), req.params).id;
    const body = parse(updateBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [cur] = await tx
        .select()
        .from(delegation)
        .where(and(eq(delegation.id, id), eq(delegation.tenantId, a.user.tenantId)));
      if (!cur) throw new AppError(404, 'NOT_FOUND', 'Delegation not found');
      if (cur.userId === a.user.id)
        throw new AppError(403, 'ROLE_SOD_VIOLATION', 'You cannot change your own authority');
      const active = body.active ?? cur.active;
      await tx
        .update(delegation)
        .set({ maxValue: body.maxValue.toFixed(2), active, updatedAt: d.clock.now() })
        .where(eq(delegation.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'delegation.update',
        entityType: 'delegation',
        entityId: id,
        before: { maxValue: Number(cur.maxValue), active: cur.active },
        after: { maxValue: body.maxValue, active },
      });
      if (cur.userId)
        await tx.insert(notification).values({
          tenantId: a.user.tenantId,
          userId: cur.userId,
          title: 'Your authority changed',
          body: active
            ? `Your ${SCOPE_LABEL[cur.scope]} limit is now ${aud.format(body.maxValue)} (was ${aud.format(Number(cur.maxValue))})`
            : `Your ${SCOPE_LABEL[cur.scope]} authority was switched off`,
          link: '/app/dashboard',
        });
      return (await rows(tx, a.user.tenantId)).find((x) => x.id === id)!;
    });
  });

  // ------------------------------------------------------------ contract alert lead times
  reg('GET', '/admin/alert-settings');
  app.get(`${p}/admin/alert-settings`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const [t] = await tx
        .select({ config: tenant.config })
        .from(tenant)
        .where(eq(tenant.id, a.user.tenantId));
      return leadsFrom(t?.config);
    });
  });

  reg('PUT', '/admin/alert-settings');
  app.put(`${p}/admin/alert-settings`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const body = parse(leadsBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [t] = await tx.select().from(tenant).where(eq(tenant.id, a.user.tenantId));
      const before = leadsFrom(t?.config);
      await tx
        .update(tenant)
        .set({ config: { ...((t?.config as object | null) ?? {}), alertLeadDays: body } })
        .where(eq(tenant.id, a.user.tenantId));
      // scheduled alerts of executed contracts follow at once; alerts already sent stay as history
      const live = await tx
        .select()
        .from(contract)
        .where(
          and(
            eq(contract.tenantId, a.user.tenantId),
            eq(contract.status, 'EXECUTED'),
            isNull(contract.deletedAt),
            isNull(contract.parentId),
          ),
        );
      for (const c of live) await rescheduleAlerts(tx, c, iso(d.clock.now()));
      await d.audit.record(tx, a.ctx, {
        action: 'settings.alert_lead_days',
        entityType: 'tenant',
        entityId: a.user.tenantId,
        before: { ...before },
        after: { ...body, contractsRescheduled: live.length },
      });
      return body;
    });
  });

  return done;
}
