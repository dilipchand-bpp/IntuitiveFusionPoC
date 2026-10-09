/**
 * Procurement Copilot runtime routes (CP-01, CP-02, CP-03, CP-06). Everything the agent does goes through the application's own
 * routes as the person who started the run; these routes start and watch runs. All of it is simulated and rules-based
 * (engine rules-simulated-v1).
 */
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard, type AuthContext } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import { cpGate, cpHandoff, cpProblem, cpRun, cpStep, request } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { gateIsFor } from './action-gates.js';
import { AGENTS, COPILOT_MANAGERS, COPILOT_ROLES, STAGES, agentLabel } from './agents.js';
import { CopilotEngine, type EngineDeps } from './engine.js';
import { simulateClose, simulateSuppliers } from './simulate.js';
import type { RunRow } from './store.js';
import { ENGINE } from './tools.js';

const uuid = z.string().uuid();
const idParam = z.object({ id: uuid });
const startBody = z
  .object({
    text: z.string().trim().min(3).max(4000),
    procurementId: uuid.optional(),
    mode: z.enum(['FULL', 'ASSISTED']).default('FULL'),
    autoAdvance: z.boolean().default(true),
    source: z.enum(['TEXT', 'VOICE']).optional(),
  })
  .strict();
const eventsQuery = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
const listQuery = z.object({
  status: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

declare module 'fastify' {
  interface FastifyInstance {
    /** The Procurement Copilot engine (BCP); tests and the timer tick runs through it. */
    copilotEngine: CopilotEngine;
  }
}

export interface CopilotDeps extends EngineDeps {
  /** Milliseconds between timer ticks; absent or 0 means no timer (always the case in tests). */
  tickMs?: number | undefined;
}

export function registerCopilotRuntime(app: FastifyInstance, p: string, d: CopilotDeps) {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const engine = new CopilotEngine(app, d);
  app.decorate('copilotEngine', engine);
  if (d.tickMs && d.tickMs > 0) {
    engine.startTimer(d.tickMs);
    app.addHook('onClose', async () => engine.stopTimer());
  }
  const ROLES = [...COPILOT_ROLES];
  const isManager = (a: AuthContext) =>
    a.user.roles.some((r) => (COPILOT_MANAGERS as readonly string[]).includes(r));

  async function visibleRun(tx: Tx, a: AuthContext, id: string): Promise<RunRow> {
    const [r] = await tx
      .select()
      .from(cpRun)
      .where(and(eq(cpRun.id, id), eq(cpRun.tenantId, a.user.tenantId)));
    // a run that is not yours looks exactly like one that does not exist, unless you are a manager
    if (!r || (r.userId !== a.user.id && !isManager(a)))
      throw new AppError(404, 'NOT_FOUND', 'Run not found');
    return r;
  }
  const mayControl = (a: AuthContext, r: RunRow) => r.userId === a.user.id || a.user.roles.includes('ADMIN');

  function brief(r: RunRow, extra: { requestNumber?: string | null } = {}) {
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      stage: r.stage,
      mode: r.mode,
      autoAdvance: r.autoAdvance,
      startedBy: { id: r.userId, name: r.userName, role: r.userRole },
      requestId: r.requestId,
      requestNumber: extra.requestNumber ?? null,
      currentAgent: r.currentAgent,
      currentAgentLabel: agentLabel(r.currentAgent),
      currentAction: r.currentAction,
      waitingFor: r.waitingFor as unknown[],
      engine: r.engine,
      simulated: r.simulated,
      sourceText: r.sourceText,
      tickCount: r.tickCount,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    };
  }

  async function detail(tx: Tx, a: AuthContext, r: RunRow) {
    const [steps, gates, handoffs, problems] = await Promise.all([
      tx.select().from(cpStep).where(eq(cpStep.runId, r.id)).orderBy(asc(cpStep.seq)),
      tx.select().from(cpGate).where(eq(cpGate.runId, r.id)).orderBy(asc(cpGate.createdAt)),
      tx.select().from(cpHandoff).where(eq(cpHandoff.runId, r.id)).orderBy(asc(cpHandoff.at)),
      tx.select().from(cpProblem).where(eq(cpProblem.runId, r.id)).orderBy(asc(cpProblem.createdAt)),
    ]);
    const [req] = r.requestId
      ? await tx
          .select()
          .from(request)
          .where(and(eq(request.id, r.requestId), eq(request.tenantId, a.user.tenantId)))
      : [];
    const idx = STAGES.findIndex((s) => s.key === r.stage);
    const stages = STAGES.map((s, i) => ({
      key: s.key,
      label: s.label,
      state:
        r.status === 'COMPLETED' || r.stage === 'DONE' || i < idx ? 'DONE' : i === idx ? 'CURRENT' : 'TODO',
    }));
    const perAgent = new Map<string, number>();
    for (const s of steps) perAgent.set(s.agent, (perAgent.get(s.agent) ?? 0) + 1);
    return {
      run: brief(r, { requestNumber: req?.number ?? null }),
      procurement: req
        ? {
            id: req.id,
            number: req.number,
            title: req.title,
            status: req.status,
            phase: req.phase,
            estimatedValue: Number(req.estimatedValue ?? 0),
            link: `/app/requests/${req.id}`,
          }
        : null,
      stages,
      steps: steps.map((s) => ({
        id: s.id,
        seq: s.seq,
        key: s.stepKey,
        agent: s.agent,
        agentLabel: agentLabel(s.agent),
        tool: s.tool,
        stage: s.stage,
        status: s.status,
        title: s.title,
        reason: s.reason,
        rule: s.rule,
        result: s.result,
        httpStatus: s.httpStatus,
        attempt: s.attempt,
        durationMs: s.durationMs,
        actor: s.actorLabel,
        at: s.finishedAt.toISOString(),
      })),
      gates: gates.map((g) => ({
        id: g.id,
        kind: g.kind,
        stage: g.stage,
        title: g.title,
        reason: g.reason,
        rule: g.rule,
        link: g.link,
        roles: g.assigneeRoles,
        names: g.assigneeNames,
        status: g.status,
        createdAt: g.createdAt.toISOString(),
        resolvedAt: g.resolvedAt?.toISOString() ?? null,
        resolution: g.resolution,
      })),
      agents: AGENTS.map((ag) => ({
        key: ag.key,
        label: ag.label,
        steps: perAgent.get(ag.key) ?? 0,
        current: r.currentAgent === ag.key,
      })),
      handoffs: handoffs.map((h) => ({
        id: h.id,
        at: h.at.toISOString(),
        from: h.fromAgent,
        fromLabel: agentLabel(h.fromAgent),
        to: h.toAgent,
        toLabel: agentLabel(h.toAgent),
        reason: h.reason,
      })),
      problems: problems.map(problemView),
      assumptions: ((r.context as { assumptions?: string[] }).assumptions ?? []) as string[],
    };
  }

  const problemView = (x: typeof cpProblem.$inferSelect) => ({
    id: x.id,
    stepKey: x.stepKey,
    code: x.code,
    title: x.title,
    detail: x.detail,
    status: x.status,
    attempts: x.attempts as unknown[],
    attemptCount: x.attemptCount,
    escalatedTo: x.escalatedTo as string[],
    createdAt: x.createdAt.toISOString(),
    resolvedAt: x.resolvedAt?.toISOString() ?? null,
  });

  // ---------------------------------------------------------------- start
  reg('POST', '/copilot/runs');
  app.post(`${p}/copilot/runs`, { preHandler: guard(d, ROLES) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(startBody, req.body ?? {});
    if (!body.procurementId && !a.user.roles.some((r) => r === 'REQUESTER' || r === 'PROCUREMENT'))
      throw new AppError(
        403,
        'FORBIDDEN',
        'Only a requester or a procurement officer can raise a request, so the Copilot cannot start one for you',
      );
    if (body.procurementId && !(await engine.requestVisibleTo(a.user.tenantId, body.procurementId, a.user)))
      throw new AppError(404, 'NOT_FOUND', 'Request not found');
    const run = await engine.createRun(
      { id: a.user.id, tenantId: a.user.tenantId, name: a.user.name, role: a.user.role, roles: a.user.roles },
      { text: body.text, procurementId: body.procurementId, mode: body.mode, autoAdvance: body.autoAdvance },
    );
    if (body.autoAdvance) await engine.tick(run.id, { source: 'start' });
    const out = await withContext(d.database, a.ctx, async (tx) =>
      detail(tx, a, await visibleRun(tx, a, run.id)),
    );
    return reply.status(201).send(out);
  });

  // ---------------------------------------------------------------- read
  reg('GET', '/copilot/runs');
  app.get(`${p}/copilot/runs`, { preHandler: guard(d, ROLES) }, async (req) => {
    const a = req.auth!;
    const q = parse(listQuery, req.query);
    return withContext(d.database, a.ctx, async (tx) => {
      const conds = [eq(cpRun.tenantId, a.user.tenantId)];
      if (!isManager(a)) conds.push(eq(cpRun.userId, a.user.id));
      if (q.status) conds.push(eq(cpRun.status, q.status as never));
      const rows = await tx
        .select({ r: cpRun, number: request.number })
        .from(cpRun)
        .leftJoin(request, eq(request.id, cpRun.requestId))
        .where(and(...conds))
        .orderBy(desc(cpRun.updatedAt))
        .limit(q.limit);
      return {
        items: rows.map((x) => brief(x.r, { requestNumber: x.number })),
        scope: isManager(a) ? 'ALL' : 'MINE',
      };
    });
  });

  reg('GET', '/copilot/runs/{id}');
  app.get(`${p}/copilot/runs/:id`, { preHandler: guard(d, ROLES) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    return withContext(d.database, a.ctx, async (tx) => detail(tx, a, await visibleRun(tx, a, id)));
  });

  reg('GET', '/copilot/runs/{id}/events');
  app.get(`${p}/copilot/runs/:id/events`, { preHandler: guard(d, ROLES) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const q = parse(eventsQuery, req.query);
    const r = await withContext(d.database, a.ctx, (tx) => visibleRun(tx, a, id));
    const events = await engine.store.eventsAfter(id, q.after, q.limit);
    const fresh = (await engine.store.getRun(id)) ?? r;
    return {
      events: events.map((e) => ({
        seq: e.seq,
        at: e.at.toISOString(),
        kind: e.kind,
        agent: e.agent,
        agentLabel: agentLabel(e.agent),
        title: e.title,
        detail: e.detail,
        data: e.data,
      })),
      cursor: events.length ? events[events.length - 1]!.seq : q.after,
      status: fresh.status,
      stage: fresh.stage,
      currentAgent: fresh.currentAgent,
      currentAgentLabel: agentLabel(fresh.currentAgent),
      currentAction: fresh.currentAction,
      waitingFor: fresh.waitingFor as unknown[],
    };
  });

  reg('GET', '/copilot/runs/{id}/problems');
  app.get(`${p}/copilot/runs/:id/problems`, { preHandler: guard(d, ROLES) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await visibleRun(tx, a, id);
      const rows = await tx
        .select()
        .from(cpProblem)
        .where(eq(cpProblem.runId, r.id))
        .orderBy(asc(cpProblem.createdAt));
      return { maxAttempts: 3, problems: rows.map(problemView) };
    });
  });

  // ---------------------------------------------------------------- control
  const control = (
    name: string,
    fn: (r: RunRow) => Promise<unknown>,
    allowed: (r: RunRow) => string | null,
  ) => {
    reg('POST', `/copilot/runs/{id}/${name}`);
    app.post(`${p}/copilot/runs/:id/${name}`, { preHandler: guard(d, ROLES) }, async (req) => {
      const a = req.auth!;
      const { id } = parse(idParam, req.params);
      const r = await withContext(d.database, a.ctx, (tx) => visibleRun(tx, a, id));
      if (!mayControl(a, r))
        throw new AppError(403, 'FORBIDDEN', 'Only the person who started the run can control it');
      const why = allowed(r);
      if (why) throw new AppError(409, 'INVALID_STATE', why);
      const extra = await fn(r);
      return withContext(d.database, a.ctx, async (tx) => ({
        ...(await detail(tx, a, await visibleRun(tx, a, id))),
        ...(extra && typeof extra === 'object' ? { result: extra } : {}),
      }));
    });
  };
  const finished = (r: RunRow) =>
    ['COMPLETED', 'CANCELLED', 'FAILED'].includes(r.status) ? 'This run has finished' : null;
  control(
    'advance',
    (r) => engine.tick(r.id, { source: 'advance', force: true }),
    (r) => (r.status === 'PAUSED' ? 'The run is paused; resume it first' : finished(r)),
  );
  control(
    'pause',
    (r) => engine.pause(r),
    (r) => (r.status === 'PAUSED' ? 'The run is already paused' : finished(r)),
  );
  control(
    'resume',
    (r) => engine.resume(r),
    (r) => (r.status === 'PAUSED' ? null : 'The run is not paused'),
  );
  control(
    'cancel',
    (r) => engine.cancel(r),
    (r) => finished(r),
  );
  control(
    'simulate-suppliers',
    (r) => simulateSuppliers(engine, r, { userId: r.userId, role: r.userRole }),
    (r) => (r.status === 'PAUSED' ? 'The run is paused' : finished(r)),
  );

  control(
    'simulate-close',
    async (r) => {
      const out = await simulateClose(engine, r, { userId: r.userId, role: r.userRole });
      await engine.tick(r.id, { source: 'advance', force: true });
      return out;
    },
    (r) => (r.status === 'PAUSED' ? 'The run is paused' : finished(r)),
  );

  // ---------------------------------------------------------------- registry and summary
  reg('GET', '/copilot/agents');
  app.get(`${p}/copilot/agents`, { preHandler: guard(d, ROLES) }, async () => ({
    engine: ENGINE,
    simulated: true,
    agents: AGENTS.map((ag) => ({
      key: ag.key,
      label: ag.label,
      purpose: ag.purpose,
      tools: ag.tools.map((t) => ({
        name: t.name,
        method: t.method,
        path: t.path,
        roles: t.roles,
        summary: t.summary,
        optionalCapability: t.optionalCapability === true,
      })),
      mayNot: ag.mayNot,
    })),
    principles: [
      'The agent acts as the person who started the run, through the same routes, so it can never do more than that person can.',
      'It never approves: plan approval, award, contract signature, panel scoring, conflict declarations and dual-witness opening stay with people.',
      'Each tick reads the current state, so a step that is done is never repeated.',
      'A failed step is repaired in a fixed order, at most 3 attempts, then a named person is asked with what was tried.',
    ],
  }));

  reg('GET', '/copilot/summary');
  app.get(`${p}/copilot/summary`, { preHandler: guard(d, ROLES) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const conds = [eq(cpRun.tenantId, a.user.tenantId)];
      if (!isManager(a)) conds.push(eq(cpRun.userId, a.user.id));
      const rows = await tx
        .select({ status: cpRun.status, n: count() })
        .from(cpRun)
        .where(and(...conds))
        .groupBy(cpRun.status);
      const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
      const n = (...s: string[]) => s.reduce((t, k) => t + (by[k] ?? 0), 0);
      const mine = await tx
        .select({ id: cpRun.id })
        .from(cpRun)
        .where(and(...conds));
      const repaired = mine.length
        ? ((
            await tx
              .select({ n: count() })
              .from(cpProblem)
              .where(
                and(
                  inArray(
                    cpProblem.runId,
                    mine.map((m) => m.id),
                  ),
                  eq(cpProblem.status, 'REPAIRED'),
                ),
              )
          )[0]?.n ?? 0)
        : 0;
      const gates = await tx
        .select()
        .from(cpGate)
        .where(and(eq(cpGate.tenantId, a.user.tenantId), eq(cpGate.status, 'OPEN')));
      const waitingOnMe = gates.filter((g) => gateIsFor(g, a.user)).length;
      const recent = await tx
        .select({ r: cpRun, number: request.number })
        .from(cpRun)
        .leftJoin(request, eq(request.id, cpRun.requestId))
        .where(and(...conds))
        .orderBy(desc(cpRun.updatedAt))
        .limit(3);
      return {
        engine: ENGINE,
        simulated: true,
        scope: isManager(a) ? 'ALL' : 'MINE',
        total: rows.reduce((t, r) => t + r.n, 0),
        active: n('RUNNING', 'WAITING_GATE', 'NEEDS_HUMAN', 'PAUSED'),
        running: n('RUNNING'),
        waitingForPerson: n('WAITING_GATE', 'NEEDS_HUMAN'),
        needsHuman: n('NEEDS_HUMAN'),
        repaired,
        completed: n('COMPLETED'),
        waitingOnMe,
        recent: recent.map((x) => brief(x.r, { requestNumber: x.number })),
      };
    });
  });

  return { done, engine };
}
