p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\_work\gen_openapi.py'
t = open(p, encoding='utf8', newline='').read()


def sub(a, b):
    global t
    assert a in t, a[:80]
    t = t.replace(a, b, 1)


D = '{"type": "string", "format": "date"}'
RISK = 'enum("LOW", "MEDIUM", "HIGH")'

# ---- schemas
sub(' "ContractDeviation": obj({"clauseId": S, "title": S, "mandatory": B, "templateText": S, "currentText": S}, ["clauseId", "templateText", "currentText"]),',
    ' "ContractDeviation": obj({"clauseId": S, "title": S, "mandatory": B, "risk": ' + RISK + ', "decision": {"type": "string", "nullable": True, "enum": ["APPROVED", "REJECTED", None]}, "decidedBy": S, "stamp": S, "templateText": S, "currentText": S}, ["clauseId", "templateText", "currentText"]),\n'
    ' "ContractMilestones": obj({"milestones": arr(obj({"title": S, "dueDate": ' + D + '}, ["title", "dueDate"]))}, ["milestones"]),\n'
    ' "ContractExtensions": obj({"extensions": arr({"type": "integer", "minimum": 1, "maximum": 60})}, ["extensions"]),\n'
    ' "ContractOwner": obj({"ownerId": UUID}, ["ownerId"]),\n'
    ' "VariationCreate": obj({"reason": {"type": "string", "minLength": 10, "maxLength": 1000}, "value": {"type": "number", "minimum": 0}, "endDate": ' + D + '}, ["reason", "value"]),\n'
    ' "DeviationRisk": obj({"risk": ' + RISK + '}, ["risk"]),\n'
    ' "AlertCreated": obj({"id": UUID, "kind": S, "triggerDate": ' + D + ', "recipientRule": S, "status": S, "origin": S, "note": S, "summary": S}, ["id", "triggerDate"]),')
sub('"permissions": ref("ContractPermissions")}, ["id", "number", "status"]),',
    '"permissions": ref("ContractPermissions"), "parent": obj({"id": UUID, "number": S}), "variations": arr(obj({"id": UUID, "number": S, "status": S, "value": N, "endDate": ' + D + '})), "cumulative": obj({"value": N, "endDate": ' + D + '}), "deviationBlockers": arr(S)}, ["id", "number", "status"]),')
sub('"ContractPermissions": obj({"canEdit": B,', '"ContractPermissions": obj({"canDecideDeviations": B, "canAmendRisk": B, "canVary": B, "canEditRecord": B, "canEdit": B,')
sub(' "Delegation": obj({"id": UUID, "role": S,', ' "Delegation": obj({"id": UUID, "userId": UUID, "userName": S, "role": S,')
sub(' "AdminUser": obj({"id": UUID, "name": S, "email": S, "role": enum(*ROLES), "orgUnit": S, "active": B}, ["id", "name", "email", "role"]),',
    ' "AdminUser": obj({"id": UUID, "name": S, "email": S, "roles": arr(enum(*ROLES)), "orgUnit": S, "active": B}, ["id", "name", "email", "roles"]),\n'
    ' "DelegationCreate": obj({"scope": enum("SOURCING_APPROVAL", "CONTRACT_SIGNING", "PUBLISH_PERMISSION"), "userId": UUID, "role": enum(*ROLES), "maxValue": {"type": "number", "minimum": 0}, "division": S}, ["scope", "maxValue"]),\n'
    ' "AlertSettings": obj({"expiry": {"type": "integer", "minimum": 1, "maximum": 365}, "notice": {"type": "integer", "minimum": 1, "maximum": 365}, "extension": {"type": "integer", "minimum": 1, "maximum": 365}, "milestone": {"type": "integer", "minimum": 1, "maximum": 365}}, ["expiry", "notice", "extension", "milestone"]),\n'
    ' "VarianceLimit": obj({"limitPct": {"type": "integer", "minimum": 5, "maximum": 60}}, ["limitPct"]),\n'
    ' "ProbitySignoff": obj({"comment": {"type": "string", "maxLength": 1000}}),\n'
    ' "SupplierContact": obj({"id": UUID, "name": S, "email": S, "active": B, "awaitingActivation": B}, ["id", "name", "email"]),\n'
    ' "SupplierProfile": obj({"id": UUID, "company": S, "abn": S, "sanctionsStatus": S, "insuranceStatus": S, "lastCheckedAt": DT, "contacts": arr(ref("SupplierContact")), "tenders": arr(obj({"tenderId": UUID, "number": S, "title": S, "submission": S})), "contracts": arr(obj({"id": UUID, "number": S, "status": S, "value": N})), "canAddContact": B}, ["id", "company"]),\n'
    ' "SupplierContactCreate": obj({"name": S, "email": {"type": "string", "format": "email"}}, ["name", "email"]),\n'
    ' "SupplierContactAdded": obj({"contact": ref("SupplierContact"), "activationPath": S, "expiresAt": DT}, ["contact", "activationPath"]),\n'
    ' "ActivationInfo": obj({"name": S, "email": S, "company": S, "organisation": S, "expiresAt": DT}),\n'
    ' "ActivationRequest": obj({"token": S, "password": {"type": "string", "minLength": 12}}, ["token", "password"]),\n'
    ' "WorkloadReport": obj({"today": ' + D + ', "owners": arr(obj({"ownerId": UUID, "ownerName": S, "procurements": I, "value": N, "byPhase": {"type": "object", "additionalProperties": {"type": "integer"}}})), "timeline": arr(obj({"requestId": UUID, "number": S, "title": S, "owner": S, "phase": S, "bars": arr(ref("TermBar"))})), "note": S}, ["owners", "timeline"]),')
sub('"SpendReport": obj({"byCategory": arr(obj({"category": S, "pipeline": N, "committed": N})), "totalPipeline": N, "totalCommitted": N, "note": S}, ["byCategory", "totalPipeline", "totalCommitted"]),',
    '"SpendReport": obj({"byCategory": arr(obj({"category": S, "pipeline": N, "committed": N, "items": arr(obj({"kind": enum("REQUEST", "CONTRACT"), "number": S, "title": S, "supplier": S, "value": N}))})), "bySupplier": arr(obj({"supplierId": UUID, "company": S, "committed": N, "contracts": I, "share": N})), "offContract": arr(obj({"requestId": UUID, "number": S, "title": S, "category": S, "value": N, "phase": S})), "totalPipeline": N, "totalCommitted": N, "totalOffContract": N, "note": S}, ["byCategory", "bySupplier", "offContract", "totalPipeline", "totalCommitted"]),')
sub('"steps": obj({"intake": B, "plan": B, "tender": B, "evaluation": B, "contract": B})', '"evaluationId": UUID, "steps": obj({"intake": B, "plan": B, "tender": B, "evaluation": B, "contract": B})')

# ---- operations
sub('ep("PUT", "/contracts/{id}/clauses/{clauseId}"', '''ep("PUT", "/contracts/{id}/milestones", "setContractMilestones", C, "Replace the milestones of an executed contract (within its term); scheduled reminders follow", ["CONTRACT_MGR", "LEGAL", "PROCUREMENT"], "ContractMilestones", "Contract", note="422 MILESTONE_OUTSIDE_TERM")
ep("PUT", "/contracts/{id}/extensions", "setContractExtensions", C, "Replace the optional extensions (months) of an executed contract", ["CONTRACT_MGR", "LEGAL", "PROCUREMENT"], "ContractExtensions", "Contract")
ep("PUT", "/contracts/{id}/owner", "setContractOwner", C, "Change the contract owner to a contract manager", ["CONTRACT_MGR", "LEGAL", "PROCUREMENT"], "ContractOwner", "Contract", note="422 NOT_A_CONTRACT_MANAGER")
ep("POST", "/contracts/{id}/variations", "createVariation", C, "Create a variation of an executed contract: a child contract with cumulative value tracking, drafted, reviewed and signed like any contract", ["LEGAL", "PROCUREMENT"], "VariationCreate", "Contract", 201, note="409 VARIATION_OPEN; 422 EMPTY_VARIATION; signing authority is judged on the cumulative value")
ep("PUT", "/contracts/{id}/deviations/{clauseId}/risk", "setDeviationRisk", C, "Legal amends the proposed risk rating of a deviation", ["LEGAL"], "DeviationRisk", "Contract")
ep("POST", "/contracts/{id}/deviations/{clauseId}/decision", "decideDeviation", C, "A delegate approves or rejects a deviation; a mandatory or high-risk change must be approved before release", ["DELEGATE", "EXEC"], "Decision", "Contract")
ep("PUT", "/contracts/{id}/clauses/{clauseId}"''')
sub('ep("POST", "/contracts/{id}/alerts", "createAlert", C, "Create alert from plain-language instruction", ["CONTRACT_MGR"], "AlertCreate", "Alert", 201)',
    'ep("POST", "/contracts/{id}/alerts", "createAlert", C, "Create a custom alert from a plain-language instruction such as: alert me 1 year before expiry and include whoever is my manager then. The recipients are resolved when it fires", ["CONTRACT_MGR", "PROCUREMENT", "LEGAL", "EXEC"], "AlertCreate", "AlertCreated", 201, note="422 ALERT_NOT_UNDERSTOOD explains what to type")')
sub('ep("GET", "/admin/users", "adminListUsers", AD, "List users", ["ADMIN"], None, "AdminUser", arrayResp=True)', 'ep("GET", "/admin/users", "adminListUsers", AD, "List staff users with their roles (read only; suppliers are not listed)", ["ADMIN"], None, "AdminUser", arrayResp=True)')
sub('ep("PUT", "/admin/delegations/{id}", "updateDelegation", AD, "Change threshold; audited", ["ADMIN"], "DelegationUpdate", "Delegation")',
    'ep("POST", "/admin/delegations", "createDelegation", AD, "Grant a limit to a person (or role); audited; applies to the next approval or signature", ["ADMIN"], "DelegationCreate", "Delegation", 201, note="409 DELEGATION_EXISTS; 403 for oneself")\nep("PUT", "/admin/delegations/{id}", "updateDelegation", AD, "Change a threshold or switch it off; audited; effective immediately; the person is notified", ["ADMIN"], "DelegationUpdate", "Delegation")\nep("GET", "/admin/alert-settings", "getAlertSettings", AD, "Contract alert lead times in days", ["ADMIN"], None, "AlertSettings")\nep("PUT", "/admin/alert-settings", "setAlertSettings", AD, "Change the lead times; scheduled alerts of executed contracts move at once; audited", ["ADMIN"], "AlertSettings", "AlertSettings")')
sub('ep("GET", "/suppliers/{id}", "getSupplier", SP, "Supplier profile with sanctions/insurance status", ["PROCUREMENT", "LEGAL", "FINANCE", "ADMIN"], None, "Supplier")',
    'ep("GET", "/suppliers", "listSuppliers", SP, "Supplier directory with sanctions and insurance status", ["PROCUREMENT", "LEGAL", "FINANCE", "ADMIN"], None, "Supplier", arrayResp=True)\nep("GET", "/suppliers/{id}", "getSupplier", SP, "Supplier profile: status, contacts, tenders bid on, contracts held", ["PROCUREMENT", "LEGAL", "FINANCE", "ADMIN"], None, "SupplierProfile")\nep("POST", "/suppliers/{id}/contacts", "addSupplierContact", SP, "A buyer adds a contact to an existing supplier; returns a one-time activation link (no email is sent in the proof of concept)", ["PROCUREMENT"], "SupplierContactCreate", "SupplierContactAdded", 201, note="409 EMAIL_IN_USE")\nep("GET", "/supplier/activate/{token}", "getActivation", SP, "Look up an activation link (one generic 404 for unknown, used or expired)", None, None, "ActivationInfo")\nep("POST", "/supplier/activate", "activateContact", SP, "Set a password with a one-time activation link", None, "ActivationRequest", "Message")')
sub('ep("POST", "/evaluations/{id}/consensus/reopen"', '''ep("PUT", "/evaluations/{id}/variance-limit", "setVarianceLimit", V, "Chair sets the variance limit (5 to 60 percent) before consensus opens", ["CHAIR"], "VarianceLimit", "Evaluation", note="409 once consensus has opened")
ep("POST", "/evaluations/{id}/probity-signoff", "probitySignoff", V, "Probity advisor records that the process was followed (after the lock); a record, not a gate on the award", ["PROBITY"], "ProbitySignoff", "Evaluation", note="409 before the lock or if already signed off")
ep("GET", "/evaluations/{id}/report/docx", "exportReportDocx", V, "The evaluation report as a Word document (same content as the PDF)", ["PROCUREMENT", "DELEGATE", "EXEC", "PROBITY", "LEGAL", "CHAIR"], None, None, note="404 until a report exists")
ep("POST", "/evaluations/{id}/consensus/reopen"''')
sub('ep("GET", "/reports/spend", "spendReport", G,', 'ep("GET", "/reports/workload", "workloadReport", G, "Procurements and value per owner, and a timeline of each active procurement", ["PROCUREMENT", "EXEC"], None, "WorkloadReport")\nep("GET", "/reports/spend", "spendReport", G,')
sub('"Spend by category: pipeline (active requests) and committed (executed contracts)"', '"Spend by category (with drill-down) and by supplier; pipeline (active requests), committed (executed contracts and variations) and off-contract spend"')
PDF = 'ep("GET", "/tenders/{id}/pack/pdf", "exportTenderPackPdf", D, "The tender pack as a PDF with status, version and timestamp (US-TND-05)", ["PROCUREMENT", "DELEGATE", "LEGAL", "PROBITY", "EXEC"], None, None, note="application/pdf")'
DOCX = 'ep("GET", "/tenders/{id}/pack/docx", "exportTenderPackDocx", D, "The tender pack as a Word document", ["PROCUREMENT", "DELEGATE", "LEGAL", "PROBITY", "EXEC"], None, None, note="Word .docx")'
sub('ep("GET", "/tenders/{id}", "getTender"', PDF + chr(10) + DOCX + chr(10) + 'ep("GET", "/tenders/{id}", "getTender"')
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
