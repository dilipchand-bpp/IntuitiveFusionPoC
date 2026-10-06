
# ---------------------------------------------------------------- B8: tender, contract and supplier intelligence
NUM8 = {"type": "number"}
_ITEM = obj({"key": S, "label": S, "section": enum("TECHNICAL", "COMMERCIAL"), "kind": enum("TEXT", "NUMBER", "CHOICE", "YESNO", "DATE"), "required": B, "options": arr(S), "unit": S, "maxLength": I}, ["key", "label", "section", "kind"])
schemas.update({
    "ResponseScheduleSave": obj({"items": arr(_ITEM)}, ["items"]),
    "ResponseSchedule": OBJ,
    "TenderRequirements": obj({"requiredCover": NUM8, "dualWitness": B}),
    "TenderRequirementsResult": OBJ,
    "ResponseAnswersView": OBJ,
    "OpeningState": OBJ,
    "WitnessRequest": obj({"password": S}, ["password"]),
    "WitnessResult": OBJ,
    "SupplierResponseView": OBJ,
    "SupplierResponseSave": obj({"answers": {"type": "object", "additionalProperties": S}}, ["answers"]),
    "SupplierResponseSaved": OBJ,
    "InsuranceCertificate": obj({"name": S, "dataBase64": S}, ["name", "dataBase64"]),
    "InsuranceCertificateResult": OBJ,
    "RatingCreate": obj({"contractId": UUID, "scores": {"type": "object", "additionalProperties": I}, "comment": S}, ["contractId", "scores"]),
    "RatingResult": OBJ,
    "SupplierRatings": OBJ,
    "SupplierRatingsOwn": OBJ,
    "DuplicateList": OBJ,
    "DuplicateDismiss": obj({"supplierA": UUID, "supplierB": UUID, "reason": S}, ["supplierA", "supplierB", "reason"]),
    "SupplierRisk": OBJ,
    "SupplierScores": OBJ,
    "DiversityReport": OBJ,
    "EsgUpdate": obj({"carbonTonnesCo2e": NUM8, "renewablePct": NUM8, "diversityOwned": enum("NONE", "INDIGENOUS", "WOMEN", "DISABILITY", "SOCIAL_ENTERPRISE"), "modernSlaveryStatement": B}),
    "EsgView": OBJ,
    "ModernSlaveryResult": OBJ,
    "LessonCreate": obj({"kind": enum("WENT_WELL", "TO_IMPROVE", "RISK", "TIP"), "text": S}, ["kind", "text"]),
    "Lesson": OBJ,
    "LessonRecall": OBJ,
    "RequestClose": obj({"outcome": enum("COMPLETED", "CANCELLED"), "reason": S, "skipLessonsReason": S}, ["outcome"]),
    "RequestClosed": OBJ,
    "LegalEdit": obj({"instruction": S, "apply": B}, ["instruction"]),
    "LegalEditResult": OBJ,
    "RedlineList": OBJ,
    "RedlineDecision": obj({"decision": enum("ACCEPT", "REJECT")}, ["decision"]),
    "RedlineDecided": OBJ,
    "CounselLinkCreate": obj({"name": S, "email": S, "party": enum("EXTERNAL_COUNSEL", "SUPPLIER")}, ["name", "email", "party"]),
    "CounselLink": OBJ,
    "CounselPage": OBJ,
    "CounselRedline": obj({"clauseId": S, "text": S}, ["clauseId", "text"]),
    "IntegrationEvents": OBJ,
    "IntegrationRetry": OBJ,
    "LegalWebhook": obj({"eventId": S, "matterRef": S, "stage": S, "redlines": arr(obj({"clauseId": S, "text": S, "author": S}, ["clauseId", "text"]))}, ["eventId", "matterRef", "stage"]),
    "LegalWebhookResult": OBJ,
    "DeletedContracts": OBJ,
    "ContractRestore": obj({"reason": S}, ["reason"]),
    "ContractRestored": OBJ,
    "ApprovalLinkView": OBJ,
    "ApprovalLinkDecision": obj({"decision": enum("APPROVE", "REJECT"), "comment": S, "code": S}, ["decision"]),
    "ApprovalLinkDecided": OBJ,
})
TD = "Tenders"; SP8 = "SupplierPortal"; SD = "Suppliers"; LS = "Lessons"; CN = "Contracts"; IN = "Integrations"; AL = "ApprovalLinks"
TREAD = ["PROCUREMENT", "LEGAL", "DELEGATE", "EXEC", "PROBITY", "EVALUATOR", "CHAIR"]
WIT = ["PROBITY", "LEGAL", "DELEGATE", "EXEC", "PROCUREMENT"]
ep("GET", "/tenders/{id}/response-schedule", "getResponseSchedule", TD, "The structured response schedule: the questions a supplier answers instead of attaching documents", TREAD, None, "ResponseSchedule")
ep("PUT", "/tenders/{id}/response-schedule", "setResponseSchedule", TD, "Define the response schedule (staged tender only)", ["PROCUREMENT"], "ResponseScheduleSave", "ResponseSchedule", note="409 once published; 422 duplicate key or a choice with under two options")
ep("PUT", "/tenders/{id}/requirements", "setTenderRequirements", TD, "Set the insurance cover a bid must hold and whether opening needs two witnesses (staged tender only)", ["PROCUREMENT"], "TenderRequirements", "TenderRequirementsResult")
ep("GET", "/tenders/{id}/response-answers", "getResponseAnswers", TD, "Every submitted answer side by side, after the tender closes (and opens, for a dual-witness tender)", TREAD, None, "ResponseAnswersView", note="409 TENDER_SEALED before close; 409 BIDS_SEALED before witnesses open it")
ep("GET", "/tenders/{id}/opening", "getOpening", TD, "Where the dual-witness opening stands: who has witnessed and until when", WIT, None, "OpeningState")
ep("POST", "/tenders/{id}/opening/witness", "witnessOpening", TD, "Confirm, by password, that you witness the opening; the second different person within the window opens the bids", WIT, "WitnessRequest", "WitnessResult", note="401 password not confirmed; 403 not independent; 409 already witnessed, already opened or not required")
ep("GET", "/supplier/tenders/{id}/response", "getSupplierResponse", SP8, "The response schedule with the supplier's answers, what is missing and whether their cover meets the tender", ["SUPPLIER"], None, "SupplierResponseView")
ep("PUT", "/supplier/tenders/{id}/response", "saveSupplierResponse", SP8, "Save answers to the response schedule; each is checked against its question", ["SUPPLIER"], "SupplierResponseSave", "SupplierResponseSaved", note="422 with a message per answer; 409 once submitted or closed")
ep("PUT", "/supplier/profile/insurance-certificate", "uploadInsuranceCertificate", SP8, "Upload an insurance certificate; the limit and expiry are read from it (rules-simulated reading)", ["SUPPLIER"], "InsuranceCertificate", "InsuranceCertificateResult", note="422 for a rejected or infected file; readable=false asks for the details by hand")
ep("GET", "/supplier/profile/esg", "getSupplierEsg", SP8, "ESG data the supplier has declared", ["SUPPLIER"], None, "EsgView")
ep("PUT", "/supplier/profile/esg", "updateSupplierEsg", SP8, "Declare carbon data, renewable share, diversity ownership and a modern slavery statement", ["SUPPLIER"], "EsgUpdate", "EsgView")
ep("GET", "/supplier/ratings", "getSupplierRatings", SP8, "Contracts the supplier can rate, and ratings received if the organisation shows them", ["SUPPLIER"], None, "SupplierRatingsOwn")
ep("POST", "/supplier/ratings", "rateEnterprise", SP8, "The supplier rates the enterprise on a signed contract", ["SUPPLIER"], "RatingCreate", "RatingResult", 201, note="409 already rated; 422 wrong dimensions")
ep("POST", "/suppliers/{id}/ratings", "rateSupplier", SD, "The enterprise rates a supplier on a signed contract", ["CONTRACT_MGR", "PROCUREMENT", "EXEC"], "RatingCreate", "RatingResult", 201, note="409 already rated or contract not signed; 422 wrong dimensions")
ep("GET", "/suppliers/{id}/ratings", "getSupplierRatingsStaff", SD, "Ratings of a supplier; what suppliers said is shown only if the organisation allows it", ["PROCUREMENT", "LEGAL", "FINANCE", "EXEC", "ADMIN", "CONTRACT_MGR"], None, "SupplierRatings")
ep("GET", "/suppliers/duplicates", "listDuplicateSuppliers", SD, "Pairs of suppliers that look like the same business (same ABN or bank account, similar name)", ["PROCUREMENT", "LEGAL", "FINANCE", "EXEC", "ADMIN"], None, "DuplicateList")
ep("POST", "/suppliers/duplicates/dismiss", "dismissDuplicate", SD, "Say two suppliers are not the same business", ["PROCUREMENT", "LEGAL"], "DuplicateDismiss", None, 204)
ep("GET", "/suppliers/{id}/risk", "getSupplierRisk", SD, "Risk, resilience and ESG score with its factors, recommendations and alternative suppliers (rules-simulated)", ["PROCUREMENT", "LEGAL", "FINANCE", "EXEC", "PROBITY"], None, "SupplierRisk")
ep("POST", "/suppliers/{id}/modern-slavery-check", "checkModernSlavery", SD, "Run the modern slavery screen for a supplier and record the result", ["PROCUREMENT", "LEGAL"], None, "ModernSlaveryResult")
ep("GET", "/reports/supplier-scores", "getSupplierScores", RP, "Every supplier's score, lowest first", ["PROCUREMENT", "EXEC", "FINANCE", "PROBITY"], None, "SupplierScores")
ep("GET", "/reports/diversity", "getDiversityReport", RP, "Committed spend by diversity ownership, and carbon data reported", ["PROCUREMENT", "EXEC", "FINANCE"], None, "DiversityReport")
LR = ["PROCUREMENT", "REQUESTER", "LEGAL", "CONTRACT_MGR", "DELEGATE", "EXEC", "FINANCE", "PROBITY", "EVALUATOR", "CHAIR"]
ep("GET", "/requests/{id}/lessons", "listLessons", LS, "Lessons learned on a procurement", LR, None, "Lesson", arrayResp=True)
ep("POST", "/requests/{id}/lessons", "addLesson", LS, "Capture a lesson learned", LR, "LessonCreate", "Lesson", 201)
ep("GET", "/requests/{id}/lessons/recall", "recallLessons", LS, "Lessons from comparable procurements, by category, size and wording, with why each was chosen (rules-simulated)", LR, None, "LessonRecall")
ep("POST", "/requests/{id}/close", "closeRequest", LS, "Close or cancel a procurement; a lesson learned (or a reason for none) is needed", ["PROCUREMENT", "EXEC"], "RequestClose", "RequestClosed", note="409 LESSONS_REQUIRED; 409 if not yet in contract management (cancel instead)")
ep("POST", "/contracts/{id}/legal-edit", "legalEdit", CN, "Redact a clause, propose a redline or insert a clause at a nominated place, in plain language", ["LEGAL"], "LegalEdit", "LegalEditResult", note="apply=false previews; 409 once released for signature")
ep("GET", "/contracts/{id}/redlines", "listRedlines", CN, "Proposed changes to clauses, from Legal, the legal platform, outside counsel or the supplier", ["LEGAL", "PROCUREMENT", "DELEGATE", "EXEC"], None, "RedlineList")
ep("POST", "/contracts/{id}/redlines/{redlineId}/decision", "decideRedline", CN, "Accept (applies the wording) or reject a proposed change", ["LEGAL"], "RedlineDecision", "RedlineDecided", note="409 already decided or the wording is final")
ep("POST", "/contracts/{id}/counsel-links", "createCounselLink", CN, "Issue a one-time link for an outside law firm or the supplier's legal team to mark up this contract", ["LEGAL"], "CounselLinkCreate", "CounselLink", 201)
ep("GET", "/contracts/{id}/counsel-links", "listCounselLinks", CN, "Links issued for this contract (never the link itself)", ["LEGAL"], None, "CounselLink", arrayResp=True)
ep("DELETE", "/contracts/{id}/counsel-links/{linkId}", "revokeCounselLink", CN, "Withdraw a counsel link", ["LEGAL"], None, None, 204)
ep("GET", "/counsel/{token}", "getCounselPage", CN, "The clauses an outside party may mark up, with their own redlines; read-only once the version is final", None, None, "CounselPage")
ep("POST", "/counsel/{token}/redlines", "proposeCounselRedline", CN, "An outside party proposes new wording for a clause", None, "CounselRedline", "RedlineDecided", 201, note="423 once the version is final")
ep("GET", "/contracts/deleted", "listDeletedContracts", CN, "Contracts that were logically deleted, with the reason", ["LEGAL", "EXEC", "PROBITY"], None, "DeletedContracts")
ep("POST", "/contracts/{id}/restore", "restoreContract", CN, "Bring a logically deleted contract back, with a reason", ["LEGAL", "EXEC"], "ContractRestore", "ContractRestored")
ep("GET", "/integration-events", "listIntegrationEvents", IN, "Events sent to other systems and whether they were delivered", ["ADMIN", "PROCUREMENT", "LEGAL"], None, "IntegrationEvents")
ep("POST", "/integration-events/retry", "retryIntegrationEvents", IN, "Try again every event that has not been delivered", ["ADMIN", "PROCUREMENT", "LEGAL"], None, "IntegrationRetry")
ep("POST", "/integrations/legal/webhook", "legalPlatformWebhook", IN, "The customer's legal platform reports a matter stage and redlines; signed with the shared secret, safe to send twice", None, "LegalWebhook", "LegalWebhookResult", note="401 for a bad signature or unknown matter; duplicate=true when seen before")
ep("GET", "/approval-links/{token}", "getApprovalLink", AL, "The summary checklist behind a one-time approval link (commercial information withheld by default)", None, None, "ApprovalLinkView")
ep("POST", "/approval-links/{token}/decision", "decideViaApprovalLink", AL, "Approve or reject from the link without a full sign-in; the same limits and checks apply", None, "ApprovalLinkDecision", "ApprovalLinkDecided", note="403 above the approver's authority; step-up code required if the organisation asks for one")
