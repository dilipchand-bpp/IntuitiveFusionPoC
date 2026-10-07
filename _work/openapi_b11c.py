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
