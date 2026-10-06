# Roadmap batch B9 - evidence

**Batch:** B9, planning, spend and experience. 11 requirements delivered in full and 3 delivered in part (list: `_work/delivered.json` key `B9`, and `_work/partial.json` for the three partly built, each saying what is not built). Each is cited by an automated test.

## What was built
| Area | Requirement | Result |
| --- | --- | --- |
| **Currencies and delegations** | FR-0810 | A request can be raised in a foreign currency; the amount is kept in the original currency and in Australian dollars at the rate in force. Rates are annual by Australian financial year (July to June) or a simulated live feed, chosen in settings, and finance maintains them at `/app/currency`. Approval limits for foreign-currency spend are separate "international" delegations, and ordinary delegations do not apply to them (and the reverse). |
| **Guided buying and autonomous sourcing** | FR-0820 | `/app/buy`: an approved catalogue (suppliers on hold are shown but cannot be ordered from), and "describe what you need" which shortlists, scores (price 50%, standing 30%, delivery 20%) and recommends. Nothing is ordered by the platform: approving drafts a request that goes through the usual budget check and approvals. Above a configurable limit (5,000 by default) the approval is refused. |
| **Progress to completion** | FR-0835 | A seven-milestone journey on each request, worked out from the records and never claiming more than is true, with a small celebration when complete (none under reduced motion). |
| **Spend optimisation** | FR-0840 | `/app/reports/optimisation`: contracts worth consolidating, duplicate contracts, rate-card gaps, price variance (including invoices blocked at the price check). Savings are labelled estimates, `rules-simulated-v1`. |
| **Future commitment** | FR-0845 | `/app/reports/commitment`: fixed amounts against ceilings (master agreements and rate cards), ranges and unknowns shown as such, extension options, by year and business unit. |
| **Personal dashboards** | FR-0850 | `/app/dashboard/my`: choose, order (drag, or Up and Down buttons), size and style the widgets, within the role. Styles: cards, 2D bars, 3D bars, line, donut, table. Each chart has a table behind it. |
| **Real-time artefacts** | FR-0870, NFR-P02 | The evaluation report and contract management plans are marked out of date when the records behind them change, then rewritten at once, in a batch after N minutes, or on request, as the organisation chooses. An approved report is never rewritten. A badge shows the state. |
| **Search with an outside source** | FR-0880 | `/app/search`: own records first under the usual visibility; the outside source only when allowed, with reference numbers, ABNs, emails, amounts and supplier names removed first, and every outbound question logged. Simulated corpus. |
| **Live plan updates** | NFR-P01 | The plan page checks for another person's change every five seconds while visible and not being edited, and says so. |
| **Layouts for every phase** | NFR-U04 | The request page and the contract page join the plan, tender pack and report: panels can be ordered and optional ones switched off, mandatory ones cannot. |

Partly built:
| Requirement | Built | Not built |
| --- | --- | --- |
| FR-0825 mobile | Installable web app (manifest, service worker for static files only, offline page), phone home `/app/m`, supplier-review notes with dictation | A native app for the Apple and Google stores |
| FR-0855 adjacent domains | Audit, risk and compliance register (`/app/risk`) with heat map, actions and platform-sourced risks; white labelling (name, tagline, five palettes, support address) | IT service desk, project management, HR, CRM, full ERP |
| NFR-P05 analytics store | A second store refreshed from the main one; the new analytical reports read from it | Moving the older dashboards and reports onto it |

## Settings added (Administration)
Currency (annual or live), later-stage artefacts (real time, batched, manual; interval), guided buying (on or off, limit), outside search (on or off), branding, analytics (refresh interval, consolidation, variance and drift thresholds).

## What is simulated, and what it would take
See "Planning, spend and experience (B9)" in `docs/swap-points.md`. In short: the live exchange feed, the sourcing score, the optimisation and commitment rules, the outside search corpus and the artefact generators are rules labelled `rules-simulated-v1`; each has a named replacement point.

## Tests run
- API: new `b9.fx`, `analytics`, `b9-experience` and `b9-buying-search` suites (FX conversion and delegations, analytics rules and store, progress, dashboards, layouts, notes, register, branding, buying, artefact refresh in the three modes, search and sanitising).
- End to end: `e2e/b9.spec.ts`, eight scenarios, each scanned for WCAG 2.1 AA with axe.
- The authorisation matrix, OpenAPI drift and roadmap tests cover the 36 new operations (contract now 412 operations).

## Defects found and fixed along the way
- The ANNUAL rate mode wrongly read live-feed rows; fixed and tested (October 2026 falls in FY2027).
- A dimmed table row failed colour contrast; dimming replaced by a background.
- The risk-action notification linked to a page that does not exist; it now opens `/app/risk`.

## Known limits
- The plan page cannot yet say who changed it ("another user"), because the plan view does not return the name.
- The mobile home counts approvals from plans awaiting approval only.
- The risk register has no owner picker (there is no user list endpoint for these roles); the creator is the owner.
- The demonstration data is small, so the optimisation and commitment reports show few findings until more contracts exist.
