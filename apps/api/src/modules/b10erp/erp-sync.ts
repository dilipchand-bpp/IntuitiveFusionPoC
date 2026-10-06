/**
 * ERP import (NFR-C02): pull from the simulated ERP through the connector layer, map with the provider's mapper, and upsert
 * cost centres, organisation units, budget lines and ledger postings by external id.
 *
 * SWAP POINT (docs/swap-points.md): the importer is provider-neutral. It calls `fetchErpSource` (erp-source.ts) inside
 * `callProvider` (so the timeout, retries and circuit breaker apply), maps the native payload to the normalised shape and
 * upserts it. Replacing the simulation with a real ERP changes `fetchErpSource` only. The run is recorded in `sync_run`
 * (generic, shown on the Connectors page) and `erp_sync` (what changed). While the ERP connector is DOWN the run fails
 * cleanly, the last imported data stays in use, and a manual task (NFR-AV04) tells a person what to do by hand.
 */
import { and, desc, eq, inArray, isNull, like } from 'drizzle-orm';
import type { RequestContext, Tx } from '../../db/client.js';
import {
  connector,
  costCentre,
  erpBudgetLine,
  erpOrgUnit,
  erpSync,
  ledgerEntry,
  manualTask,
  syncRun,
} from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { providerEntry } from '../b10conn/catalogue.js';
import { getConnector } from '../b10conn/connectors.js';
import type { DeliveryDeps } from '../b10conn/delivery.js';
import { callProvider } from '../b10conn/resilience.js';
import {
  ERP_PROVIDERS,
  MAX_REVISION,
  fetchErpSource,
  financialYearOf,
  hashOf,
  isErpProvider,
  mapErp,
  validateNormalised,
  type ErpProvider,
  type Normalised,
} from './erp-source.js';

export interface Counts {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
}
export interface SyncCounts {
  costCentres: Counts;
  orgUnits: Counts;
  budgets: Counts;
  ledger: Counts;
}
export interface ErpSyncResult {
  ok: boolean;
  dryRun: boolean;
  provider: ErpProvider | null;
  providerLabel: string;
  revision: number;
  financialYear: string;
  counts: SyncCounts | null;
  totals: { added: number; changed: number; removed: number; unchanged: number } | null;
  syncRunId: string | null;
  status: 'OK' | 'FAILED';
  reason: string | null;
  error: string | null;
  manualTaskId: string | null;
  simulated: true;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const currentFinancialYear = (at: Date) => financialYearOf(at.toISOString().slice(0, 10));
const MANUAL_TITLE = 'ERP sync: confirm budgets and cost centres by hand';

/** The provider whose mapper reads the connector's feed. SIMULATED_ERP uses the SAP-shaped feed; the others are not ERP feeds. */
export function resolveErpProvider(providerId: string): ErpProvider {
  if (isErpProvider(providerId)) return providerId;
  if (providerId === 'SIMULATED_ERP') return 'SAP';
  throw new AppError(
    422,
    'UNSUPPORTED_PROVIDER',
    `${providerEntry('ERP', providerId)?.label ?? providerId} is a procurement platform, not an ERP feed. Choose ${ERP_PROVIDERS.join(', ')} on the Connectors page.`,
  );
}

type Row = { id: string; externalId: string; hash: string; removedAt: Date | null };

/** Compares incoming records with what is stored, and (unless a dry run) applies it. A record the source no longer holds is retired, not deleted. */
async function upsertSet(
  tx: Tx,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  tenantId: string,
  provider: string,
  incoming: ReadonlyArray<{ externalId: string }>,
  now: Date,
  dry: boolean,
): Promise<Counts> {
  const existing = (await tx.select().from(table).where(eq(table.tenantId, tenantId))) as Row[];
  const byExt = new Map(existing.map((r) => [r.externalId, r]));
  const seen = new Set<string>();
  const out: Counts = { added: 0, changed: 0, removed: 0, unchanged: 0 };
  const inserts: Array<Record<string, unknown>> = [];
  const fix = (item: Record<string, unknown>) => ({
    ...item,
    ...(typeof item.amount === 'number' ? { amount: item.amount.toFixed(2) } : {}),
  });
  for (const rec of incoming) {
    const item = rec as { externalId: string } & Record<string, unknown>;
    seen.add(item.externalId);
    const hash = hashOf(item);
    const cur = byExt.get(item.externalId);
    if (!cur) {
      out.added += 1;
      inserts.push({ tenantId, ...fix(item), provider, hash, firstSeenAt: now, updatedAt: now });
    } else if (cur.hash === hash && !cur.removedAt) out.unchanged += 1;
    else {
      if (cur.removedAt) out.added += 1;
      else out.changed += 1;
      if (!dry)
        await tx
          .update(table)
          .set({ ...fix(item), provider, hash, updatedAt: now, removedAt: null })
          .where(eq(table.id, cur.id));
    }
  }
  const gone = existing.filter((r) => !seen.has(r.externalId) && !r.removedAt);
  out.removed = gone.length;
  if (!dry) {
    for (let i = 0; i < inserts.length; i += 200) await tx.insert(table).values(inserts.slice(i, i + 200));
    if (gone.length)
      await tx
        .update(table)
        .set({ removedAt: now, updatedAt: now })
        .where(
          inArray(
            table.id,
            gone.map((g) => g.id),
          ),
        );
  }
  return out;
}

const sum = (c: SyncCounts) =>
  (['added', 'changed', 'removed', 'unchanged'] as const).reduce(
    (acc, k) => ({ ...acc, [k]: c.costCentres[k] + c.orgUnits[k] + c.budgets[k] + c.ledger[k] }),
    { added: 0, changed: 0, removed: 0, unchanged: 0 },
  );

/** Which version of the simulated source answers: kept on the connector's (non-secret) configuration so a later run sees it. */
export const sourceRevisionOf = (cfg: unknown): number => {
  const n = Number((cfg as Record<string, unknown> | null)?.simulatedRevision ?? 1);
  return Number.isFinite(n) ? Math.min(MAX_REVISION, Math.max(1, Math.floor(n))) : 1;
};

export async function runErpSync(
  tx: Tx,
  d: DeliveryDeps,
  ctx: RequestContext,
  opts: { dryRun?: boolean; revision?: number | undefined } = {},
): Promise<ErpSyncResult> {
  const c = await getConnector(tx, ctx.tenantId, 'ERP');
  if (!c) throw new AppError(404, 'NOT_FOUND', 'No ERP connector is configured');
  const dry = Boolean(opts.dryRun);
  const provider = resolveErpProvider(c.provider);
  const providerLabel = providerEntry('ERP', c.provider)?.label ?? c.provider;
  const revision = opts.revision ?? sourceRevisionOf(c.config);
  const startedAt = d.clock.now();
  const fy = currentFinancialYear(startedAt);
  const base = {
    dryRun: dry,
    provider,
    providerLabel,
    revision,
    financialYear: fy,
    simulated: true as const,
  };

  const [run] = dry
    ? [undefined]
    : await tx
        .insert(syncRun)
        .values({
          tenantId: ctx.tenantId,
          connectorKind: 'ERP',
          direction: 'IN',
          startedAt,
          status: 'RUNNING',
          triggeredBy: ctx.userId,
        })
        .returning();

  const pulled = await callProvider(tx, d, ctx.tenantId, 'ERP', () => fetchErpSource(provider, revision), {
    fallback: () => null,
  });
  if (!pulled.ok || !pulled.value) {
    const error = pulled.ok ? 'The ERP returned nothing' : pulled.error;
    if (dry)
      return {
        ...base,
        ok: false,
        counts: null,
        totals: null,
        syncRunId: null,
        status: 'FAILED',
        reason: pulled.ok ? 'ERROR' : pulled.reason,
        error,
        manualTaskId: null,
      };
    await tx
      .update(syncRun)
      .set({ finishedAt: d.clock.now(), status: 'FAILED', missing: [error] })
      .where(eq(syncRun.id, run!.id));
    await tx.insert(erpSync).values({
      tenantId: ctx.tenantId,
      syncRunId: run!.id,
      provider,
      sourceRevision: revision,
      financialYear: fy,
      status: 'FAILED',
      error,
      triggeredBy: ctx.userId,
      createdAt: d.clock.now(),
    });
    const [last] = await tx
      .select()
      .from(erpSync)
      .where(and(eq(erpSync.tenantId, ctx.tenantId), eq(erpSync.status, 'OK')))
      .orderBy(desc(erpSync.createdAt))
      .limit(1);
    let task = (
      await tx
        .select()
        .from(manualTask)
        .where(
          and(
            eq(manualTask.tenantId, ctx.tenantId),
            eq(manualTask.connectorKind, 'ERP'),
            eq(manualTask.status, 'OPEN'),
            isNull(manualTask.eventId),
            like(manualTask.title, 'ERP sync:%'),
          ),
        )
    )[0];
    if (!task) {
      [task] = await tx
        .insert(manualTask)
        .values({
          tenantId: ctx.tenantId,
          connectorKind: 'ERP',
          title: MANUAL_TITLE,
          instructions:
            `${providerLabel} cannot be reached, so budgets and cost centres were not refreshed. The data from the last successful ` +
            `import (${last ? last.createdAt.toISOString().slice(0, 10) : 'none yet'}) stays in use, and budget checks for imported units ask for a ` +
            `manual confirmation. Confirm the budget for the units you are approving directly in ${providerLabel}, enter the reference ` +
            'you used and choose "Mark done". When the ERP recovers, run the sync again: this task is then closed as superseded.',
          payloadSummary: { provider, lastSuccessfulSync: last?.createdAt.toISOString() ?? null, error },
          createdAt: d.clock.now(),
        })
        .returning();
      await d.audit.record(tx, ctx, {
        action: 'connector.manual_task_queued',
        entityType: 'manual_task',
        entityId: task!.id,
        after: { connector: 'ERP', title: MANUAL_TITLE },
      });
    }
    await d.audit.record(tx, ctx, {
      action: 'erp.sync',
      entityType: 'connector',
      entityId: c.id,
      result: 'FAILED',
      after: { provider, revision, reason: pulled.ok ? 'ERROR' : pulled.reason, error },
    });
    return {
      ...base,
      ok: false,
      counts: null,
      totals: null,
      syncRunId: run!.id,
      status: 'FAILED',
      reason: pulled.ok ? 'ERROR' : pulled.reason,
      error,
      manualTaskId: task!.id,
    };
  }

  const data: Normalised = mapErp(provider, pulled.value);
  const problems = validateNormalised(data);
  if (problems.length) {
    if (run)
      await tx
        .update(syncRun)
        .set({ finishedAt: d.clock.now(), status: 'FAILED', missing: problems })
        .where(eq(syncRun.id, run.id));
    throw new AppError(422, 'ERP_PAYLOAD_INVALID', `The ERP data could not be read: ${problems.join('; ')}`);
  }
  const now = d.clock.now();
  const t = ctx.tenantId;
  const counts: SyncCounts = {
    orgUnits: await upsertSet(tx, erpOrgUnit, t, provider, data.orgUnits, now, dry),
    costCentres: await upsertSet(tx, costCentre, t, provider, data.costCentres, now, dry),
    budgets: await upsertSet(tx, erpBudgetLine, t, provider, data.budgets, now, dry),
    ledger: await upsertSet(tx, ledgerEntry, t, provider, data.ledger, now, dry),
  };
  const totals = sum(counts);
  if (dry)
    return {
      ...base,
      ok: true,
      counts,
      totals,
      syncRunId: null,
      status: 'OK',
      reason: null,
      error: null,
      manualTaskId: null,
    };

  const total = data.orgUnits.length + data.costCentres.length + data.budgets.length + data.ledger.length;
  await tx
    .update(syncRun)
    .set({
      finishedAt: d.clock.now(),
      status: 'OK',
      expectedCount: total,
      receivedCount: total,
      missing: [],
      repaired: 0,
    })
    .where(eq(syncRun.id, run!.id));
  await tx.insert(erpSync).values({
    tenantId: t,
    syncRunId: run!.id,
    provider,
    sourceRevision: revision,
    financialYear: fy,
    counts,
    status: 'OK',
    triggeredBy: ctx.userId,
    createdAt: now,
  });
  if (opts.revision !== undefined)
    await tx
      .update(connector)
      .set({ config: { ...(c.config as object), simulatedRevision: revision } })
      .where(eq(connector.id, c.id));
  // an open "by hand" task for a failed import is no longer needed
  const closed = await tx
    .update(manualTask)
    .set({ status: 'SUPERSEDED', completedAt: now })
    .where(
      and(
        eq(manualTask.tenantId, t),
        eq(manualTask.connectorKind, 'ERP'),
        eq(manualTask.status, 'OPEN'),
        isNull(manualTask.eventId),
        like(manualTask.title, 'ERP sync:%'),
      ),
    )
    .returning({ id: manualTask.id });
  await d.audit.record(tx, ctx, {
    action: 'erp.sync',
    entityType: 'connector',
    entityId: c.id,
    after: { provider, revision, financialYear: fy, totals, supersededManualTasks: closed.length },
  });
  return {
    ...base,
    ok: true,
    counts,
    totals,
    syncRunId: run!.id,
    status: 'OK',
    reason: null,
    error: null,
    manualTaskId: null,
  };
}

// ---------------------------------------------------------------- reading the imported data
export async function erpOverview(tx: Tx, tenantId: string, at: Date) {
  const fy = currentFinancialYear(at);
  const [last] = await tx
    .select()
    .from(erpSync)
    .where(eq(erpSync.tenantId, tenantId))
    .orderBy(desc(erpSync.createdAt))
    .limit(1);
  const [lastOk] = await tx
    .select()
    .from(erpSync)
    .where(and(eq(erpSync.tenantId, tenantId), eq(erpSync.status, 'OK')))
    .orderBy(desc(erpSync.createdAt))
    .limit(1);
  const orgs = await tx
    .select()
    .from(erpOrgUnit)
    .where(and(eq(erpOrgUnit.tenantId, tenantId), isNull(erpOrgUnit.removedAt)));
  const centres = await tx
    .select()
    .from(costCentre)
    .where(and(eq(costCentre.tenantId, tenantId), isNull(costCentre.removedAt)));
  const budgets = await tx
    .select()
    .from(erpBudgetLine)
    .where(and(eq(erpBudgetLine.tenantId, tenantId), isNull(erpBudgetLine.removedAt)));
  const ledger = await tx
    .select()
    .from(ledgerEntry)
    .where(and(eq(ledgerEntry.tenantId, tenantId), isNull(ledgerEntry.removedAt)));
  const orgName = new Map(orgs.map((o) => [o.externalId, o.name]));
  const view = (k: (typeof centres)[number]) => {
    const own = budgets.filter((b) => b.costCentreExternalId === k.externalId && b.financialYear === fy);
    const budget = r2(own.reduce((s, b) => s + Number(b.amount), 0));
    const lines = ledger.filter((l) => l.costCentreExternalId === k.externalId && l.financialYear === fy);
    const actual = r2(lines.filter((l) => l.kind === 'ACTUAL').reduce((s, l) => s + Number(l.amount), 0));
    const committed = r2(
      lines.filter((l) => l.kind === 'COMMITMENT').reduce((s, l) => s + Number(l.amount), 0),
    );
    return {
      id: k.id,
      externalId: k.externalId,
      code: k.code,
      name: k.name,
      orgUnit: k.orgUnitExternalId ? (orgName.get(k.orgUnitExternalId) ?? null) : null,
      owner: k.ownerName,
      active: k.active,
      budget,
      actual,
      committed,
      available: r2(Math.max(0, budget - actual - committed)),
    };
  };
  const lastRun = (r: typeof last) =>
    r
      ? {
          at: r.createdAt.toISOString(),
          status: r.status,
          provider: r.provider,
          revision: r.sourceRevision,
          financialYear: r.financialYear,
          counts: r.counts as SyncCounts | Record<string, never>,
          error: r.error,
        }
      : null;
  return {
    simulated: true,
    financialYear: fy,
    lastRun: lastRun(last),
    lastSuccess: lastRun(lastOk),
    costCentres: centres.map(view).sort((a, b) => a.code.localeCompare(b.code)),
    orgUnits: orgs
      .map((o) => ({ id: o.id, externalId: o.externalId, code: o.code, name: o.name, active: o.active }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    budgets: budgets
      .filter((b) => b.financialYear === fy)
      .map((b) => ({
        id: b.id,
        costCentre: centres.find((k) => k.externalId === b.costCentreExternalId)?.code ?? '',
        financialYear: b.financialYear,
        category: b.category,
        amount: Number(b.amount),
        currency: b.currency,
      }))
      .sort(
        (a, b) =>
          a.costCentre.localeCompare(b.costCentre) || (a.category ?? '').localeCompare(b.category ?? ''),
      ),
    ledgerCount: ledger.length,
  };
}

export async function ledgerPage(
  tx: Tx,
  tenantId: string,
  q: { costCentre?: string | undefined; limit: number },
) {
  const centres = await tx
    .select()
    .from(costCentre)
    .where(and(eq(costCentre.tenantId, tenantId), isNull(costCentre.removedAt)));
  const code = new Map(centres.map((k) => [k.externalId, k.code]));
  const rows = await tx
    .select()
    .from(ledgerEntry)
    .where(and(eq(ledgerEntry.tenantId, tenantId), isNull(ledgerEntry.removedAt)))
    .orderBy(desc(ledgerEntry.postingDate), ledgerEntry.externalId);
  return rows
    .map((l) => ({
      id: l.id,
      costCentre: code.get(l.costCentreExternalId) ?? '',
      postingDate: l.postingDate,
      financialYear: l.financialYear,
      account: l.account,
      description: l.description,
      amount: Number(l.amount),
      kind: l.kind,
      currency: l.currency,
    }))
    .filter((l) => !q.costCentre || l.costCentre.toLowerCase() === q.costCentre.toLowerCase())
    .slice(0, q.limit);
}

export async function erpHistory(tx: Tx, tenantId: string) {
  const rows = await tx
    .select()
    .from(erpSync)
    .where(eq(erpSync.tenantId, tenantId))
    .orderBy(desc(erpSync.createdAt))
    .limit(30);
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    status: r.status,
    provider: r.provider,
    revision: r.sourceRevision,
    financialYear: r.financialYear,
    counts: r.counts,
    error: r.error,
    syncRunId: r.syncRunId,
  }));
}

// ---------------------------------------------------------------- the budget check prefers an imported budget line
export interface BudgetSource {
  kind: 'ERP_IMPORT' | 'ERP_UNAVAILABLE' | 'TENANT_CONFIG';
  label: string;
  provider?: string;
  costCentres?: string[];
  financialYear?: string;
  budget?: number;
  spent?: number;
  syncedAt?: string | null;
}

/**
 * What is left of the imported budget for a business unit or a cost centre: the budget lines of the current financial year of
 * every active cost centre under the unit, less posted actuals and open commitments. Null when nothing was imported for it.
 */
export async function erpBudgetFor(
  tx: Tx,
  tenantId: string,
  businessUnit: string,
  at: Date,
  costCentreCode?: string | null,
): Promise<{ available: number; source: BudgetSource } | null> {
  const centres = await tx
    .select()
    .from(costCentre)
    .where(and(eq(costCentre.tenantId, tenantId), isNull(costCentre.removedAt), eq(costCentre.active, true)));
  if (centres.length === 0) return null;
  const same = (a: string | null | undefined, b: string) =>
    (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
  let pick = costCentreCode ? centres.filter((k) => same(k.code, costCentreCode)) : [];
  if (pick.length === 0 && businessUnit) {
    const orgs = await tx
      .select()
      .from(erpOrgUnit)
      .where(and(eq(erpOrgUnit.tenantId, tenantId), isNull(erpOrgUnit.removedAt)));
    const org = orgs.find((o) => same(o.name, businessUnit) || same(o.code, businessUnit));
    pick = org ? centres.filter((k) => k.orgUnitExternalId === org.externalId) : [];
    if (pick.length === 0)
      pick = centres.filter((k) => same(k.code, businessUnit) || same(k.name, businessUnit));
  }
  if (pick.length === 0) return null;
  const fy = currentFinancialYear(at);
  const ids = pick.map((k) => k.externalId);
  const budgets = await tx
    .select()
    .from(erpBudgetLine)
    .where(
      and(
        eq(erpBudgetLine.tenantId, tenantId),
        isNull(erpBudgetLine.removedAt),
        eq(erpBudgetLine.financialYear, fy),
        inArray(erpBudgetLine.costCentreExternalId, ids),
      ),
    );
  if (budgets.length === 0) return null;
  const postings = await tx
    .select()
    .from(ledgerEntry)
    .where(
      and(
        eq(ledgerEntry.tenantId, tenantId),
        isNull(ledgerEntry.removedAt),
        eq(ledgerEntry.financialYear, fy),
        inArray(ledgerEntry.costCentreExternalId, ids),
      ),
    );
  const budget = r2(budgets.reduce((s, b) => s + Number(b.amount), 0));
  const spent = r2(postings.reduce((s, l) => s + Number(l.amount), 0));
  const [lastOk] = await tx
    .select()
    .from(erpSync)
    .where(and(eq(erpSync.tenantId, tenantId), eq(erpSync.status, 'OK')))
    .orderBy(desc(erpSync.createdAt))
    .limit(1);
  const provider = budgets[0]!.provider;
  const label = providerEntry('ERP', provider)?.label ?? provider;
  const codes = pick.map((k) => k.code).sort();
  return {
    available: r2(Math.max(0, budget - spent)),
    source: {
      kind: 'ERP_IMPORT',
      label: `${label} budget for ${fy}, cost centre${codes.length > 1 ? 's' : ''} ${codes.join(', ')}`,
      provider,
      costCentres: codes,
      financialYear: fy,
      budget,
      spent,
      syncedAt: lastOk?.createdAt.toISOString() ?? null,
    },
  };
}
