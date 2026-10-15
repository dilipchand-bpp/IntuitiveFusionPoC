# Ask: page-aware help and Copilot guidance (evidence)

Owner request (verbatim): "For Ask AI, Change it to 'Ask' and this should provide all details page specific and also entire application. Like if in Procurement Copilot work if there is any message to do something then where and what to be done it should provide steps if agent is not able to fix it."

All answers are fixed rules (engine label `rules-simulated-v1`, shown as SIMULATED with the AI badge). No model, no network call, synthetic data, no secrets. The swap point is described at the end.

## What was built

| Owner ask | What it does now |
| --- | --- |
| Rename | The floating "Ask AI" is "Ask" everywhere a person sees it: the button, the panel title and its accessible name, the content-safety source label ("Ask question") and the retention note ("The Ask box answers and stores nothing"). Test ids (`ask-ai-button`, `ask-ai-panel`) are unchanged so existing specs keep working. The Demo Guide wording is out of scope. |
| Page specific | The panel sends the current page context with every question: the route path and, where the path carries one, the record id (request, plan, tender, evaluation, contract, supplier, Copilot run) plus a waiting card id when it was opened from one. The API works the record type out again from the path and never trusts a claimed type. The panel shows "Asking about: <page>" and offers questions that fit the page. |
| What is this page / what can I do here | A page guide in `packages/shared/src/page-guide.ts`: one entry per screen (purpose, what you can do and which actions are limited to which roles, the next lifecycle step, links). Who may open the page comes from the route rules in `access.ts`, so the guide cannot disagree with the guard. |
| Whole application "how do I" | `modules/assistant/howto.ts`: 31 numbered procedures (create a request, take it, build and submit a plan, approve a plan, risk sign-off, create and publish a tender, permission to publish, respond as a supplier, open sealed bids, set up an evaluation, declare a conflict, score, consensus, report, award, draft, review and sign a contract, invoices, variations, import data, use OCR, change settings, users and roles, delegations, run the Copilot, draft with AI, reports, audit trail, MFA). Each has steps with links, the roles who can do it and the next step. A role that cannot do it is told "<title> is done by <roles>. You hold <roles>, so you cannot do it yourself" and still sees the steps. |
| Meaning of a status or field | `modules/assistant/meanings.ts`: 32 statuses, gates and fields in words. |
| Facts from the record on screen | The API reads the record through the normal routes with the caller's own cookie (`GET /requests/:id` and `/progress`, `/plans`, `/tenders/:id`, `/evaluations/:id`, `/contracts/:id/signing`, `/suppliers/:id`, `/copilot/runs/:id`). A refusal or a 404 (another organisation, another requester's request, a role the route refuses, a supplier asking about staff records) gives one wording: "not visible to you". Nothing is read that the page itself could not show. The contract facts use the read-only signing route because the contract route records that a signatory opened it. |
| Citations | Every answer carries a "From:" line: page guide, how-to guide, policy, this request / plan / tender / evaluation / contract (read as you), Copilot guidance catalogue, your own data. |
| Copilot waiting for a person | `modules/cpagent/guidance.ts` is a catalogue of every gate kind (23) and problem code (12) with where to go, numbered steps, who must do it and what happens next. Ask turns an open gate into: the link to the page, the numbered steps, "Who must do it" (the people named on the gate, and whether that includes you), "what happens next", and for a problem the agent could not repair, "Why it stopped" and "What the Copilot tried". Steps end with "press Advance now" where relevant. |
| The agent's own messages | The gate event in the live feed, the problem event, the notification sent to each person asked, and the action item all end with "What to do: ...". The run detail returns a `whatToDo` object for each gate and each problem; `/action-items` carries `whatToDo`, `runId` and `gateId` for Copilot items. |
| Run page | Each waiting card shows the What to do line and a "What do I do?" button that opens Ask on that card. An escalated problem lists why it stopped and the fix as numbered steps. "Waiting for you" (`/app/actions`) shows the same line and button for Copilot items. |

## Guarding against drift

* `apps/web/src/lib/page-guide.test.ts` walks every `page.tsx` of the web app, every navigation item and every roadmap area. A new page, menu item or roadmap area without a guide entry fails; so does a stale entry, a link to an unknown page, or an action limited to a role that cannot open the page.
* `apps/api/src/modules/cpagent/guidance.test.ts` reads the agent's source. A gate kind, a problem code or a gate key with no entry fails; the gate kinds are also a closed list in `guidance.ts`.
* The how-to test checks that every link in a how-to is a page the guide knows.

## Tests

Counts are from runs on 15 Oct 2026.

* API, `assistant/ask.test.ts`: 21 tests (page context, page answers for several pages and roles, role refusal wording, how-to steps, record facts, visibility and tenant isolation, supplier refusal, Copilot gates at plan approval, plan submit and a problem the agent could not repair, a person a gate is waiting for asking on someone else's run page, the What to do line in run data, action items and the feed).
* API, `cpagent/guidance.test.ts`: 6 tests (coverage of kinds, codes and keys; steps, who, next; code derivation).
* API, `assistant/assistant.test.ts` (existing): 9 tests still pass. The assistant, cpagent, b9, authorisation matrix and roadmap suites together: 13 files, 161 tests passed. A wider regression (authz, app, b11priv, b11audit access, b11enc): 19 files, 191 tests passed.
* Web, `lib/page-guide.test.ts`: 8 tests. `shell/ask-ai.test.tsx`: 8 tests (renamed label, context sent, record id, event from a waiting card, numbered steps and the "From" line). `b9/action-list.test.tsx`: 2 tests. All web and shared unit tests: 13 files, 411 tests passed.
* Playwright, `e2e/ask.spec.ts`: 5 tests passed (a request page, role refusal, a Copilot run waiting at plan approval opened with "What do I do?", a 375 px phone with no sideways scroll, and the action list; axe scans with the panel open). Run with the other Ask and Copilot specs: `x01`, `bcp-agent`, `b10d` 16 passed; the screenshot specs `shell`, `intake`, `plan`, `ui-kit` 118 passed with no snapshot changed (none shows the Ask button), so no snapshot was refreshed.
* OpenAPI: `AssistantContext` added to the chat request (`_work/openapi_ext.py`, regenerated with `_work/gen_openapi.py`); the authorisation matrix test still passes.

## Honest limits

* It is rules, not a language model. A question that does not match a rule gets the "I did not catch that" answer with things to try. The how-to matching is by keywords, so an unusual wording can miss.
* Record facts cover request, plan, tender, evaluation, contract, supplier and Copilot run. Plan facts use the plans list (status only); a tender, an evaluation and a supplier answer from what their routes return to that role, so a fact the route does not return is not given.
* "Who it is waiting for" on a request is worked out from the progress milestones, and is deliberately general (it points to the plan or tender page for the precise state).
* The gate guidance names buttons as they are labelled today. If a button is renamed the catalogue text must be changed; nothing checks button labels against the screens.
* A person who is not the owner of a Copilot run and not a manager (procurement, executive, administrator) cannot ask about that run; they get a list of what is waiting for them through "What is the Copilot waiting for me to do?" instead.
* Ask never carries out an action for the person except the existing "mark my notifications as read"; it only says where to go and what to do.

## Swap point

The page guide, the how-to catalogue, the meanings, the Copilot guidance catalogue and the record readers are rules and text. A language model replaces only the wording step. It must be handed the matching guide entry, how-to entry and the record facts read through the person's own session, keep the "From:" citation and the role refusal, and keep the links filtered by `canOpen`. See docs/swap-points.md.
