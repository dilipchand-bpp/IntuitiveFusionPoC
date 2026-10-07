/**
 * ESG and socio-economic target endpoints (NFR-R05): read the metrics with their checks, set a plan's own target within
 * bounds, enter a forecast, record an exception (procurement) and acknowledge it (delegate).
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AiProvider } from '../../adapters/ai-provider.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import { plan, planEsgTarget, request } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { PlanService } from '../plan/service.js';
import { loadSettings } from '../settings/settings.js';
import { ESG_METRICS, METRIC_BY_KEY, checkOverride, round2, type EsgKey } from './esg-rules.js';
import { computeTargets } from './esg-targets.js';

export interface EsgRouteDeps extends GuardDeps {
  ai: AiProvider;
}

const keyEnum = z.enum(ESG_METRICS.map((m) => m.key) as [EsgKey, ...EsgKey[]]);
const idParam = z.object({ id: z.string().uuid() });
const keyParam = z.object({ id: z.string().uuid(), key: keyEnum });
const text = (min: number) => z.string().trim().min(min).max(1000);
const putBody = z
  .object({
    target: z.number().min(0).max(1e6).optional(),
    resetTarget: z.boolean().optional(),
    forecast: z.number().min(0).max(1e6).nullable().optional(),
    overrideReason: text(10).optional(),
    approverNote: text(10).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change' });
const exceptionBody = z.object({ reason: text(10) }).strict();
const ackBody = z.object({ note: z.string().trim().max(500).optional() }).strict();

const READERS = ['REQUESTER', 'PROCUREMENT', 'DELEGATE', 'LEGAL', 'PROBITY', 'EXEC', 'FINANCE'] as const;

export function registerEsgTargetRoutes(app: FastifyInstance, p: string, d: EsgRouteDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const svc = new PlanService(d.clock, d.audit, d.ai);

  async function load(tx: Tx, a: { user: { tenantId: string; id: string; roles: string[] } }, id: string) {
    const [pl] = await tx
      .select()
      .from(plan)
      .where(and(eq(plan.id, id), eq(plan.tenantId, a.user.tenantId)));
    if (!pl) throw new AppError(404, 'NOT_FOUND', 'Plan not found');
    const [r] = await tx.select().from(request).where(eq(request.id, pl.requestId));
    if (a.user.roles.length === 1 && a.user.roles[0] === 'REQUESTER' && r?.requesterId !== a.user.id)
      throw new AppError(404, 'NOT_FOUND', 'Plan not found');
    return { pl, r: r! };
  }

  const canChange = (a: { user: { id: string; roles: string[] } }, requesterId: string) =>
    a.user.roles.includes('PROCUREMENT') || (a.user.roles.includes('REQUESTER') && requesterId === a.user.id);

  async function upsert(
    tx: Tx,
    tenantId: string,
    planId: string,
    key: EsgKey,
    org: number,
    set: Partial<typeof planEsgTarget.$inferInsert>,
    by: string,
    now: Date,
  ) {
    await tx
      .insert(planEsgTarget)
      .values({
        tenantId,
        planId,
        metricKey: key,
        target: String(org),
        source: 'DEFAULT',
        updatedBy: by,
        updatedAt: now,
        ...set,
      })
      .onConflictDoUpdate({
        target: [planEsgTarget.planId, planEsgTarget.metricKey],
        set: { ...set, updatedBy: by, updatedAt: now },
      });
  }

  const view = async (tx: Tx, a: { user: { tenantId: string; id: string; roles: string[] } }, id: string) => {
    const { pl, r } = await load(tx, a, id);
    const v = await computeTargets(tx, pl);
    const roles = a.user.roles;
    return {
      ...v,
      locked: pl.locked,
      planStatus: pl.status,
      canEdit: !pl.locked && canChange(a, r.requesterId),
      canRecordException: !pl.locked && roles.includes('PROCUREMENT'),
      canAcknowledge:
        !pl.locked && (roles.includes('DELEGATE') || roles.includes('EXEC')) && r.requesterId !== a.user.id,
      simulated: false as const,
    };
  };

  reg('GET', '/plans/{id}/esg-targets');
  app.get(`${p}/plans/:id/esg-targets`, { preHandler: guard(d, READERS) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    return withContext(d.database, a.ctx, (tx) => view(tx, a, id));
  });

  reg('PUT', '/plans/{id}/esg-targets/{key}');
  app.put(
    `${p}/plans/:id/esg-targets/:key`,
    { preHandler: guard(d, ['PROCUREMENT', 'REQUESTER']) },
    async (req) => {
      const a = req.auth!;
      const { id, key } = parse(keyParam, req.params);
      const b = parse(putBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const { pl, r } = await load(tx, a, id);
        if (!canChange(a, r.requesterId)) throw new AppError(404, 'NOT_FOUND', 'Plan not found');
        if (pl.locked) throw new AppError(423, 'PLAN_LOCKED', 'This plan is approved and locked');
        const settings = await loadSettings(tx, a.user.tenantId);
        const def = METRIC_BY_KEY.get(key)!;
        const org = settings.esgPlan.limits[key];
        const now = d.clock.now();
        const before = (await computeTargets(tx, pl, settings)).metrics.find((m) => m.key === key)!;
        const set: Partial<typeof planEsgTarget.$inferInsert> = {};

        if (b.resetTarget) {
          Object.assign(set, {
            target: String(org),
            source: 'DEFAULT',
            isOverride: false,
            overrideReason: null,
            approverNote: null,
          });
        } else if (b.target !== undefined) {
          const chk = checkOverride(def, org, b.target, settings.esgPlan.maxRelaxationPct);
          if (!chk.ok)
            throw new AppError(422, 'ESG_OVERRIDE_OUT_OF_BOUNDS', chk.error ?? 'Outside the allowed bounds');
          if (chk.relaxes && (!b.overrideReason || !b.approverNote))
            throw new AppError(
              422,
              'ESG_OVERRIDE_NEEDS_REASON',
              `This is looser than the organisation ${def.kind === 'FLOOR' ? 'target' : 'ceiling'} of ${org}. Give a reason and an approver note.`,
              [
                ...(b.overrideReason
                  ? []
                  : [{ field: 'overrideReason', message: 'A reason of at least 10 characters is required' }]),
                ...(b.approverNote
                  ? []
                  : [{ field: 'approverNote', message: 'Say who approved it, in at least 10 characters' }]),
              ],
            );
          const value = round2(b.target);
          Object.assign(set, {
            target: String(value),
            source: chk.relaxes ? 'OVERRIDE' : value === org ? 'DEFAULT' : 'PLAN',
            isOverride: chk.relaxes,
            overrideReason: chk.relaxes ? b.overrideReason : null,
            approverNote: chk.relaxes ? b.approverNote : null,
          });
        }
        if (b.forecast !== undefined)
          Object.assign(set, { forecast: b.forecast === null ? null : String(round2(b.forecast)) });
        // an exception was granted for the figures as they stood: changing the limit or the forecast withdraws it
        if (b.target !== undefined || b.resetTarget || b.forecast !== undefined)
          Object.assign(set, {
            exceptionReason: null,
            exceptionBy: null,
            exceptionAt: null,
            acknowledgedBy: null,
            acknowledgedAt: null,
          });
        await upsert(tx, a.user.tenantId, id, key, org, set, a.user.id, now);
        const after = (await computeTargets(tx, pl, settings)).metrics.find((m) => m.key === key)!;
        await tx
          .update(planEsgTarget)
          .set({ actual: after.actual === null ? null : String(after.actual) })
          .where(and(eq(planEsgTarget.planId, id), eq(planEsgTarget.metricKey, key)));
        await d.audit.record(tx, a.ctx, {
          action: 'plan.esg_target_update',
          entityType: 'plan',
          entityId: id,
          before: { metric: key, limit: before.limit, forecast: before.forecast, status: before.status },
          after: {
            metric: key,
            limit: after.limit,
            forecast: after.forecast,
            status: after.status,
            source: after.source,
            reason: after.overrideReason,
            approverNote: after.approverNote,
          },
        });
        await svc.advance(tx, a.ctx, id);
        return view(tx, a, id);
      });
    },
  );

  reg('POST', '/plans/{id}/esg-targets/{key}/exception');
  app.post(
    `${p}/plans/:id/esg-targets/:key/exception`,
    { preHandler: guard(d, ['PROCUREMENT']) },
    async (req) => {
      const a = req.auth!;
      const { id, key } = parse(keyParam, req.params);
      const b = parse(exceptionBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const { pl } = await load(tx, a, id);
        if (pl.locked) throw new AppError(423, 'PLAN_LOCKED', 'This plan is approved and locked');
        const settings = await loadSettings(tx, a.user.tenantId);
        const m = (await computeTargets(tx, pl, settings)).metrics.find((x) => x.key === key)!;
        if (m.status !== 'BREACH')
          throw new AppError(409, 'NOT_IN_BREACH', 'An exception is only needed for a metric in breach');
        await upsert(
          tx,
          a.user.tenantId,
          id,
          key,
          settings.esgPlan.limits[key],
          {
            exceptionReason: b.reason,
            exceptionBy: a.user.id,
            exceptionAt: d.clock.now(),
            acknowledgedBy: null,
            acknowledgedAt: null,
          },
          a.user.id,
          d.clock.now(),
        );
        await d.audit.record(tx, a.ctx, {
          action: 'plan.esg_exception',
          entityType: 'plan',
          entityId: id,
          after: { metric: key, summary: m.summary, reason: b.reason },
        });
        await svc.notifyRoles(
          tx,
          a.user.tenantId,
          ['DELEGATE', 'EXEC'],
          'ESG exception to acknowledge',
          `${m.summary}. Reason: ${b.reason}`,
          `/app/plans/${pl.requestId}`,
        );
        return view(tx, a, id);
      });
    },
  );

  reg('POST', '/plans/{id}/esg-targets/{key}/acknowledge');
  app.post(
    `${p}/plans/:id/esg-targets/:key/acknowledge`,
    { preHandler: guard(d, ['DELEGATE', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      const { id, key } = parse(keyParam, req.params);
      parse(ackBody, req.body ?? {});
      return withContext(d.database, a.ctx, async (tx) => {
        const { pl, r } = await load(tx, a, id);
        if (pl.locked) throw new AppError(423, 'PLAN_LOCKED', 'This plan is approved and locked');
        if (r.requesterId === a.user.id)
          throw new AppError(
            403,
            'SOD_VIOLATION',
            'You raised this request, so someone else must acknowledge the exception',
          );
        const [row] = await tx
          .select()
          .from(planEsgTarget)
          .where(and(eq(planEsgTarget.planId, id), eq(planEsgTarget.metricKey, key)));
        if (!row?.exceptionReason)
          throw new AppError(
            409,
            'NO_EXCEPTION',
            'Procurement has not recorded an exception for this metric',
          );
        if (row.acknowledgedAt)
          throw new AppError(409, 'ALREADY_ACKNOWLEDGED', 'This exception is already acknowledged');
        const now = d.clock.now();
        await tx
          .update(planEsgTarget)
          .set({ acknowledgedBy: a.user.id, acknowledgedAt: now, updatedAt: now })
          .where(eq(planEsgTarget.id, row.id));
        await d.audit.record(tx, a.ctx, {
          action: 'plan.esg_exception_ack',
          entityType: 'plan',
          entityId: id,
          after: { metric: key, exceptionReason: row.exceptionReason },
        });
        await svc.advance(tx, a.ctx, id);
        return view(tx, a, id);
      });
    },
  );

  reg('POST', '/plans/{id}/esg-targets/apply-bids');
  app.post(
    `${p}/plans/:id/esg-targets/apply-bids`,
    { preHandler: guard(d, ['PROCUREMENT']) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(idParam, req.params);
      return withContext(d.database, a.ctx, async (tx) => {
        const { pl } = await load(tx, a, id);
        if (pl.locked) throw new AppError(423, 'PLAN_LOCKED', 'This plan is approved and locked');
        const settings = await loadSettings(tx, a.user.tenantId);
        const v = await computeTargets(tx, pl, settings);
        if (!v.bidSuggestion)
          throw new AppError(
            409,
            'NO_BIDS',
            'There are no submitted bids to estimate from, or the contract is already awarded',
          );
        const now = d.clock.now();
        let n = 0;
        for (const [k, act] of Object.entries(v.bidSuggestion) as Array<[EsgKey, { value: number | null }]>) {
          if (act.value === null) continue;
          await upsert(
            tx,
            a.user.tenantId,
            id,
            k,
            settings.esgPlan.limits[k],
            {
              forecast: String(round2(act.value)),
              exceptionReason: null,
              exceptionBy: null,
              exceptionAt: null,
              acknowledgedBy: null,
              acknowledgedAt: null,
            },
            a.user.id,
            now,
          );
          n += 1;
        }
        await d.audit.record(tx, a.ctx, {
          action: 'plan.esg_forecast_from_bids',
          entityType: 'plan',
          entityId: id,
          after: { metrics: n, basis: 'lowest-priced bid' },
        });
        await svc.advance(tx, a.ctx, id);
        return view(tx, a, id);
      });
    },
  );

  return done;
}
