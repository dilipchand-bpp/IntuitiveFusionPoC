# M11 - Contract management slice: evidence

Stories: US-CMG-01 (contract record from the executed contract), US-CMG-02 (alerts), US-CMG-04 (expiring contracts and Gantt) - Tier W. US-CMG-03 (custom alert in plain language) and spend tracking stay stubs (`POST /contracts/{id}/alerts` still answers 501).

## What was built
| Area | Result |
| --- | --- |
| Record (US-CMG-01) | When the last signature locks a contract, the same transaction creates its management record: contract owner (the person named on the request, else the first contract manager), milestones (commencement and a mid-term review), optional extensions (from the template: services 12 months, works 6 months) and the system alerts. The parties, term and value are the contract's own fields. Migration 0006 adds the owner column, milestone and extension tables and an alert delivery log. |
| Alert engine (US-CMG-02) | Pure date rules (`modules/contract/dates.ts`): notice alert = end date minus (notice days + 60), so a 90-day notice period gives 150 days before the end; expiry warning 60 days before; extension decision reminder 30 days before the notice deadline; milestone reminders 14 days before. Notice and expiry are always scheduled (if the date has passed they fire on the next run); milestone and extension reminders already past are dropped. A unique index keeps one system alert of a kind per contract and day. |
| Scheduler | `AlertService.runDue` uses the injected clock. Each due alert is flipped from SCHEDULED to SENT with a compare-and-set before delivery, so a repeated or concurrent run never delivers twice. It delivers an in-app notification and an email to the owner (resolved when the alert fires, not when created; falls back to contract managers), logs each delivery (email recorded as SIMULATED) and writes an `alert.fire` audit event. Removed contracts cancel their alerts. It runs when the alert pages are read and every 15 minutes in the real server (`main.ts`); tests call it directly. |
| Expiring and Gantt (US-CMG-04) | `GET /reports/expiring-contracts?days=90`: executed contracts ending within the window, soonest first, with owner, notice deadline, days left and the term bars (initial term plus each optional extension laid end to end). Screen `/app/contracts/expiring` with 30/90/180/365/730-day windows, a Gantt chart whose every bar is also written as text, and a table. |
| Other screens and endpoints | Contract page gets a management card (owner, term chart, milestones, alerts with state and delivery). `/app/contracts/alerts` lists all alerts (`GET /alerts`, `GET /contracts/{id}/alerts`). Seeded contracts get the same record, owner Sofia Rossi (contract manager); their past alerts are history (sent). |
| Contract | OpenAPI now 88 operations (new: list all alerts; record, alert deliveries and Gantt data added to existing schemas). |

## Verification (all run on this machine)
| Check | Result |
| --- | --- |
| `npm run ci` | exit 0, **484 tests** |
| Unit (`dates.test.ts`, 8) | month-end clamping (31 Jan + 1 month), leap-day arithmetic, 90-day notice = 150 days before the end, notice period variations, dropping past reminders but keeping overdue notice and expiry, no duplicate alerts, default milestones, Gantt bars |
| API with fake clock (`management.test.ts`, 9) | record created at execution (owner from the request, fallback to a contract manager, milestones, extension, five alerts); **time travel**: nothing the day before the notice date, fires on it with one in-app and one simulated email delivery, one notification and one audit event, and two further runs deliver nothing; reading the alert pages fires what is due; a removed contract's alerts are cancelled; role access; the expiring window, ordering, extension data and exclusions (not yet ending, already ended) |
| Browser tests | **171 pass** on the production build (3 new): expiring list and window switch with the chart, accessibility (axe WCAG 2.1 AA) and no sideways scroll on a phone; the contract record and alert states; the alert list and 403 for finance, delegate and evaluators |
| Existing tests | migration tests updated for 0006 (up, down, re-apply) |

## Decisions and caveats
- Email is simulated (recorded in `alert_delivery`, never sent): see docs/swap-points.md.
- Notice-period rule is the plan's: notice alert 60 days before the notice deadline. Expiry (60 days), extension (30) and milestone (14) lead times are constants in `dates.ts`, not yet configurable per tenant (admin slice).
- The record's milestones and extensions are defaults from the template; there is no screen to edit them, and spend tracking and custom alerts are not built.
- Alerts are only fired while the server runs or someone reads the alert pages; a deployed system would run the scheduler as its own job.
- Only the contract owner (or contract managers) receives alerts; there is no per-user alert preference.
- Existing development databases need `npm run db:reset` to get the new tables and seeded records.
- No visual-regression baselines for the new screens; the Gantt chart has been checked by tests and accessibility scan, not by a person on a real device.

M11 complete. Next: **M12** (reporting and dashboards), awaiting approval.
