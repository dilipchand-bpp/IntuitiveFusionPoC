p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\_work\gen_openapi.py'
t = open(p, encoding='utf8', newline='').read()


def sub(a, b):
    global t
    assert a in t, a[:80]
    t = t.replace(a, b, 1)


STEPS = 'obj({"intake": B, "plan": B, "tender": B, "evaluation": B, "contract": B})'
sub('"Kpis": obj({"activeProcurements": I, "valueInFlight": N, "avgCycleDays": N, "alertsDue": I,',
    '"Kpis": obj({"scope": enum("PORTFOLIO", "PANEL", "OWN"), "activeProcurements": I, "valueInFlight": N, "avgCycleDays": N, "alertsDue": {"type": "integer", "nullable": True, "description": "Null for roles outside contract management and oversight"},')
sub(' "AuditEvent": obj({"id": UUID, "seq": I, "at": DT, "actorId": UUID, "actorRole": S,',
    ' "ProcurementRow": obj({"id": UUID, "number": S, "title": S, "category": S, "businessUnit": S, "phase": S, "status": S, "estimatedValue": N, "steps": ' + STEPS + ', "updatedAt": DT}, ["id", "number", "title", "phase", "status", "steps"]),\n "ProcurementTable": obj({"scope": enum("PORTFOLIO", "PANEL", "OWN"), "items": arr(ref("ProcurementRow"))}, ["scope", "items"]),\n "SpendReport": obj({"byCategory": arr(obj({"category": S, "pipeline": N, "committed": N})), "totalPipeline": N, "totalCommitted": N, "note": S}, ["byCategory", "totalPipeline", "totalCommitted"]),\n "AuditEvent": obj({"seq": I, "at": DT, "actorId": UUID, "actorName": S, "actorRole": S,')
sub('"correlationId": S, "result": enum("SUCCESS", "DENIED", "FAILED"), "hash": S}, ["id", "seq", "at", "action", "entityType", "result"]),',
    '"result": enum("SUCCESS", "DENIED", "FAILED"), "hash": S}, ["seq", "at", "action", "entityType", "result"]),')
sub('"Search audit trail", ["PROBITY", "ADMIN", "EXEC", "PROCUREMENT"], None, "AuditPage", query=["entityType", "entityId", "actorId", "from", "to", "limit", "offset"])',
    '"Search the audit trail (newest first, with field-level before and after). requestId returns the whole trail of one procurement: its plan, tender, evaluation, report and contract", ["PROBITY", "ADMIN", "EXEC", "PROCUREMENT"], None, "AuditPage", query=["entityType", "entityId", "actorId", "requestId", "action", "result", "from", "to", "limit", "offset"])')
sub('"Export audit report (CSV); the export is itself audited", ["PROBITY", "ADMIN"], None, None, note="text/csv")',
    '"Export the audit report as CSV with the same filters (no paging); the export is itself audited and not part of its own file", ["PROBITY", "ADMIN"], None, None, query=["entityType", "entityId", "actorId", "requestId", "action", "result", "from", "to"], note="text/csv; 422 above 20,000 rows")')
sub('"Spend by category/supplier (seed data)", ["EXEC", "FINANCE", "PROCUREMENT"], None, "ComingSoon", note="Stub in POC (returns ComingSoon)")',
    '"Spend by category: pipeline (active requests) and committed (executed contracts)", ["EXEC", "FINANCE", "PROCUREMENT"], None, "SpendReport")\nep("GET", "/reports/procurements", "procurementTable", G, "Procurement table with completion indicators, scoped to the caller (portfolio, panel or own)", [r for r in ROLES if r != "SUPPLIER"], None, "ProcurementTable", query=["phase", "status", "q"])')
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
