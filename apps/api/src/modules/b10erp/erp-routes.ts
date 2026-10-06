/**
 * ERP sync routes (NFR-C02): GET /erp/overview, POST /erp/sync, GET /erp/ledger, GET /erp/history, GET /erp/cost-centres,
 * POST /erp/budget-check.
 *
 * SWAP POINT (docs/swap-points.md): see erp-source.ts (the ERP itself), erp-sync.ts (the importer) and budget.ts (the budget
 * check). These routes only expose them; none of them changes when the simulation is replaced by a real ERP.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard } from '../../auth/guard.js';
import { withContext } from '../../db/client.js';
import { manualTask, tenant } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { connectorViews } from '../b10conn/connectors.js';
import { checkBudget } from './budget.js';
import { ERP_PROVIDERS, MAX_REVISION } from './erp-source.js';
import { erpHistory, erpOverview, ledgerPage, runErpSync } from './erp-sync.js';
import type { B10bDeps } from './index.js';
import { providerEntry } from '../b10conn/catalogue.js';
import { MockErpBudgetService } from '../../adapters/erp.js';

const READERS = ['ADMIN', 'FINANCE', 'PROCUREMENT', 'EXEC'] as const;
const RUNNERS = ['ADMIN', 'FINANCE'] as const;
const PICKERS = ['ADMIN', 'REQUESTER', 'PROCUREMENT', 'FINANCE', 'EXEC', 'DELEGATE', 'CONTRACT_MGR'] as const;
const CHECKERS = ['REQUESTER', 'PROCUREMENT', 'FINANCE', 'EXEC'] as const;

const syncBody = z
  .object({
    dryRun: z.boolean().optional(),
    revision: z.number().int().min(1).max(MAX_REVISION).optional(),
  })
  .strict();
const checkBody = z
  .object({
    businessUnit: z.string().trim().max(120).optional(),
    costCentre: z.string().trim().max(60).optional(),
    amount: z.number().positive().max(1_000_000_000),
  })
  .strict()
  .refine((b) => b.businessUnit || b.costCentre, { message: 'Choose a business unit or a cost centre' });

export function registerErpRoutes(app: FastifyInstance, p: string, d: B10bDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);

  reg('GET', '/erp/overview');
  app.get(`${p}/erp/overview`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const conn = (await connectorViews(tx, a.user.tenantId)).find((c) => c.kind === 'ERP') ?? null;
      const tasks = await tx
        .select()
        .from(manualTask)
        .where(
          and(
            eq(manualTask.tenantId, a.user.tenantId),
            eq(manualTask.connectorKind, 'ERP'),
            eq(manualTask.status, 'OPEN'),
          ),
        )
        .orderBy(desc(manualTask.createdAt));
      return {
        ...(await erpOverview(tx, a.user.tenantId, d.clock.now())),
        connector: conn && {
          provider: conn.provider,
          providerLabel: conn.providerLabel,
          mode: conn.mode,
          enabled: conn.enabled,
          health: conn.health.state,
          simulatedRevision: Number((conn.config as Record<string, unknown>).simulatedRevision ?? 1),
        },
        providers: ERP_PROVIDERS.map((id) => ({ id, label: providerEntry('ERP', id)?.label ?? id })),
        maxRevision: MAX_REVISION,
        manualTasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          instructions: t.instructions,
          createdAt: t.createdAt.toISOString(),
        })),
      };
    });
  });

  reg('POST', '/erp/sync');
  app.post(`${p}/erp/sync`, { preHandler: guard(d, [...RUNNERS]) }, async (req) => {
    const a = req.auth!;
    const body = parse(syncBody, req.body ?? {});
    return withContext(d.database, a.ctx, (tx) =>
      runErpSync(tx, { clock: d.clock, audit: d.audit, ...(d.sleep ? { sleep: d.sleep } : {}) }, a.ctx, {
        ...(body.dryRun !== undefined ? { dryRun: body.dryRun } : {}),
        revision: body.revision,
      }),
    );
  });

  reg('GET', '/erp/ledger');
  app.get(`${p}/erp/ledger`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const q = parse(
      z.object({
        costCentre: z.string().max(60).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      req.query,
    );
    return withContext(d.database, a.ctx, (tx) => ledgerPage(tx, a.user.tenantId, q));
  });

  reg('GET', '/erp/history');
  app.get(`${p}/erp/history`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, (tx) => erpHistory(tx, a.user.tenantId));
  });

  reg('GET', '/erp/cost-centres');
  app.get(`${p}/erp/cost-centres`, { preHandler: guard(d, [...PICKERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const o = await erpOverview(tx, a.user.tenantId, d.clock.now());
      return o.costCentres
        .filter((c) => c.active)
        .map((c) => ({ code: c.code, name: c.name, orgUnit: c.orgUnit, owner: c.owner }));
    });
  });

  reg('POST', '/erp/budget-check');
  app.post(`${p}/erp/budget-check`, { preHandler: guard(d, [...CHECKERS]) }, async (req) => {
    const a = req.auth!;
    const body = parse(checkBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const [t] = await tx
        .select({ config: tenant.config })
        .from(tenant)
        .where(eq(tenant.id, a.user.tenantId));
      const cfg = (t?.config ?? {}) as { budgets?: Record<string, number>; erpOutage?: boolean };
      const unit = body.businessUnit ?? body.costCentre ?? '';
      const res = await checkBudget(tx, new MockErpBudgetService(), {
        tenantId: a.user.tenantId,
        businessUnit: unit,
        amount: body.amount,
        settings: cfg,
        at: d.clock.now(),
        costCentre: body.costCentre ?? null,
      });
      if (!unit) throw new AppError(422, 'VALIDATION_FAILED', 'Choose a business unit or a cost centre');
      return {
        status: res.status,
        available: res.available,
        requested: body.amount,
        businessUnit: unit,
        costCentre: body.costCentre ?? null,
        source: res.source,
        simulated: true,
      };
    });
  });

  return done;
}
