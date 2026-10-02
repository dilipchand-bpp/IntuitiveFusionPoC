# ADR-0002: TypeScript monorepo: Next.js web + Fastify API

**Status:** Accepted (M0)  |  **Date:** 2026-10-02

## Context
One language, shared types generated from OpenAPI, SSR for the public landing page.

## Decision
npm workspaces: apps/web (Next.js App Router), apps/api (Fastify + zod), packages/ui (theme + components), packages/shared (types, OpenAPI client).

## Consequences
+ Shared types, single toolchain. - Next.js heavier than a SPA; mitigated by static landing.
