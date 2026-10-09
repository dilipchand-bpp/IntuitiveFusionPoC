/** Shapes returned by the Procurement Copilot drafting routes (CP-04, CP-05). */
export type DraftKind = 'REQUEST' | 'PLAN' | 'JOB_SPEC' | 'TENDER_DOC' | 'CONTRACT_DRAFT' | 'EVAL_CRITERIA';

export const KIND_LABEL: Record<DraftKind, string> = {
  REQUEST: 'Request',
  PLAN: 'Procurement plan',
  JOB_SPEC: 'Job specification (scope of work)',
  TENDER_DOC: 'Tender document',
  CONTRACT_DRAFT: 'Contract draft',
  EVAL_CRITERIA: 'Evaluation criteria',
};

export interface DraftItem {
  id: string;
  text: string;
  title?: string;
  weight?: number;
  mandatory?: boolean;
}
export interface DraftSection {
  key: string;
  title: string;
  type: 'TEXT' | 'LIST' | 'CRITERIA' | 'CLAUSES';
  items: DraftItem[];
}
export interface DraftSource {
  path: string;
  kind: 'TEXT_SPAN' | 'HISTORY' | 'CATALOGUE' | 'POLICY' | 'TEMPLATE' | 'RECORD' | 'INSTRUCTION';
  label: string;
  quote?: string;
}
export interface DiffEntry {
  path: string;
  label: string;
  change: 'ADDED' | 'REMOVED' | 'CHANGED';
  before?: string;
  after?: string;
}
export interface DraftView {
  id: string;
  kind: DraftKind;
  title: string;
  fields: Record<string, string>;
  doc: { sections: DraftSection[]; tone: 'FORMAL' | 'PLAIN' };
  sources: DraftSource[];
  engine: string;
  revision: number;
  missing: string[];
  suggested: string[];
  warnings: string[];
  defaultTarget: 'REQUEST' | 'PLAN' | 'TENDER' | 'REPOSITORY';
  adjustExamples: string[];
  // present on the answer to an adjustment or an undo
  applied?: boolean;
  reason?: string;
  message?: string;
  summary?: string;
  diff?: DiffEntry[];
  examples?: string[];
}
export interface RevisionRow {
  revision: number;
  parentRevision: number | null;
  action: 'GENERATE' | 'ADJUST' | 'UNDO';
  instruction: string | null;
  summary: string;
  diff: DiffEntry[];
  createdAt: string;
}
export interface ApplyResult {
  applied: boolean;
  queued?: boolean;
  target: string;
  targetId?: string;
  targetUrl?: string;
  created?: boolean;
  message?: string;
  changes: Array<{ field: string; before: unknown; after: unknown }>;
}

export const FIELD_NAMES: Record<string, string> = {
  title: 'Title',
  category: 'Category',
  estimatedValue: 'Budget (AUD)',
  termMonths: 'Term (months)',
  startDate: 'Start date',
  endDate: 'End date',
  closeDate: 'Closing date',
  businessUnit: 'Business unit',
  contractOwner: 'Contract owner',
  supplyLocation: 'Supply location',
  dataSensitivity: 'Data sensitivity',
  quantity: 'Quantity',
  quantityUnit: 'Unit',
  noticeDays: 'Notice period (days)',
  tenderType: 'Tender type',
  supplierHints: 'Suppliers mentioned',
};
export const SOURCE_NAME: Record<DraftSource['kind'], string> = {
  TEXT_SPAN: 'From your words',
  HISTORY: 'In-house history',
  CATALOGUE: 'Catalogue',
  POLICY: 'Policy',
  TEMPLATE: 'Standard wording',
  RECORD: 'From the record',
  INSTRUCTION: 'Your instruction',
};
