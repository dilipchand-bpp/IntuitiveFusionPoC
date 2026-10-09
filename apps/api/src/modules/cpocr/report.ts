/**
 * Reporting across ingested contracts (CP-07): renewals due, notice windows, liability caps, missing clauses and concentration
 * by supplier. A pure builder over one item per document, so every number is tested without a database; the route loads the
 * items (using the live contract record for documents that were committed, the reviewed fields for the others).
 */
import { addDays, daysBetween } from '../contract/dates.js';
import type { DetectedClause, ExtractedField } from './types.js';

export interface ReportItem {
  documentId: string;
  status: 'NEEDS_REVIEW' | 'READY' | 'COMMITTED';
  contractId: string | null;
  contractNumber: string | null;
  title: string;
  supplier: string;
  startDate: string | null;
  endDate: string | null;
  noticeDays: number | null;
  renewal: { kind: string; months: number; count: number } | null;
  valueAmount: number | null;
  valueCurrency: string | null;
  /** The value in the base currency, or null when it could not be converted. */
  valueBase: number | null;
  liabilityCap: { basis: string; amount?: number; currency?: string; multiple?: number } | null;
  clauses: Array<Pick<DetectedClause, 'key' | 'title' | 'mandatory' | 'found'>>;
  liabilityClauseFound: boolean;
  /** Linked to a contract that already exists in the register: counted once there, so not again in the concentration. */
  linked?: boolean;
}

export const REPORT_DEFAULT_DAYS = 180;

const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;

export function itemFromFields(fields: ExtractedField[]) {
  const v = <T>(k: string): T | null => {
    const f = fields.find((x) => x.key === k);
    return f && f.status !== 'NOT_FOUND' ? (f.value as T | null) : null;
  };
  return {
    title: v<string>('title'),
    supplier: v<string>('supplier'),
    contractNumber: v<string>('contractNumber'),
    startDate: v<string>('effectiveDate'),
    endDate: v<string>('endDate'),
    noticeDays: v<number>('noticeDays'),
    renewal: v<{ kind: string; months: number; count: number }>('renewal'),
    value: v<{ amount: number; currency: string }>('value'),
    cap: v<{ basis: string; amount?: number; currency?: string; multiple?: number }>('liabilityCap'),
  };
}

export function buildReport(items: ReportItem[], today: string, days = REPORT_DEFAULT_DAYS) {
  const horizon = addDays(today, days);
  const row = (i: ReportItem) => ({
    documentId: i.documentId,
    contractId: i.contractId,
    contractNumber: i.contractNumber,
    title: i.title,
    supplier: i.supplier,
    status: i.status,
  });

  const renewalsDue = items
    .filter((i) => i.endDate && i.endDate >= today && i.endDate <= horizon)
    .sort((a, b) => a.endDate!.localeCompare(b.endDate!))
    .map((i) => ({
      ...row(i),
      endDate: i.endDate!,
      daysToEnd: daysBetween(today, i.endDate!),
      noticeDeadline: i.noticeDays !== null ? addDays(i.endDate!, -i.noticeDays) : null,
      renewal: i.renewal
        ? i.renewal.kind === 'AUTO_RENEWAL'
          ? `Renews automatically (${i.renewal.months} months)`
          : `${i.renewal.count} x ${i.renewal.months} month option`
        : 'No renewal option found',
      autoRenews: i.renewal?.kind === 'AUTO_RENEWAL',
    }));

  const noticeWindows = items
    .filter((i) => i.endDate && i.noticeDays !== null && i.endDate >= today)
    .map((i) => {
      const deadline = addDays(i.endDate!, -i.noticeDays!);
      return { i, deadline };
    })
    .filter(({ deadline }) => deadline <= horizon)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .map(({ i, deadline }) => ({
      ...row(i),
      endDate: i.endDate!,
      noticeDays: i.noticeDays!,
      noticeDeadline: deadline,
      daysToDeadline: daysBetween(today, deadline),
      // OPEN: the last day to give notice has passed and the contract has not ended
      state: deadline < today ? ('PASSED' as const) : ('UPCOMING' as const),
    }));

  const caps = items
    .filter((i) => i.liabilityCap || i.liabilityClauseFound)
    .map((i) => {
      const cap = i.liabilityCap;
      const fixed = cap?.basis === 'FIXED' ? cap.amount! : null;
      const sameCurrency = cap?.currency && i.valueCurrency && cap.currency === i.valueCurrency;
      const ratio =
        fixed !== null && i.valueAmount && sameCurrency ? round((fixed / i.valueAmount) * 100, 0) : null;
      return {
        ...row(i),
        basis: cap?.basis ?? 'NOT_STATED',
        capAmount: fixed,
        currency: cap?.currency ?? null,
        valueAmount: i.valueAmount,
        capPercentOfValue: ratio,
        belowValue: ratio !== null && ratio < 100,
      };
    });
  const liabilityCaps = {
    summary: {
      fixed: caps.filter((c) => c.basis === 'FIXED').length,
      feesBased: caps.filter((c) => c.basis.startsWith('FEES')).length,
      unlimited: caps.filter((c) => c.basis === 'UNLIMITED').length,
      notStated: caps.filter((c) => c.basis === 'NOT_STATED').length,
      belowValue: caps.filter((c) => c.belowValue).length,
    },
    items: caps,
  };

  const byClause = new Map<
    string,
    { key: string; title: string; mandatory: boolean; missing: Array<{ documentId: string; title: string }> }
  >();
  let withMissing = 0;
  for (const i of items) {
    let any = false;
    for (const c of i.clauses) {
      const e = byClause.get(c.key) ?? { key: c.key, title: c.title, mandatory: c.mandatory, missing: [] };
      if (!c.found) {
        e.missing.push({ documentId: i.documentId, title: i.title });
        if (c.mandatory) any = true;
      }
      byClause.set(c.key, e);
    }
    if (any) withMissing += 1;
  }
  const missingClauses = {
    documentsChecked: items.length,
    documentsWithMissingMandatory: withMissing,
    byClause: [...byClause.values()]
      .filter((c) => c.missing.length > 0)
      .map((c) => ({ ...c, count: c.missing.length }))
      .sort(
        (a, b) =>
          Number(b.mandatory) - Number(a.mandatory) || b.count - a.count || a.key.localeCompare(b.key),
      ),
  };

  const sup = new Map<string, { supplier: string; documents: number; totalValue: number }>();
  let total = 0;
  let unconverted = 0;
  for (const i of items.filter((x) => !x.linked)) {
    const k = i.supplier.toLowerCase();
    const e = sup.get(k) ?? { supplier: i.supplier, documents: 0, totalValue: 0 };
    e.documents += 1;
    if (i.valueBase === null) unconverted += 1;
    else {
      e.totalValue += i.valueBase;
      total += i.valueBase;
    }
    sup.set(k, e);
  }
  const bySupplier = [...sup.values()]
    .map((s) => ({
      ...s,
      totalValue: round(s.totalValue, 2),
      share: total > 0 ? round((s.totalValue / total) * 100, 1) : 0,
    }))
    .sort((a, b) => b.totalValue - a.totalValue || a.supplier.localeCompare(b.supplier));
  const concentration = {
    currency: 'AUD',
    totalValue: round(total, 2),
    unconverted,
    bySupplier,
    topShare: bySupplier[0]?.share ?? 0,
    // Herfindahl-Hirschman index on value shares: 10,000 = one supplier, near 0 = spread across many
    hhi: Math.round(bySupplier.reduce((s, x) => s + x.share ** 2, 0)),
  };

  return {
    asOf: today,
    days,
    horizon,
    totals: {
      documents: items.length,
      committed: items.filter((i) => i.status === 'COMMITTED').length,
      readyToCommit: items.filter((i) => i.status === 'READY').length,
      needsReview: items.filter((i) => i.status === 'NEEDS_REVIEW').length,
    },
    renewalsDue,
    noticeWindows,
    liabilityCaps,
    missingClauses,
    concentration,
  };
}
