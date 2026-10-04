/**
 * Evaluation, roadmap batch B3 (second half): evaluator substitution, conflict re-declaration, the report's own
 * conflict declarations, the probity advisor's portal, hold and documents, and plain-language scoring and ranking.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard, type AuthContext } from '../../auth/guard.js';
import { withContext, withSystem, type Database, type Tx } from '../../db/client.js';
import {
  appUser,
  coiDeclaration,
  criterion,
  evalReport,
  evaluation,
  panelMember,
  panelSubstitution,
  probityAllocation,
  probityDocument,
  request,
  roleAssignment,
  score,
  tender,
} from '../../db/schema.js';
import { renderDocx } from '../../documents/docx.js';
import { renderPdf, type PdfBlock, type PdfDocument } from '../../documents/pdf.js';
import { AppError, parse } from '../../http/errors.js';
import { loadSettings } from '../settings/settings.js';
import { allocatedTenders } from './b3-service.js';
import type { B3Deps, B3Helpers } from './b3-routes.js';
import { positionScore, readOrder, readScores } from './plain-language.js';
import { atLeast, isSuspended, type EvaluationService, type Loaded } from './service.js';
import { canScoreCriterion, validScore, type Stream } from './scoring.js';
import { checkUpload, sha256 } from '../tender/files.js';

type Reg = (m: string, path: string) => void;
const uuid = z.string().uuid();
const STAFF_READ = ['PROCUREMENT', 'DELEGATE', 'LEGAL', 'PROBITY', 'EXEC', 'CHAIR'] as const;
const stampOf = (verb: string, name: string, role: string, at: Date) =>
  `${verb} · ${name} · ${role.replace('_', ' ')} · ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const iso = (x: Date | null) => (x ? x.toISOString() : null);

const substituteBody = z
  .object({
    replacementUserId: uuid,
    reason: z.enum(['CONFLICT', 'OTHER']),
    note: z.string().trim().min(5).max(1000).optional(),
  })
  .strict();
const redeclareBody = z
  .object({
    none: z.boolean(),
    nature: z.string().trim().min(3).max(2000).optional(),
    subjectOrg: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((b) => b.none || Boolean(b.nature), { message: 'Describe the conflict', path: ['nature'] });
const reportCoiDecisionBody = z
  .object({
    disposition: z.enum(['IMMATERIAL', 'MANAGEABLE', 'MATERIAL']),
    rationale: z.string().trim().max(2000).optional(),
  })
  .strict();
const holdBody = z.object({ reason: z.string().trim().min(10).max(1000) }).strict();
const releaseBody = z.object({ note: z.string().trim().min(5).max(1000) }).strict();
const advisorBody = z.object({ userId: uuid }).strict();
const docKind = z.enum(['PLAN', 'OUTCOMES']);
const probityDocBody = z
  .object({ title: z.string().trim().min(3).max(200), body: z.string().trim().min(10).max(40_000) })
  .strict();
const uploadBody = z
  .object({
    title: z.string().trim().min(3).max(200),
    fileName: z.string().trim().min(3).max(200),
    contentBase64: z.string().min(4).max(14_000_000),
  })
  .strict();
const plainScoresBody = z
  .object({ supplierId: uuid, text: z.string().trim().min(3).max(4000), apply: z.boolean().default(false) })
  .strict();
const rankingBody = z.object({ order: z.array(uuid).min(1).max(50) }).strict();
const plainRankingBody = z
  .object({ text: z.string().trim().min(3).max(2000), apply: z.boolean().default(false) })
  .strict();

// ------------------------------------------------------------------ reminders (FR-0325)
/** Members who still owe a declaration, or a second one now that supplier identities are known. */
export function outstandingDeclarations(l: Loaded) {
  return l.panel.filter(
    (m) => m.coiState === 'NOT_DECLARED' || (m.coiState === 'DECLARED_NONE' && !m.redeclaredAt),
  );
}

export async function remindOutstanding(
  tx: Tx,
  svc: EvaluationService,
  l: Loaded,
  now: Date,
  onlyIfDue: boolean,
): Promise<string[]> {
  const hours = (await loadSettings(tx, l.ev.tenantId)).evaluationRules.redeclarationReminderHours;
  // the first scheduled reminder comes one period after the evaluation opened, the next one period after that
  const due = outstandingDeclarations(l).filter(
    (m) => !onlyIfDue || now.getTime() - (m.remindedAt ?? l.ev.createdAt).getTime() >= hours * 3_600_000,
  );
  for (const m of due) {
    const again = m.coiState === 'DECLARED_NONE';
    await svc.notifyUsers(
      tx,
      l.ev.tenantId,
      [m.userId],
      again ? 'Reminder: confirm your declaration again' : 'Reminder: declare any conflict of interest',
      again
        ? `${l.req.number} ${l.req.title}: now that you can see the supplier names, confirm you still have no conflict.`
        : `${l.req.number} ${l.req.title}: you cannot see any supplier until you have declared.`,
      `/app/evaluations/${l.ev.id}`,
    );
    await tx.update(panelMember).set({ remindedAt: now }).where(eq(panelMember.id, m.id));
  }
  return due.map((m) => m.name);
}

/** Sends the reminders that have come due on every live evaluation (called whenever the evaluation list is read). */
export async function sweepReminders(database: Database, svc: EvaluationService, now: Date) {
  await withSystem(database, async (tx) => {
    const live = await tx.select().from(evaluation);
    for (const ev of live.filter((x) => !x.held && !atLeast(x.status, 'LOCKED'))) {
      const l = await svc.load(tx, ev.tenantId, ev.id);
      if (l) await remindOutstanding(tx, svc, l, now, true);
    }
  });
}

// ------------------------------------------------------------------ panel changes and conflicts
export function registerPanelRoutes(app: FastifyInstance, p: string, d: B3Deps, h: B3Helpers, reg: Reg) {
  const { svc, visible, mguard, eid, assertSegregated } = h;
  const view = async (tx: Tx, a: AuthContext, id: string) =>
    svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);

  async function routeConflict(tx: Tx, tenantId: string, selfId: string): Promise<string | null> {
    const cand = await tx
      .select({ userId: roleAssignment.userId, role: roleAssignment.role })
      .from(roleAssignment)
      .where(and(eq(roleAssignment.tenantId, tenantId), inArray(roleAssignment.role, ['DELEGATE', 'EXEC'])));
    return (
      cand.find((c) => c.role === 'DELEGATE' && c.userId !== selfId)?.userId ??
      cand.find((c) => c.role === 'EXEC' && c.userId !== selfId)?.userId ??
      null
    );
  }

  // ---- evaluator substitution (FR-0305) and replacement after a material conflict (FR-0335)
  reg('POST', '/evaluations/{id}/panel/{userId}/substitute');
  app.post(
    `${p}/evaluations/:id/panel/:userId/substitute`,
    { preHandler: mguard(d, ['PROCUREMENT']) },
    async (req, reply) => {
      const a = req.auth!;
      const { id, userId } = parse(z.object({ id: uuid, userId: uuid }), req.params);
      const body = parse(substituteBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        if (l.ev.status !== 'COI_PENDING' && l.ev.status !== 'SCORING')
          throw new AppError(409, 'INVALID_STATE', 'The panel can only change before consensus');
        const leaving = l.panel.find((m) => m.userId === userId);
        if (!leaving) throw new AppError(404, 'NOT_FOUND', 'That person is not on the panel');
        const prior = await tx
          .select({ id: panelSubstitution.id })
          .from(panelSubstitution)
          .where(and(eq(panelSubstitution.evaluationId, id), eq(panelSubstitution.departingUserId, userId)));
        if (prior.length)
          throw new AppError(409, 'ALREADY_REPLACED', 'This person has already been replaced');
        if (body.reason === 'CONFLICT' && leaving.coiState !== 'REMOVED')
          throw new AppError(
            409,
            'NOT_REMOVED',
            'A replacement for a conflict follows a delegate ruling the conflict material and removing the person',
          );
        if (l.panel.some((m) => m.userId === body.replacementUserId))
          throw new AppError(409, 'ALREADY_MEMBER', 'This person is, or was, on the panel');
        const roles = (
          await tx
            .select({ role: roleAssignment.role })
            .from(roleAssignment)
            .where(
              and(
                eq(roleAssignment.tenantId, a.user.tenantId),
                eq(roleAssignment.userId, body.replacementUserId),
              ),
            )
        ).map((r) => r.role);
        const needs = leaving.stream === 'OTHER' ? 'CHAIR' : 'EVALUATOR';
        if (!roles.includes(needs))
          throw new AppError(
            400,
            'PANEL_INVALID',
            leaving.stream === 'OTHER' ? 'The chair seat needs a chair' : 'Panel members must be evaluators',
          );
        if (body.replacementUserId === l.req.requesterId)
          throw new AppError(
            400,
            'PANEL_INVALID',
            'The person who raised the request cannot evaluate the responses',
          );
        await assertSegregated(tx, a.user.tenantId, [body.replacementUserId]);
        const now = d.clock.now();
        // the leaver's marks stay as read-only history; they are left out of the averages when consensus opens
        if (leaving.coiState !== 'REMOVED')
          await tx
            .update(panelMember)
            .set({ coiState: 'REMOVED' })
            .where(and(eq(panelMember.evaluationId, id), eq(panelMember.userId, userId)));
        await tx.insert(panelMember).values({
          tenantId: a.user.tenantId,
          evaluationId: id,
          userId: body.replacementUserId,
          stream: leaving.stream,
          coiState: 'NOT_DECLARED',
        });
        await tx.insert(panelSubstitution).values({
          tenantId: a.user.tenantId,
          evaluationId: id,
          departingUserId: userId,
          incomingUserId: body.replacementUserId,
          stream: leaving.stream,
          reason: body.reason,
          note: body.note ?? null,
          byUserId: a.user.id,
          createdAt: now,
        });
        await d.audit.record(tx, a.ctx, {
          action: 'evaluation.substitute',
          entityType: 'evaluation',
          entityId: id,
          before: { userId, state: leaving.coiState },
          after: { replacementUserId: body.replacementUserId, reason: body.reason, note: body.note ?? null },
        });
        const crit = svc.criteriaFor(
          { ...l },
          { ...leaving, userId: body.replacementUserId, coiState: 'DECLARED_NONE' },
        );
        const tasks = [
          'declare any conflict of interest',
          ...(l.ev.status === 'SCORING'
            ? [
                `score ${l.bidders.length} supplier(s) on ${crit.length} criteria (a clean matrix: you start with no marks)`,
              ]
            : ['score the suppliers once scoring opens']),
          'confirm your declaration again once the supplier names are visible',
        ];
        await svc.notifyUsers(
          tx,
          a.user.tenantId,
          [body.replacementUserId],
          'You have joined an evaluation panel as a replacement',
          `${l.req.number} ${l.req.title}: you need to ${tasks.join('; then ')}.`,
          `/app/evaluations/${id}`,
        );
        await svc.notifyRoles(
          tx,
          a.user.tenantId,
          ['PROBITY', 'CHAIR'],
          'An evaluator was replaced',
          `${l.req.number}: ${leaving.name} replaced (${body.reason === 'CONFLICT' ? 'material conflict' : 'other'})`,
          `/app/evaluations/${id}`,
        );
        const after = (await svc.load(tx, a.user.tenantId, id))!;
        await svc.advance(tx, a, after);
        return view(tx, a, id);
      });
      return reply.status(201).send(out);
    },
  );

  // ---- conflict re-declaration once supplier identities are known (FR-0325)
  reg('POST', '/evaluations/{id}/coi/redeclare');
  app.post(
    `${p}/evaluations/:id/coi/redeclare`,
    { preHandler: mguard(d, ['EVALUATOR', 'CHAIR']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = eid(req);
      const body = parse(redeclareBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        const me = svc.memberOf(l, a.user.id);
        if (!me) throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
        if (me.coiState !== 'DECLARED_NONE')
          throw new AppError(409, 'INVALID_STATE', 'Declare for this evaluation first');
        if (me.redeclaredAt)
          throw new AppError(409, 'ALREADY_DECLARED', 'You have already confirmed your declaration again');
        if (l.ev.status !== 'COI_PENDING' && l.ev.status !== 'SCORING')
          throw new AppError(409, 'INVALID_STATE', 'Declarations are closed for this evaluation');
        const now = d.clock.now();
        await tx
          .update(panelMember)
          .set({
            redeclaredAt: now,
            redeclaration: body.none ? 'NONE' : 'CONFLICT',
            ...(body.none ? {} : { coiState: 'DECLARED_CONFLICT' as const }),
          })
          .where(and(eq(panelMember.evaluationId, id), eq(panelMember.userId, a.user.id)));
        if (body.none) {
          await d.audit.record(tx, a.ctx, {
            action: 'coi.redeclare_none',
            entityType: 'evaluation',
            entityId: id,
            after: { stream: me.stream },
          });
          return view(tx, a, id);
        }
        const routedTo = await routeConflict(tx, a.user.tenantId, a.user.id);
        await tx.insert(coiDeclaration).values({
          tenantId: a.user.tenantId,
          userId: a.user.id,
          scope: 'EVALUATION',
          scopeId: id,
          none: false,
          nature: body.nature ?? null,
          subjectOrg: body.subjectOrg ?? null,
          disposition: 'PENDING',
          routedTo,
          createdAt: now,
        });
        await d.audit.record(tx, a.ctx, {
          action: 'coi.redeclare_conflict',
          entityType: 'evaluation',
          entityId: id,
          after: { nature: body.nature, subjectOrg: body.subjectOrg ?? null, access: 'REVOKED' },
        });
        await svc.notifyRoles(
          tx,
          a.user.tenantId,
          ['PROBITY', 'CHAIR', 'PROCUREMENT'],
          'Evaluator suspended: conflict of interest',
          `${l.req.number}: ${a.user.name} declared a conflict after seeing the suppliers and has no access until it is decided`,
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
        return {
          suspended: true,
          message:
            'Your conflict was recorded and your access is suspended. A decision-maker will review it, and you will be told the outcome.',
        };
      });
      return reply.status(201).send(out);
    },
  );

  reg('GET', '/evaluations/{id}/coi/status');
  app.get(
    `${p}/evaluations/:id/coi/status`,
    { preHandler: guard(d, ['PROCUREMENT', 'PROBITY', 'CHAIR', 'DELEGATE', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      const id = eid(req);
      return withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        const rows = l.panel.map((m) => ({
          userId: m.userId,
          name: m.name,
          stream: m.stream,
          coiState: m.coiState,
          redeclaration:
            m.coiState === 'REMOVED'
              ? 'NOT_APPLICABLE'
              : m.redeclaration === 'CONFLICT'
                ? 'CONFLICT'
                : m.redeclaredAt
                  ? 'CONFIRMED'
                  : m.coiState === 'NOT_DECLARED'
                    ? 'AWAITING_FIRST'
                    : 'OUTSTANDING',
          redeclaredAt: iso(m.redeclaredAt),
          remindedAt: iso(m.remindedAt),
        }));
        return {
          members: rows,
          outstanding: outstandingDeclarations(l).map((m) => m.name),
        };
      });
    },
  );

  reg('POST', '/evaluations/{id}/coi/remind');
  app.post(
    `${p}/evaluations/:id/coi/remind`,
    { preHandler: mguard(d, ['PROCUREMENT', 'CHAIR']) },
    async (req) => {
      const a = req.auth!;
      const id = eid(req);
      return withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        if (atLeast(l.ev.status, 'LOCKED'))
          throw new AppError(409, 'INVALID_STATE', 'Declarations are closed for this evaluation');
        const reminded = await remindOutstanding(tx, svc, l, d.clock.now(), false);
        await d.audit.record(tx, a.ctx, {
          action: 'coi.remind',
          entityType: 'evaluation',
          entityId: id,
          after: { reminded: reminded.length },
        });
        return { reminded };
      });
    },
  );

  // ---- conflicts of interest on the report itself, as at the plan (FR-0370)
  async function reportAndEval(tx: Tx, a: AuthContext, reportId: string) {
    const [rep] = await tx
      .select()
      .from(evalReport)
      .where(and(eq(evalReport.id, reportId), eq(evalReport.tenantId, a.user.tenantId)));
    if (!rep) throw new AppError(404, 'NOT_FOUND', 'Report not found');
    const l = await visible(tx, a, rep.evaluationId);
    return { rep, l };
  }
  const COI_ROLES = ['PROCUREMENT', 'DELEGATE', 'EXEC', 'CHAIR', 'PROBITY', 'LEGAL'] as const;

  reg('POST', '/evaluation-reports/{id}/coi');
  app.post(
    `${p}/evaluation-reports/:id/coi`,
    { preHandler: mguard(d, [...COI_ROLES]) },
    async (req, reply) => {
      const a = req.auth!;
      const id = eid(req);
      const body = parse(redeclareBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const { l } = await reportAndEval(tx, a, id);
        const [dup] = await tx
          .select({ id: coiDeclaration.id })
          .from(coiDeclaration)
          .where(
            and(
              eq(coiDeclaration.scope, 'REPORT'),
              eq(coiDeclaration.scopeId, id),
              eq(coiDeclaration.userId, a.user.id),
            ),
          );
        if (dup) throw new AppError(409, 'ALREADY_DECLARED', 'You have already declared for this report');
        const routedTo = body.none ? null : await routeConflict(tx, a.user.tenantId, a.user.id);
        const now = d.clock.now();
        const [row] = await tx
          .insert(coiDeclaration)
          .values({
            tenantId: a.user.tenantId,
            userId: a.user.id,
            scope: 'REPORT',
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
          entityType: 'evaluation',
          entityId: l.ev.id,
          after: { coiId: row!.id, scope: 'REPORT', none: body.none, routedTo },
        });
        if (routedTo)
          await svc.notifyUsers(
            tx,
            a.user.tenantId,
            [routedTo],
            'Conflict of interest needs your decision',
            `${l.req.number}: ${a.user.name} declared a conflict on the evaluation report`,
            `/app/evaluations/${l.ev.id}`,
          );
        return {
          id: row!.id,
          userId: a.user.id,
          userName: a.user.name,
          none: body.none,
          disposition: row!.disposition,
          ...(routedTo ? { routedTo } : {}),
        };
      });
      return reply.status(201).send(out);
    },
  );

  reg('GET', '/evaluation-reports/{id}/coi');
  app.get(`${p}/evaluation-reports/:id/coi`, { preHandler: guard(d, [...COI_ROLES]) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      await reportAndEval(tx, a, id);
      const rows = await tx
        .select({ c: coiDeclaration, name: appUser.name })
        .from(coiDeclaration)
        .innerJoin(appUser, eq(appUser.id, coiDeclaration.userId))
        .where(and(eq(coiDeclaration.scope, 'REPORT'), eq(coiDeclaration.scopeId, id)))
        .orderBy(asc(coiDeclaration.createdAt));
      return {
        declarations: rows.map(({ c, name }) => ({
          id: c.id,
          userId: c.userId,
          name,
          none: c.none,
          nature: c.nature ?? null,
          disposition: c.disposition,
          declaredAt: c.createdAt.toISOString(),
          decidedAt: iso(c.decidedAt),
          mine: c.userId === a.user.id,
        })),
      };
    });
  });

  reg('POST', '/evaluation-reports/{id}/coi/{coiId}/decision');
  app.post(
    `${p}/evaluation-reports/:id/coi/:coiId/decision`,
    { preHandler: mguard(d, ['DELEGATE', 'EXEC', 'PROBITY']) },
    async (req) => {
      const a = req.auth!;
      const { id, coiId } = parse(z.object({ id: uuid, coiId: uuid }), req.params);
      const body = parse(reportCoiDecisionBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const { l } = await reportAndEval(tx, a, id);
        const [c] = await tx
          .select()
          .from(coiDeclaration)
          .where(
            and(
              eq(coiDeclaration.id, coiId),
              eq(coiDeclaration.scope, 'REPORT'),
              eq(coiDeclaration.scopeId, id),
            ),
          );
        if (!c) throw new AppError(404, 'NOT_FOUND', 'Declaration not found');
        if (c.userId === a.user.id)
          throw new AppError(403, 'ROLE_SOD_VIOLATION', 'You cannot decide your own conflict of interest');
        if (c.disposition !== 'PENDING')
          throw new AppError(409, 'INVALID_STATE', 'This declaration has already been decided');
        await tx
          .update(coiDeclaration)
          .set({
            disposition: body.disposition,
            decidedAt: d.clock.now(),
            decidedBy: a.user.id,
            decidedByRole: a.user.role,
            decisionNote: body.rationale ?? null,
          })
          .where(eq(coiDeclaration.id, coiId));
        await d.audit.record(tx, a.ctx, {
          action: 'coi.decide',
          entityType: 'evaluation',
          entityId: l.ev.id,
          after: { coiId, scope: 'REPORT', disposition: body.disposition, rationale: body.rationale ?? null },
        });
        await svc.notifyUsers(
          tx,
          a.user.tenantId,
          [c.userId],
          'Your conflict on the report was reviewed',
          `${l.req.number}: ${body.disposition === 'MATERIAL' ? 'you cannot take part in approving this report' : 'you can continue'}`,
          `/app/evaluations/${l.ev.id}`,
        );
        return { id: coiId, disposition: body.disposition };
      });
    },
  );
}

// ------------------------------------------------------------------ the probity advisor
const docView = (x: typeof probityDocument.$inferSelect, name?: string) => ({
  id: x.id,
  kind: x.kind,
  title: x.title,
  body: x.body,
  hasFile: Boolean(x.fileKey),
  fileName: x.fileName ?? null,
  status: x.status,
  version: x.version,
  signedAt: iso(x.signedAt),
  signedBy: name ?? null,
  stamp: x.stamp ?? null,
  updatedAt: x.updatedAt.toISOString(),
});

export function probityDocument_(i: {
  kind: 'PLAN' | 'OUTCOMES';
  title: string;
  requestNumber: string;
  requestTitle: string;
  body: string;
  version: number;
  status: string;
  stamp: string | null;
  updatedAt: Date;
}): PdfDocument {
  const at = `${i.updatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const blocks: PdfBlock[] = [
    { type: 'title', text: i.kind === 'PLAN' ? 'Probity plan' : 'Probity outcomes report' },
    { type: 'subtitle', text: `${i.requestNumber} ${i.requestTitle}` },
    { type: 'kv', label: 'Document', value: i.title },
    { type: 'kv', label: 'Version', value: String(i.version) },
    { type: 'kv', label: 'Status', value: i.status === 'SIGNED' ? 'Signed' : 'Draft, not signed' },
    { type: 'kv', label: 'Last saved', value: at },
    ...(i.stamp ? ([{ type: 'kv', label: 'Sign-off', value: i.stamp }] as PdfBlock[]) : []),
    { type: 'rule' },
    ...i.body
      .split(/\n{2,}/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => ({ type: 'p', text: t }) as PdfBlock),
  ];
  return {
    title: `${i.kind === 'PLAN' ? 'Probity plan' : 'Probity outcomes report'} ${i.requestNumber}`,
    footer: `${i.kind === 'PLAN' ? 'Probity plan' : 'Probity outcomes report'} ${i.requestNumber} - version ${i.version} - ${at}`,
    created: i.updatedAt,
    blocks,
  };
}

export function registerProbityRoutes(
  app: FastifyInstance,
  p: string,
  d: B3Deps,
  h: B3Helpers,
  reg: Reg,
  _x: unknown,
) {
  const { svc, visible, eid } = h;
  const view = async (tx: Tx, a: AuthContext, id: string) =>
    svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);

  // ---- allocation of external advisors to procurements (FR-0310)
  reg('GET', '/tenders/{id}/probity-advisors');
  app.get(
    `${p}/tenders/:id/probity-advisors`,
    { preHandler: guard(d, ['PROCUREMENT', 'ADMIN', 'PROBITY']) },
    async (req) => {
      const a = req.auth!;
      const id = eid(req);
      return withContext(d.database, a.ctx, async (tx) => {
        const [t] = await tx
          .select()
          .from(tender)
          .where(and(eq(tender.id, id), eq(tender.tenantId, a.user.tenantId)));
        if (!t) throw new AppError(404, 'NOT_FOUND', 'Tender not found');
        const allocated = await tx
          .select({ userId: probityAllocation.userId, name: appUser.name, external: appUser.external })
          .from(probityAllocation)
          .innerJoin(appUser, eq(appUser.id, probityAllocation.userId))
          .where(eq(probityAllocation.tenderId, id));
        const advisors = await tx
          .select({ id: appUser.id, name: appUser.name, external: appUser.external })
          .from(roleAssignment)
          .innerJoin(appUser, eq(appUser.id, roleAssignment.userId))
          .where(
            and(
              eq(roleAssignment.tenantId, a.user.tenantId),
              eq(roleAssignment.role, 'PROBITY'),
              eq(appUser.active, true),
            ),
          );
        return {
          allocated,
          available: advisors.filter((x) => x.external && !allocated.some((y) => y.userId === x.id)),
          note: 'An internal probity officer sees every procurement. An external advisor sees only the ones allocated here.',
        };
      });
    },
  );

  reg('POST', '/tenders/{id}/probity-advisors');
  app.post(
    `${p}/tenders/:id/probity-advisors`,
    { preHandler: guard(d, ['PROCUREMENT', 'ADMIN']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = eid(req);
      const body = parse(advisorBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const [t] = await tx
          .select()
          .from(tender)
          .where(and(eq(tender.id, id), eq(tender.tenantId, a.user.tenantId)));
        if (!t) throw new AppError(404, 'NOT_FOUND', 'Tender not found');
        const [u] = await tx
          .select()
          .from(appUser)
          .where(and(eq(appUser.id, body.userId), eq(appUser.tenantId, a.user.tenantId)));
        const roles = u
          ? (
              await tx
                .select({ r: roleAssignment.role })
                .from(roleAssignment)
                .where(eq(roleAssignment.userId, u.id))
            ).map((x) => x.r)
          : [];
        if (!u || !u.active || !roles.includes('PROBITY'))
          throw new AppError(400, 'VALIDATION_FAILED', 'Choose an active probity advisor', [
            { field: 'userId', message: 'This person does not hold the probity role' },
          ]);
        const [dup] = await tx
          .select({ id: probityAllocation.id })
          .from(probityAllocation)
          .where(and(eq(probityAllocation.userId, u.id), eq(probityAllocation.tenderId, id)));
        if (dup) throw new AppError(409, 'ALREADY_ALLOCATED', 'This advisor is already allocated');
        await tx.insert(probityAllocation).values({
          tenantId: a.user.tenantId,
          userId: u.id,
          tenderId: id,
          createdBy: a.user.id,
          createdAt: d.clock.now(),
        });
        const [r] = await tx.select().from(request).where(eq(request.id, t.requestId));
        await svc.notifyUsers(
          tx,
          a.user.tenantId,
          [u.id],
          'You were allocated to a procurement',
          `${r?.number ?? ''} ${r?.title ?? ''}: you have read-only oversight and can place a hold.`,
          '/app/probity',
        );
        await d.audit.record(tx, a.ctx, {
          action: 'probity.allocate',
          entityType: 'tender',
          entityId: id,
          after: { userId: u.id, external: u.external },
        });
        return { userId: u.id, name: u.name };
      });
      return reply.status(201).send(out);
    },
  );

  reg('DELETE', '/tenders/{id}/probity-advisors/{userId}');
  app.delete(
    `${p}/tenders/:id/probity-advisors/:userId`,
    { preHandler: guard(d, ['PROCUREMENT', 'ADMIN']) },
    async (req, reply) => {
      const a = req.auth!;
      const { id, userId } = parse(z.object({ id: uuid, userId: uuid }), req.params);
      await withContext(d.database, a.ctx, async (tx) => {
        const gone = await tx
          .delete(probityAllocation)
          .where(
            and(
              eq(probityAllocation.tenantId, a.user.tenantId),
              eq(probityAllocation.tenderId, id),
              eq(probityAllocation.userId, userId),
            ),
          )
          .returning({ id: probityAllocation.id });
        if (!gone.length) throw new AppError(404, 'NOT_FOUND', 'Allocation not found');
        await d.audit.record(tx, a.ctx, {
          action: 'probity.deallocate',
          entityType: 'tender',
          entityId: id,
          after: { userId },
        });
      });
      return reply.status(204).send();
    },
  );

  // ---- the read-only portal
  reg('GET', '/probity/portal');
  app.get(`${p}/probity/portal`, { preHandler: guard(d, ['PROBITY']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const [me] = await tx.select({ e: appUser.external }).from(appUser).where(eq(appUser.id, a.user.id));
      const scope = await allocatedTenders(tx, a.user.tenantId, { id: a.user.id, external: Boolean(me?.e) });
      const rows = await tx
        .select({ ev: evaluation, r: request })
        .from(evaluation)
        .innerJoin(tender, eq(tender.id, evaluation.tenderId))
        .innerJoin(request, eq(request.id, tender.requestId))
        .where(eq(evaluation.tenantId, a.user.tenantId))
        .orderBy(desc(evaluation.updatedAt));
      const docs = await tx
        .select()
        .from(probityDocument)
        .where(eq(probityDocument.tenantId, a.user.tenantId));
      return {
        external: Boolean(me?.e),
        procurements: rows
          .filter((x) => !scope || scope.has(x.ev.tenderId))
          .map(({ ev, r }) => ({
            evaluationId: ev.id,
            tenderId: ev.tenderId,
            number: r.number,
            title: r.title,
            status: ev.status,
            held: ev.held,
            holdReason: ev.holdReason ?? null,
            documents: docs
              .filter((x) => x.evaluationId === ev.id)
              .map((x) => ({ kind: x.kind, status: x.status, version: x.version })),
          })),
      };
    });
  });

  // ---- system hold (FR-0310): freezes the workspace on suspected bias or a process breach
  reg('POST', '/evaluations/{id}/hold');
  app.post(`${p}/evaluations/:id/hold`, { preHandler: guard(d, ['PROBITY']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(holdBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (l.ev.held) throw new AppError(409, 'ALREADY_HELD', 'This evaluation is already on hold');
      if (l.ev.status === 'APPROVED')
        throw new AppError(409, 'INVALID_STATE', 'An approved evaluation cannot be put on hold');
      const now = d.clock.now();
      await tx
        .update(evaluation)
        .set({ held: true, holdReason: body.reason, heldBy: a.user.id, heldAt: now, updatedAt: now })
        .where(eq(evaluation.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'evaluation.hold',
        entityType: 'evaluation',
        entityId: id,
        before: { held: false },
        after: { held: true, reason: body.reason },
      });
      await svc.notifyUsers(
        tx,
        a.user.tenantId,
        l.panel.map((m) => m.userId),
        'The evaluation is on hold',
        `${l.req.number} ${l.req.title}: a probity advisor has frozen the workspace. ${body.reason}`,
        `/app/evaluations/${id}`,
      );
      await svc.notifyRoles(
        tx,
        a.user.tenantId,
        ['PROCUREMENT', 'DELEGATE', 'EXEC'],
        'An evaluation was put on hold',
        `${l.req.number} ${l.req.title}: ${body.reason}`,
        `/app/evaluations/${id}`,
      );
      return view(tx, a, id);
    });
  });

  reg('POST', '/evaluations/{id}/release');
  app.post(`${p}/evaluations/:id/release`, { preHandler: guard(d, ['PROBITY']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(releaseBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (!l.ev.held) throw new AppError(409, 'INVALID_STATE', 'This evaluation is not on hold');
      await tx
        .update(evaluation)
        .set({ held: false, holdReason: null, heldBy: null, heldAt: null, updatedAt: d.clock.now() })
        .where(eq(evaluation.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'evaluation.release',
        entityType: 'evaluation',
        entityId: id,
        before: { held: true, reason: l.ev.holdReason },
        after: { held: false, note: body.note },
      });
      await svc.notifyUsers(
        tx,
        a.user.tenantId,
        l.panel.map((m) => m.userId),
        'The evaluation hold was released',
        `${l.req.number} ${l.req.title}: you can continue. ${body.note}`,
        `/app/evaluations/${id}`,
      );
      return view(tx, a, id);
    });
  });

  // ---- probity plan and probity outcomes report (FR-0340)
  async function docOf(tx: Tx, evaluationId: string, kind: 'PLAN' | 'OUTCOMES') {
    const [x] = await tx
      .select()
      .from(probityDocument)
      .where(and(eq(probityDocument.evaluationId, evaluationId), eq(probityDocument.kind, kind)));
    return x;
  }

  reg('GET', '/evaluations/{id}/probity');
  app.get(`${p}/evaluations/:id/probity`, { preHandler: guard(d, [...STAFF_READ]) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      await visible(tx, a, id);
      const rows = await tx.select().from(probityDocument).where(eq(probityDocument.evaluationId, id));
      const names = new Map(
        (await tx.select({ id: appUser.id, name: appUser.name }).from(appUser)).map((u) => [u.id, u.name]),
      );
      return { documents: rows.map((x) => docView(x, x.signedBy ? names.get(x.signedBy) : undefined)) };
    });
  });

  reg('PUT', '/evaluations/{id}/probity/{kind}');
  app.put(`${p}/evaluations/:id/probity/:kind`, { preHandler: guard(d, ['PROBITY']) }, async (req) => {
    const a = req.auth!;
    const { id, kind } = parse(z.object({ id: uuid, kind: docKind }), req.params);
    const body = parse(probityDocBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      await visible(tx, a, id);
      const now = d.clock.now();
      const ex = await docOf(tx, id, kind);
      if (ex) {
        // editing a signed document makes a new, unsigned version: the earlier sign-off stays in the audit trail
        await tx
          .update(probityDocument)
          .set({
            title: body.title,
            body: body.body,
            fileName: null,
            fileKey: null,
            fileSha256: null,
            contentType: null,
            status: 'DRAFT',
            version: ex.status === 'SIGNED' ? ex.version + 1 : ex.version,
            signedBy: null,
            signedAt: null,
            stamp: null,
            updatedAt: now,
          })
          .where(eq(probityDocument.id, ex.id));
      } else {
        await tx.insert(probityDocument).values({
          tenantId: a.user.tenantId,
          evaluationId: id,
          kind,
          title: body.title,
          body: body.body,
          createdBy: a.user.id,
          updatedAt: now,
        });
      }
      await d.audit.record(tx, a.ctx, {
        action: 'probity.document_save',
        entityType: 'evaluation',
        entityId: id,
        after: {
          kind,
          authored: true,
          version: ex ? (ex.status === 'SIGNED' ? ex.version + 1 : ex.version) : 1,
        },
      });
      return docView((await docOf(tx, id, kind))!);
    });
  });

  reg('POST', '/evaluations/{id}/probity/{kind}/upload');
  app.post(
    `${p}/evaluations/:id/probity/:kind/upload`,
    { preHandler: guard(d, ['PROBITY']), bodyLimit: 16 * 1024 * 1024 },
    async (req, reply) => {
      const a = req.auth!;
      const { id, kind } = parse(z.object({ id: uuid, kind: docKind }), req.params);
      const body = parse(uploadBody, req.body);
      const bytes = Buffer.from(body.contentBase64, 'base64');
      const check = checkUpload(body.fileName, bytes);
      if (!check.ok) throw new AppError(400, check.code, check.message);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        const key = `${a.user.tenantId}/probity/${l.ev.id}/${randomUUID()}`;
        await d.store.put(key, bytes);
        const now = d.clock.now();
        const ex = await docOf(tx, id, kind);
        const values = {
          title: body.title,
          body: '',
          fileName: check.safeName,
          fileKey: key,
          fileSha256: sha256(bytes),
          contentType: check.contentType,
          status: 'DRAFT' as const,
          version: ex && ex.status === 'SIGNED' ? ex.version + 1 : (ex?.version ?? 1),
          signedBy: null,
          signedAt: null,
          stamp: null,
          updatedAt: now,
        };
        if (ex) await tx.update(probityDocument).set(values).where(eq(probityDocument.id, ex.id));
        else
          await tx
            .insert(probityDocument)
            .values({ tenantId: a.user.tenantId, evaluationId: id, kind, createdBy: a.user.id, ...values });
        await d.audit.record(tx, a.ctx, {
          action: 'probity.document_save',
          entityType: 'evaluation',
          entityId: id,
          after: { kind, uploaded: check.safeName, sha256: values.fileSha256, version: values.version },
        });
        return docView((await docOf(tx, id, kind))!);
      });
      return reply.status(201).send(out);
    },
  );

  reg('POST', '/evaluations/{id}/probity/{kind}/sign');
  app.post(`${p}/evaluations/:id/probity/:kind/sign`, { preHandler: guard(d, ['PROBITY']) }, async (req) => {
    const a = req.auth!;
    const { id, kind } = parse(z.object({ id: uuid, kind: docKind }), req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      const x = await docOf(tx, id, kind);
      if (!x) throw new AppError(404, 'NOT_FOUND', 'There is no document to sign yet');
      if (x.status === 'SIGNED')
        throw new AppError(409, 'ALREADY_SIGNED_OFF', 'This version is already signed');
      if (kind === 'OUTCOMES' && !atLeast(l.ev.status, 'LOCKED'))
        throw new AppError(
          409,
          'INVALID_STATE',
          'The outcomes report can be signed once consensus is locked',
        );
      const now = d.clock.now();
      const stamp = stampOf(
        kind === 'PLAN' ? 'PROBITY PLAN SIGNED' : 'PROBITY OUTCOMES SIGNED',
        a.user.name,
        a.user.role,
        now,
      );
      await tx
        .update(probityDocument)
        .set({ status: 'SIGNED', signedBy: a.user.id, signedAt: now, stamp, updatedAt: now })
        .where(eq(probityDocument.id, x.id));
      await d.audit.record(tx, a.ctx, {
        action: 'probity.document_sign',
        entityType: 'evaluation',
        entityId: id,
        after: { kind, version: x.version, stamp, sha256: x.fileSha256 ?? null },
      });
      await svc.notifyRoles(
        tx,
        a.user.tenantId,
        ['PROCUREMENT', 'DELEGATE'],
        kind === 'PLAN' ? 'Probity plan signed' : 'Probity outcomes report signed',
        `${l.req.number} ${l.req.title}`,
        `/app/evaluations/${id}`,
      );
      const names = new Map([[a.user.id, a.user.name]]);
      return docView((await docOf(tx, id, kind))!, names.get(a.user.id));
    });
  });

  for (const format of ['pdf', 'docx'] as const) {
    reg('GET', `/evaluations/{id}/probity/{kind}/${format}`);
    app.get(
      `${p}/evaluations/:id/probity/:kind/${format}`,
      { preHandler: guard(d, [...STAFF_READ]) },
      async (req, reply) => {
        const a = req.auth!;
        const { id, kind } = parse(z.object({ id: uuid, kind: docKind }), req.params);
        const out = await withContext(d.database, a.ctx, async (tx) => {
          const l = await visible(tx, a, id);
          const x = await docOf(tx, id, kind);
          if (!x) throw new AppError(404, 'NO_DOCUMENT', 'There is no document to export yet');
          if (x.fileKey)
            throw new AppError(
              409,
              'UPLOADED_FILE',
              'This document was uploaded as a file: download the file instead',
            );
          await d.audit.record(tx, a.ctx, {
            action: 'probity.document_export',
            entityType: 'evaluation',
            entityId: id,
            after: { kind, format: format.toUpperCase(), version: x.version, status: x.status },
          });
          return probityDocument_({
            kind,
            title: x.title,
            requestNumber: l.req.number,
            requestTitle: l.req.title,
            body: x.body,
            version: x.version,
            status: x.status,
            stamp: x.stamp,
            updatedAt: x.updatedAt,
          });
        });
        return reply
          .header(
            'content-type',
            format === 'pdf'
              ? 'application/pdf'
              : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          )
          .header(
            'content-disposition',
            `attachment; filename="probity-${kind.toLowerCase()}-v${out.footer.match(/version (\d+)/)?.[1] ?? '1'}.${format}"`,
          )
          .send(format === 'pdf' ? renderPdf(out) : renderDocx(out));
      },
    );
  }

  reg('GET', '/evaluations/{id}/probity/{kind}/file');
  app.get(
    `${p}/evaluations/:id/probity/:kind/file`,
    { preHandler: guard(d, [...STAFF_READ]) },
    async (req, reply) => {
      const a = req.auth!;
      const { id, kind } = parse(z.object({ id: uuid, kind: docKind }), req.params);
      const x = await withContext(d.database, a.ctx, async (tx) => {
        await visible(tx, a, id);
        const f = await docOf(tx, id, kind);
        if (!f?.fileKey) throw new AppError(404, 'NO_DOCUMENT', 'There is no uploaded file');
        await d.audit.record(tx, a.ctx, {
          action: 'probity.document_export',
          entityType: 'evaluation',
          entityId: id,
          after: { kind, format: 'FILE', version: f.version },
        });
        return f;
      });
      const bytes = await d.store.get(x.fileKey!).catch(() => null);
      if (!bytes) throw new AppError(404, 'FILE_UNAVAILABLE', 'This file is not available');
      return reply
        .header('content-type', x.contentType ?? 'application/octet-stream')
        .header(
          'content-disposition',
          `attachment; filename="${(x.fileName ?? 'probity').replace(/[^\w. -]/g, '_')}"`,
        )
        .send(bytes);
    },
  );
}

// ------------------------------------------------------------------ plain language and ranking
export function registerScoringRoutes(app: FastifyInstance, p: string, d: B3Deps, h: B3Helpers, reg: Reg) {
  const { svc, visible, declaredMember, mguard, eid } = h;

  /** The rows of the criteria and suppliers this person may score now, or the reason they cannot. */
  async function scoringContext(tx: Tx, a: AuthContext, id: string) {
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
    const excluded = await svc.excludedFor(tx, l, a.user.id);
    const suppliers = l.bidders.filter((b) => !excluded.has(b.supplierId));
    return { l, me, excluded, suppliers, criteria: svc.criteriaFor(l, me) };
  }

  async function writeScores(
    tx: Tx,
    a: AuthContext,
    evaluationId: string,
    supplierId: string,
    rows: Array<{ criterionId: string; score: number; comment: string | null }>,
  ) {
    const existing = await tx
      .select()
      .from(score)
      .where(
        and(
          eq(score.evaluationId, evaluationId),
          eq(score.supplierId, supplierId),
          eq(score.evaluatorId, a.user.id),
        ),
      );
    for (const s of rows) {
      const row = existing.find((e) => e.criterionId === s.criterionId);
      if (row)
        await tx
          .update(score)
          .set({ score: s.score.toFixed(2), comment: s.comment })
          .where(eq(score.id, row.id));
      else
        await tx.insert(score).values({
          tenantId: a.user.tenantId,
          evaluationId,
          supplierId,
          criterionId: s.criterionId,
          evaluatorId: a.user.id,
          score: s.score.toFixed(2),
          comment: s.comment,
          createdAt: d.clock.now(),
        });
    }
  }

  // ---- scores and commentary in plain language, read back for confirmation before anything is saved (FR-0315)
  reg('POST', '/evaluations/{id}/scores/plain');
  app.post(
    `${p}/evaluations/:id/scores/plain`,
    { preHandler: mguard(d, ['EVALUATOR', 'CHAIR']) },
    async (req) => {
      const a = req.auth!;
      const id = eid(req);
      const body = parse(plainScoresBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const c = await scoringContext(tx, a, id);
        if (c.l.ev.mode === 'RANKING')
          throw new AppError(409, 'INVALID_STATE', 'This evaluation is ranked: use the ranking entry');
        if (!c.suppliers.some((s) => s.supplierId === body.supplierId))
          throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
        const reading = readScores(
          body.text,
          c.criteria.map((x) => ({ id: x.id, name: x.name, passFail: x.passFail })),
        );
        const named = reading.scores.map((s) => ({
          ...s,
          criterion: c.criteria.find((x) => x.id === s.criterionId)!.name,
        }));
        for (const s of named)
          if (
            !validScore(s.score, c.criteria.find((x) => x.id === s.criterionId)!.passFail) ||
            !canScoreCriterion(
              c.me.stream as Stream,
              c.criteria.find((x) => x.id === s.criterionId)!.stream as Stream,
            )
          )
            throw new AppError(400, 'VALIDATION_FAILED', 'That reading is not a valid score');
        if (body.apply) {
          if (named.length === 0)
            throw new AppError(400, 'NOTHING_UNDERSTOOD', 'No score could be read from that text', [
              {
                field: 'text',
                message:
                  'Name a criterion and say how the supplier did, for example "price is weak" or "safety 8 out of 10"',
              },
            ]);
          await writeScores(tx, a, id, body.supplierId, named);
          await d.audit.record(tx, a.ctx, {
            action: 'score.save',
            entityType: 'evaluation',
            entityId: id,
            after: { cells: named.length, entered: 'PLAIN_LANGUAGE' },
          });
        }
        return {
          model: 'rules-simulated-v1',
          applied: body.apply,
          scores: named.map((s) => ({
            criterionId: s.criterionId,
            criterion: s.criterion,
            score: s.score,
            basis: s.basis,
            comment: s.comment,
          })),
          unmatched: reading.unmatched,
        };
      });
    },
  );

  // ---- ranking mode (FR-0280): evaluators order the suppliers; the order becomes scores the rest of the process uses
  async function rankingContext(tx: Tx, a: AuthContext, id: string) {
    const c = await scoringContext(tx, a, id);
    if (c.l.ev.mode !== 'RANKING')
      throw new AppError(409, 'INVALID_STATE', 'This evaluation is scored, not ranked');
    const crit = c.criteria[0];
    if (!crit) throw new AppError(409, 'INVALID_STATE', 'There is nothing to rank');
    return { ...c, crit };
  }
  async function applyOrder(
    tx: Tx,
    a: AuthContext,
    c: Awaited<ReturnType<typeof rankingContext>>,
    order: string[],
  ) {
    const ids = c.suppliers.map((s) => s.supplierId);
    if (
      order.length !== ids.length ||
      new Set(order).size !== order.length ||
      !order.every((x) => ids.includes(x))
    )
      throw new AppError(400, 'VALIDATION_FAILED', 'Rank every supplier exactly once', [
        { field: 'order', message: `Expected ${ids.length} different suppliers` },
      ]);
    for (const [i, supplierId] of order.entries())
      await writeScores(tx, a, c.l.ev.id, supplierId, [
        {
          criterionId: c.crit.id,
          score: positionScore(i + 1, order.length),
          comment: `Ranked ${i + 1} of ${order.length}`,
        },
      ]);
    await d.audit.record(tx, a.ctx, {
      action: 'score.save',
      entityType: 'evaluation',
      entityId: c.l.ev.id,
      after: { cells: order.length, entered: 'RANKING' },
    });
  }

  reg('PUT', '/evaluations/{id}/ranking');
  app.put(`${p}/evaluations/:id/ranking`, { preHandler: mguard(d, ['EVALUATOR', 'CHAIR']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(rankingBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await rankingContext(tx, a, id);
      await applyOrder(tx, a, c, body.order);
      return { order: body.order };
    });
  });

  reg('POST', '/evaluations/{id}/ranking/plain');
  app.post(
    `${p}/evaluations/:id/ranking/plain`,
    { preHandler: mguard(d, ['EVALUATOR', 'CHAIR']) },
    async (req) => {
      const a = req.auth!;
      const id = eid(req);
      const body = parse(plainRankingBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const c = await rankingContext(tx, a, id);
        const namesVisible = !isSuspended(c.me) && c.me.coiState === 'DECLARED_NONE';
        const read = readOrder(
          body.text,
          c.suppliers.map((s) => ({
            supplierId: s.supplierId,
            names: namesVisible ? [s.company, s.label] : [s.label],
          })),
        );
        if (body.apply) {
          if (read.missing.length)
            throw new AppError(400, 'NOTHING_UNDERSTOOD', 'Every supplier must be named once', [
              { field: 'text', message: `Not found: ${read.missing.join(', ')}` },
            ]);
          await applyOrder(tx, a, c, read.order);
        }
        return {
          model: 'rules-simulated-v1',
          applied: body.apply,
          order: read.order.map((sid, i) => ({
            position: i + 1,
            supplierId: sid,
            displayName: c.suppliers.find((s) => s.supplierId === sid)!.company,
          })),
          missing: read.missing,
        };
      });
    },
  );

  void criterion;
  void tender;
}
