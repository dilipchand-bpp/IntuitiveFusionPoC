# 01 – Requirements Document

**Product:** Intuitive Fusion – Procurement Portal (Proof of Concept)
**Organisation:** Intuitive Fusion (logo supplied: `Logo.jpg`)
**Phase:** 1 – Requirements Analysis  |  **Version:** 0.1 DRAFT  |  **Date:** 2026-10-02
**Companions:** [01b-User-Stories.md](01b-User-Stories.md) · [02-RTM.md](02-RTM.md) / [RTM.csv](RTM.csv)
**Status:** For approval. No code has been written.

---

## 1. Summary

Intuitive Fusion is a conversational, AI-driven source-to-contract platform: a single conversation pre-populates the procurement plan, tender pack, scoring sheet, evaluation report and contract, with every AI-drafted field editable by a person and governance gates built in (pitch deck, slides 2–3).

This POC delivers a **portal** that demonstrates the full seven-stage lifecycle (Request intake → Plan → Tender → Evaluation → Contract award & legal → Contract management → Reporting) plus Administration, using mocked AI, authentication and integrations behind clear swap points. Per the brief, each module is built as a complete skeleton with 2–3 working functions wired UI → API → data; everything else is stubbed with TODO markers and "Coming soon" states.

**Source material used** (the "attached PDF" named in the brief was not in the folder; the owner confirmed the following substitute it):
1. `Intuitive Fusion — The Autonomous Sourcing Engine.pptx` – problem, value proposition, five user problems (13 slides).
2. `Requirements_Register_IntuitiveFusion_v0.2.xlsx` – BRS v1.1 + Detailed Design derived register: **184 functional rows, 54 non-functional, 65 security**, 22 stakeholder roles, AI behaviour notes (86 rows), 8 technical rows, 8 business objectives (OBJ-01…08).
3. `Prompt.docx` – delivery method, portal flow, branding and quality guardrails.

### 1.1 Problem being solved (from the deck)
| # | User problem | Platform response |
|---|---|---|
| 1 | Process rigidity and costly workflow customisation | Admin-configurable workflows, delegations, labels – no IT coding |
| 2 | Sourcing-to-contract silo; re-keying vendor data into legal templates | One data model from intake to contract; contract drafted from evaluation outcome |
| 3 | Value leakage after signature (~9% of contract value) | Auto-created obligations, alerts, expiry Gantt |
| 4 | Poor UX → shadow procurement (up to 29% off-contract) | Conversational front door, mobile-first approvals |
| 5 | Reactive analytics | Role-based live dashboards, audit-grade reporting |

### 1.2 Business objectives carried from the register
OBJ-01 cycle time −30% · OBJ-02 adoption >80% · OBJ-03 >70% fields auto-populated · OBJ-04 100% budget-checked (ERP) · OBJ-05 100% conflicts captured and routed · OBJ-06 dashboards for 100% of roles · OBJ-07 99.9% uptime · OBJ-08 data sovereignty and pluggable enterprise AI. *The POC does not prove OBJ-01/02/07; it demonstrates the mechanisms that enable them.*

---

## 2. Scope

### 2.1 In scope for the POC (this engagement)
- Public landing page, branded login (mock identity with IdP swap point), role-based redirect, protected routes.
- Main application shell: dashboard KPIs, per-module navigation, profile menu, notifications, logout.
- All nine functional modules (INT, PLN, TND, SUP, EVL, CON, CMG, RPT, ADM) each as skeleton + 2–3 working functions on realistic seed data; MIG and cross-cutting AI-authoring as thinner stubs.
- Mock AI assistant (scripted/rule-based, deterministic) behind an `AiProvider` interface; text interaction first-class, voice shown as "Coming soon".
- Audit log, RBAC/ABAC, segregation-of-duties checks, delegation-of-authority engine (working).
- Design tokens in one theme file, extracted from the logo, WCAG 2.1 AA verified.

### 2.2 Out of scope for the POC (documented, not built)
Real LLM/Bedrock, speech-to-text/text-to-speech, live ERP/legal/e-sign/sanctions integrations, real IdP, native mobile apps, data residency/IRAP evidencing, dual-witness bid decryption, per-tenant envelope encryption, production DR, and all 20 *Won't* functional requirements (FR-0790…FR-0880: ratings, FX, HR integration, gamification, etc.).

### 2.3 Requirement tiers (how the 312 requirements split)
| Tier | Meaning | FR | NFR | SEC | PRM |
|---|---|---|---|---|---|
| **W** Working | Implemented and tested end-to-end in Phase 5 | 44 | 10 | 19 | 9 |
| **S** Stub/mock | UI/API exist, behaviour mocked or "Coming soon" | 116 | 0 | 6 | 0 |
| **D** Design-only / deferred | Specified in Phases 2–3; not built | 24 | 44 | 40 | 0 |

NFR/SEC "D" items are still *designed for* in the architecture and verified by review, not by running code (see §8).

---

## 3. Functional requirements (summary)

Full text, acceptance criteria and notes live in the register; the RTM traces every ID. Counts are from the Functional Requirements tab (184 rows incl. 6 rows lacking an ID).

| Module | Register category | Rows | Must | Headline capabilities |
|---|---|---|---|---|
| INT | Request Intake & AI | 19 | most | Voice/text intake, field inference, follow-up questions, taxonomy (UNSPSC), workflow selection, complexity score, ERP budget check, self-service vs team-led, notifications |
| PLN | Procurement Plan | 7 | most | Auto-populated plan, delegate approval incl. mobile, restricted editing, COI capture, lock/reopen |
| TND | RFx / Tender Collaboration | 9 | most | Pack from intake, assembler, legal deviation register, anonymised Q&A, statutory windows, staged→permission to publish |
| SUP | Tender Portal + Supplier Portal | 16 + 4 | most | One-tender view, invite-only/open access, close-time lock, uploads, sanctions/insurance, SoD, addenda, multi-stage, registration |
| EVL | Evaluation + Evaluation Report | 18 + 7 | most | Record per bidder, isolated views, pass/fail gate, hidden scoring, consensus variance, BAFO, COI lifecycle, probity portal, sign-off |
| CON | Contract Award & Legal | 22 | mostly Must | Signing workflow, clause assembly, deviation monitoring, delegation of signing, e-signature, lock after signing, variations |
| CMG | Contract Management | 20 | mostly Must | Record from contract, alert engine, custom alerts, variations, compliance monitoring, spend tracking, master/child agreements |
| RPT | Reporting & Dashboards | 13 | most | Central dashboard, Gantt, role views, spend/maverick, audit report, drill-down, completeness indicators |
| ADM | Admin & Configuration | 11 | most | Segmented permissioned admin, audit of config, numbering, labels, workflow library, delegations, checkpoints |
| MIG | Data Migration | 5 | all Must | Ingestion, linking, validation, source flag, AI extraction |
| AIA | Collaboration & AI Authoring | 11 | most | Co-editing, tracked changes, field-level AI amend, summaries, advance by plain language, stamps, delegate one-screen summary |
| FUT | Future Scope | 19 | 0 | All *Won't* – documented only |

**Key rules distilled from the register that drive the POC design**
- Approved plan **locks**; only Procurement can reopen with reason (FR-0100 / AI notes).
- Tender stays **staged** until the ECV-appropriate delegate grants permission to publish (FR-0150).
- Suppliers see **one tender at a time**; closed tenders invite-only (FR-0155/0160); portal **locks at close** (FR-0165).
- Evaluators declare **COI before seeing vendor names**; scoring is **hidden until consensus**; technical evaluators **cannot retrieve pricing** (FR-0260/0270/0300).
- Consensus cannot lock while a variance flag (e.g. 30%) has no recorded rationale (FR-0275).
- **Signing authority is separate** from sourcing-approval authority (FR-0410, SEC-AC05); signed contracts are locked, logical delete only (FR-0455, NFR-CA02).
- **AI never decides**: all AI-populated fields editable, logged, behind a human gate (NFR-AV05, SEC-AC12).

---

## 4. Non-functional requirements

Targets marked **TBC** are not stated in the source documents; the *proposed* value is what the POC will test against until the client confirms (see open questions).

| Area | Requirement (register IDs) | Target in register | Proposed POC target (to confirm) |
|---|---|---|---|
| **Security** | MFA, SSO (SAML/OIDC), separate supplier identity pool, RBAC+ABAC, least privilege, SoD, encryption in transit/at rest, tenant isolation, bid sealing, WAF/DoS, SAST gate, malware scan, pen test, AI prompt-injection controls (SEC-A/AC/D/AP/N) | Mostly Must; ISO 27001:2022 Annex A refs; Essential Eight | POC *implements* RBAC/ABAC, SoD, audit, session timeout, input validation, SAST + dependency audit in CI; MFA/SSO mocked |
| **Performance** | NFR-P01…P06 | Near real-time plan update (TBC); ERP check ≤3 s; no figure for page/API | Page interactive ≤2.5 s on broadband (LCP); API p95 ≤300 ms for list/get, ≤800 ms for create; mock AI reply ≤2 s; plan section refresh ≤5 s |
| **Scalability / capacity** | NFR-SC01…SC04, CA01…CA04 | Elastic scaling; peak bid-close load TBC | POC smoke: 50 concurrent users; bid-close burst 25 simultaneous uploads |
| **Availability / DR** | NFR-AV01…AV05, DR01…DR03 | 99.9% (BRS) vs **99.99%** (Technical tab) – **conflict**; RTO/RPO TBC | Design to 99.9%; propose RTO 4 h / RPO 1 h (to confirm); not tested in POC |
| **Auditability** | SEC-L01…L08, FR-0070/0630/0615, NFR-R06 | Immutable, field-level before/after, who-did-what-when, AI conversation logged | 100% of state-changing API calls produce an append-only audit event; export working |
| **Accessibility** | NFR-U06, Technical tab ("Accessibility Compliance in Australia") | "Proposed WCAG 2.1 AA – confirm" | **WCAG 2.1 AA**; axe/Lighthouse accessibility ≥90 (target 95); keyboard-only operable; text parity with voice |
| **Usability / responsive** | NFR-U01…U08, Technical tab (mobile-first) | All role views actionable on desktop/tablet/mobile | Verified at 375 / 768 / 1280 px; light and dark mode |
| **Compatibility** | NFR-C01…C08 | Browser baseline TBC | Latest two versions of Chrome, Edge, Safari, Firefox; iOS Safari and Android Chrome |
| **Maintainability** | NFR-M01…M06 | IaC, CI/CD, observability, config over code | CI gating (lint, type-check, unit, build, SAST, audit, e2e smoke); structured logs + trace IDs; tenant config in DB |
| **Legal / regulatory** | NFR-L01…L04, NFR-R01…R06 | Statutory windows, disclosure, eIDAS, residency (AU), IRAP, Privacy Act | Statutory window validator working (configurable); others design-only |

---

## 5. Personas and journeys
Eleven personas (P1–P11), eleven RBAC roles plus platform ops, and six journeys (J1–J6) are defined in [01b-User-Stories.md](01b-User-Stories.md) §1–2.

## 6. User stories
**68 user stories / 78 Given-When-Then acceptance criteria**, organised by module in [01b-User-Stories.md](01b-User-Stories.md) §3 (57 functional + 11 enabler stories for non-functional/security). Every criterion is written to be directly automatable and is the source of the `AT-<story>` tests.

---

## 7. Assumptions, risks, dependencies

### 7.1 Assumptions
| # | Assumption | If wrong |
|---|---|---|
| A1 | Pitch deck + Requirements Register v0.2 substitute the missing PDF | Re-baseline Phase 1 |
| A2 | POC audience is a client/sponsor demo; data is synthetic; single tenant (multi-tenant designed, one tenant seeded) | Tenant switching, isolation tests added |
| A3 | Stack: React/Next.js + Node/TypeScript API + PostgreSQL, AWS-targeted (confirmed) | ADRs revisited |
| A4 | AI is **mocked** (deterministic rules + canned reasoning) behind an interface; no data leaves the machine | Real model adds cost, latency, guardrail work |
| A5 | Australian public- and private-sector context (Commonwealth Procurement Rules, Privacy Act, APRA/ACSC) | Statutory validator rules change |
| A6 | Logo is monochrome slate/silver; the **accent colour is proposed** (not in logo) | Accent is a one-line theme change |
| A7 | Voice interaction is shown as "Coming soon"; text achieves full parity | Browser speech API spike added (small) |
| A8 | Requirement IDs in the *Functional* tab are authoritative (the register's own RTM tab uses incompatible IDs) | Mapping table needed |
| A9 | Draft status of all register requirements means none is client-signed-off; POC may expose changes | – |

### 7.2 Risks
| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R1 | Scope explosion: 184 FRs vs a skeleton-first POC | H | H | Tiering (W/S/D), MoSCoW, ≤3 working functions per module, gate before deepening |
| R2 | Register conflicts (SMS vs TOTP MFA, email-approve vs mandatory SSO, 99.9 vs 99.99%, late-bid override vs lockout) cause rework | H | M | Open-question list (§8); POC implements the safer reading, flags it in UI |
| R3 | Mock AI mistaken for the real thing in demo | M | H | Visible "Simulated AI" badge; Phase notes say no LLM validation performed |
| R4 | Missing quantitative NFR targets → unverifiable acceptance | H | M | Proposed targets above, flagged TBC |
| R5 | Probity/COI rules are subtle (hidden scoring, SoD) – easy to leak data via an API | M | H | Authorisation at API layer + tests per AC; no pricing in technical-evaluator serialisers |
| R6 | Accessibility regressions with dark mode/responsive | M | M | axe in CI; contrast tokens verified (see Tech Spec §11) |
| R7 | Windows dev environment (no LibreOffice, no `gh`) limits doc rendering/repo creation | L | L | Markdown/Mermaid deliverables; repo creation needs the owner |
| R8 | Unverified source cross-references (BRS/DD sections not supplied) | M | L | Treated as informational |

### 7.3 Dependencies
Client confirmation of open questions; named stakeholders (register lists all as `[TBC]`); confirmation of accent colour/fonts; hosting target (AWS account) only for deployment gate; template and clause samples (can be synthetic).

---

## 8.0 Decisions recorded (2026-10-02, owner)
| Q | Decision |
|---|---|
| Q-01 | W/S/D tier split **approved** as drafted |
| Q-02 | Late bids: **hard lockout, no admin override** |
| Q-06 | Accent `#4254C5` and fonts (Plus Jakarta Sans + Inter) **approved** |
| Q-11 | "Intutive" was a typo; folder renamed to `IntuitiveFusionPOC` |
| Q-10 | Remote: https://github.com/dilipchand-bpp/IntuitiveFusionPoC (exists, empty) |
Q-03, Q-04, Q-05, Q-07, Q-08, Q-09 not yet answered; their stated defaults stand.

## 8. Open questions and decisions needed

**Blocking for Phase 2 (need a decision):**
1. **Q-01 Tier split** – approve the W/S/D tiering in [02-RTM.md](02-RTM.md), or nominate different "working" functions per module?
2. **Q-02 Late bids** – FR-0165 locks out at close; the Detailed Design allows admin override of a late tender (register ref FR-041, old numbering). POC default: **no override** (lockout). OK?
3. **Q-03 Approve-from-email** – NFR-U05 (approve via emailed link without sign-in) conflicts with SEC-A04 (mandatory SSO/device auth). POC default: **link opens the app and requires (mock) sign-in**. OK?
4. **Q-04 Availability** – 99.9% (BRS) vs 99.99% (Technical tab). Design to 99.9% unless told otherwise.
5. **Q-05 Accessibility standard** – confirm WCAG 2.1 AA (or 2.2 AA).
6. **Q-06 Accent colour/fonts** – logo is monochrome. Proposed accent indigo `#4254C5`; fonts Inter (UI) + Source Serif 4 or "Plus Jakarta Sans" for headings? (Tech Spec proposes Inter + Plus Jakarta Sans.)
7. **Q-07 ID scheme** – confirm Functional-tab IDs as authoritative, and approve assigning IDs FR-X01…X06 to the six unnumbered rows.

**Non-blocking (carried from the register's own open items):** voice intake at MVP vs phased (FR-0005 query); SMS as alert channel; dual-witness decryption and insurance-OCR scope; multi-currency vs FX out-of-scope; geospatial supplier view vs risk scoring out-of-scope; native mobile vs responsive web; RTO/RPO; retention periods; browser baseline; Privacy-Act breach-notification scope; IRAP scope; enterprise-hosted storage; finance-only bank-detail segment; AI adversarial-input controls; hard- vs soft-cap budget behaviour (FR-0055); who the named stakeholders are (all `[TBC]`).

**Other questions for the owner (answer or accept defaults):**
- **Q-08** Multi-tenancy: demo one tenant (default) or show two tenants with different delegations?
- **Q-09** Seed-data theme: use the deck's example ("facilities cleaning, three-year term") plus a government-style IT services tender and a low-value self-service purchase? (default yes)
- **Q-10** Where should the git repository live/what is its GitHub remote? (A repo is not created until you say so.)
- **Q-11** Is the product name "Intuitive Fusion" (as in the brief) rather than "Intutive/Intuitive" as in the folder name `IntutiveFusionPOC`? (Docs use *Intuitive Fusion*.)

---

## 9. Phase 1 test results (requirements verification)

Per the brief, Phase 1 testing is completeness / clarity / testability / traceability. What was **actually run** and found:

| # | Test | Method | Expected | Actual | Result |
|---|---|---|---|---|---|
| T1.1 | Source ingestion | Parsed all 9 register sheets, 13 deck slides, docx programmatically | All read, no truncation | 184 FR rows, 54 NFR, 65 SEC, 22 stakeholders, 13 slides, docx text recovered | Pass |
| T1.2 | RTM coverage – requirements → story | Script (`_work/build_docs.py`) over 312 requirements | 100% have ≥1 story | 312 / 312 | Pass |
| T1.3 | RTM coverage – story → requirement | Same script | No orphan stories | 68 / 68 traced | Pass |
| T1.4 | Test-case allocation | Script | Every requirement has a TC ID | 312 / 312 | Pass |
| T1.5 | Testability of stories | Check every story has ≥1 G/W/T | 100% | 68 / 68 stories, 78 criteria | Pass |
| T1.6 | Register completeness | Scripted scan for blank IDs/descriptions | None | **6 rows without ID, 2 blank descriptions (FR-0090, FR-X05), 1 requirement written as a question (FR-0055), ID-scheme mismatch with register RTM tab** | **Defects logged (register, not this document)** |
| T1.7 | Ambiguity review | Manual read-through of NFRs | Numeric targets for each | 11 NFRs lack numbers in source (P06, SC04, CA03/04, DR02, U06, C08, …) – proposals made in §4 | Findings → open questions |
| T1.8 | Conflict scan | Manual | None | 5 internal conflicts (§8 Q-02…Q-04, scope list, 99.9 vs 99.99) | Findings → open questions |
| T1.9 | Stakeholder / peer review | – | Sign-off | **Not performed** (no reviewers; stakeholders `[TBC]`) | Pending your review |

**Defects found:** 9 register data-quality items (listed in RTM §2). **None fixed in the source workbook** — the register is the client's/BA's document; they are recorded for them.

**Exit criteria status:** "Every requirement unambiguous, testable and traced; stakeholders sign off." → Traced ✔, testable at story level ✔, unambiguous ✘ for the 11 un-numbered NFRs and 5 conflicts pending your answers, sign-off pending.

---

## 10. What I need from you to proceed
1. Approve (or amend) this document, the stories and the RTM.
2. Answer or accept the defaults for **Q-01…Q-11** (defaults noted inline).
3. Confirm I should continue straight into the Phase 2–4 documents (as you instructed: documents first, **no code** until all are created). The following Phase 2, 3 and 4 documents have been drafted on the stated defaults so that you can review the whole set together; if you change an answer above, they will be revised before any build starts.
