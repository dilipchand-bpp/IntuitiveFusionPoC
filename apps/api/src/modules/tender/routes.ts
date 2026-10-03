/**
 * Tender endpoints for the buying team (M8): US-TND-01..03.
 * State machine: STAGED -> (delegate permission) -> PUBLISHED -> CLOSED (automatic at the closing time).
 * A tender nobody may see is a 404, never a 403, so existence is not revealed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, count, desc, eq, inArray, max } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Clock, RoleName } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { checkDelegation } from '../../authz/delegation.js';
import { checkSod } from '../../authz/sod.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  addendum,
  approval,
  fieldValue,
  invitation,
  notification,
  plan,
  question,
  request,
  submission,
  tender,
  tenant,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { valuesOf } from '../intake/service.js';
import { TENDER_FIELD_BY_KEY, TENDER_FIELDS, TENDER_TYPES } from './fields.js';
import type { SealedStore } from './files.js';
import { buildTenderPack } from './pack.js';
import { packDocx, packPdf } from './pack-doc.js';
import { validateWindow } from './rules.js';
import { addendumView, questionView } from './serialisers.js';
import { TenderService } from './service.js';

export interface TenderDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
  store: SealedStore;
  contactEmail: string;
}

const uuid = z.string().uuid();
const READERS = [
  'PROCUREMENT',
  'DELEGATE',
  'EVALUATOR',
  'CHAIR',
  'LEGAL',
  'PROBITY',
  'EXEC',
  'ADMIN',
] as const;
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

const createBody = z
  .object({
    requestId: uuid,
    type: z.enum(TENDER_TYPES),
    access: z.enum(['OPEN', 'CLOSED']).default('CLOSED'),
  })
  .strict();
const fieldBody = z.object({ value: z.string().max(10_000), expectedVersion: z.number().int() }).strict();
const permissionBody = z.object({ comment: z.string().trim().max(1000).optional() }).strict();
const publishBody = z.object({ closesAt: z.string().datetime() }).strict();
const inviteBody = z
  .object({
    invitees: z
      .array(
        z
          .object({
            email: z.string().trim().toLowerCase().email().max(200),
            company: z.string().trim().min(2).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
const answerBody = z.object({ answer: z.string().trim().min(2).max(4000) }).strict();
const addendumBody = z
  .object({
    summary: z.string().trim().min(5).max(2000),
    questionIds: z.array(uuid).max(100).default([]),
    newClosesAt: z.string().datetime().optional(),
  })
  .strict();

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const INVITE_DAYS = 30;

export function registerTenderRoutes(app: FastifyInstance, p: string, d: TenderDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const svc = new TenderService(d.clock, d.audit, d.store);
  const tid = (req: FastifyRequest) => parse(z.object({ id: uuid }), req.params).id;
  const fresh = () => svc.closeDue(d.database);

  async function visible(tx: Tx, tenantId: string, id: string) {
    const l = await svc.load(tx, tenantId, id);
    if (!l) throw new AppError(404, 'NOT_FOUND', 'Tender not found');
    return l;
  }

  // ---------------------------------------------------------------- read
  reg('GET', '/tenders');
  app.get(`${p}/tenders`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    await fresh();
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select({ t: tender, r: request })
        .from(tender)
        .innerJoin(request, eq(request.id, tender.requestId))
        .where(eq(tender.tenantId, a.user.tenantId))
        .orderBy(desc(tender.updatedAt));
      const out = [];
      for (const { t, r } of rows) {
        const invites = await tx
          .select({ id: invitation.id })
          .from(invitation)
          .where(eq(invitation.tenderId, t.id));
        const qs = await tx.select({ s: question.status }).from(question).where(eq(question.tenderId, t.id));
        // count only: bid content and identities stay sealed until close
        const [subs] = await tx
          .select({ n: count() })
          .from(submission)
          .where(and(eq(submission.tenderId, t.id), eq(submission.status, 'SUBMITTED')));
        out.push({
          id: t.id,
          requestId: t.requestId,
          requestNumber: r.number,
          title: r.title,
          estimatedValue: Number(r.estimatedValue ?? 0),
          type: t.type,
          access: t.access,
          status: svc.status(t),
          closesAt: t.closesAt?.toISOString() ?? null,
          permissionGranted: Boolean(t.publishPermissionId),
          invitations: invites.length,
          openQuestions: qs.filter((x) => x.s === 'OPEN').length,
          bids: subs?.n ?? 0,
          updatedAt: t.updatedAt.toISOString(),
        });
      }
      return out;
    });
  });

  reg('GET', '/tenders/{id}');
  app.get(`${p}/tenders/:id`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    await fresh();
    return withContext(d.database, a.ctx, async (tx) =>
      svc.staffView(tx, a, await visible(tx, a.user.tenantId, tid(req))),
    );
  });

  // ---------------------------------------------------------------- export the pack as PDF or Word (US-TND-05)
  for (const format of ['pdf', 'docx'] as const) {
    reg('GET', `/tenders/{id}/pack/${format}`);
    app.get(
      `${p}/tenders/:id/pack/${format}`,
      { preHandler: guard(d, ['PROCUREMENT', 'DELEGATE', 'LEGAL', 'PROBITY', 'EXEC']) },
      async (req, reply) => {
        const a = req.auth!;
        const id = tid(req);
        await fresh();
        const doc = await withContext(d.database, a.ctx, async (tx) => {
          const v = await svc.staffView(tx, a, await visible(tx, a.user.tenantId, id));
          await d.audit.record(tx, a.ctx, {
            action: 'tender_pack.export',
            entityType: 'tender',
            entityId: id,
            after: { format: format.toUpperCase(), status: v.status, version: v.version },
          });
          return {
            number: v.requestNumber,
            title: v.title,
            type: v.type,
            status: v.status,
            version: v.version,
            opensAt: v.opensAt ? new Date(v.opensAt) : null,
            closesAt: v.closesAt ? new Date(v.closesAt) : null,
            generatedAt: d.clock.now(),
            fields: v.fields.map((f) => ({ label: f.label, paragraphs: f.paragraphs })),
          };
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
            `attachment; filename="tender-pack-${doc.number}-v${doc.version}.${format}"`,
          )
          .send(format === 'pdf' ? packPdf(doc) : packDocx(doc));
      },
    );
  }

  // ---------------------------------------------------------------- create the pack (US-TND-01)
  reg('POST', '/tenders');
  app.post(`${p}/tenders`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(createBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const [r] = await tx
        .select()
        .from(request)
        .where(and(eq(request.id, body.requestId), eq(request.tenantId, a.user.tenantId)));
      if (!r) throw new AppError(404, 'NOT_FOUND', 'Request not found');
      const [pl] = await tx.select().from(plan).where(eq(plan.requestId, r.id));
      if (!pl)
        throw new AppError(409, 'PLAN_REQUIRED', 'A tender pack is built from the plan; open the plan first');
      const [dup] = await tx.select({ id: tender.id }).from(tender).where(eq(tender.requestId, r.id));
      if (dup) throw new AppError(409, 'TENDER_EXISTS', 'This request already has a tender pack');
      const [org] = await tx.select().from(tenant).where(eq(tenant.id, a.user.tenantId));
      const reqFields = await tx
        .select()
        .from(fieldValue)
        .where(and(eq(fieldValue.ownerType, 'REQUEST'), eq(fieldValue.ownerId, r.id)));
      const planFields = await tx
        .select()
        .from(fieldValue)
        .where(and(eq(fieldValue.ownerType, 'PLAN'), eq(fieldValue.ownerId, pl.id)));
      const cfg = (org?.config ?? {}) as { statutoryMinDays?: number };
      const values = valuesOf(r, reqFields);
      const pack = buildTenderPack({
        type: body.type,
        title: r.title,
        organisation: org?.name ?? 'The organisation',
        category: values.category,
        termMonths: values.termMonths,
        businessUnit: values.businessUnit,
        plan: Object.fromEntries(planFields.map((f) => [f.key, f.value ?? undefined])),
        request: values,
        contactEmail: d.contactEmail,
        ...(org?.sector === 'PUBLIC' && cfg.statutoryMinDays
          ? { statutoryMinDays: cfg.statutoryMinDays }
          : {}),
      });
      const now = d.clock.now();
      const [t] = await tx
        .insert(tender)
        .values({
          tenantId: a.user.tenantId,
          requestId: r.id,
          type: body.type,
          access: body.access,
          status: 'STAGED',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      for (const def of TENDER_FIELDS)
        await tx.insert(fieldValue).values({
          tenantId: a.user.tenantId,
          ownerType: 'TENDER',
          ownerId: t!.id,
          key: def.key,
          label: def.label,
          value: pack[def.key] ?? '',
          source: 'SYSTEM',
          aiDrafted: false,
          updatedAt: now,
        });
      await d.audit.record(tx, a.ctx, {
        action: 'tender.create',
        entityType: 'tender',
        entityId: t!.id,
        after: {
          requestId: r.id,
          type: body.type,
          access: body.access,
          status: 'STAGED',
          planStatus: pl.status,
        },
      });
      await svc.notifyRoles(
        tx,
        a.user.tenantId,
        ['DELEGATE'],
        'Tender staged: permission to publish needed',
        `${r.number} ${r.title}`,
        `/app/tenders/${t!.id}`,
      );
      return svc.staffView(tx, a, { tender: t!, req: r });
    });
    return reply.status(201).send(out);
  });

  // ---------------------------------------------------------------- edit the pack while staged
  reg('PUT', '/tenders/{id}/fields/{key}');
  app.put(`${p}/tenders/:id/fields/:key`, { preHandler: guard(d, ['PROCUREMENT', 'LEGAL']) }, async (req) => {
    const a = req.auth!;
    const { id, key } = parse(z.object({ id: uuid, key: z.string().max(40) }), req.params);
    const body = parse(fieldBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a.user.tenantId, id);
      if (svc.status(l.tender) !== 'STAGED')
        throw new AppError(
          423,
          'TENDER_LOCKED',
          'A published tender cannot be edited. Issue an addendum to change what suppliers see.',
        );
      if (body.expectedVersion !== l.tender.version)
        throw new AppError(
          409,
          'VERSION_CONFLICT',
          'The tender changed while you were editing; reload and try again',
        );
      if (!TENDER_FIELD_BY_KEY.has(key))
        throw new AppError(400, 'VALIDATION_FAILED', 'Unknown tender section', [
          { field: key, message: 'Not a tender section' },
        ]);
      const [row] = await tx
        .select()
        .from(fieldValue)
        .where(and(eq(fieldValue.ownerType, 'TENDER'), eq(fieldValue.ownerId, id), eq(fieldValue.key, key)));
      const now = d.clock.now();
      await tx
        .update(fieldValue)
        .set({
          value: body.value,
          previousValue: row?.value ?? null,
          source: 'USER',
          updatedBy: a.user.id,
          updatedAt: now,
        })
        .where(and(eq(fieldValue.ownerType, 'TENDER'), eq(fieldValue.ownerId, id), eq(fieldValue.key, key)));
      await tx
        .update(tender)
        .set({ updatedAt: now, version: l.tender.version + 1 })
        .where(eq(tender.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'tender.field_update',
        entityType: 'tender',
        entityId: id,
        before: { [key]: row?.value ?? '' },
        after: { [key]: body.value },
      });
      return svc.staffView(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
  });

  // ---------------------------------------------------------------- permission to publish (US-TND-02 AC2)
  reg('POST', '/tenders/{id}/publish-permission');
  app.post(`${p}/tenders/:id/publish-permission`, { preHandler: guard(d, ['DELEGATE']) }, async (req) => {
    const a = req.auth!;
    const id = tid(req);
    const body = parse(permissionBody, req.body ?? {});
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a.user.tenantId, id);
      if (svc.status(l.tender) !== 'STAGED')
        throw new AppError(409, 'INVALID_STATE', 'Only a staged tender can be given permission to publish');
      if (l.tender.publishPermissionId)
        throw new AppError(409, 'ALREADY_PERMITTED', 'Permission to publish has already been given');
      const sod = checkSod('APPROVE_OWN_SUBJECT', {
        roles: a.user.roles as RoleName[],
        isAuthorOfSubject: l.req.requesterId === a.user.id,
      });
      if (!sod.ok) throw new AppError(403, sod.code, sod.message);
      const value = Number(l.req.estimatedValue ?? 0);
      const del = await checkDelegation(
        tx,
        { tenantId: a.user.tenantId, userId: a.user.id, roles: a.user.roles },
        'PUBLISH_PERMISSION',
        value,
      );
      if (!del.allowed)
        throw new AppError(
          403,
          del.code ?? 'DELEGATION_EXCEEDED',
          del.limit === null
            ? 'You do not hold authority to give permission to publish'
            : `This tender (${aud.format(value)}) is above your publishing authority of ${aud.format(del.limit)}`,
        );
      const now = d.clock.now();
      const [ap] = await tx
        .insert(approval)
        .values({
          tenantId: a.user.tenantId,
          subjectType: 'TENDER_PUBLISH',
          subjectId: id,
          userId: a.user.id,
          role: a.user.role,
          decision: 'APPROVED',
          comment: body.comment ?? null,
          stamp: `PERMISSION TO PUBLISH · ${a.user.name} · ${a.user.role.replace('_', ' ')} · ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
          decidedAt: now,
        })
        .returning();
      await tx
        .update(tender)
        .set({ publishPermissionId: ap!.id, updatedAt: now, version: l.tender.version + 1 })
        .where(eq(tender.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'tender.publish_permission',
        entityType: 'tender',
        entityId: id,
        after: { approvalId: ap!.id, value, limit: del.limit },
      });
      await svc.notifyRoles(
        tx,
        a.user.tenantId,
        ['PROCUREMENT'],
        'Permission to publish given',
        `${l.req.number} ${l.req.title}: you can publish now`,
        `/app/tenders/${id}`,
      );
      return svc.staffView(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
  });

  // ---------------------------------------------------------------- publish (US-TND-02, US-TND-04)
  reg('POST', '/tenders/{id}/publish');
  app.post(`${p}/tenders/:id/publish`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const id = tid(req);
    const body = parse(publishBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a.user.tenantId, id);
      if (svc.status(l.tender) !== 'STAGED')
        throw new AppError(409, 'INVALID_STATE', 'Only a staged tender can be published');
      if (!l.tender.publishPermissionId)
        throw new AppError(
          409,
          'PERMISSION_REQUIRED',
          'A delegate has not yet given permission to publish this tender',
        );
      const [pl] = await tx.select().from(plan).where(eq(plan.requestId, l.tender.requestId));
      if (!pl?.locked)
        throw new AppError(
          409,
          'PLAN_NOT_APPROVED',
          'The procurement plan must be approved before the tender is published',
        );
      const now = d.clock.now();
      const closes = new Date(body.closesAt);
      const [org] = await tx.select().from(tenant).where(eq(tenant.id, a.user.tenantId));
      const minDays =
        org?.sector === 'PUBLIC'
          ? Number(((org.config ?? {}) as { statutoryMinDays?: number }).statutoryMinDays ?? 0)
          : 0;
      const w = validateWindow(now, closes, minDays);
      if (!w.ok)
        throw new AppError(
          422,
          'STATUTORY_WINDOW',
          closes.getTime() <= now.getTime()
            ? 'The closing time must be in the future'
            : `Closing is ${w.days} day(s) after publication; this organisation requires at least ${w.minDays}`,
          [{ field: 'closesAt', message: `Choose a closing time at least ${w.minDays} days from now` }],
        );
      await tx
        .update(tender)
        .set({
          status: 'PUBLISHED',
          opensAt: now,
          closesAt: closes,
          updatedAt: now,
          version: l.tender.version + 1,
        })
        .where(eq(tender.id, id));
      await tx.update(request).set({ phase: 'TENDER', updatedAt: now }).where(eq(request.id, l.req.id));
      await d.audit.record(tx, a.ctx, {
        action: 'tender.publish',
        entityType: 'tender',
        entityId: id,
        before: { status: 'STAGED' },
        after: {
          status: 'PUBLISHED',
          opensAt: now.toISOString(),
          closesAt: closes.toISOString(),
          windowDays: w.days,
        },
      });
      // Invitation emails are queued (mock mail): one audit entry each, no personal data in it.
      const invites = await tx
        .select({ id: invitation.id })
        .from(invitation)
        .where(eq(invitation.tenderId, id));
      for (const i of invites)
        await d.audit.record(tx, a.ctx, {
          action: 'invitation.queued',
          entityType: 'invitation',
          entityId: i.id,
          after: { tenderId: id, channel: 'EMAIL_SIMULATED' },
        });
      return svc.staffView(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
  });

  // ---------------------------------------------------------------- invitations
  reg('POST', '/tenders/{id}/invitations');
  app.post(`${p}/tenders/:id/invitations`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req, reply) => {
    const a = req.auth!;
    const id = tid(req);
    const body = parse(inviteBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a.user.tenantId, id);
      const st = svc.status(l.tender);
      if (st !== 'STAGED' && st !== 'PUBLISHED')
        throw new AppError(409, 'INVALID_STATE', 'Invitations can only be sent before the tender closes');
      const existing = await tx
        .select({ email: invitation.email })
        .from(invitation)
        .where(eq(invitation.tenderId, id));
      const have = new Set(existing.map((e) => e.email.toLowerCase()));
      const dupes = body.invitees.filter((i) => have.has(i.email));
      if (dupes.length)
        throw new AppError(
          409,
          'ALREADY_INVITED',
          'Some contacts were already invited to this tender',
          dupes.map((x) => ({ field: x.email, message: 'Already invited' })),
        );
      const now = d.clock.now();
      const expires = new Date(
        Math.min(
          now.getTime() + INVITE_DAYS * 86_400_000,
          l.tender.closesAt ? l.tender.closesAt.getTime() : Number.MAX_SAFE_INTEGER,
        ),
      );
      const created = [];
      for (const i of body.invitees) {
        const token = randomBytes(32).toString('base64url');
        const [row] = await tx
          .insert(invitation)
          .values({
            tenantId: a.user.tenantId,
            tenderId: id,
            email: i.email,
            company: i.company,
            tokenHash: hashToken(token),
            expiresAt: expires,
          })
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: 'invitation.create',
          entityType: 'invitation',
          entityId: row!.id,
          after: { tenderId: id, company: i.company, expiresAt: expires.toISOString() },
        });
        // The link is shown once, here. Only its hash is stored. (Real mail would send it; the mock shows it.)
        created.push({
          id: row!.id,
          email: i.email,
          company: i.company,
          expiresAt: expires.toISOString(),
          registerPath: `/supplier/register?token=${token}`,
        });
      }
      return { invitations: created };
    });
    return reply.status(201).send(out);
  });

  // ---------------------------------------------------------------- anonymised Q&A and addenda (US-TND-03)
  reg('GET', '/tenders/{id}/questions');
  app.get(
    `${p}/tenders/:id/questions`,
    { preHandler: guard(d, ['PROCUREMENT', 'LEGAL', 'SUPPLIER']) },
    async (req) => {
      const a = req.auth!;
      const id = tid(req);
      await fresh();
      if (a.user.roles.includes('SUPPLIER')) {
        const r = await withContext(d.database, a.ctx, async (tx) => {
          const l = await svc.supplierAccess(tx, a, id);
          return l
            ? { ok: true as const, rows: await svc.questionRows(tx, l.tender.id, true) }
            : { ok: false as const };
        });
        return r.ok ? r.rows : svc.denyAccess(d.database, a, id);
      }
      return withContext(d.database, a.ctx, async (tx) => {
        await visible(tx, a.user.tenantId, id);
        return svc.questionRows(tx, id, false);
      });
    },
  );

  reg('POST', '/tenders/{id}/questions/{questionId}/answer');
  app.post(
    `${p}/tenders/:id/questions/:questionId/answer`,
    { preHandler: guard(d, ['PROCUREMENT', 'LEGAL']) },
    async (req) => {
      const a = req.auth!;
      const { id, questionId } = parse(z.object({ id: uuid, questionId: uuid }), req.params);
      const body = parse(answerBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const l = await visible(tx, a.user.tenantId, id);
        if (svc.status(l.tender) !== 'PUBLISHED')
          throw new AppError(409, 'INVALID_STATE', 'Questions can only be answered while the tender is open');
        const [q] = await tx
          .select()
          .from(question)
          .where(and(eq(question.id, questionId), eq(question.tenderId, id)));
        if (!q) throw new AppError(404, 'NOT_FOUND', 'Question not found');
        if (q.status === 'PUBLISHED')
          throw new AppError(
            409,
            'ALREADY_PUBLISHED',
            'A published answer cannot be changed; issue a further addendum',
          );
        await tx
          .update(question)
          .set({ answer: body.answer, status: 'ANSWERED' })
          .where(eq(question.id, questionId));
        await d.audit.record(tx, a.ctx, {
          action: 'question.answer',
          entityType: 'question',
          entityId: questionId,
          after: { tenderId: id, status: 'ANSWERED' },
        });
        const [row] = await tx.select().from(question).where(eq(question.id, questionId));
        return questionView(row!);
      });
    },
  );

  reg('POST', '/tenders/{id}/addenda');
  app.post(`${p}/tenders/:id/addenda`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req, reply) => {
    const a = req.auth!;
    const id = tid(req);
    const body = parse(addendumBody, req.body);
    await fresh();
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a.user.tenantId, id);
      if (!svc.isOpen(l.tender))
        throw new AppError(409, 'INVALID_STATE', 'Addenda can only be issued while the tender is open');
      const qs = body.questionIds.length
        ? await tx
            .select()
            .from(question)
            .where(and(eq(question.tenderId, id), inArray(question.id, body.questionIds)))
        : [];
      if (qs.length !== body.questionIds.length)
        throw new AppError(400, 'VALIDATION_FAILED', 'Some questions were not found on this tender', [
          { field: 'questionIds', message: 'Unknown question' },
        ]);
      const notReady = qs.filter((q) => q.status !== 'ANSWERED');
      if (notReady.length)
        throw new AppError(
          409,
          'QUESTION_NOT_READY',
          'Only answered, unpublished questions can go in an addendum',
          [
            {
              field: 'questionIds',
              message: 'Answer each question first (and do not repeat published ones)',
            },
          ],
        );
      const now = d.clock.now();
      let newCloses: Date | null = null;
      if (body.newClosesAt) {
        newCloses = new Date(body.newClosesAt);
        if (!l.tender.closesAt || newCloses.getTime() <= l.tender.closesAt.getTime())
          throw new AppError(422, 'VALIDATION_FAILED', 'An addendum can only extend the closing time', [
            { field: 'newClosesAt', message: 'Choose a time later than the current closing time' },
          ]);
      }
      const [last] = await tx
        .select({ n: max(addendum.number) })
        .from(addendum)
        .where(eq(addendum.tenderId, id));
      const number = (last?.n ?? 0) + 1;
      const [row] = await tx
        .insert(addendum)
        .values({
          tenantId: a.user.tenantId,
          tenderId: id,
          number,
          summary: body.summary,
          questionIds: body.questionIds,
          newClosesAt: newCloses,
          issuedAt: now,
        })
        .returning();
      if (body.questionIds.length)
        await tx.update(question).set({ status: 'PUBLISHED' }).where(inArray(question.id, body.questionIds));
      if (newCloses)
        await tx
          .update(tender)
          .set({ closesAt: newCloses, updatedAt: now, version: l.tender.version + 1 })
          .where(eq(tender.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'addendum.issue',
        entityType: 'tender',
        entityId: id,
        after: {
          number,
          questions: body.questionIds.length,
          ...(newCloses ? { newClosesAt: newCloses.toISOString() } : {}),
        },
      });
      // Everyone who can see this tender gets the same notice at the same time (identical information for all).
      for (const uid of await svc.supplierUserIds(tx, l.tender))
        await tx.insert(notification).values({
          tenantId: a.user.tenantId,
          userId: uid,
          title: `Addendum ${number} issued`,
          body: `${l.req.title}: ${body.summary.slice(0, 140)}`,
          link: `/supplier/tenders/${id}`,
        });
      return addendumView(row!);
    });
    return reply.status(201).send(out);
  });

  return done;
}
