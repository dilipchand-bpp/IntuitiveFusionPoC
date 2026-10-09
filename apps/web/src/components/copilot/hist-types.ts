/** Shapes the historical import API returns (CP-07), shared by the hist-* components. */
export interface HistField {
  key: string;
  label: string;
  required: boolean;
  type: string;
  allowed?: string[];
  hint?: string;
}
export interface HistEntityDef {
  entity: 'CONTRACTS' | 'SUPPLIERS' | 'SPEND' | 'CATALOGUE';
  label: string;
  fields: HistField[];
}
export interface HistIssue {
  rule: string;
  field?: string;
  message: string;
  value?: string;
}
export interface HistRow {
  rowNo: number;
  status: 'PENDING' | 'VALID' | 'ERROR' | 'DUPLICATE' | 'LOADED' | 'MERGED' | 'SKIPPED';
  raw: Record<string, string>;
  issues: HistIssue[];
  warnings: Array<{ rule: string; field?: string; message: string }>;
  duplicate: { kind: string; reason: string } | null;
}
export interface HistSummary {
  total: number;
  valid: number;
  errors: number;
  duplicates: number;
  withWarnings: number;
  errorsByRule: Record<string, number>;
  warningsByRule: Record<string, number>;
  wouldLoad: number;
  wouldMerge: number;
  wouldSkip: number;
  suppliers: { wouldCreate: number; linked: number };
  variants: Array<{ names: string[]; rows: number[] }>;
  reminders?: { contractsWithReminders: number; endedOrTerminated: number };
  spend?: { lines: number; total: number; from: string | null; to: string | null };
  note: string | null;
}
export interface HistCommit {
  loaded: number;
  merged: number;
  skippedDuplicates: number;
  skippedErrors: number;
  total: number;
  suppliersCreated: number;
  contractsCreated: number;
  remindersCreated: number;
  catalogueCreated: number;
  catalogueUpdated: number;
  spendLines: number;
  spendTotal: number;
  reconciles: boolean;
  rollback?: {
    contractsDeleted: number;
    remindersCancelled: number;
    suppliersDeleted: number;
    suppliersKept: number;
    catalogueDeleted: number;
    spendLinesDeleted: number;
  };
}
export interface HistBatch {
  id: string;
  entity: string;
  entityLabel: string;
  filename: string;
  sourceSystem: string;
  fileKind: string;
  status: 'UPLOADED' | 'MAPPED' | 'DRY_RUN' | 'COMMITTED' | 'ROLLED_BACK';
  rowCount: number;
  headers: string[];
  mapping: Record<string, string | null>;
  duplicateRule: 'SKIP' | 'MERGE';
  parseWarnings: string[];
  summary: HistSummary | null;
  commitSummary: HistCommit | null;
  ocr?: {
    available?: boolean;
    message?: string;
    error?: boolean;
    id?: string;
    documents?: number | null;
  } | null;
  rollback?: { possible: boolean; blockers: Array<{ entity: string; message: string }> };
  suggestion?: {
    confidence: Record<string, number>;
    missingRequired: string[];
    usedSavedMapping?: string | null;
  };
  preview: Array<Record<string, string>>;
  rows: HistRow[];
  rowsTotal: number;
  createdAt: string;
}
export interface HistBatchListItem {
  id: string;
  entity: string;
  entityLabel: string;
  filename: string;
  sourceSystem: string;
  fileKind: string;
  status: HistBatch['status'];
  rowCount: number;
  createdAt: string;
  loaded: number | null;
}
export interface HistSample {
  key: string;
  entity: string;
  label: string;
  sourceSystem: string;
  rows: number;
  files: string[];
}
