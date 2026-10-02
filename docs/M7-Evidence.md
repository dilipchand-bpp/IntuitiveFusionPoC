# M7 – Procurement plan slice: evidence report

**Date:** 2026-10-03 · **DoD (plan §3 M7):** US-PLN-01…05 acceptance criteria pass as automated tests; a locked plan returns 423 on edit; a requester cannot reopen.
**Working functions delivered (per the approved tiering):** (1) auto-populated plan from the request, (2) instruction-based editing with undo, (3) delegate approval on mobile with stamp and lock; plus conflict-of-interest declaration and routing, independent risk sign-off, and reopening with a reason.

## Built
- **Plan drafting** (simulated, deterministic): 12 sections (background, objectives, requirements, deliverables, milestones, risks, evaluation and steering committees, approval delegate, consultations, due diligence, timeline) drafted from the request; the requester's own wording is kept; every section marked AI-drafted. Seeded plans created before this feature are populated on first view.
- **Plain-language editing** (`change paragraph 3 of the background to …`, `add to the risks: …`, `remove paragraph 2 of …`, `set the timeline to …`): exactly one paragraph changes; one-step **undo** restores text and authorship marker; if the instruction is unclear nothing changes and a hint says how to rephrase; direct editing with version checks also available.
- **State machine:** DRAFT → AWAITING_SIGNOFF → AWAITING_APPROVAL → APPROVED_LOCKED → (reopen) REOPENED / REJECTED, enforced server-side; locked or submitted plans refuse edits (423 / 409).
- **Governance:** conflict-of-interest declarations (none / disclosed), routed to the delegate (or executive), decided as immaterial / manageable / material, never by the declarant; **independent risk sign-off** by the risk officer; **delegation of authority** checked at approval (delegate AUD 250k, executive AUD 10M) with the limit named in the refusal; requester cannot approve their own request.
- **Approval record:** immutable approval rows with a stamp (who, role, time), superseded (not deleted) on reopen; notifications to approvers, procurement and requester at each step.
- **API (all real):** `GET /plans`, `GET /requests/{id}/plan`, `PUT /plans/{id}/fields/{key}`, `POST …/instructions`, `…/instructions/undo`, `…/submit-for-approval`, `…/decision`, `…/reopen`, `…/coi`, `POST /coi/{id}/decision` (OpenAPI now 71 operations; role rules updated: executive may decide, administrators and suppliers cannot read plans).
- **Web:** `/app/plans` (list), `/app/plans/{request}` (workspace: key points, decision panel, required checks, conflicts, instruction box with undo, numbered paragraphs, submit / reopen), `/app/approvals` (delegate queue). On a phone the key points and the decision come before the long plan detail.

## Tests actually run
| Area | What | Result |
|---|---|---|
| Domain (17) | paragraph splitting; field lookup by everyday names; instruction parsing (replace / add / remove / set, quotes, field-first wording); never guesses (missing field, paragraph or wording gives a hint); out-of-range paragraph; drafting fills all sections, keeps requester text, follows value and complexity, deterministic; one-screen summary | Pass |
| API integration (28) | plan created once and idempotently; audited population; visibility (own only, 404 vs 403); list with NOT_STARTED; seeded locked plan populated; **single-paragraph change leaves the others byte-identical, field-level audit, exact undo incl. authorship**; undo token single-use and replaced by the next change; add / remove; fallback hints change nothing; voice 422; delegates cannot edit; pasted instructions are only text; direct edit with stale version, empty mandatory, bad paragraph; **approve within limit with stamp, locks, request moves to in-progress**; **423 on every edit path when locked**; **delegation exceeded names the limit, executive approves**; audit records value and limit; reject needs a reason and returns the plan; wrong state / wrong role; incomplete plan refused; **high-value gates in order (conflict declaration → risk sign-off → executive)**; disclosed conflict routed to delegate, own decision refused (SoD), duplicate refused, MATERIAL does not satisfy the gate; risk-officer return; **reopen: only procurement, reason ≥ 10, approvals superseded, history kept, resubmit and re-approve**; notifications; database refuses to delete an approval | Pass |
| Whole unit/API/DB suite | `npm run ci` (format, lint, typecheck, build, 22 files) | **337 / 337 pass** |
| Role x operation matrix | regenerated contract (71 operations x 12 roles + anonymous) | Pass |
| Browser (production build) | 16 new plan tests: list → open → 12 AI-drafted sections with the requester's words kept; request page links to plan; paragraph-3 instruction and undo in the UI; unclear instruction hint; direct edit; **phone approval (key points and decision above the detail, no sideways scroll, axe clean, approve, stamp, edit controls disappear)**; over-limit explanation and executive approval; return needs a reason and can be resubmitted; roles without a part see no controls; **high-value flow end to end across four people**; conflict decided by delegate and not by declarant; reopen with reason, history kept, requester has no Reopen; evaluators/suppliers refused, unknown plan 404; axe at phone and desktop (list, draft, editing, approver, locked) and dark theme | Pass |
| Whole browser suite | all milestones together, production build, one clean run | **128 / 128 pass** |
| Visual | 2 new baselines (plan workspace desktop, approval on a phone) with changing data masked; reviewed by eye | Pass |
| Gates | `npm audit --audit-level=high` exit 0 | Pass |

## Defects found and fixed during M7
1. Test selector ambiguity (`Instruction` matched the form and the field) – fixed.
2. A notification test assumed a fixed unread count that other tests change – now compares against the starting count.
3. Earlier-milestone tests that assumed seed-only data were already made order-independent (M6); the same rule was applied here (all plan tests create their own request).
4. During build: lint and type errors (dynamic imports, unused values, missing `PUT` in the client) – fixed before any test run counted.

## Not verified / caveats (honest)
- **The assistant is rule-based**, not a language model: it understands a fixed set of instruction phrasings and drafts from templates. Quality of real AI drafting and instruction understanding is not tested. "Voice" is not built (button absent, API returns 422).
- **Committee members are text**, not system users: the evaluation committee section names roles, and conflict declarations are made by the people who open the plan. Declarations by named evaluators arrive with the evaluation slice (M9).
- **Consultation gates** (IT endorsement, legal review) are listed in the plan text but have no sign-off flow yet; only the conflict-of-interest and risk gates hold a plan up.
- **Date ripple (US-PLN-06)** is a stub: dates in the milestones and timeline are generated once and are not linked to the tender yet.
- **Single concurrent approver path**: no co-approval or delegation chains, no email links (approval requires signing in).
- The "undo" keeps one step only (the last instruction).
- GitHub CI runs for M1-M7 remain unobserved by me (private repo, no `gh`).

## Gate
M7 complete. Next: **M8 - Tender pack and supplier portal** (tender pack generated from the plan, staged until permission to publish, anonymised Q&A and addenda, supplier invitation / registration, one-tender view, upload and submit, automatic lock at close).
