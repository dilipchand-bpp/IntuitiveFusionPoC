/** Sections of a tender pack. Everything here is shown to suppliers, so nothing internal (budget, risk notes) belongs in it. */
export interface TenderFieldDef {
  key: string;
  label: string;
}

export const TENDER_FIELDS: readonly TenderFieldDef[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'scope', label: 'Scope of work' },
  { key: 'requirements', label: 'Requirements' },
  { key: 'deliverables', label: 'Deliverables' },
  { key: 'timetable', label: 'Timetable' },
  { key: 'evaluationCriteria', label: 'Evaluation criteria' },
  { key: 'conditions', label: 'Conditions of tendering' },
  { key: 'submission', label: 'How to submit' },
  { key: 'contact', label: 'Questions and contact' },
];
export const TENDER_FIELD_BY_KEY = new Map(TENDER_FIELDS.map((f) => [f.key, f]));

export const TENDER_TYPES = ['RFT', 'RFP', 'RFQ', 'RFI', 'EOI'] as const;
export type TenderType = (typeof TENDER_TYPES)[number];

export const TENDER_TYPE_NAME: Record<TenderType, string> = {
  RFT: 'Request for Tender',
  RFP: 'Request for Proposal',
  RFQ: 'Request for Quotation',
  RFI: 'Request for Information',
  EOI: 'Expression of Interest',
};
