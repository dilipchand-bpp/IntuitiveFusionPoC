# ADR-0006: Audit in-transaction, append-only, hash-chained

**Status:** Accepted (M0) - evidence: spikes/spike-b-audit-chain.mjs  |  **Date:** 2026-10-02

## Context
Probity/auditability (SEC-L01..L05). Spike B: 1,780 tx/s single writer, tamper detected at exact row, app role cannot UPDATE/DELETE, audit failure rolls back the business change.

## Decision
Audit row written in same tx as the change; DB grants INSERT/SELECT only; sha256 chain; periodic verifier job.

## Consequences
+ Strong evidence, fail-closed. - Write overhead; chain serialises writers per tenant (acceptable at POC; shard by tenant/day in prod).
