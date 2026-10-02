# ADR-0012: Fargate for the monolith; Lambda for burst workers (target)

**Status:** Proposed (target only)  |  **Date:** 2026-10-02

## Context
Long-lived Node API fits containers; document generation/scoring bursts fit Lambda.

## Decision
ECS Fargate web/api/worker; Lambda later if needed.

## Consequences
+ Simple ops. - Pays for idle capacity.
