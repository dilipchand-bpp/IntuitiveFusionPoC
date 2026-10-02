export interface TenderField {
  key: string;
  label: string;
  value: string;
  paragraphs: string[];
}
export interface QuestionView {
  id: string;
  text: string;
  answer?: string;
  status: 'OPEN' | 'ANSWERED' | 'PUBLISHED';
  askedAt: string;
}
export interface AddendumView {
  id: string;
  number: number;
  summary: string;
  questionIds: string[];
  newClosesAt?: string;
  issuedAt: string;
}
export interface TenderView {
  id: string;
  requestId: string;
  requestNumber: string;
  title: string;
  estimatedValue: number;
  type: string;
  access: 'OPEN' | 'CLOSED';
  status: string;
  opensAt: string | null;
  closesAt: string | null;
  version: number;
  planStatus: string | null;
  fields: TenderField[];
  permission: { granted: boolean; by?: string; at?: string };
  invitations: Array<{ id: string; email: string; company: string; state: string; expiresAt: string }>;
  questions: QuestionView[];
  addenda: AddendumView[];
  submissions: {
    count: number;
    sealed: boolean;
    items?: Array<{
      supplierId: string;
      company: string;
      receipt: string | null;
      submittedAt: string | null;
    }>;
  };
  permissions: {
    canEdit: boolean;
    canGrantPermission: boolean;
    canPublish: boolean;
    canInvite: boolean;
    canAnswer: boolean;
    canIssueAddendum: boolean;
  };
}
export interface TenderSummary {
  id: string;
  requestId: string;
  requestNumber: string;
  title: string;
  estimatedValue: number;
  type: string;
  access: string;
  status: string;
  closesAt: string | null;
  permissionGranted: boolean;
  invitations: number;
  openQuestions: number;
  bids: number;
  updatedAt: string;
}

export interface BidFile {
  id: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  section: 'TECHNICAL' | 'COMMERCIAL' | 'OTHER';
  scan: string;
  sha256?: string;
  uploadedAt: string;
}
export interface SupplierTenderView {
  id: string;
  title: string;
  number: string;
  type: string;
  status: string;
  opensAt: string | null;
  closesAt: string | null;
  serverTime: string;
  fields: TenderField[];
  questions: QuestionView[];
  addenda: AddendumView[];
  submission: {
    status: 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'REJECTED_LATE';
    receipt: string | null;
    submittedAt: string | null;
    files: BidFile[];
  };
  canBid: boolean;
}
export interface SupplierTenderSummary {
  id: string;
  title: string;
  number: string;
  type: string;
  status: string;
  closesAt: string | null;
  submissionStatus: SupplierTenderView['submission']['status'];
  receipt: string | null;
}
