
# ---------------------------------------------------------------- B6: reporting and collaboration
NUM6 = {"type": "number"}
schemas.update({
    "ScheduleView": OBJ,
    "ScheduleMove": obj({"phase": enum("INTAKE", "PLAN", "TENDER", "EVALUATION", "CONTRACT_AWARD"), "deltaDays": I}, ["phase", "deltaDays"]),
    "ScheduleMoved": OBJ,
    "DashboardList": OBJ,
    "Dashboard": OBJ,
    "PerformanceReport": OBJ,
    "SupplierRiskMap": OBJ,
    "SupplierLocation": obj({"city": S, "state": S, "country": S, "lat": NUM6, "lng": NUM6}, ["city", "state", "country", "lat", "lng"]),
    "ManagerAssign": obj({"managerId": UUID}, ["managerId"]),
    "ManagerAssigned": OBJ,
    "CapacityReport": OBJ,
    "SpendByReport": OBJ,
    "DrillReport": OBJ,
    "ReportView": OBJ,
    "ReportViewCreate": obj({"name": S, "report": enum("procurements", "spend-by", "ask", "schedule", "workload"), "filters": {"type": "object", "additionalProperties": True}, "shared": B}, ["name", "report"]),
    "AskQuestion": obj({"question": S}, ["question"]),
    "AskAnswer": OBJ,
    "LayoutView": OBJ,
    "LayoutSave": obj({"name": S, "sections": arr(obj({"key": S, "enabled": B}, ["key", "enabled"]))}, ["name", "sections"]),
    "PresenceBeat": obj({"fieldKey": S}),
    "Presence": OBJ,
    "DocumentChanges": OBJ,
    "ChangeDigest": OBJ,
    "VersionSave": obj({"label": S}, ["label"]),
    "DocumentVersion": OBJ,
    "DocumentVersions": OBJ,
    "VersionCompare": OBJ,
    "RiskAssessment": OBJ,
    "RiskItemPatch": obj({"applicable": B, "likelihood": I, "impact": I, "mitigation": S}),
    "ResponseSummaries": OBJ,
    "ReferenceContent": OBJ,
    "ReferenceRefreshed": OBJ,
    "PlainInstruction": obj({"instruction": S}, ["instruction"]),
    "AdvanceResult": OBJ,
    "PhaseSync": OBJ,
    "PhaseSyncAll": OBJ,
    "TemplateChanged": OBJ,
    "CommitteeInstruction": obj({"instruction": S, "userId": UUID, "stream": enum("TECHNICAL", "COMMERCIAL", "OTHER")}, ["instruction"]),
    "CommitteeResult": OBJ,
})
schemas["FieldUpdate"] = obj({"value": S, "paragraph": {"type": "integer", "minimum": 1}, "expectedVersion": I, "expectedRev": I}, ["value"])
schemas["TenderFieldUpdate"] = obj({"value": {"type": "string", "maxLength": 10000}, "expectedVersion": I, "expectedRev": I}, ["value"])
RP = "Reporting"
CB = "Collaboration"
REP_USERS = ["EXEC", "FINANCE", "PROCUREMENT", "CONTRACT_MGR", "DELEGATE", "LEGAL", "PROBITY"]
DASH_USERS = ["PROCUREMENT", "LEGAL", "DELEGATE", "EXEC", "FINANCE", "PROBITY", "CONTRACT_MGR", "ADMIN"]
DOCR = ["REQUESTER", "PROCUREMENT", "DELEGATE", "LEGAL", "EXEC", "PROBITY", "FINANCE", "CONTRACT_MGR"]
ep("GET", "/reports/schedule", "getProcurementSchedule", RP, "A Gantt-style view of phase and status across every active procurement, with the delegate calendar worked out from it", ["PROCUREMENT", "EXEC", "DELEGATE"], None, "ScheduleView")
ep("POST", "/reports/schedule/{requestId}/move", "moveSchedulePhase", RP, "Drag a phase earlier or later; every phase after it moves by the same, and the delegate calendar is recalculated and the delegates told", ["PROCUREMENT"], "ScheduleMove", "ScheduleMoved", note="422 SCHEDULE_CONFLICT")
ep("GET", "/dashboards", "listDashboards", RP, "The dashboard views open to the caller by role, and the scope the organisation hierarchy gives them", DASH_USERS, None, "DashboardList")
ep("GET", "/dashboards/{view}", "getDashboard", RP, "One dashboard (procurement, legal, delegate, executive, finance, risk, division) scoped by the organisational hierarchy unless the organisation chose broader visibility", DASH_USERS, None, "Dashboard")
ep("GET", "/reports/performance", "getPerformanceReport", RP, "Category spend, maverick spend (invoices released outside the contract match and purchases with no contract), captured savings and procurement velocity with the bottleneck phase", ["EXEC", "FINANCE", "PROCUREMENT"], None, "PerformanceReport")
ep("GET", "/reports/supplier-risk", "getSupplierRiskMap", RP, "Supplier locations with simulated weather, financial-distress and geopolitical signals, and the single points of failure", ["PROCUREMENT", "EXEC", "FINANCE", "PROBITY"], None, "SupplierRiskMap")
ep("PUT", "/suppliers/{id}/location", "setSupplierLocation", RP, "Record where a supplier operates from, for the risk map", ["PROCUREMENT", "ADMIN"], "SupplierLocation", "SupplierLocation")
ep("PUT", "/requests/{id}/manager", "assignProcurementManager", RP, "Assign a procurement to a manager in the procurement team", ["PROCUREMENT", "EXEC"], "ManagerAssign", "ManagerAssigned", note="422 NOT_A_MANAGER")
ep("GET", "/reports/capacity", "getCapacityReport", RP, "Active procurements and dollar exposure by assigned manager against capacity, with a rebalancing suggestion", ["PROCUREMENT", "EXEC"], None, "CapacityReport")
ep("GET", "/reports/spend-by", "getSpendBy", RP, "Committed and invoiced spend by supplier, contract, master agreement, project, business unit or division", ["EXEC", "FINANCE", "PROCUREMENT"], None, "SpendByReport", query=["dimension"])
ep("GET", "/reports/drill", "drillReport", RP, "The procurements behind a figure: by phase, category, manager, business unit or status", REP_USERS, None, "DrillReport", query=["by", "key"])
ep("GET", "/report-views", "listReportViews", RP, "The caller's saved views and those shared by others", REP_USERS, None, "ReportView", arrayResp=True)
ep("POST", "/report-views", "saveReportView", RP, "Save a custom view of a report, for the caller or shared", REP_USERS, "ReportViewCreate", "ReportView", 201)
ep("DELETE", "/report-views/{id}", "deleteReportView", RP, "Delete one of the caller's saved views", REP_USERS, None, None, 204)
ep("POST", "/reports/ask", "askReport", RP, "Ask for a report in plain language, such as: all procurement risks in 2026 (rules-simulated interpretation, shown back)", REP_USERS, "AskQuestion", "AskAnswer", note="422 QUESTION_NOT_UNDERSTOOD")
ep("GET", "/layouts", "listLayouts", CB, "The layout of the plan, the tender pack and the evaluation report: the organisation's own, or the system default", ["ADMIN", "PROCUREMENT", "LEGAL", "DELEGATE", "EXEC"], None, "LayoutView", arrayResp=True)
ep("PUT", "/layouts/{kind}", "saveLayout", CB, "Design a layout by ordering sections and switching optional ones off; mandatory sections cannot be left out", ["ADMIN", "PROCUREMENT"], "LayoutSave", "LayoutView", note="422 LAYOUT_INVALID")
ep("DELETE", "/layouts/{kind}", "resetLayout", CB, "Go back to the system default layout", ["ADMIN", "PROCUREMENT"], None, "LayoutView")
ep("POST", "/documents/{type}/{id}/presence", "documentPresence", CB, "Say you are working on a document (and which section); returns who else is", DOCR, "PresenceBeat", "Presence")
ep("GET", "/documents/{type}/{id}/presence", "getDocumentPresence", CB, "Who else has been in the document in the last minute, and where", DOCR, None, "Presence")
ep("GET", "/documents/{type}/{id}/changes", "getDocumentChanges", CB, "Tracked changes: every change to a section, who made it and when, with a word-by-word comparison", DOCR, None, "DocumentChanges", query=["since"])
ep("GET", "/documents/{type}/{id}/summary", "summariseDocumentChanges", CB, "A digest of what changed since the caller last looked (rules-simulated); markSeen=true records the look", DOCR, None, "ChangeDigest", query=["markSeen"])
ep("POST", "/documents/{type}/{id}/versions", "saveDocumentVersion", CB, "Keep a named version of the document as it stands", DOCR, "VersionSave", "DocumentVersion", 201)
ep("GET", "/documents/{type}/{id}/versions", "listDocumentVersions", CB, "The saved versions of a document", DOCR, None, "DocumentVersions")
ep("GET", "/documents/{type}/{id}/versions/{number}", "getDocumentVersion", CB, "One saved version, section by section", DOCR, None, "DocumentVersion")
ep("GET", "/documents/{type}/{id}/compare", "compareDocumentVersions", CB, "Compare two saved versions, or a version with the current text, highlighting what changed", DOCR, None, "VersionCompare", query=["from", "to"])
ep("POST", "/requests/{id}/risk-assessment/generate", "generateRiskAssessment", CB, "Draft a risk assessment for the procurement: candidate risks to mark applicable or not (rules-simulated)", ["REQUESTER", "PROCUREMENT"], None, "RiskAssessment", 201, note="409 ASSESSMENT_EXISTS")
ep("GET", "/requests/{id}/risk-assessment", "getRiskAssessment", CB, "The risk assessment, with what still needs a decision, a rating or a treatment", ["REQUESTER", "PROCUREMENT", "DELEGATE", "EXEC", "PROBITY", "LEGAL"], None, "RiskAssessment")
ep("PATCH", "/requests/{id}/risk-assessment/items/{key}", "updateRiskItem", CB, "Mark a risk applicable or not, rate its likelihood and impact, and choose or write a treatment", ["REQUESTER", "PROCUREMENT"], "RiskItemPatch", "RiskAssessment")
ep("POST", "/requests/{id}/risk-assessment/complete", "completeRiskAssessment", CB, "Complete the assessment once every risk has a decision, a rating where it applies, and a treatment for the medium and high ones", ["REQUESTER", "PROCUREMENT"], None, "RiskAssessment", note="422 ASSESSMENT_INCOMPLETE")
ep("GET", "/tenders/{id}/response-summaries", "summariseResponses", CB, "A summary of each supplier response after close: pricing, dates, changes proposed to the tender, pros and cons (rules-simulated); anonymous for panel members", ["PROCUREMENT", "LEGAL", "CHAIR", "EVALUATOR"], None, "ResponseSummaries", note="409 TENDER_SEALED")
ep("GET", "/reference-content", "listReferenceContent", CB, "The in-house corpus of best-practice content (for example role descriptions); renewed by itself when older than the refresh period", ["ADMIN", "PROCUREMENT", "LEGAL", "REQUESTER"], None, "ReferenceContent", query=["kind", "category", "level"])
ep("POST", "/reference-content/refresh", "refreshReferenceContent", CB, "Regenerate the corpus now as a new generation, entirely inside the platform", ["ADMIN", "PROCUREMENT"], None, "ReferenceRefreshed", 201)
ep("POST", "/requests/{id}/advance", "advanceProcurement", CB, "Move a procurement to a later phase from a plain-language instruction, only if the phases before it are finished", ["PROCUREMENT", "EXEC", "REQUESTER"], "PlainInstruction", "AdvanceResult", note="409 PHASE_NOT_COMPLETE")
ep("POST", "/requests/{id}/phase/sync", "syncProcurementPhase", CB, "Detect that a phase is complete from the records and move the tracker on", ["PROCUREMENT", "EXEC", "REQUESTER"], None, "PhaseSync")
ep("POST", "/requests/phase-sync", "syncAllProcurementPhases", CB, "Catch every procurement's tracker up with its records", ["PROCUREMENT", "EXEC"], None, "PhaseSyncAll")
ep("POST", "/tenders/{id}/template-change", "changeTenderTemplate", CB, "Change a staged tender to another template in plain language and fill it in again, keeping sections a person wrote", ["PROCUREMENT"], "PlainInstruction", "TemplateChanged")
ep("POST", "/evaluations/{id}/committee/instruct", "instructCommittee", CB, "Add or remove an evaluation committee member from an instruction or a name, with a picker where several people match", ["PROCUREMENT"], "CommitteeInstruction", "CommitteeResult", note="status AMBIGUOUS lists candidates; 409 HAS_SCORES")
