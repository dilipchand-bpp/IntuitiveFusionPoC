# Batch BCP, agent runtime (CP-01, CP-02, CP-03, CP-06): the Procurement Copilot runs, their live feed, the specialist registry and
# the dashboard summary. Executed from openapi_ext.py inside gen_openapi.py's namespace. All AI in the layer is simulated and
# rules-based (engine rules-simulated-v1).
CP_ROLES = ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "ADMIN", "EXEC"]
schemas.update({
    "CopilotRunStart": obj({
        "text": {"type": "string", "minLength": 3, "maxLength": 4000},
        "procurementId": UUID,
        "mode": enum("FULL", "ASSISTED"),
        "autoAdvance": B,
        "source": enum("TEXT", "VOICE"),
    }, ["text"]),
    "CopilotRunView": OBJ,
    "CopilotRunList": obj({"items": arr(OBJ), "scope": enum("MINE", "ALL")}, ["items", "scope"]),
    "CopilotEvents": obj({
        "events": arr(obj({"seq": I, "at": DT, "kind": enum("STEP", "GATE", "PROBLEM", "REPAIR", "HANDOFF", "STATUS", "NOTE"),
                           "agent": S, "agentLabel": S, "title": S, "detail": S, "data": OBJ}, ["seq", "at", "kind", "agent", "title"])),
        "cursor": I, "status": S, "stage": S, "currentAgent": S, "currentAgentLabel": S, "currentAction": S, "waitingFor": arr(OBJ),
    }, ["events", "cursor", "status", "stage"]),
    "CopilotProblems": obj({"maxAttempts": I, "problems": arr(OBJ)}, ["maxAttempts", "problems"]),
    "CopilotAgents": obj({"engine": S, "simulated": B, "agents": arr(OBJ), "principles": arr(S)}, ["engine", "simulated", "agents"]),
    "CopilotSummary": obj({
        "engine": S, "simulated": B, "scope": enum("MINE", "ALL"), "total": I, "active": I, "running": I, "waitingForPerson": I,
        "needsHuman": I, "repaired": I, "completed": I, "waitingOnMe": I, "recent": arr(OBJ),
    }, ["engine", "total", "active", "waitingForPerson", "repaired", "completed"]),
})
CPA = "Copilot"
ep("POST", "/copilot/runs", "startCopilotRun", CPA, "Start a Procurement Copilot run from plain text (typed or dictated) or for an existing procurement. The agent acts as the caller through the application's own routes, so it can never do more than the caller can; it stops at every approval, signature, declaration and scoring gate. SIMULATED, rules-based (rules-simulated-v1)", CP_ROLES, "CopilotRunStart", "CopilotRunView", 201, note="403 when no procurement is named and the caller may not raise a request; 404 for a procurement the caller cannot see. Unless autoAdvance is false the first tick runs before the response")
ep("GET", "/copilot/runs", "listCopilotRuns", CPA, "The caller's runs; managers (procurement, executive, administrator) see every run in the organisation", CP_ROLES, None, "CopilotRunList", query=["status", "limit"])
ep("GET", "/copilot/runs/{id}", "getCopilotRun", CPA, "One run: status, stage timeline, steps with the agent, tool, reason and rule, open and closed gates (who it is waiting for), problems with repairs tried, specialist agents and hand-offs", CP_ROLES, None, "CopilotRunView", note="A run that is not the caller's looks like one that does not exist, unless the caller is a manager")
ep("GET", "/copilot/runs/{id}/events", "getCopilotRunEvents", CPA, "The live activity feed after a cursor (after = the last seq seen); the run page polls this every 3 seconds", CP_ROLES, None, "CopilotEvents", query=["after", "limit"])
ep("GET", "/copilot/runs/{id}/problems", "getCopilotRunProblems", CPA, "Issues found, the repairs tried in order (at most 3 attempts) and the outcome: repaired, or escalated to a named person", CP_ROLES, None, "CopilotProblems")
ep("POST", "/copilot/runs/{id}/advance", "advanceCopilotRun", CPA, "Run one tick now. A tick reads the current state, so a step that is done is never repeated; on a run waiting for a person it also tries a problem again", CP_ROLES, None, "CopilotRunView", note="403 unless the caller started the run (or is an administrator); 409 when paused or finished")
ep("POST", "/copilot/runs/{id}/pause", "pauseCopilotRun", CPA, "Pause the run; nothing more happens until it is resumed", CP_ROLES, None, "CopilotRunView", note="403 unless the caller started the run (or is an administrator); 409 when already paused or finished")
ep("POST", "/copilot/runs/{id}/resume", "resumeCopilotRun", CPA, "Resume a paused run", CP_ROLES, None, "CopilotRunView", note="403 unless the caller started the run (or is an administrator); 409 when not paused")
ep("POST", "/copilot/runs/{id}/cancel", "cancelCopilotRun", CPA, "Cancel the run and close its gates; what was already done on the procurement stays", CP_ROLES, None, "CopilotRunView", note="403 unless the caller started the run (or is an administrator); 409 when finished")
ep("POST", "/copilot/runs/{id}/simulate-suppliers", "simulateCopilotSuppliers", CPA, "Demonstration only: the seeded demo supplier contacts each submit a bid labelled SIMULATED through the supplier-portal routes with their own sessions. Never automatic", CP_ROLES, None, "CopilotRunView", note="403 unless the caller started the run (or is an administrator); 409 TENDER_NOT_OPEN when the run has no open tender")
ep("POST", "/copilot/runs/{id}/simulate-close", "simulateCopilotClose", CPA, "Demonstration only: moves the closing time of the run's open tender to now, skipping the statutory open period, so the run can go on to evaluation. Labelled SIMULATED, audited, refused in production. Never automatic", CP_ROLES, None, "CopilotRunView", note="403 unless the caller started the run (or is an administrator); 409 TENDER_NOT_OPEN when the run has no open tender; 409 NO_BIDS_TO_CLOSE when no bid has been submitted")
ep("GET", "/copilot/agents", "listCopilotAgents", CPA, "The specialist registry (orchestrator, intake and drafting, compliance, workflow, document filling, contract data): purpose, the tools each owns with the roles their routes allow, and what each may not do", CP_ROLES, None, "CopilotAgents")
ep("GET", "/copilot/summary", "getCopilotSummary", CPA, "The dashboard card: runs active, waiting for a person, problems repaired, completed, and how many gates wait for the caller", CP_ROLES, None, "CopilotSummary")
