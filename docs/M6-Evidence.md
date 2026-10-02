# M6 – Request intake & assistant slice: evidence report

**Date:** 2026-10-02 · **DoD (plan §3 M6):** US-INT-01/02/03/05 ACs pass as automated tests; audit events exist for every AI proposal and acceptance.
**Working functions delivered (per the approved tiering):** (1) chat creates and pre-fills a request, (2) complexity score and governance gates, (3) request list and detail. Also built: edit-in-place, submit with budget check and notification (US-INT-04 / 06 at stub depth).

## Built
- **Simulated assistant** behind the `AiProvider` interface (`mock-rules-v1`, deterministic): reads value ("$1.2M", "640 thousand"), term ("three-year", "18 months"), category (10 categories with UNSPSC codes), business unit, offshore/sensitive hints; asks follow-up questions in a fixed order; drafts background/deliverables once the category is known; never overwrites a person's text; always labelled "Simulated AI".
- **Complexity score** (Low/Medium/High/Critical) from value, category criticality, supply location and data sensitivity, with plain-language reasons; **governance gates** (independent risk sign-off + upfront COI for High/Critical, IT endorsement, legal review ≥ $250k, manual-budget and budget-escalation gates).
- **Budget check** through the mock finance adapter: hard cap blocks (422 `BUDGET_EXCEEDED`, refusal audited), soft cap escalates, outage/unknown unit falls back to a manual-confirmation gate.
- **API (all real now):** `POST/GET /assistant/conversations`, `POST .../messages`, `GET/POST /requests`, `GET/PATCH /requests/{id}`, `POST /requests/{id}/submit` (OpenAPI regenerated, 70 operations). Requests are visible to their owner (requesters) or the tenant (other permitted roles); an invisible request is a 404, never a 403.
- **Web:** `/app/requests` (list, search, status filter, empty states), `/app/requests/new` (chat + live draft panel, "Voice: coming soon" disabled), `/app/requests/{id}` (detail, edit fields, submit with confirmation, error handling for missing info / budget / version conflict).
- Request numbers `PR-YYYY-NNNN` sequential per tenant; submit notifies the procurement team; `Idempotency-Key` makes submit retry-safe.

## Tests actually run
| Area | What | Result |
|---|---|---|
| Domain (36 + 12) | money/term/unit parsing incl. boundary and negative cases; "IT services" is not the IT unit; lower-case "facilities cleaning" is not the Facilities unit; complexity boundaries at 250k/1M/5M, modifiers, cap at Critical; gates; intake-mode threshold; AI determinism and "never overwrite"; ERP outcomes | Pass |
| API integration (30) | deck example creates a pre-filled AI-drafted request; conversation readable only by its owner; **every AI proposal audited with field-level diff**; **pasted instructions change nothing**; voice -> 422, empty/oversize -> 400; question sequence and re-ask on misunderstanding; HIGH/CRITICAL/LOW scenarios; threshold change flips intake mode; manual edit, validation, version conflict; ownership (404); list scoping, filters, paging; reader/non-reader roles; submit (phase, budget, notification, audit); hard cap, soft cap, outage, unknown unit; **idempotent retry notifies once**; sequential unique numbers | Pass |
| Full unit/API/DB suite | `npm run ci` (format, lint, typecheck, build, 20 files) | **292 / 292 pass** |
| Role x operation matrix | regenerated contract (requests/assistant restricted to the roles that need them) | Pass |
| Browser (production build) | **110 / 110 pass**, including 16 new intake tests: list/search/detail, delegate read-only vs evaluator refused, 404, the deck example end to end, answering questions then submitting, disabled submit with explanation, over-budget refusal, manual edit, "continue in chat", injection text, voice disabled / Enter vs Shift+Enter, axe at phone and desktop (list, chat, detail, edit), dark theme, plus all M1-M5 tests | **Pass** |
| Visual | 3 new baselines (chat desktop, chat phone dark, request list/shell chrome); reviewed by eye | Pass |
| Gates | `npm audit --audit-level=high` exit 0; coverage 93% stmts / 85% branches (intake 96%, adapters 90%) | Pass |

## Defects found and fixed during M6
1. **Deadlock:** the budget adapter queried the database from inside the request's transaction; on a single connection that waits forever. Adapters now receive tenant settings from the caller (rule recorded in `docs/swap-points.md`).
2. **Assistant accepted a pasted instruction as a "business unit" answer.** Free text is now accepted only if it is a short phrase (<= 6 words, no sentence punctuation) or a known unit.
3. **"facilities cleaning" was read as the owning Facilities unit.** Units now need a proper name or an explicit cue.
4. Over-budget refusal did not refresh the screen -> status now shows "Over budget".
5. A visual review showed the AI-drafted badge wrapping on every field, the phone header wrapping its wordmark, and a cramped chat box -> shorter badge text (full instruction kept for screen readers), compact logo on phones, composer wraps.
6. **Forms could be submitted before the page was interactive** (a native reload) -> login, forgot-password and chat stay disabled until ready.
7. **Test infrastructure:** end-to-end tests now build and run their own production copy on ports 3100/4100 (previously they shared 3000/4000 with `npm run dev`, which is why your login failed while tests ran); tests that depended on how much data earlier tests had created were made order-independent; a stray `fix_*.py` backslash problem in my edit scripts.

## Not verified / caveats (honest)
- The assistant is **rule-based, not a language model**: it recognises a fixed set of phrasings and categories. Real model quality, latency and guardrails are not validated; the "Simulated AI" label is on every screen that uses it.
- **Voice** is not built (button disabled, API returns 422).
- Gates are **displayed and counted but cannot yet be satisfied** (conflict declarations and risk sign-off arrive with the plan, M7); a submitted request is not blocked by them yet.
- Intake-mode (self-service vs team-led) is computed and shown; the two different user flows are not built.
- Single-currency (AUD); no taxonomy beyond the 10 built-in categories; the budget numbers are demo values in tenant config.
- `README.md` could not be updated this milestone because the file was locked (open in another program); the notes on test ports and M6 status will be added when it is closed.
- GitHub CI runs for M1-M6 remain unobserved by me (private repo, no `gh`). The CI e2e step now also builds the web app (about a minute longer).

## Gate
M6 complete. Next: **M7 - Procurement plan slice** (auto-populated plan, instruction-based edit with undo, COI declaration and routing, delegate approval with lock, reopen).
