/**
 * Batch BCP, agent runtime (CP-01, CP-02, CP-03, CP-06): runs of the Procurement Copilot, their steps and events, the gates where
 * the agent waits for a person, problems with the repairs tried, and hand-offs between specialist agents. Re-exported from
 * schema.ts; migration 0028_bcp_agent_runtime.sql is the DDL. The small column helpers are repeated on purpose (see
 * schema-b10a.ts): importing them back would be circular.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const tenantId = () => uuid('tenant_id').notNull();
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const CP_RUN_STATUSES = [
  'RUNNING',
  'WAITING_GATE',
  'NEEDS_HUMAN',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type CpRunStatus = (typeof CP_RUN_STATUSES)[number];
export const CP_STAGES = ['REQUEST', 'PLAN', 'TENDER', 'EVALUATION', 'AWARD', 'CONTRACT', 'DONE'] as const;
export type CpStage = (typeof CP_STAGES)[number];
export const CP_MODES = ['FULL', 'ASSISTED'] as const;

/** One run of the agent for one procurement, started by one person; the agent acts as that person. */
export const cpRun = pgTable(
  'cp_run',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    userName: text('user_name').notNull(),
    userRole: text('user_role').notNull(),
    title: text('title').notNull(),
    sourceText: text('source_text').notNull(),
    mode: text('mode', { enum: CP_MODES }).notNull(),
    autoAdvance: boolean('auto_advance').notNull().default(true),
    status: text('status', { enum: CP_RUN_STATUSES }).notNull(),
    pausedFrom: text('paused_from'),
    stage: text('stage', { enum: CP_STAGES }).notNull().default('REQUEST'),
    requestId: uuid('request_id'),
    currentAgent: text('current_agent').notNull().default('ORCHESTRATOR'),
    currentAction: text('current_action'),
    waitingFor: jsonb('waiting_for').notNull().default([]),
    context: jsonb('context').notNull().default({}),
    tickCount: integer('tick_count').notNull().default(0),
    tickingSince: ts('ticking_since'),
    lastTickAt: ts('last_tick_at'),
    nextTickAt: ts('next_tick_at'),
    engine: text('engine').notNull().default('rules-simulated-v1'),
    simulated: boolean('simulated').notNull().default(true),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    completedAt: ts('completed_at'),
  },
  (t) => [
    index('cp_run_tenant_idx').on(t.tenantId, t.updatedAt),
    index('cp_run_user_idx').on(t.tenantId, t.userId),
  ],
);

export const CP_STEP_STATUSES = ['DONE', 'FAILED', 'REPAIRED', 'SKIPPED', 'NOT_AVAILABLE'] as const;
/** A thing the agent did (or tried): which agent, which tool, why, by which rule, and what came back. */
export const cpStep = pgTable(
  'cp_step',
  {
    id: id(),
    tenantId: tenantId(),
    runId: uuid('run_id').notNull(),
    seq: integer('seq').notNull(),
    stepKey: text('step_key').notNull(),
    idemKey: text('idem_key').notNull(),
    agent: text('agent').notNull(),
    tool: text('tool'),
    stage: text('stage').notNull(),
    status: text('status', { enum: CP_STEP_STATUSES }).notNull(),
    title: text('title').notNull(),
    reason: text('reason').notNull(),
    rule: text('rule').notNull(),
    request: jsonb('request').notNull().default({}),
    result: jsonb('result').notNull().default({}),
    httpStatus: integer('http_status'),
    attempt: integer('attempt').notNull().default(1),
    startedAt: ts('started_at').notNull(),
    finishedAt: ts('finished_at').notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    actorLabel: text('actor_label').notNull().default('Procurement Copilot'),
  },
  (t) => [uniqueIndex('cp_step_idem_uq').on(t.runId, t.idemKey), index('cp_step_run_idx').on(t.runId, t.seq)],
);

export const CP_EVENT_KINDS = ['STEP', 'GATE', 'PROBLEM', 'REPAIR', 'HANDOFF', 'STATUS', 'NOTE'] as const;
/** The live activity feed; `seq` is the cursor the run page polls with. */
export const cpEvent = pgTable(
  'cp_event',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: tenantId(),
    runId: uuid('run_id').notNull(),
    at: ts('at').notNull(),
    kind: text('kind', { enum: CP_EVENT_KINDS }).notNull(),
    agent: text('agent').notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull().default(''),
    data: jsonb('data').notNull().default({}),
  },
  (t) => [index('cp_event_run_idx').on(t.runId, t.seq)],
);

/** A point where the agent waits for a person. Open gates appear in that person's action items. */
export const cpGate = pgTable(
  'cp_gate',
  {
    id: id(),
    tenantId: tenantId(),
    runId: uuid('run_id').notNull(),
    gateKey: text('gate_key').notNull(),
    kind: text('kind').notNull(),
    stage: text('stage').notNull(),
    title: text('title').notNull(),
    reason: text('reason').notNull(),
    rule: text('rule').notNull(),
    link: text('link').notNull(),
    assigneeRoles: jsonb('assignee_roles').notNull().default([]),
    assigneeUserIds: jsonb('assignee_user_ids').notNull().default([]),
    assigneeNames: jsonb('assignee_names').notNull().default([]),
    status: text('status', { enum: ['OPEN', 'RESOLVED', 'CANCELLED'] }).notNull(),
    createdAt: ts('created_at').notNull(),
    resolvedAt: ts('resolved_at'),
    resolution: text('resolution'),
  },
  (t) => [
    uniqueIndex('cp_gate_open_uq')
      .on(t.runId, t.gateKey)
      .where(sql`status = 'OPEN'`),
    index('cp_gate_tenant_idx').on(t.tenantId, t.status),
  ],
);

/** Something found wrong at a step, the repairs tried in order, and the outcome (self-repair, at most 3 attempts). */
export const cpProblem = pgTable(
  'cp_problem',
  {
    id: id(),
    tenantId: tenantId(),
    runId: uuid('run_id').notNull(),
    stepKey: text('step_key').notNull(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull().default(''),
    status: text('status', { enum: ['OPEN', 'REPAIRED', 'ESCALATED', 'RESOLVED'] }).notNull(),
    attempts: jsonb('attempts').notNull().default([]),
    attemptCount: integer('attempt_count').notNull().default(0),
    fingerprint: text('fingerprint').notNull().default(''),
    escalatedTo: jsonb('escalated_to').notNull().default([]),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [
    uniqueIndex('cp_problem_active_uq')
      .on(t.runId, t.stepKey)
      .where(sql`status in ('OPEN', 'ESCALATED')`),
    index('cp_problem_run_idx').on(t.runId, t.createdAt),
  ],
);

/** The agent that handed the work to another specialist, and why (CP-06). */
export const cpHandoff = pgTable(
  'cp_handoff',
  {
    id: id(),
    tenantId: tenantId(),
    runId: uuid('run_id').notNull(),
    at: ts('at').notNull(),
    fromAgent: text('from_agent').notNull(),
    toAgent: text('to_agent').notNull(),
    reason: text('reason').notNull(),
    stepKey: text('step_key').notNull(),
  },
  (t) => [index('cp_handoff_run_idx').on(t.runId, t.at)],
);
