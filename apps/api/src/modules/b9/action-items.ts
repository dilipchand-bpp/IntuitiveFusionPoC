/**
 * What needs this person's attention now, drawn from the records and the person's roles. The dashboard card "Waiting for you"
 * shows how many there are and opens the list. Each item links to the screen where the action is taken, and only to screens
 * the person's role may open.
 */
import { and, asc, eq, inArray, isNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import {
  alert,
  contract,
  evaluation,
  grcItem,
  invoice,
  panelMember,
  plan,
  request,
  tender,
} from '../../db/schema.js';

export interface ActionItem {
  key: string;
  kind: string;
  title: string;
  detail: string;
  link: string;
}
const DAY = 86_400_000;

export async function actionItemsFor(tx: Tx, a: AuthContext, now: Date): Promise<ActionItem[]> {
  const roles = a.user.roles;
  const has = (...r: string[]) => r.some((x) => (roles as readonly string[]).includes(x));
  const tenantId = a.user.tenantId;
  const out: ActionItem[] = [];

  if (has('DELEGATE', 'EXEC')) {
    const rows = await tx
      .select({ id: plan.id, requestId: plan.requestId, number: request.number, title: request.title })
      .from(plan)
      .innerJoin(request, eq(request.id, plan.requestId))
      .where(and(eq(plan.tenantId, tenantId), eq(plan.status, 'AWAITING_APPROVAL')))
      .orderBy(asc(request.number));
    for (const r of rows)
      out.push({
        key: `plan:${r.id}`,
        kind: 'Plan to approve',
        title: r.title,
        detail: `${r.number}: the plan is waiting for your decision`,
        link: `/app/plans/${r.requestId}`,
      });
    const cs = await tx
      .select({ id: contract.id, number: contract.number, title: contract.title })
      .from(contract)
      .where(
        and(
          eq(contract.tenantId, tenantId),
          isNull(contract.deletedAt),
          inArray(contract.status, ['AWAITING_SIGNATURE', 'PARTIALLY_SIGNED']),
        ),
      );
    for (const c of cs)
      out.push({
        key: `sign:${c.id}`,
        kind: 'Contract to sign',
        title: c.title ?? c.number,
        detail: `${c.number}: released for signature`,
        link: `/app/contracts/${c.id}`,
      });
  }

  if (has('CHAIR', 'EVALUATOR')) {
    const rows = await tx
      .select({
        evaluationId: panelMember.evaluationId,
        number: request.number,
        title: request.title,
        state: panelMember.coiState,
      })
      .from(panelMember)
      .innerJoin(evaluation, eq(evaluation.id, panelMember.evaluationId))
      .innerJoin(tender, eq(tender.id, evaluation.tenderId))
      .innerJoin(request, eq(request.id, tender.requestId))
      .where(
        and(
          eq(panelMember.userId, a.user.id),
          notInArray(panelMember.coiState, ['REMOVED', 'DECLARED_CONFLICT']),
          ne(evaluation.status, 'APPROVED'),
        ),
      );
    for (const r of rows)
      out.push({
        key: `eval:${r.evaluationId}`,
        kind: 'Evaluation',
        title: r.title,
        detail:
          r.state === 'NOT_DECLARED'
            ? `${r.number}: declare any conflict of interest before you score`
            : `${r.number}: you are on the panel`,
        link: `/app/evaluations/${r.evaluationId}`,
      });
  }

  if (has('REQUESTER')) {
    const rows = await tx
      .select({ id: request.id, number: request.number, title: request.title })
      .from(request)
      .where(
        and(eq(request.tenantId, tenantId), eq(request.requesterId, a.user.id), eq(request.status, 'DRAFT')),
      );
    for (const r of rows)
      out.push({
        key: `draft:${r.id}`,
        kind: 'Draft request',
        title: r.title || '(untitled)',
        detail: `${r.number}: finish it and submit it`,
        link: `/app/requests/${r.id}`,
      });
  }

  if (has('PROCUREMENT')) {
    const rows = await tx
      .select({ id: request.id, number: request.number, title: request.title })
      .from(request)
      .where(and(eq(request.tenantId, tenantId), eq(request.status, 'SUBMITTED')));
    for (const r of rows)
      out.push({
        key: `new:${r.id}`,
        kind: 'New request',
        title: r.title,
        detail: `${r.number}: submitted, ready for you to take on`,
        link: `/app/requests/${r.id}`,
      });
  }

  if (has('LEGAL')) {
    const cs = await tx
      .select({ id: contract.id, number: contract.number, title: contract.title })
      .from(contract)
      .where(
        and(
          eq(contract.tenantId, tenantId),
          isNull(contract.deletedAt),
          isNull(contract.parentId),
          eq(contract.status, 'LEGAL_REVIEW'),
        ),
      );
    for (const c of cs)
      out.push({
        key: `legal:${c.id}`,
        kind: 'Contract in legal review',
        title: c.title ?? c.number,
        detail: `${c.number}: in legal review`,
        link: `/app/contracts/${c.id}`,
      });
  }

  if (has('CONTRACT_MGR', 'PROCUREMENT', 'LEGAL', 'EXEC')) {
    const horizon = new Date(now.getTime() + 30 * DAY).toISOString().slice(0, 10);
    const rows = await tx
      .select({
        contractId: alert.contractId,
        n: sql<number>`count(*)::int`,
        soonest: sql<string>`min(${alert.triggerDate})::text`,
      })
      .from(alert)
      .where(
        and(eq(alert.tenantId, tenantId), eq(alert.status, 'SCHEDULED'), lte(alert.triggerDate, horizon)),
      )
      .groupBy(alert.contractId);
    if (rows.length)
      out.push({
        key: 'alerts',
        kind: 'Contract alerts',
        title: `${rows.length} contract${rows.length === 1 ? '' : 's'} with alerts in the next 30 days`,
        detail: `The soonest is on ${rows.map((r) => r.soonest).sort()[0]}`,
        link: '/app/contracts/alerts',
      });
  }

  if (has('FINANCE', 'CONTRACT_MGR')) {
    const rows = await tx
      .select({ id: invoice.id, number: invoice.number })
      .from(invoice)
      .where(and(eq(invoice.tenantId, tenantId), eq(invoice.status, 'BLOCKED')));
    for (const r of rows)
      out.push({
        key: `inv:${r.id}`,
        kind: 'Invoice blocked',
        title: `Invoice ${r.number}`,
        detail: 'Stopped at the price check: review it',
        link: '/app/contracts/invoices',
      });
  }

  if (has('PROBITY', 'EXEC', 'LEGAL', 'FINANCE', 'PROCUREMENT')) {
    const today = now.toISOString().slice(0, 10);
    const rows = await tx
      .select({ id: grcItem.id, title: grcItem.title, dueOn: grcItem.dueOn })
      .from(grcItem)
      .where(
        and(
          eq(grcItem.tenantId, tenantId),
          notInArray(grcItem.status, ['MITIGATED', 'ACCEPTED', 'CLOSED']),
          lte(grcItem.dueOn, today),
        ),
      );
    for (const r of rows)
      out.push({
        key: `grc:${r.id}`,
        kind: 'Overdue in the register',
        title: r.title,
        detail: `Was due ${r.dueOn}`,
        link: '/app/risk',
      });
  }
  return out;
}

export function registerActionItems(app: FastifyInstance, p: string, d: GuardDeps): Set<string> {
  const done = new Set<string>();
  done.add('GET /action-items');
  app.get(
    `${p}/action-items`,
    {
      preHandler: guard(d, [
        'REQUESTER',
        'PROCUREMENT',
        'DELEGATE',
        'EVALUATOR',
        'CHAIR',
        'LEGAL',
        'CONTRACT_MGR',
        'PROBITY',
        'FINANCE',
        'ADMIN',
        'EXEC',
      ]),
    },
    async (req) => {
      const a = req.auth!;
      return withContext(d.database, a.ctx, async (tx) => {
        const items = await actionItemsFor(tx, a, d.clock.now());
        return { count: items.length, items };
      });
    },
  );
  return done;
}
