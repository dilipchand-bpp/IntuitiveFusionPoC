# M7c - Visual refresh (modern SaaS, indigo)

Owner choices (2026-10-03): direction "Modern SaaS, keep indigo"; scope "everything built so far". Accent #4254C5 and fonts unchanged.

| Area | What changed |
| --- | --- |
| Theme (`packages/ui/src/theme.ts`) | New tokens `gradientFrom/To/Fg` (light and dark), rounder radii (8/12/20), softer indigo-tinted shadows. 4 new contrast pairs added to the build-failing contrast test. |
| Shared components | Gradient primary/accent buttons with lift on hover; rounder cards, tables (uppercase headers, row hover), KPI cards (gradient top bar, icon tile), badges (no wrapping), empty/coming-soon states with icon tiles, rounder dialogs and inputs. |
| Landing | Gradient-mesh hero with grid, animated conversation mock with floating chips, headline accent, at-a-glance band, icon lifecycle strip, bento feature grid, connected process steps, trust cards, gradient call-to-action, glass header, gradient footer rule. |
| Login | Gradient brand panel with feature chips; form in a raised card; gradient Sign in button. |
| App shell | Glass header, accent-tinted active nav item, section labels, subtle mesh background, page fade-in, **Ctrl+K "Jump to" palette** over the pages the person may open (real navigation, not a stub). |
| Dashboard | Gradient phase bars, KPI cards restyled. |
| Motion | CSS only; fully off under reduced-motion (browser tests run with reduced motion). |

## Verification
- `npm run ci`: exit 0, 350 tests (contrast tests cover the new gradient colours in both themes).
- Browser suite on the production build: 131 / 131 pass (axe WCAG 2.1 AA on mobile/tablet/desktop, light/dark; no horizontal scroll).
- Visual baselines (Windows/Edge) regenerated and reviewed by eye: landing dark desktop, landing light mobile, plan page, login, dashboard.
- `npm audit --audit-level=high`: clean.

## Defects found and fixed during the work
- Desktop "Jump to" button also showed on phones (class conflict) and overflowed the header by 145px; then overflowed by 48px on tablets. Fixed by wrapping per-breakpoint and showing the compact icon below `lg`.
- Feature and trust grids left an orphan card on the last row. Spans adjusted.
- Floating "Audit trail" chip covered chat text. Moved.
- A bell test depended on test order; now uses a user nobody else changes.

## Not done
- Only pages built so far were restyled; later modules inherit the look through shared components.
- No real-device or screen-reader pass; Linux visual baselines for CI still owed.
- Landing page figures in the "at a glance" band are statements about the design, not measurements.
