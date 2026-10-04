
# ---------------------------------------------------------------- B3: evaluation and report
schemas.update({
    "CriteriaLibrary": obj({"criteria": arr(OBJ)}, ["criteria"]),
    "CriteriaSet": obj({"criteria": arr(obj({"name": S, "stream": enum("TECHNICAL", "COMMERCIAL", "OTHER"), "weight": N, "passFail": B}, ["name", "stream", "weight", "passFail"]))}, ["criteria"]),
    "ComplianceWaive": obj({"note": S}, ["note"]),
    "ClarificationCreate": obj({"supplierId": UUID, "subject": S, "question": S, "dueInDays": I}, ["supplierId", "subject", "question"]),
    "Clarification": OBJ,
    "ClarificationResponse": obj({"response": S}, ["response"]),
    "BidPricing": obj({"basePrice": N, "implementation": N, "annualRunning": N, "years": I}, ["basePrice"]),
    "BidPricingView": OBJ,
    "BafoCreate": obj({"supplierIds": arr(UUID), "note": S, "closesInDays": I}, ["supplierIds", "note"]),
    "BafoOfferCreate": obj({"basePrice": N, "implementation": N, "annualRunning": N, "years": I, "note": S}, ["basePrice"]),
    "BafoView": OBJ,
    "NegotiationAdvice": OBJ,
    "PanelSubstitute": obj({"replacementUserId": UUID, "reason": enum("CONFLICT", "OTHER"), "note": S}, ["replacementUserId", "reason"]),
    "CoiRedeclare": obj({"none": B, "nature": S, "subjectOrg": S}, ["none"]),
    "CoiStatus": OBJ,
    "ReportCoi": OBJ,
    "ReportCoiDecision": obj({"disposition": enum("IMMATERIAL", "MANAGEABLE", "MATERIAL"), "rationale": S}, ["disposition"]),
    "ProbityAdvisorAllocate": obj({"userId": UUID}, ["userId"]),
    "ProbityAdvisors": OBJ,
    "ProbityPortal": OBJ,
    "ProbityHold": obj({"reason": S}, ["reason"]),
    "ProbityRelease": obj({"note": S}, ["note"]),
    "ProbityDocumentSave": obj({"title": S, "body": S}, ["title", "body"]),
    "ProbityDocumentUpload": obj({"title": S, "fileName": S, "contentBase64": S}, ["title", "fileName", "contentBase64"]),
    "ProbityDocument": OBJ,
    "ProbityDocuments": OBJ,
    "PlainScores": obj({"supplierId": UUID, "text": S, "apply": B}, ["supplierId", "text"]),
    "PlainScoresResult": OBJ,
    "RankingEntry": obj({"order": arr(UUID)}, ["order"]),
    "PlainRanking": obj({"text": S, "apply": B}, ["text"]),
    "PlainRankingResult": OBJ,
})
EV = "Evaluation"
SR = ["PROCUREMENT", "DELEGATE", "LEGAL", "PROBITY", "EXEC", "CHAIR"]
COIR = ["PROCUREMENT", "DELEGATE", "EXEC", "CHAIR", "PROBITY", "LEGAL"]
ep("GET", "/criteria-library", "getCriteriaLibrary", EV, "The pre-populated criteria library an evaluation's criteria are chosen from", ["PROCUREMENT", "ADMIN", "CHAIR", "DELEGATE", "PROBITY", "EXEC"], None, "CriteriaLibrary")
ep("PUT", "/evaluations/{id}/criteria", "setEvaluationCriteria", EV, "Set this evaluation's criteria before scoring opens (weights add to 100); each stage can differ", ["PROCUREMENT"], "CriteriaSet", "Evaluation", note="409 once scoring has opened; 400 unless weights add to 100")
ep("POST", "/evaluations/{id}/compliance/run", "runComplianceGate", EV, "Run the mandatory pass or fail checks again; each newly failing check sends the supplier a clarification request", ["PROCUREMENT"], None, "Evaluation")
ep("POST", "/evaluations/{id}/compliance/{supplierId}/{key}/waive", "waiveComplianceCheck", EV, "Waive a failed check with a recorded reason; probity is told", ["PROCUREMENT", "DELEGATE"], "ComplianceWaive", "Evaluation")
ep("POST", "/evaluations/{id}/clarifications", "requestClarification", EV, "Ask a bidder to clarify, with a response deadline; the supplier is told in the app and by email", ["PROCUREMENT"], "ClarificationCreate", "Clarification", 201)
ep("GET", "/evaluations/{id}/clarifications", "listClarifications", EV, "Clarification requests and answers for this evaluation", SR, None, "Clarification", arrayResp=True)
ep("POST", "/clarifications/{id}/close", "closeClarification", EV, "Close a clarification request", ["PROCUREMENT"], None, "Clarification")
ep("GET", "/evaluations/{id}/bafo", "listBafoRounds", EV, "Best and final offer rounds; offers stay sealed until a round closes and the original bids are untouched", SR, None, "BafoView")
ep("POST", "/evaluations/{id}/bafo", "openBafoRound", EV, "Open a controlled mini-tender for updated pricing from chosen suppliers", ["PROCUREMENT"], "BafoCreate", "BafoView", 201)
ep("POST", "/bafo-rounds/{id}/close", "closeBafoRound", EV, "Close a round (rounds also close at their time)", ["PROCUREMENT"], None, "BafoView")
ep("POST", "/bafo-offers/{id}/accept", "acceptBafoOffer", EV, "Accept an offer: its total cost replaces the supplier's original for ranking, and the draft report is rebuilt", ["PROCUREMENT"], None, "BafoView")
ep("GET", "/evaluations/{id}/negotiation-advice", "getNegotiationAdvice", EV, "Suggested discounts, clauses and insurance to negotiate, from pricing and terms against the other bids (simulated model)", ["PROCUREMENT", "DELEGATE", "EXEC"], None, "NegotiationAdvice")
ep("POST", "/evaluations/{id}/panel/{userId}/substitute", "substituteEvaluator", EV, "Replace an evaluator: their marks stay as read-only history, the replacement declares a conflict and starts with a clean scoring matrix", ["PROCUREMENT"], "PanelSubstitute", "Evaluation", 201)
ep("POST", "/evaluations/{id}/coi/redeclare", "redeclareEvalCoi", EV, "Confirm the conflict declaration again once supplier identities are visible; a conflict suspends the member", ["EVALUATOR", "CHAIR"], "CoiRedeclare", "CoiOutcome", 201)
ep("GET", "/evaluations/{id}/coi/status", "getCoiStatus", EV, "Who has declared, who has confirmed again, and who is outstanding", ["PROCUREMENT", "PROBITY", "CHAIR", "DELEGATE", "EXEC"], None, "CoiStatus")
ep("POST", "/evaluations/{id}/coi/remind", "remindCoi", EV, "Remind members who still owe a declaration (reminders also go out on a schedule)", ["PROCUREMENT", "CHAIR"], None, "CoiStatus")
ep("POST", "/evaluation-reports/{id}/coi", "declareReportCoi", EV, "Declare a conflict of interest at the report stage, as at the plan", COIR, "CoiRedeclare", "ReportCoi", 201)
ep("GET", "/evaluation-reports/{id}/coi", "listReportCoi", EV, "Conflict declarations made on the report", COIR, None, "ReportCoi")
ep("POST", "/evaluation-reports/{id}/coi/{coiId}/decision", "decideReportCoi", EV, "Decide a conflict declared on the report; a material conflict stops that person approving", ["DELEGATE", "EXEC", "PROBITY"], "ReportCoiDecision", "ReportCoi")
ep("POST", "/evaluations/{id}/scores/plain", "enterPlainScores", EV, "Scores and commentary in plain language: read back for confirmation, saved only when apply is true", ["EVALUATOR", "CHAIR"], "PlainScores", "PlainScoresResult")
ep("PUT", "/evaluations/{id}/ranking", "enterRanking", EV, "Ranking evaluations: order every supplier once, first to last", ["EVALUATOR", "CHAIR"], "RankingEntry", "RankingEntry")
ep("POST", "/evaluations/{id}/ranking/plain", "enterPlainRanking", EV, "Ranking in plain language, for example B first then A then C", ["EVALUATOR", "CHAIR"], "PlainRanking", "PlainRankingResult")
ep("GET", "/tenders/{id}/probity-advisors", "listProbityAdvisors", EV, "Probity advisors allocated to this procurement and those available", ["PROCUREMENT", "ADMIN", "PROBITY"], None, "ProbityAdvisors")
ep("POST", "/tenders/{id}/probity-advisors", "allocateProbityAdvisor", EV, "Allocate an external probity advisor to this procurement", ["PROCUREMENT", "ADMIN"], "ProbityAdvisorAllocate", "ProbityAdvisors", 201)
ep("DELETE", "/tenders/{id}/probity-advisors/{userId}", "deallocateProbityAdvisor", EV, "Remove an advisor's allocation", ["PROCUREMENT", "ADMIN"], None, None, 204)
ep("GET", "/probity/portal", "getProbityPortal", EV, "The advisor's read-only oversight portal: only the procurements they are allocated to", ["PROBITY"], None, "ProbityPortal")
ep("POST", "/evaluations/{id}/hold", "holdEvaluation", EV, "System hold: freeze the evaluation workspace on suspected bias or a process breach", ["PROBITY"], "ProbityHold", "Evaluation")
ep("POST", "/evaluations/{id}/release", "releaseEvaluation", EV, "Release a hold", ["PROBITY"], "ProbityRelease", "Evaluation")
ep("GET", "/evaluations/{id}/probity", "listProbityDocuments", EV, "The probity plan and probity outcomes report", SR, None, "ProbityDocuments")
ep("PUT", "/evaluations/{id}/probity/{kind}", "saveProbityDocument", EV, "Author the probity plan (PLAN) or outcomes report (OUTCOMES) in the platform; editing a signed document starts a new version", ["PROBITY"], "ProbityDocumentSave", "ProbityDocument")
ep("POST", "/evaluations/{id}/probity/{kind}/upload", "uploadProbityDocument", EV, "Upload the probity plan or outcomes report as a file (base64)", ["PROBITY"], "ProbityDocumentUpload", "ProbityDocument", 201)
ep("POST", "/evaluations/{id}/probity/{kind}/sign", "signProbityDocument", EV, "Sign off the current version with a profile stamp attributed to the advisor", ["PROBITY"], None, "ProbityDocument")
ep("GET", "/evaluations/{id}/probity/{kind}/pdf", "exportProbityPdf", EV, "The authored document as a PDF with the sign-off stamp (audited)", SR, None, None)
ep("GET", "/evaluations/{id}/probity/{kind}/docx", "exportProbityDocx", EV, "The authored document as a Word file with the sign-off stamp (audited)", SR, None, None)
ep("GET", "/evaluations/{id}/probity/{kind}/file", "downloadProbityFile", EV, "The uploaded file (audited)", SR, None, None)
ep("GET", "/supplier/clarifications", "listMyClarifications", SU, "Clarification and compliance requests addressed to this supplier", ["SUPPLIER"], None, "Clarification", arrayResp=True)
ep("POST", "/supplier/clarifications/{id}/response", "answerClarification", SU, "Answer a request before its deadline", ["SUPPLIER"], "ClarificationResponse", "Clarification")
ep("GET", "/supplier/tenders/{id}/pricing", "getMyPricing", SU, "The supplier's own bid pricing (total cost of ownership)", ["SUPPLIER"], None, "BidPricingView")
ep("PUT", "/supplier/tenders/{id}/pricing", "setMyPricing", SU, "Enter price, implementation and running costs so total cost of ownership can be compared", ["SUPPLIER"], "BidPricing", "BidPricingView")
ep("GET", "/supplier/bafo", "listMyBafoRounds", SU, "Best and final offer rounds the supplier is invited to, with their own offers", ["SUPPLIER"], None, "BafoView")
ep("PUT", "/supplier/bafo/{id}/offer", "submitBafoOffer", SU, "Submit a new offer revision while the round is open; the original bid is unchanged", ["SUPPLIER"], "BafoOfferCreate", "BafoView", 201)
