# Settings: "Add ..." buttons - audit and outcome

**Request (owner, verbatim):** "Also in Admin persona for settings section provide add button to each section to add customer rule or fields etc. Currently showing only save button."
**Scope chosen by the owner:** real lists where it makes sense. Every settings section was audited; where an administrator can sensibly add items, an "Add ..." button was built that really takes effect and is tested. Fixed settings keep Save only and now say why, in one line under the section's description.

Method: for each section, the code that reads it was found by searching the API for the section name (the "Consumed by" column), then the decision was made. Nothing was added that no code reads. Where the data was a list already but the consumer only needed a small extension, the consumer was extended and tested (marked "extended").

## Outcome table (Settings page, Administrator)

| # | Section (panel title) | Data today | Consumed by | Decision | Add button |
| --- | --- | --- | --- | --- | --- |
| 1 | `numbering` Procurement numbers | scheme, prefix, digits | `formatNumber` for every new request | SAVE-ONLY: one format per organisation | none |
| 2 | `fieldLabels` Field labels | label per built-in field | `labelFor` in intake | SAVE-ONLY: all 11 relabellable fields already have a box; a custom field carries its own label | none |
| 3 | `customFields` Custom fields | list of fields | intake form and submission check | ALREADY HAS ADD (moved to the shared button) | Add a field |
| 4 | `checkpoints` Mandatory checkpoints | three booleans | the three gates in plan, evaluation, contract | SAVE-ONLY: each is a fixed step in the process | none |
| 5 | `intake` Intake rules | thresholds, cap, taxonomy, layouts, **review rules** | `requiredEngagements` at create, edit and submit | **ADD**: a review rule (name, function, words, optional value) | **Add a review rule** |
| 6 | `notifications` Notifications | channels, hours, one rule per event, **extra recipients** (new) | `dispatch` for every event-based notification | **ADD** (extended): a role also told for an event | **Add a recipient** |
| 7 | `onboardingQuestions` Supplier onboarding questions | list | supplier registration, flags | ALREADY HAS ADD (moved to the shared button) | Add a question |
| 8 | `publicRegisters` Public registers | the three registers, each switchable | tender publish (`public_notice`), contract disclosure | **ADD** (extended): any other register (name, jurisdiction, from value); the name is now free text, not a fixed three | **Add a register** |
| 9 | `criteriaLibrary` Criteria library | list | evaluation set-up | ALREADY HAS ADD (its own inline form, "Add to the library") | form kept |
| 10 | `evaluationRules` Evaluation rules | insurance switch, ranking limit, two periods | compliance gate, ranking, reminders | SAVE-ONLY: the compliance checks are fixed in code and cannot take a new rule; criteria are the list, and they have theirs (row 9) | none |
| 11 | `contractRules` Contract rules | switches, endorsements, **protected clauses**, two periods | `isProtected`, release checks | **ADD**: a protected clause (was a comma-separated text box, now one row each with Remove) | **Add a protected clause** |
| 12 | `contractManagement` Contract management | switches, limits, **spend alert** | `spendCrossings`, `raiseSpendAlerts` | **ADD** (extended): up to five extra spend alert points besides the main one and the fixed 80, 90, 100 | **Add a spend alert** |
| 13 | `dashboards` Dashboards and workload | visibility, capacity, refresh days, **capacity overrides** (new) | `/reports/capacity` | **ADD** (extended): a named procurement manager with their own capacity | **Add a capacity override** |
| 14 | `tenderRules` Opening high-value bids | one value limit, one window | tender publish, witness opening | SAVE-ONLY: a single rule (two witnesses or not); a second tier would change nothing | none |
| 15 | `ratings` Supplier ratings | two visibility switches | rating views | SAVE-ONLY: the rating questions are fixed constants (`RATING_DIMENSIONS`) used by scoring, the supplier portal and risk; a configurable question would touch all of them | none |
| 16 | `approvalLinks` Approve from a link | switch, hours, switch | approval link issue and page | SAVE-ONLY: single switches | none |
| 17 | `currency` Currency and exchange rates | base, rate mode | FX conversion | SAVE-ONLY: base is fixed; rates per currency are kept by Finance on the Currencies page, not in settings | none |
| 18 | `artefacts` Reports and plans following changes | mode, minutes | artefact refresh | SAVE-ONLY | none |
| 19 | `buying` Buying assistant | switch, limit | buying recommendations | SAVE-ONLY | none |
| 20 | `externalSearch` Outside AI search | switch | search | SAVE-ONLY | none |
| 21 | `branding` Branding | name, tagline, palette, email | shell | SAVE-ONLY: one value each; palettes are the theme's | none |
| 22 | `analytics` Analytics | four numbers | analytics store | SAVE-ONLY: single thresholds | none |
| 23 | `legalPlatform` Legal platform | one connection | legal matters | SAVE-ONLY | none |
| 24 | `security` Sign-in security | three switches | sign-in, step-up | SAVE-ONLY | none |
| 25 | `workflowRouting` Workflow routing | two limits, **routing rules** (new) | `routeWorkflow` at create and edit | **ADD** (extended): a rule that sends requests mentioning words (and above a value) to a chosen workflow; the first match wins and critical-rated work still goes to governance | **Add a routing rule** |
| 26 | `erpFieldMap` ERP field names | list | `mapRecord` | ALREADY HAS ADD (moved to the shared button) | Add a mapping |
| 27 | `signatures` Signature levels (eIDAS) | default level, value tiers | contract signing level | ALREADY HAS ADD (value tier; moved to the shared button) | Add a value tier |
| 28 | `content` Outside content packs | two periods, one switch | content refresh | SAVE-ONLY: the packs are the five the platform fetches | none |
| 29 | `esgPlan` ESG and socio-economic limits | nine limits | plan ESG gate | SAVE-ONLY: the nine metrics are computed by the platform | none |

Sections held on other pages (not on the Settings page, so outside this change): `ai`, `uploadScanning`, `performance`, `residency` (with its allowed regions) and `egress` (allowed hosts) on the Residency page with a reason, `privacy`, `retention`, `securityMonitor`, `compliancePolicy`.

Totals: 29 sections on the Settings page = 11 with an Add button beside Save (7 new: intake, notifications, public registers, contract rules, contract management, dashboards, workflow routing; 4 that had one already: custom fields, onboarding questions, ERP field names, signature value tiers) + 1 with its own inline add form (criteria library) + 17 fixed-value sections (Save only, with the reason on screen).

## How it works

- `Section` (and the B11 `Block`) take one optional `add` prop: label, handler, count, limit. The button sits beside Save, a "n of N used" counter shows next to it, and it disables at the limit ("Limit reached"). A section of fixed values passes `fixed` (the reason) and shows "This section holds fixed values, so it only has Save." A new section gets the affordance with that one prop.
- New lists live in `apps/web/src/components/admin/settings-lists.tsx` (editors) and `settings-list-rules.ts` (limits, new-row defaults and the plain-sentence checks run before a save). The API validates everything again.
- Added or removed items appear in the change log in words: the settings audit entry's `after` now carries `changes` such as "Added review rule: Legal review of drone work (LEGAL)" or "Removed protected clause: IP" (`changeSummary` in `settings.ts`; also for custom fields, questions, ERP mappings, criteria and signature tiers).

## Backward compatibility

All schema additions are optional with an empty default (`extraRecipients`, `extraSpendAlertPcts`, `capacityOverrides`, `workflowRouting.rules`), so stored settings and older clients that omit them still validate and save; defaults for existing tenants are unchanged. `publicRegisters[].register` widened from three fixed names to free text (2 to 40 characters, unique ignoring case, up to 8 rows); the three built-in values remain valid. Review-rule ids must now be unique (the built-in five are). No migration: settings are stored as JSON per section.

## Tests (all run; exact counts)

| Layer | File | Result |
| --- | --- | --- |
| API | `apps/api/src/modules/settings/settings-lists.test.ts` (new) | 22 passed |
| API, regression | settings, intake extras, contract B4 and B5 and B5 rules, collab B6, tender B2, authorisation matrix, app, roadmap (11 files) | 187 passed (includes the 22 above) |
| Component | `apps/web/src/components/admin/settings-panel.test.tsx` (new) | 42 passed |
| Playwright | `e2e/settings-add.spec.ts` (new) | 9 passed |
| Playwright, regression | existing specs that use the settings page or the changed behaviour: `b1` (11), `b11d` (6), `b3` (11), `b5` (8), `b8` (8) | 44 passed |
| Component, all web | `apps/web/src/components` and `apps/web/src/lib` | 80 passed in 8 files (42 are the new file) |

The API tests cover, per list: a valid add that is consumed by the real behaviour (a request asks for the review, is routed to the workflow, a role is notified, a tender goes to the added register, an invoice crosses the extra alert point, a manager is measured against their own capacity, a changed protected clause alerts General Counsel), validation errors, limits, the change log wording, removal, administrator-only (403 for seven other roles on every list section), old stored settings, an old client omitting the new field, and tenant isolation (a second organisation sees defaults and its change does not touch the first).

The OpenAPI document describes the settings body as a generic object (`SettingsUpdate`), so it has no per-section schema to update; the operation count and the authorisation matrix are unchanged (tests above).

## Honest limits

- End-to-end runs used a private copy of the web app and API on ports 3206 and 4100 with their own database; all temporary files were deleted afterwards. A first regression pass showed 12 failures in `b3`, `b5` and `b8`, all an HTTP 500 on a bid upload caused by my temporary stack (the key service root key differed between the seeding process and the API process in my shell, which has `SECRET_STORE_KEY` set). With one fixed `KMS_ROOT_KEY` for both, the same specs passed. The default `npm run e2e` was not run.

- The protected-clause end-to-end proof is an API test; the browser spec proves it is saved and shown after reload, not a contract edit. Likewise the extra spend alert: the invoice-crossing proof is an API test, the browser spec proves save, reload and storage.
- Capacity overrides can only name procurement managers who exist now; deactivating a person later leaves a harmless unused override.
- A routing rule can send a request to any of the four existing workflows, but not to a new workflow (workflows are not created from settings).
- Review rules and routing rules match words in the title and category (and background for review rules) as plain text, in any case; there is no regular expression or category-code matching.
- Public registers added here are simulated, like the three built in: a notice is recorded with a reference and an audit entry, nothing is sent outside.
- The currency section stays Save only because rates are held by Finance on their own page; if the owner wants rates edited from Settings, that is a separate change.
- Sections on the Residency page and other admin pages (list above) were not touched.
