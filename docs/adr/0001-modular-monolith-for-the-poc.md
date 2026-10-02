# ADR-0001: Modular monolith for the POC

**Status:** Accepted (M0)  |  **Date:** 2026-10-02

## Context
Register BRS proposes serverless microservices; POC needs fast end-to-end slices and a simple local run.

## Decision
Single deployable Node API with strict module boundaries (own service interface, no cross-module table access, domain events via outbox).

## Consequences
+ Simple to run/test/debug; transactional audit. - Not independently scalable; discipline needed on boundaries. Extraction path kept (ADR-012).
