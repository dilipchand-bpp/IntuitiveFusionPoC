# M12 - Reporting and dashboards slice: evidence

Stories: US-RPT-01 (role-scoped dashboard with completion indicators) and US-RPT-02 (audit trail report and export) - Tier W. US-RPT-03/04 (Tier S) and the workload Gantt remain stubs; category spend is built (real sums over seeded data).

## What was built
| Area | Result |
| --- | --- |
| One scoping rule | `modules/reporting/scope.ts`, used by the KPIs, the procurement table and the spend report so no figure shows more than the list beside it. **Portfolio** roles (procurement, delegate, executive, finance, legal, contract manager, probity, admin) see every request; **panel** (evaluators, chair) see only requests whose evaluation they sit on and are not suspended from, plus their own; **own** (requesters) see only what they raised. A person removed from a panel loses the procurement from every figure at once. |
| KPIs | `GET /dashboard/kpis` now reports its `scope`. "Alerts due" is real and shown only to contract management and oversight (null, shown as a dash, for everyone else). "Waiting for you" for evaluators counts only their own active seats. |
| Procurement table (US-RPT-01) | `GET /reports/procurements` (filter by phase, status, text): phase, status, value and five completion ticks (intake, plan, tender, evaluation, contract). A tick means the real record reached its end state (request submitted, plan approved and locked, tender closed or beyond, evaluation approved, contract executed), not that a phase label moved. Ticks are text for screen readers ("Evaluation complete" / "not complete") and labelled on phones. |
| Spend | `GET /reports/spend` (executive, finance, procurement): pipeline (active requests) and committed (executed contracts) by category with totals; the two seeded contracts are not linked to a request so they appear honestly as "Contracts not linked to a request". Bar chart with an equivalent table for screen readers. |
| Audit search (US-RPT-02) | `GET /audit-events` (probity, admin, executive, procurement): newest first, field-level before and after, filters by record type, record, actor, action prefix, result, dates, and **requestId** which returns the whole trail of one procurement (request, plan, tender, submissions, evaluation, report, contracts); paged. |
| Audit export | `GET /audit-events/export` (probity, admin only): CSV with the same filters (no paging, refused above 20,000 rows), UTF-8 with byte order mark, spreadsheet-formula cells defused. The export is itself audited in the same transaction (filters, row count, first and last sequence) and is not part of its own file. |
| Screens | `/app/dashboard` rebuilt (scope sentence, key figures, phase bars, spend chart, filterable procurement table with ticks); `/app/audit` (filters, expandable before/after, paging, Export CSV for those allowed). Route guard on `/app/audit` already limited it to probity, admin, executive and procurement. |
| Contract | OpenAPI now 89 operations (new: procurement table; spend and audit schemas filled in; audit export filters). |

## Verification (all run on this machine)
| Check | Result |
| --- | --- |
| `npm run ci` | exit 0, **498 tests** |
| API (`reporting.test.ts`, 14) | scoping matrix: every portfolio role sees every request and the KPIs equal the table; a requester sees only their own while another person's request exists; evaluators see only their panel's procurement and lose it when removed; alerts-due visibility by role; table filters; ticks follow the real records (evaluation approval flips one tick, a draft has none); spend sums and role access; audit access for read and export separately; audit list (order, paging, who/when, before and after, filters, per-procurement trail, bad filters rejected); export (headers, rows equal the listed total, not in its own file, audited with filters and row count); hash chain still verifies; CSV quoting and formula defusing |
| Browser tests | **175 pass** on the production build (4 new): executive portfolio with ticks, spend table and phase filter; requester and evaluator scopes and no spend; probity search, real CSV download and the export visible in the trail; executive can read but not export, others get 403; accessibility (axe WCAG 2.1 AA) and no sideways scroll on phone and tablet |
| `npm audit --audit-level=high` | no high or critical findings |

## Defect found and fixed
Screen-reader-only text inside table cells was positioned outside the scrolling table, which made the whole page scroll sideways on a tablet. The completion ticks now anchor that text to themselves; caught by the existing responsive test.

## Not done / caveats
- Workload and Gantt dashboards (stub tier) and US-RPT-03/04 are not built; spend is by category only (not by supplier).
- Seeded contracts are not linked to requests, so committed spend by category only shows contracts made in this system.
- No scheduled or emailed reports; the audit export is a manual CSV.
- The CSV has no digital signature; integrity can be checked by the hash column against the chain (verification endpoint is not exposed in the UI).
- Procurement table drill-through goes to the request page; evaluators (who cannot open requests) see titles without links.
- No visual-regression baselines for the new screens.

M12 complete. Next: **M13** (admin and configuration), awaiting approval.
