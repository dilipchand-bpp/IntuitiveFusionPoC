/**
 * Progress to completion (FR-0835): which milestones a procurement has reached, worked out from the records themselves, so
 * the screen's characters, celebrations and progress bar can never claim more than what is true.
 */
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext } from '../../db/client.js';
import { contract, evaluation, plan, tender } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { visibleRequests } from '../reporting/scope.js';

export interface ProgressInput {
  requestStatus: string;
  requestPhase: string;
  planStatus: string | null;
  tenderStatus: string | null;
  evaluationStatus: string | null;
  contractStatus: string | null;
}
export interface Milestone {
  key: string;
  label: string;
  done: boolean;
  current: boolean;
  /** What a person sees when they reach it. */
  celebration: string;
}

const AFTER_PUBLISH = ['PUBLISHED', 'CLOSED', 'EVALUATING', 'AWARDED'];
const AFTER_CLOSE = ['CLOSED', 'EVALUATING', 'AWARDED'];

export function milestonesOf(i: ProgressInput): {
  milestones: Milestone[];
  doneCount: number;
  percent: number;
  complete: boolean;
} {
  const closed = i.requestPhase === 'CLOSED';
  const raw: Array<Omit<Milestone, 'current'>> = [
    {
      key: 'raised',
      label: 'Request raised',
      done: i.requestStatus !== 'DRAFT',
      celebration: 'Your request is in. The team can start.',
    },
    {
      key: 'plan',
      label: 'Plan approved',
      done: i.planStatus === 'APPROVED_LOCKED' || closed,
      celebration: 'The plan is approved and locked. On to the market.',
    },
    {
      key: 'published',
      label: 'Tender published',
      done: (i.tenderStatus !== null && AFTER_PUBLISH.includes(i.tenderStatus)) || closed,
      celebration: 'The tender is out. Suppliers can bid.',
    },
    {
      key: 'bids',
      label: 'Bids in',
      done: (i.tenderStatus !== null && AFTER_CLOSE.includes(i.tenderStatus)) || closed,
      celebration: 'The tender has closed and the bids are in.',
    },
    {
      key: 'evaluated',
      label: 'Evaluation approved',
      done: i.evaluationStatus === 'APPROVED' || closed,
      celebration: 'The evaluation is approved. A winner is chosen.',
    },
    {
      key: 'signed',
      label: 'Contract signed',
      done: i.contractStatus === 'EXECUTED' || closed,
      celebration: 'The contract is signed. Well done.',
    },
    {
      key: 'closed',
      label: 'Closed with lessons',
      done: closed,
      celebration: 'All done. The lessons are kept for next time.',
    },
  ];
  const firstOpen = raw.findIndex((m) => !m.done);
  const milestones = raw.map((m, n) => ({ ...m, current: n === firstOpen }));
  const doneCount = raw.filter((m) => m.done).length;
  return {
    milestones,
    doneCount,
    percent: Math.round((doneCount / raw.length) * 100),
    complete: firstOpen === -1,
  };
}

export function registerProgress(app: FastifyInstance, p: string, d: GuardDeps): Set<string> {
  const done = new Set<string>();
  done.add('GET /requests/{id}/progress');
  app.get(`${p}/requests/:id/progress`, { preHandler: guard(d, 'any') }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    if (a.user.roles.includes('SUPPLIER')) throw new AppError(403, 'FORBIDDEN', 'Not available to suppliers');
    return withContext(d.database, a.ctx, async (tx) => {
      const r = (await visibleRequests(tx, a)).rows.find((x) => x.id === id);
      if (!r) throw new AppError(404, 'NOT_FOUND', 'Procurement not found');
      const [pl] = await tx.select({ s: plan.status }).from(plan).where(eq(plan.requestId, id));
      const [t] = await tx
        .select()
        .from(tender)
        .where(eq(tender.requestId, id))
        .orderBy(desc(tender.createdAt))
        .limit(1);
      const [ev] = t
        ? await tx.select({ s: evaluation.status }).from(evaluation).where(eq(evaluation.tenderId, t.id))
        : [];
      const [c] = t
        ? await tx.select({ s: contract.status }).from(contract).where(eq(contract.tenderId, t.id)).limit(1)
        : [];
      return {
        requestId: id,
        phase: r.phase,
        ...milestonesOf({
          requestStatus: r.status,
          requestPhase: r.phase,
          planStatus: pl?.s ?? null,
          tenderStatus: t?.status ?? null,
          evaluationStatus: ev?.s ?? null,
          contractStatus: c?.s ?? null,
        }),
      };
    });
  });
  return done;
}
