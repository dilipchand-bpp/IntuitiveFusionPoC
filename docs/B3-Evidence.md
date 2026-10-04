# Roadmap batch B3 - evidence

**Batch:** B3, evaluation and the report. 18 stubbed requirements delivered (the list is `_work/delivered.json`, key `B3`; each is cited by an automated test, which a test enforces): FR-0265, FR-0280, FR-0285, FR-0290, FR-0295, FR-0305, FR-0310, FR-0315, FR-0320, FR-0325, FR-0330, FR-0335, FR-0340, FR-0350, FR-0355, FR-0360, FR-0370, FR-0375. FR-0365 (drag-and-drop report layout) stays with batch B6, with the other layout designers.

## What was built
| Area | Requirements | Result |
| --- | --- | --- |
| **Compliance gate** | FR-0265 | When an evaluation opens, every bidder goes through four mandatory pass or fail checks (registration and screening, declarations, insurance, response complete). Each missed requirement is named and sends the supplier an automated clarification request with a deadline. A failed supplier is not ranked until the check is put right or procurement or a delegate waives it with a recorded reason. An administrator setting decides whether a missing insurance certificate fails. |
| **Clarifications** | FR-0290 | Procurement asks a bidder a question with a response deadline (told in the app and by simulated email); the supplier answers in the portal; a late answer is refused; every step is audited. |
| **Best and final offers** | FR-0290 | A controlled mini-tender for updated pricing: chosen suppliers only, offers sealed from the buyer until the round closes, every revision kept beside the original bid (which is never touched), and an accepted offer replaces that supplier's total cost for ranking. |
| **Negotiation advice** | FR-0295 | Suggested discount, clauses legal rated high, and insurance to require, each with the basis stated. A simulated rules model, labelled as such. |
| **Pricing, ranking and value for money** | FR-0280, FR-0350 | Suppliers enter price, implementation and running cost; total cost of ownership is normalised (lowest scores 100). A low-value evaluation can be run as a ranking: each evaluator orders the suppliers, and the final order blends the panel's view with normalised cost by a project weighting. |
| **Plain language** | FR-0315 | An evaluator describes a supplier or an order in words; the platform shows how it was read and saves only when the evaluator confirms. The sentence is kept as commentary. |
| **Criteria library** | FR-0320 | Administrators keep a library; procurement picks and weights criteria for each evaluation before scoring opens (weights must add to 100, each stream needs an evaluator); a later stage can differ. |
| **Conflicts** | FR-0325, FR-0330 | Each member is asked to confirm again once supplier names are visible; outstanding members are reported and reminded (manually, and on a schedule). Decisions use three dispositions: immaterial, minor (the person stays but is excluded from the supplier concerned) and material (removed); delegates, the executive or the probity advisor decide, and the ruling records who and in what capacity. |
| **Substitution** | FR-0305, FR-0335 | A leaver's marks stay as read-only history and are left out of the averages; the replacement declares a conflict, is told every outstanding task and starts with a clean matrix. After a material conflict the replacement is nominated in one step. |
| **Multi-stage** | FR-0285, FR-0360 | A later stage shows every earlier stage's ranking and who was shortlisted, all scores are retained, and the report documents each stage. |
| **Probity advisor** | FR-0310, FR-0340 | An external advisor sees only the procurements allocated to them (everything else answers as if it did not exist, and no other part of the platform is reachable), can freeze the workspace with a system hold, and writes or uploads the probity plan and outcomes report and signs each with a stamp attributed to them. |
| **The report** | FR-0350, FR-0355, FR-0360, FR-0370, FR-0375 | At the lock the Sourcing Recommendation Report is compiled as a draft: compliance log, scoring spread, panel justifications, total cost and value for money, clarifications and offers, and a recommendation. It is printable, every export carries a reference, exporter, time and content fingerprint, and it can be reviewed and approved on a phone. Approval is routed to the holders of the lowest sourcing authority that covers the value. Anyone who prepares or approves it can declare a conflict on it, as at the plan; an uncleared conflict stops that person approving. |

## Defects found and fixed along the way
- The browser tests found that accepting an offer did not refresh the ranking on the page; it does now.
- The first scheduled reminder was due the moment an evaluation was first listed; it is now due one period after the evaluation opened.
- Two label collisions in the new screens (a form named after a field, a button named after the field it sends) were caught by the browser tests and the test locators made exact.

## Verification (run on this machine)
| Check | Result |
| --- | --- |
| `npm run ci` (format, lint, typecheck, tests, build) | exit 0, **673 tests**; the API tests added 24 for this batch (`b3.test.ts`) and 3 earlier ones changed on purpose (a draft report now exists at the lock; the probity advisor can decide a conflict) |
| Authorisation matrix | 211 operations, each allowed exactly for the roles the contract names |
| Browser tests added | 11 in `e2e/b3.spec.ts`, each with an accessibility scan; the crawler also visits the probity portal |
| Full browser suite (production build) and `npm audit --audit-level=high` | 230 of 232 passed in the full run; the two failures were an accessibility finding on the evaluations list (a link beside other text needed an underline: fixed) and an existing test expecting the old "Regenerate report" label (the report now exists as a draft from the lock, so the button reads "Generate report"); that spec then passed in full (35 of 35). Visual baselines unchanged. Audit exit 0 |
| Traceability | a test fails if a built requirement is not cited by an automated test or not listed in `_work/delivered.json` |

## Not done / caveats
- Plain-language reading, negotiation advice and the compliance checks are fixed rules, not a language model (docs/swap-points.md lists the swap points).
- Supplier pricing is entered in the portal as numbers; it is not read from the supplier's pricing file.
- The probity advisor is an external user flag with a route allow-list; the proof of concept has no separate identity provider for the advisor's own organisation.
- Approval routing uses the sourcing delegations already in the platform; a value above every limit notifies the executive and procurement that nobody holds enough authority.
