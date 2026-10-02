# M4 – Identity (mock), RBAC/ABAC, delegation & route guards: evidence report

**Date:** 2026-10-02 · **DoD (plan §3 M4):** role x endpoint matrix test passes for all current endpoints; route guards on web; IdP swap documented in `docs/swap-points.md`.

## Built
- **Identity (mock behind a port):** `IdentityProvider` + `MockIdentityProvider` (argon2id, lockout 5 failures / 15 min, uniform failure, timing equalised for unknown accounts, MFA hook stub = never required).
- **Sessions:** server-side `session` table (migration `0002`), signed cookie `<id>.<hmac>`, idle timeout 30 min, absolute 8 h, revocation on logout, **separate cookie and pool for suppliers** (`if_supplier_session`), CSRF token derived from the session, rate limit on login / forgot-password.
- **Endpoints now real:** `POST /auth/login`, `/auth/logout`, `/auth/forgot-password`, `GET /auth/me`, `POST /auth/access-denied` (new; web guard reports blocked page visits). OpenAPI regenerated: **70 operations**.
- **Role guard from the contract:** every other operation in the OpenAPI is registered behind its real access rule and answers `501 NOT_IMPLEMENTED` ("coming soon") until its milestone, so the whole API surface has correct 401/403 behaviour already.
- **Authorisation library (pure, unit-tested):** ABAC (stream isolation for bid files, sensitivity restriction, org hierarchy, score visibility), segregation-of-duties rules, delegation-of-authority engine (sourcing vs signing are separate scopes).
- **Web:** `proxy.ts` route guard (Next.js 16), shared `ROUTE_RULES` + `ROLE_HOME`, plain-but-working `/login`, `/forbidden`, and placeholder `/app`, `/admin`, `/supplier` pages (replaced by the real shell in M5). Same-origin API via Next rewrite (no CORS).
- `docs/swap-points.md`: how to replace the mock identity provider.

## Tests actually run (local, Windows)
| Area | What | Result |
|---|---|---|
| **Matrix** | 70 operations x (12 roles + anonymous). 871 protected cases: anonymous -> 401 everywhere; each role allowed exactly where `x-roles` says, `403 FORBIDDEN` everywhere else | **Pass** |
| Matrix facts | runtime OpenAPI copy identical to `docs/api/openapi.json`; admin-only user admin, signContract = DELEGATE only, reopenPlan = PROCUREMENT only, consensus = CHAIR only, ADMIN excluded from every evaluation/score operation | Pass |
| Login | success sets HttpOnly SameSite=Lax cookie; unknown vs wrong password give identical response; input validated without echo; email normalised | Pass |
| Lockout | locked after 5 failures; correct password still refused while locked; unlocks after 15 min; counter resets on success; audited | Pass |
| Session | tamper/forged cookie rejected; idle timeout (30 min) with activity resetting it; absolute 8 h; logout revokes server-side; supplier cookie only valid as supplier session | Pass |
| CSRF | state-changing call without / with wrong / another session's token -> 403 `CSRF_INVALID` (and audited); correct token succeeds | Pass |
| Forgot password | identical 202 for existing and non-existing accounts | Pass |
| Rate limiting | 429 `RATE_LIMITED` after 10 attempts | Pass |
| Audit hygiene | login success/failure/lockout/denials recorded; neither password nor attempted email stored | Pass |
| ABAC / SoD / delegation | 25 unit + DB tests: technical evaluator never sees pricing; nobody sees bids before COI; ADMIN has no bid access; division heads see subtree; signing is separate from sourcing authority; threshold edits take effect immediately | Pass |
| Shared access table | every role's home page is permitted for that role; longest-prefix rules; `/administrator` is not treated as `/admin` | Pass |
| **E2E (real browser, real API, freshly seeded DB)** | anonymous -> login -> returned to original page; 6 roles land on their role home; requester at `/admin` gets 403 "Access denied"; supplier blocked from staff pages and staff from supplier area; logout ends session; cookie HttpOnly and invisible to scripts; client-side validation; generic error identical for wrong password vs unknown user; off-site `?next=` ignored; login page passes axe | **15 / 15 pass** |
| Whole suite | unit/API/DB `npx vitest run` | **197 / 197 pass** (15 files) |
| Whole suite | Playwright (incl. M1-M2) | **45 / 45 pass** |
| Gates | format, lint, typecheck, build (`npm run ci`) exit 0; `npm audit --audit-level=high` exit 0 | Pass |
| Coverage | overall 92% stmts / 83% branches; authz 97%; guard 96% | Meets ≥80% |

## Defects found and fixed during M4
1. The matrix's own `logout` call revoked each role's session mid-run (test ordering) -> logout is now last.
2. The first E2E runs failed with 429: the API correctly rate-limited the test suite -> a documented `LOGIN_RATE_LIMIT_MAX` setting (default 10) raised only for the e2e server.
3. E2E API server ran a stale compiled `@if/shared` -> e2e start-up now rebuilds it.
4. E2E picked up Next's empty route-announcer `role=alert` instead of the form error -> locator scoped to the form.
5. Email with surrounding spaces / capitals was rejected by validation -> trimmed and lower-cased before validation.
6. Prettier reformatted the runtime OpenAPI copy and broke the drift test -> excluded from Prettier.
7. Lint: import-type annotation, unused imports, side-effect expression.

## Not verified / caveats (honest)
- **MFA is a stub** (`mfaRequired()` always false); no UI step yet. SMS vs TOTP stays an open question.
- The mock "forgot password" sends nothing; the reset e-mail flow is a TODO for M5-M7.
- Web route guard is a UX layer; the **API enforces permissions independently** (proved by the matrix). The guard calls the API on every guarded navigation, which adds a request; acceptable for the POC.
- Audit trail of web-route denials is written but cannot yet be *viewed* in the app (audit search is M12); verified through the API integration test, not the UI.
- Still no real Postgres / multi-connection test (see M3 caveat).
- GitHub CI runs for M1-M4 not observed by me (private repo, no `gh`).
- The `/login` page is deliberately plain; branding, forgot-password screen and responsive polish are M5.

## Gate
Approve M4 to begin **M5 - App shell, landing page, login screen, dashboard frame** (the first screens you will want to look at).
