import re
p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\_work\gen_openapi.py'
t = open(p, encoding='utf8', newline='').read()

def sub(old, new, count=1):
    global t
    assert old in t, old[:60]
    t = t.replace(old, new, count)

# --- roles
sub('ep("GET", "/requests", "listRequests", T, "List requests visible to caller (scope by role/hierarchy)", "*",',
    'ep("GET", "/requests", "listRequests", T, "List requests visible to caller (requesters see their own)", ["REQUESTER", "PROCUREMENT", "DELEGATE", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "EXEC"],')
sub('ep("GET", "/requests/{id}", "getRequest", T, "Get request", "*",',
    'ep("GET", "/requests/{id}", "getRequest", T, "Get request", ["REQUESTER", "PROCUREMENT", "DELEGATE", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "EXEC"],')
for op in ('startConversation', 'getConversation', 'sendMessage'):
    m = re.search(r'ep\("[A-Z]+", "[^"]+", "%s", Q, "[^"]*", "\*"' % op, t)
    assert m, op
    t = t[:m.end() - 3] + '["REQUESTER", "PROCUREMENT"]' + t[m.end():]

# --- schemas
sub('"RequestPatch": obj({"title": S, "category": S, "estimatedValue": N, "termMonths": I, "businessUnit": S}),',
    '"RequestPatch": obj({"title": S, "category": S, "estimatedValue": N, "termMonths": I, "businessUnit": S, "fields": {"type": "object", "additionalProperties": S}, "expectedVersion": I}),')
sub('"fields": arr(ref("FieldValue")), "createdAt": DT, "updatedAt": DT}, ["id", "number", "title", "phase", "status"]),',
    '"complexityReasons": arr(S), "gates": arr(ref("Gate")), "missingFields": arr(S), "version": I,\n   "fields": arr(ref("FieldValue")), "createdAt": DT, "updatedAt": DT}, ["id", "number", "title", "phase", "status"]),\n "Gate": obj({"key": S, "label": S, "reason": S, "status": enum("REQUIRED", "SATISFIED")}, ["key", "label", "status"]),')
sub('"ChatMessage": obj({"id": UUID, "role": enum("USER", "ASSISTANT", "SYSTEM"), "text": S, "createdAt": DT, "proposedChanges": arr(ref("FieldValue"))}, ["id", "role", "text"]),',
    '"ChatMessage": obj({"id": UUID, "role": enum("USER", "ASSISTANT", "SYSTEM"), "text": S, "createdAt": DT, "proposedChanges": arr(ref("FieldValue")), "requestId": UUID, "request": ref("ProcurementRequest")}, ["id", "role", "text"]),')
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
