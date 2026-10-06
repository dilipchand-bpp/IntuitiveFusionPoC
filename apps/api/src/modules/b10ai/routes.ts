/**
 * AI models per tenant (NFR-C01, NFR-M06, SEC-TP07).
 *   GET  /ai/models                         the catalogue with each model's approval state and data-handling profile
 *   POST /ai/models/{key}/request-approval   ADMIN or PROCUREMENT asks for a third-party model to be approved
 *   POST /ai/approvals/{id}/decision        PROBITY or EXEC decides; never the person who asked
 *   POST /ai/models/{key}/revoke             withdraws an approval; the tenant falls back to the built-in model at once
 *   GET  /ai/active-model, PUT /ai/active-model   what answers now; changed by configuration only, no restart
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLE_NAMES, type Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext } from '../../db/client.js';
import { aiProviderApproval } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { loadSettings, saveSettings } from '../settings/settings.js';
import { AI_TASKS, MODELS, modelById, type AiModel } from './models.js';
import {
  approvalStates,
  assertSettable,
  fallBackFrom,
  isUsable,
  namesOf,
  resolveModel,
  type ModelApproval,
} from './service.js';

export interface AiDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
}

const VIEW = ['ADMIN', 'PROCUREMENT', 'PROBITY', 'EXEC'] as const;
const REQUEST = ['ADMIN', 'PROCUREMENT'] as const;
const DECIDE = ['PROBITY', 'EXEC'] as const;
const REVOKE = ['ADMIN', 'PROBITY', 'EXEC'] as const;
const STAFF = ROLE_NAMES.filter((r) => r !== 'SUPPLIER');
const uuid = z.string().uuid();
const keyParam = z.object({ key: z.string().trim().min(1).max(60) });
const reasonText = z.string().trim().min(3).max(500);
const requestBody = z.object({ reason: reasonText }).strict();
const decisionBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: reasonText }).strict();
const revokeBody = z.object({ reason: reasonText }).strict();
const activeBody = z
  .object({
    activeModel: z.string().trim().min(1).max(60),
    taskOverrides: z
      .record(z.enum(AI_TASKS as [string, ...string[]]), z.string().trim().min(1).max(60))
      .optional(),
  })
  .strict();

export function registerAiRoutes(app: FastifyInstance, p: string, d: AiDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);

  const modelView = (m: AiModel, st: ModelApproval, names: Map<string, string>, active: string) => ({
    id: m.id,
    provider: m.provider,
    label: m.label,
    simulated: m.simulated,
    builtIn: m.builtIn,
    dataHandling: m.dataHandling,
    approval: {
      state: st.state,
      ...(st.row
        ? {
            id: st.row.id,
            requestedBy: names.get(st.row.requestedBy) ?? null,
            requestedById: st.row.requestedBy,
            requestReason: st.row.requestReason,
            decidedBy: st.row.decidedBy ? (names.get(st.row.decidedBy) ?? null) : null,
            reason: st.row.reason,
            decidedAt: st.row.decidedAt?.toISOString() ?? null,
            revokedBy: st.row.revokedBy ? (names.get(st.row.revokedBy) ?? null) : null,
            revokeReason: st.row.revokeReason,
            revokedAt: st.row.revokedAt?.toISOString() ?? null,
            createdAt: st.row.createdAt.toISOString(),
          }
        : {}),
    },
    active: m.id === active,
    canActivate: isUsable(st.state),
  });

  reg('GET', '/ai/models');
  app.get(`${p}/ai/models`, { preHandler: guard(d, [...VIEW]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      const states = await approvalStates(tx, a.user.tenantId);
      const names = await namesOf(
        tx,
        [...states.values()].flatMap((x) =>
          x.row ? [x.row.requestedBy, x.row.decidedBy, x.row.revokedBy] : [],
        ),
      );
      const resolved = await resolveModel(tx, a.user.tenantId, undefined, s);
      return {
        activeModel: resolved.model.id,
        taskOverrides: s.ai.taskOverrides ?? {},
        tasks: AI_TASKS,
        models: MODELS.map((m) => modelView(m, states.get(m.id)!, names, resolved.model.id)),
      };
    });
  });

  reg('POST', '/ai/models/{key}/request-approval');
  app.post(
    `${p}/ai/models/:key/request-approval`,
    { preHandler: guard(d, [...REQUEST]) },
    async (req, reply) => {
      const a = req.auth!;
      const { key: id } = parse(keyParam, req.params);
      const b = parse(requestBody, req.body);
      const m = modelById(id);
      if (!m) throw new AppError(404, 'NOT_FOUND', 'Model not found');
      if (m.builtIn) throw new AppError(409, 'INVALID_STATE', 'The built-in model is always approved');
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const st = (await approvalStates(tx, a.user.tenantId)).get(m.id)!;
        if (st.state === 'APPROVED')
          throw new AppError(409, 'INVALID_STATE', 'This model is already approved');
        if (st.state === 'REQUESTED')
          throw new AppError(
            409,
            'INVALID_STATE',
            'An approval request for this model is already waiting for a decision',
          );
        const [row] = await tx
          .insert(aiProviderApproval)
          .values({
            tenantId: a.user.tenantId,
            modelId: m.id,
            provider: m.provider,
            status: 'REQUESTED',
            requestedBy: a.user.id,
            requestReason: b.reason,
            dataHandling: m.dataHandling,
            createdAt: d.clock.now(),
          })
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: 'ai.approval_requested',
          entityType: 'ai_provider_approval',
          entityId: row!.id,
          after: { model: m.id, provider: m.provider, reason: b.reason, dataHandling: m.dataHandling },
        });
        return { id: row!.id, modelId: m.id, status: row!.status };
      });
      return reply.status(201).send(out);
    },
  );

  reg('POST', '/ai/approvals/{id}/decision');
  app.post(`${p}/ai/approvals/:id/decision`, { preHandler: guard(d, [...DECIDE]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(decisionBody, req.body);
    const run = withContext(d.database, a.ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(aiProviderApproval)
        .where(and(eq(aiProviderApproval.id, id), eq(aiProviderApproval.tenantId, a.user.tenantId)));
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Approval request not found');
      if (row.status !== 'REQUESTED')
        throw new AppError(409, 'INVALID_STATE', 'This request has already been decided');
      if (row.requestedBy === a.user.id)
        throw new AppError(
          403,
          'SELF_APPROVAL',
          'You asked for this approval, so someone else must decide it',
        );
      const status = b.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await tx
        .update(aiProviderApproval)
        .set({ status, decidedBy: a.user.id, reason: b.reason, decidedAt: d.clock.now() })
        .where(eq(aiProviderApproval.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'ai.approval_decided',
        entityType: 'ai_provider_approval',
        entityId: id,
        before: { status: 'REQUESTED' },
        after: { status, model: row.modelId, reason: b.reason, requestedBy: row.requestedBy },
      });
      return { id, modelId: row.modelId, status };
    });
    try {
      return await run;
    } catch (e) {
      // the refusal is evidence too, and the transaction that refused it has been rolled back
      if (e instanceof AppError && e.code === 'SELF_APPROVAL')
        await d.audit.recordOutsideTx(d.database, a.ctx, {
          action: 'ai.approval_self_decision_refused',
          entityType: 'ai_provider_approval',
          entityId: id,
          result: 'DENIED',
        });
      throw e;
    }
  });

  reg('POST', '/ai/models/{key}/revoke');
  app.post(`${p}/ai/models/:key/revoke`, { preHandler: guard(d, [...REVOKE]) }, async (req) => {
    const a = req.auth!;
    const { key: id } = parse(keyParam, req.params);
    const b = parse(revokeBody, req.body);
    const m = modelById(id);
    if (!m) throw new AppError(404, 'NOT_FOUND', 'Model not found');
    if (m.builtIn) throw new AppError(409, 'INVALID_STATE', 'The built-in model cannot be revoked');
    return withContext(d.database, a.ctx, async (tx) => {
      const st = (await approvalStates(tx, a.user.tenantId)).get(m.id)!;
      if (st.state !== 'APPROVED' || !st.row)
        throw new AppError(409, 'INVALID_STATE', 'Only an approved model can be revoked');
      await tx
        .update(aiProviderApproval)
        .set({ status: 'REVOKED', revokedBy: a.user.id, revokeReason: b.reason, revokedAt: d.clock.now() })
        .where(eq(aiProviderApproval.id, st.row.id));
      await d.audit.record(tx, a.ctx, {
        action: 'ai.approval_revoked',
        entityType: 'ai_provider_approval',
        entityId: st.row.id,
        before: { status: 'APPROVED' },
        after: { status: 'REVOKED', model: m.id, reason: b.reason },
      });
      const fb = await fallBackFrom(tx, a.user.tenantId, m.id);
      if (fb.changed)
        await d.audit.record(tx, a.ctx, {
          action: 'settings.ai',
          entityType: 'tenant',
          entityId: a.user.tenantId,
          before: { ai: fb.before },
          after: { ai: fb.after, because: `${m.id} approval revoked` },
        });
      return {
        id: st.row.id,
        modelId: m.id,
        status: 'REVOKED',
        activeModel: fb.after.activeModel,
        fellBack: fb.changed,
      };
    });
  });

  const activeView = async (tx: Parameters<Parameters<typeof withContext>[2]>[0], tenantId: string) => {
    const s = await loadSettings(tx, tenantId);
    const r = await resolveModel(tx, tenantId, undefined, s);
    return {
      activeModel: r.model.id,
      label: r.model.label,
      simulated: r.model.simulated,
      builtIn: r.model.builtIn,
      dataHandling: r.model.dataHandling,
      taskOverrides: s.ai.taskOverrides ?? {},
      source: r.source,
    };
  };

  reg('GET', '/ai/active-model');
  app.get(`${p}/ai/active-model`, { preHandler: guard(d, [...STAFF]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, (tx) => activeView(tx, a.user.tenantId));
  });

  reg('PUT', '/ai/active-model');
  app.put(`${p}/ai/active-model`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const b = parse(activeBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const next = {
        activeModel: b.activeModel,
        ...(b.taskOverrides && Object.keys(b.taskOverrides).length ? { taskOverrides: b.taskOverrides } : {}),
      };
      await assertSettable(tx, a.user.tenantId, next);
      const { before, after } = await saveSettings(tx, a.user.tenantId, { ai: next });
      if (JSON.stringify(before.ai) !== JSON.stringify(after.ai)) {
        await d.audit.record(tx, a.ctx, {
          action: 'settings.ai',
          entityType: 'tenant',
          entityId: a.user.tenantId,
          before: { ai: before.ai },
          after: { ai: after.ai },
        });
        await d.audit.record(tx, a.ctx, {
          action: 'ai.active_model_changed',
          entityType: 'tenant',
          entityId: a.user.tenantId,
          before: { activeModel: before.ai.activeModel, taskOverrides: before.ai.taskOverrides ?? {} },
          after: { activeModel: after.ai.activeModel, taskOverrides: after.ai.taskOverrides ?? {} },
        });
      }
      return activeView(tx, a.user.tenantId);
    });
  });

  return done;
}
