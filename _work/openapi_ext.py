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
