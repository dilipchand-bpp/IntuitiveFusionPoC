import re
p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\_work\gen_openapi.py'
t = open(p, encoding='utf8', newline='').read()

def sub(old, new):
    global t
    assert old in t, old[:70]
    t = t.replace(old, new, 1)

# ---- schemas
m = re.search(r' "Plan": obj\(\{.*?\}, \["id", "requestId", "status", "fields", "version"\]\),\r?\n', t, re.S)
assert m, 'Plan schema'
t = t[:m.start()] + ''' "Plan": obj({"id": UUID, "requestId": UUID, "requestNumber": S, "title": S, "estimatedValue": N, "complexity": enum("LOW", "MEDIUM", "HIGH", "CRITICAL"),
   "status": enum("DRAFT", "AWAITING_SIGNOFF", "AWAITING_APPROVAL", "APPROVED_LOCKED", "REOPENED", "REJECTED"), "locked": B,
   "fields": arr(ref("PlanField")), "approvals": arr(ref("Approval")), "conflicts": arr(ref("CoiRecord")), "gates": arr(ref("Gate")),
   "summary": S, "summaryPoints": arr(S), "version": I, "permissions": ref("PlanPermissions"), "undoAvailable": B}, ["id", "requestId", "status", "fields", "version"]),
 "PlanField": obj({"key": S, "label": S, "value": S, "paragraphs": arr(S), "source": enum("USER", "AI", "SYSTEM", "MIGRATED"), "aiDrafted": B, "updatedAt": DT}, ["key", "label", "source"]),
 "PlanPermissions": obj({"canEdit": B, "canSubmit": B, "canApprove": B, "canReopen": B, "canDeclareConflict": B, "canDecideConflict": B, "canSignOffRisk": B, "reason": S}, ["canEdit", "canSubmit", "canApprove", "canReopen"]),
 "PlanSummary": obj({"planId": UUID, "requestId": UUID, "requestNumber": S, "title": S, "estimatedValue": N, "complexity": S, "status": S, "updatedAt": DT}, ["planId", "requestId", "requestNumber", "title", "status"]),
 "UndoRequest": obj({"undoToken": S}, ["undoToken"]),
''' + t[m.end():]
sub('"CoiRecord": obj({"id": UUID, "userId": UUID,', '"CoiRecord": obj({"id": UUID, "userId": UUID, "userName": S, "rationale": S,')
sub('"Decision": obj({"decision": enum("APPROVE", "REJECT"), "comment": {"type": "string", "maxLength": 2000}}, ["decision"]),',
    '"Decision": obj({"decision": enum("APPROVE", "REJECT"), "comment": {"type": "string", "maxLength": 2000}, "gate": enum("RISK_SIGNOFF")}, ["decision"]),')

# ---- operations
sub('"Get (or lazily create from intake) the procurement plan", ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "PROBITY", "EXEC", "ADMIN"], None, "Plan")',
    '"Get (or lazily create from intake) the procurement plan", ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "PROBITY", "EXEC"], None, "Plan")')
sub('ep("GET", "/requests/{id}/plan"', 'ep("GET", "/plans", "listPlans", P, "Plans visible to the caller (requesters see their own)", ["REQUESTER", "PROCUREMENT", "DELEGATE", "LEGAL", "PROBITY", "EXEC"], None, "PlanSummary", arrayResp=True, query=["status"])\nep("GET", "/requests/{id}/plan"')
sub('"Undo last instruction by token", ["PROCUREMENT", "REQUESTER"], None, "Plan")', '"Undo last instruction by token", ["PROCUREMENT", "REQUESTER"], "UndoRequest", "Plan")')
sub('"Delegate approves/rejects; delegation limit enforced; locks on approval", ["DELEGATE"], "Decision", "Plan",',
    '"Delegate approves/rejects within their delegation (locks on approval); the independent risk officer signs off the risk gate", ["DELEGATE", "EXEC", "PROBITY"], "Decision", "Plan",')
sub('"Delegate/Risk decides disposition", ["DELEGATE", "PROBITY"]', '"Delegate/Risk decides disposition", ["DELEGATE", "EXEC", "PROBITY"]')
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
