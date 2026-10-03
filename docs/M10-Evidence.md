# M10 - Contract award and legal slice: evidence

Stories: US-CON-01 (draft), US-CON-03 (sign under separate signing authority), US-CON-04 (lock on execution) - Tier W. US-CON-02 (deviation register) is a read-only list derived from the clauses changed from the template; US-CON-05 (variations) remains an unimplemented stub.

## What was built
| Area | Result |
| --- | --- |
| Draft (US-CON-01) | `POST /contracts` from an approved evaluation, only for the supplier the report ranks first and compliant (422 `SUPPLIER_NOT_RECOMMENDED` otherwise; 409 if the evaluation is not approved or a live contract exists). Template matched to the tender route (RFT works, RFP/RFQ services); clause library with mandatory clauses; supplier name/ABN, price, dates, notice and service levels (from the request deliverables) filled in; numbered CT-YYYY-NNNN; tender becomes AWARDED; legal is told. The value defaults to the request estimate or can be entered, because bid prices are not captured in the system. |
| Legal edit | `PUT /contracts/{id}/clauses/{clauseId}` (legal only). A clause whose wording or title differs from the template is marked `changedFromTemplate` and appears in the deviation list with template and current wording; restoring the wording clears the mark. Mandatory clauses cannot be emptied. `PATCH /contracts/{id}` changes value, dates, notice (legal or procurement); unedited clauses follow, edited ones keep legal wording. Audited. |
| Release | `POST /contracts/{id}/release-for-signing`: legal from draft/legal review; procurement only after legal review. Blocked (422, with the list) by an empty mandatory clause, an unfilled placeholder, a missing value or bad dates. After release clauses cannot be edited. |
| Sign (US-CON-03) | `POST /contracts/{id}/sign`: mock e-signature with a stamp (name, role, UTC time) stored as an approval. Authority is looked up under the separate `CONTRACT_SIGNING` scope: holding sourcing approval gives nothing, and a limit below the value refuses with `SIGNING_AUTHORITY_INSUFFICIENT` (the refusal is audited). Chain: the delegate always signs; above 1,000,000 the executive co-signs (status "Partly signed" in between). Nobody signs twice. A signatory can return the contract to legal with a reason: signatures are withdrawn (superseded) and the contract is released again after the fix. |
| Lock (US-CON-04) | The last signature sets EXECUTED and locked; system alerts for notice and expiry are created. Any edit returns 423 `CONTRACT_LOCKED`. New migration 0005 adds a database trigger so clauses of a locked contract cannot be inserted, changed or deleted even by a privileged connection (contract terms were already guarded by migration 0001), and a unique index of one live contract per tender. Logical delete only (`DELETE /contracts/{id}`: legal or executive, reason of 10+ characters, audited, record kept). |
| Screens | `/app/contracts` (awards ready, all contracts) and the contract workspace: stepper, clauses with change marks and inline editing for legal, deviations, terms, signature chain with stamps, release / sign / return / remove actions. Route guard added for the roles that may read contracts. |
| Seed | Template bodies hold the clause libraries (`tpl-services-std`, new `tpl-works-std`); the two seeded executed contracts carry a delegate signature stamp and are locked. |
| Contract | OpenAPI now 87 operations (new: contract awards, change terms, delete; sign is now also open to the executive role). |

## Verification (all run on this machine)
| Check | Result |
| --- | --- |
| `npm run ci` (format, lint, typecheck, unit/API/DB tests, build) | exit 0, **467 tests** |
| Unit (`clauses.test.ts`, 7) | clause assembly fills all data and keeps every mandatory clause in library order; template picked by route; release rules; signing chain threshold; numbering |
| API (`contract.test.ts`, 14) | draft and refusals; works template for RFT; awards list; terms change; change tracking and deviation register; release rules; delegate signs with stamp and executes; `SIGNING_AUTHORITY_INSUFFICIENT` for a user with sourcing approval but no signing delegation and for a limit below the value (audited); executive co-signature; return to legal; 423 after execution and database refusal of direct changes; logical delete; lists and role access; seeded contracts |
| Browser tests | **168 pass** on the production build (3 new): legal drafts from the approved report, edits a clause, releases; the executive is not a signatory; the delegate signs, the contract locks and legal sees no edit buttons; accessibility (axe WCAG 2.1 AA) and no sideways scroll on a phone; 403 for people without a contracts role |
| `npm audit --audit-level=high` | no high or critical findings (a moderate esbuild advisory in drizzle-kit dev tooling remains) |

## Decisions and caveats
- The executive co-sign above 1,000,000 needs a `CONTRACT_SIGNING` delegation; the seed gives none (the existing rule that the executive has no signing authority was kept), so such a contract cannot be completed in the demo until one exists. There is no screen to manage delegations.
- Contract value comes from the request estimate unless entered; supplier bid prices are files, not data.
- Service levels in the contract quote the request deliverables text; no structured SLA data exists.
- The deviation register is derived from clause changes only; there is no approval of deviations and no variations (US-CON-05).
- Contract alerts are created on execution but not listed or sent (alert endpoints remain stubs); the mock e-signature is a stamp, not a certified signature (see swap points).
- The "sign" screen has no browser test for the return-to-legal path (API-tested only). No visual-regression baselines for the contract screens; a real-Postgres multi-connection test of the new trigger is still owed (PGlite only).

M10 complete. Next: **M11**, awaiting approval.
