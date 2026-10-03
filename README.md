# Intuitive Fusion – Procurement Portal (POC)

Conversational source-to-contract procurement portal proof of concept. **Status: Phase 5, milestones M0–M9 complete** (foundation, design system, data/audit core, identity & access, app shell, request intake, procurement plan, tender pack and supplier portal, evaluation). Later modules (contracts, reporting, admin) are "Coming soon" placeholders. Use the **Preview on phone or tablet** button in any header to check the layout on a smaller screen. Voice dictation (speech to text) works in Chrome and Edge in the request chat and the plan instruction box.

- Documents: [docs/README.md](docs/README.md) · Plan: [docs/05-Implementation-Plan.md](docs/05-Implementation-Plan.md) · Evidence per milestone: `docs/M*-Evidence.md`
- Stack: TypeScript, Next.js 16, Fastify 5, PostgreSQL (PGlite locally), AWS-targeted. AI, sign-in and integrations are mocked behind adapters ([docs/swap-points.md](docs/swap-points.md)).

## Run it

```bash
npm install
npm run db:reset      # creates ./apps/api/var/db with synthetic demo data
npm run dev           # API on :4000, web on :3000
```

Open http://localhost:3000. `npm run dev` creates `.env` with a random `SESSION_SECRET` if there is none. If sign-in fails, check that both `:3000` and `:4000` are listening – if the API died, stop the dev terminal and run `npm run dev` again.

## Demo users (synthetic)

All users share one **demo-only** password: `Demo-Only-Passw0rd!2026` (override with `SEED_PASSWORD` before `db:reset`).

| Role                   | Email                                | Lands on         |
| ---------------------- | ------------------------------------ | ---------------- |
| Requester              | requester@meridian-demo.example      | /app/requests    |
| Procurement lead       | procurement@meridian-demo.example    | /app/dashboard   |
| Delegate (approver)    | delegate@meridian-demo.example       | /app/approvals   |
| Evaluator (technical)  | evaluator-tech@meridian-demo.example | /app/evaluations |
| Evaluator (commercial) | evaluator-comm@meridian-demo.example | /app/evaluations |
| Panel chair            | chair@meridian-demo.example          | /app/evaluations |
| Legal                  | legal@meridian-demo.example          | /app/contracts   |
| Contract manager       | contract-mgr@meridian-demo.example   | /app/contracts   |
| Probity advisor        | probity@meridian-demo.example        | /app/audit       |
| Finance                | finance@meridian-demo.example        | /app/dashboard   |
| Administrator          | admin@meridian-demo.example          | /admin           |
| Executive              | exec@meridian-demo.example           | /app/dashboard   |
| Supplier               | supplier@meridian-demo.example       | /supplier        |

## Try the tender and supplier journey

1. Sign in as `requester@…`, create and submit a request (about $90,000 keeps approvals simple).
2. As `procurement@…` open the plan and send it for approval; as `delegate@…` approve it.
3. As `procurement@…` open **Tenders** and create the tender pack. It stays **staged** (invisible to suppliers).
4. As `delegate@…` open **Approvals** and give permission to publish. Then, as `procurement@…`, publish with a closing time at least 25 days out (the demo organisation is public-sector) and invite a supplier. Email is simulated: copy the registration link shown.
5. Open the link in a private window, register (the ABN must pass the real checksum, for example `65 000 000 101`), sign in, ask a question, upload a technical and a commercial file and submit to get a receipt.
6. Back as `procurement@…`, answer the question and issue an addendum. The question's author is never shown. Bids stay sealed until the closing time.

The seeded supplier `supplier@…` already has a closed, submitted tender and an open one to explore. Bid files are stored sealed under `apps/api/var/storage`.

## Try the evaluation

The seeded tender "Facilities cleaning services" is already at the consensus stage: sign in as `chair@…` (or `probity@…` for a read-only view) and open **Evaluations**. One score is flagged (37.5% apart) and cannot be locked without a reason. To run a whole evaluation yourself, close a tender (the browser tests do this with a test-only API entry), then as `procurement@…` open **Evaluations**, choose a panel, and have `evaluator-tech@…`, `evaluator-comm@…` and `chair@…` declare conflicts and score. Technical evaluators never see pricing; nobody sees another evaluator's scores until the chair opens consensus. A declared conflict goes to a delegate to decide; the chair can reopen a locked consensus with a reason; the report downloads as a PDF. Seeded bid documents are real files (PDF and Excel): run `npm run db:reset` once to get them in an existing dev database.

## Try the contract award

Sign in as `legal@...` and open **Contracts**: two executed, locked contracts are seeded (open one: no edit buttons, signature stamp shown). When an evaluation report has been approved (the browser tests create one by API) the award appears under Awards ready for a contract; **Draft contract** assembles the template for the tender route (RFT = works, RFP/RFQ = services) with the winner, value, dates and service levels filled in. Legal edits clauses (a change is marked and listed under deviations), then releases for signing. `delegate@...` signs with a stamp and the contract is locked. Signing authority is a separate grant from sourcing approval: above 1,000,000 an executive must co-sign, and `exec@...` holds no signing delegation in the seed, so such a contract cannot be completed in the demo until one is delegated. The contract value defaults to the request estimate because bid prices are not captured.

## Try contract management

Sign in as `contract-mgr@...` and open **Contracts**: **Expiring contracts** lists what ends in the next 90 days (CT-2026-0001 ends in 74 days) with a term chart including the optional extension; **Alerts** lists every alert. Open a contract to see its owner, milestones and alerts. When a contract is signed and locked its record and alerts are created automatically; alerts fire on their date (the browser tests cannot change the date, the API tests travel in time). Email is simulated. Existing dev databases need `npm run db:reset`.

## Try the dashboards and audit trail

Sign in as `exec@...` for the portfolio dashboard: key figures, spend by category, and every procurement with completion ticks (filter by phase or text). `requester@...` sees only their own requests and `evaluator-tech@...` only what they evaluate. `probity@...` opens **Audit trail** to search who did what, with before and after, filter to one procurement, and **Export CSV** (the export is itself recorded in the trail). Executives can read the trail but not export it.

## Try the follow-up features

- **Contracts:** as `legal@...` draft a contract, change a mandatory clause (for example liability): it is rated for risk and `delegate@...` must approve it before release. After signing, `contract-mgr@...` can edit milestones and extensions, change the owner and add an alert in plain language (for example "alert me 1 year before expiry and include whoever is my manager then"). `legal@...` can create a **variation**, which is signed like a contract and adds to the cumulative value.
- **Administration:** `admin@...` opens **Delegations** to change a signing or approval limit (it applies to the very next signature) and the timing of contract alerts. Raise `exec@...` a signing limit to complete contracts above 1,000,000.
- **Suppliers:** `procurement@...` opens **Suppliers** for each supplier's screening status and contacts, and adds a contact who activates their account through a one-time link (shown once; no email is sent).
- **Reports:** `exec@...` opens **Reports** for spend by category (with drill-down) and by supplier, off-contract spend, workload by owner and a procurement timeline.
- **Evaluation:** the chair can set the variance limit per evaluation before consensus opens; `probity@...` records a sign-off once consensus is locked. The evaluation report downloads as PDF or Word, and so does a tender pack.
- Existing dev databases need `npm run db:reset` for the new tables and seed data.

## Try administration

`admin@...` opens **Admin overview**: **Users and roles** (add a person with roles; the one-time activation link is shown once; changing roles or switching someone off ends their sessions), **Delegations**, **Workflows** (the simple one is editable, an approval checkpoint cannot be removed) and **Templates** (read only). The administrator role cannot be combined with another, and administrators are refused every bid screen: try `/app/evaluations` as `admin@...`, then look at the refusal in the audit trail as `probity@...`.

## Checks

```bash
npm run ci                       # format, lint, typecheck, unit/API/DB tests, build
PW_CHANNEL=msedge npm run e2e    # browser tests on a production build, ports 3100/4100 (so they never clash with `npm run dev` on 3000/4000); uses the installed Edge, CI uses Playwright Chromium
```

Other: `cd spikes && npm install && node spike-a-score-isolation.mjs`; regenerate RTM/stories/OpenAPI with the scripts in `_work/` (needs the source `.xlsx` locally).
