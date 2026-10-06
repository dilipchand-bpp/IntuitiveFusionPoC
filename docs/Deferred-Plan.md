# Plan for the requirements listed as "Not in the proof of concept"

107 requirements, in five batches. Each batch ends with its own evidence document and your approval before the next starts.

## How each one is delivered

| Kind | Count | Meaning |
| --- | ---: | --- |
| Build | 58 | Built and tested as a working feature |
| Sim | 18 | Works against a labelled simulated outside system; the swap point is documented |
| Evidence | 18 | A control, policy or runbook that is implemented and tested here |
| Design | 13 | Cannot run on one laptop: delivered as a design and the configuration to apply, and shown on the roadmap as designed, not built |

Nothing in the Design kind will be described as built. Those requirements need production hosting, a cloud edge, an external assessor or a real third party, and a proof-of-concept laptop cannot supply them. For each, the batch delivers the design, the rules or configuration to apply, and what would be needed to prove it.

## B8: Tender, contract and supplier intelligence (16)

| Requirement | Priority | Kind | What will be delivered |
| --- | --- | --- | --- |
| FR-0130 | Won't | Build | Interactive response schedules: structured bid-entry forms for pricing and technical answers |
| FR-0175 | Could | Build | Dual-witness opening: two named people must both release a sealed tender after close |
| FR-0185 | Could | Sim | Insurance certificate reading (simulated OCR of limits and expiry); blocks submission below required cover |
| FR-0390 | Could | Sim | Outbound matter-initiation event to an enterprise legal platform (simulated receiver) |
| FR-0790 | Won't | Build | Supplier ratings both ways with configurable visibility |
| FR-0795 | Won't | Build | Duplicate supplier detection (ABN, name and address similarity) |
| FR-0800 | Won't | Sim | Supplier risk, resilience and ESG score from performance, finance and compliance signals |
| FR-0805 | Won't | Build | Lessons learned captured at close and recalled on comparable procurements |
| FR-0830 | Won't | Build | Plain-language legal edits: redact, redline and insert a clause at a section |
| NFR-L01 | Must | Build | Statutory minimum publication-to-close window (25 days) enforced |
| NFR-L02 | Must | Build | Statutory disclosure for contract changes above a value threshold, enforced |
| NFR-L04 | Must | Build | Signed contracts kept permanently, logical delete only, complete audit trail |
| NFR-U05 | Should | Build | Approve from an emailed link without full sign-in, with a summary checklist |
| NFR-U08 | Should | Build | Fallback path when an in-field amendment cannot be actioned |
| SEC-TP02 | Must | Build | Sanctions and finance checks re-run when negotiation passes 30 days, before execution |
| SEC-TP03 | Must | Build | Vendor legal name, tax number and bank details verified before signature unlocks |

## B9: Planning, spend and experience (14)

| Requirement | Priority | Kind | What will be delivered |
| --- | --- | --- | --- |
| FR-0810 | Won't | Build | Multiple currencies, conversion and rate feed (rates entered or loaded) |
| FR-0820 | Won't | Build | Guided buying from approved catalogues and contracts; low-value repeat purchases proposed for approval |
| FR-0825 | Won't | Design | Native mobile app: delivered as an installable mobile web app, not a store app |
| FR-0835 | Won't | Build | Progress characters, completion celebrations and progress-to-completion view |
| FR-0840 | Won't | Build | Spend optimisation: consolidation, duplicate contracts, rate-card and price variance |
| FR-0845 | Won't | Build | Future commitment by financial year, cost centre and business unit |
| FR-0850 | Won't | Build | Dashboard personalisation: choose, place and style charts |
| FR-0855 | Won't | Build | Adjacent domain: an audit, risk and compliance register |
| FR-0870 | Won't | Sim | Evaluation report and contract record update as the underlying data changes |
| FR-0880 | Won't | Sim | Search of an outside AI source against institutional data (simulated provider) |
| NFR-P01 | Must | Build | Plan section updates live from the conversation |
| NFR-P02 | Should | Build | Later-stage artefacts update in batches |
| NFR-P05 | Must | Build | Reporting reads from a separate analytics copy of the data |
| NFR-U04 | Should | Build | Drag-and-drop layout in every lifecycle phase |

## B10: Integrations and the AI layer (19)

| Requirement | Priority | Kind | What will be delivered |
| --- | --- | --- | --- |
| FR-0815 | Won't | Sim | HR feed: starters, leavers and delegate changes applied automatically |
| FR-0860 | Won't | Sim | Business-continuity alerts by SMS and email with response trackers (simulated gateways) |
| FR-0875 | Won't | Sim | Payment execution through a simulated finance system |
| NFR-AV03 | Must | Build | Idempotent retried webhook delivery and reconciliation of missed syncs |
| NFR-AV04 | Must | Build | Manual fallback when ERP or legal system is down |
| NFR-C01 | Must | Build | Pluggable AI models per tenant |
| NFR-C02 | Must | Sim | ERP sync of budget, ledger, cost centre and organisation (simulated SAP, Oracle, Dynamics) |
| NFR-C03 | Must | Sim | Legal system sync by webhook (simulated) |
| NFR-C04 | Must | Sim | E-signature providers with signatories pre-filled (simulated DocuSign and Adobe) |
| NFR-C05 | Must | Sim | Sanctions and insurance verification providers behind a resilient API layer (simulated) |
| NFR-C06 | Should | Sim | Enterprise document repository read and write (simulated SharePoint) |
| NFR-C07 | Should | Sim | Connector catalogue for procurement, legal, ERP and middleware platforms |
| NFR-C08 | Should | Evidence | Published browser and operating-system baseline, checked at sign-in |
| NFR-M05 | Must | Build | All tenant configuration changeable by an authorised person without a release |
| NFR-M06 | Should | Build | Approved AI model changed through configuration |
| NFR-P04 | Must | Build | Budget check returns within the intake conversation, measured |
| SEC-N03 | Must | Sim | Integration credentials in a managed secret store with rotation (local store) |
| SEC-TP04 | Must | Evidence | Middleware leg security: signed, authenticated delivery both ways |
| SEC-TP07 | Must | Build | Third-party AI providers approved per tenant before they can be switched on |

## B11: Security and data protection controls (28)

| Requirement | Priority | Kind | What will be delivered |
| --- | --- | --- | --- |
| FR-0865 | Won't | Build | Project-level encryption invisible outside the assigned sourcing group |
| NFR-L03 | Must | Build | Signature capability aligned to eIDAS levels |
| NFR-R01 | Must | Evidence | Data stays within the customer tenancy: shown and tested |
| NFR-R02 | Must | Build | Customer elects a hosting country; enforced |
| NFR-R03 | Must | Build | Field population combines in-house data with periodically refreshed outside content |
| NFR-R05 | Should | Build | ESG and socio-economic plan data with ceilings and ratios checked |
| NFR-R06 | Must | Evidence | Probity demonstrable to an external auditor: evidence pack |
| NFR-SC01 | Must | Build | Multiple tenants with per-tenant request throttling and usage plans |
| SEC-AC09 | Must | Build | Access policies that override the default hierarchy |
| SEC-AC10 | Should | Build | Bank details visible to finance only |
| SEC-AP04 | Must | Sim | Every upload scanned for malware (simulated scanner, test signature) |
| SEC-AP08 | Should | Build | Prompt-injection resistance for supplier and uploaded content |
| SEC-D01 | Must | Evidence | Encrypted in transit and at rest (field encryption, transport checks, evidence page) |
| SEC-D02 | Must | Sim | Customer-managed keys with rotation (local key service) |
| SEC-D03 | Must | Build | Bids encrypted at upload, unreadable to internal users before close |
| SEC-D04 | Must | Build | Per-tenant envelope encryption of the bid box |
| SEC-D05 | Must | Evidence | No data to public AI endpoints: egress allow-list enforced and tested |
| SEC-D06 | Must | Build | AI conversations held under the same retention and residency controls |
| SEC-D07 | Must | Build | Sensitive data discovered and classified automatically |
| SEC-D08 | Must | Build | Privacy Act handling: collection notices, access and correction requests |
| SEC-D09 | Must | Build | Cross-border controls: nominated region enforced for storage, logs and AI paths |
| SEC-D10 | Must | Evidence | Tenant isolation proven by a cross-tenant test |
| SEC-D11 | Should | Design | Hosting topology choice: platform, customer cloud or hybrid (design only) |
| SEC-IR05 | Must | Build | Data breach assessment and notification workflow |
| SEC-L02 | Must | Build | Platform administrative actions logged immutably (hash-chained) |
| SEC-L06 | Must | Build | Anomalous access detected and routed to the security owner |
| SEC-L07 | Must | Build | Auditor export of probity and audit history with integrity proof |
| SEC-L08 | Must | Build | Configuration compliance checked continuously with remediation |

## B12: Operations, resilience and evidence (30)

| Requirement | Priority | Kind | What will be delivered |
| --- | --- | --- | --- |
| NFR-AV01 | Must | Design | 99.9% availability (needs production hosting and measurement) |
| NFR-AV02 | Must | Design | Automated failover (needs redundant hosting) |
| NFR-CA01 | Must | Evidence | Legacy estate of thousands of contracts migrated and stored (volume test) |
| NFR-CA03 | Must | Build | Retention rules for audit logs, conversations and versions |
| NFR-CA04 | Must | Evidence | Sizing inputs defined and checked against a measured run |
| NFR-DR01 | Must | Build | Regular backups held apart from the primary store |
| NFR-DR02 | Must | Evidence | Recovery time and point objectives defined and demonstrated by test |
| NFR-DR03 | Must | Build | Restore tested periodically and the outcome recorded |
| NFR-M01 | Must | Design | Infrastructure as code (definitions provided; cannot be applied here) |
| NFR-M03 | Must | Build | Metrics, logs and alarms with AI latency, ERP failure and workflow error dashboards |
| NFR-M04 | Should | Build | End-to-end request tracing |
| NFR-R04 | Should | Design | IRAP and ISM alignment (mapping provided; assessment is external) |
| NFR-SC02 | Must | Design | Elastic compute (needs a cloud platform) |
| NFR-SC03 | Must | Design | Independent analytics warehouse scaling (needs a cloud platform) |
| NFR-SC04 | Must | Evidence | Peak submissions before close absorbed without loss (load test) |
| SEC-AP01 | Must | Design | Web application firewall (rules provided; needs a cloud edge) |
| SEC-AP02 | Must | Design | Always-on denial-of-service protection (needs a cloud edge) |
| SEC-AP05 | Must | Design | Penetration test (needs an independent tester; scope and checklist provided) |
| SEC-IR01 | Must | Evidence | Incident response playbook |
| SEC-IR02 | Must | Evidence | Vulnerability scanning with severity SLAs; critical findings fail the pipeline |
| SEC-IR03 | Must | Build | Findings routed to a named security owner with acknowledgement times |
| SEC-IR04 | Must | Evidence | Business continuity and ICT readiness plan |
| SEC-N01 | Must | Design | Government security protocols (assessment mapping provided) |
| SEC-N02 | Must | Design | Network segmentation (needs network infrastructure) |
| SEC-N04 | Must | Evidence | Document storage has no public read: tested |
| SEC-N05 | Must | Evidence | Backups encrypted and held in the nominated boundary |
| SEC-TP01 | Must | Sim | Sanctions screening on onboarding against several lists (simulated lists) |
| SEC-TP05 | Must | Build | Insurance currency monitored with a purchase-order hold |
| SEC-TP06 | Must | Evidence | Shared-responsibility matrix |
| SEC-TP08 | Should | Evidence | Governed handling when a third party migrates data |
