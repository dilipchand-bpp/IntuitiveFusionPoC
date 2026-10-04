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
