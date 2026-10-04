/**
 * Evaluation and report, roadmap batch B3:
 *  - criteria library and per-evaluation criteria (FR-0320);
 *  - the compliance gate with automated clarification requests and waivers (FR-0265);
 *  - clarifications, bid pricing, best and final offer rounds and the negotiation advisor (FR-0290, FR-0295);
 *  - plain-language scores and rankings, and ranking mode (FR-0280, FR-0315);
 *  - evaluator substitution and replacement after a material conflict (FR-0305, FR-0335);
 *  - conflict re-declaration and reminders, and conflict declarations on the report (FR-0325, FR-0370);
 *  - the probity advisor's allocation, hold, plan and outcomes report (FR-0310, FR-0340).
 * Every change is audited. Scores stay hidden exactly as before: nothing here lets an evaluator see another's marks.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Clock, RoleName } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { withContext, withSystem, type Tx } from '../../db/client.js';
import {
  bafoOffer,
  bafoRound,
  bidPricing,
  clarification,
  complianceCheck,
  criterion,
  evaluation,
  request,
  submission,
  supplier,
  tender,
  tenderDeviation,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { loadSettings } from '../settings/settings.js';
import { type SealedStore } from '../tender/files.js';
import { TenderService } from '../tender/service.js';
import { adviseNegotiation, tcoOf } from './commercial.js';
import { loadExtras, noticeToSupplier, runComplianceGate } from './b3-service.js';
import { registerPanelRoutes, registerProbityRoutes, registerScoringRoutes } from './b3-routes2.js';
import { composeReport, storeReport } from './report-compose.js';
import { atLeast, type EvaluationService, type Loaded } from './service.js';

export interface B3Deps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
  store: SealedStore;
}
/** What the main evaluation routes share with this file, so the rules (who may see an evaluation, the hold) stay in one place. */
export interface B3Helpers {
  svc: EvaluationService;
  visible: (tx: Tx, a: AuthContext, id: string) => Promise<Loaded>;
  declaredMember: (l: Loaded, a: AuthContext) => Loaded['panel'][number];
  mguard: (
    dd: GuardDeps,
    roles: readonly RoleName[],
  ) => Array<(req: FastifyRequest, reply: FastifyReply) => Promise<void>>;
  eid: (req: FastifyRequest) => string;
  assertSegregated: (tx: Tx, tenantId: string, userIds: string[]) => Promise<void>;
}

const uuid = z.string().uuid();
const money = z.number().min(0).max(1e10);
const criteriaBody = z
  .object({
    criteria: z
      .array(
        z
          .object({
            name: z.string().trim().min(3).max(120),
            stream: z.enum(['TECHNICAL', 'COMMERCIAL', 'OTHER']),
            weight: z.number().min(0).max(100),
            passFail: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
const waiveBody = z.object({ note: z.string().trim().min(10).max(1000) }).strict();
const clarifyBody = z
  .object({
    supplierId: uuid,
    subject: z.string().trim().min(3).max(200),
    question: z.string().trim().min(10).max(4000),
    dueInDays: z.number().int().min(1).max(60).optional(),
  })
  .strict();
const responseBody = z.object({ response: z.string().trim().min(2).max(8000) }).strict();
const pricingBody = z
  .object({
    basePrice: money,
    implementation: money.default(0),
    annualRunning: money.default(0),
    years: z.number().int().min(1).max(30).default(1),
  })
  .strict();
const bafoBody = z
  .object({
    supplierIds: z.array(uuid).min(1).max(20),
    note: z.string().trim().min(10).max(2000),
    closesInDays: z.number().int().min(1).max(30).default(3),
  })
  .strict();
const offerBody = pricingBody.extend({ note: z.string().trim().max(2000).optional() }).strict();
export function registerEvaluationB3(app: FastifyInstance, p: string, d: B3Deps, h: B3Helpers): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const { svc, visible, mguard, eid } = h;
  const tenders = new TenderService(d.clock, d.audit, d.store);
  const STAFF_READ = ['PROCUREMENT', 'DELEGATE', 'LEGAL', 'PROBITY', 'EXEC', 'CHAIR'] as const;
  const iso = (x: Date | null) => (x ? x.toISOString() : null);

  const view = async (tx: Tx, a: AuthContext, id: string) =>
    svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);

  /** A recompiled draft keeps the report in step with offers or waivers accepted after the lock (FR-0350). */
  async function recompile(a: AuthContext, id: string) {
    await withSystem(d.database, async (tx) => {
      const l = await svc.load(tx, a.user.tenantId, id);
      if (!l || l.ev.status !== 'LOCKED') return;
      const now = d.clock.now();
      await storeReport(tx, a.user.tenantId, id, await composeReport(tx, svc, l, now), 'DRAFT', now);
    });
  }

  // ---------------------------------------------------------------- criteria library and per-evaluation criteria (FR-0320)
  reg('GET', '/criteria-library');
  app.get(
    `${p}/criteria-library`,
    { preHandler: guard(d, ['PROCUREMENT', 'ADMIN', 'CHAIR', 'DELEGATE', 'PROBITY', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      return withContext(d.database, a.ctx, async (tx) => ({
        criteria: (await loadSettings(tx, a.user.tenantId)).criteriaLibrary,
      }));
    },
  );

  reg('PUT', '/evaluations/{id}/criteria');
  app.put(`${p}/evaluations/:id/criteria`, { preHandler: mguard(d, ['PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(criteriaBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (l.ev.status !== 'COI_PENDING')
        throw new AppError(409, 'INVALID_STATE', 'Criteria can only change before scoring opens');
      if (l.ev.mode === 'RANKING')
        throw new AppError(409, 'INVALID_STATE', 'A ranking evaluation has a single criterion');
      const names = body.criteria.map((c) => c.name.toLowerCase());
      if (new Set(names).size !== names.length)
        throw new AppError(400, 'VALIDATION_FAILED', 'Each criterion can appear once');
      const weighted = body.criteria.filter((c) => !c.passFail);
      const total = weighted.reduce((x, c) => x + c.weight, 0);
      if (weighted.length === 0 || Math.round(total * 100) !== 10_000)
        throw new AppError(400, 'VALIDATION_FAILED', 'The weights must add up to 100', [
          { field: 'criteria', message: `They add up to ${total}` },
        ]);
      if (body.criteria.some((c) => c.passFail && c.weight !== 0))
        throw new AppError(400, 'VALIDATION_FAILED', 'A pass or fail criterion carries no weight');
      for (const s of ['TECHNICAL', 'COMMERCIAL'] as const)
        if (body.criteria.some((c) => c.stream === s) && !svc.active(l).some((m) => m.stream === s))
          throw new AppError(
            400,
            'VALIDATION_FAILED',
            `The panel has no ${s.toLowerCase()} evaluator for a ${s.toLowerCase()} criterion`,
          );
      await tx.delete(criterion).where(eq(criterion.evaluationId, id));
      for (const c of body.criteria)
        await tx.insert(criterion).values({
          tenantId: a.user.tenantId,
          evaluationId: id,
          name: c.name,
          weight: String(c.weight),
          stream: c.stream,
          passFail: c.passFail,
        });
      await d.audit.record(tx, a.ctx, {
        action: 'evaluation.criteria_set',
        entityType: 'evaluation',
        entityId: id,
        before: { criteria: l.criteria.map((c) => ({ name: c.name, weight: Number(c.weight) })) },
        after: {
          criteria: body.criteria.map((c) => ({ name: c.name, weight: c.weight })),
          stage: l.tender.stage,
        },
      });
      return view(tx, a, id);
    });
  });

  // ---------------------------------------------------------------- compliance gate (FR-0265)
  reg('POST', '/evaluations/{id}/compliance/run');
  app.post(`${p}/evaluations/:id/compliance/run`, { preHandler: mguard(d, ['PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (atLeast(l.ev.status, 'LOCKED'))
        throw new AppError(409, 'INVALID_STATE', 'The checks cannot be re-run once consensus is locked');
      const now = d.clock.now();
      const out = await runComplianceGate(tx, l, now, a.user.id);
      for (const r of out.requests)
        await noticeToSupplier(tx, a.user.tenantId, r.supplierId, {
          title: r.subject,
          body: `${l.req.number} ${l.req.title}: ${r.question}`,
          link: `/supplier/tenders/${l.tender.id}`,
          kind: 'CLARIFICATION',
          refId: id,
        });
      await d.audit.record(tx, a.ctx, {
        action: 'evaluation.compliance_gate',
        entityType: 'evaluation',
        entityId: id,
        after: { failed: out.failed, requests: out.requests.length, rerun: true },
      });
      return view(tx, a, id);
    });
  });

  reg('POST', '/evaluations/{id}/compliance/{supplierId}/{key}/waive');
  app.post(
    `${p}/evaluations/:id/compliance/:supplierId/:key/waive`,
    { preHandler: mguard(d, ['PROCUREMENT', 'DELEGATE']) },
    async (req) => {
      const a = req.auth!;
      const { id, supplierId, key } = parse(
        z.object({
          id: uuid,
          supplierId: uuid,
          key: z.enum(['REGISTRATION', 'DECLARATIONS', 'INSURANCE', 'COMPLETENESS']),
        }),
        req.params,
      );
      const body = parse(waiveBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        if (l.ev.status === 'APPROVED' || l.ev.status === 'REPORTED')
          throw new AppError(409, 'INVALID_STATE', 'The report is already with the approver');
        const [row] = await tx
          .select()
          .from(complianceCheck)
          .where(
            and(
              eq(complianceCheck.evaluationId, id),
              eq(complianceCheck.supplierId, supplierId),
              eq(complianceCheck.checkKey, key),
            ),
          );
        if (!row || row.result !== 'FAIL')
          throw new AppError(409, 'INVALID_STATE', 'Only a failed check can be waived');
        await tx
          .update(complianceCheck)
          .set({ result: 'WAIVED', decidedBy: a.user.id, decidedNote: body.note, decidedAt: d.clock.now() })
          .where(eq(complianceCheck.id, row.id));
        await d.audit.record(tx, a.ctx, {
          action: 'compliance.waive',
          entityType: 'evaluation',
          entityId: id,
          before: { check: key, supplierId, result: 'FAIL', detail: row.detail },
          after: { result: 'WAIVED', note: body.note },
        });
        await svc.notifyRoles(
          tx,
          a.user.tenantId,
          ['PROBITY'],
          'A compliance check was waived',
          `${l.req.number}: ${row.detail}. Waived with: ${body.note}`,
          `/app/evaluations/${id}`,
        );
        return view(tx, a, id);
      });
      await recompile(a, id);
      return out;
    },
  );

  // ---------------------------------------------------------------- clarification requests (FR-0290)
  const clarView = (c: typeof clarification.$inferSelect, company?: string) => ({
    id: c.id,
    evaluationId: c.evaluationId,
    supplierId: c.supplierId,
    ...(company ? { supplier: company } : {}),
    kind: c.kind,
    subject: c.subject,
    question: c.question,
    dueAt: c.dueAt.toISOString(),
    status: c.status,
    overdue: c.status === 'OPEN' && c.dueAt.getTime() < d.clock.now().getTime(),
    response: c.response ?? null,
    respondedAt: iso(c.respondedAt),
    createdAt: c.createdAt.toISOString(),
  });

  reg('POST', '/evaluations/{id}/clarifications');
  app.post(
    `${p}/evaluations/:id/clarifications`,
    { preHandler: mguard(d, ['PROCUREMENT']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = eid(req);
      const body = parse(clarifyBody, req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        if (l.ev.status === 'APPROVED')
          throw new AppError(409, 'INVALID_STATE', 'The evaluation has been approved');
        if (!l.bidders.some((b) => b.supplierId === body.supplierId))
          throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
        const days =
          body.dueInDays ?? (await loadSettings(tx, a.user.tenantId)).evaluationRules.clarificationDays;
        const now = d.clock.now();
        const [c] = await tx
          .insert(clarification)
          .values({
            tenantId: a.user.tenantId,
            evaluationId: id,
            supplierId: body.supplierId,
            kind: 'CLARIFICATION',
            subject: body.subject,
            question: body.question,
            dueAt: new Date(now.getTime() + days * 86_400_000),
            createdBy: a.user.id,
            createdAt: now,
          })
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: 'clarification.request',
          entityType: 'evaluation',
          entityId: id,
          after: {
            clarificationId: c!.id,
            supplierId: body.supplierId,
            subject: body.subject,
            dueAt: c!.dueAt,
          },
        });
        await noticeToSupplier(tx, a.user.tenantId, body.supplierId, {
          title: `Clarification requested: ${body.subject}`,
          body: `${l.req.number} ${l.req.title}: ${body.question} Please answer by ${c!.dueAt.toISOString().slice(0, 10)}.`,
          link: `/supplier/tenders/${l.tender.id}`,
          kind: 'CLARIFICATION',
          refId: id,
        });
        return clarView(c!, l.bidders.find((b) => b.supplierId === body.supplierId)?.company);
      });
      return reply.status(201).send(out);
    },
  );

  reg('GET', '/evaluations/{id}/clarifications');
  app.get(`${p}/evaluations/:id/clarifications`, { preHandler: guard(d, [...STAFF_READ]) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      const rows = await tx
        .select()
        .from(clarification)
        .where(eq(clarification.evaluationId, id))
        .orderBy(desc(clarification.createdAt));
      return {
        clarifications: rows.map((c) =>
          clarView(c, l.bidders.find((b) => b.supplierId === c.supplierId)?.company),
        ),
      };
    });
  });

  reg('POST', '/clarifications/{id}/close');
  app.post(`${p}/clarifications/:id/close`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const [c] = await tx
        .select()
        .from(clarification)
        .where(and(eq(clarification.id, id), eq(clarification.tenantId, a.user.tenantId)));
      if (!c) throw new AppError(404, 'NOT_FOUND', 'Clarification not found');
      await visible(tx, a, c.evaluationId);
      await tx.update(clarification).set({ status: 'CLOSED' }).where(eq(clarification.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'clarification.close',
        entityType: 'evaluation',
        entityId: c.evaluationId,
        after: { clarificationId: id },
      });
      return clarView({ ...c, status: 'CLOSED' });
    });
  });

  // ---- the supplier's side
  async function assertSupplierLive(tx: Tx, a: AuthContext) {
    const [s] = await tx.select().from(supplier).where(eq(supplier.id, a.user.supplierId!));
    if (s?.sanctionsStatus === 'MATCH')
      throw new AppError(
        403,
        'SUPPLIER_QUARANTINED',
        'Your account is on hold while a screening result is reviewed. The buyer will contact you.',
      );
  }

  reg('GET', '/supplier/clarifications');
  app.get(`${p}/supplier/clarifications`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      await assertSupplierLive(tx, a);
      const rows = await tx
        .select({
          c: clarification,
          tenderId: evaluation.tenderId,
          title: request.title,
          number: request.number,
        })
        .from(clarification)
        .innerJoin(evaluation, eq(evaluation.id, clarification.evaluationId))
        .innerJoin(tender, eq(tender.id, evaluation.tenderId))
        .innerJoin(request, eq(request.id, tender.requestId))
        .where(eq(clarification.supplierId, a.user.supplierId!))
        .orderBy(desc(clarification.createdAt));
      return {
        clarifications: rows.map((r) => ({
          ...clarView(r.c),
          tenderId: r.tenderId,
          tenderTitle: `${r.number} ${r.title}`,
        })),
      };
    });
  });

  reg('POST', '/supplier/clarifications/{id}/response');
  app.post(
    `${p}/supplier/clarifications/:id/response`,
    { preHandler: guard(d, ['SUPPLIER']) },
    async (req) => {
      const a = req.auth!;
      const id = eid(req);
      const body = parse(responseBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        await assertSupplierLive(tx, a);
        const [c] = await tx
          .select()
          .from(clarification)
          .where(and(eq(clarification.id, id), eq(clarification.supplierId, a.user.supplierId!)));
        if (!c) throw new AppError(404, 'NOT_FOUND', 'Clarification not found');
        if (c.status !== 'OPEN') throw new AppError(409, 'INVALID_STATE', 'This request is no longer open');
        const now = d.clock.now();
        if (c.dueAt.getTime() < now.getTime())
          throw new AppError(
            409,
            'RESPONSE_PERIOD_ENDED',
            'The response period has ended. Contact the buyer if you still need to answer.',
          );
        await tx
          .update(clarification)
          .set({ status: 'ANSWERED', response: body.response, respondedBy: a.user.id, respondedAt: now })
          .where(eq(clarification.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'clarification.respond',
          entityType: 'evaluation',
          entityId: c.evaluationId,
          after: { clarificationId: id, kind: c.kind },
        });
        // an answered compliance request tells procurement the gate may now be re-run
        const [ev] = await tx.select().from(evaluation).where(eq(evaluation.id, c.evaluationId));
        const [r] = ev
          ? await tx
              .select({ n: request.number, t: request.title })
              .from(tender)
              .innerJoin(request, eq(request.id, tender.requestId))
              .where(eq(tender.id, ev.tenderId))
          : [];
        await svc.notifyRoles(
          tx,
          a.user.tenantId,
          ['PROCUREMENT'],
          'A supplier answered a clarification',
          `${r?.n ?? ''} ${r?.t ?? ''}: ${c.subject}`,
          `/app/evaluations/${c.evaluationId}`,
        );
        return clarView({ ...c, status: 'ANSWERED', response: body.response, respondedAt: now });
      });
    },
  );

  // ---------------------------------------------------------------- bid pricing, for total cost of ownership (FR-0280, FR-0350)
  async function myPricing(tx: Tx, tenderId: string, supplierId: string) {
    const [sub] = await tx
      .select()
      .from(submission)
      .where(and(eq(submission.tenderId, tenderId), eq(submission.supplierId, supplierId)));
    if (!sub) return { submissionId: null, pricing: null };
    const [pr] = await tx.select().from(bidPricing).where(eq(bidPricing.submissionId, sub.id));
    return {
      submissionId: sub.id,
      pricing: pr
        ? {
            basePrice: Number(pr.basePrice),
            implementation: Number(pr.implementation),
            annualRunning: Number(pr.annualRunning),
            years: pr.years,
            tco: Number(pr.tco),
            updatedAt: pr.updatedAt.toISOString(),
          }
        : null,
    };
  }

  reg('GET', '/supplier/tenders/{id}/pricing');
  app.get(`${p}/supplier/tenders/:id/pricing`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const r = await withContext(d.database, a.ctx, async (tx) => {
      await assertSupplierLive(tx, a);
      const l = await tenders.supplierAccess(tx, a, id);
      return l ? { pricing: (await myPricing(tx, id, a.user.supplierId!)).pricing } : null;
    });
    if (r === null) return tenders.denyAccess(d.database, a, id);
    return r;
  });

  reg('PUT', '/supplier/tenders/{id}/pricing');
  app.put(`${p}/supplier/tenders/:id/pricing`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(pricingBody, req.body);
    const r = await withContext(d.database, a.ctx, async (tx) => {
      await assertSupplierLive(tx, a);
      const l = await tenders.supplierAccess(tx, a, id);
      if (!l) return null;
      if (!(await tenders.canBid(tx, l.tender, a.user.supplierId!)))
        throw new AppError(409, 'BID_CLOSED', 'The closing time has passed, so pricing can no longer change');
      let [sub] = await tx
        .select()
        .from(submission)
        .where(and(eq(submission.tenderId, id), eq(submission.supplierId, a.user.supplierId!)));
      if (!sub)
        [sub] = await tx
          .insert(submission)
          .values({
            tenantId: a.user.tenantId,
            tenderId: id,
            supplierId: a.user.supplierId!,
            status: 'DRAFT',
            createdAt: d.clock.now(),
          })
          .returning();
      const tco = tcoOf(body);
      const values = {
        basePrice: body.basePrice.toFixed(2),
        implementation: body.implementation.toFixed(2),
        annualRunning: body.annualRunning.toFixed(2),
        years: body.years,
        tco: tco.toFixed(2),
        updatedAt: d.clock.now(),
      };
      const [ex] = await tx.select().from(bidPricing).where(eq(bidPricing.submissionId, sub!.id));
      if (ex) await tx.update(bidPricing).set(values).where(eq(bidPricing.id, ex.id));
      else
        await tx.insert(bidPricing).values({ tenantId: a.user.tenantId, submissionId: sub!.id, ...values });
      await d.audit.record(tx, a.ctx, {
        action: 'bid.pricing',
        entityType: 'tender',
        entityId: id,
        // the audit trail is readable by more people than the evaluators: it records that pricing was entered, not the sums
        after: { years: body.years },
      });
      return (await myPricing(tx, id, a.user.supplierId!)).pricing;
    });
    if (r === null) return tenders.denyAccess(d.database, a, id);
    return { pricing: r };
  });

  // ---------------------------------------------------------------- best and final offer rounds (FR-0290)
  const offerView = (o: typeof bafoOffer.$inferSelect) => ({
    id: o.id,
    supplierId: o.supplierId,
    revision: o.revision,
    basePrice: Number(o.basePrice),
    implementation: Number(o.implementation),
    annualRunning: Number(o.annualRunning),
    years: o.years,
    tco: Number(o.tco),
    note: o.note ?? null,
    submittedAt: o.submittedAt.toISOString(),
    accepted: o.accepted,
  });

  /** A round closes at its time without anyone having to press a button. */
  async function closeDueRounds(tx: Tx, evaluationId?: string) {
    const open = await tx.select().from(bafoRound).where(eq(bafoRound.status, 'OPEN'));
    const now = d.clock.now();
    for (const r of open.filter(
      (x) => (!evaluationId || x.evaluationId === evaluationId) && x.closesAt <= now,
    ))
      await tx
        .update(bafoRound)
        .set({ status: 'CLOSED', closedAt: r.closesAt })
        .where(eq(bafoRound.id, r.id));
  }

  reg('POST', '/evaluations/{id}/bafo');
  app.post(`${p}/evaluations/:id/bafo`, { preHandler: mguard(d, ['PROCUREMENT']) }, async (req, reply) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(bafoBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (l.ev.status !== 'CONSENSUS' && l.ev.status !== 'LOCKED')
        throw new AppError(
          409,
          'INVALID_STATE',
          'A best and final offer round runs once the panel has scored, and before the report goes for approval',
        );
      await closeDueRounds(tx, id);
      const rounds = await tx.select().from(bafoRound).where(eq(bafoRound.evaluationId, id));
      if (rounds.some((r) => r.status === 'OPEN'))
        throw new AppError(409, 'ROUND_OPEN', 'Close the open round before starting another');
      const bad = body.supplierIds.filter((s) => !l.bidders.some((b) => b.supplierId === s));
      if (bad.length) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
      const now = d.clock.now();
      const [r] = await tx
        .insert(bafoRound)
        .values({
          tenantId: a.user.tenantId,
          evaluationId: id,
          round: rounds.length + 1,
          note: body.note,
          closesAt: new Date(now.getTime() + body.closesInDays * 86_400_000),
          invited: body.supplierIds,
          createdBy: a.user.id,
          createdAt: now,
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'bafo.open',
        entityType: 'evaluation',
        entityId: id,
        after: { roundId: r!.id, round: r!.round, suppliers: body.supplierIds.length, closesAt: r!.closesAt },
      });
      for (const s of body.supplierIds)
        await noticeToSupplier(tx, a.user.tenantId, s, {
          title: 'Best and final offer requested',
          body: `${l.req.number} ${l.req.title}: ${body.note} Offers close ${r!.closesAt.toISOString().slice(0, 10)}. Your original bid stays on record.`,
          link: `/supplier/tenders/${l.tender.id}`,
          kind: 'BAFO',
          refId: id,
        });
      return { id: r!.id, round: r!.round };
    });
    return reply.status(201).send(out);
  });

  reg('GET', '/evaluations/{id}/bafo');
  app.get(`${p}/evaluations/:id/bafo`, { preHandler: guard(d, [...STAFF_READ]) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      await closeDueRounds(tx, id);
      const rounds = await tx
        .select()
        .from(bafoRound)
        .where(eq(bafoRound.evaluationId, id))
        .orderBy(asc(bafoRound.round));
      const offers = rounds.length
        ? await tx
            .select()
            .from(bafoOffer)
            .where(
              inArray(
                bafoOffer.roundId,
                rounds.map((r) => r.id),
              ),
            )
            .orderBy(asc(bafoOffer.submittedAt))
        : [];
      const extras = await loadExtras(tx, l);
      return {
        rounds: rounds.map((r) => ({
          id: r.id,
          round: r.round,
          status: r.status,
          note: r.note,
          closesAt: r.closesAt.toISOString(),
          invited: (r.invited as string[]).map((s) => ({
            supplierId: s,
            company: l.bidders.find((b) => b.supplierId === s)?.company ?? 'Supplier',
          })),
          // offers stay sealed from the buyer until the round closes, as bids do
          offers:
            r.status === 'CLOSED'
              ? offers
                  .filter((o) => o.roundId === r.id)
                  .map((o) => ({
                    ...offerView(o),
                    company: l.bidders.find((b) => b.supplierId === o.supplierId)?.company ?? 'Supplier',
                  }))
              : [],
          offersReceived: offers.filter((o) => o.roundId === r.id).length,
        })),
        originalTco: l.bidders.map((b) => ({
          supplierId: b.supplierId,
          company: b.company,
          tco: extras.tco.get(b.supplierId) ?? null,
        })),
        canAccept: a.user.roles.includes('PROCUREMENT') && l.ev.status === 'LOCKED',
      };
    });
  });

  reg('POST', '/bafo-rounds/{id}/close');
  app.post(`${p}/bafo-rounds/:id/close`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const [r] = await tx
        .select()
        .from(bafoRound)
        .where(and(eq(bafoRound.id, id), eq(bafoRound.tenantId, a.user.tenantId)));
      if (!r) throw new AppError(404, 'NOT_FOUND', 'Round not found');
      await visible(tx, a, r.evaluationId);
      if (r.status !== 'OPEN') throw new AppError(409, 'INVALID_STATE', 'The round is already closed');
      await tx
        .update(bafoRound)
        .set({ status: 'CLOSED', closedAt: d.clock.now() })
        .where(eq(bafoRound.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'bafo.close',
        entityType: 'evaluation',
        entityId: r.evaluationId,
        after: { roundId: id },
      });
      return { id, status: 'CLOSED' };
    });
  });

  reg('POST', '/bafo-offers/{id}/accept');
  app.post(`${p}/bafo-offers/:id/accept`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const evId = await withContext(d.database, a.ctx, async (tx) => {
      const [o] = await tx
        .select()
        .from(bafoOffer)
        .where(and(eq(bafoOffer.id, id), eq(bafoOffer.tenantId, a.user.tenantId)));
      if (!o) throw new AppError(404, 'NOT_FOUND', 'Offer not found');
      const [r] = await tx.select().from(bafoRound).where(eq(bafoRound.id, o.roundId));
      const l = await visible(tx, a, r!.evaluationId);
      await closeDueRounds(tx, l.ev.id);
      const [round] = await tx.select().from(bafoRound).where(eq(bafoRound.id, o.roundId));
      if (round!.status !== 'CLOSED')
        throw new AppError(409, 'ROUND_OPEN', 'Offers can be accepted once the round has closed');
      if (l.ev.status !== 'LOCKED')
        throw new AppError(
          409,
          'INVALID_STATE',
          'An offer can be accepted after the lock and before the report goes for approval',
        );
      const mine = await tx
        .select()
        .from(bafoOffer)
        .where(and(eq(bafoOffer.roundId, o.roundId), eq(bafoOffer.supplierId, o.supplierId)));
      for (const x of mine.filter((m) => m.accepted && m.id !== id))
        await tx.update(bafoOffer).set({ accepted: false }).where(eq(bafoOffer.id, x.id));
      await tx
        .update(bafoOffer)
        .set({ accepted: true, acceptedBy: a.user.id, acceptedAt: d.clock.now() })
        .where(eq(bafoOffer.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'bafo.accept',
        entityType: 'evaluation',
        entityId: l.ev.id,
        after: { offerId: id, supplierId: o.supplierId, revision: o.revision },
      });
      return l.ev.id;
    });
    await recompile(a, evId);
    return { id, accepted: true };
  });

  reg('GET', '/supplier/bafo');
  app.get(`${p}/supplier/bafo`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      await assertSupplierLive(tx, a);
      await closeDueRounds(tx);
      const rows = await tx
        .select({ r: bafoRound, number: request.number, title: request.title, tenderId: evaluation.tenderId })
        .from(bafoRound)
        .innerJoin(evaluation, eq(evaluation.id, bafoRound.evaluationId))
        .innerJoin(tender, eq(tender.id, evaluation.tenderId))
        .innerJoin(request, eq(request.id, tender.requestId))
        .orderBy(desc(bafoRound.createdAt));
      const mine = rows.filter((x) => (x.r.invited as string[]).includes(a.user.supplierId!));
      const offers = mine.length
        ? await tx
            .select()
            .from(bafoOffer)
            .where(
              and(
                inArray(
                  bafoOffer.roundId,
                  mine.map((x) => x.r.id),
                ),
                eq(bafoOffer.supplierId, a.user.supplierId!),
              ),
            )
            .orderBy(asc(bafoOffer.revision))
        : [];
      return {
        rounds: mine.map((x) => ({
          id: x.r.id,
          tenderId: x.tenderId,
          tenderTitle: `${x.number} ${x.title}`,
          round: x.r.round,
          status: x.r.status,
          note: x.r.note,
          closesAt: x.r.closesAt.toISOString(),
          offers: offers.filter((o) => o.roundId === x.r.id).map(offerView),
        })),
      };
    });
  });

  reg('PUT', '/supplier/bafo/{id}/offer');
  app.put(`${p}/supplier/bafo/:id/offer`, { preHandler: guard(d, ['SUPPLIER']) }, async (req, reply) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(offerBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      await assertSupplierLive(tx, a);
      await closeDueRounds(tx);
      const [r] = await tx
        .select()
        .from(bafoRound)
        .where(and(eq(bafoRound.id, id), eq(bafoRound.tenantId, a.user.tenantId)));
      if (!r || !(r.invited as string[]).includes(a.user.supplierId!))
        throw new AppError(404, 'NOT_FOUND', 'Round not found');
      if (r.status !== 'OPEN')
        throw new AppError(409, 'ROUND_CLOSED', 'This round has closed, so offers can no longer change');
      const prior = await tx
        .select()
        .from(bafoOffer)
        .where(and(eq(bafoOffer.roundId, id), eq(bafoOffer.supplierId, a.user.supplierId!)));
      const now = d.clock.now();
      const [o] = await tx
        .insert(bafoOffer)
        .values({
          tenantId: a.user.tenantId,
          roundId: id,
          supplierId: a.user.supplierId!,
          revision: prior.length + 1,
          basePrice: body.basePrice.toFixed(2),
          implementation: body.implementation.toFixed(2),
          annualRunning: body.annualRunning.toFixed(2),
          years: body.years,
          tco: tcoOf(body).toFixed(2),
          note: body.note ?? null,
          submittedAt: now,
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'bafo.offer',
        entityType: 'evaluation',
        entityId: r.evaluationId,
        after: { roundId: id, revision: o!.revision },
      });
      return offerView(o!);
    });
    return reply.status(201).send(out);
  });

  // ---------------------------------------------------------------- negotiation advisor, simulated (FR-0295)
  reg('GET', '/evaluations/{id}/negotiation-advice');
  app.get(
    `${p}/evaluations/:id/negotiation-advice`,
    { preHandler: guard(d, ['PROCUREMENT', 'DELEGATE', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      const id = eid(req);
      return withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a, id);
        if (!atLeast(l.ev.status, 'LOCKED'))
          throw new AppError(409, 'INVALID_STATE', 'Advice is available once consensus is locked');
        const { ranking } = await view(tx, a, id);
        const devs = await tx.select().from(tenderDeviation).where(eq(tenderDeviation.tenderId, l.tender.id));
        const sups = await tx
          .select()
          .from(supplier)
          .where(
            inArray(
              supplier.id,
              l.bidders.map((b) => b.supplierId),
            ),
          );
        const advice = adviseNegotiation(
          ranking.map((r) => {
            const s = sups.find((x) => x.id === r.supplierId);
            const ins = (s?.insurance ?? null) as { coverAud?: number } | null;
            return {
              supplierId: r.supplierId,
              name: r.displayName,
              rank: r.rank,
              score: r.weightedScore,
              tco: r.tco,
              insuranceStatus: s?.insuranceStatus ?? 'UNKNOWN',
              insuranceCover: ins?.coverAud ?? null,
              deviations: devs
                .filter((x) => x.supplierId === r.supplierId)
                .map((x) => ({
                  clauseRef: x.clauseRef,
                  proposal: x.proposal,
                  risk: x.risk,
                  status: x.status,
                })),
            };
          }),
          l.req.estimatedValue === null ? null : Number(l.req.estimatedValue),
        );
        await d.audit.record(tx, a.ctx, {
          action: 'negotiation.advice',
          entityType: 'evaluation',
          entityId: id,
          after: { recommendations: advice.length },
        });
        return {
          model: 'rules-simulated-v1',
          note: 'Generated by fixed rules from submitted pricing and terms, not by an external model. A person decides what to ask for.',
          advice: advice.map((x) => ({
            ...x,
            supplier: l.bidders.find((b) => b.supplierId === x.supplierId)?.company ?? 'Supplier',
          })),
        };
      });
    },
  );

  registerPanelRoutes(app, p, d, h, reg);
  registerProbityRoutes(app, p, d, h, reg, null);
  registerScoringRoutes(app, p, d, h, reg);
  return done;
}
