p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\_work\gen_openapi.py'
t = open(p, encoding='utf8', newline='').read()


def sub(a, b):
    global t
    assert a in t, a[:80]
    t = t.replace(a, b, 1)


sub('"CoiOutcome": obj({"removed": B, "message": S}),', '"CoiOutcome": obj({"suspended": B, "message": S}),')
sub('"EvalPermissions": obj({"canDeclare": B,', '"EvalPermissions": obj({"canReopen": B, "canDecideConflict": B, "canDeclare": B,')
sub('"me": ref("EvalMe"),', '"conflicts": arr(ref("EvalConflict")), "me": ref("EvalMe"),')
sub(' "EvalMe": obj(', ' "EvalConflict": obj({"userId": UUID, "name": S, "nature": S, "subjectOrg": S, "disposition": enum("PENDING", "IMMATERIAL", "MANAGEABLE", "MATERIAL"), "declaredAt": DT, "decidedAt": DT}, ["userId", "name", "disposition"]),\n "ConflictDecision": obj({"disposition": enum("IMMATERIAL", "MANAGEABLE", "MATERIAL"), "rationale": {"type": "string", "maxLength": 2000}}, ["disposition"]),\n "ReopenConsensus": obj({"reason": {"type": "string", "minLength": 10, "maxLength": 1000}}, ["reason"]),\n "EvalMe": obj(')
sub('"Mandatory conflict declaration before any access; a conflict removes the member at once and alerts chair and probity"',
    '"Mandatory conflict declaration before any access; a conflict suspends the member at once, alerts chair, probity and procurement, and goes to a delegate to decide"')
sub('ep("POST", "/evaluations/{id}/scores/submit"', '''ep("POST", "/evaluations/{id}/conflicts/{userId}/decision", "decideEvalConflict", V, "Delegate (or executive) decides a declared conflict: immaterial or manageable reinstates the evaluator, material removes them", ["DELEGATE", "EXEC"], "ConflictDecision", "Evaluation", note="409 if nothing is waiting; 403 for your own conflict")
ep("POST", "/evaluations/{id}/scores/submit"''')
sub('ep("POST", "/evaluations/{id}/consensus/lock"', '''ep("POST", "/evaluations/{id}/consensus/reopen", "reopenConsensus", V, "Chair reopens a locked consensus with a recorded reason; any report is invalidated and must be generated again", ["CHAIR"], "ReopenConsensus", "Evaluation", note="409 once the report is approved")
ep("POST", "/evaluations/{id}/consensus/lock"''')
sub('ep("GET", "/evaluations/{id}/suppliers/{supplierId}/files/{fileId}"', '''ep("GET", "/evaluations/{id}/report/pdf", "exportReportPdf", V, "The evaluation report as a PDF carrying its generation time and version on every page", ["PROCUREMENT", "DELEGATE", "EXEC", "PROBITY", "LEGAL", "CHAIR"], None, None, note="404 until a report exists")
ep("GET", "/evaluations/{id}/suppliers/{supplierId}/files/{fileId}"''')
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
