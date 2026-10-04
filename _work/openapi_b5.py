
# ---------------------------------------------------------------- B5: contract management
NUM = {"type": "number"}
LINE = obj({"item": S, "qty": NUM, "unitPrice": NUM}, ["item", "qty", "unitPrice"])
schemas.update({
    "RateCard": obj({"rates": arr(obj({"item": S, "unit": S, "unitPrice": NUM}, ["item", "unitPrice"]))}, ["rates"]),
    "EscalationSet": obj({"escalations": arr(obj({"kind": enum("CPI", "SCHEDULED"), "effectiveOn": S, "pct": NUM, "capPct": NUM, "note": S}, ["kind", "effectiveOn", "pct"]))}, ["escalations"]),
    "RebateCreate": obj({"title": S, "threshold": NUM, "ratePct": NUM, "periodStart": S, "periodEnd": S}, ["title", "threshold", "ratePct", "periodStart", "periodEnd"]),
    "RebateClaim": obj({"amount": NUM, "claimedOn": S}, ["amount"]),
    "RebateView": OBJ,
    "CommercialView": OBJ,
    "PurchaseOrderCreate": obj({"description": S, "workOrderId": UUID, "lines": arr(LINE)}, ["description", "lines"]),
    "PurchaseOrder": OBJ,
    "InvoiceCreate": obj({"number": S, "invoiceDate": S, "poId": UUID, "workOrderId": UUID, "lines": arr(LINE)}, ["invoiceDate", "lines"]),
    "InvoiceResult": OBJ,
    "Invoice": OBJ,
    "InvoiceOverride": obj({"reason": S}, ["reason"]),
    "ContractSpend": OBJ,
    "AlertRules": OBJ,
    "AlertPreferences": obj({"muted": arr(enum("NOTICE", "EXPIRY", "MILESTONE", "EXTENSION", "CUSTOM", "CLAUSE", "COUNTDOWN", "INSURANCE"))}, ["muted"]),
    "AlertPreferenceView": OBJ,
    "AlertExtraction": OBJ,
    "AlertExtractApply": obj({"keys": arr(S)}, ["keys"]),
    "AlertExtractResult": OBJ,
    "ContractPlans": OBJ,
    "PlanGenerated": OBJ,
    "ActivityComplete": obj({"note": S}),
    "PlanTemplates": OBJ,
    "PlanTemplateUpload": obj({"name": S, "text": S, "sections": arr(obj({"title": S, "text": S}, ["title", "text"]))}, ["name"]),
    "WorkOrderCreate": obj({"title": S, "value": NUM, "startDate": S, "endDate": S}, ["title", "value", "startDate", "endDate"]),
    "WorkOrderPatch": obj({"status": enum("OPEN", "COMPLETE", "CANCELLED")}, ["status"]),
    "WorkOrder": OBJ,
    "WorkOrders": OBJ,
    "MasterAgreementReport": OBJ,
    "ProcurementLink": obj({"kind": enum("RENEW", "VARY", "EXTEND"), "note": S, "extensionPosition": I, "value": NUM}, ["kind", "note"]),
    "ProcurementLinked": OBJ,
    "ContractManagement": OBJ,
    "ContractSearch": OBJ,
    "DisclosureTask": OBJ,
    "DisclosureComplete": obj({"reference": S}, ["reference"]),
    "EnvelopeCreate": obj({"name": S, "amount": NUM, "nominees": arr(UUID), "warnPct": I}, ["name", "amount"]),
    "Envelope": OBJ,
    "EnvelopeCommit": obj({"description": S, "amount": NUM, "contractId": UUID}, ["description", "amount"]),
    "EnvelopeTopUp": obj({"amount": NUM}, ["amount"]),
    "EnvelopeCandidates": OBJ,
})
schemas["AlertCreate"]["properties"]["channels"] = arr(enum("IN_APP", "EMAIL", "SMS", "SLACK"))
schemas["AlertCreate"]["properties"]["ownerId"] = UUID
schemas["VariationCreate"]["properties"]["requestId"] = UUID
CM = "Contract management"
RD = ["PROCUREMENT", "LEGAL", "CONTRACT_MGR", "DELEGATE", "EXEC", "FINANCE", "PROBITY"]
RE = ["CONTRACT_MGR", "LEGAL", "PROCUREMENT"]
MONEY = ["FINANCE", "CONTRACT_MGR", "PROCUREMENT"]
FC = ["FINANCE", "CONTRACT_MGR"]
AU = ["CONTRACT_MGR", "PROCUREMENT", "LEGAL", "EXEC", "DELEGATE", "FINANCE"]
AM = ["CONTRACT_MGR", "PROCUREMENT", "LEGAL", "EXEC"]
EU = ["DELEGATE", "EXEC", "FINANCE", "PROCUREMENT", "CONTRACT_MGR", "REQUESTER", "LEGAL"]
ep("GET", "/contracts/{id}/commercial", "getContractCommercial", CM, "The rate card, price escalation clauses, rebates with their status, the insurance hold and what the caller may edit", RD, None, "CommercialView")
ep("PUT", "/contracts/{id}/rates", "setContractRates", CM, "Replace the contract rate card used by the three-way match", RE, "RateCard", "RateCard")
ep("PUT", "/contracts/{id}/escalations", "setContractEscalations", CM, "Replace the price-escalation clauses: scheduled steps, or an index movement up to a cap", RE, "EscalationSet", "EscalationSet", note="422 ESCALATION_BEFORE_START")
ep("POST", "/contracts/{id}/rebates", "addContractRebate", CM, "Record a rebate term: a rate on spend in a period once a threshold is reached", RE, "RebateCreate", "RebateView", 201)
ep("POST", "/contracts/{id}/rebates/{rebateId}/claim", "claimContractRebate", CM, "Record an amount claimed from the supplier against a rebate", FC, "RebateClaim", "RebateView")
ep("POST", "/contracts/{id}/rebates/{rebateId}/follow-up", "followUpContractRebate", CM, "Record a follow-up of a missed or under-claimed rebate", FC, None, "RebateView", note="409 NOT_FLAGGED")
ep("POST", "/contracts/{id}/purchase-orders", "createPurchaseOrder", CM, "Raise a purchase order (the simulated ERP feed). Blocked, and recorded, when it would take commitments above the contract limit; refused while an insurance hold is on", MONEY, "PurchaseOrderCreate", "PurchaseOrder", 201, note="422 SPEND_CEILING; 409 PURCHASE_ORDER_HELD")
ep("GET", "/contracts/{id}/purchase-orders", "listPurchaseOrders", CM, "Purchase orders against the contract, including any that were blocked", RD, None, "PurchaseOrder", arrayResp=True)
ep("POST", "/contracts/{id}/invoices", "recordInvoice", CM, "Record an invoice (the simulated ERP feed). It is matched to its purchase order and the rate card with the escalation formula; a price increase not allowed blocks it", FC, "InvoiceCreate", "InvoiceResult", 201)
ep("GET", "/contracts/{id}/invoices", "listContractInvoices", CM, "Invoices against the contract with their match findings", RD, None, "Invoice", arrayResp=True)
ep("GET", "/invoices", "listInvoices", CM, "Invoices across contracts; filter by status to see what is blocked", ["FINANCE", "CONTRACT_MGR", "PROCUREMENT", "EXEC"], None, "Invoice", arrayResp=True, query=["status"])
ep("POST", "/invoices/{id}/override", "overrideBlockedInvoice", CM, "Release a blocked invoice as a recorded exception, with a reason", ["FINANCE", "EXEC"], "InvoiceOverride", "Invoice")
ep("POST", "/invoices/{id}/pay", "payInvoice", CM, "Record payment of a matched or excepted invoice", ["FINANCE"], None, "Invoice", note="409 while the invoice is blocked")
ep("GET", "/contracts/{id}/spend", "getContractSpend", CM, "Live spend against the contract from invoice and payment data: progress of spend and term, and the notices raised", RD, None, "ContractSpend")
ep("GET", "/alerts/rules", "getFixedAlertRules", CM, "The alerts the platform fixes (expiry countdown, insurance lapse, spend ceiling) that no one can mute or change", AU, None, "AlertRules")
ep("GET", "/me/alert-preferences", "getAlertPreferences", CM, "The alert kinds the caller has muted, and the fixed ones that cannot be", AU, None, "AlertPreferenceView")
ep("PUT", "/me/alert-preferences", "setAlertPreferences", CM, "Mute alert kinds for the caller; the fixed kinds are refused", AU, "AlertPreferences", "AlertPreferenceView", note="422 ALERT_NOT_MUTABLE")
ep("POST", "/contracts/{id}/alerts/extract", "extractAlertTriggers", CM, "Propose alerts from notice periods, review cycles and anniversaries in the clause wording (rules-simulated model); nothing is scheduled", AM, None, "AlertExtraction")
ep("POST", "/contracts/{id}/alerts/extract/apply", "applyAlertTriggers", CM, "Schedule the proposed alerts the caller confirms", AM, "AlertExtractApply", "AlertExtractResult", 201, note="422 PROPOSAL_NOT_FOUND")
ep("GET", "/contracts/{id}/plans", "getContractPlans", CM, "The contract management plan and risk management plan, their tier and reasons, and the generated activities", RD, None, "ContractPlans")
ep("POST", "/contracts/{id}/plans/generate", "generateContractPlans", CM, "Generate (or regenerate) both plans and their activities from the contract's size, term and risk, using the customer's template where one is uploaded", RE, None, "PlanGenerated", 201)
ep("POST", "/contracts/{id}/activities/{activityId}/complete", "completeContractActivity", CM, "Mark a contract management activity done", RE, "ActivityComplete", "ContractPlans")
ep("GET", "/contract-plan-templates", "getPlanTemplates", CM, "The standard plan templates and any the customer uploaded", ["CONTRACT_MGR", "LEGAL", "ADMIN"], None, "PlanTemplates")
ep("PUT", "/contract-plan-templates/{kind}", "uploadPlanTemplate", CM, "Upload the customer's template for the management plan (CMP) or the risk plan (RMP), as headed text or sections", ["CONTRACT_MGR", "LEGAL", "ADMIN"], "PlanTemplateUpload", "PlanTemplates")
ep("DELETE", "/contract-plan-templates/{kind}", "removePlanTemplate", CM, "Go back to the standard template", ["CONTRACT_MGR", "LEGAL", "ADMIN"], None, "PlanTemplates")
ep("POST", "/contracts/{id}/work-orders", "createWorkOrder", CM, "Raise a work order under a master agreement, within its value and term", RE, "WorkOrderCreate", "WorkOrder", 201, note="422 WORK_ORDER_OVER_MASTER; 409 NOT_A_MASTER")
ep("GET", "/contracts/{id}/work-orders", "listWorkOrders", CM, "The master agreement's work orders with committed and invoiced amounts, and totals", RD, None, "WorkOrders")
ep("PATCH", "/work-orders/{id}", "updateWorkOrder", CM, "Complete or cancel a work order", RE, "WorkOrderPatch", "WorkOrder")
ep("GET", "/reports/master-agreements", "reportMasterAgreements", CM, "Master agreements and their work orders, reportable at both levels", RD, None, "MasterAgreementReport")
ep("POST", "/contracts/{id}/procurements", "linkProcurementToContract", CM, "Start a new procurement number linked to a contract to renew it, vary it or take up an extension; not a new tender", RE, "ProcurementLink", "ProcurementLinked", 201, note="422 NO_EXTENSION; 409 EXTENSION_EXERCISED")
ep("GET", "/contracts/{id}/management", "getContractManagement", CM, "Variation count, extensions exercised and remaining, cumulative value, historic versions, linked procurements and next-step suggestions", RD, None, "ContractManagement")
ep("GET", "/contracts/search", "searchMyContracts", CM, "Search the contracts that belong to the caller and their team, with a suggested next step near the end date", RD, None, "ContractSearch", query=["q", "status", "endingWithinDays"])
ep("GET", "/disclosure-tasks", "listDisclosureTasks", CM, "Public register disclosure tasks raised by contract changes over the statutory threshold", ["PROCUREMENT", "LEGAL", "CONTRACT_MGR", "EXEC"], None, "DisclosureTask", arrayResp=True)
ep("POST", "/disclosure-tasks/{id}/complete", "completeDisclosureTask", CM, "Record the register reference once the disclosure is made", ["PROCUREMENT", "LEGAL"], "DisclosureComplete", "DisclosureTask")
ep("GET", "/envelopes/candidates", "listEnvelopeCandidates", CM, "People who can be nominated to approve commitments from an envelope", ["DELEGATE", "EXEC"], None, "EnvelopeCandidates")
ep("GET", "/envelopes", "listFundingEnvelopes", CM, "Funding envelopes the caller holds, is nominated for, or oversees", EU, None, "Envelope", arrayResp=True)
ep("GET", "/envelopes/{id}", "getFundingEnvelope", CM, "One envelope with its commitments and what is left", EU, None, "Envelope")
ep("POST", "/envelopes", "createFundingEnvelope", CM, "A delegate approves an allocated funding envelope, within their delegated authority, and nominates who can commit against it", ["DELEGATE", "EXEC"], "EnvelopeCreate", "Envelope", 201, note="403 DELEGATION_EXCEEDED; 422 INVALID_NOMINEE")
ep("POST", "/envelopes/{id}/commitments", "commitFromEnvelope", CM, "A nominated person approves a commitment against the envelope; warns the holder as it nears exhaustion", EU, "EnvelopeCommit", "Envelope", 201, note="422 ENVELOPE_EXHAUSTED; 403 NOT_NOMINATED")
ep("POST", "/envelopes/{id}/top-up", "topUpFundingEnvelope", CM, "The holder or an executive adds to the envelope, within delegated authority", ["DELEGATE", "EXEC"], "EnvelopeTopUp", "Envelope", note="403 DELEGATION_EXCEEDED")
