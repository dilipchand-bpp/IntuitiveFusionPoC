/**
 * Roadmap batch B8, tender side: interactive response schedules (FR-0130), dual-witness opening of sealed bids (FR-0175)
 * and insurance certificates that are read and checked against the cover a tender requires (FR-0185).
 */
import { flagContent } from '../b11priv/content-safety.js';
import { randomUUID } from 'node:crypto';
import { verify as argon2Verify } from '@node-rs/argon2';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  appUser,
  bidWitness,
  evaluation,
  panelMember,
  responseAnswer,
  responseItem,
  submission,
  supplier,
  tender,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { checkUpload, scanBytes, sha256, type SealedStore } from '../tender/files.js';
import { answersOf, auditDecrypt, sealAnswer } from '../b11enc/bids.js';
import { insuranceStatusFor } from '../tender/insurance.js';
import { TenderService, type LoadedTender, type TenderRow } from '../tender/service.js';
import { loadSettings } from '../settings/settings.js';
import {
  B8_MODEL,
  checkAnswer,
  coverCheck,
  missingAnswers,
  readCertificate,
  type ScheduleItem,
} from './rules.js';

export interface B8Deps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
  store: SealedStore;
  /** Password confirmations per 15 minutes per address at the witness step (default 10). */
  witnessRateLimitMax?: number;
}

const uuid = z.string().uuid();
const KEY = /^[a-z][a-z0-9_]{1,39}$/;
const itemBody = z
  .object({
    key: z.string().regex(KEY, 'Use lower-case letters, digits and underscores, starting with a letter'),
    label: z.string().trim().min(3).max(300),
    section: z.enum(['TECHNICAL', 'COMMERCIAL']),
    kind: z.enum(['TEXT', 'NUMBER', 'CHOICE', 'YESNO', 'DATE']),
    required: z.boolean().default(true),
    options: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    unit: z.string().trim().max(20).nullable().default(null),
    maxLength: z.number().int().min(10).max(10_000).nullable().default(null),
  })
  .strict();
const scheduleBody = z.object({ items: z.array(itemBody).max(60) }).strict();
const requirementsBody = z
  .object({
    requiredCover: z.number().min(0).max(1e11).nullable().optional(),
    dualWitness: z.boolean().optional(),
  })
  .strict();
const witnessBody = z.object({ password: z.string().min(1).max(200) }).strict();
const answersBody = z.object({ answers: z.record(z.string().max(40), z.string().max(10_000)) }).strict();
const certBody = z
  .object({ name: z.string().trim().min(1).max(200), dataBase64: z.string().min(8).max(14_000_000) })
  .strict();

const toItem = (r: typeof responseItem.$inferSelect): ScheduleItem => ({
  key: r.key,
  label: r.label,
  section: r.section,
  kind: r.kind,
  required: r.required,
  options: (r.options as string[]) ?? [],
  unit: r.unit,
  maxLength: r.maxLength,
});
export async function scheduleOf(tx: Tx, tenderId: string): Promise<ScheduleItem[]> {
  const rows = await tx
    .select()
    .from(responseItem)
    .where(eq(responseItem.tenderId, tenderId))
    .orderBy(asc(responseItem.position));
  return rows.map(toItem);
}

/** Bids are shut after close until, for a dual-witness tender, two independent witnesses have opened them. */
export const bidsOpened = (t: Pick<TenderRow, 'dualWitness' | 'openedAt'>) =>
  !t.dualWitness || t.openedAt !== null;

type Held = { coverAud: number | null; expiresOn: string | null; insurer?: string | null } | null;
export const heldCover = (s: { insurance: unknown; insuranceExpiresOn: string | null } | undefined): Held => {
  if (!s?.insurance) return null;
  const i = s.insurance as { coverAud?: number };
  return { coverAud: i.coverAud ?? null, expiresOn: s.insuranceExpiresOn };
};

/**
 * What stops a bid being submitted beyond the existing checks: a required question left unanswered, and cover below what the
 * tender requires. Used by the submit route so the rules live in one place.
 */
export async function submitBlockers(
  tx: Tx,
  t: TenderRow,
  submissionId: string,
  sup: { insurance: unknown; insuranceExpiresOn: string | null } | undefined,
  today: string,
): Promise<
  Array<{
    code: 'RESPONSE_INCOMPLETE' | 'INSURANCE_BELOW_REQUIRED';
    message: string;
    errors: Array<{ field: string; message: string }>;
  }>
> {
  const out: Array<{
    code: 'RESPONSE_INCOMPLETE' | 'INSURANCE_BELOW_REQUIRED';
    message: string;
    errors: Array<{ field: string; message: string }>;
  }> = [];
  const items = await scheduleOf(tx, t.id);
  if (items.length) {
    const rows = await tx.select().from(responseAnswer).where(eq(responseAnswer.submissionId, submissionId));
    const plain = await answersOf(tx, t.tenantId, rows);
    const miss = missingAnswers(
      items,
      Object.fromEntries(rows.map((r) => [r.itemKey, plain.get(`${r.submissionId}|${r.itemKey}`) ?? ''])),
    );
    if (miss.length)
      out.push({
        code: 'RESPONSE_INCOMPLETE',
        message: `${miss.length} required question${miss.length === 1 ? '' : 's'} in the response schedule ${miss.length === 1 ? 'has' : 'have'} no answer`,
        errors: miss.map((m) => ({ field: m.key, message: `Answer: ${m.label}` })),
      });
  }
  const required = t.requiredCover === null ? null : Number(t.requiredCover);
  const c = coverCheck(required, heldCover(sup), today);
  if (!c.ok)
    out.push({
      code: 'INSURANCE_BELOW_REQUIRED',
      message: c.reason ?? 'Your insurance does not meet this tender',
      errors: [{ field: 'insurance', message: c.reason ?? 'Update your insurance certificate' }],
    });
  return out;
}

export function registerTenderB8(app: FastifyInstance, p: string, d: B8Deps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const svc = new TenderService(d.clock, d.audit, d.store);
  const now = () => d.clock.now();
  const tid = (req: { params: unknown }) => parse(z.object({ id: uuid }), req.params).id;
  const load = async (tx: Tx, a: AuthContext, id: string): Promise<LoadedTender> => {
    const l = await svc.load(tx, a.user.tenantId, id);
    if (!l) throw new AppError(404, 'NOT_FOUND', 'Tender not found');
    return l;
  };
  const READERS = ['PROCUREMENT', 'LEGAL', 'DELEGATE', 'EXEC', 'PROBITY', 'EVALUATOR', 'CHAIR'] as const;

  // ---------------------------------------------------------------- response schedule (FR-0130)
  reg('GET', '/tenders/{id}/response-schedule');
  app.get(`${p}/tenders/:id/response-schedule`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const id = tid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await load(tx, a, id);
      return {
        tenderId: id,
        editable: svc.status(l.tender) === 'STAGED',
        items: await scheduleOf(tx, id),
        requiredCover: l.tender.requiredCover === null ? null : Number(l.tender.requiredCover),
        dualWitness: l.tender.dualWitness,
      };
    });
  });

  reg('PUT', '/tenders/{id}/response-schedule');
  app.put(`${p}/tenders/:id/response-schedule`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const id = tid(req);
    const body = parse(scheduleBody, req.body);
    const keys = body.items.map((i) => i.key);
    if (new Set(keys).size !== keys.length)
      throw new AppError(422, 'VALIDATION_FAILED', 'Each question needs its own key', [
        { field: 'items', message: 'Two questions share a key' },
      ]);
    for (const [n, i] of body.items.entries())
      if (i.kind === 'CHOICE' && i.options.length < 2)
        throw new AppError(422, 'VALIDATION_FAILED', 'A choice question needs at least two options', [
          { field: `items.${n}.options`, message: 'Add at least two options' },
        ]);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await load(tx, a, id);
      if (svc.status(l.tender) !== 'STAGED')
        throw new AppError(
          409,
          'INVALID_STATE',
          'The response schedule can only change before the tender is published',
        );
      const before = await scheduleOf(tx, id);
      await tx.delete(responseItem).where(eq(responseItem.tenderId, id));
      for (const [position, i] of body.items.entries())
        await tx.insert(responseItem).values({
          tenantId: a.user.tenantId,
          tenderId: id,
          key: i.key,
          label: i.label,
          section: i.section,
          kind: i.kind,
          required: i.required,
          options: i.options,
          unit: i.unit,
          maxLength: i.maxLength,
          position,
        });
      await d.audit.record(tx, a.ctx, {
        action: 'tender.response_schedule',
        entityType: 'tender',
        entityId: id,
        before: { questions: before.length },
        after: { questions: body.items.length, required: body.items.filter((i) => i.required).length },
      });
      return { tenderId: id, editable: true, items: await scheduleOf(tx, id) };
    });
  });

  reg('PUT', '/tenders/{id}/requirements');
  app.put(`${p}/tenders/:id/requirements`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const id = tid(req);
    const body = parse(requirementsBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await load(tx, a, id);
      if (svc.status(l.tender) !== 'STAGED')
        throw new AppError(
          409,
          'INVALID_STATE',
          'Requirements can only change before the tender is published',
        );
      const set: Partial<typeof tender.$inferInsert> = {};
      if (body.requiredCover !== undefined)
        set.requiredCover = body.requiredCover === null ? null : String(body.requiredCover);
      if (body.dualWitness !== undefined) set.dualWitness = body.dualWitness;
      await tx.update(tender).set(set).where(eq(tender.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'tender.requirements',
        entityType: 'tender',
        entityId: id,
        before: { requiredCover: l.tender.requiredCover, dualWitness: l.tender.dualWitness },
        after: body,
      });
      return {
        requiredCover:
          body.requiredCover === undefined
            ? l.tender.requiredCover === null
              ? null
              : Number(l.tender.requiredCover)
            : body.requiredCover,
        dualWitness: body.dualWitness ?? l.tender.dualWitness,
      };
    });
  });

  /** After close (and opening, for a dual-witness tender): every submitted answer side by side. */
  reg('GET', '/tenders/{id}/response-answers');
  app.get(`${p}/tenders/:id/response-answers`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const id = tid(req);
    await svc.closeDue(d.database);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await load(tx, a, id);
      const st = svc.status(l.tender);
      if (st === 'DRAFT' || st === 'STAGED' || st === 'PUBLISHED')
        throw new AppError(409, 'TENDER_SEALED', 'Answers stay sealed until the tender closes');
      if (!bidsOpened(l.tender))
        throw new AppError(409, 'BIDS_SEALED', 'This tender needs two witnesses to open the bids first');
      let items = await scheduleOf(tx, id);
      // a panel member sees only the stream they assess, as with the files (SEC-AC)
      if (!a.user.roles.some((r) => ['PROCUREMENT', 'LEGAL', 'PROBITY', 'EXEC', 'DELEGATE'].includes(r))) {
        const [pm] = await tx
          .select({ stream: panelMember.stream, coi: panelMember.coiState })
          .from(panelMember)
          .innerJoin(evaluation, eq(evaluation.id, panelMember.evaluationId))
          .where(and(eq(evaluation.tenderId, id), eq(panelMember.userId, a.user.id)));
        if (!pm || pm.coi !== 'DECLARED_NONE')
          throw new AppError(
            403,
            'FORBIDDEN',
            'You have no seat on this evaluation, or have not declared your interests',
          );
        items = items.filter((i) => pm.stream === 'OTHER' || i.section === pm.stream);
      }
      const subs = await tx
        .select({ id: submission.id, supplierId: submission.supplierId, company: supplier.company })
        .from(submission)
        .innerJoin(supplier, eq(supplier.id, submission.supplierId))
        .where(and(eq(submission.tenderId, id), eq(submission.status, 'SUBMITTED')));
      const answers = subs.length
        ? await tx
            .select()
            .from(responseAnswer)
            .where(
              inArray(
                responseAnswer.submissionId,
                subs.map((s) => s.id),
              ),
            )
        : [];
      // answers are stored encrypted; reading them after close is itself audited (SEC-D03)
      const by = await answersOf(tx, a.user.tenantId, answers);
      if (answers.length)
        await auditDecrypt(d.audit, tx, a.ctx, id, { kind: 'ANSWERS', count: answers.length });
      return {
        tenderId: id,
        suppliers: subs.map((s) => ({ supplierId: s.supplierId, company: s.company })),
        rows: items.map((i) => ({
          ...i,
          answers: subs.map((s) => by.get(`${s.id}|${i.key}`) ?? null),
          lowest:
            i.kind === 'NUMBER'
              ? Math.min(...subs.map((s) => Number(by.get(`${s.id}|${i.key}`) ?? Infinity)))
              : null,
        })),
      };
    });
  });

  // ---------------------------------------------------------------- dual-witness opening (FR-0175)
  const WITNESS_ROLES = ['PROBITY', 'LEGAL', 'DELEGATE', 'EXEC', 'PROCUREMENT'] as const;
  reg('GET', '/tenders/{id}/opening');
  app.get(`${p}/tenders/:id/opening`, { preHandler: guard(d, [...WITNESS_ROLES]) }, async (req) => {
    const a = req.auth!;
    const id = tid(req);
    await svc.closeDue(d.database);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await load(tx, a, id);
      const s = await loadSettings(tx, a.user.tenantId);
      const w = await tx
        .select({ name: appUser.name, at: bidWitness.witnessedAt, userId: bidWitness.userId })
        .from(bidWitness)
        .innerJoin(appUser, eq(appUser.id, bidWitness.userId))
        .where(eq(bidWitness.tenderId, id))
        .orderBy(asc(bidWitness.witnessedAt));
      const cutoff = now().getTime() - s.tenderRules.witnessWindowMinutes * 60_000;
      const live = l.tender.openedAt ? w : w.filter((x) => x.at.getTime() >= cutoff);
      const st = svc.status(l.tender);
      return {
        tenderId: id,
        required: l.tender.dualWitness,
        witnessesNeeded: 2,
        opened: bidsOpened(l.tender),
        openedAt: l.tender.openedAt?.toISOString() ?? null,
        windowMinutes: s.tenderRules.witnessWindowMinutes,
        witnesses: live.map((x) => ({ name: x.name, at: x.at.toISOString() })),
        expiresAt:
          !l.tender.openedAt && live[0]
            ? new Date(live[0].at.getTime() + s.tenderRules.witnessWindowMinutes * 60_000).toISOString()
            : null,
        closed: st !== 'DRAFT' && st !== 'STAGED' && st !== 'PUBLISHED',
        youHaveWitnessed: live.some((x) => x.userId === a.user.id),
      };
    });
  });

  reg('POST', '/tenders/{id}/opening/witness');
  app.post(
    `${p}/tenders/:id/opening/witness`,
    {
      preHandler: guard(d, [...WITNESS_ROLES]),
      config: { rateLimit: { max: d.witnessRateLimitMax ?? 10, timeWindow: '15 minutes' } },
    },
    async (req) => {
      const a = req.auth!;
      const id = tid(req);
      const body = parse(witnessBody, req.body);
      await svc.closeDue(d.database);
      // a witness proves who they are again at this moment; the session alone is not enough
      const ok = await withContext(d.database, a.ctx, async (tx) => {
        const [u] = await tx
          .select({ h: appUser.passwordHash })
          .from(appUser)
          .where(eq(appUser.id, a.user.id));
        return Boolean(u?.h) && (await argon2Verify(u!.h!, body.password).catch(() => false));
      });
      if (!ok) {
        await d.audit.recordOutsideTx(d.database, a.ctx, {
          action: 'tender.witness',
          entityType: 'tender',
          entityId: id,
          result: 'DENIED',
          after: { reason: 'password not confirmed' },
        });
        throw new AppError(401, 'REAUTH_FAILED', 'Your password was not confirmed. Try again.');
      }
      return withContext(d.database, a.ctx, async (tx) => {
        const l = await load(tx, a, id);
        const st = svc.status(l.tender);
        if (st === 'DRAFT' || st === 'STAGED' || st === 'PUBLISHED')
          throw new AppError(409, 'INVALID_STATE', 'Bids can only be opened after the tender has closed');
        if (!l.tender.dualWitness)
          throw new AppError(409, 'NOT_REQUIRED', 'This tender does not need witnesses to open its bids');
        if (l.tender.openedAt) throw new AppError(409, 'ALREADY_OPENED', 'The bids have already been opened');
        // independence: not on the panel, not the person who raised the request
        if (l.req.requesterId === a.user.id)
          throw new AppError(
            403,
            'NOT_INDEPENDENT',
            'You raised this request, so you cannot witness the opening of its bids',
          );
        const seat = await tx
          .select({ id: panelMember.id })
          .from(panelMember)
          .innerJoin(evaluation, eq(evaluation.id, panelMember.evaluationId))
          .where(and(eq(evaluation.tenderId, id), eq(panelMember.userId, a.user.id)));
        if (seat.length)
          throw new AppError(
            403,
            'NOT_INDEPENDENT',
            'You sit on the evaluation panel, so you cannot witness the opening of its bids',
          );
        const s = await loadSettings(tx, a.user.tenantId);
        const at = now();
        // a first witness whose window has run out no longer counts
        await tx
          .delete(bidWitness)
          .where(
            and(
              eq(bidWitness.tenderId, id),
              lt(
                bidWitness.witnessedAt,
                new Date(at.getTime() - s.tenderRules.witnessWindowMinutes * 60_000),
              ),
            ),
          );
        const have = await tx.select().from(bidWitness).where(eq(bidWitness.tenderId, id));
        if (have.some((x) => x.userId === a.user.id))
          throw new AppError(
            409,
            'ALREADY_WITNESSED',
            'You have already witnessed. A second, different person must do the same.',
          );
        await tx
          .insert(bidWitness)
          .values({ tenantId: a.user.tenantId, tenderId: id, userId: a.user.id, witnessedAt: at });
        await d.audit.record(tx, a.ctx, {
          action: 'tender.witness',
          entityType: 'tender',
          entityId: id,
          after: { witnesses: have.length + 1 },
        });
        const opened = have.length + 1 >= 2;
        if (opened) {
          await tx
            .update(tender)
            .set({ openedAt: at, updatedAt: at, version: l.tender.version + 1 })
            .where(eq(tender.id, id));
          await d.audit.record(tx, a.ctx, {
            action: 'tender.bids_opened',
            entityType: 'tender',
            entityId: id,
            after: { witnessIds: [...have.map((x) => x.userId), a.user.id] },
          });
        }
        return {
          opened,
          witnesses: have.length + 1,
          message: opened
            ? 'Both witnesses have confirmed. The bids are now open.'
            : 'You are the first witness. A second, different person must confirm within the window.',
          windowMinutes: s.tenderRules.witnessWindowMinutes,
        };
      });
    },
  );
  return done;
}

// ------------------------------------------------------------------ supplier side

interface SupplierHelpers {
  asSupplier: <T>(a: AuthContext, id: string, fn: (tx: Tx, l: LoadedTender) => Promise<T>) => Promise<T>;
  svc: TenderService;
  fresh: () => Promise<unknown>;
  tid: (req: { params: unknown }) => string;
  ensureSubmission: (
    tx: Tx,
    tenantId: string,
    tenderId: string,
    supplierId: string,
  ) => Promise<{ id: string; status: string }>;
}

export function registerSupplierB8(
  app: FastifyInstance,
  p: string,
  d: B8Deps,
  h: SupplierHelpers,
): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const today = () => d.clock.now().toISOString().slice(0, 10);

  const cover = async (tx: Tx, supplierId: string, required: number | null) => {
    const [s] = await tx.select().from(supplier).where(eq(supplier.id, supplierId));
    const held = heldCover(s);
    return {
      held,
      check: coverCheck(required, held, today()),
      certificate: (s?.insuranceCertificate as { name?: string } | null) ?? null,
    };
  };

  reg('GET', '/supplier/tenders/{id}/response');
  app.get(`${p}/supplier/tenders/:id/response`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    const id = h.tid(req);
    await h.fresh();
    return h.asSupplier(a, id, async (tx, l) => {
      const items = await scheduleOf(tx, id);
      const [sub] = await tx
        .select()
        .from(submission)
        .where(and(eq(submission.tenderId, id), eq(submission.supplierId, a.user.supplierId!)));
      const rows = sub
        ? await tx.select().from(responseAnswer).where(eq(responseAnswer.submissionId, sub.id))
        : [];
      const plain = await answersOf(tx, a.user.tenantId, rows);
      const answers = Object.fromEntries(
        rows.map((r) => [r.itemKey, plain.get(`${r.submissionId}|${r.itemKey}`) ?? '']),
      );
      const required = l.tender.requiredCover === null ? null : Number(l.tender.requiredCover);
      const c = await cover(tx, a.user.supplierId!, required);
      return {
        tenderId: id,
        items,
        answers,
        missing: missingAnswers(items, answers).map((m) => m.key),
        requiredCover: required,
        cover: {
          coverAud: c.held?.coverAud ?? null,
          expiresOn: c.held?.expiresOn ?? null,
          ok: c.check.ok,
          reason: c.check.reason,
          certificate: c.certificate,
        },
        submitted: sub?.status === 'SUBMITTED',
      };
    });
  });

  reg('PUT', '/supplier/tenders/{id}/response');
  app.put(`${p}/supplier/tenders/:id/response`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    const id = h.tid(req);
    const body = parse(answersBody, req.body);
    await h.fresh();
    return h.asSupplier(a, id, async (tx, l) => {
      if (!(await h.svc.canBid(tx, l.tender, a.user.supplierId ?? null)))
        throw new AppError(409, 'BID_CLOSED', 'This tender is no longer open for bids');
      const items = await scheduleOf(tx, id);
      const by = new Map(items.map((i) => [i.key, i]));
      const errors: Array<{ field: string; message: string }> = [];
      const clean: Array<[string, string]> = [];
      for (const [k, raw] of Object.entries(body.answers)) {
        const item = by.get(k);
        if (!item) {
          errors.push({ field: k, message: 'There is no such question' });
          continue;
        }
        if (raw.trim() === '') continue; // a cleared answer is removed below
        const r = checkAnswer(item, raw);
        if (r.ok) clean.push([k, r.value]);
        else errors.push({ field: k, message: r.message });
      }
      if (errors.length) throw new AppError(422, 'VALIDATION_FAILED', 'Some answers need correcting', errors);
      const sub = await h.ensureSubmission(tx, a.user.tenantId, id, a.user.supplierId!);
      if (sub.status === 'SUBMITTED')
        throw new AppError(
          409,
          'ALREADY_SUBMITTED',
          'You have already submitted. Withdraw the bid to change your answers.',
        );
      // SEC-AP08: a supplier's answer is data; instruction-like wording is flagged for reviewers and changes nothing
      for (const [, v] of clean)
        await flagContent(tx, a.user.tenantId, {
          source: 'RESPONSE_ANSWER',
          entityType: 'submission',
          entityId: sub.id,
          text: v,
          actorId: a.user.id,
        });
      const cleared = Object.entries(body.answers)
        .filter(([, v]) => v.trim() === '')
        .map(([k]) => k);
      for (const [k, v] of clean) {
        // encrypted before it is written: the column never holds the answer itself (SEC-D03, SEC-D04)
        const sealed = await sealAnswer(tx, a.user.tenantId, sub.id, k, v, d.clock.now());
        await tx
          .insert(responseAnswer)
          .values({
            tenantId: a.user.tenantId,
            submissionId: sub.id,
            itemKey: k,
            value: sealed,
            updatedAt: d.clock.now(),
          })
          .onConflictDoUpdate({
            target: [responseAnswer.submissionId, responseAnswer.itemKey],
            set: { value: sealed, updatedAt: d.clock.now() },
          });
      }
      for (const k of cleared)
        await tx
          .delete(responseAnswer)
          .where(and(eq(responseAnswer.submissionId, sub.id), eq(responseAnswer.itemKey, k)));
      await d.audit.record(tx, a.ctx, {
        action: 'submission.response_saved',
        entityType: 'submission',
        entityId: sub.id,
        after: { answered: clean.length, cleared: cleared.length },
      });
      const rows = await tx.select().from(responseAnswer).where(eq(responseAnswer.submissionId, sub.id));
      const plain = await answersOf(tx, a.user.tenantId, rows);
      const answers = Object.fromEntries(
        rows.map((r) => [r.itemKey, plain.get(`${r.submissionId}|${r.itemKey}`) ?? '']),
      );
      return { saved: clean.length, answers, missing: missingAnswers(items, answers).map((m) => m.key) };
    });
  });

  // ---------------------------------------------------------------- insurance certificate (FR-0185)
  reg('PUT', '/supplier/profile/insurance-certificate');
  app.put(
    `${p}/supplier/profile/insurance-certificate`,
    { preHandler: guard(d, ['SUPPLIER']), bodyLimit: 15 * 1024 * 1024 },
    async (req) => {
      const a = req.auth!;
      const body = parse(certBody, req.body);
      const bytes = Buffer.from(body.dataBase64, 'base64');
      const chk = checkUpload(body.name, bytes);
      if (!chk.ok) throw new AppError(422, 'UPLOAD_REJECTED', chk.message);
      if (scanBytes(bytes) === 'INFECTED')
        throw new AppError(422, 'UPLOAD_REJECTED', 'This file was rejected by the virus scan');
      const read = readCertificate(bytes);
      return withContext(d.database, a.ctx, async (tx) => {
        const [s] = await tx.select().from(supplier).where(eq(supplier.id, a.user.supplierId!));
        if (!s) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
        const key = `${a.user.tenantId}/insurance/${s.id}/${randomUUID()}`;
        await d.store.put(key, bytes, { tx });
        const file = {
          name: body.name,
          sha256: sha256(bytes),
          storageKey: key,
          uploadedAt: d.clock.now().toISOString(),
          reading: { ...read, model: B8_MODEL },
        };
        const set: Partial<typeof supplier.$inferInsert> = {
          insuranceCertificate: file,
          lastCheckedAt: d.clock.now(),
        };
        if (read.readable) {
          set.insurance = {
            insurer: read.insurer ?? '',
            policyNumber: read.policyNumber ?? '',
            coverAud: read.coverAud,
            expiresOn: read.expiresOn,
            source: 'CERTIFICATE',
          };
          set.insuranceExpiresOn = read.expiresOn;
          set.insuranceStatus = insuranceStatusFor(read.expiresOn, today());
        }
        await tx.update(supplier).set(set).where(eq(supplier.id, s.id));
        await d.audit.record(tx, a.ctx, {
          action: 'supplier.insurance_certificate',
          entityType: 'supplier',
          entityId: s.id,
          after: {
            name: body.name,
            sha256: file.sha256,
            readable: read.readable,
            coverAud: read.coverAud,
            expiresOn: read.expiresOn,
          },
        });
        return {
          readable: read.readable,
          applied: read.readable,
          reading: {
            insurer: read.insurer,
            policyNumber: read.policyNumber,
            coverAud: read.coverAud,
            expiresOn: read.expiresOn,
            confidence: read.confidence,
            notes: read.notes,
          },
          message: read.readable
            ? 'Your certificate was read and your cover has been updated.'
            : 'We could not read the limit and expiry from this file. Enter them by hand under your insurance details; they will be marked as not verified.',
          model: B8_MODEL,
        };
      });
    },
  );
  return done;
}
