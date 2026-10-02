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
   "fields": arr(ref("FieldValue")), "createdAt": DT, "updatedAt": DT}, ["id", "number", "title", "phase", "status"]),
 "RequestList": obj({"items": arr(ref("ProcurementRequest")), "page": ref("Page")}, ["items", "page"]),
 "RequestPatch": obj({"title": S, "category": S, "estimatedValue": N, "termMonths": I, "businessUnit": S}),
 "ConversationStart": obj({"purpose": enum("INTAKE", "PLAN", "TENDER", "EVALUATION", "CONTRACT", "GENERAL"), "contextId": UUID}, ["purpose"]),
 "Conversation": obj({"id": UUID, "purpose": S, "contextId": UUID, "messages": arr(ref("ChatMessage")), "simulated": B}, ["id", "messages", "simulated"]),
 "ChatMessage": obj({"id": UUID, "role": enum("USER", "ASSISTANT", "SYSTEM"), "text": S, "createdAt": DT, "proposedChanges": arr(ref("FieldValue"))}, ["id", "role", "text"]),
 "ChatSend": obj({"text": {"type": "string", "minLength": 1, "maxLength": 4000}, "channel": enum("TEXT", "VOICE")}, ["text"]),
 "Plan": obj({"id": UUID, "requestId": UUID, "status": enum("DRAFT", "AWAITING_SIGNOFF", "AWAITING_APPROVAL", "APPROVED_LOCKED", "REOPENED", "REJECTED"),
   "fields": arr(ref("FieldValue")), "approvals": arr(ref("Approval")), "summary": S, "version": I}, ["id", "requestId", "status", "fields", "version"]),
 "FieldUpdate": obj({"value": S, "paragraph": {"type": "integer", "minimum": 1}, "expectedVersion": I}, ["value", "expectedVersion"]),
 "Instruction": obj({"text": {"type": "string", "minLength": 1, "maxLength": 2000}, "channel": enum("TEXT", "VOICE")}, ["text"]),
 "InstructionResult": obj({"applied": arr(ref("FieldValue")), "undoToken": S, "explanation": S, "fallbackHint": S}, ["applied", "explanation"]),
 "Approval": obj({"id": UUID, "subject": S, "userId": UUID, "role": S, "decision": enum("APPROVED", "REJECTED", "SUPERSEDED"), "comment": S, "decidedAt": DT, "stamp": S}, ["id", "decision", "decidedAt"]),
 "Decision": obj({"decision": enum("APPROVE", "REJECT"), "comment": {"type": "string", "maxLength": 2000}}, ["decision"]),
 "Reopen": obj({"reason": {"type": "string", "minLength": 10, "maxLength": 1000}}, ["reason"]),
 "CoiDeclaration": obj({"subjectOrg": S, "nature": {"type": "string", "minLength": 3, "maxLength": 2000}, "none": B}, ["none"]),
 "CoiRecord": obj({"id": UUID, "userId": UUID, "scope": enum("PLAN", "EVALUATION"), "scopeId": UUID, "none": B, "nature": S, "disposition": enum("PENDING", "IMMATERIAL", "MANAGEABLE", "MATERIAL"), "routedTo": UUID, "decidedAt": DT}, ["id", "userId", "scope", "disposition"]),
 "CoiDecision": obj({"disposition": enum("IMMATERIAL", "MANAGEABLE", "MATERIAL"), "rationale": S}, ["disposition"]),
 "Tender": obj({"id": UUID, "requestId": UUID, "type": enum("RFT", "RFP", "RFQ", "RFI", "EOI"), "access": enum("OPEN", "CLOSED"), "status": enum("DRAFT", "STAGED", "PUBLISHED", "CLOSED", "EVALUATING", "AWARDED"),
   "opensAt": DT, "closesAt": DT, "fields": arr(ref("FieldValue")), "publishPermission": ref("Approval"), "version": I}, ["id", "requestId", "type", "status"]),
 "TenderCreate": obj({"requestId": UUID, "type": enum("RFT", "RFP", "RFQ", "RFI", "EOI"), "access": enum("OPEN", "CLOSED"), "closesAt": DT}, ["requestId", "type"]),
 "Invitation": obj({"email": {"type": "string", "format": "email"}, "company": S}, ["email", "company"]),
 "Question": obj({"id": UUID, "tenderId": UUID, "text": S, "answer": S, "status": enum("OPEN", "ANSWERED", "PUBLISHED"), "askedAt": DT}, ["id", "text", "status"]),
 "QuestionCreate": obj({"text": {"type": "string", "minLength": 5, "maxLength": 2000}}, ["text"]),
 "Addendum": obj({"id": UUID, "number": I, "summary": S, "questionIds": arr(UUID), "newClosesAt": DT, "issuedAt": DT}, ["id", "number", "summary"]),
 "AddendumCreate": obj({"summary": {"type": "string", "minLength": 5}, "questionIds": arr(UUID), "newClosesAt": DT}, ["summary"]),
 "SupplierRegistration": obj({"inviteToken": S, "contactName": S, "email": {"type": "string", "format": "email"}, "company": S, "abn": {"type": "string", "pattern": "^\\d{11}$"}, "password": {"type": "string", "minLength": 12}}, ["inviteToken", "contactName", "email", "company", "abn", "password"]),
 "Supplier": obj({"id": UUID, "company": S, "abn": S, "sanctionsStatus": enum("PENDING", "CLEAR", "MATCH"), "insuranceStatus": enum("UNKNOWN", "CURRENT", "EXPIRING", "EXPIRED"), "lastCheckedAt": DT}, ["id", "company", "sanctionsStatus"]),
 "Submission": obj({"id": UUID, "tenderId": UUID, "supplierId": UUID, "status": enum("DRAFT", "SUBMITTED", "REJECTED_LATE"), "files": arr(ref("FileRef")), "receipt": S, "submittedAt": DT}, ["id", "tenderId", "status"]),
 "FileRef": obj({"id": UUID, "name": S, "sizeBytes": I, "contentType": S, "scan": enum("PENDING", "CLEAN", "INFECTED"), "section": enum("TECHNICAL", "COMMERCIAL", "OTHER")}, ["id", "name"]),
 "Evaluation": obj({"id": UUID, "tenderId": UUID, "status": enum("COI_PENDING", "SCORING", "CONSENSUS", "LOCKED", "REPORTED", "APPROVED"), "criteria": arr(ref("Criterion")), "suppliers": arr(ref("EvalSupplier")), "panel": arr(ref("PanelMember"))}, ["id", "tenderId", "status"]),
 "Criterion": obj({"id": UUID, "name": S, "weight": N, "stream": enum("TECHNICAL", "COMMERCIAL", "OTHER"), "passFail": B}, ["id", "name", "weight"]),
 "PanelMember": obj({"userId": UUID, "name": S, "stream": S, "coiState": enum("NOT_DECLARED", "DECLARED_NONE", "DECLARED_CONFLICT", "REMOVED")}, ["userId", "coiState"]),
 "EvalSupplier": obj({"supplierId": UUID, "displayName": S, "anonymised": B, "compliance": enum("PENDING", "PASS", "FAIL"), "rank": I, "weightedScore": N}, ["supplierId", "displayName"]),
 "ScoreSet": obj({"supplierId": UUID, "scores": arr(obj({"criterionId": UUID, "score": {"type": "number", "minimum": 0, "maximum": 10}, "comment": S}, ["criterionId", "score"]))}, ["supplierId", "scores"]),
 "ConsensusItem": obj({"supplierId": UUID, "criterionId": UUID, "individual": arr(obj({"evaluatorId": UUID, "score": N})), "variancePct": N, "flagged": B, "consensusScore": N, "rationale": S}, ["supplierId", "criterionId"]),
 "ConsensusUpdate": obj({"criterionId": UUID, "consensusScore": {"type": "number", "minimum": 0, "maximum": 10}, "rationale": S}, ["criterionId", "consensusScore"]),
 "Report": obj({"id": UUID, "evaluationId": UUID, "status": enum("DRAFT", "AWAITING_APPROVAL", "APPROVED"), "fields": arr(ref("FieldValue")), "generatedAt": DT, "approvals": arr(ref("Approval"))}, ["id", "evaluationId", "status"]),
 "Contract": obj({"id": UUID, "number": S, "tenderId": UUID, "supplierId": UUID, "templateId": S, "status": enum("DRAFT", "LEGAL_REVIEW", "AWAITING_SIGNATURE", "PARTIALLY_SIGNED", "EXECUTED"), "value": N, "startDate": {"type": "string", "format": "date"}, "endDate": {"type": "string", "format": "date"},
   "noticeDays": I, "clauses": arr(ref("Clause")), "signatures": arr(ref("Approval")), "parentId": UUID, "locked": B, "version": I}, ["id", "number", "status"]),
 "ContractCreate": obj({"evaluationId": UUID, "supplierId": UUID}, ["evaluationId", "supplierId"]),
 "Clause": obj({"id": S, "title": S, "text": S, "mandatory": B, "changedFromTemplate": B}, ["id", "title", "text"]),
 "Alert": obj({"id": UUID, "contractId": UUID, "kind": enum("EXPIRY", "NOTICE", "MILESTONE", "EXTENSION", "CUSTOM"), "triggerDate": {"type": "string", "format": "date"}, "recipientRule": S, "status": enum("SCHEDULED", "SENT", "CANCELLED"), "origin": enum("SYSTEM", "USER")}, ["id", "contractId", "kind", "triggerDate"]),
 "AlertCreate": obj({"instruction": {"type": "string", "minLength": 5, "maxLength": 500}}, ["instruction"]),
 "Kpis": obj({"activeProcurements": I, "valueInFlight": N, "avgCycleDays": N, "alertsDue": I, "pendingMyAction": I, "byPhase": arr(obj({"phase": S, "count": I})), "recent": arr(ref("RecentProcurement"))}, ["activeProcurements", "valueInFlight", "avgCycleDays"]),
 "RecentProcurement": obj({"id": UUID, "number": S, "title": S, "phase": S, "status": S, "estimatedValue": N, "updatedAt": DT}, ["id", "number", "title", "phase", "status"]),
 "ExpiringContract": obj({"contractId": UUID, "number": S, "supplier": S, "endDate": {"type": "string", "format": "date"}, "daysRemaining": I, "optionalExtensions": arr(obj({"months": I}))}, ["contractId", "number", "endDate", "daysRemaining"]),
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
ep("GET", "/requests", "listRequests", T, "List requests visible to caller (scope by role/hierarchy)", "*", None, "RequestList", query=["phase", "status", "q", "limit", "offset"])
ep("POST", "/requests", "createRequest", T, "Create blank request", ["REQUESTER", "PROCUREMENT"], "RequestPatch", "ProcurementRequest", 201)
ep("GET", "/requests/{id}", "getRequest", T, "Get request", "*", None, "ProcurementRequest")
ep("PATCH", "/requests/{id}", "updateRequest", T, "Update request fields", ["REQUESTER", "PROCUREMENT"], "RequestPatch", "ProcurementRequest")
ep("POST", "/requests/{id}/submit", "submitRequest", T, "Run budget check, complexity score and routing; submits", ["REQUESTER", "PROCUREMENT"], None, "ProcurementRequest", note="409 if mandatory fields missing; 422 if hard-cap budget exceeded")
Q = "Assistant"
ep("POST", "/assistant/conversations", "startConversation", Q, "Start mock-AI conversation (simulated=true)", "*", "ConversationStart", "Conversation", 201)
ep("GET", "/assistant/conversations/{id}", "getConversation", Q, "Get conversation", "*", None, "Conversation")
ep("POST", "/assistant/conversations/{id}/messages", "sendMessage", Q, "Send user text; returns assistant reply with proposed field changes", "*", "ChatSend", "ChatMessage", 201)
P = "Plans"
ep("GET", "/requests/{id}/plan", "getPlan", P, "Get (or lazily create from intake) the procurement plan", ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "PROBITY", "EXEC", "ADMIN"], None, "Plan")
ep("PUT", "/plans/{id}/fields/{key}", "updatePlanField", P, "Set a field (or one paragraph); optimistic concurrency via expectedVersion", ["PROCUREMENT", "REQUESTER"], "FieldUpdate", "Plan", note="409 on stale version; 423 if plan locked")
ep("POST", "/plans/{id}/instructions", "instructPlan", P, "Plain-language amend ('change paragraph 3 to …')", ["PROCUREMENT", "REQUESTER"], "Instruction", "InstructionResult")
ep("POST", "/plans/{id}/instructions/undo", "undoInstruction", P, "Undo last instruction by token", ["PROCUREMENT", "REQUESTER"], None, "Plan")
ep("POST", "/plans/{id}/submit-for-approval", "submitPlan", P, "Move to approval; requires COI declarations and risk gates", ["PROCUREMENT"], None, "Plan")
ep("POST", "/plans/{id}/decision", "decidePlan", P, "Delegate approves/rejects; delegation limit enforced; locks on approval", ["DELEGATE"], "Decision", "Plan", note="403 if value exceeds delegation; 409 if gates unmet")
ep("POST", "/plans/{id}/reopen", "reopenPlan", P, "Reopen locked plan with reason (Procurement only)", ["PROCUREMENT"], "Reopen", "Plan")
ep("POST", "/plans/{id}/coi", "declarePlanCoi", P, "Declare conflict (or none)", ["PROCUREMENT", "EVALUATOR", "CHAIR", "LEGAL", "DELEGATE"], "CoiDeclaration", "CoiRecord", 201)
ep("POST", "/coi/{id}/decision", "decideCoi", P, "Delegate/Risk decides disposition", ["DELEGATE", "PROBITY"], "CoiDecision", "CoiRecord")
D = "Tenders"
ep("GET", "/tenders", "listTenders", D, "List tenders visible to caller", ["PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "PROBITY", "EXEC", "ADMIN"], None, "Tender", arrayResp=True, query=["status"])
ep("POST", "/tenders", "createTender", D, "Create tender and generate pack from request/plan", ["PROCUREMENT"], "TenderCreate", "Tender", 201)
ep("GET", "/tenders/{id}", "getTender", D, "Get tender", ["PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "PROBITY", "EXEC", "ADMIN"], None, "Tender")
ep("PUT", "/tenders/{id}/fields/{key}", "updateTenderField", D, "Edit pack field", ["PROCUREMENT", "LEGAL"], "FieldUpdate", "Tender")
ep("POST", "/tenders/{id}/publish-permission", "grantPublishPermission", D, "ECV-appropriate delegate grants permission to publish", ["DELEGATE"], "Decision", "Tender")
ep("POST", "/tenders/{id}/publish", "publishTender", D, "Publish (needs permission, statutory window valid)", ["PROCUREMENT"], None, "Tender", note="409 without permission; 422 if statutory window not met")
ep("POST", "/tenders/{id}/invitations", "inviteSuppliers", D, "Invite suppliers by email", ["PROCUREMENT"], "Invitation", "Message", 202)
ep("GET", "/tenders/{id}/questions", "listQuestions", D, "Questions (identity never returned)", ["PROCUREMENT", "LEGAL", "SUPPLIER"], None, "Question", arrayResp=True)
ep("POST", "/tenders/{id}/addenda", "issueAddendum", D, "Publish answers/changes to all bidders", ["PROCUREMENT"], "AddendumCreate", "Addendum", 201)
SP = "SupplierPortal"
ep("POST", "/supplier/register", "registerSupplier", SP, "Self-register from invitation token", None, "SupplierRegistration", "Supplier", 201)
ep("GET", "/supplier/tenders", "listMyTenders", SP, "Tenders caller is invited to (max one active view)", ["SUPPLIER"], None, "Tender", arrayResp=True)
ep("POST", "/supplier/tenders/{id}/questions", "askQuestion", SP, "Ask anonymised question", ["SUPPLIER"], "QuestionCreate", "Question", 201)
ep("POST", "/supplier/tenders/{id}/submission/files", "uploadBidFile", SP, "Multipart upload (type/size allow-list, malware scan)", ["SUPPLIER"], None, "FileRef", 201, note="multipart/form-data; 415/413 on type/size; 423 after close")
ep("POST", "/supplier/tenders/{id}/submission", "submitBid", SP, "Submit; issues receipt; rejected if after close", ["SUPPLIER"], None, "Submission", 201, note="423 + REJECTED_LATE after closesAt")
ep("GET", "/suppliers/{id}", "getSupplier", SP, "Supplier profile with sanctions/insurance status", ["PROCUREMENT", "LEGAL", "FINANCE", "ADMIN"], None, "Supplier")
V = "Evaluation"
ER = ["PROCUREMENT", "EVALUATOR", "CHAIR", "DELEGATE", "PROBITY", "LEGAL"]
ep("POST", "/tenders/{id}/evaluation", "openEvaluation", V, "Create evaluation + one record per submitted bidder", ["PROCUREMENT"], None, "Evaluation", 201)
ep("GET", "/evaluations/{id}", "getEvaluation", V, "Get evaluation; suppliers anonymised until COI declared; stream-scoped payload", ER, None, "Evaluation")
ep("POST", "/evaluations/{id}/coi", "declareEvalCoi", V, "Mandatory COI before access; conflict revokes access", ["EVALUATOR", "CHAIR"], "CoiDeclaration", "CoiRecord", 201)
ep("GET", "/evaluations/{id}/scores/mine", "getMyScores", V, "Own scores only", ["EVALUATOR", "CHAIR"], None, "ScoreSet", arrayResp=True)
ep("PUT", "/evaluations/{id}/scores", "saveScores", V, "Save own scores (hidden from others)", ["EVALUATOR", "CHAIR"], "ScoreSet", "ScoreSet")
ep("POST", "/evaluations/{id}/consensus/open", "openConsensus", V, "Chair opens consensus (all scoring submitted)", ["CHAIR"], None, "ConsensusItem", arrayResp=True)
ep("PUT", "/evaluations/{id}/consensus/{supplierId}", "setConsensus", V, "Record consensus score + rationale", ["CHAIR"], "ConsensusUpdate", "ConsensusItem")
ep("POST", "/evaluations/{id}/consensus/lock", "lockConsensus", V, "Lock; fails if flagged items lack rationale", ["CHAIR"], None, "Evaluation", note="409 CONSENSUS_UNRESOLVED_FLAGS")
ep("POST", "/evaluations/{id}/report", "generateReport", V, "Generate evaluation report", ["PROCUREMENT"], None, "Report", 201)
ep("POST", "/evaluation-reports/{id}/decision", "decideReport", V, "Value-tier delegate signs off", ["DELEGATE"], "Decision", "Report")
C = "Contracts"
ep("POST", "/contracts", "draftContract", C, "Draft from approved report: template + clauses + supplier data", ["LEGAL", "PROCUREMENT"], "ContractCreate", "Contract", 201)
ep("GET", "/contracts", "listContracts", C, "Contracts visible to caller", ["PROCUREMENT", "LEGAL", "CONTRACT_MGR", "DELEGATE", "EXEC", "FINANCE", "PROBITY"], None, "Contract", arrayResp=True, query=["status", "q"])
ep("GET", "/contracts/{id}", "getContract", C, "Get contract", ["PROCUREMENT", "LEGAL", "CONTRACT_MGR", "DELEGATE", "EXEC", "FINANCE", "PROBITY"], None, "Contract")
ep("PUT", "/contracts/{id}/clauses/{clauseId}", "updateClause", C, "Edit clause (blocked when locked)", ["LEGAL"], "Clause", "Contract", note="423 when executed")
ep("POST", "/contracts/{id}/release-for-signing", "releaseForSigning", C, "Run configured review chain, then signing", ["LEGAL", "PROCUREMENT"], None, "Contract")
ep("POST", "/contracts/{id}/sign", "signContract", C, "Mock e-signature by signing delegate (authority checked separately)", ["DELEGATE"], "Decision", "Contract", note="403 SIGNING_AUTHORITY_INSUFFICIENT")
ep("GET", "/contracts/{id}/alerts", "listAlerts", C, "System + user alerts", ["CONTRACT_MGR", "PROCUREMENT", "LEGAL", "EXEC"], None, "Alert", arrayResp=True)
ep("POST", "/contracts/{id}/alerts", "createAlert", C, "Create alert from plain-language instruction", ["CONTRACT_MGR"], "AlertCreate", "Alert", 201)
G = "Reporting"
ep("GET", "/dashboard/kpis", "getKpis", G, "Role-scoped KPIs (staff only; requesters see their own requests)", [r for r in ROLES if r != "SUPPLIER"], None, "Kpis")
ep("GET", "/reports/expiring-contracts", "expiringContracts", G, "Contracts expiring within N days (default 90)", ["CONTRACT_MGR", "PROCUREMENT", "EXEC", "LEGAL"], None, "ExpiringContract", arrayResp=True, query=["days"])
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
