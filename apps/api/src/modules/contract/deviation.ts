/**
 * Deviation register rules (US-CON-02): a clause changed from the template is a deviation. It gets an auto-proposed
 * risk rating that Legal can amend; a deviation to a mandatory clause, or one rated high, needs a delegate's decision
 * before the contract can be released for signing.
 */
export type Risk = 'LOW' | 'MEDIUM' | 'HIGH';

/** Wording that shifts risk to the customer: each hit raises the rating. */
const RISKY =
  /\b(waive[sd]?|waiver|unlimited|exclud\w+|disclaim\w*|no liability|not liable|sole discretion|indemnif\w+|uncapped)\b/i;

export function proposeRisk(input: { mandatory: boolean; templateText: string; currentText: string }): Risk {
  const t = input.templateText.trim();
  const c = input.currentText.trim();
  const shorter = t.length > 0 && c.length < t.length * 0.7; // a clause cut by more than 30% usually drops protections
  const addsRisky = RISKY.test(c) && !RISKY.test(t);
  if (addsRisky && (input.mandatory || shorter)) return 'HIGH';
  if (input.mandatory) return shorter ? 'HIGH' : 'MEDIUM';
  return addsRisky || shorter ? 'MEDIUM' : 'LOW';
}

/** Does this deviation need a delegate's decision before release? */
export const needsDecision = (d: { mandatory: boolean; risk: Risk | null }) =>
  d.mandatory || d.risk === 'HIGH';

export function deviationBlockers(
  deviations: Array<{
    title: string;
    mandatory: boolean;
    risk: Risk | null;
    decision: 'APPROVED' | 'REJECTED' | null;
  }>,
): string[] {
  return deviations
    .filter((d) => needsDecision(d) && d.decision !== 'APPROVED')
    .map((d) =>
      d.decision === 'REJECTED'
        ? `The change to "${d.title}" was rejected; restore or reword it`
        : `The change to "${d.title}" (${(d.risk ?? 'MEDIUM').toLowerCase()} risk) needs a delegate's approval`,
    );
}
