import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Clock, RoleName } from '@if/shared';
import type { AiProvider } from '../../adapters/ai-provider.js';
import type { AuditService } from '../../audit/audit-service.js';
import type { AuthContext } from '../../auth/guard.js';
import { checkDelegation } from '../../authz/delegation.js';
import type { RequestContext, Tx } from '../../db/client.js';
import {
  appUser,
  approval,
  coiDeclaration,
  fieldValue,
  notification,
  plan,
  request,
  roleAssignment,
} from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { toView as requestView, valuesOf } from '../intake/service.js';
import { PLAN_FIELDS, PLAN_FIELD_BY_KEY, splitParagraphs } from './fields.js';
import { summarisePlan } from './summary.js';

export type PlanRow = typeof plan.$inferSelect;
type ReqRow = typeof request.$inferSelect;
type FieldRow = typeof fieldValue.$inferSelect;

export const EDITABLE: ReadonlyArray<PlanRow['status']> = ['DRAFT', 'REOPENED', 'REJECTED'];
/** Gates that actually hold up a plan. Other request gates (IT endorsement, legal review) are tracked outside the plan. */
export const PLAN_GATES = ['RISK_SIGNOFF', 'UPFRONT_COI'] as const;

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const UNDO_KEY = '_undo';

export interface Loaded {
  plan: PlanRow;
  req: ReqRow;
  reqFields: FieldRow[];
  planFields: FieldRow[];
}

export class PlanService {
  constructor(
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly ai: AiProvider,
  ) {}

  // ------------------------------------------------------------------ loading
  async load(tx: Tx, tenantId: string, planId: string): Promise<Loaded | null> {
    const [p] = await tx
      .select()
      .from(plan)
      .where(and(eq(plan.id, planId), eq(plan.tenantId, tenantId)));
    if (!p) return null;
    const [req] = await tx.select().from(request).where(eq(request.id, p.requestId));
    const reqFields = await tx
      .select()
      .from(fieldValue)
      .where(and(eq(fieldValue.ownerType, 'REQUEST'), eq(fieldValue.ownerId, p.requestId)));
    const planFields = await tx
      .select()
      .from(fieldValue)
      .where(and(eq(fieldValue.ownerType, 'PLAN'), eq(fieldValue.ownerId, p.id)));
    return { plan: p, req: req!, reqFields, planFields };
  }

  /** The plan for a request, created and populated from the intake the first time it is opened (US-PLN-01). */
  async ensure(tx: Tx, ctx: RequestContext, requestId: string): Promise<string> {
    const [req] = await tx
      .select()
      .from(request)
      .where(and(eq(request.id, requestId), eq(request.tenantId, ctx.tenantId)));
    if (!req) throw new AppError(404, 'NOT_FOUND', 'Request not found');
    if (req.status === 'DRAFT')
      throw new AppError(409, 'REQUEST_NOT_SUBMITTED', 'The request must be submitted before it has a plan');
    let [p] = await tx.select().from(plan).where(eq(plan.requestId, requestId));
    if (!p) {
      [p] = await tx
        .insert(plan)
        .values({
          tenantId: ctx.tenantId,
          requestId,
          status: 'DRAFT',
          createdAt: this.clock.now(),
          updatedAt: this.clock.now(),
        })
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'plan.create',
        entityType: 'plan',
        entityId: p!.id,
        after: { requestId, status: 'DRAFT' },
      });
    }
    const existing = await tx
      .select({ id: fieldValue.id })
      .from(fieldValue)
      .where(and(eq(fieldValue.ownerType, 'PLAN'), eq(fieldValue.ownerId, p!.id)));
    if (existing.length === 0) {
      const reqFields = await tx
        .select()
        .from(fieldValue)
        .where(and(eq(fieldValue.ownerType, 'REQUEST'), eq(fieldValue.ownerId, requestId)));
      const rv = requestView(req, reqFields);
      const draft = await this.ai.draftPlan({
        values: valuesOf(req, reqFields),
        complexity: (rv.complexity ?? 'LOW') as 'LOW',
        gateKeys: rv.gates.map((g) => g.key),
        today: this.clock.now(),
      });
      const now = this.clock.now();
      for (const def of PLAN_FIELDS) {
        await tx.insert(fieldValue).values({
          tenantId: ctx.tenantId,
          ownerType: 'PLAN',
          ownerId: p!.id,
          key: def.key,
          label: def.label,
          value: draft[def.key] ?? '',
          source: 'AI',
          aiDrafted: true,
          missing: false,
          updatedAt: now,
        });
      }
      await this.audit.record(tx, ctx, {
        action: 'plan.populate',
        entityType: 'plan',
        entityId: p!.id,
        after: { fields: PLAN_FIELDS.length, provider: this.ai.name, simulated: this.ai.simulated },
      });
    }
    return p!.id;
  }

  // ------------------------------------------------------------------ gates
  /** Which plan gates apply, whether each is met, and keeps the request's gate rows in step. */
  async evaluateGates(
    tx: Tx,
    l: Loaded,
  ): Promise<Array<{ key: string; label: string; reason: string; status: 'REQUIRED' | 'SATISFIED' }>> {
    const rv = requestView(l.req, l.reqFields);
    const required = rv.gates.filter((g) => (PLAN_GATES as readonly string[]).includes(g.key));
    if (required.length === 0) return [];
    const cois = await tx
      .select()
      .from(coiDeclaration)
      .where(and(eq(coiDeclaration.scope, 'PLAN'), eq(coiDeclaration.scopeId, l.plan.id)));
    const leads = cois.length
      ? await tx
          .select({ userId: roleAssignment.userId })
          .from(roleAssignment)
          .where(
            and(
              inArray(
                roleAssignment.userId,
                cois.map((c) => c.userId),
              ),
              eq(roleAssignment.role, 'PROCUREMENT'),
            ),
          )
      : [];
    const leadIds = new Set(leads.map((x) => x.userId));
    const coiOk =
      !cois.some((c) => c.disposition === 'PENDING') &&
      cois.some(
        (c) => leadIds.has(c.userId) && (c.disposition === 'IMMATERIAL' || c.disposition === 'MANAGEABLE'),
      );
    const [risk] = await tx
      .select()
      .from(approval)
      .where(
        and(
          eq(approval.subjectType, 'PLAN_RISK'),
          eq(approval.subjectId, l.plan.id),
          eq(approval.decision, 'APPROVED'),
        ),
      );
    const met: Record<string, boolean> = { UPFRONT_COI: coiOk, RISK_SIGNOFF: Boolean(risk) };
    const out = required.map((g) => ({
      ...g,
      status: met[g.key] ? ('SATISFIED' as const) : ('REQUIRED' as const),
    }));
    for (const g of out) {
      const key = `gate.${g.key}`;
      const set = { value: g.status, source: 'SYSTEM' as const, label: g.label, updatedAt: this.clock.now() };
      await tx
        .insert(fieldValue)
        .values({ tenantId: l.plan.tenantId, ownerType: 'REQUEST', ownerId: l.plan.requestId, key, ...set })
        .onConflictDoUpdate({ target: [fieldValue.ownerType, fieldValue.ownerId, fieldValue.key], set });
    }
    return out;
  }

  /** After anything that can satisfy a gate: move AWAITING_SIGNOFF -> AWAITING_APPROVAL when all gates are met. */
  async advance(tx: Tx, ctx: RequestContext, planId: string): Promise<void> {
    const l = (await this.load(tx, ctx.tenantId, planId))!;
    const gates = await this.evaluateGates(tx, l);
    if (l.plan.status === 'AWAITING_SIGNOFF' && gates.every((g) => g.status === 'SATISFIED')) {
      await tx
        .update(plan)
        .set({ status: 'AWAITING_APPROVAL', updatedAt: this.clock.now(), version: l.plan.version + 1 })
        .where(eq(plan.id, planId));
      await this.audit.record(tx, ctx, {
        action: 'plan.ready_for_approval',
        entityType: 'plan',
        entityId: planId,
        before: { status: 'AWAITING_SIGNOFF' },
        after: { status: 'AWAITING_APPROVAL' },
      });
      await this.notifyRoles(
        tx,
        ctx.tenantId,
        ['DELEGATE', 'EXEC'],
        'Plan awaiting your approval',
        `${l.req.number} ${l.req.title}`,
        `/app/plans/${l.req.id}`,
      );
    }
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

  // ------------------------------------------------------------------ editing
  assertEditable(p: PlanRow): void {
    if (p.locked)
      throw new AppError(
        423,
        'PLAN_LOCKED',
        'This plan is approved and locked. Procurement can reopen it with a reason.',
      );
    if (!EDITABLE.includes(p.status))
      throw new AppError(409, 'PLAN_NOT_EDITABLE', 'The plan is with approvers and cannot be edited now');
  }

  async writeField(
    tx: Tx,
    ctx: RequestContext,
    l: Loaded,
    key: string,
    value: string,
    source: 'USER' | 'AI',
    action: string,
  ): Promise<void> {
    const def = PLAN_FIELD_BY_KEY.get(key);
    if (!def)
      throw new AppError(400, 'VALIDATION_FAILED', 'Unknown plan field', [
        { field: key, message: 'Not a plan section' },
      ]);
    if (value.length > 8000)
      throw new AppError(400, 'VALIDATION_FAILED', 'Too long', [
        { field: key, message: 'Maximum 8000 characters' },
      ]);
    if (def.mandatory && value.trim() === '')
      throw new AppError(400, 'VALIDATION_FAILED', 'Required', [
        { field: key, message: `${def.label} cannot be empty` },
      ]);
    const existing = l.planFields.find((f) => f.key === key);
    const now = this.clock.now();
    const set = {
      value,
      source,
      aiDrafted: source === 'AI',
      missing: false,
      previousValue: existing?.value ?? null,
      updatedBy: source === 'AI' ? null : ctx.userId,
      updatedAt: now,
      label: def.label,
    };
    await tx
      .insert(fieldValue)
      .values({ tenantId: ctx.tenantId, ownerType: 'PLAN', ownerId: l.plan.id, key, ...set })
      .onConflictDoUpdate({ target: [fieldValue.ownerType, fieldValue.ownerId, fieldValue.key], set });
    await tx
      .update(plan)
      .set({ updatedAt: now, version: l.plan.version + 1 })
      .where(eq(plan.id, l.plan.id));
    await this.audit.record(tx, ctx, {
      action,
      entityType: 'plan',
      entityId: l.plan.id,
      before: { [key]: existing?.value ?? null },
      after: { [key]: value, _source: source },
    });
  }

  async saveUndo(
    tx: Tx,
    l: Loaded,
    snapshot: { key: string; before: string; source: string; aiDrafted: boolean },
  ): Promise<string> {
    const token = randomUUID();
    const set = {
      value: JSON.stringify({ token, ...snapshot }),
      source: 'SYSTEM' as const,
      label: 'undo',
      updatedAt: this.clock.now(),
    };
    await tx
      .insert(fieldValue)
      .values({ tenantId: l.plan.tenantId, ownerType: 'PLAN', ownerId: l.plan.id, key: UNDO_KEY, ...set })
      .onConflictDoUpdate({ target: [fieldValue.ownerType, fieldValue.ownerId, fieldValue.key], set });
    return token;
  }

  async readUndo(
    tx: Tx,
    planId: string,
  ): Promise<{
    token: string;
    key: string;
    before: string;
    source: 'USER' | 'AI' | 'SYSTEM' | 'MIGRATED';
    aiDrafted: boolean;
  } | null> {
    const [row] = await tx
      .select()
      .from(fieldValue)
      .where(
        and(eq(fieldValue.ownerType, 'PLAN'), eq(fieldValue.ownerId, planId), eq(fieldValue.key, UNDO_KEY)),
      );
    return row?.value ? (JSON.parse(row.value) as never) : null;
  }

  async clearUndo(tx: Tx, planId: string): Promise<void> {
    await tx
      .delete(fieldValue)
      .where(
        and(eq(fieldValue.ownerType, 'PLAN'), eq(fieldValue.ownerId, planId), eq(fieldValue.key, UNDO_KEY)),
      );
  }

  // ------------------------------------------------------------------ view
  async view(tx: Tx, auth: AuthContext, planId: string) {
    const l = (await this.load(tx, auth.user.tenantId, planId))!;
    const rv = requestView(l.req, l.reqFields);
    const gates = await this.evaluateGates(tx, l);
    const byKey = new Map(l.planFields.map((f) => [f.key, f]));
    const fields = PLAN_FIELDS.map((def) => {
      const row = byKey.get(def.key);
      return {
        key: def.key,
        label: def.label,
        value: row?.value ?? '',
        paragraphs: splitParagraphs(row?.value),
        source: (row?.source ?? 'AI') as string,
        aiDrafted: row?.aiDrafted ?? false,
        ...(row ? { updatedAt: row.updatedAt.toISOString() } : {}),
      };
    });
    const approvals = await tx
      .select()
      .from(approval)
      .where(and(inArray(approval.subjectType, ['PLAN', 'PLAN_RISK']), eq(approval.subjectId, planId)))
      .orderBy(desc(approval.decidedAt));
    const conflictRows = await tx
      .select({ c: coiDeclaration, name: appUser.name })
      .from(coiDeclaration)
      .innerJoin(appUser, eq(appUser.id, coiDeclaration.userId))
      .where(and(eq(coiDeclaration.scope, 'PLAN'), eq(coiDeclaration.scopeId, planId)))
      .orderBy(coiDeclaration.createdAt);
    const conflicts = conflictRows.map(({ c, name }) => ({
      id: c.id,
      userId: c.userId,
      userName: name,
      scope: c.scope,
      scopeId: c.scopeId,
      none: c.none,
      ...(c.nature ? { nature: c.nature } : {}),
      disposition: c.disposition,
      ...(c.routedTo ? { routedTo: c.routedTo } : {}),
      ...(c.decidedAt ? { decidedAt: c.decidedAt.toISOString() } : {}),
    }));
    const firstRisk = splitParagraphs(byKey.get('risks')?.value)[0]?.split('. Level')[0];
    const perms = await this.permissions(tx, auth, l, gates, conflicts);
    const points = summarisePlan({
      title: l.req.title,
      requestNumber: l.req.number,
      estimatedValue: rv.estimatedValue,
      termMonths: rv.termMonths,
      businessUnit: rv.businessUnit,
      complexity: rv.complexity ?? 'LOW',
      budgetCheck: l.req.budgetCheck,
      gates,
      conflicts: conflicts.map((c) => ({ none: c.none, disposition: c.disposition })),
      topRisk: firstRisk,
    });
    const undo = await this.readUndo(tx, planId);
    return {
      id: l.plan.id,
      requestId: l.req.id,
      requestNumber: l.req.number,
      title: l.req.title,
      estimatedValue: rv.estimatedValue,
      complexity: rv.complexity,
      status: l.plan.status,
      locked: l.plan.locked,
      fields,
      approvals: approvals.map((a) => ({
        id: a.id,
        subject: a.subjectType,
        userId: a.userId,
        role: a.role,
        decision: a.decision,
        ...(a.comment ? { comment: a.comment } : {}),
        decidedAt: a.decidedAt.toISOString(),
        ...(a.stamp ? { stamp: a.stamp } : {}),
      })),
      conflicts,
      gates,
      summary: points.join(' '),
      summaryPoints: points,
      version: l.plan.version,
      permissions: perms,
      undoAvailable: Boolean(undo),
      ...(undo && perms.canEdit ? { undoToken: undo.token } : {}),
    };
  }

  private async permissions(
    tx: Tx,
    auth: AuthContext,
    l: Loaded,
    gates: Array<{ key: string; status: string }>,
    conflicts: Array<{ userId: string; disposition: string }>,
  ) {
    const roles = auth.user.roles;
    const isProc = roles.includes('PROCUREMENT');
    const isOwner = roles.includes('REQUESTER') && l.req.requesterId === auth.user.id;
    const editable = !l.plan.locked && EDITABLE.includes(l.plan.status);
    const canEdit = editable && (isProc || isOwner);
    let canApprove = false;
    let reason: string | undefined;
    if (l.plan.status === 'AWAITING_APPROVAL' && (roles.includes('DELEGATE') || roles.includes('EXEC'))) {
      const value = Number(l.req.estimatedValue ?? 0);
      const d = await checkDelegation(
        tx,
        { tenantId: auth.user.tenantId, userId: auth.user.id, roles },
        'SOURCING_APPROVAL',
        value,
      );
      if (l.req.requesterId === auth.user.id)
        reason = 'You raised this request, so someone else must approve it.';
      else if (!d.allowed)
        reason =
          d.limit === null
            ? 'You do not hold sourcing approval authority.'
            : `Your sourcing authority is ${aud.format(d.limit)}; this plan is ${aud.format(value)}. Escalate to someone with higher authority.`;
      else canApprove = true;
    }
    const riskOpen = gates.some((g) => g.key === 'RISK_SIGNOFF' && g.status === 'REQUIRED');
    return {
      canEdit,
      canSubmit: canEdit && isProc,
      canApprove,
      canReopen: isProc && l.plan.locked,
      canDeclareConflict:
        !l.plan.locked &&
        ['PROCUREMENT', 'EVALUATOR', 'CHAIR', 'LEGAL', 'DELEGATE'].some((r) =>
          roles.includes(r as RoleName),
        ) &&
        !conflicts.some((c) => c.userId === auth.user.id),
      canDecideConflict:
        ['DELEGATE', 'EXEC', 'PROBITY'].some((r) => roles.includes(r as RoleName)) &&
        conflicts.some((c) => c.disposition === 'PENDING' && c.userId !== auth.user.id),
      canSignOffRisk: roles.includes('PROBITY') && l.plan.status === 'AWAITING_SIGNOFF' && riskOpen,
      ...(reason ? { reason } : {}),
    };
  }
}
