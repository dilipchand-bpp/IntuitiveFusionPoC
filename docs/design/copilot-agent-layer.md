# Procurement Copilot: agent layer (batch BCP)

Approved by the owner on 9 Oct 2026, to be built before B12. Seven requirements, numbered CP-01 to CP-07. They are additions to the requirements register (not in the RTM), so they are tracked in this document, in `docs/BCP-Evidence.md` and by tests that cite the ids; the roadmap page revision (later) will list them.

All "AI" in this layer is **simulated and rules-based** (engine label `rules-simulated-v1`, SIMULATED on screen), in line with the standing rules. Every outside dependency (OCR service, language model, speech) sits behind an adapter with a documented swap point in `docs/swap-points.md` (section "Procurement Copilot (BCP)"). No secrets, no network calls at run time, synthetic data only.

## Requirements

| Id | Requirement |
| --- | --- |
| CP-01 | An agent can carry a procurement from the first request to completion. The only human intervention is where a gate approval is required. |
| CP-02 | The agent resolves problems on the way (bounded self-repair), and raises what it cannot resolve to a named person with what it tried. |
| CP-03 | Progress is visible: a live run page with a stage timeline, step log, current action, who the run is waiting for, and pause/cancel. |
| CP-04 | From voice or text the AI pre-populates requests, plans and tender fields, and creates job specifications (scopes of work) and documents. |
| CP-05 | Content adjusts dynamically to the user's plain-language instructions (before and after view, undo). |
| CP-06 | Multiple specialist agents (orchestrator, compliance, workflow, document filling, contract data) each with their own tools and a visible hand-off. |
| CP-07 | OCR contract ingestion: extract contract data and clauses for reporting and reminders; import historical data to speed implementation. |

## Principles (all four modules follow these)

1. **Same rules as a person.** The agent acts as the user who started the run. It calls the application's own HTTP routes through `app.inject` with that user's session, so the role guards, segregation of duties, probity rules, audit trail and visibility rules apply unchanged. It can never do what its user cannot do. Every call is audited with the actor shown as the user and the actor label "Procurement Copilot".
2. **Gates stay human.** The agent never approves. It stops (`WAITING_GATE`) at: plan approval, award approval, contract signature, panel scoring and conflict declarations, dual-witness opening, anything routed to a delegate above the author's limit, probity decisions, and any action the guards refuse because the user lacks the role. It creates an action item for the person who must act (appears in `/app/actions` and the Waiting-for-you count) and resumes by itself when the state changes.
3. **State-driven and idempotent.** A run does not hold a script position. Each tick reads the current state of the procurement (stage, plan status, tender status, and so on), decides the next step, performs it, and records it. Re-running a tick never repeats a completed step. Ticks run on a timer in the API (interval from config, off in tests) and on demand (`POST /copilot/runs/:id/advance`).
4. **Bounded self-repair.** Each step has a validator and an ordered list of repairs (fill a missing field from the request context, add a missing mandatory clause, attach a missing document, re-run a failed compliance check with the suggested remediation, retry a transient failure with backoff). At most 3 attempts per step. If it still fails the run moves to `NEEDS_HUMAN` with the attempts shown and an action item for the right person. Never an infinite loop.
5. **Suppliers.** Real supplier actions stay with suppliers. For demonstration only, the user can press "Simulate supplier responses", which submits labelled SIMULATED bids through the supplier-portal routes as seeded demo supplier contacts. It is never automatic.
6. **Visible and honest.** Everything the agent decided is shown with a reason and the rule that fired. Nothing is described as done unless the step's result was checked.
7. **Conventions.** Tenant-scoped tables with row-level security like the existing ones; new numbered migration plus `.down.sql` (never edit an applied migration); own schema file; routes registered through the same `reg`/`guard` helpers; roles in every route match guards (authorisation matrix test); supplier-only operations tagged `SupplierPortal`; OpenAPI blocks appended in `_work/openapi_cpX.py` and the document regenerated; every built id cited in a test; UI uses the single theme file and the shared components, works on a phone, passes the axe checks, and has Playwright specs.

## Module split (owners are separate agents; shared files only get small additive edits)

| Module | Migration | Schema file | API module | Web | OpenAPI block | Ids |
| --- | --- | --- | --- | --- | --- | --- |
| Agent runtime and specialists | 0028 | `schema-cpa.ts` | `modules/cpagent` | `/app/copilot`, `components/copilot/` | `openapi_cpa.py` | CP-01, CP-02, CP-03, CP-06 |
| Drafting from voice or text | 0029 | `schema-cpb.ts` | `modules/cpdraft` | `components/copilot/draft-*` plus panels on request, plan and tender pages | `openapi_cpb.py` | CP-04, CP-05 |
| Contract OCR and extraction | 0030 | `schema-cpc.ts` | `modules/cpocr` | `/app/contracts/ingest`, `components/copilot/ocr-*` | `openapi_cpc.py` | CP-07 (OCR and extraction) |
| Historical import | 0031 | `schema-cpd.ts` | `modules/cphist` | extends `/admin/migration`, `components/copilot/hist-*` | `openapi_cpd.py` | CP-07 (import) |

## Route contract between modules (the agent runtime calls these as tools)

Paths are under the API prefix (`/api/v1`). Bodies are JSON unless stated. Each module implements exactly these, so the runtime can be written in parallel. Extra routes are allowed.

### Agent runtime (cpagent)
- `POST /copilot/runs` `{ text, procurementId?, mode: 'FULL'|'ASSISTED', autoAdvance?: boolean }` start a run (from text; the web sends dictated text the same way). Creates the request through the drafting module when there is no procurement yet. Returns the run.
- `GET /copilot/runs` (mine, or all for managers), `GET /copilot/runs/:id` (run, steps, gates, agents, hand-offs), `GET /copilot/runs/:id/events` (cursor `?after=` for live polling).
- `POST /copilot/runs/:id/advance`, `/pause`, `/resume`, `/cancel`, `POST /copilot/runs/:id/simulate-suppliers`.
- `GET /copilot/agents` (the specialist registry with tools and what each may and may not do), `GET /copilot/runs/:id/problems` (issues found, repairs tried, outcome).
- `GET /copilot/summary` for the dashboard card (runs active, waiting for a person, repaired, completed).

### Drafting (cpdraft)
- `POST /copilot/draft` `{ kind: 'REQUEST'|'PLAN'|'JOB_SPEC'|'TENDER_DOC'|'CONTRACT_DRAFT'|'EVAL_CRITERIA', text, procurementId?, source: 'TEXT'|'VOICE' }` returns `{ id, kind, fields, content, sources, engine: 'rules-simulated-v1', revision: 1 }`.
- `POST /copilot/draft/:id/adjust` `{ instruction }` applies a plain-language change ("make price 60% and quality 40%", "add a data-sovereignty requirement", "shorten the scope", "change the budget to 450k") and returns the new revision with a field-level before/after diff. `POST /copilot/draft/:id/undo`. `GET /copilot/draft/:id` and `/revisions`.
- `POST /copilot/draft/:id/apply` writes the draft into the real record (request fields, plan sections, a document in the repository) through the normal routes as the acting user, and returns what changed. Refused with the usual error if the user's role or the record's state does not allow it.
- Pre-population: `POST /copilot/prepopulate` `{ procurementId, stage: 'REQUEST'|'PLAN'|'TENDER' , text? }` returns suggested values per field with a reason and the source (in-house history, catalogue, text).

### Contract OCR (cpocr)
- `POST /contract-ingest/uploads` (multipart: one or more files: PDF, PNG, JPG, TIFF, or a zip of them) creates an ingest batch, runs the OCR engine, extraction and clause detection per document. Returns the batch.
- `GET /contract-ingest/batches`, `GET /contract-ingest/batches/:id`, `GET /contract-ingest/documents/:id` (text, pages, extracted fields with confidence and the text span they came from, clauses found).
- `POST /contract-ingest/documents/:id/review` `{ corrections, accept }` human review for low-confidence fields; `POST /contract-ingest/documents/:id/commit` creates or updates the contract record (with key dates, value, parties, clauses) and the reminders.
- `GET /contract-ingest/clause-library` and `PUT` for managers (clause types, keywords, the standard wording to compare against), `GET /contract-ingest/report` (clause and obligation reporting across ingested contracts: renewals due, notice periods, liability caps, missing clauses).

### Historical import (cphist)
- Extends the existing `migration` module (CSV, FR-0655 to FR-0675) with: spreadsheet files (`.xlsx` as well as `.csv`), saved column mappings with auto-suggested mapping, a dry run with row-level validation and duplicate detection (against suppliers and contracts), commit with a per-batch rollback, and entity types contracts, suppliers, historical procurements (spend), and catalogue prices.
- `POST /history-import/uploads` (multipart), `GET /history-import/batches/:id`, `PUT /history-import/batches/:id/mapping`, `POST /history-import/batches/:id/dry-run`, `POST /history-import/batches/:id/commit`, `POST /history-import/batches/:id/rollback`, `GET /history-import/templates/:entity` (a downloadable template).
- A batch of historical contract files (zip of PDFs) is handed to the OCR module's upload route and the results come back as contract records in the same batch report.

## Specialist agents (CP-06), what each owns

| Agent | Purpose | Tools it uses |
| --- | --- | --- |
| Orchestrator | reads state, picks the next step, hands off, raises gates and problems | the run store, the other agents |
| Intake and drafting | pre-populates and drafts from text/voice, adjusts on request | `/copilot/draft*`, `/copilot/prepopulate`, request routes |
| Compliance | runs the compliance checks (probity, sanctions and finance checks, statutory windows, delegation limits, mandatory clauses, privacy and sensitive data), explains and proposes remediation | the existing compliance and check routes |
| Workflow | moves the procurement through plan, tender, evaluation set-up, award, contract; computes who must approve | the existing lifecycle routes, approval routing, action items |
| Document filling | fills plan sections, tender documents, award letters, contract drafts from the record | `/copilot/draft*`, document and repository routes |
| Contract data | ingests and reads contracts, extracts data and clauses, keeps key dates and reminders current | `/contract-ingest/*`, contract record routes |

## Progress display (CP-03)

`/app/copilot` lists runs with a status chip (RUNNING, WAITING_GATE, NEEDS_HUMAN, PAUSED, COMPLETED, FAILED, CANCELLED). The run page shows: the stage timeline (request, plan, tender, evaluation, award, contract) with the current stage highlighted; a live activity feed (what the agent just did, which agent, how long); "Waiting for" cards naming the person and the action, with a link; a "Problems and repairs" panel; pause, resume, cancel, advance now. It polls the events route every 3 seconds. The dashboard shows a Copilot summary card. Ask AI offers "Run this for me" for a request typed or dictated.

## Out of scope and honest limits (to be restated in the evidence document)

- The language understanding, drafting and OCR are rules-based simulations. Free-form instructions outside the supported patterns are answered with "I could not apply that" and examples, not guessed.
- OCR reads the text layer of PDFs for real; scanned images and photographs go through a simulated recognition engine that reads text from synthetic sample files. A real OCR service (for example a cloud document-intelligence service) is the swap point.
- The agent does not replace evaluators, delegates or signatories, and does not act as suppliers except for the labelled demonstration button.
