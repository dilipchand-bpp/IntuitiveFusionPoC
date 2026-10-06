# Roadmap batch B10 - evidence

**Batch:** B10, integrations and the AI layer. 19 requirements delivered (list: `_work/delivered.json` key `B10`; each is cited by an automated test). Every external system is simulated, labelled so on screen, and has a documented swap point in `docs/swap-points.md` ("Integrations and the AI layer (B10)").

## What was built
| Area | Requirement | Result |
| --- | --- | --- |
| **Connector catalogue** | NFR-C07 | `/app/connectors`: the supported connectors by kind (HR, ERP, legal, e-signature, sanctions, insurance, document repository, messaging, payments, middleware, AI) and provider (SAP, Oracle, Dynamics, DocuSign, Adobe, SharePoint and others), with this organisation's choice, health, and a demonstration switch to take one down. Configuration holds secret names only. |
| **Secret store** | SEC-N03 | Local AES-256-GCM store with versions and rotation; values are never returned, only name, version and fingerprint. The legal platform's shared secret now lives here. Production needs `SECRET_STORE_KEY`. |
| **Resilient providers** | NFR-C05 | One call path with timeout, retries, a circuit breaker and a fallback. Sanctions and insurance checks use it: when a provider is down the supplier is shown as unverified, never clear. |
| **Delivery and reconciliation** | NFR-AV03 | Outbound events retry with backoff (1, 5, 15, 60, 240 minutes), then dead-letter and stay visible; inbound events are idempotent by event id; reconciliation finds what the remote side never acknowledged and resends it once. |
| **Middleware security** | SEC-TP04 | Signed in both directions (HMAC-SHA256 over timestamp and body), a five-minute window, replay refused; tampered, wrongly signed, stale and replayed messages are tested. |
| **Manual fallback** | NFR-AV04 | When the legal, ERP or other system is down, the work is queued as a manual task with instructions and completed with a reference; a later successful replay supersedes it. The user's own work is never lost. |
| **ERP sync** | NFR-C02 | `/app/erp`: budgets, cost centres, organisation units and ledger from three simulated ERPs with different native shapes, normalised by three mappers; idempotent upsert with added, changed and removed counts. The intake budget check prefers an imported budget line and says where its answer came from. |
| **Legal system sync** | NFR-C03 | Signed inbound events (stage changes, documents, matter closed), idempotent, with retry and dead letter; a demonstration sender; the matter's stage and history on the contract page. |
| **HR feed** | FR-0815 | `/admin/hr-feed`: starters, leavers, role changes and delegate changes applied from a simulated feed, with a dry run. The feed can never grant administrator rights or raise a delegation above the delegator's own limit; a leaver's open work is flagged to a backup. |
| **Payments** | FR-0875 | A matched invoice can be paid through a simulated finance system: finance creates, a different person approves, no double payment, part payments tracked, signed confirmation back; a down connector holds the payment rather than losing or repeating it. |
| **E-signature** | NFR-C04 | DocuSign and Adobe style envelopes with signatories pre-filled from the signature chain; provider callbacks arrive through the signed webhook and reach the chain only through the normal sign route, so authority limits still apply. A decline returns the contract to legal. |
| **Document repository** | NFR-C06 | `/app/repository`: a simulated SharePoint with versions and If-Match concurrency, scoped to the procurements a person can see; publish to and import from existing documents. |
| **Continuity alerts** | FR-0860 | `/app/continuity`: raise an event, message recipients by simulated SMS and email, track who has answered through one-time links (no sign-in), resend to non-responders, escalate, close. SMS text cannot carry supplier names or amounts. |
| **Pluggable AI models** | NFR-C01, NFR-M06, SEC-TP07 | A registry with the built-in `rules-simulated-v1` and two simulated third-party style models, each with a data-handling profile. A third-party model can be active only after two different people approve it (the second PROBITY or EXEC); revoking falls back at once; switching is configuration only and audited. Ask AI and the sourcing recommendation show which model produced their text. |
| **Configuration without a release** | NFR-M05 | `/admin/config`: every settings section with its editor, last change, export (no secrets) and dry-run import with a diff. A test shows a change takes effect immediately. |
| **Browser baseline** | NFR-C08 | Published at `/browser-support`; a polite, never-blocking notice at sign-in; only family, version and a flag are counted. |
| **Measured budget check** | NFR-P04 | The budget check now answers inside the intake conversation; each check is timed with a monotonic timer; `/admin/performance` shows p50, p95 and the target (2 seconds). |

## Tests run
- API suites `b10conn`, `b10ai`, `b10erp`, `b10x` (connectors, delivery, AI layer, ERP, legal sync, HR feed, payments, e-signature, repository, continuity), shared `baseline.test.ts`, with the authorisation matrix and OpenAPI drift tests over 486 operations.
- End to end: `e2e/b10a.spec.ts`, `b10b.spec.ts`, `b10c.spec.ts`, `b10d.spec.ts`, each page scanned for WCAG 2.1 AA with axe.

## Settings added
AI (active model, per-task overrides), performance (budget check target). Connector choices and modes are on `/app/connectors`.

## Known limits
- No cost-centre dropdown on the request form itself; imported cost centres are selectable on `/app/erp` and the intake check matches a business unit by name or code.
- Failed inbound legal events are reprocessed on request, not on a schedule.
- The HR, payments and several other connectors are disabled by default and must be switched on by an administrator.
- A signing link is stored hashed, so it is shown once; the card issues a fresh one for the signed-in signatory.
- E-signature pre-fills one named person per seat of the signature chain.
- The simulated systems are deterministic stand-ins; none proves behaviour of a real SAP, Oracle, Dynamics, DocuSign, Adobe, SharePoint or bank system.
