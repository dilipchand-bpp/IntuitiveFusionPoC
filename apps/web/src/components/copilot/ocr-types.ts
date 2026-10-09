/** Shapes returned by the contract ingestion routes (CP-07, /contract-ingest/*). */
export interface OcrSpan {
  page: number;
  start: number;
  end: number;
  text: string;
}
export interface OcrField {
  key: string;
  label: string;
  required: boolean;
  status: 'EXTRACTED' | 'NOT_FOUND' | 'CORRECTED';
  value: unknown;
  display: string;
  confidence: number;
  ruleConfidence: number;
  pageConfidence: number;
  method: string | null;
  source: OcrSpan | null;
  extraSources?: OcrSpan[];
  note?: string;
  reviewed: boolean;
  needsReview: boolean;
  reviewReason?: string;
}
export interface OcrClause {
  key: string;
  title: string;
  mandatory: boolean;
  risk: string;
  found: boolean;
  similarity: number | null;
  match: 'STANDARD' | 'MINOR_DEVIATION' | 'MATERIAL_DEVIATION' | null;
  confidence: number;
  source: OcrSpan | null;
  text: string | null;
  standardText: string;
}
export interface OcrFinding {
  code: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  clauseKey?: string;
  fieldKey?: string;
  message: string;
}
export interface OcrDocSummary {
  id: string;
  batchId: string;
  fileName: string;
  entryPath: string | null;
  kind: string;
  engine: string;
  simulated: boolean;
  pageCount: number;
  ocrConfidence: number | null;
  status: 'NEEDS_REVIEW' | 'READY' | 'COMMITTED' | 'REJECTED' | 'FAILED';
  failure: string | null;
  title: string | null;
  contractNumber: string | null;
  supplier: string | null;
  endDate: string | null;
  needsReview: number;
  missingMandatory: number;
  findings: { HIGH: number; MEDIUM: number; LOW: number; INFO: number };
  duplicateOf: string | null;
  contractId: string | null;
  label: string;
}
export interface OcrBatch {
  id: string;
  origin: string;
  createdAt: string;
  note: string | null;
  skipped: Array<{ name: string; reason: string }>;
  counts: {
    documents: number;
    needsReview: number;
    ready: number;
    committed: number;
    rejected: number;
    failed: number;
  };
  documents: OcrDocSummary[];
}
export interface OcrBatchRow {
  id: string;
  origin: string;
  createdAt: string;
  note: string | null;
  documents: number;
  needsReview: number;
  ready: number;
  committed: number;
  rejected: number;
  failed: number;
  skipped: number;
}
export interface OcrMatches {
  supplier: {
    match: { id: string; company: string; abn: string; by: string } | null;
    similar: Array<{ id: string; company: string; score: number }>;
  };
  contracts: Array<{
    id: string;
    number: string;
    title: string | null;
    strength: string;
    reason: string;
    endDate: string | null;
  }>;
}
export interface OcrDocument extends Omit<OcrDocSummary, 'findings'> {
  reviewThreshold: number;
  pages: Array<{ page: number; text: string; confidence: number }>;
  fields: OcrField[];
  clauses: OcrClause[];
  findings: OcrFinding[];
  corrections: Array<{
    id: string;
    fieldKey: string;
    before: { display?: string } | null;
    after: { display?: string } | null;
    reason: string | null;
    correctedAt: string;
  }>;
  commitSummary: Record<string, unknown> | null;
  matches: OcrMatches | null;
  engineLabel: string;
  version: number;
}
export interface OcrCommitResult {
  mode: string;
  contractId: string;
  contractNumber: string;
  reminders?: Array<{ kind: string; triggerDate: string }>;
  supplier: { company: string; created: boolean };
}
export interface OcrSample {
  key: string;
  fileName: string;
  title: string;
  description: string;
  kind: string;
  simulated: boolean;
}
export interface OcrReport {
  asOf: string;
  days: number;
  totals: { documents: number; committed: number; readyToCommit: number; needsReview: number };
  renewalsDue: Array<{
    documentId: string;
    contractId: string | null;
    title: string;
    supplier: string;
    endDate: string;
    daysToEnd: number;
    noticeDeadline: string | null;
    renewal: string;
    status: string;
  }>;
  noticeWindows: Array<{
    documentId: string;
    title: string;
    supplier: string;
    endDate: string;
    noticeDays: number;
    noticeDeadline: string;
    daysToDeadline: number;
    state: string;
  }>;
  liabilityCaps: {
    summary: { fixed: number; feesBased: number; unlimited: number; notStated: number; belowValue: number };
    items: Array<{
      documentId: string;
      title: string;
      supplier: string;
      basis: string;
      capAmount: number | null;
      currency: string | null;
      valueAmount: number | null;
      capPercentOfValue: number | null;
      belowValue: boolean;
    }>;
  };
  missingClauses: {
    documentsChecked: number;
    documentsWithMissingMandatory: number;
    byClause: Array<{
      key: string;
      title: string;
      mandatory: boolean;
      count: number;
      missing: Array<{ documentId: string; title: string }>;
    }>;
  };
  concentration: {
    currency: string;
    totalValue: number;
    unconverted: number;
    topShare: number;
    hhi: number;
    bySupplier: Array<{ supplier: string; documents: number; totalValue: number; share: number }>;
  };
}
