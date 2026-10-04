/**
 * Evaluation endpoints (M9): US-EVL-01..05.
 * Flow: open (procurement picks the panel) -> every member declares conflicts -> independent hidden scoring ->
 * consensus with variance flags -> lock -> report -> delegate approval.
 * An evaluation a person may not see is a 404, never a 403.
 */
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Clock, RoleName } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { checkDelegation } from '../../authz/delegation.js';
import { checkSod } from '../../authz/sod.js';
import { withContext, withSystem, type Tx } from '../../db/client.js';
import {
  appUser,
  approval,
  coiDeclaration,
  consensusItem,
  criterion,
  evalReport,
  evaluation,
  fieldValue,
  fileObject,
  panelMember,
  request,
  roleAssignment,
  score,
  submission,
  tender,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { loadSettings } from '../settings/settings.js';
import type { SealedStore } from '../tender/files.js';
import { evaluationCriteria } from '../tender/pack.js';
import { TenderService } from '../tender/service.js';
import { REPORT_SECTIONS, buildReport } from './report.js';
import { atLeast, EvaluationService, isSuspended, type Loaded } from './service.js';
import { evaluationReportDocx, evaluationReportPdf } from './report-pdf.js';
import {
  canScoreCriterion,
  canSeeFileSection,
  isFlagged,
  validScore,
  variancePct,
  type Stream,
} from './scoring.js';
import type { TenderType } from '../tender/fields.js';

export interface EvaluationDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
  store: SealedStore;
}

const uuid = z.string().uuid();
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const PROCESS: readonly RoleName[] = ['PROCUREMENT', 'DELEGATE', 'LEGAL', 'PROBITY', 'EXEC'];

const openBody = z
  .object({
    panel: z
      .array(z.object({ userId: uuid, stream: z.enum(['TECHNICAL', 'COMMERCIAL']) }).strict())
      .min(1)
      .max(12),
  })
  .strict();
const addPanelBody = z
  .object({ userId: uuid, stream: z.enum(['TECHNICAL', 'COMMERCIAL', 'OTHER']) })
  .strict();
const coiBody = z
  .object({
    none: z.boolean(),
    nature: z.string().trim().min(3).max(2000).optional(),
    subjectOrg: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((b) => b.none || Boolean(b.nature), { message: 'Describe the conflict', path: ['nature'] });
const scoresBody = z
  .object({
    supplierId: uuid,
    scores: z
      .array(
        z
          .object({ criterionId: uuid, score: z.number(), comment: z.string().trim().max(2000).optional() })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
const consensusBody = z
  .object({
    items: z
      .array(
        z
          .object({
            criterionId: uuid,
            consensusScore: z.number(),
            rationale: z.string().trim().max(2000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
const varianceBody = z.object({ limitPct: z.number().int().min(5).max(60) }).strict();
const signoffBody = z.object({ comment: z.string().trim().max(1000).optional() }).strict();
const reopenBody = z.object({ reason: z.string().trim().min(10).max(1000) }).strict();
const conflictDecisionBody = z
  .object({
    disposition: z.enum(['IMMATERIAL', 'MANAGEABLE', 'MATERIAL']),
    rationale: z.string().trim().max(2000).optional(),
  })
  .strict();
const decisionBody = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().trim().max(2000).optional() })
  .strict();

export function registerEvaluationRoutes(app: FastifyInstance, p: string, d: EvaluationDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const svc = new EvaluationService(d.clock, d.audit);
  const tenders = new TenderService(d.clock, d.audit, d.store);
  const fresh = () => tenders.closeDue(d.database);
  const eid = (req: FastifyRequest) => parse(z.object({ id: uuid }), req.params).id;

  /** Loads an evaluation the caller may see, else 404. Panel members who were removed have no access. */
  async function visible(tx: Tx, a: AuthContext, id: string): Promise<Loaded> {
    const l = await svc.load(tx, a.user.tenantId, id);
    if (!l) throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
    const processRole = a.user.roles.some((r) => PROCESS.includes(r));
    const me = svc.memberOf(l, a.user.id);
    if (!processRole && (!me || isSuspended(me)))
      throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
    return l;
  }
  /** The caller's own panel seat, which must exist and have declared no conflict. */
  function declaredMember(l: Loaded, a: AuthContext) {
    const me = svc.memberOf(l, a.user.id);
    if (!me || isSuspended(me)) throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
    if (me.coiState !== 'DECLARED_NONE')
      throw new AppError(403, 'COI_REQUIRED', 'Declare that you have no conflict of interest first');
    return me;
  }

  // ---------------------------------------------------------------- lists
  reg('GET', '/evaluations');
  app.get(
    `${p}/evaluations`,
    { preHandler: guard(d, ['PROCUREMENT', 'EVALUATOR', 'CHAIR', 'DELEGATE', 'PROBITY', 'LEGAL', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      await fresh();
      return withContext(d.database, a.ctx, async (tx) => {
        const processRole = a.user.roles.some((r) => PROCESS.includes(r));
        const rows = await tx
          .select({ ev: evaluation, r: request })
          .from(evaluation)
          .innerJoin(tender, eq(tender.id, evaluation.tenderId))
          .innerJoin(request, eq(request.id, tender.requestId))
          .where(eq(evaluation.tenantId, a.user.tenantId))
          .orderBy(desc(evaluation.updatedAt));
        const evaluations = [];
        for (const { ev, r } of rows) {
          const panel = await tx.select().from(panelMember).where(eq(panelMember.evaluationId, ev.id));
          const mine = panel.find((m) => m.userId === a.user.id);
          if (!processRole && (!mine || isSuspended(mine))) continue;
          const [bids] = await tx
            .select({ n: count() })
            .from(submission)
            .where(and(eq(submission.tenderId, ev.tenderId), eq(submission.status, 'SUBMITTED')));
          evaluations.push({
            id: ev.id,
            tenderId: ev.tenderId,
            requestNumber: r.number,
            title: r.title,
            status: ev.status,
            bids: bids?.n ?? 0,
            panelSize: panel.filter((m) => !isSuspended(m)).length,
            ...(mine ? { myCoiState: mine.coiState, myScoringComplete: Boolean(mine.scoredAt) } : {}),
            updatedAt: ev.updatedAt.toISOString(),
          });
        }
        let ready: unknown[] = [];
        if (a.user.roles.includes('PROCUREMENT')) {
          const closed = await tx
            .select({ t: tender, r: request })
            .from(tender)
            .innerJoin(request, eq(request.id, tender.requestId))
            .where(and(eq(tender.tenantId, a.user.tenantId), eq(tender.status, 'CLOSED')));
          const have = new Set(rows.map((x) => x.ev.tenderId));
          ready = [];
          for (const { t, r } of closed.filter((x) => !have.has(x.t.id))) {
            const [bids] = await tx
              .select({ n: count() })
              .from(submission)
              .where(and(eq(submission.tenderId, t.id), eq(submission.status, 'SUBMITTED')));
            (ready as unknown[]).push({
              tenderId: t.id,
              requestNumber: r.number,
              title: r.title,
              type: t.type,
              bids: bids?.n ?? 0,
              evaluable: evaluationCriteria(t.type as TenderType) !== null,
            });
          }
        }
        return { evaluations, ready };
      });
    },
  );

  reg('GET', '/evaluators');
  app.get(`${p}/evaluators`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select({ id: appUser.id, name: appUser.name, role: roleAssignment.role })
        .from(roleAssignment)
        .innerJoin(appUser, eq(appUser.id, roleAssignment.userId))
        .where(
          and(
            eq(roleAssignment.tenantId, a.user.tenantId),
            inArray(roleAssignment.role, ['EVALUATOR', 'CHAIR']),
            eq(appUser.active, true),
          ),
        );
      return {
        evaluators: rows.filter((r) => r.role === 'EVALUATOR').map((r) => ({ id: r.id, name: r.name })),
        chairs: rows.filter((r) => r.role === 'CHAIR').map((r) => ({ id: r.id, name: r.name })),
      };
    });
  });

  // ---------------------------------------------------------------- open (US-EVL-02)
  reg('POST', '/tenders/{id}/evaluation');
  app.post(`${p}/tenders/:id/evaluation`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req, reply) => {
    const a = req.auth!;
    const tenderId = eid(req);
    const body = parse(openBody, req.body);
    await fresh();
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const [t] = await tx
        .select()
        .from(tender)
        .where(and(eq(tender.id, tenderId), eq(tender.tenantId, a.user.tenantId)));
      if (!t) throw new AppError(404, 'NOT_FOUND', 'Tender not found');
      if (t.status !== 'CLOSED')
        throw new AppError(409, 'INVALID_STATE', 'Evaluation opens once the tender has closed');
      const template = evaluationCriteria(t.type as TenderType);
      if (!template)
        throw new AppError(409, 'NOT_EVALUABLE', 'This type of document is not scored for award');
      const [existing] = await tx
        .select({ id: evaluation.id })
        .from(evaluation)
        .where(eq(evaluation.tenderId, tenderId));
      if (existing) throw new AppError(409, 'EVALUATION_EXISTS', 'This tender already has an evaluation');
      const bids = await tx
        .select({ id: submission.id })
        .from(submission)
        .where(and(eq(submission.tenderId, tenderId), eq(submission.status, 'SUBMITTED')));
      if (bids.length === 0)
        throw new AppError(409, 'NO_BIDS', 'No bids were submitted, so there is nothing to evaluate');
      const [req0] = await tx.select().from(request).where(eq(request.id, t.requestId));

      const ids = body.panel.map((m) => m.userId);
      if (new Set(ids).size !== ids.length)
        throw new AppError(400, 'PANEL_INVALID', 'A person can only be on the panel once');
      const roleRows = await tx
        .select({ userId: roleAssignment.userId, role: roleAssignment.role })
        .from(roleAssignment)
        .where(
          and(
            eq(roleAssignment.tenantId, a.user.tenantId),
            inArray(roleAssignment.role, ['EVALUATOR', 'CHAIR']),
          ),
        );
      const isEvaluator = new Set(roleRows.filter((r) => r.role === 'EVALUATOR').map((r) => r.userId));
      const bad = ids.filter((i) => !isEvaluator.has(i));
      if (bad.length)
        throw new AppError(400, 'PANEL_INVALID', 'Panel members must be users with the evaluator role');
      if (ids.includes(req0!.requesterId))
        throw new AppError(
          400,
          'PANEL_INVALID',
          'The person who raised the request cannot evaluate the responses',
        );
      for (const s of ['TECHNICAL', 'COMMERCIAL'] as const)
        if (template.some((c) => c.stream === s) && !body.panel.some((m) => m.stream === s))
          throw new AppError(
            400,
            'PANEL_INVALID',
            `The panel needs at least one ${s.toLowerCase()} evaluator`,
          );
      const chairId = roleRows.find((r) => r.role === 'CHAIR')?.userId;
      if (!chairId) throw new AppError(409, 'NO_CHAIR', 'There is no panel chair in the system');

      const now = d.clock.now();
      const [ev] = await tx
        .insert(evaluation)
        .values({
          tenantId: a.user.tenantId,
          tenderId,
          status: 'COI_PENDING',
          varianceLimitPct: 30,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      for (const c of template)
        await tx.insert(criterion).values({
          tenantId: a.user.tenantId,
          evaluationId: ev!.id,
          name: c.name,
          weight: String(c.weight),
          stream: c.stream,
          passFail: c.passFail,
        });
      const members = [...body.panel, { userId: chairId, stream: 'OTHER' as const }];
      for (const m of members)
        await tx.insert(panelMember).values({
          tenantId: a.user.tenantId,
          evaluationId: ev!.id,
          userId: m.userId,
          stream: m.stream,
          coiState: 'NOT_DECLARED',
        });
      await tx
        .update(tender)
        .set({ status: 'EVALUATING', updatedAt: now, version: t.version + 1 })
        .where(eq(tender.id, tenderId));
      await tx
        .update(request)
        .set({ phase: 'EVALUATION', updatedAt: now })
        .where(eq(request.id, t.requestId));
      await d.audit.record(tx, a.ctx, {
        action: 'evaluation.open',
        entityType: 'evaluation',
        entityId: ev!.id,
        after: { tenderId, bidders: bids.length, panel: members.length, criteria: template.length },
      });
      await svc.notifyUsers(
        tx,
        a.user.tenantId,
        members.map((m) => m.userId),
        'You are on an evaluation panel',
        `${req0!.number} ${req0!.title}: declare any conflict of interest before you see the suppliers`,
        `/app/evaluations/${ev!.id}`,
      );
      const l = (await svc.load(tx, a.user.tenantId, ev!.id))!;
      return svc.view(tx, a, l);
    });
    return reply.status(201).send(out);
  });

  reg('POST', '/evaluations/{id}/panel');
  app.post(`${p}/evaluations/:id/panel`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req, reply) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(addPanelBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (l.ev.status !== 'COI_PENDING' && l.ev.status !== 'SCORING')
        throw new AppError(409, 'INVALID_STATE', 'The panel can only change before consensus');
      if (l.panel.some((m) => m.userId === body.userId))
        throw new AppError(409, 'ALREADY_MEMBER', 'This person is, or was, on the panel');
      const roles = (
        await tx
          .select({ role: roleAssignment.role })
          .from(roleAssignment)
          .where(and(eq(roleAssignment.tenantId, a.user.tenantId), eq(roleAssignment.userId, body.userId)))
      ).map((r) => r.role);
      const ok = body.stream === 'OTHER' ? roles.includes('CHAIR') : roles.includes('EVALUATOR');
      if (!ok)
        throw new AppError(
          400,
          'PANEL_INVALID',
          body.stream === 'OTHER' ? 'The chair seat needs a chair' : 'Panel members must be evaluators',
        );
      if (body.userId === l.req.requesterId)
        throw new AppError(
          400,
          'PANEL_INVALID',
          'The person who raised the request cannot evaluate the responses',
        );
      await tx.insert(panelMember).values({
        tenantId: a.user.tenantId,
        evaluationId: id,
        userId: body.userId,
        stream: body.stream,
        coiState: 'NOT_DECLARED',
      });
      await d.audit.record(tx, a.ctx, {
        action: 'evaluation.panel_add',
        entityType: 'evaluation',
        entityId: id,
        after: { userId: body.userId, stream: body.stream },
      });
      await svc.notifyUsers(
        tx,
        a.user.tenantId,
        [body.userId],
        'You are on an evaluation panel',
        `${l.req.number} ${l.req.title}: declare any conflict of interest first`,
        `/app/evaluations/${id}`,
      );
      return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
    return reply.status(201).send(out);
  });

  reg('GET', '/evaluations/{id}');
  app.get(
    `${p}/evaluations/:id`,
    { preHandler: guard(d, ['PROCUREMENT', 'EVALUATOR', 'CHAIR', 'DELEGATE', 'PROBITY', 'LEGAL', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      return withContext(d.database, a.ctx, async (tx) => svc.view(tx, a, await visible(tx, a, eid(req))));
    },
  );

  // ---------------------------------------------------------------- conflict declaration (US-EVL-01)
  reg('POST', '/evaluations/{id}/coi');
  app.post(
    `${p}/evaluations/:id/coi`,
    { preHandler: guard(d, ['EVALUATOR', 'CHAIR']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = eid(req);
      const body = parse(coiBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        const me = svc.memberOf(l, a.user.id);
        if (!me) throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
        if (me.coiState !== 'NOT_DECLARED')
          throw new AppError(409, 'ALREADY_DECLARED', 'You have already declared for this evaluation');
        if (l.ev.status !== 'COI_PENDING' && l.ev.status !== 'SCORING')
          throw new AppError(409, 'INVALID_STATE', 'Declarations are closed for this evaluation');
        const now = d.clock.now();
        const next = body.none ? 'DECLARED_NONE' : 'DECLARED_CONFLICT'; // a conflict suspends access immediately, pending a delegate's decision
        await tx
          .update(panelMember)
          .set({ coiState: next })
          .where(and(eq(panelMember.evaluationId, id), eq(panelMember.userId, a.user.id)));
        // A real conflict goes to a delegate (or the executive when there is none) for a decision.
        const approvers = body.none
          ? []
          : await tx
              .select({ userId: roleAssignment.userId, role: roleAssignment.role })
              .from(roleAssignment)
              .where(
                and(
                  eq(roleAssignment.tenantId, a.user.tenantId),
                  inArray(roleAssignment.role, ['DELEGATE', 'EXEC']),
                ),
              );
        const routedTo =
          approvers.find((x) => x.role === 'DELEGATE')?.userId ??
          approvers.find((x) => x.role === 'EXEC')?.userId ??
          null;
        await tx.insert(coiDeclaration).values({
          tenantId: a.user.tenantId,
          userId: a.user.id,
          scope: 'EVALUATION',
          scopeId: id,
          none: body.none,
          nature: body.nature ?? null,
          subjectOrg: body.subjectOrg ?? null,
          disposition: body.none ? 'IMMATERIAL' : 'PENDING',
          routedTo: body.none ? null : routedTo,
          decidedAt: body.none ? now : null,
          createdAt: now,
        });
        await d.audit.record(tx, a.ctx, {
          action: body.none ? 'coi.declare_none' : 'coi.declare_conflict',
          entityType: 'evaluation',
          entityId: id,
          after: {
            stream: me.stream,
            none: body.none,
            ...(body.none
              ? {}
              : { nature: body.nature, subjectOrg: body.subjectOrg ?? null, access: 'REVOKED' }),
          },
        });
        if (!body.none) {
          await svc.notifyRoles(
            tx,
            a.user.tenantId,
            ['PROBITY', 'CHAIR', 'PROCUREMENT'],
            'Evaluator suspended: conflict of interest',
            `${l.req.number}: ${a.user.name} declared a conflict and has no access until a delegate decides`,
            `/app/evaluations/${id}`,
          );
          if (routedTo)
            await svc.notifyUsers(
              tx,
              a.user.tenantId,
              [routedTo],
              'Conflict of interest needs your decision',
              `${l.req.number}: ${a.user.name} declared a conflict on an evaluation`,
              `/app/evaluations/${id}`,
            );
        }
        const fresh2 = (await svc.load(tx, a.user.tenantId, id))!;
        const blockers = await svc.advance(tx, a, fresh2);
        if (!body.none && blockers.some((b) => b.startsWith('No active')))
          await svc.notifyRoles(
            tx,
            a.user.tenantId,
            ['PROCUREMENT'],
            'Add a replacement evaluator',
            blockers.join('. '),
            `/app/evaluations/${id}`,
          );
        if (!body.none)
          return {
            suspended: true,
            message:
              'Your conflict was recorded and your access is suspended. A delegate will decide, and you will be told the outcome.',
          };
        return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
      });
      return reply.status(201).send(out);
    },
  );

  // ---------------------------------------------------------------- independent scoring (US-EVL-03)
  async function myScores(tx: Tx, a: AuthContext, l: Loaded) {
    const me = declaredMember(l, a);
    const criteria = svc.criteriaFor(l, me);
    const rows = await tx
      .select()
      .from(score)
      .where(and(eq(score.evaluationId, l.ev.id), eq(score.evaluatorId, a.user.id)));
    return {
      me,
      criteria,
      rows,
      suppliers: l.bidders.map((b) => ({
        supplierId: b.supplierId,
        displayName: b.company,
        scores: rows
          .filter((r) => r.supplierId === b.supplierId && criteria.some((c) => c.id === r.criterionId))
          .map((r) => ({ criterionId: r.criterionId, score: Number(r.score), comment: r.comment ?? null })),
      })),
    };
  }

  reg('GET', '/evaluations/{id}/scores/mine');
  app.get(
    `${p}/evaluations/:id/scores/mine`,
    { preHandler: guard(d, ['EVALUATOR', 'CHAIR']) },
    async (req) => {
      const a = req.auth!;
      return withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, eid(req));
        const m = await myScores(tx, a, l);
        const required = m.suppliers.length * m.criteria.length;
        const doneCount = m.suppliers.reduce((s, x) => s + x.scores.length, 0);
        return {
          criteria: m.criteria.map((c) => ({
            id: c.id,
            name: c.name,
            weight: Number(c.weight),
            stream: c.stream,
            passFail: c.passFail,
          })),
          suppliers: m.suppliers,
          progress: { required, done: doneCount, complete: Boolean(m.me.scoredAt) },
        };
      });
    },
  );

  reg('PUT', '/evaluations/{id}/scores');
  app.put(`${p}/evaluations/:id/scores`, { preHandler: guard(d, ['EVALUATOR', 'CHAIR']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(scoresBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      const me = declaredMember(l, a);
      if (l.ev.status !== 'SCORING')
        throw new AppError(
          409,
          'INVALID_STATE',
          l.ev.status === 'COI_PENDING'
            ? 'Scoring opens once every panel member has declared'
            : 'Scoring is closed',
        );
      if (me.scoredAt) throw new AppError(409, 'SCORING_SUBMITTED', 'You have marked your scoring complete');
      if (!l.bidders.some((b) => b.supplierId === body.supplierId))
        throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
      const allowed = svc.criteriaFor(l, me);
      const seen = new Set<string>();
      for (const s of body.scores) {
        const c = allowed.find((x) => x.id === s.criterionId);
        // A criterion outside your stream looks exactly like one that does not exist.
        if (!c || !canScoreCriterion(me.stream as Stream, c.stream as Stream))
          throw new AppError(404, 'NOT_FOUND', 'Criterion not found');
        if (seen.has(c.id))
          throw new AppError(400, 'VALIDATION_FAILED', 'A criterion can only be scored once per request');
        seen.add(c.id);
        if (!validScore(s.score, c.passFail))
          throw new AppError(400, 'VALIDATION_FAILED', 'Invalid score', [
            {
              field: c.id,
              message: c.passFail ? 'Choose pass (10) or fail (0)' : 'Use 0 to 10 in half points',
            },
          ]);
      }
      const existing = await tx
        .select()
        .from(score)
        .where(
          and(
            eq(score.evaluationId, id),
            eq(score.supplierId, body.supplierId),
            eq(score.evaluatorId, a.user.id),
          ),
        );
      for (const s of body.scores) {
        const row = existing.find((e) => e.criterionId === s.criterionId);
        if (row)
          await tx
            .update(score)
            .set({ score: s.score.toFixed(2), comment: s.comment ?? null })
            .where(eq(score.id, row.id));
        else
          await tx.insert(score).values({
            tenantId: a.user.tenantId,
            evaluationId: id,
            supplierId: body.supplierId,
            criterionId: s.criterionId,
            evaluatorId: a.user.id,
            score: s.score.toFixed(2),
            comment: s.comment ?? null,
            createdAt: d.clock.now(),
          });
      }
      // The audit trail records that scoring happened, never the scores themselves (it is readable by more people).
      await d.audit.record(tx, a.ctx, {
        action: 'score.save',
        entityType: 'evaluation',
        entityId: id,
        after: { cells: body.scores.length },
      });
      const m = await myScores(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
      return {
        criteria: m.criteria.map((c) => ({
          id: c.id,
          name: c.name,
          weight: Number(c.weight),
          stream: c.stream,
          passFail: c.passFail,
        })),
        suppliers: m.suppliers,
        progress: {
          required: m.suppliers.length * m.criteria.length,
          done: m.suppliers.reduce((s, x) => s + x.scores.length, 0),
          complete: false,
        },
      };
    });
  });

  reg('POST', '/evaluations/{id}/scores/submit');
  app.post(
    `${p}/evaluations/:id/scores/submit`,
    { preHandler: guard(d, ['EVALUATOR', 'CHAIR']) },
    async (req) => {
      const a = req.auth!;
      const id = eid(req);
      return withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        const me = declaredMember(l, a);
        if (l.ev.status !== 'SCORING') throw new AppError(409, 'INVALID_STATE', 'Scoring is not open');
        if (me.scoredAt)
          throw new AppError(409, 'SCORING_SUBMITTED', 'You have already marked your scoring complete');
        const m = await myScores(tx, a, l);
        const required = m.suppliers.length * m.criteria.length;
        const doneCount = m.suppliers.reduce((s, x) => s + x.scores.length, 0);
        if (doneCount < required)
          throw new AppError(
            409,
            'SCORING_INCOMPLETE',
            `${required - doneCount} score(s) are still missing`,
            [
              {
                field: 'scores',
                message: `Score every supplier on every criterion (${doneCount} of ${required} done)`,
              },
            ],
          );
        await tx
          .update(panelMember)
          .set({ scoredAt: d.clock.now() })
          .where(and(eq(panelMember.evaluationId, id), eq(panelMember.userId, a.user.id)));
        await d.audit.record(tx, a.ctx, {
          action: 'score.complete',
          entityType: 'evaluation',
          entityId: id,
          after: { cells: required },
        });
        const l2 = (await svc.load(tx, a.user.tenantId, id))!;
        const live = svc.active(l2);
        if (live.every((x) => x.coiState === 'DECLARED_NONE' && x.scoredAt))
          await svc.notifyRoles(
            tx,
            a.user.tenantId,
            ['CHAIR'],
            'All scoring is complete',
            `${l.req.number} ${l.req.title}: you can open consensus`,
            `/app/evaluations/${id}`,
          );
        return svc.view(tx, a, l2);
      });
    },
  );

  // ---------------------------------------------------------------- consensus, variance flags and lock (US-EVL-04)
  function chairOnly(l: Loaded, a: AuthContext) {
    const me = svc.memberOf(l, a.user.id);
    if (!me || me.stream !== 'OTHER' || !a.user.roles.includes('CHAIR'))
      throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
    if (me.coiState !== 'DECLARED_NONE')
      throw new AppError(403, 'COI_REQUIRED', 'Declare that you have no conflict of interest first');
    return me;
  }

  // ---------------------------------------------------------------- variance limit per evaluation (US-EVL-04)
  reg('PUT', '/evaluations/{id}/variance-limit');
  app.put(`${p}/evaluations/:id/variance-limit`, { preHandler: guard(d, ['CHAIR']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(varianceBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      chairOnly(l, a);
      if (l.ev.status !== 'COI_PENDING' && l.ev.status !== 'SCORING')
        throw new AppError(409, 'INVALID_STATE', 'The limit can only change before consensus opens');
      await tx
        .update(evaluation)
        .set({ varianceLimitPct: body.limitPct, updatedAt: d.clock.now(), version: l.ev.version + 1 })
        .where(eq(evaluation.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'evaluation.variance_limit',
        entityType: 'evaluation',
        entityId: id,
        before: { limitPct: l.ev.varianceLimitPct },
        after: { limitPct: body.limitPct },
      });
      await svc.notifyRoles(
        tx,
        a.user.tenantId,
        ['PROCUREMENT', 'PROBITY'],
        'Variance limit changed',
        `${l.req.number}: flagged at ${body.limitPct}% instead of ${l.ev.varianceLimitPct}%`,
        `/app/evaluations/${id}`,
      );
      return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
  });

  // ---------------------------------------------------------------- probity sign-off (US-EVL-06/07)
  reg('POST', '/evaluations/{id}/probity-signoff');
  app.post(`${p}/evaluations/:id/probity-signoff`, { preHandler: guard(d, ['PROBITY']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(signoffBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (!atLeast(l.ev.status, 'LOCKED'))
        throw new AppError(409, 'INVALID_STATE', 'The process can be signed off once consensus is locked');
      if (await svc.probityOf(tx, l))
        throw new AppError(409, 'ALREADY_SIGNED_OFF', 'The process is already signed off');
      const now = d.clock.now();
      await tx.insert(approval).values({
        tenantId: a.user.tenantId,
        subjectType: 'EVAL_PROBITY',
        subjectId: id,
        userId: a.user.id,
        role: a.user.role,
        decision: 'APPROVED',
        comment: body.comment ?? null,
        stamp: `PROBITY SIGN-OFF · ${a.user.name} · ${a.user.role.replace('_', ' ')} · ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
        decidedAt: now,
      });
      await d.audit.record(tx, a.ctx, {
        action: 'evaluation.probity_signoff',
        entityType: 'evaluation',
        entityId: id,
        after: { comment: body.comment },
      });
      await svc.notifyRoles(
        tx,
        a.user.tenantId,
        ['PROCUREMENT', 'DELEGATE'],
        'Probity sign-off recorded',
        `${l.req.number} ${l.req.title}`,
        `/app/evaluations/${id}`,
      );
      return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
  });

  reg('POST', '/evaluations/{id}/consensus/open');
  app.post(`${p}/evaluations/:id/consensus/open`, { preHandler: guard(d, ['CHAIR']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      chairOnly(l, a);
      if (l.ev.status !== 'SCORING') throw new AppError(409, 'INVALID_STATE', 'Consensus opens from scoring');
      if (l.panel.some((m) => m.coiState === 'DECLARED_CONFLICT'))
        throw new AppError(
          409,
          'CONFLICT_PENDING',
          'A declared conflict is still waiting for a delegate decision',
        );
      const waiting = svc.active(l).filter((m) => m.coiState === 'DECLARED_NONE' && !m.scoredAt);
      const undeclared = svc.active(l).filter((m) => m.coiState === 'NOT_DECLARED');
      if (waiting.length || undeclared.length)
        throw new AppError(
          409,
          'SCORING_PENDING',
          `${waiting.length + undeclared.length} panel member(s) have not finished yet`,
        );
      const now = d.clock.now();
      await tx
        .update(evaluation)
        .set({ status: 'CONSENSUS', updatedAt: now, version: l.ev.version + 1 })
        .where(eq(evaluation.id, id));
      // From here the chair (and probity) can read everyone's scores: row level security opens at this status.
      const rows = await tx.select().from(score).where(eq(score.evaluationId, id));
      let flagged = 0;
      for (const b of l.bidders)
        for (const c of l.criteria) {
          const vals = rows
            .filter((r) => r.supplierId === b.supplierId && r.criterionId === c.id)
            .map((r) => Number(r.score));
          if (vals.length === 0) continue;
          const v = variancePct(vals);
          const flag = isFlagged(v, l.ev.varianceLimitPct);
          if (flag) flagged++;
          await tx.insert(consensusItem).values({
            tenantId: a.user.tenantId,
            evaluationId: id,
            supplierId: b.supplierId,
            criterionId: c.id,
            variancePct: v === null ? null : v.toFixed(2),
            flagged: flag,
            consensusScore: vals.length === 1 ? vals[0]!.toFixed(2) : null, // a single scorer has nothing to reconcile
          });
        }
      await d.audit.record(tx, a.ctx, {
        action: 'evaluation.consensus_open',
        entityType: 'evaluation',
        entityId: id,
        before: { status: 'SCORING' },
        after: { status: 'CONSENSUS', flagged, varianceLimitPct: l.ev.varianceLimitPct },
      });
      await svc.notifyRoles(
        tx,
        a.user.tenantId,
        ['PROBITY'],
        'Consensus is open',
        `${l.req.number}: ${flagged} flagged score(s)`,
        `/app/evaluations/${id}`,
      );
      return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
  });

  reg('PUT', '/evaluations/{id}/consensus/{supplierId}');
  app.put(`${p}/evaluations/:id/consensus/:supplierId`, { preHandler: guard(d, ['CHAIR']) }, async (req) => {
    const a = req.auth!;
    const { id, supplierId } = parse(z.object({ id: uuid, supplierId: uuid }), req.params);
    const body = parse(consensusBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      chairOnly(l, a);
      if (l.ev.status !== 'CONSENSUS') throw new AppError(409, 'INVALID_STATE', 'Consensus is not open');
      if (!l.bidders.some((b) => b.supplierId === supplierId))
        throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
      for (const it of body.items) {
        const c = l.criteria.find((x) => x.id === it.criterionId);
        if (!c) throw new AppError(404, 'NOT_FOUND', 'Criterion not found');
        if (!validScore(it.consensusScore, c.passFail))
          throw new AppError(400, 'VALIDATION_FAILED', 'Invalid score', [
            {
              field: c.id,
              message: c.passFail ? 'Choose pass (10) or fail (0)' : 'Use 0 to 10 in half points',
            },
          ]);
        const upd = await tx
          .update(consensusItem)
          .set({ consensusScore: it.consensusScore.toFixed(2), rationale: it.rationale ?? null })
          .where(
            and(
              eq(consensusItem.evaluationId, id),
              eq(consensusItem.supplierId, supplierId),
              eq(consensusItem.criterionId, it.criterionId),
            ),
          )
          .returning({ id: consensusItem.id });
        if (upd.length === 0)
          throw new AppError(404, 'NOT_FOUND', 'There is nothing to agree for that criterion');
      }
      await d.audit.record(tx, a.ctx, {
        action: 'consensus.save',
        entityType: 'evaluation',
        entityId: id,
        after: { supplierId, items: body.items.length },
      });
      return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
  });

  reg('POST', '/evaluations/{id}/consensus/lock');
  app.post(`${p}/evaluations/:id/consensus/lock`, { preHandler: guard(d, ['CHAIR']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      chairOnly(l, a);
      if (l.ev.status !== 'CONSENSUS') throw new AppError(409, 'INVALID_STATE', 'Consensus is not open');
      const items = await tx.select().from(consensusItem).where(eq(consensusItem.evaluationId, id));
      const label = (i: (typeof items)[number]) =>
        `${l.bidders.find((b) => b.supplierId === i.supplierId)?.company ?? 'Supplier'}: ${l.criteria.find((c) => c.id === i.criterionId)?.name ?? 'criterion'}`;
      const missing = items.filter((i) => i.consensusScore === null);
      if (missing.length)
        throw new AppError(
          409,
          'CONSENSUS_INCOMPLETE',
          `${missing.length} score(s) still need a consensus value`,
          missing.map((i) => ({ field: i.criterionId, message: `${label(i)} needs a consensus score` })),
        );
      const unresolved = items.filter((i) => i.flagged && (i.rationale ?? '').trim().length < 10);
      if (unresolved.length)
        throw new AppError(
          409,
          'FLAGS_UNRESOLVED',
          `${unresolved.length} flagged score(s) need a recorded rationale before locking`,
          unresolved.map((i) => ({
            field: i.criterionId,
            message: `${label(i)} differs by ${i.variancePct}%: record why (at least 10 characters)`,
          })),
        );
      await tx
        .update(evaluation)
        .set({ status: 'LOCKED', updatedAt: d.clock.now(), version: l.ev.version + 1 })
        .where(eq(evaluation.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'evaluation.consensus_lock',
        entityType: 'evaluation',
        entityId: id,
        before: { status: 'CONSENSUS' },
        after: { status: 'LOCKED', flaggedResolved: items.filter((i) => i.flagged).length },
      });
      await svc.notifyRoles(
        tx,
        a.user.tenantId,
        ['PROCUREMENT'],
        'Consensus locked',
        `${l.req.number} ${l.req.title}: you can generate the evaluation report`,
        `/app/evaluations/${id}`,
      );
      return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
  });

  // ---------------------------------------------------------------- report (US-EVL-05)
  reg('POST', '/evaluations/{id}/report');
  app.post(`${p}/evaluations/:id/report`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req, reply) => {
    const a = req.auth!;
    const id = eid(req);
    // 1. check state and gather what the report needs (inside the caller's own permissions)
    const gathered = await withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      const [existing] = await tx.select().from(evalReport).where(eq(evalReport.evaluationId, id));
      const regenerate = l.ev.status === 'REPORTED' && existing?.status === 'DRAFT';
      const items = await tx.select().from(consensusItem).where(eq(consensusItem.evaluationId, id));
      // an enterprise may relax "evaluation complete before the report" (FR-0720): consensus must still be fully scored
      const relaxable =
        !(await loadSettings(tx, a.user.tenantId)).checkpoints.evaluationBeforeReport &&
        l.ev.status === 'CONSENSUS' &&
        items.length > 0 &&
        items.every((i) => i.consensusScore !== null);
      if (l.ev.status !== 'LOCKED' && !regenerate && !relaxable)
        throw new AppError(409, 'INVALID_STATE', 'A report can be generated once consensus is locked');
      if (relaxable && l.ev.status !== 'LOCKED')
        await d.audit.record(tx, a.ctx, {
          action: 'checkpoint.relaxed',
          entityType: 'evaluation',
          entityId: id,
          after: {
            checkpoint: 'evaluationBeforeReport',
            note: 'Report generated before consensus was locked',
          },
        });
      const decl = await tx
        .select()
        .from(coiDeclaration)
        .where(
          and(
            eq(coiDeclaration.scope, 'EVALUATION'),
            eq(coiDeclaration.scopeId, id),
            eq(coiDeclaration.none, false),
          ),
        );
      return { l, items, existing, conflictUsers: new Set(decl.map((x) => x.userId)) };
    });
    // 2. the evaluators' comments are readable only by the chair and probity (row level security), so the report reads
    //    them as the system, and quotes them without saying who wrote them
    const comments = await withSystem(d.database, (tx) =>
      tx.select().from(score).where(eq(score.evaluationId, id)),
    );
    const { l, items, conflictUsers } = gathered;
    const ranking = await svc.ranking({ ...l, ev: { ...l.ev, status: 'LOCKED' } }, items);
    const now = d.clock.now();
    const text = buildReport({
      title: l.req.title,
      number: l.req.number,
      type: l.tender.type,
      generatedAt: now,
      varianceLimitPct: l.ev.varianceLimitPct,
      panel: l.panel.map((m) => ({
        name: m.name,
        stream: m.stream,
        outcome:
          m.coiState === 'REMOVED'
            ? ('CONFLICT_REMOVED' as const)
            : conflictUsers.has(m.userId)
              ? ('CONFLICT_REVIEWED' as const)
              : ('NO_CONFLICT' as const),
      })),
      criteria: l.criteria.map((c) => ({
        id: c.id,
        name: c.name,
        weight: Number(c.weight),
        stream: c.stream,
        passFail: c.passFail,
      })),
      suppliers: l.bidders.map((b) => {
        const r = ranking.find((x) => x.supplierId === b.supplierId)!;
        return {
          name: b.company,
          score: r.weightedScore,
          rank: r.rank,
          compliant: r.compliance === 'PASS',
          items: items
            .filter((i) => i.supplierId === b.supplierId)
            .map((i) => ({
              criterionId: i.criterionId,
              consensus: Number(i.consensusScore ?? 0),
              flagged: i.flagged,
              variance: i.variancePct === null ? null : Number(i.variancePct),
              rationale: i.rationale ?? null,
            })),
          comments: comments.filter((c) => c.supplierId === b.supplierId && c.comment).map((c) => c.comment!),
        };
      }),
    });
    // 3. store it
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const l2 = (await svc.load(tx, a.user.tenantId, id))!;
      let [rep] = await tx.select().from(evalReport).where(eq(evalReport.evaluationId, id));
      if (rep) {
        await tx
          .update(evalReport)
          .set({ status: 'AWAITING_APPROVAL', generatedAt: now })
          .where(eq(evalReport.id, rep.id));
      } else {
        [rep] = await tx
          .insert(evalReport)
          .values({
            tenantId: a.user.tenantId,
            evaluationId: id,
            status: 'AWAITING_APPROVAL',
            generatedAt: now,
          })
          .returning();
      }
      for (const sec of REPORT_SECTIONS) {
        const [row] = await tx
          .select()
          .from(fieldValue)
          .where(
            and(
              eq(fieldValue.ownerType, 'EVAL_REPORT'),
              eq(fieldValue.ownerId, rep!.id),
              eq(fieldValue.key, sec.key),
            ),
          );
        if (row)
          await tx
            .update(fieldValue)
            .set({ value: text[sec.key] ?? '', source: 'SYSTEM', updatedAt: now })
            .where(eq(fieldValue.id, row.id));
        else
          await tx.insert(fieldValue).values({
            tenantId: a.user.tenantId,
            ownerType: 'EVAL_REPORT',
            ownerId: rep!.id,
            key: sec.key,
            label: sec.label,
            value: text[sec.key] ?? '',
            source: 'SYSTEM',
            updatedAt: now,
          });
      }
      await tx
        .update(evaluation)
        .set({ status: 'REPORTED', updatedAt: now, version: l2.ev.version + 1 })
        .where(eq(evaluation.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'report.generate',
        entityType: 'evaluation',
        entityId: id,
        after: { reportId: rep!.id, generatedAt: now.toISOString() },
      });
      await svc.notifyRoles(
        tx,
        a.user.tenantId,
        ['DELEGATE', 'EXEC'],
        'Evaluation report awaiting approval',
        `${l2.req.number} ${l2.req.title}`,
        `/app/evaluations/${id}`,
      );
      return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
    return reply.status(201).send(out);
  });

  reg('POST', '/evaluation-reports/{id}/decision');
  app.post(
    `${p}/evaluation-reports/:id/decision`,
    { preHandler: guard(d, ['DELEGATE', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      const reportId = eid(req);
      const body = parse(decisionBody, req.body);
      if (body.decision === 'REJECT' && (body.comment ?? '').length < 5)
        throw new AppError(400, 'VALIDATION_FAILED', 'A reason is required', [
          { field: 'comment', message: 'Say why in at least 5 characters' },
        ]);
      return withContext(d.database, a.ctx, async (tx) => {
        const [rep] = await tx
          .select()
          .from(evalReport)
          .where(and(eq(evalReport.id, reportId), eq(evalReport.tenantId, a.user.tenantId)));
        if (!rep) throw new AppError(404, 'NOT_FOUND', 'Report not found');
        const l = await visible(tx, a, rep.evaluationId);
        if (rep.status !== 'AWAITING_APPROVAL')
          throw new AppError(409, 'INVALID_STATE', 'The report is not waiting for approval');
        const sod = checkSod('APPROVE_OWN_SUBJECT', {
          roles: a.user.roles as RoleName[],
          isAuthorOfSubject: l.req.requesterId === a.user.id,
        });
        if (!sod.ok) throw new AppError(403, sod.code, sod.message);
        const now = d.clock.now();
        const stamp = (verb: string) =>
          `${verb} · ${a.user.name} · ${a.user.role.replace('_', ' ')} · ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
        if (body.decision === 'APPROVE') {
          const value = Number(l.req.estimatedValue ?? 0);
          const del = await checkDelegation(
            tx,
            { tenantId: a.user.tenantId, userId: a.user.id, roles: a.user.roles },
            'SOURCING_APPROVAL',
            value,
          );
          if (!del.allowed)
            throw new AppError(
              403,
              del.code ?? 'DELEGATION_EXCEEDED',
              del.limit === null
                ? 'You do not hold approval authority'
                : `This award (${aud.format(value)}) is above your authority of ${aud.format(del.limit)}`,
            );
          await tx.insert(approval).values({
            tenantId: a.user.tenantId,
            subjectType: 'EVAL_REPORT',
            subjectId: reportId,
            userId: a.user.id,
            role: a.user.role,
            decision: 'APPROVED',
            comment: body.comment ?? null,
            stamp: stamp('REPORT APPROVED'),
            decidedAt: now,
          });
          await tx.update(evalReport).set({ status: 'APPROVED' }).where(eq(evalReport.id, reportId));
          await tx
            .update(evaluation)
            .set({ status: 'APPROVED', updatedAt: now, version: l.ev.version + 1 })
            .where(eq(evaluation.id, l.ev.id));
          await d.audit.record(tx, a.ctx, {
            action: 'report.approve',
            entityType: 'evaluation',
            entityId: l.ev.id,
            after: { reportId, value, limit: del.limit },
          });
          await svc.notifyRoles(
            tx,
            a.user.tenantId,
            ['PROCUREMENT', 'LEGAL'],
            'Evaluation report approved',
            `${l.req.number} ${l.req.title}: the award can proceed to contract`,
            `/app/evaluations/${l.ev.id}`,
          );
        } else {
          await tx.insert(approval).values({
            tenantId: a.user.tenantId,
            subjectType: 'EVAL_REPORT',
            subjectId: reportId,
            userId: a.user.id,
            role: a.user.role,
            decision: 'REJECTED',
            comment: body.comment ?? null,
            stamp: stamp('REPORT RETURNED'),
            decidedAt: now,
          });
          await tx.update(evalReport).set({ status: 'DRAFT' }).where(eq(evalReport.id, reportId));
          await d.audit.record(tx, a.ctx, {
            action: 'report.reject',
            entityType: 'evaluation',
            entityId: l.ev.id,
            after: { reportId, comment: body.comment },
          });
          await svc.notifyRoles(
            tx,
            a.user.tenantId,
            ['PROCUREMENT'],
            'Evaluation report returned',
            `${l.req.number}: ${body.comment}`,
            `/app/evaluations/${l.ev.id}`,
          );
        }
        return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, l.ev.id))!);
      });
    },
  );

  // ---------------------------------------------------------------- bid files for evaluators
  reg('GET', '/evaluations/{id}/suppliers/{supplierId}/files/{fileId}');
  app.get(
    `${p}/evaluations/:id/suppliers/:supplierId/files/:fileId`,
    { preHandler: guard(d, ['EVALUATOR', 'CHAIR', 'PROCUREMENT', 'PROBITY', 'LEGAL']) },
    async (req, reply) => {
      const a = req.auth!;
      const { id, supplierId, fileId } = parse(
        z.object({ id: uuid, supplierId: uuid, fileId: uuid }),
        req.params,
      );
      const found = await withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        const processRole = a.user.roles.some((r) => PROCESS.includes(r));
        const me = svc.memberOf(l, a.user.id);
        if (!processRole) declaredMember(l, a); // evaluators open nothing before declaring no conflict
        const bidder = l.bidders.find((b) => b.supplierId === supplierId);
        if (!bidder) throw new AppError(404, 'NOT_FOUND', 'File not found');
        // The database already hides files by role, stream and close time; the checks here repeat it in plain code.
        const [f] = await tx
          .select()
          .from(fileObject)
          .where(and(eq(fileObject.id, fileId), eq(fileObject.submissionId, bidder.submissionId)));
        if (!f || (!processRole && (!me || !canSeeFileSection(me.stream as Stream, f.section as Stream))))
          throw new AppError(404, 'NOT_FOUND', 'File not found');
        await d.audit.record(tx, a.ctx, {
          action: 'bid_file.download',
          entityType: 'evaluation',
          entityId: id,
          after: { fileId, section: f.section },
        });
        return f;
      });
      const bytes = await d.store.get(found.storageKey).catch(() => null);
      if (!bytes) throw new AppError(404, 'FILE_UNAVAILABLE', 'This file is not available');
      const safe = found.name.replace(/[^\w. -]/g, '_');
      return reply
        .header('content-type', found.contentType)
        .header('content-disposition', `attachment; filename="${safe}"`)
        .send(bytes);
    },
  );

  // ---------------------------------------------------------------- delegate decision on a declared conflict
  reg('POST', '/evaluations/{id}/conflicts/{userId}/decision');
  app.post(
    `${p}/evaluations/:id/conflicts/:userId/decision`,
    { preHandler: guard(d, ['DELEGATE', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      const { id, userId } = parse(z.object({ id: uuid, userId: uuid }), req.params);
      const body = parse(conflictDecisionBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        const member = l.panel.find((m) => m.userId === userId);
        if (!member || member.coiState !== 'DECLARED_CONFLICT')
          throw new AppError(
            409,
            'INVALID_STATE',
            'There is no conflict waiting for a decision for this person',
          );
        if (userId === a.user.id)
          throw new AppError(403, 'ROLE_SOD_VIOLATION', 'You cannot decide your own conflict of interest');
        const [decl] = await tx
          .select()
          .from(coiDeclaration)
          .where(
            and(
              eq(coiDeclaration.scope, 'EVALUATION'),
              eq(coiDeclaration.scopeId, id),
              eq(coiDeclaration.userId, userId),
              eq(coiDeclaration.none, false),
            ),
          );
        if (!decl || decl.disposition !== 'PENDING')
          throw new AppError(409, 'INVALID_STATE', 'This declaration has already been decided');
        const now = d.clock.now();
        const stays = body.disposition !== 'MATERIAL';
        await tx
          .update(coiDeclaration)
          .set({ disposition: body.disposition, decidedAt: now })
          .where(eq(coiDeclaration.id, decl.id));
        await tx
          .update(panelMember)
          .set({ coiState: stays ? 'DECLARED_NONE' : 'REMOVED' })
          .where(and(eq(panelMember.evaluationId, id), eq(panelMember.userId, userId)));
        await d.audit.record(tx, a.ctx, {
          action: 'coi.decide',
          entityType: 'evaluation',
          entityId: id,
          before: { userId, state: 'DECLARED_CONFLICT' },
          after: {
            userId,
            disposition: body.disposition,
            outcome: stays ? 'REINSTATED' : 'REMOVED',
            rationale: body.rationale ?? null,
          },
        });
        await svc.notifyUsers(
          tx,
          a.user.tenantId,
          [userId],
          stays
            ? 'Your conflict was reviewed: you can continue'
            : 'Your conflict was reviewed: you are removed from the panel',
          `${l.req.number} ${l.req.title}${body.rationale ? `: ${body.rationale}` : ''}`,
          `/app/evaluations/${id}`,
        );
        await svc.notifyRoles(
          tx,
          a.user.tenantId,
          ['PROCUREMENT', 'CHAIR', 'PROBITY'],
          stays ? 'Conflict reviewed: evaluator reinstated' : 'Conflict reviewed: evaluator removed',
          `${l.req.number}: ${member.name}`,
          `/app/evaluations/${id}`,
        );
        const after = (await svc.load(tx, a.user.tenantId, id))!;
        const blockers = await svc.advance(tx, a, after);
        if (!stays && blockers.some((b) => b.startsWith('No active')))
          await svc.notifyRoles(
            tx,
            a.user.tenantId,
            ['PROCUREMENT'],
            'Add a replacement evaluator',
            blockers.join('. '),
            `/app/evaluations/${id}`,
          );
        return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
      });
    },
  );

  // ---------------------------------------------------------------- reopen consensus after the lock
  reg('POST', '/evaluations/{id}/consensus/reopen');
  app.post(`${p}/evaluations/:id/consensus/reopen`, { preHandler: guard(d, ['CHAIR']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(reopenBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      chairOnly(l, a);
      const [rep] = await tx.select().from(evalReport).where(eq(evalReport.evaluationId, id));
      if (l.ev.status !== 'LOCKED' && !(l.ev.status === 'REPORTED' && rep && rep.status !== 'APPROVED'))
        throw new AppError(
          409,
          'INVALID_STATE',
          l.ev.status === 'APPROVED'
            ? 'An approved evaluation cannot be reopened: the approver must return the report first'
            : 'Consensus can be reopened once it has been locked',
        );
      const now = d.clock.now();
      const before = l.ev.status;
      await tx
        .update(evaluation)
        .set({ status: 'CONSENSUS', updatedAt: now, version: l.ev.version + 1 })
        .where(eq(evaluation.id, id));
      // The report was written from the old scores, so it no longer stands and has to be generated again after re-locking.
      if (rep) await tx.update(evalReport).set({ status: 'DRAFT' }).where(eq(evalReport.id, rep.id));
      await d.audit.record(tx, a.ctx, {
        action: 'evaluation.consensus_reopen',
        entityType: 'evaluation',
        entityId: id,
        before: { status: before, reportStatus: rep?.status ?? null },
        after: { status: 'CONSENSUS', reason: body.reason, reportInvalidated: Boolean(rep) },
      });
      await svc.notifyRoles(
        tx,
        a.user.tenantId,
        ['PROCUREMENT', 'DELEGATE', 'EXEC', 'PROBITY'],
        'Consensus reopened by the chair',
        `${l.req.number} ${l.req.title}: ${body.reason}`,
        `/app/evaluations/${id}`,
      );
      return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
  });

  // ---------------------------------------------------------------- report as a PDF or Word document (US-TND-05)
  const EXPORTERS = ['PROCUREMENT', 'DELEGATE', 'EXEC', 'PROBITY', 'LEGAL', 'CHAIR'] as const;
  for (const format of ['pdf', 'docx'] as const) {
    reg('GET', `/evaluations/{id}/report/${format}`);
    app.get(
      `${p}/evaluations/:id/report/${format}`,
      { preHandler: guard(d, [...EXPORTERS]) },
      async (req, reply) => {
        const a = req.auth!;
        const id = eid(req);
        const out = await withContext(d.database, a.ctx, async (tx) => {
          const l = await visible(tx, a, id);
          const v = await svc.view(tx, a, l);
          if (!v.report) throw new AppError(404, 'NO_REPORT', 'There is no report to export yet');
          await d.audit.record(tx, a.ctx, {
            action: 'report.export',
            entityType: 'evaluation',
            entityId: id,
            after: { format: format.toUpperCase(), reportStatus: v.report.status, version: l.ev.version },
          });
          return { v, number: l.req.number, version: l.ev.version, type: l.tender.type };
        });
        const input = {
          requestNumber: out.number,
          title: out.v.title,
          tenderType: out.type,
          evaluationVersion: out.version,
          reportStatus: out.v.report!.status,
          generatedAt: new Date(out.v.report!.generatedAt),
          sections: out.v.report!.sections,
          ranking: out.v.ranking,
          decision: out.v.report!.decision ? { stamp: out.v.report!.decision.stamp } : undefined,
          probity: out.v.probitySignoff,
        };
        return reply
          .header(
            'content-type',
            format === 'pdf'
              ? 'application/pdf'
              : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          )
          .header(
            'content-disposition',
            `attachment; filename="evaluation-report-${out.number}-v${out.version}.${format}"`,
          )
          .send(format === 'pdf' ? evaluationReportPdf(input) : evaluationReportDocx(input));
      },
    );
  }

  void atLeast;
  return done;
}
