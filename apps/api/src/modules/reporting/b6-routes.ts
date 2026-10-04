/**
 * Reporting, roadmap batch B6: the procurement-wide schedule, role and hierarchy dashboards, performance (category spend,
 * maverick spend, savings and velocity), the supplier risk map, workload against capacity, spend by any dimension,
 * saved views, drill-down and plain-language questions.
 */
import { and, asc, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RoleName } from '@if/shared';
import { MockVendorRegistry } from '../../adapters/vendor-registry.js';
import { guard, type AuthContext } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  appUser,
  auditEvent,
  contract,
  contractHold,
  coiDeclaration,
  evaluation,
  invoice,
  legalMatter,
  orgUnit,
  plan,
  request,
  riskAssessment,
  riskItem,
  roleAssignment,
  savedView,
  scheduleItem,
  supplier,
  tender,
  workOrder,
  fundingEnvelope,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { addDays, daysBetween, iso } from '../contract/dates.js';
import { COUNTED, cumulativeValue } from '../contract/b5-service.js';
import { loadSettings } from '../settings/settings.js';
import {
  B6_MODEL,
  SCHEDULE_PHASES,
  SPEND_DIMENSIONS,
  defaultSchedule,
  delegateCalendar,
  overallLevel,
  parseQuestion,
  riskRating,
  shiftSchedule,
  supplierSignals,
  velocity,
  type Location,
  type PhaseTiming,
  type SchedulePhase,
  type Signal,
  type Slot,
  type SpendDimension,
} from './b6-rules.js';
import { visibleRequests } from './scope.js';
import type { ReportingDeps } from './routes.js';

type Req = typeof request.$inferSelect;
const uuid = z.string().uuid();
const r1 = (n: number) => Math.round(n * 10) / 10;
const NO_CATEGORY = 'No category';
const cat = (c: string | null) => (c ?? '').replace(/\s*\(.*\)\s*$/, '').trim() || NO_CATEGORY;
const REPORT_USERS: RoleName[] = [
  'EXEC',
  'FINANCE',
  'PROCUREMENT',
  'CONTRACT_MGR',
  'DELEGATE',
  'LEGAL',
  'PROBITY',
];
const ACTIVE = (r: Req) => r.status !== 'COMPLETE' && r.phase !== 'CLOSED';

const moveBody = z
  .object({ phase: z.enum(SCHEDULE_PHASES), deltaDays: z.number().int().min(-90).max(90) })
  .strict();
const locationBody = z
  .object({
    city: z.string().trim().min(2).max(80),
    state: z.string().trim().min(2).max(40),
    country: z.string().trim().min(2).max(60),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();
const viewBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    report: z.enum(['procurements', 'spend-by', 'ask', 'schedule', 'workload']),
    filters: z
      .record(z.string().max(40), z.union([z.string().max(300), z.number(), z.boolean()]))
      .default({}),
    shared: z.boolean().default(false),
  })
  .strict();
const askBody = z.object({ question: z.string().trim().min(3).max(300) }).strict();
const managerBody = z.object({ managerId: uuid.nullable() }).strict();

export function registerReportingB6(
  app: FastifyInstance,
  p: string,
  d: ReportingDeps,
  reg: (m: string, path: string) => void,
) {
  const today = () => iso(d.clock.now());
  const registry = new MockVendorRegistry();
  const names = async (tx: Tx, tenantId: string) =>
    new Map(
      (
        await tx
          .select({ id: appUser.id, name: appUser.name })
          .from(appUser)
          .where(eq(appUser.tenantId, tenantId))
      ).map((u) => [u.id, u.name]),
    );

  // ---------------------------------------------------------------- the schedule and drag-and-drop moves (FR-0595)
  async function slotsFor(tx: Tx, r: Req): Promise<{ slots: Slot[]; custom: boolean }> {
    const rows = await tx.select().from(scheduleItem).where(eq(scheduleItem.requestId, r.id));
    if (rows.length === SCHEDULE_PHASES.length)
      return {
        custom: true,
        slots: SCHEDULE_PHASES.map((ph) => {
          const x = rows.find((y) => y.phase === ph)!;
          return { phase: ph, startDate: x.startDate, endDate: x.endDate };
        }),
      };
    return { custom: false, slots: defaultSchedule(iso(r.createdAt)) };
  }

  reg('GET', '/reports/schedule');
  app.get(
    `${p}/reports/schedule`,
    { preHandler: guard(d, ['PROCUREMENT', 'EXEC', 'DELEGATE']) },
    async (req) => {
      const a = req.auth!;
      return withContext(d.database, a.ctx, async (tx) => {
        const { rows } = await visibleRequests(tx, a);
        const who = await names(tx, a.user.tenantId);
        const items = [];
        const calendar = [];
        for (const r of rows.filter(ACTIVE)) {
          const { slots, custom } = await slotsFor(tx, r);
          const cal = delegateCalendar(slots);
          items.push({
            requestId: r.id,
            number: r.number,
            title: r.title,
            manager: r.managerId ? (who.get(r.managerId) ?? null) : null,
            phase: r.phase,
            custom,
            slots,
            late: slots.some(
              (s) =>
                s.endDate < today() &&
                SCHEDULE_PHASES.indexOf(s.phase) >=
                  SCHEDULE_PHASES.indexOf(
                    (r.phase === 'CONTRACT_MGMT' ? 'CONTRACT_AWARD' : r.phase) as SchedulePhase,
                  ),
            ),
          });
          for (const c of cal) calendar.push({ ...c, number: r.number, requestId: r.id, title: r.title });
        }
        return {
          today: today(),
          items: items.sort(
            (x, y) =>
              x.slots[0]!.startDate.localeCompare(y.slots[0]!.startDate) || x.number.localeCompare(y.number),
          ),
          delegateCalendar: calendar.sort((x, y) => x.date.localeCompare(y.date)),
          canMove: a.user.roles.includes('PROCUREMENT'),
        };
      });
    },
  );

  reg('POST', '/reports/schedule/{requestId}/move');
  app.post(
    `${p}/reports/schedule/:requestId/move`,
    { preHandler: guard(d, ['PROCUREMENT']) },
    async (req) => {
      const a = req.auth!;
      const { requestId } = parse(z.object({ requestId: uuid }), req.params);
      const body = parse(moveBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const { rows } = await visibleRequests(tx, a);
        const r = rows.find((x) => x.id === requestId);
        if (!r) throw new AppError(404, 'NOT_FOUND', 'Procurement not found');
        const { slots } = await slotsFor(tx, r);
        const moved = shiftSchedule(slots, body.phase, body.deltaDays);
        if (!moved.ok) throw new AppError(422, 'SCHEDULE_CONFLICT', moved.message);
        await tx.delete(scheduleItem).where(eq(scheduleItem.requestId, requestId));
        for (const s of moved.slots)
          await tx.insert(scheduleItem).values({
            tenantId: a.user.tenantId,
            requestId,
            phase: s.phase,
            startDate: s.startDate,
            endDate: s.endDate,
          });
        const before = delegateCalendar(slots);
        const after = delegateCalendar(moved.slots);
        const changed = after.filter((x, i) => before[i]?.date !== x.date);
        await d.audit.record(tx, a.ctx, {
          action: 'schedule.move',
          entityType: 'request',
          entityId: requestId,
          before: { slots },
          after: { phase: body.phase, deltaDays: body.deltaDays, slots: moved.slots, delegateDates: after },
        });
        if (changed.length) {
          const delegates = await tx
            .select({ userId: roleAssignment.userId })
            .from(roleAssignment)
            .where(and(eq(roleAssignment.tenantId, a.user.tenantId), eq(roleAssignment.role, 'DELEGATE')));
          const { notification } = await import('../../db/schema.js');
          for (const u of new Set(delegates.map((x) => x.userId)))
            await tx.insert(notification).values({
              tenantId: a.user.tenantId,
              userId: u,
              title: 'Your calendar changed',
              body: `${r.number}: ${changed.map((c) => `${c.what} is now ${c.date}`).join('; ')}`,
              link: '/app/reports/schedule',
            });
        }
        return {
          requestId,
          slots: moved.slots,
          delegateCalendar: after,
          recalculated: moved.slots.length - SCHEDULE_PHASES.indexOf(body.phase),
        };
      });
    },
  );

  // ---------------------------------------------------------------- dashboards by role and hierarchy (FR-0600)
  const VIEWS: Array<{ view: string; title: string; roles: RoleName[] }> = [
    { view: 'procurement', title: 'Procurement team', roles: ['PROCUREMENT'] },
    { view: 'legal', title: 'Legal', roles: ['LEGAL'] },
    { view: 'delegate', title: 'Delegate', roles: ['DELEGATE'] },
    { view: 'executive', title: 'Executive', roles: ['EXEC'] },
    { view: 'finance', title: 'Finance', roles: ['FINANCE'] },
    { view: 'risk', title: 'Risk and compliance', roles: ['PROBITY'] },
    {
      view: 'division',
      title: 'Division or business unit',
      roles: ['PROCUREMENT', 'LEGAL', 'DELEGATE', 'EXEC', 'FINANCE', 'PROBITY', 'CONTRACT_MGR', 'ADMIN'],
    },
  ];
  const available = (roles: readonly string[]) => VIEWS.filter((v) => v.roles.some((r) => roles.includes(r)));

  /** The units whose procurements the caller may see: their own and those beneath it, unless the organisation is broad. */
  async function unitScope(tx: Tx, a: AuthContext) {
    const s = await loadSettings(tx, a.user.tenantId);
    const sees = a.user.roles.some((r) => r === 'EXEC' || r === 'PROCUREMENT');
    if (s.dashboards.visibility === 'BROAD' || sees)
      return { visibility: 'ALL' as const, units: null as string[] | null };
    const units = await tx.select().from(orgUnit).where(eq(orgUnit.tenantId, a.user.tenantId));
    const [me] = await tx.select().from(appUser).where(eq(appUser.id, a.user.id));
    const mine = new Set<string>(me?.orgUnitId ? [me.orgUnitId] : []);
    for (let grew = true; grew;) {
      grew = false;
      for (const u of units) {
        if (u.parentId && mine.has(u.parentId) && !mine.has(u.id)) {
          mine.add(u.id);
          grew = true;
        }
      }
    }
    return {
      visibility: 'HIERARCHY' as const,
      units: units.filter((u) => mine.has(u.id)).map((u) => u.name),
    };
  }

  reg('GET', '/dashboards');
  app.get(
    `${p}/dashboards`,
    {
      preHandler: guard(d, [
        'PROCUREMENT',
        'LEGAL',
        'DELEGATE',
        'EXEC',
        'FINANCE',
        'PROBITY',
        'CONTRACT_MGR',
        'ADMIN',
      ]),
    },
    async (req) => {
      const a = req.auth!;
      return withContext(d.database, a.ctx, async (tx) => {
        const sc = await unitScope(tx, a);
        return {
          views: available(a.user.roles).map((v) => ({ view: v.view, title: v.title })),
          visibility: sc.visibility,
          units: sc.units,
        };
      });
    },
  );

  reg('GET', '/dashboards/{view}');
  app.get(
    `${p}/dashboards/:view`,
    {
      preHandler: guard(d, [
        'PROCUREMENT',
        'LEGAL',
        'DELEGATE',
        'EXEC',
        'FINANCE',
        'PROBITY',
        'CONTRACT_MGR',
        'ADMIN',
      ]),
    },
    async (req) => {
      const a = req.auth!;
      const { view } = parse(
        z.object({
          view: z.enum(['procurement', 'legal', 'delegate', 'executive', 'finance', 'risk', 'division']),
        }),
        req.params,
      );
      if (!available(a.user.roles).some((v) => v.view === view))
        throw new AppError(404, 'NOT_FOUND', 'That dashboard is not one of yours');
      return withContext(d.database, a.ctx, async (tx) => {
        const sc = await unitScope(tx, a);
        const all = (await visibleRequests(tx, a)).rows;
        const inScope = (r: Req) =>
          !sc.units || sc.units.some((u) => u.toLowerCase() === (r.businessUnit ?? '').toLowerCase());
        const rows = all.filter(inScope);
        const active = rows.filter(ACTIVE);
        const value = (rs: Req[]) => rs.reduce((s, r) => s + Number(r.estimatedValue ?? 0), 0);
        const kpi = (label: string, v: number | string, detail?: string) => ({
          label,
          value: v,
          ...(detail ? { detail } : {}),
        });
        const table = (title: string, columns: string[], data: Array<Array<string | number>>) => ({
          title,
          columns,
          rows: data,
        });
        const by = (rs: Req[], f: (r: Req) => string) => {
          const m = new Map<string, { n: number; v: number }>();
          for (const r of rs)
            m.set(f(r), {
              n: (m.get(f(r))?.n ?? 0) + 1,
              v: (m.get(f(r))?.v ?? 0) + Number(r.estimatedValue ?? 0),
            });
          return [...m.entries()].sort((x, y) => y[1].v - x[1].v);
        };
        const contracts = await tx
          .select()
          .from(contract)
          .where(
            and(
              eq(contract.tenantId, a.user.tenantId),
              isNull(contract.deletedAt),
              isNull(contract.parentId),
            ),
          );
        const out: { kpis: ReturnType<typeof kpi>[]; tables: ReturnType<typeof table>[] } = {
          kpis: [],
          tables: [],
        };
        if (view === 'procurement') {
          const sched = [];
          for (const r of active) {
            const { slots } = await slotsFor(tx, r);
            if (
              slots.some(
                (s) =>
                  s.endDate < today() &&
                  SCHEDULE_PHASES.indexOf(s.phase) >=
                    SCHEDULE_PHASES.indexOf(
                      (r.phase === 'CONTRACT_MGMT' ? 'CONTRACT_AWARD' : r.phase) as SchedulePhase,
                    ),
              )
            )
              sched.push(r);
          }
          out.kpis = [
            kpi('Active procurements', active.length),
            kpi('Value in flight', Math.round(value(active))),
            kpi('Behind schedule', sched.length),
          ];
          out.tables = [
            table(
              'Active by phase',
              ['Phase', 'Procurements', 'Value'],
              by(active, (r) => r.phase).map(([k, v]) => [k, v.n, Math.round(v.v)]),
            ),
          ];
        } else if (view === 'legal') {
          const matters = await tx
            .select()
            .from(legalMatter)
            .where(eq(legalMatter.tenantId, a.user.tenantId));
          out.kpis = [
            kpi('Contracts in legal review', contracts.filter((c) => c.status === 'LEGAL_REVIEW').length),
            kpi(
              'Awaiting signature',
              contracts.filter((c) => ['AWAITING_SIGNATURE', 'PARTIALLY_SIGNED'].includes(c.status)).length,
            ),
            kpi('Open legal matters', matters.filter((m) => m.lane !== 'DONE').length),
          ];
          out.tables = [
            table(
              'Contracts by status',
              ['Status', 'Contracts'],
              [...new Set(contracts.map((c) => c.status))].map((s) => [
                s,
                contracts.filter((c) => c.status === s).length,
              ]),
            ),
          ];
        } else if (view === 'delegate') {
          const plans = await tx
            .select()
            .from(plan)
            .where(and(eq(plan.tenantId, a.user.tenantId), eq(plan.status, 'AWAITING_APPROVAL')));
          const env = await tx
            .select()
            .from(fundingEnvelope)
            .where(
              and(eq(fundingEnvelope.tenantId, a.user.tenantId), eq(fundingEnvelope.holderId, a.user.id)),
            );
          out.kpis = [
            kpi('Plans awaiting your approval', plans.length),
            kpi(
              'Contracts awaiting signature',
              contracts.filter((c) => ['AWAITING_SIGNATURE', 'PARTIALLY_SIGNED'].includes(c.status)).length,
            ),
            kpi('Funding envelopes you hold', env.length),
          ];
          out.tables = [
            table(
              'Your procurements by phase',
              ['Phase', 'Procurements', 'Value'],
              by(active, (r) => r.phase).map(([k, v]) => [k, v.n, Math.round(v.v)]),
            ),
          ];
        } else if (view === 'executive') {
          const executed = contracts.filter((c) => c.status === 'EXECUTED');
          const soon = executed.filter(
            (c) => c.endDate && c.endDate >= today() && c.endDate <= addDays(today(), 90),
          );
          out.kpis = [
            kpi('Pipeline value', Math.round(value(active))),
            kpi('Committed in contracts', Math.round(executed.reduce((s, c) => s + Number(c.value), 0))),
            kpi('Contracts ending in 90 days', soon.length),
          ];
          out.tables = [
            table(
              'Pipeline by category',
              ['Category', 'Procurements', 'Value'],
              by(active, (r) => cat(r.category))
                .slice(0, 8)
                .map(([k, v]) => [k, v.n, Math.round(v.v)]),
            ),
          ];
        } else if (view === 'finance') {
          const inv = await tx.select().from(invoice).where(eq(invoice.tenantId, a.user.tenantId));
          const holds = await tx
            .select()
            .from(contractHold)
            .where(and(eq(contractHold.tenantId, a.user.tenantId), isNull(contractHold.releasedAt)));
          const blocked = inv.filter((i) => i.status === 'BLOCKED');
          out.kpis = [
            kpi(
              'Invoices blocked',
              blocked.length,
              `${Math.round(blocked.reduce((s, i) => s + Number(i.amount), 0))} AUD held`,
            ),
            kpi(
              'Invoiced and counted',
              Math.round(
                inv
                  .filter((i) => (COUNTED as readonly string[]).includes(i.status))
                  .reduce((s, i) => s + Number(i.amount), 0),
              ),
            ),
            kpi('Insurance holds', holds.length),
          ];
          out.tables = [
            table(
              'Invoices by status',
              ['Status', 'Invoices'],
              ['MATCHED', 'BLOCKED', 'EXCEPTION', 'PAID'].map((s) => [
                s,
                inv.filter((i) => i.status === s).length,
              ]),
            ),
          ];
        } else if (view === 'risk') {
          const denied = await tx
            .select({ id: auditEvent.seq })
            .from(auditEvent)
            .where(
              and(
                eq(auditEvent.tenantId, a.user.tenantId),
                eq(auditEvent.result, 'DENIED'),
                gte(auditEvent.at, new Date(d.clock.now().getTime() - 30 * 86_400_000)),
              ),
            );
          const conflicts = await tx
            .select({ id: coiDeclaration.id })
            .from(coiDeclaration)
            .where(and(eq(coiDeclaration.tenantId, a.user.tenantId), eq(coiDeclaration.none, false)));
          const risks = await tx
            .select()
            .from(riskItem)
            .where(and(eq(riskItem.tenantId, a.user.tenantId), eq(riskItem.applicable, true)));
          const high = risks.filter((x) => riskRating(x.likelihood, x.impact)?.level === 'HIGH');
          out.kpis = [
            kpi('Refused actions in 30 days', denied.length),
            kpi('Conflicts declared', conflicts.length),
            kpi('High risks on assessments', high.length),
          ];
          out.tables = [
            table(
              'Evaluations by status',
              ['Status', 'Evaluations'],
              await (async () => {
                const ev = await tx.select().from(evaluation).where(eq(evaluation.tenantId, a.user.tenantId));
                return [...new Set(ev.map((e) => e.status))].map((s) => [
                  s,
                  ev.filter((e) => e.status === s).length,
                ]);
              })(),
            ),
          ];
        } else {
          out.kpis = [
            kpi('Procurements in your scope', rows.length),
            kpi('Active', active.length),
            kpi('Value in flight', Math.round(value(active))),
          ];
          out.tables = [
            table(
              'By business unit',
              ['Business unit', 'Procurements', 'Value'],
              by(rows, (r) => r.businessUnit ?? 'Unassigned').map(([k, v]) => [k, v.n, Math.round(v.v)]),
            ),
          ];
        }
        const title = VIEWS.find((v) => v.view === view)!.title;
        return {
          view,
          title,
          visibility: sc.visibility,
          units: sc.units,
          note: sc.units
            ? `Scoped to ${sc.units.join(', ')} and the units beneath, by the organisation hierarchy.`
            : 'Shows the whole organisation.',
          ...out,
        };
      });
    },
  );

  // ---------------------------------------------------------------- performance: spend, maverick, savings, velocity (FR-0605)
  reg('GET', '/reports/performance');
  app.get(
    `${p}/reports/performance`,
    { preHandler: guard(d, ['EXEC', 'FINANCE', 'PROCUREMENT']) },
    async (req) => {
      const a = req.auth!;
      return withContext(d.database, a.ctx, async (tx) => {
        const { rows } = await visibleRequests(tx, a);
        const ids = rows.map((r) => r.id);
        const tenders = ids.length
          ? await tx.select().from(tender).where(inArray(tender.requestId, ids))
          : [];
        const contracts = await tx
          .select()
          .from(contract)
          .where(and(eq(contract.tenantId, a.user.tenantId), isNull(contract.deletedAt)));
        const plans = ids.length ? await tx.select().from(plan).where(inArray(plan.requestId, ids)) : [];
        const evals = tenders.length
          ? await tx
              .select()
              .from(evaluation)
              .where(
                inArray(
                  evaluation.tenderId,
                  tenders.map((t) => t.id),
                ),
              )
          : [];
        const executed = contracts.filter((c) => c.status === 'EXECUTED' && !c.parentId && c.tenderId);
        // category spend: committed in executed contracts by the category of the request behind them
        const byCat = new Map<string, { committed: number; contracts: number }>();
        const savings = [];
        for (const c of executed) {
          const t = tenders.find((x) => x.id === c.tenderId);
          const r = t ? rows.find((x) => x.id === t.requestId) : undefined;
          if (!r) continue;
          const committed = await cumulativeValue(tx, c);
          const k = cat(r.category);
          byCat.set(k, {
            committed: (byCat.get(k)?.committed ?? 0) + committed,
            contracts: (byCat.get(k)?.contracts ?? 0) + 1,
          });
          const est = Number(r.estimatedValue ?? 0);
          if (est > 0)
            savings.push({
              number: r.number,
              title: r.title,
              estimate: est,
              awarded: Number(c.value),
              saved: Math.round((est - Number(c.value)) * 100) / 100,
            });
        }
        // maverick: invoices paid outside an approved contract, and purchases with no executed contract behind them
        const inv = await tx
          .select({ i: invoice, c: contract })
          .from(invoice)
          .innerJoin(contract, eq(contract.id, invoice.contractId))
          .where(eq(invoice.tenantId, a.user.tenantId));
        const outside = inv
          .filter((x) => x.i.status === 'EXCEPTION' || (x.i.status === 'PAID' && x.i.overrideBy))
          .map((x) => ({
            number: x.i.number,
            contract: x.c.number,
            amount: Number(x.i.amount),
            reason: x.i.overrideReason ?? 'Released outside the contract match',
          }));
        const withContract = new Set(
          executed.map((c) => tenders.find((t) => t.id === c.tenderId)?.requestId),
        );
        const offContract = rows
          .filter(
            (r) =>
              ['CONTRACT_MGMT', 'CLOSED'].includes(r.phase) && !withContract.has(r.id) && !r.linkedContractId,
          )
          .map((r) => ({ number: r.number, title: r.title, value: Number(r.estimatedValue ?? 0) }));
        // velocity: how long each phase took, and how long what is still in it has waited
        const timings: PhaseTiming[] = [];
        const days = (x: Date, y: Date) => Math.max(0, daysBetween(iso(x), iso(y)));
        const now = d.clock.now();
        for (const r of rows) {
          const pl = plans.find((x) => x.requestId === r.id);
          const t = tenders.find((x) => x.requestId === r.id);
          const ev = t ? evals.find((x) => x.tenderId === t.id) : undefined;
          const c = t ? contracts.find((x) => x.tenderId === t.id) : undefined;
          if (r.status !== 'DRAFT') {
            const done = !!pl;
            timings.push({
              phase: 'INTAKE',
              days: days(r.createdAt, done ? pl!.createdAt : now),
              open: !done && r.phase === 'INTAKE',
            });
          }
          if (pl) {
            const approved = pl.status === 'APPROVED_LOCKED';
            timings.push({
              phase: 'PLAN',
              days: days(pl.createdAt, approved ? pl.updatedAt : now),
              open: !approved && r.phase === 'PLAN',
            });
          }
          if (t) {
            const closed = ['CLOSED', 'EVALUATING', 'AWARDED'].includes(t.status);
            if (t.opensAt)
              timings.push({
                phase: 'TENDER',
                days: days(t.opensAt, closed && t.closesAt ? t.closesAt : now),
                open: !closed && r.phase === 'TENDER',
              });
          }
          if (ev) {
            const approved = ev.status === 'APPROVED';
            timings.push({
              phase: 'EVALUATION',
              days: days(ev.createdAt, approved ? ev.updatedAt : now),
              open: !approved && r.phase === 'EVALUATION',
            });
          }
          if (c) {
            const exec = c.status === 'EXECUTED';
            timings.push({
              phase: 'CONTRACT_AWARD',
              days: days(c.createdAt, exec ? c.updatedAt : now),
              open: !exec,
            });
          }
        }
        return {
          categorySpend: [...byCat.entries()]
            .map(([category, v]) => ({ category, ...v }))
            .sort((x, y) => y.committed - x.committed),
          maverick: {
            invoicesOutsideContract: outside,
            offContractPurchases: offContract,
            total:
              Math.round(
                (outside.reduce((s, x) => s + x.amount, 0) + offContract.reduce((s, x) => s + x.value, 0)) *
                  100,
              ) / 100,
          },
          savings: {
            items: savings.sort((x, y) => y.saved - x.saved),
            captured:
              Math.round(savings.filter((s) => s.saved > 0).reduce((s, x) => s + x.saved, 0) * 100) / 100,
            overruns:
              Math.round(savings.filter((s) => s.saved < 0).reduce((s, x) => s + x.saved, 0) * 100) / 100,
          },
          velocity: velocity(timings),
          note: 'Savings are the approved estimate less the awarded value. Phase times come from when each record was created and reached its end state.',
        };
      });
    },
  );

  // ---------------------------------------------------------------- supplier risk map (FR-0610)
  reg('GET', '/reports/supplier-risk');
  app.get(
    `${p}/reports/supplier-risk`,
    { preHandler: guard(d, ['PROCUREMENT', 'EXEC', 'FINANCE', 'PROBITY']) },
    async (req) => {
      const a = req.auth!;
      return withContext(d.database, a.ctx, async (tx) => {
        const sups = await tx.select().from(supplier).where(eq(supplier.tenantId, a.user.tenantId));
        const contracts = await tx
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
        const reqs = (await visibleRequests(tx, a)).rows;
        const tenders = reqs.length
          ? await tx
              .select()
              .from(tender)
              .where(
                inArray(
                  tender.requestId,
                  reqs.map((r) => r.id),
                ),
              )
          : [];
        const month = d.clock.now().getUTCMonth() + 1;
        const items: Array<{
          supplierId: string;
          company: string;
          location: Location | null;
          committed: number;
          categories: string[];
          signals: Signal[];
          level: string;
        }> = [];
        const catSuppliers = new Map<string, Set<string>>();
        for (const s of sups) {
          const mine = contracts.filter((c) => c.supplierId === s.id);
          if (mine.length === 0 && !s.location) continue;
          const cats = new Set<string>();
          for (const c of mine) {
            const t = tenders.find((x) => x.id === c.tenderId);
            const r = t ? reqs.find((x) => x.id === t.requestId) : undefined;
            if (r) cats.add(cat(r.category));
          }
          for (const k of cats) catSuppliers.set(k, (catSuppliers.get(k) ?? new Set()).add(s.id));
          const loc = s.location as Location | null;
          const fin = await registry.financialRisk(s.abn, s.company);
          const signals = loc ? supplierSignals(loc, month, fin) : [];
          items.push({
            supplierId: s.id,
            company: s.company,
            location: loc,
            committed: mine.reduce((n, c) => n + Number(c.value), 0),
            categories: [...cats],
            signals,
            level: loc ? overallLevel(signals) : 'UNKNOWN',
          });
        }
        const single = [...catSuppliers.entries()]
          .filter(([, v]) => v.size === 1)
          .map(([category, v]) => ({
            category,
            supplier: items.find((i) => i.supplierId === [...v][0])!.company,
            reason: 'The only supplier on contract for this category',
          }));
        const regions = new Map<string, number>();
        for (const i of items)
          if (i.location) regions.set(i.location.state, (regions.get(i.location.state) ?? 0) + i.committed);
        const total = [...regions.values()].reduce((n, v) => n + v, 0);
        const concentrated = [...regions.entries()]
          .filter(([, v]) => total > 0 && v / total >= 0.6 && regions.size > 1)
          .map(([state, v]) => ({
            region: state,
            share: r1((v / total) * 100),
            reason: 'Most committed spend sits in one region',
          }));
        return {
          model: B6_MODEL,
          feeds: ['WEATHER', 'FINANCIAL', 'GEOPOLITICAL'],
          items,
          singlePoints: [
            ...single.map((x) => ({ kind: 'CATEGORY', ...x })),
            ...concentrated.map((x) => ({ kind: 'REGION', ...x })),
          ],
          note: 'External feeds are simulated: a seasonal weather outlook by state, the platform financial reading and a fixed watchlist.',
        };
      });
    },
  );

  reg('PUT', '/suppliers/{id}/location');
  app.put(`${p}/suppliers/:id/location`, { preHandler: guard(d, ['PROCUREMENT', 'ADMIN']) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(locationBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [s] = await tx
        .select()
        .from(supplier)
        .where(and(eq(supplier.id, id), eq(supplier.tenantId, a.user.tenantId)));
      if (!s) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
      await tx.update(supplier).set({ location: body }).where(eq(supplier.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'supplier.location_set',
        entityType: 'supplier',
        entityId: id,
        before: { location: s.location },
        after: { location: body },
      });
      return { supplierId: id, location: body };
    });
  });

  // ---------------------------------------------------------------- workload against capacity (FR-0620)
  reg('PUT', '/requests/{id}/manager');
  app.put(`${p}/requests/:id/manager`, { preHandler: guard(d, ['PROCUREMENT', 'EXEC']) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(managerBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [r] = await tx
        .select()
        .from(request)
        .where(and(eq(request.id, id), eq(request.tenantId, a.user.tenantId)));
      if (!r) throw new AppError(404, 'NOT_FOUND', 'Procurement not found');
      if (body.managerId) {
        const [m] = await tx
          .select()
          .from(roleAssignment)
          .where(and(eq(roleAssignment.userId, body.managerId), eq(roleAssignment.role, 'PROCUREMENT')));
        if (!m)
          throw new AppError(422, 'NOT_A_MANAGER', 'Assign a member of the procurement team', [
            { field: 'managerId', message: 'Choose someone in procurement' },
          ]);
      }
      await tx.update(request).set({ managerId: body.managerId }).where(eq(request.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'request.manager_assign',
        entityType: 'request',
        entityId: id,
        before: { managerId: r.managerId },
        after: { managerId: body.managerId },
      });
      return { id, managerId: body.managerId };
    });
  });

  reg('GET', '/reports/capacity');
  app.get(`${p}/reports/capacity`, { preHandler: guard(d, ['PROCUREMENT', 'EXEC']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      const cap = s.dashboards.capacityPerManager;
      const { rows } = await visibleRequests(tx, a);
      const active = rows.filter(ACTIVE);
      const team = await tx
        .select({ id: appUser.id, name: appUser.name })
        .from(roleAssignment)
        .innerJoin(appUser, eq(appUser.id, roleAssignment.userId))
        .where(and(eq(roleAssignment.tenantId, a.user.tenantId), eq(roleAssignment.role, 'PROCUREMENT')));
      const who = await names(tx, a.user.tenantId);
      const managers = new Map<string, { managerId: string | null; name: string; assigned: boolean }>();
      for (const m of team) managers.set(m.id, { managerId: m.id, name: m.name, assigned: true });
      const load = new Map<string | null, Req[]>();
      for (const r of active) load.set(r.managerId, [...(load.get(r.managerId) ?? []), r]);
      const out = [...new Set([...managers.keys(), ...[...load.keys()].filter((k): k is string => !!k)])]
        .map((id) => {
          const rs = load.get(id) ?? [];
          const exposure = rs.reduce((n, r) => n + Number(r.estimatedValue ?? 0), 0);
          return {
            managerId: id,
            name: who.get(id) ?? 'Unknown',
            procurements: rs.length,
            exposure,
            utilisation: r1((rs.length / cap) * 100),
            overloaded: rs.length > cap,
            items: rs.map((r) => ({
              id: r.id,
              number: r.number,
              title: r.title,
              phase: r.phase,
              value: Number(r.estimatedValue ?? 0),
            })),
          };
        })
        .sort((x, y) => y.procurements - x.procurements || x.name.localeCompare(y.name));
      const unassigned = load.get(null) ?? [];
      const spare = [...out].sort((x, y) => x.procurements - y.procurements)[0];
      return {
        capacityPerManager: cap,
        managers: out,
        unassigned: unassigned.map((r) => ({
          id: r.id,
          number: r.number,
          title: r.title,
          phase: r.phase,
          value: Number(r.estimatedValue ?? 0),
        })),
        suggestion:
          out.some((m) => m.overloaded) && spare
            ? `Move work to ${spare.name}, who has the most room (${spare.procurements} of ${cap}).`
            : null,
      };
    });
  });

  // ---------------------------------------------------------------- spend by any dimension (FR-0645)
  async function spendFacts(tx: Tx, a: AuthContext) {
    const reqs = (await visibleRequests(tx, a)).rows;
    const tenders = reqs.length
      ? await tx
          .select()
          .from(tender)
          .where(
            inArray(
              tender.requestId,
              reqs.map((r) => r.id),
            ),
          )
      : [];
    const contracts = await tx
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
    const sups = new Map(
      (await tx.select().from(supplier).where(eq(supplier.tenantId, a.user.tenantId))).map((s) => [
        s.id,
        s.company,
      ]),
    );
    const units = await tx.select().from(orgUnit).where(eq(orgUnit.tenantId, a.user.tenantId));
    const divisionOf = (bu: string | null) => {
      let u = units.find((x) => x.name.toLowerCase() === (bu ?? '').toLowerCase());
      while (u?.parentId) u = units.find((x) => x.id === u!.parentId) ?? u;
      return u?.name ?? bu ?? 'Unassigned';
    };
    const inv = await tx.select().from(invoice).where(eq(invoice.tenantId, a.user.tenantId));
    const orders = await tx.select().from(workOrder).where(eq(workOrder.tenantId, a.user.tenantId));
    const facts = [];
    for (const c of contracts) {
      const t = c.tenderId ? tenders.find((x) => x.id === c.tenderId) : undefined;
      const r = t ? reqs.find((x) => x.id === t.requestId) : undefined;
      if (c.tenderId && !r) continue; // not one of the caller's procurements
      facts.push({
        contractId: c.id,
        contract: c.number,
        docType: c.docType,
        supplierId: c.supplierId,
        supplier: sups.get(c.supplierId) ?? 'Unknown supplier',
        project: r ? `${r.number} ${r.title}` : 'Not linked to a request',
        businessUnit: r?.businessUnit ?? 'Unassigned',
        division: divisionOf(r?.businessUnit ?? null),
        committed: await cumulativeValue(tx, c),
        invoiced: inv
          .filter((i) => i.contractId === c.id && (COUNTED as readonly string[]).includes(i.status))
          .reduce((n, i) => n + Number(i.amount), 0),
        workOrders: orders.filter((o) => o.masterId === c.id).length,
      });
    }
    return facts;
  }

  reg('GET', '/reports/spend-by');
  app.get(
    `${p}/reports/spend-by`,
    { preHandler: guard(d, ['EXEC', 'FINANCE', 'PROCUREMENT']) },
    async (req) => {
      const a = req.auth!;
      const q = parse(z.object({ dimension: z.enum(SPEND_DIMENSIONS).default('SUPPLIER') }), req.query);
      return withContext(d.database, a.ctx, async (tx) => {
        const facts = await spendFacts(tx, a);
        const key = (f: (typeof facts)[number]): string =>
          ({
            SUPPLIER: f.supplier,
            CONTRACT: f.contract,
            MASTER: f.docType === 'MASTER' ? f.contract : 'Not under a master agreement',
            PROJECT: f.project,
            BUSINESS_UNIT: f.businessUnit,
            DIVISION: f.division,
          })[q.dimension as SpendDimension];
        const groups = new Map<string, { committed: number; invoiced: number; contracts: string[] }>();
        for (const f of facts) {
          const g = groups.get(key(f)) ?? { committed: 0, invoiced: 0, contracts: [] };
          g.committed += f.committed;
          g.invoiced += f.invoiced;
          g.contracts.push(f.contract);
          groups.set(key(f), g);
        }
        const rows = [...groups.entries()]
          .map(([k, g]) => ({
            key: k,
            committed: Math.round(g.committed * 100) / 100,
            invoiced: Math.round(g.invoiced * 100) / 100,
            contracts: g.contracts,
          }))
          .sort((x, y) => y.committed - x.committed || x.key.localeCompare(y.key));
        return {
          dimension: q.dimension,
          dimensions: SPEND_DIMENSIONS,
          rows,
          total: {
            committed: rows.reduce((n, r) => n + r.committed, 0),
            invoiced: rows.reduce((n, r) => n + r.invoiced, 0),
          },
        };
      });
    },
  );

  reg('GET', '/reports/drill');
  app.get(`${p}/reports/drill`, { preHandler: guard(d, REPORT_USERS) }, async (req) => {
    const a = req.auth!;
    const q = parse(
      z.object({
        by: z.enum(['phase', 'category', 'manager', 'businessUnit', 'status']),
        key: z.string().max(200),
      }),
      req.query,
    );
    return withContext(d.database, a.ctx, async (tx) => {
      const { rows } = await visibleRequests(tx, a);
      const who = await names(tx, a.user.tenantId);
      const pick = (r: Req) =>
        ({
          phase: r.phase,
          category: cat(r.category),
          manager: r.managerId ? (who.get(r.managerId) ?? 'Unknown') : 'Unassigned',
          businessUnit: r.businessUnit ?? 'Unassigned',
          status: r.status,
        })[q.by];
      const hit = rows.filter((r) => pick(r) === q.key);
      return {
        by: q.by,
        key: q.key,
        total: hit.length,
        rows: hit.map((r) => ({
          id: r.id,
          number: r.number,
          title: r.title,
          phase: r.phase,
          status: r.status,
          value: Number(r.estimatedValue ?? 0),
        })),
      };
    });
  });

  // ---------------------------------------------------------------- saved views (FR-0625)
  reg('GET', '/report-views');
  app.get(`${p}/report-views`, { preHandler: guard(d, REPORT_USERS) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select({ v: savedView, by: appUser.name })
        .from(savedView)
        .innerJoin(appUser, eq(appUser.id, savedView.userId))
        .where(and(eq(savedView.tenantId, a.user.tenantId)))
        .orderBy(asc(savedView.name));
      return rows
        .filter((r) => r.v.userId === a.user.id || r.v.shared)
        .map((r) => ({
          id: r.v.id,
          name: r.v.name,
          report: r.v.report,
          filters: r.v.filters,
          shared: r.v.shared,
          mine: r.v.userId === a.user.id,
          owner: r.by,
        }));
    });
  });

  reg('POST', '/report-views');
  app.post(`${p}/report-views`, { preHandler: guard(d, REPORT_USERS) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(viewBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const [row] = await tx
        .insert(savedView)
        .values({
          tenantId: a.user.tenantId,
          userId: a.user.id,
          name: body.name,
          report: body.report,
          filters: body.filters,
          shared: body.shared,
          createdAt: d.clock.now(),
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'report_view.save',
        entityType: 'saved_view',
        entityId: row!.id,
        after: { name: body.name, report: body.report, shared: body.shared },
      });
      return {
        id: row!.id,
        name: row!.name,
        report: row!.report,
        filters: row!.filters,
        shared: row!.shared,
        mine: true,
      };
    });
    return reply.status(201).send(out);
  });

  reg('DELETE', '/report-views/{id}');
  app.delete(`${p}/report-views/:id`, { preHandler: guard(d, REPORT_USERS) }, async (req, reply) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    await withContext(d.database, a.ctx, async (tx) => {
      const [v] = await tx
        .select()
        .from(savedView)
        .where(and(eq(savedView.id, id), eq(savedView.userId, a.user.id)));
      if (!v) throw new AppError(404, 'NOT_FOUND', 'View not found');
      await tx.delete(savedView).where(eq(savedView.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'report_view.delete',
        entityType: 'saved_view',
        entityId: id,
        before: { name: v.name },
      });
    });
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------- ask in plain language (FR-0625)
  reg('POST', '/reports/ask');
  app.post(`${p}/reports/ask`, { preHandler: guard(d, REPORT_USERS) }, async (req) => {
    const a = req.auth!;
    const body = parse(askBody, req.body);
    const q = parseQuestion(body.question);
    if ('error' in q)
      throw new AppError(422, 'QUESTION_NOT_UNDERSTOOD', q.error, [{ field: 'question', message: q.error }]);
    return withContext(d.database, a.ctx, async (tx) => {
      const inYear = (dt: Date | string | null) =>
        !q.year || (dt !== null && new Date(dt).getUTCFullYear() === q.year);
      const has = (s: string) => !q.text || s.toLowerCase().includes(q.text);
      let columns: Array<{ key: string; label: string }>;
      let data: Array<Record<string, string | number | null>>;
      if (q.entity === 'procurements') {
        const { rows } = await visibleRequests(tx, a);
        data = rows
          .filter(
            (r) =>
              inYear(r.createdAt) &&
              (!q.phase || r.phase === q.phase) &&
              (q.minValue === null || Number(r.estimatedValue ?? 0) > q.minValue) &&
              has(`${r.title} ${r.category ?? ''}`),
          )
          .map((r) => ({
            number: r.number,
            title: r.title,
            phase: r.phase,
            status: r.status,
            value: Number(r.estimatedValue ?? 0),
          }));
        columns = [
          ['number', 'Number'],
          ['title', 'Title'],
          ['phase', 'Phase'],
          ['status', 'Status'],
          ['value', 'Value'],
        ].map(([key, label]) => ({ key: key!, label: label! }));
      } else if (q.entity === 'contracts') {
        const cs = await tx
          .select()
          .from(contract)
          .where(
            and(
              eq(contract.tenantId, a.user.tenantId),
              isNull(contract.deletedAt),
              isNull(contract.parentId),
            ),
          );
        const sups = new Map(
          (await tx.select().from(supplier).where(eq(supplier.tenantId, a.user.tenantId))).map((s) => [
            s.id,
            s.company,
          ]),
        );
        data = cs
          .filter(
            (c) =>
              inYear(c.createdAt) &&
              (!q.status || c.status === q.status) &&
              (q.minValue === null || Number(c.value) > q.minValue) &&
              (!q.expiringDays ||
                (c.endDate !== null &&
                  c.endDate >= today() &&
                  c.endDate <= addDays(today(), q.expiringDays))) &&
              has(`${c.number} ${sups.get(c.supplierId) ?? ''}`),
          )
          .map((c) => ({
            number: c.number,
            supplier: sups.get(c.supplierId) ?? '',
            status: c.status,
            value: Number(c.value),
            endDate: c.endDate,
          }));
        columns = [
          ['number', 'Contract'],
          ['supplier', 'Supplier'],
          ['status', 'Status'],
          ['value', 'Value'],
          ['endDate', 'Ends'],
        ].map(([key, label]) => ({ key: key!, label: label! }));
      } else if (q.entity === 'risks') {
        const { rows } = await visibleRequests(tx, a);
        const items = rows.length
          ? await tx
              .select({ i: riskItem, as: riskAssessment })
              .from(riskItem)
              .innerJoin(riskAssessment, eq(riskAssessment.id, riskItem.assessmentId))
              .where(
                and(
                  eq(riskItem.applicable, true),
                  inArray(
                    riskAssessment.requestId,
                    rows.map((r) => r.id),
                  ),
                ),
              )
          : [];
        data = items
          .filter((x) => inYear(x.as.generatedAt) && has(`${x.i.title} ${x.i.description}`))
          .map((x) => ({
            x,
            r: rows.find((r) => r.id === x.as.requestId)!,
            rate: riskRating(x.i.likelihood, x.i.impact),
          }))
          .filter((x) => !q.level || x.rate?.level === q.level)
          .map((x) => ({
            procurement: x.r.number,
            title: x.r.title,
            risk: x.x.i.title,
            rating: x.rate?.level ?? 'Not rated',
            mitigation: x.x.i.mitigation,
          }));
        columns = [
          ['procurement', 'Procurement'],
          ['title', 'Title'],
          ['risk', 'Risk'],
          ['rating', 'Rating'],
          ['mitigation', 'Treatment'],
        ].map(([key, label]) => ({ key: key!, label: label! }));
      } else if (q.entity === 'invoices') {
        const inv = await tx
          .select({ i: invoice, c: contract })
          .from(invoice)
          .innerJoin(contract, eq(contract.id, invoice.contractId))
          .where(eq(invoice.tenantId, a.user.tenantId));
        data = inv
          .filter(
            (x) =>
              inYear(x.i.createdAt) &&
              (!q.status || x.i.status === q.status) &&
              (q.minValue === null || Number(x.i.amount) > q.minValue),
          )
          .map((x) => ({
            number: x.i.number,
            contract: x.c.number,
            date: x.i.invoiceDate,
            amount: Number(x.i.amount),
            status: x.i.status,
          }));
        columns = [
          ['number', 'Invoice'],
          ['contract', 'Contract'],
          ['date', 'Date'],
          ['amount', 'Amount'],
          ['status', 'Status'],
        ].map(([key, label]) => ({ key: key!, label: label! }));
      } else {
        const sups = await tx.select().from(supplier).where(eq(supplier.tenantId, a.user.tenantId));
        data = sups
          .filter((s) => has(s.company))
          .map((s) => ({
            company: s.company,
            abn: s.abn,
            insurance: s.insuranceStatus,
            sanctions: s.sanctionsStatus,
          }));
        columns = [
          ['company', 'Supplier'],
          ['abn', 'ABN'],
          ['insurance', 'Insurance'],
          ['sanctions', 'Sanctions'],
        ].map(([key, label]) => ({ key: key!, label: label! }));
      }
      return {
        question: body.question,
        model: B6_MODEL,
        entity: q.entity,
        interpretation: q.understood.join(', '),
        columns,
        rows: data,
        total: data.length,
      };
    });
  });
}
