export interface PlanField {
  key: string;
  label: string;
  value: string;
  paragraphs: string[];
  source: string;
  aiDrafted: boolean;
}
export interface PlanApproval {
  id: string;
  subject: string;
  userName?: string;
  role: string;
  decision: 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  comment?: string;
  stamp?: string;
  decidedAt: string;
}
export interface PlanConflict {
  id: string;
  userId: string;
  userName: string;
  none: boolean;
  nature?: string;
  disposition: 'PENDING' | 'IMMATERIAL' | 'MANAGEABLE' | 'MATERIAL';
}
export interface PlanGate {
  key: string;
  label: string;
  reason: string;
  status: 'REQUIRED' | 'SATISFIED';
}
export interface PlanPermissions {
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReopen: boolean;
  canDeclareConflict: boolean;
  canDecideConflict: boolean;
  canSignOffRisk: boolean;
  reason?: string;
}
export interface PlanView {
  id: string;
  requestId: string;
  requestNumber: string;
  title: string;
  estimatedValue: number;
  complexity?: string;
  status: string;
  locked: boolean;
  fields: PlanField[];
  approvals: PlanApproval[];
  conflicts: PlanConflict[];
  gates: PlanGate[];
  summaryPoints: string[];
  version: number;
  permissions: PlanPermissions;
  undoAvailable: boolean;
  undoToken?: string;
}
