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
  evaluationId: string | null;
  updatedAt: string;
}

export interface ProcurementTable {
  scope: 'PORTFOLIO' | 'PANEL' | 'OWN';
  items: ProcurementRow[];
}

export interface SpendItem {
  kind: 'REQUEST' | 'CONTRACT';
  number: string;
  title: string;
  supplier: string | null;
  value: number;
}
export interface SpendReport {
  byCategory: Array<{ category: string; pipeline: number; committed: number; items: SpendItem[] }>;
  bySupplier: Array<{
    supplierId: string;
    company: string;
    committed: number;
    contracts: number;
    share: number;
  }>;
  offContract: Array<{
    requestId: string;
    number: string;
    title: string;
    category: string;
    value: number;
    phase: string;
  }>;
  totalPipeline: number;
  totalCommitted: number;
  totalOffContract: number;
  note: string;
}

export interface WorkloadReport {
  today: string;
  owners: Array<{
    ownerId: string;
    ownerName: string;
    procurements: number;
    value: number;
    byPhase: Record<string, number>;
  }>;
  timeline: Array<{
    requestId: string;
    number: string;
    title: string;
    owner: string;
    phase: string;
    bars: Array<{ label: string; start: string; end: string; optional: boolean }>;
  }>;
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
