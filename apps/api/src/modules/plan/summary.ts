/**
 * "Key points on one screen" for the approving delegate (FR-0785): what, how much, how risky, what has been checked,
 * what is still outstanding. Deterministic text from facts already on the plan, so it can never contradict the record.
 */
export interface SummaryInput {
  title: string;
  requestNumber: string;
  estimatedValue: number;
  termMonths?: number | undefined;
  businessUnit?: string | undefined;
  complexity: string;
  budgetCheck: string;
  gates: Array<{ label: string; status: 'REQUIRED' | 'SATISFIED' }>;
  conflicts: Array<{ none: boolean; disposition: string }>;
  topRisk?: string | undefined;
  approverNote?: string | undefined;
}

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const BUDGET: Record<string, string> = {
  CLEARED: 'budget cleared',
  EXCEEDED: 'over budget (escalated)',
  UNAVAILABLE: 'budget needs manual confirmation',
  NOT_RUN: 'budget not yet checked',
};

export function summarisePlan(i: SummaryInput): string[] {
  const points: string[] = [];
  points.push(
    `${i.requestNumber} ${i.title}: ${aud.format(i.estimatedValue)}${i.termMonths ? ` over ${i.termMonths} months` : ''}${i.businessUnit ? `, owned by ${i.businessUnit}` : ''}.`,
  );
  points.push(`Complexity ${i.complexity.toLowerCase()}; ${BUDGET[i.budgetCheck] ?? i.budgetCheck}.`);
  const open = i.gates.filter((g) => g.status === 'REQUIRED');
  points.push(
    open.length === 0
      ? i.gates.length === 0
        ? 'No extra approvals were required.'
        : 'All required checks are complete.'
      : `Still outstanding: ${open.map((g) => g.label.toLowerCase()).join('; ')}.`,
  );
  const declared = i.conflicts.length;
  const real = i.conflicts.filter((c) => !c.none);
  points.push(
    declared === 0
      ? 'No conflict-of-interest declarations yet.'
      : real.length === 0
        ? `${declared} conflict declaration${declared > 1 ? 's' : ''}: none disclosed.`
        : `${real.length} conflict${real.length > 1 ? 's' : ''} disclosed (${real.map((c) => c.disposition.toLowerCase()).join(', ')}).`,
  );
  if (i.topRisk) points.push(`Main risk: ${i.topRisk}`);
  if (i.approverNote) points.push(i.approverNote);
  return points;
}
