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

# B10A block
# ---------------------------------------------------------------- B10a: the connector foundation
# NFR-C07 connector catalogue, SEC-N03 secret store, NFR-C05 resilient provider layer, NFR-AV03 delivery and reconciliation,
# SEC-TP04 signed middleware legs, NFR-AV04 manual fallback. Appended to openapi_ext.py (runs in gen_openapi.py's namespace).
schemas.update({n: OBJ for n in [
    "ConnectorCatalogue", "ConnectorUpdate", "ConnectorView", "ConnectorTestResult", "ConnectorSyncRequest", "ConnectorSyncResult",
    "SyncRun", "ManualTask", "ManualTaskComplete", "SecretList", "SecretValue", "SecretMeta", "ConnectorSecurity",
    "InboundWebhook", "InboundWebhookResult", "SupplierVerification", "IntegrationEventView",
]})
CN = "Connectors"; SC = "SecretStore"; MT = "ManualFallback"
CN_READ = ["ADMIN", "PROCUREMENT", "FINANCE", "LEGAL", "EXEC"]
CN_OPS = ["ADMIN", "PROCUREMENT"]
ep("GET", "/connectors", "listConnectors", CN, "The catalogue of supported providers by kind (all simulated) and this tenant's connectors with their health and circuit breaker", CN_READ, None, "ConnectorCatalogue")
ep("PUT", "/connectors/{kind}", "updateConnector", CN, "Choose the provider, switch on or off, set the demonstration mode UP or DOWN and the non-secret configuration", ["ADMIN"], "ConnectorUpdate", "ConnectorView", note="422 for a provider not in the catalogue; 400 when the configuration holds something that looks like a secret")
ep("POST", "/connectors/{kind}/test", "testConnector", CN, "Run a health check through the resilient layer and show the circuit breaker state (CLOSED, OPEN, HALF_OPEN)", CN_OPS, None, "ConnectorTestResult")
ep("POST", "/connectors/{kind}/sync", "syncConnector", CN, "Send records outward through the connector, signed; safe to repeat because each record has a key. A failure is kept to retry and queues a manual task", ["ADMIN", "PROCUREMENT", "FINANCE"], "ConnectorSyncRequest", "ConnectorSyncResult", 201)
ep("POST", "/connectors/{kind}/reconcile", "reconcileConnector", CN, "Compare what was sent with what the other side acknowledged and send what is missing again under the same key; a second run changes nothing", CN_OPS, None, "SyncRun")
ep("GET", "/connectors/sync-runs", "listSyncRuns", CN, "Reconciliation runs: how many were expected, received, missing and repaired", CN_READ, None, "SyncRun", arrayResp=True, query=["kind"])
ep("GET", "/connectors/{kind}/security", "getConnectorSecurity", CN, "Evidence for the middleware leg: algorithm, replay window, secret fingerprint and the count of rejected attempts", ["ADMIN", "PROCUREMENT", "PROBITY", "EXEC"], None, "ConnectorSecurity")
ep("POST", "/integration-events/{id}/requeue", "requeueIntegrationEvent", CN, "Put a dead-lettered delivery back in the queue with fresh attempts and try it now", ["ADMIN", "PROCUREMENT", "LEGAL"], None, "IntegrationEventView", note="409 unless the event is a dead letter")
ep("POST", "/integrations/{kind}/webhook", "inboundWebhook", CN, "Signed inbound message from the middleware (X-IF-Signature and X-IF-Timestamp, HMAC-SHA256, five-minute window); an event id is accepted once", None, "InboundWebhook", "InboundWebhookResult", note="401 for a bad signature, wrong secret, stale timestamp or unknown organisation; 409 REPLAYED for an event id already received")
ep("POST", "/suppliers/{id}/verification", "verifySupplier", CN, "Screen a supplier against the sanctions list and verify insurance through the resilient layer; UNVERIFIED (provider unavailable) when a provider is down, never CLEAR", CN_OPS, None, "SupplierVerification")
ep("GET", "/manual-tasks", "listManualTasks", MT, "Work to do by hand while a connected system is down, with instructions", CN_READ, None, "ManualTask", arrayResp=True, query=["status"])
ep("POST", "/manual-tasks/{id}/complete", "completeManualTask", MT, "Mark a manual task done with the reference the person typed; the queued delivery is then closed", ["ADMIN", "PROCUREMENT", "FINANCE", "LEGAL"], "ManualTaskComplete", "ManualTask", note="409 when the task is already done or was superseded")
ep("GET", "/secrets", "listSecrets", SC, "Names, versions, fingerprints and last rotation of stored secrets; values are never returned", ["ADMIN"], None, "SecretList")
ep("PUT", "/secrets/{name}", "setSecret", SC, "Set or rotate a secret: a new version is written and the previous one retired; audited without the value", ["ADMIN"], "SecretValue", "SecretMeta")

# B10B block
# ---------------------------------------------------------------- B10b: ERP sync, legal status sync, HR feed, payment execution
# NFR-C02 ERP sync (simulated SAP, Oracle, Dynamics), NFR-C03 legal system sync by webhook, FR-0815 HR feed, FR-0875 payments.
# Appended to openapi_ext.py (runs in gen_openapi.py's namespace). The roles listed here MUST equal the route guards (authz matrix test).
schemas.update({n: OBJ for n in [
    "ErpOverview", "ErpSyncRequest", "ErpSyncResult", "ErpLedgerEntry", "ErpHistoryEntry", "ErpCostCentre", "ErpBudgetCheckRequest",
    "ErpBudgetCheck", "LegalSimulateRequest", "LegalSimulateResult", "LegalSyncView", "LegalStatusSent", "LegalEventReprocessed",
    "LegalInboundEvent", "LegalInboundResult", "HrFeedOverview", "HrFeedRunRequest", "HrFeedRunResult", "HrDelegationSync",
    "HrReassignmentDone", "PaymentCreate", "Payment", "PaymentList", "PaymentSettled", "PaymentConfirmation", "PaymentConfirmationResult",
]})
ER = "ErpSync"; LG = "LegalSync"; HR = "HrFeed"; PY = "Payments"
ER_READ = ["ADMIN", "FINANCE", "PROCUREMENT", "EXEC"]
ER_RUN = ["ADMIN", "FINANCE"]
ER_PICK = ["ADMIN", "REQUESTER", "PROCUREMENT", "FINANCE", "EXEC", "DELEGATE", "CONTRACT_MGR"]
ER_CHECK = ["REQUESTER", "PROCUREMENT", "FINANCE", "EXEC"]
ep("GET", "/erp/overview", "getErpOverview", ER, "Imported cost centres with budget, actuals and what is available, organisation units, budget lines, the last run and the ERP connector's provider and health (SIMULATED)", ER_READ, None, "ErpOverview")
ep("POST", "/erp/sync", "runErpSync", ER, "Pull cost centres, organisation units, budgets and the ledger from the ERP connector's provider (SAP, Oracle or Dynamics), map them and upsert by external id. A second run changes nothing; changes at the source are reported as added, changed and removed. dryRun shows the counts without writing", ER_RUN, "ErpSyncRequest", "ErpSyncResult", note="200 with status FAILED and a manual task when the ERP connector is DOWN; 422 for a provider that is not an ERP feed")
ep("GET", "/erp/ledger", "listErpLedger", ER, "Imported ledger postings, newest first", ER_READ, None, "ErpLedgerEntry", arrayResp=True, query=["costCentre", "limit"])
ep("GET", "/erp/history", "listErpSyncs", ER, "Recent ERP imports with the counts of what was added, changed, removed and left alone", ER_READ, None, "ErpHistoryEntry", arrayResp=True)
ep("GET", "/erp/cost-centres", "listErpCostCentres", ER, "Active imported cost centres, for choosing a cost centre", ER_PICK, None, "ErpCostCentre", arrayResp=True)
ep("POST", "/erp/budget-check", "checkErpBudget", ER, "The budget check for a business unit or cost centre. An imported ERP budget line is used when there is one, otherwise the tenant settings; the answer names its source", ER_CHECK, "ErpBudgetCheckRequest", "ErpBudgetCheck", note="422 without a business unit or cost centre")
LEG_READ = ["ADMIN", "LEGAL", "PROCUREMENT", "DELEGATE", "EXEC", "CONTRACT_MGR"]
LEG_WORK = ["ADMIN", "LEGAL"]
ep("POST", "/integrations/legal/events", "legalInboundEvent", LG, "Signed inbound event from the legal system: MATTER_STAGE_CHANGED, DOCUMENT_ATTACHED or MATTER_CLOSED (X-IF-Signature and X-IF-Timestamp, HMAC-SHA256, five-minute window). Applied to the matter and the contract page; an event id is applied once; a failure is kept and retried, then dead-lettered", None, "LegalInboundEvent", "LegalInboundResult", note="401 for a bad or stale signature or an unknown organisation; 202 when the event could not be applied yet (kept as FAILED or DEAD_LETTER)")
ep("POST", "/integrations/legal/simulate", "simulateLegalEvent", LG, "Build a correctly signed inbound legal event for a matter and run it through the same receiver an outside caller uses (SIMULATED); options show a repeat, a bad signature and an unknown matter", LEG_WORK, "LegalSimulateRequest", "LegalSimulateResult", note="409 when the matter has no reference in the legal system or the legal connector is off")
ep("POST", "/integrations/legal/events/{id}/reprocess", "reprocessLegalEvent", LG, "Apply an inbound legal event that failed or was dead-lettered, now", LEG_WORK, None, "LegalEventReprocessed", note="409 when the event was already applied")
ep("POST", "/legal-matters/{id}/sync-status", "sendLegalMatterStatus", LG, "Send this matter's status to the legal system as a signed outbound event through the connector; safe to repeat, a failure is kept and a manual task is queued", ["ADMIN", "LEGAL", "PROCUREMENT"], None, "LegalStatusSent")
ep("GET", "/contracts/{id}/legal-sync", "getContractLegalSync", LG, "The contract's legal matters as the legal system reports them: stage, documents attached, closed, and the event history with retries and dead letters", LEG_READ, None, "LegalSyncView")
ep("GET", "/hr-feed/overview", "getHrFeedOverview", HR, "HR feed batches, every event with its outcome, exceptions that need a person, time-bound delegations and the work listed for reassignment", ["ADMIN"], None, "HrFeedOverview")
ep("POST", "/hr-feed/run", "runHrFeed", HR, "Preview (dryRun) or apply the next batch of the simulated HR feed: starters, leavers, role changes and delegate changes. Each event id is applied once; ADMIN is never granted by the feed; a delegation is capped at the delegator's own limit", ["ADMIN"], "HrFeedRunRequest", "HrFeedRunResult", note="200 with ok false and a manual task when the HR connector is off or DOWN; 409 when there is no later batch")
ep("POST", "/hr-feed/sync-delegations", "syncHrDelegations", HR, "Start delegations whose start date has come and end those whose end date has passed", ["ADMIN"], None, "HrDelegationSync")
ep("POST", "/hr-feed/reassignments/{id}/done", "completeHrReassignment", HR, "Record that a leaver's open item was given to a new owner", ["ADMIN"], None, "HrReassignmentDone", note="409 when already done")
PY_READ = ["FINANCE", "EXEC", "PROCUREMENT", "CONTRACT_MGR"]
PY_ACT = ["FINANCE", "EXEC"]
ep("POST", "/invoices/{id}/payments", "proposePayment", PY, "Propose a payment for a matched invoice (full or part). Repeating the same idempotency key returns the same payment and creates nothing", ["FINANCE"], "PaymentCreate", "Payment", 201, note="409 INVOICE_NOT_PAYABLE for an invoice that is not matched (blocked, exception, paid); 409 PAYMENT_EXCEEDS_INVOICE above what is still unpaid")
ep("POST", "/payments/{id}/approve", "approvePayment", PY, "A different person approves the payment and the order is sent to the finance system through the PAYMENTS connector; if the system is down it waits with a manual task", PY_ACT, None, "Payment", note="403 ROLE_SOD_VIOLATION for the person who proposed it; 409 unless the payment is proposed")
ep("POST", "/payments/{id}/retry", "retryPayment", PY, "Send a failed payment again, or try a waiting payment now", PY_ACT, None, "Payment", note="409 for a payment that is neither failed nor waiting")
ep("POST", "/payments/{id}/cancel", "cancelPayment", PY, "Cancel a proposed or failed payment", PY_ACT, None, "Payment", note="409 once the order has been sent")
ep("POST", "/payments/settle", "settlePayments", PY, "Bring up to date the payments whose order was delivered after a wait or paid by hand", PY_ACT, None, "PaymentSettled")
ep("GET", "/payments", "listPayments", PY, "Payments with their status trail, and the PAYMENTS connector's state", PY_READ, None, "PaymentList", query=["invoiceId"])
ep("GET", "/payments/{id}", "getPayment", PY, "One payment with its status trail", PY_READ, None, "Payment")
ep("POST", "/integrations/payments/confirmation", "paymentConfirmation", PY, "The finance system's signed confirmation or failure callback; applied once per event id", None, "PaymentConfirmation", "PaymentConfirmationResult", note="401 for a bad or stale signature; 409 unless the payment was sent")

# B10C block
# ---------------------------------------------------------------- B10c: e-signature envelopes, document repository, continuity alerts
# NFR-C04 e-signature providers with signatories pre-filled (simulated DocuSign and Adobe), NFR-C06 enterprise document repository
# (simulated SharePoint), FR-0860 business-continuity alerts by SMS and email with response trackers (simulated gateways).
# Appended to openapi_ext.py (runs in gen_openapi.py's namespace). Roles match the guards in apps/api/src/modules/b10x/*-routes.ts.
schemas.update({n: OBJ for n in [
    "EsignEnvelopeCard", "EsignEnvelopeCreate", "EsignSigningLink", "EsignSimulateEvent", "EsignSimulateResult", "EsignCeremony",
    "EsignConfirm", "EsignConfirmResult",
    "RepoProjects", "RepoFileList", "RepoFile", "RepoVersions", "RepoWrite", "RepoWriteResult", "RepoSources", "RepoPublish",
    "RepoPublishResult", "RepoImport", "RepoImportResult",
    "ContinuityOptions", "ContinuityRaise", "ContinuityTracker", "ContinuityEventList", "ContinuityAnswer", "ContinuityClose",
    "ContinuityResend", "RespondLink", "RespondAnswer",
]})
ES = "ESignature"; RP = "DocumentRepository"; CB = "ContinuityAlerts"
ES_READ = ["ADMIN", "PROCUREMENT", "LEGAL", "CONTRACT_MGR", "DELEGATE", "EXEC", "FINANCE", "PROBITY"]
ES_MANAGE = ["ADMIN", "LEGAL", "PROCUREMENT"]
ES_SIGN = ["DELEGATE", "EXEC"]
ep("GET", "/contracts/{id}/envelope", "getContractEnvelope", ES, "The e-signature envelope for a contract: provider, status for each signatory and the event history (a signatory in blind signing sees only their own line)", ES_READ, None, "EsignEnvelopeCard")
ep("POST", "/contracts/{id}/envelope", "createContractEnvelope", ES, "Create (or try again to create) the envelope for a contract that is out for signature, with the signatories pre-filled from the signature chain; closes the manual task if one was raised", ES_MANAGE, None, "EsignEnvelopeCard", 201, note="409 NO_ENVELOPE when the e-signature connector is not DocuSign or Adobe or the contract is not out for signature; 200 with result MANUAL_TASK when the provider is down")
ep("POST", "/contracts/{id}/envelope/signing-link", "issueEnvelopeSigningLink", ES, "A fresh signing link for the signed-in signatory (the earlier link stops working)", ES_SIGN, None, "EsignSigningLink", note="403 NOT_A_SIGNATORY")
ep("POST", "/contracts/{id}/envelope/simulate-event", "simulateEnvelopeEvent", ES, "Demonstration: make the simulated provider call back (sent, delivered, viewed, signed, declined, voided, expired) with a correctly signed message through the inbound webhook", ES_MANAGE, "EsignSimulateEvent", "EsignSimulateResult", note="a repeated eventId is refused as a replay; a signed callback reaches the chain only through the normal sign decision and may be REFUSED by signing authority or order")
ep("GET", "/esign/{token}", "getEsignCeremony", ES, "The simulated signing ceremony: a summary of the document for the signatory the link was issued to; opening it is reported to the provider as delivered and viewed", ES_SIGN, None, "EsignCeremony", note="404 for a link that is not yours, expired or replaced")
ep("POST", "/esign/{token}/confirm", "confirmEsign", ES, "The signatory's own confirmation: signs or declines through the contract's normal sign decision, so signing authority, order and checks still apply", ES_SIGN, "EsignConfirm", "EsignConfirmResult", note="403 SIGNING_AUTHORITY_INSUFFICIENT; 409 SIGNING_ORDER, ENVELOPE_CLOSED or ALREADY_DONE; 400 a decline needs a reason")
REPO_READ = ["REQUESTER", "PROCUREMENT", "DELEGATE", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "EXEC"]
REPO_WRITE = ["REQUESTER", "PROCUREMENT", "LEGAL", "CONTRACT_MGR"]
REPO_PUBLISH = ["PROCUREMENT", "LEGAL", "CONTRACT_MGR"]
ep("GET", "/repository/projects", "listRepositoryProjects", RP, "The project sites in the simulated repository that the caller may open (the same procurements the caller can see in reports)", REPO_READ, None, "RepoProjects", note="409 REPOSITORY_OFF when the connector is off; 503 REPOSITORY_UNAVAILABLE when it is down")
ep("GET", "/repository/projects/{requestId}/files", "listRepositoryFiles", RP, "Folders and the newest version of each file in a project site", REPO_READ, None, "RepoFileList", query=["folder"], note="404 for a project the caller cannot see")
ep("GET", "/repository/projects/{requestId}/files/{folder}/{name}", "readRepositoryFile", RP, "Read a file (newest version, or ?version=); the ETag is the version to send back in If-Match", REPO_READ, None, "RepoFile", query=["version"])
ep("GET", "/repository/projects/{requestId}/files/{folder}/{name}/download", "downloadRepositoryFile", RP, "Download a file as it was stored", REPO_READ, None, None, query=["version"], note="the file's own content type")
ep("GET", "/repository/projects/{requestId}/files/{folder}/{name}/versions", "listRepositoryVersions", RP, "Every version of a file, newest first", REPO_READ, None, "RepoVersions")
ep("PUT", "/repository/projects/{requestId}/files/{folder}/{name}", "writeRepositoryFile", RP, "Write the next version of a file (never an overwrite): If-Match must carry the version last read; omit it only for a new file", REPO_WRITE, "RepoWrite", "RepoWriteResult", 201, note="428 PRECONDITION_REQUIRED without If-Match for an existing file; 412 PRECONDITION_FAILED for a stale version; 400 unsafe file; 413 over 2 MB; 422 FILE_INFECTED; 202 MANUAL_TASK when the repository is down")
ep("GET", "/repository/projects/{requestId}/sources", "listRepositorySources", RP, "Platform documents of this project that can be filed: the tender pack, the evaluation report and contracts", REPO_READ, None, "RepoSources")
ep("POST", "/repository/projects/{requestId}/publish", "publishToRepository", RP, "File a platform document (contract, evaluation report, tender pack) in the project folder as the next version; an unchanged document adds no version", REPO_PUBLISH, "RepoPublish", "RepoPublishResult", 201, note="200 UNCHANGED; 202 MANUAL_TASK when the repository is down; the document is fetched with the caller's own rights")
ep("POST", "/repository/projects/{requestId}/import", "importFromRepository", RP, "Bring a repository file into a contract's negotiation drafts", ["LEGAL"], "RepoImport", "RepoImportResult", 201, note="404 for a contract of another project; 423 for a locked contract")
CB_RAISE = ["PROCUREMENT", "CONTRACT_MGR", "EXEC"]
CB_VIEW = ["PROCUREMENT", "CONTRACT_MGR", "EXEC", "LEGAL"]
ep("GET", "/continuity/options", "getContinuityOptions", CB, "What can be picked when raising an event: kinds, severities, affected suppliers and contracts, recipient groups and people to escalate to", CB_RAISE, None, "ContinuityOptions")
ep("POST", "/continuity/events", "raiseContinuityEvent", CB, "Raise a continuity event and send an SMS and an email to each recipient through the simulated gateway; returns the tracker and, once, each recipient's one-time response link", CB_RAISE, "ContinuityRaise", "ContinuityTracker", 201, note="422 SMS_NOT_PLAIN when the text message note carries a supplier name, a number or an identifier; NO_RECIPIENTS; AFFECTED_REQUIRED")
ep("GET", "/continuity/events", "listContinuityEvents", CB, "Continuity events, newest first, with how many have answered", CB_VIEW, None, "ContinuityEventList")
ep("GET", "/continuity/events/{id}", "getContinuityTracker", CB, "The tracker: who has been reached, by which channel, and who has not answered; reading it also records delivery receipts and escalates when due", CB_VIEW, None, "ContinuityTracker")
ep("POST", "/continuity/events/{id}/resend", "resendContinuityEvent", CB, "Message the people who have not answered again, each with a new one-time link", CB_RAISE, None, "ContinuityResend", note="409 EVENT_CLOSED")
ep("POST", "/continuity/events/{id}/responses/{responseId}", "recordContinuityAnswer", CB, "Record an answer taken by phone on someone's behalf", CB_RAISE, "ContinuityAnswer", "ContinuityTracker", note="409 EVENT_CLOSED")
ep("POST", "/continuity/events/{id}/close", "closeContinuityEvent", CB, "Close the event with a summary of who answered what and how many messages got through", CB_RAISE, "ContinuityClose", "ContinuityTracker", note="409 when already closed")
ep("GET", "/respond-links/{token}", "getRespondLink", CB, "The one-time response page for one recipient (no sign-in)", None, None, "RespondLink", note="404 unknown link; 410 LINK_EXPIRED")
ep("POST", "/respond-links/{token}", "answerRespondLink", CB, "Say I am safe, I am affected or I need help; one answer per person, changeable until the event is closed", None, "RespondAnswer", "RespondLink", note="410 LINK_EXPIRED; 409 EVENT_CLOSED")

# B10D block
# ---------------------------------------------------------------- B10 (AI layer, configuration, client baseline, performance)
schemas.update({n: OBJ for n in [
    "AiModelCatalogue", "AiApprovalRequest", "AiApprovalRequested", "AiApprovalDecision", "AiApprovalDecided", "AiRevoke", "AiRevoked",
    "AiActiveModel", "AiActiveModelSave", "ConfigInventory", "ConfigExport", "ConfigImport", "ConfigImportResult", "ClientCheck",
    "ClientCheckResult", "ClientBaselineSummary", "BudgetCheckPerformance",
]})
AI = "AiModels"; CF = "Configuration"; PF = "Performance"
AI_VIEW = ["ADMIN", "PROCUREMENT", "PROBITY", "EXEC"]
STAFF_B10 = ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "ADMIN", "EXEC"]
ep("GET", "/ai/models", "listAiModels", AI, "The AI models the platform can use, each with its approval state for this tenant and its data-handling profile (SEC-TP07)", AI_VIEW, None, "AiModelCatalogue")
ep("POST", "/ai/models/{key}/request-approval", "requestAiModelApproval", AI, "Ask for a third-party AI model to be approved for this tenant", ["ADMIN", "PROCUREMENT"], "AiApprovalRequest", "AiApprovalRequested", 201, note="409 for the built-in model, an approved model or one with a request already waiting; 404 unknown model")
ep("POST", "/ai/approvals/{id}/decision", "decideAiApproval", AI, "Approve or reject a request; never the person who made it", ["PROBITY", "EXEC"], "AiApprovalDecision", "AiApprovalDecided", note="403 SELF_APPROVAL when the caller made the request; 409 when already decided")
ep("POST", "/ai/models/{key}/revoke", "revokeAiModel", AI, "Withdraw an approval; the tenant falls back to rules-simulated-v1 at once and the change is audited", ["ADMIN", "PROBITY", "EXEC"], "AiRevoke", "AiRevoked", note="409 unless the model is approved")
ep("GET", "/ai/active-model", "getActiveAiModel", AI, "The model answering for this tenant now, and any per-task choices", STAFF_B10, None, "AiActiveModel")
ep("PUT", "/ai/active-model", "setActiveAiModel", AI, "Switch the active model (and optional per-task models) by configuration; takes effect at once and is audited with old and new value", ["ADMIN"], "AiActiveModelSave", "AiActiveModel", note="409 MODEL_NOT_APPROVED for a third-party model that is not approved; 422 unknown model")
ep("GET", "/admin/config/inventory", "getConfigInventory", CF, "Every settings section: fields, defaults, current value, who changed it last and the screen that edits it (NFR-M05)", ["ADMIN"], None, "ConfigInventory")
ep("GET", "/admin/config/export", "exportConfig", CF, "All tenant configuration as a JSON file; secrets are left empty and no user data is included", ["ADMIN"], None, "ConfigExport", note="application/json attachment")
ep("POST", "/admin/config/import", "importConfig", CF, "Validate a configuration file with the same schemas and show the difference; applies only when dryRun is false", ["ADMIN"], "ConfigImport", "ConfigImportResult", note="dryRun defaults to true; 422 when applying an invalid file")
ep("POST", "/auth/client-check", "reportClientCheck", CF, "A signed-in browser reports its user agent and feature support; the server judges it against the published baseline and counts it", "*", "ClientCheck", "ClientCheckResult", note="Stores browser family, major version and the verdict only")
ep("GET", "/admin/client-baseline", "getClientBaseline", CF, "Counts of sign-ins by browser and whether the baseline was met, with the published baseline", ["ADMIN"], None, "ClientBaselineSummary")
ep("GET", "/admin/performance/budget-check", "getBudgetCheckPerformance", PF, "Count, p50, p95 and max of the measured budget check against the configured target (NFR-P04)", ["ADMIN"], None, "BudgetCheckPerformance", query=["last"])

# B11A block
# ---------------------------------------------------------------- B11a: encryption, keys, sealed bids, upload scanning, restricted projects, evidence
# SEC-D01 evidence, SEC-D02 keys with rotation, SEC-D03 sealed bids, SEC-D04 envelope encryption, SEC-AP04 malware scanning,
# FR-0865 restricted projects, NFR-R01 / SEC-D10 isolation check. Appended to openapi_ext.py (runs in gen_openapi.py's namespace).
schemas.update({n: OBJ for n in [
    "KeyList", "KeyView", "KeyRewrapResult", "BidBox", "QuarantineList", "QuarantineRescan", "SecurityEvidence",
    "IsolationCheck", "EncryptExistingResult", "RestrictRequest", "RestrictResult", "RestrictionView", "RestrictionDelegate",
    "RestrictedProjectList",
]})
KY = "Keys"; BB = "SealedBids"; QT = "Quarantine"; EV = "SecurityEvidence"; RP = "RestrictedProjects"
KEY_READ = ["ADMIN", "PROBITY", "EXEC"]
BOX = ["ADMIN", "PROCUREMENT", "PROBITY", "EXEC", "LEGAL"]
ep("GET", "/security/keys", "listKeys", KY, "Tenant key versions per purpose (DATA, BIDS, PROJECT) with state and how many objects each protects; key material is never returned. SIMULATED key service", KEY_READ, None, "KeyList")
ep("POST", "/security/keys/{purpose}/rotate", "rotateKey", KY, "Create a new key version for the purpose; the previous version is retired but still decrypts what it sealed", ["ADMIN"], None, "KeyView", 201)
ep("POST", "/security/keys/{purpose}/rewrap", "rewrapKey", KY, "Re-wrap every data key of the purpose to the newest key version without touching a ciphertext; versions that are disabled are skipped and reported", ["ADMIN"], None, "KeyRewrapResult")
ep("POST", "/security/keys/{id}/disable", "disableKey", KY, "Disable a key version: what it protects then fails to decrypt with 'key disabled'", ["ADMIN"], None, "KeyView", note="409 LAST_ACTIVE_KEY when it is the only active key for its purpose")
ep("POST", "/security/keys/{id}/enable", "enableKey", KY, "Enable a disabled key version again (it returns as RETIRED)", ["ADMIN"], None, "KeyView")
ep("GET", "/tenders/{id}/bid-box", "getBidBox", BB, "Sealed bids: metadata only (existence, size, time, hash) until the tender closes and, for a high-value tender, two witnesses have opened it", BOX, None, "BidBox")
ep("GET", "/tenders/{id}/bid-box/files/{fileId}", "downloadBidFile", BB, "Decrypt and download a bid file; every decryption is audited", BOX, None, None, note="423 BIDS_SEALED before close, 423 BIDS_NOT_OPENED before the witnesses open a high-value tender, 403 BID_READ_NOT_PERMITTED for a role not entitled to bid content")
ep("GET", "/security/quarantine", "listQuarantine", QT, "Uploads refused as infected (no content kept) and uploads held as PENDING_SCAN; the simulated scanner's state and test signatures", ["ADMIN", "PROBITY"], None, "QuarantineList")
ep("POST", "/security/quarantine/{id}/rescan", "rescanQuarantineItem", QT, "Rescan an upload held while the scanner was down; clean items are CLEARED, infected ones quarantined", ["ADMIN"], None, "QuarantineRescan", note="409 SCANNER_DOWN while the scanner is still down")
ep("GET", "/security/evidence", "getSecurityEvidence", EV, "Encryption in transit and at rest, measured: HSTS and cookie flags, registry of encrypted fields with encrypted and plaintext row counts, key versions in use, and what is not evidenced here", KEY_READ, None, "SecurityEvidence")
ep("POST", "/security/isolation-check", "runIsolationCheck", EV, "Live tenant-isolation check: tables with tenant_id, which have row level security, and that no foreign row is visible", ["ADMIN"], None, "IsolationCheck")
ep("POST", "/security/encrypt-existing", "encryptExisting", EV, "One-off, safe to repeat: encrypt older plaintext bids and bank details and move a legal platform secret out of the settings", ["ADMIN"], None, "EncryptExistingResult")
ep("POST", "/requests/{id}/restrict", "restrictRequest", RP, "Mark a procurement as a restricted project with a reason: its plan text, report narrative and documents are encrypted with a per-project key and it is invisible outside its sourcing group", ["PROCUREMENT", "EXEC"], "RestrictRequest", "RestrictResult", 201, note="409 when already restricted")
ep("GET", "/requests/{id}/restriction", "getRestriction", RP, "The restriction on a procurement; 404 for anyone outside its sourcing group, exactly as for an id that does not exist", "*", None, "RestrictionView")
ep("POST", "/requests/{id}/restriction/delegates", "addRestrictionDelegate", RP, "Name a delegate who joins the sourcing group of a restricted project", ["PROCUREMENT", "EXEC"], "RestrictionDelegate", None, 201)
ep("GET", "/security/restricted-projects", "listRestrictedProjects", RP, "The restricted projects the caller belongs to", ["ADMIN", "PROBITY", "EXEC", "PROCUREMENT"], None, "RestrictedProjectList")

# B11B block
# ---------------------------------------------------------------- B11b (residency, egress, retention, classification, privacy, content safety, breach, topology)
schemas.update({n: OBJ for n in [
    "ResidencyView", "ResidencyChange", "ResidencyChanged", "EgressView", "EgressChange", "EgressProbe", "EgressProbeResult",
    "RetentionView", "RetentionChange", "RetentionRun", "LegalHoldCreate", "LegalHoldCreated", "LegalHoldRelease", "LegalHoldReleased",
    "ClassificationRun", "ClassificationView", "ClassificationReview", "ClassificationReviewed",
    "PrivacyNotice", "PrivacyNoticeStatus", "PrivacyNoticeAck", "PrivacyNoticeAcked", "PrivacySettings",
    "PrivacyRequestLodge", "PrivacyRequestLog", "PrivacyRequestView", "PrivacyRequestList", "PrivacyRequestAssign", "PrivacyRequestVerify",
    "PrivacyRequestComplete", "PrivacyRequestRefuse", "PrivacyOverdueRun", "PrivacyExport",
    "ContentFlags", "ContentFlagReviewed", "ContentInspect", "ContentInspectResult",
    "IncidentReport", "IncidentReported", "IncidentList", "IncidentMine", "IncidentView", "IncidentQuestions", "IncidentAssess",
    "IncidentContainment", "IncidentRemindersRun", "IncidentClose", "HostingTopology",
]})
RS = "Residency"; EG = "Egress"; RT = "Retention"; CL = "Classification"; PV = "Privacy"; CS = "ContentSafety"; IN = "Incidents"; DS = "Design"
RES_READ = ["ADMIN", "PROBITY", "EXEC"]
PRIV_MGR = ["ADMIN", "LEGAL", "PROBITY"]
INC_MGR = ["ADMIN", "PROBITY", "LEGAL", "EXEC"]
SAFETY = ["ADMIN", "PROBITY", "PROCUREMENT"]
STAFF_B11 = ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "ADMIN", "EXEC"]
ep("GET", "/admin/residency", "getResidency", RS, "The elected hosting country, allowed regions, every outbound path with its region and whether it is allowed, and recent refusals (NFR-R02, SEC-D09)", RES_READ, None, "ResidencyView")
ep("PUT", "/admin/residency", "setResidency", RS, "Change the hosting country, allowed regions, AI region or log region; a reason is required and the change is audited. Connectors now outside the allowed regions are switched off; nothing is ever switched back on", ["ADMIN"], "ResidencyChange", "ResidencyChanged", note="422 VALIDATION_FAILED without a reason; 409 NO_CHANGE")
ep("GET", "/admin/egress", "getEgress", EG, "The egress allow-list, the evidence text and the attempts blocked (SEC-D05)", RES_READ, None, "EgressView")
ep("PUT", "/admin/egress", "setEgress", EG, "Replace the egress allow-list; a reason is required, a too-broad wildcard is refused, the change is audited", ["ADMIN"], "EgressChange", "EgressView", note="422 for an invalid or too broad host pattern")
ep("POST", "/admin/egress/probe", "probeEgress", EG, "Try a host through the egress gate; a host not on the list is refused, audited and counted", ["ADMIN"], "EgressProbe", "EgressProbeResult", note="422 EGRESS_BLOCKED when the host is not on the allow-list")
ep("GET", "/privacy/retention", "getRetention", RT, "AI conversation retention setting, stamps, legal holds and recent purge runs (SEC-D06)", PRIV_MGR, None, "RetentionView")
ep("PUT", "/privacy/retention", "setRetention", RT, "Set the days an AI conversation transcript is kept (30 at least); audited", ["ADMIN"], "RetentionChange", "RetentionView", note="400 below 30 days")
ep("POST", "/privacy/retention/run", "runRetention", RT, "Anonymise expired AI conversation transcripts now; legal-hold records are skipped and the reason recorded; audit events are never touched", ["ADMIN"], None, "RetentionRun")
ep("POST", "/privacy/legal-holds", "placeLegalHold", RT, "Place a legal hold on a request or a conversation so it is never purged", PRIV_MGR, "LegalHoldCreate", "LegalHoldCreated", 201, note="409 ALREADY_HELD; 404 unknown record")
ep("POST", "/privacy/legal-holds/{id}/release", "releaseLegalHold", RT, "Release a legal hold, with a reason", PRIV_MGR, "LegalHoldRelease", "LegalHoldReleased", note="409 ALREADY_RELEASED")
ep("POST", "/privacy/classification/run", "runClassification", CL, "Scan the text-bearing tables and classify what is found; idempotent; stores masked samples only (SEC-D07)", ["ADMIN", "PROBITY"], None, "ClassificationRun")
ep("GET", "/privacy/classification", "getClassification", CL, "Findings summarised by class and location, with warnings for sensitive data in unexpected places", ["PROBITY", "ADMIN", "LEGAL", "EXEC"], None, "ClassificationView", query=["status", "class", "warningsOnly"])
ep("POST", "/privacy/classification/{id}/review", "reviewClassification", CL, "Confirm or dismiss a finding, with a reason", ["ADMIN", "PROBITY", "LEGAL"], "ClassificationReview", "ClassificationReviewed")
ep("GET", "/privacy/notice", "getPrivacyNotice", PV, "The collection notice and its version for a place where personal information is collected (SEC-D08)", None, None, "PrivacyNotice", query=["context"])
ep("GET", "/privacy/notice/status", "getPrivacyNoticeStatus", PV, "Which places the signed-in person has acknowledged the current notice version", "*", None, "PrivacyNoticeStatus")
ep("POST", "/privacy/notice/ack", "acknowledgePrivacyNotice", PV, "Record that the signed-in person acknowledged the current notice version in a place", "*", "PrivacyNoticeAck", "PrivacyNoticeAcked", 201, note="200 when already acknowledged")
ep("GET", "/privacy/settings", "getPrivacySettings", PV, "Notice text and version, privacy officer role and response days", PRIV_MGR, None, "PrivacySettings")
ep("PUT", "/privacy/settings", "setPrivacySettings", PV, "Change the notice, officer role and response days; audited", ["ADMIN"], "PrivacySettings", "PrivacySettings")
ep("POST", "/privacy/requests", "lodgePrivacyRequest", PV, "Lodge an access or correction request about yourself; identity is verified because you are signed in (staff or supplier contact)", "*", "PrivacyRequestLodge", "PrivacyRequestView", 201)
ep("GET", "/privacy/requests/mine", "listMyPrivacyRequests", PV, "Your own privacy requests and their state", "*", None, "PrivacyRequestList")
ep("GET", "/privacy/requests", "listPrivacyRequests", PV, "All privacy requests with due dates and overdue flags", PRIV_MGR, None, "PrivacyRequestList", query=["status"])
ep("POST", "/privacy/requests/log", "logPrivacyRequest", PV, "Log a request taken from a caller; staff record how identity was verified", PRIV_MGR, "PrivacyRequestLog", "PrivacyRequestView", 201)
ep("POST", "/privacy/requests/run-overdue", "escalateOverduePrivacyRequests", PV, "Escalate each overdue request once to the privacy officer role", PRIV_MGR, None, "PrivacyOverdueRun")
ep("POST", "/privacy/requests/{id}/assign", "assignPrivacyRequest", PV, "Take or assign a request; moves it to IN_PROGRESS", PRIV_MGR, "PrivacyRequestAssign", "PrivacyRequestView", note="409 when closed")
ep("POST", "/privacy/requests/{id}/verify", "verifyPrivacyRequest", PV, "Record how the requester's identity was verified", PRIV_MGR, "PrivacyRequestVerify", "PrivacyRequestView")
ep("POST", "/privacy/requests/{id}/apply-correction", "applyPrivacyCorrection", PV, "Apply the requested correction to the person's profile with a before and after audit", PRIV_MGR, None, "PrivacyRequestView", note="409 IDENTITY_NOT_VERIFIED, ALREADY_APPLIED or EMAIL_IN_USE")
ep("POST", "/privacy/requests/{id}/complete", "completePrivacyRequest", PV, "Complete a request with a response summary", PRIV_MGR, "PrivacyRequestComplete", "PrivacyRequestView", note="409 until identity is verified and the export or correction is done")
ep("POST", "/privacy/requests/{id}/refuse", "refusePrivacyRequest", PV, "Refuse a request; a reason is required", PRIV_MGR, "PrivacyRequestRefuse", "PrivacyRequestView")
ep("GET", "/privacy/requests/{id}/export", "exportPrivacyRequest", PV, "The person's own records as a JSON download; managers any time after verification, the requester once the request is completed", "*", None, "PrivacyExport", note="application/json attachment; 404 for anyone else; 409 until verified or completed")
ep("GET", "/content-safety/flags", "listContentFlags", CS, "Recent supplier or uploaded text that contained instruction-like content (SEC-AP08)", SAFETY, None, "ContentFlags")
ep("POST", "/content-safety/flags/{id}/review", "reviewContentFlag", CS, "Mark a flag reviewed", SAFETY, None, "ContentFlagReviewed")
ep("POST", "/content-safety/inspect", "inspectContent", CS, "Show how a piece of text would be neutralised, wrapped as data and flagged", SAFETY, "ContentInspect", "ContentInspectResult")
ep("POST", "/incidents/report", "reportIncident", IN, "Report a suspected data breach; any staff member (SEC-IR05)", STAFF_B11, "IncidentReport", "IncidentReported", 201)
ep("GET", "/incidents/mine", "listMyIncidents", IN, "Incidents you reported", STAFF_B11, None, "IncidentMine")
ep("GET", "/incidents/questions", "getIncidentQuestions", IN, "The assessment questions and the rule set (rules-simulated-v1; decision support, not legal advice)", INC_MGR, None, "IncidentQuestions")
ep("GET", "/incidents", "listIncidents", IN, "All incidents with deadlines and recommendations", INC_MGR, None, "IncidentList")
ep("POST", "/incidents/run-reminders", "runIncidentReminders", IN, "Remind, then escalate, incidents whose 30-day assessment is outstanding", INC_MGR, None, "IncidentRemindersRun")
ep("GET", "/incidents/{id}", "getIncident", IN, "One incident in full: assessment, containment, notice drafts, reminders", INC_MGR, None, "IncidentView")
ep("POST", "/incidents/{id}/assess", "assessIncident", IN, "Answer the likelihood-of-serious-harm questions; returns a score and a recommendation of Notifiable or Not notifiable (record the reason)", INC_MGR, "IncidentAssess", "IncidentView", note="422 unless every question is answered")
ep("POST", "/incidents/{id}/containment", "setIncidentContainment", IN, "Tick or untick a containment step", INC_MGR, "IncidentContainment", "IncidentView")
ep("POST", "/incidents/{id}/notifications/{audience}/draft", "draftIncidentNotice", IN, "Draft the notice to the regulator or to affected individuals from a template with merge fields; audience is REGULATOR or INDIVIDUALS", INC_MGR, None, "IncidentView", note="409 unless assessed as Notifiable")
ep("POST", "/incidents/{id}/notifications/{audience}/send", "sendIncidentNotice", IN, "Send a drafted notice. SIMULATED through the MESSAGING connector: a record is kept, nothing is sent", INC_MGR, None, "IncidentView", note="422 RESIDENCY_VIOLATION or EGRESS_BLOCKED when the gateway is outside the allowed regions; 409 without a draft")
ep("POST", "/incidents/{id}/close", "closeIncident", IN, "Close the incident with lessons learned", INC_MGR, "IncidentClose", "IncidentView", note="409 until notified (Notifiable) or the reason is recorded (Not notifiable)")
ep("GET", "/design/hosting-topology", "getHostingTopology", DS, "The three hosting options with data flows, responsibilities, residency and key management. DESIGN ONLY: not built (SEC-D11)", STAFF_B11, None, "HostingTopology")

# B11C block
# ---------------------------------------------------------------- B11c (audit chain, evidence pack, anomalous access, compliance, access policies, bank details)
schemas.update({n: OBJ for n in [
    "AdminChainStatus", "AdminChainVerified",
    "PackCoverage", "PackRequest", "PackBundle", "PackVerifyRequest", "PackVerification",
    "SecurityAlertList", "SecurityAlertView", "SecurityAlertNote", "SecurityAlertClose", "SecurityAlertSessionsEnded",
    "MonitorRun", "MonitorStatus",
    "ComplianceView", "ComplianceRun", "ComplianceRemediate", "ComplianceRemediated",
    "AccessPolicyList", "AccessPolicyCreate", "AccessPolicyView", "AccessPolicyReason", "AccessPolicySimulate", "AccessPolicySimulation",
    "AccessTagList", "AccessTagCreate", "AccessTagView", "AccessTagRemoved",
    "SupplierBankView", "OwnBankView", "BankChangeRequest", "BankChangeView", "BankChangeList", "BankChangeConfirm", "BankChangeReject",
]})
AUD = "AuditIntegrity"; PK = "EvidencePack"; MON = "SecurityMonitor"; CMP = "Compliance"; POL = "AccessPolicies"; BNK = "BankDetails"
CHAIN_READ = ["PROBITY", "EXEC", "ADMIN"]
ALERT_ROLES = ["ADMIN", "PROBITY", "EXEC"]
BANK_VIEW = ["PROCUREMENT", "LEGAL", "FINANCE", "ADMIN", "EXEC", "PROBITY", "CONTRACT_MGR", "DELEGATE"]
BANK_LIST = ["FINANCE", "PROCUREMENT", "ADMIN", "EXEC", "PROBITY"]
ep("GET", "/audit/admin-chain", "getAdminChain", AUD, "Re-computes the whole tenant hash chain, reports the first broken link, the administrative-event count, head hash and digest, the database guards and the latest recorded verification (SEC-L02)", CHAIN_READ, None, "AdminChainStatus", note="Readable by probity and executives as well as administrators, so administrators are not the only verifiers")
ep("POST", "/audit/admin-chain/verify", "verifyAdminChain", AUD, "Runs the same verification and keeps the outcome as an append-only record and an audit event", CHAIN_READ, None, "AdminChainVerified")
ep("GET", "/audit/export-pack/coverage", "getPackCoverage", PK, "What an external auditor would look for on one procurement, pass or fail per item computed from the data (NFR-R06)", CHAIN_READ, None, "PackCoverage", query=["requestId"], note="404 for an unknown procurement")
ep("POST", "/audit/export-pack", "createExportPack", PK, "An evidence pack for a date range and optionally one procurement: audit events as the hash-chain segment, probity records, coverage, manifest with SHA-256 per file, head hash and a signature. SIMULATED signature (HMAC with the secret audit.export.signing); a real deployment signs with an asymmetric key in an HSM (SEC-L07)", CHAIN_READ, "PackRequest", "PackBundle", note="format JSON returns a bundle file, ZIP returns application/zip; 422 EXPORT_TOO_LARGE over 20000 events; recorded in the audit trail")
ep("POST", "/audit/export-pack/verify", "verifyExportPack", PK, "Checks a pack (bundle JSON or base64 zip): every file against the manifest, the signature, every event hash and link, the head hash, and each event against the live chain; names the parts that fail", ["PROBITY", "EXEC", "ADMIN", "LEGAL"], "PackVerifyRequest", "PackVerification")
ep("GET", "/security/alerts", "listSecurityAlerts", MON, "Alerts raised by the access monitor (rules-simulated-v1) and by configuration drift, newest first, with the owner it was routed to (SEC-L06)", ALERT_ROLES, None, "SecurityAlertList", query=["status", "limit"])
ep("POST", "/security/alerts/{id}/acknowledge", "acknowledgeSecurityAlert", MON, "Acknowledge an alert; an alert nobody acknowledges within the configured minutes is escalated to the executives", ALERT_ROLES, "SecurityAlertNote", "SecurityAlertView", note="409 when closed")
ep("POST", "/security/alerts/{id}/close", "closeSecurityAlert", MON, "Close an alert with a note of at least five characters", ALERT_ROLES, "SecurityAlertClose", "SecurityAlertView", note="409 when already closed")
ep("POST", "/security/alerts/{id}/end-sessions", "endSecurityAlertSessions", MON, "Ends every session of the person the alert is about so they must sign in again; the account is never locked; audited", ["ADMIN", "PROBITY"], "SecurityAlertNote", "SecurityAlertSessionsEnded", note="409 NO_SUBJECT for a configuration alert; 409 OWN_SESSIONS")
ep("POST", "/security/monitor/run", "runSecurityMonitor", MON, "Flushes the access log, applies the rules, raises alerts, escalates what is due and trims the log", ALERT_ROLES, None, "MonitorRun")
ep("GET", "/security/monitor/status", "getSecurityMonitorStatus", MON, "The rules and thresholds, the security owner, the last run and 24 hours of access-log counts", ALERT_ROLES, None, "MonitorStatus")
ep("GET", "/compliance", "getCompliance", CMP, "The configuration checks with their last result, since when a check has been failing, guidance and whether a one-click fix exists (SEC-L08)", ALERT_ROLES, None, "ComplianceView")
ep("POST", "/compliance/run", "runCompliance", CMP, "Runs every check now; a check that passed and now fails raises a security alert for the security owner", ALERT_ROLES, None, "ComplianceRun")
ep("POST", "/compliance/checks/{key}/remediate", "remediateComplianceCheck", CMP, "Applies the one safe settings change for a failing check, with a reason; audited like any settings change, then the checks run again", ["ADMIN"], "ComplianceRemediate", "ComplianceRemediated", note="409 NO_ONE_CLICK for guidance-only checks; 409 ALREADY_PASSING; 404 unknown check")
ep("GET", "/access/policies", "listAccessPolicies", POL, "Access policies that override the default hierarchy (SEC-AC09)", ALERT_ROLES, None, "AccessPolicyList", query=["includeInactive"])
ep("POST", "/access/policies", "createAccessPolicy", POL, "Create a DENY or ALLOW policy for a role or a person, an action, a resource selector and conditions, with a reason and an optional expiry; an explicit DENY always wins", ["ADMIN"], "AccessPolicyCreate", "AccessPolicyView", 201, note="400 for an unknown role or person or an expiry in the past")
ep("POST", "/access/policies/{id}/disable", "disableAccessPolicy", POL, "Switch a policy off, with a reason", ["ADMIN"], "AccessPolicyReason", "AccessPolicyView", note="409 when already off")
ep("DELETE", "/access/policies/{id}", "deleteAccessPolicy", POL, "Delete a policy, with a reason; the record stays for the audit trail", ["ADMIN"], "AccessPolicyReason", "AccessPolicyView", note="409 when already deleted")
ep("POST", "/access/policies/simulate", "simulateAccessPolicy", POL, "What can this person see: the decision for a person, a procurement and an action, which policy decided and why each policy did or did not apply", ALERT_ROLES, "AccessPolicySimulate", "AccessPolicySimulation")
ep("GET", "/access/tags", "listAccessTags", POL, "Tags on procurements that policies can select on", ALERT_ROLES, None, "AccessTagList")
ep("POST", "/access/tags", "addAccessTag", POL, "Tag a procurement, for example hr-sensitive", ["ADMIN"], "AccessTagCreate", "AccessTagView", 201, note="409 ALREADY_TAGGED")
ep("DELETE", "/access/tags/{id}", "removeAccessTag", POL, "Remove a tag", ["ADMIN"], None, "AccessTagRemoved")
ep("GET", "/suppliers/{id}/bank", "getSupplierBank", BNK, "A supplier's bank details: unmasked only for finance (and every unmasked read is audited); every other role sees the BSB hidden and the last three digits of the account (SEC-AC10)", BANK_VIEW, None, "SupplierBankView")
ep("GET", "/supplier/profile/bank", "getOwnBank", "SupplierPortal", "The supplier's own bank details, unmasked, and whether a change is waiting for finance", ["SUPPLIER"], None, "OwnBankView")
ep("POST", "/suppliers/{id}/bank-change", "requestBankChange", BNK, "Staff ask for a change to a supplier's bank details; held PENDING, the old details stay in force until a different finance person confirms", ["FINANCE", "PROCUREMENT"], "BankChangeRequest", "BankChangeView", 201)
ep("GET", "/bank-changes", "listBankChanges", BNK, "Bank detail changes waiting for finance (or by status); details are masked for everyone but finance", BANK_LIST, None, "BankChangeList", query=["status"])
ep("POST", "/bank-changes/{id}/confirm", "confirmBankChange", BNK, "Confirm a change; never the person who asked for it", ["FINANCE"], "BankChangeConfirm", "BankChangeView", note="403 SECOND_PERSON when the caller asked for it; 409 when already decided")
ep("POST", "/bank-changes/{id}/reject", "rejectBankChange", BNK, "Reject a change with a note; details recorded for the first time are taken out again", ["FINANCE"], "BankChangeReject", "BankChangeView", note="403 SECOND_PERSON; 409 when already decided")

# B11D block
# ---------------------------------------------------------------- B11d: signature levels, outside content, ESG plan targets, tenants
# NFR-L03 signature levels aligned to eIDAS (SES, AES, QES), NFR-R03 field population from in-house data and refreshed outside
# content, NFR-R05 ESG and socio-economic plan data with ceilings and ratios checked, NFR-SC01 tenants, usage plans, per-tenant
# throttling and metering. Appended to openapi_ext.py (runs in gen_openapi.py's namespace). Roles match the guards in
# apps/api/src/modules/b11prod/*-routes.ts exactly.
schemas.update({n: OBJ for n in [
    "SignatureLevelCard", "SignatureLevelOverride", "SignatureEvidenceExport",
    "ContentPacks", "ContentRefresh", "ContentRefreshResult", "ContentItems", "ContentHints",
    "EsgTargets", "EsgTargetUpdate", "EsgException", "EsgAcknowledge",
    "UsageView", "OperatorTenantList", "OperatorTenantCreate", "OperatorTenantCreated", "OperatorPlanChange", "OperatorPlanChanged",
]})
# the sign decision may carry how the signer proves who they are; the level it reaches is recorded on the signature
schemas["ContractSignRequest"] = obj({
    "decision": enum("APPROVE", "REJECT"),
    "comment": S,
    "method": enum("PASSWORD", "PASSWORD_MFA"),
    "password": {"type": "string", "maxLength": 128},
    "mfaCode": {"type": "string", "maxLength": 10},
}, ["decision"])
for _e in E:
    if _e["op"] == "signContract":
        _e["req"] = "ContractSignRequest"
        _e["note"] += "; 422 SIGNATURE_LEVEL_TOO_LOW when the signature reaches a lower eIDAS level (SES, AES, QES) than the contract needs; 403 SIGNATURE_REAUTH_FAILED for a wrong password or authenticator code. method PASSWORD_MFA signs at AES; a provider ceremony through the qualified provider signs at QES"
# an optional tenant short name on sign-in; the default organisation is used when it is left out
schemas["LoginRequest"]["properties"]["tenant"] = {"type": "string", "minLength": 1, "maxLength": 60}

SG = "SignatureLevels"; CT = "OutsideContent"; EG = "EsgTargets"; TN = "Tenants"
SG_READ = ["PROCUREMENT", "LEGAL", "CONTRACT_MGR", "DELEGATE", "EXEC", "FINANCE", "PROBITY", "ADMIN"]
ep("GET", "/contracts/{id}/signature-level", "getContractSignatureLevel", SG, "The eIDAS level this contract needs and why (Legal's override, a value tier or the default), the level each signature reached with its non-repudiation evidence, whether the signed content is unchanged, and an explainer of the three levels", SG_READ, None, "SignatureLevelCard", note="A signatory in blind signing sees only their own line until the contract is executed")
ep("PUT", "/contracts/{id}/signature-level", "setContractSignatureLevel", SG, "Legal sets the level a contract needs (SES, AES or QES) with a reason, over the value tiers in settings; null clears the override. Audited", ["LEGAL"], "SignatureLevelOverride", "SignatureLevelCard", note="400 when the reason is under 10 characters; 423 once the contract is executed and locked")
ep("GET", "/contracts/{id}/signature-evidence", "exportSignatureEvidence", SG, "Non-repudiation evidence for each signature: signer, method, level, time, SHA-256 document digest, IP address and browser class, and whether the contract still matches what was signed. Audited as an export", SG_READ, None, "SignatureEvidenceExport", note="application/json attachment")
CT_READ = ["PROCUREMENT", "ADMIN", "LEGAL", "EXEC"]
CT_RUN = ["ADMIN", "PROCUREMENT"]
ep("GET", "/content", "listContentPacks", CT, "The outside content packs (UNSPSC taxonomy, market benchmarks, risk library, clause references, ESG reference): version, source name and URL, refreshed and valid-until dates, state CURRENT, STALE, FAILED or NONE, item count, checksum, what the last refresh changed, and the in-house fallback note. The outside source is simulated", CT_READ, None, "ContentPacks")
ep("GET", "/content/{key}/items", "listContentItems", CT, "The items of one pack (the path key is the pack kind)", CT_READ, None, "ContentItems", note="400 for a kind that is not one of the five")
ep("POST", "/content/refresh", "refreshContent", CT, "Refresh one pack or all of them now, through the resilient provider layer (middleware connector). Applying the same release twice changes nothing; a failed call keeps what is held. toVersion is a demonstration control and never moves backwards", CT_RUN, "ContentRefresh", "ContentRefreshResult", note="422 VERSION_OLDER or VERSION_UNAVAILABLE")
ep("GET", "/requests/{id}/content-hints", "getRequestContentHints", CT, "What in-house data and the outside packs suggest for a request: classification code, market price benchmark and standard risks, each with its source (In-house, Outside content with name and version, or both) and a note when a pack is stale and only in-house data was used", ["REQUESTER", "PROCUREMENT", "LEGAL", "DELEGATE", "EXEC", "PROBITY", "CONTRACT_MGR"], None, "ContentHints", note="A requester sees only their own requests")
EG_READ = ["REQUESTER", "PROCUREMENT", "DELEGATE", "LEGAL", "PROBITY", "EXEC", "FINANCE"]
ep("GET", "/plans/{id}/esg-targets", "getPlanEsgTargets", EG, "The nine ESG and socio-economic metrics of a plan: limit and organisation default, figure and where it came from (awarded contracts and declared supplier ESG data, or the owner's forecast), PASS, AT RISK or BREACH with the arithmetic, any exception, and the plan gate state", EG_READ, None, "EsgTargets", note="A requester sees only their own plans")
ep("PUT", "/plans/{id}/esg-targets/{key}", "updatePlanEsgTarget", EG, "Set a plan's own limit (looser than the organisation's only within the allowed relaxation, with a reason and an approver note), reset it, or enter a forecast. Changing the limit or forecast withdraws an exception. Audited", ["PROCUREMENT", "REQUESTER"], "EsgTargetUpdate", "EsgTargets", note="422 ESG_OVERRIDE_NEEDS_REASON or ESG_OVERRIDE_OUT_OF_BOUNDS; 423 once the plan is locked; the path key is the metric key")
ep("POST", "/plans/{id}/esg-targets/{key}/exception", "recordEsgException", EG, "Procurement records why a metric in breach should go ahead; the delegates are told", ["PROCUREMENT"], "EsgException", "EsgTargets", note="409 NOT_IN_BREACH; 423 once the plan is locked")
ep("POST", "/plans/{id}/esg-targets/{key}/acknowledge", "acknowledgeEsgException", EG, "A delegate acknowledges the exception; with every breach acknowledged the ESG ceilings gate is satisfied and the plan moves on. Not the person who raised the request", ["DELEGATE", "EXEC"], "EsgAcknowledge", "EsgTargets", note="409 NO_EXCEPTION or ALREADY_ACKNOWLEDGED; 403 SOD_VIOLATION")
ep("POST", "/plans/{id}/esg-targets/apply-bids", "applyBidsToEsgForecast", EG, "Use the lowest-priced submitted bid's declared ESG data as the starting forecast for each metric (indicative only; the awarded contract replaces it)", ["PROCUREMENT"], None, "EsgTargets", note="409 NO_BIDS when there are no submitted bids or the contract is already awarded")
ep("GET", "/usage", "getTenantUsage", TN, "The organisation's usage plan and limits (requests per minute and burst, daily requests, monthly AI calls, storage, users) with today's requests and refused requests, the month's AI calls and the last week", ["ADMIN"], None, "UsageView", note="Counts are batched and written first when this is read")
OP_NOTE = "Public as far as sessions go: no cookie and no CSRF token. The only credential is the X-Operator-Token header, compared in constant time with the OPERATOR_TOKEN setting (at least 24 characters). When OPERATOR_TOKEN is not set these endpoints do not exist (404). Limited per client address. 401 OPERATOR_TOKEN_INVALID for a missing or wrong token"
ep("GET", "/operator/tenants", "operatorListTenants", TN, "Platform operator: every tenant with its plan, active users and today's use, and the available usage plans", None, None, "OperatorTenantList", note=OP_NOTE)
ep("POST", "/operator/tenants", "operatorCreateTenant", TN, "Platform operator: create a tenant with its short name, a first ADMIN user and a usage plan. The first administrator's one-time password is in the response once; only its hash is kept", None, "OperatorTenantCreate", "OperatorTenantCreated", 201, note=OP_NOTE + "; 409 TENANT_EXISTS; 422 UNKNOWN_PLAN")
ep("PATCH", "/operator/tenants/{id}/plan", "operatorChangeTenantPlan", TN, "Platform operator: move a tenant to another usage plan; the new limits apply to the next request and the change is audited in the tenant's log", None, "OperatorPlanChange", "OperatorPlanChanged", note=OP_NOTE + "; 404 unknown tenant; 422 UNKNOWN_PLAN (also for a plan made for another tenant)")
