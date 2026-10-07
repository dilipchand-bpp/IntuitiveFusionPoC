/**
 * Who sees which procurements (US-RPT-01): one rule shared by the KPIs, the procurement table and the spend report,
 * so no figure can reveal more than the list beside it.
 *  - PORTFOLIO: roles that run or oversee procurement see every request of the tenant.
 *  - PANEL: evaluators and the chair see only requests whose evaluation they sit on (and are not suspended from),
 *    plus their own requests.
 *  - OWN: a requester sees only what they raised.
 */
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { AuthContext } from '../../auth/guard.js';
import type { Tx } from '../../db/client.js';
import { contract, evaluation, panelMember, plan, request, tender } from '../../db/schema.js';
import { applyViewPolicies } from '../b11audit/policy-engine.js';

export const PORTFOLIO_ROLES = [
  'PROCUREMENT',
  'DELEGATE',
  'EXEC',
  'FINANCE',
  'LEGAL',
  'CONTRACT_MGR',
  'PROBITY',
  'ADMIN',
] as const;

export type Scope = 'PORTFOLIO' | 'PANEL' | 'OWN';

export function scopeOf(roles: readonly string[]): Scope {
  if (roles.some((r) => (PORTFOLIO_ROLES as readonly string[]).includes(r))) return 'PORTFOLIO';
  if (roles.includes('EVALUATOR') || roles.includes('CHAIR')) return 'PANEL';
  return 'OWN';
}

type RequestRow = typeof request.$inferSelect;

/**
 * The requests this person may see in reports: the role rules (`baseVisibleRequests`) with the access policies applied on top
 * (SEC-AC09): a DENY hides a procurement from someone the role rules would show it to, an ALLOW shows one the role rules hide.
 */
export async function visibleRequests(tx: Tx, a: AuthContext): Promise<{ scope: Scope; rows: RequestRow[] }> {
  const base = await baseVisibleRequests(tx, a);
  const rows = await applyViewPolicies(
    tx,
    a.ctx,
    { id: a.user.id, roles: a.user.roles, mfaVerified: a.mfaState === 'VERIFIED' },
    a.user.tenantId,
    base.rows,
    () => tx.select().from(request).where(eq(request.tenantId, a.user.tenantId)),
  );
  return { scope: base.scope, rows };
}

/** The role rules alone, before any access policy. */
export async function baseVisibleRequests(
  tx: Tx,
  a: Pick<AuthContext, 'user'>,
): Promise<{ scope: Scope; rows: RequestRow[] }> {
  const scope = scopeOf(a.user.roles);
  const all = await tx.select().from(request).where(eq(request.tenantId, a.user.tenantId));
  if (scope === 'PORTFOLIO') return { scope, rows: all };
  const mine = all.filter((r) => r.requesterId === a.user.id);
  if (scope === 'OWN') return { scope, rows: mine };
  const seats = await tx
    .select({ tenderId: evaluation.tenderId })
    .from(panelMember)
    .innerJoin(evaluation, eq(evaluation.id, panelMember.evaluationId))
    .where(
      and(
        eq(panelMember.userId, a.user.id),
        notInArray(panelMember.coiState, ['REMOVED', 'DECLARED_CONFLICT']),
      ),
    );
  const tenders = seats.length
    ? await tx
        .select({ requestId: tender.requestId })
        .from(tender)
        .where(
          inArray(
            tender.id,
            seats.map((s) => s.tenderId),
          ),
        )
    : [];
  const ids = new Set([...mine.map((r) => r.id), ...tenders.map((t) => t.requestId)]);
  return { scope, rows: all.filter((r) => ids.has(r.id)) };
}

export const STEPS = ['intake', 'plan', 'tender', 'evaluation', 'contract'] as const;
export type Steps = Record<(typeof STEPS)[number], boolean>;

/** Completion indicators: a step is ticked when its real record reached the end state, not when the phase label moved. */
export async function stepsFor(tx: Tx, tenantId: string, rows: RequestRow[]): Promise<Map<string, Steps>> {
  const out = new Map<string, Steps>();
  if (rows.length === 0) return out;
  const ids = rows.map((r) => r.id);
  const plans = await tx
    .select()
    .from(plan)
    .where(and(eq(plan.tenantId, tenantId), inArray(plan.requestId, ids)));
  const tenders = await tx
    .select()
    .from(tender)
    .where(and(eq(tender.tenantId, tenantId), inArray(tender.requestId, ids)));
  const evals = tenders.length
    ? await tx
        .select()
        .from(evaluation)
        .where(
          inArray(
            evaluation.tenderId,
            tenders.map((t) => t.id),
          ),
        )
    : [];
  const contracts = tenders.length
    ? await tx
        .select()
        .from(contract)
        .where(
          inArray(
            contract.tenderId,
            tenders.map((t) => t.id),
          ),
        )
    : [];
  for (const r of rows) {
    const ts = tenders.filter((t) => t.requestId === r.id);
    out.set(r.id, {
      intake: r.status !== 'DRAFT',
      plan: plans.some((p) => p.requestId === r.id && p.status === 'APPROVED_LOCKED'),
      tender: ts.some((t) => ['CLOSED', 'EVALUATING', 'AWARDED'].includes(t.status)),
      evaluation: evals.some((e) => ts.some((t) => t.id === e.tenderId) && e.status === 'APPROVED'),
      contract: contracts.some(
        (c) => ts.some((t) => t.id === c.tenderId) && c.status === 'EXECUTED' && !c.deletedAt,
      ),
    });
  }
  return out;
}
