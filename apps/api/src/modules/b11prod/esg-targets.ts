/**
 * ESG and socio-economic targets and ceilings on a plan (NFR-R05): the organisation's defaults (settings `esgPlan`), a plan's
 * own values within bounds, the figures worked out from awarded contracts and the suppliers' declared ESG data (or the
 * forecast the plan owner enters), PASS, AT RISK or BREACH for each metric with the arithmetic, and the plan gate
 * 'ESG ceilings' that a breach holds until procurement records an exception and the delegate acknowledges it.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import {
  bidPricing,
  contract,
  planEsgTarget,
  request,
  submission,
  supplier,
  tender,
} from '../../db/schema.js';
import type { plan } from '../../db/schema.js';
import { loadSettings, type Settings } from '../settings/settings.js';
import {
  ESG_METRICS,
  actualsFromSpend,
  evaluateMetric,
  gateOf,
  summaryLine,
  type Actual,
  type EsgKey,
  type EsgStatus,
  type SpendLine,
  type SupplierEsg,
} from './esg-rules.js';

type PlanRow = typeof plan.$inferSelect;
type TargetRow = typeof planEsgTarget.$inferSelect;

export const ESG_GATE_KEY = 'ESG_CEILINGS';

export interface MetricView {
  key: EsgKey;
  label: string;
  kind: 'FLOOR' | 'CEILING';
  unit: 'PCT' | 'T_PER_M' | 'RATING';
  limit: number;
  orgLimit: number;
  source: 'DEFAULT' | 'PLAN' | 'OVERRIDE';
  overrideReason: string | null;
  approverNote: string | null;
  forecast: number | null;
  actual: number | null;
  actualArithmetic: string | null;
  value: number | null;
  valueSource: 'ACTUAL' | 'FORECAST' | 'NONE';
  status: EsgStatus;
  summary: string;
  arithmetic: string;
  shortfall: number;
  exception: {
    state: 'NONE' | 'RECORDED' | 'ACKNOWLEDGED';
    reason: string | null;
    recordedBy: string | null;
    recordedAt: string | null;
    acknowledgedBy: string | null;
    acknowledgedAt: string | null;
  };
}

export interface BidLine {
  supplierId: string;
  company: string;
  tco: number;
  declared: {
    diversityOwned: string | null;
    carbonTonnesCo2e: number | null;
    modernSlaveryRating: number | null;
  };
}

export interface EsgTargetsView {
  planId: string;
  contractValue: number | null;
  valueBasis: 'AWARDED' | 'ESTIMATE' | 'NONE';
  atRiskBandPct: number;
  maxRelaxationPct: number;
  metrics: MetricView[];
  gate: { status: 'REQUIRED' | 'SATISFIED' | null; breaches: number };
  bids: BidLine[];
  /** Figures if the lowest-priced bid won: indicative only, offered as a starting forecast. */
  bidSuggestion: Partial<Record<EsgKey, Actual>> | null;
}

const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

const esgOf = (s: { onboarding: unknown }): SupplierEsg =>
  ((s.onboarding as { esg?: SupplierEsg } | null)?.esg ?? {}) as SupplierEsg;

/** Loads what the checks need and returns every metric judged. Reads only; nothing is written. */
export async function computeTargets(tx: Tx, pl: PlanRow, settings?: Settings): Promise<EsgTargetsView> {
  const cfg = (settings ?? (await loadSettings(tx, pl.tenantId))).esgPlan;
  const [req] = await tx.select().from(request).where(eq(request.id, pl.requestId));
  const rows = await tx.select().from(planEsgTarget).where(eq(planEsgTarget.planId, pl.id));
  const tenders = await tx.select({ id: tender.id }).from(tender).where(eq(tender.requestId, pl.requestId));
  const tenderIds = tenders.map((t) => t.id);

  // awarded contracts under this plan (top-level only: a variation is not a new award)
  const awarded = tenderIds.length
    ? await tx
        .select()
        .from(contract)
        .where(
          and(
            eq(contract.tenantId, pl.tenantId),
            inArray(contract.tenderId, tenderIds),
            isNull(contract.parentId),
            isNull(contract.deletedAt),
          ),
        )
    : [];
  const orgSpend = await tx
    .select({ supplierId: contract.supplierId, total: sql<string>`sum(${contract.value})` })
    .from(contract)
    .where(and(eq(contract.tenantId, pl.tenantId), isNull(contract.parentId), isNull(contract.deletedAt)))
    .groupBy(contract.supplierId);
  const orgBySupplier = new Map(orgSpend.map((r) => [r.supplierId, Number(r.total)]));
  const orgTotal = [...orgBySupplier.values()].reduce((s, n) => s + n, 0);

  const supplierIds = [...new Set(awarded.map((c) => c.supplierId))];
  const suppliers = supplierIds.length
    ? await tx.select().from(supplier).where(inArray(supplier.id, supplierIds))
    : [];
  const lines: SpendLine[] = supplierIds.map((sid) => {
    const s = suppliers.find((x) => x.id === sid);
    return {
      supplierId: sid,
      company: s?.company ?? 'Supplier',
      spend: awarded.filter((c) => c.supplierId === sid).reduce((n, c) => n + Number(c.value), 0),
      organisationSpend: orgBySupplier.get(sid) ?? 0,
      esg: s ? esgOf(s) : {},
    };
  });
  const actuals = actualsFromSpend(lines, orgTotal);
  const awardedValue = lines.reduce((s, l) => s + l.spend, 0);
  const estimate = req?.estimatedValue ? Number(req.estimatedValue) : null;
  const contractValue = awarded.length ? awardedValue : estimate;
  const valueBasis = awarded.length
    ? ('AWARDED' as const)
    : estimate !== null
      ? ('ESTIMATE' as const)
      : ('NONE' as const);

  // bids (informational): what each bidder declared, and what would follow if the lowest-priced bid won
  const subs = tenderIds.length
    ? await tx
        .select({ s: submission, p: bidPricing })
        .from(submission)
        .innerJoin(bidPricing, eq(bidPricing.submissionId, submission.id))
        .where(and(inArray(submission.tenderId, tenderIds), eq(submission.status, 'SUBMITTED')))
    : [];
  const bidSupplierIds = [...new Set(subs.map((x) => x.s.supplierId))];
  const bidSuppliers = bidSupplierIds.length
    ? await tx.select().from(supplier).where(inArray(supplier.id, bidSupplierIds))
    : [];
  const bids: BidLine[] = subs
    .map((x) => {
      const s = bidSuppliers.find((y) => y.id === x.s.supplierId);
      const e = s ? esgOf(s) : {};
      return {
        supplierId: x.s.supplierId,
        company: s?.company ?? 'Supplier',
        tco: Number(x.p.tco),
        declared: {
          diversityOwned: e.diversityOwned ?? null,
          carbonTonnesCo2e: typeof e.carbonTonnesCo2e === 'number' ? e.carbonTonnesCo2e : null,
          modernSlaveryRating:
            e.modernSlaveryResult === 'REVIEW'
              ? 3
              : e.modernSlaveryStatement
                ? 1
                : e.modernSlaveryResult === 'CLEAR'
                  ? 2
                  : null,
        },
      };
    })
    .sort((a, b) => a.tco - b.tco);
  let bidSuggestion: EsgTargetsView['bidSuggestion'] = null;
  if (!awarded.length && bids.length) {
    const low = bids[0]!;
    const s = bidSuppliers.find((y) => y.id === low.supplierId);
    bidSuggestion = actualsFromSpend(
      [
        {
          supplierId: low.supplierId,
          company: low.company,
          spend: low.tco,
          organisationSpend: (orgBySupplier.get(low.supplierId) ?? 0) + low.tco,
          esg: s ? esgOf(s) : {},
        },
      ],
      orgTotal + low.tco,
    );
  }

  const metrics: MetricView[] = ESG_METRICS.map((def) => {
    const row: TargetRow | undefined = rows.find((r) => r.metricKey === def.key);
    const orgLimit = cfg.limits[def.key];
    const limit = row && row.source !== 'DEFAULT' ? Number(row.target) : orgLimit;
    const actual = actuals[def.key] ?? null;
    const forecast = num(row?.forecast);
    const value = actual?.value ?? forecast;
    const valueSource =
      actual?.value !== null && actual?.value !== undefined
        ? ('ACTUAL' as const)
        : forecast !== null
          ? ('FORECAST' as const)
          : ('NONE' as const);
    const ev = evaluateMetric(def.kind, limit, value, cfg.atRiskBandPct);
    const arithmetic =
      valueSource === 'ACTUAL'
        ? actual!.arithmetic
        : valueSource === 'FORECAST'
          ? `Forecast entered by the plan owner: ${forecast}${def.unit === 'PCT' ? '%' : def.unit === 'T_PER_M' ? ' t per $m' : ''}`
          : (actual?.arithmetic ?? 'No actual figure and no forecast yet');
    const excState = row?.exceptionReason
      ? row.acknowledgedAt
        ? ('ACKNOWLEDGED' as const)
        : ('RECORDED' as const)
      : ('NONE' as const);
    return {
      key: def.key,
      label: def.label,
      kind: def.kind,
      unit: def.unit,
      limit,
      orgLimit,
      source: row?.source ?? 'DEFAULT',
      overrideReason: row?.overrideReason ?? null,
      approverNote: row?.approverNote ?? null,
      forecast,
      actual: actual?.value ?? null,
      actualArithmetic: actual?.arithmetic ?? null,
      value: ev.value,
      valueSource,
      status: ev.status,
      summary: summaryLine(def, ev.value, limit),
      arithmetic,
      shortfall: ev.shortfall,
      exception: {
        state: excState,
        reason: row?.exceptionReason ?? null,
        recordedBy: row?.exceptionBy ?? null,
        recordedAt: row?.exceptionAt?.toISOString() ?? null,
        acknowledgedBy: row?.acknowledgedBy ?? null,
        acknowledgedAt: row?.acknowledgedAt?.toISOString() ?? null,
      },
    };
  });
  const breaches = metrics.filter((m) => m.status === 'BREACH');
  return {
    planId: pl.id,
    contractValue,
    valueBasis,
    atRiskBandPct: cfg.atRiskBandPct,
    maxRelaxationPct: cfg.maxRelaxationPct,
    metrics,
    gate: {
      status:
        breaches.length === 0
          ? null
          : gateOf(
              metrics.map((m) => ({
                key: m.key,
                status: m.status,
                excepted: m.exception.state === 'ACKNOWLEDGED',
              })),
            ),
      breaches: breaches.length,
    },
    bids,
    bidSuggestion,
  };
}

/**
 * The plan gate 'ESG ceilings'. It exists only while some metric is in BREACH: REQUIRED until every breach has an exception
 * recorded by procurement and acknowledged by the delegate, SATISFIED after. A plan with nothing in breach has no such gate.
 */
export async function esgCeilingGate(
  tx: Tx,
  pl: PlanRow,
): Promise<{ key: string; label: string; reason: string; status: 'REQUIRED' | 'SATISFIED' } | null> {
  const v = await computeTargets(tx, pl);
  if (v.gate.status === null) return null;
  const breached = v.metrics.filter((m) => m.status === 'BREACH');
  const open = breached.filter((m) => m.exception.state !== 'ACKNOWLEDGED');
  return {
    key: ESG_GATE_KEY,
    label: 'ESG ceilings',
    reason:
      v.gate.status === 'REQUIRED'
        ? `${open.map((m) => m.summary).join('; ')}. Procurement records an exception and the delegate acknowledges it, or the figures are corrected.`
        : `${breached.length} breach${breached.length === 1 ? '' : 'es'} accepted by exception and acknowledged by the delegate.`,
    status: v.gate.status,
  };
}
