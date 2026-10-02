# M8 - Tender pack and supplier portal: evidence

Stories: US-TND-01, 02, 03 and US-SUP-01, 02, 03, 04 (all Tier W), plus US-TND-04 (statutory window, Tier S) which came free with publish.

## What was built
| Area | Result |
| --- | --- |
| Tender pack (US-TND-01) | Deterministic generator (`modules/tender/pack.ts`) for RFT, RFP, RFQ, RFI and EOI. Nine sections built from the approved plan and request. Weighted criteria add to 100 for RFT/RFP; RFI/EOI are not scored for award. Internal wording (budget, complexity, governance, approvals) is filtered out of anything copied from the plan. |
| Staged until permission (US-TND-02) | New tender is STAGED and invisible to every supplier. A delegate gives permission (separate PUBLISH_PERMISSION authority, limit $5,000,000, stamped, audited). Publish needs permission, an approved plan and a valid window. |
| Statutory window (US-TND-04) | 25 whole days for the public-sector demo tenant; refusal states days given and days required. |
| Invitations | One-time link per contact, only its SHA-256 stored, shown once to the buyer, expires at close or 30 days. Mail is simulated; `invitation.queued` audit event at publish. |
| Registration (US-SUP-01) | Real ABN checksum, 12+ character password, separate identity pool and cookie, sanctions status PENDING. Open-access tenders allow registration without an invitation. |
| One-tender view (US-SUP-02) | Suppliers see only tenders that name them (or open-access ones). Anything else is a 404 plus an audited `access.denied`, indistinguishable from a tender that does not exist. |
| Anonymised Q&A (US-TND-03) | Author stored for abuse control only; no response includes it (allow-list serialiser plus a source-scan test). Answers reach everyone only through an addendum; addenda may extend, never shorten, the closing time. |
| Upload and submit (US-SUP-03) | JSON/base64 upload; allow-list, 10 MB, magic-byte content check, double-extension and path-trick refusal, EICAR scan stub, AES-256-GCM sealed storage, SHA-256 per file. Submit needs one technical and one commercial file; receipt `RC-<ABN tail>-<date>-<tag>` with a manifest. Withdraw and resubmit allowed before close. |
| Close-time lock (US-SUP-04) | Decided on the server clock at the moment of each request. At close: tender closes automatically (audited), drafts are purged, late attempts are discarded, marked and notified, an earlier submitted bid survives. |
| Bid-file protection | Database row level security on `file_object` (migration 0003): owning supplier only; after close the evaluating roles read submitted bids only; administrators never. Before close staff see only a count. |
| Screens | Staff: Tenders list, tender workspace (steps, permission, publish, pack editor, invitations, Q&A, addenda, sealed bids), delegate section on Approvals. Supplier: own header-only portal, My tenders, tender page with live countdown, upload, receipt, withdraw, Q&A; public registration page. |
| Contract | OpenAPI now 76 operations (5 new: answer question, invitation lookup, get my tender, delete bid file, withdraw bid). |

## Verification (all run, this machine)
| Check | Result |
| --- | --- |
| `npm run ci` (format, lint, typecheck, unit/API/DB tests, build) | exit 0, **393 tests** |
| New API tests (`tender.test.ts`, 25) | governance, window, IDOR across every supplier endpoint, anonymity, upload negatives, sealing on disk, receipts, withdraw, row level security by role, late lock with a fake clock to the millisecond |
| New unit tests (`tender-domain.test.ts`, 18) | window validator, close-time, ABN checksum, receipts, upload checks, sealed store, pack generator |
| Browser suite on the production build | **147 pass** (exit 0) after updating older tests for the new supplier shell; includes the 13-test tender spec |
| Browser journey | pack, delegate permission, refused 10-day window, publish at 26 days, invite, register (bad ABN refused first), anonymous question, answer and addendum, bad uploads refused, bid submitted with receipt, staff see it sealed, withdraw and resubmit |
| Accessibility and phone layout | axe WCAG 2.1 AA and no sideways scroll on tenders list, workspace, supplier home, supplier tender and registration at 375 and 1280 |
| `npm audit --audit-level=high` | clean |

## Defects found and fixed during M8
1. **Budget leak (fixed, tested).** The plan background contains the estimated value; the first pack generator copied it, so suppliers would have read the budget. Plan and request text is now filtered through `publicText()`; unit and API tests assert no money, complexity or approval wording appears.
2. **Account takeover by ABN (fixed, tested).** Registration originally reused an existing supplier row with the same ABN, so anyone knowing a company's public ABN could join it and see its tenders. An ABN already in the directory now cannot self-register (generic refusal); the buyer must add extra contacts.
3. **Deadlock (fixed).** The refused-access audit opened a second transaction while the request's was open (single-connection PGlite). Audit now happens after the transaction ends.
4. A scope section came out empty when the plan had no objectives (caught by a unit test); the registration rate limit blocked the test suite (now configurable); several test-selector problems (Next route announcer is also an alert; ambiguous labels).

## Not done / caveats
- Email is simulated; the invitation link is shown to the buyer. Sanctions and insurance are never called (status stays PENDING). ABN is checksum-only, no lookup. Virus scan is an EICAR-only stub. See `docs/swap-points.md`.
- Adding a second contact to an existing supplier company has no screen yet.
- Staff cannot download bid files yet (evaluation, M9). The database already permits it after close.
- US-TND-05 (export tender pack to PDF/Word) not built.
- k6 bid-close burst script is drafted (`perf/bid-close-burst.k6.js`) but **not run**: k6 is not installed here. The close-lock is proven by API tests with a fake clock, not under load.
- No visual-regression baselines for the new screens (layout, a11y and journey are tested; baselines can be added once the look settles). Real-device and screen-reader checks not done.
- Closing is evaluated when a request touches the tender (and by `closeDue`, ready for a scheduler); no background scheduler runs in the POC.
- Table rows on phones are shown as cards; some screen readers may not announce them as a table.

M8 complete. Next: **M9 - Evaluation slice** (conflict declaration, independent hidden scoring, consensus with variance flags, evaluation report), awaiting approval.
