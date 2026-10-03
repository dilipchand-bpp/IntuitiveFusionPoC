# M9 - Evaluation slice: evidence

Stories: US-EVL-01 to US-EVL-05 (all Tier W). US-EVL-06/07 (Tier S: probity read-only workspace, sign-off) are covered only as a read-only view for probity and executive.

Also in this batch (before M9, at the owner's request): request screen redesign, plan page redesign (plus a fix so the approval stamp shows the approver's name), tender workspace tabs, empty-state for the new-request draft, and a **device preview** (phone / tablet frame from any header). See "Earlier in this batch" below.

## What was built (M9)
| Area | Result |
| --- | --- |
| Open (US-EVL-02) | Procurement picks the panel (technical or commercial per evaluator; the chair is added automatically). One record per submitted bid; the scoring sheet comes from the same weighted criteria published in the tender pack (single source in `tender/pack.ts`). Refused: tender not closed, no bids, RFI/EOI (not scored for award), panel without a needed stream, non-evaluators, duplicates, the requester on the panel. Tender moves to EVALUATING. |
| Conflict gate (US-EVL-01) | Before declaring: suppliers appear as "Supplier A/B/C", no files, no scoring, no file download. "No conflict" reveals names and the member's stream files. A conflict removes the member immediately (their access is a 404), alerts chair, probity and procurement, is audited; scoring does not start while a stream has nobody, and procurement adds a replacement (a removed member cannot be re-added). |
| Hidden scoring and isolation (US-EVL-03) | Technical members see/score technical and shared criteria and open only technical files; commercial members the commercial equivalents; the chair sees all. Scores 0-10 in half points (pass/fail = 0 or 10). A criterion outside your stream looks like one that does not exist (404). Others' scores are unreachable by any role, endpoint or direct database query before consensus (existing row level security, re-tested). Audit records that scoring happened, never the scores or comments. |
| Database-level file isolation | Migration 0004 replaces the bid-file policy: evaluators/chair read a bid file only if on the panel, declared no conflict, the tender is closed, and the file's section matches their stream. Administrators and executives are in no group. Tested with direct queries per identity. |
| Consensus (US-EVL-04) | Chair opens when every member has declared and finished. Variance = (max - min) / max; above 30% is flagged. Chair sees each individual score with the evaluator's name; probity read-only. Lock refused with a count and a list while any score lacks a consensus value or any flagged score lacks a reason (10+ characters). After consensus opens, scores cannot change, even through the database. "Use the average where scorers agree" helper; flagged scores always need a human decision. |
| Report (US-EVL-05) | After lock, procurement generates a deterministic report: summary, process followed (declarations, removed members, isolation, each flagged score with its rationale), ranking (weighted score out of 100, competition ranking, non-compliant unranked), commentary by supplier (evaluator comments quoted, not attributed), recommendation, timestamp. A delegate approves within their authority (stamp) or the executive above it; "return" lets procurement regenerate. |
| Screens | `/app/evaluations` (list, closed tenders ready, panel set-up dialog) and the evaluation workspace that adapts to the person and stage: conflict gate, panel, suppliers and files, scoring sheet (per-supplier cards that stack on phones), consensus with flags, ranking, report and decision. |
| Contract | OpenAPI now 81 operations (5 new: list evaluations, list evaluators, add panel member, submit scores, download bid file); executives may read evaluations. |
| Test-only API entry | `apps/api/src/e2e-main.ts` (refuses to run outside NODE_ENV=test with an e2e database) adds one route that backdates a tender's closing time, so the browser tests can close a tender despite the 25-day minimum. Production uses `main.ts` only. |

## Verification (all run on this machine)
| Check | Result |
| --- | --- |
| `npm run ci` (format, lint, typecheck, unit/API/DB tests, build) | exit 0, **430 tests** |
| New unit tests (`evaluation-domain.test.ts`, 18) | variance (incl. exactly 30% not flagged), weighted score, ranking ties, pass/fail, stream rules, criteria templates, report content and determinism |
| New API tests (`evaluation.test.ts`, 17) | open and refusals; conflict gate and removal and replacement; stream isolation incl. file bytes, 404s and direct database reads per identity; no-leak matrix across every role, endpoint and a direct query; score validation and freezing; consensus, flags, lock; scores immutable after consensus; report; delegate and executive approval and delegation limit; lists; seeded evaluation |
| Browser tests | **162 pass** on the production build, including the 9-test evaluation spec: panel set-up, anonymous-then-named suppliers, each stream's files, scoring by three people, consensus with flags and a refused lock, report and delegate approval, accessibility (axe WCAG 2.1 AA) and no sideways scroll on phone and desktop, seeded evaluation, read-only oversight and 403/login for outsiders |
| `npm audit --audit-level=high` | clean |

## Defects found and fixed during M9
1. **Seed contradicted the rules.** The seeded evaluation had the technical evaluator scoring price. Seed now follows the stream rules (12/8/16 scores, one flagged score of exactly 37.5%).
2. **Executive could not read the report they must approve** above a delegate's limit (404). Executives are now read-only participants (no bid files, no scores).
3. A test used a past closing time and the system correctly closed the tender first; tests now use true states. Supplier order is intentionally unpredictable (it fixes anonymous labels), so tests score by company name.

## Earlier in this batch
- Request, plan and tender screens redesigned (grouped facts, clear hierarchy, right-hand rail on the plan page, tender sections in tabs). The seeded approval stamp lacked the approver's name; the API now returns the approver's name and the seed uses the real stamp format.
- Device preview (`/preview`): the current page inside a real 375 or 768 px iframe, rotate, reload, open in a new tab; hidden on phones and inside the frame; only same-site paths can be framed. 6 browser tests + unit test for the path guard. It shows layout and responsive behaviour; it does not simulate touch or a phone browser's own toolbars.

## M9 follow-ups (requested after the first review)
| Item | Result |
| --- | --- |
| Blank areas on the evaluation page | Every stage now has a "where this is and what comes next" card (conflicts waiting, scores in, flagged scores, report awaiting approval). Read-only roles (procurement, delegates, executive) get the suppliers and their documents in the main column as a two-column grid; people who score keep them beside the scoring sheet. File links show the name on its own line with stream and size underneath instead of wrapping awkwardly. |
| Bid documents would not download | **Cause:** the seeded bid files were database rows with made-up storage keys and nothing on disk. **Fix:** the seed now writes a real PDF (technical response) and a real Excel workbook (pricing schedule) per bidder into the sealed store; a stored file that is genuinely missing is a clean 404 ("This file is not available"), never a server error. Existing dev databases need `npm run db:reset` to get the files. |
| PDF export of the report | `GET /evaluations/{id}/report/pdf` (procurement, delegate, executive, probity, legal, chair; audited). A dependency-free PDF writer (`apps/api/src/documents/pdf.ts`): A4, wrapped text, headings, bullets, a ranking table, and a footer on every page with the report name, "Page x of y", generation time and the evaluation record version. Status is printed ("Awaiting approval", "Approved" with the stamp, or "Needs regenerating"). "Download PDF" button on the report. |
| Reopening consensus after the lock | `POST /evaluations/{id}/consensus/reopen` (chair only, reason of 10+ characters). Agreed values and rationales are kept, individual scores stay frozen (also at the database), the earlier report is invalidated ("Needs regenerating") and must be regenerated after the chair locks again; refused before the lock and once the report is approved (the approver must return it first). Audited with the reason; procurement, delegates, executive and probity are told. |
| Delegate review of a declared conflict | Declaring a conflict now **suspends** access immediately (404 for that person) and sends the decision to a delegate (executive if none). Immaterial or manageable reinstates the evaluator (they continue; scoring cannot start and consensus cannot open while any conflict is undecided); material removes them for good (a replacement can be added). `POST /evaluations/{id}/conflicts/{userId}/decision` (delegate or executive); chair, probity and procurement are alerted at the declaration and at the outcome; the declarant is told the outcome; the declared conflicts are shown to those who must act and to oversight, never to other evaluators. The report records members whose conflict was reviewed and allowed. |
| Contract | OpenAPI now 84 operations (3 new: report PDF, reopen consensus, conflict decision; the declare-conflict outcome is now "suspended"). |

### Verification of the follow-ups
| Check | Result |
| --- | --- |
| `npm run ci` | exit 0, **446 tests** (new: 6 document-writer tests, 10 new evaluation API tests) |
| Independent file check | The generated PDF opens in Mozilla PDF.js (pages, title and text extracted correctly); the generated workbook passes Python's zip integrity check and holds the parts Excel needs |
| Browser tests | **165 pass**, including: real downloads of the seeded PDF and Excel file; a conflict declared on screen, the evaluator redirected with a notice and shut out, a delegate reinstating them, scoring, report generation and PDF download, the chair reopening with a reason, re-lock, regeneration, approval, and no reopen after approval; a material conflict removing someone for good |
| `npm audit --audit-level=high` | clean |

## Not done / caveats
- Word export of the report is not built (PDF only). Changing the variance limit per evaluation is not built.
- The PDF writer uses the built-in Helvetica fonts: text outside Western European characters prints as "?".
- The seeded documents are synthetic and short; real supplier uploads are whatever the supplier sent.
- Evaluators comment per supplier, not per criterion. No search or export of evaluation data exists, so there is nothing further to leak through, but if added it must reuse the same rules.
- Probity sign-off and the read-only probity workspace beyond viewing (US-EVL-06/07) are stubs.
- Real-Postgres multi-connection test of the new policies is still owed (PGlite only); no manual screen-reader pass; no Linux visual baselines; the k6 burst script remains unrun.
- No visual-regression baselines yet for the evaluation screens.

M9 complete. Next: **M10 - Contract award and legal slice**, awaiting approval.
