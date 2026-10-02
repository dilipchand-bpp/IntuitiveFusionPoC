# Intuitive Fusion – Procurement Portal POC: document set

Status: **Phases 1–4 drafted for review. No application code exists yet.**

| # | Document | Phase |
|---|---|---|
| 1 | [01-Requirements-Document.md](01-Requirements-Document.md) | 1 |
| 1b | [01b-User-Stories.md](01b-User-Stories.md) (personas, journeys, 68 stories, G/W/T) | 1 |
| 2 | [02-RTM.md](02-RTM.md) · [RTM.csv](RTM.csv) (312 requirements) | 1 |
| 3 | [03-Technical-Specification.md](03-Technical-Specification.md) · [api/openapi.json](api/openapi.json) · [api/endpoint-table.md](api/endpoint-table.md) | 2 |
| 4 | [04-Architecture.md](04-Architecture.md) (Mermaid diagrams, STRIDE, ADR summary) | 3 |
| 5 | [05-Implementation-Plan.md](05-Implementation-Plan.md) (M0–M19) | 4 |

Generated files (RTM, stories, OpenAPI) are produced by scripts in `../_work/` from the Requirements Register; re-run `python _work/build_docs.py`, `python _work/gen_openapi.py`, `python _work/lint_openapi.py` after edits.
