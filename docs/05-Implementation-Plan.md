# 05 – Step-by-Step Implementation Plan

**Product:** Intuitive Fusion – Procurement Portal (POC)  |  **Phase:** 4  |  **Version:** 0.1 DRAFT  |  **Date:** 2026-10-02
**Inputs:** Requirements, RTM, Technical Specification, Architecture (all drafts awaiting approval)
**Rule:** nothing in this plan starts until you approve it. Phase 5 builds **skeleton first**, then pauses for you to pick modules to deepen.

---

## 1. Approach
Order: **foundation → skeleton → vertical slices per module → hardening → UAT/release**. Each milestone is small enough to review in one sitting, ends with a green pipeline and **evidence** (test report, screenshots, coverage), and is committed behind a gate you approve.

**Estimating basis (assumption):** one engineer pairing with Claude, working days of focused effort; ± 30% until the spikes in M0 finish. Elapsed time depends on your review turnaround (not included). Total ≈ **66 working days** to the skeleton gate (M0-M15, summed from the table), + 2 days docs (M16) + **16 days** hardening/UAT/release (M17-M19) = **~84 days**; with M2 and M13 run in parallel the critical path to the gate is ≈ **59 days**.

> The deep-dive of individual modules (after the skeleton gate) is estimated separately once you choose them; typical figure 5–8 days per module.

## 2. Milestone overview (critical path in **bold**)

| # | Milestone | Effort (d) | Depends on | Req coverage (RTM) |
|---|---|---|---|---|
| **M0** | Decisions, repo & spikes | 3 | Approvals of Phases 1-4 | – |
| **M1** | Scaffold: monorepo, tooling, CI | 3 | M0 | PRM-09, NFR-M02 |
| **M2** | Design system & theme | 4 | M1 | PRM-05/06/07, NFR-U01/06 |
| **M3** | Data layer, seed, audit core | 5 | M1 | SEC-L01/03/04, NFR-CA02 |
| **M4** | Identity (mock), RBAC/ABAC, delegation, guards | 5 | M3 | SEC-A*, SEC-AC*, PRM-02/04 |
| **M5** | App shell, landing, login, dashboard frame, notifications | 5 | M2, M4 | PRM-01/03/06, US-PLT-* |
| **M6** | Intake & Assistant slice | 5 | M5 | US-INT-01/02/03/05 |
| **M7** | Plan slice | 5 | M6 | US-PLN-01…05 |
| **M8** | Tender pack + Supplier portal slice | 6 | M7 | US-TND-01..03, US-SUP-01..04 |
| **M9** | Evaluation slice | 6 | M8 | US-EVL-01..05 |
| **M10** | Contract award & legal slice | 4 | M9 | US-CON-01,03,04 |
| **M11** | Contract management slice | 4 | M10 | US-CMG-01,02,04 |
| **M12** | Reporting & dashboards slice | 3 | M6-M11 data | US-RPT-01,02 |
| **M13** | Admin & configuration slice | 3 | M4 | US-ADM-01,04 |
| **M14** | Stubs sweep: every remaining page/feature "Coming soon" + TODO markers | 3 | M6-M13 | PRM-08, US-FUT-01 |
| **M15** | Skeleton E2E smoke & **GATE 5b** | 2 | M14 | all W-tier |
| — | *You choose modules to deepen* | — | — | — |
| **M16** | Documentation, runbook, demo script | 2 | M15 | – |
| **M17** | Hardening: performance, security, accessibility, cross-browser | 8 | chosen modules | NFR/SEC W-tier |
| **M18** | UAT scripts, regression pack, rollback rehearsal | 5 | M17 | all AT-* |
| **M19** | Release readiness & go-live checklist (POC handover) | 3 | M18 | – |

Parallelism: M2 ∥ M3 after M1; M13 ∥ M7-M12 once M4 done. **Critical path:** M0→M1→M3→M4→M5→M6→M7→M8→M9→M10→M11→M12→M14→M15 ≈ 59 days (M2 and M13 off the path).

## 3. Milestone detail
Format: **Scope · Deliverables · Depends · Effort · Definition of Done (DoD) · Tests that must pass.**

### M0 – Decisions, repo & spikes (3 d)
- **Scope:** record approved answers (Q-01…Q-11); initialise git repo (local; you create the GitHub remote); agree ADRs; run three spikes: (a) score-isolation via service-layer vs Postgres RLS, (b) audit hash-chain throughput, (c) PDF export fidelity.
- **Deliverables:** `docs/adr/0001…0012`, spike notes with measurements, `CLAUDE.md` + `README.md` for the app folder, `.gitignore`, `.env.example`.
- **DoD:** ADRs approved; spike conclusions recorded with numbers; repo initialised with no secrets.
- **Tests:** spike scripts executed, outputs attached; secret-scan on empty repo passes.

### M1 – Scaffold (3 d)
- **Scope:** npm-workspaces monorepo (`apps/web`, `apps/api`, `packages/ui`, `packages/shared`), TypeScript strict, ESLint, Prettier, Vitest, Playwright config, husky/lint-staged, `.env` handling (zod-validated config), Docker compose (Postgres), GitHub Actions CI.
- **Deliverables:** running "hello" web + API, `/health`, CI pipeline (lint, typecheck, unit, build, audit, gitleaks).
- **DoD:** fresh clone → `npm ci && npm run dev` works on Windows and Linux; CI green on PR.
- **Tests:** CI smoke; app-start smoke test; config validation test (missing env fails fast).

### M2 – Design system & theme (4 d)
- **Scope:** `theme.ts` tokens (light/dark), CSS variable emitter, Tailwind binding, self-hosted fonts, components (Button, Input, Select, Textarea, Checkbox, Dialog, Toast, Tabs, Table, Badge, Card, Stepper, Stamp, ComingSoon, AiBadge, EmptyState, Skeleton), layout primitives, favicon + logo assets, storybook-style `/ui-kit` gallery page.
- **DoD:** all components keyboard-operable; rebrand test — change 3 values in `theme.ts` and the whole UI re-themes; contrast table regenerated from tokens by script.
- **Tests:** component tests; axe on gallery (light/dark); contrast script gate (26+ pairs ≥ AA); visual snapshots 3 breakpoints × 2 themes.

### M3 – Data layer, seed, audit core (5 d)
- **Scope:** Drizzle schema + migrations for §3.2 entities, tenant scoping helper, seed script (synthetic Meridian Group), `AuditService` (in-transaction, hash chain, redaction), `Clock`, idempotency middleware.
- **DoD:** `npm run db:reset && db:seed` idempotent; app DB role cannot UPDATE/DELETE `audit_event` (verified by test); hash-chain verifier passes and detects a tampered row.
- **Tests:** unit (audit diff, redaction, hash chain); integration (rollback leaves no audit; tamper detection); migration up/down test.

### M4 – Identity, RBAC/ABAC, delegation (5 d)
- **Scope:** `IdentityProvider` port + mock, session, CSRF, lockout, forgot-password (no enumeration), role guards, ABAC (stream, hierarchy, sensitivity), DelegationService, SoD checks, MFA stub.
- **DoD:** role × endpoint matrix test passes for all current endpoints; route guards on web; IdP swap documented in `docs/swap-points.md`.
- **Tests:** auth unit/integration (lockout after 5, enumeration uniform responses, idle timeout using fake clock); **authorisation matrix** (12 roles × all ops); SoD tests; CSRF tests; ASVS L1 auth checklist subset.

### M5 – App shell, landing, login, dashboard frame (5 d)
- **Scope:** public landing (hero + CTA, features, 4-step how-it-works, illustrations, trust/security/compliance, FAQ accordion, footer w/ contact+legal), login (validation, forgot password, role redirect), shell (sidebar/top nav per module by role, profile menu, notification bell, logout, theme toggle), dashboard KPI frame, 404/403/500 pages, `ComingSoon` routes for all modules.
- **DoD:** every nav item resolves to a non-blank screen; logo in header/landing/login/favicon; responsive at 375/768/1280; Lighthouse a11y ≥ 90 on landing & login.
- **Tests:** component + e2e: US-PLT-01…05 (landing content, login success/failure/lockout, role redirect, guard on `/admin`, logout); axe 0 serious/critical; visual snapshots; "no empty screens" crawler across all routes for all roles.

### M6 – Intake & Assistant slice (5 d)
- **Scope:** `AiProvider` port + deterministic mock (extraction of title/category/value/term/BU, missing-field prompts, "Simulated AI" badge), chat UI, request create/update/submit, complexity score, governance gates, My requests list/detail, budget check mock + hard/soft cap config (stub UI).
- **Working functions:** (1) chat creates & prefills request, (2) complexity score + gates, (3) list/detail.
- **DoD:** US-INT-01/02/03/05 ACs pass as automated tests; audit events exist for every AI proposal and acceptance.
- **Tests:** unit (extractor, complexity matrix with boundary values $1M high-value); API contract; component (chat); e2e happy + missing-field + High-complexity gate path.

### M7 – Plan slice (5 d)
- **Scope:** plan generation from request, field renderer with `aiDrafted` marker, instruction-based edit (field/paragraph) with undo token, COI declaration & routing, approval (delegation limit), lock, reopen with reason, mobile approval view with AI one-screen summary, stamps.
- **Working functions:** (1) auto-populated plan, (2) instruction edit, (3) approve/lock on mobile (+COI, reopen).
- **DoD:** US-PLN-01…05 pass; locked plan returns 423 on edit; Requester cannot reopen.
- **Tests:** unit (paragraph patcher, delegation); API (stale version 409, 423); e2e at 375 px for approval; axe.

### M8 – Tender pack & Supplier portal slice (6 d)
- **Scope:** tender pack generator from request/plan, staged→permission→publish with statutory-window validator, invitations (outbox), supplier self-registration, invite-only vs open access, one-tender view, anonymised Q&A + addendum, upload (allow-list, scan stub), submission receipt, **close-time lock**, separate supplier identity pool.
- **Working functions:** (1) pack generate/stage/publish, (2) Q&A + addendum, (3) supplier register→upload→submit→late-lock.
- **DoD:** US-TND-01…03, US-SUP-01…04 pass; question author never returned by any API/response (test greps serialisers); late submission discarded.
- **Tests:** unit (window validator, close-time with fake clock); API IDOR tests (supplier A cannot see tender B); upload negative cases (type, size, double extension); e2e supplier journey; k6 bid-close burst script drafted.

### M9 – Evaluation slice (6 d)
- **Scope:** evaluation open (record per submitting bidder), panel, COI gate (declare/conflict revokes access, alerts), anonymised vendor display until declared, independent scoring UI (weighted criteria), stream isolation (technical cannot fetch pricing), consensus view with variance flag and rationale, lock, report generation (auto-populated), read-only probity view (stub).
- **Working functions:** (1) COI gate, (2) hidden scoring + isolation, (3) consensus + variance + lock, (4) report generate.
- **DoD:** US-EVL-01…05 pass; **negative tests prove no leakage** via API, export, search; consensus lock refuses unresolved flags.
- **Tests:** unit (variance %, weighted score, ranking); API leakage matrix (every evaluator/stream/phase combination); e2e (two evaluators + chair); audit checks.

### M10 – Contract award & legal slice (4 d)
- **Scope:** draft from template + clause assembly + supplier data, legal edit with change tracking marker, release for signing chain, mock e-signature with stamp, separate signing authority, lock on execution, deviation register (stub), variations (stub).
- **Working functions:** (1) draft, (2) release & sign, (3) lock.
- **DoD:** US-CON-01/03/04 pass; user with sourcing approval but no signing delegation gets `SIGNING_AUTHORITY_INSUFFICIENT`.
- **Tests:** unit (clause assembly mandatory clauses); API (423 after execution); e2e legal→delegate sign.

### M11 – Contract management slice (4 d)
- **Scope:** contract record from executed contract; alert engine (system alerts incl. notice-period rule 90→150; scheduler with `Clock`); alert list; expiring-in-90-days report; Gantt of terms/extensions; custom alert by instruction (stub), spend tracking (stub).
- **Working functions:** (1) record creation, (2) alerts, (3) expiry list/Gantt.
- **DoD:** US-CMG-01/02/04 pass; time-travel test shows alert fires on correct date and is logged once (idempotent).
- **Tests:** unit (date rules incl. month ends/leap years); scheduler integration with fake clock; e2e.

### M12 – Reporting & dashboards slice (3 d)
- **Scope:** role-scoped KPI endpoint & dashboard, procurement table with completion ticks, audit search & CSV export, charts for category spend (seed; stub tier), Gantt/workload (stub).
- **DoD:** US-RPT-01/02 pass; Exec sees portfolio, Requester sees own; export itself audited.
- **Tests:** API scoping matrix; e2e; accessibility of charts (tabular alternative).

### M13 – Admin & configuration slice (3 d)
- **Scope:** users & roles, delegation thresholds edit (audited), workflow library read + simple workflow edit, template library read, admin cannot read bids (negative tests).
- **DoD:** US-ADM-01/04 pass; threshold change affects next approval immediately.
- **Tests:** API; e2e "raise limit then approve"; audit assertions.

### M14 – Stub sweep (3 d)
- **Scope:** every requirement of tier S gets a page/section/API stub returning `ComingSoon` with requirement IDs, plus `// TODO(FR-xxxx)` markers; roadmap page for Won't items; sweep for broken links.
- **DoD:** crawler visits every route per role: no blank page, no 500, each stub lists its requirement IDs; TODO inventory generated (`docs/todo-inventory.md`).
- **Tests:** automated route crawler; link checker; TODO↔RTM reconciliation script (every S-tier ID appears).

### M15 – Skeleton end-to-end smoke & **Gate 5b** (2 d)
- **Scope:** one stitched E2E: request → plan approved → tender published → bid submitted → evaluation → report approved → contract signed → alerts → dashboard/audit; run full suite; produce evidence pack.
- **Deliverable:** *Skeleton Evidence Report*: test results (unit/API/component/E2E counts, pass/fail), coverage, axe/Lighthouse scores, screenshots (3 breakpoints × light/dark), defect list, updated RTM with actual results.
- **DoD / exit:** all W-tier ACs pass; no broken navigation or empty screens; pipeline green. **STOP — you choose the modules to deepen.**

### M16 – Documentation & demo (2 d)
README, architecture-as-built, swap-point guide (IdP, AI, ERP, e-sign), demo script (10-minute path with seeded personas), known limitations.

### M17 – Hardening (8 d)
- **Scope:** deepen chosen modules; performance (k6: smoke 50 users, bid-close burst, soak 30 min); security (Semgrep, `npm audit`, ZAP baseline, auth abuse tests: lockout, enumeration, IDOR, CSRF, session fixation; file-upload attacks); accessibility full pass (axe + manual keyboard + screen-reader spot checks); cross-browser matrix; visual regression approval.
- **DoD / exit:** meets Tech Spec §8; **no critical/high** vulnerabilities; Lighthouse a11y ≥ 90; p95 targets met or deviations documented.
- **Tests:** k6 reports, ZAP report, audit report, axe report, browser matrix results.

### M18 – UAT & regression (5 d)
Scripted UAT from `AT-*` (one script per persona journey J1-J6), regression pack tagged `@regression`, rollback rehearsal (migration down + redeploy previous build), defect triage.
**Exit:** business sign-off recorded; regression green.

### M19 – Release readiness (3 d)
Go-live (demo/hand-over) checklist, environment config, backup/restore rehearsal (local), tag release, handover pack. **Exit:** checklist complete; sponsor acceptance.

### 3.1 Enabler-story allocation (added after check T4.1)
| Story | Delivered in | How verified |
|---|---|---|
| US-NFR-07 CI/CD gates, IaC, observability | M1 (pipeline), M17 (observability checks) | Pipeline run evidence |
| US-NFR-01 Immutable audit | M3 | Tamper-detection and rollback tests |
| US-NFR-02 RBAC/ABAC/SoD | M4 (re-run in every slice) | Role × endpoint matrix |
| US-NFR-11 Accessible/text parity | M2 (components), M5 (shell), M17 (full pass) | axe + keyboard tests |
| US-AIA-02 AI badge + human gate | M6 (badge, edit logging), M7 (approval gate) | Component + e2e tests |

## 4. Test-to-milestone mapping

| Test type | M1 | M2 | M3 | M4 | M5 | M6-M13 | M14 | M15 | M17 | M18 |
|---|---|---|---|---|---|---|---|---|---|---|
| Lint/type/format/audit/secret scan | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| Unit | ● | ● | ● | ● | ● | ● | ● | ● | | |
| API contract (OpenAPI) | | | ● | ● | ● | ● | ● | ● | | ● |
| Authorisation matrix | | | | ● | ● | ● | | ● | ● | ● |
| Component | | ● | | | ● | ● | | | | |
| E2E (Playwright) | smoke | | | | ● | ● per module | crawler | full | | ● |
| Accessibility (axe/Lighthouse) | | ● | | | ● | ● | ● | ● | ● | |
| Visual regression | | ● | | | ● | ○ | | ● | ● | |
| Performance (k6) | | | | | | | | smoke | ● | |
| Security scans (SAST/DAST) | SAST | | | | | SAST | | ● | ● | |
| UAT | | | | | | | | | | ● |

## 5. Quality gates and evidence
- **Per milestone:** DoD checklist, test report, defect list (found/fixed/deferred), updated RTM result column, short demo, and your approval before the next starts.
- **Evidence rule (from the brief):** no statement that something works unless the test output proving it is attached; unverified items listed as such.
- **Defect policy:** severity S1/S2 block the milestone; S3/S4 recorded.
- **Change control:** requirement changes go through the RTM change log; scope changes need your approval.

## 6. Risks to the plan
| Risk | Mitigation |
|---|---|
| Open questions unanswered at M0 | Defaults documented; changes after M3 cost rework (schema) |
| Probity leakage defects | M9 negative-test matrix; spike on RLS in M0 |
| Windows toolchain limits (no LibreOffice; no `gh`) | Docs in Markdown/Mermaid; PDF via Playwright; GitHub remote created by you |
| Estimating error ±30% | Re-baseline after M5 and M9 |
| Mock AI over-trusted | "Simulated AI" badge + limitations section in demo script |
| Gate review latency | Evidence pack designed to be reviewable in 30 minutes |

## 7. Phase 4 test results (plan quality)
| # | Check | Method | Result |
|---|---|---|---|
| T4.1 | Every W-tier story assigned to a milestone | Script expanded the story ranges quoted in §3 and compared with the 41 W-tier stories | First run: 36/41; **5 enabler stories unassigned** (US-AIA-02, US-NFR-01/02/07/11) → allocated in §3.1; no other gaps |
| T4.2 | Every milestone has Scope/DoD/Tests | Manual | 20/20 milestones have all three |
| T4.3 | Effort arithmetic | Summed table: M0-M15 = 66 d; M16-M19 = 18 d; total 84 d | Initial text said 63/79; **corrected in §1** |
| T4.4 | Dependency review | No cycles (graph checked by inspection) | Pass |
| T4.5 | Estimates validated by team | – | **Not performed** |

## 8. What I need from you
1. Approve the plan or reorder/trim milestones (e.g., drop a slice, add a module).
2. Confirm the **skeleton gate** approach: after M15 you choose modules for deepening.
3. Create (or tell me to skip) the GitHub remote for the repo.
