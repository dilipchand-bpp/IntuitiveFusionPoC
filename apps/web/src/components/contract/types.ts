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
  permissions: {
    canEdit: boolean;
    canEditTerms: boolean;
    canRelease: boolean;
    canSign: boolean;
    signBlocked: string | null;
    canDelete: boolean;
  };
}
