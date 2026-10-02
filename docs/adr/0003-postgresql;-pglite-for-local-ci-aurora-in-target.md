# ADR-0003: PostgreSQL; PGlite for local/CI, Aurora in target

**Status:** Accepted (M0) - amends Architecture §4.1 (Docker -> PGlite)  |  **Date:** 2026-10-02

## Context
Windows dev machine has no Docker or Postgres. Spikes A and B ran on PGlite (real Postgres in WASM) incl. roles, RLS and transactions.

## Decision
Use PostgreSQL features only (no vendor-specific ones). Local/dev/CI use PGlite; production-like envs use Postgres 16 / Aurora PG via the same Drizzle schema. A Postgres service container is added in CI to run the integration suite on real Postgres as well.

## Consequences
+ Zero install, identical SQL. - PGlite is single-connection; pool/concurrency behaviour only verified on real Postgres in CI.
