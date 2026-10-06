/**
 * Approve from an emailed link without a full sign-in (NFR-U05). A delegate is sent a one-time link that opens a summary
 * checklist for that one procurement. Deciding goes through the same decision route as a signed-in approval, so the
 * delegation limit, separation of duties and the step-up code all still apply; the link only replaces the sign-in.
 * Commercial information is withheld unless the organisation chooses to show it.
 */
import { isForeign } from '../b9/fx-rules.js';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { COOKIE_NAMES } from '../../auth/session-service.js';
import { withContext, withSystem, type Tx } from '../../db/client.js';
import {
  appUser,
  approval,
  approvalLink,
  coiDeclaration,
  evalReport,
  evaluation,
  fieldValue,
  notification,
  panelMember,
  plan,
  request,
  roleAssignment,
  tender,
} from '../../db/schema.js';
import { checkDelegation } from '../../authz/delegation.js';
import { AppError, parse } from '../../http/errors.js';
import { loadSettings } from '../settings/settings.js';

export interface LinkDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
}
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/** Gives each approver a one-time link in their notifications. The link is never written to the email log or returned to the sender. */
export async function issueApprovalLinks(
  tx: Tx,
  clock: Clock,
  tenantId: string,
  subject: { type: 'PLAN' | 'EVAL_REPORT'; id: string; label: string },
  userIds: string[],
) {
  const s = await loadSettings(tx, tenantId);
  if (!s.approvalLinks.enabled) return 0;
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + s.approvalLinks.validHours * 3_600_000);
  for (const userId of new Set(userIds)) {
    const token = randomBytes(24).toString('base64url');
    // an older link for the same subject and person no longer works
    await tx
      .update(approvalLink)
      .set({ usedAt: now })
      .where(
        and(
          eq(approvalLink.userId, userId),
          eq(approvalLink.subjectId, subject.id),
          isNull(approvalLink.usedAt),
        ),
      );
    await tx.insert(approvalLink).values({
      tenantId,
      tokenHash: hash(token),
      userId,
      subjectType: subject.type,
      subjectId: subject.id,
      expiresAt,
      createdAt: now,
    });
    await tx.insert(notification).values({
      tenantId,
      userId,
      title: 'Approve without signing in',
      body: `${subject.label}. This link works once and expires in ${s.approvalLinks.validHours} hours.`,
      link: `/approve/${token}`,
    });
  }
  return new Set(userIds).size;
}

/** Delegates and executives, for a plan that has just become ready for approval. */
export async function approvers(tx: Tx, tenantId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: roleAssignment.userId })
    .from(roleAssignment)
    .where(and(eq(roleAssignment.tenantId, tenantId), inArray(roleAssignment.role, ['DELEGATE', 'EXEC'])));
  return [...new Set(rows.map((r) => r.id))];
}

const decisionBody = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    comment: z.string().trim().max(1000).optional(),
    code: z.string().trim().max(12).optional(),
  })
  .strict();
const tokenParam = z.object({ token: z.string().min(20).max(80) });

export function registerApprovalLinks(app: FastifyInstance, p: string, d: LinkDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const limit = { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } };

  async function find(token: string) {
    const [l] = await withSystem(d.database, (tx) =>
      tx
        .select()
        .from(approvalLink)
        .where(eq(approvalLink.tokenHash, hash(token))),
    );
    if (!l || l.usedAt || l.expiresAt <= d.clock.now())
      throw new AppError(
        404,
        'NOT_FOUND',
        'This link has expired or was already used. Sign in to the portal to decide, or ask for a new link.',
      );
    return l;
  }

  /** The checklist for this one procurement: what is done, what is not, and whether the amount is within this person's authority. */
  async function summary(l: typeof approvalLink.$inferSelect) {
    return withSystem(d.database, async (tx) => {
      const s = await loadSettings(tx, l.tenantId);
      const [u] = await tx.select().from(appUser).where(eq(appUser.id, l.userId));
      const roles = (
        await tx
          .select({ r: roleAssignment.role })
          .from(roleAssignment)
          .where(eq(roleAssignment.userId, l.userId))
      ).map((x) => x.r);
      let reqRow: typeof request.$inferSelect | undefined;
      const checks: Array<{ label: string; ok: boolean; note?: string }> = [];
      let waiting: boolean;
      let kind: string;
      if (l.subjectType === 'PLAN') {
        kind = 'Procurement plan';
        const [pl] = await tx.select().from(plan).where(eq(plan.id, l.subjectId));
        const [r] = pl ? await tx.select().from(request).where(eq(request.id, pl.requestId)) : [];
        reqRow = r;
        waiting = pl?.status === 'AWAITING_APPROVAL';
        const missing = await tx
          .select({ id: fieldValue.id })
          .from(fieldValue)
          .where(
            and(
              eq(fieldValue.ownerType, 'PLAN'),
              eq(fieldValue.ownerId, l.subjectId),
              eq(fieldValue.missing, true),
            ),
          );
        checks.push({
          label: 'Every section of the plan is complete',
          ok: missing.length === 0,
          note: missing.length ? `${missing.length} section(s) still missing` : undefined,
        });
        const risk = await tx
          .select({ id: approval.id })
          .from(approval)
          .where(
            and(
              eq(approval.subjectType, 'PLAN_RISK'),
              eq(approval.subjectId, l.subjectId),
              eq(approval.decision, 'APPROVED'),
            ),
          );
        checks.push({ label: 'The risk officer has signed off', ok: risk.length > 0 });
        const coi = await tx
          .select({ disp: coiDeclaration.disposition })
          .from(coiDeclaration)
          .where(and(eq(coiDeclaration.scope, 'PLAN'), eq(coiDeclaration.scopeId, l.subjectId)));
        checks.push({
          label: 'Conflict of interest declarations are settled',
          ok: coi.length > 0 && coi.every((c) => c.disp !== 'PENDING'),
        });
        if (reqRow)
          checks.push({
            label: 'The budget check is clear',
            ok: reqRow.budgetCheck === 'CLEARED' || reqRow.budgetCheck === 'UNAVAILABLE',
            note: reqRow.budgetCheck === 'UNAVAILABLE' ? 'ERP budget check was not available' : undefined,
          });
      } else {
        kind = 'Evaluation report';
        const [rep] = await tx.select().from(evalReport).where(eq(evalReport.id, l.subjectId));
        waiting = rep?.status === 'AWAITING_APPROVAL';
        const [ev] = rep ? await tx.select().from(evaluation).where(eq(evaluation.id, rep.evaluationId)) : [];
        if (ev) {
          const [tn] = await tx
            .select({ requestId: tender.requestId })
            .from(tender)
            .where(eq(tender.id, ev.tenderId));
          const [r] = tn ? await tx.select().from(request).where(eq(request.id, tn.requestId)) : [];
          reqRow = r;
          const panel = await tx
            .select({ at: panelMember.scoredAt })
            .from(panelMember)
            .where(eq(panelMember.evaluationId, ev.id));
          checks.push({
            label: 'Every panel member has finished scoring',
            ok: panel.length > 0 && panel.every((m) => m.at !== null),
          });
          const sign = await tx
            .select({ id: approval.id })
            .from(approval)
            .where(
              and(
                eq(approval.subjectType, 'EVAL_PROBITY'),
                eq(approval.subjectId, ev.id),
                eq(approval.decision, 'APPROVED'),
              ),
            );
          checks.push({ label: 'The probity officer has signed off', ok: sign.length > 0 });
        }
      }
      const value = Number(reqRow?.estimatedValue ?? 0);
      const del = await checkDelegation(
        tx,
        { tenantId: l.tenantId, userId: l.userId, roles },
        'SOURCING_APPROVAL',
        value,
        null,
        isForeign(reqRow?.currency),
      );
      checks.push({ label: 'The amount is within your approval authority', ok: del.allowed });
      return {
        kind,
        approver: u?.name ?? '',
        procurement: reqRow ? { number: reqRow.number, title: reqRow.title } : null,
        waiting,
        // dollar values are commercial information: shown only if the organisation chose to
        value: s.approvalLinks.showCommercial ? aud.format(value) : null,
        valueWithheld: !s.approvalLinks.showCommercial,
        checks,
        canApprove: waiting && del.allowed,
        stepUpRequired: s.security.stepUpApprovals,
        expiresAt: l.expiresAt.toISOString(),
        openInPortal: l.subjectType === 'PLAN' && reqRow ? `/app/plans/${reqRow.id}` : null,
      };
    });
  }
  reg('GET', '/approval-links/{token}');
  app.get(`${p}/approval-links/:token`, { preHandler: guard(d, 'public'), ...limit }, async (req) => {
    const { token } = parse(tokenParam, req.params);
    return summary(await find(token));
  });

  reg('POST', '/approval-links/{token}/decision');
  app.post(
    `${p}/approval-links/:token/decision`,
    { preHandler: guard(d, 'public'), ...limit },
    async (req, reply) => {
      const { token } = parse(tokenParam, req.params);
      const body = parse(decisionBody, req.body);
      const l = await find(token);
      const s = await summary(l);
      if (!s.waiting) throw new AppError(409, 'INVALID_STATE', 'This is no longer waiting for approval');
      // a short-lived session for this person, used for this one decision and then ended
      const sess = await d.sessions.createFor(l.userId, { userAgent: 'approval-link' });
      if (!sess) throw new AppError(404, 'NOT_FOUND', 'This link is not valid any more');
      try {
        const url =
          l.subjectType === 'PLAN'
            ? `${p}/plans/${l.subjectId}/decision`
            : `${p}/evaluation-reports/${l.subjectId}/decision`;
        const res = await app.inject({
          method: 'POST',
          url,
          headers: {
            cookie: `${COOKIE_NAMES.STAFF}=${sess.cookieValue}`,
            'x-csrf-token': sess.csrf,
            'content-type': 'application/json',
            ...(body.code ? { 'x-step-up-code': body.code } : {}),
          },
          payload: { decision: body.decision, ...(body.comment ? { comment: body.comment } : {}) },
        });
        if (res.statusCode >= 400)
          return reply.status(res.statusCode).type('application/json').send(res.body);
        const now = d.clock.now();
        await withContext(
          d.database,
          { tenantId: l.tenantId, userId: l.userId, role: 'SYSTEM' },
          async (tx) => {
            await tx.update(approvalLink).set({ usedAt: now }).where(eq(approvalLink.id, l.id));
            await tx
              .update(approvalLink)
              .set({ usedAt: now })
              .where(and(eq(approvalLink.subjectId, l.subjectId), isNull(approvalLink.usedAt)));
            await d.audit.record(
              tx,
              { tenantId: l.tenantId, userId: l.userId, role: 'SYSTEM' },
              {
                action: 'approval.link_used',
                entityType: l.subjectType === 'PLAN' ? 'plan' : 'evaluation_report',
                entityId: l.subjectId,
                after: { decision: body.decision, withoutSignIn: true },
              },
            );
          },
        );
        return { decided: true, decision: body.decision };
      } finally {
        await d.sessions.revoke(sess.id);
      }
    },
  );
  return done;
}
