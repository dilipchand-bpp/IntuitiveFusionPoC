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
