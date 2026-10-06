/**
 * Analytical reports that run on the analytics store, not the main database (NFR-P05): future commitment by financial year,
 * cost centre and business unit (FR-0845), and spend optimisation (FR-0840). Every answer carries the time the copy was made.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AnalyticsStore } from '../../analytics/store.js';
import { guard, type AuthContext, type GuardDeps } from '../../auth/guard.js';
import { withContext } from '../../db/client.js';
import { parse } from '../../http/errors.js';
import { loadSettings } from '../settings/settings.js';
import {
  ANALYTICS_MODEL,
  categoryMap,
  commitmentFor,
  consolidation,
  duplicateContracts,
  priceVariance,
  rateCardOptimisation,
  rollup,
  type Assumptions,
  type ContractFact,
  type ExtensionFact,
  type LineFact,
  type RateFact,
} from './analytics-rules.js';

export interface AnalyticsDeps extends GuardDeps {
  analytics: AnalyticsStore;
}
const READERS = ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR'] as const;

interface CRow {
  id: string;
  number: string;
  title: string | null;
  supplier_id: string;
  supplier: string;
  category: string;
  business_unit: string;
  cost_centre: string;
  owner_id: string | null;
  doc_type: string;
  value: number;
  spent: number;
  start: string | null;
  end: string | null;
  has_rate_card: boolean;
}

export function registerAnalytics(app: FastifyInstance, p: string, d: AnalyticsDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const today = () => d.clock.now().toISOString().slice(0, 10);

  /** The copy, brought up to date if it is older than the tenant allows, and the owner filter for a contract manager. */
  async function ready(a: AuthContext) {
    const s = await withContext(d.database, a.ctx, (tx) => loadSettings(tx, a.user.tenantId));
    const info = await d.analytics.ensureFresh(
      d.database,
      a.user.tenantId,
      d.clock.now(),
      s.analytics.refreshMinutes,
    );
    // a contract manager sees only the contracts they own; the other readers see the portfolio
    const wide = a.user.roles.some((r) => ['EXEC', 'FINANCE', 'PROCUREMENT'].includes(r));
    return { s, info, owner: wide ? null : a.user.id };
  }
  const contractsOf = async (tenantId: string, owner: string | null): Promise<ContractFact[]> => {
    const rows = await d.analytics.query<CRow>(
      `select id, number, title, supplier_id, supplier, category, business_unit, cost_centre, owner_id, doc_type,
              value::float8 as value, spent::float8 as spent, start_date::text as start, end_date::text as "end", has_rate_card
         from fact_contract where tenant_id = $1 ${owner ? 'and owner_id = $2' : ''} order by number`,
      owner ? [tenantId, owner] : [tenantId],
    );
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      supplierId: r.supplier_id,
      supplier: r.supplier,
      category: r.category,
      businessUnit: r.business_unit,
      costCentre: r.cost_centre,
      ownerId: r.owner_id,
      docType: r.doc_type,
      value: r.value,
      spent: r.spent,
      start: r.start,
      end: r.end,
      hasRateCard: r.has_rate_card,
    }));
  };

  reg('GET', '/analytics/status');
  app.get(`${p}/analytics/status`, { preHandler: guard(d, [...READERS, 'ADMIN']) }, async (req) => {
    const a = req.auth!;
    const info = await d.analytics.info(a.user.tenantId);
    const s = await withContext(d.database, a.ctx, (tx) => loadSettings(tx, a.user.tenantId));
    return {
      store: 'A separate analytics database, rebuilt from the main one',
      asOf: info.asOf,
      rebuiltInMs: info.ms,
      rows: info.rows,
      refreshEveryMinutes: s.analytics.refreshMinutes,
      readsFromIt: ['Future commitment', 'Spend optimisation'],
    };
  });

  reg('POST', '/analytics/refresh');
  app.post(
    `${p}/analytics/refresh`,
    { preHandler: guard(d, ['EXEC', 'FINANCE', 'PROCUREMENT', 'ADMIN']) },
    async (req) => {
      const a = req.auth!;
      const info = await d.analytics.refresh(d.database, a.user.tenantId, d.clock.now());
      return { asOf: info.asOf, rebuiltInMs: info.ms, rows: info.rows };
    },
  );

  const commitBody = z.object({
    by: z.enum(['businessUnit', 'costCentre']).default('businessUnit'),
    years: z.coerce.number().int().min(1).max(8).default(4),
  });
  reg('GET', '/reports/future-commitment');
  app.get(`${p}/reports/future-commitment`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const q = parse(commitBody, req.query);
    const { info, owner } = await ready(a);
    const contracts = await contractsOf(a.user.tenantId, owner);
    const ids = new Set(contracts.map((c) => c.id));
    const exts = (
      await d.analytics.query<{ contract_id: string; months: number; exercised: boolean }>(
        'select contract_id, months, exercised from fact_extension where tenant_id = $1',
        [a.user.tenantId],
      )
    )
      .filter((e) => ids.has(e.contract_id))
      .map((e): ExtensionFact => ({ contractId: e.contract_id, months: e.months, exercised: e.exercised }));
    const list = contracts
      .map((c) => commitmentFor(c, exts, today(), q.years))
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const rows = rollup(list, q.by);
    const labels = list[0]?.years.map((y) => y.label) ?? [];
    const totals = (list[0]?.years ?? []).map((y, i) => ({
      fy: y.fy,
      label: y.label,
      committed: list.reduce((n, c) => n + c.years[i]!.committed, 0),
      low: list.reduce((n, c) => n + c.years[i]!.low, 0),
      expected: list.reduce((n, c) => n + c.years[i]!.expected, 0),
      high: list.reduce((n, c) => n + c.years[i]!.high, 0),
    }));
    return {
      model: ANALYTICS_MODEL,
      asOf: info.asOf,
      by: q.by,
      years: labels,
      totals,
      rows,
      contracts: list.map((c) => ({
        contractId: c.contractId,
        number: c.number,
        supplier: c.supplier,
        businessUnit: c.businessUnit,
        costCentre: c.costCentre,
        basis: c.basis,
        years: c.years,
        unknowns: c.unknowns,
      })),
      stated: [
        'Committed is what remains to be paid on a fixed-value contract, spread evenly over the days left, by Australian financial year (1 July to 30 June).',
        'A master agreement, or a contract priced by a rate card, has a maximum, not a commitment. It has no committed figure; its range runs from the spend so far projected forward up to the maximum.',
        'An option to extend that has not been exercised is not committed. It appears only in the top of the range.',
      ],
    };
  });

  reg('GET', '/reports/optimisation');
  app.get(`${p}/reports/optimisation`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const { s, info, owner } = await ready(a);
    const as: Assumptions = {
      consolidationPct: s.analytics.consolidationPct,
      varianceThresholdPct: s.analytics.varianceThresholdPct,
      driftThresholdPct: s.analytics.driftThresholdPct,
    };
    const contracts = await contractsOf(a.user.tenantId, owner);
    const ids = new Set(contracts.map((c) => c.id));
    const numbers = new Map(contracts.map((c) => [c.id, c.number]));
    const rates = (
      await d.analytics.query<{
        contract_id: string;
        supplier_id: string;
        supplier: string;
        item: string;
        unit: string;
        unit_price: number;
      }>(
        'select contract_id, supplier_id, supplier, item, unit, unit_price::float8 as unit_price from fact_rate where tenant_id = $1',
        [a.user.tenantId],
      )
    )
      .filter((r) => ids.has(r.contract_id))
      .map((r): RateFact => ({
        contractId: r.contract_id,
        supplierId: r.supplier_id,
        supplier: r.supplier,
        item: r.item,
        unit: r.unit,
        unitPrice: r.unit_price,
      }));
    const lines = (
      await d.analytics.query<{
        contract_id: string;
        supplier_id: string;
        supplier: string;
        item: string;
        qty: number;
        unit_price: number;
        date: string;
        status: string;
      }>(
        'select contract_id, supplier_id, supplier, item, qty::float8 as qty, unit_price::float8 as unit_price, invoice_date::text as date, status from fact_line where tenant_id = $1',
        [a.user.tenantId],
      )
    )
      .filter((l) => ids.has(l.contract_id))
      .map((l): LineFact => ({
        contractId: l.contract_id,
        supplierId: l.supplier_id,
        supplier: l.supplier,
        item: l.item,
        qty: l.qty,
        unitPrice: l.unit_price,
        date: l.date,
        status: l.status,
      }));
    const tenders = new Map(
      (
        await d.analytics.query<{ category: string; tenders: number }>(
          'select category, tenders from fact_category_tender where tenant_id = $1',
          [a.user.tenantId],
        )
      ).map((t) => [t.category, t.tenders]),
    );
    const cons = consolidation(contracts, as);
    const dups = duplicateContracts(contracts);
    const rateGaps = rateCardOptimisation(rates, lines, numbers, today());
    const variance = priceVariance(rates, lines, numbers, as);
    const cats = categoryMap(contracts, tenders, today());
    const consSaving = cons.reduce((n, c) => n + c.estimatedSaving, 0);
    const rateSaving = rateGaps.reduce((n, g) => n + (g.estimatedSaving ?? 0), 0);
    const overpaid = variance
      .filter((v) => v.kind === 'VS_CONTRACT_RATE' && !v.blocked && v.impact > 0)
      .reduce((n, v) => n + v.impact, 0);
    const stopped = variance.filter((v) => v.blocked && v.impact > 0).reduce((n, v) => n + v.impact, 0);
    return {
      model: ANALYTICS_MODEL,
      asOf: info.asOf,
      assumptions: as,
      summary: {
        consolidation: Math.round(consSaving),
        rateCards: Math.round(rateSaving),
        invoicedAboveContractRate: Math.round(overpaid),
        overchargesStopped: Math.round(stopped),
        note: 'These are separate ideas that can overlap, so do not add them up as a promise. Each states the assumption behind it.',
      },
      consolidation: cons,
      duplicates: dups,
      rateCards: rateGaps,
      variance,
      categories: cats,
    };
  });
  return done;
}
