p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\_work\gen_openapi.py'
t = open(p, encoding='utf8', newline='').read()


def sub(a, b):
    global t
    assert a in t, a[:80]
    t = t.replace(a, b, 1)


D = '{"type": "string", "format": "date"}'
sub('"origin": enum("SYSTEM", "USER")}, ["id", "contractId", "kind", "triggerDate"]),',
    '"origin": enum("SYSTEM", "USER"), "sentAt": DT, "contractNumber": S, "endDate": ' + D + ', "deliveries": arr(ref("AlertDelivery"))}, ["id", "contractId", "kind", "triggerDate"]),\n "AlertDelivery": obj({"channel": enum("IN_APP", "EMAIL"), "status": enum("DELIVERED", "SIMULATED"), "deliveredAt": DT}, ["channel", "status", "deliveredAt"]),\n "TermBar": obj({"label": S, "start": ' + D + ', "end": ' + D + ', "optional": B}, ["label", "start", "end", "optional"]),\n "ContractRecord": obj({"owner": obj({"id": UUID, "name": S}), "milestones": arr(obj({"id": UUID, "title": S, "dueDate": ' + D + '})), "extensions": arr(ref("TermBar")), "bars": arr(ref("TermBar")), "alerts": arr(ref("Alert"))}),')
sub('"ExpiringContract": obj({"contractId": UUID, "number": S, "supplier": S, "endDate": {"type": "string", "format": "date"}, "daysRemaining": I, "optionalExtensions": arr(obj({"months": I}))},',
    '"ExpiringContract": obj({"contractId": UUID, "number": S, "title": S, "supplier": S, "value": N, "owner": S, "startDate": ' + D + ', "endDate": ' + D + ', "noticeDeadline": ' + D + ', "daysRemaining": I, "optionalExtensions": arr(obj({"months": I, "endDate": ' + D + '})), "bars": arr(ref("TermBar"))},')
sub('"deviations": arr(ref("ContractDeviation")),', '"deviations": arr(ref("ContractDeviation")), "record": ref("ContractRecord"),')
sub('"System + user alerts", ["CONTRACT_MGR"', '"Alerts of the contract with their delivery log (due alerts fire first)", ["CONTRACT_MGR"')
sub('ep("POST", "/contracts/{id}/alerts"', 'ep("GET", "/alerts", "listAllAlerts", C, "All contract alerts, soonest first (due alerts fire first)", ["CONTRACT_MGR", "PROCUREMENT", "LEGAL", "EXEC"], None, "Alert", arrayResp=True, query=["status"])\nep("POST", "/contracts/{id}/alerts"')
sub('"Contracts expiring within N days (default 90)"', '"Executed contracts ending within N days (default 90), soonest first, with the term and optional extensions for the Gantt chart"')
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
