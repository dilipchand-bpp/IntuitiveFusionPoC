# ADR-0011: OpenAPI as contract; generated types/client; CI drift check

**Status:** Accepted (M0)  |  **Date:** 2026-10-02

## Context
Single source of truth for API.

## Decision
docs/api/openapi.json drives zod/types generation and contract tests; CI fails on drift. Redocly lint added in M1 CI.

## Consequences
+ No drift. - Generator tooling to maintain.
