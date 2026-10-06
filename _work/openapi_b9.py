
# ---------------------------------------------------------------- B9: planning, spend and experience
schemas.update({n: OBJ for n in [
    "FxRates", "FxRatesSave", "FxRefreshResult", "FxConversion", "DashboardView", "DashboardSave", "AnalyticsStatus", "AnalyticsRefreshed",
    "FutureCommitment", "OptimisationReport", "ReviewNoteTargets", "ReviewNoteCreate", "ReviewNote", "GrcItem", "GrcItemCreate", "GrcItemUpdate",
    "GrcActionCreate", "GrcSummary", "GrcSyncResult", "Branding", "ProgressView", "AppliedLayout", "CatalogueView", "CatalogueItemCreate",
    "CatalogueItemUpdate", "CatalogueItemResult", "BuyingOrder", "BuyingOrderResult", "SourceNeed", "SourcingProposal", "ProposalDecision",
    "ArtefactState", "ArtefactRefreshed", "SearchQuery", "SearchResult", "ExternalSearchLog",
]})
FX = "Currency"; AN = "Analytics"; DB = "Dashboards"; GR = "RiskRegister"; BY = "GuidedBuying"; AF = "Artefacts"; SR = "Search"; PG = "Progress"
STAFF_ALL = ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "ADMIN", "EXEC"]
STAFF_BUY = ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "EXEC"]
NOTERS = ["PROCUREMENT", "LEGAL", "FINANCE", "EXEC", "CONTRACT_MGR", "PROBITY", "DELEGATE", "EVALUATOR", "CHAIR"]
GRC_R = ["PROBITY", "EXEC", "LEGAL", "FINANCE", "PROCUREMENT", "CONTRACT_MGR", "DELEGATE"]
GRC_W = ["PROBITY", "EXEC", "LEGAL", "PROCUREMENT", "FINANCE"]
ANR = ["EXEC", "FINANCE", "PROCUREMENT", "CONTRACT_MGR"]
ep("GET", "/fx/rates", "listFxRates", FX, "Exchange rates in force today and the history, by annual or live setting", STAFF_ALL, None, "FxRates")
ep("PUT", "/fx/rates", "saveFxRates", FX, "Set the annual rates for a financial year", ["ADMIN", "FINANCE"], "FxRatesSave", "FxRates", note="422 unsupported currency or a rate that is not positive")
ep("POST", "/fx/refresh", "refreshFxRates", FX, "Pull the latest simulated live rates", ["ADMIN", "FINANCE"], None, "FxRefreshResult")
ep("GET", "/fx/convert", "convertAmount", FX, "Convert an amount to AUD at the rate in force on a date", STAFF_ALL, None, "FxConversion", query=["amount", "currency", "on"])
ep("GET", "/me/dashboard", "getMyDashboard", DB, "My own dashboard: the widgets I chose, or the default for my role, and the catalogue I may choose from", STAFF_ALL, None, "DashboardView")
ep("PUT", "/me/dashboard", "saveMyDashboard", DB, "Choose, order, size and style my widgets", STAFF_ALL, "DashboardSave", "DashboardView", note="422 for a widget my role cannot use or a style it cannot take")
ep("DELETE", "/me/dashboard", "resetMyDashboard", DB, "Go back to the default dashboard for my role", STAFF_ALL, None, "DashboardView")
ep("GET", "/analytics/status", "getAnalyticsStatus", AN, "When the separate analytics store was last refreshed from the main database", ANR + ["ADMIN"], None, "AnalyticsStatus")
ep("POST", "/analytics/refresh", "refreshAnalytics", AN, "Refresh the analytics store now", ["EXEC", "FINANCE", "PROCUREMENT", "ADMIN"], None, "AnalyticsRefreshed")
ep("GET", "/reports/future-commitment", "getFutureCommitment", AN, "What the enterprise is committed to pay in future: fixed amounts, ceilings, ranges, unknowns and extensions", ANR, None, "FutureCommitment")
ep("GET", "/reports/optimisation", "getOptimisation", AN, "Where spend can be reduced: consolidation, duplicate contracts, rate card gaps and price variance", ANR, None, "OptimisationReport")
ep("GET", "/notes/targets", "listNoteTargets", PG, "The suppliers the caller may take review notes about", NOTERS, None, "ReviewNoteTargets")
ep("POST", "/notes", "createNote", PG, "Take a note about a supplier, private or shared with the team", NOTERS, "ReviewNoteCreate", "ReviewNote", 201)
ep("GET", "/notes", "listNotes", PG, "My notes, and the ones others shared, about a supplier", NOTERS, None, "ReviewNote", arrayResp=True, query=["supplierId"])
ep("DELETE", "/notes/{id}", "deleteNote", PG, "Delete one of my own notes", NOTERS, None, None, 204)
ep("GET", "/grc/items", "listGrcItems", GR, "Risks, audit findings and obligations in the register", GRC_R, None, "GrcItem", arrayResp=True, query=["kind", "status"])
ep("POST", "/grc/items", "createGrcItem", GR, "Add a risk, an audit finding or an obligation", GRC_W, "GrcItemCreate", "GrcItem", 201, note="422 a risk needs likelihood and impact")
ep("PATCH", "/grc/items/{id}", "updateGrcItem", GR, "Change the rating, owner, dates or status", GRC_W, "GrcItemUpdate", "GrcItem", note="422 accepting needs a treatment of at least ten characters")
ep("POST", "/grc/items/{id}/actions", "addGrcAction", GR, "Assign an action; the owner is notified", GRC_W, "GrcActionCreate", "GrcItem", 201)
ep("POST", "/grc/items/{id}/actions/{actionId}/complete", "completeGrcAction", GR, "Mark an action done", GRC_W, None, "GrcItem")
ep("GET", "/grc/summary", "getGrcSummary", GR, "Counts by kind and status and the likelihood and impact heat map", GRC_R, None, "GrcSummary")
ep("POST", "/grc/sync", "syncGrc", GR, "Pull in what the platform already knows (sanctions, expired insurance and the like), once each", ["PROBITY", "EXEC"], None, "GrcSyncResult")
ep("GET", "/branding", "getBranding", FX, "The product name, tagline, palette and support address (shown on the sign-in page)", None, None, "Branding")
ep("GET", "/requests/{id}/progress", "getRequestProgress", PG, "How far a procurement has come, by milestone", STAFF_ALL, None, "ProgressView", note="404 for a request the caller cannot see; 403 for suppliers")
ep("GET", "/layouts/{kind}/applied", "getAppliedLayout", PG, "What a page shows and in what order, for anyone who can open the page", STAFF_ALL, None, "AppliedLayout")
ep("GET", "/catalogue", "listCatalogue", BY, "The approved catalogue, with suppliers that cannot be ordered from marked", STAFF_BUY, None, "CatalogueView", query=["q", "category"])
ep("POST", "/catalogue", "addCatalogueItem", BY, "Add a catalogue item", ["PROCUREMENT"], "CatalogueItemCreate", "CatalogueItemResult", 201)
ep("PATCH", "/catalogue/{id}", "updateCatalogueItem", BY, "Change the price, lead time or whether it is offered", ["PROCUREMENT"], "CatalogueItemUpdate", "CatalogueItemResult")
ep("POST", "/buying/orders", "orderFromCatalogue", BY, "Draft a request from chosen catalogue lines", ["REQUESTER", "PROCUREMENT"], "BuyingOrder", "BuyingOrderResult", 201)
ep("POST", "/buying/auto-source", "autoSource", BY, "Describe a need: the platform shortlists, scores and recommends (rules-simulated-v1)", ["REQUESTER", "PROCUREMENT"], "SourceNeed", "SourcingProposal", 201)
ep("GET", "/buying/proposals", "listProposals", BY, "My sourcing proposals (procurement sees all)", ["REQUESTER", "PROCUREMENT"], None, "SourcingProposal", arrayResp=True)
ep("POST", "/buying/proposals/{id}/decision", "decideProposal", BY, "A person approves or rejects a recommendation; approving drafts a request", ["REQUESTER", "PROCUREMENT"], "ProposalDecision", "SourcingProposal", note="409 OVER_LIMIT above the limit; SUPPLIER_NOT_APPROVED")
ep("GET", "/artefacts/{kind}/{id}/state", "getArtefactState", AF, "Whether an evaluation report or contract plans are out of date, and when they will be refreshed", ["PROCUREMENT", "DELEGATE", "EXEC", "PROBITY", "CHAIR", "LEGAL", "CONTRACT_MGR"], None, "ArtefactState")
ep("POST", "/artefacts/{kind}/{id}/refresh", "refreshArtefact", AF, "Bring an artefact up to date now", ["PROCUREMENT", "CONTRACT_MGR", "LEGAL"], None, "ArtefactRefreshed", note="409 for an approved report")
ep("POST", "/search", "search", SR, "Search my records, and an outside source when the organisation allows it (identifiers withheld)", STAFF_BUY, "SearchQuery", "SearchResult")
ep("GET", "/search/external-log", "listExternalSearchLog", SR, "Every question sent to an outside source and what was withheld", ["ADMIN", "PROBITY", "EXEC"], None, "ExternalSearchLog", arrayResp=True)
