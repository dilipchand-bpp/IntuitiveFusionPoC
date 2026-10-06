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

## Bid file storage and virus scan (M8)

| | |
|---|---|
| Storage | `SealedStore` in `modules/tender/files.ts`: AES-256-GCM, key derived (HKDF) from the server secret, objects under `STORAGE_DIR/<tenant>/<submission>/<uuid>`. Stands in for S3 + KMS (SSE-KMS, per-tenant key) |
| Virus scan | `scanBytes()` stub: flags only the standard EICAR test string. A real adapter calls an AV service (for example an S3 object-scan Lambda) and keeps the same `CLEAN` / `INFECTED` result |
| Upload checks (kept in production) | allow-list of extensions, 10 MB cap, content ("magic byte") check, double-extension and path-trick refusal, 20 files per bid |
| Database seal | Row level security on `file_object` (migration 0003): the owning supplier, and after close only the evaluating roles, can read; administrators never |

**Real adapter notes:** upload by pre-signed URL straight to the bucket rather than through the API, then scan before the file is marked `CLEAN`; keep the receipt checksum (`sha256`) so a bid can be proved unchanged.

## Supplier registration, invitation e-mail and ABN (M8)

| | |
|---|---|
| Invitation e-mail | Simulated. The one-time registration link is returned once to the buyer who created it (only its SHA-256 is stored) and an `invitation.queued` audit event is written at publish. A real `EmailService` sends the link instead |
| ABN | Checked with the official 11-digit checksum only (`validAbn`). A real adapter would also look the number up in the ABN Lookup service |
| Sanctions / insurance | Registered suppliers start with `sanctionsStatus = PENDING`; no screening provider is called yet |
| Existing company | An ABN already in the directory cannot be joined by self-registration (it would expose that company's tenders). The buyer adds extra contacts after checking them (flow not built yet) |

## Still mocked, adapter arrives in a later milestone

| Dependency | Interface | Milestone |
|---|---|---|
| E-mail / notifications | `EmailService` (outbox table) | M5-M7 |
| Document storage | `DocumentStore` | M8 |
| Sanctions / insurance | `SanctionsService`, `InsuranceVerificationService` | M8 |
| E-signature | `ESignatureProvider` | M10 |

## E-signature (M10)

| | |
| --- | --- |
| Today | Mock: signing is an authenticated, authority-checked click that stores an approval stamp (name, role, UTC time) in `approval` (subject type CONTRACT). Not a certified or legally verifiable signature |
| Swap | Replace the stamp creation in `modules/contract/routes.ts` (`POST /contracts/{id}/sign`) with a call to an e-signature provider (for example DocuSign or Adobe Acrobat Sign); keep the signing-authority check and the lock-on-execution step |

## Email delivery of alerts (M11)

| | |
| --- | --- |
| Today | Alert emails are recorded in `alert_delivery` with status SIMULATED; nothing leaves the server. The in-app notification is real |
| Swap | Replace the EMAIL branch in `AlertService.runDue` (`modules/contract/record.ts`) with a mail provider (for example Amazon SES) and record DELIVERED or FAILED; keep the compare-and-set that makes each alert fire once |

## Manager lookup for custom alerts (M12b)

| | |
| --- | --- |
| Today | "Include my manager" resolves to the nearest delegate or executive in the person's organisation unit, else any delegate: the proof of concept has no reporting lines |
| Swap | Replace `resolveManager` in `modules/contract/record.ts` with a lookup against the identity provider or HR system, keeping the rule that it is resolved when the alert fires |


## Roadmap batch B1: what is real and what is simulated

| Capability | Status | Swap point |
|---|---|---|
| Authenticator-app codes (SEC-A01) | **Real.** RFC 6238 time-based codes (SHA-1, 30 s, 6 digits) checked against the published test vectors; secrets stored encrypted (AES-256-GCM, key derived from the server secret); a code works once; the password-then-code step issues no session until the code is right | None needed. When an enterprise identity provider performs MFA itself, single sign-on sessions already skip the second step (`authMethod = SSO`) |
| Single sign-on (SEC-A02) | **Simulated provider, real validation.** `POST /auth/sso/simulate` plays the identity provider and issues an HS256 ID token for a demo person (refused when `NODE_ENV=production`). `POST /auth/sso/callback` checks signature, issuer, audience, expiry and nonce, then requires an existing active account (it never creates accounts) | Replace `simulate` with a redirect to the organisation's OIDC authorisation endpoint (state and nonce kept in a short-lived cookie); replace the HS256 check in `verifyIdToken` with the provider's published keys (JWKS, RS256) and discovery; keep every other check and the callback route as they are |
| Step-up for approvals (SEC-A04) | **Real.** When `security.stepUpApprovals` is on, plan approval, report approval, contract signing, permission to publish and process-change approval need a fresh authenticator code in `x-step-up-code`; the web client asks for it with a browser prompt | Replace the prompt with a proper modal; a push-approval provider could replace the code check |
| Notification channels (FR-0065) | **In-app is real; email, Slack and Teams are simulated.** `dispatch()` writes the in-app notification and one `notification_delivery` row per other channel saying what would have been sent | Replace the delivery step in `modules/notify/dispatch.ts` with the real senders; the rules, escalation and audit stay |
| ERP field names (FR-0700) | **Real mapping, no ERP behind it.** `mapRecord()` renames fields both ways from the configured table; the admin screen tries it on a sample record | Call `mapRecord` in the ERP adapter on every inbound and outbound record |
| Classification, review rules, contract-text extraction (FR-0015, FR-0030, FR-0675) | **Deterministic rules standing in for a language model.** Same input, same answer; every result shows its reason | `AiProvider` (as for the assistant); the review step and audit stay |
| Supplier ABN (migration, FR-0655) | A migrated supplier with no ABN gets 00000000000 and sanctions `PENDING` until someone checks | ABN lookup (as in supplier registration) |

## Tender and supplier portal (B2)

| Item | Today | Swap |
| --- | --- | --- |
| Tender and supplier email (FR-0195) | `modules/notify/email.ts` `sendEmail` writes `outbound_email` rows; nothing leaves the server; one-time links are never logged | Replace the write with a real mail sender; the kinds, recipients and audit stay |
| Sanctions screening (FR-0180) | `adapters/sanctions.ts` `MockSanctionsScreening` matches a synthetic watchlist ("blocked holdings", "sanctioned trading", "embargo exports") | Implement `SanctionsScreening` against a screening provider; hold, review and audit stay |
| Public registers (FR-0205) | Notices are recorded in `public_notice` with the thresholds in settings; nothing is posted | Post to AusTender, SAM.gov or TED and store the returned notice number |
| Insurance (FR-0245) | Details only (insurer, policy, cover, expiry); no certificate file | Add a certificate upload and, optionally, an insurer verification call |

## Evaluation and report (B3)

| Item | Today | Swap |
| --- | --- | --- |
| Plain-language scores and rankings (FR-0315) | `evaluation/plain-language.ts`: fixed rules read a sentence into scores or an order, shown for confirmation before anything is saved; no network call | Replace `readScores` and `readOrder` with a language model; the confirmation step, validation and audit stay |
| Negotiation recommendations (FR-0295) | `evaluation/commercial.ts` `adviseNegotiation`: rules over pricing, deviations and insurance against the other bids; every item states its basis; labelled `rules-simulated-v1` in the response | Replace with a model fed the same inputs and a category or market benchmark source |
| Compliance gate checks (FR-0265) | Registration (ABN, screening), declarations (flagged onboarding answers), insurance status and response completeness, from data the platform already holds | Add checks that call an external registry or insurer; the gate rows, waivers and clarification requests stay |
| Supplier clarification and offer notices | In-app notification plus a simulated email (`CLARIFICATION`, `BAFO` kinds in the email log) | The real mail sender, as for the other tender emails |
| Probity advisor identity (FR-0310) | An external advisor is a user flagged `external` with the probity role; the API refuses every route outside sign-in, notifications, evaluations and probity, and evaluations outside their allocation look like they do not exist | Single sign-on for the advisor's own organisation; the allocation table and the route allow-list stay |
| Probity documents (FR-0340) | Authored text exports to PDF and Word with a sign-off stamp; an uploaded file is stored sealed with its hash | Electronic signature for the sign-off stamp |
| Bid pricing (FR-0280, FR-0350) | Entered by the supplier as price, implementation and running cost, held beside the bid and sealed until close; total cost of ownership is computed on the platform | Read the pricing from the supplier's commercial file or a pricing template |

## Contract award and legal (B4)

| Item | Today | Swap |
| --- | --- | --- |
| Vendor register, tax and financial risk (FR-0415, FR-0440) | `adapters/vendor-registry.ts` `MockVendorRegistry`: any supplier with a valid ABN is "registered" under the name it gave; a few synthetic names (dissolved, in administration) fail so the failure paths can be shown | Implement `VendorRegistry` against the business register, the tax authority and a credit-risk provider; the checks, reviews and locks stay |
| Banking verification (FR-0415) | Details the supplier enters are checked for format and for the account name matching the legal name; no bank is called | Verify the account with a bank-account verification service or the ERP's vetted vendor record |
| Contract risk summary, deviation explanations and negotiation strategy (FR-0450, FR-0475, FR-0485) | `contract/b4-rules.ts`: fixed rules over the contract, its checks, the bids and the legal knowledge base; labelled `rules-simulated-v1` | Replace with a language model given the same inputs and the knowledge base; legal's review and edit step stays |
| Signing invitations and reminders (FR-0445) | In-app notifications plus simulated email (`SIGNING_INVITATION`, `SIGNING_REMINDER`); the supplier reads the contract in its portal | The real mail sender; an e-signature provider for external signing |
| Signing modes (FR-0425) | Blind and staged signing are enforced by the platform; signature-block positions come from the template | Pass the positions to an e-signature provider |
| Time-bound access (FR-0435) | Grants are checked and ended whenever they are read (no background job); only the contract and report PDFs are shared | Extend to document repositories; add a nightly sweep so ends are audited even if nobody reads |

## Contract management feeds and models (B5)

| | |
| --- | --- |
| ERP purchase orders and invoices | `POST /contracts/{id}/purchase-orders` and `/invoices` are the simulated feed. A real ERP integration posts the same records (or a connector writes the `purchase_order` and `invoice` tables); the three-way match, the spend-ceiling guard and the spend notices run unchanged. The guard is off when `contractManagement.erpIntegrated` is false |
| Alert channels | In-app is real; email, SMS and Slack are recorded in `alert_delivery` as `SIMULATED`. A real sender reads those rows |
| Insurance certificates | The supplier enters the certificate in its portal; the monitor (`modules/contract/compliance.ts`) reads `supplier.insurance_expires_on`. A real source would be a certificate-of-currency service |
| Clause trigger extraction, next-step suggestions, plan risk tiers | Fixed rules in `b5-rules.ts`, labelled `rules-simulated-v1`; a model replaces the functions `extractTriggers`, `nextSteps`, `planTier` |
| Public register | The disclosure task records the reference a person types; no register is called |

## Reporting and collaboration models and feeds (B6)

| | |
| --- | --- |
| External risk feeds | `supplierSignals` in `modules/reporting/b6-rules.ts` simulates weather (seasonal by state), financial distress (the vendor registry reading) and a geopolitical watchlist. A real adapter reads provider feeds and returns the same signals |
| Language understanding | `parseQuestion`, `parseAdvance`, `parseCommittee`, `parseTemplateChange` are fixed grammars; a model replaces them and keeps the interpretation read-back |
| Drafting help | `candidateRisks`, `summariseChanges`, the response summaries and `generateReference` are rules; a model replaces them (reference content stays inside the approved boundary) |
| Concurrent editing | Section revisions and a heartbeat; a real-time channel would carry the same presence and conflict messages |

## Ask AI, tender, contract and supplier intelligence (B7, B8)

| | |
| --- | --- |
| The Ask AI assistant (FR-X01) | `modules/assistant/rules.ts`: `classify` reads the question and `answer`, `attentionReply`, `reviewReply` and `authorityReply` build the reply, from the portal's own route rules and the person's own data. Labelled `rules-simulated-v1`. A language model replaces `classify` and the reply builders; it must be handed only what the person may see (the facts the route gathers) and keep the links filtered by `canOpen` |
| Insurance certificate reading (FR-0185) | `readCertificate` in `modules/b8/rules.ts` reads the text layer of a document for limit, expiry, insurer and policy number. A real text-recognition or document-intelligence service replaces it and returns the same `CertificateReading`; a certificate it cannot read is never trusted, and the supplier enters the details by hand |
| Enterprise legal platform (FR-0390) | `adapters/legal-platform.ts` `SimulatedLegalPlatform` opens a matter and returns a reference; `modules/b8/integration.ts` keeps every outgoing event so a failed delivery can be retried. Inbound, `POST /integrations/legal/webhook` verifies an HMAC-SHA256 signature over the sorted-key JSON body with the shared secret in `settings.legalPlatform`, and ignores an event id it has seen. A real adapter implements `LegalPlatformGateway`; the secret moves to a secret store (batch B10) |
| Supplier risk, resilience and ESG score (FR-0800) | `scoreSupplier` weighs ratings, the platform financial reading, simulated weather and watchlist signals, compliance records and what the supplier declared. Replace the signal sources with provider feeds; the factors, weights and recommendations stay. The modern slavery screen (`modernSlaverySignal`) is a category rule; a real screen calls a supply-chain risk service |
| Duplicate detection, lessons recall, legal edit parsing (FR-0795, FR-0805, FR-0830) | `findDuplicates`, `recallLessons` and `parseLegalEdit` are rules; a model replaces them and keeps the read-back and the preview (`apply: false`) |
| Approval links (NFR-U05) | A link is a one-time token (only its hash is stored) delivered in the approver's own notifications. It never appears in the email log or in anything the sender can read. A real mail sender would put it in the email; the decision still goes through the normal decision route, so every limit applies |
| Outside counsel portal (FR-0830) | A one-time link scoped to one contract; the page shows clause wording only and accepts proposed wording, never a change. A law firm's own system could post redlines through the legal platform webhook instead |
