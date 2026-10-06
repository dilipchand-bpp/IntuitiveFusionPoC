# Roadmap batch B8 - evidence

**Batch:** B8, tender, contract and supplier intelligence. 16 requirements delivered, from the deferred (tier D) list at the owner's request (list: `_work/delivered.json`, key `B8`; each is cited by an automated test): FR-0130, FR-0175, FR-0185, FR-0390, FR-0790, FR-0795, FR-0800, FR-0805, FR-0830, SEC-TP02, SEC-TP03, NFR-L01, NFR-L02, NFR-L04, NFR-U05, NFR-U08. The plan for all 107 deferred requirements is `docs/Deferred-Plan.md`.

Also in this batch, at the owner's request:
- **Supplier risk map:** the four seeded suppliers have demonstration locations (Sydney, Newcastle, Brisbane, Perth), and the map is now a real one: OpenStreetMap tiles through Leaflet, with zoom buttons, double-click and pinch zoom, keyboard zoom, a "Show all suppliers" button and a popup for each pin. The scores table beside it carries the same facts for anyone who cannot use a map. The map background needs an internet connection; the pins do not.
- **The logo** in the portal and the supplier portal now opens the landing page, which offers "Back to my portal" to a signed-in person.
- **Sharing the demo** with an outside person: `docs/Share-the-Demo.md` compares the options and gives the steps, and `npm run demo:start` runs the built app in production mode on one port, which was tried here through login, the dashboard and the map.

## What was built
| Area | Requirement | Result |
| --- | --- | --- |
| **Response form** | FR-0130 | Procurement defines a structured response schedule on a staged tender (text, number, choice, yes or no, date; technical or commercial; required or optional). Suppliers answer in the portal, each answer is checked as it is saved, and a bid with a required question blank is refused (`RESPONSE_INCOMPLETE`). After close the answers are compared side by side, with the lowest price marked. Panel members see only the stream they assess. |
| **Dual-witness opening** | FR-0175 | A tender at or above a configurable value (or one marked so when its pack is prepared) stays sealed after it closes. Two different, independent people confirm with their password within a window; neither may have raised the request or sit on the panel. Sealed in the database as well as on screen: the file-access policy refuses bid files until the tender is opened. Evaluation cannot start until it is open. |
| **Insurance certificates** | FR-0185 | A supplier uploads a certificate; the policy limit, expiry, insurer and policy number are read from it and shown back. A tender can require a least cover; a bid is refused if the cover is below it, absent or expired. A certificate that cannot be read is not trusted and the supplier is asked to enter the details by hand. |
| **Legal platform** | FR-0390 | When the customer runs a legal platform (a setting), each new legal matter is raised there. Every outgoing event is kept, so a failed delivery stays visible and can be retried. A signed, idempotent webhook brings the stage and redlines back to the matter and contract. The platform is simulated. |
| **Ratings** | FR-0790 | The enterprise rates a supplier, and a supplier rates the enterprise, once per signed contract on fixed dimensions. Two settings decide whether suppliers see what was said of them and whether staff read what suppliers said. |
| **Duplicate suppliers** | FR-0795 | Pairs of suppliers with the same ABN or bank account, or a similar name (suffixes and punctuation ignored), with the reasons. A person can say a pair is not a duplicate, with a reason. Procurement is told when a new registration looks like an existing supplier. |
| **Risk, resilience and ESG** | FR-0800 | A score out of 100 from eight weighted factors (performance, financial, geopolitical, disruption, compliance, cyber, ESG, dependence on the supplier), with recommendations and alternative suppliers in the same category. Suppliers declare carbon, renewable share, ownership diversity and a modern slavery statement; a modern slavery check can be run on demand. Reports for scores (lowest first) and for diversity and carbon. |
| **Lessons learned** | FR-0805 | Lessons are captured on a procurement. A new procurement is shown lessons from comparable ones (same category, similar size, shared wording), with the reason for each. Closing or cancelling a procurement needs a lesson or a reason for none. |
| **Legal edits** | FR-0830 | In plain language: redact a clause (withheld from everyone but Legal, and from exports), propose a redline (nothing changes until accepted) or insert a clause after a nominated one. A preview shows what would happen. Outside counsel or a supplier's legal team mark up one contract through a one-time link that shows clause wording only; once the contract is released for signature the version is final and the link is read-only. |
| **Counterparty checks** | SEC-TP02, SEC-TP03 | Already enforced by the contract batch (a negotiation past 30 days locks release and signature until sanctions and financial risk are checked again; the vendor pre-flight verifies legal name, tax number and bank details before signature unlocks). Tests added here show each at the point it matters. |
| **Statutory window** | NFR-L01 | Already enforced at publish and when an addendum moves the closing date. A test added here shows the 25-day minimum. |
| **Statutory disclosure** | NFR-L02 | Beyond creating the task, an overdue disclosure now stops further change to that contract (`DISCLOSURE_OVERDUE`) and is escalated once to the executive and procurement. A variation deleted before it took effect owes nothing. |
| **Retention** | NFR-L04 | A signed contract is never destroyed: the database refuses to remove it. A list of deleted contracts, with the reason, and a restore that needs a reason. Deletion and restoration are in the audit trail. |
| **Approve from a link** | NFR-U05 | When a plan or an evaluation report becomes ready for approval, each approver is given a one-time link in their own notifications. It opens a checklist for that one procurement (dollar values withheld unless the organisation chooses to show them). The decision goes through the normal decision route, so the delegation limit, separation of duties and the step-up code all still apply. The link works once and expires. |
| **Fallback for amendments** | NFR-U08 | When the assistant cannot make an in-field amendment, the person can copy the section and the instruction into their AI chat, paste the amended text back and save it, or edit the section directly. |

## Settings added (Administration)
Opening high-value bids (threshold, witness window); supplier ratings (who sees what); approve from a link (on or off, validity, show values); legal platform (on or off, name, shared secret, a switch to pretend it is down).

## What is simulated, and what it would take
- Certificate reading, supplier risk signals, the modern slavery screen, the legal platform and the language understanding in the legal edit, the lessons recall and the duplicate detection are rules, labelled `rules-simulated-v1`. The swap points are in `docs/swap-points.md`.
- The legal platform's shared secret is held in the organisation's settings so the demonstration works. A production deployment keeps it in a secret store (batch B10).
- The approval link is delivered inside the portal (the approver's notifications) and never written to the email log, because administrators can read that log. A real mail sender would put it in the email.
- Approval links are issued for plans and for evaluation reports. The plan path is exercised end to end in the tests; the evaluation report path shares the same issuing and decision code and its decision route is covered by the existing evaluation tests, but no test here drives a report decision through a link.

## Defects found and fixed along the way
- A date such as 30 February was accepted as a valid answer because the parser was lenient; it is now checked strictly.
- A disclosure task left behind by a variation that was deleted before it took effect would have escalated and blocked the contract; deleted variations are now ignored.
- The seeded demonstration data had no supplier locations, so the risk map said none were recorded.
- The crawler test caught that the new supplier scores table linked to supplier pages that executives and probity officers may not open; only roles that can open them now get a link.
- Two migration pieces were added to an already-applied migration file, which left a running development database out of step with the code (login failed because the API refused to start). They now live in their own migration, 0018, so an existing database upgrades in place without a reset.
- The web server's address for the API is fixed when the app is built, so a production start on a non-default API port would send logins to the wrong server. Share mode uses the default ports (documented).

## Verification (run on this machine)
| Check | Result |
| --- | --- |
| API unit and integration tests for B8 | 33 tests across `b8.test.ts`, `b8-tender.test.ts` and `rules.test.ts` pass |
| `npm run ci` (format, lint, typecheck, tests, build) | passes, 813 tests |
| Browser tests for B8 (`e2e/b8.spec.ts`) | 8 pass, with accessibility scans on the new screens, the real map zoomed in and out, and the logo |
| OpenAPI contract | 376 operations; the authorisation matrix and drift tests pass |
