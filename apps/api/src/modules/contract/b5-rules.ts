/**
 * Contract management rules (B5): the three-way match of purchase orders, contracts and invoices, price escalation,
 * rebates, spend thresholds, the fixed alert schedule, alert triggers read from clause wording, variation measures,
 * management and risk plans, and next-step suggestions. Pure functions on plain values, so every rule is tested
 * without a database. The "AI" parts are deterministic rules labelled `rules-simulated-v1` (docs/swap-points.md).
 */
import { addDays, addMonths, daysBetween } from './dates.js';

export const B5_MODEL = 'rules-simulated-v1';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 });
export const money = (n: number) => aud.format(n);

// ---------------------------------------------------------------- price escalation (FR-0525)
export interface EscalationRow {
  kind: 'CPI' | 'SCHEDULED';
  effectiveOn: string;
  pct: number;
  capPct: number | null;
}

/** What may be added to the price: a scheduled step as written, or the index movement up to its cap. */
export const allowedPct = (e: EscalationRow) =>
  e.kind === 'CPI' ? Math.min(e.pct, e.capPct ?? e.pct) : e.pct;

/** The multiplier on the rate card that is due on a date: every escalation that has taken effect, compounded. */
export function escalationFactor(rows: EscalationRow[], on: string): number {
  return r4(
    rows
      .filter((e) => e.effectiveOn <= on)
      .sort((a, b) => a.effectiveOn.localeCompare(b.effectiveOn))
      .reduce((f, e) => f * (1 + allowedPct(e) / 100), 1),
  );
}

// ---------------------------------------------------------------- three-way match (FR-0500, FR-0525)
export interface Line {
  item: string;
  qty: number;
  unitPrice: number;
}
export interface Finding {
  code:
    | 'NO_PO'
    | 'NOT_ON_CONTRACT'
    | 'RATE_INCREASE'
    | 'ESCALATION_OUTSIDE_FORMULA'
    | 'NOT_ON_PO'
    | 'PO_PRICE_MISMATCH'
    | 'OVER_PO_QTY'
    | 'OVER_PO_AMOUNT'
    | 'NO_RATE_CARD';
  /** A BLOCK holds the invoice; a FLAG is shown but does not hold it. */
  severity: 'BLOCK' | 'FLAG';
  item?: string;
  message: string;
}

export interface MatchInput {
  invoiceDate: string;
  lines: Line[];
  rates: Map<string, number>;
  escalations: EscalationRow[];
  /** The purchase order the invoice is raised against, with what has been invoiced on it already. */
  po: {
    number: string;
    amount: number;
    lines: Line[];
    invoicedQty: Map<string, number>;
    invoicedAmount: number;
  } | null;
  /** Where the ERP is integrated, an invoice must carry a purchase order. */
  requirePo: boolean;
}

export const lineTotal = (lines: Line[]) => r2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));

export function matchInvoice(i: MatchInput): Finding[] {
  const out: Finding[] = [];
  const factor = escalationFactor(i.escalations, i.invoiceDate);
  if (!i.po && i.requirePo)
    out.push({
      code: 'NO_PO',
      severity: 'BLOCK',
      message: 'The invoice has no purchase order, so the three-way match cannot be completed',
    });
  if (i.rates.size === 0)
    out.push({
      code: 'NO_RATE_CARD',
      severity: 'FLAG',
      message: 'The contract has no rate card, so prices could not be checked against it',
    });
  const poBy = new Map((i.po?.lines ?? []).map((l) => [l.item.toLowerCase(), l]));
  const invoiced = new Map<string, number>();
  for (const l of i.lines) {
    const key = l.item.toLowerCase();
    if (i.rates.size > 0) {
      const rate = [...i.rates.entries()].find(([k]) => k.toLowerCase() === key)?.[1];
      if (rate === undefined)
        out.push({
          code: 'NOT_ON_CONTRACT',
          severity: 'BLOCK',
          item: l.item,
          message: `"${l.item}" is not on the contract rate card`,
        });
      else {
        const expected = r4(rate * factor);
        if (l.unitPrice > expected + 0.00005) {
          const escalated = i.escalations.length > 0;
          const upcoming = i.escalations
            .filter((e) => e.effectiveOn > i.invoiceDate)
            .sort((a, b) => a.effectiveOn.localeCompare(b.effectiveOn))[0];
          out.push({
            code: escalated ? 'ESCALATION_OUTSIDE_FORMULA' : 'RATE_INCREASE',
            severity: 'BLOCK',
            item: l.item,
            message: escalated
              ? `"${l.item}" is invoiced at ${money(l.unitPrice)}, above the ${money(expected)} the escalation clause allows on ${i.invoiceDate} (rate card ${money(rate)}${
                  factor > 1 ? `, escalated ${r2((factor - 1) * 100)}%` : ''
                })${upcoming && factor === 1 ? `; the first escalation is not due until ${upcoming.effectiveOn}` : ''}`
              : `"${l.item}" is invoiced at ${money(l.unitPrice)}, above the contracted ${money(rate)}: an unapproved price increase`,
          });
        }
      }
    }
    if (i.po) {
      const pl = poBy.get(key);
      if (!pl)
        out.push({
          code: 'NOT_ON_PO',
          severity: 'BLOCK',
          item: l.item,
          message: `"${l.item}" is not on purchase order ${i.po.number}`,
        });
      else if (l.unitPrice > pl.unitPrice + 0.00005)
        out.push({
          code: 'PO_PRICE_MISMATCH',
          severity: 'BLOCK',
          item: l.item,
          message: `"${l.item}" is invoiced at ${money(l.unitPrice)} but ordered at ${money(pl.unitPrice)}`,
        });
      invoiced.set(key, (invoiced.get(key) ?? 0) + l.qty);
    }
  }
  if (i.po) {
    for (const [key, qty] of invoiced) {
      const pl = poBy.get(key);
      if (!pl) continue;
      const before = i.po.invoicedQty.get(key) ?? 0;
      if (before + qty > pl.qty + 0.00005)
        out.push({
          code: 'OVER_PO_QTY',
          severity: 'BLOCK',
          item: pl.item,
          message: `"${pl.item}": ${before + qty} invoiced against ${pl.qty} ordered`,
        });
    }
    const total = lineTotal(i.lines);
    if (i.po.invoicedAmount + total > i.po.amount + 0.005)
      out.push({
        code: 'OVER_PO_AMOUNT',
        severity: 'BLOCK',
        message: `Invoiced ${money(i.po.invoicedAmount + total)} would exceed purchase order ${i.po.number} (${money(i.po.amount)})`,
      });
  }
  return out;
}

// ---------------------------------------------------------------- rebates (FR-0520)
export type RebateStatus = 'OPEN' | 'EARNED_TO_CLAIM' | 'NOT_EARNED' | 'CLAIMED' | 'MISSED' | 'UNDER_CLAIMED';
export interface RebateInput {
  threshold: number;
  ratePct: number;
  periodStart: string;
  periodEnd: string;
  claimed: number;
}
export interface RebateResult {
  spend: number;
  earned: number;
  claimed: number;
  shortfall: number;
  status: RebateStatus;
  /** Missed and under-claimed rebates are flagged for follow-up. */
  flagged: boolean;
  message: string;
}

/** The rebate earned is the rate on all spend in the period once the threshold is reached. */
export function evaluateRebate(r: RebateInput, spend: number, today: string): RebateResult {
  const earned = spend >= r.threshold ? r2((spend * r.ratePct) / 100) : 0;
  const ended = today > r.periodEnd;
  const shortfall = r2(Math.max(0, earned - r.claimed));
  let status: RebateStatus;
  let message: string;
  if (!ended) {
    status = earned > r.claimed + 0.005 ? 'EARNED_TO_CLAIM' : 'OPEN';
    message =
      earned > 0
        ? `${money(earned)} earned so far in the period; claim it when the period ends`
        : `Spend of ${money(spend)} is ${money(Math.max(0, r.threshold - spend))} short of the ${money(r.threshold)} threshold`;
  } else if (earned === 0) {
    status = 'NOT_EARNED';
    message = `The ${money(r.threshold)} threshold was not reached (spend ${money(spend)})`;
  } else if (r.claimed <= 0.005) {
    status = 'MISSED';
    message = `${money(earned)} was earned and has not been claimed`;
  } else if (r.claimed < earned - 0.005) {
    status = 'UNDER_CLAIMED';
    message = `${money(r.claimed)} was claimed but ${money(earned)} was earned: ${money(shortfall)} is outstanding`;
  } else {
    status = 'CLAIMED';
    message = `${money(r.claimed)} claimed in full`;
  }
  return {
    spend: r2(spend),
    earned,
    claimed: r2(r.claimed),
    shortfall,
    status,
    flagged: status === 'MISSED' || status === 'UNDER_CLAIMED',
    message,
  };
}

// ---------------------------------------------------------------- spend thresholds (FR-0510, FR-0580)
/** Fixed notice points for a breach of the authorised limit: not configurable and not mutable. */
export const MANDATORY_SPEND_PCTS = [80, 90, 100] as const;

export function spendCrossings(spentPct: number, configuredPct: number, already: Set<string>) {
  const out: Array<{ kind: 'MANDATORY' | 'CONFIGURED'; threshold: number }> = [];
  for (const t of MANDATORY_SPEND_PCTS)
    if (spentPct >= t && !already.has(`MANDATORY:${t}`)) out.push({ kind: 'MANDATORY', threshold: t });
  if (spentPct >= configuredPct && !already.has(`CONFIGURED:${configuredPct}`))
    out.push({ kind: 'CONFIGURED', threshold: configuredPct });
  return out;
}

// ---------------------------------------------------------------- fixed alert schedule (FR-0510)
/** Alert kinds no one can mute or change (FR-0510); everything else follows the user's preferences. */
export const MANDATORY_KINDS = ['COUNTDOWN', 'INSURANCE'] as const;
export const COUNTDOWN_DAYS = [180, 90, 60] as const;
export const INSURANCE_LEAD_DAYS = 30;

export interface Countdown {
  triggerDate: string;
  note: string;
}

/** 180, 90 and 60 days before expiry, and before the extension decision closes where an extension is on offer. */
export function countdownAlerts(
  c: { endDate: string; noticeDays: number; hasExtensions: boolean },
  today: string,
): Countdown[] {
  const out: Countdown[] = [];
  for (const n of COUNTDOWN_DAYS)
    out.push({ triggerDate: addDays(c.endDate, -n), note: `Expiry is ${n} days away` });
  if (c.hasExtensions) {
    const close = addDays(c.endDate, -c.noticeDays);
    for (const n of COUNTDOWN_DAYS)
      out.push({
        triggerDate: addDays(close, -n),
        note: `The extension decision closes in ${n} days (${close})`,
      });
  }
  const seen = new Set<string>();
  return out
    .filter((a) => a.triggerDate >= today)
    .filter((a) => (seen.has(a.triggerDate) ? false : (seen.add(a.triggerDate), true)))
    .sort((a, b) => a.triggerDate.localeCompare(b.triggerDate));
}

/** The insurance-lapse warning date for a certificate that expires on the given day. */
export const insuranceAlertDate = (expiresOn: string) => addDays(expiresOn, -INSURANCE_LEAD_DAYS);

// ---------------------------------------------------------------- triggers read from clause wording (FR-0530)
export interface TriggerProposal {
  key: string;
  clauseId: string;
  clauseTitle: string;
  quote: string;
  summary: string;
  triggerDate: string;
}

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
};
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : (WORDS[s.toLowerCase()] ?? 0));
export const CLAUSE_ALERT_LEAD_DAYS = 30;

/**
 * Reads the clauses for notice periods, review cycles and anniversaries and proposes the alerts they imply: a notice
 * period of N months or days means an alert a month before the last day to give it. A person confirms each proposal.
 */
export function extractTriggers(
  clauses: Array<{ clauseId: string; title: string; text: string }>,
  c: { startDate: string; endDate: string },
  today: string,
): TriggerProposal[] {
  const out: TriggerProposal[] = [];
  const add = (
    k: { clauseId: string; title: string },
    quote: string,
    summary: string,
    date: string,
    key: string,
  ) => {
    if (date < today) return;
    if (!out.some((o) => o.key === `${k.clauseId}:${key}`))
      out.push({
        key: `${k.clauseId}:${key}`,
        clauseId: k.clauseId,
        clauseTitle: k.title,
        quote: quote.trim().slice(0, 200),
        summary,
        triggerDate: date,
      });
  };
  for (const k of clauses) {
    const t = k.text.replace(/\s+/g, ' ');
    const notice =
      /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)[- ](month|day|week)s?['’]?\s+(?:written\s+)?notice/gi;
    for (const m of t.matchAll(notice)) {
      const n = num(m[1]!);
      if (n < 1) continue;
      const unit = m[2]!.toLowerCase();
      const last =
        unit === 'month' ? addMonths(c.endDate, -n) : addDays(c.endDate, -n * (unit === 'week' ? 7 : 1));
      const about = /terminat/i.test(t)
        ? 'termination notice'
        : /extension|renew|decline/i.test(t)
          ? 'notice about the extension'
          : 'notice';
      add(
        k,
        m[0],
        `Last day to give ${n} ${unit}${n > 1 ? 's' : ''} of ${about} is ${last}; reminder ${CLAUSE_ALERT_LEAD_DAYS} days before`,
        addDays(last, -CLAUSE_ALERT_LEAD_DAYS),
        `notice-${n}-${unit}`,
      );
    }
    const cycle =
      /(?:review|reviewed|meet|meeting|report|audit)[^.]{0,60}?every\s+(\d+|one|two|three|four|six|twelve)\s+(month|week)s?/gi;
    for (const m of t.matchAll(cycle)) {
      const n = num(m[1]!);
      if (n < 1) continue;
      const step = (i: number) =>
        m[2]!.toLowerCase() === 'month' ? addMonths(c.startDate, n * i) : addDays(c.startDate, n * 7 * i);
      for (let i = 1; i <= 24; i++) {
        const d = step(i);
        if (d > c.endDate) break;
        if (d >= today) {
          add(
            k,
            m[0],
            `Review due (every ${n} ${m[2]!.toLowerCase()}s) on ${d}`,
            d,
            `cycle-${n}-${m[2]!.toLowerCase()}-${d}`,
          );
          break;
        }
      }
    }
    const yearly = /(annual(?:ly)?|each year|every year|on each anniversary)/i.exec(t);
    if (yearly && /(review|adjust|certificate|renew|audit|price)/i.test(t) && !cycle.test(t)) {
      for (let y = 1; y <= 10; y++) {
        const d = addMonths(c.startDate, 12 * y);
        if (d > c.endDate) break;
        if (addDays(d, -CLAUSE_ALERT_LEAD_DAYS) >= today) {
          add(
            k,
            yearly[0],
            `Annual obligation (${k.title.toLowerCase()}) falls due on ${d}; reminder ${CLAUSE_ALERT_LEAD_DAYS} days before`,
            addDays(d, -CLAUSE_ALERT_LEAD_DAYS),
            `annual-${d}`,
          );
          break;
        }
      }
    }
  }
  return out.sort((a, b) => a.triggerDate.localeCompare(b.triggerDate));
}

// ---------------------------------------------------------------- variations (FR-0535, FR-0540, FR-0545)
export type VariationModel = 'CUMULATIVE' | 'INCREMENTAL';

export interface VariationMeasure {
  model: VariationModel;
  /** The change as a share of what it is measured against, as a percentage. */
  variancePct: number;
  /** The value the delegate and signing authority is judged on. */
  authorityValue: number;
  /** The value the same measure gives before this variation, to see whether it changes the tier. */
  authorityBefore: number;
  cumulativeValue: number;
  base: number;
}

/**
 * Cumulative: the whole contract so far, including every variation, against the original value. Incremental: only the
 * additional spend of this variation, against the contract as it stood.
 */
export function measureVariation(
  model: VariationModel,
  m: { original: number; earlier: number; value: number },
): VariationMeasure {
  const standing = m.original + m.earlier;
  const cumulativeValue = standing + m.value;
  const base = model === 'CUMULATIVE' ? m.original : standing;
  const change = model === 'CUMULATIVE' ? m.earlier + m.value : m.value;
  return {
    model,
    variancePct: base > 0 ? r2((change / base) * 100) : 0,
    authorityValue: model === 'CUMULATIVE' ? cumulativeValue : m.value,
    authorityBefore: model === 'CUMULATIVE' ? standing : 0,
    cumulativeValue,
    base,
  };
}

// ---------------------------------------------------------------- management and risk plans (FR-0555)
export type PlanTier = 'STANDARD' | 'ELEVATED' | 'HIGH';
export interface PlanFacts {
  value: number;
  termMonths: number;
  highValueAud: number;
  supplierRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  insuranceCurrent: boolean;
  highDeviations: number;
}

export function planTier(f: PlanFacts): { tier: PlanTier; score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (f.value >= f.highValueAud) {
    score += 2;
    reasons.push(
      `The value (${money(f.value)}) is at or above the high-value line of ${money(f.highValueAud)}`,
    );
  } else if (f.value >= f.highValueAud / 2) {
    score += 1;
    reasons.push(`The value (${money(f.value)}) is above half the high-value line`);
  }
  if (f.termMonths >= 36) {
    score += 1;
    reasons.push(`A long term of ${f.termMonths} months`);
  }
  if (f.supplierRisk === 'HIGH') {
    score += 2;
    reasons.push('The supplier shows a high financial risk');
  } else if (f.supplierRisk === 'MEDIUM') {
    score += 1;
    reasons.push('The supplier shows a medium financial risk');
  }
  if (!f.insuranceCurrent) {
    score += 1;
    reasons.push('The supplier has no current insurance certificate on record');
  }
  if (f.highDeviations > 0) {
    score += 1;
    reasons.push(`${f.highDeviations} high-risk deviation(s) from the standard terms`);
  }
  return { tier: score >= 4 ? 'HIGH' : score >= 2 ? 'ELEVATED' : 'STANDARD', score, reasons };
}

export interface PlanSection {
  title: string;
  text: string;
}
export interface PlanActivity {
  plan: 'CMP' | 'RMP';
  title: string;
  dueDate: string;
}

export const STANDARD_CMP: PlanSection[] = [
  {
    title: 'Purpose and scope',
    text: 'This plan sets out how {{CONTRACT}} with {{SUPPLIER}} ({{VALUE}} over {{TERM_MONTHS}} months, {{START}} to {{END}}) is managed, so that the outcomes in the contract are delivered and paid for correctly.',
  },
  {
    title: 'Roles and responsibilities',
    text: 'The contract owner is {{OWNER}}. The owner approves variations for review, monitors performance and spend, and is the point of contact for the supplier. Legal advises on changes; Finance confirms payments against the rate card.',
  },
  {
    title: 'Performance management',
    text: 'Performance is reviewed against the service levels in the contract at the intervals set out in the activity list for this {{TIER}} tier. Under-performance is recorded, raised with the supplier in writing and followed up.',
  },
  {
    title: 'Financial management',
    text: 'Invoices are matched to purchase orders and the rate card before payment. Spend is tracked against the contract value and the alerts at 80, 90 and 100 per cent are acted on.',
  },
  {
    title: 'Governance and reporting',
    text: 'The contract owner reports status, spend, risks and open activities to the delegate at each review.',
  },
  {
    title: 'Variations and change',
    text: 'Changes go through the variation workflow with a business case; the cumulative effect on value and authority is checked each time.',
  },
  {
    title: 'Dispute resolution and exit',
    text: 'Disputes are escalated in the order set out in the contract. Expiry and renewal planning starts at least six months before the end date ({{END}}).',
  },
];

export const STANDARD_RMP: PlanSection[] = [
  {
    title: 'Risk context',
    text: 'This contract is rated {{TIER}} for management. The reasons are listed with this plan and are reviewed when circumstances change.',
  },
  {
    title: 'Key risks and treatments',
    text: 'Supplier failure or insolvency (monitor financial standing and keep a fallback), lapse of insurance (the certificate is monitored and a hold stops new purchase orders if cover lapses), price creep (three-way match and escalation checks), and dependency on a single supplier (exit and transition plan).',
  },
  {
    title: 'Monitoring and reporting',
    text: 'The risk register is reviewed at the intervals in the activity list. New risks are added when found and reported to the delegate.',
  },
  {
    title: 'Escalation',
    text: 'A risk rated high, or one that cannot be treated by the contract owner, is escalated to the delegate and the risk owner the same week.',
  },
  {
    title: 'Contingency and exit',
    text: 'The exit plan covers transfer of data and knowledge and the notice dates in the contract. It is rehearsed before the extension decision.',
  },
];

const fillPlan = (text: string, v: Record<string, string>) =>
  text.replace(/\{\{([A-Z_]+)\}\}/g, (all, k: string) => v[k] ?? all);

export function buildPlanSections(
  kind: 'CMP' | 'RMP',
  custom: PlanSection[] | null,
  vars: Record<string, string>,
): { template: string; sections: PlanSection[] } {
  const base = custom ?? (kind === 'CMP' ? STANDARD_CMP : STANDARD_RMP);
  return {
    template: custom ? 'CUSTOM' : 'STANDARD',
    sections: base.map((s) => ({ title: fillPlan(s.title, vars), text: fillPlan(s.text, vars) })),
  };
}

const CADENCE: Record<PlanTier, number> = { STANDARD: 12, ELEVATED: 6, HIGH: 3 };

/** How many activities a contract generates grows with its size, term and risk. */
export function planActivities(
  tier: PlanTier,
  c: { startDate: string; endDate: string; termMonths: number },
  today: string,
): PlanActivity[] {
  const out: PlanActivity[] = [];
  const every = CADENCE[tier];
  const monthly = (plan: 'CMP' | 'RMP', title: string, months: number, cap: number) => {
    for (let i = 1; i <= cap; i++) {
      const d = addMonths(c.startDate, months * i);
      if (d >= c.endDate) break;
      out.push({ plan, title: `${title} (${i})`, dueDate: d });
    }
  };
  out.push({ plan: 'CMP', title: 'Kick-off meeting with the supplier', dueDate: addDays(c.startDate, 14) });
  monthly('CMP', 'Performance review against service levels', every, 24);
  monthly('CMP', 'Confirm insurance certificates are current', tier === 'STANDARD' ? 12 : 6, 12);
  out.push({ plan: 'CMP', title: 'Expiry and renewal planning', dueDate: addDays(c.endDate, -180) });
  out.push({ plan: 'CMP', title: 'Close-out review', dueDate: c.endDate });
  monthly('RMP', 'Review the risk register', tier === 'HIGH' ? 3 : tier === 'ELEVATED' ? 6 : 12, 24);
  if (tier !== 'STANDARD') monthly('RMP', 'Check the supplier financial health', 6, 12);
  if (tier === 'HIGH') {
    monthly('RMP', 'Risk workshop with the supplier', 6, 12);
    out.push({ plan: 'RMP', title: 'Test the exit and transition plan', dueDate: addDays(c.endDate, -270) });
  }
  return out
    .filter((a) => a.dueDate >= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------- next steps near the end date (FR-0560)
export interface NextStepFacts {
  today: string;
  endDate: string;
  noticeDays: number;
  extensionsTotal: number;
  extensionsExercised: number;
  nextExtensionMonths: number | null;
  extensionProcurementOpen: boolean;
  renewalProcurementOpen: boolean;
  spendPct: number;
  overdueActivities: number;
  hold: boolean;
}
export interface NextStep {
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  action: 'EXTEND' | 'RENEW' | 'VARY' | 'REVIEW' | 'RESOLVE' | 'NOTICE';
  text: string;
  why: string;
}

/** Suggestions for the contract owner as the end date approaches. */
export function nextSteps(f: NextStepFacts): NextStep[] {
  const left = daysBetween(f.today, f.endDate);
  const notice = addDays(f.endDate, -f.noticeDays);
  const toNotice = daysBetween(f.today, notice);
  const out: NextStep[] = [];
  if (f.hold)
    out.push({
      priority: 'HIGH',
      action: 'RESOLVE',
      text: 'Get a current insurance certificate from the supplier',
      why: 'New purchase orders are on hold while the mandatory cover has lapsed.',
    });
  if (left < 0)
    out.push({
      priority: 'HIGH',
      action: 'RENEW',
      text: 'The contract has ended: confirm no services are being supplied without cover, or start a renewal',
      why: `The end date was ${f.endDate}.`,
    });
  else if (left <= 270) {
    const remaining = f.extensionsTotal - f.extensionsExercised;
    if (remaining > 0 && !f.extensionProcurementOpen)
      out.push({
        priority: toNotice <= 90 ? 'HIGH' : 'MEDIUM',
        action: 'EXTEND',
        text: `Decide whether to take up the next extension${f.nextExtensionMonths ? ` (${f.nextExtensionMonths} months)` : ''}${toNotice >= 0 ? ` by ${notice}` : ''}`,
        why:
          toNotice >= 0
            ? `${remaining} extension(s) remain and the decision closes in ${toNotice} day(s).`
            : `${remaining} extension(s) remain but the notice date has passed.`,
      });
    if (remaining === 0 && !f.renewalProcurementOpen)
      out.push({
        priority: left <= 180 ? 'HIGH' : 'MEDIUM',
        action: 'RENEW',
        text: 'Start a renewal procurement now: a new tender usually needs six months or more',
        why: `No extension is left and the contract ends in ${left} day(s).`,
      });
    if (toNotice >= 0 && toNotice <= 60)
      out.push({
        priority: 'HIGH',
        action: 'NOTICE',
        text: `Last chance to give notice (${notice}) if you do not want the contract to continue`,
        why: `The notice period is ${f.noticeDays} days.`,
      });
  }
  if (f.spendPct >= 90 && left > 0)
    out.push({
      priority: 'HIGH',
      action: 'VARY',
      text: 'Raise a variation or plan the end: most of the contract value is spent',
      why: `${f.spendPct}% of the value is spent with ${left} day(s) left.`,
    });
  else if (f.spendPct < 40 && left > 0 && left <= 180)
    out.push({
      priority: 'LOW',
      action: 'REVIEW',
      text: 'Review why little has been spent and whether the scope still fits',
      why: `Only ${f.spendPct}% of the value is spent with ${left} day(s) left.`,
    });
  if (f.overdueActivities > 0)
    out.push({
      priority: 'MEDIUM',
      action: 'REVIEW',
      text: `Complete ${f.overdueActivities} overdue contract management activit${f.overdueActivities > 1 ? 'ies' : 'y'}`,
      why: 'Overdue reviews weaken the position at renewal.',
    });
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  return out.sort((a, b) => rank[a.priority] - rank[b.priority]);
}

// ---------------------------------------------------------------- funding envelopes (FR-0585)
export function envelopeState(amount: number, committed: number, warnPct: number) {
  const remaining = r2(amount - committed);
  const usedPct = amount > 0 ? r2((committed / amount) * 100) : 0;
  return {
    remaining,
    usedPct,
    nearing: usedPct >= warnPct,
    exhausted: remaining <= 0.005,
  };
}
