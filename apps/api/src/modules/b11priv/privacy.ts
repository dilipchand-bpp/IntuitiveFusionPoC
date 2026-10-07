/**
 * SEC-D08: Privacy Act handling. Collection notices, and access and correction requests.
 *
 * A person asks to see (ACCESS) or correct (CORRECTION) the personal information held about them. The request has a
 * due date (settings: `privacy.responseDays`, 30 by default, counted with the Clock), an owner, and one of four states:
 * RECEIVED, IN_PROGRESS, COMPLETED, REFUSED (a refusal needs a reason). An overdue request is flagged and escalated
 * once to the privacy officer (settings: `privacy.officerRole`).
 *
 * For an access request the system assembles a JSON export of the person's own records. Identity comes first: the
 * request is verified when the requester is signed in as the subject, or when staff record how they checked identity.
 * A correction updates an allowed profile field (name, email) with a before and after audit.
 */
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import {
  appUser,
  auditEvent,
  chatMessage,
  conversation,
  lesson,
  notification,
  orgUnit,
  privacyNoticeAck,
  privacyRequest,
  request,
  reviewNote,
  roleAssignment,
} from '../../db/schema.js';
import type { NoticeContext } from '../../db/schema-b11b.js';
import { AppError } from '../../http/errors.js';
import { addDays, iso } from '../contract/dates.js';
import { loadSettings } from '../settings/settings.js';
import { outboundClock } from './outbound.js';

export type PrivacyRequestRow = typeof privacyRequest.$inferSelect;
export const MANAGERS = ['ADMIN', 'LEGAL', 'PROBITY'] as const;
export const OPEN_STATES = ['RECEIVED', 'IN_PROGRESS'] as const;
export const CORRECTABLE = ['name', 'email'] as const;

export async function nextNumber(tx: Tx, tenantId: string): Promise<string> {
  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(privacyRequest)
    .where(eq(privacyRequest.tenantId, tenantId));
  return `PRV-${String(Number(n) + 1).padStart(4, '0')}`;
}

export interface NewRequest {
  kind: 'ACCESS' | 'CORRECTION';
  details: string;
  correctionField?: 'name' | 'email' | undefined;
  correctionValue?: string | undefined;
  channel: 'SELF' | 'STAFF_LOGGED';
  requesterUserId: string | null;
  requesterName: string;
  requesterEmail: string;
  lodgedBy: string;
  /** Staff-logged requests: how identity was checked, if it already has been. */
  verificationMethod?: string | undefined;
}

export async function lodgeRequest(
  tx: Tx,
  ctx: RequestContext,
  input: NewRequest,
): Promise<PrivacyRequestRow> {
  const clock = outboundClock();
  const now = clock.now();
  const s = await loadSettings(tx, ctx.tenantId);
  if (input.kind === 'CORRECTION' && (!input.correctionField || !input.correctionValue))
    throw new AppError(
      422,
      'VALIDATION_FAILED',
      'A correction request names the field and the corrected value',
      [{ field: 'correctionField', message: 'Say which field is wrong and what it should be' }],
    );
  const self = input.channel === 'SELF';
  const [row] = await tx
    .insert(privacyRequest)
    .values({
      tenantId: ctx.tenantId,
      number: await nextNumber(tx, ctx.tenantId),
      kind: input.kind,
      requesterUserId: input.requesterUserId,
      requesterName: input.requesterName,
      requesterEmail: input.requesterEmail.toLowerCase(),
      channel: input.channel,
      lodgedBy: input.lodgedBy,
      details: input.details,
      correctionField: input.kind === 'CORRECTION' ? (input.correctionField ?? null) : null,
      correctionValue: input.kind === 'CORRECTION' ? (input.correctionValue ?? null) : null,
      dueDate: addDays(iso(now), s.privacy.responseDays),
      // signed in as the subject is the verification; for a caller, staff record how they checked
      identityVerified: self || Boolean(input.verificationMethod),
      verificationMethod: self
        ? 'Signed in as the person the request is about'
        : (input.verificationMethod ?? null),
      verifiedBy: self ? input.lodgedBy : input.verificationMethod ? input.lodgedBy : null,
      verifiedAt: self || input.verificationMethod ? now : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await new AuditService(clock).record(tx, ctx, {
    action: 'privacy.request_lodged',
    entityType: 'privacy_request',
    entityId: row!.id,
    after: { number: row!.number, kind: row!.kind, channel: row!.channel, dueDate: row!.dueDate },
  });
  return row!;
}

export const isOverdue = (r: Pick<PrivacyRequestRow, 'status' | 'dueDate'>, now: Date) =>
  (OPEN_STATES as readonly string[]).includes(r.status) && r.dueDate < iso(now);

export async function namesOf(tx: Tx, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!uniq.length) return new Map();
  const rows = await tx
    .select({ id: appUser.id, name: appUser.name })
    .from(appUser)
    .where(inArray(appUser.id, uniq));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export function requestView(r: PrivacyRequestRow, names: Map<string, string>, now: Date) {
  return {
    id: r.id,
    number: r.number,
    kind: r.kind,
    status: r.status,
    requesterName: r.requesterName,
    requesterEmail: r.requesterEmail,
    channel: r.channel,
    details: r.details,
    correctionField: r.correctionField,
    correctionValue: r.correctionValue,
    correctionApplied: r.correctionApplied,
    dueDate: r.dueDate,
    overdue: isOverdue(r, now),
    escalatedAt: r.escalatedAt?.toISOString() ?? null,
    assignedTo: r.assignedTo ? { id: r.assignedTo, name: names.get(r.assignedTo) ?? null } : null,
    identityVerified: r.identityVerified,
    verificationMethod: r.verificationMethod,
    verifiedBy: r.verifiedBy ? (names.get(r.verifiedBy) ?? null) : null,
    responseSummary: r.responseSummary,
    refusalReason: r.refusalReason,
    exportGeneratedAt: r.exportGeneratedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

/** Escalates each overdue request once to the privacy officer role. Returns how many were escalated. */
export async function escalateOverdue(tx: Tx, tenantId: string, actorId: string | null): Promise<number> {
  const clock = outboundClock();
  const now = clock.now();
  const s = await loadSettings(tx, tenantId);
  const rows = await tx
    .select()
    .from(privacyRequest)
    .where(
      and(
        eq(privacyRequest.tenantId, tenantId),
        inArray(privacyRequest.status, [...OPEN_STATES]),
        lt(privacyRequest.dueDate, iso(now)),
        isNull(privacyRequest.escalatedAt),
      ),
    );
  if (!rows.length) return 0;
  const officers = await tx
    .select({ userId: roleAssignment.userId })
    .from(roleAssignment)
    .where(and(eq(roleAssignment.tenantId, tenantId), eq(roleAssignment.role, s.privacy.officerRole)));
  const audit = new AuditService(clock);
  const ctx: RequestContext = { tenantId, userId: actorId, role: actorId ? null : 'SYSTEM' };
  for (const r of rows) {
    await tx
      .update(privacyRequest)
      .set({ escalatedAt: now, updatedAt: now })
      .where(eq(privacyRequest.id, r.id));
    for (const o of officers)
      await tx.insert(notification).values({
        tenantId,
        userId: o.userId,
        title: `Privacy request ${r.number} is overdue`,
        body: `The ${r.kind.toLowerCase()} request from ${r.requesterName} was due on ${r.dueDate} and is still ${r.status.toLowerCase().replace('_', ' ')}.`,
        link: '/app/privacy/manage',
        event: 'PRIVACY_OVERDUE',
        read: false,
      });
    await audit.record(tx, ctx, {
      action: 'privacy.request_overdue_escalated',
      entityType: 'privacy_request',
      entityId: r.id,
      after: { number: r.number, dueDate: r.dueDate, escalatedTo: s.privacy.officerRole },
    });
  }
  return rows.length;
}

/** The person's own records, assembled for an access request. Others' private notes and other people's data are not included. */
export async function buildExport(tx: Tx, tenantId: string, r: PrivacyRequestRow) {
  const clock = outboundClock();
  const [user] = r.requesterUserId
    ? await tx
        .select()
        .from(appUser)
        .where(and(eq(appUser.tenantId, tenantId), eq(appUser.id, r.requesterUserId)))
    : await tx
        .select()
        .from(appUser)
        .where(and(eq(appUser.tenantId, tenantId), eq(appUser.email, r.requesterEmail)));
  const base = {
    format: 'if-privacy-access-export-v1',
    generatedAt: clock.now().toISOString(),
    request: { number: r.number, kind: r.kind, requester: r.requesterName, email: r.requesterEmail },
    note: 'Your own records only. Other people’s notes and data are not included. Synthetic data in this demonstration.',
  };
  if (!user)
    return {
      ...base,
      found: false,
      message: 'No account is held for this person, so there are no account records to export.',
    };
  const unit = user.orgUnitId
    ? ((await tx.select({ n: orgUnit.name }).from(orgUnit).where(eq(orgUnit.id, user.orgUnitId)))[0]?.n ??
      null)
    : null;
  const roles = await tx
    .select({ role: roleAssignment.role, expiresAt: roleAssignment.expiresAt })
    .from(roleAssignment)
    .where(eq(roleAssignment.userId, user.id));
  const requests = await tx
    .select()
    .from(request)
    .where(and(eq(request.tenantId, tenantId), eq(request.requesterId, user.id)))
    .orderBy(asc(request.createdAt));
  // only notes this person wrote: never someone else's, private or not
  const notes = await tx
    .select()
    .from(reviewNote)
    .where(and(eq(reviewNote.tenantId, tenantId), eq(reviewNote.authorId, user.id)))
    .orderBy(asc(reviewNote.createdAt));
  const lessons = await tx
    .select()
    .from(lesson)
    .where(and(eq(lesson.tenantId, tenantId), eq(lesson.authorId, user.id)))
    .orderBy(asc(lesson.createdAt));
  const notes2 = await tx
    .select()
    .from(notification)
    .where(and(eq(notification.tenantId, tenantId), eq(notification.userId, user.id)))
    .orderBy(asc(notification.createdAt));
  const events = await tx
    .select({
      at: auditEvent.at,
      action: auditEvent.action,
      entityType: auditEvent.entityType,
      entityId: auditEvent.entityId,
      result: auditEvent.result,
    })
    .from(auditEvent)
    .where(and(eq(auditEvent.tenantId, tenantId), eq(auditEvent.actorId, user.id)))
    .orderBy(desc(auditEvent.seq))
    .limit(2000);
  const acks = await tx
    .select()
    .from(privacyNoticeAck)
    .where(and(eq(privacyNoticeAck.tenantId, tenantId), eq(privacyNoticeAck.userId, user.id)));
  const convs = await tx
    .select()
    .from(conversation)
    .where(and(eq(conversation.tenantId, tenantId), eq(conversation.userId, user.id)));
  const messages = convs.length
    ? await tx
        .select()
        .from(chatMessage)
        .where(
          inArray(
            chatMessage.conversationId,
            convs.map((c) => c.id),
          ),
        )
        .orderBy(asc(chatMessage.createdAt))
    : [];
  const mine = await tx
    .select()
    .from(privacyRequest)
    .where(
      and(
        eq(privacyRequest.tenantId, tenantId),
        or(eq(privacyRequest.requesterUserId, user.id), eq(privacyRequest.requesterEmail, user.email)),
      ),
    );
  return {
    ...base,
    found: true,
    profile: {
      name: user.name,
      email: user.email,
      orgUnit: unit,
      active: user.active,
      external: user.external,
      supplierContact: Boolean(user.supplierId),
      createdAt: user.createdAt.toISOString(),
      roles: roles.map((x) => ({ role: x.role, expiresAt: x.expiresAt?.toISOString() ?? null })),
    },
    requestsRaised: requests.map((q) => ({
      number: q.number,
      title: q.title,
      phase: q.phase,
      status: q.status,
      estimatedValue: q.estimatedValue,
      createdAt: q.createdAt.toISOString(),
    })),
    notesWritten: notes.map((n) => ({
      visibility: n.visibility,
      text: n.text,
      at: n.createdAt.toISOString(),
    })),
    lessonsWritten: lessons.map((l) => ({ kind: l.kind, text: l.text, at: l.createdAt.toISOString() })),
    notifications: notes2.map((n) => ({
      title: n.title,
      body: n.body,
      read: n.read,
      at: n.createdAt.toISOString(),
    })),
    activity: events.map((e) => ({ ...e, at: e.at.toISOString() })),
    privacyNoticeAcknowledgements: acks.map((a) => ({
      context: a.context,
      version: a.version,
      at: a.acknowledgedAt.toISOString(),
    })),
    intakeConversations: convs.map((c) => ({
      id: c.id,
      startedAt: c.createdAt.toISOString(),
      messages: messages
        .filter((m) => m.conversationId === c.id)
        .map((m) => ({ role: m.role, text: m.text, at: m.createdAt.toISOString() })),
    })),
    privacyRequests: mine.map((p) => ({
      number: p.number,
      kind: p.kind,
      status: p.status,
      dueDate: p.dueDate,
    })),
  };
}

/** Applies a verified correction to the person's profile, with a before and after audit. */
export async function applyCorrection(tx: Tx, ctx: RequestContext, r: PrivacyRequestRow): Promise<void> {
  if (r.kind !== 'CORRECTION' || !r.correctionField || !r.correctionValue)
    throw new AppError(409, 'NOT_A_CORRECTION', 'This request is not a correction with a field and value');
  if (!r.identityVerified)
    throw new AppError(409, 'IDENTITY_NOT_VERIFIED', 'Verify the requester’s identity first');
  if (r.correctionApplied)
    throw new AppError(409, 'ALREADY_APPLIED', 'The correction has already been applied');
  const clock = outboundClock();
  const [user] = r.requesterUserId
    ? await tx
        .select()
        .from(appUser)
        .where(and(eq(appUser.tenantId, ctx.tenantId), eq(appUser.id, r.requesterUserId)))
    : await tx
        .select()
        .from(appUser)
        .where(and(eq(appUser.tenantId, ctx.tenantId), eq(appUser.email, r.requesterEmail)));
  if (!user)
    throw new AppError(
      404,
      'NO_ACCOUNT',
      'No account is held for this person, so there is no profile to correct',
    );
  const field = r.correctionField;
  const value = field === 'email' ? r.correctionValue.trim().toLowerCase() : r.correctionValue.trim();
  if (field === 'email') {
    const [clash] = await tx
      .select({ id: appUser.id })
      .from(appUser)
      .where(and(eq(appUser.tenantId, ctx.tenantId), eq(appUser.email, value)));
    if (clash && clash.id !== user.id)
      throw new AppError(409, 'EMAIL_IN_USE', 'Another account already uses that email address');
  }
  const before = { [field]: user[field] };
  await tx
    .update(appUser)
    .set({ [field]: value, updatedAt: clock.now() })
    .where(eq(appUser.id, user.id));
  await new AuditService(clock).record(tx, ctx, {
    action: 'privacy.correction_applied',
    entityType: 'app_user',
    entityId: user.id,
    before,
    after: { [field]: value },
  });
  await tx
    .update(privacyRequest)
    .set({ correctionApplied: true, updatedAt: clock.now() })
    .where(eq(privacyRequest.id, r.id));
}

/** Records that a person saw and accepted the current collection notice in a place. One row per user, place and version. */
export async function acknowledgeNotice(
  tx: Tx,
  tenantId: string,
  userId: string,
  context: NoticeContext,
): Promise<{ version: string; acknowledgedAt: string; already: boolean }> {
  const s = await loadSettings(tx, tenantId);
  const now = outboundClock().now();
  const [row] = await tx
    .insert(privacyNoticeAck)
    .values({ tenantId, userId, context, version: s.privacy.noticeVersion, acknowledgedAt: now })
    .onConflictDoNothing()
    .returning();
  if (row) return { version: row.version, acknowledgedAt: row.acknowledgedAt.toISOString(), already: false };
  const [prev] = await tx
    .select()
    .from(privacyNoticeAck)
    .where(
      and(
        eq(privacyNoticeAck.userId, userId),
        eq(privacyNoticeAck.context, context),
        eq(privacyNoticeAck.version, s.privacy.noticeVersion),
      ),
    );
  return { version: prev!.version, acknowledgedAt: prev!.acknowledgedAt.toISOString(), already: true };
}
