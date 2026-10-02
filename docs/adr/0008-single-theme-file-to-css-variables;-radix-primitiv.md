# ADR-0008: Single theme file -> CSS variables; Radix primitives; Tailwind

**Status:** Accepted (M0)  |  **Date:** 2026-10-02

## Context
One-file rebrand and accessible components.

## Decision
packages/ui/src/theme.ts is the only place with colours/fonts/spacing; build emits CSS variables for light/dark; Tailwind reads variables only. Accent #4254C5 and Plus Jakarta Sans + Inter approved by owner.

## Consequences
+ Rebrand = one file. - Component upkeep vs off-the-shelf kit.
