export interface ContractSummary {
  id: string;
  number: string;
  status: 'DRAFT' | 'LEGAL_REVIEW' | 'AWAITING_SIGNATURE' | 'PARTIALLY_SIGNED' | 'EXECUTED';
  value: number;
  supplierName: string;
  title: string | null;
  requestNumber: string | null;
  endDate: string | null;
  locked: boolean;
  signed: number;
  signaturesRequired: number;
}

export interface ContractAward {
  evaluationId: string;
  requestNumber: string;
  title: string;
  estimatedValue: number;
  recommended: Array<{ supplierId: string; company: string; score: number }>;
  contractId: string | null;
  contractNumber: string | null;
}

export interface ContractView extends ContractSummary {
  startDate: string | null;
  noticeDays: number;
  templateId: string | null;
  clauses: Array<{
    id: string;
    title: string;
    text: string;
    mandatory: boolean;
    changedFromTemplate: boolean;
  }>;
  deviations: Array<{
    clauseId: string;
    title: string;
    mandatory: boolean;
    templateText: string;
    currentText: string;
  }>;
  signatures: Array<{
    id: string;
    userName: string;
    role: string;
    decision: 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
    comment: string | null;
    stamp: string | null;
  }>;
  chain: Array<{ role: string; label: string; signedBy: string | null; stamp: string | null }>;
  record: ContractRecord;
  permissions: {
    canEdit: boolean;
    canEditTerms: boolean;
    canRelease: boolean;
    canSign: boolean;
    signBlocked: string | null;
    canDelete: boolean;
  };
}

export interface TermBar {
  label: string;
  start: string;
  end: string;
  optional: boolean;
}

export interface AlertRow {
  id: string;
  contractId: string;
  kind: 'EXPIRY' | 'NOTICE' | 'MILESTONE' | 'EXTENSION' | 'CUSTOM';
  triggerDate: string;
  status: 'SCHEDULED' | 'SENT' | 'CANCELLED';
  sentAt: string | null;
  contractNumber?: string;
  deliveries: Array<{ channel: 'IN_APP' | 'EMAIL'; status: 'DELIVERED' | 'SIMULATED'; deliveredAt: string }>;
}

export interface ContractRecord {
  owner: { id: string; name: string } | null;
  milestones: Array<{ id: string; title: string; dueDate: string }>;
  extensions: TermBar[];
  bars: TermBar[];
  alerts: AlertRow[];
}

export interface ExpiringContract {
  contractId: string;
  number: string;
  title: string | null;
  supplier: string;
  value: number;
  owner: string | null;
  startDate: string;
  endDate: string;
  noticeDeadline: string;
  daysRemaining: number;
  bars: TermBar[];
}
