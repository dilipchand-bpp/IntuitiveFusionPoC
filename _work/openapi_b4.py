
# ---------------------------------------------------------------- B4: contract award and legal
schemas.update({
    "ContractChecks": OBJ,
    "CheckReview": obj({"note": S}, ["note"]),
    "BankDetails": obj({"bsb": S, "account": S, "accountName": S}, ["bsb", "account", "accountName"]),
    "BankDetailsView": OBJ,
    "Endorse": obj({"role": enum("LEGAL", "FINANCE"), "comment": S}),
    "SigningMode": obj({"signingMode": enum("STANDARD", "BLIND", "STAGED")}, ["signingMode"]),
    "SigningProgress": OBJ,
    "ContractQuestionCreate": obj({"question": S, "clauseId": S}, ["question"]),
    "ContractQuestions": OBJ,
    "ContractAnswer": obj({"answer": S}, ["answer"]),
    "RiskSummary": OBJ,
    "RiskSummaryEdit": obj({"text": S}, ["text"]),
    "DocumentCreate": obj({"docType": enum("NDA", "CONFIDENTIALITY", "MASTER"), "supplierId": UUID, "title": S, "text": S, "startDate": S, "endDate": S}, ["docType", "supplierId", "title", "text"]),
    "DraftUpload": obj({"fileName": S, "contentBase64": S, "note": S}, ["fileName", "contentBase64"]),
    "DraftFile": OBJ,
    "DraftList": OBJ,
    "CommentCreate": obj({"body": S, "clauseId": S}, ["body"]),
    "CommentList": OBJ,
    "KnowledgeCreate": obj({"kind": enum("POLICY", "ADVICE", "FALLBACK", "BOILERPLATE"), "title": S, "body": S, "clauseId": S, "tags": S}, ["kind", "title", "body"]),
    "KnowledgeList": OBJ,
    "DeviationExplanation": OBJ,
    "PlainRisk": obj({"text": S, "apply": B}, ["text"]),
    "PlainRiskResult": OBJ,
    "RiskAcceptance": obj({"statement": S}, ["statement"]),
    "NegotiationStrategy": OBJ,
    "Lineage": OBJ,
    "MatterCreate": obj({"title": S, "contractId": UUID, "priority": enum("LOW", "NORMAL", "HIGH"), "assigneeId": UUID, "dueOn": S}, ["title"]),
    "MatterPatch": OBJ,
    "MatterBoard": OBJ,
    "TimeEntry": obj({"hours": N, "workDate": S, "note": S}, ["hours", "workDate"]),
    "TimeEntries": OBJ,
    "GrantCreate": obj({"userId": UUID, "tenderId": UUID, "label": enum("COMMITTEE", "AUDITOR", "ADVISOR"), "expiresOn": S, "event": enum("CONTRACT_SIGNED", "REPORT_APPROVED"), "eventDays": I}, ["userId", "tenderId", "label"]),
    "GrantList": OBJ,
    "GrantRevoke": obj({"reason": S}, ["reason"]),
    "SharedProjects": OBJ,
    "SupplierContractList": OBJ,
    "SupplierContractView": OBJ,
})
CTX = "Contracts"
RD = ["PROCUREMENT", "LEGAL", "CONTRACT_MGR", "DELEGATE", "EXEC", "FINANCE", "PROBITY"]
LP = ["LEGAL", "PROCUREMENT"]
ep("GET", "/contracts/{id}/checks", "getContractChecks", CTX, "The tender cross-check, vendor pre-flight and counterparty re-check results, and whether negotiation has locked signing", RD, None, "ContractChecks")
ep("POST", "/contracts/{id}/checks/run", "runContractChecks", CTX, "Run the tender cross-check and the vendor pre-flight (legal name, tax, banking) now", LP, None, "ContractChecks")
ep("POST", "/contracts/{id}/checks/{kind}/{key}/review", "reviewContractCheck", CTX, "Review a failed or flagged check with a recorded reason so it no longer blocks", LP, "CheckReview", "Contract")
ep("POST", "/contracts/{id}/recheck", "recheckCounterparty", CTX, "Run sanctions and financial risk checks again; unlocks signing after a long negotiation when they pass", LP, None, "Contract")
ep("POST", "/contracts/{id}/endorse", "endorseContract", CTX, "Endorse before release (legal, finance) where the organisation requires it", ["LEGAL", "FINANCE"], "Endorse", "Contract")
ep("PUT", "/contracts/{id}/signing-mode", "setSigningMode", CTX, "STANDARD, BLIND (signatories see no one else's signature) or STAGED (signed in sequence), set before release", LP, "SigningMode", "Contract")
ep("GET", "/contracts/{id}/signing", "getSigningProgress", CTX, "Who was invited to sign, who has seen the contract, reminders sent, and who has signed", RD, None, "SigningProgress")
ep("POST", "/contracts/{id}/signing/remind", "remindSigners", CTX, "Remind the signatories who have not signed", LP, None, "SigningProgress")
ep("POST", "/contracts/{id}/questions", "askContractQuestion", CTX, "A signatory or reviewer raises a question before signing", ["DELEGATE", "EXEC", "LEGAL", "PROCUREMENT"], "ContractQuestionCreate", "ContractQuestions", 201)
ep("GET", "/contracts/{id}/questions", "listContractQuestions", CTX, "Questions raised about the contract, from the business and from the supplier, with answers", RD, None, "ContractQuestions")
ep("POST", "/contract-questions/{id}/answer", "answerContractQuestion", CTX, "Legal answers a question", ["LEGAL"], "ContractAnswer", "ContractQuestions")
ep("GET", "/contracts/{id}/risk-summary", "getContractRiskSummary", CTX, "An auto-populated summary of the risks in signing (simulated model); refresh=true regenerates it", ["DELEGATE", "EXEC", "LEGAL", "PROCUREMENT"], None, "RiskSummary")
ep("PUT", "/contracts/{id}/risk-summary", "editContractRiskSummary", CTX, "Legal edits the summary before it goes to the delegate", ["LEGAL"], "RiskSummaryEdit", "RiskSummary")
ep("POST", "/contracts/{id}/risk-summary/review", "reviewContractRiskSummary", CTX, "Legal confirms the summary after review", ["LEGAL"], None, "RiskSummary")
ep("POST", "/contracts/documents", "createSigningDocument", CTX, "Create an NDA, confidentiality agreement or master agreement signed the same way as a contract", LP, "DocumentCreate", "Contract", 201)
ep("GET", "/contracts/{id}/export.pdf", "exportContractPdf", CTX, "The current contract as a PDF with its version and any signatures (audited)", RD, None, None)
ep("GET", "/contracts/{id}/export.docx", "exportContractDocx", CTX, "The current contract as a Word document (audited)", RD, None, None)
ep("POST", "/contracts/{id}/drafts", "uploadAmendedDraft", CTX, "Upload an externally amended draft (kept as a numbered version with its hash)", ["LEGAL"], "DraftUpload", "DraftFile", 201)
ep("GET", "/contracts/{id}/drafts", "listAmendedDrafts", CTX, "Amended drafts uploaded for this contract", RD, None, "DraftList")
ep("GET", "/contracts/{id}/drafts/{fileId}", "downloadAmendedDraft", CTX, "Download an uploaded draft (audited)", RD, None, None)
ep("POST", "/contracts/{id}/comments", "commentOnContract", CTX, "Comment on the draft or one clause while it is being worked on", ["LEGAL", "PROCUREMENT", "CONTRACT_MGR", "FINANCE"], "CommentCreate", "CommentList", 201)
ep("GET", "/contracts/{id}/comments", "listContractComments", CTX, "Comments on the draft", RD, None, "CommentList")
ep("GET", "/contracts/{id}/lineage", "getContractLineage", CTX, "The parent contract and its variations, with cumulative value and the latest end date", RD, None, "Lineage")
ep("POST", "/contracts/{id}/deviations/{clauseId}/explain", "explainDeviation", CTX, "What a deviation means in plain language, with the corporate fallback where one is on file (simulated model)", ["LEGAL", "PROCUREMENT", "DELEGATE", "EXEC", "CONTRACT_MGR", "FINANCE"], None, "DeviationExplanation")
ep("POST", "/contracts/{id}/deviations/{clauseId}/risk/plain", "rateDeviationInWords", CTX, "Legal amends a deviation's risk rating in plain language; read back, saved only when apply is true", ["LEGAL"], "PlainRisk", "PlainRiskResult")
ep("POST", "/contracts/{id}/deviations/{clauseId}/accept-risk", "acceptDeviationRisk", CTX, "The business or a delegate formally accepts the identified risk, with a statement", ["DELEGATE", "EXEC", "CONTRACT_MGR"], "RiskAcceptance", "Contract")
ep("GET", "/contracts/{id}/negotiation-strategy", "getNegotiationStrategy", CTX, "A negotiation strategy: framing, techniques, a graduated set of positions and levers (simulated model)", ["LEGAL", "PROCUREMENT", "DELEGATE", "EXEC"], None, "NegotiationStrategy")
LG = "Legal"
ep("GET", "/legal-knowledge", "listLegalKnowledge", LG, "Policies, historical advice, corporate fallback positions and mandatory boilerplate the advisers draw on", LP, None, "KnowledgeList")
ep("POST", "/legal-knowledge", "addLegalKnowledge", LG, "Add a policy, advice, fallback position or boilerplate", ["LEGAL"], "KnowledgeCreate", "KnowledgeList", 201)
ep("DELETE", "/legal-knowledge/{id}", "removeLegalKnowledge", LG, "Remove an entry", ["LEGAL"], None, None, 204)
ep("GET", "/legal/matters", "listLegalMatters", LG, "The legal kanban board with review hours per matter", LP, None, "MatterBoard")
ep("POST", "/legal/matters", "createLegalMatter", LG, "Open a legal matter, optionally linked to a contract", ["LEGAL"], "MatterCreate", "MatterBoard", 201)
ep("PATCH", "/legal/matters/{id}", "updateLegalMatter", LG, "Move a matter between lanes or change its assignee, priority or due date", ["LEGAL"], "MatterPatch", "MatterBoard")
ep("POST", "/legal/matters/{id}/time", "logReviewHours", LG, "Log review hours against a matter", ["LEGAL"], "TimeEntry", "TimeEntries", 201)
ep("GET", "/legal/matters/{id}/time", "listReviewHours", LG, "Review hours logged against a matter", LP, None, "TimeEntries")
AG = "Access"
STAFF_ALL = ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "ADMIN", "EXEC"]
ep("POST", "/access-grants", "grantProjectAccess", AG, "Give a committee member, auditor or advisor access to one project's documents until a date or an event (for example 30 days after signature)", ["PROCUREMENT", "ADMIN"], "GrantCreate", "GrantList", 201)
ep("GET", "/access-grants", "listProjectAccess", AG, "Access grants with whether each is still live; an expired grant is revoked and audited when read", ["PROCUREMENT", "ADMIN", "PROBITY"], None, "GrantList")
ep("DELETE", "/access-grants/{id}", "revokeProjectAccess", AG, "End a grant now, with a reason", ["PROCUREMENT", "ADMIN"], "GrantRevoke", None, 204)
ep("GET", "/shared/projects", "listSharedProjects", AG, "The projects the caller has a grant for, and the documents each opens while it is live", STAFF_ALL, None, "SharedProjects")
ep("GET", "/shared/projects/{id}/contract.pdf", "downloadSharedContract", AG, "The project's contract as a PDF, while the caller's grant is live", STAFF_ALL, None, None)
ep("GET", "/shared/projects/{id}/report.pdf", "downloadSharedReport", AG, "The project's evaluation report as a PDF, while the caller's grant is live", STAFF_ALL, None, None)
ep("PUT", "/supplier/profile/bank", "setSupplierBank", SU, "Give banking details, checked against the legal name before signature", ["SUPPLIER"], "BankDetails", "BankDetailsView")
ep("GET", "/supplier/contracts", "listSupplierContracts", SU, "Contracts out for signature or signed, for this supplier to read", ["SUPPLIER"], None, "SupplierContractList")
ep("GET", "/supplier/contracts/{id}", "getSupplierContract", SU, "The full contract text, and the supplier's own questions with answers", ["SUPPLIER"], None, "SupplierContractView")
ep("POST", "/supplier/contracts/{id}/questions", "askSupplierContractQuestion", SU, "Raise a question before the contract is signed", ["SUPPLIER"], "ContractQuestionCreate", "ContractQuestions", 201)

ep("GET", "/access-grants/candidates", "listGrantCandidates", AG, "The staff and projects a grant can be made for", ["PROCUREMENT", "ADMIN"], None, "GrantList")
