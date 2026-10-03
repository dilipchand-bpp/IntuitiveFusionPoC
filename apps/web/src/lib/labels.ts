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

export const PLAN_STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started',
  DRAFT: 'Draft',
  AWAITING_SIGNOFF: 'Awaiting checks',
  AWAITING_APPROVAL: 'Awaiting approval',
  APPROVED_LOCKED: 'Approved and locked',
  REOPENED: 'Reopened',
  REJECTED: 'Returned',
};
export const PLAN_STATUS_TONE: Record<string, BadgeTone> = {
  NOT_STARTED: 'neutral',
  DRAFT: 'neutral',
  AWAITING_SIGNOFF: 'warning',
  AWAITING_APPROVAL: 'info',
  APPROVED_LOCKED: 'success',
  REOPENED: 'warning',
  REJECTED: 'error',
};
export const COI_LABEL: Record<string, string> = {
  PENDING: 'Awaiting decision',
  IMMATERIAL: 'No conflict / immaterial',
  MANAGEABLE: 'Manageable',
  MATERIAL: 'Material',
};
export const COI_TONE: Record<string, BadgeTone> = {
  PENDING: 'warning',
  IMMATERIAL: 'success',
  MANAGEABLE: 'info',
  MATERIAL: 'error',
};

export const TENDER_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  STAGED: 'Staged',
  PUBLISHED: 'Open for bids',
  CLOSED: 'Closed',
  EVALUATING: 'Evaluating',
  AWARDED: 'Awarded',
};
export const TENDER_STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  STAGED: 'warning',
  PUBLISHED: 'success',
  CLOSED: 'neutral',
  EVALUATING: 'info',
  AWARDED: 'success',
};
export const TENDER_TYPE_LABEL: Record<string, string> = {
  RFT: 'Request for Tender',
  RFP: 'Request for Proposal',
  RFQ: 'Request for Quotation',
  RFI: 'Request for Information',
  EOI: 'Expression of Interest',
};
export const SUBMISSION_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started',
  DRAFT: 'Draft (not submitted)',
  SUBMITTED: 'Submitted',
  REJECTED_LATE: 'Not accepted (late)',
};
export const SUBMISSION_TONE: Record<string, BadgeTone> = {
  NOT_STARTED: 'neutral',
  DRAFT: 'warning',
  SUBMITTED: 'success',
  REJECTED_LATE: 'error',
};
const dateTime = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
export const formatDateTime = (iso: string | null | undefined) =>
  iso ? dateTime.format(new Date(iso)) : '–';

export const CONTRACT_STATUS: Record<string, [string, BadgeTone]> = {
  DRAFT: ['Draft', 'neutral'],
  LEGAL_REVIEW: ['Legal review', 'info'],
  AWAITING_SIGNATURE: ['Awaiting signature', 'warning'],
  PARTIALLY_SIGNED: ['Partly signed', 'warning'],
  EXECUTED: ['Executed and locked', 'success'],
};

export const ALERT_KIND: Record<string, string> = {
  NOTICE: 'Notice deadline approaching',
  EXPIRY: 'Contract expiry',
  EXTENSION: 'Extension decision',
  MILESTONE: 'Milestone',
  CUSTOM: 'Custom reminder',
};
