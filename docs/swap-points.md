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

## Planning, spend and experience (B9)

| | |
| --- | --- |
| Exchange rates (FR-0810) | Annual rates are entered by finance for the Australian financial year (July to June); the live mode reads `fx_rate` rows written by `POST /fx/refresh`, which draws a small, repeatable drift around the annual rate (`modules/b9/fx-rules.ts`). A real feed (a central bank or treasury service) writes the same rows with source `LIVE` |
| Guided buying and autonomous sourcing (FR-0820) | `scoreCandidates` weighs price 50%, supplier standing 30% and delivery 20%, from the approved catalogue (`catalogue_item`). Labelled `rules-simulated-v1`. A model or a punch-out catalogue (a supplier's own shop) replaces `matching` and the catalogue read; the platform still only drafts a request, and a person decides |
| Spend optimisation and future commitment (FR-0840, FR-0845) | Rules in `modules/b9/analytics-rules.ts` (consolidation, duplicate contracts, rate-card gaps, price variance, ceilings, ranges and unknowns). A model or a spend-analytics product replaces them; the saving figures are estimates either way |
| Analytics store (NFR-P05) | A second in-memory database (`analytics/store.ts`) refreshed from the main one on a timer and on demand. A real warehouse (a read replica, or a columnar store) takes its place; only the new analytical reports read from it, the older dashboards still read the main database |
| Later-stage artefacts (FR-0870, NFR-P02) | The evaluation report and the contract management plans are generated by rules; `modules/b9/artefacts.ts` decides when (at once, in a batch, or on request). A model replaces the generators, and the batch interval is what keeps its cost down |
| Search with an outside source (FR-0880) | `SimulatedExternalSearch` in `modules/b9/search.ts` answers from a small synthetic corpus. A real provider is called through the organisation's gateway; `sanitise` strips reference numbers, ABNs, email addresses, amounts and supplier names first, and every outbound question is logged in `external_search_log` |
| Mobile (FR-0825) | An installable web app (manifest, service worker for static files only, an offline page). A native app for the Apple and Google stores would wrap the same API with a native shell |
| White labelling (FR-0855) | The product name, tagline, palette and support address come from the `branding` setting and the five palettes in `packages/ui/src/theme.ts`. A deployment for another organisation sets these and replaces the logo files |

## Integrations and the AI layer (B10)

Everything below is simulated, labelled so on screen, and sits behind the connector layer (`modules/b10conn`): a connector per kind and provider, a local secret store, one resilient call path (timeout, retries, circuit breaker, fallback), signed delivery with retry and reconciliation, and a manual task when a system is down.

| | |
| --- | --- |
| Connector catalogue (NFR-C07) | `connector` table and `modules/b10conn/catalogue.ts`; every provider is simulated and the UP or DOWN mode is a demonstration switch. Real adapters per provider (SAP, Oracle, Dynamics, DocuSign, Adobe, SharePoint, middleware platforms) register in the catalogue; configuration holds only secret names |
| Secret store (SEC-N03) | `readSecret(tx, tenantId, name)` in `modules/b10conn/secrets.ts`; a local AES-256-GCM table with the key from `SECRET_STORE_KEY` (required in production). AWS Secrets Manager or a vault goes behind the same function, with rotation by its own rotation functions |
| Resilient provider layer (NFR-C05) | `callProvider` in `resilience.ts`; `SimulatedSanctionsProvider` and `SimulatedInsuranceProvider` in `providers.ts`. A provider that is down gives UNVERIFIED, never CLEAR. A real screening and insurance service replaces the providers; callers keep only the `callProvider` result |
| Delivery, retry and reconciliation (NFR-AV03) | `integration_event` with a backoff schedule, six attempts then `DEAD_LETTER`, and `sync_run` reconciliation against a simulated receiver. A queue with a dead-letter queue and the middleware's own receipts replace it |
| Middleware leg security (SEC-TP04) | HMAC-SHA256 over timestamp and sorted-key body in `X-IF-Signature` and `X-IF-Timestamp`, a five-minute window, replay refused by event id. The same contract on the real middleware leg, with the secret from the secret store and a gateway in front |
| Manual fallback (NFR-AV04) | `manual_task` rows when a delivery fails, completed with a reference, superseded when a replay succeeds. The same table can raise tickets in a service desk tool |
| ERP sync (NFR-C02) | `fetchErpSource(provider, revision)` in `modules/b10erp/erp-source.ts` returns each provider's native payload; three mappers (SAP, Oracle, Dynamics) normalise it; the importer upserts by external id. Replace `fetchErpSource` with the real API; imported budget lines remain the offline copy |
| Legal system webhook (NFR-C03) | `POST /integrations/legal/events`, signed, idempotent by event id; outbound matter status through the connector. A real legal platform is configured to call the endpoint, or a middleware sits in front. `/integrations/legal/simulate` is the demonstration sender |
| HR feed (FR-0815) | `fetchHrBatch` in `modules/b10erp/hr-feed.ts` (synthetic batches); `applyHrEvent` rules are fixed (no administrator or supplier grant from the feed, delegation capped at the delegator's own limit). A worker feed from the HR system, or SCIM provisioning for starters and leavers, replaces it |
| Payments (FR-0875) | PAYMENTS connector: a signed payment order out, a signed confirmation back at `/integrations/payments/confirmation`. The bank or ERP accounts-payable payment API calls the same callback |
| E-signature (NFR-C04) | `EsignAdapter` in `modules/b10x/esign-adapters.ts` (DocuSign and Adobe payload shapes), chosen by the ESIGN connector; callbacks arrive through the signed webhook and reach the signature chain only through the normal sign route. DocuSign eSignature and Connect, or Adobe Acrobat Sign, replace the adapters |
| Document repository (NFR-C06) | `repo_document` (one row per version) behind `modules/b10x/docrepo.ts`, with If-Match concurrency. SharePoint through its drive API replaces it, with the ETag mapped to If-Match |
| Continuity messages (FR-0860) | `simulatedGateway` in `modules/b10x/continuity.ts` through the MESSAGING connector; one-time response links stored hashed. SMS and email services with delivery-receipt webhooks replace the gateway |
| AI model registry (NFR-C01, NFR-M06, SEC-TP07) | `AiModel` in `modules/b10ai/models.ts`: `rules-simulated-v1` (built in) and two deterministic third-party style models. A third-party model must be approved by two different people (the second PROBITY or EXEC) before it can be active; revoking falls back to `rules-simulated-v1` at once. A model hosted in the customer's region replaces a simulated one; its data-handling profile must be truthful, and its output stays a proposal that a person decides |
| Configuration portability (NFR-M05) | Export and dry-run import of every settings section, no secrets (`modules/b10ai/config-inventory.ts`). A promotion pipeline between environments uses the same files |
| Browser baseline (NFR-C08) | `packages/shared/src/baseline.ts`, re-judged on the server; sign-in is never blocked. Client hints or real-user monitoring could replace the user agent check |
| Performance measurement (NFR-P04) | `perf_sample` with a monotonic timer (`modules/b10ai/perf.ts`). Tracing or an APM product feeds the same summary |
