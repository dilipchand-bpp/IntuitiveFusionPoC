# ---------------------------------------------------------------- B10b: ERP sync, legal status sync, HR feed, payment execution
# NFR-C02 ERP sync (simulated SAP, Oracle, Dynamics), NFR-C03 legal system sync by webhook, FR-0815 HR feed, FR-0875 payments.
# Appended to openapi_ext.py (runs in gen_openapi.py's namespace). The roles listed here MUST equal the route guards (authz matrix test).
schemas.update({n: OBJ for n in [
    "ErpOverview", "ErpSyncRequest", "ErpSyncResult", "ErpLedgerEntry", "ErpHistoryEntry", "ErpCostCentre", "ErpBudgetCheckRequest",
    "ErpBudgetCheck", "LegalSimulateRequest", "LegalSimulateResult", "LegalSyncView", "LegalStatusSent", "LegalEventReprocessed",
    "LegalInboundEvent", "LegalInboundResult", "HrFeedOverview", "HrFeedRunRequest", "HrFeedRunResult", "HrDelegationSync",
    "HrReassignmentDone", "PaymentCreate", "Payment", "PaymentList", "PaymentSettled", "PaymentConfirmation", "PaymentConfirmationResult",
]})
ER = "ErpSync"; LG = "LegalSync"; HR = "HrFeed"; PY = "Payments"
ER_READ = ["ADMIN", "FINANCE", "PROCUREMENT", "EXEC"]
ER_RUN = ["ADMIN", "FINANCE"]
ER_PICK = ["ADMIN", "REQUESTER", "PROCUREMENT", "FINANCE", "EXEC", "DELEGATE", "CONTRACT_MGR"]
ER_CHECK = ["REQUESTER", "PROCUREMENT", "FINANCE", "EXEC"]
ep("GET", "/erp/overview", "getErpOverview", ER, "Imported cost centres with budget, actuals and what is available, organisation units, budget lines, the last run and the ERP connector's provider and health (SIMULATED)", ER_READ, None, "ErpOverview")
ep("POST", "/erp/sync", "runErpSync", ER, "Pull cost centres, organisation units, budgets and the ledger from the ERP connector's provider (SAP, Oracle or Dynamics), map them and upsert by external id. A second run changes nothing; changes at the source are reported as added, changed and removed. dryRun shows the counts without writing", ER_RUN, "ErpSyncRequest", "ErpSyncResult", note="200 with status FAILED and a manual task when the ERP connector is DOWN; 422 for a provider that is not an ERP feed")
ep("GET", "/erp/ledger", "listErpLedger", ER, "Imported ledger postings, newest first", ER_READ, None, "ErpLedgerEntry", arrayResp=True, query=["costCentre", "limit"])
ep("GET", "/erp/history", "listErpSyncs", ER, "Recent ERP imports with the counts of what was added, changed, removed and left alone", ER_READ, None, "ErpHistoryEntry", arrayResp=True)
ep("GET", "/erp/cost-centres", "listErpCostCentres", ER, "Active imported cost centres, for choosing a cost centre", ER_PICK, None, "ErpCostCentre", arrayResp=True)
ep("POST", "/erp/budget-check", "checkErpBudget", ER, "The budget check for a business unit or cost centre. An imported ERP budget line is used when there is one, otherwise the tenant settings; the answer names its source", ER_CHECK, "ErpBudgetCheckRequest", "ErpBudgetCheck", note="422 without a business unit or cost centre")
LEG_READ = ["ADMIN", "LEGAL", "PROCUREMENT", "DELEGATE", "EXEC", "CONTRACT_MGR"]
LEG_WORK = ["ADMIN", "LEGAL"]
ep("POST", "/integrations/legal/events", "legalInboundEvent", LG, "Signed inbound event from the legal system: MATTER_STAGE_CHANGED, DOCUMENT_ATTACHED or MATTER_CLOSED (X-IF-Signature and X-IF-Timestamp, HMAC-SHA256, five-minute window). Applied to the matter and the contract page; an event id is applied once; a failure is kept and retried, then dead-lettered", None, "LegalInboundEvent", "LegalInboundResult", note="401 for a bad or stale signature or an unknown organisation; 202 when the event could not be applied yet (kept as FAILED or DEAD_LETTER)")
ep("POST", "/integrations/legal/simulate", "simulateLegalEvent", LG, "Build a correctly signed inbound legal event for a matter and run it through the same receiver an outside caller uses (SIMULATED); options show a repeat, a bad signature and an unknown matter", LEG_WORK, "LegalSimulateRequest", "LegalSimulateResult", note="409 when the matter has no reference in the legal system or the legal connector is off")
ep("POST", "/integrations/legal/events/{id}/reprocess", "reprocessLegalEvent", LG, "Apply an inbound legal event that failed or was dead-lettered, now", LEG_WORK, None, "LegalEventReprocessed", note="409 when the event was already applied")
ep("POST", "/legal-matters/{id}/sync-status", "sendLegalMatterStatus", LG, "Send this matter's status to the legal system as a signed outbound event through the connector; safe to repeat, a failure is kept and a manual task is queued", ["ADMIN", "LEGAL", "PROCUREMENT"], None, "LegalStatusSent")
ep("GET", "/contracts/{id}/legal-sync", "getContractLegalSync", LG, "The contract's legal matters as the legal system reports them: stage, documents attached, closed, and the event history with retries and dead letters", LEG_READ, None, "LegalSyncView")
ep("GET", "/hr-feed/overview", "getHrFeedOverview", HR, "HR feed batches, every event with its outcome, exceptions that need a person, time-bound delegations and the work listed for reassignment", ["ADMIN"], None, "HrFeedOverview")
ep("POST", "/hr-feed/run", "runHrFeed", HR, "Preview (dryRun) or apply the next batch of the simulated HR feed: starters, leavers, role changes and delegate changes. Each event id is applied once; ADMIN is never granted by the feed; a delegation is capped at the delegator's own limit", ["ADMIN"], "HrFeedRunRequest", "HrFeedRunResult", note="200 with ok false and a manual task when the HR connector is off or DOWN; 409 when there is no later batch")
ep("POST", "/hr-feed/sync-delegations", "syncHrDelegations", HR, "Start delegations whose start date has come and end those whose end date has passed", ["ADMIN"], None, "HrDelegationSync")
ep("POST", "/hr-feed/reassignments/{id}/done", "completeHrReassignment", HR, "Record that a leaver's open item was given to a new owner", ["ADMIN"], None, "HrReassignmentDone", note="409 when already done")
PY_READ = ["FINANCE", "EXEC", "PROCUREMENT", "CONTRACT_MGR"]
PY_ACT = ["FINANCE", "EXEC"]
ep("POST", "/invoices/{id}/payments", "proposePayment", PY, "Propose a payment for a matched invoice (full or part). Repeating the same idempotency key returns the same payment and creates nothing", ["FINANCE"], "PaymentCreate", "Payment", 201, note="409 INVOICE_NOT_PAYABLE for an invoice that is not matched (blocked, exception, paid); 409 PAYMENT_EXCEEDS_INVOICE above what is still unpaid")
ep("POST", "/payments/{id}/approve", "approvePayment", PY, "A different person approves the payment and the order is sent to the finance system through the PAYMENTS connector; if the system is down it waits with a manual task", PY_ACT, None, "Payment", note="403 ROLE_SOD_VIOLATION for the person who proposed it; 409 unless the payment is proposed")
ep("POST", "/payments/{id}/retry", "retryPayment", PY, "Send a failed payment again, or try a waiting payment now", PY_ACT, None, "Payment", note="409 for a payment that is neither failed nor waiting")
ep("POST", "/payments/{id}/cancel", "cancelPayment", PY, "Cancel a proposed or failed payment", PY_ACT, None, "Payment", note="409 once the order has been sent")
ep("POST", "/payments/settle", "settlePayments", PY, "Bring up to date the payments whose order was delivered after a wait or paid by hand", PY_ACT, None, "PaymentSettled")
ep("GET", "/payments", "listPayments", PY, "Payments with their status trail, and the PAYMENTS connector's state", PY_READ, None, "PaymentList", query=["invoiceId"])
ep("GET", "/payments/{id}", "getPayment", PY, "One payment with its status trail", PY_READ, None, "Payment")
ep("POST", "/integrations/payments/confirmation", "paymentConfirmation", PY, "The finance system's signed confirmation or failure callback; applied once per event id", None, "PaymentConfirmation", "PaymentConfirmationResult", note="401 for a bad or stale signature; 409 unless the payment was sent")
