/**
 * Supplier portal endpoints (M8): US-SUP-01..04.
 * Suppliers live in their own identity pool (cookie if_supplier_session). A supplier sees only tenders that name them
 * (or open-access ones); anything else is a 404 plus an audited denial, so nothing reveals that a tender exists.
 */
import { randomUUID } from 'node:crypto';
import { hash as argon2Hash } from '@node-rs/argon2';
import { and, count, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig, Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { withContext, withSystem, type RequestContext, type Tx } from '../../db/client.js';
import {
  appUser,
  fileObject,
  invitation,
  notification,
  question,
  roleAssignment,
  submission,
  supplier,
  tender,
  tenant,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { checkUpload, MAX_FILES_PER_BID, scanBytes, sha256, type SealedStore } from './files.js';
import { makeReceipt, validAbn } from './rules.js';
import { fileView } from './serialisers.js';
import { TenderService, type LoadedTender } from './service.js';
import { hashToken } from './routes.js';

export interface SupplierDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
  store: SealedStore;
  config: AppConfig;
  /** Attempts per 15 minutes per address on the public registration routes. */
  publicRateLimitMax?: number;
}

const uuid = z.string().uuid();
const registerBody = z
  .object({
    token: z.string().min(20).max(100).optional(),
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(200),
    company: z.string().trim().min(2).max(200),
    abn: z.string().trim().max(20),
    password: z.string().min(12).max(200),
  })
  .strict();
const askBody = z.object({ text: z.string().trim().min(5).max(2000) }).strict();
const uploadBody = z
  .object({
    name: z.string().min(1).max(300),
    section: z.enum(['TECHNICAL', 'COMMERCIAL', 'OTHER']).default('OTHER'),
    dataBase64: z.string().min(1),
  })
  .strict();

const MAX_QUESTIONS_PER_SUPPLIER = 10;
const UPLOAD_BODY_LIMIT = 15 * 1024 * 1024; // 10 MB of file is about 13.4 MB as base64

export function registerSupplierRoutes(app: FastifyInstance, p: string, d: SupplierDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const svc = new TenderService(d.clock, d.audit, d.store);
  const fresh = () => svc.closeDue(d.database);
  const tid = (req: { params: unknown }) => parse(z.object({ id: uuid }), req.params).id;
  const publicLimit = {
    config: { rateLimit: { max: d.publicRateLimitMax ?? 20, timeWindow: '15 minutes' } },
  };

  /** Runs `fn` as the signed-in supplier on a tender they may see; otherwise an audited 404 once the transaction is over. */
  async function asSupplier<T>(
    a: AuthContext,
    id: string,
    fn: (tx: Tx, l: LoadedTender) => Promise<T>,
  ): Promise<T> {
    const r = await withContext(d.database, a.ctx, async (tx) => {
      const l = await svc.supplierAccess(tx, a, id);
      return l ? { ok: true as const, value: await fn(tx, l) } : { ok: false as const };
    });
    if (!r.ok) return svc.denyAccess(d.database, a, id);
    return r.value;
  }

  // ---------------------------------------------------------------- invitation lookup (public, US-SUP-01)
  reg('GET', '/supplier/invitations/{token}');
  app.get(
    `${p}/supplier/invitations/:token`,
    { preHandler: guard(d, 'public'), ...publicLimit },
    async (req) => {
      const { token } = parse(z.object({ token: z.string().min(20).max(100) }), req.params);
      return withSystem(d.database, async (tx) => {
        const [inv] = await tx
          .select()
          .from(invitation)
          .where(eq(invitation.tokenHash, hashToken(token)));
        const now = d.clock.now();
        // One generic answer for unknown, used and expired links, so links cannot be probed.
        if (!inv || inv.usedAt || inv.expiresAt <= now)
          throw new AppError(
            404,
            'INVITATION_INVALID',
            'This invitation link is not valid. Ask the buyer for a new one.',
          );
        const [t] = await tx.select().from(tender).where(eq(tender.id, inv.tenderId));
        const [org] = await tx.select().from(tenant).where(eq(tenant.id, inv.tenantId));
        const closed = !t || (svc.status(t) !== 'PUBLISHED' && svc.status(t) !== 'STAGED');
        if (closed)
          throw new AppError(
            404,
            'INVITATION_INVALID',
            'This invitation link is not valid. Ask the buyer for a new one.',
          );
        return {
          email: inv.email,
          company: inv.company,
          organisation: org?.name ?? '',
          expiresAt: inv.expiresAt.toISOString(),
        };
      });
    },
  );

  // ---------------------------------------------------------------- self-registration (public, US-SUP-01)
  reg('POST', '/supplier/register');
  app.post(
    `${p}/supplier/register`,
    { preHandler: guard(d, 'public'), ...publicLimit },
    async (req, reply) => {
      const b = parse(registerBody, req.body);
      if (!validAbn(b.abn))
        throw new AppError(400, 'VALIDATION_FAILED', 'The ABN is not valid', [
          { field: 'abn', message: 'Enter an 11-digit ABN (it is checked against the official checksum)' },
        ]);
      if (!/[A-Za-z]/.test(b.password) || !/\d/.test(b.password))
        throw new AppError(400, 'VALIDATION_FAILED', 'The password is too weak', [
          { field: 'password', message: 'Use at least 12 characters with letters and numbers' },
        ]);
      const passwordHash = await argon2Hash(b.password);
      const abn = b.abn.replace(/\s+/g, '');
      const out = await withSystem(d.database, async (tx) => {
        const now = d.clock.now();
        let tenantId: string;
        let inv: typeof invitation.$inferSelect | undefined;
        if (b.token) {
          [inv] = await tx
            .select()
            .from(invitation)
            .where(eq(invitation.tokenHash, hashToken(b.token)));
          if (!inv || inv.usedAt || inv.expiresAt <= now)
            throw new AppError(
              404,
              'INVITATION_INVALID',
              'This invitation link is not valid. Ask the buyer for a new one.',
            );
          tenantId = inv.tenantId;
        } else {
          // Without an invitation a supplier can only join the default organisation, and then sees open-access tenders only.
          const [org] = await tx.select().from(tenant).where(eq(tenant.slug, d.config.DEFAULT_TENANT_SLUG));
          if (!org) throw new AppError(404, 'NOT_FOUND', 'Registration is not available');
          tenantId = org.id;
        }
        const sys: RequestContext = { tenantId, userId: null, role: 'SYSTEM' };
        const [taken] = await tx
          .select({ id: appUser.id })
          .from(appUser)
          .where(and(eq(appUser.tenantId, tenantId), eq(appUser.email, b.email)));
        // Same answer whether or not the email is already registered, and nothing about the existing account.
        if (taken)
          throw new AppError(
            409,
            'REGISTRATION_FAILED',
            'We could not register with these details. If you already have an account, sign in instead.',
          );
        // A company already in the directory cannot be joined by self-registration: anyone who knows an ABN (a public
        // number) could otherwise attach themselves to that company and see its tenders and bids. The buyer adds new
        // contacts for an existing supplier after checking them. The answer is the same generic one as for a taken email.
        const [existing] = await tx
          .select({ id: supplier.id })
          .from(supplier)
          .where(and(eq(supplier.tenantId, tenantId), eq(supplier.abn, abn)));
        if (existing)
          throw new AppError(
            409,
            'REGISTRATION_FAILED',
            'We could not register with these details. If you already have an account, sign in instead.',
          );
        const [sup] = await tx
          .insert(supplier)
          .values({
            tenantId,
            company: b.company,
            abn,
            sanctionsStatus: 'PENDING',
            insuranceStatus: 'UNKNOWN',
            createdAt: now,
          })
          .returning();
        await d.audit.record(tx, sys, {
          action: 'supplier.register',
          entityType: 'supplier',
          entityId: sup!.id,
          after: { company: b.company, sanctionsStatus: 'PENDING' },
        });
        const [u] = await tx
          .insert(appUser)
          .values({
            tenantId,
            email: b.email,
            name: b.name,
            passwordHash,
            supplierId: sup!.id,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        await tx.insert(roleAssignment).values({ tenantId, userId: u!.id, role: 'SUPPLIER' });
        if (inv) {
          await tx
            .update(invitation)
            .set({ usedAt: now, supplierId: sup!.id })
            .where(eq(invitation.id, inv.id));
        }
        await d.audit.record(tx, sys, {
          action: 'supplier.user_register',
          entityType: 'user',
          entityId: u!.id,
          after: { supplierId: sup!.id, viaInvitation: Boolean(inv) },
        });
        return { registered: true, supplierId: sup!.id, sanctionsStatus: sup!.sanctionsStatus };
      });
      return reply.status(201).send(out);
    },
  );

  // ---------------------------------------------------------------- one-tender view (US-SUP-02)
  reg('GET', '/supplier/tenders');
  app.get(`${p}/supplier/tenders`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    await fresh();
    return withContext(d.database, a.ctx, async (tx) => {
      const list = await svc.visibleTo(tx, a.user.tenantId, a.user.supplierId);
      const out = [];
      for (const t of list) {
        const l = await svc.load(tx, a.user.tenantId, t.id);
        const [sub] = a.user.supplierId
          ? await tx
              .select()
              .from(submission)
              .where(and(eq(submission.tenderId, t.id), eq(submission.supplierId, a.user.supplierId)))
          : [];
        out.push({
          id: t.id,
          title: l!.req.title,
          number: l!.req.number,
          type: t.type,
          status: svc.status(t),
          closesAt: t.closesAt?.toISOString() ?? null,
          submissionStatus: sub?.status ?? 'NOT_STARTED',
          receipt: sub?.receipt ?? null,
        });
      }
      return out;
    });
  });

  reg('GET', '/supplier/tenders/{id}');
  app.get(`${p}/supplier/tenders/:id`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    const id = tid(req);
    await fresh();
    return asSupplier(a, id, (tx, l) => svc.supplierView(tx, a, l));
  });

  // ---------------------------------------------------------------- ask a question (anonymised, US-TND-03)
  reg('POST', '/supplier/tenders/{id}/questions');
  app.post(
    `${p}/supplier/tenders/:id/questions`,
    { preHandler: guard(d, ['SUPPLIER']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = tid(req);
      const body = parse(askBody, req.body);
      await fresh();
      const out = await asSupplier(a, id, async (tx, l) => {
        if (!svc.isOpen(l.tender))
          throw new AppError(409, 'BID_CLOSED', 'This tender is closed to questions');
        const [n] = await tx
          .select({ n: count() })
          .from(question)
          .where(and(eq(question.tenderId, id), eq(question.askedBySupplierId, a.user.supplierId!)));
        if ((n?.n ?? 0) >= MAX_QUESTIONS_PER_SUPPLIER)
          throw new AppError(
            429,
            'QUESTION_LIMIT',
            `You can ask up to ${MAX_QUESTIONS_PER_SUPPLIER} questions on one tender`,
          );
        const [q] = await tx
          .insert(question)
          .values({
            tenantId: a.user.tenantId,
            tenderId: id,
            text: body.text,
            status: 'OPEN',
            askedBySupplierId: a.user.supplierId!, // stored for abuse control only; no response ever includes it
            askedAt: d.clock.now(),
          })
          .returning({ id: question.id, status: question.status });
        await d.audit.record(tx, a.ctx, {
          action: 'question.ask',
          entityType: 'question',
          entityId: q!.id,
          after: { tenderId: id },
        });
        await svc.notifyRoles(
          tx,
          a.user.tenantId,
          ['PROCUREMENT'],
          'New supplier question',
          `${l.req.number}: a question needs an answer`,
          `/app/tenders/${id}`,
        );
        return { id: q!.id, status: q!.status };
      });
      return reply.status(201).send(out);
    },
  );

  // ---------------------------------------------------------------- upload (US-SUP-03)
  /** Gets (or starts) this supplier's submission for a tender. */
  async function ensureSubmission(
    tx: Parameters<Parameters<typeof withContext>[2]>[0],
    tenantId: string,
    tenderId: string,
    supplierId: string,
  ) {
    let [s] = await tx
      .select()
      .from(submission)
      .where(and(eq(submission.tenderId, tenderId), eq(submission.supplierId, supplierId)));
    if (!s)
      [s] = await tx
        .insert(submission)
        .values({ tenantId, tenderId, supplierId, status: 'DRAFT', createdAt: d.clock.now() })
        .returning();
    return s!;
  }
  const lateReply = (reply: { status(n: number): { send(b: unknown): unknown } }, req: { id: string }) =>
    reply.status(409).send({
      type: 'about:blank',
      status: 409,
      title: 'The closing time has passed, so this was not accepted',
      code: 'BID_CLOSED',
      correlationId: req.id,
    });

  /** After close: discard anything started, mark it late, tell the supplier (US-SUP-04). */
  async function discardLate(a: AuthContext, tenderId: string, title: string) {
    const doomed: string[] = [];
    await withContext(d.database, a.ctx, async (tx) => {
      const [s] = await tx
        .select()
        .from(submission)
        .where(and(eq(submission.tenderId, tenderId), eq(submission.supplierId, a.user.supplierId!)));
      if (s && s.status === 'DRAFT') {
        const files = await tx.select().from(fileObject).where(eq(fileObject.submissionId, s.id));
        doomed.push(...files.map((f) => f.storageKey));
        await tx.delete(fileObject).where(eq(fileObject.submissionId, s.id));
        await tx.update(submission).set({ status: 'REJECTED_LATE' }).where(eq(submission.id, s.id));
      }
      await d.audit.record(tx, a.ctx, {
        action: 'submission.rejected_late',
        entityType: 'tender',
        entityId: tenderId,
        after: { supplierId: a.user.supplierId, discardedFiles: doomed.length },
        result: 'DENIED',
      });
      await tx.insert(notification).values({
        tenantId: a.user.tenantId,
        userId: a.user.id,
        title: 'Late submission not accepted',
        body: `${title}: the closing time had passed, so nothing was accepted.`,
        link: `/supplier/tenders/${tenderId}`,
      });
    });
    for (const k of doomed) await d.store.remove(k);
  }

  reg('POST', '/supplier/tenders/{id}/submission/files');
  app.post(
    `${p}/supplier/tenders/:id/submission/files`,
    { preHandler: guard(d, ['SUPPLIER']), bodyLimit: UPLOAD_BODY_LIMIT },
    async (req, reply) => {
      const a = req.auth!;
      const id = tid(req);
      const body = parse(uploadBody, req.body);
      await fresh();
      // Cheap, content-free checks first; the contents are examined before anything is stored.
      const bytes = Buffer.from(body.dataBase64, 'base64');
      const chk = checkUpload(body.name, bytes);
      let late = false;
      const out = await asSupplier(a, id, async (tx, l) => {
        if (!svc.isOpen(l.tender)) {
          late = true;
          return null;
        }
        if (!chk.ok) {
          await d.audit.record(tx, a.ctx, {
            action: 'submission.upload_refused',
            entityType: 'tender',
            entityId: id,
            after: { code: chk.code, name: body.name.slice(0, 80) },
            result: 'DENIED',
          });
          return { refused: chk };
        }
        const sub = await ensureSubmission(tx, a.user.tenantId, id, a.user.supplierId!);
        if (sub.status === 'SUBMITTED')
          throw new AppError(
            409,
            'ALREADY_SUBMITTED',
            'You have already submitted. Withdraw your submission first if you need to change files.',
          );
        const [n] = await tx
          .select({ n: count() })
          .from(fileObject)
          .where(eq(fileObject.submissionId, sub.id));
        if ((n?.n ?? 0) >= MAX_FILES_PER_BID)
          throw new AppError(409, 'TOO_MANY_FILES', `A bid can have up to ${MAX_FILES_PER_BID} files`);
        const scan = scanBytes(bytes);
        if (scan === 'INFECTED') {
          await d.audit.record(tx, a.ctx, {
            action: 'submission.upload_infected',
            entityType: 'tender',
            entityId: id,
            after: { name: chk.safeName },
            result: 'DENIED',
          });
          return {
            refused: {
              ok: false as const,
              code: 'FILE_INFECTED',
              message: 'The virus check found a problem with this file, so it was not stored.',
            },
          };
        }
        const key = `${a.user.tenantId}/${sub.id}/${randomUUID()}`;
        await d.store.put(key, bytes);
        const [f] = await tx
          .insert(fileObject)
          .values({
            tenantId: a.user.tenantId,
            submissionId: sub.id,
            name: chk.safeName,
            sizeBytes: bytes.length,
            contentType: chk.contentType,
            storageKey: key,
            sha256: sha256(bytes),
            scan: 'CLEAN',
            section: body.section,
            createdAt: d.clock.now(),
          })
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: 'submission.upload',
          entityType: 'submission',
          entityId: sub.id,
          after: { name: chk.safeName, sizeBytes: bytes.length, section: body.section, sha256: f!.sha256 },
        });
        return { file: fileView(f!) };
      });
      if (late) {
        const l = await withContext(d.database, a.ctx, (tx) => svc.load(tx, a.user.tenantId, id));
        await discardLate(a, id, l?.req.title ?? 'Tender');
        return lateReply(reply, req);
      }
      if (out && 'refused' in out && out.refused && !out.refused.ok) {
        const status = out.refused.code === 'FILE_TOO_LARGE' ? 413 : 400;
        return reply.status(status).type('application/problem+json').send({
          type: 'about:blank',
          status,
          title: out.refused.message,
          code: out.refused.code,
          correlationId: req.id,
        });
      }
      return reply.status(201).send((out as { file: unknown }).file);
    },
  );

  reg('DELETE', '/supplier/tenders/{id}/submission/files/{fileId}');
  app.delete(
    `${p}/supplier/tenders/:id/submission/files/:fileId`,
    { preHandler: guard(d, ['SUPPLIER']) },
    async (req, reply) => {
      const a = req.auth!;
      const { id, fileId } = parse(z.object({ id: uuid, fileId: uuid }), req.params);
      await fresh();
      let key: string | null = null;
      await asSupplier(a, id, async (tx, l) => {
        if (!svc.isOpen(l.tender)) throw new AppError(409, 'BID_CLOSED', 'The tender is closed');
        const [sub] = await tx
          .select()
          .from(submission)
          .where(and(eq(submission.tenderId, id), eq(submission.supplierId, a.user.supplierId!)));
        // Row level security also limits this to the owner's files; the explicit supplier match is belt and braces.
        const [f] = sub
          ? await tx
              .select()
              .from(fileObject)
              .where(and(eq(fileObject.id, fileId), eq(fileObject.submissionId, sub.id)))
          : [];
        if (!sub || !f) throw new AppError(404, 'NOT_FOUND', 'File not found');
        if (sub.status === 'SUBMITTED')
          throw new AppError(
            409,
            'ALREADY_SUBMITTED',
            'You have already submitted. Withdraw your submission first.',
          );
        await tx.delete(fileObject).where(eq(fileObject.id, fileId));
        key = f.storageKey;
        await d.audit.record(tx, a.ctx, {
          action: 'submission.file_remove',
          entityType: 'submission',
          entityId: sub.id,
          after: { name: f.name },
        });
      });
      if (key) await d.store.remove(key);
      return reply.status(204).send();
    },
  );

  // ---------------------------------------------------------------- submit, receipt, withdraw (US-SUP-03/04)
  reg('POST', '/supplier/tenders/{id}/submission');
  app.post(
    `${p}/supplier/tenders/:id/submission`,
    { preHandler: guard(d, ['SUPPLIER']) },
    async (req, reply) => {
      const a = req.auth!;
      const id = tid(req);
      await fresh();
      let late = false;
      const out = await asSupplier(a, id, async (tx, l) => {
        const now = d.clock.now();
        // Decided on the server clock at this instant, not on the stored status (which a scheduler may not have updated).
        if (!svc.isOpen(l.tender)) {
          late = true;
          return null;
        }
        const sub = await ensureSubmission(tx, a.user.tenantId, id, a.user.supplierId!);
        if (sub.status === 'SUBMITTED')
          throw new AppError(
            409,
            'ALREADY_SUBMITTED',
            'You have already submitted. Your receipt is on the tender page.',
          );
        const files = await tx.select().from(fileObject).where(eq(fileObject.submissionId, sub.id));
        const clean = files.filter((f) => f.scan === 'CLEAN');
        const missing = (['TECHNICAL', 'COMMERCIAL'] as const).filter(
          (s) => !clean.some((f) => f.section === s),
        );
        if (missing.length)
          throw new AppError(
            409,
            'SUBMISSION_INCOMPLETE',
            'Your bid needs at least one technical file and one commercial file',
            missing.map((m) => ({ field: m.toLowerCase(), message: `Add a ${m.toLowerCase()} file` })),
          );
        const [sup] = await tx.select().from(supplier).where(eq(supplier.id, a.user.supplierId!));
        const receipt = makeReceipt(sup?.abn ?? '0000', now, sub.id);
        await tx
          .update(submission)
          .set({ status: 'SUBMITTED', receipt, submittedAt: now })
          .where(eq(submission.id, sub.id));
        await d.audit.record(tx, a.ctx, {
          action: 'submission.submit',
          entityType: 'submission',
          entityId: sub.id,
          after: {
            receipt,
            files: clean.map((f) => ({ name: f.name, sha256: f.sha256 })),
            closesAt: l.tender.closesAt?.toISOString(),
          },
        });
        await tx.insert(notification).values({
          tenantId: a.user.tenantId,
          userId: a.user.id,
          title: 'Bid received',
          body: `${l.req.title}: receipt ${receipt}`,
          link: `/supplier/tenders/${id}`,
        });
        return {
          receipt,
          submittedAt: now.toISOString(),
          closesAt: l.tender.closesAt?.toISOString() ?? null,
          files: clean.map((f) => ({
            name: f.name,
            sizeBytes: f.sizeBytes,
            section: f.section,
            sha256: f.sha256,
          })),
        };
      });
      if (late) {
        const l = await withContext(d.database, a.ctx, (tx) => svc.load(tx, a.user.tenantId, id));
        await discardLate(a, id, l?.req.title ?? 'Tender');
        return lateReply(reply, req);
      }
      return reply.status(201).send(out);
    },
  );

  reg('POST', '/supplier/tenders/{id}/submission/withdraw');
  app.post(
    `${p}/supplier/tenders/:id/submission/withdraw`,
    { preHandler: guard(d, ['SUPPLIER']) },
    async (req) => {
      const a = req.auth!;
      const id = tid(req);
      await fresh();
      return asSupplier(a, id, async (tx, l) => {
        if (!svc.isOpen(l.tender))
          throw new AppError(409, 'BID_CLOSED', 'The tender is closed, so a bid can no longer be changed');
        const [sub] = await tx
          .select()
          .from(submission)
          .where(
            and(
              eq(submission.tenderId, id),
              eq(submission.supplierId, a.user.supplierId!),
              ne(submission.status, 'DRAFT'),
            ),
          );
        if (!sub || sub.status !== 'SUBMITTED')
          throw new AppError(409, 'INVALID_STATE', 'There is no submitted bid to withdraw');
        await tx
          .update(submission)
          .set({ status: 'DRAFT', receipt: null, submittedAt: null })
          .where(eq(submission.id, sub.id));
        await d.audit.record(tx, a.ctx, {
          action: 'submission.withdraw',
          entityType: 'submission',
          entityId: sub.id,
          before: { status: 'SUBMITTED', receipt: sub.receipt },
          after: { status: 'DRAFT' },
        });
        return svc.supplierView(tx, a, l);
      });
    },
  );

  return done;
}
