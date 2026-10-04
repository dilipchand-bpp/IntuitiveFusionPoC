p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\components\evaluation\types.ts'
s = open(p, encoding='utf8').read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a[:60]
    s = s.replace(a, b)


rep("""  scoringComplete: boolean;
}
export interface EvalFile {""", """  scoringComplete: boolean;
  redeclaration?: 'NONE' | 'CONFLICT' | null;
  redeclaredAt?: string;
}
export interface EvalFile {""")
rep("""  individual?: Array<{ evaluator: string; score: number; comment: string | null }>;
}""", """  individual?: Array<{ evaluator: string; score: number; comment: string | null; departed?: boolean }>;
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
}""")
rep("""  status: 'COI_PENDING' | 'SCORING' | 'CONSENSUS' | 'LOCKED' | 'REPORTED' | 'APPROVED';
  varianceLimitPct: number;
  version: number;""", """  status: 'COI_PENDING' | 'SCORING' | 'CONSENSUS' | 'LOCKED' | 'REPORTED' | 'APPROVED';
  mode: 'SCORING' | 'RANKING';
  priceWeightPct: number;
  stage: number;
  previousStages: PreviousStage[];
  held: null | { reason: string; by: string; at: string };
  compliance: ComplianceRow[];
  varianceLimitPct: number;
  version: number;""")
rep("""    required: number;
    done: number;
  };
  conflicts: Array<{""", """    required: number;
    done: number;
    needsRedeclaration?: boolean;
  };
  conflicts: Array<{""")
rep("""    weightedScore: number;
    rank: number | null;
    compliance: 'PASS' | 'FAIL';
  }>;""", """    weightedScore: number;
    qualityScore: number;
    rank: number | null;
    compliance: 'PASS' | 'FAIL';
    tco: number | null;
    priceScore: number | null;
    valueForMoney: number | null;
  }>;""")
rep("""    canSetVarianceLimit: boolean;
    canProbitySignOff: boolean;
  };""", """    canSetVarianceLimit: boolean;
    canProbitySignOff: boolean;
    canRedeclare: boolean;
    canHold: boolean;
    canRelease: boolean;
    canRunGate: boolean;
    canEditCriteria: boolean;
    canSubstitute: boolean;
  };""")
rep("""  bids: number;
  panelSize: number;
  myCoiState""", """  bids: number;
  panelSize: number;
  held?: boolean;
  mode?: 'SCORING' | 'RANKING';
  myCoiState""")
s += """
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
"""
open(p, 'w', encoding='utf8').write(s)
print('ok')
