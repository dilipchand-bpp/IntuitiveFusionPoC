# Single source of truth for personas, roles, user stories and requirement->story mapping.
# Used by build_docs.py to generate docs/01b-User-Stories.md and docs/02-RTM.md / RTM.csv.

PERSONAS = [
 ("P1","Business Requester","REQUESTER","Business-unit staff who need goods/services but are not procurement experts; mostly on mobile; want to say what they need and move on.","Shadow procurement, complex forms"),
 ("P2","Procurement Lead / Category Manager","PROCUREMENT","Owns the end-to-end process for medium/high-value procurements; assembles plan, tender pack, runs evaluation.","Re-keying data across documents; version chaos"),
 ("P3","Delegate / Approver","DELEGATE","Holds financial or signing authority; approves plans, publication, evaluation reports; often on phone or Teams.","Needs one-screen summary, one-tap approval, proof of what they approved"),
 ("P4","Evaluator (Technical / Commercial)","EVALUATOR","Scores supplier bids independently within an assigned stream; must declare conflicts first.","Bias, leakage of pricing, unclear rubric"),
 ("P5","Panel Chair","CHAIR","Moderates consensus, resolves score deviations, signs off the panel outcome.","Reconciling scores in spreadsheets"),
 ("P6","Legal Counsel / Legal Ops","LEGAL","Reviews and amends contract drafts, deviation register, endorsement gate.","Copy-paste of supplier terms into templates"),
 ("P7","Contract Manager / Owner","CONTRACT_MGR","Manages post-award obligations, milestones, variations, renewals.","Contracts buried as PDFs; missed notice windows"),
 ("P8","Supplier / Tenderer (external)","SUPPLIER","Registers, views one invited tender, asks questions, submits a bid before close.","Opaque process, late-submission risk"),
 ("P9","Probity Advisor / Auditor (read-only)","PROBITY","Independent oversight of process integrity; read-only portal; audit export.","No evidence trail, after-the-fact audits"),
 ("P10","Tenant Administrator","ADMIN","Configures workflows, delegations, templates, labels, users; no access to bid content.","IT-coded changes for simple rule edits"),
 ("P11","Executive / Finance","EXEC","Consumes dashboards (spend, cycle time, risk); Finance additionally handles ERP/budget views.","Reactive analytics"),
]

# role -> description used in the RBAC matrix
ROLES = [r[2] for r in PERSONAS] + ["PLATFORM_OPS"]

MODULES = {
 "INT":"Request Intake & AI Assistant",
 "PLN":"Procurement Plan",
 "TND":"Tender Pack & RFx Collaboration",
 "SUP":"Supplier & Tender Portal",
 "EVL":"Evaluation & Evaluation Report",
 "CON":"Contract Award & Legal",
 "CMG":"Contract Management",
 "RPT":"Reporting & Dashboards",
 "ADM":"Administration & Configuration",
 "MIG":"Data Migration",
 "AIA":"Collaboration & AI Authoring (cross-cutting)",
 "PLT":"Platform: Identity, Audit, Notifications, Accessibility",
 "FUT":"Future scope (deferred)",
}

# Stories: id, module, persona, want, so, [(G,W,T)...], priority, tier (W working / S stub / D deferred)
S = []
def story(id,mod,persona,want,so,gwt,pri="Must",tier="S"):
    S.append(dict(id=id,mod=mod,persona=persona,want=want,so=so,gwt=gwt,pri=pri,tier=tier))

# ---------------- INT
story("US-INT-01","INT","P1","describe what I need in plain language by text (or voice)","a procurement request is created without me completing a structured form",
 [("a signed-in Requester with intake permission","they type 'Run an RFx for facilities cleaning, three-year term, about $1.2M' into the assistant","a request record is created with title, category, term, estimated value and business unit pre-populated and shown for review")],"Must","W")
story("US-INT-02","INT","P1","be asked follow-up questions for any mandatory field the assistant could not infer","the request is complete before submission",
 [("an intake conversation with missing mandatory fields","the assistant processes the user's message","it asks targeted questions for each missing field and the field is populated when answered"),
  ("all mandatory fields are populated","the user reviews the request","the Submit action becomes enabled; otherwise it is disabled with a list of missing fields")],"Must","W")
story("US-INT-03","INT","P2","have the platform score request complexity and route governance automatically","high-value or high-risk requests get the right gates",
 [("a request with value, category criticality, supply location and data sensitivity captured","the request is saved","a complexity score (Low/Medium/High/Critical) is computed and displayed with its inputs"),
  ("a request scored High or Critical","it is submitted","an independent risk-officer sign-off and upfront COI declaration are added as mandatory gates and progression is blocked until both are satisfied")],"Must","W")
story("US-INT-04","INT","P2","choose between procurement-team-led and self-service intake by value/risk threshold","low-value requests are fast and high-value requests are controlled",
 [("a tenant threshold of $50,000","a request below the threshold is created","self-service intake is offered directly to the requester"),
  ("the same threshold","a request above it is created","it is routed to the procurement team queue")],"Must","S")
story("US-INT-05","INT","P1","see my requests and their status, and open any request","I know where my request is",
 [("a Requester with 3 requests","they open 'My requests'","only their own requests are listed with phase, status and last-updated, and each opens to a detail view")],"Must","W")
story("US-INT-06","INT","P11","have budget checked against ERP at submission (mock in POC)","only funded requests proceed",
 [("an ERP-integrated tenant (mock adapter)","a request is submitted","a budget clearance status is returned within 3 seconds and recorded against the request"),
  ("hard-cap configuration and insufficient budget","the request is submitted","submission is blocked and a budget-amendment task is raised")],"Must","S")

# ---------------- PLN
story("US-PLN-01","PLN","P2","open an auto-populated procurement plan from the request","I do not re-key intake data",
 [("a submitted request","the Procurement Lead opens the plan","plan fields (background, requirements, deliverables, milestones, risks, evaluation committee, delegate, due-diligence approach) are pre-populated from the intake conversation")],"Must","W")
story("US-PLN-02","PLN","P2","tell the assistant to change a field or one paragraph of a field","edits are fast and everything else is untouched",
 [("a plan field with five paragraphs","the user says 'change paragraph 3 to say X'","only paragraph 3 changes, a before/after entry is written to the audit log, and the user can undo")],"Must","W")
story("US-PLN-03","PLN","P3","review a one-screen summary and approve the plan with one action (including on mobile)","approval is quick and evidenced",
 [("a plan awaiting approval by the Delegate for its value tier","the Delegate opens the plan on a 375px-wide screen","an AI summary of key points is shown and Approve/Reject is reachable without horizontal scrolling"),
  ("the Delegate approves","approval is recorded","a visible approval stamp with name, role and timestamp is applied and the plan becomes locked")],"Must","W")
story("US-PLN-04","PLN","P2","reopen a locked plan with reason","genuine changes (e.g. evaluation criteria) can be made under control",
 [("a locked plan","only a Procurement-role user requests reopening and gives a reason","the plan reopens, previously collected approvals are marked superseded, and the event is audited; a Requester cannot reopen")],"Must","W")
story("US-PLN-05","PLN","P4","declare a conflict of interest conversationally","conflicts are routed to the delegate",
 [("a user named on the evaluation committee","they declare 'I previously worked for Acme Pty Ltd'","the declaration is recorded against the plan and routed to the appropriate delegate for decision (immaterial / manageable / material)")],"Must","W")
story("US-PLN-06","PLN","P2","have dates changes ripple across all documents","documents never disagree",
 [("a plan and tender pack sharing a closing date","the date is changed in either","the other document shows the new date and the change is audited")],"Must","S")

# ---------------- TND
story("US-TND-01","TND","P2","generate a tender pack from the request and plan","the RFx is ready for review without retyping",
 [("an approved (or in-progress) plan","the Procurement Lead selects 'Create tender pack'","requirements, scope, deliverables and timeline are pre-populated using the template for the chosen procurement type (RFT/RFP/RFQ/RFI/EOI)")],"Must","W")
story("US-TND-02","TND","P3","keep a tender in a staged state until I give permission to publish","nothing is released without authority",
 [("a staged tender","no permission-to-publish has been recorded","the tender is not visible to any supplier and Publish is disabled"),
  ("the ECV-appropriate delegate grants permission","the Procurement Lead publishes","the tender becomes visible to invited suppliers and invitation emails are queued")],"Must","W")
story("US-TND-03","TND","P2","manage anonymised Q&A and publish answers as an addendum","all bidders receive identical information",
 [("a question from a registered bidder","the buyer publishes the response","an addendum is issued to all registered bidders and the questioner's identity is not disclosed")],"Must","W")
story("US-TND-04","TND","P2","validate statutory minimum publication-to-close periods","public-sector tenders are compliant",
 [("a public-sector tenant with a 25-day minimum","the closing date is set 10 days after publication","publication is blocked with an explanatory error")],"Must","S")
story("US-TND-05","TND","P2","print or export any document to Word and PDF","I can circulate paper copies",
 [("any templated document","the user chooses Export","a PDF (and Word where available) is produced carrying a timestamp and version")],"Must","S")

# ---------------- SUP
story("US-SUP-01","SUP","P8","register once via an invitation link","I can access the tender I was invited to",
 [("an invited supplier contact","they open the unique invitation link","they can self-register (name, email, company, ABN) and are placed in the supplier directory with sanctions-screening status 'pending'")],"Must","W")
story("US-SUP-02","SUP","P8","see only the tender I am invited to","confidential tenders stay confidential",
 [("a closed tender and a supplier not invited","the supplier opens the tender URL","access is denied and the attempt is logged; invited suppliers see exactly one tender")],"Must","W")
story("US-SUP-03","SUP","P8","upload my bid before close and receive a receipt","I know my bid is in",
 [("an open tender before closing time","the supplier uploads allowed file types and submits","the files are stored (encrypted/sealed in design) and a submission receipt with timestamp is issued"),
  ("an upload or file type outside the allowed list or size","the supplier submits","it is rejected with a clear message")],"Must","W")
story("US-SUP-04","SUP","P8","be locked out automatically after the closing time","the process is fair",
 [("a submission in progress at closing time","the deadline passes","the transfer is discarded, the bid is not accepted, and a late-submission notification is sent")],"Must","W")
story("US-SUP-05","SUP","P2","see sanctions/insurance status on the supplier profile","I can assess supplier eligibility",
 [("a registered supplier","the Procurement Lead opens the profile","sanctions-screening and insurance-certificate status are shown with last-checked date (mock provider in POC)")],"Must","S")

# ---------------- EVL
story("US-EVL-01","EVL","P4","complete a mandatory COI declaration before I can see vendor names or bid files","evaluation is free from undeclared conflicts",
 [("an evaluator who has not declared","they open the evaluation","vendor identities and documents are withheld"),
  ("an evaluator declares a conflict","the declaration is saved","their project access is revoked immediately and the Panel Chair and Probity Advisor are alerted")],"Must","W")
story("US-EVL-02","EVL","P2","have one evaluation record auto-created per supplier that submitted","scoring starts without manual set-up",
 [("a closed tender with 5 submissions","evaluation is opened","5 supplier columns and all weighted criteria are pre-populated in the scoring sheet")],"Must","W")
story("US-EVL-03","EVL","P4","score independently without seeing others' scores","bias is avoided",
 [("two evaluators scoring the same supplier","evaluator A opens the scoring screen","evaluator B's scores and comments are not retrievable through any view or API until the consensus stage opens"),
  ("a technical evaluator","they open a bid","commercial pricing content is not retrievable by any view, export or search")],"Must","W")
story("US-EVL-04","EVL","P5","moderate consensus with automatic variance flags","large disagreements are discussed and recorded",
 [("two evaluators differ by more than the configured variance (30%)","the Chair opens consensus","the deviation is flagged and consensus cannot be locked until a rationale is recorded")],"Must","W")
story("US-EVL-05","EVL","P2","generate an evaluation report from the evaluation outcomes","the report writes itself and is evidenced",
 [("a locked consensus","the Procurement Lead generates the report","scores, per-supplier commentary and the process followed are populated and the report is timestamped")],"Must","W")
story("US-EVL-06","EVL","P3","sign off the evaluation report at my value tier before award","award has proper authority",
 [("an unapproved report","contract award is attempted","progression is blocked until the value-tier delegate signs off; sign-off is audited")],"Must","S")
story("US-EVL-07","EVL","P9","have a read-only oversight view and audit export","I can evidence probity to an auditor",
 [("a Probity Advisor","they open an evaluation","they see process events, declarations and approvals read-only and cannot edit any record")],"Must","S")
story("US-EVL-08","EVL","P2","run negotiation / BAFO with an AI-recommended plan","negotiation outcomes are captured",
 [("a shortlisted supplier","the user opens the negotiation workspace","offers and counter-offers are recorded with timestamps and an AI recommendation is shown (mock)")],"Must","S")

# ---------------- CON
story("US-CON-01","CON","P6","get a draft contract assembled from the correct template and clauses","drafting starts from verified content",
 [("an approved evaluation report","Legal opens 'Draft contract'","the template matching the tender route is selected, clauses are assembled from the clause library, and winning-supplier price/SLA data is populated")],"Must","W")
story("US-CON-02","CON","P6","review a deviation register with risk ratings","supplier-proposed changes are visible",
 [("supplier deviations captured","Legal opens the register","each deviation shows an auto-proposed risk rating that Legal can amend")],"Must","S")
story("US-CON-03","CON","P3","sign (and see a signing stamp) under separately enforced signing authority","only authorised people execute contracts",
 [("a final contract and a signing delegate with sufficient authority","they sign","a signature stamp with name/role/time is applied; a user lacking signing authority cannot sign even if they approved the sourcing")],"Must","W")
story("US-CON-04","CON","P6","have signed contracts locked","executed contracts cannot be altered",
 [("a fully signed contract","any user attempts edit or delete","edit is blocked, delete is limited to authorised roles via logical delete, and both are audited")],"Must","W")
story("US-CON-05","CON","P6","create variations linked to the parent contract","history is preserved",
 [("a signed contract","a variation is created","it is stored as a child of the parent contract with cumulative value tracking")],"Must","S")

# ---------------- CMG
story("US-CMG-01","CMG","P7","have a contract record auto-created from the executed contract","I start managing without data entry",
 [("an executed contract","it is locked","a contract record is created with parties, term, value, milestones and optional extensions populated")],"Must","W")
story("US-CMG-02","CMG","P7","get automatic alerts for expiry, milestones and notice periods","I never miss a window",
 [("a contract with a 90-day termination notice","the record is created","an alert is scheduled 150 days before the end date, and delivery (email + in-app) is logged when triggered")],"Must","W")
story("US-CMG-03","CMG","P7","add my own alert in plain language","personal reminders are easy",
 [("an open contract","the user types 'alert me 1 year before expiry and include whoever is my manager then'","a custom alert is created, resolves the recipient at trigger time, and is shown in the alert list")],"Must","S")
story("US-CMG-04","CMG","P7","see all contracts expiring in the next 90 days and a Gantt of terms and extensions","I can plan renewals",
 [("contracts with varied end dates","the user opens the expiry view","contracts ending within 90 days are listed and a Gantt shows initial term plus optional extensions")],"Must","W")
story("US-CMG-05","CMG","P7","track spend against contract value","I see leakage early",
 [("a contract with invoices","spend is loaded (mock feed)","committed vs actual spend is displayed with a warning at the configured threshold")],"Should","S")

# ---------------- RPT
story("US-RPT-01","RPT","P11","see a central dashboard of all active procurements with lifecycle phase and completion indicators","I have portfolio visibility",
 [("active procurements","the dashboard opens","KPIs (active count, avg cycle time, value in flight, alerts due) and a procurement table with phase and green-tick completion indicators are shown, scoped to the user's role")],"Must","W")
story("US-RPT-02","RPT","P9","export a probity/audit-trail report","auditors have an unalterable evidence trail",
 [("a procurement with activity","an authorised user exports the audit report","it lists who did what and when, with field-level before/after, and the export itself is audited")],"Must","W")
story("US-RPT-03","RPT","P11","view spend by category/supplier and maverick spend","I can find savings",
 [("spend data (seeded)","the report opens","spend splits by category and supplier and off-contract spend is highlighted; charts support drill-down")],"Must","S")
story("US-RPT-04","RPT","P2","see a workload/capacity view and procurement Gantt","I can balance the team",
 [("active procurements by owner","the view opens","volume and value per owner and a timeline of phases are shown")],"Must","S")

# ---------------- ADM
story("US-ADM-01","ADM","P10","manage users, roles and delegations of authority","the right people hold the right authority",
 [("an Administrator","they edit a delegation threshold (e.g. Delegate L2 up to $500,000)","the change takes effect for new approvals without a code release and is audited")],"Must","W")
story("US-ADM-02","ADM","P10","configure workflows, mandatory checkpoints and field labels","the platform fits our policy",
 [("an Administrator","they view the workflow library (simple/intermediate/complex)","workflows are listed with steps and checkpoints; editing is available for a simple workflow, others show 'Coming soon'")],"Must","S")
story("US-ADM-03","ADM","P10","manage templates and clause library","documents follow our standards",
 [("an Administrator","they open the template library","templates are listed by type and version; creating new ones is 'Coming soon'")],"Must","S")
story("US-ADM-04","ADM","P10","be prevented from reading bid content","administration cannot compromise probity",
 [("a user with the ADMIN role only","they request any supplier bid file","the request is denied and logged (SEC-AC13)")],"Must","W")

# ---------------- MIG / AIA / FUT
story("US-MIG-01","MIG","P7","upload legacy contract records and see them validated before cutover","history is not lost",
 [("a CSV of legacy contracts","the user uploads it","the platform profiles it, reports errors, and marks accepted rows with a 'migrated' source flag (full AI extraction is 'Coming soon')")],"Must","S")
story("US-AIA-01","AIA","P2","collaborate on the same document with tracked changes and version compare","teams work in one place",
 [("two users editing a plan","each saves changes","changes are tracked per user and a version compare shows what changed")],"Must","S")
story("US-AIA-02","AIA","P1","get an AI-generated summary and draft that I can always edit, with a mandatory human gate","AI helps but never decides",
 [("any AI-populated field","the user opens it","it is flagged 'AI-drafted', fully editable, every change is logged, and progression requires human approval")],"Must","W")
story("US-FUT-01","FUT","P2","see future capabilities signposted","I understand the roadmap",
 [("a feature scoped as Won't/Deferred","the user opens its nav entry","a 'Coming soon' state explains the capability and links to the roadmap")],"Won't","S")

# ---------------- PLT (portal flow, identity)
story("US-PLT-01","PLT","P1","land on a public page that explains the value of Intuitive Fusion","I understand why to sign in",
 [("an anonymous visitor","they open the site","they see hero + CTA, features, how-it-works (4 steps), illustrations, trust/security section, FAQ and footer with contact/legal links")],"Must","W")
story("US-PLT-02","PLT","P1","log in with validation and a forgot-password path and be redirected by role","I land where I work",
 [("valid mock credentials for a Delegate","they log in","they are redirected to the Delegate home; invalid input shows field-level errors; 'Forgot password' shows a confirmation without revealing whether the account exists"),
  ("5 failed attempts","a 6th is made","the account is temporarily locked and the event audited")],"Must","W")
story("US-PLT-03","PLT","P1","have routes protected by role","I cannot open things I should not",
 [("a Requester","they navigate directly to /admin","they see an access-denied page and the attempt is audited")],"Must","W")
story("US-PLT-04","PLT","P1","use notifications and a profile menu, and log out","I stay informed and in control",
 [("a signed-in user","a task is assigned to them","a notification appears in the bell menu with a deep link; Logout ends the session")],"Must","W")
story("US-PLT-05","PLT","P1","use the whole portal comfortably on desktop, tablet and phone, in light or dark mode","I can work anywhere",
 [("viewports of 375, 768 and 1280px","any key page loads","no horizontal scroll occurs, primary actions are reachable, and contrast meets WCAG 2.1 AA in both themes")],"Must","W")

# ---------------- NFR enabler stories (trace NFR/SEC categories)
def enabler(id,want,so,gwt,tier="W"):
    story(id,"PLT","P10",want,so,gwt,"Must",tier)
enabler("US-NFR-01","every action and field change to be written to an immutable audit log with who/what/when/before/after","auditors can reconstruct any decision",
 [("any create/update/approve/sign/delete action","it completes","an append-only audit record exists and cannot be updated or deleted through the application")])
enabler("US-NFR-02","role- and attribute-based access control with least privilege and segregation of duties","access is limited to need",
 [("a user without the required role/attribute","they call a protected API","the API returns 403 and the denial is audited")])
enabler("US-NFR-03","strong authentication, MFA and session controls (mocked behind an IdP swap point)","identity is trustworthy",
 [("a session idle beyond the timeout","the user acts","re-authentication is required")],"S")
enabler("US-NFR-04","data to be encrypted in transit and at rest with tenant isolation and no public document access","customer data is protected",
 [("any stored document","it is retrieved","retrieval is mediated by the API with authorisation; no public URL exists (design-verified in POC; enforced in AWS build)")],"D")
enabler("US-NFR-05","defined performance targets for primary journeys and the ability to scale","users are not kept waiting",
 [("the p95 targets in the Technical Specification","the k6 smoke profile runs","API p95 and page load targets are met")],"S")
enabler("US-NFR-06","99.9% availability with backups, tested restore and defined RTO/RPO","the platform is dependable",
 [("a simulated primary failure (design/runbook)","the DR procedure is followed","service is restored within the agreed RTO with RPO respected (design-validated; rehearsed in hardening)")],"D")
enabler("US-NFR-07","infrastructure as code, CI/CD gates, observability and tracing","delivery is safe and repeatable",
 [("a commit to main","the pipeline runs","lint, unit, build, SAST, dependency audit and e2e smoke must pass before deploy")],"W")
enabler("US-NFR-08","AI to be pluggable, enterprise-bounded and guarded against prompt injection","AI use is governed",
 [("a tenant AI configuration","the model provider is switched by configuration","no application code changes are needed and prompts/outputs are logged")],"S")
enabler("US-NFR-09","integrations (ERP, legal, e-signature, sanctions) behind adapters with retry and manual fallback","external outages do not stop work",
 [("an adapter outage (simulated)","a dependent action is attempted","the action retries idempotently or falls back to a manual path and the user is informed")],"S")
enabler("US-NFR-10","legal and regulatory rules (statutory timing, data residency, Privacy Act, IRAP alignment) to be configurable and evidenced","we can operate in regulated sectors",
 [("tenant region set to Australia","data is stored","it remains in the ap-southeast-2 region (design-verified)")],"D")
enabler("US-NFR-11","accessible, responsive, text-first (voice optional) interfaces","everyone can use the platform",
 [("any journey","it is performed by keyboard and text only","it completes with full parity to voice; axe scan reports no serious violations")])

# ---------------- mapping requirement -> stories
FR_CAT = {
 "Request Intake & AI":["US-INT-01","US-INT-02","US-INT-03","US-INT-04","US-INT-05","US-INT-06"],
 "Procurement Plan":["US-PLN-01","US-PLN-02","US-PLN-03","US-PLN-04","US-PLN-05"],
 "RFx / Tender Collaboration":["US-TND-01","US-TND-02","US-TND-03","US-TND-04","US-TND-05"],
 "Tender Portal":["US-SUP-02","US-SUP-03","US-SUP-04"],
 "Supplier Portal":["US-SUP-01","US-SUP-05"],
 "Evaluation":["US-EVL-01","US-EVL-02","US-EVL-03","US-EVL-04","US-EVL-08"],
 "Evaluation Report":["US-EVL-05","US-EVL-06","US-EVL-07"],
 "Contract Award & Legal":["US-CON-01","US-CON-02","US-CON-03","US-CON-04","US-CON-05"],
 "Contract Management":["US-CMG-01","US-CMG-02","US-CMG-03","US-CMG-04","US-CMG-05"],
 "Reporting & Dashboards":["US-RPT-01","US-RPT-02","US-RPT-03","US-RPT-04"],
 "Data Migration":["US-MIG-01"],
 "Admin & Configuration":["US-ADM-01","US-ADM-02","US-ADM-03","US-ADM-04"],
 "Collaboration & AI Authoring":["US-AIA-01","US-AIA-02","US-PLN-02"],
 "Future Scope":["US-FUT-01"],
}
# fine-grained overrides (primary story first). Only the requirements with a precise 1:1 intent.
FR_OVERRIDE = {
 "FR-0005":["US-INT-01"],"FR-0006":["US-INT-01"],"FR-0035":["US-INT-02"],"FR-0060":["US-INT-03"],"FR-0040":["US-INT-04"],
 "FR-0050":["US-INT-06"],"FR-0055":["US-INT-06"],"FR-0070":["US-NFR-01","US-INT-05"],
 "FR-0075":["US-PLN-01"],"FR-0080":["US-PLN-03"],"FR-0100":["US-PLN-04","US-NFR-02"],"FR-0105":["US-PLN-05"],
 "FR-0110":["US-TND-01"],"FR-0120":["US-TND-01"],"FR-0135":["US-TND-03"],"FR-0145":["US-TND-04"],"FR-0150":["US-TND-02"],
 "FR-0155":["US-SUP-02"],"FR-0160":["US-SUP-02"],"FR-0165":["US-SUP-04"],"FR-0170":["US-SUP-03"],"FR-0180":["US-SUP-05"],"FR-0185":["US-SUP-05"],"FR-0190":["US-NFR-02"],
 "FR-0235":["US-SUP-01"],"FR-0240":["US-SUP-01"],"FR-0250":["US-SUP-05"],
 "FR-0255":["US-EVL-02"],"FR-0260":["US-EVL-03"],"FR-0270":["US-EVL-03"],"FR-0275":["US-EVL-04"],"FR-0290":["US-EVL-08"],"FR-0295":["US-EVL-08"],
 "FR-0300":["US-EVL-01"],"FR-0310":["US-EVL-07"],"FR-0325":["US-EVL-01"],"FR-0330":["US-EVL-01"],"FR-0335":["US-EVL-01"],
 "FR-0345":["US-EVL-05"],"FR-0350":["US-EVL-05"],"FR-0375":["US-EVL-06"],
 "FR-0380":["US-CON-03"],"FR-0395":["US-CON-01"],"FR-0405":["US-CON-01"],"FR-0410":["US-CON-03"],"FR-0420":["US-CON-03"],"FR-0455":["US-CON-04"],"FR-0460":["US-CON-05"],"FR-0475":["US-CON-02"],"FR-0125":["US-CON-02"],
 "FR-0490":["US-CMG-01"],"FR-0505":["US-CMG-02"],"FR-0510":["US-CMG-02"],"FR-0515":["US-CMG-03"],"FR-0530":["US-CMG-03"],"FR-0635":["US-CMG-04"],"FR-0640":["US-CMG-04"],"FR-0580":["US-CMG-05"],
 "FR-0590":["US-RPT-01"],"FR-0650":["US-RPT-01"],"FR-0615":["US-RPT-02"],"FR-0630":["US-RPT-02","US-NFR-01"],"FR-0605":["US-RPT-03"],"FR-0620":["US-RPT-04"],"FR-0595":["US-RPT-04"],
 "FR-0715":["US-ADM-01"],"FR-0725":["US-ADM-01"],"FR-0685":["US-ADM-04"],
}
# POC tier W (working end-to-end): requirement ids implemented in Phase 5 key functions
POC_WORKING = set("""FR-0005 FR-0006 FR-0025 FR-0035 FR-0060 FR-0070
FR-0075 FR-0080 FR-0100 FR-0105
FR-0110 FR-0120 FR-0135 FR-0150
FR-0155 FR-0160 FR-0165 FR-0170 FR-0235
FR-0255 FR-0260 FR-0270 FR-0275 FR-0300 FR-0345
FR-0380 FR-0395 FR-0410 FR-0420 FR-0455
FR-0490 FR-0505 FR-0640 FR-0635
FR-0590 FR-0615 FR-0630 FR-0650
FR-0680 FR-0715 FR-0685 FR-0745 FR-0780 FR-0785""".split())

NFR_CAT = {
 "P":["US-NFR-05"],"SC":["US-NFR-05"],"AV":["US-NFR-06","US-NFR-09","US-AIA-02"],"U":["US-NFR-11","US-PLT-05"],
 "M":["US-NFR-07","US-NFR-08"],"C":["US-NFR-08","US-NFR-09"],"CA":["US-NFR-06","US-NFR-10"],
 "DR":["US-NFR-06"],"L":["US-NFR-10"],"R":["US-NFR-10","US-NFR-04"],
}
SEC_CAT = {
 "A":["US-NFR-03","US-PLT-02"],"AC":["US-NFR-02","US-PLT-03"],"D":["US-NFR-04"],"L":["US-NFR-01"],
 "AP":["US-NFR-07","US-NFR-08"],"N":["US-NFR-04"],"IR":["US-NFR-06"],"TP":["US-NFR-09"],
}
NFR_WORKING = set("NFR-U01 NFR-U02 NFR-U03 NFR-U06 NFR-U07 NFR-M02 NFR-AV05 NFR-P03 NFR-P06 NFR-CA02".split())
SEC_WORKING = set("SEC-AC01 SEC-AC02 SEC-AC03 SEC-AC04 SEC-AC05 SEC-AC06 SEC-AC07 SEC-AC08 SEC-AC11 SEC-AC12 SEC-AC13 SEC-L01 SEC-L03 SEC-L04 SEC-L05 SEC-A07 SEC-AP03 SEC-AP06 SEC-AP07".split())
SEC_STUB = set("SEC-A01 SEC-A02 SEC-A03 SEC-A04 SEC-A05 SEC-A06".split())
