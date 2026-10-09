/** Shared shapes of the contract OCR pipeline (CP-07). Everything here is plain data so it can be stored as JSON. */

export const ENGINE_LABEL = 'rules-simulated-v1';

export interface OcrPage {
  page: number;
  text: string;
  /** 0..1. A text layer is read exactly (0.99); a simulated recognition reports what its fixture says. */
  confidence: number;
}

export interface Span {
  page: number;
  start: number;
  end: number;
  text: string;
}

export type FieldKey =
  | 'title'
  | 'contractNumber'
  | 'customer'
  | 'supplier'
  | 'supplierAbn'
  | 'effectiveDate'
  | 'endDate'
  | 'termMonths'
  | 'renewal'
  | 'noticeDays'
  | 'value'
  | 'paymentTerms'
  | 'governingLaw'
  | 'liabilityCap'
  | 'indemnity'
  | 'terminationConvenience'
  | 'serviceLevels'
  | 'confidentiality'
  | 'dataLocation'
  | 'insurance';

export type FieldMethod = 'LABEL' | 'PATTERN' | 'DERIVED' | 'REVIEWED';
export type FieldStatus = 'EXTRACTED' | 'NOT_FOUND' | 'CORRECTED';

export interface ExtractedField {
  key: FieldKey;
  label: string;
  required: boolean;
  status: FieldStatus;
  /** The typed value; null when not found. */
  value: unknown;
  display: string;
  /** Final confidence: the rule's confidence times the confidence of the page it was read from. */
  confidence: number;
  ruleConfidence: number;
  pageConfidence: number;
  method: FieldMethod | null;
  source: Span | null;
  /** Further text spans for list values (service levels, insurance). */
  extraSources?: Span[];
  note?: string;
  /** Set by a reviewer: accepted as read, or corrected. */
  reviewed: boolean;
  /** Computed: must be reviewed before the document can be committed. */
  needsReview: boolean;
  reviewReason?: string;
}

export type ClauseMatch = 'STANDARD' | 'MINOR_DEVIATION' | 'MATERIAL_DEVIATION';

export interface DetectedClause {
  key: string;
  title: string;
  mandatory: boolean;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  found: boolean;
  /** Similarity of the wording found to the library's standard wording, 0..1. */
  similarity: number | null;
  match: ClauseMatch | null;
  confidence: number;
  heading: string | null;
  source: Span | null;
  text: string | null;
  standardText: string;
}

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface Finding {
  code: string;
  severity: Severity;
  clauseKey?: string;
  fieldKey?: FieldKey;
  message: string;
  source?: Span | null;
}

export interface LibraryClause {
  key: string;
  title: string;
  mandatory: boolean;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  keywords: string[];
  standardText: string;
  active: boolean;
}

export type FieldMap = Partial<Record<FieldKey, ExtractedField>>;
