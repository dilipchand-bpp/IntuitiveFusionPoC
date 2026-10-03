p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\tender\pack.ts'
t = open(p, encoding='utf8', newline='').read()
a = t.index('/** Weighted criteria by type.')
b = t.index('/**\n * Builds a tender pack from the approved plan')
new = '''/**
 * Weighted criteria by type, the single source for both the wording in the tender pack and the scoring sheet the panel
 * uses, so suppliers are scored on exactly what they were told. Price is not scored for information-gathering documents.
 */
export type CriterionStream = 'TECHNICAL' | 'COMMERCIAL' | 'OTHER';
export interface CriterionTemplate {
  name: string;
  weight: number;
  stream: CriterionStream;
  passFail: boolean;
}
const crit = (name: string, weight: number, stream: CriterionStream, passFail = false): CriterionTemplate => ({
  name,
  weight,
  stream,
  passFail,
});
const CRITERIA: Record<TenderType, CriterionTemplate[]> = {
  RFT: [
    crit('Technical capability and approach', 40, 'TECHNICAL'),
    crit('Delivery, transition and risk management', 20, 'TECHNICAL'),
    crit('Price and commercial terms', 30, 'COMMERCIAL'),
    crit('Experience and references', 10, 'OTHER'),
  ],
  RFP: [
    crit('Quality of proposed solution', 40, 'TECHNICAL'),
    crit('Delivery approach and team', 20, 'TECHNICAL'),
    crit('Price and value for money', 30, 'COMMERCIAL'),
    crit('Experience and references', 10, 'OTHER'),
  ],
  RFQ: [
    crit('Compliance with the specification (pass or fail)', 0, 'TECHNICAL', true),
    crit('Price', 100, 'COMMERCIAL'),
  ],
  RFI: [crit('Relevance and completeness of the information provided (not scored for award)', 0, 'OTHER')],
  EOI: [crit('Capability and relevant experience (used to shortlist, not to award)', 0, 'OTHER')],
};

/** The scoring sheet for a procurement type, or null when the document is not evaluated for award (RFI, EOI). */
export const evaluationCriteria = (type: TenderType): CriterionTemplate[] | null =>
  type === 'RFT' || type === 'RFP' || type === 'RFQ' ? CRITERIA[type] : null;

'''
t = t[:a] + new + t[b:]
t = t.replace("  const criteriaText = criteria\n    .map(([name, w]) => (w > 0 ? `${name}: ${w}%` : name))",
              "  const criteriaText = criteria\n    .map(({ name, weight: w }) => (w > 0 ? `${name}: ${w}%` : name))")
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
