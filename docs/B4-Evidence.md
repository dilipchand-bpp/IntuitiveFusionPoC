# Roadmap batch B4 - evidence

**Batch:** B4, contract award and legal. 16 stubbed requirements delivered (the list is `_work/delivered.json`, key `B4`; each is cited by an automated test, which a test enforces): FR-0385, FR-0400, FR-0405, FR-0415, FR-0425, FR-0430, FR-0435, FR-0440, FR-0445, FR-0450, FR-0460, FR-0465, FR-0470, FR-0475, FR-0480, FR-0485.

## What was built
| Area | Requirements | Result |
| --- | --- | --- |
| **Tender cross-check** | FR-0405 | The draft is compared with the winning response: contract value against the tendered total cost (including an accepted best and final offer), against the approved estimate, the term against the tender, and any supplier-proposed change still to be negotiated. A price difference over 10% fails and holds release until a person reviews it with a reason; the other findings are shown without blocking. |
| **Vendor pre-flight** | FR-0415 | Legal name and registration, tax registration and banking details are checked before signature options unlock. The supplier gives bank details in its portal (only the last three digits are echoed, and the audit trail never holds the numbers). A failure holds release, and one found later holds signing, until legal reviews it. |
| **Long negotiations** | FR-0440 | After 30 days (a setting) signature blocks lock; sanctions, financial risk and insurance must be run again, and the lock clears for another period only when they pass. |
| **Signing modes** | FR-0425 | Standard, blind (a signatory sees no other signature or identity until execution) or staged (signatures in order). Signature-block positions come from the template, else signing order. |
| **Other documents** | FR-0430 | NDAs, confidentiality agreements and master agreements are drafted, reviewed, released and signed exactly like a contract, and export to PDF and Word. |
| **Non-negotiable clauses** | FR-0400 | An administrator names the clauses (for example liability and IP). A change tells General Counsel (executive) and the risk delegate (probity) at once and blocks release until one of them approves; an ordinary delegate cannot. |
| **Endorsements** | FR-0480 | Legal and finance endorsement before release can each be required. |
| **Invitations and questions** | FR-0445 | Each signatory is invited by email and in the app, the supplier's contacts are invited to read the contract, opening it is recorded, unsigned signatories are reminded on a schedule or on request, questions go to legal and are answered in the platform, and procurement and legal are told as each signature arrives. |
| **Risk summary** | FR-0450 | An auto-populated summary for the delegate (deviations, checks, supplier standing, open questions) that legal edits and reviews; review can be required before release. |
| **Deviations in plain language** | FR-0475 | Each deviation says what it means (with the corporate fallback where one is on file), legal can rate it in words (read back before it is saved), and the business or a delegate can formally accept the risk with a statement. |
| **Negotiation strategy** | FR-0485 | Framing, techniques, four graduated positions (minimum, expected, very good, stretch) tied to the tendered cost and rival bids, and levers for price, payment, liability and indemnities. |
| **Working on the draft** | FR-0465 | Legal edits clauses live; comments, a downloadable PDF or Word draft, and uploaded amended drafts kept as numbered versions with their hash. |
| **Legal desk** | FR-0385, FR-0470 | A kanban board of legal matters with review hours, and a knowledge base of policies, historical advice, fallback positions and boilerplate that the advisers draw on. |
| **Lineage** | FR-0460 | A variation shows its parent, siblings, cumulative value and latest end date. |
| **Time-bound access** | FR-0435 | A committee member, auditor or advisor is given one project's contract and report until a date or a set number of days after the contract is signed or the report is approved. The grant ends on its own when it is next read, and the end is audited; it never opens bid files. |

## Defects found and fixed along the way
- Release of a contract returned 422 in every existing test once "IP" and "Liability" were treated as protected by default; the administrator now names protected clauses (none by default) so existing journeys are unaffected.
- A refused read of an ended grant rolled back the very revocation it was recording; the refusal is now thrown after the transaction commits.
- Contract and variation rows took the database's clock, not the platform's, so time-travel tests and the negotiation clock disagreed; both now use the platform clock.

## Verification (run on this machine)
| Check | Result |
| --- | --- |
| `npm run ci` (format, lint, typecheck, tests, build) | exit 0, **693 tests**; 20 new API tests in `b4.test.ts` and none of the earlier contract tests changed |
| Authorisation matrix | 257 operations, each allowed exactly for the roles the contract names |
| Browser tests added | 8 in `e2e/b4.spec.ts`, each with an accessibility scan; the crawler also visits the legal desk, shared documents and the supplier's contracts |
| Full browser suite (production build) and `npm audit --audit-level=high` | 236 of 239 passed in the full run. One accessibility check on the dark sign-in page failed once on a hover colour and passed on re-run (75 of 75 for the shell and gallery specs); two mobile gallery snapshots changed on purpose because form hints now sit under their field (the baselines were updated). Audit exit 0 |
| Traceability | a test fails if a built requirement is not cited by an automated test or not listed in `_work/delivered.json` |

## Not done / caveats
- The vendor register, banking check, risk summary, deviation explanations and negotiation strategy are fixed rules and a synthetic register, not outside services (docs/swap-points.md lists the swap points).
- The supplier reads and questions a contract in its portal but does not sign for the customer; external signature by an e-signature provider is not simulated.
- Shared documents cover the contract and the evaluation report as PDFs; a grant is ended when it is next read, with no nightly job.
- A change of a protected clause is tied to clause ids named in settings; none is protected until an administrator names them.
