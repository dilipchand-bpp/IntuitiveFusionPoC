/**
 * Spend analytics (FR-0840, FR-0845): what is committed for future financial years, with the ranges and unknowns stated,
 * and where money could be saved. Pure functions over plain facts, so every figure can be tested and every assumption is
 * written down next to the figure it affects. The language is rules-simulated (`ANALYTICS_MODEL`); a model could write the
 * estimates, but the assumptions and ranges here are what it would be held to.
 */
import { nameSimilarity } from '../b8/rules.js';

export const ANALYTICS_MODEL = 'rules-simulated-v1';
const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(ms(d) + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);
export const fyOf = (d: string) =>
  Number(d.slice(5, 7)) >= 7 ? Number(d.slice(0, 4)) + 1 : Number(d.slice(0, 4));
export const fyLabel = (fy: number) => `FY${String(fy - 1).slice(2)}/${String(fy).slice(2)}`;
export const categoryOf = (raw: string | null) =>
  (raw ?? 'Uncategorised').replace(/\s*\(.*\)\s*$/, '').trim() || 'Uncategorised';

export interface ContractFact {
  id: string;
  number: string;
  title: string | null;
  supplierId: string;
  supplier: string;
  category: string;
  businessUnit: string;
  costCentre: string;
  ownerId: string | null;
  docType: string;
  /** The contract and its signed variations. */
  value: number;
  /** Paid or matched invoices so far. */
  spent: number;
  start: string | null;
  end: string | null;
  hasRateCard: boolean;
}
export interface ExtensionFact {
  contractId: string;
  months: number;
  exercised: boolean;
}
export interface RateFact {
  contractId: string;
  supplierId: string;
  supplier: string;
  item: string;
  unit: string;
  unitPrice: number;
}
export interface LineFact {
  contractId: string;
  supplierId: string;
  supplier: string;
  item: string;
  qty: number;
  unitPrice: number;
  date: string;
  /** Where the invoice stands: a BLOCKED one never became spend. */
  status: string;
}

// ------------------------------------------------------------------ future commitment (FR-0845)

/** Splits an amount over the days between two dates (inclusive), by Australian financial year. */
export function spreadByFy(start: string, end: string, amount: number): Map<number, number> {
  const out = new Map<number, number>();
  if (end < start || amount <= 0) return out;
  const total = daysBetween(start, end) + 1;
  let cur = start;
  while (cur <= end) {
    const fy = fyOf(cur);
    const fyEnd = `${fy}-06-30`;
    const segEnd = fyEnd < end ? fyEnd : end;
    const days = daysBetween(cur, segEnd) + 1;
    out.set(fy, (out.get(fy) ?? 0) + (amount * days) / total);
    cur = addDays(segEnd, 1);
  }
  return out;
}

export interface YearFigure {
  fy: number;
  label: string;
  /** Firm: owed whatever happens, if the contract runs to its end. */
  committed: number;
  low: number;
  expected: number;
  high: number;
}
export interface Commitment {
  contractId: string;
  number: string;
  supplier: string;
  businessUnit: string;
  costCentre: string;
  basis: 'FIXED' | 'CEILING';
  years: YearFigure[];
  unknowns: string[];
}

const LICENCE = /licen[cs]e|subscription|saas|software|per user|per seat/i;

/**
 * What one contract commits for each financial year from this one onward. A fixed-value contract commits what remains,
 * spread over the days left. A ceiling (a master agreement, or a contract priced by a rate card) commits nothing firm: it
 * has a range from what the spend so far implies up to the ceiling. Options to extend are never committed, only counted
 * in the top of the range. Whatever cannot be known is listed.
 */
export function commitmentFor(
  c: ContractFact,
  exts: ExtensionFact[],
  today: string,
  years = 4,
): Commitment | null {
  if (!c.end || !c.start || c.end < today) return null;
  const basis: Commitment['basis'] = c.docType === 'MASTER' || c.hasRateCard ? 'CEILING' : 'FIXED';
  const remaining = Math.max(0, c.value - c.spent);
  const from = addDays(today, 1) > c.start ? addDays(today, 1) : c.start;
  const unknowns: string[] = [];
  const firm = new Map<number, number>();
  const low = new Map<number, number>();
  const expected = new Map<number, number>();
  const high = new Map<number, number>();
  const add = (m: Map<number, number>, from: string, to: string, amt: number) => {
    for (const [fy, v] of spreadByFy(from, to, amt)) m.set(fy, (m.get(fy) ?? 0) + v);
  };

  if (basis === 'FIXED') {
    add(firm, from, c.end, remaining);
    add(low, from, c.end, remaining);
    add(expected, from, c.end, remaining);
    add(high, from, c.end, remaining);
    if (LICENCE.test(`${c.title ?? ''} ${c.category}`)) {
      // licence counts are rarely fixed for the whole term
      const l = new Map<number, number>();
      const h = new Map<number, number>();
      add(l, from, c.end, remaining * 0.9);
      add(h, from, c.end, remaining * 1.1);
      low.clear();
      high.clear();
      l.forEach((v, k) => low.set(k, v));
      h.forEach((v, k) => high.set(k, v));
      unknowns.push(
        'The number of licences is not fixed for the term. The range assumes it can move by 10% either way.',
      );
    }
  } else {
    const monthsElapsed = Math.max(1, daysBetween(c.start, today) / 30.4);
    const monthsLeft = Math.max(0, daysBetween(from, c.end) / 30.4);
    const rate = c.spent > 0 ? c.spent / monthsElapsed : 0;
    const projected = Math.min(remaining, rate * monthsLeft);
    const exp = c.spent > 0 ? projected : remaining * 0.5;
    add(low, from, c.end, Math.min(projected, exp));
    add(expected, from, c.end, exp);
    add(high, from, c.end, remaining);
    unknowns.push(
      c.docType === 'MASTER'
        ? 'A master agreement states a maximum aggregate spend, not a commitment. The range runs from the spend so far projected forward up to the maximum.'
        : 'Prices are set by a rate card and quantities are not fixed. The range runs from the spend so far projected forward up to the contract value.',
    );
    if (c.spent <= 0)
      unknowns.push(
        'No spend has been recorded yet, so the expected figure assumes half of what remains will be used.',
      );
  }

  // options to extend: possible, never committed
  const termMonths = Math.max(1, daysBetween(c.start, c.end) / 30.4);
  let extEnd = c.end;
  for (const e of exts.filter((x) => x.contractId === c.id && !x.exercised)) {
    const start = addDays(extEnd, 1);
    const end = addDays(extEnd, Math.round(e.months * 30.4));
    add(high, start, end, (c.value / termMonths) * e.months);
    unknowns.push(
      `An option to extend by ${e.months} months has not been exercised. It is counted only in the top of the range.`,
    );
    extEnd = end;
  }

  const firstFy = fyOf(today);
  const rows: YearFigure[] = [];
  for (let fy = firstFy; fy < firstFy + years; fy++) {
    const g = (m: Map<number, number>) => r2(m.get(fy) ?? 0);
    rows.push({
      fy,
      label: fyLabel(fy),
      committed: basis === 'FIXED' ? g(firm) : 0,
      low: g(low),
      expected: g(expected),
      high: g(high),
    });
  }
  // anything past the horizon is rolled into the last year so the totals still add up
  const last = rows[rows.length - 1]!;
  for (const m of [firm, low, expected, high])
    for (const [fy, v] of m)
      if (fy >= firstFy + years) {
        const key = m === firm ? 'committed' : m === low ? 'low' : m === expected ? 'expected' : 'high';
        if (key !== 'committed' || basis === 'FIXED') last[key] = r2(last[key] + v);
      }
  return {
    contractId: c.id,
    number: c.number,
    supplier: c.supplier,
    businessUnit: c.businessUnit,
    costCentre: c.costCentre,
    basis,
    years: rows,
    unknowns,
  };
}

export interface CommitmentRow {
  key: string;
  years: YearFigure[];
}
/** Adds the contracts up by business unit or by cost centre. */
export function rollup(list: Commitment[], by: 'businessUnit' | 'costCentre'): CommitmentRow[] {
  const groups = new Map<string, Commitment[]>();
  for (const c of list) groups.set(c[by], [...(groups.get(c[by]) ?? []), c]);
  return [...groups.entries()]
    .map(([key, cs]) => ({
      key,
      years: cs[0]!.years.map((y, i) => ({
        fy: y.fy,
        label: y.label,
        committed: r2(cs.reduce((n, c) => n + c.years[i]!.committed, 0)),
        low: r2(cs.reduce((n, c) => n + c.years[i]!.low, 0)),
        expected: r2(cs.reduce((n, c) => n + c.years[i]!.expected, 0)),
        high: r2(cs.reduce((n, c) => n + c.years[i]!.high, 0)),
      })),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// ------------------------------------------------------------------ spend optimisation (FR-0840)

export interface Assumptions {
  /** Share of the spend with the smaller suppliers in a category that consolidating onto one supplier might save. */
  consolidationPct: number;
  /** An invoice price this far from the contract rate is flagged. */
  varianceThresholdPct: number;
  /** The same item priced this far apart between two invoices from one supplier is flagged. */
  driftThresholdPct: number;
}
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  consolidationPct: 8,
  varianceThresholdPct: 5,
  driftThresholdPct: 10,
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const annualised = (c: ContractFact) => {
  if (!c.start || !c.end) return c.value;
  const years = Math.max(1, daysBetween(c.start, c.end) / 365);
  return c.value / years;
};

export interface Consolidation {
  category: string;
  suppliers: Array<{ supplier: string; annual: number }>;
  lead: string;
  addressable: number;
  estimatedSaving: number;
}
export function consolidation(contracts: ContractFact[], a: Assumptions): Consolidation[] {
  const by = new Map<string, ContractFact[]>();
  for (const c of contracts) by.set(c.category, [...(by.get(c.category) ?? []), c]);
  const out: Consolidation[] = [];
  for (const [category, cs] of by) {
    const bySup = new Map<string, number>();
    for (const c of cs) bySup.set(c.supplier, (bySup.get(c.supplier) ?? 0) + annualised(c));
    if (bySup.size < 2) continue;
    const sorted = [...bySup.entries()].sort((x, y) => y[1] - x[1]);
    const addressable = sorted.slice(1).reduce((n, [, v]) => n + v, 0);
    out.push({
      category,
      suppliers: sorted.map(([supplier, annual]) => ({ supplier, annual: r2(annual) })),
      lead: sorted[0]![0],
      addressable: r2(addressable),
      estimatedSaving: r2((addressable * a.consolidationPct) / 100),
    });
  }
  return out.sort((x, y) => y.estimatedSaving - x.estimatedSaving);
}

export interface DuplicateContract {
  a: { id: string; number: string; title: string | null };
  b: { id: string; number: string; title: string | null };
  supplier: string;
  reason: string;
  overlapDays: number;
  annualOverlap: number;
}
export function duplicateContracts(contracts: ContractFact[]): DuplicateContract[] {
  const out: DuplicateContract[] = [];
  for (let i = 0; i < contracts.length; i++)
    for (let j = i + 1; j < contracts.length; j++) {
      const a = contracts[i]!;
      const b = contracts[j]!;
      if (a.supplierId !== b.supplierId || !a.start || !a.end || !b.start || !b.end) continue;
      const from = a.start > b.start ? a.start : b.start;
      const to = a.end < b.end ? a.end : b.end;
      const overlap = daysBetween(from, to) + 1;
      if (overlap < 30) continue;
      const sim = nameSimilarity(a.title ?? a.category, b.title ?? b.category);
      const sameCat = a.category === b.category;
      if (!sameCat && sim < 0.8) continue;
      out.push({
        a: { id: a.id, number: a.number, title: a.title },
        b: { id: b.id, number: b.number, title: b.title },
        supplier: a.supplier,
        reason:
          sim >= 0.8
            ? 'Almost the same name, with the same supplier, over the same period'
            : 'The same supplier and category, over the same period',
        overlapDays: overlap,
        annualOverlap: r2(Math.min(annualised(a), annualised(b))),
      });
    }
  return out.sort((x, y) => y.annualOverlap - x.annualOverlap);
}

export interface RateGap {
  item: string;
  unit: string;
  lowest: { supplier: string; contract: string; unitPrice: number };
  others: Array<{ supplier: string; contract: string; unitPrice: number; gapPct: number }>;
  volume12m: number;
  estimatedSaving: number | null;
}
export function rateCardOptimisation(
  rates: RateFact[],
  lines: LineFact[],
  numbers: Map<string, string>,
  today: string,
): RateGap[] {
  const by = new Map<string, RateFact[]>();
  for (const r of rates) by.set(norm(r.item), [...(by.get(norm(r.item)) ?? []), r]);
  const since = addDays(today, -365);
  const out: RateGap[] = [];
  for (const [item, rs] of by) {
    if (rs.length < 2) continue;
    const sorted = [...rs].sort((x, y) => x.unitPrice - y.unitPrice);
    const low = sorted[0]!;
    const others = sorted
      .slice(1)
      .filter((o) => o.unitPrice > low.unitPrice)
      .map((o) => ({
        supplier: o.supplier,
        contract: numbers.get(o.contractId) ?? '',
        unitPrice: o.unitPrice,
        gapPct: r2(((o.unitPrice - low.unitPrice) / low.unitPrice) * 100),
      }));
    if (!others.length) continue;
    // what was bought at the higher rates, last twelve months
    const recent = lines.filter((l) => norm(l.item) === item && l.date >= since && l.status !== 'BLOCKED');
    const volume = recent.reduce((n, l) => n + l.qty, 0);
    const saving = recent.reduce((n, l) => n + Math.max(0, l.unitPrice - low.unitPrice) * l.qty, 0);
    out.push({
      item: rs[0]!.item,
      unit: rs[0]!.unit,
      lowest: {
        supplier: low.supplier,
        contract: numbers.get(low.contractId) ?? '',
        unitPrice: low.unitPrice,
      },
      others,
      volume12m: volume,
      estimatedSaving: recent.length ? r2(saving) : null,
    });
  }
  return out.sort(
    (x, y) =>
      (y.estimatedSaving ?? 0) - (x.estimatedSaving ?? 0) || y.others[0]!.gapPct - x.others[0]!.gapPct,
  );
}

export interface PriceVariance {
  kind: 'VS_CONTRACT_RATE' | 'DRIFT';
  /** An invoice that was blocked at the price check, so the extra was never paid. */
  blocked: boolean;
  item: string;
  supplier: string;
  contract: string;
  detail: string;
  variancePct: number;
  impact: number;
}
export function priceVariance(
  rates: RateFact[],
  lines: LineFact[],
  numbers: Map<string, string>,
  a: Assumptions,
): PriceVariance[] {
  const out: PriceVariance[] = [];
  const rateOf = new Map(rates.map((r) => [`${r.contractId}|${norm(r.item)}`, r]));
  for (const l of lines) {
    const r = rateOf.get(`${l.contractId}|${norm(l.item)}`);
    if (!r || r.unitPrice <= 0) continue;
    const v = ((l.unitPrice - r.unitPrice) / r.unitPrice) * 100;
    if (Math.abs(v) <= a.varianceThresholdPct) continue;
    out.push({
      kind: 'VS_CONTRACT_RATE',
      blocked: l.status === 'BLOCKED',
      item: l.item,
      supplier: l.supplier,
      contract: numbers.get(l.contractId) ?? '',
      detail: `Invoiced at ${l.unitPrice} against a contract rate of ${r.unitPrice}`,
      variancePct: r2(v),
      impact: r2((l.unitPrice - r.unitPrice) * l.qty),
    });
  }
  const group = new Map<string, LineFact[]>();
  for (const l of lines.filter((x) => x.status !== 'BLOCKED'))
    group.set(`${l.supplierId}|${norm(l.item)}`, [
      ...(group.get(`${l.supplierId}|${norm(l.item)}`) ?? []),
      l,
    ]);
  for (const ls of group.values()) {
    if (ls.length < 2) continue;
    const sorted = [...ls].sort((x, y) => (x.date < y.date ? -1 : 1));
    const min = Math.min(...ls.map((x) => x.unitPrice));
    const max = Math.max(...ls.map((x) => x.unitPrice));
    if (min <= 0 || ((max - min) / min) * 100 <= a.driftThresholdPct) continue;
    const first = sorted[0]!;
    const last = sorted.at(-1)!;
    out.push({
      kind: 'DRIFT',
      blocked: false,
      item: first.item,
      supplier: first.supplier,
      contract: numbers.get(first.contractId) ?? '',
      detail: `The same item was invoiced between ${min} and ${max}`,
      variancePct: r2(((max - min) / min) * 100),
      impact: r2(ls.reduce((n, l) => n + (l.unitPrice - min) * l.qty, 0)),
    });
    void last;
  }
  return out.sort((x, y) => Math.abs(y.impact) - Math.abs(x.impact));
}

export interface CategoryOpportunity {
  category: string;
  annualSpend: number;
  contracts: number;
  suppliers: number;
  topSupplierSharePct: number;
  nextExpiry: string | null;
  tenders: number;
  signal: 'MARKET_TEST' | 'CONSOLIDATE' | 'RENEGOTIATE' | 'MONITOR';
  why: string;
}
/** One row per category: how much is spent, how concentrated it is, whether it was ever put to market, and what to do about it. */
export function categoryMap(
  contracts: ContractFact[],
  tendersByCategory: Map<string, number>,
  today: string,
  spendFloor = 50_000,
): CategoryOpportunity[] {
  const by = new Map<string, ContractFact[]>();
  for (const c of contracts) by.set(c.category, [...(by.get(c.category) ?? []), c]);
  const out: CategoryOpportunity[] = [];
  for (const [category, cs] of by) {
    const spend = cs.reduce((n, c) => n + annualised(c), 0);
    const bySup = new Map<string, number>();
    for (const c of cs) bySup.set(c.supplier, (bySup.get(c.supplier) ?? 0) + annualised(c));
    const top = Math.max(...bySup.values());
    const share = spend > 0 ? (top / spend) * 100 : 0;
    const expiries = cs
      .map((c) => c.end)
      .filter((e): e is string => !!e && e >= today)
      .sort();
    const next = expiries[0] ?? null;
    const tenders = tendersByCategory.get(category) ?? 0;
    let signal: CategoryOpportunity['signal'] = 'MONITOR';
    let why = 'Nothing stands out; keep watching it.';
    if (bySup.size >= 3) {
      signal = 'CONSOLIDATE';
      why = `${bySup.size} suppliers share this category. Consolidating could win better rates.`;
    } else if (next && daysBetween(today, next) <= 180) {
      signal = 'RENEGOTIATE';
      why = `A contract ends on ${next}. It is the moment to renegotiate or go to market.`;
    }
    if (bySup.size <= 2 && share >= 80 && spend >= spendFloor && tenders <= 1) {
      signal = 'MARKET_TEST';
      why = `${Math.round(share)}% of the spend is with one supplier and the category has been to market ${tenders === 0 ? 'never' : 'once'}. Test the market.`;
    }
    out.push({
      category,
      annualSpend: r2(spend),
      contracts: cs.length,
      suppliers: bySup.size,
      topSupplierSharePct: r2(share),
      nextExpiry: next,
      tenders,
      signal,
      why,
    });
  }
  return out.sort((x, y) => y.annualSpend - x.annualSpend);
}
