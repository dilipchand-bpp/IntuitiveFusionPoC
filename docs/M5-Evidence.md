# M5 – App shell, landing, login, dashboard frame: evidence report

**Date:** 2026-10-02 · **DoD (plan §3 M5):** every nav item resolves to a non-blank screen; logo in header/landing/login/favicon; responsive at 375/768/1280; Lighthouse accessibility ≥ 90 on landing and login.

## Built
- **Public landing** (`/`): hero with CTA, lifecycle strip, "one conversation → every document" illustration, 8 key features, 4-step "how it works", security/trust/compliance section (alignment by design, explicitly *not* certified), FAQ accordion, CTA band, footer with contact and legal links; three legal pages (clearly marked placeholder text).
- **Login** (`/login`): branded two-panel layout, validation, show/hide password, forgot-password flow (`/forgot-password`, identical neutral outcome), role-based redirect, open-redirect protection.
- **App shell** for `/app`, `/admin`, `/supplier`: header (logo, theme toggle, notification bell with unread count and mark-read, profile menu with sign-out), role-filtered sidebar (desktop) / drawer (phone, tablet), skip link, `aria-current`.
- **Dashboard** (`/app/dashboard`): live KPIs (active procurements, value in flight, cycle time, alerts due, waiting for you), by-phase bars, recent-procurements table, from the new real API endpoints `GET /dashboard/kpis` (role-scoped; suppliers refused) and `GET /notifications`, `POST /notifications/{id}/read` (own only).
- **Placeholders**: every other module page shows a "Coming soon" panel with the module, description and requirement IDs (16 navigation entries); unknown paths are branded 404s; 403 and 500 pages branded.
- **Navigation and guard now agree**: the address bar refuses a page that the menu hides from your role (found by testing, see defects).

## Tests actually run
| Area | What | Result |
|---|---|---|
| Unit / API / DB | `npm run ci` (format, lint, typecheck, 17 files, build) | **214 / 214 pass**, exit 0 |
| API | KPIs: whole-tenant vs requester-own scoping, pending actions by role, supplier refused; notifications: own only, mark read, other user's id = 404, bad id = 400 | Pass (8 tests) |
| Nav rules | no nav item shown to a role the guard refuses; every role sees its home page in its nav; address-bar access equals menu access for every item | Pass |
| Browser (Edge), non-visual | **72 / 72 pass** in one clean run: landing content (US-PLT-01), FAQ by keyboard, legal pages and 404, logo/favicon, forgot-password, show/hide password, **12 roles x every nav page opens real content (200, heading, non-blank, no horizontal scroll)**, hidden pages refused with 403, branded 404, notification bell, profile menu, skip link, phone drawer, **axe WCAG 2.1 A/AA at 375/768/1280 x light/dark on landing, login, forgot-password, legal, dashboard, requests**, 403/404 pages, plus all M1-M4 browser tests | Pass |
| Visual regression | 13 baselines (landing and login x 3 widths x 2 themes, dashboard); I reviewed landing and dashboard images by eye | Baselines created; re-run stable |
| **Lighthouse** (production build, Chrome) | landing: accessibility **100**, best-practices 100, SEO 100, performance 94; login: accessibility **100**, best-practices 100, SEO 100, performance 94 | Pass (target ≥ 90) |

## Defects found and fixed during M5
1. **A hidden page was still reachable by URL**: a Requester could open `/app/approvals` by typing it. Guard now narrows the shared route table by the navigation table; unit-tested for every nav entry.
2. **Mobile dashboard overflowed by 197 px** (grid children lacked `min-w-0`).
3. **"Value in flight" was clipped** in its KPI card (seen in the baseline image) -> compact format "$6.65M" with the full "$6,648,000" beneath.
4. Seed accepted an empty `SEED_PASSWORD` (user-reported login failure) -> blank values ignored, short ones refused, tests added.
5. Test infrastructure: a leftover dev server from an interrupted run served broken pages and overlapping runs shared one database; fixed by killing strays and running one suite at a time. A runtime import in `nav.ts` broke Playwright's loader -> moved to `lib/access.ts`.
6. FAQ keyboard test pressed Enter before hydration -> retries until interactive. Header logo test looked for a role that a decorative image does not have.
7. `~$README.md` editor lock file broke the format check -> ignored.

## Not verified / caveats (honest)
- Lighthouse **performance 94** is under the 100 mark: LCP 3.0 s on the test machine, above the 2.5 s target in the spec. Acceptable for the POC (the target was Lighthouse ≥ 80 overall) but worth tuning in hardening (image sizes, font loading).
- Lighthouse and axe are automated; manual screen-reader and keyboard walkthrough is still planned (M17). Dark-mode Lighthouse was not run (axe covers both themes).
- Visual baselines are Windows/Edge; CI (Linux) skips `@visual` until M17.
- The notification list does not auto-refresh (loads on page load and when opened); real-time delivery is out of scope.
- Voice input and the assistant UI are illustrations on the landing page only; no assistant exists until M6.
- GitHub CI runs for M1-M5 remain unobserved by me (private repo, no `gh`).

## Gate
M5 complete. Next: **M6 - Intake & Assistant slice** (mock AI, chat, request create/submit, complexity score, governance gates, My requests).
