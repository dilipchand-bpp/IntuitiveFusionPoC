# Requirements Traceability Matrix (RTM)

**Product:** Intuitive Fusion – Procurement Portal (POC)  |  **Version:** 0.1 DRAFT  |  **Date:** 2026-10-02  |  **Phase:** 1 – Requirements Analysis

Baseline sources: Requirements Register v0.2 (FR/NFR/SEC), pitch deck, Prompt.docx portal brief (PRM). Full machine-readable copy: [RTM.csv](RTM.csv).

**Chain:** Requirement → User story (G/W/T in [01b-User-Stories.md](01b-User-Stories.md)) → Spec reference (Phase 2) → Test case (authored in Phase 4/5) → Result (filled during build).
Test case IDs are allocated 1:1 in the register's scheme (TC-Fnnnn / TC-Nnn / TC-Snnn); story-level acceptance tests (`AT-<story id>`) carry the executable Given/When/Then. **Results column is intentionally empty until Phase 5** — nothing has been run against code yet.

**POC tier key:** `W` = working end-to-end in Phase 5 · `S` = stubbed / mocked behind a swap point ('Coming soon' state) · `D` = deferred or design-only (documented in architecture; not built in POC).

## 1. Coverage summary (computed by script from the data below)

| Measure | Result |
|---|---|
| Requirements traced | 312 (184 FR, 54 NFR, 65 SEC, 9 PRM) |
| Requirements with ≥1 user story | 312 / 312 |
| User stories with ≥1 requirement (no orphans) | 68 / 68 |
| Requirements with a test case ID | 312 / 312 |
| Tier W / S / D (all) | 82 / 122 / 108 |

| Type | W | S | D |
|---|---|---|---|
| Functional | 44 | 116 | 24 |
| Non-functional | 10 | 0 | 44 |
| Security | 19 | 6 | 40 |
| Brief (prompt) | 9 | 0 | 0 |

## 2. Register data-quality defects found while tracing

- FR-X01: register row has no ID (provisional ID assigned) — 'The platform shall provide a conversational AI capability in which the'
- FR-X02: register row has no ID (provisional ID assigned) — 'The customer shall have the ability to configure muiltiple procurement'
- FR-X03: register row has no ID (provisional ID assigned) — 'The platform shall offer users the ability to select from mulitple lay'
- FR-X04: register row has no ID (provisional ID assigned) — 'The platform shall offer configurable forms'
- FR-0055: description is an open question ('what is next step??'), not a requirement; acceptance criteria exist and were used
- FR-X05: register row has no ID (provisional ID assigned) — 'CLIENT QUERY: This row (private-sector 'soft cap' model) has no Requir'
- FR-X05: requirement description is blank in the register
- FR-0090: requirement description is blank in the register
- FR-X06: register row has no ID (provisional ID assigned) — 'Delegated approval setup and actioned. This is a customer configurable'
- The register's own *Traceability Matrix* tab uses IDs `FR-001…FR-180` (3-digit) whereas the *Functional Requirements* tab uses `FR-0005…FR-0880` (4-digit, step of 5). The two cannot be joined; this RTM uses the Functional tab IDs as authoritative. **Decision needed (Q-07).**
- Many register 'Source' cells reference BRS/DD sections not supplied to this POC; they are carried through unverified.

## 3. Matrix

| Req ID | Type | Category | Pri | Tier | Stories | Spec | Test case | Result |
|---|---|---|---|---|---|---|---|---|
| FR-0005 | Func | Request Intake & AI | Must | W | INT-01 | TS-INT | TC-F0005 | – |
| FR-0006 | Func | Request Intake & AI | Must | W | INT-01 | TS-INT | TC-F0006 | – |
| FR-X01 | Func | Request Intake & AI | Could | D | INT-01, INT-02 | TS-INT | TC-FX01 | – |
| FR-0010 | Func | Request Intake & AI | Should | S | INT-01, INT-02 | TS-INT | TC-F0010 | – |
| FR-0015 | Func | Request Intake & AI | Must | S | INT-01, INT-02 | TS-INT | TC-F0015 | – |
| FR-0020 | Func | Request Intake & AI | Should | S | INT-01, INT-02 | TS-INT | TC-F0020 | – |
| FR-0025 | Func | Request Intake & AI | Must | W | INT-01, INT-02 | TS-INT | TC-F0025 | – |
| FR-X02 | Func | Request Intake & AI | Unprioritised | S | INT-01, INT-02 | TS-INT | TC-FX02 | – |
| FR-0030 | Func | Request Intake & AI | Must | S | INT-01, INT-02 | TS-INT | TC-F0030 | – |
| FR-0035 | Func | Request Intake & AI | Must | W | INT-02 | TS-INT | TC-F0035 | – |
| FR-0040 | Func | Request Intake & AI | Must | S | INT-04 | TS-INT | TC-F0040 | – |
| FR-0045 | Func | Request Intake & AI | Should | S | INT-01, INT-02 | TS-INT | TC-F0045 | – |
| FR-X03 | Func | Request Intake & AI | Should | S | INT-01, INT-02 | TS-INT | TC-FX03 | – |
| FR-X04 | Func | Request Intake & AI | Should | S | INT-01, INT-02 | TS-INT | TC-FX04 | – |
| FR-0050 | Func | Request Intake & AI | Must | S | INT-06 | TS-INT | TC-F0050 | – |
| FR-0055 | Func | Request Intake & AI | Must | S | INT-06 | TS-INT | TC-F0055 | – |
| FR-X05 | Func | Request Intake & AI | Unprioritised | S | INT-01, INT-02 | TS-INT | TC-FX05 | – |
| FR-0060 | Func | Request Intake & AI | Must | W | INT-03 | TS-INT | TC-F0060 | – |
| FR-0065 | Func | Request Intake & AI | Must | S | PLT-04 | TS-INT | TC-F0065 | – |
| FR-0066 | Func | Request Intake & AI | Must | S | PLT-04 | TS-INT | TC-F0066 | – |
| FR-0070 | Func | Request Intake & AI | Must | W | NFR-01, INT-05 | TS-INT | TC-F0070 | – |
| FR-0075 | Func | Procurement Plan | Must | W | PLN-01 | TS-PLN | TC-F0075 | – |
| FR-0080 | Func | Procurement Plan | Must | W | PLN-03 | TS-PLN | TC-F0080 | – |
| FR-0085 | Func | Procurement Plan | Should | S | PLN-01, PLN-02 | TS-PLN | TC-F0085 | – |
| FR-0090 | Func | Procurement Plan | Must | S | PLN-01, PLN-02 | TS-PLN | TC-F0090 | – |
| FR-0095 | Func | Procurement Plan | Should | S | PLN-01, PLN-02 | TS-PLN | TC-F0095 | – |
| FR-0100 | Func | Procurement Plan | Must | W | PLN-04, NFR-02 | TS-PLN | TC-F0100 | – |
| FR-X06 | Func | Request Intake & AI | Unprioritised | S | INT-01, INT-02 | TS-INT | TC-FX06 | – |
| FR-0105 | Func | Procurement Plan | Must | W | PLN-05 | TS-PLN | TC-F0105 | – |
| FR-0110 | Func | RFx / Tender Collaboration | Must | W | TND-01 | TS-TND | TC-F0110 | – |
| FR-0115 | Func | RFx / Tender Collaboration | Should | S | TND-01, TND-02 | TS-TND | TC-F0115 | – |
| FR-0120 | Func | RFx / Tender Collaboration | Must | W | TND-01 | TS-TND | TC-F0120 | – |
| FR-0125 | Func | RFx / Tender Collaboration | Should | S | CON-02 | TS-TND | TC-F0125 | – |
| FR-0130 | Func | RFx / Tender Collaboration | Won't | D | TND-01, TND-02 | TS-TND | TC-F0130 | – |
| FR-0135 | Func | RFx / Tender Collaboration | Must | W | TND-03 | TS-TND | TC-F0135 | – |
| FR-0140 | Func | RFx / Tender Collaboration | Must | S | TND-01, TND-02 | TS-TND | TC-F0140 | – |
| FR-0145 | Func | RFx / Tender Collaboration | Must | S | TND-04 | TS-TND | TC-F0145 | – |
| FR-0150 | Func | RFx / Tender Collaboration | Must | W | TND-02 | TS-TND | TC-F0150 | – |
| FR-0155 | Func | Tender Portal | Must | W | SUP-02 | TS-SUP | TC-F0155 | – |
| FR-0160 | Func | Tender Portal | Must | W | SUP-02 | TS-SUP | TC-F0160 | – |
| FR-0165 | Func | Tender Portal | Must | W | SUP-04 | TS-SUP | TC-F0165 | – |
| FR-0170 | Func | Tender Portal | Must | W | SUP-03 | TS-SUP | TC-F0170 | – |
| FR-0175 | Func | Tender Portal | Could | D | SUP-02, SUP-03 | TS-SUP | TC-F0175 | – |
| FR-0180 | Func | Tender Portal | Must | S | SUP-05 | TS-SUP | TC-F0180 | – |
| FR-0185 | Func | Tender Portal | Could | D | SUP-05 | TS-SUP | TC-F0185 | – |
| FR-0190 | Func | Tender Portal | Must | S | NFR-02 | TS-SUP | TC-F0190 | – |
| FR-0195 | Func | Tender Portal | Must | S | SUP-02, SUP-03 | TS-SUP | TC-F0195 | – |
| FR-0200 | Func | Tender Portal | Must | S | SUP-02, SUP-03 | TS-SUP | TC-F0200 | – |
| FR-0205 | Func | Tender Portal | Should | S | SUP-02, SUP-03 | TS-SUP | TC-F0205 | – |
| FR-0210 | Func | Tender Portal | Must | S | SUP-02, SUP-03 | TS-SUP | TC-F0210 | – |
| FR-0215 | Func | Tender Portal | Should | S | SUP-02, SUP-03 | TS-SUP | TC-F0215 | – |
| FR-0220 | Func | Tender Portal | Should | S | SUP-02, SUP-03 | TS-SUP | TC-F0220 | – |
| FR-0225 | Func | Tender Portal | Must | S | SUP-02, SUP-03 | TS-SUP | TC-F0225 | – |
| FR-0230 | Func | Tender Portal | Must | S | SUP-02, SUP-03 | TS-SUP | TC-F0230 | – |
| FR-0235 | Func | Supplier Portal | Must | W | SUP-01 | TS-SUP | TC-F0235 | – |
| FR-0240 | Func | Supplier Portal | Must | S | SUP-01 | TS-SUP | TC-F0240 | – |
| FR-0245 | Func | Supplier Portal | Must | S | SUP-01, SUP-05 | TS-SUP | TC-F0245 | – |
| FR-0250 | Func | Supplier Portal | Must | S | SUP-05 | TS-SUP | TC-F0250 | – |
| FR-0255 | Func | Evaluation | Must | W | EVL-02 | TS-EVL | TC-F0255 | – |
| FR-0260 | Func | Evaluation | Must | W | EVL-03 | TS-EVL | TC-F0260 | – |
| FR-0265 | Func | Evaluation | Must | S | EVL-01, EVL-02 | TS-EVL | TC-F0265 | – |
| FR-0270 | Func | Evaluation | Must | W | EVL-03 | TS-EVL | TC-F0270 | – |
| FR-0275 | Func | Evaluation | Must | W | EVL-04 | TS-EVL | TC-F0275 | – |
| FR-0280 | Func | Evaluation | Must | S | EVL-01, EVL-02 | TS-EVL | TC-F0280 | – |
| FR-0285 | Func | Evaluation | Must | S | EVL-01, EVL-02 | TS-EVL | TC-F0285 | – |
| FR-0290 | Func | Evaluation | Must | S | EVL-08 | TS-EVL | TC-F0290 | – |
| FR-0295 | Func | Evaluation | Should | S | EVL-08 | TS-EVL | TC-F0295 | – |
| FR-0300 | Func | Evaluation | Must | W | EVL-01 | TS-EVL | TC-F0300 | – |
| FR-0305 | Func | Evaluation | Must | S | EVL-01, EVL-02 | TS-EVL | TC-F0305 | – |
| FR-0310 | Func | Evaluation | Must | S | EVL-07 | TS-EVL | TC-F0310 | – |
| FR-0315 | Func | Evaluation | Must | S | EVL-01, EVL-02 | TS-EVL | TC-F0315 | – |
| FR-0320 | Func | Evaluation | Must | S | EVL-01, EVL-02 | TS-EVL | TC-F0320 | – |
| FR-0325 | Func | Evaluation | Must | S | EVL-01 | TS-EVL | TC-F0325 | – |
| FR-0330 | Func | Evaluation | Must | S | EVL-01 | TS-EVL | TC-F0330 | – |
| FR-0335 | Func | Evaluation | Must | S | EVL-01 | TS-EVL | TC-F0335 | – |
| FR-0340 | Func | Evaluation | Should | S | EVL-01, EVL-02 | TS-EVL | TC-F0340 | – |
| FR-0345 | Func | Evaluation Report | Must | W | EVL-05 | TS-EVL | TC-F0345 | – |
| FR-0350 | Func | Evaluation Report | Must | S | EVL-05 | TS-EVL | TC-F0350 | – |
| FR-0355 | Func | Evaluation Report | Must | S | EVL-05, EVL-06 | TS-EVL | TC-F0355 | – |
| FR-0360 | Func | Evaluation Report | Must | S | EVL-05, EVL-06 | TS-EVL | TC-F0360 | – |
| FR-0365 | Func | Evaluation Report | Should | S | EVL-05, EVL-06 | TS-EVL | TC-F0365 | – |
| FR-0370 | Func | Evaluation Report | Must | S | EVL-05, EVL-06 | TS-EVL | TC-F0370 | – |
| FR-0375 | Func | Evaluation Report | Must | S | EVL-06 | TS-EVL | TC-F0375 | – |
| FR-0380 | Func | Contract Award & Legal | Must | W | CON-03 | TS-CON | TC-F0380 | – |
| FR-0385 | Func | Contract Award & Legal | Must | S | CON-01, CON-02 | TS-CON | TC-F0385 | – |
| FR-0390 | Func | Contract Award & Legal | Could | D | CON-01, CON-02 | TS-CON | TC-F0390 | – |
| FR-0395 | Func | Contract Award & Legal | Must | W | CON-01 | TS-CON | TC-F0395 | – |
| FR-0400 | Func | Contract Award & Legal | Must | S | CON-01, CON-02 | TS-CON | TC-F0400 | – |
| FR-0405 | Func | Contract Award & Legal | Must | S | CON-01 | TS-CON | TC-F0405 | – |
| FR-0410 | Func | Contract Award & Legal | Must | W | CON-03 | TS-CON | TC-F0410 | – |
| FR-0415 | Func | Contract Award & Legal | Must | S | CON-01, CON-02 | TS-CON | TC-F0415 | – |
| FR-0420 | Func | Contract Award & Legal | Must | W | CON-03 | TS-CON | TC-F0420 | – |
| FR-0425 | Func | Contract Award & Legal | Should | S | CON-01, CON-02 | TS-CON | TC-F0425 | – |
| FR-0430 | Func | Contract Award & Legal | Should | S | CON-01, CON-02 | TS-CON | TC-F0430 | – |
| FR-0435 | Func | Contract Award & Legal | Should | S | CON-01, CON-02 | TS-CON | TC-F0435 | – |
| FR-0440 | Func | Contract Award & Legal | Should | S | CON-01, CON-02 | TS-CON | TC-F0440 | – |
| FR-0445 | Func | Contract Award & Legal | Should | S | CON-01, CON-02 | TS-CON | TC-F0445 | – |
| FR-0450 | Func | Contract Award & Legal | Should | S | CON-01, CON-02 | TS-CON | TC-F0450 | – |
| FR-0455 | Func | Contract Award & Legal | Must | W | CON-04 | TS-CON | TC-F0455 | – |
| FR-0460 | Func | Contract Award & Legal | Must | S | CON-05 | TS-CON | TC-F0460 | – |
| FR-0465 | Func | Contract Award & Legal | Must | S | CON-01, CON-02 | TS-CON | TC-F0465 | – |
| FR-0470 | Func | Contract Award & Legal | Should | S | CON-01, CON-02 | TS-CON | TC-F0470 | – |
| FR-0475 | Func | Contract Award & Legal | Must | S | CON-02 | TS-CON | TC-F0475 | – |
| FR-0480 | Func | Contract Award & Legal | Must | S | CON-01, CON-02 | TS-CON | TC-F0480 | – |
| FR-0485 | Func | Contract Award & Legal | Should | S | CON-01, CON-02 | TS-CON | TC-F0485 | – |
| FR-0490 | Func | Contract Management | Must | W | CMG-01 | TS-CMG | TC-F0490 | – |
| FR-0495 | Func | Contract Management | Should | S | CMG-01, CMG-02 | TS-CMG | TC-F0495 | – |
| FR-0500 | Func | Contract Management | Should | S | CMG-01, CMG-02 | TS-CMG | TC-F0500 | – |
| FR-0505 | Func | Contract Management | Must | W | CMG-02 | TS-CMG | TC-F0505 | – |
| FR-0510 | Func | Contract Management | Must | S | CMG-02 | TS-CMG | TC-F0510 | – |
| FR-0515 | Func | Contract Management | Must | S | CMG-03 | TS-CMG | TC-F0515 | – |
| FR-0520 | Func | Contract Management | Should | S | CMG-01, CMG-02 | TS-CMG | TC-F0520 | – |
| FR-0525 | Func | Contract Management | Should | S | CMG-01, CMG-02 | TS-CMG | TC-F0525 | – |
| FR-0530 | Func | Contract Management | Must | S | CMG-03 | TS-CMG | TC-F0530 | – |
| FR-0535 | Func | Contract Management | Must | S | CMG-01, CMG-02 | TS-CMG | TC-F0535 | – |
| FR-0540 | Func | Contract Management | Must | S | CMG-01, CMG-02 | TS-CMG | TC-F0540 | – |
| FR-0545 | Func | Contract Management | Should | S | CMG-01, CMG-02 | TS-CMG | TC-F0545 | – |
| FR-0550 | Func | Contract Management | Must | S | CMG-01, CMG-02 | TS-CMG | TC-F0550 | – |
| FR-0555 | Func | Contract Management | Must | S | CMG-01, CMG-02 | TS-CMG | TC-F0555 | – |
| FR-0560 | Func | Contract Management | Must | S | CMG-01, CMG-02 | TS-CMG | TC-F0560 | – |
| FR-0565 | Func | Contract Management | Must | S | CMG-01, CMG-02 | TS-CMG | TC-F0565 | – |
| FR-0570 | Func | Contract Management | Must | S | CMG-01, CMG-02 | TS-CMG | TC-F0570 | – |
| FR-0575 | Func | Contract Management | Must | S | CMG-01, CMG-02 | TS-CMG | TC-F0575 | – |
| FR-0580 | Func | Contract Management | Must | S | CMG-05 | TS-CMG | TC-F0580 | – |
| FR-0585 | Func | Contract Management | Should | S | CMG-01, CMG-02 | TS-CMG | TC-F0585 | – |
| FR-0590 | Func | Reporting & Dashboards | Must | W | RPT-01 | TS-RPT | TC-F0590 | – |
| FR-0595 | Func | Reporting & Dashboards | Must | S | RPT-04 | TS-RPT | TC-F0595 | – |
| FR-0600 | Func | Reporting & Dashboards | Must | S | RPT-01, RPT-02 | TS-RPT | TC-F0600 | – |
| FR-0605 | Func | Reporting & Dashboards | Must | S | RPT-03 | TS-RPT | TC-F0605 | – |
| FR-0610 | Func | Reporting & Dashboards | Should | S | RPT-01, RPT-02 | TS-RPT | TC-F0610 | – |
| FR-0615 | Func | Reporting & Dashboards | Must | W | RPT-02 | TS-RPT | TC-F0615 | – |
| FR-0620 | Func | Reporting & Dashboards | Must | S | RPT-04 | TS-RPT | TC-F0620 | – |
| FR-0625 | Func | Reporting & Dashboards | Must | S | RPT-01, RPT-02 | TS-RPT | TC-F0625 | – |
| FR-0630 | Func | Reporting & Dashboards | Must | W | RPT-02, NFR-01 | TS-RPT | TC-F0630 | – |
| FR-0635 | Func | Reporting & Dashboards | Must | W | CMG-04 | TS-RPT | TC-F0635 | – |
| FR-0640 | Func | Reporting & Dashboards | Must | W | CMG-04 | TS-RPT | TC-F0640 | – |
| FR-0645 | Func | Reporting & Dashboards | Must | S | RPT-01, RPT-02 | TS-RPT | TC-F0645 | – |
| FR-0650 | Func | Reporting & Dashboards | Must | W | RPT-01 | TS-RPT | TC-F0650 | – |
| FR-0655 | Func | Data Migration | Must | S | MIG-01 | TS-MIG | TC-F0655 | – |
| FR-0660 | Func | Data Migration | Must | S | MIG-01 | TS-MIG | TC-F0660 | – |
| FR-0665 | Func | Data Migration | Must | S | MIG-01 | TS-MIG | TC-F0665 | – |
| FR-0670 | Func | Data Migration | Must | S | MIG-01 | TS-MIG | TC-F0670 | – |
| FR-0675 | Func | Data Migration | Must | S | MIG-01 | TS-MIG | TC-F0675 | – |
| FR-0680 | Func | Admin & Configuration | Must | W | ADM-01, ADM-02 | TS-ADM | TC-F0680 | – |
| FR-0685 | Func | Admin & Configuration | Must | W | ADM-04 | TS-ADM | TC-F0685 | – |
| FR-0690 | Func | Admin & Configuration | Must | S | ADM-01, ADM-02 | TS-ADM | TC-F0690 | – |
| FR-0695 | Func | Admin & Configuration | Must | S | ADM-01, ADM-02 | TS-ADM | TC-F0695 | – |
| FR-0700 | Func | Admin & Configuration | Must | S | ADM-02 | TS-ADM | TC-F0700 | – |
| FR-0705 | Func | Admin & Configuration | Must | S | ADM-02 | TS-ADM | TC-F0705 | – |
| FR-0710 | Func | Admin & Configuration | Must | S | ADM-02 | TS-ADM | TC-F0710 | – |
| FR-0715 | Func | Admin & Configuration | Must | W | ADM-01 | TS-ADM | TC-F0715 | – |
| FR-0720 | Func | Admin & Configuration | Must | S | ADM-02 | TS-ADM | TC-F0720 | – |
| FR-0725 | Func | Admin & Configuration | Must | S | ADM-01 | TS-ADM | TC-F0725 | – |
| FR-0730 | Func | Admin & Configuration | Should | S | ADM-01, ADM-02 | TS-ADM | TC-F0730 | – |
| FR-0735 | Func | Collaboration & AI Authoring | Must | S | AIA-01, AIA-02 | TS-AIA | TC-F0735 | – |
| FR-0740 | Func | Collaboration & AI Authoring | Must | S | AIA-01, AIA-02 | TS-AIA | TC-F0740 | – |
| FR-0745 | Func | Collaboration & AI Authoring | Should | W | AIA-01, AIA-02 | TS-AIA | TC-F0745 | – |
| FR-0750 | Func | Collaboration & AI Authoring | Must | S | ADM-03, AIA-02 | TS-AIA | TC-F0750 | – |
| FR-0755 | Func | Collaboration & AI Authoring | Should | S | AIA-01, AIA-02 | TS-AIA | TC-F0755 | – |
| FR-0760 | Func | Collaboration & AI Authoring | Must | S | AIA-01, AIA-02 | TS-AIA | TC-F0760 | – |
| FR-0765 | Func | Collaboration & AI Authoring | Should | S | AIA-01, AIA-02 | TS-AIA | TC-F0765 | – |
| FR-0770 | Func | Collaboration & AI Authoring | Must | S | AIA-01, AIA-02 | TS-AIA | TC-F0770 | – |
| FR-0775 | Func | Collaboration & AI Authoring | Should | S | AIA-01, AIA-02 | TS-AIA | TC-F0775 | – |
| FR-0780 | Func | Collaboration & AI Authoring | Must | W | AIA-01, AIA-02 | TS-AIA | TC-F0780 | – |
| FR-0785 | Func | Collaboration & AI Authoring | Must | W | AIA-01, AIA-02 | TS-AIA | TC-F0785 | – |
| FR-0790 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0790 | – |
| FR-0795 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0795 | – |
| FR-0800 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0800 | – |
| FR-0805 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0805 | – |
| FR-0810 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0810 | – |
| FR-0815 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0815 | – |
| FR-0820 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0820 | – |
| FR-0825 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0825 | – |
| FR-0830 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0830 | – |
| FR-0835 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0835 | – |
| FR-0840 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0840 | – |
| FR-0845 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0845 | – |
| FR-0850 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0850 | – |
| FR-0855 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0855 | – |
| FR-0860 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0860 | – |
| FR-0865 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0865 | – |
| FR-0870 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0870 | – |
| FR-0875 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0875 | – |
| FR-0880 | Func | Future Scope | Won't | D | FUT-01 | TS-FUT | TC-F0880 | – |
| NFR-P01 | Non- | Performance & Response Time | Must | D | NFR-05 | TS-PLT | TC-NFP01 | – |
| NFR-P02 | Non- | Performance & Response Time | Should | D | NFR-05 | TS-PLT | TC-NFP02 | – |
| NFR-P03 | Non- | Performance & Response Time | Must | W | PLN-06, NFR-05 | TS-PLT | TC-NFP03 | – |
| NFR-P04 | Non- | Performance & Response Time | Must | D | NFR-05 | TS-PLT | TC-NFP04 | – |
| NFR-P05 | Non- | Performance & Response Time | Must | D | NFR-05 | TS-PLT | TC-NFP05 | – |
| NFR-P06 | Non- | Performance & Response Time | Must | W | NFR-05 | TS-PLT | TC-NFP06 | – |
| NFR-SC01 | Non- | Scalability | Must | D | NFR-05 | TS-PLT | TC-NFSC01 | – |
| NFR-SC02 | Non- | Scalability | Must | D | NFR-05 | TS-PLT | TC-NFSC02 | – |
| NFR-SC03 | Non- | Scalability | Must | D | NFR-05 | TS-PLT | TC-NFSC03 | – |
| NFR-SC04 | Non- | Scalability | Must | D | NFR-05 | TS-PLT | TC-NFSC04 | – |
| NFR-AV01 | Non- | Availability & Reliability | Must | D | NFR-06, NFR-09, AIA-02 | TS-PLT | TC-NFAV01 | – |
| NFR-AV02 | Non- | Availability & Reliability | Must | D | NFR-06, NFR-09, AIA-02 | TS-PLT | TC-NFAV02 | – |
| NFR-AV03 | Non- | Availability & Reliability | Must | D | NFR-06, NFR-09, AIA-02 | TS-PLT | TC-NFAV03 | – |
| NFR-AV04 | Non- | Availability & Reliability | Must | D | NFR-06, NFR-09, AIA-02 | TS-PLT | TC-NFAV04 | – |
| NFR-AV05 | Non- | Availability & Reliability | Must | W | NFR-06, NFR-09, AIA-02 | TS-PLT | TC-NFAV05 | – |
| NFR-U01 | Non- | Usability & Accessibility | Must | W | PLT-05, NFR-11 | TS-PLT | TC-NFU01 | – |
| NFR-U02 | Non- | Usability & Accessibility | Must | W | NFR-11, PLT-05 | TS-PLT | TC-NFU02 | – |
| NFR-U03 | Non- | Usability & Accessibility | Must | W | TND-05, NFR-11, PLT-05 | TS-PLT | TC-NFU03 | – |
| NFR-U04 | Non- | Usability & Accessibility | Should | D | NFR-11, PLT-05 | TS-PLT | TC-NFU04 | – |
| NFR-U05 | Non- | Usability & Accessibility | Should | D | NFR-11, PLT-05 | TS-PLT | TC-NFU05 | – |
| NFR-U06 | Non- | Usability & Accessibility | Should | W | NFR-11, PLT-05 | TS-PLT | TC-NFU06 | – |
| NFR-U07 | Non- | Usability & Accessibility | Must | W | NFR-11, PLT-05 | TS-PLT | TC-NFU07 | – |
| NFR-U08 | Non- | Usability & Accessibility | Should | D | NFR-11, PLT-05 | TS-PLT | TC-NFU08 | – |
| NFR-M01 | Non- | Maintainability & Supportabi | Must | D | NFR-07, NFR-08 | TS-PLT | TC-NFM01 | – |
| NFR-M02 | Non- | Maintainability & Supportabi | Must | W | NFR-07, NFR-08 | TS-PLT | TC-NFM02 | – |
| NFR-M03 | Non- | Maintainability & Supportabi | Must | D | NFR-07, NFR-08 | TS-PLT | TC-NFM03 | – |
| NFR-M04 | Non- | Maintainability & Supportabi | Should | D | NFR-07, NFR-08 | TS-PLT | TC-NFM04 | – |
| NFR-M05 | Non- | Maintainability & Supportabi | Must | D | NFR-07, NFR-08 | TS-PLT | TC-NFM05 | – |
| NFR-M06 | Non- | Maintainability & Supportabi | Should | D | NFR-07, NFR-08 | TS-PLT | TC-NFM06 | – |
| NFR-C01 | Non- | Compatibility & Portability | Must | D | NFR-08, NFR-09 | TS-PLT | TC-NFC01 | – |
| NFR-C02 | Non- | Compatibility & Portability | Must | D | NFR-08, NFR-09 | TS-PLT | TC-NFC02 | – |
| NFR-C03 | Non- | Compatibility & Portability | Must | D | NFR-08, NFR-09 | TS-PLT | TC-NFC03 | – |
| NFR-C04 | Non- | Compatibility & Portability | Must | D | NFR-08, NFR-09 | TS-PLT | TC-NFC04 | – |
| NFR-C05 | Non- | Compatibility & Portability | Must | D | NFR-08, NFR-09 | TS-PLT | TC-NFC05 | – |
| NFR-C06 | Non- | Compatibility & Portability | Should | D | NFR-08, NFR-09 | TS-PLT | TC-NFC06 | – |
| NFR-C07 | Non- | Compatibility & Portability | Should | D | NFR-08, NFR-09 | TS-PLT | TC-NFC07 | – |
| NFR-C08 | Non- | Compatibility & Portability | Should | D | NFR-08, NFR-09 | TS-PLT | TC-NFC08 | – |
| NFR-CA01 | Non- | Capacity & Data Volume | Must | D | NFR-06, NFR-10 | TS-PLT | TC-NFCA01 | – |
| NFR-CA02 | Non- | Capacity & Data Volume | Must | W | NFR-06, NFR-10 | TS-PLT | TC-NFCA02 | – |
| NFR-CA03 | Non- | Capacity & Data Volume | Must | D | NFR-06, NFR-10 | TS-PLT | TC-NFCA03 | – |
| NFR-CA04 | Non- | Capacity & Data Volume | Must | D | NFR-06, NFR-10 | TS-PLT | TC-NFCA04 | – |
| NFR-DR01 | Non- | Disaster Recovery & Business | Must | D | NFR-06 | TS-PLT | TC-NFDR01 | – |
| NFR-DR02 | Non- | Disaster Recovery & Business | Must | D | NFR-06 | TS-PLT | TC-NFDR02 | – |
| NFR-DR03 | Non- | Disaster Recovery & Business | Must | D | NFR-06 | TS-PLT | TC-NFDR03 | – |
| NFR-L01 | Non- | Legal | Must | D | NFR-10 | TS-PLT | TC-NFL01 | – |
| NFR-L02 | Non- | Legal | Must | D | NFR-10 | TS-PLT | TC-NFL02 | – |
| NFR-L03 | Non- | Legal | Must | D | NFR-10 | TS-PLT | TC-NFL03 | – |
| NFR-L04 | Non- | Legal | Must | D | NFR-10 | TS-PLT | TC-NFL04 | – |
| NFR-R01 | Non- | Regulatory & Environmental | Must | D | NFR-10, NFR-04 | TS-PLT | TC-NFR01 | – |
| NFR-R02 | Non- | Regulatory & Environmental | Must | D | NFR-10, NFR-04 | TS-PLT | TC-NFR02 | – |
| NFR-R03 | Non- | Regulatory & Environmental | Must | D | NFR-10, NFR-04 | TS-PLT | TC-NFR03 | – |
| NFR-R04 | Non- | Regulatory & Environmental | Should | D | NFR-10, NFR-04 | TS-PLT | TC-NFR04 | – |
| NFR-R05 | Non- | Regulatory & Environmental | Should | D | NFR-10, NFR-04 | TS-PLT | TC-NFR05 | – |
| NFR-R06 | Non- | Regulatory & Environmental | Must | D | NFR-10, NFR-04 | TS-PLT | TC-NFR06 | – |
| SEC-A01 | Secu | Authentication & Identity | Must | S | NFR-03, PLT-02 | TS-PLT | TC-SA01 | – |
| SEC-A02 | Secu | Authentication & Identity | Must | S | NFR-03, PLT-02 | TS-PLT | TC-SA02 | – |
| SEC-A03 | Secu | Authentication & Identity | Must | S | NFR-03, PLT-02 | TS-PLT | TC-SA03 | – |
| SEC-A04 | Secu | Authentication & Identity | Must | S | NFR-03, PLT-02 | TS-PLT | TC-SA04 | – |
| SEC-A05 | Secu | Authentication & Identity | Should | S | NFR-03, PLT-02 | TS-PLT | TC-SA05 | – |
| SEC-A06 | Secu | Authentication & Identity | Must | S | NFR-03, PLT-02 | TS-PLT | TC-SA06 | – |
| SEC-A07 | Secu | Authentication & Identity | Should | W | NFR-03, PLT-02 | TS-PLT | TC-SA07 | – |
| SEC-AC01 | Secu | Authorisation & Access Contr | Must | W | NFR-02, PLT-03 | TS-PLT | TC-SAC01 | – |
| SEC-AC02 | Secu | Authorisation & Access Contr | Must | W | NFR-02, PLT-03 | TS-PLT | TC-SAC02 | – |
| SEC-AC03 | Secu | Authorisation & Access Contr | Must | W | NFR-02, PLT-03 | TS-PLT | TC-SAC03 | – |
| SEC-AC04 | Secu | Authorisation & Access Contr | Must | W | NFR-02, PLT-03 | TS-PLT | TC-SAC04 | – |
| SEC-AC05 | Secu | Authorisation & Access Contr | Must | W | NFR-02, PLT-03 | TS-PLT | TC-SAC05 | – |
| SEC-AC06 | Secu | Authorisation & Access Contr | Must | W | NFR-02, PLT-03 | TS-PLT | TC-SAC06 | – |
| SEC-AC07 | Secu | Authorisation & Access Contr | Must | W | NFR-02, PLT-03 | TS-PLT | TC-SAC07 | – |
| SEC-AC08 | Secu | Authorisation & Access Contr | Must | W | NFR-02, PLT-03 | TS-PLT | TC-SAC08 | – |
| SEC-AC09 | Secu | Authorisation & Access Contr | Must | D | NFR-02, PLT-03 | TS-PLT | TC-SAC09 | – |
| SEC-AC10 | Secu | Authorisation & Access Contr | Should | D | NFR-02, PLT-03 | TS-PLT | TC-SAC10 | – |
| SEC-AC11 | Secu | Authorisation & Access Contr | Must | W | NFR-02, PLT-03 | TS-PLT | TC-SAC11 | – |
| SEC-AC12 | Secu | Authorisation & Access Contr | Must | W | NFR-02, PLT-03 | TS-PLT | TC-SAC12 | – |
| SEC-AC13 | Secu | Authorisation & Access Contr | Must | W | NFR-02, PLT-03 | TS-PLT | TC-SAC13 | – |
| SEC-D01 | Secu | Data Protection & Privacy | Must | D | NFR-04 | TS-PLT | TC-SD01 | – |
| SEC-D02 | Secu | Data Protection & Privacy | Must | D | NFR-04 | TS-PLT | TC-SD02 | – |
| SEC-D03 | Secu | Data Protection & Privacy | Must | D | NFR-04 | TS-PLT | TC-SD03 | – |
| SEC-D04 | Secu | Data Protection & Privacy | Must | D | NFR-04 | TS-PLT | TC-SD04 | – |
| SEC-D05 | Secu | Data Protection & Privacy | Must | D | NFR-04 | TS-PLT | TC-SD05 | – |
| SEC-D06 | Secu | Data Protection & Privacy | Must | D | NFR-04 | TS-PLT | TC-SD06 | – |
| SEC-D07 | Secu | Data Protection & Privacy | Must | D | NFR-04 | TS-PLT | TC-SD07 | – |
| SEC-D08 | Secu | Data Protection & Privacy | Must | D | NFR-04 | TS-PLT | TC-SD08 | – |
| SEC-D09 | Secu | Data Protection & Privacy | Must | D | NFR-04 | TS-PLT | TC-SD09 | – |
| SEC-D10 | Secu | Data Protection & Privacy | Must | D | NFR-04 | TS-PLT | TC-SD10 | – |
| SEC-D11 | Secu | Data Protection & Privacy | Should | D | NFR-04 | TS-PLT | TC-SD11 | – |
| SEC-L01 | Secu | Audit Logging & Monitoring | Must | W | NFR-01 | TS-PLT | TC-SL01 | – |
| SEC-L02 | Secu | Audit Logging & Monitoring | Must | D | NFR-01 | TS-PLT | TC-SL02 | – |
| SEC-L03 | Secu | Audit Logging & Monitoring | Must | W | NFR-01 | TS-PLT | TC-SL03 | – |
| SEC-L04 | Secu | Audit Logging & Monitoring | Must | W | NFR-01 | TS-PLT | TC-SL04 | – |
| SEC-L05 | Secu | Audit Logging & Monitoring | Must | W | NFR-01 | TS-PLT | TC-SL05 | – |
| SEC-L06 | Secu | Audit Logging & Monitoring | Must | D | NFR-01 | TS-PLT | TC-SL06 | – |
| SEC-L07 | Secu | Audit Logging & Monitoring | Must | D | NFR-01 | TS-PLT | TC-SL07 | – |
| SEC-L08 | Secu | Audit Logging & Monitoring | Must | D | NFR-01 | TS-PLT | TC-SL08 | – |
| SEC-AP01 | Secu | Application Security | Must | D | NFR-07, NFR-08 | TS-PLT | TC-SAP01 | – |
| SEC-AP02 | Secu | Application Security | Must | D | NFR-07, NFR-08 | TS-PLT | TC-SAP02 | – |
| SEC-AP03 | Secu | Application Security | Must | W | NFR-07, NFR-08 | TS-PLT | TC-SAP03 | – |
| SEC-AP04 | Secu | Application Security | Must | D | NFR-07, NFR-08 | TS-PLT | TC-SAP04 | – |
| SEC-AP05 | Secu | Application Security | Must | D | NFR-07, NFR-08 | TS-PLT | TC-SAP05 | – |
| SEC-AP06 | Secu | Application Security | Must | W | NFR-07, NFR-08 | TS-PLT | TC-SAP06 | – |
| SEC-AP07 | Secu | Application Security | Must | W | NFR-07, NFR-08 | TS-PLT | TC-SAP07 | – |
| SEC-AP08 | Secu | Application Security | Should | D | NFR-07, NFR-08 | TS-PLT | TC-SAP08 | – |
| SEC-N01 | Secu | Infrastructure & Network Sec | Must | D | NFR-04 | TS-PLT | TC-SN01 | – |
| SEC-N02 | Secu | Infrastructure & Network Sec | Must | D | NFR-04 | TS-PLT | TC-SN02 | – |
| SEC-N03 | Secu | Infrastructure & Network Sec | Must | D | NFR-04 | TS-PLT | TC-SN03 | – |
| SEC-N04 | Secu | Infrastructure & Network Sec | Must | D | NFR-04 | TS-PLT | TC-SN04 | – |
| SEC-N05 | Secu | Infrastructure & Network Sec | Must | D | NFR-04 | TS-PLT | TC-SN05 | – |
| SEC-IR01 | Secu | Incident Response & Vulnerab | Must | D | NFR-06 | TS-PLT | TC-SIR01 | – |
| SEC-IR02 | Secu | Incident Response & Vulnerab | Must | D | NFR-06 | TS-PLT | TC-SIR02 | – |
| SEC-IR03 | Secu | Incident Response & Vulnerab | Must | D | NFR-06 | TS-PLT | TC-SIR03 | – |
| SEC-IR04 | Secu | Incident Response & Vulnerab | Must | D | NFR-06 | TS-PLT | TC-SIR04 | – |
| SEC-IR05 | Secu | Incident Response & Vulnerab | Must | D | NFR-06 | TS-PLT | TC-SIR05 | – |
| SEC-TP01 | Secu | Third-Party & Vendor Securit | Must | D | NFR-09 | TS-PLT | TC-STP01 | – |
| SEC-TP02 | Secu | Third-Party & Vendor Securit | Must | D | NFR-09 | TS-PLT | TC-STP02 | – |
| SEC-TP03 | Secu | Third-Party & Vendor Securit | Must | D | NFR-09 | TS-PLT | TC-STP03 | – |
| SEC-TP04 | Secu | Third-Party & Vendor Securit | Must | D | NFR-09 | TS-PLT | TC-STP04 | – |
| SEC-TP05 | Secu | Third-Party & Vendor Securit | Must | D | NFR-09 | TS-PLT | TC-STP05 | – |
| SEC-TP06 | Secu | Third-Party & Vendor Securit | Must | D | NFR-09 | TS-PLT | TC-STP06 | – |
| SEC-TP07 | Secu | Third-Party & Vendor Securit | Must | D | NFR-09 | TS-PLT | TC-STP07 | – |
| SEC-TP08 | Secu | Third-Party & Vendor Securit | Should | D | NFR-09 | TS-PLT | TC-STP08 | – |
| PRM-01 | Brie | Portal / Branding | Must | W | PLT-01 | TS-PLT | TC-P01 | – |
| PRM-02 | Brie | Portal / Branding | Must | W | PLT-02, NFR-03 | TS-PLT | TC-P02 | – |
| PRM-03 | Brie | Portal / Branding | Must | W | RPT-01, PLT-04 | TS-PLT | TC-P03 | – |
| PRM-04 | Brie | Portal / Branding | Must | W | PLT-03, NFR-02 | TS-PLT | TC-P04 | – |
| PRM-05 | Brie | Portal / Branding | Must | W | PLT-05 | TS-PLT | TC-P05 | – |
| PRM-06 | Brie | Portal / Branding | Must | W | PLT-01, PLT-02 | TS-PLT | TC-P06 | – |
| PRM-07 | Brie | Portal / Branding | Must | W | PLT-05 | TS-PLT | TC-P07 | – |
| PRM-08 | Brie | Portal / Branding | Must | W | FUT-01 | TS-PLT | TC-P08 | – |
| PRM-09 | Brie | Portal / Branding | Must | W | NFR-01, NFR-02, NFR-07 | TS-PLT | TC-P09 | – |

## 4. Reverse trace: user story → requirements

| Story | Module | Tier | Requirements (count) | Sample |
|---|---|---|---|---|
| US-INT-01 | INT | W | 14 | FR-0005, FR-0006, FR-X01, FR-0010, FR-0015, FR-0020… |
| US-INT-02 | INT | W | 13 | FR-X01, FR-0010, FR-0015, FR-0020, FR-0025, FR-X02… |
| US-INT-03 | INT | W | 1 | FR-0060 |
| US-INT-04 | INT | S | 1 | FR-0040 |
| US-INT-05 | INT | W | 1 | FR-0070 |
| US-INT-06 | INT | S | 2 | FR-0050, FR-0055 |
| US-PLN-01 | PLN | W | 4 | FR-0075, FR-0085, FR-0090, FR-0095 |
| US-PLN-02 | PLN | W | 3 | FR-0085, FR-0090, FR-0095 |
| US-PLN-03 | PLN | W | 1 | FR-0080 |
| US-PLN-04 | PLN | W | 1 | FR-0100 |
| US-PLN-05 | PLN | W | 1 | FR-0105 |
| US-PLN-06 | PLN | S | 1 | NFR-P03 |
| US-TND-01 | TND | W | 5 | FR-0110, FR-0115, FR-0120, FR-0130, FR-0140 |
| US-TND-02 | TND | W | 4 | FR-0115, FR-0130, FR-0140, FR-0150 |
| US-TND-03 | TND | W | 1 | FR-0135 |
| US-TND-04 | TND | S | 1 | FR-0145 |
| US-TND-05 | TND | S | 1 | NFR-U03 |
| US-SUP-01 | SUP | W | 3 | FR-0235, FR-0240, FR-0245 |
| US-SUP-02 | SUP | W | 11 | FR-0155, FR-0160, FR-0175, FR-0195, FR-0200, FR-0205… |
| US-SUP-03 | SUP | W | 10 | FR-0170, FR-0175, FR-0195, FR-0200, FR-0205, FR-0210… |
| US-SUP-04 | SUP | W | 1 | FR-0165 |
| US-SUP-05 | SUP | S | 4 | FR-0180, FR-0185, FR-0245, FR-0250 |
| US-EVL-01 | EVL | W | 11 | FR-0265, FR-0280, FR-0285, FR-0300, FR-0305, FR-0315… |
| US-EVL-02 | EVL | W | 8 | FR-0255, FR-0265, FR-0280, FR-0285, FR-0305, FR-0315… |
| US-EVL-03 | EVL | W | 2 | FR-0260, FR-0270 |
| US-EVL-04 | EVL | W | 1 | FR-0275 |
| US-EVL-05 | EVL | W | 6 | FR-0345, FR-0350, FR-0355, FR-0360, FR-0365, FR-0370 |
| US-EVL-06 | EVL | S | 5 | FR-0355, FR-0360, FR-0365, FR-0370, FR-0375 |
| US-EVL-07 | EVL | S | 1 | FR-0310 |
| US-EVL-08 | EVL | S | 2 | FR-0290, FR-0295 |
| US-CON-01 | CON | W | 16 | FR-0385, FR-0390, FR-0395, FR-0400, FR-0405, FR-0415… |
| US-CON-02 | CON | S | 16 | FR-0125, FR-0385, FR-0390, FR-0400, FR-0415, FR-0425… |
| US-CON-03 | CON | W | 3 | FR-0380, FR-0410, FR-0420 |
| US-CON-04 | CON | W | 1 | FR-0455 |
| US-CON-05 | CON | S | 1 | FR-0460 |
| US-CMG-01 | CMG | W | 15 | FR-0490, FR-0495, FR-0500, FR-0520, FR-0525, FR-0535… |
| US-CMG-02 | CMG | W | 16 | FR-0495, FR-0500, FR-0505, FR-0510, FR-0520, FR-0525… |
| US-CMG-03 | CMG | S | 2 | FR-0515, FR-0530 |
| US-CMG-04 | CMG | W | 2 | FR-0635, FR-0640 |
| US-CMG-05 | CMG | S | 1 | FR-0580 |
| US-RPT-01 | RPT | W | 7 | FR-0590, FR-0600, FR-0610, FR-0625, FR-0645, FR-0650… |
| US-RPT-02 | RPT | W | 6 | FR-0600, FR-0610, FR-0615, FR-0625, FR-0630, FR-0645 |
| US-RPT-03 | RPT | S | 1 | FR-0605 |
| US-RPT-04 | RPT | S | 2 | FR-0595, FR-0620 |
| US-ADM-01 | ADM | W | 6 | FR-0680, FR-0690, FR-0695, FR-0715, FR-0725, FR-0730 |
| US-ADM-02 | ADM | S | 8 | FR-0680, FR-0690, FR-0695, FR-0700, FR-0705, FR-0710… |
| US-ADM-03 | ADM | S | 1 | FR-0750 |
| US-ADM-04 | ADM | W | 1 | FR-0685 |
| US-MIG-01 | MIG | S | 5 | FR-0655, FR-0660, FR-0665, FR-0670, FR-0675 |
| US-AIA-01 | AIA | S | 10 | FR-0735, FR-0740, FR-0745, FR-0755, FR-0760, FR-0765… |
| US-AIA-02 | AIA | W | 16 | FR-0735, FR-0740, FR-0745, FR-0750, FR-0755, FR-0760… |
| US-FUT-01 | FUT | S | 20 | FR-0790, FR-0795, FR-0800, FR-0805, FR-0810, FR-0815… |
| US-PLT-01 | PLT | W | 2 | PRM-01, PRM-06 |
| US-PLT-02 | PLT | W | 9 | SEC-A01, SEC-A02, SEC-A03, SEC-A04, SEC-A05, SEC-A06… |
| US-PLT-03 | PLT | W | 14 | SEC-AC01, SEC-AC02, SEC-AC03, SEC-AC04, SEC-AC05, SEC-AC06… |
| US-PLT-04 | PLT | W | 3 | FR-0065, FR-0066, PRM-03 |
| US-PLT-05 | PLT | W | 10 | NFR-U01, NFR-U02, NFR-U03, NFR-U04, NFR-U05, NFR-U06… |
| US-NFR-01 | PLT | W | 11 | FR-0070, FR-0630, SEC-L01, SEC-L02, SEC-L03, SEC-L04… |
| US-NFR-02 | PLT | W | 17 | FR-0100, FR-0190, SEC-AC01, SEC-AC02, SEC-AC03, SEC-AC04… |
| US-NFR-03 | PLT | S | 8 | SEC-A01, SEC-A02, SEC-A03, SEC-A04, SEC-A05, SEC-A06… |
| US-NFR-04 | PLT | D | 22 | NFR-R01, NFR-R02, NFR-R03, NFR-R04, NFR-R05, NFR-R06… |
| US-NFR-05 | PLT | S | 10 | NFR-P01, NFR-P02, NFR-P03, NFR-P04, NFR-P05, NFR-P06… |
| US-NFR-06 | PLT | D | 17 | NFR-AV01, NFR-AV02, NFR-AV03, NFR-AV04, NFR-AV05, NFR-CA01… |
| US-NFR-07 | PLT | W | 15 | NFR-M01, NFR-M02, NFR-M03, NFR-M04, NFR-M05, NFR-M06… |
| US-NFR-08 | PLT | S | 22 | NFR-M01, NFR-M02, NFR-M03, NFR-M04, NFR-M05, NFR-M06… |
| US-NFR-09 | PLT | S | 21 | NFR-AV01, NFR-AV02, NFR-AV03, NFR-AV04, NFR-AV05, NFR-C01… |
| US-NFR-10 | PLT | D | 14 | NFR-CA01, NFR-CA02, NFR-CA03, NFR-CA04, NFR-L01, NFR-L02… |
| US-NFR-11 | PLT | W | 8 | NFR-U01, NFR-U02, NFR-U03, NFR-U04, NFR-U05, NFR-U06… |
