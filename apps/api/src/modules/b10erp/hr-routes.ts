/**
 * HR feed routes (FR-0815), all for administrators:
 *   GET  /hr-feed/overview                    batches, events and their outcomes, exceptions, delegations, reassignments
 *   POST /hr-feed/run                         preview (dryRun true) or apply the next (or a chosen) batch
 *   POST /hr-feed/sync-delegations            start delegations whose date has come and end those that have passed
 *   POST /hr-feed/reassignments/{id}/done     record that a leaver's open item was given to a new owner
 * SWAP POINT: see hr-feed.ts.
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard } from '../../auth/guard.js';
import { withContext } from '../../db/client.js';
import { hrReassignment } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { connectorViews } from '../b10conn/connectors.js';
import { HR_BATCHES, hrOverview, runHrFeed, syncDelegations } from './hr-feed.js';
import type { B10bDeps } from './index.js';

const runBody = z
  .object({ dryRun: z.boolean().optional(), batch: z.number().int().min(1).max(HR_BATCHES).optional() })
  .strict();

export function registerHrRoutes(app: FastifyInstance, p: string, d: B10bDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);

  reg('GET', '/hr-feed/overview');
  app.get(`${p}/hr-feed/overview`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const conn = (await connectorViews(tx, a.user.tenantId)).find((c) => c.kind === 'HR') ?? null;
      return {
        ...(await hrOverview(tx, a.user.tenantId, d.clock.now())),
        connector: conn && {
          provider: conn.provider,
          providerLabel: conn.providerLabel,
          enabled: conn.enabled,
          mode: conn.mode,
          health: conn.health.state,
        },
      };
    });
  });

  reg('POST', '/hr-feed/run');
  app.post(`${p}/hr-feed/run`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const body = parse(runBody, req.body ?? {});
    return withContext(d.database, a.ctx, (tx) =>
      runHrFeed(tx, d, a.ctx, {
        ...(body.dryRun !== undefined ? { dryRun: body.dryRun } : {}),
        batch: body.batch,
      }),
    );
  });

  reg('POST', '/hr-feed/sync-delegations');
  app.post(`${p}/hr-feed/sync-delegations`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, (tx) => syncDelegations(tx, d, a.ctx, d.clock.now()));
  });

  reg('POST', '/hr-feed/reassignments/{id}/done');
  app.post(`${p}/hr-feed/reassignments/:id/done`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const [r] = await tx
        .select()
        .from(hrReassignment)
        .where(and(eq(hrReassignment.id, id), eq(hrReassignment.tenantId, a.user.tenantId)));
      if (!r) throw new AppError(404, 'NOT_FOUND', 'Reassignment not found');
      if (r.status === 'DONE') throw new AppError(409, 'ALREADY_DONE', 'Already marked done');
      await tx
        .update(hrReassignment)
        .set({ status: 'DONE', doneBy: a.user.id, doneAt: d.clock.now() })
        .where(eq(hrReassignment.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'hr.reassignment_done',
        entityType: 'hr_reassignment',
        entityId: id,
        after: { source: 'HR', kind: r.kind, label: r.label },
      });
      return { id, status: 'DONE' as const };
    });
  });

  return done;
}
