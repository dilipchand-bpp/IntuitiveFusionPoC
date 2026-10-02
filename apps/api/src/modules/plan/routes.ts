/**
 * Procurement plan endpoints (M7): US-PLN-01..05.
 * State machine: DRAFT -> AWAITING_SIGNOFF -> AWAITING_APPROVAL -> APPROVED_LOCKED -> (reopen) REOPENED -> ...
 * Visibility mirrors requests: a requester sees their own; an invisible plan is a 404, never a 403.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Clock, RoleName } from '@if/shared';
import type { AiProvider } from '../../adapters/ai-provider.js';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { checkDelegation } from '../../authz/delegation.js';
import { checkSod } from '../../authz/sod.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  appUser,
  approval,
  coiDeclaration,
  fieldValue,
  notification,
  plan,
  request,
  roleAssignment,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { PLAN_FIELDS, PLAN_FIELD_BY_KEY, joinParagraphs, splitParagraphs } from './fields.js';
import { PlanService, type Loaded } from './service.js';

export interface PlanDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
  ai: AiProvider;
}
type AuthCtx = NonNullable<FastifyRequest['auth']>;

const uuid = z.string().uuid();
const READERS = [
  'REQUESTER',
  'PROCUREMENT',
  'DELEGATE',
  'EVALUATOR',
  'CHAIR',
  'LEGAL',
  'PROBITY',
  'EXEC',
] as const;
const EDITORS = ['PROCUREMENT', 'REQUESTER'] as const;
const ownerOnly = (roles: readonly string[]) => roles.length === 1 && roles[0] === 'REQUESTER';
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

const fieldBody = z
  .object({
    value: z.string().max(8000),
    paragraph: z.number().int().min(1).optional(),
    expectedVersion: z.number().int(),
  })
  .strict();
const instructionBody = z
  .object({ text: z.string().trim().min(1).max(2000), channel: z.enum(['TEXT', 'VOICE']).default('TEXT') })
  .strict();
const undoBody = z.object({ undoToken: z.string().uuid() }).strict();
const decisionBody = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    comment: z.string().trim().max(2000).optional(),
    gate: z.enum(['RISK_SIGNOFF']).optional(),
  })
  .strict();
const reopenBody = z.object({ reason: z.string().trim().min(10).max(1000) }).strict();
const coiBody = z
  .object({
    none: z.boolean(),
    nature: z.string().trim().min(3).max(2000).optional(),
    subjectOrg: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((b) => b.none || Boolean(b.nature), { message: 'Describe the conflict', path: ['nature'] });
const coiDecisionBody = z
  .object({
    disposition: z.enum(['IMMATERIAL', 'MANAGEABLE', 'MATERIAL']),
    rationale: z.string().trim().max(2000).optional(),
  })
  .strict();

export function registerPlanRoutes(app: FastifyInstance, p: string, d: PlanDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const svc = new PlanService(d.clock, d.audit, d.ai);

  /** Loads a plan the caller may see, else 404. */
  async function visible(tx: Tx, a: AuthCtx, planId: string): Promise<Loaded> {
    const l = await svc.load(tx, a.user.tenantId, planId);
    if (!l || (ownerOnly(a.user.roles) && l.req.requesterId !== a.user.id))
      throw new AppError(404, 'NOT_FOUND', 'Plan not found');
    return l;
  }
  const mayEdit = (a: AuthCtx, l: Loaded) =>
    a.user.roles.includes('PROCUREMENT') ||
    (a.user.roles.includes('REQUESTER') && l.req.requesterId === a.user.id);
  const planId = (req: FastifyRequest) => parse(z.object({ id: uuid }), req.params).id;

  // ---------------------------------------------------------------- read
  reg('GET', '/plans');
  app.get(
    `${p}/plans`,
    { preHandler: guard(d, ['REQUESTER', 'PROCUREMENT', 'DELEGATE', 'LEGAL', 'PROBITY', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      const q = parse(z.object({ status: z.string().max(30).optional() }), req.query);
      return withContext(d.database, a.ctx, async (tx) => {
        const conds = [eq(request.tenantId, a.user.tenantId)];
        if (ownerOnly(a.user.roles)) conds.push(eq(request.requesterId, a.user.id));
        const rows = await tx
          .select({ r: request, p: plan })
          .from(request)
          .leftJoin(plan, eq(plan.requestId, request.id))
          .where(and(...conds))
          .orderBy(desc(request.updatedAt));
        return rows
          .filter(({ r }) => r.status !== 'DRAFT')
          .map(({ r, p: pl }) => ({
            ...(pl ? { planId: pl.id } : {}),
            requestId: r.id,
            requestNumber: r.number,
            title: r.title,
            estimatedValue: Number(r.estimatedValue ?? 0),
            ...(r.complexity ? { complexity: r.complexity } : {}),
            status: pl?.status ?? 'NOT_STARTED',
            updatedAt: (pl?.updatedAt ?? r.updatedAt).toISOString(),
          }))
          .filter((x) => !q.status || x.status === q.status);
      });
    },
  );

  reg('GET', '/requests/{id}/plan');
  app.get(`${p}/requests/:id/plan`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const [r] = await tx
        .select()
        .from(request)
        .where(and(eq(request.id, id), eq(request.tenantId, a.user.tenantId)));
      if (!r || (ownerOnly(a.user.roles) && r.requesterId !== a.user.id))
        throw new AppError(404, 'NOT_FOUND', 'Request not found');
      const pid = await svc.ensure(tx, a.ctx, id);
      return svc.view(tx, a, pid);
    });
  });

  // ---------------------------------------------------------------- editing
  reg('PUT', '/plans/{id}/fields/{key}');
  app.put(`${p}/plans/:id/fields/:key`, { preHandler: guard(d, [...EDITORS]) }, async (req) => {
    const a = req.auth!;
    const { id, key } = parse(z.object({ id: uuid, key: z.string().max(40) }), req.params);
    const body = parse(fieldBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (!mayEdit(a, l)) throw new AppError(403, 'FORBIDDEN', 'You cannot edit this plan');
      svc.assertEditable(l.plan);
      if (body.expectedVersion !== l.plan.version)
        throw new AppError(
          409,
          'VERSION_CONFLICT',
          'The plan changed while you were editing; reload and try again',
        );
      if (!PLAN_FIELD_BY_KEY.has(key))
        throw new AppError(400, 'VALIDATION_FAILED', 'Unknown plan field', [
          { field: key, message: 'Not a plan section' },
        ]);
      let value = body.value;
      if (body.paragraph !== undefined) {
        const ps = splitParagraphs(l.planFields.find((f) => f.key === key)?.value);
        if (body.paragraph > ps.length)
          throw new AppError(400, 'VALIDATION_FAILED', 'No such paragraph', [
            { field: 'paragraph', message: `This section has ${ps.length} paragraph(s)` },
          ]);
        value = joinParagraphs(ps.map((x, i) => (i === body.paragraph! - 1 ? body.value.trim() : x)));
      }
      await svc.writeField(tx, a.ctx, l, key, value, 'USER', 'plan.field_update');
      return svc.view(tx, a, id);
    });
  });

  reg('POST', '/plans/{id}/instructions');
  app.post(`${p}/plans/:id/instructions`, { preHandler: guard(d, [...EDITORS]) }, async (req) => {
    const a = req.auth!;
    const id = planId(req);
    const body = parse(instructionBody, req.body);
    if (body.channel === 'VOICE')
      throw new AppError(
        422,
        'VOICE_NOT_AVAILABLE',
        'Voice input is coming soon; please type your instruction',
      );
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (!mayEdit(a, l)) throw new AppError(403, 'FORBIDDEN', 'You cannot edit this plan');
      svc.assertEditable(l.plan);
      const current = Object.fromEntries(l.planFields.map((f) => [f.key, f.value ?? undefined]));
      const r = await d.ai.interpretPlanInstruction(body.text, current);
      await d.audit.record(tx, a.ctx, {
        action: 'ai.interpret_instruction',
        entityType: 'plan',
        entityId: id,
        after: {
          provider: d.ai.name,
          simulated: d.ai.simulated,
          understood: r.ok,
          text: body.text.slice(0, 300),
        },
      });
      if (!r.ok) return { applied: [], explanation: 'I did not change anything.', fallbackHint: r.hint };
      const row = l.planFields.find((f) => f.key === r.key);
      const undoToken = await svc.saveUndo(tx, l, {
        key: r.key,
        before: row?.value ?? '',
        source: row?.source ?? 'AI',
        aiDrafted: row?.aiDrafted ?? false,
      });
      await svc.writeField(tx, a.ctx, l, r.key, r.newValue, 'USER', 'plan.instruction_apply');
      return {
        applied: [{ key: r.key, label: r.label, value: r.newValue, source: 'USER', aiDrafted: false }],
        undoToken,
        explanation: r.explanation,
      };
    });
  });

  reg('POST', '/plans/{id}/instructions/undo');
  app.post(`${p}/plans/:id/instructions/undo`, { preHandler: guard(d, [...EDITORS]) }, async (req) => {
    const a = req.auth!;
    const id = planId(req);
    const body = parse(undoBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (!mayEdit(a, l)) throw new AppError(403, 'FORBIDDEN', 'You cannot edit this plan');
      svc.assertEditable(l.plan);
      const u = await svc.readUndo(tx, id);
      if (!u || u.token !== body.undoToken)
        throw new AppError(
          409,
          'UNDO_NOT_AVAILABLE',
          'There is nothing to undo, or a later change replaced it',
        );
      await svc.writeField(tx, a.ctx, l, u.key, u.before, 'USER', 'plan.instruction_undo');
      // Put back the original authorship marker as well, not just the text.
      await tx
        .update(fieldValue)
        .set({ source: u.source, aiDrafted: u.aiDrafted })
        .where(and(eq(fieldValue.ownerType, 'PLAN'), eq(fieldValue.ownerId, id), eq(fieldValue.key, u.key)));
      await svc.clearUndo(tx, id);
      return svc.view(tx, a, id);
    });
  });

  // ---------------------------------------------------------------- workflow
  reg('POST', '/plans/{id}/submit-for-approval');
  app.post(`${p}/plans/:id/submit-for-approval`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const id = planId(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      svc.assertEditable(l.plan);
      const empty = PLAN_FIELDS.filter(
        (f) => f.mandatory && !splitParagraphs(l.planFields.find((x) => x.key === f.key)?.value).length,
      );
      if (empty.length > 0)
        throw new AppError(
          409,
          'PLAN_INCOMPLETE',
          'Some required sections are empty',
          empty.map((f) => ({ field: f.key, message: `${f.label} is required` })),
        );
      await tx
        .update(plan)
        .set({ status: 'AWAITING_SIGNOFF', updatedAt: d.clock.now(), version: l.plan.version + 1 })
        .where(eq(plan.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'plan.submit',
        entityType: 'plan',
        entityId: id,
        before: { status: l.plan.status },
        after: { status: 'AWAITING_SIGNOFF' },
      });
      const gates = await svc.evaluateGates(tx, l);
      if (gates.some((g) => g.key === 'RISK_SIGNOFF' && g.status === 'REQUIRED')) {
        await svc.notifyRoles(
          tx,
          a.user.tenantId,
          ['PROBITY'],
          'Risk sign-off requested',
          `${l.req.number} ${l.req.title}`,
          `/app/plans/${l.req.id}`,
        );
      }
      await svc.advance(tx, a.ctx, id);
      return svc.view(tx, a, id);
    });
  });

  reg('POST', '/plans/{id}/decision');
  app.post(
    `${p}/plans/:id/decision`,
    { preHandler: guard(d, ['DELEGATE', 'EXEC', 'PROBITY']) },
    async (req) => {
      const a = req.auth!;
      const id = planId(req);
      const body = parse(decisionBody, req.body);
      const roles = a.user.roles;
      const approver = roles.includes('DELEGATE') || roles.includes('EXEC');
      const riskOfficer = roles.includes('PROBITY');
      const riskMode = body.gate === 'RISK_SIGNOFF' || (!approver && riskOfficer);
      if (riskMode && !riskOfficer)
        throw new AppError(403, 'FORBIDDEN', 'Only the independent risk officer can sign off the risk gate');
      if (!riskMode && !approver)
        throw new AppError(403, 'FORBIDDEN', 'Only a delegate with sourcing authority can approve a plan');
      if (body.decision === 'REJECT' && (body.comment ?? '').length < 5)
        throw new AppError(400, 'VALIDATION_FAILED', 'A reason is required', [
          { field: 'comment', message: 'Say why in at least 5 characters' },
        ]);

      const out = await withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        const now = d.clock.now();
        const stamp = (verb: string) =>
          `${verb} · ${a.user.name} · ${a.user.role.replace('_', ' ')} · ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

        if (riskMode) {
          if (l.plan.status !== 'AWAITING_SIGNOFF')
            throw new AppError(409, 'INVALID_STATE', 'The plan is not waiting for risk sign-off');
          await tx.insert(approval).values({
            tenantId: a.user.tenantId,
            subjectType: 'PLAN_RISK',
            subjectId: id,
            userId: a.user.id,
            role: a.user.role,
            decision: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            comment: body.comment ?? null,
            stamp: stamp(body.decision === 'APPROVE' ? 'RISK SIGNED OFF' : 'RISK REJECTED'),
            decidedAt: now,
          });
          await d.audit.record(tx, a.ctx, {
            action: body.decision === 'APPROVE' ? 'plan.risk_signoff' : 'plan.risk_reject',
            entityType: 'plan',
            entityId: id,
            after: { decision: body.decision, comment: body.comment ?? null },
          });
          if (body.decision === 'REJECT') {
            await tx
              .update(plan)
              .set({ status: 'REJECTED', updatedAt: now, version: l.plan.version + 1 })
              .where(eq(plan.id, id));
            await svc.notifyRoles(
              tx,
              a.user.tenantId,
              ['PROCUREMENT'],
              'Plan returned by risk officer',
              `${l.req.number}: ${body.comment}`,
              `/app/plans/${l.req.id}`,
            );
          } else await svc.advance(tx, a.ctx, id);
          return svc.view(tx, a, id);
        }

        if (l.plan.status !== 'AWAITING_APPROVAL')
          throw new AppError(
            409,
            'INVALID_STATE',
            l.plan.status === 'AWAITING_SIGNOFF'
              ? 'Required checks are not complete yet'
              : 'The plan is not waiting for approval',
          );
        const sod = checkSod('APPROVE_OWN_SUBJECT', {
          roles: roles as RoleName[],
          isAuthorOfSubject: l.req.requesterId === a.user.id,
        });
        if (!sod.ok) throw new AppError(403, sod.code, sod.message);
        if (body.decision === 'APPROVE') {
          const value = Number(l.req.estimatedValue ?? 0);
          const del = await checkDelegation(
            tx,
            { tenantId: a.user.tenantId, userId: a.user.id, roles },
            'SOURCING_APPROVAL',
            value,
          );
          if (!del.allowed)
            throw new AppError(
              403,
              del.code ?? 'DELEGATION_EXCEEDED',
              del.limit === null
                ? 'You do not hold sourcing approval authority'
                : `This plan (${aud.format(value)}) is above your sourcing authority of ${aud.format(del.limit)}`,
            );
          await tx.insert(approval).values({
            tenantId: a.user.tenantId,
            subjectType: 'PLAN',
            subjectId: id,
            userId: a.user.id,
            role: a.user.role,
            decision: 'APPROVED',
            comment: body.comment ?? null,
            stamp: stamp('APPROVED'),
            decidedAt: now,
          });
          await tx
            .update(plan)
            .set({ status: 'APPROVED_LOCKED', locked: true, updatedAt: now, version: l.plan.version + 1 })
            .where(eq(plan.id, id));
          await tx
            .update(request)
            .set({ status: 'IN_PROGRESS', updatedAt: now })
            .where(eq(request.id, l.req.id));
          await d.audit.record(tx, a.ctx, {
            action: 'plan.approve',
            entityType: 'plan',
            entityId: id,
            before: { status: 'AWAITING_APPROVAL', locked: false },
            after: { status: 'APPROVED_LOCKED', locked: true, value, limit: del.limit },
          });
          await tx.insert(notification).values({
            tenantId: a.user.tenantId,
            userId: l.req.requesterId,
            title: 'Your plan was approved',
            body: `${l.req.number} ${l.req.title}`,
            link: `/app/plans/${l.req.id}`,
          });
          await svc.notifyRoles(
            tx,
            a.user.tenantId,
            ['PROCUREMENT'],
            'Plan approved and locked',
            `${l.req.number} ${l.req.title}`,
            `/app/plans/${l.req.id}`,
          );
        } else {
          await tx.insert(approval).values({
            tenantId: a.user.tenantId,
            subjectType: 'PLAN',
            subjectId: id,
            userId: a.user.id,
            role: a.user.role,
            decision: 'REJECTED',
            comment: body.comment ?? null,
            stamp: stamp('REJECTED'),
            decidedAt: now,
          });
          await tx
            .update(plan)
            .set({ status: 'REJECTED', updatedAt: now, version: l.plan.version + 1 })
            .where(eq(plan.id, id));
          await d.audit.record(tx, a.ctx, {
            action: 'plan.reject',
            entityType: 'plan',
            entityId: id,
            before: { status: 'AWAITING_APPROVAL' },
            after: { status: 'REJECTED', comment: body.comment },
          });
          await svc.notifyRoles(
            tx,
            a.user.tenantId,
            ['PROCUREMENT'],
            'Plan rejected',
            `${l.req.number}: ${body.comment}`,
            `/app/plans/${l.req.id}`,
          );
        }
        return svc.view(tx, a, id);
      });
      return out;
    },
  );

  reg('POST', '/plans/{id}/reopen');
  app.post(`${p}/plans/:id/reopen`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const id = planId(req);
    const body = parse(reopenBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (!l.plan.locked)
        throw new AppError(409, 'INVALID_STATE', 'Only an approved, locked plan can be reopened');
      const now = d.clock.now();
      // Earlier approvals no longer apply to the changed plan; the rows stay as history, marked superseded.
      for (const subject of ['PLAN', 'PLAN_RISK']) {
        await tx
          .update(approval)
          .set({ decision: 'SUPERSEDED' })
          .where(
            and(
              eq(approval.subjectType, subject),
              eq(approval.subjectId, id),
              eq(approval.decision, 'APPROVED'),
            ),
          );
      }
      await tx
        .update(plan)
        .set({ status: 'REOPENED', locked: false, updatedAt: now, version: l.plan.version + 1 })
        .where(eq(plan.id, id));
      await tx.update(request).set({ status: 'SUBMITTED', updatedAt: now }).where(eq(request.id, l.req.id));
      await d.audit.record(tx, a.ctx, {
        action: 'plan.reopen',
        entityType: 'plan',
        entityId: id,
        before: { status: 'APPROVED_LOCKED', locked: true },
        after: { status: 'REOPENED', locked: false, reason: body.reason },
      });
      const refreshed = (await svc.load(tx, a.user.tenantId, id))!;
      await svc.evaluateGates(tx, refreshed); // risk sign-off is required again
      await svc.notifyRoles(
        tx,
        a.user.tenantId,
        ['DELEGATE', 'EXEC'],
        'Approved plan reopened',
        `${l.req.number}: ${body.reason}`,
        `/app/plans/${l.req.id}`,
      );
      await tx.insert(notification).values({
        tenantId: a.user.tenantId,
        userId: l.req.requesterId,
        title: 'Your approved plan was reopened',
        body: `${l.req.number}: ${body.reason}`,
        link: `/app/plans/${l.req.id}`,
      });
      return svc.view(tx, a, id);
    });
  });

  // ---------------------------------------------------------------- conflicts of interest
  reg('POST', '/plans/{id}/coi');
  app.post(
    `${p}/plans/:id/coi`,
    { preHandler: guard(d, ['PROCUREMENT', 'EVALUATOR', 'CHAIR', 'LEGAL', 'DELEGATE']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = planId(req);
      const body = parse(coiBody, req.body);
      const rec = await withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        if (l.plan.locked) throw new AppError(423, 'PLAN_LOCKED', 'This plan is locked');
        const [dup] = await tx
          .select({ id: coiDeclaration.id })
          .from(coiDeclaration)
          .where(
            and(
              eq(coiDeclaration.scope, 'PLAN'),
              eq(coiDeclaration.scopeId, id),
              eq(coiDeclaration.userId, a.user.id),
            ),
          );
        if (dup) throw new AppError(409, 'ALREADY_DECLARED', 'You have already declared for this plan');
        // A real conflict is routed to the delegate (or the executive when there is no delegate) for a decision.
        let routedTo: string | null = null;
        if (!body.none) {
          const cand = await tx
            .select({ userId: roleAssignment.userId, role: roleAssignment.role })
            .from(roleAssignment)
            .where(eq(roleAssignment.tenantId, a.user.tenantId));
          routedTo =
            cand.find((c) => c.role === 'DELEGATE' && c.userId !== a.user.id)?.userId ??
            cand.find((c) => c.role === 'EXEC' && c.userId !== a.user.id)?.userId ??
            null;
        }
        const now = d.clock.now();
        const [row] = await tx
          .insert(coiDeclaration)
          .values({
            tenantId: a.user.tenantId,
            userId: a.user.id,
            scope: 'PLAN',
            scopeId: id,
            none: body.none,
            nature: body.nature ?? null,
            subjectOrg: body.subjectOrg ?? null,
            disposition: body.none ? 'IMMATERIAL' : 'PENDING',
            routedTo,
            decidedAt: body.none ? now : null,
            createdAt: now,
          })
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: body.none ? 'coi.declare_none' : 'coi.declare_conflict',
          entityType: 'plan',
          entityId: id,
          after: {
            coiId: row!.id,
            none: body.none,
            nature: body.nature ?? null,
            subjectOrg: body.subjectOrg ?? null,
            routedTo,
          },
        });
        if (routedTo)
          await tx.insert(notification).values({
            tenantId: a.user.tenantId,
            userId: routedTo,
            title: 'Conflict of interest needs your decision',
            body: `${l.req.number}: ${a.user.name} declared a conflict`,
            link: `/app/plans/${l.req.id}`,
          });
        await svc.advance(tx, a.ctx, id);
        return {
          id: row!.id,
          userId: a.user.id,
          userName: a.user.name,
          scope: 'PLAN',
          scopeId: id,
          none: body.none,
          ...(body.nature ? { nature: body.nature } : {}),
          disposition: row!.disposition,
          ...(routedTo ? { routedTo } : {}),
          ...(row!.decidedAt ? { decidedAt: row!.decidedAt.toISOString() } : {}),
        };
      });
      return reply.status(201).send(rec);
    },
  );

  reg('POST', '/coi/{id}/decision');
  app.post(
    `${p}/coi/:id/decision`,
    { preHandler: guard(d, ['DELEGATE', 'EXEC', 'PROBITY']) },
    async (req) => {
      const a = req.auth!;
      const id = planId(req);
      const body = parse(coiDecisionBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const [c] = await tx
          .select()
          .from(coiDeclaration)
          .where(and(eq(coiDeclaration.id, id), eq(coiDeclaration.tenantId, a.user.tenantId)));
        if (!c || c.scope !== 'PLAN') throw new AppError(404, 'NOT_FOUND', 'Declaration not found');
        if (c.userId === a.user.id)
          throw new AppError(403, 'ROLE_SOD_VIOLATION', 'You cannot decide your own conflict of interest');
        if (c.disposition !== 'PENDING')
          throw new AppError(409, 'INVALID_STATE', 'This declaration has already been decided');
        const now = d.clock.now();
        await tx
          .update(coiDeclaration)
          .set({ disposition: body.disposition, decidedAt: now })
          .where(eq(coiDeclaration.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'coi.decide',
          entityType: 'plan',
          entityId: c.scopeId,
          before: { disposition: 'PENDING' },
          after: { coiId: id, disposition: body.disposition, rationale: body.rationale ?? null },
        });
        await svc.advance(tx, a.ctx, c.scopeId);
        const [who] = await tx.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, c.userId));
        return {
          id,
          userId: c.userId,
          userName: who?.name ?? '',
          scope: c.scope,
          scopeId: c.scopeId,
          none: c.none,
          ...(c.nature ? { nature: c.nature } : {}),
          disposition: body.disposition,
          ...(body.rationale ? { rationale: body.rationale } : {}),
          decidedAt: now.toISOString(),
        };
      });
    },
  );

  return done;
}
