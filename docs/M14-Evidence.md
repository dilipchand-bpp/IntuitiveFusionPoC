# M14 - Stub sweep: evidence

Requirement: PRM-08 and US-FUT-01. Every stubbed (tier S) and deferred (tier D) requirement in the traceability matrix is accounted for in the product, no screen is blank, and no link leads nowhere.

## What was built
| Area | Result |
| --- | --- |
| Roadmap register | `packages/shared/src/roadmap-data.ts`, **generated** by `_work/gen_roadmap.py` from `docs/RTM.csv` and the requirements register: 122 tier S and 108 tier D requirements, one line each with id, category, priority, a plain description and a `TODO(<id>)` (S) or `DEFERRED(<id>)` (D) marker. Stubbed requirements are tied to the screen they belong to. |
| Roadmap screen | `/app/roadmap` (menu: Oversight, all staff): totals, then "coming soon" grouped by screen (each heading links to the screen only if the person's own menu offers it), then the deferred items by category. |
| "Coming soon" screens | `/app/collaboration` (new, tier S collaboration and AI authoring), `/admin/migration` and `/supplier/profile` each state what is planned and list their requirement ids and descriptions. A placeholder now answers **only for its own address**: any other made-up address is a 404. |
| TODO inventory | `docs/todo-inventory.md` (generated): S items by screen, D items by category, with status counts. |
| API stubs | Unchanged from M3: every contract operation without a handler answers 501 `NOT_IMPLEMENTED` ("Coming soon", feature name) behind its real access guard; the role by operation matrix test covers all of them. 112 operations in the contract. |

## Defects the crawler found and fixed
- Any made-up address under `/admin/...` or `/supplier/...` showed the parent's "coming soon" panel (a supplier typing a wrong address was told "My tenders - coming soon"): placeholders now match their exact address only.
- The supplier portal had **no menu at all**, so "Company profile" could not be reached: a small menu (My tenders, Company profile) was added.
- The dashboard linked request titles to a screen the administrator cannot open (403), and the new roadmap linked areas some roles cannot open: both now link only when the person's own menu offers the screen.

## Verification (run on this machine)
| Check | Result |
| --- | --- |
| Reconciliation test (`apps/api/src/roadmap.test.ts`, 6) | reads `docs/RTM.csv`: every S and D requirement is in the register exactly once and in its own tier, nothing else is, every S item has a screen, every item has its marker, and the inventory document lists every id. Fails if the matrix changes and the generator is not re-run. |
| Route crawler and link checker (`e2e/crawler.spec.ts`, 14) | per role (all 12): sign in, open every screen the menu offers (200, a heading, real content, no error text), follow every internal link on those pages (none 4xx/5xx), probe every other screen (403 or a real page, never blank), only administrators reach `/admin` and only suppliers `/supplier`, a made-up address shows a not-found page. Plus the public pages and their links, and the coming-soon and roadmap screens. |
| `npm run ci` (format, lint, typecheck, tests, build) | exit 0, **569 tests** (42 files) |
| Browser tests, full suite | 201 of 202 passed on the production build; the one failure (`shell.spec.ts` notification count for the Legal user) is a timing flake under full parallel load (another test adds a notification to that user between its steps); `shell.spec.ts` and `crawler.spec.ts` together then passed 61 of 61. |
| `npm audit --audit-level=high` | exit 0 |

## Not done / caveats
- "Partly built" versus "coming soon" is **inferred**: a stubbed requirement counts as partly built only if its id appears in built code, tests or a milestone evidence document. Several requirements shown as coming soon may in fact have been delivered under a neighbouring story without citing their id; the owner should confirm the statuses at the M15 gate.
- Stubbed API operations do not carry requirement ids in their 501 response (the contract does not map operations to requirements); the screens and the inventory do.
- Coming-soon screens are text: no visual-regression baselines, and no manual screen-reader pass.
- The notification-count browser test can flake when run in parallel with the rest; it passes alone and with its own spec.

M14 complete. Next: **M15** (skeleton end-to-end smoke and Gate 5b), awaiting approval.
