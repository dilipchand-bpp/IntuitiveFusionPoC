# ---------------------------------------------------------------- B10a: the connector foundation
# NFR-C07 connector catalogue, SEC-N03 secret store, NFR-C05 resilient provider layer, NFR-AV03 delivery and reconciliation,
# SEC-TP04 signed middleware legs, NFR-AV04 manual fallback. Appended to openapi_ext.py (runs in gen_openapi.py's namespace).
schemas.update({n: OBJ for n in [
    "ConnectorCatalogue", "ConnectorUpdate", "ConnectorView", "ConnectorTestResult", "ConnectorSyncRequest", "ConnectorSyncResult",
    "SyncRun", "ManualTask", "ManualTaskComplete", "SecretList", "SecretValue", "SecretMeta", "ConnectorSecurity",
    "InboundWebhook", "InboundWebhookResult", "SupplierVerification", "IntegrationEventView",
]})
CN = "Connectors"; SC = "SecretStore"; MT = "ManualFallback"
CN_READ = ["ADMIN", "PROCUREMENT", "FINANCE", "LEGAL", "EXEC"]
CN_OPS = ["ADMIN", "PROCUREMENT"]
ep("GET", "/connectors", "listConnectors", CN, "The catalogue of supported providers by kind (all simulated) and this tenant's connectors with their health and circuit breaker", CN_READ, None, "ConnectorCatalogue")
ep("PUT", "/connectors/{kind}", "updateConnector", CN, "Choose the provider, switch on or off, set the demonstration mode UP or DOWN and the non-secret configuration", ["ADMIN"], "ConnectorUpdate", "ConnectorView", note="422 for a provider not in the catalogue; 400 when the configuration holds something that looks like a secret")
ep("POST", "/connectors/{kind}/test", "testConnector", CN, "Run a health check through the resilient layer and show the circuit breaker state (CLOSED, OPEN, HALF_OPEN)", CN_OPS, None, "ConnectorTestResult")
ep("POST", "/connectors/{kind}/sync", "syncConnector", CN, "Send records outward through the connector, signed; safe to repeat because each record has a key. A failure is kept to retry and queues a manual task", ["ADMIN", "PROCUREMENT", "FINANCE"], "ConnectorSyncRequest", "ConnectorSyncResult", 201)
ep("POST", "/connectors/{kind}/reconcile", "reconcileConnector", CN, "Compare what was sent with what the other side acknowledged and send what is missing again under the same key; a second run changes nothing", CN_OPS, None, "SyncRun")
ep("GET", "/connectors/sync-runs", "listSyncRuns", CN, "Reconciliation runs: how many were expected, received, missing and repaired", CN_READ, None, "SyncRun", arrayResp=True, query=["kind"])
ep("GET", "/connectors/{kind}/security", "getConnectorSecurity", CN, "Evidence for the middleware leg: algorithm, replay window, secret fingerprint and the count of rejected attempts", ["ADMIN", "PROCUREMENT", "PROBITY", "EXEC"], None, "ConnectorSecurity")
ep("POST", "/integration-events/{id}/requeue", "requeueIntegrationEvent", CN, "Put a dead-lettered delivery back in the queue with fresh attempts and try it now", ["ADMIN", "PROCUREMENT", "LEGAL"], None, "IntegrationEventView", note="409 unless the event is a dead letter")
ep("POST", "/integrations/{kind}/webhook", "inboundWebhook", CN, "Signed inbound message from the middleware (X-IF-Signature and X-IF-Timestamp, HMAC-SHA256, five-minute window); an event id is accepted once", None, "InboundWebhook", "InboundWebhookResult", note="401 for a bad signature, wrong secret, stale timestamp or unknown organisation; 409 REPLAYED for an event id already received")
ep("POST", "/suppliers/{id}/verification", "verifySupplier", CN, "Screen a supplier against the sanctions list and verify insurance through the resilient layer; UNVERIFIED (provider unavailable) when a provider is down, never CLEAR", CN_OPS, None, "SupplierVerification")
ep("GET", "/manual-tasks", "listManualTasks", MT, "Work to do by hand while a connected system is down, with instructions", CN_READ, None, "ManualTask", arrayResp=True, query=["status"])
ep("POST", "/manual-tasks/{id}/complete", "completeManualTask", MT, "Mark a manual task done with the reference the person typed; the queued delivery is then closed", ["ADMIN", "PROCUREMENT", "FINANCE", "LEGAL"], "ManualTaskComplete", "ManualTask", note="409 when the task is already done or was superseded")
ep("GET", "/secrets", "listSecrets", SC, "Names, versions, fingerprints and last rotation of stored secrets; values are never returned", ["ADMIN"], None, "SecretList")
ep("PUT", "/secrets/{name}", "setSecret", SC, "Set or rotate a secret: a new version is written and the previous one retired; audited without the value", ["ADMIN"], "SecretValue", "SecretMeta")
