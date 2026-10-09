import type { FastifyInstance } from 'fastify';
import type { GuardDeps } from '../../auth/guard.js';
import type { CpStage } from '../../db/schema.js';
import type { AgentKey } from './agents.js';
import type { Obs } from './observe.js';
import type { RunRow, Store } from './store.js';
import type { ToolClient, ToolResult } from './tools.js';

export interface Failure {
  code: string;
  message: string;
  http: number;
  errors: Array<{ field: string; message: string }>;
}

export type ActionResult =
  | {
      ok: true;
      result: Record<string, unknown>;
      http?: number;
      tool?: string;
      /** The tool belongs to a module that is not built yet; the run carried on in another way. */
      notAvailable?: boolean;
      /** Fields of the run to update (for example the id of the request just made). */
      patch?: { requestId?: string; title?: string };
    }
  | ({ ok: false } & Failure);

export interface Ctx {
  run: RunRow;
  obs: Obs;
  tool: ToolClient;
  store: Store;
  app: FastifyInstance;
  d: GuardDeps;
  now: Date;
  /** Names the step in the correlation id of every call (set by the engine). */
  stepKey: string;
  /** The roles of the person the run acts as. */
  roles: readonly string[];
  /** Does this person hold a role that the tool's route guard allows? (Checked before calling, to avoid a refused call.) */
  can(agent: AgentKey, tool: string): boolean;
  context: Record<string, unknown>;
  setContext(patch: Record<string, unknown>): Promise<void>;
  userName: string;
  /** Who the person's profile says they are (for filling a contract owner or business unit). */
  profile: { name: string; unitName: string | null };
  tenantConfig: { sector: string; statutoryMinDays: number };
  tenderDays: number;
}

export interface GateSpec {
  key: string;
  kind: string;
  stage: CpStage;
  agent: AgentKey;
  title: string;
  reason: string;
  rule: string;
  link: string;
  roles: readonly string[];
  /** When set, only these people get the action item (otherwise everyone holding one of the roles). */
  userIds?: readonly string[];
}

export interface Repair {
  key: string;
  label: string;
  agent: AgentKey;
  apply(ctx: Ctx, failure: Failure): Promise<{ applied: boolean; note: string }>;
}

export interface Action {
  type: 'ACTION';
  key: string;
  agent: AgentKey;
  stage: CpStage;
  title: string;
  reason: string;
  rule: string;
  /** May legitimately be needed again later under the same key (its result is a check, not a change). */
  repeatable?: boolean;
  run(ctx: Ctx): Promise<ActionResult>;
  repairs: readonly Repair[];
  /** Where an unrepairable failure goes (the right person, with what was tried). */
  escalate(ctx: Ctx, failure: Failure): GateSpec;
  /** When the route refuses the person's role, the run waits for someone who may. */
  onForbidden?: GateSpec;
}

export type Decision =
  | Action
  | { type: 'GATES'; stage: CpStage; gates: GateSpec[]; summary: string }
  | { type: 'WAIT'; stage: CpStage; summary: string; until?: Date | null }
  | { type: 'HUMAN'; stage: CpStage; gate: GateSpec; summary: string }
  | { type: 'DONE'; summary: string };

export const failureOf = (r: ToolResult): Failure => ({
  code: r.code ?? `HTTP_${r.status}`,
  message: r.title ?? `The request failed (${r.status})`,
  http: r.status,
  errors: r.errors,
});

export const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
