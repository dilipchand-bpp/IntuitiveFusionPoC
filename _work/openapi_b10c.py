# ---------------------------------------------------------------- B10c: e-signature envelopes, document repository, continuity alerts
# NFR-C04 e-signature providers with signatories pre-filled (simulated DocuSign and Adobe), NFR-C06 enterprise document repository
# (simulated SharePoint), FR-0860 business-continuity alerts by SMS and email with response trackers (simulated gateways).
# Appended to openapi_ext.py (runs in gen_openapi.py's namespace). Roles match the guards in apps/api/src/modules/b10x/*-routes.ts.
schemas.update({n: OBJ for n in [
    "EsignEnvelopeCard", "EsignEnvelopeCreate", "EsignSigningLink", "EsignSimulateEvent", "EsignSimulateResult", "EsignCeremony",
    "EsignConfirm", "EsignConfirmResult",
    "RepoProjects", "RepoFileList", "RepoFile", "RepoVersions", "RepoWrite", "RepoWriteResult", "RepoSources", "RepoPublish",
    "RepoPublishResult", "RepoImport", "RepoImportResult",
    "ContinuityOptions", "ContinuityRaise", "ContinuityTracker", "ContinuityEventList", "ContinuityAnswer", "ContinuityClose",
    "ContinuityResend", "RespondLink", "RespondAnswer",
]})
ES = "ESignature"; RP = "DocumentRepository"; CB = "ContinuityAlerts"
ES_READ = ["ADMIN", "PROCUREMENT", "LEGAL", "CONTRACT_MGR", "DELEGATE", "EXEC", "FINANCE", "PROBITY"]
ES_MANAGE = ["ADMIN", "LEGAL", "PROCUREMENT"]
ES_SIGN = ["DELEGATE", "EXEC"]
ep("GET", "/contracts/{id}/envelope", "getContractEnvelope", ES, "The e-signature envelope for a contract: provider, status for each signatory and the event history (a signatory in blind signing sees only their own line)", ES_READ, None, "EsignEnvelopeCard")
ep("POST", "/contracts/{id}/envelope", "createContractEnvelope", ES, "Create (or try again to create) the envelope for a contract that is out for signature, with the signatories pre-filled from the signature chain; closes the manual task if one was raised", ES_MANAGE, None, "EsignEnvelopeCard", 201, note="409 NO_ENVELOPE when the e-signature connector is not DocuSign or Adobe or the contract is not out for signature; 200 with result MANUAL_TASK when the provider is down")
ep("POST", "/contracts/{id}/envelope/signing-link", "issueEnvelopeSigningLink", ES, "A fresh signing link for the signed-in signatory (the earlier link stops working)", ES_SIGN, None, "EsignSigningLink", note="403 NOT_A_SIGNATORY")
ep("POST", "/contracts/{id}/envelope/simulate-event", "simulateEnvelopeEvent", ES, "Demonstration: make the simulated provider call back (sent, delivered, viewed, signed, declined, voided, expired) with a correctly signed message through the inbound webhook", ES_MANAGE, "EsignSimulateEvent", "EsignSimulateResult", note="a repeated eventId is refused as a replay; a signed callback reaches the chain only through the normal sign decision and may be REFUSED by signing authority or order")
ep("GET", "/esign/{token}", "getEsignCeremony", ES, "The simulated signing ceremony: a summary of the document for the signatory the link was issued to; opening it is reported to the provider as delivered and viewed", ES_SIGN, None, "EsignCeremony", note="404 for a link that is not yours, expired or replaced")
ep("POST", "/esign/{token}/confirm", "confirmEsign", ES, "The signatory's own confirmation: signs or declines through the contract's normal sign decision, so signing authority, order and checks still apply", ES_SIGN, "EsignConfirm", "EsignConfirmResult", note="403 SIGNING_AUTHORITY_INSUFFICIENT; 409 SIGNING_ORDER, ENVELOPE_CLOSED or ALREADY_DONE; 400 a decline needs a reason")
REPO_READ = ["REQUESTER", "PROCUREMENT", "DELEGATE", "LEGAL", "CONTRACT_MGR", "PROBITY", "FINANCE", "EXEC"]
REPO_WRITE = ["REQUESTER", "PROCUREMENT", "LEGAL", "CONTRACT_MGR"]
REPO_PUBLISH = ["PROCUREMENT", "LEGAL", "CONTRACT_MGR"]
ep("GET", "/repository/projects", "listRepositoryProjects", RP, "The project sites in the simulated repository that the caller may open (the same procurements the caller can see in reports)", REPO_READ, None, "RepoProjects", note="409 REPOSITORY_OFF when the connector is off; 503 REPOSITORY_UNAVAILABLE when it is down")
ep("GET", "/repository/projects/{requestId}/files", "listRepositoryFiles", RP, "Folders and the newest version of each file in a project site", REPO_READ, None, "RepoFileList", query=["folder"], note="404 for a project the caller cannot see")
ep("GET", "/repository/projects/{requestId}/files/{folder}/{name}", "readRepositoryFile", RP, "Read a file (newest version, or ?version=); the ETag is the version to send back in If-Match", REPO_READ, None, "RepoFile", query=["version"])
ep("GET", "/repository/projects/{requestId}/files/{folder}/{name}/download", "downloadRepositoryFile", RP, "Download a file as it was stored", REPO_READ, None, None, query=["version"], note="the file's own content type")
ep("GET", "/repository/projects/{requestId}/files/{folder}/{name}/versions", "listRepositoryVersions", RP, "Every version of a file, newest first", REPO_READ, None, "RepoVersions")
ep("PUT", "/repository/projects/{requestId}/files/{folder}/{name}", "writeRepositoryFile", RP, "Write the next version of a file (never an overwrite): If-Match must carry the version last read; omit it only for a new file", REPO_WRITE, "RepoWrite", "RepoWriteResult", 201, note="428 PRECONDITION_REQUIRED without If-Match for an existing file; 412 PRECONDITION_FAILED for a stale version; 400 unsafe file; 413 over 2 MB; 422 FILE_INFECTED; 202 MANUAL_TASK when the repository is down")
ep("GET", "/repository/projects/{requestId}/sources", "listRepositorySources", RP, "Platform documents of this project that can be filed: the tender pack, the evaluation report and contracts", REPO_READ, None, "RepoSources")
ep("POST", "/repository/projects/{requestId}/publish", "publishToRepository", RP, "File a platform document (contract, evaluation report, tender pack) in the project folder as the next version; an unchanged document adds no version", REPO_PUBLISH, "RepoPublish", "RepoPublishResult", 201, note="200 UNCHANGED; 202 MANUAL_TASK when the repository is down; the document is fetched with the caller's own rights")
ep("POST", "/repository/projects/{requestId}/import", "importFromRepository", RP, "Bring a repository file into a contract's negotiation drafts", ["LEGAL"], "RepoImport", "RepoImportResult", 201, note="404 for a contract of another project; 423 for a locked contract")
CB_RAISE = ["PROCUREMENT", "CONTRACT_MGR", "EXEC"]
CB_VIEW = ["PROCUREMENT", "CONTRACT_MGR", "EXEC", "LEGAL"]
ep("GET", "/continuity/options", "getContinuityOptions", CB, "What can be picked when raising an event: kinds, severities, affected suppliers and contracts, recipient groups and people to escalate to", CB_RAISE, None, "ContinuityOptions")
ep("POST", "/continuity/events", "raiseContinuityEvent", CB, "Raise a continuity event and send an SMS and an email to each recipient through the simulated gateway; returns the tracker and, once, each recipient's one-time response link", CB_RAISE, "ContinuityRaise", "ContinuityTracker", 201, note="422 SMS_NOT_PLAIN when the text message note carries a supplier name, a number or an identifier; NO_RECIPIENTS; AFFECTED_REQUIRED")
ep("GET", "/continuity/events", "listContinuityEvents", CB, "Continuity events, newest first, with how many have answered", CB_VIEW, None, "ContinuityEventList")
ep("GET", "/continuity/events/{id}", "getContinuityTracker", CB, "The tracker: who has been reached, by which channel, and who has not answered; reading it also records delivery receipts and escalates when due", CB_VIEW, None, "ContinuityTracker")
ep("POST", "/continuity/events/{id}/resend", "resendContinuityEvent", CB, "Message the people who have not answered again, each with a new one-time link", CB_RAISE, None, "ContinuityResend", note="409 EVENT_CLOSED")
ep("POST", "/continuity/events/{id}/responses/{responseId}", "recordContinuityAnswer", CB, "Record an answer taken by phone on someone's behalf", CB_RAISE, "ContinuityAnswer", "ContinuityTracker", note="409 EVENT_CLOSED")
ep("POST", "/continuity/events/{id}/close", "closeContinuityEvent", CB, "Close the event with a summary of who answered what and how many messages got through", CB_RAISE, "ContinuityClose", "ContinuityTracker", note="409 when already closed")
ep("GET", "/respond-links/{token}", "getRespondLink", CB, "The one-time response page for one recipient (no sign-in)", None, None, "RespondLink", note="404 unknown link; 410 LINK_EXPIRED")
ep("POST", "/respond-links/{token}", "answerRespondLink", CB, "Say I am safe, I am affected or I need help; one answer per person, changeable until the event is closed", None, "RespondAnswer", "RespondLink", note="410 LINK_EXPIRED; 409 EVENT_CLOSED")
