# Design system (phase 1 foundation)

The product has one look: near-black blue-grey (dark, the default) with a light variant of the same character, hairline borders, light airy type and one restrained accent. This page is the contract for everyone building or restyling a page. Phase 1 built the foundation described here; phase 2 moves the remaining pages onto it.

## 1. Where styling lives

- **All tokens** are in `packages/ui/src/theme.ts` (colours for `dark` and `light`, type scale and weights, spacing, radius, shadow, motion). `npm run theme:build -w @if/ui` regenerates `packages/ui/src/theme.css`; a test fails if the two differ.
- No component or page may contain a `#hex` or `rgb()` literal (a test enforces it). Use token classes: `bg-bg`, `bg-surface`, `bg-surface-alt`, `border-border`, `border-border-strong`, `text-text`, `text-text-muted`, `bg-primary text-primary-fg`, `bg-accent text-accent-fg`, `text-success|warning|error|info` (+ `-bg`).
- Tailwind's `text-sm`, `text-base` and the `font-medium|semibold|bold|extrabold` utilities resolve to the theme scale, so existing classes already follow the light look: body 14px, `sm` 13px, `xs` 12px; `extrabold` is weight 500, `semibold` 550, `bold` 600.

## 2. Colour modes

- **Dark is the default.** `<html data-theme="dark">` is rendered by the server; the inline script in `<head>` (`THEME_INIT_SCRIPT`) applies a stored `light` before first paint. The operating-system setting is ignored.
- The choice is stored in `localStorage` key `if-theme` (always in try/catch). The toggle lives in the profile menu (`useThemeChoice()` from `@if/ui`; `ThemeToggle` is the icon button used on public pages).
- Light values apply only under `:root[data-theme='light']`. White-label palettes (`data-palette`) change accent and gradient only, in both modes.
- Every text/background pair is in `CONTRAST_PAIRS` and must pass WCAG AA in both modes (`theme.test.ts`). Check new pairs there; do not eyeball.

## 3. Primitives (`@if/ui`)

| Primitive | Use |
| --- | --- |
| `PageHeader` | eyebrow, one `h1`, subtitle, `actions` (right). Exactly one per page. |
| `SectionHeader` | eyebrow + title (`h2` by default, `as` to change) + optional controls |
| `Eyebrow` | 11px uppercase label, wide tracking, muted |
| `KpiStrip` + `KpiCell` | four figures separated by hairlines; `padNumber()` zero-pads; `href` adds the drill-down arrow (give it only if the role can open the target) |
| `Panel` | bordered block, no fill, no shadow |
| `RowList` + `ListRow` | hairline list; row = left accent bar, caption, title, subtitle, tag, arrow |
| `ActivityRow` | small round initials, one line of text, muted "who · when" |
| `Button` | `primary`, `accent`, `secondary`, `ghost`, `danger`; sizes `sm` (36px), `md` (44px, default), `lg`, `icon` |
| `Field`, `Input`, `Select`, `Textarea`, `Checkbox` | controls keep a 44px target and a `border-strong` edge (WCAG 1.4.11) |
| `Badge`, `AiBadge`, `Stepper`, `Stamp`, `Table/Th/Td`, `Tabs`, `Dialog`, `Drawer`, `Popover`, `Menu`, `Toast`, `Skeleton`, `EmptyState`, `ComingSoon`, `Avatar`, `KpiCard` | unchanged APIs, restyled |
| `UiLinkProvider` | the web app gives the kit the Next.js `Link`, so rows and cells navigate without a page load |

The gallery at `/ui-kit` (needs `NEXT_PUBLIC_UI_KIT=true`) shows all of them in both modes; `e2e/ui-kit.spec.ts` snapshots it.

## 4. The page pattern

```
<PageHeader eyebrow="TENANT / TUESDAY 27 OCTOBER" title="..." subtitle="..." actions={<Button size="sm">...</Button>} />
<KpiStrip label="Key figures"> <KpiCell label value caption href /> x4 </KpiStrip>      (only where figures help)
<Panel> ... </Panel>                                                                      (a bordered block)
<SectionHeader eyebrow="..." title="..." actions={...} />
<RowList> <ListRow .../> </RowList>                                                       (lists)
<Table caption="..."> ... </Table>                                                        (tables)
forms: <Field label hint error> <Input/> </Field>, stacked, max one column of fields per ~28rem
```

- The page sits in a centred column of about 1250px (`main` in the shell); do not add your own outer padding or a second `max-w`.
- Spacing: `gap-12` between page blocks, `gap-4` inside a block. Whitespace is part of the design; do not box everything.
- Empty states are one calm sentence (or `EmptyState`), never a blank box. Loading is a sentence or `Skeleton`.
- Status is never colour alone: a `Badge` carries an icon and text; a `ListRow` tag carries text.

## 5. The shell

- Top bar: logo and name, divider, workspace chip (organisation name from `GET /auth/me` -> `tenantName`), the "Proof of concept · synthetic data" marker (xl screens), search icon (Ctrl+K command palette), preview link, notification bell (dot when unread), account avatar (menu: Security, theme, Sign out).
- Second row: tabs from `apps/web/src/lib/nav-tabs.ts` (`TAB_OF` places every `NAV` entry; a test fails for an unplaced page). A tab with several pages is a button that opens a dropdown; with one page it is a link. The role filter stays in `navFor` (`nav.ts` + `@if/shared` route rules); `groupNav` only groups what a role may already open.
- Keyboard: Enter/Space/Arrow Down open and move into a tab's pages, Arrow Up/Down/Home/End move, Arrow Left/Right change tab, Escape closes and returns focus to the tab, Tab leaves.
- Phones and tablets: hamburger opens a drawer (`nav` named "Pages") with the same groups as an accordion; focus returns to the menu button on close.
- Every page remains in the document inside `nav[aria-label=Main]` (closed menus are `hidden`), which the crawler and shell specs rely on.
- The Ask pill (bottom right) is labelled "Ask".

## 6. Your work home (`/app/dashboard`)

KPIs: active procurements and pipeline value, awaiting decisions (`pendingMyAction`), active agreements, expiring within 90 days (`/contracts?status=EXECUTED`, `/reports/expiring-contracts?days=90`; a dash when the role cannot read them). "Since you were last here": notifications plus recent activity newer than `localStorage['if.home.lastVisit']` (never required). Work queue: `GET /action-items` (My work), team and all procurements where the scope allows. Recent activity: the audit trail for roles that may read it, otherwise the procurements the role can see. Below: Copilot summary, the procurement table, by phase, spend, role views; "Personalise my dashboard" opens `/app/dashboard/my`.

## 7. Rules for phase 2 (sweeping the other pages)

1. Start every page with `PageHeader`; replace hand-made `h1` blocks. Keep existing `data-testid`s, labels and headings that specs use.
2. Use `SectionHeader`, `Panel`, `RowList`, `Table`, `Field` instead of local card markup. Remove `shadow-*`, `rounded-xl+`, `card-lift`, `icon-tile` boxes and gradient bars.
3. Replace `bg-brand-gradient` buttons/links with `Button` (`primary` or `accent`). Where a gradient must stay, the text colour is `text-gradient-fg`, never `text-white`.
4. Never `text-white` / `text-black` / `bg-white` or slate/gray classes. On a solid status fill use `text-bg`; on accent use `text-accent-fg`.
5. Do not hard-code font sizes below 11px or weights above 600. Headings are `font-medium` or the default.
6. Keep touch targets at 44px (`Button size="sm"` is only for dense bars) and keep one `h1` per page.
7. A link to a page only if the role can open it (reuse `allowedRolesForPath`).
8. Test each swept page in both modes (axe) and at phone width; refresh only snapshots that changed for a good reason, after looking at the diff image.

## 8. Phase 2 checklist (known leftovers)

- `bg-brand-gradient` / `text-brand-gradient`: audit, contracts expiring, contracts mine, login, landing (`app/page.tsx`, `site-chrome`, `illustrations`), `b9/my-dashboard`, `contract/gantt`, `evaluation` (`b3-commercial`, `eval-card`, `evaluation-workspace`), `plan/plan-workspace` (Key points top bar), `requests/intake-chat`, `requests/progress-journey`.
- `bg-white/10`, `bg-white/20` decorations on the login and landing gradient panels.
- Old glass/mesh/grid helpers still used by the public pages, supplier shell and register/activate pages: `bg-hero-mesh`, `bg-grid`, `glass`, `card-lift`, `icon-tile`, `.reveal`, `.float`.
- Pages that still use their own card markup (`rounded-lg border ... bg-surface p-6`): about 45 page folders under `apps/web/src/app/app` and most of `apps/web/src/components/*` (requests, plan, tender, evaluation, contract, legal, supplier, reports, admin, security, b8-b11).
- The supplier portal shell (`components/supplier/supplier-shell.tsx`) still has the old header; it should adopt the top bar pattern without the staff tabs.
- Landing and login keep their marketing look (gradient panel) until the owner decides.
- Search the tree again with: `grep -rnE "bg-brand-gradient|text-white|text-black|bg-white|(text|bg|border)-(slate|gray|zinc)-|shadow-(lg|xl)|rounded-(xl|2xl)|font-extrabold" apps/web/src`.
