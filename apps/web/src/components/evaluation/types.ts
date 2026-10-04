export type Stream = 'TECHNICAL' | 'COMMERCIAL' | 'OTHER';

export interface EvalCriterion {
  id: string;
  name: string;
  weight: number;
  stream: Stream;
  passFail: boolean;
}
export interface EvalMember {
  userId: string;
  name: string;
  stream: Stream;
  coiState: 'NOT_DECLARED' | 'DECLARED_NONE' | 'DECLARED_CONFLICT' | 'REMOVED';
  scoringComplete: boolean;
  redeclaration?: 'NONE' | 'CONFLICT' | null;
  redeclaredAt?: string;
}
export interface EvalFile {
  id: string;
  name: string;
  section: Stream;
  sizeBytes: number;
  contentType: string;
}
export interface EvalSupplier {
  supplierId: string;
  displayName: string;
  anonymised: boolean;
  files: EvalFile[];
}
export interface ConsensusRow {
  supplierId: string;
  criterionId: string;
  variancePct: number | null;
  flagged: boolean;
  consensusScore: number | null;
  rationale: string | null;
  individual?: Array<{ evaluator: string; score: number; comment: string | null; departed?: boolean }>;
}
export interface ComplianceRow {
  supplierId: string;
  key: 'REGISTRATION' | 'DECLARATIONS' | 'INSURANCE' | 'COMPLETENESS';
  label: string;
  result: 'PASS' | 'FAIL' | 'WAIVED';
  detail: string;
  note: string | null;
}
export interface PreviousStage {
  stage: number;
  tenderId: string;
  evaluationId: string | null;
  status: string | null;
  suppliers: Array<{ displayName: string; rank: number | null; weightedScore: number; shortlisted: boolean }>;
}
export interface EvalView {
  id: string;
  tenderId: string;
  requestNumber: string;
  title: string;
  tenderType: string;
  status: 'COI_PENDING' | 'SCORING' | 'CONSENSUS' | 'LOCKED' | 'REPORTED' | 'APPROVED';
  mode: 'SCORING' | 'RANKING';
  priceWeightPct: number;
  stage: number;
  previousStages: PreviousStage[];
  held: null | { reason: string; by: string; at: string };
  compliance: ComplianceRow[];
  varianceLimitPct: number;
  version: number;
  criteria: EvalCriterion[];
  panel: EvalMember[];
  suppliers: EvalSupplier[];
  me: null | {
    stream: Stream;
    coiState: EvalMember['coiState'];
    scoringComplete: boolean;
    required: number;
    done: number;
    needsRedeclaration?: boolean;
  };
  conflicts: Array<{
    userId: string;
    name: string;
    nature: string;
    subjectOrg: string | null;
    disposition: 'PENDING' | 'IMMATERIAL' | 'MANAGEABLE' | 'MATERIAL';
    declaredAt: string;
    decidedAt?: string;
  }>;
  consensus: ConsensusRow[];
  ranking: Array<{
    supplierId: string;
    displayName: string;
    weightedScore: number;
    qualityScore: number;
    rank: number | null;
    compliance: 'PASS' | 'FAIL';
    tco: number | null;
    priceScore: number | null;
    valueForMoney: number | null;
  }>;
  report: null | {
    id: string;
    status: 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED';
    generatedAt: string;
    routedTo: string[];
    approverLimit: number | null;
    value: number;
    sections: Array<{ key: string; label: string; paragraphs: string[] }>;
    decision?: { decision: string; stamp: string; comment: string | null };
  };
  permissions: {
    canDeclare: boolean;
    canScore: boolean;
    canOpenConsensus: boolean;
    canSetConsensus: boolean;
    canLock: boolean;
    canManagePanel: boolean;
    canGenerateReport: boolean;
    canDecideReport: boolean;
    canReopen: boolean;
    canDecideConflict: boolean;
    canSetVarianceLimit: boolean;
    canProbitySignOff: boolean;
    canRedeclare: boolean;
    canHold: boolean;
    canRelease: boolean;
    canRunGate: boolean;
    canEditCriteria: boolean;
    canSubstitute: boolean;
  };
  probitySignoff: null | { by: string; stamp: string; at: string; comment: string | null };
}
export interface MyScores {
  criteria: EvalCriterion[];
  suppliers: Array<{
    supplierId: string;
    displayName: string;
    scores: Array<{ criterionId: string; score: number; comment: string | null }>;
  }>;
  progress: { required: number; done: number; complete: boolean };
}
export interface EvalSummary {
  id: string;
  tenderId: string;
  requestNumber: string;
  title: string;
  status: EvalView['status'];
  bids: number;
  panelSize: number;
  held?: boolean;
  mode?: 'SCORING' | 'RANKING';
  myCoiState?: EvalMember['coiState'];
  myScoringComplete?: boolean;
  updatedAt: string;
}
export interface ReadyTender {
  tenderId: string;
  requestNumber: string;
  title: string;
  type: string;
  bids: number;
  evaluable: boolean;
}

export interface Clarification {
  id: string;
  evaluationId: string;
  supplierId: string;
  supplier?: string;
  kind: 'COMPLIANCE' | 'CLARIFICATION' | 'NEGOTIATION';
  subject: string;
  question: string;
  dueAt: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  overdue: boolean;
  response: string | null;
  respondedAt: string | null;
  createdAt: string;
}
export interface BafoOffer {
  id: string;
  supplierId: string;
  company?: string;
  revision: number;
  basePrice: number;
  implementation: number;
  annualRunning: number;
  years: number;
  tco: number;
  note: string | null;
  submittedAt: string;
  accepted: boolean;
}
export interface BafoRoundView {
  id: string;
  round: number;
  status: 'OPEN' | 'CLOSED';
  note: string;
  closesAt: string;
  invited: Array<{ supplierId: string; company: string }>;
  offers: BafoOffer[];
  offersReceived: number;
}
export interface BafoStaffView {
  rounds: BafoRoundView[];
  originalTco: Array<{ supplierId: string; company: string; tco: number | null }>;
  canAccept: boolean;
}
export interface AdviceItem {
  supplierId: string;
  supplier: string;
  kind: 'DISCOUNT' | 'CLAUSE' | 'INSURANCE' | 'PROCESS';
  text: string;
  basis: string;
  suggestedDiscountPct?: number;
}
export interface CoiStatus {
  members: Array<{
    userId: string;
    name: string;
    stream: Stream;
    coiState: EvalMember['coiState'];
    redeclaration: 'NOT_APPLICABLE' | 'CONFLICT' | 'CONFIRMED' | 'AWAITING_FIRST' | 'OUTSTANDING';
    redeclaredAt: string | null;
    remindedAt: string | null;
  }>;
  outstanding: string[];
}
export interface ProbityDoc {
  id: string;
  kind: 'PLAN' | 'OUTCOMES';
  title: string;
  body: string;
  hasFile: boolean;
  fileName: string | null;
  status: 'DRAFT' | 'SIGNED';
  version: number;
  signedAt: string | null;
  signedBy: string | null;
  stamp: string | null;
  updatedAt: string;
}
export interface ReportCoiRow {
  id: string;
  userId: string;
  name: string;
  none: boolean;
  nature: string | null;
  disposition: 'PENDING' | 'IMMATERIAL' | 'MANAGEABLE' | 'MATERIAL';
  declaredAt: string;
  decidedAt: string | null;
  mine: boolean;
}
export interface LibraryCriterion {
  name: string;
  stream: Stream;
  weight: number;
  passFail: boolean;
}
