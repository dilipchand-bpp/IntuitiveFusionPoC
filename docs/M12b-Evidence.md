# M12b - Follow-up batch: items left unbuilt through M12

Requested after M12: build Group A and the cheaper Group B items. M13 and M14 are unchanged except that some of what they would have covered (delegation limits, several Tier S stubs) is now real.

## What was built
| # | Item | Result |
| --- | --- | --- |
| A1 | Edit the contract record | After execution, contract management, legal and procurement can replace the milestones (they must fall inside the term), replace the optional extensions, and change the owner (to a contract manager only). Scheduled reminders are recomputed; alerts already sent stay as history; every change is audited. |
| A2 / US-CON-05 | Variations | A child contract linked to the parent (`CT-xxxx-V1`, `-V2`...): only from an executed contract, one open at a time, drafted, reviewed, released and signed like any contract, then locked. Signing authority and the signing chain are judged on the **cumulative** value (a small variation can still exceed a delegate's limit). The parent keeps its own locked terms and shows cumulative value and the later end date; its scheduled notice/expiry alerts and the expiring-contracts report follow the effective end date. |
| A3 / US-ADM-01 | Delegations screen | `/admin/delegations`: list, change, switch off, add a limit for a person; applies to the very next approval or signature (checked in tests: a raise lets a blocked signature through, a switch-off stops one); the person is notified; audited with before and after; administrators cannot grant authority to themselves. `GET /admin/users` (read-only, no suppliers). |
| A4 | Return-to-legal in the browser | New browser test: a signatory returns with a reason, legal fixes and re-releases, it is signed. |
| A5 | Second supplier contact | Procurement adds a contact from the new supplier profile; the contact sets a password through a one-time link (7 days, stored as a hash, single use, generic 404 for any bad link, rate-limited). No email is sent in the proof of concept: the link is shown once for the buyer to pass on. Self-registration still cannot join an existing company. |
| US-SUP-05 | Supplier directory and profile | `/app/suppliers`: sanctions and insurance status (simulated), last checked, contacts, tenders bid on, contracts held. |
| A6 / US-TND-05 | Word export, tender pack export | Dependency-free Word writer next to the PDF writer (same blocks, so the two never differ): evaluation report as PDF **and** Word; tender pack as PDF and Word, each with status, version, timestamp and a footer; all audited. |
| A7 | Configurable lead times | The expiry, notice, extension and milestone lead times are tenant settings (admin screen, validated 1 to 365 days); saving moves the scheduled alerts of every executed contract. |
| A8 | Evaluator dashboard link | The procurement table returns the evaluation id, so evaluators and the chair follow a row to their evaluation. |
| A9 | Seeded contracts linked to requests | The two seeded contracts now sit behind tenders and requests, so spend by category is complete. A seeded off-contract purchase (PR-2026-0007) demonstrates the maverick view. |
| B1 / US-CMG-03 | Custom alerts in plain language | `POST /contracts/{id}/alerts` with text such as "alert me 1 year before expiry and include whoever is my manager then": a small deterministic grammar (lead time, anchor date: expiry, notice deadline or start; extra recipients: manager or a named role). Recipients are resolved **when it fires**. Unclear text gets an explanation of what to type; dates already past and drafts are refused. |
| B2 / US-RPT-03/04 | Spend by supplier, off-contract spend, workload and timeline | `/app/reports`: category spend with drill-down to each request and contract, committed spend by supplier with share, off-contract spend highlighted, workload by owner and a procurement timeline (Gantt) with a table or text equivalent for every chart. |
| B3 / US-EVL-04 | Variance limit per evaluation | The chair sets 5 to 60 percent before consensus opens (audited; procurement and probity told); the existing flagging uses it. |
| B4 / US-CON-02 | Deviation register | Each changed clause gets an auto-proposed risk rating (mandatory clause, length cut by more than 30 percent, added exclusion/waiver/unlimited wording); Legal can amend it; a change to a mandatory clause or any high-risk change needs a delegate's (or the executive's) approval before release; any new edit voids the earlier approval. |
| B5 / US-EVL-06/07 | Probity sign-off | Probity records that the process was followed once consensus is locked (stamp, audited, shown on the evaluation and in the PDF). It is a **record, not a gate**: the delegate approval of the report remains the gate. |
| B6 | Scheduler for tenders | Tenders now also close on a timer in the running server (every 15 minutes), as contract alerts already did; the pages still close what is due when read. |
| Contract | OpenAPI is now 108 operations (19 new). Migrations 0007 (clause risk, custom alert note and author) and 0008 (supplier activation). |

## Verification (all run on this machine)
| Check | Result |
| --- | --- |
| `npm run ci` | exit 0, **551 tests** |
| New unit tests | risk rating, plain-language grammar (the stakeholder's example, units, month ends, roles, refusals), lead times, Word writer (package parts, tables, escaping, determinism) |
| New API tests | record editing; variations (path, cumulative authority, effective end date, parent alerts moved, numbering); deviation decisions; custom alerts with time travel (author and manager resolved at firing, once only); lead times; admin delegations (a raise or switch-off changes the next signature, audit, notification, self-service refused); supplier directory and the activation flow (single use, expiry, login as supplier only); variance limit; probity sign-off; Word and tender-pack exports; spend by supplier, off-contract and workload; seed linkage |
| Browser tests | **184 pass** on the production build (13 new): deviation approval then release then sign, record editing, a plain-language alert, a variation signed; return to legal; lowering a limit blocks a signature and restoring it allows it; alert timing; adding a supplier contact who activates and signs in; reports (executive, finance, contract manager, others refused); variance limit, probity sign-off and real Word and PDF downloads of the report and the tender pack; the evaluator's dashboard link; accessibility (axe WCAG 2.1 AA) on the new screens and no sideways scroll on a phone |
| Independent file check | The generated .docx opens as a valid zip and every XML part is well-formed (Python `zipfile` + `minidom`). It has not been opened in Microsoft Word or LibreOffice (neither is installed here). |
| `npm audit --audit-level=high` | no high or critical findings |

## Decisions and caveats
- **Executive co-signature above 1,000,000** still needs a signing delegation: the seed gives the executive none (the rule that sourcing approval does not confer signing authority is kept). The administrator can now grant one on the delegations screen.
- Deviation approval is by role (delegate or executive), without a value-based limit, because no limit scope exists for it.
- "My manager" is a stand-in: the nearest delegate or executive in the person's organisation unit, else any delegate; the proof of concept has no reporting lines (docs/swap-points.md).
- The probity sign-off does not block the award; making it a gate would change the existing approval flow and was not asked for.
- The workload "owner" is the person who raised the request, since procurements have no separate lead assignment.
- Supplier activation links are shown to the buyer, not emailed. There is no way to deactivate or remove a contact, or to reissue a link (add the contact again with another email).
- Variations cannot be created for a contract still being drafted, and a variation does not change the parent's locked fields; its value and end date are shown as cumulative figures.
- Not built: alert preferences per user, editing alert recipients after creation, spend tracking against invoices (US-CMG-05), negotiation (US-EVL-08), user creation and role editing (rest of US-ADM-01), AI contract analysis. No visual-regression baselines for the new screens; no manual screen-reader pass; the real-Postgres test of the policies and triggers is still owed.

Next: **M13** (admin and configuration: users and roles, workflows and templates read-only), awaiting approval.
