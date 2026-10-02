# ADR-0013: PDF generation via headless Chromium-family browser

**Status:** Accepted (M0) - evidence: spikes/spike-c-sample.pdf  |  **Date:** 2026-10-02

## Context
Spike C: Edge headless --print-to-pdf produced a valid 2-page A4 PDF (48 KB) with 4 embedded font files and page break honoured; Word export separate (docx library).

## Decision
Server renders the same HTML/CSS template to PDF using Playwright's Chromium in CI/prod and system Edge/Chrome locally; print stylesheet shared with on-screen view.

## Consequences
+ Same template, high fidelity. - Needs a browser binary at runtime; visual fidelity not yet eyeballed (no PDF rasteriser installed).
