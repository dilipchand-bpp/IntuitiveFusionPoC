# Roadmap batch B2 - evidence

**Batch:** B2, the tender and supplier portal. 16 stubbed requirements delivered (the list is `_work/delivered.json`, key `B2`; each is cited by an automated test, which a test enforces): FR-0125, FR-0140, FR-0145, FR-0180, FR-0190, FR-0195, FR-0200, FR-0205, FR-0210, FR-0215, FR-0220, FR-0225, FR-0230, FR-0240, FR-0245, FR-0250.

## What was built
| Area | Requirements | Result |
| --- | --- | --- |
| **Answers to one supplier** | FR-0145 | An answer goes to everyone (through the usual publication) or to the asker only. A single answer is published at once, notified in the app and by email to that supplier, and is invisible to every other supplier. The asker's identity is still never in any response. |
| **Late submissions** | FR-0140, FR-0215 | Procurement can allow one supplier extra time after close, with a reason and an end time; every grant and withdrawal is audited. A supplier with a live permission can upload, submit and withdraw; the rest of the market stays closed. The supplier page says so. There is still no override of the closing time for anyone else. |
| **Addenda that change dates** | FR-0125 | An addendum may move the closing time either way inside the statutory window (a shorter notice is refused with 422 `STATUTORY_WINDOW`); every invited and registered contact is emailed. |
| **Tender emails and release record** | FR-0195, FR-0200 | Invitation, publication, addendum, dates-changed, answer, late-permission, shortlisted and unsuccessful emails go through the simulated email service (`outbound_email`, visible to administrators and procurement at `/admin/settings`). One-time links are never written into the log. Publishing records the SHA-256 of the released pack. |
| **Public notices** | FR-0205 | Public-sector tenders at or above the minimum of an enabled public register (AusTender 80,000; SAM.gov and TED configurable, off by default) get a notice recorded and audited; shown on the tender's "Stages, register and notices" tab. The registers are simulated. |
| **Multi-stage tendering** | FR-0210, FR-0220 | After evaluation is locked, procurement shortlists suppliers: a stage-2 tender is created copying the pack, only shortlisted suppliers (with accepted invitations) are invited, and the others are told. A stage-2 supplier sees stage 1 and stage 2; files from stage 1 for a section not replaced are carried forward at submit and labelled so. |
| **Deviation register** | FR-0225, FR-0230 | Suppliers propose contract changes by clause. The register is sealed from staff until close; legal rates risk and status with commentary (audited) and exports it as Excel or Word. |
| **Separation of duties** | FR-0190 | Procurement, probity and administrator roles cannot join an evaluation panel (403 `ROLE_SOD_VIOLATION`). |
| **Onboarding and screening** | FR-0180, FR-0240 | Administrators define onboarding questions (yes/no, text, choice; mandatory; a flag value). Registration asks them, records the supplier's privacy choices, and screens the company against a synthetic watchlist. A match puts the supplier on hold (they cannot open tender documents), notifies procurement and sends a hold email; procurement releases or confirms with a recorded reason. |
| **Supplier profile** | FR-0245, FR-0250 | A real `/supplier/profile` page: screening and insurance status, certificate details (insurer, policy, cover, expiry; status Current / Expiring / Expired), privacy choices, and adding or removing the company's own colleagues (one-time activation link shown once; removal ends their sessions and is audited). Insurance status appears to buyers on each bid. |

## Defects found and fixed along the way
- Carrying files forward was first wired into the upload route (it copied everything); it now runs once, in the submit route.
- Supplier registration with only whitespace in an answer, and a supplier with a rejected-late bid, are handled (a rejected-late bid returns to draft once permission is granted).
- Axe found two links in running text with no underline (the registration "Sign in" link and the "Open" link on the stages list): both are underlined now.
- The anonymity test checked that no supplier id appears anywhere in the tender view; the view now lists invitees by id (needed to grant late access and shortlist), so the test checks every other part of the view and all question data.

## Verification (run on this machine)
| Check | Result |
| --- | --- |
| `npm run ci` (format, lint, typecheck, tests, build) | exit 0, **649 tests**; API tests 546 |
| Browser tests added | 7 in `e2e/b2.spec.ts` (single answer, late permission, onboarding questions, hold and release, profile and colleagues, deviation register, two-stage shortlist), each with an accessibility scan; all passed on the production build |
| Full browser suite (production build) and `npm audit --audit-level=high` | 221 passed, none failed, visual baselines unchanged; audit exit 0 |
| Traceability | a test fails if a built requirement is not cited by an automated test or not listed in `_work/delivered.json` |

## Not done / caveats
- Email, public registers and sanctions screening are simulated; the screening list is synthetic ("blocked holdings", "sanctioned trading", "embargo exports"). Swap points are in `docs/swap-points.md`.
- Insurance is recorded as details only; no certificate file is uploaded.
- The supplier privacy choices are stored and shown but do not yet change what a buyer sees in the supplier directory.
- Multi-stage tendering copies the pack; stage 2 is evaluated like any tender.
