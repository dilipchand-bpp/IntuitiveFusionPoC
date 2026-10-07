# ---------------------------------------------------------------- B11b (residency, egress, retention, classification, privacy, content safety, breach, topology)
schemas.update({n: OBJ for n in [
    "ResidencyView", "ResidencyChange", "ResidencyChanged", "EgressView", "EgressChange", "EgressProbe", "EgressProbeResult",
    "RetentionView", "RetentionChange", "RetentionRun", "LegalHoldCreate", "LegalHoldCreated", "LegalHoldRelease", "LegalHoldReleased",
    "ClassificationRun", "ClassificationView", "ClassificationReview", "ClassificationReviewed",
    "PrivacyNotice", "PrivacyNoticeStatus", "PrivacyNoticeAck", "PrivacyNoticeAcked", "PrivacySettings",
    "PrivacyRequestLodge", "PrivacyRequestLog", "PrivacyRequestView", "PrivacyRequestList", "PrivacyRequestAssign", "PrivacyRequestVerify",
    "PrivacyRequestComplete", "PrivacyRequestRefuse", "PrivacyOverdueRun", "PrivacyExport",
    "ContentFlags", "ContentFlagReviewed", "ContentInspect", "ContentInspectResult",
    "IncidentReport", "IncidentReported", "IncidentList", "IncidentMine", "IncidentView", "IncidentQuestions", "IncidentAssess",
    "IncidentContainment", "IncidentRemindersRun", "IncidentClose", "HostingTopology",
]})
RS = "Residency"; EG = "Egress"; RT = "Retention"; CL = "Classification"; PV = "Privacy"; CS = "ContentSafety"; IN = "Incidents"; DS = "Design"
RES_READ = ["ADMIN", "PROBITY", "EXEC"]
PRIV_MGR = ["ADMIN", "LEGAL", "PROBITY"]
INC_MGR = ["ADMIN", "PROBITY", "LEGAL", "EXEC"]
SAFETY = ["ADMIN", "PROBITY", "PROCUREMENT"]
STAFF_B11 = ["REQUESTER", "PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "ADMIN", "EXEC"]
ep("GET", "/admin/residency", "getResidency", RS, "The elected hosting country, allowed regions, every outbound path with its region and whether it is allowed, and recent refusals (NFR-R02, SEC-D09)", RES_READ, None, "ResidencyView")
ep("PUT", "/admin/residency", "setResidency", RS, "Change the hosting country, allowed regions, AI region or log region; a reason is required and the change is audited. Connectors now outside the allowed regions are switched off; nothing is ever switched back on", ["ADMIN"], "ResidencyChange", "ResidencyChanged", note="422 VALIDATION_FAILED without a reason; 409 NO_CHANGE")
ep("GET", "/admin/egress", "getEgress", EG, "The egress allow-list, the evidence text and the attempts blocked (SEC-D05)", RES_READ, None, "EgressView")
ep("PUT", "/admin/egress", "setEgress", EG, "Replace the egress allow-list; a reason is required, a too-broad wildcard is refused, the change is audited", ["ADMIN"], "EgressChange", "EgressView", note="422 for an invalid or too broad host pattern")
ep("POST", "/admin/egress/probe", "probeEgress", EG, "Try a host through the egress gate; a host not on the list is refused, audited and counted", ["ADMIN"], "EgressProbe", "EgressProbeResult", note="422 EGRESS_BLOCKED when the host is not on the allow-list")
ep("GET", "/privacy/retention", "getRetention", RT, "AI conversation retention setting, stamps, legal holds and recent purge runs (SEC-D06)", PRIV_MGR, None, "RetentionView")
ep("PUT", "/privacy/retention", "setRetention", RT, "Set the days an AI conversation transcript is kept (30 at least); audited", ["ADMIN"], "RetentionChange", "RetentionView", note="400 below 30 days")
ep("POST", "/privacy/retention/run", "runRetention", RT, "Anonymise expired AI conversation transcripts now; legal-hold records are skipped and the reason recorded; audit events are never touched", ["ADMIN"], None, "RetentionRun")
ep("POST", "/privacy/legal-holds", "placeLegalHold", RT, "Place a legal hold on a request or a conversation so it is never purged", PRIV_MGR, "LegalHoldCreate", "LegalHoldCreated", 201, note="409 ALREADY_HELD; 404 unknown record")
ep("POST", "/privacy/legal-holds/{id}/release", "releaseLegalHold", RT, "Release a legal hold, with a reason", PRIV_MGR, "LegalHoldRelease", "LegalHoldReleased", note="409 ALREADY_RELEASED")
ep("POST", "/privacy/classification/run", "runClassification", CL, "Scan the text-bearing tables and classify what is found; idempotent; stores masked samples only (SEC-D07)", ["ADMIN", "PROBITY"], None, "ClassificationRun")
ep("GET", "/privacy/classification", "getClassification", CL, "Findings summarised by class and location, with warnings for sensitive data in unexpected places", ["PROBITY", "ADMIN", "LEGAL", "EXEC"], None, "ClassificationView", query=["status", "class", "warningsOnly"])
ep("POST", "/privacy/classification/{id}/review", "reviewClassification", CL, "Confirm or dismiss a finding, with a reason", ["ADMIN", "PROBITY", "LEGAL"], "ClassificationReview", "ClassificationReviewed")
ep("GET", "/privacy/notice", "getPrivacyNotice", PV, "The collection notice and its version for a place where personal information is collected (SEC-D08)", None, None, "PrivacyNotice", query=["context"])
ep("GET", "/privacy/notice/status", "getPrivacyNoticeStatus", PV, "Which places the signed-in person has acknowledged the current notice version", "*", None, "PrivacyNoticeStatus")
ep("POST", "/privacy/notice/ack", "acknowledgePrivacyNotice", PV, "Record that the signed-in person acknowledged the current notice version in a place", "*", "PrivacyNoticeAck", "PrivacyNoticeAcked", 201, note="200 when already acknowledged")
ep("GET", "/privacy/settings", "getPrivacySettings", PV, "Notice text and version, privacy officer role and response days", PRIV_MGR, None, "PrivacySettings")
ep("PUT", "/privacy/settings", "setPrivacySettings", PV, "Change the notice, officer role and response days; audited", ["ADMIN"], "PrivacySettings", "PrivacySettings")
ep("POST", "/privacy/requests", "lodgePrivacyRequest", PV, "Lodge an access or correction request about yourself; identity is verified because you are signed in (staff or supplier contact)", "*", "PrivacyRequestLodge", "PrivacyRequestView", 201)
ep("GET", "/privacy/requests/mine", "listMyPrivacyRequests", PV, "Your own privacy requests and their state", "*", None, "PrivacyRequestList")
ep("GET", "/privacy/requests", "listPrivacyRequests", PV, "All privacy requests with due dates and overdue flags", PRIV_MGR, None, "PrivacyRequestList", query=["status"])
ep("POST", "/privacy/requests/log", "logPrivacyRequest", PV, "Log a request taken from a caller; staff record how identity was verified", PRIV_MGR, "PrivacyRequestLog", "PrivacyRequestView", 201)
ep("POST", "/privacy/requests/run-overdue", "escalateOverduePrivacyRequests", PV, "Escalate each overdue request once to the privacy officer role", PRIV_MGR, None, "PrivacyOverdueRun")
ep("POST", "/privacy/requests/{id}/assign", "assignPrivacyRequest", PV, "Take or assign a request; moves it to IN_PROGRESS", PRIV_MGR, "PrivacyRequestAssign", "PrivacyRequestView", note="409 when closed")
ep("POST", "/privacy/requests/{id}/verify", "verifyPrivacyRequest", PV, "Record how the requester's identity was verified", PRIV_MGR, "PrivacyRequestVerify", "PrivacyRequestView")
ep("POST", "/privacy/requests/{id}/apply-correction", "applyPrivacyCorrection", PV, "Apply the requested correction to the person's profile with a before and after audit", PRIV_MGR, None, "PrivacyRequestView", note="409 IDENTITY_NOT_VERIFIED, ALREADY_APPLIED or EMAIL_IN_USE")
ep("POST", "/privacy/requests/{id}/complete", "completePrivacyRequest", PV, "Complete a request with a response summary", PRIV_MGR, "PrivacyRequestComplete", "PrivacyRequestView", note="409 until identity is verified and the export or correction is done")
ep("POST", "/privacy/requests/{id}/refuse", "refusePrivacyRequest", PV, "Refuse a request; a reason is required", PRIV_MGR, "PrivacyRequestRefuse", "PrivacyRequestView")
ep("GET", "/privacy/requests/{id}/export", "exportPrivacyRequest", PV, "The person's own records as a JSON download; managers any time after verification, the requester once the request is completed", "*", None, "PrivacyExport", note="application/json attachment; 404 for anyone else; 409 until verified or completed")
ep("GET", "/content-safety/flags", "listContentFlags", CS, "Recent supplier or uploaded text that contained instruction-like content (SEC-AP08)", SAFETY, None, "ContentFlags")
ep("POST", "/content-safety/flags/{id}/review", "reviewContentFlag", CS, "Mark a flag reviewed", SAFETY, None, "ContentFlagReviewed")
ep("POST", "/content-safety/inspect", "inspectContent", CS, "Show how a piece of text would be neutralised, wrapped as data and flagged", SAFETY, "ContentInspect", "ContentInspectResult")
ep("POST", "/incidents/report", "reportIncident", IN, "Report a suspected data breach; any staff member (SEC-IR05)", STAFF_B11, "IncidentReport", "IncidentReported", 201)
ep("GET", "/incidents/mine", "listMyIncidents", IN, "Incidents you reported", STAFF_B11, None, "IncidentMine")
ep("GET", "/incidents/questions", "getIncidentQuestions", IN, "The assessment questions and the rule set (rules-simulated-v1; decision support, not legal advice)", INC_MGR, None, "IncidentQuestions")
ep("GET", "/incidents", "listIncidents", IN, "All incidents with deadlines and recommendations", INC_MGR, None, "IncidentList")
ep("POST", "/incidents/run-reminders", "runIncidentReminders", IN, "Remind, then escalate, incidents whose 30-day assessment is outstanding", INC_MGR, None, "IncidentRemindersRun")
ep("GET", "/incidents/{id}", "getIncident", IN, "One incident in full: assessment, containment, notice drafts, reminders", INC_MGR, None, "IncidentView")
ep("POST", "/incidents/{id}/assess", "assessIncident", IN, "Answer the likelihood-of-serious-harm questions; returns a score and a recommendation of Notifiable or Not notifiable (record the reason)", INC_MGR, "IncidentAssess", "IncidentView", note="422 unless every question is answered")
ep("POST", "/incidents/{id}/containment", "setIncidentContainment", IN, "Tick or untick a containment step", INC_MGR, "IncidentContainment", "IncidentView")
ep("POST", "/incidents/{id}/notifications/{audience}/draft", "draftIncidentNotice", IN, "Draft the notice to the regulator or to affected individuals from a template with merge fields; audience is REGULATOR or INDIVIDUALS", INC_MGR, None, "IncidentView", note="409 unless assessed as Notifiable")
ep("POST", "/incidents/{id}/notifications/{audience}/send", "sendIncidentNotice", IN, "Send a drafted notice. SIMULATED through the MESSAGING connector: a record is kept, nothing is sent", INC_MGR, None, "IncidentView", note="422 RESIDENCY_VIOLATION or EGRESS_BLOCKED when the gateway is outside the allowed regions; 409 without a draft")
ep("POST", "/incidents/{id}/close", "closeIncident", IN, "Close the incident with lessons learned", INC_MGR, "IncidentClose", "IncidentView", note="409 until notified (Notifiable) or the reason is recorded (Not notifiable)")
ep("GET", "/design/hosting-topology", "getHostingTopology", DS, "The three hosting options with data flows, responsibilities, residency and key management. DESIGN ONLY: not built (SEC-D11)", STAFF_B11, None, "HostingTopology")
