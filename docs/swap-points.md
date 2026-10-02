# Swap points: replacing the mocks

Everything external is behind an interface so the proof of concept can be upgraded without touching callers (ADR-0004).
This page lists the swap points that exist **today**; later milestones append to it.

## Identity provider (M4)

| | |
|---|---|
| Interface | `IdentityProvider` in `apps/api/src/auth/identity-provider.ts` |
| Mock | `MockIdentityProvider`: email + password (argon2id) against `app_user`, lockout after 5 failures for 15 minutes, uniform failure response, timing equalised for unknown accounts |
| Selected by | `IDENTITY_PROVIDER=mock` (config) and `AppDeps.idp` override |
| Production candidates | Amazon Cognito (staff federated via SAML/OIDC; **separate user pool for suppliers**, SEC-A03), Microsoft Entra ID, Okta |

**What a real adapter must provide**

1. `authenticate(email, password)`: for OIDC this becomes "exchange the authorisation code" and the method signature changes to take the callback result. Callers only use the returned `AuthenticatedUser`, so only `POST /auth/login` (and a new `/auth/callback`) change.
2. `loadUser(userId)`: resolve roles and org unit (from IdP groups/claims mapped to `ROLE_NAMES`, or from `role_assignment`).
3. `requestPasswordReset(email)`: delegate to the IdP's own reset flow; must behave identically whether or not the account exists.
4. `mfaRequired(user)`: return `true` when the IdP step-up applies. The mock never requires MFA; the UI step is not built yet (TOTP preferred over SMS, open question SEC-A01).

**What stays the same:** server-side `session` rows (idle 30 min / absolute 8 h / revocation), signed `if_session` / `if_supplier_session` cookies, CSRF token, audit events, the role guard, and every route's `x-roles` contract.

**Production hardening checklist for the swap:** `NODE_ENV=production` (Secure cookies, trusted proxy), real `SESSION_SECRET` from Secrets Manager, rate limit behind the load balancer's client IP, remove `SEED_PASSWORD` and the seed command from deployment.

## Authorisation (M4): not a swap point, but configurable

- Which roles may call which operation lives in **one place**: `x-roles` in `docs/api/openapi.json` (copied to `apps/api/openapi.json`, drift-tested).
- Which roles may open which web page lives in `ROUTE_RULES` in `packages/shared/src/access.ts` (used by the web route guard and tested against the same role list).
- Delegation limits are **data** (`delegation` table, edited by an Administrator), not code.

## AI assistant (M6)

| | |
|---|---|
| Interface | `AiProvider` in `apps/api/src/adapters/ai-provider.ts`: `draftRequest({text, current, pending}) -> {changes, reply, stillMissing}` |
| Mock | `MockAiProvider` (`mock-rules-v1`): deterministic rules in `modules/intake/extract.ts`; always `simulated = true` and shown to users as "Simulated AI" |
| Production candidate | Amazon Bedrock in-region via VPC endpoint (ADR-0005) |

**Contract a real model adapter must keep:** it returns *proposals only*. The service stores every change as AI-drafted (`source=AI`, `aiDrafted=true`), writes an audit event, never overwrites narrative a person wrote, and never changes request state (submit/approve are human actions). Free-text from users and suppliers is **data, not instructions** (tested: pasted instructions change nothing). A real adapter needs input/output guardrails and size limits on top.

## Finance / ERP budget check (M6)

| | |
|---|---|
| Interface | `ErpBudgetService.check({tenantId, businessUnit, amount, settings?})` in `adapters/erp.ts` |
| Mock | `MockErpBudgetService`: per-business-unit budgets and an `erpOutage` switch come from tenant config (`settings`, read by the caller inside its own transaction) |
| Behaviour | `CLEARED`, `EXCEEDED` (hard cap blocks with 422; soft cap adds an escalation gate), `UNAVAILABLE` (adds a manual-confirmation gate; submission still works, NFR-AV04) |

**Real adapter notes:** ignore `settings`; call the ERP with a timeout, and map errors to `UNAVAILABLE` rather than throwing. Do not issue extra database queries from inside an adapter that runs within a request transaction (single-connection PGlite deadlocks; a pooled Postgres would hold a second connection).

## Still mocked, adapter arrives in a later milestone

| Dependency | Interface | Milestone |
|---|---|---|
| E-mail / notifications | `EmailService` (outbox table) | M5-M7 |
| Document storage | `DocumentStore` | M8 |
| Sanctions / insurance | `SanctionsService`, `InsuranceVerificationService` | M8 |
| E-signature | `ESignatureProvider` | M10 |
