export interface ProcurementRow {
  id: string;
  number: string;
  title: string;
  category: string | null;
  businessUnit: string | null;
  phase: string;
  status: string;
  estimatedValue: number;
  steps: Record<'intake' | 'plan' | 'tender' | 'evaluation' | 'contract', boolean>;
  updatedAt: string;
}

export interface ProcurementTable {
  scope: 'PORTFOLIO' | 'PANEL' | 'OWN';
  items: ProcurementRow[];
}

export interface SpendReport {
  byCategory: Array<{ category: string; pipeline: number; committed: number }>;
  totalPipeline: number;
  totalCommitted: number;
  note: string;
}

export interface AuditRow {
  seq: number;
  at: string;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  result: 'SUCCESS' | 'DENIED' | 'FAILED';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface AuditPage {
  items: AuditRow[];
  page: { total: number; limit: number; offset: number };
}
