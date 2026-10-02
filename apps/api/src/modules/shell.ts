/**
 * Routes that back the application shell: dashboard KPIs (US-RPT-01 frame) and notifications (US-PLT-04).
 * Reads run as the least-privilege app role with the caller's identity published for row level security.
 */
import { and, desc, eq, gte, lte, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard, type GuardDeps } from '../auth/guard.js';
import { withContext } from '../db/client.js';
import { alert, evaluation, notification, plan, request } from '../db/schema.js';
import { AppError, parse } from '../http/errors.js';

const STAFF = [
  'REQUESTER',
  'PROCUREMENT',
  'DELEGATE',
  'EVALUATOR',
  'CHAIR',
  'LEGAL',
  'CONTRACT_MGR',
  'PROBITY',
  'FINANCE',
  'ADMIN',
  'EXEC',
] as const;
const DAY = 86_400_000;

export function registerShellRoutes(app: FastifyInstance, p: string, d: GuardDeps): Set<string> {
  const done = new Set<string>();

  // GET /dashboard/kpis
  done.add('GET /dashboard/kpis');
  app.get(`${p}/dashboard/kpis`, { preHandler: guard(d, [...STAFF]) }, async (req) => {
    const a = req.auth!;
    const now = d.clock.now();
    const own = a.user.roles.length === 1 && a.user.roles[0] === 'REQUESTER'; // requesters see only their own requests
    return withContext(d.database, a.ctx, async (tx) => {
      const scope = own
        ? and(eq(request.tenantId, a.user.tenantId), eq(request.requesterId, a.user.id))
        : eq(request.tenantId, a.user.tenantId);
      const rows = await tx.select().from(request).where(scope);
      const active = rows.filter((r) => r.status !== 'COMPLETE');
      const done_ = rows.filter((r) => r.status === 'COMPLETE');
      const cycle = done_.length
        ? done_.reduce((s, r) => s + (r.updatedAt.getTime() - r.createdAt.getTime()) / DAY, 0) / done_.length
        : 0;

      const horizon = new Date(now.getTime() + 30 * DAY).toISOString().slice(0, 10);
      const [alerts] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(alert)
        .where(
          and(
            eq(alert.tenantId, a.user.tenantId),
            eq(alert.status, 'SCHEDULED'),
            gte(alert.triggerDate, now.toISOString().slice(0, 10)),
            lte(alert.triggerDate, horizon),
          ),
        );

      // "Waiting for me": what each role is expected to act on next.
      let pending = 0;
      const roles = a.user.roles;
      if (roles.includes('DELEGATE') || roles.includes('EXEC')) {
        const [x] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(plan)
          .where(and(eq(plan.tenantId, a.user.tenantId), eq(plan.status, 'AWAITING_APPROVAL')));
        pending += x?.n ?? 0;
      }
      if (roles.includes('CHAIR') || roles.includes('EVALUATOR')) {
        const [x] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(evaluation)
          .where(and(eq(evaluation.tenantId, a.user.tenantId), ne(evaluation.status, 'APPROVED')));
        pending += x?.n ?? 0;
      }
      if (roles.includes('REQUESTER'))
        pending += rows.filter((r) => r.status === 'DRAFT' && r.requesterId === a.user.id).length;

      const byPhase = Object.entries(
        active.reduce<Record<string, number>>((m, r) => ((m[r.phase] = (m[r.phase] ?? 0) + 1), m), {}),
      ).map(([phase, count]) => ({ phase, count }));

      return {
        activeProcurements: active.length,
        valueInFlight: active.reduce((s, r) => s + Number(r.estimatedValue ?? 0), 0),
        avgCycleDays: Math.round(cycle * 10) / 10,
        alertsDue: alerts?.n ?? 0,
        pendingMyAction: pending,
        byPhase,
        recent: [...rows]
          .sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime())
          .slice(0, 5)
          .map((r) => ({
            id: r.id,
            number: r.number,
            title: r.title,
            phase: r.phase,
            status: r.status,
            estimatedValue: Number(r.estimatedValue ?? 0),
            updatedAt: r.updatedAt.toISOString(),
          })),
      };
    });
  });

  // GET /notifications  (own only)
  done.add('GET /notifications');
  app.get(`${p}/notifications`, { preHandler: guard(d, 'any') }, async (req) => {
    const a = req.auth!;
    const rows = await withContext(d.database, a.ctx, (tx) =>
      tx
        .select()
        .from(notification)
        .where(and(eq(notification.tenantId, a.user.tenantId), eq(notification.userId, a.user.id)))
        .orderBy(desc(notification.createdAt))
        .limit(50),
    );
    return rows.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body ?? undefined,
      link: n.link ?? undefined,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    }));
  });

  // POST /notifications/:id/read  (own only; someone else's id looks like "not found", never "forbidden")
  done.add('POST /notifications/{id}/read');
  app.post(`${p}/notifications/:id/read`, { preHandler: guard(d, 'any') }, async (req, reply) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const updated = await withContext(d.database, a.ctx, (tx) =>
      tx
        .update(notification)
        .set({ read: true })
        .where(
          and(
            eq(notification.id, id),
            eq(notification.userId, a.user.id),
            eq(notification.tenantId, a.user.tenantId),
          ),
        )
        .returning({ id: notification.id }),
    );
    if (updated.length === 0) throw new AppError(404, 'NOT_FOUND', 'Notification not found');
    return reply.status(204).send();
  });

  return done;
}
