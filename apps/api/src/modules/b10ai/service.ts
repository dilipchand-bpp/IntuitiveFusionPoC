/**
 * Which AI model a tenant uses, and the approval that lets a third-party one be switched on (NFR-C01, NFR-M06, SEC-TP07).
 *
 * The rule that matters is enforced in two places on purpose: `assertSettable` refuses to NAME an unapproved model in
 * the tenant's `ai` setting, and `resolveModel` refuses to USE one that is not approved right now. So revoking an
 * approval takes effect on the very next call even if some other path had left the old name in the setting.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { aiProviderApproval, appUser, type AiProviderApprovalRow } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { assertOutbound, checkOutbound } from '../b11priv/outbound.js';
import { loadSettings, saveSettings, type Settings } from '../settings/settings.js';
import { AI_TASKS, DEFAULT_MODEL_ID, MODELS, modelById, type AiModel, type AiTask } from './models.js';

export type ApprovalState = 'BUILT_IN' | 'NOT_REQUESTED' | 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REVOKED';

export interface ModelApproval {
  state: ApprovalState;
  /** The approval row that explains the state, when there is one. */
  row: AiProviderApprovalRow | null;
}

/** The current approval state of every model for the tenant. */
export async function approvalStates(tx: Tx, tenantId: string): Promise<Map<string, ModelApproval>> {
  const rows = await tx
    .select()
    .from(aiProviderApproval)
    .where(eq(aiProviderApproval.tenantId, tenantId))
    .orderBy(asc(aiProviderApproval.createdAt));
  const out = new Map<string, ModelApproval>();
  for (const m of MODELS) {
    if (m.builtIn) {
      out.set(m.id, { state: 'BUILT_IN', row: null });
      continue;
    }
    const mine = rows.filter((r) => r.modelId === m.id);
    const approved = mine.find((r) => r.status === 'APPROVED');
    const open = mine.find((r) => r.status === 'REQUESTED');
    const last = mine.length ? mine[mine.length - 1]! : null;
    if (approved) out.set(m.id, { state: 'APPROVED', row: approved });
    else if (open) out.set(m.id, { state: 'REQUESTED', row: open });
    else if (last) out.set(m.id, { state: last.status as ApprovalState, row: last });
    else out.set(m.id, { state: 'NOT_REQUESTED', row: null });
  }
  return out;
}

export const isUsable = (state: ApprovalState) => state === 'BUILT_IN' || state === 'APPROVED';

/** Names of the people behind approval rows, for display. */
export async function namesOf(tx: Tx, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!uniq.length) return new Map();
  const rows = await tx
    .select({ id: appUser.id, name: appUser.name })
    .from(appUser)
    .where(inArray(appUser.id, uniq));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export interface Resolved {
  model: AiModel;
  /** Why this model: the tenant's active model, a per-task override, or the fall-back because approval was withdrawn. */
  source: 'ACTIVE' | 'OVERRIDE' | 'FALLBACK';
  /** Set when the model was refused for residency or egress (SEC-D09, SEC-D05) and the built-in model was used instead. */
  refused?: string;
}

/** The model to use for a task, right now, for this tenant. Never returns a model that is not approved. */
export async function resolveModel(
  tx: Tx,
  tenantId: string,
  task?: AiTask,
  settings?: Settings,
): Promise<Resolved> {
  const s = settings ?? (await loadSettings(tx, tenantId));
  const wanted = (task ? s.ai.taskOverrides?.[task] : undefined) ?? s.ai.activeModel;
  const model = modelById(wanted);
  if (!model) return { model: modelById(DEFAULT_MODEL_ID)!, source: 'FALLBACK' };
  if (!model.builtIn) {
    const st = (await approvalStates(tx, tenantId)).get(model.id);
    if (!st || !isUsable(st.state)) return { model: modelById(DEFAULT_MODEL_ID)!, source: 'FALLBACK' };
    // SEC-D09 and SEC-D05: the content would leave the application, so the hosting country and the egress allow-list apply
    const refused = await checkOutbound(tx, tenantId, {
      purpose: 'AI_MODEL',
      target: { label: model.label, host: model.endpointHost, region: model.dataHandling.region },
      settings: s,
    });
    if (refused) return { model: modelById(DEFAULT_MODEL_ID)!, source: 'FALLBACK', refused: refused.code };
  }
  const overridden =
    task !== undefined && s.ai.taskOverrides?.[task] === wanted && wanted !== s.ai.activeModel;
  return { model, source: overridden ? 'OVERRIDE' : 'ACTIVE' };
}

/** What every response that came from a model carries, so a person can always see what produced it. */
export const modelStamp = (r: Resolved) => ({
  model: r.model.id,
  modelLabel: r.model.label,
  modelSimulated: r.model.simulated,
  modelSource: r.source,
  ...(r.refused ? { modelRefused: r.refused } : {}),
});

/** Refuses an `ai` setting that names an unknown model, an unknown task, or a third-party model that is not approved. */
export async function assertSettable(
  tx: Tx,
  tenantId: string,
  ai: Settings['ai'],
  actorId?: string,
): Promise<void> {
  const states = await approvalStates(tx, tenantId);
  const problems: Array<{ field: string; message: string }> = [];
  const check = (field: string, id: string) => {
    const m = modelById(id);
    if (!m) return void problems.push({ field, message: `"${id}" is not a model this platform knows` });
    const st = states.get(id)!;
    if (!isUsable(st.state))
      problems.push({
        field,
        message: `${m.label} cannot be switched on: it is ${st.state === 'NOT_REQUESTED' ? 'not approved for this organisation yet' : st.state.toLowerCase()}`,
      });
  };
  check('activeModel', ai.activeModel);
  for (const [task, id] of Object.entries(ai.taskOverrides ?? {})) {
    if (!(AI_TASKS as readonly string[]).includes(task))
      problems.push({
        field: `taskOverrides.${task}`,
        message: `"${task}" is not a task a model can be chosen for`,
      });
    else check(`taskOverrides.${task}`, id);
  }
  if (problems.length > 0) {
    const unapproved = problems.some((p) => p.message.includes('cannot be switched on'));
    throw new AppError(
      unapproved ? 409 : 422,
      unapproved ? 'MODEL_NOT_APPROVED' : 'VALIDATION_FAILED',
      unapproved
        ? 'A third-party AI model must be approved for this organisation before it can be switched on'
        : 'Some AI settings are not valid',
      problems,
    );
  }
  // SEC-D09 and SEC-D05: a model that would process content outside the elected country, or on a host that is not on the
  // egress allow-list, cannot be named. The refusal is audited; the caller commits it (refusable) and answers 422.
  for (const id of [ai.activeModel, ...Object.values(ai.taskOverrides ?? {})]) {
    const m = modelById(id);
    if (m && !m.builtIn)
      await assertOutbound(tx, tenantId, {
        purpose: 'AI_MODEL',
        target: { label: m.label, host: m.endpointHost, region: m.dataHandling.region },
        actorId: actorId ?? null,
      });
  }
}

/** Withdraws a model from the tenant's settings: back to the built-in model, and any task override that used it is removed. */
export async function fallBackFrom(
  tx: Tx,
  tenantId: string,
  modelId: string,
): Promise<{ before: Settings['ai']; after: Settings['ai']; changed: boolean }> {
  const s = await loadSettings(tx, tenantId);
  const before = s.ai;
  const overrides = Object.fromEntries(
    Object.entries(before.taskOverrides ?? {}).filter(([, v]) => v !== modelId),
  );
  const after: Settings['ai'] = {
    activeModel: before.activeModel === modelId ? DEFAULT_MODEL_ID : before.activeModel,
    ...(Object.keys(overrides).length ? { taskOverrides: overrides } : {}),
  };
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  if (changed) await saveSettings(tx, tenantId, { ai: after });
  return { before, after, changed };
}

export const findOpen = (tx: Tx, tenantId: string, modelId: string) =>
  tx
    .select()
    .from(aiProviderApproval)
    .where(
      and(
        eq(aiProviderApproval.tenantId, tenantId),
        eq(aiProviderApproval.modelId, modelId),
        eq(aiProviderApproval.status, 'REQUESTED'),
      ),
    );
