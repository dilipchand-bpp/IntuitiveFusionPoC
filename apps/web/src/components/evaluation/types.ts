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
  individual?: Array<{ evaluator: string; score: number; comment: string | null }>;
}
export interface EvalView {
  id: string;
  tenderId: string;
  requestNumber: string;
  title: string;
  tenderType: string;
  status: 'COI_PENDING' | 'SCORING' | 'CONSENSUS' | 'LOCKED' | 'REPORTED' | 'APPROVED';
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
  };
  consensus: ConsensusRow[];
  ranking: Array<{
    supplierId: string;
    displayName: string;
    weightedScore: number;
    rank: number | null;
    compliance: 'PASS' | 'FAIL';
  }>;
  report: null | {
    id: string;
    status: 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED';
    generatedAt: string;
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
  };
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
