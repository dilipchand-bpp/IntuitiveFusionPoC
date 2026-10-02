# ADR-0010: Session cookies + CSRF token (BFF style)

**Status:** Accepted (M0)  |  **Date:** 2026-10-02

## Context
Avoid tokens in browser storage (XSS).

## Decision
HttpOnly SameSite=Lax Secure cookie; X-CSRF-Token on mutations; supplier and staff cookies distinct.

## Consequences
+ Safer storage. - Cross-site embedding needs extra work.
