export interface SupplierRow {
  id: string;
  company: string;
  abn: string;
  sanctionsStatus: 'PENDING' | 'CLEAR' | 'MATCH';
  insuranceStatus: 'UNKNOWN' | 'CURRENT' | 'EXPIRING' | 'EXPIRED';
  lastCheckedAt: string | null;
  contacts: number;
}

export interface SupplierProfile {
  id: string;
  company: string;
  abn: string;
  sanctionsStatus: SupplierRow['sanctionsStatus'];
  insuranceStatus: SupplierRow['insuranceStatus'];
  lastCheckedAt: string | null;
  contacts: Array<{ id: string; name: string; email: string; active: boolean; awaitingActivation: boolean }>;
  tenders: Array<{ tenderId: string; number: string; title: string; submission: string | null }>;
  contracts: Array<{ id: string; number: string; status: string; value: number }>;
  canAddContact: boolean;
}
