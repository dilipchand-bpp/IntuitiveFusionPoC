# Intuitive Fusion – Procurement Portal (POC)

Conversational source-to-contract procurement portal proof of concept. **Status: Phase 5, milestones M0–M5 complete** (foundation, design system, data/audit core, identity & access, app shell). Module screens (M6 onward) are "Coming soon" placeholders.

- Documents: [docs/README.md](docs/README.md) · Plan: [docs/05-Implementation-Plan.md](docs/05-Implementation-Plan.md) · Evidence per milestone: `docs/M*-Evidence.md`
- Stack: TypeScript, Next.js 16, Fastify 5, PostgreSQL (PGlite locally), AWS-targeted. AI, sign-in and integrations are mocked behind adapters ([docs/swap-points.md](docs/swap-points.md)).

## Run it

```bash
npm install
npm run db:reset      # creates ./apps/api/var/db with synthetic demo data
npm run dev           # API on :4000, web on :3000
```

Open http://localhost:3000. The environment needs `SESSION_SECRET` (32+ characters) – copy `.env.example` to `.env` and set it.

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
PW_CHANNEL=msedge npm run e2e    # browser tests (uses the installed Edge; CI uses Playwright Chromium)
```

Other: `cd spikes && npm install && node spike-a-score-isolation.mjs`; regenerate RTM/stories/OpenAPI with the scripts in `_work/` (needs the source `.xlsx` locally).
