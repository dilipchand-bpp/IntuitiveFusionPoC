export interface FieldView {
  key: string;
  label: string;
  value?: string;
  source: string;
  aiDrafted: boolean;
  missing: boolean;
}
export interface GateView {
  key: string;
  label: string;
  reason: string;
  status: 'REQUIRED' | 'SATISFIED';
}
export interface RequestView {
  id: string;
  number: string;
  title: string;
  category?: string;
  estimatedValue: number;
  /** The currency the value was typed in; the value above is always AUD. */
  currency?: string;
  originalAmount?: number;
  fxRate?: number;
  termMonths?: number;
  businessUnit?: string;
  phase: string;
  status: string;
  intakeMode: string;
  complexity?: string;
  complexityReasons: string[];
  budgetCheck: string;
  fields: FieldView[];
  gates: GateView[];
  missingFields: string[];
  version: number;
}
export interface ChatMsg {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  text: string;
}
