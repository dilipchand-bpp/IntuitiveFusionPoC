# 01b – Personas, User Journeys and User Stories

**Product:** Intuitive Fusion – Procurement Portal (POC)  |  **Version:** 0.1 DRAFT  |  Companion to [01-Requirements-Document.md](01-Requirements-Document.md).

Every Given/When/Then below becomes an automated test (`AT-<story id>`) in Phase 5. Tier: **W** working end-to-end in the POC, **S** stub/mock behind swap point, **D** design-only.

## 1. Personas and roles

| ID | Persona | RBAC role | Profile | Pain point |
|---|---|---|---|---|
| P1 | Business Requester | `REQUESTER` | Business-unit staff who need goods/services but are not procurement experts; mostly on mobile; want to say what they need and move on. | Shadow procurement, complex forms |
| P2 | Procurement Lead / Category Manager | `PROCUREMENT` | Owns the end-to-end process for medium/high-value procurements; assembles plan, tender pack, runs evaluation. | Re-keying data across documents; version chaos |
| P3 | Delegate / Approver | `DELEGATE` | Holds financial or signing authority; approves plans, publication, evaluation reports; often on phone or Teams. | Needs one-screen summary, one-tap approval, proof of what they approved |
| P4 | Evaluator (Technical / Commercial) | `EVALUATOR` | Scores supplier bids independently within an assigned stream; must declare conflicts first. | Bias, leakage of pricing, unclear rubric |
| P5 | Panel Chair | `CHAIR` | Moderates consensus, resolves score deviations, signs off the panel outcome. | Reconciling scores in spreadsheets |
| P6 | Legal Counsel / Legal Ops | `LEGAL` | Reviews and amends contract drafts, deviation register, endorsement gate. | Copy-paste of supplier terms into templates |
| P7 | Contract Manager / Owner | `CONTRACT_MGR` | Manages post-award obligations, milestones, variations, renewals. | Contracts buried as PDFs; missed notice windows |
| P8 | Supplier / Tenderer (external) | `SUPPLIER` | Registers, views one invited tender, asks questions, submits a bid before close. | Opaque process, late-submission risk |
| P9 | Probity Advisor / Auditor (read-only) | `PROBITY` | Independent oversight of process integrity; read-only portal; audit export. | No evidence trail, after-the-fact audits |
| P10 | Tenant Administrator | `ADMIN` | Configures workflows, delegations, templates, labels, users; no access to bid content. | IT-coded changes for simple rule edits |
| P11 | Executive / Finance | `EXEC` | Consumes dashboards (spend, cycle time, risk); Finance additionally handles ERP/budget views. | Reactive analytics |

## 2. User journeys

| Journey | Steps | Stories |
|---|---|---|
| J1 – Request to approved plan (P1, P2, P3) | Requester describes need → assistant asks follow-ups → complexity scored → request submitted → Procurement Lead opens auto-populated plan → edits by instruction → declares COI → Delegate reviews AI summary and approves on mobile → plan locked. | US-INT-01..05, US-PLN-01..05 |
| J2 – Tender to bids (P2, P3, P8) | Tender pack generated → staged → delegate grants permission to publish → suppliers invited → supplier registers, asks anonymised question → addendum issued → supplier uploads bid before close → portal locks at close. | US-TND-01..03, US-SUP-01..04 |
| J3 – Evaluation to report (P4, P5, P2, P3, P9) | Evaluators declare COI → independent hidden scoring (technical blind to price) → Chair opens consensus, variance flagged → rationale recorded → report generated → delegate signs off → Probity Advisor reviews read-only. | US-EVL-01..07 |
| J4 – Award to managed contract (P6, P3, P7) | Legal drafts from template and clause library → reviews deviation register → signing delegate signs (separate authority) → contract locked → contract record and alerts auto-created → expiry Gantt. | US-CON-01..04, US-CMG-01..04 |
| J5 – Oversight and configuration (P9, P10, P11) | Executive opens dashboard → Probity exports audit trail → Admin edits delegation threshold (no access to bids). | US-RPT-01..03, US-ADM-01..04 |
| J6 – Anonymous to signed-in (all) | Visitor lands on public page → clicks Get Started → logs in (mock IdP) → redirected by role → uses notifications/profile → logs out. | US-PLT-01..04 |

## 3. User stories with acceptance criteria

### INT – Request Intake & AI Assistant

#### US-INT-01  ·  Must  ·  Tier W
**As a** Business Requester, **I want** describe what I need in plain language by text (or voice), **so that** a procurement request is created without me completing a structured form.

- **AC1** — **Given** a signed-in Requester with intake permission, **when** they type 'Run an RFx for facilities cleaning, three-year term, about $1.2M' into the assistant, **then** a request record is created with title, category, term, estimated value and business unit pre-populated and shown for review.
- Traces to: FR-0005, FR-0006, FR-X01, FR-0010, FR-0015, FR-0020, FR-0025, FR-X02 …(+6)

#### US-INT-02  ·  Must  ·  Tier W
**As a** Business Requester, **I want** be asked follow-up questions for any mandatory field the assistant could not infer, **so that** the request is complete before submission.

- **AC1** — **Given** an intake conversation with missing mandatory fields, **when** the assistant processes the user's message, **then** it asks targeted questions for each missing field and the field is populated when answered.
- **AC2** — **Given** all mandatory fields are populated, **when** the user reviews the request, **then** the Submit action becomes enabled; otherwise it is disabled with a list of missing fields.
- Traces to: FR-X01, FR-0010, FR-0015, FR-0020, FR-0025, FR-X02, FR-0030, FR-0035 …(+5)

#### US-INT-03  ·  Must  ·  Tier W
**As a** Procurement Lead / Category Manager, **I want** have the platform score request complexity and route governance automatically, **so that** high-value or high-risk requests get the right gates.

- **AC1** — **Given** a request with value, category criticality, supply location and data sensitivity captured, **when** the request is saved, **then** a complexity score (Low/Medium/High/Critical) is computed and displayed with its inputs.
- **AC2** — **Given** a request scored High or Critical, **when** it is submitted, **then** an independent risk-officer sign-off and upfront COI declaration are added as mandatory gates and progression is blocked until both are satisfied.
- Traces to: FR-0060

#### US-INT-04  ·  Must  ·  Tier S
**As a** Procurement Lead / Category Manager, **I want** choose between procurement-team-led and self-service intake by value/risk threshold, **so that** low-value requests are fast and high-value requests are controlled.

- **AC1** — **Given** a tenant threshold of $50,000, **when** a request below the threshold is created, **then** self-service intake is offered directly to the requester.
- **AC2** — **Given** the same threshold, **when** a request above it is created, **then** it is routed to the procurement team queue.
- Traces to: FR-0040

#### US-INT-05  ·  Must  ·  Tier W
**As a** Business Requester, **I want** see my requests and their status, and open any request, **so that** I know where my request is.

- **AC1** — **Given** a Requester with 3 requests, **when** they open 'My requests', **then** only their own requests are listed with phase, status and last-updated, and each opens to a detail view.
- Traces to: FR-0070

#### US-INT-06  ·  Must  ·  Tier S
**As a** Executive / Finance, **I want** have budget checked against ERP at submission (mock in POC), **so that** only funded requests proceed.

- **AC1** — **Given** an ERP-integrated tenant (mock adapter), **when** a request is submitted, **then** a budget clearance status is returned within 3 seconds and recorded against the request.
- **AC2** — **Given** hard-cap configuration and insufficient budget, **when** the request is submitted, **then** submission is blocked and a budget-amendment task is raised.
- Traces to: FR-0050, FR-0055

### PLN – Procurement Plan

#### US-PLN-01  ·  Must  ·  Tier W
**As a** Procurement Lead / Category Manager, **I want** open an auto-populated procurement plan from the request, **so that** I do not re-key intake data.

- **AC1** — **Given** a submitted request, **when** the Procurement Lead opens the plan, **then** plan fields (background, requirements, deliverables, milestones, risks, evaluation committee, delegate, due-diligence approach) are pre-populated from the intake conversation.
- Traces to: FR-0075, FR-0085, FR-0090, FR-0095

#### US-PLN-02  ·  Must  ·  Tier W
**As a** Procurement Lead / Category Manager, **I want** tell the assistant to change a field or one paragraph of a field, **so that** edits are fast and everything else is untouched.

- **AC1** — **Given** a plan field with five paragraphs, **when** the user says 'change paragraph 3 to say X', **then** only paragraph 3 changes, a before/after entry is written to the audit log, and the user can undo.
- Traces to: FR-0085, FR-0090, FR-0095

#### US-PLN-03  ·  Must  ·  Tier W
**As a** Delegate / Approver, **I want** review a one-screen summary and approve the plan with one action (including on mobile), **so that** approval is quick and evidenced.

- **AC1** — **Given** a plan awaiting approval by the Delegate for its value tier, **when** the Delegate opens the plan on a 375px-wide screen, **then** an AI summary of key points is shown and Approve/Reject is reachable without horizontal scrolling.
- **AC2** — **Given** the Delegate approves, **when** approval is recorded, **then** a visible approval stamp with name, role and timestamp is applied and the plan becomes locked.
- Traces to: FR-0080

#### US-PLN-04  ·  Must  ·  Tier W
**As a** Procurement Lead / Category Manager, **I want** reopen a locked plan with reason, **so that** genuine changes (e.g. evaluation criteria) can be made under control.

- **AC1** — **Given** a locked plan, **when** only a Procurement-role user requests reopening and gives a reason, **then** the plan reopens, previously collected approvals are marked superseded, and the event is audited; a Requester cannot reopen.
- Traces to: FR-0100

#### US-PLN-05  ·  Must  ·  Tier W
**As a** Evaluator (Technical / Commercial), **I want** declare a conflict of interest conversationally, **so that** conflicts are routed to the delegate.

- **AC1** — **Given** a user named on the evaluation committee, **when** they declare 'I previously worked for Acme Pty Ltd', **then** the declaration is recorded against the plan and routed to the appropriate delegate for decision (immaterial / manageable / material).
- Traces to: FR-0105

#### US-PLN-06  ·  Must  ·  Tier S
**As a** Procurement Lead / Category Manager, **I want** have dates changes ripple across all documents, **so that** documents never disagree.

- **AC1** — **Given** a plan and tender pack sharing a closing date, **when** the date is changed in either, **then** the other document shows the new date and the change is audited.
- Traces to: NFR-P03

### TND – Tender Pack & RFx Collaboration

#### US-TND-01  ·  Must  ·  Tier W
**As a** Procurement Lead / Category Manager, **I want** generate a tender pack from the request and plan, **so that** the RFx is ready for review without retyping.

- **AC1** — **Given** an approved (or in-progress) plan, **when** the Procurement Lead selects 'Create tender pack', **then** requirements, scope, deliverables and timeline are pre-populated using the template for the chosen procurement type (RFT/RFP/RFQ/RFI/EOI).
- Traces to: FR-0110, FR-0115, FR-0120, FR-0130, FR-0140

#### US-TND-02  ·  Must  ·  Tier W
**As a** Delegate / Approver, **I want** keep a tender in a staged state until I give permission to publish, **so that** nothing is released without authority.

- **AC1** — **Given** a staged tender, **when** no permission-to-publish has been recorded, **then** the tender is not visible to any supplier and Publish is disabled.
- **AC2** — **Given** the ECV-appropriate delegate grants permission, **when** the Procurement Lead publishes, **then** the tender becomes visible to invited suppliers and invitation emails are queued.
- Traces to: FR-0115, FR-0130, FR-0140, FR-0150

#### US-TND-03  ·  Must  ·  Tier W
**As a** Procurement Lead / Category Manager, **I want** manage anonymised Q&A and publish answers as an addendum, **so that** all bidders receive identical information.

- **AC1** — **Given** a question from a registered bidder, **when** the buyer publishes the response, **then** an addendum is issued to all registered bidders and the questioner's identity is not disclosed.
- Traces to: FR-0135

#### US-TND-04  ·  Must  ·  Tier S
**As a** Procurement Lead / Category Manager, **I want** validate statutory minimum publication-to-close periods, **so that** public-sector tenders are compliant.

- **AC1** — **Given** a public-sector tenant with a 25-day minimum, **when** the closing date is set 10 days after publication, **then** publication is blocked with an explanatory error.
- Traces to: FR-0145

#### US-TND-05  ·  Must  ·  Tier S
**As a** Procurement Lead / Category Manager, **I want** print or export any document to Word and PDF, **so that** I can circulate paper copies.

- **AC1** — **Given** any templated document, **when** the user chooses Export, **then** a PDF (and Word where available) is produced carrying a timestamp and version.
- Traces to: NFR-U03

### SUP – Supplier & Tender Portal

#### US-SUP-01  ·  Must  ·  Tier W
**As a** Supplier / Tenderer (external), **I want** register once via an invitation link, **so that** I can access the tender I was invited to.

- **AC1** — **Given** an invited supplier contact, **when** they open the unique invitation link, **then** they can self-register (name, email, company, ABN) and are placed in the supplier directory with sanctions-screening status 'pending'.
- Traces to: FR-0235, FR-0240, FR-0245

#### US-SUP-02  ·  Must  ·  Tier W
**As a** Supplier / Tenderer (external), **I want** see only the tender I am invited to, **so that** confidential tenders stay confidential.

- **AC1** — **Given** a closed tender and a supplier not invited, **when** the supplier opens the tender URL, **then** access is denied and the attempt is logged; invited suppliers see exactly one tender.
- Traces to: FR-0155, FR-0160, FR-0175, FR-0195, FR-0200, FR-0205, FR-0210, FR-0215 …(+3)

#### US-SUP-03  ·  Must  ·  Tier W
**As a** Supplier / Tenderer (external), **I want** upload my bid before close and receive a receipt, **so that** I know my bid is in.

- **AC1** — **Given** an open tender before closing time, **when** the supplier uploads allowed file types and submits, **then** the files are stored (encrypted/sealed in design) and a submission receipt with timestamp is issued.
- **AC2** — **Given** an upload or file type outside the allowed list or size, **when** the supplier submits, **then** it is rejected with a clear message.
- Traces to: FR-0170, FR-0175, FR-0195, FR-0200, FR-0205, FR-0210, FR-0215, FR-0220 …(+2)

#### US-SUP-04  ·  Must  ·  Tier W
**As a** Supplier / Tenderer (external), **I want** be locked out automatically after the closing time, **so that** the process is fair.

- **AC1** — **Given** a submission in progress at closing time, **when** the deadline passes, **then** the transfer is discarded, the bid is not accepted, and a late-submission notification is sent.
- Traces to: FR-0165

#### US-SUP-05  ·  Must  ·  Tier S
**As a** Procurement Lead / Category Manager, **I want** see sanctions/insurance status on the supplier profile, **so that** I can assess supplier eligibility.

- **AC1** — **Given** a registered supplier, **when** the Procurement Lead opens the profile, **then** sanctions-screening and insurance-certificate status are shown with last-checked date (mock provider in POC).
- Traces to: FR-0180, FR-0185, FR-0245, FR-0250

### EVL – Evaluation & Evaluation Report

#### US-EVL-01  ·  Must  ·  Tier W
**As a** Evaluator (Technical / Commercial), **I want** complete a mandatory COI declaration before I can see vendor names or bid files, **so that** evaluation is free from undeclared conflicts.

- **AC1** — **Given** an evaluator who has not declared, **when** they open the evaluation, **then** vendor identities and documents are withheld.
- **AC2** — **Given** an evaluator declares a conflict, **when** the declaration is saved, **then** their project access is revoked immediately and the Panel Chair and Probity Advisor are alerted.
- Traces to: FR-0265, FR-0280, FR-0285, FR-0300, FR-0305, FR-0315, FR-0320, FR-0325 …(+3)

#### US-EVL-02  ·  Must  ·  Tier W
**As a** Procurement Lead / Category Manager, **I want** have one evaluation record auto-created per supplier that submitted, **so that** scoring starts without manual set-up.

- **AC1** — **Given** a closed tender with 5 submissions, **when** evaluation is opened, **then** 5 supplier columns and all weighted criteria are pre-populated in the scoring sheet.
- Traces to: FR-0255, FR-0265, FR-0280, FR-0285, FR-0305, FR-0315, FR-0320, FR-0340

#### US-EVL-03  ·  Must  ·  Tier W
**As a** Evaluator (Technical / Commercial), **I want** score independently without seeing others' scores, **so that** bias is avoided.

- **AC1** — **Given** two evaluators scoring the same supplier, **when** evaluator A opens the scoring screen, **then** evaluator B's scores and comments are not retrievable through any view or API until the consensus stage opens.
- **AC2** — **Given** a technical evaluator, **when** they open a bid, **then** commercial pricing content is not retrievable by any view, export or search.
- Traces to: FR-0260, FR-0270

#### US-EVL-04  ·  Must  ·  Tier W
**As a** Panel Chair, **I want** moderate consensus with automatic variance flags, **so that** large disagreements are discussed and recorded.

- **AC1** — **Given** two evaluators differ by more than the configured variance (30%), **when** the Chair opens consensus, **then** the deviation is flagged and consensus cannot be locked until a rationale is recorded.
- Traces to: FR-0275

#### US-EVL-05  ·  Must  ·  Tier W
**As a** Procurement Lead / Category Manager, **I want** generate an evaluation report from the evaluation outcomes, **so that** the report writes itself and is evidenced.

- **AC1** — **Given** a locked consensus, **when** the Procurement Lead generates the report, **then** scores, per-supplier commentary and the process followed are populated and the report is timestamped.
- Traces to: FR-0345, FR-0350, FR-0355, FR-0360, FR-0365, FR-0370

#### US-EVL-06  ·  Must  ·  Tier S
**As a** Delegate / Approver, **I want** sign off the evaluation report at my value tier before award, **so that** award has proper authority.

- **AC1** — **Given** an unapproved report, **when** contract award is attempted, **then** progression is blocked until the value-tier delegate signs off; sign-off is audited.
- Traces to: FR-0355, FR-0360, FR-0365, FR-0370, FR-0375

#### US-EVL-07  ·  Must  ·  Tier S
**As a** Probity Advisor / Auditor (read-only), **I want** have a read-only oversight view and audit export, **so that** I can evidence probity to an auditor.

- **AC1** — **Given** a Probity Advisor, **when** they open an evaluation, **then** they see process events, declarations and approvals read-only and cannot edit any record.
- Traces to: FR-0310

#### US-EVL-08  ·  Must  ·  Tier S
**As a** Procurement Lead / Category Manager, **I want** run negotiation / BAFO with an AI-recommended plan, **so that** negotiation outcomes are captured.

- **AC1** — **Given** a shortlisted supplier, **when** the user opens the negotiation workspace, **then** offers and counter-offers are recorded with timestamps and an AI recommendation is shown (mock).
- Traces to: FR-0290, FR-0295

### CON – Contract Award & Legal

#### US-CON-01  ·  Must  ·  Tier W
**As a** Legal Counsel / Legal Ops, **I want** get a draft contract assembled from the correct template and clauses, **so that** drafting starts from verified content.

- **AC1** — **Given** an approved evaluation report, **when** Legal opens 'Draft contract', **then** the template matching the tender route is selected, clauses are assembled from the clause library, and winning-supplier price/SLA data is populated.
- Traces to: FR-0385, FR-0390, FR-0395, FR-0400, FR-0405, FR-0415, FR-0425, FR-0430 …(+8)

#### US-CON-02  ·  Must  ·  Tier S
**As a** Legal Counsel / Legal Ops, **I want** review a deviation register with risk ratings, **so that** supplier-proposed changes are visible.

- **AC1** — **Given** supplier deviations captured, **when** Legal opens the register, **then** each deviation shows an auto-proposed risk rating that Legal can amend.
- Traces to: FR-0125, FR-0385, FR-0390, FR-0400, FR-0415, FR-0425, FR-0430, FR-0435 …(+8)

#### US-CON-03  ·  Must  ·  Tier W
**As a** Delegate / Approver, **I want** sign (and see a signing stamp) under separately enforced signing authority, **so that** only authorised people execute contracts.

- **AC1** — **Given** a final contract and a signing delegate with sufficient authority, **when** they sign, **then** a signature stamp with name/role/time is applied; a user lacking signing authority cannot sign even if they approved the sourcing.
- Traces to: FR-0380, FR-0410, FR-0420

#### US-CON-04  ·  Must  ·  Tier W
**As a** Legal Counsel / Legal Ops, **I want** have signed contracts locked, **so that** executed contracts cannot be altered.

- **AC1** — **Given** a fully signed contract, **when** any user attempts edit or delete, **then** edit is blocked, delete is limited to authorised roles via logical delete, and both are audited.
- Traces to: FR-0455

#### US-CON-05  ·  Must  ·  Tier S
**As a** Legal Counsel / Legal Ops, **I want** create variations linked to the parent contract, **so that** history is preserved.

- **AC1** — **Given** a signed contract, **when** a variation is created, **then** it is stored as a child of the parent contract with cumulative value tracking.
- Traces to: FR-0460

### CMG – Contract Management

#### US-CMG-01  ·  Must  ·  Tier W
**As a** Contract Manager / Owner, **I want** have a contract record auto-created from the executed contract, **so that** I start managing without data entry.

- **AC1** — **Given** an executed contract, **when** it is locked, **then** a contract record is created with parties, term, value, milestones and optional extensions populated.
- Traces to: FR-0490, FR-0495, FR-0500, FR-0520, FR-0525, FR-0535, FR-0540, FR-0545 …(+7)

#### US-CMG-02  ·  Must  ·  Tier W
**As a** Contract Manager / Owner, **I want** get automatic alerts for expiry, milestones and notice periods, **so that** I never miss a window.

- **AC1** — **Given** a contract with a 90-day termination notice, **when** the record is created, **then** an alert is scheduled 150 days before the end date, and delivery (email + in-app) is logged when triggered.
- Traces to: FR-0495, FR-0500, FR-0505, FR-0510, FR-0520, FR-0525, FR-0535, FR-0540 …(+8)

#### US-CMG-03  ·  Must  ·  Tier S
**As a** Contract Manager / Owner, **I want** add my own alert in plain language, **so that** personal reminders are easy.

- **AC1** — **Given** an open contract, **when** the user types 'alert me 1 year before expiry and include whoever is my manager then', **then** a custom alert is created, resolves the recipient at trigger time, and is shown in the alert list.
- Traces to: FR-0515, FR-0530

#### US-CMG-04  ·  Must  ·  Tier W
**As a** Contract Manager / Owner, **I want** see all contracts expiring in the next 90 days and a Gantt of terms and extensions, **so that** I can plan renewals.

- **AC1** — **Given** contracts with varied end dates, **when** the user opens the expiry view, **then** contracts ending within 90 days are listed and a Gantt shows initial term plus optional extensions.
- Traces to: FR-0635, FR-0640

#### US-CMG-05  ·  Should  ·  Tier S
**As a** Contract Manager / Owner, **I want** track spend against contract value, **so that** I see leakage early.

- **AC1** — **Given** a contract with invoices, **when** spend is loaded (mock feed), **then** committed vs actual spend is displayed with a warning at the configured threshold.
- Traces to: FR-0580

### RPT – Reporting & Dashboards

#### US-RPT-01  ·  Must  ·  Tier W
**As a** Executive / Finance, **I want** see a central dashboard of all active procurements with lifecycle phase and completion indicators, **so that** I have portfolio visibility.

- **AC1** — **Given** active procurements, **when** the dashboard opens, **then** KPIs (active count, avg cycle time, value in flight, alerts due) and a procurement table with phase and green-tick completion indicators are shown, scoped to the user's role.
- Traces to: FR-0590, FR-0600, FR-0610, FR-0625, FR-0645, FR-0650, PRM-03

#### US-RPT-02  ·  Must  ·  Tier W
**As a** Probity Advisor / Auditor (read-only), **I want** export a probity/audit-trail report, **so that** auditors have an unalterable evidence trail.

- **AC1** — **Given** a procurement with activity, **when** an authorised user exports the audit report, **then** it lists who did what and when, with field-level before/after, and the export itself is audited.
- Traces to: FR-0600, FR-0610, FR-0615, FR-0625, FR-0630, FR-0645

#### US-RPT-03  ·  Must  ·  Tier S
**As a** Executive / Finance, **I want** view spend by category/supplier and maverick spend, **so that** I can find savings.

- **AC1** — **Given** spend data (seeded), **when** the report opens, **then** spend splits by category and supplier and off-contract spend is highlighted; charts support drill-down.
- Traces to: FR-0605

#### US-RPT-04  ·  Must  ·  Tier S
**As a** Procurement Lead / Category Manager, **I want** see a workload/capacity view and procurement Gantt, **so that** I can balance the team.

- **AC1** — **Given** active procurements by owner, **when** the view opens, **then** volume and value per owner and a timeline of phases are shown.
- Traces to: FR-0595, FR-0620

### ADM – Administration & Configuration

#### US-ADM-01  ·  Must  ·  Tier W
**As a** Tenant Administrator, **I want** manage users, roles and delegations of authority, **so that** the right people hold the right authority.

- **AC1** — **Given** an Administrator, **when** they edit a delegation threshold (e.g. Delegate L2 up to $500,000), **then** the change takes effect for new approvals without a code release and is audited.
- Traces to: FR-0680, FR-0690, FR-0695, FR-0715, FR-0725, FR-0730

#### US-ADM-02  ·  Must  ·  Tier S
**As a** Tenant Administrator, **I want** configure workflows, mandatory checkpoints and field labels, **so that** the platform fits our policy.

- **AC1** — **Given** an Administrator, **when** they view the workflow library (simple/intermediate/complex), **then** workflows are listed with steps and checkpoints; editing is available for a simple workflow, others show 'Coming soon'.
- Traces to: FR-0680, FR-0690, FR-0695, FR-0700, FR-0705, FR-0710, FR-0720, FR-0730

#### US-ADM-03  ·  Must  ·  Tier S
**As a** Tenant Administrator, **I want** manage templates and clause library, **so that** documents follow our standards.

- **AC1** — **Given** an Administrator, **when** they open the template library, **then** templates are listed by type and version; creating new ones is 'Coming soon'.
- Traces to: FR-0750

#### US-ADM-04  ·  Must  ·  Tier W
**As a** Tenant Administrator, **I want** be prevented from reading bid content, **so that** administration cannot compromise probity.

- **AC1** — **Given** a user with the ADMIN role only, **when** they request any supplier bid file, **then** the request is denied and logged (SEC-AC13).
- Traces to: FR-0685

### MIG – Data Migration

#### US-MIG-01  ·  Must  ·  Tier S
**As a** Contract Manager / Owner, **I want** upload legacy contract records and see them validated before cutover, **so that** history is not lost.

- **AC1** — **Given** a CSV of legacy contracts, **when** the user uploads it, **then** the platform profiles it, reports errors, and marks accepted rows with a 'migrated' source flag (full AI extraction is 'Coming soon').
- Traces to: FR-0655, FR-0660, FR-0665, FR-0670, FR-0675

### AIA – Collaboration & AI Authoring (cross-cutting)

#### US-AIA-01  ·  Must  ·  Tier S
**As a** Procurement Lead / Category Manager, **I want** collaborate on the same document with tracked changes and version compare, **so that** teams work in one place.

- **AC1** — **Given** two users editing a plan, **when** each saves changes, **then** changes are tracked per user and a version compare shows what changed.
- Traces to: FR-0735, FR-0740, FR-0745, FR-0755, FR-0760, FR-0765, FR-0770, FR-0775 …(+2)

#### US-AIA-02  ·  Must  ·  Tier W
**As a** Business Requester, **I want** get an AI-generated summary and draft that I can always edit, with a mandatory human gate, **so that** AI helps but never decides.

- **AC1** — **Given** any AI-populated field, **when** the user opens it, **then** it is flagged 'AI-drafted', fully editable, every change is logged, and progression requires human approval.
- Traces to: FR-0735, FR-0740, FR-0745, FR-0750, FR-0755, FR-0760, FR-0765, FR-0770 …(+8)

### PLT – Platform: Identity, Audit, Notifications, Accessibility

#### US-PLT-01  ·  Must  ·  Tier W
**As a** Business Requester, **I want** land on a public page that explains the value of Intuitive Fusion, **so that** I understand why to sign in.

- **AC1** — **Given** an anonymous visitor, **when** they open the site, **then** they see hero + CTA, features, how-it-works (4 steps), illustrations, trust/security section, FAQ and footer with contact/legal links.
- Traces to: PRM-01, PRM-06

#### US-PLT-02  ·  Must  ·  Tier W
**As a** Business Requester, **I want** log in with validation and a forgot-password path and be redirected by role, **so that** I land where I work.

- **AC1** — **Given** valid mock credentials for a Delegate, **when** they log in, **then** they are redirected to the Delegate home; invalid input shows field-level errors; 'Forgot password' shows a confirmation without revealing whether the account exists.
- **AC2** — **Given** 5 failed attempts, **when** a 6th is made, **then** the account is temporarily locked and the event audited.
- Traces to: SEC-A01, SEC-A02, SEC-A03, SEC-A04, SEC-A05, SEC-A06, SEC-A07, PRM-02 …(+1)

#### US-PLT-03  ·  Must  ·  Tier W
**As a** Business Requester, **I want** have routes protected by role, **so that** I cannot open things I should not.

- **AC1** — **Given** a Requester, **when** they navigate directly to /admin, **then** they see an access-denied page and the attempt is audited.
- Traces to: SEC-AC01, SEC-AC02, SEC-AC03, SEC-AC04, SEC-AC05, SEC-AC06, SEC-AC07, SEC-AC08 …(+6)

#### US-PLT-04  ·  Must  ·  Tier W
**As a** Business Requester, **I want** use notifications and a profile menu, and log out, **so that** I stay informed and in control.

- **AC1** — **Given** a signed-in user, **when** a task is assigned to them, **then** a notification appears in the bell menu with a deep link; Logout ends the session.
- Traces to: FR-0065, FR-0066, PRM-03

#### US-PLT-05  ·  Must  ·  Tier W
**As a** Business Requester, **I want** use the whole portal comfortably on desktop, tablet and phone, in light or dark mode, **so that** I can work anywhere.

- **AC1** — **Given** viewports of 375, 768 and 1280px, **when** any key page loads, **then** no horizontal scroll occurs, primary actions are reachable, and contrast meets WCAG 2.1 AA in both themes.
- Traces to: NFR-U01, NFR-U02, NFR-U03, NFR-U04, NFR-U05, NFR-U06, NFR-U07, NFR-U08 …(+2)

#### US-NFR-01  ·  Must  ·  Tier W
**As a** Tenant Administrator, **I want** every action and field change to be written to an immutable audit log with who/what/when/before/after, **so that** auditors can reconstruct any decision.

- **AC1** — **Given** any create/update/approve/sign/delete action, **when** it completes, **then** an append-only audit record exists and cannot be updated or deleted through the application.
- Traces to: FR-0070, FR-0630, SEC-L01, SEC-L02, SEC-L03, SEC-L04, SEC-L05, SEC-L06 …(+3)

#### US-NFR-02  ·  Must  ·  Tier W
**As a** Tenant Administrator, **I want** role- and attribute-based access control with least privilege and segregation of duties, **so that** access is limited to need.

- **AC1** — **Given** a user without the required role/attribute, **when** they call a protected API, **then** the API returns 403 and the denial is audited.
- Traces to: FR-0100, FR-0190, SEC-AC01, SEC-AC02, SEC-AC03, SEC-AC04, SEC-AC05, SEC-AC06 …(+9)

#### US-NFR-03  ·  Must  ·  Tier S
**As a** Tenant Administrator, **I want** strong authentication, MFA and session controls (mocked behind an IdP swap point), **so that** identity is trustworthy.

- **AC1** — **Given** a session idle beyond the timeout, **when** the user acts, **then** re-authentication is required.
- Traces to: SEC-A01, SEC-A02, SEC-A03, SEC-A04, SEC-A05, SEC-A06, SEC-A07, PRM-02

#### US-NFR-04  ·  Must  ·  Tier D
**As a** Tenant Administrator, **I want** data to be encrypted in transit and at rest with tenant isolation and no public document access, **so that** customer data is protected.

- **AC1** — **Given** any stored document, **when** it is retrieved, **then** retrieval is mediated by the API with authorisation; no public URL exists (design-verified in POC; enforced in AWS build).
- Traces to: NFR-R01, NFR-R02, NFR-R03, NFR-R04, NFR-R05, NFR-R06, SEC-D01, SEC-D02 …(+14)

#### US-NFR-05  ·  Must  ·  Tier S
**As a** Tenant Administrator, **I want** defined performance targets for primary journeys and the ability to scale, **so that** users are not kept waiting.

- **AC1** — **Given** the p95 targets in the Technical Specification, **when** the k6 smoke profile runs, **then** API p95 and page load targets are met.
- Traces to: NFR-P01, NFR-P02, NFR-P03, NFR-P04, NFR-P05, NFR-P06, NFR-SC01, NFR-SC02 …(+2)

#### US-NFR-06  ·  Must  ·  Tier D
**As a** Tenant Administrator, **I want** 99.9% availability with backups, tested restore and defined RTO/RPO, **so that** the platform is dependable.

- **AC1** — **Given** a simulated primary failure (design/runbook), **when** the DR procedure is followed, **then** service is restored within the agreed RTO with RPO respected (design-validated; rehearsed in hardening).
- Traces to: NFR-AV01, NFR-AV02, NFR-AV03, NFR-AV04, NFR-AV05, NFR-CA01, NFR-CA02, NFR-CA03 …(+9)

#### US-NFR-07  ·  Must  ·  Tier W
**As a** Tenant Administrator, **I want** infrastructure as code, CI/CD gates, observability and tracing, **so that** delivery is safe and repeatable.

- **AC1** — **Given** a commit to main, **when** the pipeline runs, **then** lint, unit, build, SAST, dependency audit and e2e smoke must pass before deploy.
- Traces to: NFR-M01, NFR-M02, NFR-M03, NFR-M04, NFR-M05, NFR-M06, SEC-AP01, SEC-AP02 …(+7)

#### US-NFR-08  ·  Must  ·  Tier S
**As a** Tenant Administrator, **I want** AI to be pluggable, enterprise-bounded and guarded against prompt injection, **so that** AI use is governed.

- **AC1** — **Given** a tenant AI configuration, **when** the model provider is switched by configuration, **then** no application code changes are needed and prompts/outputs are logged.
- Traces to: NFR-M01, NFR-M02, NFR-M03, NFR-M04, NFR-M05, NFR-M06, NFR-C01, NFR-C02 …(+14)

#### US-NFR-09  ·  Must  ·  Tier S
**As a** Tenant Administrator, **I want** integrations (ERP, legal, e-signature, sanctions) behind adapters with retry and manual fallback, **so that** external outages do not stop work.

- **AC1** — **Given** an adapter outage (simulated), **when** a dependent action is attempted, **then** the action retries idempotently or falls back to a manual path and the user is informed.
- Traces to: NFR-AV01, NFR-AV02, NFR-AV03, NFR-AV04, NFR-AV05, NFR-C01, NFR-C02, NFR-C03 …(+13)

#### US-NFR-10  ·  Must  ·  Tier D
**As a** Tenant Administrator, **I want** legal and regulatory rules (statutory timing, data residency, Privacy Act, IRAP alignment) to be configurable and evidenced, **so that** we can operate in regulated sectors.

- **AC1** — **Given** tenant region set to Australia, **when** data is stored, **then** it remains in the ap-southeast-2 region (design-verified).
- Traces to: NFR-CA01, NFR-CA02, NFR-CA03, NFR-CA04, NFR-L01, NFR-L02, NFR-L03, NFR-L04 …(+6)

#### US-NFR-11  ·  Must  ·  Tier W
**As a** Tenant Administrator, **I want** accessible, responsive, text-first (voice optional) interfaces, **so that** everyone can use the platform.

- **AC1** — **Given** any journey, **when** it is performed by keyboard and text only, **then** it completes with full parity to voice; axe scan reports no serious violations.
- Traces to: NFR-U01, NFR-U02, NFR-U03, NFR-U04, NFR-U05, NFR-U06, NFR-U07, NFR-U08

### FUT – Future scope (deferred)

#### US-FUT-01  ·  Won't  ·  Tier S
**As a** Procurement Lead / Category Manager, **I want** see future capabilities signposted, **so that** I understand the roadmap.

- **AC1** — **Given** a feature scoped as Won't/Deferred, **when** the user opens its nav entry, **then** a 'Coming soon' state explains the capability and links to the roadmap.
- Traces to: FR-0790, FR-0795, FR-0800, FR-0805, FR-0810, FR-0815, FR-0820, FR-0825 …(+12)

