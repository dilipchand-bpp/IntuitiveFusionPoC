"""Triage of every requirement the roadmap lists as "Not in the proof of concept" (tier D) into delivery batches.
Class: BUILD = working feature, tested. SIM = works against a labelled simulated outside system (swap point documented).
EVIDENCE = a control, policy or runbook we can implement and test in the POC (backup/restore test, retention rule, export).
DESIGN = cannot run on one laptop (cloud infrastructure, certification, external test); delivered as a design and the
configuration to apply, and marked as such on the roadmap rather than as built."""
import re, sys

T = {
    # B8 tender, contract, supplier intelligence
    'FR-0130': ('B8', 'BUILD', 'Interactive response schedules: structured bid-entry forms for pricing and technical answers'),
    'FR-0175': ('B8', 'BUILD', 'Dual-witness opening: two named people must both release a sealed tender after close'),
    'FR-0185': ('B8', 'SIM', 'Insurance certificate reading (simulated OCR of limits and expiry); blocks submission below required cover'),
    'FR-0390': ('B8', 'SIM', 'Outbound matter-initiation event to an enterprise legal platform (simulated receiver)'),
    'FR-0790': ('B8', 'BUILD', 'Supplier ratings both ways with configurable visibility'),
    'FR-0795': ('B8', 'BUILD', 'Duplicate supplier detection (ABN, name and address similarity)'),
    'FR-0800': ('B8', 'SIM', 'Supplier risk, resilience and ESG score from performance, finance and compliance signals'),
    'FR-0805': ('B8', 'BUILD', 'Lessons learned captured at close and recalled on comparable procurements'),
    'FR-0830': ('B8', 'BUILD', 'Plain-language legal edits: redact, redline and insert a clause at a section'),
    'SEC-TP02': ('B8', 'BUILD', 'Sanctions and finance checks re-run when negotiation passes 30 days, before execution'),
    'SEC-TP03': ('B8', 'BUILD', 'Vendor legal name, tax number and bank details verified before signature unlocks'),
    'NFR-L01': ('B8', 'BUILD', 'Statutory minimum publication-to-close window (25 days) enforced'),
    'NFR-L02': ('B8', 'BUILD', 'Statutory disclosure for contract changes above a value threshold, enforced'),
    'NFR-L04': ('B8', 'BUILD', 'Signed contracts kept permanently, logical delete only, complete audit trail'),
    'NFR-U05': ('B8', 'BUILD', 'Approve from an emailed link without full sign-in, with a summary checklist'),
    'NFR-U08': ('B8', 'BUILD', 'Fallback path when an in-field amendment cannot be actioned'),
    # B9 planning, spend and experience
    'FR-0810': ('B9', 'BUILD', 'Multiple currencies, conversion and rate feed (rates entered or loaded)'),
    'FR-0820': ('B9', 'BUILD', 'Guided buying from approved catalogues and contracts; low-value repeat purchases proposed for approval'),
    'FR-0825': ('B9', 'DESIGN', 'Native mobile app: delivered as an installable mobile web app, not a store app'),
    'FR-0835': ('B9', 'BUILD', 'Progress characters, completion celebrations and progress-to-completion view'),
    'FR-0840': ('B9', 'BUILD', 'Spend optimisation: consolidation, duplicate contracts, rate-card and price variance'),
    'FR-0845': ('B9', 'BUILD', 'Future commitment by financial year, cost centre and business unit'),
    'FR-0850': ('B9', 'BUILD', 'Dashboard personalisation: choose, place and style charts'),
    'FR-0855': ('B9', 'BUILD', 'Adjacent domain: an audit, risk and compliance register'),
    'FR-0870': ('B9', 'SIM', 'Evaluation report and contract record update as the underlying data changes'),
    'FR-0880': ('B9', 'SIM', 'Search of an outside AI source against institutional data (simulated provider)'),
    'NFR-P01': ('B9', 'BUILD', 'Plan section updates live from the conversation'),
    'NFR-P02': ('B9', 'BUILD', 'Later-stage artefacts update in batches'),
    'NFR-P05': ('B9', 'BUILD', 'Reporting reads from a separate analytics copy of the data'),
    'NFR-U04': ('B9', 'BUILD', 'Drag-and-drop layout in every lifecycle phase'),
    # B10 integrations and the AI layer
    'FR-0815': ('B10', 'SIM', 'HR feed: starters, leavers and delegate changes applied automatically'),
    'FR-0860': ('B10', 'SIM', 'Business-continuity alerts by SMS and email with response trackers (simulated gateways)'),
    'FR-0875': ('B10', 'SIM', 'Payment execution through a simulated finance system'),
    'NFR-C01': ('B10', 'BUILD', 'Pluggable AI models per tenant'),
    'NFR-C02': ('B10', 'SIM', 'ERP sync of budget, ledger, cost centre and organisation (simulated SAP, Oracle, Dynamics)'),
    'NFR-C03': ('B10', 'SIM', 'Legal system sync by webhook (simulated)'),
    'NFR-C04': ('B10', 'SIM', 'E-signature providers with signatories pre-filled (simulated DocuSign and Adobe)'),
    'NFR-C05': ('B10', 'SIM', 'Sanctions and insurance verification providers behind a resilient API layer (simulated)'),
    'NFR-C06': ('B10', 'SIM', 'Enterprise document repository read and write (simulated SharePoint)'),
    'NFR-C07': ('B10', 'SIM', 'Connector catalogue for procurement, legal, ERP and middleware platforms'),
    'NFR-C08': ('B10', 'EVIDENCE', 'Published browser and operating-system baseline, checked at sign-in'),
    'NFR-M05': ('B10', 'BUILD', 'All tenant configuration changeable by an authorised person without a release'),
    'NFR-M06': ('B10', 'BUILD', 'Approved AI model changed through configuration'),
    'NFR-P04': ('B10', 'BUILD', 'Budget check returns within the intake conversation, measured'),
    'NFR-AV03': ('B10', 'BUILD', 'Idempotent retried webhook delivery and reconciliation of missed syncs'),
    'NFR-AV04': ('B10', 'BUILD', 'Manual fallback when ERP or legal system is down'),
    'SEC-N03': ('B10', 'SIM', 'Integration credentials in a managed secret store with rotation (local store)'),
    'SEC-TP04': ('B10', 'EVIDENCE', 'Middleware leg security: signed, authenticated delivery both ways'),
    'SEC-TP07': ('B10', 'BUILD', 'Third-party AI providers approved per tenant before they can be switched on'),
    # B11 security and data protection controls
    'SEC-AC09': ('B11', 'BUILD', 'Access policies that override the default hierarchy'),
    'SEC-AC10': ('B11', 'BUILD', 'Bank details visible to finance only'),
    'SEC-D01': ('B11', 'EVIDENCE', 'Encrypted in transit and at rest (field encryption, transport checks, evidence page)'),
    'SEC-D02': ('B11', 'SIM', 'Customer-managed keys with rotation (local key service)'),
    'SEC-D03': ('B11', 'BUILD', 'Bids encrypted at upload, unreadable to internal users before close'),
    'SEC-D04': ('B11', 'BUILD', 'Per-tenant envelope encryption of the bid box'),
    'SEC-D05': ('B11', 'EVIDENCE', 'No data to public AI endpoints: egress allow-list enforced and tested'),
    'SEC-D06': ('B11', 'BUILD', 'AI conversations held under the same retention and residency controls'),
    'SEC-D07': ('B11', 'BUILD', 'Sensitive data discovered and classified automatically'),
    'SEC-D08': ('B11', 'BUILD', 'Privacy Act handling: collection notices, access and correction requests'),
    'SEC-D09': ('B11', 'BUILD', 'Cross-border controls: nominated region enforced for storage, logs and AI paths'),
    'SEC-D10': ('B11', 'EVIDENCE', 'Tenant isolation proven by a cross-tenant test'),
    'SEC-D11': ('B11', 'DESIGN', 'Hosting topology choice: platform, customer cloud or hybrid (design only)'),
    'SEC-L02': ('B11', 'BUILD', 'Platform administrative actions logged immutably (hash-chained)'),
    'SEC-L06': ('B11', 'BUILD', 'Anomalous access detected and routed to the security owner'),
    'SEC-L07': ('B11', 'BUILD', 'Auditor export of probity and audit history with integrity proof'),
    'SEC-L08': ('B11', 'BUILD', 'Configuration compliance checked continuously with remediation'),
    'SEC-AP04': ('B11', 'SIM', 'Every upload scanned for malware (simulated scanner, test signature)'),
    'SEC-AP08': ('B11', 'BUILD', 'Prompt-injection resistance for supplier and uploaded content'),
    'SEC-IR05': ('B11', 'BUILD', 'Data breach assessment and notification workflow'),
    'NFR-R01': ('B11', 'EVIDENCE', 'Data stays within the customer tenancy: shown and tested'),
    'NFR-R02': ('B11', 'BUILD', 'Customer elects a hosting country; enforced'),
    'NFR-R03': ('B11', 'BUILD', 'Field population combines in-house data with periodically refreshed outside content'),
    'NFR-R05': ('B11', 'BUILD', 'ESG and socio-economic plan data with ceilings and ratios checked'),
    'NFR-R06': ('B11', 'EVIDENCE', 'Probity demonstrable to an external auditor: evidence pack'),
    'NFR-L03': ('B11', 'BUILD', 'Signature capability aligned to eIDAS levels'),
    'FR-0865': ('B11', 'BUILD', 'Project-level encryption invisible outside the assigned sourcing group'),
    'NFR-SC01': ('B11', 'BUILD', 'Multiple tenants with per-tenant request throttling and usage plans'),
    # B12 operations, resilience, evidence
    'NFR-M03': ('B12', 'BUILD', 'Metrics, logs and alarms with AI latency, ERP failure and workflow error dashboards'),
    'NFR-M04': ('B12', 'BUILD', 'End-to-end request tracing'),
    'NFR-DR01': ('B12', 'BUILD', 'Regular backups held apart from the primary store'),
    'NFR-DR02': ('B12', 'EVIDENCE', 'Recovery time and point objectives defined and demonstrated by test'),
    'NFR-DR03': ('B12', 'BUILD', 'Restore tested periodically and the outcome recorded'),
    'NFR-CA01': ('B12', 'EVIDENCE', 'Legacy estate of thousands of contracts migrated and stored (volume test)'),
    'NFR-CA03': ('B12', 'BUILD', 'Retention rules for audit logs, conversations and versions'),
    'NFR-CA04': ('B12', 'EVIDENCE', 'Sizing inputs defined and checked against a measured run'),
    'NFR-SC04': ('B12', 'EVIDENCE', 'Peak submissions before close absorbed without loss (load test)'),
    'NFR-M01': ('B12', 'DESIGN', 'Infrastructure as code (definitions provided; cannot be applied here)'),
    'SEC-IR01': ('B12', 'EVIDENCE', 'Incident response playbook'),
    'SEC-IR02': ('B12', 'EVIDENCE', 'Vulnerability scanning with severity SLAs; critical findings fail the pipeline'),
    'SEC-IR03': ('B12', 'BUILD', 'Findings routed to a named security owner with acknowledgement times'),
    'SEC-IR04': ('B12', 'EVIDENCE', 'Business continuity and ICT readiness plan'),
    'SEC-N04': ('B12', 'EVIDENCE', 'Document storage has no public read: tested'),
    'SEC-N05': ('B12', 'EVIDENCE', 'Backups encrypted and held in the nominated boundary'),
    'SEC-TP01': ('B12', 'SIM', 'Sanctions screening on onboarding against several lists (simulated lists)'),
    'SEC-TP05': ('B12', 'BUILD', 'Insurance currency monitored with a purchase-order hold'),
    'SEC-TP06': ('B12', 'EVIDENCE', 'Shared-responsibility matrix'),
    'SEC-TP08': ('B12', 'EVIDENCE', 'Governed handling when a third party migrates data'),
    # cannot run on one laptop: design and the configuration to apply
    'SEC-AP01': ('B12', 'DESIGN', 'Web application firewall (rules provided; needs a cloud edge)'),
    'SEC-AP02': ('B12', 'DESIGN', 'Always-on denial-of-service protection (needs a cloud edge)'),
    'SEC-AP05': ('B12', 'DESIGN', 'Penetration test (needs an independent tester; scope and checklist provided)'),
    'SEC-N01': ('B12', 'DESIGN', 'Government security protocols (assessment mapping provided)'),
    'SEC-N02': ('B12', 'DESIGN', 'Network segmentation (needs network infrastructure)'),
    'SEC-L05': ('B12', 'DESIGN', 'placeholder'),
    'NFR-R04': ('B12', 'DESIGN', 'IRAP and ISM alignment (mapping provided; assessment is external)'),
    'NFR-AV01': ('B12', 'DESIGN', '99.9% availability (needs production hosting and measurement)'),
    'NFR-AV02': ('B12', 'DESIGN', 'Automated failover (needs redundant hosting)'),
    'NFR-SC02': ('B12', 'DESIGN', 'Elastic compute (needs a cloud platform)'),
    'NFR-SC03': ('B12', 'DESIGN', 'Independent analytics warehouse scaling (needs a cloud platform)'),
}
T.pop('SEC-L05')

if __name__ == '__main__':
    listed = set(re.findall(r'^((?:FR|NFR|SEC)-[A-Z]*\d+) \[', open('_work/deferred_list.txt', encoding='utf8').read(), re.M))
    missing = sorted(listed - set(T))
    extra = sorted(set(T) - listed)
    print('deferred', len(listed), 'triaged', len(T), 'missing', missing, 'extra', extra)
    import collections
    c = collections.Counter((b, k) for b, k, _ in T.values())
    for b in ['B8', 'B9', 'B10', 'B11', 'B12']:
        print(b, {k: n for (bb, k), n in sorted(c.items()) if bb == b})
    print('by class', collections.Counter(k for _, k, _ in T.values()))
