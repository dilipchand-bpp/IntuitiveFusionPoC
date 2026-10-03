"""Generates docs/api/openapi.json and docs/api/endpoint-table.md from one compact definition."""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "api"); os.makedirs(OUT, exist_ok=True)

def obj(props, req=None, extra=False):
    d = {"type": "object", "properties": props, "additionalProperties": extra}
    if req: d["required"] = req
    return d
S = {"type": "string"}; I = {"type": "integer"}; N = {"type": "number"}; B = {"type": "boolean"}
DT = {"type": "string", "format": "date-time"}; UUID = {"type": "string", "format": "uuid"}
def ref(n): return {"$ref": f"#/components/schemas/{n}"}
def arr(x): return {"type": "array", "items": x}
def enum(*v): return {"type": "string", "enum": list(v)}

ROLES = ["REQUESTER","PROCUREMENT","DELEGATE","EVALUATOR","CHAIR","LEGAL","CONTRACT_MGR","PROBITY","FINANCE","ADMIN","EXEC","SUPPLIER"]
PHASES = ["INTAKE","PLAN","TENDER","EVALUATION","CONTRACT_AWARD","CONTRACT_MGMT","CLOSED"]

schemas = {
 "Problem": obj({"type": S, "title": S, "status": I, "detail": S, "code": S, "correlationId": S,
                 "errors": arr(obj({"field": S, "message": S}, ["field", "message"]))}, ["type", "title", "status", "code", "correlationId"]),
 "Page": obj({"total": I, "limit": I, "offset": I}, ["total", "limit", "offset"], True),
 "User": obj({"id": UUID, "name": S, "email": {"type": "string", "format": "email"}, "role": enum(*ROLES), "roles": arr(enum(*ROLES)), "orgUnit": S, "delegationLimit": N, "homePath": S, "csrfToken": S}, ["id", "name", "email", "role"]),
 "LoginRequest": obj({"email": {"type": "string", "format": "email"}, "password": {"type": "string", "minLength": 8, "maxLength": 128}}, ["email", "password"]),
 "Session": obj({"user": ref("User"), "expiresAt": DT, "mfaRequired": B, "csrfToken": S}, ["user", "expiresAt", "csrfToken"]),
 "AccessDenied": obj({"path": {"type": "string", "maxLength": 200, "pattern": "^/"}}, ["path"]),
 "ForgotPassword": obj({"email": {"type": "string", "format": "email"}}, ["email"]),
 "Message": obj({"message": S}, ["message"]),
 "FieldValue": obj({"key": S, "label": S, "value": S, "source": enum("USER", "AI", "SYSTEM", "MIGRATED"), "aiDrafted": B, "missing": B, "updatedAt": DT, "updatedBy": UUID}, ["key", "label", "source"]),
 "ProcurementRequest": obj({"id": UUID, "number": S, "title": S, "category": S, "unspsc": S, "estimatedValue": N, "currency": S, "termMonths": I,
   "businessUnit": S, "requesterId": UUID, "phase": enum(*PHASES), "status": enum("DRAFT", "SUBMITTED", "IN_PROGRESS", "BLOCKED", "COMPLETE"),
   "intakeMode": enum("SELF_SERVICE", "TEAM_LED"), "complexity": enum("LOW", "MEDIUM", "HIGH", "CRITICAL"), "budgetCheck": enum("NOT_RUN", "CLEARED", "EXCEEDED", "UNAVAILABLE"),
   "complexityReasons": arr(S), "gates": arr(ref("Gate")), "missingFields": arr(S), "version": I,
   "fields": arr(ref("FieldValue")), "createdAt": DT, "updatedAt": DT}, ["id", "number", "title", "phase", "status"]),
 "Gate": obj({"key": S, "label": S, "reason": S, "status": enum("REQUIRED", "SATISFIED")}, ["key", "label", "status"]),
 "RequestList": obj({"items": arr(ref("ProcurementRequest")), "page": ref("Page")}, ["items", "page"]),
 "RequestPatch": obj({"title": S, "category": S, "estimatedValue": N, "termMonths": I, "businessUnit": S, "fields": {"type": "object", "additionalProperties": S}, "expectedVersion": I}),
 "ConversationStart": obj({"purpose": enum("INTAKE", "PLAN", "TENDER", "EVALUATION", "CONTRACT", "GENERAL"), "contextId": UUID}, ["purpose"]),
 "Conversation": obj({"id": UUID, "purpose": S, "contextId": UUID, "messages": arr(ref("ChatMessage")), "simulated": B}, ["id", "messages", "simulated"]),
 "ChatMessage": obj({"id": UUID, "role": enum("USER", "ASSISTANT", "SYSTEM"), "text": S, "createdAt": DT, "proposedChanges": arr(ref("FieldValue")), "requestId": UUID, "request": ref("ProcurementRequest")}, ["id", "role", "text"]),
 "ChatSend": obj({"text": {"type": "string", "minLength": 1, "maxLength": 4000}, "channel": enum("TEXT", "VOICE")}, ["text"]),
 "Plan": obj({"id": UUID, "requestId": UUID, "requestNumber": S, "title": S, "estimatedValue": N, "complexity": enum("LOW", "MEDIUM", "HIGH", "CRITICAL"),
   "status": enum("DRAFT", "AWAITING_SIGNOFF", "AWAITING_APPROVAL", "APPROVED_LOCKED", "REOPENED", "REJECTED"), "locked": B,
   "fields": arr(ref("PlanField")), "approvals": arr(ref("Approval")), "conflicts": arr(ref("CoiRecord")), "gates": arr(ref("Gate")),
   "summary": S, "summaryPoints": arr(S), "version": I, "permissions": ref("PlanPermissions"), "undoAvailable": B, "undoToken": S}, ["id", "requestId", "status", "fields", "version"]),
 "PlanField": obj({"key": S, "label": S, "value": S, "paragraphs": arr(S), "source": enum("USER", "AI", "SYSTEM", "MIGRATED"), "aiDrafted": B, "updatedAt": DT}, ["key", "label", "source"]),
 "PlanPermissions": obj({"canEdit": B, "canSubmit": B, "canApprove": B, "canReopen": B, "canDeclareConflict": B, "canDecideConflict": B, "canSignOffRisk": B, "reason": S}, ["canEdit", "canSubmit", "canApprove", "canReopen"]),
 "PlanSummary": obj({"planId": UUID, "requestId": UUID, "requestNumber": S, "title": S, "estimatedValue": N, "complexity": S, "status": S, "updatedAt": DT}, ["requestId", "requestNumber", "title", "status"]),
 "UndoRequest": obj({"undoToken": S}, ["undoToken"]),
 "FieldUpdate": obj({"value": S, "paragraph": {"type": "integer", "minimum": 1}, "expectedVersion": I}, ["value", "expectedVersion"]),
 "Instruction": obj({"text": {"type": "string", "minLength": 1, "maxLength": 2000}, "channel": enum("TEXT", "VOICE")}, ["text"]),
 "InstructionResult": obj({"applied": arr(ref("FieldValue")), "undoToken": S, "explanation": S, "fallbackHint": S}, ["applied", "explanation"]),
 "Approval": obj({"id": UUID, "subject": S, "userId": UUID, "userName": S, "role": S, "decision": enum("APPROVED", "REJECTED", "SUPERSEDED"), "comment": S, "decidedAt": DT, "stamp": S}, ["id", "decision", "decidedAt"]),
 "Decision": obj({"decision": enum("APPROVE", "REJECT"), "comment": {"type": "string", "maxLength": 2000}, "gate": enum("RISK_SIGNOFF")}, ["decision"]),
 "Reopen": obj({"reason": {"type": "string", "minLength": 10, "maxLength": 1000}}, ["reason"]),
 "CoiDeclaration": obj({"subjectOrg": S, "nature": {"type": "string", "minLength": 3, "maxLength": 2000}, "none": B}, ["none"]),
 "CoiRecord": obj({"id": UUID, "userId": UUID, "userName": S, "rationale": S, "scope": enum("PLAN", "EVALUATION"), "scopeId": UUID, "none": B, "nature": S, "disposition": enum("PENDING", "IMMATERIAL", "MANAGEABLE", "MATERIAL"), "routedTo": UUID, "decidedAt": DT}, ["id", "userId", "scope", "disposition"]),
 "CoiDecision": obj({"disposition": enum("IMMATERIAL", "MANAGEABLE", "MATERIAL"), "rationale": S}, ["disposition"]),
 "Tender": obj({"id": UUID, "requestId": UUID, "requestNumber": S, "title": S, "estimatedValue": N, "type": enum("RFT", "RFP", "RFQ", "RFI", "EOI"), "access": enum("OPEN", "CLOSED"),
   "status": enum("DRAFT", "STAGED", "PUBLISHED", "CLOSED", "EVALUATING", "AWARDED"), "opensAt": DT, "closesAt": DT, "version": I, "planStatus": S,
   "fields": arr(ref("TenderField")), "permission": ref("PublishPermission"), "invitations": arr(ref("InvitationState")), "questions": arr(ref("Question")),
   "addenda": arr(ref("Addendum")), "submissions": ref("SubmissionSummary"), "permissions": ref("TenderPermissions")}, ["id", "requestId", "type", "status", "version", "fields"]),
 "TenderSummary": obj({"id": UUID, "requestId": UUID, "requestNumber": S, "title": S, "estimatedValue": N, "type": S, "access": S, "status": S, "closesAt": DT, "permissionGranted": B, "invitations": I, "openQuestions": I, "bids": I, "updatedAt": DT}, ["id", "requestId", "title", "status"]),
 "TenderField": obj({"key": S, "label": S, "value": S, "paragraphs": arr(S), "source": S, "aiDrafted": B, "updatedAt": DT}, ["key", "label", "value"]),
 "TenderPermissions": obj({"canEdit": B, "canGrantPermission": B, "canPublish": B, "canInvite": B, "canAnswer": B, "canIssueAddendum": B}, ["canEdit", "canGrantPermission", "canPublish"]),
 "PublishPermission": obj({"granted": B, "by": S, "at": DT}, ["granted"]),
 "InvitationState": obj({"id": UUID, "email": S, "company": S, "state": enum("INVITED", "REGISTERED", "USED", "EXPIRED"), "expiresAt": DT}, ["id", "email", "company", "state"]),
 "SubmissionSummary": obj({"count": I, "sealed": B, "items": arr(obj({"supplierId": UUID, "company": S, "receipt": S, "submittedAt": DT}))}, ["count", "sealed"]),
 "TenderFieldUpdate": obj({"value": {"type": "string", "maxLength": 10000}, "expectedVersion": I}, ["value", "expectedVersion"]),
 "PermissionRequest": obj({"comment": {"type": "string", "maxLength": 1000}}),
 "PublishRequest": obj({"closesAt": DT}, ["closesAt"]),
 "TenderCreate": obj({"requestId": UUID, "type": enum("RFT", "RFP", "RFQ", "RFI", "EOI"), "access": enum("OPEN", "CLOSED")}, ["requestId", "type"]),
 "InviteRequest": obj({"invitees": {"type": "array", "minItems": 1, "maxItems": 50, "items": obj({"email": {"type": "string", "format": "email"}, "company": S}, ["email", "company"])}}, ["invitees"]),
 "InviteResponse": obj({"invitations": arr(obj({"id": UUID, "email": S, "company": S, "expiresAt": DT, "registerPath": S}, ["id", "email", "company", "registerPath"]))}, ["invitations"]),
 "InvitationInfo": obj({"email": S, "company": S, "organisation": S, "expiresAt": DT}, ["email", "company"]),
 "Question": obj({"id": UUID, "text": S, "answer": S, "status": enum("OPEN", "ANSWERED", "PUBLISHED"), "askedAt": DT}, ["id", "text", "status"]),
 "AnswerRequest": obj({"answer": {"type": "string", "minLength": 2, "maxLength": 4000}}, ["answer"]),
 "QuestionCreate": obj({"text": {"type": "string", "minLength": 5, "maxLength": 2000}}, ["text"]),
 "Addendum": obj({"id": UUID, "number": I, "summary": S, "questionIds": arr(UUID), "newClosesAt": DT, "issuedAt": DT}, ["id", "number", "summary"]),
 "AddendumCreate": obj({"summary": {"type": "string", "minLength": 5}, "questionIds": arr(UUID), "newClosesAt": DT}, ["summary"]),
 "SupplierRegistration": obj({"token": S, "name": S, "email": {"type": "string", "format": "email"}, "company": S, "abn": S, "password": {"type": "string", "minLength": 12}}, ["name", "email", "company", "abn", "password"]),
 "RegistrationResult": obj({"registered": B, "supplierId": UUID, "sanctionsStatus": enum("PENDING", "CLEAR", "MATCH")}, ["registered", "supplierId"]),
 "SupplierTenderSummary": obj({"id": UUID, "title": S, "number": S, "type": S, "status": S, "closesAt": DT, "submissionStatus": enum("NOT_STARTED", "DRAFT", "SUBMITTED", "REJECTED_LATE"), "receipt": S}, ["id", "title", "status"]),
 "SupplierTender": obj({"id": UUID, "title": S, "number": S, "type": S, "status": S, "opensAt": DT, "closesAt": DT, "serverTime": DT, "fields": arr(ref("TenderField")), "questions": arr(ref("Question")), "addenda": arr(ref("Addendum")),
   "submission": obj({"status": S, "receipt": S, "submittedAt": DT, "files": arr(ref("BidFile"))}, ["status", "files"]), "canBid": B}, ["id", "title", "status", "fields", "submission", "canBid"]),
 "BidFileUpload": obj({"name": S, "section": enum("TECHNICAL", "COMMERCIAL", "OTHER"), "dataBase64": S}, ["name", "dataBase64"]),
 "BidFile": obj({"id": UUID, "name": S, "sizeBytes": I, "contentType": S, "section": S, "scan": S, "sha256": S, "uploadedAt": DT}, ["id", "name", "sizeBytes", "section"]),
 "BidReceipt": obj({"receipt": S, "submittedAt": DT, "closesAt": DT, "files": arr(obj({"name": S, "sizeBytes": I, "section": S, "sha256": S}))}, ["receipt", "submittedAt", "files"]),
 "Supplier": obj({"id": UUID, "company": S, "abn": S, "sanctionsStatus": enum("PENDING", "CLEAR", "MATCH"), "insuranceStatus": enum("UNKNOWN", "CURRENT", "EXPIRING", "EXPIRED"), "lastCheckedAt": DT}, ["id", "company", "sanctionsStatus"]),
 "Submission": obj({"id": UUID, "tenderId": UUID, "supplierId": UUID, "status": enum("DRAFT", "SUBMITTED", "REJECTED_LATE"), "files": arr(ref("FileRef")), "receipt": S, "submittedAt": DT}, ["id", "tenderId", "status"]),
 "FileRef": obj({"id": UUID, "name": S, "sizeBytes": I, "contentType": S, "scan": enum("PENDING", "CLEAN", "INFECTED"), "section": enum("TECHNICAL", "COMMERCIAL", "OTHER")}, ["id", "name"]),
 "Evaluation": obj({"id": UUID, "tenderId": UUID, "requestNumber": S, "title": S, "tenderType": S, "status": enum("COI_PENDING", "SCORING", "CONSENSUS", "LOCKED", "REPORTED", "APPROVED"),
   "varianceLimitPct": I, "version": I, "criteria": arr(ref("Criterion")), "panel": arr(ref("PanelMember")), "suppliers": arr(ref("EvalSupplier")),
   "conflicts": arr(ref("EvalConflict")), "me": ref("EvalMe"), "consensus": arr(ref("ConsensusItem")), "ranking": arr(ref("RankedSupplier")), "report": ref("EvalReport"), "permissions": ref("EvalPermissions")}, ["id", "tenderId", "status", "criteria", "panel", "suppliers", "permissions"]),
 "EvalConflict": obj({"userId": UUID, "name": S, "nature": S, "subjectOrg": S, "disposition": enum("PENDING", "IMMATERIAL", "MANAGEABLE", "MATERIAL"), "declaredAt": DT, "decidedAt": DT}, ["userId", "name", "disposition"]),
 "ConflictDecision": obj({"disposition": enum("IMMATERIAL", "MANAGEABLE", "MATERIAL"), "rationale": {"type": "string", "maxLength": 2000}}, ["disposition"]),
 "ReopenConsensus": obj({"reason": {"type": "string", "minLength": 10, "maxLength": 1000}}, ["reason"]),
 "EvalMe": obj({"stream": S, "coiState": S, "scoringComplete": B, "required": I, "done": I}),
 "EvalPermissions": obj({"canReopen": B, "canDecideConflict": B, "canDeclare": B, "canScore": B, "canOpenConsensus": B, "canSetConsensus": B, "canLock": B, "canManagePanel": B, "canGenerateReport": B, "canDecideReport": B}),
 "EvalSummary": obj({"id": UUID, "tenderId": UUID, "requestNumber": S, "title": S, "status": S, "bids": I, "panelSize": I, "myCoiState": S, "myScoringComplete": B, "updatedAt": DT}, ["id", "tenderId", "title", "status"]),
 "EvalList": obj({"evaluations": arr(ref("EvalSummary")), "ready": arr(obj({"tenderId": UUID, "requestNumber": S, "title": S, "type": S, "bids": I, "evaluable": B}))}, ["evaluations"]),
 "EvaluatorList": obj({"evaluators": arr(obj({"id": UUID, "name": S})), "chairs": arr(obj({"id": UUID, "name": S}))}, ["evaluators", "chairs"]),
 "OpenEvaluation": obj({"panel": {"type": "array", "minItems": 1, "maxItems": 12, "items": obj({"userId": UUID, "stream": enum("TECHNICAL", "COMMERCIAL")}, ["userId", "stream"])}}, ["panel"]),
 "AddPanelMember": obj({"userId": UUID, "stream": enum("TECHNICAL", "COMMERCIAL", "OTHER")}, ["userId", "stream"]),
 "RankedSupplier": obj({"supplierId": UUID, "displayName": S, "weightedScore": N, "rank": I, "compliance": enum("PASS", "FAIL")}, ["supplierId", "displayName", "weightedScore", "compliance"]),
 "EvalReport": obj({"id": UUID, "status": enum("DRAFT", "AWAITING_APPROVAL", "APPROVED"), "generatedAt": DT, "sections": arr(obj({"key": S, "label": S, "paragraphs": arr(S)})), "decision": obj({"decision": S, "stamp": S, "comment": S})}, ["id", "status", "generatedAt", "sections"]),
 "Report": obj({"id": UUID, "status": S}),
 "Criterion": obj({"id": UUID, "name": S, "weight": N, "stream": enum("TECHNICAL", "COMMERCIAL", "OTHER"), "passFail": B}, ["id", "name", "weight", "stream"]),
 "PanelMember": obj({"userId": UUID, "name": S, "stream": S, "coiState": enum("NOT_DECLARED", "DECLARED_NONE", "DECLARED_CONFLICT", "REMOVED"), "scoringComplete": B}, ["userId", "name", "stream", "coiState"]),
 "EvalSupplier": obj({"supplierId": UUID, "displayName": S, "anonymised": B, "files": arr(obj({"id": UUID, "name": S, "section": S, "sizeBytes": I, "contentType": S}))}, ["supplierId", "displayName", "anonymised"]),
 "ScoreSet": obj({"criteria": arr(ref("Criterion")), "suppliers": arr(obj({"supplierId": UUID, "displayName": S, "scores": arr(obj({"criterionId": UUID, "score": N, "comment": S}))})), "progress": obj({"required": I, "done": I, "complete": B})}, ["criteria", "suppliers", "progress"]),
 "ScoresUpdate": obj({"supplierId": UUID, "scores": {"type": "array", "minItems": 1, "maxItems": 50, "items": obj({"criterionId": UUID, "score": {"type": "number", "minimum": 0, "maximum": 10, "multipleOf": 0.5}, "comment": {"type": "string", "maxLength": 2000}}, ["criterionId", "score"])}}, ["supplierId", "scores"]),
 "CoiOutcome": obj({"suspended": B, "message": S}),
 "ConsensusItem": obj({"supplierId": UUID, "criterionId": UUID, "variancePct": N, "flagged": B, "consensusScore": N, "rationale": S, "individual": arr(obj({"evaluator": S, "score": N, "comment": S}))}, ["supplierId", "criterionId", "flagged"]),
 "ConsensusUpdate": obj({"items": {"type": "array", "minItems": 1, "maxItems": 50, "items": obj({"criterionId": UUID, "consensusScore": {"type": "number", "minimum": 0, "maximum": 10}, "rationale": {"type": "string", "maxLength": 2000}}, ["criterionId", "consensusScore"])}}, ["items"]),
 "Report": obj({"id": UUID, "evaluationId": UUID, "status": enum("DRAFT", "AWAITING_APPROVAL", "APPROVED"), "fields": arr(ref("FieldValue")), "generatedAt": DT, "approvals": arr(ref("Approval"))}, ["id", "evaluationId", "status"]),
 "ContractSummary": obj({"id": UUID, "number": S, "status": enum("DRAFT", "LEGAL_REVIEW", "AWAITING_SIGNATURE", "PARTIALLY_SIGNED", "EXECUTED"), "value": N, "supplierId": UUID, "supplierName": S, "title": S, "requestNumber": S, "templateId": S, "startDate": {"type": "string", "format": "date"}, "endDate": {"type": "string", "format": "date"}, "noticeDays": I, "locked": B, "tenderId": UUID, "version": I, "signed": I, "signaturesRequired": I}, ["id", "number", "status"]),
 "ContractDeviation": obj({"clauseId": S, "title": S, "mandatory": B, "templateText": S, "currentText": S}, ["clauseId", "templateText", "currentText"]),
 "ContractSigner": obj({"role": enum("DELEGATE", "EXEC"), "label": S, "signedBy": S, "stamp": S}, ["role", "label"]),
 "ContractPermissions": obj({"canEdit": B, "canEditTerms": B, "canRelease": B, "canSign": B, "signBlocked": S, "canDelete": B}),
 "ContractAward": obj({"evaluationId": UUID, "tenderId": UUID, "requestNumber": S, "title": S, "estimatedValue": N, "recommended": arr(obj({"supplierId": UUID, "company": S, "score": N})), "contractId": UUID, "contractNumber": S}, ["evaluationId", "requestNumber", "recommended"]),
 "ContractTerms": obj({"value": N, "startDate": {"type": "string", "format": "date"}, "endDate": {"type": "string", "format": "date"}, "noticeDays": I}),
 "ContractDelete": obj({"reason": {"type": "string", "minLength": 10, "maxLength": 1000}}, ["reason"]),
 "Contract": obj({"id": UUID, "number": S, "tenderId": UUID, "supplierId": UUID, "templateId": S, "status": enum("DRAFT", "LEGAL_REVIEW", "AWAITING_SIGNATURE", "PARTIALLY_SIGNED", "EXECUTED"), "value": N, "startDate": {"type": "string", "format": "date"}, "endDate": {"type": "string", "format": "date"},
   "noticeDays": I, "clauses": arr(ref("Clause")), "signatures": arr(ref("Approval")), "parentId": UUID, "locked": B, "version": I,
   "supplierName": S, "title": S, "requestNumber": S, "signed": I, "signaturesRequired": I, "deviations": arr(ref("ContractDeviation")), "record": ref("ContractRecord"), "chain": arr(ref("ContractSigner")), "permissions": ref("ContractPermissions")}, ["id", "number", "status"]),
 "ContractCreate": obj({"evaluationId": UUID, "supplierId": UUID, "value": N, "startDate": {"type": "string", "format": "date"}, "endDate": {"type": "string", "format": "date"}}, ["evaluationId", "supplierId"]),
 "Clause": obj({"id": S, "title": S, "text": S, "mandatory": B, "changedFromTemplate": B}, ["id", "title", "text"]),
 "Alert": obj({"id": UUID, "contractId": UUID, "kind": enum("EXPIRY", "NOTICE", "MILESTONE", "EXTENSION", "CUSTOM"), "triggerDate": {"type": "string", "format": "date"}, "recipientRule": S, "status": enum("SCHEDULED", "SENT", "CANCELLED"), "origin": enum("SYSTEM", "USER"), "sentAt": DT, "contractNumber": S, "endDate": {"type": "string", "format": "date"}, "deliveries": arr(ref("AlertDelivery"))}, ["id", "contractId", "kind", "triggerDate"]),
 "AlertDelivery": obj({"channel": enum("IN_APP", "EMAIL"), "status": enum("DELIVERED", "SIMULATED"), "deliveredAt": DT}, ["channel", "status", "deliveredAt"]),
 "TermBar": obj({"label": S, "start": {"type": "string", "format": "date"}, "end": {"type": "string", "format": "date"}, "optional": B}, ["label", "start", "end", "optional"]),
 "ContractRecord": obj({"owner": obj({"id": UUID, "name": S}), "milestones": arr(obj({"id": UUID, "title": S, "dueDate": {"type": "string", "format": "date"}})), "extensions": arr(ref("TermBar")), "bars": arr(ref("TermBar")), "alerts": arr(ref("Alert"))}),
 "AlertCreate": obj({"instruction": {"type": "string", "minLength": 5, "maxLength": 500}}, ["instruction"]),
 "Kpis": obj({"activeProcurements": I, "valueInFlight": N, "avgCycleDays": N, "alertsDue": I, "pendingMyAction": I, "byPhase": arr(obj({"phase": S, "count": I})), "recent": arr(ref("RecentProcurement"))}, ["activeProcurements", "valueInFlight", "avgCycleDays"]),
 "RecentProcurement": obj({"id": UUID, "number": S, "title": S, "phase": S, "status": S, "estimatedValue": N, "updatedAt": DT}, ["id", "number", "title", "phase", "status"]),
 "ExpiringContract": obj({"contractId": UUID, "number": S, "title": S, "supplier": S, "value": N, "owner": S, "startDate": {"type": "string", "format": "date"}, "endDate": {"type": "string", "format": "date"}, "noticeDeadline": {"type": "string", "format": "date"}, "daysRemaining": I, "optionalExtensions": arr(obj({"months": I, "endDate": {"type": "string", "format": "date"}})), "bars": arr(ref("TermBar"))}, ["contractId", "number", "endDate", "daysRemaining"]),
 "AuditEvent": obj({"id": UUID, "seq": I, "at": DT, "actorId": UUID, "actorRole": S, "action": S, "entityType": S, "entityId": UUID, "before": {"type": "object", "additionalProperties": True}, "after": {"type": "object", "additionalProperties": True}, "correlationId": S, "result": enum("SUCCESS", "DENIED", "FAILED"), "hash": S}, ["id", "seq", "at", "action", "entityType", "result"]),
 "AuditPage": obj({"items": arr(ref("AuditEvent")), "page": ref("Page")}, ["items", "page"]),
 "Notification": obj({"id": UUID, "title": S, "body": S, "link": S, "read": B, "createdAt": DT}, ["id", "title", "createdAt"]),
 "Delegation": obj({"id": UUID, "role": S, "scope": enum("SOURCING_APPROVAL", "CONTRACT_SIGNING", "PUBLISH_PERMISSION"), "maxValue": N, "division": S, "active": B}, ["id", "scope", "maxValue"]),
 "DelegationUpdate": obj({"maxValue": {"type": "number", "minimum": 0}, "active": B}, ["maxValue"]),
 "AdminUser": obj({"id": UUID, "name": S, "email": S, "role": enum(*ROLES), "orgUnit": S, "active": B}, ["id", "name", "email", "role"]),
 "AdminUserCreate": obj({"name": S, "email": {"type": "string", "format": "email"}, "role": enum(*ROLES), "orgUnit": S}, ["name", "email", "role"]),
 "Workflow": obj({"id": S, "name": S, "tier": enum("SIMPLE", "INTERMEDIATE", "COMPLEX"), "steps": arr(obj({"key": S, "label": S, "mandatory": B, "approverRole": S})), "editable": B}, ["id", "name", "steps"]),
 "Template": obj({"id": S, "type": S, "name": S, "version": S, "status": S}, ["id", "type", "name"]),
 "ComingSoon": obj({"feature": S, "status": enum("COMING_SOON"), "plannedPhase": S, "requirementIds": arr(S)}, ["feature", "status"]),
 "MigrationUpload": obj({"id": UUID, "rowsRead": I, "rowsAccepted": I, "errors": arr(obj({"row": I, "message": S})), "status": enum("VALIDATED", "FAILED")}, ["id", "rowsRead", "rowsAccepted"]),
}

# method, path, opId, tag, summary, roles (None=public, "*"=any signed in), req schema, resp schema (or None), status, array?, extra params
E = []
def ep(m, p, op, tag, summ, roles, req=None, resp=None, st=200, query=None, arrayResp=False, note=""):
    E.append(dict(m=m, p=p, op=op, tag=tag, summ=summ, roles=roles, req=req, resp=resp, st=st, query=query or [], arr=arrayResp, note=note))

A = "Auth"; ep("POST", "/auth/login", "login", A, "Mock login; returns session cookie (HttpOnly) and user", None, "LoginRequest", "Session")
ep("POST", "/auth/logout", "logout", A, "End session", "*", None, None, 204)
ep("POST", "/auth/forgot-password", "forgotPassword", A, "Request reset; always returns 202 (no account enumeration)", None, "ForgotPassword", "Message", 202)
ep("GET", "/auth/me", "getMe", A, "Current user and role-based home path", "*", None, "User")
ep("POST", "/auth/access-denied", "reportAccessDenied", A, "Web route guard reports a blocked page visit so it is audited", "*", "AccessDenied", None, 204)
T = "Requests"; R = ["REQUESTER", "PROCUREMENT", "EXEC", "FINANCE", "ADMIN", "DELEGATE", "PROBITY"]
ep("GET", "/requests", "listRequests", T, "List requests visible to caller (requesters see their own)", ["REQUESTER", "PROCUREMENT", "DELEGATE", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "EXEC"], None, "RequestList", query=["phase", "status", "q", "limit", "offset"])
ep("POST", "/requests", "createRequest", T, "Create blank request", ["REQUESTER", "PROCUREMENT"], "RequestPatch", "ProcurementRequest", 201)
ep("GET", "/requests/{id}", "getRequest", T, "Get request", ["REQUESTER", "PROCUREMENT", "DELEGATE", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "EXEC"], None, "ProcurementRequest")
ep("PATCH", "/requests/{id}", "updateRequest", T, "Update request fields", ["REQUESTER", "PROCUREMENT"], "RequestPatch", "ProcurementRequest")
ep("POST", "/requests/{id}/submit", "submitRequest", T, "Run budget check, complexity score and routing; submits", ["REQUESTER", "PROCUREMENT"], None, "ProcurementRequest", note="409 if mandatory fields missing; 422 if hard-cap budget exceeded")
Q = "Assistant"
ep("POST", "/assistant/conversations", "startConversation", Q, "Start mock-AI conversation (simulated=true)", ["REQUESTER", "PROCUREMENT"], "ConversationStart", "Conversation", 201)
ep("GET", "/assistant/conversations/{id}", "getConversation", Q, "Get conversation", ["REQUESTER", "PROCUREMENT"], None, "Conversation")
ep("POST", "/assistant/conversations/{id}/messages", "sendMessage", Q, "Send user text; returns assistant reply with proposed field changes", ["REQUESTER", "PROCUREMENT"], "ChatSend", "ChatMessage", 201)
P = "Plans"
ep("GET", "/plans", "listPlans", P, "Plans visible to the caller (requesters see their own)", ["REQUESTER", "PROCUREMENT", "DELEGATE", "LEGAL", "PROBITY", "EXEC"], None, "PlanSummary", arrayResp=True, query=["status"])
ep("GET", "/requests/{id}/plan", "getPlan", P, "Get (or lazily create from intake) the procurement plan", ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "PROBITY", "EXEC"], None, "Plan")
ep("PUT", "/plans/{id}/fields/{key}", "updatePlanField", P, "Set a field (or one paragraph); optimistic concurrency via expectedVersion", ["PROCUREMENT", "REQUESTER"], "FieldUpdate", "Plan", note="409 on stale version; 423 if plan locked")
ep("POST", "/plans/{id}/instructions", "instructPlan", P, "Plain-language amend ('change paragraph 3 to …')", ["PROCUREMENT", "REQUESTER"], "Instruction", "InstructionResult")
ep("POST", "/plans/{id}/instructions/undo", "undoInstruction", P, "Undo last instruction by token", ["PROCUREMENT", "REQUESTER"], "UndoRequest", "Plan")
ep("POST", "/plans/{id}/submit-for-approval", "submitPlan", P, "Move to approval; requires COI declarations and risk gates", ["PROCUREMENT"], None, "Plan")
ep("POST", "/plans/{id}/decision", "decidePlan", P, "Delegate approves/rejects within their delegation (locks on approval); the independent risk officer signs off the risk gate", ["DELEGATE", "EXEC", "PROBITY"], "Decision", "Plan", note="403 if value exceeds delegation; 409 if gates unmet")
ep("POST", "/plans/{id}/reopen", "reopenPlan", P, "Reopen locked plan with reason (Procurement only)", ["PROCUREMENT"], "Reopen", "Plan")
ep("POST", "/plans/{id}/coi", "declarePlanCoi", P, "Declare conflict (or none)", ["PROCUREMENT", "EVALUATOR", "CHAIR", "LEGAL", "DELEGATE"], "CoiDeclaration", "CoiRecord", 201)
ep("POST", "/coi/{id}/decision", "decideCoi", P, "Delegate/Risk decides disposition", ["DELEGATE", "EXEC", "PROBITY"], "CoiDecision", "CoiRecord")
D = "Tenders"
ep("GET", "/tenders", "listTenders", D, "List tenders visible to caller (bid counts only; content stays sealed until close)", ["PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "PROBITY", "EXEC", "ADMIN"], None, "TenderSummary", arrayResp=True)
ep("POST", "/tenders", "createTender", D, "Create tender and generate pack from request/plan", ["PROCUREMENT"], "TenderCreate", "Tender", 201)
ep("GET", "/tenders/{id}", "getTender", D, "Get tender", ["PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "PROBITY", "EXEC", "ADMIN"], None, "Tender")
ep("PUT", "/tenders/{id}/fields/{key}", "updateTenderField", D, "Edit a pack section while the tender is staged", ["PROCUREMENT", "LEGAL"], "TenderFieldUpdate", "Tender", note="409 on stale version; 423 once published")
ep("POST", "/tenders/{id}/publish-permission", "grantPublishPermission", D, "ECV-appropriate delegate grants permission to publish", ["DELEGATE"], "PermissionRequest", "Tender", note="403 if value exceeds the delegate's publishing authority")
ep("POST", "/tenders/{id}/publish", "publishTender", D, "Publish (needs permission, approved plan, statutory window valid)", ["PROCUREMENT"], "PublishRequest", "Tender", note="409 without permission or approved plan; 422 if statutory window not met")
ep("POST", "/tenders/{id}/invitations", "inviteSuppliers", D, "Invite supplier contacts; returns each one-time registration link (mail is simulated)", ["PROCUREMENT"], "InviteRequest", "InviteResponse", 201, note="409 if already invited")
ep("GET", "/tenders/{id}/questions", "listQuestions", D, "Questions (author never returned; suppliers see published ones only)", ["PROCUREMENT", "LEGAL", "SUPPLIER"], None, "Question", arrayResp=True)
ep("POST", "/tenders/{id}/questions/{questionId}/answer", "answerQuestion", D, "Draft the answer to a question (published to everyone via an addendum)", ["PROCUREMENT", "LEGAL"], "AnswerRequest", "Question", note="409 once published")
ep("POST", "/tenders/{id}/addenda", "issueAddendum", D, "Publish answers/changes to all bidders", ["PROCUREMENT"], "AddendumCreate", "Addendum", 201)
SP = "SupplierPortal"
ep("POST", "/supplier/register", "registerSupplier", SP, "Self-register from an invitation token (or, for open tenders, without one)", None, "SupplierRegistration", "RegistrationResult", 201, note="400 invalid ABN checksum; 404 invalid invitation; 409 generic if already registered")
ep("GET", "/supplier/invitations/{token}", "getInvitation", SP, "Look up an invitation link to pre-fill registration (one generic 404 for unknown, used or expired)", None, None, "InvitationInfo")
ep("GET", "/supplier/tenders", "listMyTenders", SP, "Tenders caller is invited to (plus open-access tenders)", ["SUPPLIER"], None, "SupplierTenderSummary", arrayResp=True)
ep("GET", "/supplier/tenders/{id}", "getMyTender", SP, "One tender: pack, published Q&A and addenda, own bid", ["SUPPLIER"], None, "SupplierTender", note="404 (and audited) if not invited")
ep("POST", "/supplier/tenders/{id}/questions", "askQuestion", SP, "Ask anonymised question", ["SUPPLIER"], "QuestionCreate", "Question", 201)
ep("POST", "/supplier/tenders/{id}/submission/files", "uploadBidFile", SP, "Upload one file (JSON, base64): allow-list, 10 MB, content check, scan stub, sealed storage", ["SUPPLIER"], "BidFileUpload", "BidFile", 201, note="400 type/name/content; 413 size; 409 BID_CLOSED after close or already submitted")
ep("DELETE", "/supplier/tenders/{id}/submission/files/{fileId}", "deleteBidFile", SP, "Remove a file from an unsubmitted bid", ["SUPPLIER"], None, None, 204, note="409 once submitted (withdraw first) or closed")
ep("POST", "/supplier/tenders/{id}/submission", "submitBid", SP, "Submit; issues a receipt; refused after the closing time", ["SUPPLIER"], None, "BidReceipt", 201, note="409 BID_CLOSED after closesAt (late attempt discarded and notified); 409 SUBMISSION_INCOMPLETE without technical and commercial files")
ep("POST", "/supplier/tenders/{id}/submission/withdraw", "withdrawBid", SP, "Withdraw a submitted bid before close so files can be changed", ["SUPPLIER"], None, "SupplierTender", note="409 after close")
ep("GET", "/suppliers/{id}", "getSupplier", SP, "Supplier profile with sanctions/insurance status", ["PROCUREMENT", "LEGAL", "FINANCE", "ADMIN"], None, "Supplier")
V = "Evaluation"
ER = ["PROCUREMENT", "EVALUATOR", "CHAIR", "DELEGATE", "PROBITY", "LEGAL", "EXEC"]
ep("GET", "/evaluations", "listEvaluations", V, "Evaluations the caller can see, plus (procurement) closed tenders ready to evaluate", ER, None, "EvalList")
ep("GET", "/evaluators", "listEvaluators", V, "Users who can sit on a panel", ["PROCUREMENT"], None, "EvaluatorList")
ep("POST", "/tenders/{id}/evaluation", "openEvaluation", V, "Open the evaluation of a closed tender: one record per submitted bid, scoring sheet from the published criteria, panel chosen by procurement", ["PROCUREMENT"], "OpenEvaluation", "Evaluation", 201, note="409 unless the tender is closed, has bids and is scored for award; 400 if the panel lacks a stream")
ep("POST", "/evaluations/{id}/panel", "addPanelMember", V, "Add a replacement panel member (before consensus)", ["PROCUREMENT"], "AddPanelMember", "Evaluation", 201)
ep("GET", "/evaluations/{id}", "getEvaluation", V, "Get the evaluation as the caller may see it: suppliers anonymised and files withheld until a panel member declares no conflict; criteria and files limited to their stream; others' scores hidden until consensus", ER, None, "Evaluation", note="404 for anyone not on the panel (and for removed members)")
ep("POST", "/evaluations/{id}/coi", "declareEvalCoi", V, "Mandatory conflict declaration before any access; a conflict suspends the member at once, alerts chair, probity and procurement, and goes to a delegate to decide", ["EVALUATOR", "CHAIR"], "CoiDeclaration", "CoiOutcome", 201)
ep("GET", "/evaluations/{id}/scores/mine", "getMyScores", V, "Own scores and progress only", ["EVALUATOR", "CHAIR"], None, "ScoreSet", note="403 COI_REQUIRED until declared")
ep("PUT", "/evaluations/{id}/scores", "saveScores", V, "Save own scores for one supplier (hidden from everyone else)", ["EVALUATOR", "CHAIR"], "ScoresUpdate", "ScoreSet", note="404 for a criterion outside the caller's stream; 409 once marked complete")
ep("POST", "/evaluations/{id}/conflicts/{userId}/decision", "decideEvalConflict", V, "Delegate (or executive) decides a declared conflict: immaterial or manageable reinstates the evaluator, material removes them", ["DELEGATE", "EXEC"], "ConflictDecision", "Evaluation", note="409 if nothing is waiting; 403 for your own conflict")
ep("POST", "/evaluations/{id}/scores/submit", "submitScores", V, "Mark own scoring complete (every supplier on every allowed criterion)", ["EVALUATOR", "CHAIR"], None, "Evaluation", note="409 SCORING_INCOMPLETE")
ep("POST", "/evaluations/{id}/consensus/open", "openConsensus", V, "Chair opens consensus once every member has finished; variance is computed and flagged", ["CHAIR"], None, "Evaluation", note="409 SCORING_PENDING")
ep("PUT", "/evaluations/{id}/consensus/{supplierId}", "setConsensus", V, "Record consensus scores and rationale for one supplier", ["CHAIR"], "ConsensusUpdate", "Evaluation")
ep("POST", "/evaluations/{id}/consensus/reopen", "reopenConsensus", V, "Chair reopens a locked consensus with a recorded reason; any report is invalidated and must be generated again", ["CHAIR"], "ReopenConsensus", "Evaluation", note="409 once the report is approved")
ep("POST", "/evaluations/{id}/consensus/lock", "lockConsensus", V, "Lock consensus; refused while any flagged score lacks a rationale", ["CHAIR"], None, "Evaluation", note="409 FLAGS_UNRESOLVED / CONSENSUS_INCOMPLETE")
ep("POST", "/evaluations/{id}/report", "generateReport", V, "Generate the evaluation report from the locked consensus", ["PROCUREMENT"], None, "Evaluation", 201)
ep("POST", "/evaluation-reports/{id}/decision", "decideReport", V, "Delegate (within their authority) or executive approves or returns the report", ["DELEGATE", "EXEC"], "Decision", "Evaluation", note="403 if the award value exceeds the approver's authority")
ep("GET", "/evaluations/{id}/report/pdf", "exportReportPdf", V, "The evaluation report as a PDF carrying its generation time and version on every page", ["PROCUREMENT", "DELEGATE", "EXEC", "PROBITY", "LEGAL", "CHAIR"], None, None, note="404 until a report exists")
ep("GET", "/evaluations/{id}/suppliers/{supplierId}/files/{fileId}", "downloadBidFile", V, "Download one bid file (panel members only after declaring no conflict, and only files of their stream)", ["EVALUATOR", "CHAIR", "PROCUREMENT", "PROBITY", "LEGAL"], None, None, note="404 for any file the caller may not see")
C = "Contracts"
ep("POST", "/contracts", "draftContract", C, "Draft from approved report: template for the tender route + clause library + winning supplier data. Value defaults to the request estimate (bid prices are not captured)", ["LEGAL", "PROCUREMENT"], "ContractCreate", "Contract", 201, note="422 SUPPLIER_NOT_RECOMMENDED unless the supplier is ranked first; 409 CONTRACT_EXISTS")
ep("GET", "/contracts", "listContracts", C, "Contracts visible to caller", ["PROCUREMENT", "LEGAL", "CONTRACT_MGR", "DELEGATE", "EXEC", "FINANCE", "PROBITY"], None, "ContractSummary", arrayResp=True, query=["status", "q"])
ep("GET", "/contracts/awards", "listContractAwards", C, "Approved evaluations and whom the report recommends, with any contract already drafted", ["LEGAL", "PROCUREMENT"], None, "ContractAward", arrayResp=True)
ep("PATCH", "/contracts/{id}", "updateContractTerms", C, "Change value, dates or notice period of a draft; unedited clauses follow", ["LEGAL", "PROCUREMENT"], "ContractTerms", "Contract", note="423 when executed")
ep("DELETE", "/contracts/{id}", "deleteContract", C, "Logical delete with a reason (the record is kept and audited)", ["LEGAL", "EXEC"], "ContractDelete", None, 204)
ep("GET", "/contracts/{id}", "getContract", C, "Get contract", ["PROCUREMENT", "LEGAL", "CONTRACT_MGR", "DELEGATE", "EXEC", "FINANCE", "PROBITY"], None, "Contract")
ep("PUT", "/contracts/{id}/clauses/{clauseId}", "updateClause", C, "Edit clause; a change from the template is marked (blocked when locked)", ["LEGAL"], "Clause", "Clause", note="423 CONTRACT_LOCKED when executed; 422 MANDATORY_CLAUSE")
ep("POST", "/contracts/{id}/release-for-signing", "releaseForSigning", C, "Release the reviewed draft for signing", ["LEGAL", "PROCUREMENT"], None, "Contract", note="422 RELEASE_BLOCKED lists what is missing; procurement can release only after legal review")
ep("POST", "/contracts/{id}/sign", "signContract", C, "Mock e-signature with a stamp (name, role, time); signing authority is checked separately from sourcing approval. Above 1M the executive co-signs. REJECT returns the contract to legal", ["DELEGATE", "EXEC"], "Decision", "Contract", note="403 SIGNING_AUTHORITY_INSUFFICIENT; 409 ALREADY_SIGNED; 423 once executed")
ep("GET", "/contracts/{id}/alerts", "listAlerts", C, "Alerts of the contract with their delivery log (due alerts fire first)", ["CONTRACT_MGR", "PROCUREMENT", "LEGAL", "EXEC"], None, "Alert", arrayResp=True)
ep("GET", "/alerts", "listAllAlerts", C, "All contract alerts, soonest first (due alerts fire first)", ["CONTRACT_MGR", "PROCUREMENT", "LEGAL", "EXEC"], None, "Alert", arrayResp=True, query=["status"])
ep("POST", "/contracts/{id}/alerts", "createAlert", C, "Create alert from plain-language instruction", ["CONTRACT_MGR"], "AlertCreate", "Alert", 201)
G = "Reporting"
ep("GET", "/dashboard/kpis", "getKpis", G, "Role-scoped KPIs (staff only; requesters see their own requests)", [r for r in ROLES if r != "SUPPLIER"], None, "Kpis")
ep("GET", "/reports/expiring-contracts", "expiringContracts", G, "Executed contracts ending within N days (default 90), soonest first, with the term and optional extensions for the Gantt chart", ["CONTRACT_MGR", "PROCUREMENT", "EXEC", "LEGAL"], None, "ExpiringContract", arrayResp=True, query=["days"])
ep("GET", "/audit-events", "listAuditEvents", G, "Search audit trail", ["PROBITY", "ADMIN", "EXEC", "PROCUREMENT"], None, "AuditPage", query=["entityType", "entityId", "actorId", "from", "to", "limit", "offset"])
ep("GET", "/audit-events/export", "exportAudit", G, "Export audit report (CSV); the export is itself audited", ["PROBITY", "ADMIN"], None, None, note="text/csv")
ep("GET", "/reports/spend", "spendReport", G, "Spend by category/supplier (seed data)", ["EXEC", "FINANCE", "PROCUREMENT"], None, "ComingSoon", note="Stub in POC (returns ComingSoon)")
N = "Notifications"
ep("GET", "/notifications", "listNotifications", N, "My notifications", "*", None, "Notification", arrayResp=True)
ep("POST", "/notifications/{id}/read", "markRead", N, "Mark read", "*", None, None, 204)
AD = "Admin"
ep("GET", "/admin/users", "adminListUsers", AD, "List users", ["ADMIN"], None, "AdminUser", arrayResp=True)
ep("POST", "/admin/users", "adminCreateUser", AD, "Create user", ["ADMIN"], "AdminUserCreate", "AdminUser", 201)
ep("GET", "/admin/delegations", "listDelegations", AD, "Delegations of authority", ["ADMIN", "EXEC"], None, "Delegation", arrayResp=True)
ep("PUT", "/admin/delegations/{id}", "updateDelegation", AD, "Change threshold; audited", ["ADMIN"], "DelegationUpdate", "Delegation")
ep("GET", "/admin/workflows", "listWorkflows", AD, "Workflow library", ["ADMIN", "PROCUREMENT"], None, "Workflow", arrayResp=True)
ep("GET", "/admin/templates", "listTemplates", AD, "Template library (read-only in POC)", ["ADMIN", "PROCUREMENT", "LEGAL"], None, "Template", arrayResp=True)
M = "Migration"
ep("POST", "/migration/uploads", "uploadMigration", M, "Validate legacy contract CSV (profiling only in POC)", ["ADMIN", "CONTRACT_MGR"], None, "MigrationUpload", 201, note="multipart/form-data")
ep("GET", "/features/{key}", "getFeatureStatus", M, "Feature availability for Coming-soon screens", "*", None, "ComingSoon")

ERR = {"400": "Validation error", "401": "Not authenticated", "403": "Forbidden", "404": "Not found", "409": "Conflict / rule violated", "422": "Business rule failed", "423": "Locked", "429": "Rate limited"}
paths = {}
for e in E:
    params = []
    for seg in [s for s in e["p"].split("/") if s.startswith("{")]:
        params.append({"name": seg.strip("{}"), "in": "path", "required": True, "schema": S if seg.strip("{}") in ("key", "clauseId") else UUID})
    for q in e["query"]:
        params.append({"name": q, "in": "query", "required": False, "schema": I if q in ("limit", "offset", "days") else S})
    op = {"operationId": e["op"], "tags": [e["tag"]], "summary": e["summ"], "parameters": params,
          "x-roles": "public" if e["roles"] is None else ("any-authenticated" if e["roles"] == "*" else e["roles"]), "responses": {}}
    if e["note"]: op["description"] = e["note"]
    if e["roles"] is None: op["security"] = []
    if e["req"]: op["requestBody"] = {"required": True, "content": {"application/json": {"schema": ref(e["req"])}}}
    if e["resp"]:
        sch = arr(ref(e["resp"])) if e["arr"] else ref(e["resp"])
        op["responses"][str(e["st"])] = {"description": "Success", "content": {"application/json": {"schema": sch}}}
    else:
        op["responses"][str(e["st"])] = {"description": "Success"}
    codes = ["400", "401", "403", "404"] if e["roles"] is not None else ["400", "429"]
    if e["m"] in ("POST", "PUT", "PATCH"): codes += ["409", "422"]
    if e["roles"] is not None and "423" in e["note"]: codes.append("423")
    for c in dict.fromkeys(codes):
        op["responses"][c] = {"$ref": f"#/components/responses/E{c}"}
    paths.setdefault(e["p"], {})[e["m"].lower()] = op

responses = {f"E{c}": {"description": d, "content": {"application/problem+json": {"schema": ref("Problem")}}} for c, d in ERR.items()}
spec = {"openapi": "3.0.3",
  "info": {"title": "Intuitive Fusion Procurement Portal API (POC)", "version": "0.1.0-draft",
           "description": "REST API for the POC. Auth is mock (HttpOnly session cookie) behind an IdentityProvider interface. All mutations emit audit events. Errors follow RFC 7807 (application/problem+json) with stable `code` and `correlationId`."},
  "servers": [{"url": "http://localhost:4000/api/v1", "description": "Local dev"}],
  "tags": [{"name": t} for t in dict.fromkeys(e["tag"] for e in E)],
  "security": [{"sessionCookie": []}],
  "paths": paths,
  "components": {"securitySchemes": {"sessionCookie": {"type": "apiKey", "in": "cookie", "name": "if_session"}},
                 "schemas": schemas, "responses": responses}}
json.dump(spec, open(os.path.join(OUT, "openapi.json"), "w", encoding="utf8"), indent=1, ensure_ascii=False)

lines = ["| Method | Path | operationId | Roles | Purpose | Notes |", "|---|---|---|---|---|---|"]
for e in E:
    r = "public" if e["roles"] is None else ("any signed-in" if e["roles"] == "*" else ", ".join(e["roles"]))
    lines.append(f"| {e['m']} | `{e['p']}` | {e['op']} | {r} | {e['summ']} | {e['note']} |")
open(os.path.join(OUT, "endpoint-table.md"), "w", encoding="utf8").write("\n".join(lines) + "\n")
print(len(E), "operations;", len(schemas), "schemas")

import shutil
shutil.copyfile(os.path.join(OUT, "openapi.json"), os.path.join(ROOT, "apps", "api", "openapi.json"))  # runtime copy (drift-tested, ADR-0011)
