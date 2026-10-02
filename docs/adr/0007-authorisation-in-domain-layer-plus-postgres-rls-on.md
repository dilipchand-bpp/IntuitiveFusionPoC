# ADR-0007: Authorisation in domain layer plus Postgres RLS on score tables

**Status:** Accepted (M0) - evidence: spikes/spike-a-score-isolation.mjs  |  **Date:** 2026-10-02

## Context
Spike A: RLS correctly isolated evaluators, blocked spoofed inserts, released rows to Chair only after consensus opens; cost ~4% (18.4 vs 17.6 ms over 20k rows).

## Decision
Primary enforcement in service layer (RBAC/ABAC/delegation/SoD) and RLS as defence-in-depth on score (and later bid-file) tables, with per-transaction set_config of app.user_id/app.role. Role x endpoint matrix test remains mandatory.

## Consequences
+ Forgotten WHERE cannot leak scores. - Must use SET LOCAL inside transactions with pooled connections (test added in M3); two places to reason about.
