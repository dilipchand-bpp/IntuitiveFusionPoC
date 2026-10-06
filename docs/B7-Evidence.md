# Roadmap batch B7 - evidence

**Batch:** B7, conversational assistant. One requirement delivered (list: `_work/delivered.json`, key `B7`; cited by an automated test): FR-X01. It was a deferred (tier D) requirement and was built at the owner's request.

## What was built
| Area | Requirement | Result |
| --- | --- | --- |
| **Ask AI on every page** | FR-X01 | A button at the bottom right of every signed-in page (staff and supplier portals) opens a chat. The conversation is kept for the browser session, can be cleared, closes with Escape, and works by keyboard. |
| **Answers** | FR-X01 | The workflow in six phases; what each role does; who can approve a plan, publish, decide an evaluation, sign a contract, override an invoice; plain-language definitions (three-way match, delegation of authority, separation of duties, probity, conflict of interest, variation, spend ceiling); what the current page is for. |
| **Insights** | FR-X01 | "What needs my attention?" and "What is my approval limit?" are answered from the person's own data: plans awaiting approval or risk sign-off, blocked invoices, contracts ending within 90 days, unassigned procurements, draft requests, unread notifications. Figures follow the same visibility rules as the reports. |
| **Suggestions** | FR-X01 | "Anything I should fix?" lists stalled procurements, blocked requests, procurements with no manager, contracts with no owner, contracts about to end, blocked invoices, suppliers with expired insurance or a sanctions match, each with a link to the page that fixes it. |
| **Instructions** | FR-X01 | "Take me to invoices" opens the page (only if the person's role may open it); "mark all my notifications as read" does it and records it in the audit trail; a report question such as "contracts expiring in 90 days" opens the Ask for a report page already run. |

## Limits, stated plainly
- The assistant is a fixed set of rules, labelled `rules-simulated-v1`. It does not understand free text beyond the questions above; when it does not understand it says so and offers things to try. The swap point for a real model is `answer` in `apps/api/src/modules/assistant/rules.ts`.
- It changes data in one case only (marking notifications read). Approvals, edits and other changes are done on the pages, where the portal's own checks apply.
- Suppliers get general answers only, never portal data.

## Verification
See the commit for this batch: `assistant.test.ts` (API, 9 tests) and `e2e/x01.spec.ts` (browser).
