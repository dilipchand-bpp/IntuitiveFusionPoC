# M2 – Design system & theme: evidence report

**Date:** 2026-10-02 · **DoD (plan §3 M2):** components keyboard-operable; rebrand = change `theme.ts` only; contrast table regenerated from tokens by script.

## Built
- `packages/ui/src/theme.ts` – the only place for colour, fonts, spacing, radius, shadow, motion, breakpoints, touch target (light + dark). `npm run theme:build -w @if/ui` emits `theme.css` (CSS variables, system dark preference, manual `data-theme` override, reduced-motion rules, Tailwind v4 `@theme` mapping).
- Components: Button, Field, Input, Textarea, Select, Checkbox, Dialog (Radix), Toast, Tabs (Radix), Table, Badge, Card, Stepper, Stamp, AiBadge, ComingSoon, EmptyState, Skeleton, Logo, ThemeToggle.
- Assets: logo PNGs, favicon, apple icon (from `Logo.jpg`); fonts self-hosted via `@fontsource-variable` (Inter, Plus Jakarta Sans) - no third-party requests.
- Gallery page `/ui-kit` (hidden in production builds unless `NEXT_PUBLIC_UI_KIT=true`).

## Tests actually run (local, Windows, Edge)
| # | Check | Result |
|---|---|---|
| 1 | Contrast contract: 25 pairs x 2 themes computed from tokens (WCAG 2.1 AA, 4.5:1 text / 3:1 UI) | **50 / 50 pass** |
| 2 | Generated `theme.css` equals output of `theme.ts` (drift guard) | Pass |
| 3 | Component tests (Button, Field wiring, Checkbox, Badge, Stepper, ComingSoon, Table, Dialog, Tabs arrow keys, Toast role=alert, ThemeToggle) | Pass |
| 4 | Rebrand guard: no hex/rgb colour literal in any component or web source outside the theme | Pass |
| 5 | Unit suite total (incl. M1) | **81 / 81 pass** |
| 6 | axe-core WCAG 2.1 A/AA on `/ui-kit`: 3 viewports (375/768/1280) x light/dark | **6 / 6 pass, 0 violations** (after fix below) |
| 7 | No horizontal page scroll at 375/768/1280, both themes | 6 / 6 pass |
| 8 | Theme tokens reach the DOM (body background equals token) | 6 / 6 pass |
| 9 | Self-hosted fonts load; zero external requests | Pass |
| 10 | Keyboard: dialog opens, traps focus, Escape closes, focus returns to opener | Pass (after fix) |
| 11 | Theme toggle switches and persists across reload | Pass |
| 12 | Reduced-motion respected | Pass |
| 13 | Visual regression: 6 baselines (3 breakpoints x 2 themes), re-run against themselves | 6 / 6 pass; I reviewed the light-desktop and dark-mobile images by eye |
| 14 | Full gates: format, lint, typecheck, build, `npm audit` (high) | All pass; 0 vulnerabilities |
| 15 | Total Playwright run | **30 / 30 pass** |

## Defects found and fixed
1. **axe colour-contrast failure (light theme):** the gallery's "secondary" swatch put white text on `#717888` (4.43:1). Exactly the case the spec warned about; secondary is restricted to non-text/large uses. Swatches now show a colour chip with separate text.
2. **Dialog did not return focus to its opener** (controlled dialog has no Radix trigger) -> now captures and restores the opener.
3. `theme.css` was reformatted by Prettier, breaking the drift guard -> excluded from Prettier.
4. My toggle test re-seeded storage on reload (test bug) -> fixed.
5. Next.js dev badge appeared in snapshots -> `devIndicators: false`.

## Not verified / caveats
- axe covers automated rules only (~30-40% of WCAG issues). Manual screen-reader pass is planned in M17.
- Visual baselines are Windows/Edge renders; CI (Linux) skips `@visual`. Linux baselines to be generated in M17.
- Lighthouse scores not run yet (planned M5 on real pages).
- Dark-mode "Next" Tabs table on 375 px scrolls horizontally inside its own labelled region (by design); page itself does not scroll.
- Fonts: system fallbacks verified only by the load check, not by metrics comparison.
- M1's GitHub CI run still unconfirmed by me (private repo, no `gh`).

## Gate
Approve M2 to begin **M3 - Data layer, seed & audit core** (Drizzle schema + migrations on PGlite, seed script, in-transaction hash-chained audit, RLS for scores with pooled-connection test).
