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
