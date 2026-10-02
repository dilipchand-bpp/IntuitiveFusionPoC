# ADR-0014: Monolith keeps a 'Coming soon' contract for stubbed features

**Status:** Accepted (M0)  |  **Date:** 2026-10-02

## Context
Brief requires stubs never blank.

## Decision
GET /features/{key} + shared ComingSoon component listing requirement IDs; every S-tier requirement has a TODO(FR-xxxx) marker; reconciled by script in M14.

## Consequences
+ Honest, traceable stubs. - Marker hygiene.
