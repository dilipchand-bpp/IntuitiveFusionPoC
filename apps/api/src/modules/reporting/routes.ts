/**
 * Reporting endpoints (M12): US-RPT-01 procurement table and spend, US-RPT-02 audit search and CSV export.
 * Everything is scoped by the same rule (`scope.ts`); the audit export is itself an audited action.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  appUser,
  auditEvent,
  contract,
  evalReport,
  evaluation,
  plan,
  submission,
  supplier,
  tender,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { visibleRequests, stepsFor } from './scope.js';
import { toCsv } from './csv.js';

export interface ReportingDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
}

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-01');
const auditQuery = z
  .object({
    entityType: z.string().max(60).optional(),
    entityId: uuid.optional(),
    actorId: uuid.optional(),
    requestId: uuid.optional(),
    action: z.string().max(80).optional(),
    result: z.enum(['SUCCESS', 'DENIED', 'FAILED']).optional(),
    from: day.optional(),
    to: day.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
const NO_CATEGORY = 'No category';
const UNLINKED = 'Contracts not linked to a request';
const AUDIT_READERS = ['PROBITY', 'ADMIN', 'EXEC', 'PROCUREMENT'] as const;
const AUDIT_EXPORTERS = ['PROBITY', 'ADMIN'] as const;
const EXPORT_MAX = 20_000;

export function registerReportingRoutes(app: FastifyInstance, p: string, d: ReportingDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);

  // ------------------------------------------------------------ procurement table (US-RPT-01)
  reg('GET', '/reports/procurements');
  app.get(
    `${p}/reports/procurements`,
    {
      preHandler: guard(d, [
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
      ]),
    },
    async (req) => {
      const a = req.auth!;
      const q = parse(
        z.object({
          phase: z.string().max(30).optional(),
          q: z.string().max(100).optional(),
          status: z.string().max(30).optional(),
        }),
        req.query,
      );
      return withContext(d.database, a.ctx, async (tx) => {
        const { scope, rows } = await visibleRequests(tx, a);
        const steps = await stepsFor(tx, a.user.tenantId, rows);
        // where an evaluation exists, evaluators and the chair follow the row to it (they cannot open requests)
        const tn = rows.length
          ? await tx
              .select({ id: tender.id, requestId: tender.requestId })
              .from(tender)
              .where(
                inArray(
                  tender.requestId,
                  rows.map((r) => r.id),
                ),
              )
          : [];
        const evs = tn.length
          ? await tx
              .select({ id: evaluation.id, tenderId: evaluation.tenderId })
              .from(evaluation)
              .where(
                inArray(
                  evaluation.tenderId,
                  tn.map((x) => x.id),
                ),
              )
          : [];
        const evalOf = (requestId: string) => {
          const t0 = tn.find((x) => x.requestId === requestId);
          return evs.find((e) => e.tenderId === t0?.id)?.id ?? null;
        };
        const needle = q.q?.toLowerCase();
        const items = rows
          .filter((r) => !q.phase || r.phase === q.phase)
          .filter((r) => !q.status || r.status === q.status)
          .filter(
            (r) =>
              !needle ||
              `${r.number} ${r.title} ${r.category ?? ''} ${r.businessUnit ?? ''}`
                .toLowerCase()
                .includes(needle),
          )
          .sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime())
          .map((r) => ({
            id: r.id,
            number: r.number,
            title: r.title,
            category: r.category,
            businessUnit: r.businessUnit,
            phase: r.phase,
            status: r.status,
            estimatedValue: Number(r.estimatedValue ?? 0),
            steps: steps.get(r.id)!,
            sourceSystem: r.sourceSystem,
            evaluationId: evalOf(r.id),
            updatedAt: r.updatedAt.toISOString(),
          }));
        return { scope, items };
      });
    },
  );

  // ------------------------------------------------------------ spend (US-RPT-03)
  const cleanCategory = (c: string | null) => c?.replace(/\s*\(UNSPSC[^)]*\)/, '') || NO_CATEGORY;

  reg('GET', '/reports/spend');
  app.get(`${p}/reports/spend`, { preHandler: guard(d, ['EXEC', 'FINANCE', 'PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const { rows } = await visibleRequests(tx, a);
      const tenders = rows.length
        ? await tx
            .select()
            .from(tender)
            .where(
              inArray(
                tender.requestId,
                rows.map((r) => r.id),
              ),
            )
        : [];
      const all = await tx
        .select()
        .from(contract)
        .where(and(eq(contract.tenantId, a.user.tenantId), sql`${contract.deletedAt} is null`));
      const executed = all.filter((c) => c.status === 'EXECUTED');
      const suppliers = await tx.select().from(supplier).where(eq(supplier.tenantId, a.user.tenantId));
      const company = (id: string) => suppliers.find((s) => s.id === id)?.company ?? 'Unknown supplier';
      // a variation counts against the request of the contract it varies
      const requestOf = (c: (typeof all)[number]) => {
        const root = c.parentId ? all.find((x) => x.id === c.parentId) : c;
        const t = root?.tenderId ? tenders.find((x) => x.id === root.tenderId) : undefined;
        return t ? rows.find((x) => x.id === t.requestId) : undefined;
      };

      type Item = {
        kind: 'REQUEST' | 'CONTRACT';
        number: string;
        title: string;
        supplier: string | null;
        value: number;
      };
      const cat = new Map<string, { pipeline: number; committed: number; items: Item[] }>();
      const slot = (k: string) => {
        if (!cat.has(k)) cat.set(k, { pipeline: 0, committed: 0, items: [] });
        return cat.get(k)!;
      };
      for (const r of rows.filter((x) => x.status !== 'COMPLETE')) {
        const s = slot(cleanCategory(r.category));
        s.pipeline += Number(r.estimatedValue ?? 0);
        s.items.push({
          kind: 'REQUEST',
          number: r.number,
          title: r.title,
          supplier: null,
          value: Number(r.estimatedValue ?? 0),
        });
      }
      const sup = new Map<string, { company: string; committed: number; contracts: number }>();
      for (const c of executed) {
        const r = requestOf(c);
        const s = slot(r ? cleanCategory(r.category) : UNLINKED);
        s.committed += Number(c.value);
        s.items.push({
          kind: 'CONTRACT',
          number: c.number,
          title: r?.title ?? '',
          supplier: company(c.supplierId),
          value: Number(c.value),
        });
        const x = sup.get(c.supplierId) ?? { company: company(c.supplierId), committed: 0, contracts: 0 };
        x.committed += Number(c.value);
        x.contracts += 1;
        sup.set(c.supplierId, x);
      }
      const byCategory = [...cat.entries()]
        .map(([category, v]) => ({ category, pipeline: v.pipeline, committed: v.committed, items: v.items }))
        .sort(
          (x, y) =>
            y.pipeline + y.committed - (x.pipeline + x.committed) || x.category.localeCompare(y.category),
        );
      const total = [...sup.values()].reduce((n, x) => n + x.committed, 0);
      const bySupplier = [...sup.entries()]
        .map(([supplierId, v]) => ({
          supplierId,
          ...v,
          share: total ? Math.round((v.committed / total) * 1000) / 10 : 0,
        }))
        .sort((x, y) => y.committed - x.committed || x.company.localeCompare(y.company));
      // Off-contract ("maverick") spend: a purchase that reached delivery or was closed with no executed contract behind it
      const withContract = new Set(executed.map((c) => requestOf(c)?.id).filter(Boolean));
      const offContract = rows
        .filter((r) => ['CONTRACT_MGMT', 'CLOSED'].includes(r.phase) && !withContract.has(r.id))
        .map((r) => ({
          requestId: r.id,
          number: r.number,
          title: r.title,
          category: cleanCategory(r.category),
          value: Number(r.estimatedValue ?? 0),
          phase: r.phase,
        }))
        .sort((x, y) => y.value - x.value);
      return {
        byCategory,
        bySupplier,
        offContract,
        totalPipeline: byCategory.reduce((s, x) => s + x.pipeline, 0),
        totalCommitted: byCategory.reduce((s, x) => s + x.committed, 0),
        totalOffContract: offContract.reduce((s, x) => s + x.value, 0),
        note: 'Pipeline is the estimated value of active requests; committed is the value of executed contracts, including variations; off-contract is a purchase that reached delivery or was closed with no executed contract.',
      };
    });
  });

  // ------------------------------------------------------------ workload and timeline (US-RPT-04)
  reg('GET', '/reports/workload');
  app.get(`${p}/reports/workload`, { preHandler: guard(d, ['PROCUREMENT', 'EXEC']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const { rows } = await visibleRequests(tx, a);
      const active = rows.filter((r) => r.status !== 'COMPLETE');
      const people = await tx.select().from(appUser).where(eq(appUser.tenantId, a.user.tenantId));
      const name = (id: string) => people.find((u) => u.id === id)?.name ?? 'Unknown';
      const owners = new Map<
        string,
        {
          ownerId: string;
          ownerName: string;
          procurements: number;
          value: number;
          byPhase: Record<string, number>;
        }
      >();
      for (const r of active) {
        const o = owners.get(r.requesterId) ?? {
          ownerId: r.requesterId,
          ownerName: name(r.requesterId),
          procurements: 0,
          value: 0,
          byPhase: {},
        };
        o.procurements += 1;
        o.value += Number(r.estimatedValue ?? 0);
        o.byPhase[r.phase] = (o.byPhase[r.phase] ?? 0) + 1;
        owners.set(r.requesterId, o);
      }
      const ids = active.map((r) => r.id);
      const tenders = ids.length ? await tx.select().from(tender).where(inArray(tender.requestId, ids)) : [];
      const contracts = tenders.length
        ? await tx
            .select()
            .from(contract)
            .where(
              inArray(
                contract.tenderId,
                tenders.map((t) => t.id),
              ),
            )
        : [];
      const day = (d0: Date | string | null | undefined) =>
        d0 ? new Date(d0).toISOString().slice(0, 10) : null;
      const today = day(d.clock.now())!;
      const timeline = active
        .map((r) => {
          const bars: Array<{ label: string; start: string; end: string; optional: boolean }> = [
            {
              label: 'Request and plan',
              start: day(r.createdAt)!,
              end: day(r.updatedAt)! < day(r.createdAt)! ? day(r.createdAt)! : day(r.updatedAt)!,
              optional: false,
            },
          ];
          const t = tenders.find((x) => x.requestId === r.id);
          if (t?.opensAt && t.closesAt)
            bars.push({
              label: 'Tender open',
              start: day(t.opensAt)!,
              end: day(t.closesAt)!,
              optional: false,
            });
          const c = t ? contracts.find((x) => x.tenderId === t.id && !x.deletedAt) : undefined;
          if (c?.startDate && c.endDate)
            bars.push({ label: `Contract ${c.number}`, start: c.startDate, end: c.endDate, optional: false });
          return {
            requestId: r.id,
            number: r.number,
            title: r.title,
            owner: name(r.requesterId),
            phase: r.phase,
            bars,
          };
        })
        .sort((x, y) => x.number.localeCompare(y.number));
      return {
        today,
        owners: [...owners.values()].sort(
          (x, y) =>
            y.procurements - x.procurements || y.value - x.value || x.ownerName.localeCompare(y.ownerName),
        ),
        timeline,
        note: 'The owner of a procurement is the person who raised the request; the proof of concept has no separate procurement lead assignment.',
      };
    });
  });

  // ------------------------------------------------------------ audit trail (US-RPT-02)
  /** Every record that belongs to one procurement, so its whole trail can be read at once. */
  async function relatedEntityIds(tx: Tx, tenantId: string, requestId: string): Promise<string[]> {
    const ids = new Set<string>([requestId]);
    const [pl] = await tx
      .select({ id: plan.id })
      .from(plan)
      .where(and(eq(plan.tenantId, tenantId), eq(plan.requestId, requestId)));
    if (pl) ids.add(pl.id);
    const ts = await tx
      .select({ id: tender.id })
      .from(tender)
      .where(and(eq(tender.tenantId, tenantId), eq(tender.requestId, requestId)));
    for (const t of ts) {
      ids.add(t.id);
      for (const s of await tx
        .select({ id: submission.id })
        .from(submission)
        .where(eq(submission.tenderId, t.id)))
        ids.add(s.id);
      for (const e of await tx
        .select({ id: evaluation.id })
        .from(evaluation)
        .where(eq(evaluation.tenderId, t.id))) {
        ids.add(e.id);
        for (const r of await tx
          .select({ id: evalReport.id })
          .from(evalReport)
          .where(eq(evalReport.evaluationId, e.id)))
          ids.add(r.id);
      }
      for (const c of await tx.select({ id: contract.id }).from(contract).where(eq(contract.tenderId, t.id)))
        ids.add(c.id);
    }
    return [...ids];
  }

  async function auditRows(tx: Tx, tenantId: string, f: z.infer<typeof auditQuery>, paged: boolean) {
    const conds: SQL[] = [eq(auditEvent.tenantId, tenantId)];
    if (f.entityType) conds.push(eq(auditEvent.entityType, f.entityType));
    if (f.entityId) conds.push(eq(auditEvent.entityId, f.entityId));
    if (f.actorId) conds.push(eq(auditEvent.actorId, f.actorId));
    if (f.result) conds.push(eq(auditEvent.result, f.result));
    if (f.action) conds.push(sql`${auditEvent.action} like ${`${f.action.replace(/[%_\\]/g, '\\$&')}%`}`);
    if (f.from) conds.push(gte(auditEvent.at, new Date(`${f.from}T00:00:00Z`)));
    if (f.to) conds.push(lte(auditEvent.at, new Date(`${f.to}T23:59:59.999Z`)));
    if (f.requestId) {
      const ids = await relatedEntityIds(tx, tenantId, f.requestId);
      conds.push(inArray(auditEvent.entityId, ids));
    }
    const where = and(...conds);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(auditEvent)
      .where(where);
    const base = tx
      .select({ e: auditEvent, actorName: appUser.name })
      .from(auditEvent)
      .leftJoin(appUser, eq(appUser.id, auditEvent.actorId))
      .where(where)
      .orderBy(paged ? desc(auditEvent.seq) : asc(auditEvent.seq));
    const rows = paged ? await base.limit(f.limit).offset(f.offset) : await base.limit(EXPORT_MAX);
    return {
      total: n,
      rows: rows.map(({ e, actorName }) => ({
        seq: e.seq,
        at: e.at.toISOString(),
        actorId: e.actorId,
        actorName: actorName ?? (e.actorRole === 'SYSTEM' ? 'System' : null),
        actorRole: e.actorRole,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        result: e.result,
        before: e.before as Record<string, unknown> | null,
        after: e.after as Record<string, unknown> | null,
        hash: e.hash,
      })),
    };
  }

  reg('GET', '/audit-events');
  app.get(`${p}/audit-events`, { preHandler: guard(d, [...AUDIT_READERS]) }, async (req) => {
    const a = req.auth!;
    const f = parse(auditQuery, req.query);
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await auditRows(tx, a.user.tenantId, f, true);
      return { items: r.rows, page: { total: r.total, limit: f.limit, offset: f.offset } };
    });
  });

  reg('GET', '/audit-events/export');
  app.get(`${p}/audit-events/export`, { preHandler: guard(d, [...AUDIT_EXPORTERS]) }, async (req, reply) => {
    const a = req.auth!;
    const f = parse(auditQuery.omit({ limit: true, offset: true }), req.query);
    const csv = await withContext(d.database, a.ctx, async (tx) => {
      const r = await auditRows(tx, a.user.tenantId, { ...f, limit: EXPORT_MAX, offset: 0 }, false);
      if (r.total > EXPORT_MAX)
        throw new AppError(
          422,
          'EXPORT_TOO_LARGE',
          `More than ${EXPORT_MAX} events match; narrow the filters`,
        );
      // The export is recorded in the same transaction, and its own event is not part of the file it describes.
      await d.audit.record(tx, a.ctx, {
        action: 'audit.export',
        entityType: 'audit',
        after: {
          filters: { ...f },
          rows: r.rows.length,
          firstSeq: r.rows[0]?.seq ?? null,
          lastSeq: r.rows.at(-1)?.seq ?? null,
        },
      });
      return toCsv(
        [
          'Seq',
          'Time (UTC)',
          'Actor',
          'Role',
          'Action',
          'Entity type',
          'Entity id',
          'Result',
          'Before',
          'After',
          'Hash',
        ],
        r.rows.map((x) => [
          x.seq,
          x.at,
          x.actorName ?? '',
          x.actorRole ?? '',
          x.action,
          x.entityType,
          x.entityId ?? '',
          x.result,
          x.before ? JSON.stringify(x.before) : '',
          x.after ? JSON.stringify(x.after) : '',
          x.hash,
        ]),
      );
    });
    const stamp = d.clock.now().toISOString().slice(0, 10).replace(/-/g, '');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="audit-trail-${stamp}.csv"`)
      .header('cache-control', 'no-store')
      .send(csv);
  });

  return done;
}
