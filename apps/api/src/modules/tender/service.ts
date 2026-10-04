import { and, asc, desc, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import type { Clock, RoleName } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import type { AuthContext } from '../../auth/guard.js';
import { withSystem, type Database, type RequestContext, type Tx } from '../../db/client.js';
import {
  addendum,
  appUser,
  approval,
  fieldValue,
  fileObject,
  invitation,
  latePermission,
  notification,
  plan,
  question,
  request,
  roleAssignment,
  submission,
  supplier,
  tender,
} from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { insuranceStatusFor } from './insurance.js';
import { applyLayout, loadLayout } from '../collab/routes.js';
import { TENDER_FIELDS } from './fields.js';
import type { SealedStore } from './files.js';
import { effectiveStatus, isOpenForBids, type TenderStatus } from './rules.js';
import { addendumView, fileView, questionView } from './serialisers.js';

export type TenderRow = typeof tender.$inferSelect;
type ReqRow = typeof request.$inferSelect;

export interface LoadedTender {
  tender: TenderRow;
  req: ReqRow;
}

const SYSTEM = (tenantId: string): RequestContext => ({ tenantId, userId: null, role: 'SYSTEM' });

export class TenderService {
  constructor(
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly store: SealedStore,
  ) {}

  // ------------------------------------------------------------------ loading
  async load(tx: Tx, tenantId: string, id: string): Promise<LoadedTender | null> {
    const [t] = await tx
      .select()
      .from(tender)
      .where(and(eq(tender.id, id), eq(tender.tenantId, tenantId)));
    if (!t) return null;
    const [req] = await tx.select().from(request).where(eq(request.id, t.requestId));
    return { tender: t, req: req! };
  }

  status(t: TenderRow): TenderStatus {
    return effectiveStatus(t.status, t.closesAt, this.clock.now());
  }
  isOpen(t: TenderRow): boolean {
    return isOpenForBids(t.status, t.closesAt, this.clock.now());
  }

  async notifyRoles(
    tx: Tx,
    tenantId: string,
    roles: RoleName[],
    title: string,
    body: string,
    link: string,
  ): Promise<void> {
    const users = await tx
      .select({ userId: roleAssignment.userId })
      .from(roleAssignment)
      .where(and(eq(roleAssignment.tenantId, tenantId), inArray(roleAssignment.role, roles)));
    for (const u of new Set(users.map((x) => x.userId)))
      await tx.insert(notification).values({ tenantId, userId: u, title, body, link });
  }

  /** Every user belonging to suppliers that can see this tender (invited, or any supplier for an open tender). */
  async supplierUserIds(tx: Tx, t: TenderRow): Promise<string[]> {
    if (t.access === 'OPEN') {
      const rows = await tx
        .select({ id: appUser.id })
        .from(appUser)
        .where(and(eq(appUser.tenantId, t.tenantId)));
      const sup = await tx
        .select({ id: roleAssignment.userId })
        .from(roleAssignment)
        .where(eq(roleAssignment.role, 'SUPPLIER'));
      const set = new Set(sup.map((s) => s.id));
      return rows.map((r) => r.id).filter((id) => set.has(id));
    }
    const invs = await tx
      .select({ supplierId: invitation.supplierId })
      .from(invitation)
      .where(eq(invitation.tenderId, t.id));
    const ids = invs.map((i) => i.supplierId).filter((x): x is string => Boolean(x));
    if (ids.length === 0) return [];
    const users = await tx.select({ id: appUser.id, supplierId: appUser.supplierId }).from(appUser);
    return users.filter((u) => u.supplierId && ids.includes(u.supplierId)).map((u) => u.id);
  }

  // ------------------------------------------------------------------ automatic close (US-SUP-04)
  /**
   * Closes every published tender whose closing time has passed, discards bids that were started but never
   * submitted, and tells the people affected. Runs as the system in its own transaction, before any read or
   * write that depends on tender state, and can equally be run by a scheduler.
   */
  async closeDue(database: Database): Promise<number> {
    const now = this.clock.now();
    const doomed: string[] = [];
    const n = await withSystem(database, async (tx) => {
      const due = await tx
        .select()
        .from(tender)
        .where(and(eq(tender.status, 'PUBLISHED'), lte(tender.closesAt, now)));
      for (const t of due) {
        const ctx = SYSTEM(t.tenantId);
        await tx
          .update(tender)
          .set({ status: 'CLOSED', updatedAt: now, version: t.version + 1 })
          .where(eq(tender.id, t.id));
        const subs = await tx.select().from(submission).where(eq(submission.tenderId, t.id));
        const sent = subs.filter((s) => s.status === 'SUBMITTED').length;
        for (const s of subs.filter((x) => x.status === 'DRAFT')) {
          const files = await tx.select().from(fileObject).where(eq(fileObject.submissionId, s.id));
          doomed.push(...files.map((f) => f.storageKey));
          await tx.delete(fileObject).where(eq(fileObject.submissionId, s.id));
          await tx.update(submission).set({ status: 'REJECTED_LATE' }).where(eq(submission.id, s.id));
          const users = await tx
            .select({ id: appUser.id })
            .from(appUser)
            .where(eq(appUser.supplierId, s.supplierId));
          for (const u of users)
            await tx.insert(notification).values({
              tenantId: t.tenantId,
              userId: u.id,
              title: 'Tender closed: your bid was not submitted',
              body: 'The closing time passed before you pressed Submit, so your draft files were discarded.',
              link: `/supplier/tenders/${t.id}`,
            });
        }
        await this.audit.record(tx, ctx, {
          action: 'tender.close',
          entityType: 'tender',
          entityId: t.id,
          before: { status: 'PUBLISHED' },
          after: { status: 'CLOSED', reason: 'CLOSING_TIME_REACHED', submitted: sent },
        });
        const [req] = await tx.select().from(request).where(eq(request.id, t.requestId));
        await this.notifyRoles(
          tx,
          t.tenantId,
          ['PROCUREMENT'],
          'Tender closed',
          `${req?.number ?? ''} ${req?.title ?? ''}: ${sent} bid(s) received`,
          `/app/tenders/${t.id}`,
        );
      }
      return due.length;
    });
    for (const k of doomed) await this.store.remove(k);
    return n;
  }

  // ------------------------------------------------------------------ pack
  async fields(tx: Tx, tenderId: string) {
    const rows = await tx
      .select()
      .from(fieldValue)
      .where(and(eq(fieldValue.ownerType, 'TENDER'), eq(fieldValue.ownerId, tenderId)));
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const [owner] = await tx.select({ t: tender.tenantId }).from(tender).where(eq(tender.id, tenderId));
    const layout = owner ? await loadLayout(tx, owner.t, 'RFX') : null;
    return (layout ? applyLayout([...TENDER_FIELDS], layout) : TENDER_FIELDS).map((def) => {
      const r = byKey.get(def.key);
      return {
        key: def.key,
        label: def.label,
        rev: r?.rev ?? 0,
        value: r?.value ?? '',
        paragraphs: (r?.value ?? '').split(/\n{2,}/).filter(Boolean),
        source: (r?.source ?? 'SYSTEM') as string,
        aiDrafted: false,
        ...(r ? { updatedAt: r.updatedAt.toISOString() } : {}),
      };
    });
  }

  // ------------------------------------------------------------------ views
  /**
   * Staff see every question. A supplier sees the answers published to everyone, and the answers given to them alone
   * (FR-0195); never another supplier's single answer.
   */
  async questionRows(tx: Tx, tenderId: string, onlyPublished: boolean, forSupplierId?: string | null) {
    const rows = await tx
      .select()
      .from(question)
      .where(eq(question.tenderId, tenderId))
      .orderBy(asc(question.askedAt));
    return rows
      .filter((q) => !onlyPublished || q.status === 'PUBLISHED')
      .filter(
        (q) =>
          !onlyPublished || q.audience === 'ALL' || (forSupplierId && q.targetSupplierId === forSupplierId),
      )
      .map(questionView);
  }

  /**
   * May this supplier still bid? Yes while the tender is open, and after it closed only while a late-submission
   * permission granted to them (with a reason) is live, before evaluation has begun (FR-0205).
   */
  async canBid(tx: Tx, t: TenderRow, supplierId: string | null): Promise<boolean> {
    if (this.isOpen(t)) return true;
    if (!supplierId || this.status(t) !== 'CLOSED') return false;
    const [p] = await tx
      .select({ id: latePermission.id })
      .from(latePermission)
      .where(
        and(
          eq(latePermission.tenderId, t.id),
          eq(latePermission.supplierId, supplierId),
          isNull(latePermission.revokedAt),
          gt(latePermission.expiresAt, this.clock.now()),
        ),
      );
    return Boolean(p);
  }

  async addenda(tx: Tx, tenderId: string) {
    const rows = await tx
      .select()
      .from(addendum)
      .where(eq(addendum.tenderId, tenderId))
      .orderBy(asc(addendum.number));
    return rows.map(addendumView);
  }

  /** What the buying team sees. Bid content stays sealed: before close only a count, after close the receipts. */
  async staffView(tx: Tx, a: AuthContext, l: LoadedTender) {
    const t = l.tender;
    const status = this.status(t);
    const closed = status !== 'DRAFT' && status !== 'STAGED' && status !== 'PUBLISHED';
    const [perm] = t.publishPermissionId
      ? await tx.select().from(approval).where(eq(approval.id, t.publishPermissionId))
      : [];
    const [pl] = await tx.select().from(plan).where(eq(plan.requestId, t.requestId));
    const invites = await tx
      .select()
      .from(invitation)
      .where(eq(invitation.tenderId, t.id))
      .orderBy(asc(invitation.company));
    const now = this.clock.now();
    const subs = await tx
      .select({
        s: submission,
        company: supplier.company,
        sanctions: supplier.sanctionsStatus,
        insuranceOn: supplier.insuranceExpiresOn,
      })
      .from(submission)
      .leftJoin(supplier, eq(supplier.id, submission.supplierId))
      .where(eq(submission.tenderId, t.id));
    const submitted = subs.filter((x) => x.s.status === 'SUBMITTED');
    const roles = a.user.roles;
    const procurement = roles.includes('PROCUREMENT');
    const staged = status === 'STAGED';
    return {
      id: t.id,
      requestId: t.requestId,
      requestNumber: l.req.number,
      title: l.req.title,
      estimatedValue: Number(l.req.estimatedValue ?? 0),
      type: t.type,
      access: t.access,
      status,
      opensAt: t.opensAt?.toISOString() ?? null,
      closesAt: t.closesAt?.toISOString() ?? null,
      version: t.version,
      stage: t.stage,
      parentTenderId: t.parentTenderId,
      shortlisted: (t.shortlist as string[] | null) ?? null,
      planStatus: pl?.status ?? null,
      fields: await this.fields(tx, t.id),
      permission: perm
        ? { granted: true, by: perm.stamp ?? '', at: perm.decidedAt.toISOString() }
        : { granted: false },
      invitations: invites.map((i) => ({
        id: i.id,
        email: i.email,
        company: i.company,
        supplierId: i.supplierId,
        state: i.supplierId ? 'REGISTERED' : i.usedAt ? 'USED' : i.expiresAt <= now ? 'EXPIRED' : 'INVITED',
        expiresAt: i.expiresAt.toISOString(),
      })),
      questions: await this.questionRows(tx, t.id, false),
      addenda: await this.addenda(tx, t.id),
      submissions: {
        count: submitted.length,
        sealed: !closed,
        ...(closed
          ? {
              items: submitted.map((x) => ({
                supplierId: x.s.supplierId,
                company: x.company ?? '',
                // onboarding checks shared from the supplier's profile (FR-0250)
                sanctionsStatus: x.sanctions ?? 'PENDING',
                insuranceStatus: insuranceStatusFor(x.insuranceOn ?? null, now.toISOString().slice(0, 10)),
                receipt: x.s.receipt,
                submittedAt: x.s.submittedAt?.toISOString() ?? null,
              })),
            }
          : {}),
      },
      permissions: {
        canEdit: staged && (procurement || roles.includes('LEGAL')),
        canGrantPermission: staged && roles.includes('DELEGATE') && !perm,
        canPublish: staged && procurement && Boolean(perm),
        canInvite: procurement && (staged || status === 'PUBLISHED'),
        canAnswer: (procurement || roles.includes('LEGAL')) && status === 'PUBLISHED',
        canIssueAddendum: procurement && status === 'PUBLISHED',
      },
    };
  }

  /** What an invited supplier sees: the pack, published answers and addenda, and their own bid. Nothing about others. */
  async supplierView(tx: Tx, a: AuthContext, l: LoadedTender) {
    const t = l.tender;
    const status = this.status(t);
    const sid = a.user.supplierId;
    const [sub] = sid
      ? await tx
          .select()
          .from(submission)
          .where(and(eq(submission.tenderId, t.id), eq(submission.supplierId, sid)))
      : [];
    const files = sub
      ? await tx
          .select()
          .from(fileObject)
          .where(eq(fileObject.submissionId, sub.id))
          .orderBy(desc(fileObject.createdAt))
      : [];
    const now = this.clock.now();
    return {
      id: t.id,
      title: l.req.title,
      number: l.req.number,
      type: t.type,
      status,
      opensAt: t.opensAt?.toISOString() ?? null,
      closesAt: t.closesAt?.toISOString() ?? null,
      serverTime: now.toISOString(),
      fields: await this.fields(tx, t.id),
      questions: await this.questionRows(tx, t.id, true, sid),
      addenda: await this.addenda(tx, t.id),
      stage: t.stage,
      submission: {
        status: sub?.status ?? 'NOT_STARTED',
        receipt: sub?.receipt ?? null,
        submittedAt: sub?.submittedAt?.toISOString() ?? null,
        files: files.map(fileView),
      },
      canBid: await this.canBid(tx, t, sid ?? null),
      lateAccess: !this.isOpen(t) && (await this.canBid(tx, t, sid ?? null)),
    };
  }

  /** Tenders a supplier may see: those that name them (invitation) and every published open-access tender. */
  async visibleTo(tx: Tx, tenantId: string, supplierId: string | null): Promise<TenderRow[]> {
    const all = await tx
      .select()
      .from(tender)
      .where(
        and(
          eq(tender.tenantId, tenantId),
          inArray(tender.status, ['PUBLISHED', 'CLOSED', 'EVALUATING', 'AWARDED']),
        ),
      );
    if (!supplierId) return [];
    const mine = new Set(
      (
        await tx
          .select({ t: invitation.tenderId })
          .from(invitation)
          .where(eq(invitation.supplierId, supplierId))
      ).map((x) => x.t),
    );
    return all.filter((t) =>
      t.access === 'OPEN' ? t.status === 'PUBLISHED' || mine.has(t.id) : mine.has(t.id),
    );
  }

  /** A supplier's access to one tender: the row, or null when they may not see it (no audit here: see denyAccess). */
  async supplierAccess(tx: Tx, a: AuthContext, id: string): Promise<LoadedTender | null> {
    const l = await this.load(tx, a.user.tenantId, id);
    if (!l) return null;
    const visible = (await this.visibleTo(tx, a.user.tenantId, a.user.supplierId)).some((t) => t.id === id);
    return visible ? l : null;
  }

  /**
   * Logs the refused attempt and answers exactly like "no such tender". Must be called AFTER the request's
   * transaction has ended: the audit write opens its own, and a second concurrent transaction would deadlock a
   * single-connection database (and would be rolled back with the failed request otherwise).
   */
  async denyAccess(database: Database, a: AuthContext, id: string): Promise<never> {
    await this.audit.recordOutsideTx(database, a.ctx, {
      action: 'access.denied',
      entityType: 'tender',
      entityId: id,
      after: { reason: 'NOT_INVITED' },
      result: 'DENIED',
    });
    throw new AppError(404, 'NOT_FOUND', 'Tender not found');
  }
}
