# Intuitive Fusion – Procurement Portal (POC)

Conversational source-to-contract procurement portal proof of concept. **Status: Phase 5, milestones M0–M7 complete** (foundation, design system, data/audit core, identity & access, app shell, request intake, procurement plan). Later modules (tender and supplier portal, evaluation, contracts, reporting, admin) are "Coming soon" placeholders. Voice dictation (speech to text) works in Chrome and Edge in the request chat and the plan instruction box.

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

## Checks

```bash
npm run ci                       # format, lint, typecheck, unit/API/DB tests, build
PW_CHANNEL=msedge npm run e2e    # browser tests on a production build, ports 3100/4100 (so they never clash with `npm run dev` on 3000/4000); uses the installed Edge, CI uses Playwright Chromium
```

Other: `cd spikes && npm install && node spike-a-score-isolation.mjs`; regenerate RTM/stories/OpenAPI with the scripts in `_work/` (needs the source `.xlsx` locally).
