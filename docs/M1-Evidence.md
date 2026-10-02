# M1 – Scaffold: evidence report

**Date:** 2026-10-02 · **DoD (plan §3 M1):** fresh clone -> `npm ci && npm run dev` works; CI green on PR.

## What was built
npm-workspaces monorepo: `apps/web` (Next.js 16, App Router, placeholder home), `apps/api` (Fastify 5: `/health`, `/api/v1/health`, helmet, correlation id, RFC 7807 errors), `packages/shared` (zod-validated config, fail-fast), `packages/ui` (placeholder for M2). Tooling: TypeScript strict, ESLint 10 flat config, Prettier, Vitest + v8 coverage, Playwright e2e, husky + lint-staged pre-commit, GitHub Actions CI (`.github/workflows/ci.yml`).

## Tests actually run (Windows 11, Node 24, local)
| # | Check | Command | Result |
|---|---|---|---|
| 1 | Format | `npm run format:check` | Pass |
| 2 | Lint | `npm run lint` | Pass, 0 problems |
| 3 | Type check (strict, all workspaces) | `npm run typecheck` | Pass |
| 4 | Unit/API tests | `npm run test:coverage` | **10 / 10 pass** (5 config, 5 API incl. real-port HTTP smoke, problem+json, helmet headers, correlation id) |
| 5 | Production build | `npm run build` | Pass (shared, api, web) |
| 6 | Config fail-fast | start built API with no `SESSION_SECRET` | Exits with code 78 and message names the variable only (value not echoed - also unit-tested) |
| 7 | Dependency audit | `npm audit --audit-level=high` | First run **found a high-severity PostCSS issue bundled in Next 15.5**; fixed by upgrading to Next 16.3.8; re-run: **0 vulnerabilities** |
| 8 | App-start e2e smoke | `PW_CHANNEL=msedge npm run e2e` | **2 / 2 pass** (web renders titled page; API health answers with correlation id) |

## Not verified / limitations
- **CI on GitHub has not been observed running** (no `gh` CLI; see result in the hand-off message). The workflow uses the same commands that passed locally, plus gitleaks, which was **not run locally**.
- Coverage is low on branches (26%) because only the skeleton exists; the 80% domain-logic gate applies from M3.
- "Fresh clone on Linux" not tested; Windows only. `ci.yml` runs on ubuntu so the first CI run is that test.
- Docker compose item from the plan dropped: no Docker here; DB is PGlite (ADR-0003), wired in M3.
- npm warns that `esbuild`'s postinstall script is not allow-listed; harmless for now, to be reviewed.

## Defects found and fixed during M1
1. Typecheck failed because `@if/shared` was imported before being built -> typecheck now builds shared first; Vitest aliases to source.
2. High-severity transitive PostCSS vulnerability in Next 15 -> Next 16.
3. Vite config ESM warning -> root `"type": "module"`.

## Gate
Approve M1 to begin **M2 – Design system & theme**.
