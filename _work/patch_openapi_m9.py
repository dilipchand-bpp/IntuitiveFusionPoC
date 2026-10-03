import re

p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\_work\gen_openapi.py'
t = open(p, encoding='utf8', newline='').read()


def replace_line_starting(prefix, new):
    """Replaces the (possibly multi-line) schema/ep statement that begins with `prefix`."""
    global t
    i = t.index(prefix)
    m = re.compile(r'\n(?= "|ep\(|[A-Z]+ = |\n)').search(t, i + len(prefix))
    assert m, prefix
    t = t[:i] + new + t[m.start():]


# ---------------------------------------------------------------- schemas
replace_line_starting(' "Evaluation": obj(', ''' "Evaluation": obj({"id": UUID, "tenderId": UUID, "requestNumber": S, "title": S, "tenderType": S, "status": enum("COI_PENDING", "SCORING", "CONSENSUS", "LOCKED", "REPORTED", "APPROVED"),
   "varianceLimitPct": I, "version": I, "criteria": arr(ref("Criterion")), "panel": arr(ref("PanelMember")), "suppliers": arr(ref("EvalSupplier")),
   "me": ref("EvalMe"), "consensus": arr(ref("ConsensusItem")), "ranking": arr(ref("RankedSupplier")), "report": ref("EvalReport"), "permissions": ref("EvalPermissions")}, ["id", "tenderId", "status", "criteria", "panel", "suppliers", "permissions"]),
 "EvalMe": obj({"stream": S, "coiState": S, "scoringComplete": B, "required": I, "done": I}),
 "EvalPermissions": obj({"canDeclare": B, "canScore": B, "canOpenConsensus": B, "canSetConsensus": B, "canLock": B, "canManagePanel": B, "canGenerateReport": B, "canDecideReport": B}),
 "EvalSummary": obj({"id": UUID, "tenderId": UUID, "requestNumber": S, "title": S, "status": S, "bids": I, "panelSize": I, "myCoiState": S, "myScoringComplete": B, "updatedAt": DT}, ["id", "tenderId", "title", "status"]),
 "EvalList": obj({"evaluations": arr(ref("EvalSummary")), "ready": arr(obj({"tenderId": UUID, "requestNumber": S, "title": S, "type": S, "bids": I, "evaluable": B}))}, ["evaluations"]),
 "EvaluatorList": obj({"evaluators": arr(obj({"id": UUID, "name": S})), "chairs": arr(obj({"id": UUID, "name": S}))}, ["evaluators", "chairs"]),
 "OpenEvaluation": obj({"panel": {"type": "array", "minItems": 1, "maxItems": 12, "items": obj({"userId": UUID, "stream": enum("TECHNICAL", "COMMERCIAL")}, ["userId", "stream"])}}, ["panel"]),
 "AddPanelMember": obj({"userId": UUID, "stream": enum("TECHNICAL", "COMMERCIAL", "OTHER")}, ["userId", "stream"]),
 "RankedSupplier": obj({"supplierId": UUID, "displayName": S, "weightedScore": N, "rank": I, "compliance": enum("PASS", "FAIL")}, ["supplierId", "displayName", "weightedScore", "compliance"]),
 "EvalReport": obj({"id": UUID, "status": enum("DRAFT", "AWAITING_APPROVAL", "APPROVED"), "generatedAt": DT, "sections": arr(obj({"key": S, "label": S, "paragraphs": arr(S)})), "decision": obj({"decision": S, "stamp": S, "comment": S})}, ["id", "status", "generatedAt", "sections"]),
 "Report": obj({"id": UUID, "status": S}),''')
replace_line_starting(' "Criterion": obj(', ''' "Criterion": obj({"id": UUID, "name": S, "weight": N, "stream": enum("TECHNICAL", "COMMERCIAL", "OTHER"), "passFail": B}, ["id", "name", "weight", "stream"]),''')
replace_line_starting(' "PanelMember": obj(', ''' "PanelMember": obj({"userId": UUID, "name": S, "stream": S, "coiState": enum("NOT_DECLARED", "DECLARED_NONE", "DECLARED_CONFLICT", "REMOVED"), "scoringComplete": B}, ["userId", "name", "stream", "coiState"]),''')
replace_line_starting(' "EvalSupplier": obj(', ''' "EvalSupplier": obj({"supplierId": UUID, "displayName": S, "anonymised": B, "files": arr(obj({"id": UUID, "name": S, "section": S, "sizeBytes": I, "contentType": S}))}, ["supplierId", "displayName", "anonymised"]),''')
replace_line_starting(' "ScoreSet": obj(', ''' "ScoreSet": obj({"criteria": arr(ref("Criterion")), "suppliers": arr(obj({"supplierId": UUID, "displayName": S, "scores": arr(obj({"criterionId": UUID, "score": N, "comment": S}))})), "progress": obj({"required": I, "done": I, "complete": B})}, ["criteria", "suppliers", "progress"]),
 "ScoresUpdate": obj({"supplierId": UUID, "scores": {"type": "array", "minItems": 1, "maxItems": 50, "items": obj({"criterionId": UUID, "score": {"type": "number", "minimum": 0, "maximum": 10, "multipleOf": 0.5}, "comment": {"type": "string", "maxLength": 2000}}, ["criterionId", "score"])}}, ["supplierId", "scores"]),
 "CoiOutcome": obj({"removed": B, "message": S}),''')
replace_line_starting(' "ConsensusItem": obj(', ''' "ConsensusItem": obj({"supplierId": UUID, "criterionId": UUID, "variancePct": N, "flagged": B, "consensusScore": N, "rationale": S, "individual": arr(obj({"evaluator": S, "score": N, "comment": S}))}, ["supplierId", "criterionId", "flagged"]),''')
replace_line_starting(' "ConsensusUpdate": obj(', ''' "ConsensusUpdate": obj({"items": {"type": "array", "minItems": 1, "maxItems": 50, "items": obj({"criterionId": UUID, "consensusScore": {"type": "number", "minimum": 0, "maximum": 10}, "rationale": {"type": "string", "maxLength": 2000}}, ["criterionId", "consensusScore"])}}, ["items"]),''')

# ---------------------------------------------------------------- operations
replace_line_starting('ep("POST", "/tenders/{id}/evaluation", "openEvaluation"', '''ep("GET", "/evaluations", "listEvaluations", V, "Evaluations the caller can see, plus (procurement) closed tenders ready to evaluate", ER, None, "EvalList")
ep("GET", "/evaluators", "listEvaluators", V, "Users who can sit on a panel", ["PROCUREMENT"], None, "EvaluatorList")
ep("POST", "/tenders/{id}/evaluation", "openEvaluation", V, "Open the evaluation of a closed tender: one record per submitted bid, scoring sheet from the published criteria, panel chosen by procurement", ["PROCUREMENT"], "OpenEvaluation", "Evaluation", 201, note="409 unless the tender is closed, has bids and is scored for award; 400 if the panel lacks a stream")
ep("POST", "/evaluations/{id}/panel", "addPanelMember", V, "Add a replacement panel member (before consensus)", ["PROCUREMENT"], "AddPanelMember", "Evaluation", 201)''')
replace_line_starting('ep("GET", "/evaluations/{id}", "getEvaluation"', '''ep("GET", "/evaluations/{id}", "getEvaluation", V, "Get the evaluation as the caller may see it: suppliers anonymised and files withheld until a panel member declares no conflict; criteria and files limited to their stream; others' scores hidden until consensus", ER, None, "Evaluation", note="404 for anyone not on the panel (and for removed members)")''')
replace_line_starting('ep("POST", "/evaluations/{id}/coi", "declareEvalCoi"', '''ep("POST", "/evaluations/{id}/coi", "declareEvalCoi", V, "Mandatory conflict declaration before any access; a conflict removes the member at once and alerts chair and probity", ["EVALUATOR", "CHAIR"], "CoiDeclaration", "CoiOutcome", 201)''')
replace_line_starting('ep("GET", "/evaluations/{id}/scores/mine", "getMyScores"', '''ep("GET", "/evaluations/{id}/scores/mine", "getMyScores", V, "Own scores and progress only", ["EVALUATOR", "CHAIR"], None, "ScoreSet", note="403 COI_REQUIRED until declared")''')
replace_line_starting('ep("PUT", "/evaluations/{id}/scores", "saveScores"', '''ep("PUT", "/evaluations/{id}/scores", "saveScores", V, "Save own scores for one supplier (hidden from everyone else)", ["EVALUATOR", "CHAIR"], "ScoresUpdate", "ScoreSet", note="404 for a criterion outside the caller's stream; 409 once marked complete")
ep("POST", "/evaluations/{id}/scores/submit", "submitScores", V, "Mark own scoring complete (every supplier on every allowed criterion)", ["EVALUATOR", "CHAIR"], None, "Evaluation", note="409 SCORING_INCOMPLETE")''')
replace_line_starting('ep("POST", "/evaluations/{id}/consensus/open", "openConsensus"', '''ep("POST", "/evaluations/{id}/consensus/open", "openConsensus", V, "Chair opens consensus once every member has finished; variance is computed and flagged", ["CHAIR"], None, "Evaluation", note="409 SCORING_PENDING")''')
replace_line_starting('ep("PUT", "/evaluations/{id}/consensus/{supplierId}", "setConsensus"', '''ep("PUT", "/evaluations/{id}/consensus/{supplierId}", "setConsensus", V, "Record consensus scores and rationale for one supplier", ["CHAIR"], "ConsensusUpdate", "Evaluation")''')
replace_line_starting('ep("POST", "/evaluations/{id}/consensus/lock", "lockConsensus"', '''ep("POST", "/evaluations/{id}/consensus/lock", "lockConsensus", V, "Lock consensus; refused while any flagged score lacks a rationale", ["CHAIR"], None, "Evaluation", note="409 FLAGS_UNRESOLVED / CONSENSUS_INCOMPLETE")''')
replace_line_starting('ep("POST", "/evaluations/{id}/report", "generateReport"', '''ep("POST", "/evaluations/{id}/report", "generateReport", V, "Generate the evaluation report from the locked consensus", ["PROCUREMENT"], None, "Evaluation", 201)''')
replace_line_starting('ep("POST", "/evaluation-reports/{id}/decision", "decideReport"', '''ep("POST", "/evaluation-reports/{id}/decision", "decideReport", V, "Delegate (within their authority) or executive approves or returns the report", ["DELEGATE", "EXEC"], "Decision", "Evaluation", note="403 if the award value exceeds the approver's authority")
ep("GET", "/evaluations/{id}/suppliers/{supplierId}/files/{fileId}", "downloadBidFile", V, "Download one bid file (panel members only after declaring no conflict, and only files of their stream)", ["EVALUATOR", "CHAIR", "PROCUREMENT", "PROBITY", "LEGAL"], None, None, note="404 for any file the caller may not see")''')

open(p, 'w', encoding='utf8', newline='').write(t)
print('patched')
