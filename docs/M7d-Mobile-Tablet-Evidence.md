# M7d - Mobile and tablet pass

Method: screenshot sweep at 375x812 (phone) and 768x1024 (tablet) across five roles/pages (requests, new request, dashboard, plans + plan, approvals, menu drawer), fixes, re-sweep, then permanent tests.

| Finding (before) | Fix |
| --- | --- |
| Phone: tables scrolled sideways, hiding Status/Value | Shared `Table` turns each row into a labelled card below 768px (`Td label=...`); used on requests, plans, dashboard |
| Tablet: Updated column clipped | Hidden between 768 and 1023px on the requests list |
| Tablet: "Proof of concept" chip overlapped the logo | Chip shown from 1280px only |
| Phone: five KPI cards in one long column | Two per row, odd last card spans full width |
| Phone: chat box cramped | 3 rows |
| Phone: approval card squeezed button | Stacks below 640px |
| Phone: header logo link 36px (< 44px target) | 44x44 minimum |

Tests added (`e2e/intake.spec.ts`, "phone and tablet layout"): phone card cells fit in 375px with no sideways scroll; tablet full table fits, chip hidden; every header control on phone is >= 44px. Existing axe + no-horizontal-scroll checks (mobile/tablet/desktop, light/dark) still pass.

Verification: `npm run ci` 350 tests; browser suite 134 pass after re-baselining three phone snapshots (ui-kit light/dark mobile, chat dark mobile) that changed on purpose.

Not done: real devices, landscape orientation, screen reader on a phone. Table semantics: on phones rows are displayed as blocks; cells keep their text labels so the content stays readable, but some screen readers may stop announcing a table there.
