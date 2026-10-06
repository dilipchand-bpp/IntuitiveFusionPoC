# Operations and schemas added by the roadmap batches (B1..B6). Executed inside gen_openapi.py's namespace.
OBJ = {"type": "object", "additionalProperties": True}

# ---------------------------------------------------------------- B1: settings, notifications
schemas.update({
    "Settings": OBJ,
    "SettingsUpdate": OBJ,
    "PublicSettings": obj({"fieldLabels": OBJ, "customFields": arr(OBJ), "layout": S, "layouts": OBJ, "taxonomy": S}, ["fieldLabels", "customFields", "layout"]),
    "EscalationRun": obj({"escalated": I}, ["escalated"]),
    "NotificationLogEntry": obj({"id": UUID, "channel": S, "status": S, "detail": S, "title": S, "recipient": S, "createdAt": DT}, ["id", "channel", "status"]),
})
ST = "Settings"
ep("GET", "/admin/settings", "getSettings", ST, "All tenant settings: numbering, labels, custom fields, checkpoints, intake rules, notification rules, workflow routing", ["ADMIN"], None, "Settings")
ep("PUT", "/admin/settings", "updateSettings", ST, "Replace one or more settings sections; every change is audited with the old and new values", ["ADMIN"], "SettingsUpdate", "Settings")
ep("GET", "/settings", "getPublicSettings", ST, "The settings every screen needs: field labels, custom fields and the caller's layout", "*", None, "PublicSettings")
ep("POST", "/admin/notifications/run-escalations", "runEscalations", ST, "Escalate approvals that have waited longer than the configured period (also runs on a schedule)", ["ADMIN"], None, "EscalationRun")
ep("GET", "/admin/notification-log", "listNotificationLog", ST, "Recent notification deliveries by channel (simulated in the proof of concept)", ["ADMIN"], None, "NotificationLogEntry", arrayResp=True)
ep("POST", "/admin/erp-mapping/preview", "previewErpMapping", ST, "Try the ERP field-name mapping on a sample record, inbound or outbound", ["ADMIN"], "ErpPreview", "ErpPreview")

# ---------------------------------------------------------------- B1: intake extras
READ_REQ = ["REQUESTER", "PROCUREMENT", "DELEGATE", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "EXEC"]
EDIT_REQ = ["REQUESTER", "PROCUREMENT"]
schemas.update({
    "ErpPreview": OBJ,
    "TaxonomyConfirm": obj({"code": S, "confirm": B}, ["confirm"]),
    "TaxonomyResult": obj({"scheme": S, "code": S, "confirmed": B, "label": S}, ["scheme", "code", "confirmed"]),
    "SuggestedSupplier": OBJ,
    "SuppliersSelect": obj({"supplierIds": arr(UUID)}, ["supplierIds"]),
    "EcvInput": OBJ,
    "Ecv": OBJ,
    "Artefact": OBJ,
    "StageDelegate": OBJ,
    "Nominate": obj({"userId": UUID}, ["userId"]),
    "ProcessVariation": OBJ,
    "ProcessVariationRequest": OBJ,
    "Esg": OBJ,
})
RQ = "Requests"
ep("POST", "/requests/{id}/taxonomy", "confirmTaxonomy", RQ, "Confirm (or replace with your own) the preliminary classification code", EDIT_REQ, "TaxonomyConfirm", "TaxonomyResult")
ep("GET", "/requests/{id}/suggested-suppliers", "listSuggestedSuppliers", RQ, "Suppliers from the in-house directory that fit the request's category, with contacts", READ_REQ, None, "SuggestedSupplier", arrayResp=True)
ep("PUT", "/requests/{id}/suggested-suppliers", "amendSuggestedSuppliers", RQ, "Choose which of the suggested suppliers to keep", EDIT_REQ, "SuppliersSelect", "SuggestedSupplier", arrayResp=True)
ep("GET", "/requests/{id}/ecv", "getEcv", RQ, "Estimated contract value calculator: the saved inputs, or the request value as a start", READ_REQ, None, "Ecv")
ep("PUT", "/requests/{id}/ecv", "calculateEcv", RQ, "Calculate the estimated contract value; with apply=true it becomes the request value and drives routing", EDIT_REQ, "EcvInput", "Ecv")
ep("GET", "/requests/{id}/artefacts", "listArtefacts", RQ, "What the request has filled in downstream: plan, tender, scoring sheet, report, contract", READ_REQ, None, "Artefact", arrayResp=True)
ep("GET", "/requests/{id}/delegates", "listStageDelegates", RQ, "The delegate for each approval stage, by value, and who actually signed", READ_REQ, None, "StageDelegate", arrayResp=True)
ep("PUT", "/requests/{id}/delegates/{stage}", "redirectStageDelegate", RQ, "Procurement redirects a stage to another person who holds enough authority; history is not rewritten", ["PROCUREMENT"], "Nominate", "StageDelegate")
ep("GET", "/requests/{id}/process-variations", "listProcessVariations", RQ, "Changes to this procurement's workflow steps and their approval", READ_REQ, None, "ProcessVariation", arrayResp=True)
ep("POST", "/requests/{id}/process-variations", "requestProcessVariation", RQ, "Ask to add or remove a workflow step for this procurement only; a delegate must approve", EDIT_REQ, "ProcessVariationRequest", "ProcessVariation", 201)
ep("POST", "/requests/{id}/process-variations/{variationId}/decision", "decideProcessVariation", RQ, "A delegate approves or rejects a change to the process; the approval basis is recorded", ["DELEGATE", "EXEC"], "Decision", "ProcessVariation")
ep("GET", "/plans/{id}/esg", "getPlanEsg", "Plans", "ESG and social objectives set on the plan", ["REQUESTER", "PROCUREMENT", "DELEGATE", "LEGAL", "PROBITY", "EXEC"], None, "Esg")
ep("PUT", "/plans/{id}/esg", "setPlanEsg", "Plans", "Set carbon, local labour, diversity and socio-economic objectives; they carry into the tender pack", ["PROCUREMENT", "REQUESTER"], "Esg", "Esg", note="423 if the plan is locked")

# ---------------------------------------------------------------- B1: data migration
schemas.update({
    "MigrationUploadRequest": obj({"filename": S, "sourceSystem": S, "csv": S}, ["filename", "sourceSystem", "csv"]),
    "MigrationBatch": OBJ,
    "MigrationRecord": OBJ,
    "MigrationFix": obj({"fields": OBJ}, ["fields"]),
    "MigrationSkip": obj({"note": S}, ["note"]),
})
MG = "Migration"
MGR = ["ADMIN", "CONTRACT_MGR"]
ep("POST", "/migration/uploads", "uploadMigration", MG, "Upload a legacy contract extract (CSV text); it is profiled for missing fields, unparseable dates and values and duplicates", MGR, "MigrationUploadRequest", "MigrationBatch", 201)
ep("GET", "/migration/batches", "listMigrationBatches", MG, "Migration batches and their counts", MGR, None, "MigrationBatch", arrayResp=True)
ep("GET", "/migration/batches/{id}", "getMigrationBatch", MG, "One batch with every record, its issues and what the contract text yielded", MGR, None, "MigrationBatch")
ep("GET", "/migration/batches/{id}/exceptions.csv", "exportMigrationExceptions", MG, "The exceptions report as CSV (audited)", MGR, None, None)
ep("PUT", "/migration/records/{id}", "fixMigrationRecord", MG, "Correct a record; it is checked again", MGR, "MigrationFix", "MigrationRecord")
ep("POST", "/migration/records/{id}/skip", "skipMigrationRecord", MG, "Set a record aside with a reason", MGR, "MigrationSkip", "MigrationRecord")
ep("POST", "/migration/batches/{id}/cutover", "cutoverMigrationBatch", MG, "Load the batch; refused while any exception is unreviewed", ["ADMIN"], None, "MigrationBatch")

# ---------------------------------------------------------------- B1: identity
schemas.update({
    "MfaStatus": obj({"enrolled": B, "pending": B, "required": B, "method": S}, ["enrolled", "pending", "required"]),
    "MfaEnrol": obj({"secret": S, "otpauthUrl": S}, ["secret", "otpauthUrl"]),
    "MfaCode": obj({"code": S}, ["code"]),
    "MfaVerify": obj({"mfaToken": S, "code": S}, ["mfaToken", "code"]),
    "SsoConfig": obj({"available": B, "simulated": B, "issuer": S, "enforced": B}, ["available", "enforced"]),
    "SsoSimulate": obj({"email": S, "nonce": S}, ["email", "nonce"]),
    "SsoToken": obj({"idToken": S}, ["idToken"]),
    "SsoCallback": obj({"idToken": S, "nonce": S}, ["idToken", "nonce"]),
    "RoleExpiry": obj({"role": enum(*ROLES), "expiresAt": {"type": "string", "format": "date-time", "nullable": True}}, ["role", "expiresAt"]),
    "GrantSweep": obj({"ended": I}, ["ended"]),
    "ContactDeprovision": obj({"reason": S}, ["reason"]),
    "ContactReassign": OBJ,
    "ContactCreated": OBJ,
})
AU = "Auth"
ep("GET", "/auth/mfa", "getMfaStatus", AU, "Is an authenticator app set up for this account", "*", None, "MfaStatus")
ep("POST", "/auth/mfa/enroll", "enrollMfa", AU, "Start setting up an authenticator app; the secret is shown once", "*", None, "MfaEnrol")
ep("POST", "/auth/mfa/confirm", "confirmMfa", AU, "Finish set-up with a code from the app", "*", "MfaCode", "Message")
ep("DELETE", "/auth/mfa", "removeMfa", AU, "Remove the authenticator app (refused when the organisation requires it)", "*", "MfaCode", None, 204)
ep("POST", "/auth/mfa/verify", "verifyMfa", AU, "Complete a password sign-in with the one-time code", None, "MfaVerify", "Session")
ep("GET", "/auth/sso/config", "getSsoConfig", AU, "Whether single sign-on is available and whether it is the only way in", None, None, "SsoConfig")
ep("POST", "/auth/sso/simulate", "simulateSso", AU, "Simulated identity provider: issues an ID token for a demo person (not available in production)", None, "SsoSimulate", "SsoToken")
ep("POST", "/auth/sso/callback", "ssoCallback", AU, "Complete single sign-on from an ID token; checks signature, issuer, audience, expiry and nonce", None, "SsoCallback", "Session")
ep("PUT", "/admin/users/{id}/role-expiry", "setRoleExpiry", "Admin", "Make a role time-bound: access ends on the date (or clear the date)", ["ADMIN"], "RoleExpiry", "AdminUser")
ep("POST", "/admin/grants/sweep", "sweepGrants", "Admin", "Remove ended grants, end their sessions and tell the people involved (also runs on a schedule)", ["ADMIN"], None, "GrantSweep")
ep("POST", "/suppliers/{id}/contacts/{userId}/deprovision", "deprovisionContact", "Suppliers", "Switch a departed contact off: no sign-in, open links void, sessions ended", ["PROCUREMENT"], "ContactDeprovision", "SupplierContact")
ep("POST", "/suppliers/{id}/contacts/{userId}/reassign", "reassignContact", "Suppliers", "Replace a contact with someone else; the old access ends and the new person gets a one-time link", ["PROCUREMENT"], "ContactReassign", "ContactCreated", 201)

# ---------------------------------------------------------------- B2: tender and supplier portal
schemas.update({
    "LatePermissionCreate": obj({"supplierId": UUID, "reason": S, "hours": I}, ["supplierId", "reason"]),
    "LatePermission": OBJ,
    "TenderStage": OBJ,
    "ShortlistRequest": obj({"supplierIds": arr(UUID), "type": S, "note": S}, ["supplierIds"]),
    "ShortlistResult": obj({"nextTenderId": UUID, "nextStage": I, "shortlisted": I, "unsuccessfulNotified": I}, ["nextTenderId"]),
    "DeviationCreate": obj({"clauseRef": S, "proposal": S, "reason": S}, ["clauseRef", "proposal"]),
    "Deviation": OBJ,
    "DeviationRegister": obj({"sealed": B, "items": arr(OBJ)}, ["sealed", "items"]),
    "DeviationAssess": obj({"risk": enum("LOW", "MEDIUM", "HIGH"), "comment": S, "status": enum("PROPOSED", "ACCEPTABLE", "NEGOTIATE", "REJECTED")}),
    "PublicNotice": OBJ,
    "SanctionsReview": obj({"decision": enum("RELEASE", "CONFIRM"), "note": S}, ["decision", "note"]),
    "SupplierSelfProfile": OBJ,
    "PrivacyChoices": obj({"shareProfile": B, "productUpdates": B}, ["shareProfile", "productUpdates"]),
    "InsuranceRecord": obj({"insurer": S, "policyNumber": S, "coverAud": N, "expiresOn": S}, ["insurer", "policyNumber", "coverAud", "expiresOn"]),
    "OnboardingQuestion": obj({"id": S, "label": S, "type": enum("YESNO", "TEXT"), "mandatory": B}, ["id", "label", "type"]),
    "EmailLogEntry": OBJ,
})
TD = "Tenders"
STAFF_T = ["PROCUREMENT", "LEGAL", "DELEGATE", "EXEC", "PROBITY"]
ep("POST", "/tenders/{id}/late-permissions", "grantLatePermission", TD, "Let one supplier submit after the closing time, with a reason and a short expiry; audited and told by email", ["PROCUREMENT"], "LatePermissionCreate", "LatePermission", 201)
ep("GET", "/tenders/{id}/late-permissions", "listLatePermissions", TD, "Late-submission permissions granted on this tender", ["PROCUREMENT", "DELEGATE", "LEGAL", "PROBITY", "EXEC"], None, "LatePermission", arrayResp=True)
ep("DELETE", "/tenders/{id}/late-permissions/{permissionId}", "revokeLatePermission", TD, "Withdraw a late-submission permission", ["PROCUREMENT"], None, None, 204)
ep("GET", "/tenders/{id}/stages", "listTenderStages", TD, "The stages of this procurement and where each stands", STAFF_T, None, "TenderStage", arrayResp=True)
ep("POST", "/tenders/{id}/shortlist", "shortlistSuppliers", TD, "Shortlist suppliers after evaluation: creates the next stage's own pack, invites the shortlisted, tells the unsuccessful", ["PROCUREMENT"], "ShortlistRequest", "ShortlistResult", 201)
ep("GET", "/tenders/{id}/deviations", "getDeviationRegister", TD, "Contract changes suppliers proposed (sealed until the tender closes)", ["LEGAL", "PROCUREMENT"], None, "DeviationRegister")
ep("PUT", "/tender-deviations/{id}", "assessDeviation", TD, "Legal rates the risk, comments and sets the status of a proposed change", ["LEGAL"], "DeviationAssess", "Deviation")
ep("GET", "/tenders/{id}/deviations/export.xlsx", "exportDeviationsXlsx", TD, "The deviation register as an Excel workbook (audited)", ["LEGAL", "PROCUREMENT"], None, None)
ep("GET", "/tenders/{id}/deviations/export.docx", "exportDeviationsDocx", TD, "The deviation register as a Word document (audited)", ["LEGAL", "PROCUREMENT"], None, None)
ep("GET", "/tenders/{id}/notices", "listPublicNotices", TD, "Notices routed to public registers (simulated)", STAFF_T, None, "PublicNotice", arrayResp=True)
ep("POST", "/suppliers/{id}/sanctions-review", "reviewSanctionsMatch", "Suppliers", "Release or confirm a screening match; a held supplier cannot see tender documents until released", ["PROCUREMENT", "LEGAL"], "SanctionsReview", "SupplierSelfProfile")
ep("GET", "/admin/email-log", "listEmailLog", "Admin", "Email that would have been sent (simulated)", ["ADMIN", "PROCUREMENT"], None, "EmailLogEntry", arrayResp=True)
SU = "SupplierPortal"
ep("POST", "/supplier/tenders/{id}/deviations", "proposeDeviation", SU, "Propose a change to a contract clause as part of the response", ["SUPPLIER"], "DeviationCreate", "Deviation", 201)
ep("GET", "/supplier/tenders/{id}/deviations", "listMyDeviations", SU, "The changes this supplier proposed", ["SUPPLIER"], None, "Deviation", arrayResp=True)
ep("DELETE", "/supplier/tenders/{id}/deviations/{deviationId}", "withdrawDeviation", SU, "Withdraw a proposed change while the tender is open", ["SUPPLIER"], None, None, 204)
ep("GET", "/supplier/onboarding-questions", "listOnboardingQuestions", SU, "The organisation's own registration questions", None, None, "OnboardingQuestion", arrayResp=True)
ep("GET", "/supplier/profile", "getSupplierProfile", SU, "The supplier's own profile: screening and insurance status, privacy choices, contacts", ["SUPPLIER"], None, "SupplierSelfProfile")
ep("PUT", "/supplier/profile/privacy", "setSupplierPrivacy", SU, "Change the supplier's privacy choices", ["SUPPLIER"], "PrivacyChoices", "SupplierSelfProfile")
ep("PUT", "/supplier/profile/insurance", "setSupplierInsurance", SU, "Record the current insurance certificate", ["SUPPLIER"], "InsuranceRecord", "SupplierSelfProfile")
ep("POST", "/supplier/contacts", "addSupplierContact", SU, "Add a colleague; they receive a one-time link through the person who added them", ["SUPPLIER"], "SupplierContactAdd", "ContactCreated", 201)
ep("POST", "/supplier/contacts/{userId}/deprovision", "removeSupplierContact", SU, "End a colleague's access; sessions end and they are told", ["SUPPLIER"], "ContactDeprovision", "SupplierContact")
schemas.update({"SupplierContactAdd": obj({"name": S, "email": S}, ["name", "email"])})

# ---------------------------------------------------------------- B3: evaluation and report
schemas.update({
    "CriteriaLibrary": obj({"criteria": arr(OBJ)}, ["criteria"]),
    "CriteriaSet": obj({"criteria": arr(obj({"name": S, "stream": enum("TECHNICAL", "COMMERCIAL", "OTHER"), "weight": N, "passFail": B}, ["name", "stream", "weight", "passFail"]))}, ["criteria"]),
    "ComplianceWaive": obj({"note": S}, ["note"]),
    "ClarificationCreate": obj({"supplierId": UUID, "subject": S, "question": S, "dueInDays": I}, ["supplierId", "subject", "question"]),
    "Clarification": OBJ,
    "ClarificationResponse": obj({"response": S}, ["response"]),
    "BidPricing": obj({"basePrice": N, "implementation": N, "annualRunning": N, "years": I}, ["basePrice"]),
    "BidPricingView": OBJ,
    "BafoCreate": obj({"supplierIds": arr(UUID), "note": S, "closesInDays": I}, ["supplierIds", "note"]),
    "BafoOfferCreate": obj({"basePrice": N, "implementation": N, "annualRunning": N, "years": I, "note": S}, ["basePrice"]),
    "BafoView": OBJ,
    "NegotiationAdvice": OBJ,
    "PanelSubstitute": obj({"replacementUserId": UUID, "reason": enum("CONFLICT", "OTHER"), "note": S}, ["replacementUserId", "reason"]),
    "CoiRedeclare": obj({"none": B, "nature": S, "subjectOrg": S}, ["none"]),
    "CoiStatus": OBJ,
    "ReportCoi": OBJ,
    "ReportCoiDecision": obj({"disposition": enum("IMMATERIAL", "MANAGEABLE", "MATERIAL"), "rationale": S}, ["disposition"]),
    "ProbityAdvisorAllocate": obj({"userId": UUID}, ["userId"]),
    "ProbityAdvisors": OBJ,
    "ProbityPortal": OBJ,
    "ProbityHold": obj({"reason": S}, ["reason"]),
    "ProbityRelease": obj({"note": S}, ["note"]),
    "ProbityDocumentSave": obj({"title": S, "body": S}, ["title", "body"]),
    "ProbityDocumentUpload": obj({"title": S, "fileName": S, "contentBase64": S}, ["title", "fileName", "contentBase64"]),
    "ProbityDocument": OBJ,
    "ProbityDocuments": OBJ,
    "PlainScores": obj({"supplierId": UUID, "text": S, "apply": B}, ["supplierId", "text"]),
    "PlainScoresResult": OBJ,
    "RankingEntry": obj({"order": arr(UUID)}, ["order"]),
    "PlainRanking": obj({"text": S, "apply": B}, ["text"]),
    "PlainRankingResult": OBJ,
})
EV = "Evaluation"
SR = ["PROCUREMENT", "DELEGATE", "LEGAL", "PROBITY", "EXEC", "CHAIR"]
COIR = ["PROCUREMENT", "DELEGATE", "EXEC", "CHAIR", "PROBITY", "LEGAL"]
ep("GET", "/criteria-library", "getCriteriaLibrary", EV, "The pre-populated criteria library an evaluation's criteria are chosen from", ["PROCUREMENT", "ADMIN", "CHAIR", "DELEGATE", "PROBITY", "EXEC"], None, "CriteriaLibrary")
ep("PUT", "/evaluations/{id}/criteria", "setEvaluationCriteria", EV, "Set this evaluation's criteria before scoring opens (weights add to 100); each stage can differ", ["PROCUREMENT"], "CriteriaSet", "Evaluation", note="409 once scoring has opened; 400 unless weights add to 100")
ep("POST", "/evaluations/{id}/compliance/run", "runComplianceGate", EV, "Run the mandatory pass or fail checks again; each newly failing check sends the supplier a clarification request", ["PROCUREMENT"], None, "Evaluation")
ep("POST", "/evaluations/{id}/compliance/{supplierId}/{key}/waive", "waiveComplianceCheck", EV, "Waive a failed check with a recorded reason; probity is told", ["PROCUREMENT", "DELEGATE"], "ComplianceWaive", "Evaluation")
ep("POST", "/evaluations/{id}/clarifications", "requestClarification", EV, "Ask a bidder to clarify, with a response deadline; the supplier is told in the app and by email", ["PROCUREMENT"], "ClarificationCreate", "Clarification", 201)
ep("GET", "/evaluations/{id}/clarifications", "listClarifications", EV, "Clarification requests and answers for this evaluation", SR, None, "Clarification", arrayResp=True)
ep("POST", "/clarifications/{id}/close", "closeClarification", EV, "Close a clarification request", ["PROCUREMENT"], None, "Clarification")
ep("GET", "/evaluations/{id}/bafo", "listBafoRounds", EV, "Best and final offer rounds; offers stay sealed until a round closes and the original bids are untouched", SR, None, "BafoView")
ep("POST", "/evaluations/{id}/bafo", "openBafoRound", EV, "Open a controlled mini-tender for updated pricing from chosen suppliers", ["PROCUREMENT"], "BafoCreate", "BafoView", 201)
ep("POST", "/bafo-rounds/{id}/close", "closeBafoRound", EV, "Close a round (rounds also close at their time)", ["PROCUREMENT"], None, "BafoView")
ep("POST", "/bafo-offers/{id}/accept", "acceptBafoOffer", EV, "Accept an offer: its total cost replaces the supplier's original for ranking, and the draft report is rebuilt", ["PROCUREMENT"], None, "BafoView")
ep("GET", "/evaluations/{id}/negotiation-advice", "getNegotiationAdvice", EV, "Suggested discounts, clauses and insurance to negotiate, from pricing and terms against the other bids (simulated model)", ["PROCUREMENT", "DELEGATE", "EXEC"], None, "NegotiationAdvice")
ep("POST", "/evaluations/{id}/panel/{userId}/substitute", "substituteEvaluator", EV, "Replace an evaluator: their marks stay as read-only history, the replacement declares a conflict and starts with a clean scoring matrix", ["PROCUREMENT"], "PanelSubstitute", "Evaluation", 201)
ep("POST", "/evaluations/{id}/coi/redeclare", "redeclareEvalCoi", EV, "Confirm the conflict declaration again once supplier identities are visible; a conflict suspends the member", ["EVALUATOR", "CHAIR"], "CoiRedeclare", "CoiOutcome", 201)
ep("GET", "/evaluations/{id}/coi/status", "getCoiStatus", EV, "Who has declared, who has confirmed again, and who is outstanding", ["PROCUREMENT", "PROBITY", "CHAIR", "DELEGATE", "EXEC"], None, "CoiStatus")
ep("POST", "/evaluations/{id}/coi/remind", "remindCoi", EV, "Remind members who still owe a declaration (reminders also go out on a schedule)", ["PROCUREMENT", "CHAIR"], None, "CoiStatus")
ep("POST", "/evaluation-reports/{id}/coi", "declareReportCoi", EV, "Declare a conflict of interest at the report stage, as at the plan", COIR, "CoiRedeclare", "ReportCoi", 201)
ep("GET", "/evaluation-reports/{id}/coi", "listReportCoi", EV, "Conflict declarations made on the report", COIR, None, "ReportCoi")
ep("POST", "/evaluation-reports/{id}/coi/{coiId}/decision", "decideReportCoi", EV, "Decide a conflict declared on the report; a material conflict stops that person approving", ["DELEGATE", "EXEC", "PROBITY"], "ReportCoiDecision", "ReportCoi")
ep("POST", "/evaluations/{id}/scores/plain", "enterPlainScores", EV, "Scores and commentary in plain language: read back for confirmation, saved only when apply is true", ["EVALUATOR", "CHAIR"], "PlainScores", "PlainScoresResult")
ep("PUT", "/evaluations/{id}/ranking", "enterRanking", EV, "Ranking evaluations: order every supplier once, first to last", ["EVALUATOR", "CHAIR"], "RankingEntry", "RankingEntry")
ep("POST", "/evaluations/{id}/ranking/plain", "enterPlainRanking", EV, "Ranking in plain language, for example B first then A then C", ["EVALUATOR", "CHAIR"], "PlainRanking", "PlainRankingResult")
ep("GET", "/tenders/{id}/probity-advisors", "listProbityAdvisors", EV, "Probity advisors allocated to this procurement and those available", ["PROCUREMENT", "ADMIN", "PROBITY"], None, "ProbityAdvisors")
ep("POST", "/tenders/{id}/probity-advisors", "allocateProbityAdvisor", EV, "Allocate an external probity advisor to this procurement", ["PROCUREMENT", "ADMIN"], "ProbityAdvisorAllocate", "ProbityAdvisors", 201)
ep("DELETE", "/tenders/{id}/probity-advisors/{userId}", "deallocateProbityAdvisor", EV, "Remove an advisor's allocation", ["PROCUREMENT", "ADMIN"], None, None, 204)
ep("GET", "/probity/portal", "getProbityPortal", EV, "The advisor's read-only oversight portal: only the procurements they are allocated to", ["PROBITY"], None, "ProbityPortal")
ep("POST", "/evaluations/{id}/hold", "holdEvaluation", EV, "System hold: freeze the evaluation workspace on suspected bias or a process breach", ["PROBITY"], "ProbityHold", "Evaluation")
ep("POST", "/evaluations/{id}/release", "releaseEvaluation", EV, "Release a hold", ["PROBITY"], "ProbityRelease", "Evaluation")
ep("GET", "/evaluations/{id}/probity", "listProbityDocuments", EV, "The probity plan and probity outcomes report", SR, None, "ProbityDocuments")
ep("PUT", "/evaluations/{id}/probity/{kind}", "saveProbityDocument", EV, "Author the probity plan (PLAN) or outcomes report (OUTCOMES) in the platform; editing a signed document starts a new version", ["PROBITY"], "ProbityDocumentSave", "ProbityDocument")
ep("POST", "/evaluations/{id}/probity/{kind}/upload", "uploadProbityDocument", EV, "Upload the probity plan or outcomes report as a file (base64)", ["PROBITY"], "ProbityDocumentUpload", "ProbityDocument", 201)
ep("POST", "/evaluations/{id}/probity/{kind}/sign", "signProbityDocument", EV, "Sign off the current version with a profile stamp attributed to the advisor", ["PROBITY"], None, "ProbityDocument")
ep("GET", "/evaluations/{id}/probity/{kind}/pdf", "exportProbityPdf", EV, "The authored document as a PDF with the sign-off stamp (audited)", SR, None, None)
ep("GET", "/evaluations/{id}/probity/{kind}/docx", "exportProbityDocx", EV, "The authored document as a Word file with the sign-off stamp (audited)", SR, None, None)
ep("GET", "/evaluations/{id}/probity/{kind}/file", "downloadProbityFile", EV, "The uploaded file (audited)", SR, None, None)
ep("GET", "/supplier/clarifications", "listMyClarifications", SU, "Clarification and compliance requests addressed to this supplier", ["SUPPLIER"], None, "Clarification", arrayResp=True)
ep("POST", "/supplier/clarifications/{id}/response", "answerClarification", SU, "Answer a request before its deadline", ["SUPPLIER"], "ClarificationResponse", "Clarification")
ep("GET", "/supplier/tenders/{id}/pricing", "getMyPricing", SU, "The supplier's own bid pricing (total cost of ownership)", ["SUPPLIER"], None, "BidPricingView")
ep("PUT", "/supplier/tenders/{id}/pricing", "setMyPricing", SU, "Enter price, implementation and running costs so total cost of ownership can be compared", ["SUPPLIER"], "BidPricing", "BidPricingView")
ep("GET", "/supplier/bafo", "listMyBafoRounds", SU, "Best and final offer rounds the supplier is invited to, with their own offers", ["SUPPLIER"], None, "BafoView")
ep("PUT", "/supplier/bafo/{id}/offer", "submitBafoOffer", SU, "Submit a new offer revision while the round is open; the original bid is unchanged", ["SUPPLIER"], "BafoOfferCreate", "BafoView", 201)

# ---------------------------------------------------------------- B4: contract award and legal
schemas.update({
    "ContractChecks": OBJ,
    "CheckReview": obj({"note": S}, ["note"]),
    "BankDetails": obj({"bsb": S, "account": S, "accountName": S}, ["bsb", "account", "accountName"]),
    "BankDetailsView": OBJ,
    "Endorse": obj({"role": enum("LEGAL", "FINANCE"), "comment": S}),
    "SigningMode": obj({"signingMode": enum("STANDARD", "BLIND", "STAGED")}, ["signingMode"]),
    "SigningProgress": OBJ,
    "ContractQuestionCreate": obj({"question": S, "clauseId": S}, ["question"]),
    "ContractQuestions": OBJ,
    "ContractAnswer": obj({"answer": S}, ["answer"]),
    "RiskSummary": OBJ,
    "RiskSummaryEdit": obj({"text": S}, ["text"]),
    "DocumentCreate": obj({"docType": enum("NDA", "CONFIDENTIALITY", "MASTER"), "supplierId": UUID, "title": S, "text": S, "startDate": S, "endDate": S}, ["docType", "supplierId", "title", "text"]),
    "DraftUpload": obj({"fileName": S, "contentBase64": S, "note": S}, ["fileName", "contentBase64"]),
    "DraftFile": OBJ,
    "DraftList": OBJ,
    "CommentCreate": obj({"body": S, "clauseId": S}, ["body"]),
    "CommentList": OBJ,
    "KnowledgeCreate": obj({"kind": enum("POLICY", "ADVICE", "FALLBACK", "BOILERPLATE"), "title": S, "body": S, "clauseId": S, "tags": S}, ["kind", "title", "body"]),
    "KnowledgeList": OBJ,
    "DeviationExplanation": OBJ,
    "PlainRisk": obj({"text": S, "apply": B}, ["text"]),
    "PlainRiskResult": OBJ,
    "RiskAcceptance": obj({"statement": S}, ["statement"]),
    "NegotiationStrategy": OBJ,
    "Lineage": OBJ,
    "MatterCreate": obj({"title": S, "contractId": UUID, "priority": enum("LOW", "NORMAL", "HIGH"), "assigneeId": UUID, "dueOn": S}, ["title"]),
    "MatterPatch": OBJ,
    "MatterBoard": OBJ,
    "TimeEntry": obj({"hours": N, "workDate": S, "note": S}, ["hours", "workDate"]),
    "TimeEntries": OBJ,
    "GrantCreate": obj({"userId": UUID, "tenderId": UUID, "label": enum("COMMITTEE", "AUDITOR", "ADVISOR"), "expiresOn": S, "event": enum("CONTRACT_SIGNED", "REPORT_APPROVED"), "eventDays": I}, ["userId", "tenderId", "label"]),
    "GrantList": OBJ,
    "GrantRevoke": obj({"reason": S}, ["reason"]),
    "SharedProjects": OBJ,
    "SupplierContractList": OBJ,
    "SupplierContractView": OBJ,
})
CTX = "Contracts"
RD = ["PROCUREMENT", "LEGAL", "CONTRACT_MGR", "DELEGATE", "EXEC", "FINANCE", "PROBITY"]
LP = ["LEGAL", "PROCUREMENT"]
ep("GET", "/contracts/{id}/checks", "getContractChecks", CTX, "The tender cross-check, vendor pre-flight and counterparty re-check results, and whether negotiation has locked signing", RD, None, "ContractChecks")
ep("POST", "/contracts/{id}/checks/run", "runContractChecks", CTX, "Run the tender cross-check and the vendor pre-flight (legal name, tax, banking) now", LP, None, "ContractChecks")
ep("POST", "/contracts/{id}/checks/{kind}/{key}/review", "reviewContractCheck", CTX, "Review a failed or flagged check with a recorded reason so it no longer blocks", LP, "CheckReview", "Contract")
ep("POST", "/contracts/{id}/recheck", "recheckCounterparty", CTX, "Run sanctions and financial risk checks again; unlocks signing after a long negotiation when they pass", LP, None, "Contract")
ep("POST", "/contracts/{id}/endorse", "endorseContract", CTX, "Endorse before release (legal, finance) where the organisation requires it", ["LEGAL", "FINANCE"], "Endorse", "Contract")
ep("PUT", "/contracts/{id}/signing-mode", "setSigningMode", CTX, "STANDARD, BLIND (signatories see no one else's signature) or STAGED (signed in sequence), set before release", LP, "SigningMode", "Contract")
ep("GET", "/contracts/{id}/signing", "getSigningProgress", CTX, "Who was invited to sign, who has seen the contract, reminders sent, and who has signed", RD, None, "SigningProgress")
ep("POST", "/contracts/{id}/signing/remind", "remindSigners", CTX, "Remind the signatories who have not signed", LP, None, "SigningProgress")
ep("POST", "/contracts/{id}/questions", "askContractQuestion", CTX, "A signatory or reviewer raises a question before signing", ["DELEGATE", "EXEC", "LEGAL", "PROCUREMENT"], "ContractQuestionCreate", "ContractQuestions", 201)
ep("GET", "/contracts/{id}/questions", "listContractQuestions", CTX, "Questions raised about the contract, from the business and from the supplier, with answers", RD, None, "ContractQuestions")
ep("POST", "/contract-questions/{id}/answer", "answerContractQuestion", CTX, "Legal answers a question", ["LEGAL"], "ContractAnswer", "ContractQuestions")
ep("GET", "/contracts/{id}/risk-summary", "getContractRiskSummary", CTX, "An auto-populated summary of the risks in signing (simulated model); refresh=true regenerates it", ["DELEGATE", "EXEC", "LEGAL", "PROCUREMENT"], None, "RiskSummary")
ep("PUT", "/contracts/{id}/risk-summary", "editContractRiskSummary", CTX, "Legal edits the summary before it goes to the delegate", ["LEGAL"], "RiskSummaryEdit", "RiskSummary")
ep("POST", "/contracts/{id}/risk-summary/review", "reviewContractRiskSummary", CTX, "Legal confirms the summary after review", ["LEGAL"], None, "RiskSummary")
ep("POST", "/contracts/documents", "createSigningDocument", CTX, "Create an NDA, confidentiality agreement or master agreement signed the same way as a contract", LP, "DocumentCreate", "Contract", 201)
ep("GET", "/contracts/{id}/export.pdf", "exportContractPdf", CTX, "The current contract as a PDF with its version and any signatures (audited)", RD, None, None)
ep("GET", "/contracts/{id}/export.docx", "exportContractDocx", CTX, "The current contract as a Word document (audited)", RD, None, None)
ep("POST", "/contracts/{id}/drafts", "uploadAmendedDraft", CTX, "Upload an externally amended draft (kept as a numbered version with its hash)", ["LEGAL"], "DraftUpload", "DraftFile", 201)
ep("GET", "/contracts/{id}/drafts", "listAmendedDrafts", CTX, "Amended drafts uploaded for this contract", RD, None, "DraftList")
ep("GET", "/contracts/{id}/drafts/{fileId}", "downloadAmendedDraft", CTX, "Download an uploaded draft (audited)", RD, None, None)
ep("POST", "/contracts/{id}/comments", "commentOnContract", CTX, "Comment on the draft or one clause while it is being worked on", ["LEGAL", "PROCUREMENT", "CONTRACT_MGR", "FINANCE"], "CommentCreate", "CommentList", 201)
ep("GET", "/contracts/{id}/comments", "listContractComments", CTX, "Comments on the draft", RD, None, "CommentList")
ep("GET", "/contracts/{id}/lineage", "getContractLineage", CTX, "The parent contract and its variations, with cumulative value and the latest end date", RD, None, "Lineage")
ep("POST", "/contracts/{id}/deviations/{clauseId}/explain", "explainDeviation", CTX, "What a deviation means in plain language, with the corporate fallback where one is on file (simulated model)", ["LEGAL", "PROCUREMENT", "DELEGATE", "EXEC", "CONTRACT_MGR", "FINANCE"], None, "DeviationExplanation")
ep("POST", "/contracts/{id}/deviations/{clauseId}/risk/plain", "rateDeviationInWords", CTX, "Legal amends a deviation's risk rating in plain language; read back, saved only when apply is true", ["LEGAL"], "PlainRisk", "PlainRiskResult")
ep("POST", "/contracts/{id}/deviations/{clauseId}/accept-risk", "acceptDeviationRisk", CTX, "The business or a delegate formally accepts the identified risk, with a statement", ["DELEGATE", "EXEC", "CONTRACT_MGR"], "RiskAcceptance", "Contract")
ep("GET", "/contracts/{id}/negotiation-strategy", "getNegotiationStrategy", CTX, "A negotiation strategy: framing, techniques, a graduated set of positions and levers (simulated model)", ["LEGAL", "PROCUREMENT", "DELEGATE", "EXEC"], None, "NegotiationStrategy")
LG = "Legal"
ep("GET", "/legal-knowledge", "listLegalKnowledge", LG, "Policies, historical advice, corporate fallback positions and mandatory boilerplate the advisers draw on", LP, None, "KnowledgeList")
ep("POST", "/legal-knowledge", "addLegalKnowledge", LG, "Add a policy, advice, fallback position or boilerplate", ["LEGAL"], "KnowledgeCreate", "KnowledgeList", 201)
ep("DELETE", "/legal-knowledge/{id}", "removeLegalKnowledge", LG, "Remove an entry", ["LEGAL"], None, None, 204)
ep("GET", "/legal/matters", "listLegalMatters", LG, "The legal kanban board with review hours per matter", LP, None, "MatterBoard")
ep("POST", "/legal/matters", "createLegalMatter", LG, "Open a legal matter, optionally linked to a contract", ["LEGAL"], "MatterCreate", "MatterBoard", 201)
ep("PATCH", "/legal/matters/{id}", "updateLegalMatter", LG, "Move a matter between lanes or change its assignee, priority or due date", ["LEGAL"], "MatterPatch", "MatterBoard")
ep("POST", "/legal/matters/{id}/time", "logReviewHours", LG, "Log review hours against a matter", ["LEGAL"], "TimeEntry", "TimeEntries", 201)
ep("GET", "/legal/matters/{id}/time", "listReviewHours", LG, "Review hours logged against a matter", LP, None, "TimeEntries")
AG = "Access"
STAFF_ALL = ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "ADMIN", "EXEC"]
ep("POST", "/access-grants", "grantProjectAccess", AG, "Give a committee member, auditor or advisor access to one project's documents until a date or an event (for example 30 days after signature)", ["PROCUREMENT", "ADMIN"], "GrantCreate", "GrantList", 201)
ep("GET", "/access-grants", "listProjectAccess", AG, "Access grants with whether each is still live; an expired grant is revoked and audited when read", ["PROCUREMENT", "ADMIN", "PROBITY"], None, "GrantList")
ep("DELETE", "/access-grants/{id}", "revokeProjectAccess", AG, "End a grant now, with a reason", ["PROCUREMENT", "ADMIN"], "GrantRevoke", None, 204)
ep("GET", "/shared/projects", "listSharedProjects", AG, "The projects the caller has a grant for, and the documents each opens while it is live", STAFF_ALL, None, "SharedProjects")
ep("GET", "/shared/projects/{id}/contract.pdf", "downloadSharedContract", AG, "The project's contract as a PDF, while the caller's grant is live", STAFF_ALL, None, None)
ep("GET", "/shared/projects/{id}/report.pdf", "downloadSharedReport", AG, "The project's evaluation report as a PDF, while the caller's grant is live", STAFF_ALL, None, None)
ep("PUT", "/supplier/profile/bank", "setSupplierBank", SU, "Give banking details, checked against the legal name before signature", ["SUPPLIER"], "BankDetails", "BankDetailsView")
ep("GET", "/supplier/contracts", "listSupplierContracts", SU, "Contracts out for signature or signed, for this supplier to read", ["SUPPLIER"], None, "SupplierContractList")
ep("GET", "/supplier/contracts/{id}", "getSupplierContract", SU, "The full contract text, and the supplier's own questions with answers", ["SUPPLIER"], None, "SupplierContractView")
ep("POST", "/supplier/contracts/{id}/questions", "askSupplierContractQuestion", SU, "Raise a question before the contract is signed", ["SUPPLIER"], "ContractQuestionCreate", "ContractQuestions", 201)

ep("GET", "/access-grants/candidates", "listGrantCandidates", AG, "The staff and projects a grant can be made for", ["PROCUREMENT", "ADMIN"], None, "GrantList")

# ---------------------------------------------------------------- B5: contract management
NUM = {"type": "number"}
LINE = obj({"item": S, "qty": NUM, "unitPrice": NUM}, ["item", "qty", "unitPrice"])
schemas.update({
    "RateCard": obj({"rates": arr(obj({"item": S, "unit": S, "unitPrice": NUM}, ["item", "unitPrice"]))}, ["rates"]),
    "EscalationSet": obj({"escalations": arr(obj({"kind": enum("CPI", "SCHEDULED"), "effectiveOn": S, "pct": NUM, "capPct": NUM, "note": S}, ["kind", "effectiveOn", "pct"]))}, ["escalations"]),
    "RebateCreate": obj({"title": S, "threshold": NUM, "ratePct": NUM, "periodStart": S, "periodEnd": S}, ["title", "threshold", "ratePct", "periodStart", "periodEnd"]),
    "RebateClaim": obj({"amount": NUM, "claimedOn": S}, ["amount"]),
    "RebateView": OBJ,
    "CommercialView": OBJ,
    "PurchaseOrderCreate": obj({"description": S, "workOrderId": UUID, "lines": arr(LINE)}, ["description", "lines"]),
    "PurchaseOrder": OBJ,
    "InvoiceCreate": obj({"number": S, "invoiceDate": S, "poId": UUID, "workOrderId": UUID, "lines": arr(LINE)}, ["invoiceDate", "lines"]),
    "InvoiceResult": OBJ,
    "Invoice": OBJ,
    "InvoiceOverride": obj({"reason": S}, ["reason"]),
    "ContractSpend": OBJ,
    "AlertRules": OBJ,
    "AlertPreferences": obj({"muted": arr(enum("NOTICE", "EXPIRY", "MILESTONE", "EXTENSION", "CUSTOM", "CLAUSE", "COUNTDOWN", "INSURANCE"))}, ["muted"]),
    "AlertPreferenceView": OBJ,
    "AlertExtraction": OBJ,
    "AlertExtractApply": obj({"keys": arr(S)}, ["keys"]),
    "AlertExtractResult": OBJ,
    "ContractPlans": OBJ,
    "PlanGenerated": OBJ,
    "ActivityComplete": obj({"note": S}),
    "PlanTemplates": OBJ,
    "PlanTemplateUpload": obj({"name": S, "text": S, "sections": arr(obj({"title": S, "text": S}, ["title", "text"]))}, ["name"]),
    "WorkOrderCreate": obj({"title": S, "value": NUM, "startDate": S, "endDate": S}, ["title", "value", "startDate", "endDate"]),
    "WorkOrderPatch": obj({"status": enum("OPEN", "COMPLETE", "CANCELLED")}, ["status"]),
    "WorkOrder": OBJ,
    "WorkOrders": OBJ,
    "MasterAgreementReport": OBJ,
    "ProcurementLink": obj({"kind": enum("RENEW", "VARY", "EXTEND"), "note": S, "extensionPosition": I, "value": NUM}, ["kind", "note"]),
    "ProcurementLinked": OBJ,
    "ContractManagement": OBJ,
    "ContractSearch": OBJ,
    "DisclosureTask": OBJ,
    "DisclosureComplete": obj({"reference": S}, ["reference"]),
    "EnvelopeCreate": obj({"name": S, "amount": NUM, "nominees": arr(UUID), "warnPct": I}, ["name", "amount"]),
    "Envelope": OBJ,
    "EnvelopeCommit": obj({"description": S, "amount": NUM, "contractId": UUID}, ["description", "amount"]),
    "EnvelopeTopUp": obj({"amount": NUM}, ["amount"]),
    "EnvelopeCandidates": OBJ,
})
schemas["AlertCreate"]["properties"]["channels"] = arr(enum("IN_APP", "EMAIL", "SMS", "SLACK"))
schemas["AlertCreate"]["properties"]["ownerId"] = UUID
schemas["VariationCreate"]["properties"]["requestId"] = UUID
CM = "Contract management"
RD = ["PROCUREMENT", "LEGAL", "CONTRACT_MGR", "DELEGATE", "EXEC", "FINANCE", "PROBITY"]
RE = ["CONTRACT_MGR", "LEGAL", "PROCUREMENT"]
MONEY = ["FINANCE", "CONTRACT_MGR", "PROCUREMENT"]
FC = ["FINANCE", "CONTRACT_MGR"]
AU = ["CONTRACT_MGR", "PROCUREMENT", "LEGAL", "EXEC", "DELEGATE", "FINANCE"]
AM = ["CONTRACT_MGR", "PROCUREMENT", "LEGAL", "EXEC"]
EU = ["DELEGATE", "EXEC", "FINANCE", "PROCUREMENT", "CONTRACT_MGR", "REQUESTER", "LEGAL"]
ep("GET", "/contracts/{id}/commercial", "getContractCommercial", CM, "The rate card, price escalation clauses, rebates with their status, the insurance hold and what the caller may edit", RD, None, "CommercialView")
ep("PUT", "/contracts/{id}/rates", "setContractRates", CM, "Replace the contract rate card used by the three-way match", RE, "RateCard", "RateCard")
ep("PUT", "/contracts/{id}/escalations", "setContractEscalations", CM, "Replace the price-escalation clauses: scheduled steps, or an index movement up to a cap", RE, "EscalationSet", "EscalationSet", note="422 ESCALATION_BEFORE_START")
ep("POST", "/contracts/{id}/rebates", "addContractRebate", CM, "Record a rebate term: a rate on spend in a period once a threshold is reached", RE, "RebateCreate", "RebateView", 201)
ep("POST", "/contracts/{id}/rebates/{rebateId}/claim", "claimContractRebate", CM, "Record an amount claimed from the supplier against a rebate", FC, "RebateClaim", "RebateView")
ep("POST", "/contracts/{id}/rebates/{rebateId}/follow-up", "followUpContractRebate", CM, "Record a follow-up of a missed or under-claimed rebate", FC, None, "RebateView", note="409 NOT_FLAGGED")
ep("POST", "/contracts/{id}/purchase-orders", "createPurchaseOrder", CM, "Raise a purchase order (the simulated ERP feed). Blocked, and recorded, when it would take commitments above the contract limit; refused while an insurance hold is on", MONEY, "PurchaseOrderCreate", "PurchaseOrder", 201, note="422 SPEND_CEILING; 409 PURCHASE_ORDER_HELD")
ep("GET", "/contracts/{id}/purchase-orders", "listPurchaseOrders", CM, "Purchase orders against the contract, including any that were blocked", RD, None, "PurchaseOrder", arrayResp=True)
ep("POST", "/contracts/{id}/invoices", "recordInvoice", CM, "Record an invoice (the simulated ERP feed). It is matched to its purchase order and the rate card with the escalation formula; a price increase not allowed blocks it", FC, "InvoiceCreate", "InvoiceResult", 201)
ep("GET", "/contracts/{id}/invoices", "listContractInvoices", CM, "Invoices against the contract with their match findings", RD, None, "Invoice", arrayResp=True)
ep("GET", "/invoices", "listInvoices", CM, "Invoices across contracts; filter by status to see what is blocked", ["FINANCE", "CONTRACT_MGR", "PROCUREMENT", "EXEC"], None, "Invoice", arrayResp=True, query=["status"])
ep("POST", "/invoices/{id}/override", "overrideBlockedInvoice", CM, "Release a blocked invoice as a recorded exception, with a reason", ["FINANCE", "EXEC"], "InvoiceOverride", "Invoice")
ep("POST", "/invoices/{id}/pay", "payInvoice", CM, "Record payment of a matched or excepted invoice", ["FINANCE"], None, "Invoice", note="409 while the invoice is blocked")
ep("GET", "/contracts/{id}/spend", "getContractSpend", CM, "Live spend against the contract from invoice and payment data: progress of spend and term, and the notices raised", RD, None, "ContractSpend")
ep("GET", "/alerts/rules", "getFixedAlertRules", CM, "The alerts the platform fixes (expiry countdown, insurance lapse, spend ceiling) that no one can mute or change", AU, None, "AlertRules")
ep("GET", "/me/alert-preferences", "getAlertPreferences", CM, "The alert kinds the caller has muted, and the fixed ones that cannot be", AU, None, "AlertPreferenceView")
ep("PUT", "/me/alert-preferences", "setAlertPreferences", CM, "Mute alert kinds for the caller; the fixed kinds are refused", AU, "AlertPreferences", "AlertPreferenceView", note="422 ALERT_NOT_MUTABLE")
ep("POST", "/contracts/{id}/alerts/extract", "extractAlertTriggers", CM, "Propose alerts from notice periods, review cycles and anniversaries in the clause wording (rules-simulated model); nothing is scheduled", AM, None, "AlertExtraction")
ep("POST", "/contracts/{id}/alerts/extract/apply", "applyAlertTriggers", CM, "Schedule the proposed alerts the caller confirms", AM, "AlertExtractApply", "AlertExtractResult", 201, note="422 PROPOSAL_NOT_FOUND")
ep("GET", "/contracts/{id}/plans", "getContractPlans", CM, "The contract management plan and risk management plan, their tier and reasons, and the generated activities", RD, None, "ContractPlans")
ep("POST", "/contracts/{id}/plans/generate", "generateContractPlans", CM, "Generate (or regenerate) both plans and their activities from the contract's size, term and risk, using the customer's template where one is uploaded", RE, None, "PlanGenerated", 201)
ep("POST", "/contracts/{id}/activities/{activityId}/complete", "completeContractActivity", CM, "Mark a contract management activity done", RE, "ActivityComplete", "ContractPlans")
ep("GET", "/contract-plan-templates", "getPlanTemplates", CM, "The standard plan templates and any the customer uploaded", ["CONTRACT_MGR", "LEGAL", "ADMIN"], None, "PlanTemplates")
ep("PUT", "/contract-plan-templates/{kind}", "uploadPlanTemplate", CM, "Upload the customer's template for the management plan (CMP) or the risk plan (RMP), as headed text or sections", ["CONTRACT_MGR", "LEGAL", "ADMIN"], "PlanTemplateUpload", "PlanTemplates")
ep("DELETE", "/contract-plan-templates/{kind}", "removePlanTemplate", CM, "Go back to the standard template", ["CONTRACT_MGR", "LEGAL", "ADMIN"], None, "PlanTemplates")
ep("POST", "/contracts/{id}/work-orders", "createWorkOrder", CM, "Raise a work order under a master agreement, within its value and term", RE, "WorkOrderCreate", "WorkOrder", 201, note="422 WORK_ORDER_OVER_MASTER; 409 NOT_A_MASTER")
ep("GET", "/contracts/{id}/work-orders", "listWorkOrders", CM, "The master agreement's work orders with committed and invoiced amounts, and totals", RD, None, "WorkOrders")
ep("PATCH", "/work-orders/{id}", "updateWorkOrder", CM, "Complete or cancel a work order", RE, "WorkOrderPatch", "WorkOrder")
ep("GET", "/reports/master-agreements", "reportMasterAgreements", CM, "Master agreements and their work orders, reportable at both levels", RD, None, "MasterAgreementReport")
ep("POST", "/contracts/{id}/procurements", "linkProcurementToContract", CM, "Start a new procurement number linked to a contract to renew it, vary it or take up an extension; not a new tender", RE, "ProcurementLink", "ProcurementLinked", 201, note="422 NO_EXTENSION; 409 EXTENSION_EXERCISED")
ep("GET", "/contracts/{id}/management", "getContractManagement", CM, "Variation count, extensions exercised and remaining, cumulative value, historic versions, linked procurements and next-step suggestions", RD, None, "ContractManagement")
ep("GET", "/contracts/search", "searchMyContracts", CM, "Search the contracts that belong to the caller and their team, with a suggested next step near the end date", RD, None, "ContractSearch", query=["q", "status", "endingWithinDays"])
ep("GET", "/disclosure-tasks", "listDisclosureTasks", CM, "Public register disclosure tasks raised by contract changes over the statutory threshold", ["PROCUREMENT", "LEGAL", "CONTRACT_MGR", "EXEC"], None, "DisclosureTask", arrayResp=True)
ep("POST", "/disclosure-tasks/{id}/complete", "completeDisclosureTask", CM, "Record the register reference once the disclosure is made", ["PROCUREMENT", "LEGAL"], "DisclosureComplete", "DisclosureTask")
ep("GET", "/envelopes/candidates", "listEnvelopeCandidates", CM, "People who can be nominated to approve commitments from an envelope", ["DELEGATE", "EXEC"], None, "EnvelopeCandidates")
ep("GET", "/envelopes", "listFundingEnvelopes", CM, "Funding envelopes the caller holds, is nominated for, or oversees", EU, None, "Envelope", arrayResp=True)
ep("GET", "/envelopes/{id}", "getFundingEnvelope", CM, "One envelope with its commitments and what is left", EU, None, "Envelope")
ep("POST", "/envelopes", "createFundingEnvelope", CM, "A delegate approves an allocated funding envelope, within their delegated authority, and nominates who can commit against it", ["DELEGATE", "EXEC"], "EnvelopeCreate", "Envelope", 201, note="403 DELEGATION_EXCEEDED; 422 INVALID_NOMINEE")
ep("POST", "/envelopes/{id}/commitments", "commitFromEnvelope", CM, "A nominated person approves a commitment against the envelope; warns the holder as it nears exhaustion", EU, "EnvelopeCommit", "Envelope", 201, note="422 ENVELOPE_EXHAUSTED; 403 NOT_NOMINATED")
ep("POST", "/envelopes/{id}/top-up", "topUpFundingEnvelope", CM, "The holder or an executive adds to the envelope, within delegated authority", ["DELEGATE", "EXEC"], "EnvelopeTopUp", "Envelope", note="403 DELEGATION_EXCEEDED")

# ---------------------------------------------------------------- B6: reporting and collaboration
NUM6 = {"type": "number"}
schemas.update({
    "ScheduleView": OBJ,
    "ScheduleMove": obj({"phase": enum("INTAKE", "PLAN", "TENDER", "EVALUATION", "CONTRACT_AWARD"), "deltaDays": I}, ["phase", "deltaDays"]),
    "ScheduleMoved": OBJ,
    "DashboardList": OBJ,
    "Dashboard": OBJ,
    "PerformanceReport": OBJ,
    "SupplierRiskMap": OBJ,
    "SupplierLocation": obj({"city": S, "state": S, "country": S, "lat": NUM6, "lng": NUM6}, ["city", "state", "country", "lat", "lng"]),
    "ManagerAssign": obj({"managerId": UUID}, ["managerId"]),
    "ManagerAssigned": OBJ,
    "CapacityReport": OBJ,
    "SpendByReport": OBJ,
    "DrillReport": OBJ,
    "ReportView": OBJ,
    "ReportViewCreate": obj({"name": S, "report": enum("procurements", "spend-by", "ask", "schedule", "workload"), "filters": {"type": "object", "additionalProperties": True}, "shared": B}, ["name", "report"]),
    "AskQuestion": obj({"question": S}, ["question"]),
    "AskAnswer": OBJ,
    "LayoutView": OBJ,
    "LayoutSave": obj({"name": S, "sections": arr(obj({"key": S, "enabled": B}, ["key", "enabled"]))}, ["name", "sections"]),
    "PresenceBeat": obj({"fieldKey": S}),
    "Presence": OBJ,
    "DocumentChanges": OBJ,
    "ChangeDigest": OBJ,
    "VersionSave": obj({"label": S}, ["label"]),
    "DocumentVersion": OBJ,
    "DocumentVersions": OBJ,
    "VersionCompare": OBJ,
    "RiskAssessment": OBJ,
    "RiskItemPatch": obj({"applicable": B, "likelihood": I, "impact": I, "mitigation": S}),
    "ResponseSummaries": OBJ,
    "ReferenceContent": OBJ,
    "ReferenceRefreshed": OBJ,
    "PlainInstruction": obj({"instruction": S}, ["instruction"]),
    "AdvanceResult": OBJ,
    "PhaseSync": OBJ,
    "PhaseSyncAll": OBJ,
    "TemplateChanged": OBJ,
    "CommitteeInstruction": obj({"instruction": S, "userId": UUID, "stream": enum("TECHNICAL", "COMMERCIAL", "OTHER")}, ["instruction"]),
    "CommitteeResult": OBJ,
})
schemas["FieldUpdate"] = obj({"value": S, "paragraph": {"type": "integer", "minimum": 1}, "expectedVersion": I, "expectedRev": I}, ["value"])
schemas["TenderFieldUpdate"] = obj({"value": {"type": "string", "maxLength": 10000}, "expectedVersion": I, "expectedRev": I}, ["value"])
RP = "Reporting"
CB = "Collaboration"
REP_USERS = ["EXEC", "FINANCE", "PROCUREMENT", "CONTRACT_MGR", "DELEGATE", "LEGAL", "PROBITY"]
DASH_USERS = ["PROCUREMENT", "LEGAL", "DELEGATE", "EXEC", "FINANCE", "PROBITY", "CONTRACT_MGR", "ADMIN"]
DOCR = ["REQUESTER", "PROCUREMENT", "DELEGATE", "LEGAL", "EXEC", "PROBITY", "FINANCE", "CONTRACT_MGR"]
ep("GET", "/reports/schedule", "getProcurementSchedule", RP, "A Gantt-style view of phase and status across every active procurement, with the delegate calendar worked out from it", ["PROCUREMENT", "EXEC", "DELEGATE"], None, "ScheduleView")
ep("POST", "/reports/schedule/{requestId}/move", "moveSchedulePhase", RP, "Drag a phase earlier or later; every phase after it moves by the same, and the delegate calendar is recalculated and the delegates told", ["PROCUREMENT"], "ScheduleMove", "ScheduleMoved", note="422 SCHEDULE_CONFLICT")
ep("GET", "/dashboards", "listDashboards", RP, "The dashboard views open to the caller by role, and the scope the organisation hierarchy gives them", DASH_USERS, None, "DashboardList")
ep("GET", "/dashboards/{view}", "getDashboard", RP, "One dashboard (procurement, legal, delegate, executive, finance, risk, division) scoped by the organisational hierarchy unless the organisation chose broader visibility", DASH_USERS, None, "Dashboard")
ep("GET", "/reports/performance", "getPerformanceReport", RP, "Category spend, maverick spend (invoices released outside the contract match and purchases with no contract), captured savings and procurement velocity with the bottleneck phase", ["EXEC", "FINANCE", "PROCUREMENT"], None, "PerformanceReport")
ep("GET", "/reports/supplier-risk", "getSupplierRiskMap", RP, "Supplier locations with simulated weather, financial-distress and geopolitical signals, and the single points of failure", ["PROCUREMENT", "EXEC", "FINANCE", "PROBITY"], None, "SupplierRiskMap")
ep("PUT", "/suppliers/{id}/location", "setSupplierLocation", RP, "Record where a supplier operates from, for the risk map", ["PROCUREMENT", "ADMIN"], "SupplierLocation", "SupplierLocation")
ep("PUT", "/requests/{id}/manager", "assignProcurementManager", RP, "Assign a procurement to a manager in the procurement team", ["PROCUREMENT", "EXEC"], "ManagerAssign", "ManagerAssigned", note="422 NOT_A_MANAGER")
ep("GET", "/reports/capacity", "getCapacityReport", RP, "Active procurements and dollar exposure by assigned manager against capacity, with a rebalancing suggestion", ["PROCUREMENT", "EXEC"], None, "CapacityReport")
ep("GET", "/reports/spend-by", "getSpendBy", RP, "Committed and invoiced spend by supplier, contract, master agreement, project, business unit or division", ["EXEC", "FINANCE", "PROCUREMENT"], None, "SpendByReport", query=["dimension"])
ep("GET", "/reports/drill", "drillReport", RP, "The procurements behind a figure: by phase, category, manager, business unit or status", REP_USERS, None, "DrillReport", query=["by", "key"])
ep("GET", "/report-views", "listReportViews", RP, "The caller's saved views and those shared by others", REP_USERS, None, "ReportView", arrayResp=True)
ep("POST", "/report-views", "saveReportView", RP, "Save a custom view of a report, for the caller or shared", REP_USERS, "ReportViewCreate", "ReportView", 201)
ep("DELETE", "/report-views/{id}", "deleteReportView", RP, "Delete one of the caller's saved views", REP_USERS, None, None, 204)
ep("POST", "/reports/ask", "askReport", RP, "Ask for a report in plain language, such as: all procurement risks in 2026 (rules-simulated interpretation, shown back)", REP_USERS, "AskQuestion", "AskAnswer", note="422 QUESTION_NOT_UNDERSTOOD")
ep("GET", "/layouts", "listLayouts", CB, "The layout of the plan, the tender pack and the evaluation report: the organisation's own, or the system default", ["ADMIN", "PROCUREMENT", "LEGAL", "DELEGATE", "EXEC"], None, "LayoutView", arrayResp=True)
ep("PUT", "/layouts/{kind}", "saveLayout", CB, "Design a layout by ordering sections and switching optional ones off; mandatory sections cannot be left out", ["ADMIN", "PROCUREMENT"], "LayoutSave", "LayoutView", note="422 LAYOUT_INVALID")
ep("DELETE", "/layouts/{kind}", "resetLayout", CB, "Go back to the system default layout", ["ADMIN", "PROCUREMENT"], None, "LayoutView")
ep("POST", "/documents/{type}/{id}/presence", "documentPresence", CB, "Say you are working on a document (and which section); returns who else is", DOCR, "PresenceBeat", "Presence")
ep("GET", "/documents/{type}/{id}/presence", "getDocumentPresence", CB, "Who else has been in the document in the last minute, and where", DOCR, None, "Presence")
ep("GET", "/documents/{type}/{id}/changes", "getDocumentChanges", CB, "Tracked changes: every change to a section, who made it and when, with a word-by-word comparison", DOCR, None, "DocumentChanges", query=["since"])
ep("GET", "/documents/{type}/{id}/summary", "summariseDocumentChanges", CB, "A digest of what changed since the caller last looked (rules-simulated); markSeen=true records the look", DOCR, None, "ChangeDigest", query=["markSeen"])
ep("POST", "/documents/{type}/{id}/versions", "saveDocumentVersion", CB, "Keep a named version of the document as it stands", DOCR, "VersionSave", "DocumentVersion", 201)
ep("GET", "/documents/{type}/{id}/versions", "listDocumentVersions", CB, "The saved versions of a document", DOCR, None, "DocumentVersions")
ep("GET", "/documents/{type}/{id}/versions/{number}", "getDocumentVersion", CB, "One saved version, section by section", DOCR, None, "DocumentVersion")
ep("GET", "/documents/{type}/{id}/compare", "compareDocumentVersions", CB, "Compare two saved versions, or a version with the current text, highlighting what changed", DOCR, None, "VersionCompare", query=["from", "to"])
ep("POST", "/requests/{id}/risk-assessment/generate", "generateRiskAssessment", CB, "Draft a risk assessment for the procurement: candidate risks to mark applicable or not (rules-simulated)", ["REQUESTER", "PROCUREMENT"], None, "RiskAssessment", 201, note="409 ASSESSMENT_EXISTS")
ep("GET", "/requests/{id}/risk-assessment", "getRiskAssessment", CB, "The risk assessment, with what still needs a decision, a rating or a treatment", ["REQUESTER", "PROCUREMENT", "DELEGATE", "EXEC", "PROBITY", "LEGAL"], None, "RiskAssessment")
ep("PATCH", "/requests/{id}/risk-assessment/items/{key}", "updateRiskItem", CB, "Mark a risk applicable or not, rate its likelihood and impact, and choose or write a treatment", ["REQUESTER", "PROCUREMENT"], "RiskItemPatch", "RiskAssessment")
ep("POST", "/requests/{id}/risk-assessment/complete", "completeRiskAssessment", CB, "Complete the assessment once every risk has a decision, a rating where it applies, and a treatment for the medium and high ones", ["REQUESTER", "PROCUREMENT"], None, "RiskAssessment", note="422 ASSESSMENT_INCOMPLETE")
ep("GET", "/tenders/{id}/response-summaries", "summariseResponses", CB, "A summary of each supplier response after close: pricing, dates, changes proposed to the tender, pros and cons (rules-simulated); anonymous for panel members", ["PROCUREMENT", "LEGAL", "CHAIR", "EVALUATOR"], None, "ResponseSummaries", note="409 TENDER_SEALED")
ep("GET", "/reference-content", "listReferenceContent", CB, "The in-house corpus of best-practice content (for example role descriptions); renewed by itself when older than the refresh period", ["ADMIN", "PROCUREMENT", "LEGAL", "REQUESTER"], None, "ReferenceContent", query=["kind", "category", "level"])
ep("POST", "/reference-content/refresh", "refreshReferenceContent", CB, "Regenerate the corpus now as a new generation, entirely inside the platform", ["ADMIN", "PROCUREMENT"], None, "ReferenceRefreshed", 201)
ep("POST", "/requests/{id}/advance", "advanceProcurement", CB, "Move a procurement to a later phase from a plain-language instruction, only if the phases before it are finished", ["PROCUREMENT", "EXEC", "REQUESTER"], "PlainInstruction", "AdvanceResult", note="409 PHASE_NOT_COMPLETE")
ep("POST", "/requests/{id}/phase/sync", "syncProcurementPhase", CB, "Detect that a phase is complete from the records and move the tracker on", ["PROCUREMENT", "EXEC", "REQUESTER"], None, "PhaseSync")
ep("POST", "/requests/phase-sync", "syncAllProcurementPhases", CB, "Catch every procurement's tracker up with its records", ["PROCUREMENT", "EXEC"], None, "PhaseSyncAll")
ep("POST", "/tenders/{id}/template-change", "changeTenderTemplate", CB, "Change a staged tender to another template in plain language and fill it in again, keeping sections a person wrote", ["PROCUREMENT"], "PlainInstruction", "TemplateChanged")
ep("POST", "/evaluations/{id}/committee/instruct", "instructCommittee", CB, "Add or remove an evaluation committee member from an instruction or a name, with a picker where several people match", ["PROCUREMENT"], "CommitteeInstruction", "CommitteeResult", note="status AMBIGUOUS lists candidates; 409 HAS_SCORES")

# ---------------------------------------------------------------- X01: conversational assistant
schemas.update({
    "AssistantMessage": obj({"message": S, "page": S}, ["message"]),
    "AssistantReply": OBJ,
})
ep("POST", "/assistant/chat", "assistantChat", "Assistant", "Ask the assistant about the workflow, roles and approvals, what needs attention or what to fix, or give a simple instruction (rules-simulated)", STAFF_ALL + ["SUPPLIER"], "AssistantMessage", "AssistantReply")

# ---------------------------------------------------------------- B8: tender, contract and supplier intelligence
NUM8 = {"type": "number"}
_ITEM = obj({"key": S, "label": S, "section": enum("TECHNICAL", "COMMERCIAL"), "kind": enum("TEXT", "NUMBER", "CHOICE", "YESNO", "DATE"), "required": B, "options": arr(S), "unit": S, "maxLength": I}, ["key", "label", "section", "kind"])
schemas.update({
    "ResponseScheduleSave": obj({"items": arr(_ITEM)}, ["items"]),
    "ResponseSchedule": OBJ,
    "TenderRequirements": obj({"requiredCover": NUM8, "dualWitness": B}),
    "TenderRequirementsResult": OBJ,
    "ResponseAnswersView": OBJ,
    "OpeningState": OBJ,
    "WitnessRequest": obj({"password": S}, ["password"]),
    "WitnessResult": OBJ,
    "SupplierResponseView": OBJ,
    "SupplierResponseSave": obj({"answers": {"type": "object", "additionalProperties": S}}, ["answers"]),
    "SupplierResponseSaved": OBJ,
    "InsuranceCertificate": obj({"name": S, "dataBase64": S}, ["name", "dataBase64"]),
    "InsuranceCertificateResult": OBJ,
    "RatingCreate": obj({"contractId": UUID, "scores": {"type": "object", "additionalProperties": I}, "comment": S}, ["contractId", "scores"]),
    "RatingResult": OBJ,
    "SupplierRatings": OBJ,
    "SupplierRatingsOwn": OBJ,
    "DuplicateList": OBJ,
    "DuplicateDismiss": obj({"supplierA": UUID, "supplierB": UUID, "reason": S}, ["supplierA", "supplierB", "reason"]),
    "SupplierRisk": OBJ,
    "SupplierScores": OBJ,
    "DiversityReport": OBJ,
    "EsgUpdate": obj({"carbonTonnesCo2e": NUM8, "renewablePct": NUM8, "diversityOwned": enum("NONE", "INDIGENOUS", "WOMEN", "DISABILITY", "SOCIAL_ENTERPRISE"), "modernSlaveryStatement": B}),
    "EsgView": OBJ,
    "ModernSlaveryResult": OBJ,
    "LessonCreate": obj({"kind": enum("WENT_WELL", "TO_IMPROVE", "RISK", "TIP"), "text": S}, ["kind", "text"]),
    "Lesson": OBJ,
    "LessonRecall": OBJ,
    "RequestClose": obj({"outcome": enum("COMPLETED", "CANCELLED"), "reason": S, "skipLessonsReason": S}, ["outcome"]),
    "RequestClosed": OBJ,
    "LegalEdit": obj({"instruction": S, "apply": B}, ["instruction"]),
    "LegalEditResult": OBJ,
    "RedlineList": OBJ,
    "RedlineDecision": obj({"decision": enum("ACCEPT", "REJECT")}, ["decision"]),
    "RedlineDecided": OBJ,
    "CounselLinkCreate": obj({"name": S, "email": S, "party": enum("EXTERNAL_COUNSEL", "SUPPLIER")}, ["name", "email", "party"]),
    "CounselLink": OBJ,
    "CounselPage": OBJ,
    "CounselRedline": obj({"clauseId": S, "text": S}, ["clauseId", "text"]),
    "IntegrationEvents": OBJ,
    "IntegrationRetry": OBJ,
    "LegalWebhook": obj({"eventId": S, "matterRef": S, "stage": S, "redlines": arr(obj({"clauseId": S, "text": S, "author": S}, ["clauseId", "text"]))}, ["eventId", "matterRef", "stage"]),
    "LegalWebhookResult": OBJ,
    "DeletedContracts": OBJ,
    "ContractRestore": obj({"reason": S}, ["reason"]),
    "ContractRestored": OBJ,
    "ApprovalLinkView": OBJ,
    "ApprovalLinkDecision": obj({"decision": enum("APPROVE", "REJECT"), "comment": S, "code": S}, ["decision"]),
    "ApprovalLinkDecided": OBJ,
})
TD = "Tenders"; SP8 = "SupplierPortal"; SD = "Suppliers"; LS = "Lessons"; CN = "Contracts"; IN = "Integrations"; AL = "ApprovalLinks"
TREAD = ["PROCUREMENT", "LEGAL", "DELEGATE", "EXEC", "PROBITY", "EVALUATOR", "CHAIR"]
WIT = ["PROBITY", "LEGAL", "DELEGATE", "EXEC", "PROCUREMENT"]
ep("GET", "/tenders/{id}/response-schedule", "getResponseSchedule", TD, "The structured response schedule: the questions a supplier answers instead of attaching documents", TREAD, None, "ResponseSchedule")
ep("PUT", "/tenders/{id}/response-schedule", "setResponseSchedule", TD, "Define the response schedule (staged tender only)", ["PROCUREMENT"], "ResponseScheduleSave", "ResponseSchedule", note="409 once published; 422 duplicate key or a choice with under two options")
ep("PUT", "/tenders/{id}/requirements", "setTenderRequirements", TD, "Set the insurance cover a bid must hold and whether opening needs two witnesses (staged tender only)", ["PROCUREMENT"], "TenderRequirements", "TenderRequirementsResult")
ep("GET", "/tenders/{id}/response-answers", "getResponseAnswers", TD, "Every submitted answer side by side, after the tender closes (and opens, for a dual-witness tender)", TREAD, None, "ResponseAnswersView", note="409 TENDER_SEALED before close; 409 BIDS_SEALED before witnesses open it")
ep("GET", "/tenders/{id}/opening", "getOpening", TD, "Where the dual-witness opening stands: who has witnessed and until when", WIT, None, "OpeningState")
ep("POST", "/tenders/{id}/opening/witness", "witnessOpening", TD, "Confirm, by password, that you witness the opening; the second different person within the window opens the bids", WIT, "WitnessRequest", "WitnessResult", note="401 password not confirmed; 403 not independent; 409 already witnessed, already opened or not required")
ep("GET", "/supplier/tenders/{id}/response", "getSupplierResponse", SP8, "The response schedule with the supplier's answers, what is missing and whether their cover meets the tender", ["SUPPLIER"], None, "SupplierResponseView")
ep("PUT", "/supplier/tenders/{id}/response", "saveSupplierResponse", SP8, "Save answers to the response schedule; each is checked against its question", ["SUPPLIER"], "SupplierResponseSave", "SupplierResponseSaved", note="422 with a message per answer; 409 once submitted or closed")
ep("PUT", "/supplier/profile/insurance-certificate", "uploadInsuranceCertificate", SP8, "Upload an insurance certificate; the limit and expiry are read from it (rules-simulated reading)", ["SUPPLIER"], "InsuranceCertificate", "InsuranceCertificateResult", note="422 for a rejected or infected file; readable=false asks for the details by hand")
ep("GET", "/supplier/profile/esg", "getSupplierEsg", SP8, "ESG data the supplier has declared", ["SUPPLIER"], None, "EsgView")
ep("PUT", "/supplier/profile/esg", "updateSupplierEsg", SP8, "Declare carbon data, renewable share, diversity ownership and a modern slavery statement", ["SUPPLIER"], "EsgUpdate", "EsgView")
ep("GET", "/supplier/ratings", "getSupplierRatings", SP8, "Contracts the supplier can rate, and ratings received if the organisation shows them", ["SUPPLIER"], None, "SupplierRatingsOwn")
ep("POST", "/supplier/ratings", "rateEnterprise", SP8, "The supplier rates the enterprise on a signed contract", ["SUPPLIER"], "RatingCreate", "RatingResult", 201, note="409 already rated; 422 wrong dimensions")
ep("POST", "/suppliers/{id}/ratings", "rateSupplier", SD, "The enterprise rates a supplier on a signed contract", ["CONTRACT_MGR", "PROCUREMENT", "EXEC"], "RatingCreate", "RatingResult", 201, note="409 already rated or contract not signed; 422 wrong dimensions")
ep("GET", "/suppliers/{id}/ratings", "getSupplierRatingsStaff", SD, "Ratings of a supplier; what suppliers said is shown only if the organisation allows it", ["PROCUREMENT", "LEGAL", "FINANCE", "EXEC", "ADMIN", "CONTRACT_MGR"], None, "SupplierRatings")
ep("GET", "/suppliers/duplicates", "listDuplicateSuppliers", SD, "Pairs of suppliers that look like the same business (same ABN or bank account, similar name)", ["PROCUREMENT", "LEGAL", "FINANCE", "EXEC", "ADMIN"], None, "DuplicateList")
ep("POST", "/suppliers/duplicates/dismiss", "dismissDuplicate", SD, "Say two suppliers are not the same business", ["PROCUREMENT", "LEGAL"], "DuplicateDismiss", None, 204)
ep("GET", "/suppliers/{id}/risk", "getSupplierRisk", SD, "Risk, resilience and ESG score with its factors, recommendations and alternative suppliers (rules-simulated)", ["PROCUREMENT", "LEGAL", "FINANCE", "EXEC", "PROBITY"], None, "SupplierRisk")
ep("POST", "/suppliers/{id}/modern-slavery-check", "checkModernSlavery", SD, "Run the modern slavery screen for a supplier and record the result", ["PROCUREMENT", "LEGAL"], None, "ModernSlaveryResult")
ep("GET", "/reports/supplier-scores", "getSupplierScores", RP, "Every supplier's score, lowest first", ["PROCUREMENT", "EXEC", "FINANCE", "PROBITY"], None, "SupplierScores")
ep("GET", "/reports/diversity", "getDiversityReport", RP, "Committed spend by diversity ownership, and carbon data reported", ["PROCUREMENT", "EXEC", "FINANCE"], None, "DiversityReport")
LR = ["PROCUREMENT", "REQUESTER", "LEGAL", "CONTRACT_MGR", "DELEGATE", "EXEC", "FINANCE", "PROBITY", "EVALUATOR", "CHAIR"]
ep("GET", "/requests/{id}/lessons", "listLessons", LS, "Lessons learned on a procurement", LR, None, "Lesson", arrayResp=True)
ep("POST", "/requests/{id}/lessons", "addLesson", LS, "Capture a lesson learned", LR, "LessonCreate", "Lesson", 201)
ep("GET", "/requests/{id}/lessons/recall", "recallLessons", LS, "Lessons from comparable procurements, by category, size and wording, with why each was chosen (rules-simulated)", LR, None, "LessonRecall")
ep("POST", "/requests/{id}/close", "closeRequest", LS, "Close or cancel a procurement; a lesson learned (or a reason for none) is needed", ["PROCUREMENT", "EXEC"], "RequestClose", "RequestClosed", note="409 LESSONS_REQUIRED; 409 if not yet in contract management (cancel instead)")
ep("POST", "/contracts/{id}/legal-edit", "legalEdit", CN, "Redact a clause, propose a redline or insert a clause at a nominated place, in plain language", ["LEGAL"], "LegalEdit", "LegalEditResult", note="apply=false previews; 409 once released for signature")
ep("GET", "/contracts/{id}/redlines", "listRedlines", CN, "Proposed changes to clauses, from Legal, the legal platform, outside counsel or the supplier", ["LEGAL", "PROCUREMENT", "DELEGATE", "EXEC"], None, "RedlineList")
ep("POST", "/contracts/{id}/redlines/{redlineId}/decision", "decideRedline", CN, "Accept (applies the wording) or reject a proposed change", ["LEGAL"], "RedlineDecision", "RedlineDecided", note="409 already decided or the wording is final")
ep("POST", "/contracts/{id}/counsel-links", "createCounselLink", CN, "Issue a one-time link for an outside law firm or the supplier's legal team to mark up this contract", ["LEGAL"], "CounselLinkCreate", "CounselLink", 201)
ep("GET", "/contracts/{id}/counsel-links", "listCounselLinks", CN, "Links issued for this contract (never the link itself)", ["LEGAL"], None, "CounselLink", arrayResp=True)
ep("DELETE", "/contracts/{id}/counsel-links/{linkId}", "revokeCounselLink", CN, "Withdraw a counsel link", ["LEGAL"], None, None, 204)
ep("GET", "/counsel/{token}", "getCounselPage", CN, "The clauses an outside party may mark up, with their own redlines; read-only once the version is final", None, None, "CounselPage")
ep("POST", "/counsel/{token}/redlines", "proposeCounselRedline", CN, "An outside party proposes new wording for a clause", None, "CounselRedline", "RedlineDecided", 201, note="423 once the version is final")
ep("GET", "/contracts/deleted", "listDeletedContracts", CN, "Contracts that were logically deleted, with the reason", ["LEGAL", "EXEC", "PROBITY"], None, "DeletedContracts")
ep("POST", "/contracts/{id}/restore", "restoreContract", CN, "Bring a logically deleted contract back, with a reason", ["LEGAL", "EXEC"], "ContractRestore", "ContractRestored")
ep("GET", "/integration-events", "listIntegrationEvents", IN, "Events sent to other systems and whether they were delivered", ["ADMIN", "PROCUREMENT", "LEGAL"], None, "IntegrationEvents")
ep("POST", "/integration-events/retry", "retryIntegrationEvents", IN, "Try again every event that has not been delivered", ["ADMIN", "PROCUREMENT", "LEGAL"], None, "IntegrationRetry")
ep("POST", "/integrations/legal/webhook", "legalPlatformWebhook", IN, "The customer's legal platform reports a matter stage and redlines; signed with the shared secret, safe to send twice", None, "LegalWebhook", "LegalWebhookResult", note="401 for a bad signature or unknown matter; duplicate=true when seen before")
ep("GET", "/approval-links/{token}", "getApprovalLink", AL, "The summary checklist behind a one-time approval link (commercial information withheld by default)", None, None, "ApprovalLinkView")
ep("POST", "/approval-links/{token}/decision", "decideViaApprovalLink", AL, "Approve or reject from the link without a full sign-in; the same limits and checks apply", None, "ApprovalLinkDecision", "ApprovalLinkDecided", note="403 above the approver's authority; step-up code required if the organisation asks for one")

# ---------------------------------------------------------------- B9: planning, spend and experience
schemas.update({n: OBJ for n in [
    "FxRates", "FxRatesSave", "FxRefreshResult", "FxConversion", "DashboardView", "DashboardSave", "AnalyticsStatus", "AnalyticsRefreshed",
    "FutureCommitment", "OptimisationReport", "ReviewNoteTargets", "ReviewNoteCreate", "ReviewNote", "GrcItem", "GrcItemCreate", "GrcItemUpdate",
    "GrcActionCreate", "GrcSummary", "GrcSyncResult", "Branding", "ProgressView", "AppliedLayout", "CatalogueView", "CatalogueItemCreate",
    "CatalogueItemUpdate", "CatalogueItemResult", "BuyingOrder", "BuyingOrderResult", "SourceNeed", "SourcingProposal", "ProposalDecision",
    "ArtefactState", "ArtefactRefreshed", "SearchQuery", "SearchResult", "ExternalSearchLog",
]})
FX = "Currency"; AN = "Analytics"; DB = "Dashboards"; GR = "RiskRegister"; BY = "GuidedBuying"; AF = "Artefacts"; SR = "Search"; PG = "Progress"
STAFF_ALL = ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "ADMIN", "EXEC"]
STAFF_BUY = ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "EXEC"]
NOTERS = ["PROCUREMENT", "LEGAL", "FINANCE", "EXEC", "CONTRACT_MGR", "PROBITY", "DELEGATE", "EVALUATOR", "CHAIR"]
GRC_R = ["PROBITY", "EXEC", "LEGAL", "FINANCE", "PROCUREMENT", "CONTRACT_MGR", "DELEGATE"]
GRC_W = ["PROBITY", "EXEC", "LEGAL", "PROCUREMENT", "FINANCE"]
ANR = ["EXEC", "FINANCE", "PROCUREMENT", "CONTRACT_MGR"]
ep("GET", "/fx/rates", "listFxRates", FX, "Exchange rates in force today and the history, by annual or live setting", STAFF_ALL, None, "FxRates")
ep("PUT", "/fx/rates", "saveFxRates", FX, "Set the annual rates for a financial year", ["ADMIN", "FINANCE"], "FxRatesSave", "FxRates", note="422 unsupported currency or a rate that is not positive")
ep("POST", "/fx/refresh", "refreshFxRates", FX, "Pull the latest simulated live rates", ["ADMIN", "FINANCE"], None, "FxRefreshResult")
ep("GET", "/fx/convert", "convertAmount", FX, "Convert an amount to AUD at the rate in force on a date", STAFF_ALL, None, "FxConversion", query=["amount", "currency", "on"])
ep("GET", "/me/dashboard", "getMyDashboard", DB, "My own dashboard: the widgets I chose, or the default for my role, and the catalogue I may choose from", STAFF_ALL, None, "DashboardView")
ep("PUT", "/me/dashboard", "saveMyDashboard", DB, "Choose, order, size and style my widgets", STAFF_ALL, "DashboardSave", "DashboardView", note="422 for a widget my role cannot use or a style it cannot take")
ep("DELETE", "/me/dashboard", "resetMyDashboard", DB, "Go back to the default dashboard for my role", STAFF_ALL, None, "DashboardView")
ep("GET", "/analytics/status", "getAnalyticsStatus", AN, "When the separate analytics store was last refreshed from the main database", ANR + ["ADMIN"], None, "AnalyticsStatus")
ep("POST", "/analytics/refresh", "refreshAnalytics", AN, "Refresh the analytics store now", ["EXEC", "FINANCE", "PROCUREMENT", "ADMIN"], None, "AnalyticsRefreshed")
ep("GET", "/reports/future-commitment", "getFutureCommitment", AN, "What the enterprise is committed to pay in future: fixed amounts, ceilings, ranges, unknowns and extensions", ANR, None, "FutureCommitment")
ep("GET", "/reports/optimisation", "getOptimisation", AN, "Where spend can be reduced: consolidation, duplicate contracts, rate card gaps and price variance", ANR, None, "OptimisationReport")
ep("GET", "/notes/targets", "listNoteTargets", PG, "The suppliers the caller may take review notes about", NOTERS, None, "ReviewNoteTargets")
ep("POST", "/notes", "createNote", PG, "Take a note about a supplier, private or shared with the team", NOTERS, "ReviewNoteCreate", "ReviewNote", 201)
ep("GET", "/notes", "listNotes", PG, "My notes, and the ones others shared, about a supplier", NOTERS, None, "ReviewNote", arrayResp=True, query=["supplierId"])
ep("DELETE", "/notes/{id}", "deleteNote", PG, "Delete one of my own notes", NOTERS, None, None, 204)
ep("GET", "/grc/items", "listGrcItems", GR, "Risks, audit findings and obligations in the register", GRC_R, None, "GrcItem", arrayResp=True, query=["kind", "status"])
ep("POST", "/grc/items", "createGrcItem", GR, "Add a risk, an audit finding or an obligation", GRC_W, "GrcItemCreate", "GrcItem", 201, note="422 a risk needs likelihood and impact")
ep("PATCH", "/grc/items/{id}", "updateGrcItem", GR, "Change the rating, owner, dates or status", GRC_W, "GrcItemUpdate", "GrcItem", note="422 accepting needs a treatment of at least ten characters")
ep("POST", "/grc/items/{id}/actions", "addGrcAction", GR, "Assign an action; the owner is notified", GRC_W, "GrcActionCreate", "GrcItem", 201)
ep("POST", "/grc/items/{id}/actions/{actionId}/complete", "completeGrcAction", GR, "Mark an action done", GRC_W, None, "GrcItem")
ep("GET", "/grc/summary", "getGrcSummary", GR, "Counts by kind and status and the likelihood and impact heat map", GRC_R, None, "GrcSummary")
ep("POST", "/grc/sync", "syncGrc", GR, "Pull in what the platform already knows (sanctions, expired insurance and the like), once each", ["PROBITY", "EXEC"], None, "GrcSyncResult")
ep("GET", "/branding", "getBranding", FX, "The product name, tagline, palette and support address (shown on the sign-in page)", None, None, "Branding")
ep("GET", "/requests/{id}/progress", "getRequestProgress", PG, "How far a procurement has come, by milestone", STAFF_ALL, None, "ProgressView", note="404 for a request the caller cannot see; 403 for suppliers")
ep("GET", "/layouts/{kind}/applied", "getAppliedLayout", PG, "What a page shows and in what order, for anyone who can open the page", STAFF_ALL, None, "AppliedLayout")
ep("GET", "/catalogue", "listCatalogue", BY, "The approved catalogue, with suppliers that cannot be ordered from marked", STAFF_BUY, None, "CatalogueView", query=["q", "category"])
ep("POST", "/catalogue", "addCatalogueItem", BY, "Add a catalogue item", ["PROCUREMENT"], "CatalogueItemCreate", "CatalogueItemResult", 201)
ep("PATCH", "/catalogue/{id}", "updateCatalogueItem", BY, "Change the price, lead time or whether it is offered", ["PROCUREMENT"], "CatalogueItemUpdate", "CatalogueItemResult")
ep("POST", "/buying/orders", "orderFromCatalogue", BY, "Draft a request from chosen catalogue lines", ["REQUESTER", "PROCUREMENT"], "BuyingOrder", "BuyingOrderResult", 201)
ep("POST", "/buying/auto-source", "autoSource", BY, "Describe a need: the platform shortlists, scores and recommends (rules-simulated-v1)", ["REQUESTER", "PROCUREMENT"], "SourceNeed", "SourcingProposal", 201)
ep("GET", "/buying/proposals", "listProposals", BY, "My sourcing proposals (procurement sees all)", ["REQUESTER", "PROCUREMENT"], None, "SourcingProposal", arrayResp=True)
ep("POST", "/buying/proposals/{id}/decision", "decideProposal", BY, "A person approves or rejects a recommendation; approving drafts a request", ["REQUESTER", "PROCUREMENT"], "ProposalDecision", "SourcingProposal", note="409 OVER_LIMIT above the limit; SUPPLIER_NOT_APPROVED")
ep("GET", "/artefacts/{kind}/{id}/state", "getArtefactState", AF, "Whether an evaluation report or contract plans are out of date, and when they will be refreshed", ["PROCUREMENT", "DELEGATE", "EXEC", "PROBITY", "CHAIR", "LEGAL", "CONTRACT_MGR"], None, "ArtefactState")
ep("POST", "/artefacts/{kind}/{id}/refresh", "refreshArtefact", AF, "Bring an artefact up to date now", ["PROCUREMENT", "CONTRACT_MGR", "LEGAL"], None, "ArtefactRefreshed", note="409 for an approved report")
ep("POST", "/search", "search", SR, "Search my records, and an outside source when the organisation allows it (identifiers withheld)", STAFF_BUY, "SearchQuery", "SearchResult")
ep("GET", "/search/external-log", "listExternalSearchLog", SR, "Every question sent to an outside source and what was withheld", ["ADMIN", "PROBITY", "EXEC"], None, "ExternalSearchLog", arrayResp=True)
schemas["ActionItems"] = OBJ
ep("GET", "/action-items", "listActionItems", "Dashboards", "What needs my attention now, with a link to the screen where each is dealt with", ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "ADMIN", "EXEC"], None, "ActionItems")
