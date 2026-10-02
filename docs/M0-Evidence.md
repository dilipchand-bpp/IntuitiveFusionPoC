# M0 – Decisions, repo & spikes: evidence report

**Date:** 2026-10-02 · **Milestone DoD (plan §3 M0):** ADRs approved; spike conclusions with numbers; repo initialised with no secrets.

## Spike results (actually executed; scripts in `spikes/`, run with `node <file>`; PGlite 0.5.8, Node 24)
| Spike | Test | Expected | Actual | Result |
|---|---|---|---|---|
| A – score isolation (`spike-a-score-isolation.mjs`) | Evaluator 1 sees only own rows | 1 distinct evaluator | 1 | Pass |
| | Explicit query for evaluator 2's rows | 0 rows | 0 | Pass |
| | Insert as another evaluator | Blocked | Blocked | Pass |
| | Chair before / after consensus opens | 0 rows / all 20,000 | 0 / 20,000 | Pass |
| | Cost of RLS | small | 18.37 ms vs 17.62 ms per query (20k rows, ~4%) | Acceptable |
| B – audit chain (`spike-b-audit-chain.mjs`) | Throughput, change+audit in one tx | measure | 1,780 tx/s (single writer, in-memory) | Info |
| | Verify untouched chain (2,000 events) | valid | valid, 22 ms | Pass |
| | Tamper with row 1000 | detected at 1000 | detected at 1000 | Pass |
| | App role UPDATE / DELETE on audit | denied | denied / denied | Pass |
| | Audit step fails | business change rolled back | rolled back | Pass |
| C – PDF (`spike-c-sample.html` -> PDF via headless Edge) | Valid PDF, 2 pages (forced break), fonts embedded | yes | `%PDF-1.4`, 2 pages, 4 font files, 48 KB | Pass (structure) |
| | Visual fidelity | looks right | **Not eyeballed** (no PDF rasteriser on this machine); open `spikes/spike-c-sample.pdf` to check | Pending you |

**Caveats (honest limits):** PGlite is single-connection, so pooled-connection behaviour of RLS settings (must use `SET LOCAL` inside the transaction) is not proven yet - test scheduled in M3 against real Postgres in CI. Throughput numbers are in-memory/single-writer and are indicative only.

## Findings that changed the design
1. No Docker/Postgres on this machine -> ADR-0003 (PGlite locally, real Postgres service in CI); Architecture §4.1 amended.
2. RLS is cheap enough -> adopted as defence-in-depth for scores (ADR-0007).
3. Edge/Chrome headless suffices locally for PDF (ADR-0013).

## Artefacts
`docs/adr/0001…0014`, `spikes/`, `README.md`, `CLAUDE.md`, `.env.example`, `.gitignore`. Secret scan: no keys/passwords present (spikes contain no credentials; `.env` ignored).

## Decisions recorded
Owner approved tiers, no late-bid override, accent/fonts, folder rename (2026-10-02). Remaining defaults (Q-03/04/05/07/08/09) stand.

## Gate
Approve M0 to begin **M1 – Scaffold** (monorepo, tooling, CI).
