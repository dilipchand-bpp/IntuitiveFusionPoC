/** The budget check outcome as it is put to the person inside the intake conversation (NFR-P04, FR-0050). */
import type { BudgetCheckResult } from '../../adapters/erp.js';

export interface ConversationBudget {
  status: BudgetCheckResult['status'];
  available: number | null;
  requested: number;
  businessUnit: string;
  cap: 'HARD' | 'SOFT';
  /** What the person is told. */
  text: string;
  /** How long the check took, in milliseconds (monotonic timer). */
  ms: number;
}

const aud = (n: number) => `AUD ${n.toLocaleString('en-AU')}`;

export function budgetReply(
  r: BudgetCheckResult,
  requested: number,
  businessUnit: string,
  cap: 'HARD' | 'SOFT',
  ms: number,
): ConversationBudget {
  let text: string;
  if (r.status === 'CLEARED')
    text = `Budget check: within budget. ${aud(requested)} is covered by the ${aud(r.available ?? 0)} available for ${businessUnit}.`;
  else if (r.status === 'EXCEEDED')
    text =
      cap === 'HARD'
        ? `Budget check: hard cap exceeded. ${aud(requested)} is more than the ${aud(r.available ?? 0)} available for ${businessUnit}, so this request cannot be submitted until the value is reduced or the budget is amended.`
        : `Budget check: over budget. ${aud(requested)} is more than the ${aud(r.available ?? 0)} available for ${businessUnit}. You can still submit; it will be escalated for an executive decision.`;
  else
    text = `Budget check: the finance system could not confirm the budget for ${businessUnit}, so a manual budget confirmation will be needed before approval.`;
  return {
    status: r.status,
    available: r.available,
    requested,
    businessUnit,
    cap,
    text,
    ms: Math.round(ms * 1000) / 1000,
  };
}
