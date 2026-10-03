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
            updatedAt: r.updatedAt.toISOString(),
          }));
        return { scope, items };
      });
    },
  );

  // ------------------------------------------------------------ spend by category (stub tier: seed data, real sums)
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
      const contracts = await tx
        .select()
        .from(contract)
        .where(
          and(
            eq(contract.tenantId, a.user.tenantId),
            eq(contract.status, 'EXECUTED'),
            sql`${contract.deletedAt} is null`,
          ),
        );
      const cat = new Map<string, { pipeline: number; committed: number }>();
      const slot = (k: string) => {
        if (!cat.has(k)) cat.set(k, { pipeline: 0, committed: 0 });
        return cat.get(k)!;
      };
      for (const r of rows.filter((x) => x.status !== 'COMPLETE'))
        slot(r.category?.replace(/\s*\(UNSPSC[^)]*\)/, '') || NO_CATEGORY).pipeline += Number(
          r.estimatedValue ?? 0,
        );
      for (const c of contracts) {
        const t = tenders.find((x) => x.id === c.tenderId);
        const r = t ? rows.find((x) => x.id === t.requestId) : undefined;
        slot(r ? r.category?.replace(/\s*\(UNSPSC[^)]*\)/, '') || NO_CATEGORY : UNLINKED).committed += Number(
          c.value,
        );
      }
      const byCategory = [...cat.entries()]
        .map(([category, v]) => ({ category, pipeline: v.pipeline, committed: v.committed }))
        .sort(
          (x, y) =>
            y.pipeline + y.committed - (x.pipeline + x.committed) || x.category.localeCompare(y.category),
        );
      return {
        byCategory,
        totalPipeline: byCategory.reduce((s, x) => s + x.pipeline, 0),
        totalCommitted: byCategory.reduce((s, x) => s + x.committed, 0),
        note: 'Pipeline is the estimated value of active requests; committed is the value of executed contracts.',
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
