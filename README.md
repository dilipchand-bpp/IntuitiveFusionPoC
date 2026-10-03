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

## Checks

```bash
npm run ci                       # format, lint, typecheck, unit/API/DB tests, build
PW_CHANNEL=msedge npm run e2e    # browser tests on a production build, ports 3100/4100 (so they never clash with `npm run dev` on 3000/4000); uses the installed Edge, CI uses Playwright Chromium
```

Other: `cd spikes && npm install && node spike-a-score-isolation.mjs`; regenerate RTM/stories/OpenAPI with the scripts in `_work/` (needs the source `.xlsx` locally).
