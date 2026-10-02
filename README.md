# Intuitive Fusion – Procurement Portal (POC)

Conversational source-to-contract procurement portal proof of concept. **Status: Phase 5, milestone M0 complete; no application code yet.**

- Documents: [docs/README.md](docs/README.md) · Plan: [docs/05-Implementation-Plan.md](docs/05-Implementation-Plan.md) · M0 evidence: [docs/M0-Evidence.md](docs/M0-Evidence.md)
- Stack: TypeScript, Next.js, Fastify, PostgreSQL (PGlite locally), AWS-targeted. AI/auth/integrations are mocked behind adapters.
- Run spikes: `cd spikes && npm install && node spike-a-score-isolation.mjs`
- Regenerate RTM/stories/OpenAPI (needs the source `.xlsx` locally): `python _work/dump.py && PYTHONIOENCODING=utf-8 python _work/build_docs.py`
