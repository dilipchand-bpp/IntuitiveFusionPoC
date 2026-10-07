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
