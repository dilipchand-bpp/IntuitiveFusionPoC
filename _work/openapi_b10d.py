# ---------------------------------------------------------------- B10 (AI layer, configuration, client baseline, performance)
schemas.update({n: OBJ for n in [
    "AiModelCatalogue", "AiApprovalRequest", "AiApprovalRequested", "AiApprovalDecision", "AiApprovalDecided", "AiRevoke", "AiRevoked",
    "AiActiveModel", "AiActiveModelSave", "ConfigInventory", "ConfigExport", "ConfigImport", "ConfigImportResult", "ClientCheck",
    "ClientCheckResult", "ClientBaselineSummary", "BudgetCheckPerformance",
]})
AI = "AiModels"; CF = "Configuration"; PF = "Performance"
AI_VIEW = ["ADMIN", "PROCUREMENT", "PROBITY", "EXEC"]
STAFF_B10 = ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "ADMIN", "EXEC"]
ep("GET", "/ai/models", "listAiModels", AI, "The AI models the platform can use, each with its approval state for this tenant and its data-handling profile (SEC-TP07)", AI_VIEW, None, "AiModelCatalogue")
ep("POST", "/ai/models/{key}/request-approval", "requestAiModelApproval", AI, "Ask for a third-party AI model to be approved for this tenant", ["ADMIN", "PROCUREMENT"], "AiApprovalRequest", "AiApprovalRequested", 201, note="409 for the built-in model, an approved model or one with a request already waiting; 404 unknown model")
ep("POST", "/ai/approvals/{id}/decision", "decideAiApproval", AI, "Approve or reject a request; never the person who made it", ["PROBITY", "EXEC"], "AiApprovalDecision", "AiApprovalDecided", note="403 SELF_APPROVAL when the caller made the request; 409 when already decided")
ep("POST", "/ai/models/{key}/revoke", "revokeAiModel", AI, "Withdraw an approval; the tenant falls back to rules-simulated-v1 at once and the change is audited", ["ADMIN", "PROBITY", "EXEC"], "AiRevoke", "AiRevoked", note="409 unless the model is approved")
ep("GET", "/ai/active-model", "getActiveAiModel", AI, "The model answering for this tenant now, and any per-task choices", STAFF_B10, None, "AiActiveModel")
ep("PUT", "/ai/active-model", "setActiveAiModel", AI, "Switch the active model (and optional per-task models) by configuration; takes effect at once and is audited with old and new value", ["ADMIN"], "AiActiveModelSave", "AiActiveModel", note="409 MODEL_NOT_APPROVED for a third-party model that is not approved; 422 unknown model")
ep("GET", "/admin/config/inventory", "getConfigInventory", CF, "Every settings section: fields, defaults, current value, who changed it last and the screen that edits it (NFR-M05)", ["ADMIN"], None, "ConfigInventory")
ep("GET", "/admin/config/export", "exportConfig", CF, "All tenant configuration as a JSON file; secrets are left empty and no user data is included", ["ADMIN"], None, "ConfigExport", note="application/json attachment")
ep("POST", "/admin/config/import", "importConfig", CF, "Validate a configuration file with the same schemas and show the difference; applies only when dryRun is false", ["ADMIN"], "ConfigImport", "ConfigImportResult", note="dryRun defaults to true; 422 when applying an invalid file")
ep("POST", "/auth/client-check", "reportClientCheck", CF, "A signed-in browser reports its user agent and feature support; the server judges it against the published baseline and counts it", "*", "ClientCheck", "ClientCheckResult", note="Stores browser family, major version and the verdict only")
ep("GET", "/admin/client-baseline", "getClientBaseline", CF, "Counts of sign-ins by browser and whether the baseline was met, with the published baseline", ["ADMIN"], None, "ClientBaselineSummary")
ep("GET", "/admin/performance/budget-check", "getBudgetCheckPerformance", PF, "Count, p50, p95 and max of the measured budget check against the configured target (NFR-P04)", ["ADMIN"], None, "BudgetCheckPerformance", query=["last"])
