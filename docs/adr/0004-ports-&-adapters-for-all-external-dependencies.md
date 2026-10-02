# ADR-0004: Ports & adapters for all external dependencies

**Status:** Accepted (M0)  |  **Date:** 2026-10-02

## Context
Mock-now/real-later for IdP, AI, ERP, sanctions, e-sign, storage, email, clock.

## Decision
Each dependency is an interface in packages/shared with a mock adapter and a shared contract-test suite that real adapters must also pass.

## Consequences
+ Clear swap points, testable time/failures. - Interface upkeep.
