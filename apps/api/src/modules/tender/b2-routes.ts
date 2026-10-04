/**
 * Tender and supplier portal, roadmap batch B2:
 *  - late-submission permission (FR-0205);
 *  - multi-stage tendering: shortlist, a separate pack and round per stage, notices to the unsuccessful, and the latest
 *    submission standing while earlier material the supplier did not replace is carried forward (FR-0220, FR-0225, FR-0230);
 *  - the legal deviation register of supplier-proposed contract changes, exportable to Word and Excel (FR-0125);
 *  - public notices for public-sector tenders (FR-0140);
 *  - sanctions review (FR-0180);
 *  - the supplier's own profile, privacy choices, insurance and contacts (FR-0240, FR-0245, FR-0250).
 * Every change is audited. Bid content stays sealed exactly as before: nothing here reads a supplier's files.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash as argon2Hash } from '@node-rs/argon2';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  appUser,
  evaluation,
  fieldValue,
  fileObject,
  invitation,
  latePermission,
  notification,
  outboundEmail,
  publicNotice,
  request,
  roleAssignment,
  submission,
  supplier,
  supplierActivation,
  tender,
  tenderDeviation,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { renderDocx } from '../../documents/docx.js';
import type { PdfBlock } from '../../documents/pdf.js';
import { buildXlsx } from '../../documents/xlsx.js';
import { dispatch, usersWithRole } from '../notify/dispatch.js';
import { sendEmail } from '../notify/email.js';
import { loadSettings } from '../settings/settings.js';
import { insuranceStatusFor } from './insurance.js';
import { hashToken } from './routes.js';
import { TenderService } from './service.js';
import type { SupplierDeps } from './supplier-routes.js';

const uuid = z.string().uuid();
const STAFF_TENDER = ['PROCUREMENT', 'LEGAL', 'DELEGATE', 'EXEC', 'PROBITY'] as const;
const DAY = 86_400_000;

const lateBody = z
  .object({
    supplierId: uuid,
    reason: z.string().trim().min(10).max(1000),
    hours: z.number().int().min(1).max(72).default(24),
  })
  .strict();
const shortlistBody = z
  .object({
    supplierIds: z.array(uuid).min(1).max(20),
    type: z.enum(['RFT', 'RFP', 'RFQ', 'RFI', 'EOI']).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
const deviationBody = z
  .object({
    clauseRef: z.string().trim().min(1).max(80),
    proposal: z.string().trim().min(5).max(3000),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict();
const legalBody = z
  .object({
    risk: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    comment: z.string().trim().max(3000).optional(),
    status: z.enum(['PROPOSED', 'ACCEPTABLE', 'NEGOTIATE', 'REJECTED']).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change' });
const reviewBody = z
  .object({ decision: z.enum(['RELEASE', 'CONFIRM']), note: z.string().trim().min(5).max(1000) })
  .strict();
const privacyBody = z.object({ shareProfile: z.boolean(), productUpdates: z.boolean() }).strict();
const insuranceBody = z
  .object({
    insurer: z.string().trim().min(2).max(120),
    policyNumber: z.string().trim().min(3).max(60),
    coverAud: z.number().min(0).max(1e10),
    expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
const contactBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(200),
  })
  .strict();

const iso = (d: Date) => d.toISOString().slice(0, 10);
const section = (s: string | null | undefined) => s ?? '';

export function registerTenderB2(app: FastifyInstance, p: string, d: SupplierDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const svc = new TenderService(d.clock, d.audit, d.store);
  const tid = (req: { params: unknown }) => parse(z.object({ id: uuid }), req.params).id;

  async function visible(tx: Tx, tenantId: string, id: string) {
    const l = await svc.load(tx, tenantId, id);
    if (!l) throw new AppError(404, 'NOT_FOUND', 'Tender not found');
    return l;
  }
  const contactsOf = async (tx: Tx, supplierId: string) =>
    tx
      .select()
      .from(appUser)
      .where(and(eq(appUser.supplierId, supplierId), eq(appUser.active, true)));

  // ---------------------------------------------------------------- late-submission permission (FR-0205)
  reg('POST', '/tenders/{id}/late-permissions');
  app.post(
    `${p}/tenders/:id/late-permissions`,
    { preHandler: guard(d, ['PROCUREMENT']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = tid(req);
      const body = parse(lateBody, req.body);
      await svc.closeDue(d.database);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a.user.tenantId, id);
        if (svc.status(l.tender) !== 'CLOSED')
          throw new AppError(
            409,
            'INVALID_STATE',
            'A late submission can be permitted only after the tender has closed and before evaluation has begun',
          );
        const [s] = await tx
          .select()
          .from(supplier)
          .where(and(eq(supplier.id, body.supplierId), eq(supplier.tenantId, a.user.tenantId)));
        if (!s) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
        if (s.sanctionsStatus === 'MATCH')
          throw new AppError(
            409,
            'SUPPLIER_QUARANTINED',
            'This supplier is on hold and cannot be given extra time',
          );
        const invited = await tx
          .select({ id: invitation.id })
          .from(invitation)
          .where(and(eq(invitation.tenderId, id), eq(invitation.supplierId, body.supplierId)));
        if (invited.length === 0 && l.tender.access !== 'OPEN')
          throw new AppError(422, 'VALIDATION_FAILED', 'That supplier was not invited to this tender', [
            { field: 'supplierId', message: 'Choose a supplier that was invited' },
          ]);
        const [already] = await tx
          .select({ id: submission.id })
          .from(submission)
          .where(
            and(
              eq(submission.tenderId, id),
              eq(submission.supplierId, body.supplierId),
              eq(submission.status, 'SUBMITTED'),
            ),
          );
        if (already) throw new AppError(409, 'ALREADY_SUBMITTED', 'This supplier has already submitted');
        const now = d.clock.now();
        const expiresAt = new Date(now.getTime() + body.hours * 3_600_000);
        const [row] = await tx
          .insert(latePermission)
          .values({
            tenantId: a.user.tenantId,
            tenderId: id,
            supplierId: body.supplierId,
            reason: body.reason,
            expiresAt,
            grantedBy: a.user.id,
            createdAt: now,
          })
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: 'late_permission.grant',
          entityType: 'tender',
          entityId: id,
          after: { supplierId: body.supplierId, reason: body.reason, expiresAt: expiresAt.toISOString() },
        });
        const settings = await loadSettings(tx, a.user.tenantId);
        for (const u of await contactsOf(tx, body.supplierId)) {
          await dispatch(
            tx,
            {
              tenantId: a.user.tenantId,
              recipients: [u.id],
              title: 'You may submit after the closing time',
              body: `${l.req.number} ${l.req.title}: you have until ${expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
              link: `/supplier/tenders/${id}`,
            },
            settings,
          );
          await sendEmail(tx, {
            tenantId: a.user.tenantId,
            to: u.email,
            kind: 'LATE_PERMISSION',
            subject: 'Extra time to submit',
            body: `Hello ${u.name}, the buyer has given you until ${expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC to submit your response to ${l.req.title}.`,
            refType: 'tender',
            refId: id,
          });
        }
        return {
          id: row!.id,
          supplierId: body.supplierId,
          reason: body.reason,
          expiresAt: expiresAt.toISOString(),
        };
      });
      return reply.status(201).send(out);
    },
  );

  reg('GET', '/tenders/{id}/late-permissions');
  app.get(
    `${p}/tenders/:id/late-permissions`,
    { preHandler: guard(d, ['PROCUREMENT', 'DELEGATE', 'LEGAL', 'PROBITY', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      const id = tid(req);
      return withContext(d.database, a.ctx, async (tx) => {
        await visible(tx, a.user.tenantId, id);
        const rows = await tx
          .select({ lp: latePermission, company: supplier.company })
          .from(latePermission)
          .innerJoin(supplier, eq(supplier.id, latePermission.supplierId))
          .where(eq(latePermission.tenderId, id))
          .orderBy(desc(latePermission.createdAt));
        const now = d.clock.now();
        return rows.map(({ lp, company }) => ({
          id: lp.id,
          supplierId: lp.supplierId,
          company,
          reason: lp.reason,
          expiresAt: lp.expiresAt.toISOString(),
          active: !lp.revokedAt && lp.expiresAt > now,
          revoked: Boolean(lp.revokedAt),
        }));
      });
    },
  );

  reg('DELETE', '/tenders/{id}/late-permissions/{permissionId}');
  app.delete(
    `${p}/tenders/:id/late-permissions/:permissionId`,
    { preHandler: guard(d, ['PROCUREMENT']) },
    async (req, reply) => {
      const a = req.auth!;
      const { id, permissionId } = parse(z.object({ id: uuid, permissionId: uuid }), req.params);
      await withContext(d.database, a.ctx, async (tx) => {
        await visible(tx, a.user.tenantId, id);
        const gone = await tx
          .update(latePermission)
          .set({ revokedAt: d.clock.now() })
          .where(
            and(
              eq(latePermission.id, permissionId),
              eq(latePermission.tenderId, id),
              isNull(latePermission.revokedAt),
            ),
          )
          .returning({ id: latePermission.id });
        if (gone.length === 0)
          throw new AppError(404, 'NOT_FOUND', 'Permission not found or already withdrawn');
        await d.audit.record(tx, a.ctx, {
          action: 'late_permission.revoke',
          entityType: 'tender',
          entityId: id,
          after: { permissionId },
        });
      });
      return reply.status(204).send();
    },
  );

  // ---------------------------------------------------------------- multi-stage tendering (FR-0220, FR-0225, FR-0230)
  reg('GET', '/tenders/{id}/stages');
  app.get(`${p}/tenders/:id/stages`, { preHandler: guard(d, [...STAFF_TENDER]) }, async (req) => {
    const a = req.auth!;
    const id = tid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a.user.tenantId, id);
      const all = await tx
        .select()
        .from(tender)
        .where(and(eq(tender.requestId, l.tender.requestId), eq(tender.tenantId, a.user.tenantId)))
        .orderBy(asc(tender.stage));
      const out = [];
      for (const t of all) {
        const [ev] = await tx.select().from(evaluation).where(eq(evaluation.tenderId, t.id));
        const submitted = await tx
          .select({ id: submission.id })
          .from(submission)
          .where(and(eq(submission.tenderId, t.id), eq(submission.status, 'SUBMITTED')));
        out.push({
          tenderId: t.id,
          stage: t.stage,
          type: t.type,
          status: svc.status(t),
          submissions: submitted.length,
          evaluationId: ev?.id ?? null,
          evaluationStatus: ev?.status ?? null,
          shortlisted: (t.shortlist as string[] | null) ?? null,
          current: t.id === id,
        });
      }
      return out;
    });
  });

  reg('POST', '/tenders/{id}/shortlist');
  app.post(`${p}/tenders/:id/shortlist`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req, reply) => {
    const a = req.auth!;
    const id = tid(req);
    const body = parse(shortlistBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a.user.tenantId, id);
      const t = l.tender;
      if (t.shortlistedAt)
        throw new AppError(
          409,
          'ALREADY_SHORTLISTED',
          'The shortlist for this stage has already been confirmed',
        );
      const [ev] = await tx.select().from(evaluation).where(eq(evaluation.tenderId, id));
      if (!ev || !['LOCKED', 'REPORTED', 'APPROVED'].includes(ev.status))
        throw new AppError(
          409,
          'EVALUATION_NOT_COMPLETE',
          'The evaluation of this stage must be complete (consensus locked) before suppliers are shortlisted',
        );
      const bids = await tx
        .select()
        .from(submission)
        .where(and(eq(submission.tenderId, id), eq(submission.status, 'SUBMITTED')));
      const bidders = new Set(bids.map((b) => b.supplierId));
      const outsiders = body.supplierIds.filter((s) => !bidders.has(s));
      if (outsiders.length > 0)
        throw new AppError(
          422,
          'VALIDATION_FAILED',
          'Only suppliers who submitted can be shortlisted',
          outsiders.map((s) => ({
            field: 'supplierIds',
            message: `${s} did not submit a bid at this stage`,
          })),
        );
      const now = d.clock.now();
      // a separate pack for the next stage: a copy of this stage's, which can then be changed on its own
      const [next] = await tx
        .insert(tender)
        .values({
          tenantId: a.user.tenantId,
          requestId: t.requestId,
          type: body.type ?? t.type,
          access: 'CLOSED',
          status: 'STAGED',
          stage: t.stage + 1,
          parentTenderId: t.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const fields = await tx
        .select()
        .from(fieldValue)
        .where(and(eq(fieldValue.ownerType, 'TENDER'), eq(fieldValue.ownerId, id)));
      for (const f of fields)
        await tx.insert(fieldValue).values({
          tenantId: f.tenantId,
          ownerType: 'TENDER',
          ownerId: next!.id,
          key: f.key,
          label: f.label,
          value: f.value,
          source: f.source,
          aiDrafted: f.aiDrafted,
          missing: f.missing,
          updatedAt: now,
        });
      await tx
        .update(tender)
        .set({ shortlist: body.supplierIds, shortlistedAt: now, updatedAt: now, version: t.version + 1 })
        .where(eq(tender.id, id));
      const settings = await loadSettings(tx, a.user.tenantId);
      const names = new Map(
        (
          await tx
            .select({ id: supplier.id, company: supplier.company })
            .from(supplier)
            .where(eq(supplier.tenantId, a.user.tenantId))
        ).map((s) => [s.id, s.company]),
      );
      let shortlistedCount = 0;
      let unsuccessfulCount = 0;
      for (const sid of body.supplierIds) {
        const contacts = await contactsOf(tx, sid);
        // access to the next stage is by invitation naming the supplier, already accepted: no second registration
        await tx.insert(invitation).values({
          tenantId: a.user.tenantId,
          tenderId: next!.id,
          email: contacts[0]?.email ?? `${sid}@unknown.invalid`,
          company: names.get(sid) ?? 'Supplier',
          tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
          expiresAt: new Date(now.getTime() + 60 * DAY),
          usedAt: now,
          supplierId: sid,
        });
        for (const u of contacts) {
          await dispatch(
            tx,
            {
              tenantId: a.user.tenantId,
              recipients: [u.id],
              title: 'You are shortlisted',
              body: `${l.req.number} ${l.req.title}: you are invited to stage ${next!.stage}. The pack will be released when it is published.`,
              link: '/supplier',
            },
            settings,
          );
          await sendEmail(tx, {
            tenantId: a.user.tenantId,
            to: u.email,
            kind: 'SHORTLISTED',
            subject: 'You have been shortlisted',
            body: `Hello ${u.name}, ${names.get(sid)} has been shortlisted for stage ${next!.stage} of ${l.req.title}. You will be told when the next pack is released.`,
            refType: 'tender',
            refId: next!.id,
          });
        }
        shortlistedCount += 1;
      }
      // everyone else who bid at this stage is told, once the buyer confirms the outcome (FR-0225)
      for (const sid of [...bidders].filter((s) => !body.supplierIds.includes(s))) {
        for (const u of await contactsOf(tx, sid)) {
          await dispatch(
            tx,
            {
              tenantId: a.user.tenantId,
              recipients: [u.id],
              title: 'Outcome of your response',
              body: `${l.req.number} ${l.req.title}: you were not shortlisted. Thank you for responding.`,
              link: '/supplier',
            },
            settings,
          );
          await sendEmail(tx, {
            tenantId: a.user.tenantId,
            to: u.email,
            kind: 'UNSUCCESSFUL',
            subject: 'Outcome of your response',
            body: `Hello ${u.name}, thank you for responding to ${l.req.title}. On this occasion ${names.get(sid)} has not been shortlisted.${body.note ? ` ${body.note}` : ''}`,
            refType: 'tender',
            refId: id,
          });
        }
        unsuccessfulCount += 1;
      }
      await d.audit.record(tx, a.ctx, {
        action: 'tender.shortlist',
        entityType: 'tender',
        entityId: id,
        after: {
          stage: t.stage,
          nextTenderId: next!.id,
          nextStage: next!.stage,
          shortlisted: shortlistedCount,
          unsuccessful: unsuccessfulCount,
        },
      });
      return {
        nextTenderId: next!.id,
        nextStage: next!.stage,
        shortlisted: shortlistedCount,
        unsuccessfulNotified: unsuccessfulCount,
      };
    });
    return reply.status(201).send(out);
  });

  // ---------------------------------------------------------------- deviation register (FR-0125)
  reg('POST', '/supplier/tenders/{id}/deviations');
  app.post(
    `${p}/supplier/tenders/:id/deviations`,
    { preHandler: guard(d, ['SUPPLIER']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = tid(req);
      const body = parse(deviationBody, req.body);
      await svc.closeDue(d.database);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const l = await svc.supplierAccess(tx, a, id);
        if (!l) throw new AppError(404, 'NOT_FOUND', 'Tender not found');
        if (!(await svc.canBid(tx, l.tender, a.user.supplierId ?? null)))
          throw new AppError(409, 'BID_CLOSED', 'The tender is closed');
        const mine = await tx
          .select({ id: tenderDeviation.id })
          .from(tenderDeviation)
          .where(and(eq(tenderDeviation.tenderId, id), eq(tenderDeviation.supplierId, a.user.supplierId!)));
        if (mine.length >= 30)
          throw new AppError(429, 'DEVIATION_LIMIT', 'At most 30 proposed changes per tender');
        const [row] = await tx
          .insert(tenderDeviation)
          .values({
            tenantId: a.user.tenantId,
            tenderId: id,
            supplierId: a.user.supplierId!,
            clauseRef: body.clauseRef,
            proposal: body.proposal,
            reason: body.reason ?? null,
            createdAt: d.clock.now(),
          })
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: 'deviation.propose',
          entityType: 'tender',
          entityId: id,
          after: { deviationId: row!.id, clauseRef: body.clauseRef },
        });
        return {
          id: row!.id,
          clauseRef: row!.clauseRef,
          proposal: row!.proposal,
          reason: row!.reason ?? undefined,
          status: row!.status,
        };
      });
      return reply.status(201).send(out);
    },
  );

  reg('GET', '/supplier/tenders/{id}/deviations');
  app.get(`${p}/supplier/tenders/:id/deviations`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    const id = tid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await svc.supplierAccess(tx, a, id);
      if (!l) throw new AppError(404, 'NOT_FOUND', 'Tender not found');
      const rows = await tx
        .select()
        .from(tenderDeviation)
        .where(and(eq(tenderDeviation.tenderId, id), eq(tenderDeviation.supplierId, a.user.supplierId!)))
        .orderBy(asc(tenderDeviation.createdAt));
      // the supplier sees what they proposed, not legal's risk rating or commentary
      return rows.map((r) => ({
        id: r.id,
        clauseRef: r.clauseRef,
        proposal: r.proposal,
        reason: r.reason ?? undefined,
      }));
    });
  });

  reg('DELETE', '/supplier/tenders/{id}/deviations/{deviationId}');
  app.delete(
    `${p}/supplier/tenders/:id/deviations/:deviationId`,
    { preHandler: guard(d, ['SUPPLIER']) },
    async (req, reply) => {
      const a = req.auth!;
      const { id, deviationId } = parse(z.object({ id: uuid, deviationId: uuid }), req.params);
      await svc.closeDue(d.database);
      await withContext(d.database, a.ctx, async (tx) => {
        const l = await svc.supplierAccess(tx, a, id);
        if (!l) throw new AppError(404, 'NOT_FOUND', 'Tender not found');
        if (!(await svc.canBid(tx, l.tender, a.user.supplierId ?? null)))
          throw new AppError(409, 'BID_CLOSED', 'The tender is closed');
        const gone = await tx
          .delete(tenderDeviation)
          .where(
            and(
              eq(tenderDeviation.id, deviationId),
              eq(tenderDeviation.tenderId, id),
              eq(tenderDeviation.supplierId, a.user.supplierId!),
            ),
          )
          .returning({ id: tenderDeviation.id });
        if (gone.length === 0) throw new AppError(404, 'NOT_FOUND', 'Proposed change not found');
        await d.audit.record(tx, a.ctx, {
          action: 'deviation.withdraw',
          entityType: 'tender',
          entityId: id,
          after: { deviationId },
        });
      });
      return reply.status(204).send();
    },
  );

  async function register(tx: Tx, tenantId: string, id: string) {
    const rows = await tx
      .select({ dv: tenderDeviation, company: supplier.company })
      .from(tenderDeviation)
      .innerJoin(supplier, eq(supplier.id, tenderDeviation.supplierId))
      .where(and(eq(tenderDeviation.tenderId, id), eq(tenderDeviation.tenantId, tenantId)))
      .orderBy(asc(supplier.company), asc(tenderDeviation.createdAt));
    return rows.map(({ dv, company }) => ({
      id: dv.id,
      supplierId: dv.supplierId,
      company,
      clauseRef: dv.clauseRef,
      proposal: dv.proposal,
      reason: dv.reason ?? undefined,
      risk: dv.risk ?? undefined,
      legalComment: dv.legalComment ?? undefined,
      status: dv.status,
    }));
  }

  reg('GET', '/tenders/{id}/deviations');
  app.get(`${p}/tenders/:id/deviations`, { preHandler: guard(d, ['LEGAL', 'PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const id = tid(req);
    await svc.closeDue(d.database);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a.user.tenantId, id);
      const st = svc.status(l.tender);
      // the register is sealed with the bids: nothing until the tender has closed
      if (st === 'DRAFT' || st === 'STAGED' || st === 'PUBLISHED') return { sealed: true, items: [] };
      return { sealed: false, items: await register(tx, a.user.tenantId, id) };
    });
  });

  reg('PUT', '/tender-deviations/{id}');
  app.put(`${p}/tender-deviations/:id`, { preHandler: guard(d, ['LEGAL']) }, async (req) => {
    const a = req.auth!;
    const id = tid(req);
    const body = parse(legalBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [cur] = await tx
        .select()
        .from(tenderDeviation)
        .where(and(eq(tenderDeviation.id, id), eq(tenderDeviation.tenantId, a.user.tenantId)));
      if (!cur) throw new AppError(404, 'NOT_FOUND', 'Proposed change not found');
      const l = await visible(tx, a.user.tenantId, cur.tenderId);
      if (['DRAFT', 'STAGED', 'PUBLISHED'].includes(svc.status(l.tender)))
        throw new AppError(409, 'INVALID_STATE', 'The register opens when the tender closes');
      await tx
        .update(tenderDeviation)
        .set({
          ...(body.risk ? { risk: body.risk } : {}),
          ...(body.comment !== undefined ? { legalComment: body.comment } : {}),
          ...(body.status ? { status: body.status } : {}),
          decidedBy: a.user.id,
          decidedAt: d.clock.now(),
        })
        .where(eq(tenderDeviation.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'deviation.assess',
        entityType: 'tender',
        entityId: cur.tenderId,
        before: { risk: cur.risk, status: cur.status, legalComment: cur.legalComment },
        after: {
          risk: body.risk ?? cur.risk,
          status: body.status ?? cur.status,
          legalComment: body.comment ?? cur.legalComment,
        },
      });
      return (await register(tx, a.user.tenantId, cur.tenderId)).find((x) => x.id === id)!;
    });
  });

  for (const format of ['xlsx', 'docx'] as const) {
    reg('GET', `/tenders/{id}/deviations/export.${format}`);
    app.get(
      `${p}/tenders/:id/deviations/export.${format}`,
      { preHandler: guard(d, ['LEGAL', 'PROCUREMENT']) },
      async (req, reply) => {
        const a = req.auth!;
        const id = tid(req);
        await svc.closeDue(d.database);
        const out = await withContext(d.database, a.ctx, async (tx) => {
          const l = await visible(tx, a.user.tenantId, id);
          if (['DRAFT', 'STAGED', 'PUBLISHED'].includes(svc.status(l.tender)))
            throw new AppError(409, 'INVALID_STATE', 'The register opens when the tender closes');
          const items = await register(tx, a.user.tenantId, id);
          await d.audit.record(tx, a.ctx, {
            action: 'deviation.export',
            entityType: 'tender',
            entityId: id,
            after: { format: format.toUpperCase(), rows: items.length },
          });
          return { items, title: l.req.title, number: l.req.number };
        });
        const when = d.clock.now();
        let bytes: Buffer;
        if (format === 'xlsx') {
          bytes = buildXlsx('Deviations', [
            [
              'Supplier',
              'Clause',
              'Proposed change',
              'Supplier reason',
              'Risk rating',
              'Legal commentary',
              'Status',
            ],
            ...out.items.map((i) => [
              i.company,
              i.clauseRef,
              i.proposal,
              section(i.reason),
              section(i.risk),
              section(i.legalComment),
              i.status,
            ]),
          ]);
        } else {
          const blocks: PdfBlock[] = [
            { type: 'title', text: `Deviation register: ${out.title}` },
            {
              type: 'subtitle',
              text: `${out.number} - exported ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
            },
            { type: 'rule' },
          ];
          if (out.items.length === 0) blocks.push({ type: 'p', text: 'No contract changes were proposed.' });
          let last = '';
          for (const i of out.items) {
            if (i.company !== last) blocks.push({ type: 'h2', text: i.company });
            last = i.company;
            blocks.push({ type: 'kv', label: `Clause ${i.clauseRef}`, value: i.status });
            blocks.push({ type: 'p', text: `Proposed: ${i.proposal}` });
            if (i.reason) blocks.push({ type: 'p', text: `Reason: ${i.reason}` });
            blocks.push({
              type: 'p',
              text: `Risk: ${i.risk ?? 'not rated'}. ${i.legalComment ? `Legal: ${i.legalComment}` : 'No legal commentary yet.'}`,
            });
          }
          bytes = renderDocx({
            title: `Deviation register ${out.number}`,
            footer: `Deviation register ${out.number}`,
            created: when,
            blocks,
          });
        }
        return reply
          .header(
            'content-type',
            format === 'xlsx'
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          )
          .header('content-disposition', `attachment; filename="deviations-${out.number}.${format}"`)
          .send(bytes);
      },
    );
  }

  // ---------------------------------------------------------------- public notices (FR-0140)
  reg('GET', '/tenders/{id}/notices');
  app.get(`${p}/tenders/:id/notices`, { preHandler: guard(d, [...STAFF_TENDER]) }, async (req) => {
    const a = req.auth!;
    const id = tid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      await visible(tx, a.user.tenantId, id);
      const rows = await tx
        .select()
        .from(publicNotice)
        .where(eq(publicNotice.tenderId, id))
        .orderBy(asc(publicNotice.createdAt));
      return rows.map((n) => ({
        id: n.id,
        register: n.register,
        reference: n.reference,
        status: n.status,
        createdAt: n.createdAt.toISOString(),
      }));
    });
  });

  // ---------------------------------------------------------------- sanctions review (FR-0180)
  reg('POST', '/suppliers/{id}/sanctions-review');
  app.post(
    `${p}/suppliers/:id/sanctions-review`,
    { preHandler: guard(d, ['PROCUREMENT', 'LEGAL']) },
    async (req) => {
      const a = req.auth!;
      const id = tid(req);
      const body = parse(reviewBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const [s] = await tx
          .select()
          .from(supplier)
          .where(and(eq(supplier.id, id), eq(supplier.tenantId, a.user.tenantId)));
        if (!s) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
        if (s.sanctionsStatus !== 'MATCH')
          throw new AppError(409, 'INVALID_STATE', 'There is no screening match to review');
        const release = body.decision === 'RELEASE';
        await tx
          .update(supplier)
          .set({
            sanctionsStatus: release ? 'CLEAR' : 'MATCH',
            sanctionsNote: `${release ? 'Released' : 'Confirmed'} by review: ${body.note}`,
            lastCheckedAt: d.clock.now(),
          })
          .where(eq(supplier.id, id));
        await d.audit.record(tx, a.ctx, {
          action: release ? 'supplier.sanctions_release' : 'supplier.sanctions_confirm',
          entityType: 'supplier',
          entityId: id,
          before: { sanctionsStatus: 'MATCH' },
          after: { sanctionsStatus: release ? 'CLEAR' : 'MATCH', note: body.note },
        });
        if (release)
          for (const u of await contactsOf(tx, id))
            await sendEmail(tx, {
              tenantId: a.user.tenantId,
              to: u.email,
              kind: 'WELCOME',
              subject: 'Your supplier account is active',
              body: `Hello ${u.name}, the review is complete and your account for ${s.company} is now active.`,
              refType: 'supplier',
              refId: id,
            });
        return { id, sanctionsStatus: release ? 'CLEAR' : 'MATCH' };
      });
    },
  );

  // ---------------------------------------------------------------- the supplier's own profile (FR-0240, FR-0250)
  async function profile(tx: Tx, supplierId: string, today: string) {
    const [s] = await tx.select().from(supplier).where(eq(supplier.id, supplierId));
    if (!s) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
    const people = await tx
      .select()
      .from(appUser)
      .where(eq(appUser.supplierId, supplierId))
      .orderBy(asc(appUser.createdAt));
    return {
      id: s.id,
      company: s.company,
      abn: s.abn,
      sanctionsStatus: s.sanctionsStatus,
      onHold: s.sanctionsStatus === 'MATCH',
      insuranceStatus: insuranceStatusFor(s.insuranceExpiresOn, today),
      insurance: s.insurance ?? null,
      privacy: s.privacy as { shareProfile: boolean; productUpdates: boolean },
      onboarding: s.onboarding as { answers?: Record<string, string>; flagged?: string[] },
      contacts: people.map((u) => ({ id: u.id, name: u.name, email: u.email, active: u.active })),
    };
  }

  reg('GET', '/supplier/profile');
  app.get(`${p}/supplier/profile`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, (tx) => profile(tx, a.user.supplierId!, iso(d.clock.now())));
  });

  reg('PUT', '/supplier/profile/privacy');
  app.put(`${p}/supplier/profile/privacy`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    const body = parse(privacyBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [s] = await tx.select().from(supplier).where(eq(supplier.id, a.user.supplierId!));
      await tx.update(supplier).set({ privacy: body }).where(eq(supplier.id, a.user.supplierId!));
      await d.audit.record(tx, a.ctx, {
        action: 'supplier.privacy_update',
        entityType: 'supplier',
        entityId: a.user.supplierId,
        before: { privacy: s?.privacy },
        after: { privacy: body },
      });
      return profile(tx, a.user.supplierId!, iso(d.clock.now()));
    });
  });

  reg('PUT', '/supplier/profile/insurance');
  app.put(`${p}/supplier/profile/insurance`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    const body = parse(insuranceBody, req.body);
    if (Number.isNaN(Date.parse(body.expiresOn)))
      throw new AppError(400, 'VALIDATION_FAILED', 'Not a date', [
        { field: 'expiresOn', message: 'Enter the end date of the certificate' },
      ]);
    return withContext(d.database, a.ctx, async (tx) => {
      const status = insuranceStatusFor(body.expiresOn, iso(d.clock.now()));
      await tx
        .update(supplier)
        .set({
          insurance: { ...body, recordedAt: d.clock.now().toISOString() },
          insuranceExpiresOn: body.expiresOn,
          insuranceStatus: status,
          lastCheckedAt: d.clock.now(),
        })
        .where(eq(supplier.id, a.user.supplierId!));
      await d.audit.record(tx, a.ctx, {
        action: 'supplier.insurance_update',
        entityType: 'supplier',
        entityId: a.user.supplierId,
        after: { insurer: body.insurer, expiresOn: body.expiresOn, status },
      });
      return profile(tx, a.user.supplierId!, iso(d.clock.now()));
    });
  });

  // ---------------------------------------------------------------- the supplier manages its own contacts (FR-0245)
  reg('POST', '/supplier/contacts');
  app.post(`${p}/supplier/contacts`, { preHandler: guard(d, ['SUPPLIER']) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(contactBody, req.body);
    const token = randomBytes(32).toString('base64url');
    const placeholder = await argon2Hash(randomBytes(32).toString('hex'));
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const [taken] = await tx
        .select({ id: appUser.id })
        .from(appUser)
        .where(and(eq(appUser.tenantId, a.user.tenantId), eq(appUser.email, body.email)));
      if (taken)
        throw new AppError(409, 'EMAIL_IN_USE', 'That email address already has an account', [
          { field: 'email', message: 'Use a different email address' },
        ]);
      const now = d.clock.now();
      const [u] = await tx
        .insert(appUser)
        .values({
          tenantId: a.user.tenantId,
          email: body.email,
          name: body.name,
          passwordHash: placeholder,
          supplierId: a.user.supplierId!,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await tx.insert(roleAssignment).values({ tenantId: a.user.tenantId, userId: u!.id, role: 'SUPPLIER' });
      const expiresAt = new Date(now.getTime() + 7 * DAY);
      await tx.insert(supplierActivation).values({
        tenantId: a.user.tenantId,
        userId: u!.id,
        tokenHash: hashToken(token),
        expiresAt,
        createdBy: a.user.id,
      });
      await d.audit.record(tx, a.ctx, {
        action: 'supplier.contact_add',
        entityType: 'supplier',
        entityId: a.user.supplierId,
        after: { userId: u!.id, email: body.email, by: 'SUPPLIER' },
      });
      // the colleague is told (the one-time link is shown to the person who added them, never written into the message)
      await sendEmail(tx, {
        tenantId: a.user.tenantId,
        to: body.email,
        kind: 'CONTACT_ADDED',
        subject: 'You have been added to a supplier portal',
        body: `Hello ${body.name}, ${a.user.name} has added you to the supplier portal. They will pass on your one-time link to set a password.`,
        refType: 'supplier',
        refId: a.user.supplierId!,
      });
      return {
        contact: { id: u!.id, name: u!.name, email: u!.email, active: true },
        activationPath: `/supplier/activate?token=${token}`,
        expiresAt: expiresAt.toISOString(),
      };
    });
    return reply.status(201).send(out);
  });

  reg('POST', '/supplier/contacts/{userId}/deprovision');
  app.post(
    `${p}/supplier/contacts/:userId/deprovision`,
    { preHandler: guard(d, ['SUPPLIER']) },
    async (req) => {
      const a = req.auth!;
      const { userId } = parse(z.object({ userId: uuid }), req.params);
      const body = parse(z.object({ reason: z.string().trim().min(3).max(300) }).strict(), req.body);
      const out = await withContext(d.database, a.ctx, async (tx) => {
        if (userId === a.user.id)
          throw new AppError(409, 'CANNOT_REMOVE_SELF', 'Ask a colleague to remove you, or ask the buyer');
        const [u] = await tx
          .select()
          .from(appUser)
          .where(and(eq(appUser.id, userId), eq(appUser.supplierId, a.user.supplierId!)));
        if (!u) throw new AppError(404, 'NOT_FOUND', 'Contact not found');
        if (!u.active) throw new AppError(409, 'ALREADY_INACTIVE', 'This contact already has no access');
        await tx
          .update(appUser)
          .set({ active: false, updatedAt: d.clock.now() })
          .where(eq(appUser.id, userId));
        await tx
          .update(supplierActivation)
          .set({ usedAt: d.clock.now() })
          .where(and(eq(supplierActivation.userId, userId), isNull(supplierActivation.usedAt)));
        await d.audit.record(tx, a.ctx, {
          action: 'supplier.contact_deprovision',
          entityType: 'supplier',
          entityId: a.user.supplierId,
          before: { userId, email: u.email, active: true },
          after: { active: false, reason: body.reason, by: 'SUPPLIER' },
        });
        await sendEmail(tx, {
          tenantId: a.user.tenantId,
          to: u.email,
          kind: 'CONTACT_REMOVED',
          subject: 'Your access to a supplier portal ended',
          body: `Hello ${u.name}, your access to the supplier portal for your company has been ended by ${a.user.name}.`,
          refType: 'supplier',
          refId: a.user.supplierId!,
        });
        const settings = await loadSettings(tx, a.user.tenantId);
        await dispatch(
          tx,
          {
            tenantId: a.user.tenantId,
            recipients: await usersWithRole(tx, a.user.tenantId, ['PROCUREMENT']),
            title: 'A supplier contact was removed',
            body: `${a.user.name} removed ${u.name} from their company's portal access.`,
            link: `/app/suppliers/${a.user.supplierId}`,
          },
          settings,
        );
        return { id: u.id, name: u.name, active: false };
      });
      await d.sessions.revokeAllFor(userId);
      return out;
    },
  );

  // ---------------------------------------------------------------- the email log (simulated mail)
  reg('GET', '/admin/email-log');
  app.get(`${p}/admin/email-log`, { preHandler: guard(d, ['ADMIN', 'PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(outboundEmail)
        .where(eq(outboundEmail.tenantId, a.user.tenantId))
        .orderBy(desc(outboundEmail.createdAt))
        .limit(100);
      return rows.map((r) => ({
        id: r.id,
        to: r.toEmail,
        subject: r.subject,
        body: r.body,
        kind: r.kind,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  });

  void inArray;
  void request;
  void notification;
  void fileObject;
  void randomUUID;
  return done;
}
