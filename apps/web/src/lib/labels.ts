import type { BadgeTone } from '@if/ui';

export const PHASE_LABEL: Record<string, string> = {
  INTAKE: 'Intake',
  PLAN: 'Plan',
  TENDER: 'Tender',
  EVALUATION: 'Evaluation',
  CONTRACT_AWARD: 'Contract award',
  CONTRACT_MGMT: 'Contract management',
  CLOSED: 'Closed',
};

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  COMPLETE: 'Complete',
};
export const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  IN_PROGRESS: 'info',
  BLOCKED: 'error',
  COMPLETE: 'success',
};

export const COMPLEXITY_LABEL: Record<string, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};
export const COMPLEXITY_TONE: Record<string, BadgeTone> = {
  LOW: 'success',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'error',
};

export const BUDGET_LABEL: Record<string, string> = {
  NOT_RUN: 'Not checked yet',
  CLEARED: 'Budget cleared',
  EXCEEDED: 'Over budget',
  UNAVAILABLE: 'Manual confirmation needed',
};
export const BUDGET_TONE: Record<string, BadgeTone> = {
  NOT_RUN: 'neutral',
  CLEARED: 'success',
  EXCEEDED: 'error',
  UNAVAILABLE: 'warning',
};

export const MODE_LABEL: Record<string, string> = {
  SELF_SERVICE: 'Self-service',
  TEAM_LED: 'Procurement-team led',
};

export const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

/** Field values are stored as text; show money and months the way a person reads them. */
export function displayValue(key: string, value: string | undefined): string {
  if (value === undefined || value === '') return '';
  if (key === 'estimatedValue') return aud.format(Number(value));
  if (key === 'termMonths') return `${value} months`;
  return value;
}
