/**
 * Procurement complexity score and the governance it triggers (FR-0060, US-INT-03, FR-0040, FR-0030).
 * Pure functions: same inputs, same answer, every explanation shown to the user.
 */
import { CATEGORIES } from './extract.js';

export type Complexity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
const ORDER: Complexity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export interface ComplexityInput {
  estimatedValue: number | null;
  category?: string | null;
  supplyLocation?: string | null; // LOCAL | OFFSHORE
  dataSensitivity?: string | null; // NONE | PERSONAL | SENSITIVE
}
export interface ComplexityResult {
  level: Complexity;
  /** Plain-language reasons, in order, so the score is never a black box. */
  reasons: string[];
}

/** Value sets the base band: <250k low, <1M medium, <5M high, >=5M critical ($1M is "high value": AI notes). */
export function valueBand(value: number): Complexity {
  if (value >= 5_000_000) return 'CRITICAL';
  if (value >= 1_000_000) return 'HIGH';
  if (value >= 250_000) return 'MEDIUM';
  return 'LOW';
}

const bump = (c: Complexity, by: number): Complexity =>
  ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(c) + by)]!;

export function scoreComplexity(i: ComplexityInput): ComplexityResult {
  const reasons: string[] = [];
  const value = i.estimatedValue ?? 0;
  let level = valueBand(value);
  reasons.push(
    `Estimated value AUD ${value.toLocaleString('en-AU')} sets the base level to ${level.toLowerCase()}.`,
  );

  const rule = CATEGORIES.find((c) => i.category && i.category.startsWith(c.category));
  if (rule?.critical) {
    level = bump(level, 1);
    reasons.push(`${rule.category} is a critical category (+1).`);
  }
  if (i.supplyLocation === 'OFFSHORE') {
    level = bump(level, 1);
    reasons.push('Offshore supply adds geopolitical and data-residency risk (+1).');
  }
  if (
    i.dataSensitivity === 'SENSITIVE' ||
    i.dataSensitivity === 'PERSONAL' ||
    (rule?.sensitiveData && !i.dataSensitivity)
  ) {
    level = bump(level, 1);
    reasons.push('Sensitive or personal data is involved (+1).');
  }
  return { level, reasons };
}

export interface Gate {
  key: string;
  label: string;
  reason: string;
}

/** Gates the request must clear before it can progress (FR-0060, FR-0030). */
export function gatesFor(
  level: Complexity,
  category: string | null | undefined,
  value: number,
  budgetCheck: string,
): Gate[] {
  const gates: Gate[] = [];
  if (level === 'HIGH' || level === 'CRITICAL') {
    gates.push(
      {
        key: 'RISK_SIGNOFF',
        label: 'Independent risk-officer sign-off',
        reason: `Complexity is ${level.toLowerCase()}.`,
      },
      {
        key: 'UPFRONT_COI',
        label: 'Upfront conflict-of-interest declaration',
        reason: `Complexity is ${level.toLowerCase()}.`,
      },
    );
  }
  if (category?.startsWith('IT managed services'))
    gates.push({ key: 'IT_ENDORSEMENT', label: 'IT department endorsement', reason: 'IT category.' });
  if (value >= 250_000)
    gates.push({
      key: 'LEGAL_REVIEW',
      label: 'Legal review of the contract approach',
      reason: 'Value of AUD 250,000 or more.',
    });
  if (budgetCheck === 'UNAVAILABLE')
    gates.push({
      key: 'MANUAL_BUDGET_CONFIRMATION',
      label: 'Manual budget confirmation',
      reason: 'The finance system could not be reached.',
    });
  if (budgetCheck === 'EXCEEDED')
    gates.push({
      key: 'BUDGET_ESCALATION',
      label: 'Executive budget escalation',
      reason: 'Requested value exceeds available budget (soft-cap tenant).',
    });
  return gates;
}

/** Self-service for low-value requests, procurement-team-led above the tenant threshold (FR-0040). */
export const intakeModeFor = (value: number, thresholdAud: number): 'SELF_SERVICE' | 'TEAM_LED' =>
  value < thresholdAud ? 'SELF_SERVICE' : 'TEAM_LED';
