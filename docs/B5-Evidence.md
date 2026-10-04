# Roadmap batch B5 - evidence

**Batch:** B5, contract management. 18 stubbed requirements delivered (list: `_work/delivered.json`, key `B5`; each is cited by an automated test): FR-0495, FR-0500, FR-0510, FR-0515, FR-0520, FR-0525, FR-0530, FR-0535, FR-0540, FR-0545, FR-0550, FR-0555, FR-0560, FR-0565, FR-0570, FR-0575, FR-0580, FR-0585.

## What was built
| Area | Requirements | Result |
| --- | --- | --- |
| **Spend-ceiling guard** | FR-0495 | Where the ERP is integrated (a setting), a requisition that takes commitments above the contract limit (or a work order's value) is blocked, recorded as a blocked purchase order and audited. |
| **Three-way match** | FR-0500, FR-0525 | An invoice is matched to its purchase order and the contract rate card. An unapproved price increase, an item not on the card or the order, more than was ordered, or no order at all blocks it; finance releases it as a recorded exception with a reason. Price escalation (scheduled, or index-linked up to a cap) is applied from its effective date; an escalation applied early or above the formula is blocked. |
| **Rebates** | FR-0520 | Rebate terms (rate on period spend above a threshold). Once a period ends, a rebate earned and not claimed, or part-claimed, is flagged once with a notice to finance and the owner; claims are recorded. |
| **Compliance hold** | FR-0550 | The platform watches supplier insurance. Lapsed cover places a hold that refuses new purchase orders; a current certificate in the supplier portal lifts it by itself. All audited. |
| **Fixed alerts** | FR-0510 | 180, 90 and 60 days before expiry and before the extension decision closes; 30 days before a certificate expires; spend notices at 80, 90 and 100 per cent. Not configurable and refused if a user tries to mute them (422); other alert kinds can be muted per person. |
| **Custom alerts** | FR-0515 | Plain-language alerts now choose channels (in-app, email, SMS, Slack, the last three simulated) and an assigned owner. |
| **Alerts from clause wording** | FR-0530 | Notice periods, review cycles and yearly duties are found in the clauses by fixed rules and proposed; nothing is scheduled until a person confirms. |
| **Variations** | FR-0535, FR-0540, FR-0545 | Each variation logs a business case and a variance, as a numbered sub-record (CT-...-V1). Cumulative or incremental model by setting; the signing authority is re-evaluated when the value tier changes. For public-sector customers a change over the threshold creates a register disclosure task. |
| **Plans** | FR-0555 | A contract management plan and a risk plan are filled in automatically for high-value or high-risk contracts (a tier from value, term, supplier risk, insurance, deviations); activities scale with the tier; the customer's own template can replace the standard one. |
| **My contracts** | FR-0560 | A contract manager sees only the contracts of their own team and the teams beneath it; search with rule-based next-step suggestions as the end date approaches. |
| **Lineage and links** | FR-0565, FR-0570 | Variation count, extensions taken up and left, cumulative value, historic versions; a renewal, variation or extension starts a new procurement number linked to the contract and shown in the pipeline (not a tender). Variations can also get their own procurement number (setting). |
| **Master agreements** | FR-0575 | Work orders under a master agreement within its value and term, with spend at both levels and a report. |
| **Live spend** | FR-0580 | Progress bars for spend, term, payment and commitment from invoice and payment data; a configured percentage alert besides the fixed ones. |
| **Funding envelopes** | FR-0585 | A delegate approves an envelope within their delegated authority; nominated people approve commitments; the holder is warned as it nears exhaustion; top-up needs authority again. |

## Defects found and fixed along the way
- Default contract owner was "any contract manager" by row order; with team-scoped access that hid contracts. It is now the longest-serving one.
- Changing a contract's owner returned 404 to the person who had just given it away; it is now read back without the team filter.
- The dashboard alert count counted the expiry reminder and the fixed countdown twice on the same day; it counts once per contract and day.
- A removed variation's number could be reused; numbering counts every variation ever raised.
- The pipeline board had no column for the contract phases; added, so linked procurements show.

## Verification (run on this machine)
| Check | Result |
| --- | --- |
| `npm run ci` (format, lint, typecheck, tests, build) | exit 0, 737 tests; 44 new API tests (`b5.test.ts`, `b5-rules.test.ts`); 297-operation authorisation matrix passes |
| Browser tests | 8 new in `e2e/b5.spec.ts`, each with an accessibility scan; full suite 245 passed, 10 skipped, 2 failed on the first run: one real defect (a linked renewal counted as off-contract spend, fixed and re-run green) and the known login-page hover colour flake |

Existing tests changed on purpose: the alert-kind list and notification count in `management.test.ts` (the fixed countdown adds alerts), and the owner-change test in `extras.test.ts` (the earlier owner no longer sees the contract).

## Not done / caveats
- Purchase orders and invoices are entered through the platform: they stand in for the ERP feed (docs/swap-points.md). SMS and Slack delivery, the clause "AI" extraction, next-step suggestions and plan risk reading are fixed rules, labelled `rules-simulated-v1`.
- A hold and the sweeps run when alerts are read and on the scheduler; there is no separate job runner.
- A contract that is not yet executed is visible to all contract readers; the team filter applies to executed contracts and their variations.
