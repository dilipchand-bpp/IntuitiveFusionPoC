# ADR-0005: Deterministic mock AI; Bedrock in target; human gate always

**Status:** Accepted (M0)  |  **Date:** 2026-10-02

## Context
No data egress, repeatable tests; AI must never decide.

## Decision
MockAiProvider (rules + templates), UI badge 'Simulated AI', all AI output is a proposal logged to audit; progression needs a human action.

## Consequences
+ Deterministic, free, safe. - Does not validate real LLM quality/latency; stated in every demo.
