/**
 * Persistence for the run, its steps, events, gates, problems and hand-offs. The engine runs as a background actor, so these write as
 * the system (tenant id is always part of the condition); what people read goes through withContext in routes.ts.
 */
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import { withSystem, type Database } from '../../db/client.js';
import { cpEvent, cpGate, cpHandoff, cpProblem, cpRun, cpStep } from '../../db/schema.js';
import type { CpRunStatus, CpStage } from '../../db/schema.js';

export type RunRow = typeof cpRun.$inferSelect;
export type GateRow = typeof cpGate.$inferSelect;
export type ProblemRow = typeof cpProblem.$inferSelect;
export type EventKind = 'STEP' | 'GATE' | 'PROBLEM' | 'REPAIR' | 'HANDOFF' | 'STATUS' | 'NOTE';

export interface ProblemAttempt {
  n: number;
  repair: string;
  label: string;
  outcome: 'FIXED' | 'NOT_FIXED' | 'NOT_APPLICABLE';
  note: string;
  at: string;
}

const STALE_LOCK_MS = 2 * 60_000;

export class Store {
  constructor(
    readonly db: Database,
    readonly clock: Clock,
  ) {}

  async getRun(id: string): Promise<RunRow | null> {
    const [r] = await withSystem(this.db, (tx) => tx.select().from(cpRun).where(eq(cpRun.id, id)));
    return r ?? null;
  }

  /** Takes the tick lock for one run; false when another tick holds it (so a tick can never run twice at once). */
  async lock(id: string): Promise<boolean> {
    const now = this.clock.now();
    const stale = new Date(now.getTime() - STALE_LOCK_MS);
    const rows = await withSystem(this.db, (tx) =>
      tx
        .update(cpRun)
        .set({ tickingSince: now })
        .where(and(eq(cpRun.id, id), or(isNull(cpRun.tickingSince), lt(cpRun.tickingSince, stale))))
        .returning({ id: cpRun.id }),
    );
    return rows.length === 1;
  }
  async unlock(id: string) {
    await withSystem(this.db, (tx) => tx.update(cpRun).set({ tickingSince: null }).where(eq(cpRun.id, id)));
  }

  async updateRun(id: string, patch: Partial<typeof cpRun.$inferInsert>) {
    await withSystem(this.db, (tx) =>
      tx
        .update(cpRun)
        .set({ ...patch, updatedAt: this.clock.now() })
        .where(eq(cpRun.id, id)),
    );
  }

  async setContext(run: RunRow, patch: Record<string, unknown>) {
    const next = { ...(run.context as Record<string, unknown>), ...patch };
    await this.updateRun(run.id, { context: next });
    run.context = next;
  }

  async event(
    run: Pick<RunRow, 'id' | 'tenantId'>,
    kind: EventKind,
    agent: string,
    title: string,
    detail = '',
    data: Record<string, unknown> = {},
  ) {
    await withSystem(this.db, (tx) =>
      tx.insert(cpEvent).values({
        tenantId: run.tenantId,
        runId: run.id,
        at: this.clock.now(),
        kind,
        agent,
        title: title.slice(0, 300),
        detail: detail.slice(0, 2000),
        data,
      }),
    );
  }

  async eventsAfter(runId: string, after: number, limit: number) {
    return withSystem(this.db, (tx) =>
      tx
        .select()
        .from(cpEvent)
        .where(and(eq(cpEvent.runId, runId), gt(cpEvent.seq, after)))
        .orderBy(asc(cpEvent.seq))
        .limit(limit),
    );
  }

  async nextSeq(runId: string): Promise<number> {
    const [r] = await withSystem(this.db, (tx) =>
      tx
        .select({ m: sql<number>`coalesce(max(${cpStep.seq}), 0)::int` })
        .from(cpStep)
        .where(eq(cpStep.runId, runId)),
    );
    return (r?.m ?? 0) + 1;
  }

  async stepExists(runId: string, idemKey: string): Promise<boolean> {
    const [r] = await withSystem(this.db, (tx) =>
      tx
        .select({ id: cpStep.id })
        .from(cpStep)
        .where(and(eq(cpStep.runId, runId), eq(cpStep.idemKey, idemKey))),
    );
    return Boolean(r);
  }

  /** Records a step; false when a step with the same idempotency key is already recorded (nothing is written twice). */
  async addStep(row: Omit<typeof cpStep.$inferInsert, 'seq' | 'id'>): Promise<boolean> {
    const seq = await this.nextSeq(row.runId);
    const out = await withSystem(this.db, (tx) =>
      tx
        .insert(cpStep)
        .values({ ...row, seq })
        .onConflictDoNothing()
        .returning({ id: cpStep.id }),
    );
    return out.length === 1;
  }

  async handoff(
    run: Pick<RunRow, 'id' | 'tenantId'>,
    from: string,
    to: string,
    reason: string,
    stepKey: string,
  ) {
    await withSystem(this.db, (tx) =>
      tx.insert(cpHandoff).values({
        tenantId: run.tenantId,
        runId: run.id,
        at: this.clock.now(),
        fromAgent: from,
        toAgent: to,
        reason,
        stepKey,
      }),
    );
  }

  // ------------------------------------------------------------------ gates
  async openGates(runId: string): Promise<GateRow[]> {
    return withSystem(this.db, (tx) =>
      tx
        .select()
        .from(cpGate)
        .where(and(eq(cpGate.runId, runId), eq(cpGate.status, 'OPEN')))
        .orderBy(asc(cpGate.createdAt)),
    );
  }
  async addGate(row: typeof cpGate.$inferInsert): Promise<boolean> {
    const out = await withSystem(this.db, (tx) =>
      tx.insert(cpGate).values(row).onConflictDoNothing().returning({ id: cpGate.id }),
    );
    return out.length === 1;
  }
  async resolveGates(ids: string[], resolution: string, status: 'RESOLVED' | 'CANCELLED' = 'RESOLVED') {
    if (ids.length === 0) return;
    await withSystem(this.db, (tx) =>
      tx
        .update(cpGate)
        .set({ status, resolvedAt: this.clock.now(), resolution })
        .where(and(inArray(cpGate.id, ids), eq(cpGate.status, 'OPEN'))),
    );
  }

  // ------------------------------------------------------------------ problems
  async activeProblem(runId: string, stepKey: string): Promise<ProblemRow | null> {
    const [p] = await withSystem(this.db, (tx) =>
      tx
        .select()
        .from(cpProblem)
        .where(
          and(
            eq(cpProblem.runId, runId),
            eq(cpProblem.stepKey, stepKey),
            inArray(cpProblem.status, ['OPEN', 'ESCALATED']),
          ),
        ),
    );
    return p ?? null;
  }
  async openProblem(
    run: RunRow,
    stepKey: string,
    code: string,
    title: string,
    detail: string,
    fingerprint: string,
  ) {
    const now = this.clock.now();
    const [p] = await withSystem(this.db, (tx) =>
      tx
        .insert(cpProblem)
        .values({
          tenantId: run.tenantId,
          runId: run.id,
          stepKey,
          code,
          title: title.slice(0, 300),
          detail: detail.slice(0, 2000),
          status: 'OPEN',
          fingerprint,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
    );
    return p!;
  }
  async updateProblem(id: string, patch: Partial<typeof cpProblem.$inferInsert>) {
    await withSystem(this.db, (tx) =>
      tx
        .update(cpProblem)
        .set({ ...patch, updatedAt: this.clock.now() })
        .where(eq(cpProblem.id, id)),
    );
  }
  async problems(runId: string) {
    return withSystem(this.db, (tx) =>
      tx.select().from(cpProblem).where(eq(cpProblem.runId, runId)).orderBy(asc(cpProblem.createdAt)),
    );
  }

  async lastStep(runId: string) {
    const [s] = await withSystem(this.db, (tx) =>
      tx.select().from(cpStep).where(eq(cpStep.runId, runId)).orderBy(desc(cpStep.seq)).limit(1),
    );
    return s ?? null;
  }

  setStatus(run: RunRow, status: CpRunStatus, stage?: CpStage) {
    run.status = status;
    if (stage) run.stage = stage;
    return this.updateRun(run.id, { status, ...(stage ? { stage } : {}) });
  }
}
