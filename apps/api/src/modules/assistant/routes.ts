/**
 * The conversational assistant (FR-X01): POST /assistant/chat. One question in, one answer out, with links to act on.
 * The answer is worked out by fixed rules (./rules.ts); the figures it quotes are read for this person only, under the same
 * visibility rules as the reports, so it can never say more than the pages it points to.
 */
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLE_NAMES, type RoleName } from '@if/shared';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import { contract, delegation, invoice, notification, plan, supplier } from '../../db/schema.js';
import { parse } from '../../http/errors.js';
import { addDays, iso } from '../contract/dates.js';
import { parseQuestion } from '../reporting/b6-rules.js';
import { visibleRequests } from '../reporting/scope.js';
import {
  ASSISTANT_MODEL,
  answer,
  askLink,
  attentionReply,
  canOpen,
  authorityReply,
  classify,
  followUpsFor,
  reviewReply,
  unknownReply,
  type Facts,
  type Reply,
} from './rules.js';

const REPORT_USERS = ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR', 'DELEGATE', 'LEGAL', 'PROBITY'];
const chatBody = z.object({
  message: z.string().trim().min(1).max(500),
  page: z.string().max(200).optional(),
});

async function gather(d: GuardDeps, tx: Tx, a: AuthContext): Promise<Facts> {
  const roles = a.user.roles;
  const is = (...r: RoleName[]) => r.some((x) => roles.includes(x));
  const has = new Set<keyof Facts>();
  const now = d.clock.now();
  const f: Facts = {
    unread: 0,
    draftsMine: 0,
    blockedRequests: 0,
    unassigned: 0,
    stalled: 0,
    plansToApprove: 0,
    plansToSignOff: 0,
    contractsEnding: 0,
    contractsNoOwner: 0,
    invoicesBlocked: 0,
    suppliersAtRisk: 0,
    limits: [],
    has,
  };
  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(notification)
    .where(
      and(
        eq(notification.tenantId, a.user.tenantId),
        eq(notification.userId, a.user.id),
        eq(notification.read, false),
      ),
    );
  f.unread = n;

  const { scope, rows } = await visibleRequests(tx, a);
  const mine = rows.filter((r) => r.requesterId === a.user.id);
  f.draftsMine = mine.filter((r) => r.status === 'DRAFT').length;
  has.add('draftsMine');
  f.blockedRequests = rows.filter((r) => r.status === 'BLOCKED').length;
  has.add('blockedRequests');
  const stale = now.getTime() - 14 * 86_400_000;
  f.stalled = rows.filter(
    (r) => r.status === 'IN_PROGRESS' && new Date(r.updatedAt).getTime() < stale,
  ).length;
  has.add('stalled');
  if (scope === 'PORTFOLIO' && is('PROCUREMENT', 'EXEC')) {
    f.unassigned = rows.filter((r) => !r.managerId && r.status !== 'DRAFT' && r.status !== 'COMPLETE').length;
    has.add('unassigned');
  }

  if (is('DELEGATE', 'EXEC', 'PROCUREMENT', 'PROBITY') && rows.length) {
    const ids = rows.map((r) => r.id);
    const plans = await tx.select({ s: plan.status }).from(plan).where(inArray(plan.requestId, ids));
    if (is('DELEGATE', 'EXEC')) {
      f.plansToApprove = plans.filter((p) => p.s === 'AWAITING_APPROVAL').length;
      has.add('plansToApprove');
    }
    if (is('PROBITY')) {
      f.plansToSignOff = plans.filter((p) => p.s === 'AWAITING_SIGNOFF').length;
      has.add('plansToSignOff');
    }
  }

  const today = iso(now);
  if (is('LEGAL', 'PROCUREMENT', 'EXEC', 'FINANCE', 'PROBITY', 'DELEGATE', 'CONTRACT_MGR')) {
    const own = is('LEGAL', 'PROCUREMENT', 'EXEC', 'FINANCE', 'PROBITY', 'DELEGATE')
      ? undefined
      : eq(contract.ownerId, a.user.id); // a contract manager is shown only the contracts they own
    const cs = await tx
      .select({ ownerId: contract.ownerId, endDate: contract.endDate })
      .from(contract)
      .where(
        and(
          eq(contract.tenantId, a.user.tenantId),
          eq(contract.status, 'EXECUTED'),
          isNull(contract.deletedAt),
          isNull(contract.parentId),
          own,
        ),
      );
    f.contractsEnding = cs.filter(
      (c) => c.endDate && c.endDate >= today && c.endDate <= addDays(today, 90),
    ).length;
    has.add('contractsEnding');
    if (own === undefined) {
      f.contractsNoOwner = cs.filter((c) => !c.ownerId).length;
      has.add('contractsNoOwner');
    }
  }
  if (is('FINANCE', 'PROCUREMENT', 'EXEC')) {
    const [{ n: blocked } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(invoice)
      .where(and(eq(invoice.tenantId, a.user.tenantId), inArray(invoice.status, ['BLOCKED', 'EXCEPTION'])));
    f.invoicesBlocked = blocked;
    has.add('invoicesBlocked');
  }
  if (is('PROCUREMENT', 'LEGAL', 'FINANCE', 'EXEC')) {
    const [{ n: risky } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(supplier)
      .where(
        and(
          eq(supplier.tenantId, a.user.tenantId),
          or(
            inArray(supplier.insuranceStatus, ['EXPIRED', 'EXPIRING']),
            eq(supplier.sanctionsStatus, 'MATCH'),
          ),
        ),
      );
    f.suppliersAtRisk = risky;
    has.add('suppliersAtRisk');
  }

  const dels = await tx
    .select()
    .from(delegation)
    .where(and(eq(delegation.tenantId, a.user.tenantId), eq(delegation.active, true)));
  f.limits = dels
    .filter((x) => (x.userId ? x.userId === a.user.id : roles.includes(x.role)))
    .map((x) => ({ scope: x.scope as string, limit: Number(x.maxValue) }))
    .reduce<Facts['limits']>((acc, x) => {
      const at = acc.findIndex((y) => y.scope === x.scope);
      if (at < 0) acc.push(x);
      else if (x.limit > acc[at]!.limit) acc[at] = x; // the highest limit that applies is the one used
      return acc;
    }, []);
  return f;
}

export function registerAssistantRoutes(app: FastifyInstance, p: string, d: GuardDeps): Set<string> {
  const done = new Set<string>();
  done.add('POST /assistant/chat');
  app.post(
    `${p}/assistant/chat`,
    {
      preHandler: guard(d, [...ROLE_NAMES]),
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req) => {
      const a = req.auth!;
      const body = parse(chatBody, req.body);
      const roles = a.user.roles;
      const supplierOnly = roles.includes('SUPPLIER');
      const canQueryData = !supplierOnly && roles.some((r) => REPORT_USERS.includes(r));
      const who = { roles, name: a.user.name };
      const intent = classify(body.message, canQueryData);
      let reply: Reply | null = answer(intent, who, body.page ?? null);
      let done_: string | null = null;

      if (!reply && !supplierOnly) {
        if (intent.kind === 'attention' || intent.kind === 'review' || intent.kind === 'my-authority') {
          const facts = await withContext(d.database, a.ctx, (tx) => gather(d, tx, a));
          reply =
            intent.kind === 'attention'
              ? attentionReply(facts)
              : intent.kind === 'review'
                ? reviewReply(facts)
                : authorityReply(facts, roles);
        } else if (intent.kind === 'mark-read') {
          const n = await withContext(d.database, a.ctx, async (tx) => {
            const rows = await tx
              .update(notification)
              .set({ read: true })
              .where(and(eq(notification.userId, a.user.id), eq(notification.read, false)))
              .returning({ id: notification.id });
            await d.audit.record(tx, a.ctx, {
              action: 'assistant.mark_notifications_read',
              entityType: 'user',
              entityId: a.user.id,
              after: { count: rows.length },
            });
            return rows.length;
          });
          done_ = `Marked ${n} notification${n === 1 ? '' : 's'} as read.`;
          reply = {
            topic: 'instruction',
            answer: done_,
            bullets: [],
            actions: [],
            followUps: followUpsFor(roles),
          };
        } else if (intent.kind === 'data') {
          const q = parseQuestion(body.message);
          reply =
            'error' in q
              ? unknownReply(who)
              : {
                  topic: 'data',
                  answer: `I read that as a report question: ${q.understood.join(', ')}. Open it to see the rows, and save the view if you will use it again.`,
                  bullets: [],
                  actions: [askLink(body.message)],
                  followUps: followUpsFor(roles),
                };
        }
      }
      if (!reply) reply = unknownReply(who);
      // keep only links this person may open, and never anything outside the portal
      reply.actions = reply.actions.filter((x) => x.href.startsWith('/') && canOpen(roles, x.href));
      return { ...reply, intent: intent.kind, executed: done_ !== null, model: ASSISTANT_MODEL };
    },
  );
  return done;
}
