/**
 * ESG and socio-economic plan metrics with ceilings and ratios checked (NFR-R05). Pure functions: the same inputs always
 * give the same answer, and every answer carries the arithmetic so a reader can check it.
 *
 * A metric is either a FLOOR (a target that must be reached: at least 5 percent of contract value goes to Indigenous
 * businesses) or a CEILING (a limit that must not be exceeded: at most 120 tonnes of CO2e per million dollars).
 * Figures are compared as shown, rounded to two decimal places (half away from zero), so what the reader sees and what is
 * judged never disagree.
 */
import type { Settings } from '../settings/settings.js';

export type EsgKey = keyof Settings['esgPlan']['limits'];
export type EsgStatus = 'PASS' | 'AT_RISK' | 'BREACH' | 'NO_DATA';
export type EsgKind = 'FLOOR' | 'CEILING';

export interface MetricDef {
  key: EsgKey;
  label: string;
  /** What is being measured, for the sentence. */
  measure: string;
  kind: EsgKind;
  unit: 'PCT' | 'T_PER_M' | 'RATING';
  /** The largest value a limit can take. */
  max: number;
  min: number;
}

export const ESG_METRICS: readonly MetricDef[] = [
  {
    key: 'INDIGENOUS_SPEND_PCT',
    label: 'Indigenous-owned spend',
    measure: 'Indigenous-owned spend',
    kind: 'FLOOR',
    unit: 'PCT',
    min: 0,
    max: 100,
  },
  {
    key: 'SOCIAL_ENTERPRISE_SPEND_PCT',
    label: 'Social enterprise spend',
    measure: 'Social enterprise spend',
    kind: 'FLOOR',
    unit: 'PCT',
    min: 0,
    max: 100,
  },
  {
    key: 'DISABILITY_EMPLOYMENT_SPEND_PCT',
    label: 'Disability employment spend',
    measure: 'Spend with disability enterprises',
    kind: 'FLOOR',
    unit: 'PCT',
    min: 0,
    max: 100,
  },
  {
    key: 'LOCAL_CONTENT_PCT',
    label: 'Local content',
    measure: 'Local content',
    kind: 'FLOOR',
    unit: 'PCT',
    min: 0,
    max: 100,
  },
  {
    key: 'SUPPLIER_DIVERSITY_PCT',
    label: 'Supplier diversity',
    measure: 'Spend with diversity-owned suppliers',
    kind: 'FLOOR',
    unit: 'PCT',
    min: 0,
    max: 100,
  },
  {
    key: 'SME_PANEL_PCT',
    label: 'SME share of the panel',
    measure: 'Small and medium suppliers on the panel',
    kind: 'FLOOR',
    unit: 'PCT',
    min: 0,
    max: 100,
  },
  {
    key: 'CARBON_INTENSITY_T_PER_M',
    label: 'Carbon intensity',
    measure: 'Carbon intensity',
    kind: 'CEILING',
    unit: 'T_PER_M',
    min: 0,
    max: 1_000_000,
  },
  {
    key: 'MODERN_SLAVERY_RISK',
    label: 'Modern slavery risk rating',
    measure: 'Highest modern slavery risk rating',
    kind: 'CEILING',
    unit: 'RATING',
    min: 1,
    max: 3,
  },
  {
    key: 'SINGLE_SUPPLIER_SHARE_PCT',
    label: 'Single supplier concentration',
    measure: 'Largest supplier share of contract spend',
    kind: 'CEILING',
    unit: 'PCT',
    min: 0,
    max: 100,
  },
];
export const METRIC_BY_KEY = new Map(ESG_METRICS.map((m) => [m.key, m]));

export const RATING_NAME: Record<number, string> = { 1: 'Low', 2: 'Medium', 3: 'High' };

/** Half away from zero, two decimal places (not the banker's rounding of some number formatters). */
export const round2 = (n: number): number => Math.sign(n) * (Math.round(Math.abs(n) * 100 + 1e-9) / 100);

/** part as a percent of whole, rounded; null when the whole is not a positive number (a ratio of nothing is undefined). */
export function pctOf(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return round2((part / whole) * 100);
}

export interface Evaluation {
  status: EsgStatus;
  /** The value as judged (rounded), or null when there is none. */
  value: number | null;
  /** How far on the wrong side of the limit, in the metric's unit (0 when it passes). */
  shortfall: number;
}

/**
 * Judges a value against its limit.
 *  FLOOR:   PASS at or above the target; AT_RISK within the band below it; BREACH under that.
 *  CEILING: PASS at or below the ceiling less the band; AT_RISK from there up to the ceiling; BREACH above it.
 * A zero floor always passes. A zero ceiling passes only at zero.
 */
export function evaluateMetric(
  kind: EsgKind,
  limit: number,
  value: number | null,
  bandPct: number,
): Evaluation {
  if (value === null || !Number.isFinite(value)) return { status: 'NO_DATA', value: null, shortfall: 0 };
  const v = round2(value);
  const l = round2(limit);
  const band = Math.max(0, bandPct) / 100;
  if (kind === 'FLOOR') {
    if (v >= l) return { status: 'PASS', value: v, shortfall: 0 };
    if (v >= round2(l * (1 - band))) return { status: 'AT_RISK', value: v, shortfall: round2(l - v) };
    return { status: 'BREACH', value: v, shortfall: round2(l - v) };
  }
  if (v > l) return { status: 'BREACH', value: v, shortfall: round2(v - l) };
  if (v > round2(l * (1 - band))) return { status: 'AT_RISK', value: v, shortfall: 0 };
  return { status: 'PASS', value: v, shortfall: 0 };
}

// ------------------------------------------------------------------ plan overrides
export interface OverrideCheck {
  ok: boolean;
  /** True when the plan's limit is looser than the organisation's: it needs a reason and an approver note. */
  relaxes: boolean;
  /** The loosest value the plan may take at all. */
  loosest: number;
  error?: string;
}

/**
 * Whether a plan may use `requested` instead of the organisation's limit. A stricter value is always fine. A looser one
 * is a relaxation: allowed only up to `maxRelaxationPct` of the organisation value, and only with a reason and an approver
 * note (checked by the caller). Nothing may leave the metric's own range (for example 0 to 100 percent).
 */
export function checkOverride(
  def: MetricDef,
  orgLimit: number,
  requested: number,
  maxRelaxationPct: number,
): OverrideCheck {
  const r = round2(requested);
  if (!Number.isFinite(r) || r < def.min || r > def.max)
    return {
      ok: false,
      relaxes: false,
      loosest: def.kind === 'CEILING' ? def.max : def.min,
      error: `The value must be between ${def.min} and ${def.max}`,
    };
  const rel = Math.max(0, maxRelaxationPct) / 100;
  if (def.kind === 'FLOOR') {
    const loosest = round2(orgLimit * (1 - rel));
    if (r >= orgLimit) return { ok: true, relaxes: false, loosest };
    return r >= loosest
      ? { ok: true, relaxes: true, loosest }
      : {
          ok: false,
          relaxes: true,
          loosest,
          error: `A plan may lower this target to ${loosest} at most (the organisation target is ${orgLimit})`,
        };
  }
  const loosest = Math.min(def.max, round2(orgLimit * (1 + rel)));
  if (r <= orgLimit) return { ok: true, relaxes: false, loosest };
  return r <= loosest
    ? { ok: true, relaxes: true, loosest }
    : {
        ok: false,
        relaxes: true,
        loosest,
        error: `A plan may raise this ceiling to ${loosest} at most (the organisation ceiling is ${orgLimit})`,
      };
}

// ------------------------------------------------------------------ actuals from the data
export interface SupplierEsg {
  carbonTonnesCo2e?: number | null | undefined;
  diversityOwned?: 'NONE' | 'INDIGENOUS' | 'WOMEN' | 'DISABILITY' | 'SOCIAL_ENTERPRISE' | null | undefined;
  modernSlaveryStatement?: boolean | null | undefined;
  modernSlaveryResult?: 'CLEAR' | 'REVIEW' | null | undefined;
}
export interface SpendLine {
  supplierId: string;
  company: string;
  /** What this supplier is paid under the plan's contracts. */
  spend: number;
  /** All the organisation's contract spend with this supplier (including this plan's). */
  organisationSpend: number;
  esg: SupplierEsg;
}
export interface Actual {
  value: number | null;
  /** The sums behind the value, in words. */
  arithmetic: string;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;
const pctText = (n: number) => `${n}%`;

export function slaveryRating(e: SupplierEsg): number | null {
  if (e.modernSlaveryResult === 'REVIEW') return 3;
  if (e.modernSlaveryStatement === true) return 1;
  if (e.modernSlaveryResult === 'CLEAR') return 2;
  return null;
}

/**
 * The metrics that can be worked out from awarded contracts and the suppliers' declared ESG data. `organisationTotal` is
 * all contract spend in the organisation, for the concentration check. Metrics that need data nobody holds (local content,
 * SME share of a panel) are not here: they come from the forecast the plan owner enters.
 */
export function actualsFromSpend(
  lines: SpendLine[],
  organisationTotal: number,
): Partial<Record<EsgKey, Actual>> {
  const out: Partial<Record<EsgKey, Actual>> = {};
  const total = lines.reduce((s, l) => s + l.spend, 0);
  if (lines.length === 0) return out;
  const share = (key: EsgKey, name: string, pick: (l: SpendLine) => boolean) => {
    const part = lines.filter(pick).reduce((s, l) => s + l.spend, 0);
    const v = pctOf(part, total);
    out[key] = {
      value: v,
      arithmetic:
        v === null
          ? 'The contract value is zero, so a share cannot be worked out'
          : `${name} ${money(part)} of ${money(total)} contract value = ${pctText(v)}`,
    };
  };
  share('INDIGENOUS_SPEND_PCT', 'Indigenous-owned spend', (l) => l.esg.diversityOwned === 'INDIGENOUS');
  share(
    'SOCIAL_ENTERPRISE_SPEND_PCT',
    'Social enterprise spend',
    (l) => l.esg.diversityOwned === 'SOCIAL_ENTERPRISE',
  );
  share(
    'DISABILITY_EMPLOYMENT_SPEND_PCT',
    'Spend with disability enterprises',
    (l) => l.esg.diversityOwned === 'DISABILITY',
  );
  share(
    'SUPPLIER_DIVERSITY_PCT',
    'Spend with diversity-owned suppliers',
    (l) => !!l.esg.diversityOwned && l.esg.diversityOwned !== 'NONE',
  );

  // carbon intensity: reported tonnes over the contract value of the suppliers that reported, per million dollars
  const reporters = lines.filter((l) => typeof l.esg.carbonTonnesCo2e === 'number');
  const reportedSpend = reporters.reduce((s, l) => s + l.spend, 0);
  const tonnes = reporters.reduce((s, l) => s + (l.esg.carbonTonnesCo2e ?? 0), 0);
  if (reporters.length > 0 && reportedSpend > 0) {
    const v = round2(tonnes / (reportedSpend / 1_000_000));
    out.CARBON_INTENSITY_T_PER_M = {
      value: v,
      arithmetic: `Reported emissions ${tonnes.toLocaleString('en-AU')} t CO2e over ${money(reportedSpend)} contract value = ${v} t per $m`,
    };
  } else
    out.CARBON_INTENSITY_T_PER_M = {
      value: null,
      arithmetic: 'No supplier has reported emissions, so an intensity cannot be worked out',
    };

  const ratings = lines.map((l) => ({ l, r: slaveryRating(l.esg) })).filter((x) => x.r !== null);
  if (ratings.length > 0) {
    const worst = ratings.reduce((a, b) => (b.r! > a.r! ? b : a));
    out.MODERN_SLAVERY_RISK = {
      value: worst.r!,
      arithmetic: `Highest rating is ${RATING_NAME[worst.r!]} (${worst.r}), for ${worst.l.company}`,
    };
  } else
    out.MODERN_SLAVERY_RISK = {
      value: null,
      arithmetic: 'No supplier has a modern slavery rating on record',
    };

  // concentration: the largest supplier's share of all the organisation's contract spend
  if (organisationTotal > 0) {
    const top = lines.reduce((a, b) => (b.organisationSpend > a.organisationSpend ? b : a));
    const v = pctOf(top.organisationSpend, organisationTotal);
    out.SINGLE_SUPPLIER_SHARE_PCT = {
      value: v,
      arithmetic:
        v === null
          ? 'There is no contract spend to compare'
          : `${top.company} holds ${money(top.organisationSpend)} of ${money(organisationTotal)} contract spend = ${pctText(v)}`,
    };
  }
  return out;
}

// ------------------------------------------------------------------ the sentence and the gate
export interface JudgedMetric {
  key: EsgKey;
  status: EsgStatus;
  /** An exception recorded by procurement and acknowledged by the delegate. */
  excepted: boolean;
}

/** The plan gate: satisfied when every metric passes (or has no data) or carries an acknowledged exception. */
export function gateOf(metrics: JudgedMetric[]): 'REQUIRED' | 'SATISFIED' {
  return metrics.some((m) => m.status === 'BREACH' && !m.excepted) ? 'REQUIRED' : 'SATISFIED';
}

/** "Indigenous-owned spend 4% of contract value vs target 5%", the sentence a reader checks first. */
export function summaryLine(def: MetricDef, value: number | null, limit: number): string {
  const unit = def.unit === 'PCT' ? '%' : def.unit === 'T_PER_M' ? ' t per $m' : '';
  const limitWord = def.kind === 'FLOOR' ? 'target' : 'ceiling';
  if (def.unit === 'RATING') {
    const v = value === null ? 'no rating' : `${RATING_NAME[Math.round(value)] ?? value} (${value})`;
    return `${def.measure} ${v} vs ${limitWord} ${RATING_NAME[Math.round(limit)] ?? limit} (${limit})`;
  }
  const base =
    def.key === 'LOCAL_CONTENT_PCT'
      ? ' of labour hours'
      : def.key === 'SME_PANEL_PCT'
        ? ' of the panel'
        : def.unit === 'PCT'
          ? ' of contract value'
          : '';
  return `${def.measure} ${value === null ? 'has no figure yet' : `${value}${unit}${base}`} vs ${limitWord} ${limit}${unit}`;
}
