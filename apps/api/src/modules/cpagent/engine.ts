/**
 * The tick engine (design principles 3 and 4). A run keeps no script position: every tick observes the procurement, asks stages.ts
 * what is next, does it through the tool adapter, checks the result, repairs a failure in a fixed order (at most 3 repair
 * attempts, each followed by a re-check) and otherwise stops at a gate or hands the problem to a named person. A step that is
 * already recorded is never repeated, and two ticks can never run at once on one run (a lock on the run row).
 */
import { and, asc, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { withSystem } from '../../db/client.js';
import {
  appUser,
  cpRun,
  notification,
  orgUnit,
  request,
  roleAssignment,
  tenant,
  type CpStage,
} from '../../db/schema.js';
import type { GuardDeps } from '../../auth/guard.js';
import { AGENT_BY_KEY, agentLabel, type AgentKey } from './agents.js';
import { observe, usersWithRoles, namesOf, type Obs } from './observe.js';
import { parseRequestText } from './parse.js';
import { decide, stageOf } from './stages.js';
import { Store, type ProblemAttempt, type RunRow } from './store.js';
import { ACTOR_LABEL, ToolClient } from './tools.js';
import type { Action, ActionResult, Ctx, Failure, GateSpec } from './types.js';

const MAX_REPAIRS = 3;
const MAX_ACTIONS_PER_TICK = 14;
const RUNNABLE = ['RUNNING', 'WAITING_GATE', 'NEEDS_HUMAN'] as const;

export interface EngineDeps extends GuardDeps {
  /** Days a tender stays open when the agent publishes (it is moved out if a statutory minimum says so). */
  tenderDays?: number;
}

export interface TickOutcome {
  ran: boolean;
  skipped?: 'busy' | 'not_runnable';
  actions: number;
  status: string;
}

export class CopilotEngine {
  readonly store: Store;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    readonly app: FastifyInstance,
    readonly d: EngineDeps,
  ) {
    this.store = new Store(d.database, d.clock);
  }

  // ------------------------------------------------------------------ start and control
  async createRun(
    user: { id: string; tenantId: string; name: string; role: string; roles: readonly string[] },
    input: {
      text: string;
      procurementId?: string | undefined;
      mode: 'FULL' | 'ASSISTED';
      autoAdvance: boolean;
    },
  ): Promise<RunRow> {
    const now = this.d.clock.now();
    const parsed = parseRequestText(input.text);
    const title = (parsed.title ?? input.text).slice(0, 120);
    const [run] = await withSystem(this.d.database, (tx) =>
      tx
        .insert(cpRun)
        .values({
          tenantId: user.tenantId,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          title,
          sourceText: input.text,
          mode: input.mode,
          autoAdvance: input.autoAdvance,
          status: 'RUNNING',
          stage: 'REQUEST',
          requestId: input.procurementId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
    );
    await this.store.event(
      run!,
      'STATUS',
      'ORCHESTRATOR',
      'Run started',
      `Acting as ${user.name} (${user.role}). Mode ${input.mode}. Everything is simulated and rules-based (rules-simulated-v1).`,
    );
    return run!;
  }

  async pause(run: RunRow) {
    if (!['RUNNING', 'WAITING_GATE', 'NEEDS_HUMAN'].includes(run.status)) return run;
    await this.store.updateRun(run.id, { status: 'PAUSED', pausedFrom: run.status });
    await this.store.event(
      run,
      'STATUS',
      'ORCHESTRATOR',
      'Run paused',
      'Nothing more happens until it is resumed.',
    );
    return (await this.store.getRun(run.id))!;
  }
  async resume(run: RunRow) {
    if (run.status !== 'PAUSED') return run;
    await this.store.updateRun(run.id, {
      status: (run.pausedFrom as RunRow['status']) ?? 'RUNNING',
      pausedFrom: null,
    });
    await this.store.event(
      run,
      'STATUS',
      'ORCHESTRATOR',
      'Run resumed',
      'The next tick looks at the procurement again.',
    );
    return (await this.store.getRun(run.id))!;
  }
  async cancel(run: RunRow) {
    if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(run.status)) return run;
    const open = await this.store.openGates(run.id);
    await this.store.resolveGates(
      open.map((g) => g.id),
      'The run was cancelled',
      'CANCELLED',
    );
    await this.store.updateRun(run.id, {
      status: 'CANCELLED',
      waitingFor: [],
      currentAction: 'Cancelled',
      completedAt: this.d.clock.now(),
    });
    await this.store.event(
      run,
      'STATUS',
      'ORCHESTRATOR',
      'Run cancelled',
      'What was already done on the procurement stays as it is.',
    );
    return (await this.store.getRun(run.id))!;
  }

  // ------------------------------------------------------------------ timer
  startTimer(ms: number) {
    if (this.timer) return;
    let busy = false;
    this.timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void this.tickDue().finally(() => (busy = false));
    }, ms);
    this.timer.unref();
  }
  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  /** Ticks every run that is waiting to be moved on and set to advance by itself. */
  async tickDue(): Promise<number> {
    const now = this.d.clock.now();
    const ids = await withSystem(this.d.database, (tx) =>
      tx
        .select({ id: cpRun.id })
        .from(cpRun)
        .where(
          and(
            inArray(cpRun.status, [...RUNNABLE]),
            eq(cpRun.autoAdvance, true),
            or(isNull(cpRun.nextTickAt), lte(cpRun.nextTickAt, now)),
          ),
        )
        .orderBy(asc(cpRun.updatedAt))
        .limit(25),
    );
    let n = 0;
    for (const r of ids) {
      try {
        const o = await this.tick(r.id, { source: 'timer' });
        if (o.ran) n += 1;
      } catch {
        /* a failed tick is recorded on its run; the timer carries on with the others */
      }
    }
    return n;
  }

  // ------------------------------------------------------------------ the tick
  async tick(
    runId: string,
    opts: { source: 'timer' | 'advance' | 'start'; force?: boolean } = { source: 'advance' },
  ): Promise<TickOutcome> {
    const first = await this.store.getRun(runId);
    if (!first) return { ran: false, skipped: 'not_runnable', actions: 0, status: 'MISSING' };
    if (!(RUNNABLE as readonly string[]).includes(first.status))
      return { ran: false, skipped: 'not_runnable', actions: 0, status: first.status };
    if (!(await this.store.lock(runId)))
      return { ran: false, skipped: 'busy', actions: 0, status: first.status };
    let tool: ToolClient | null = null;
    let actions = 0;
    try {
      let run = (await this.store.getRun(runId))!;
      await this.store.updateRun(run.id, { tickCount: run.tickCount + 1, lastTickAt: this.d.clock.now() });
      const who = await this.loadPerson(run);
      if (!who) {
        await this.fail(
          run,
          'The person who started this run can no longer use the system, so the run stopped.',
        );
        return { ran: true, actions, status: 'FAILED' };
      }
      tool = new ToolClient(this.app, this.d, {
        tenantId: run.tenantId,
        userId: run.userId,
        role: who.primaryRole,
        runId: run.id,
      });
      const cfg = await this.tenantConfig(run.tenantId);
      let force = opts.force === true;
      for (let i = 0; i < MAX_ACTIONS_PER_TICK; i++) {
        run = (await this.store.getRun(runId))!;
        if (!(RUNNABLE as readonly string[]).includes(run.status)) break;
        const obs = await observe(this.d.database, run.tenantId, run.requestId, this.d.clock.now());
        const stage = stageOf(obs);
        if (stage !== run.stage) {
          await this.store.updateRun(run.id, { stage });
          run.stage = stage;
          await this.store.event(
            run,
            'STATUS',
            'ORCHESTRATOR',
            `Stage: ${stage.charAt(0) + stage.slice(1).toLowerCase()}`,
            `Now in the ${stage.toLowerCase()} stage.`,
          );
        }
        await this.releaseStaleProblems(run, obs, force);
        const ctx = this.makeCtx(run, obs, tool, who, cfg);
        const decision = await decide(ctx);
        if (decision.type === 'DONE') {
          await this.complete(run, decision.summary);
          break;
        }
        if (decision.type === 'WAIT') {
          await this.wait(run, decision.summary, decision.until ?? null, decision.stage);
          break;
        }
        if (decision.type === 'GATES') {
          await this.applyGates(run, decision.gates, decision.summary, decision.stage, 'WAITING_GATE');
          break;
        }
        if (decision.type === 'HUMAN') {
          await this.applyGates(run, [decision.gate], decision.summary, decision.stage, 'NEEDS_HUMAN');
          break;
        }
        // an action
        const res = await this.perform(run, ctx, decision, force);
        force = false;
        actions += 1;
        if (res === 'ESCALATED' || res === 'GATED') break;
        if (run.mode === 'ASSISTED') {
          await this.store.event(
            run,
            'NOTE',
            'ORCHESTRATOR',
            'Assisted mode: one step done',
            'Press "Advance now" for the next step.',
          );
          await this.store.updateRun(run.id, {
            status: 'RUNNING',
            currentAction: 'Waiting for you to advance',
          });
          break;
        }
      }
      return { ran: true, actions, status: (await this.store.getRun(runId))!.status };
    } catch (err) {
      const run = await this.store.getRun(runId);
      if (run) {
        const n = Number((run.context as Record<string, unknown>).errors ?? 0) + 1;
        await this.store.setContext(run, { errors: n });
        await this.store.event(
          run,
          'NOTE',
          'ORCHESTRATOR',
          'A tick failed and will be tried again',
          (err as Error).message.slice(0, 300),
        );
        if (n >= 3) await this.fail(run, 'The run stopped after three failed ticks in a row.');
      }
      return { ran: true, actions, status: run?.status ?? 'FAILED' };
    } finally {
      if (tool) await tool.close();
      await this.store.unlock(runId);
    }
  }

  // ------------------------------------------------------------------ one action with its validator and repairs
  private async perform(
    run: RunRow,
    ctx: Ctx,
    action: Action,
    force: boolean,
  ): Promise<'DONE' | 'ESCALATED' | 'GATED'> {
    const store = this.store;
    let epoch = Number((run.context as Record<string, unknown>).retryEpoch ?? 0);
    let problem = await store.activeProblem(run.id, action.key);
    if (problem?.status === 'ESCALATED') {
      if (problem.fingerprint === ctx.obs.fingerprint && !force) {
        // unchanged since the person was asked: hold, do not try again
        await this.applyGates(
          run,
          [action.escalate(ctx, { code: problem.code, message: problem.title, http: 0, errors: [] })],
          'Waiting for a person',
          action.stage,
          'NEEDS_HUMAN',
        );
        return 'ESCALATED';
      }
      await this.closeProblem(
        run,
        problem.id,
        'RESOLVED',
        force ? 'A person asked for another try' : 'The state changed, so the step is tried again',
      );
      if (force) {
        epoch += 1;
        await store.setContext(run, { retryEpoch: epoch });
        ctx.context = run.context as Record<string, unknown>;
      }
      problem = null;
    }
    // a step with this key already ran and the state still asks for it: it had no effect, so it is not repeated (no loops)
    const baseKey = `${action.key}@${epoch}`;
    if (!problem && !action.repeatable && (await store.stepExists(run.id, `${baseKey}#1`))) {
      const f: Failure = {
        code: 'STEP_NO_EFFECT',
        message: `"${action.title}" ran but the record did not change as expected`,
        http: 0,
        errors: [],
      };
      const p = await store.openProblem(run, action.key, f.code, f.message, '', ctx.obs.fingerprint);
      await store.event(
        run,
        'PROBLEM',
        action.agent,
        f.message,
        'The step is not repeated; a person looks at it.',
      );
      await this.escalate(run, ctx, action, p.id, f, []);
      return 'ESCALATED';
    }

    await this.handoffTo(run, action);
    await store.updateRun(run.id, { currentAgent: action.agent, currentAction: action.title });
    let attemptNo = (problem?.attemptCount ?? 0) + 1;
    const attempts: ProblemAttempt[] = ((problem?.attempts as ProblemAttempt[] | undefined) ?? []).slice();
    for (;;) {
      ctx.stepKey = action.key;
      const started = this.d.clock.now();
      const t0 = Date.now();
      let res: ActionResult;
      try {
        res = await action.run(ctx);
      } catch (err) {
        res = {
          ok: false,
          code: 'EXCEPTION',
          message: (err as Error).message.slice(0, 300),
          http: 0,
          errors: [],
        };
      }
      const ms = Date.now() - t0;
      const idem = `${baseKey}#${attemptNo}${action.repeatable ? `@t${run.tickCount}` : ''}`;
      if (res.ok) {
        const repaired = attemptNo > 1;
        await store.addStep({
          tenantId: run.tenantId,
          runId: run.id,
          stepKey: action.key,
          idemKey: idem,
          agent: action.agent,
          tool: res.tool ?? null,
          stage: action.stage,
          status: res.notAvailable ? 'NOT_AVAILABLE' : repaired ? 'REPAIRED' : 'DONE',
          title: action.title,
          reason: action.reason,
          rule: action.rule,
          request: {},
          result: res.result,
          httpStatus: res.http ?? null,
          attempt: attemptNo,
          startedAt: started,
          finishedAt: this.d.clock.now(),
          durationMs: ms,
          actorLabel: ACTOR_LABEL,
        });
        await store.event(run, 'STEP', action.agent, action.title, summarise(res.result), {
          tool: res.tool ?? null,
          attempt: attemptNo,
          ms,
        });
        if (res.patch?.requestId || res.patch?.title)
          await store.updateRun(run.id, {
            ...(res.patch.requestId ? { requestId: res.patch.requestId } : {}),
            ...(res.patch.title ? { title: res.patch.title } : {}),
          });
        if (res.patch?.requestId) run.requestId = res.patch.requestId;
        if (problem) {
          if (attempts.length && attempts[attempts.length - 1]!.outcome !== 'NOT_APPLICABLE')
            attempts[attempts.length - 1]!.outcome = 'FIXED';
          await store.updateProblem(problem.id, {
            status: 'REPAIRED',
            attempts,
            attemptCount: attempts.length,
            resolvedAt: this.d.clock.now(),
          });
          await store.event(
            run,
            'REPAIR',
            action.agent,
            `Fixed after ${attempts.length} repair attempt(s): ${action.title}`,
            attempts.map((a) => `${a.n}. ${a.label}: ${a.note}`).join(' | '),
          );
        }
        return 'DONE';
      }
      // a failure
      await store.addStep({
        tenantId: run.tenantId,
        runId: run.id,
        stepKey: action.key,
        idemKey: idem,
        agent: action.agent,
        tool: null,
        stage: action.stage,
        status: 'FAILED',
        title: action.title,
        reason: action.reason,
        rule: action.rule,
        request: {},
        result: { code: res.code, message: res.message, errors: res.errors },
        httpStatus: res.http || null,
        attempt: attemptNo,
        startedAt: started,
        finishedAt: this.d.clock.now(),
        durationMs: ms,
        actorLabel: ACTOR_LABEL,
      });
      if (res.http === 403 && action.onForbidden) {
        if (problem)
          await this.closeProblem(
            run,
            problem.id,
            'RESOLVED',
            'The role is missing, so a person who holds it acts',
          );
        await this.applyGates(
          run,
          [action.onForbidden],
          "The route refused this person's role",
          action.stage,
          'WAITING_GATE',
        );
        return 'GATED';
      }
      if (!problem) {
        problem = await store.openProblem(
          run,
          action.key,
          res.code,
          res.message,
          res.errors.map((e) => e.message).join('; '),
          ctx.obs.fingerprint,
        );
        await store.event(
          run,
          'PROBLEM',
          action.agent,
          `Problem: ${res.message}`,
          `${action.title} did not pass its check (${res.code}). Trying repairs in order.`,
        );
      }
      const repair = attempts.length < MAX_REPAIRS ? action.repairs[attempts.length] : undefined;
      if (!repair) {
        await store.updateProblem(problem.id, { attempts, attemptCount: attempts.length });
        await this.escalate(run, ctx, action, problem.id, res, attempts);
        return 'ESCALATED';
      }
      if (repair.agent !== action.agent)
        await this.handoffTo(run, { agent: repair.agent, title: repair.label, key: action.key } as Action);
      let outcome: { applied: boolean; note: string };
      try {
        outcome = await repair.apply(ctx, res);
      } catch (err) {
        outcome = { applied: false, note: `The repair failed: ${(err as Error).message.slice(0, 200)}` };
      }
      attempts.push({
        n: attempts.length + 1,
        repair: repair.key,
        label: repair.label,
        outcome: outcome.applied ? 'NOT_FIXED' : 'NOT_APPLICABLE',
        note: outcome.note,
        at: this.d.clock.now().toISOString(),
      });
      await store.updateProblem(problem.id, { attempts, attemptCount: attempts.length });
      await store.event(
        run,
        'REPAIR',
        repair.agent,
        `Repair ${attempts.length}: ${repair.label}`,
        outcome.note,
        { applied: outcome.applied },
      );
      if (repair.agent !== action.agent) await this.handoffTo(run, action);
      // the repair changed the record: look again before the re-check
      ctx.obs = await observe(this.d.database, run.tenantId, run.requestId, this.d.clock.now());
      attemptNo += 1;
    }
  }

  private async escalate(
    run: RunRow,
    ctx: Ctx,
    action: Action,
    problemId: string,
    f: Failure,
    attempts: ProblemAttempt[],
  ) {
    const spec = action.escalate(ctx, f);
    const tried = attempts.length
      ? ` What the Copilot tried: ${attempts.map((a) => `${a.n}. ${a.label} (${a.outcome === 'NOT_APPLICABLE' ? 'not applicable: ' : ''}${a.note})`).join('; ')}.`
      : ' The Copilot has no automatic repair for this.';
    const withTried: GateSpec = { ...spec, reason: `${spec.reason}${tried}` };
    const assignees = await this.assignees(run, withTried);
    await this.store.updateProblem(problemId, {
      status: 'ESCALATED',
      // the record as it is now (the repairs may have changed it): a later change by a person is what releases the problem
      fingerprint: ctx.obs.fingerprint,
      escalatedTo: assignees.names,
      attempts,
      attemptCount: attempts.length,
    });
    await this.store.event(
      run,
      'PROBLEM',
      'ORCHESTRATOR',
      `Needs a person: ${spec.title}`,
      `${f.message}.${tried} Raised to ${assignees.names.slice(0, 4).join(', ') || assignees.roles.join(', ')}.`,
      { code: f.code },
    );
    await this.applyGates(
      run,
      [{ ...withTried, kind: 'NEEDS_HUMAN' }],
      'Waiting for a person',
      action.stage,
      'NEEDS_HUMAN',
    );
  }

  private async closeProblem(run: RunRow, id: string, status: 'RESOLVED' | 'REPAIRED', why: string) {
    await this.store.updateProblem(id, { status, resolvedAt: this.d.clock.now() });
    const gates = await this.store.openGates(run.id);
    await this.store.resolveGates(
      gates.filter((g) => g.kind === 'NEEDS_HUMAN').map((g) => g.id),
      why,
    );
    await this.store.event(run, 'NOTE', 'ORCHESTRATOR', 'Problem closed', why);
  }

  /** A problem that was handed to a person is closed when the procurement changed under it (the person acted). */
  private async releaseStaleProblems(run: RunRow, obs: Obs, force: boolean) {
    if (force) return;
    const probs = await this.store.problems(run.id);
    for (const p of probs)
      if (p.status === 'ESCALATED' && p.fingerprint !== obs.fingerprint) {
        await this.closeProblem(
          run,
          p.id,
          'RESOLVED',
          'The state changed after a person was asked, so the Copilot looks again',
        );
      }
  }

  // ------------------------------------------------------------------ gates and waiting
  private async assignees(run: RunRow, g: GateSpec) {
    const byRole = g.roles.length ? await usersWithRoles(this.d.database, run.tenantId, g.roles) : [];
    const ids = [...new Set([...(g.userIds ?? []), ...byRole.map((u) => u.id)])];
    const names = await namesOf(this.d.database, run.tenantId, ids);
    return { ids, names, roles: [...g.roles] };
  }

  private async applyGates(
    run: RunRow,
    specs: GateSpec[],
    summary: string,
    stage: CpStage,
    status: 'WAITING_GATE' | 'NEEDS_HUMAN',
  ) {
    const store = this.store;
    const open = await store.openGates(run.id);
    const wanted = new Set(specs.map((s) => s.key));
    await store.resolveGates(
      open.filter((g) => !wanted.has(g.gateKey)).map((g) => g.id),
      'The person acted or the procurement moved on',
    );
    const have = new Set(open.map((g) => g.gateKey));
    for (const s of specs) {
      if (have.has(s.key)) continue;
      const a = await this.assignees(run, s);
      const created = await store.addGate({
        tenantId: run.tenantId,
        runId: run.id,
        gateKey: s.key,
        kind: s.kind,
        stage: s.stage,
        title: s.title.slice(0, 300),
        reason: s.reason.slice(0, 2000),
        rule: s.rule,
        link: s.link,
        assigneeRoles: [...s.roles],
        assigneeUserIds: a.ids,
        assigneeNames: a.names,
        status: 'OPEN',
        createdAt: this.d.clock.now(),
      });
      if (!created) continue;
      await store.event(
        run,
        'GATE',
        s.agent,
        s.kind === 'NEEDS_HUMAN' ? `Needs a person: ${s.title}` : `Waiting: ${s.title}`,
        `${s.reason} Rule: ${s.rule}. Waiting for ${a.names.slice(0, 5).join(', ') || s.roles.join(', ')}.`,
        { gateKey: s.key, kind: s.kind },
      );
      // a note in the notification list of each person asked (the same text as the action item)
      if (a.ids.length)
        await withSystem(this.d.database, (tx) =>
          tx.insert(notification).values(
            a.ids.slice(0, 12).map((userId) => ({
              tenantId: run.tenantId,
              userId,
              title: `Procurement Copilot is waiting for you: ${s.title}`.slice(0, 200),
              body: s.reason.slice(0, 400),
              link: s.link,
            })),
          ),
        );
    }
    const now = await store.openGates(run.id);
    const waiting = now.map((g) => ({
      gateId: g.id,
      kind: g.kind,
      title: g.title,
      reason: g.reason,
      link: g.link,
      roles: g.assigneeRoles,
      names: g.assigneeNames,
      userIds: g.assigneeUserIds,
    }));
    const next = now.some((g) => g.kind === 'NEEDS_HUMAN') ? 'NEEDS_HUMAN' : status;
    if (run.status !== next)
      await store.event(
        run,
        'STATUS',
        'ORCHESTRATOR',
        next === 'NEEDS_HUMAN' ? 'Needs a person' : 'Waiting at a gate',
        summary,
      );
    await store.updateRun(run.id, {
      status: next,
      stage,
      currentAgent: 'ORCHESTRATOR',
      currentAction: summary,
      waitingFor: waiting,
      nextTickAt: null,
    });
  }

  private async wait(run: RunRow, summary: string, until: Date | null, stage: CpStage) {
    const open = await this.store.openGates(run.id);
    await this.store.resolveGates(
      open.map((g) => g.id),
      'Nothing is waiting for a person now',
    );
    if (run.currentAction !== summary || run.status !== 'RUNNING')
      await this.store.event(
        run,
        'NOTE',
        'ORCHESTRATOR',
        summary,
        until ? `Next look at ${until.toISOString().slice(0, 16).replace('T', ' ')} UTC or sooner.` : '',
      );
    await this.store.updateRun(run.id, {
      status: 'RUNNING',
      stage,
      currentAgent: 'ORCHESTRATOR',
      currentAction: summary,
      waitingFor: [],
      nextTickAt: null,
    });
  }

  private async complete(run: RunRow, summary: string) {
    const open = await this.store.openGates(run.id);
    await this.store.resolveGates(
      open.map((g) => g.id),
      'The run is complete',
    );
    await this.store.updateRun(run.id, {
      status: 'COMPLETED',
      stage: 'DONE',
      waitingFor: [],
      currentAction: summary,
      completedAt: this.d.clock.now(),
    });
    await this.store.event(run, 'STATUS', 'ORCHESTRATOR', 'Run completed', summary);
  }

  private async fail(run: RunRow, why: string) {
    const open = await this.store.openGates(run.id);
    await this.store.resolveGates(
      open.map((g) => g.id),
      'The run stopped',
      'CANCELLED',
    );
    await this.store.updateRun(run.id, {
      status: 'FAILED',
      waitingFor: [],
      currentAction: why,
      completedAt: this.d.clock.now(),
    });
    await this.store.event(run, 'STATUS', 'ORCHESTRATOR', 'Run failed', why);
  }

  private async handoffTo(run: RunRow, action: Pick<Action, 'agent' | 'title' | 'key'>) {
    const fresh = (await this.store.getRun(run.id))!;
    if (fresh.currentAgent === action.agent) return;
    await this.store.handoff(run, fresh.currentAgent, action.agent, action.title, action.key);
    await this.store.event(
      run,
      'HANDOFF',
      fresh.currentAgent,
      `${agentLabel(fresh.currentAgent)} handed over to ${agentLabel(action.agent)}`,
      action.title,
    );
    await this.store.updateRun(run.id, { currentAgent: action.agent });
  }

  // ------------------------------------------------------------------ context
  private makeCtx(
    run: RunRow,
    obs: Obs,
    tool: ToolClient,
    who: Person,
    cfg: { sector: string; statutoryMinDays: number },
  ): Ctx {
    const store = this.store;
    const ctx: Ctx = {
      run,
      obs,
      tool,
      store,
      app: this.app,
      d: this.d,
      now: this.d.clock.now(),
      stepKey: '',
      roles: who.roles,
      can: (agent: AgentKey, name: string) => {
        const def = AGENT_BY_KEY.get(agent)?.tools.find((t) => t.name === name);
        if (!def) return false;
        return def.roles === 'any' || def.roles.some((r) => who.roles.includes(r));
      },
      context: run.context as Record<string, unknown>,
      async setContext(patch) {
        await store.setContext(run, patch);
        ctx.context = run.context as Record<string, unknown>;
      },
      userName: who.name,
      profile: { name: who.name, unitName: who.unitName },
      tenantConfig: cfg,
      tenderDays: this.d.tenderDays ?? 14,
    };
    return ctx;
  }

  private async loadPerson(run: RunRow): Promise<Person | null> {
    return withSystem(this.d.database, async (tx) => {
      const [u] = await tx
        .select({ name: appUser.name, active: appUser.active, unit: orgUnit.name })
        .from(appUser)
        .leftJoin(orgUnit, eq(orgUnit.id, appUser.orgUnitId))
        .where(and(eq(appUser.id, run.userId), eq(appUser.tenantId, run.tenantId)));
      if (!u || !u.active) return null;
      const roles = await tx
        .select({ role: roleAssignment.role })
        .from(roleAssignment)
        .where(and(eq(roleAssignment.userId, run.userId), eq(roleAssignment.tenantId, run.tenantId)));
      return {
        name: u.name,
        unitName: u.unit ?? null,
        roles: roles.map((r) => r.role),
        primaryRole: run.userRole,
      };
    });
  }

  private async tenantConfig(tenantId: string) {
    return withSystem(this.d.database, async (tx) => {
      const [t] = await tx.select().from(tenant).where(eq(tenant.id, tenantId));
      const c = (t?.config ?? {}) as { statutoryMinDays?: number };
      return {
        sector: t?.sector ?? 'PRIVATE',
        statutoryMinDays: t?.sector === 'PUBLIC' ? Number(c.statutoryMinDays ?? 0) : 0,
      };
    });
  }

  /** Runs for one request (to find who is acting on a procurement). */
  async runsForRequest(tenantId: string, requestId: string) {
    return withSystem(this.d.database, (tx) =>
      tx
        .select()
        .from(cpRun)
        .where(and(eq(cpRun.tenantId, tenantId), eq(cpRun.requestId, requestId)))
        .orderBy(desc(cpRun.createdAt)),
    );
  }

  async requestVisibleTo(
    tenantId: string,
    requestId: string,
    user: { id: string; roles: readonly string[] },
  ) {
    return withSystem(this.d.database, async (tx) => {
      const [r] = await tx
        .select({ id: request.id, requesterId: request.requesterId })
        .from(request)
        .where(and(eq(request.id, requestId), eq(request.tenantId, tenantId)));
      if (!r) return false;
      const ownerOnly = user.roles.length === 1 && user.roles[0] === 'REQUESTER';
      return !ownerOnly || r.requesterId === user.id;
    });
  }
}

interface Person {
  name: string;
  unitName: string | null;
  roles: string[];
  primaryRole: string;
}

function summarise(result: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(result)) {
    if (v === null || v === undefined || v === '') continue;
    const val = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    parts.push(`${k}: ${val.length > 140 ? `${val.slice(0, 140)}...` : val}`);
  }
  return parts.join('; ').slice(0, 600);
}
