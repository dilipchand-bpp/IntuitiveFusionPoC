# ADR-0009: Data residency: Australia only

**Status:** Open - needs client RTO/RPO  |  **Date:** 2026-10-02

## Context
NFR-R01/R02, SEC-D09.

## Decision
All target resources in ap-southeast-2; DR via multi-AZ + PITR backups; second AU region optional.

## Consequences
+ Meets residency. - Region-level outage = restore time.
