/**
 * SEC-AC09: access policies that override the default hierarchy.
 *
 * The default hierarchy is the role rules (scope.ts: who sees which procurements) and the route guards (who may call what).
 * Policies are data (`access_policy`) evaluated in addition to them:
 *   - an explicit DENY always wins over the default hierarchy and over an ALLOW;
 *   - an ALLOW grants what the default hierarchy would not (for example, a delegate may view procurements in another business
 *     unit). An ALLOW never overrides a DENY and never widens what a route guard refuses outright.
 * Conditions narrow when a policy is in force: a time window (local hours in a time zone), and MFA (a DENY with requiresMfa is in
 * force while the session has NOT been verified with MFA; an ALLOW with requiresMfa only while it has). Policies can expire.
 *
 * Where it is applied (documented in docs, and tested):
 *   COVERED: `visibleRequests` (modules/reporting/scope.ts), which backs the procurement table, KPIs, spend, search, progress, the
 *   assistant, lessons, the document repository and the supplier close-out lists; a global preHandler (index.ts) that checks
 *   the view, edit, approve and export action on `/requests/:id*`, `/plans/:id*`, `/tenders/:id*`, `/evaluations/:id*` and
 *   `/contracts/:id*` for the procurement the record belongs to; every route whose URL contains `/export` (with the procurement
 *   when the URL names one).
 *   NOT COVERED: ALLOW grants do not widen the per-record routes (a route's own scope check still decides there); records that
 *   belong to no procurement (supplier directory, contracts without a tender); reads that bypass those routes, such as the
 *   analytics store's own reports and notifications about a procurement.
 *
 * Every decision that changes an outcome is audited: `policy.deny` and `policy.allow` (once per person, policy, procurement and
 * action per hour on list reads, so a list refresh does not flood the trail).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import { accessPolicy, accessTag, contract, submission, tender } from '../../db/schema.js';
import type { request } from '../../db/schema.js';

export type PolicyRow = typeof accessPolicy.$inferSelect;
export type RequestRow = typeof request.$inferSelect;
export type PolicyAction = 'view' | 'edit' | 'approve' | 'export';

export interface PolicySelector {
  entityType?: 'request';
  businessUnit?: string;
  minValue?: number;
  supplierId?: string;
  tag?: string;
}
export interface PolicyConditions {
  timeWindow?: { startHour: number; endHour: number; timeZone?: string };
  requiresMfa?: boolean;
}
export interface PolicyUser {
  id: string;
  roles: readonly string[];
  mfaVerified: boolean;
}
export interface PolicyResource {
  requestId: string;
  businessUnit: string | null;
  value: number | null;
  supplierIds: string[];
  tags: string[];
}
export interface Decision {
  allowed: boolean;
  kind: 'DEFAULT' | 'DENY_OVERRIDE' | 'ALLOW_GRANT';
  policy: PolicyRow | null;
}

/** The runtime used to audit decisions made deep inside read paths. Set once when the app is built. */
const runtime: { audit: AuditService | null; clock: Clock | null } = { audit: null, clock: null };
export function configurePolicyRuntime(audit: AuditService, clock: Clock) {
  runtime.audit = audit;
  runtime.clock = clock;
}
const recently = new Map<string, number>();

export const DEFAULT_TZ = 'Australia/Sydney';

export function hourIn(at: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(at));
}

export function expiredOrOff(p: PolicyRow, now: Date): 'DELETED' | 'DISABLED' | 'EXPIRED' | null {
  if (p.deletedAt) return 'DELETED';
  if (!p.active) return 'DISABLED';
  if (p.expiresAt && p.expiresAt <= now) return 'EXPIRED';
  return null;
}

/** Why a policy does or does not apply to this person, action and procurement (used by the simulator and by evaluation). */
export function explain(
  p: PolicyRow,
  user: PolicyUser,
  action: PolicyAction,
  res: PolicyResource | null,
  now: Date,
): { applies: boolean; why: string } {
  const off = expiredOrOff(p, now);
  if (off)
    return {
      applies: false,
      why:
        off === 'EXPIRED'
          ? 'The policy has expired'
          : off === 'DISABLED'
            ? 'The policy is disabled'
            : 'The policy was deleted',
    };
  if (p.action !== action) return { applies: false, why: `The policy is about ${p.action}, not ${action}` };
  const subjectOk = p.subjectType === 'ROLE' ? user.roles.includes(p.subject) : user.id === p.subject;
  if (!subjectOk)
    return {
      applies: false,
      why:
        p.subjectType === 'ROLE'
          ? `The person does not hold the ${p.subject} role`
          : 'The policy names a different person',
    };
  const sel = (p.selector ?? {}) as PolicySelector;
  const constrained = Boolean(sel.businessUnit || sel.minValue !== undefined || sel.supplierId || sel.tag);
  if (constrained && !res)
    return { applies: false, why: 'The policy selects specific procurements and this action names none' };
  if (res) {
    if (sel.businessUnit && (res.businessUnit ?? '').toLowerCase() !== sel.businessUnit.toLowerCase())
      return {
        applies: false,
        why: `The procurement is in ${res.businessUnit ?? 'no business unit'}, not ${sel.businessUnit}`,
      };
    if (sel.minValue !== undefined && !((res.value ?? 0) > sel.minValue))
      return { applies: false, why: `The value is not above AUD ${sel.minValue.toLocaleString('en-AU')}` };
    if (sel.supplierId && !res.supplierIds.includes(sel.supplierId))
      return { applies: false, why: 'The named supplier is not part of this procurement' };
    if (sel.tag && !res.tags.includes(sel.tag))
      return { applies: false, why: `The procurement is not tagged ${sel.tag}` };
  }
  const c = (p.conditions ?? {}) as PolicyConditions;
  if (c.timeWindow) {
    const h = hourIn(now, c.timeWindow.timeZone ?? DEFAULT_TZ);
    const { startHour: s, endHour: e } = c.timeWindow;
    const inside = s <= e ? h >= s && h < e : h >= s || h < e;
    if (!inside) return { applies: false, why: `Outside the policy's time window (${s}:00 to ${e}:00)` };
  }
  if (c.requiresMfa) {
    if (p.effect === 'DENY' && user.mfaVerified)
      return { applies: false, why: 'The session was verified with MFA, which lifts this denial' };
    if (p.effect === 'ALLOW' && !user.mfaVerified)
      return { applies: false, why: 'The grant needs a session verified with MFA' };
  }
  return { applies: true, why: p.effect === 'DENY' ? 'The denial applies' : 'The grant applies' };
}

const byPriority = (a: PolicyRow, b: PolicyRow) =>
  a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime();

/** DENY wins over everything; ALLOW only matters when the default hierarchy refuses. */
export function decide(
  policies: PolicyRow[],
  user: PolicyUser,
  action: PolicyAction,
  res: PolicyResource | null,
  now: Date,
  defaultAllowed: boolean,
): Decision {
  const hits = policies.filter((p) => explain(p, user, action, res, now).applies).sort(byPriority);
  const deny = hits.find((p) => p.effect === 'DENY');
  if (deny) return { allowed: false, kind: 'DENY_OVERRIDE', policy: deny };
  const allow = hits.find((p) => p.effect === 'ALLOW');
  if (allow && !defaultAllowed) return { allowed: true, kind: 'ALLOW_GRANT', policy: allow };
  return { allowed: defaultAllowed, kind: 'DEFAULT', policy: null };
}

export async function loadPolicies(tx: Tx, tenantId: string): Promise<PolicyRow[]> {
  return tx
    .select()
    .from(accessPolicy)
    .where(
      and(eq(accessPolicy.tenantId, tenantId), eq(accessPolicy.active, true), isNull(accessPolicy.deletedAt)),
    );
}

/** Facts about procurements that policies can select on. Supplier links are read only when a policy selects on a supplier. */
export async function resourcesFor(
  tx: Tx,
  tenantId: string,
  rows: RequestRow[],
  needSuppliers: boolean,
): Promise<Map<string, PolicyResource>> {
  const out = new Map<string, PolicyResource>();
  if (rows.length === 0) return out;
  const tags = await tx
    .select({ requestId: accessTag.requestId, tag: accessTag.tag })
    .from(accessTag)
    .where(eq(accessTag.tenantId, tenantId));
  const restricted = new Set<string>();
  const t = await tx.execute(sql`select to_regclass('public.restricted_project') as t`);
  if ((t as unknown as { rows?: Array<{ t: string | null }> }).rows?.[0]?.t) {
    const r = await tx.execute(sql`select request_id from restricted_project where tenant_id = ${tenantId}`);
    for (const x of (r as unknown as { rows?: Array<{ request_id: string }> }).rows ?? [])
      restricted.add(x.request_id);
  }
  const supplierOf = new Map<string, Set<string>>();
  if (needSuppliers) {
    const tenders = await tx
      .select({ id: tender.id, requestId: tender.requestId })
      .from(tender)
      .where(eq(tender.tenantId, tenantId));
    const reqOf = new Map(tenders.map((x) => [x.id, x.requestId] as const));
    const add = (tenderId: string | null, supplierId: string) => {
      const rid = tenderId ? reqOf.get(tenderId) : undefined;
      if (!rid) return;
      if (!supplierOf.has(rid)) supplierOf.set(rid, new Set());
      supplierOf.get(rid)!.add(supplierId);
    };
    for (const s of await tx
      .select({ tenderId: submission.tenderId, supplierId: submission.supplierId })
      .from(submission)
      .where(eq(submission.tenantId, tenantId)))
      add(s.tenderId, s.supplierId);
    for (const c of await tx
      .select({ tenderId: contract.tenderId, supplierId: contract.supplierId })
      .from(contract)
      .where(eq(contract.tenantId, tenantId)))
      add(c.tenderId, c.supplierId);
  }
  for (const r of rows) {
    const mine = tags.filter((x) => x.requestId === r.id).map((x) => x.tag);
    if (restricted.has(r.id)) mine.push('restricted');
    out.set(r.id, {
      requestId: r.id,
      businessUnit: r.businessUnit,
      value: r.estimatedValue === null ? null : Number(r.estimatedValue),
      supplierIds: [...(supplierOf.get(r.id) ?? [])],
      tags: mine,
    });
  }
  return out;
}

export async function auditDecision(
  tx: Tx,
  ctx: RequestContext,
  d: Decision,
  action: PolicyAction,
  requestId: string | null,
  throttle: boolean,
): Promise<void> {
  if (!runtime.audit || !runtime.clock || d.kind === 'DEFAULT' || !d.policy) return;
  const now = runtime.clock.now().getTime();
  const key = `${ctx.tenantId}|${ctx.userId}|${d.policy.id}|${requestId}|${action}`;
  if (throttle) {
    const last = recently.get(key);
    if (last !== undefined && now - last < 3_600_000) return;
    recently.set(key, now);
  }
  await runtime.audit.record(tx, ctx, {
    action: d.kind === 'DENY_OVERRIDE' ? 'policy.deny' : 'policy.allow',
    entityType: 'request',
    entityId: requestId,
    after: {
      policyId: d.policy.id,
      policy: d.policy.name,
      effect: d.policy.effect,
      action,
      reason: d.policy.reason,
    },
    result: d.kind === 'DENY_OVERRIDE' ? 'DENIED' : 'SUCCESS',
  });
}

/**
 * Applies the 'view' policies to the list the role rules produced: removes what a DENY hides and adds what an ALLOW grants.
 * `all` is read only when the person has an applicable grant.
 */
export async function applyViewPolicies(
  tx: Tx,
  ctx: RequestContext,
  user: PolicyUser,
  tenantId: string,
  base: RequestRow[],
  loadAll: () => Promise<RequestRow[]>,
): Promise<RequestRow[]> {
  const now = (runtime.clock ?? { now: () => new Date() }).now();
  const policies = (await loadPolicies(tx, tenantId)).filter(
    (p) => p.action === 'view' && explainSubject(p, user),
  );
  if (policies.length === 0) return base;
  const needSuppliers = policies.some((p) => Boolean((p.selector as PolicySelector).supplierId));
  const hasAllow = policies.some((p) => p.effect === 'ALLOW');
  const universe = hasAllow ? await loadAll() : base;
  const res = await resourcesFor(tx, tenantId, universe, needSuppliers);
  const inBase = new Set(base.map((r) => r.id));
  const out: RequestRow[] = [];
  for (const r of universe) {
    const d = decide(policies, user, 'view', res.get(r.id)!, now, inBase.has(r.id));
    if (d.kind !== 'DEFAULT') await auditDecision(tx, ctx, d, 'view', r.id, true);
    if (d.allowed) out.push(r);
  }
  return out;
}
const explainSubject = (p: PolicyRow, user: PolicyUser) =>
  p.subjectType === 'ROLE' ? user.roles.includes(p.subject) : user.id === p.subject;
