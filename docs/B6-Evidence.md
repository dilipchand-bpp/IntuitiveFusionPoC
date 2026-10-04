# Roadmap batch B6 - evidence

**Batch:** B6, reporting and collaboration. 18 stubbed requirements delivered (list: `_work/delivered.json`, key `B6`; each is cited by an automated test): FR-0085, FR-0115, FR-0365, FR-0595, FR-0600, FR-0605, FR-0610, FR-0620, FR-0625, FR-0645, FR-0735, FR-0740, FR-0750, FR-0755, FR-0760, FR-0765, FR-0770, FR-0775.

## What was built
| Area | Requirements | Result |
| --- | --- | --- |
| **Layout designers** | FR-0085, FR-0115, FR-0365 | The plan, the tender (RFx) pack and the evaluation report each have a system default layout. An administrator or procurement drags sections into order and switches optional ones off (buttons for keyboard use); required sections cannot be left out. The plan view, the tender pack and the report follow the saved layout. |
| **Schedule** | FR-0595 | One Gantt-style chart of every active procurement. Dragging a phase (or the earlier/later buttons) moves it and everything after it; the delegate calendar is worked out from the schedule and delegates are told when their dates change. |
| **Dashboards** | FR-0600 | A view for procurement, legal, delegate, executive, finance, risk and division. Scope follows the organisation hierarchy (own unit and units beneath) unless the organisation chose broad visibility (setting); procurement and executives always see all. |
| **Performance** | FR-0605 | Category spend, maverick spend (invoices released outside the contract match, purchases with no contract), captured savings (estimate less award) and velocity: average time per phase, what is waiting, and the bottleneck. |
| **Supplier risk map** | FR-0610 | Supplier locations on a map (with a table alternative) with simulated weather, financial and watchlist signals; single points of failure by category and by region. |
| **Workload** | FR-0620 | Procurements are assigned to a manager; active volume and dollar exposure by manager against a capacity setting, with a rebalancing suggestion. |
| **Spend** | FR-0645 | Committed and invoiced spend by supplier, contract, master agreement, project, business unit and division. |
| **Reporting tools** | FR-0625 | Drill-down to the procurements behind a figure; saved custom views, private or shared; plain-language questions such as "all procurement risks in 2026", with the interpretation shown back. |
| **Concurrent editing** | FR-0735 | Plan and tender sections are edited against the section's own revision, so two people can edit different sections at once; a stale edit of the same section is refused with who changed it and what it says now. Presence shows who is in a document. |
| **Tracked changes** | FR-0740 | Every change to a section is recorded by the database (who, when, the old and new text); named versions are kept and compared word by word; a digest says what changed since you last looked. |
| **Template change** | FR-0750 | "Use the request for quotation template": a staged tender changes type and is filled in again; sections a person wrote are kept. |
| **Risk assessment** | FR-0755 | Candidate risks fitted to the procurement; the person marks which apply, rates likelihood and impact, and chooses a treatment from options (or writes one); completion needs every decision. |
| **Response summaries** | FR-0760 | After a tender closes: pricing, dates, proposed changes to the tender, pros and cons per response; anonymous to panel members. |
| **Reference content** | FR-0765 | An in-house corpus of role-description variants across categories, sectors and levels, regenerated on request and by itself when older than the refresh period; no external call. |
| **Plain-language phase moves** | FR-0770 | "Go to the next phase" moves a procurement only when the phase before it is finished by its records; a sync detects finished work and moves the tracker on. |
| **Committee** | FR-0775 | "Add Tomas" / "remove Mei Tanaka" changes the evaluation committee; where several people match a list is offered. |

## Defects found and fixed along the way
- The plan and tender editors checked the whole document's version, so two people editing different sections collided; they now check the section's revision.
- "Has already scored" cannot be read from the sealed scores table; the committee removal uses the member's own completion mark.

## Verification (run on this machine)
| Check | Result |
| --- | --- |
| `npm run ci` (format, lint, typecheck, tests, build) | exit 0, **770 tests**; 33 new API tests (`collab/b6.test.ts`, `reporting/b6-rules.test.ts`); 335-operation authorisation matrix passes |
| Browser tests | 9 new in `e2e/b6.spec.ts`, each with an accessibility scan; full suite 256 passed, 10 skipped, 0 failed (after fixing four defects the first full run found: a back link a role cannot open, a "Save" button name that collided, a tender-list link with no underline next to text, and the collaboration page still being a coming-soon page in the crawler) |
| `npm audit --audit-level=high` | exit 0 |

Existing tests changed on purpose: the crawler's check that the collaboration screen is a placeholder (it is now built).

## Not done / caveats
- The "AI" parts (question reading, instruction reading, candidate risks, response summaries, change digests, reference content) are fixed rules labelled `rules-simulated-v1`; the external risk feeds are simulated (docs/swap-points.md).
- Concurrent editing is by section with revisions and presence, not character-level live co-editing.
- Presence is a heartbeat every 20 seconds; there is no push channel.
- The committee instruction is in the evaluation page; it is covered by API tests, and the browser tests do not drive it.
