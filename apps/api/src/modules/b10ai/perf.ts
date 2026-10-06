/**
 * Measured performance of the intake conversation (NFR-P04): how long the budget check and each intake message took.
 *
 * Durations come from a monotonic high-resolution timer (`process.hrtime`), never from the injectable Clock, so a test that
 * moves the Clock cannot fake a timing and the wall clock being corrected cannot produce a negative one. Samples are kept
 * to the latest RETENTION per tenant and kind.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '@if/shared';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import { perfSample } from '../../db/schema.js';
import { parse } from '../../http/errors.js';
import { loadSettings } from '../settings/settings.js';

export type PerfKind = 'BUDGET_CHECK' | 'INTAKE_MESSAGE';
/** Samples kept for each tenant and kind; older ones are deleted as new ones arrive. */
export const PERF_RETENTION = 1000;

/** Milliseconds from a monotonic clock. Only differences between two calls mean anything. */
export const nowMs = (): number => Number(process.hrtime.bigint()) / 1e6;

export async function recordSample(
  tx: Tx,
  tenantId: string,
  kind: PerfKind,
  ms: number,
  at: Date,
): Promise<void> {
  await tx.insert(perfSample).values({ tenantId, kind, ms: ms.toFixed(3), at });
  // retention cap: drop everything older than the newest PERF_RETENTION
  await tx.execute(sql`
    delete from perf_sample
    where tenant_id = ${tenantId} and kind = ${kind}
      and id <= coalesce((select id from perf_sample where tenant_id = ${tenantId} and kind = ${kind}
                          order by id desc offset ${PERF_RETENTION} limit 1), 0)`);
}

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

const round = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);

export interface PerfSummary {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export function summarise(values: readonly number[]): PerfSummary {
  const s = [...values].sort((a, b) => a - b);
  return {
    count: s.length,
    p50: round(percentile(s, 50)),
    p95: round(percentile(s, 95)),
    max: round(s.at(-1) ?? null),
  };
}

export async function latest(tx: Tx, tenantId: string, kind: PerfKind, n: number): Promise<number[]> {
  const rows = await tx
    .select({ ms: perfSample.ms })
    .from(perfSample)
    .where(and(eq(perfSample.tenantId, tenantId), eq(perfSample.kind, kind)))
    .orderBy(desc(perfSample.id))
    .limit(n);
  return rows.map((r) => Number(r.ms));
}

export function registerPerformance(
  app: FastifyInstance,
  p: string,
  d: GuardDeps & { clock: Clock },
): Set<string> {
  const done = new Set<string>();
  done.add('GET /admin/performance/budget-check');
  app.get(`${p}/admin/performance/budget-check`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const q = parse(
      z.object({ last: z.coerce.number().int().min(1).max(PERF_RETENTION).default(200) }),
      req.query,
    );
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      const budget = await latest(tx, a.user.tenantId, 'BUDGET_CHECK', q.last);
      const messages = await latest(tx, a.user.tenantId, 'INTAKE_MESSAGE', q.last);
      const sum = summarise(budget);
      const target = s.performance.budgetCheckMs;
      return {
        targetMs: target,
        window: q.last,
        ...sum,
        // the target is judged on the 95th percentile; with no samples there is nothing to judge
        pass: sum.p95 === null ? null : sum.p95 <= target,
        intakeMessage: summarise(messages),
        recent: budget.slice(0, 20).map((x) => Math.round(x * 1000) / 1000),
        timer: 'process.hrtime (monotonic, high resolution)',
        note: 'The budget check is the simulated ERP adapter; with a real ERP the same measurement captures its response time.',
      };
    });
  });
  return done;
}
