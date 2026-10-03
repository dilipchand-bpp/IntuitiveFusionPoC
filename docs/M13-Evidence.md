# M13 - Admin and configuration slice: evidence

Stories: US-ADM-01 (users, roles and delegations), US-ADM-04 (administrators cannot read bids) - Tier W. US-ADM-02 (workflow library, one editable simple workflow) and US-ADM-03 (template library, read only, create is "coming soon") - Tier S, built as the plan describes.

Delegation limits and alert timing were built in M12b; this milestone adds the rest.

## What was built
| Area | Result |
| --- | --- |
| Users and roles (US-ADM-01) | `GET/POST /admin/users`, `PUT /admin/users/{id}`, `POST /admin/users/{id}/activation-link`, `GET /admin/org-units`. The administrator adds a staff person with one or more roles and an organisation unit; the person sets their own password through a one-time link (7 days, stored as a hash, single use, shown once, no email in the proof of concept; reissuing voids older links). Roles, name, unit and "can sign in" can be changed; a change of roles or a switch-off **ends the person's sessions at once** and the next sign-in carries the new roles. Everything is audited with before and after. |
| Guard rails | The administrator role is **exclusive** (cannot be combined with any other, so no administrator can also approve or read bids). You cannot change your own roles or switch yourself off. Suppliers do not appear here (procurement manages supplier contacts). Email addresses are unique. |
| Workflow library (US-ADM-02) | `GET /admin/workflows` (administrator, procurement), `PUT /admin/workflows/{id}`. Three workflows with steps and mandatory flags. Only the simple workflow is editable: rename, reorder, add, remove, mark optional (2 to 12 steps, unique names). An **approval checkpoint stays**: it cannot be removed or made optional (422 `CHECKPOINT_REQUIRED`). The intermediate and complex ones answer 409 `NOT_EDITABLE` and show "Editing coming soon". The library is configuration: it does not yet route live requests. |
| Template library (US-ADM-03) | `GET /admin/templates` (administrator, procurement, legal): templates by type with version, status, the tender routes they apply to and their clauses (mandatory marked). Read only; "Create a template" is a disabled button marked coming soon. |
| No bids for administrators (US-ADM-04) | The evaluation pages and bid-file download answer 403 for the administrator and each refusal is audited as `access.denied` with role ADMIN (visible in the audit trail); the supplier portal is closed to them; the tender view they may open carries no file names or storage details; and **the database itself** returns no bid files and no scores to a connection acting as an administrator. |
| Screens | `/admin` overview (counts and areas), `/admin/users`, `/admin/delegations` (M12b), `/admin/workflows`, `/admin/templates`; public `/activate` for staff links (shares the supplier activation page). The admin catch-all route became `[...slug]` so `/admin` could be a real page. |
| Contract | OpenAPI now 112 operations. |

## Verification (all run on this machine)
| Check | Result |
| --- | --- |
| API tests (`admin/directory.test.ts`, 18) | create with roles, activation, sign-in with exactly those roles; taken email, combined administrator role, bad input, unknown unit, other roles refused; role change and switch-off end sessions (old session revoked, new sign-in has new roles), switch back on, audit before and after; not yourself, only staff, only the administrator, a second administrator can manage the first; reissued link voids the old one; workflow list, edit (add, rename, reorder, optional), checkpoint protection, duplicates, bounds, coming-soon workflows, role access, audit; template list shape and access; administrator refused every bid path and audited; the database returns nothing to an administrator while procurement can read the files |
| Browser tests | the administrator adds a person who activates and signs in with that role only and cannot open `/admin`; administrator is exclusive in the role picker; roles changed and the person switched off and then refused sign-in; an administrator cannot edit their own roles; workflow edit and the refused checkpoint removal, coming-soon workflows; template library and its disabled create button; an administrator refused the evaluation, the supplier portal and a bid-file request, and the refusals found in the audit trail; accessibility (axe WCAG 2.1 AA) and no sideways scroll on a phone |
| `npm run ci` (format, lint, typecheck, unit/API/DB tests, build) | exit 0, **563 tests** |
| Browser tests | **188 pass** on the production build (4 new) |
| `npm audit --audit-level=high` | no high or critical findings |

## Defects found and fixed
- `/admin` as a real page conflicted with the optional catch-all `/admin/[[...slug]]` (Next refused to build): the catch-all is now `[...slug]`.
- A browser test could not click the primary button inside a dialog because the button lifts on hover and a resting mouse kept it moving; the test now activates it from the keyboard (the button itself is unchanged).

## Not done / caveats
- The workflow library does not drive request routing yet; editing changes the stored library and is audited.
- Roles are plain assignments: there is no per-role permission editing, no role creation, no multi-factor settings (the identity provider is mocked).
- New staff get an activation link, not an email. There is no bulk import (the data migration slice is a stub in M14).
- Deleting users is not offered: people are switched off, which keeps the audit trail intact.
- Templates cannot be created, edited or versioned yet; contract clause wording is changed per contract by Legal.
- No visual-regression baselines for the admin screens; no manual screen-reader pass; the real-Postgres test of the policies and triggers is still owed.

M13 complete. Next: **M14** (stub sweep: every remaining Tier S / Won't page and API stub with requirement IDs and a TODO inventory), awaiting approval.
