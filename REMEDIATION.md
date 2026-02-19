

# Remediation Ledger

This file is the **single canonical TODO list** for Journal Distiller remediation work. 

**Rule:** Any audit finding must be captured here as an `AUD-###` entry. Other docs may reference `AUD-###` IDs, but must not create competing task lists.

## How to use this ledger

Each entry has:
- **Type**: `Contract break` (SPEC/ACCEPTANCE vs code), `Test/infra`, `Doc drift`, `UX roadmap`
- **Decision**: `Fix code`, `Fix docs`, `Change spec`, `Defer`
- **Status**: `Not started | In progress | Blocked | Done`

### Priority policy

- **P0**: Red build / correctness risk / data integrity
- **P1**: Contract alignment + completeness
- **P2**: Documentation polish + UX roadmap work

## Current top priorities

> **Rule:** This section must list only non-`Done` entries. If there are none, state that explicitly.

- **P0 (Red build / integrity):** _none listed_
- **P1 (Contract alignment):** AUD-100 — Track upstream Next/SWC mismatch warning (`Blocked`, upstream dependency)
- **P2 (Docs/UX):** _none listed_

_Last refreshed: 2026-02-19_

## Ledger size policy

This ledger is the canonical remediation record. Size is not a problem; **day-to-day navigability is**.

**Canonical rule:** `REMEDIATION.md` should contain only `Not started | In progress | Blocked` entries.

**Archive rule:** When an entry becomes `Done` (or `Won't fix`), move the full entry block to `REMEDIATION_ARCHIVE.md` (keep the same `AUD-###` ID). Leave behind a one-line stub in this file:

- `AUD-### — <title>` → moved to `REMEDIATION_ARCHIVE.md`

**Index rule:** The `Current top priorities` list must be updated in the same commit whenever an entry’s status changes.

## Open entries

### Active sequence (execute in order)
- AUD-100 — Track upstream Next/SWC mismatch warning (`Blocked`)

---

## Buckets

### Bucket A — Test/Infra (P0)
- AUD-100

### Bucket B — Contract breaks (P0–P1)
- _none_

### Bucket C — Docs drift (P1)
- _none_

### Bucket B+ — Contract alignment (P1)
- _none_

### Bucket E — Git Export pipeline (P1)
- _none_

### Bucket F — Refactor Roadmap (P0–P1, merged audit)
- _none_

### Bucket G — SPEC ↔ Code audit (P0–P1)
- _none_

### Bucket D — UX roadmap gaps (P2 unless explicitly promoted)
- _none_

---

## Ledger entries

- AUD-001 — Search FTS columns missing in test DB (16 failing tests) → moved to REMEDIATION_ARCHIVE.md
- AUD-002 — Advisory lock is not guaranteed same-session → moved to REMEDIATION_ARCHIVE.md
- AUD-003 — Run totals exclude partial tokens/cost from failed jobs → moved to REMEDIATION_ARCHIVE.md
- AUD-004 — Search results missing labelSpec-derived atom metadata (category, confidence) → moved to REMEDIATION_ARCHIVE.md
- AUD-005 — Run creation incorrectly requires labelSpec → moved to REMEDIATION_ARCHIVE.md
- AUD-006 — Prisma vs SPEC mismatch: `ClassifyRun.status` includes `cancelled` → moved to REMEDIATION_ARCHIVE.md
- AUD-007 — Seed violates “exactly one active PromptVersion per stage (classify)” → moved to REMEDIATION_ARCHIVE.md
- AUD-008 — GLOSSARY: Grok format description is wrong → moved to REMEDIATION_ARCHIVE.md
- AUD-009 — GLOSSARY: Claude format description ambiguous → moved to REMEDIATION_ARCHIVE.md
- AUD-010 — GLOSSARY: Error codes table incomplete → moved to REMEDIATION_ARCHIVE.md
- AUD-011 — Test count mismatch across docs (582 vs actual 592) → moved to REMEDIATION_ARCHIVE.md
- AUD-012 — CONTEXT_PACK: "576 excluding pre-existing search FTS column issue" is unexplained → moved to REMEDIATION_ARCHIVE.md
- AUD-013 — EXECUTION_PLAN: broken markdown fence; and read endpoints drift → moved to REMEDIATION_ARCHIVE.md
- AUD-014 — UX_SPEC: PR list (UX-8.1–UX-8.8) not implemented and lacks status markers → moved to REMEDIATION_ARCHIVE.md
- AUD-015 — Shared distill shell/nav not implemented (no `src/app/distill/layout.tsx`) → moved to REMEDIATION_ARCHIVE.md
- AUD-016 — Dashboard “Create Run” gated by local classifyResult instead of persisted classify status → moved to REMEDIATION_ARCHIVE.md
- AUD-017 — UI data loads have silent failure handling (need actionable errors) → moved to REMEDIATION_ARCHIVE.md
- AUD-018 — Run detail missing grouped tick/reset/resume/cancel controls → moved to REMEDIATION_ARCHIVE.md
- AUD-019 — Search scope switch clears results immediately without explicit rerun cue → moved to REMEDIATION_ARCHIVE.md
## Spec/doc internal inconsistencies to resolve

These are not necessarily code bugs, but they create recurring audit noise.

- AUD-020 — SPEC conflicts on search scope and polling interval → moved to REMEDIATION_ARCHIVE.md
- AUD-021 — Flaky test: run.test.ts "selects default labelSpec when omitted" fails in parallel → moved to REMEDIATION_ARCHIVE.md
- AUD-022 — Search endpoint missing `sources` and `categories` filter params → moved to REMEDIATION_ARCHIVE.md
- AUD-023 — Classify-runs `progress` field shape differs from SPEC §7.2.1 → moved to REMEDIATION_ARCHIVE.md
- AUD-024 — ACCEPTANCE.md test coverage table stale → moved to REMEDIATION_ARCHIVE.md
- AUD-025 — EXECUTION_PLAN references non-existent E2E tests → moved to REMEDIATION_ARCHIVE.md
- AUD-026 — Search `categories` filter bypasses required labelSpec context → moved to REMEDIATION_ARCHIVE.md
- AUD-027 — Stub mode PromptVersion contract differs from SPEC → moved to REMEDIATION_ARCHIVE.md
- AUD-028 — “Exactly one active PromptVersion per stage” conflicts with seeded state → moved to REMEDIATION_ARCHIVE.md
- AUD-029 — Canonical test count is stale again (regression of AUD-011) → moved to REMEDIATION_ARCHIVE.md
- AUD-030 — ACCEPTANCE test-suite commands reference non-existent paths → moved to REMEDIATION_ARCHIVE.md
- AUD-031 — REMEDIATION "Current top priorities" lists already-done items → moved to REMEDIATION_ARCHIVE.md
- AUD-032 — UX_SPEC Section 8 status markers are stale → moved to REMEDIATION_ARCHIVE.md
- AUD-033 — Dashboard 2-column layout + latest run card (UX-8.3) → moved to REMEDIATION_ARCHIVE.md
- AUD-034 — Import Inspector context bar + filter reset (UX-8.6) → moved to REMEDIATION_ARCHIVE.md
- AUD-035 — Run detail top status rail + collapsible config (UX-8.7) → moved to REMEDIATION_ARCHIVE.md
- AUD-042 — Dashboard classify gating not scoped to selected batch → moved to REMEDIATION_ARCHIVE.md
- AUD-043 — Support creating runs across multiple import batches (multi-batch selection) → moved to REMEDIATION_ARCHIVE.md
- AUD-036 — Search metadata hierarchy + empty state (UX-8.5) → moved to REMEDIATION_ARCHIVE.md
- AUD-037 — Dashboard classify checkpoint timestamp (UX-8.4) → moved to REMEDIATION_ARCHIVE.md
- AUD-038 — Extract shared UI utility functions and types → moved to REMEDIATION_ARCHIVE.md
- AUD-039 — Extract usePolling hook (UX-8.8) → moved to REMEDIATION_ARCHIVE.md
- AUD-044 — Create Run UI: provider/model selection is unclear (model is free-text) → moved to REMEDIATION_ARCHIVE.md
- AUD-040 — Wire usePolling into run detail (auto-refresh progress) → moved to REMEDIATION_ARCHIVE.md
- AUD-043a — Multi-batch run support: spec & UX_SPEC design updates → moved to REMEDIATION_ARCHIVE.md
- AUD-043b — Schema: RunBatch junction table + data migration → moved to REMEDIATION_ARCHIVE.md
- AUD-043c — Backend: multi-batch service + bundle dedup → moved to REMEDIATION_ARCHIVE.md
- AUD-043d — API: POST /runs accepts importBatchIds[] → moved to REMEDIATION_ARCHIVE.md
- AUD-043e — Dashboard UI: multi-batch selector + TZ validation → moved to REMEDIATION_ARCHIVE.md
- AUD-043f — Run detail + search: multi-batch display → moved to REMEDIATION_ARCHIVE.md
- AUD-045 — Multi-batch correctness for job input inspector endpoint → moved to REMEDIATION_ARCHIVE.md
- AUD-046 — Runs list filtering should respect RunBatch membership → moved to REMEDIATION_ARCHIVE.md
- AUD-047 — Distill bundles must include USER text only (exclude assistant) → moved to REMEDIATION_ARCHIVE.md
- AUD-048 — Foreground auto-run tick: spec + UX updates (DOC-ONLY) → moved to REMEDIATION_ARCHIVE.md
- AUD-049 — Run detail "Auto-run" foreground tick loop (SPEC §7.4.2) → moved to REMEDIATION_ARCHIVE.md
- AUD-051 — Align Run.status transitions with SPEC §7.4.1 → moved to REMEDIATION_ARCHIVE.md
- AUD-050 — Run detail must treat FAILED as terminal (polling + auto-run) → moved to REMEDIATION_ARCHIVE.md
- AUD-052 — Reject `sourceOverride=mixed` in import API (v0.3 reserved) → moved to REMEDIATION_ARCHIVE.md
- AUD-054 — Flaky test: listImportBatches pagination → moved to REMEDIATION_ARCHIVE.md
- AUD-055 — Studio inspect panel (collapsible input/output view) → moved to REMEDIATION_ARCHIVE.md
- AUD-056 — Studio status bar + cost anomaly badges → moved to REMEDIATION_ARCHIVE.md
- AUD-057 — Journal-friendly summarize prompt versions (seed data) → moved to REMEDIATION_ARCHIVE.md
- AUD-058 — Enforce spend caps during summarize/tick execution → moved to REMEDIATION_ARCHIVE.md
- AUD-059 — Apply `LLM_MIN_DELAY_MS` rate limiting to summarize/tick path → moved to REMEDIATION_ARCHIVE.md
- AUD-060 — Correct `LLM_MAX_USD_PER_DAY` semantics to calendar-day spend → moved to REMEDIATION_ARCHIVE.md
- AUD-061 — Docs reckoning: archive stale docs, fix volatile facts, slim ACCEPTANCE → moved to REMEDIATION_ARCHIVE.md
- AUD-062 — V1 export renderer + SPEC §14 + ADR-015/016 → moved to REMEDIATION_ARCHIVE.md
- AUD-063 — Export DB orchestrator (buildExportInput) → moved to REMEDIATION_ARCHIVE.md
- AUD-064 — Filesystem writer (writeExportTree) → moved to REMEDIATION_ARCHIVE.md
- AUD-065 — Export API endpoint → moved to REMEDIATION_ARCHIVE.md
- AUD-066 — Atoms export (v2, §14.1 follow-on) → moved to REMEDIATION_ARCHIVE.md
- AUD-067 — Sources metadata (v2, §14.1 follow-on) → moved to REMEDIATION_ARCHIVE.md
- AUD-068 — Privacy tiers (§14.8) → moved to REMEDIATION_ARCHIVE.md
- AUD-069 — CI determinism guard → moved to REMEDIATION_ARCHIVE.md
- AUD-070 — Extract shared formatDate() utility → moved to REMEDIATION_ARCHIVE.md
- AUD-071 — Shared RunConfig Type + parseRunConfig() → moved to REMEDIATION_ARCHIVE.md
- AUD-072 — Test Fixture Factory Extraction → moved to REMEDIATION_ARCHIVE.md
- AUD-073 — Typed Service Errors: Shared Classes + run.ts + Run Routes → moved to REMEDIATION_ARCHIVE.md
- AUD-074 — Typed Service Errors: Tick, Classify, Advisory Lock + Remaining Routes → moved to REMEDIATION_ARCHIVE.md
- AUD-075 — Cost Overwrite Correctness Fix (Segmented Jobs) → moved to REMEDIATION_ARCHIVE.md
- AUD-076 — Budget Guard Consolidation → moved to REMEDIATION_ARCHIVE.md
- AUD-077 — Multi-Batch Identity Canonicalization → moved to REMEDIATION_ARCHIVE.md
- AUD-078 — Test Harness DB Preflight + Teardown → moved to REMEDIATION_ARCHIVE.md
- AUD-079 — Orchestration Decomposition (tick.ts / classify.ts) → moved to REMEDIATION_ARCHIVE.md
- AUD-080 — Import Scalability Batching → moved to REMEDIATION_ARCHIVE.md
- AUD-081 — Route Validation Helpers / Zod → moved to REMEDIATION_ARCHIVE.md
- AUD-082 — Export button on Run Detail page → moved to REMEDIATION_ARCHIVE.md
- AUD-084 — Flaky test: listImportBatches pagination (cursor invalidation) → moved to REMEDIATION_ARCHIVE.md
- AUD-085 — Typed Service Errors: Import Route + Parsers → moved to REMEDIATION_ARCHIVE.md
- AUD-086 — `determineRunStatus` returns QUEUED for all-cancelled jobs → moved to REMEDIATION_ARCHIVE.md
- AUD-087 — `bundleContextHash` in bundle.ts diverges from SPEC and bundleHash.ts → moved to REMEDIATION_ARCHIVE.md
- AUD-088 — GET /runs/:runId response shape mismatches SPEC §7.9 → moved to REMEDIATION_ARCHIVE.md
- AUD-089 — Tick does not guard COMPLETED/FAILED terminal states → moved to REMEDIATION_ARCHIVE.md
- AUD-090 — cancelRun/resumeRun incomplete terminal state guards → moved to REMEDIATION_ARCHIVE.md
- AUD-091 — ConflictError uses HTTP 400 instead of SPEC 409 → moved to REMEDIATION_ARCHIVE.md
- AUD-092 — Search atom results include importBatchId not in SPEC → moved to REMEDIATION_ARCHIVE.md
- AUD-093 — Export API outputDir allows arbitrary server-side writes (path traversal / absolute path) → moved to REMEDIATION_ARCHIVE.md
- AUD-097 — Restore lint + tsc green on master (quality gate regression) → moved to REMEDIATION_ARCHIVE.md
- AUD-098 — Re-enable Next.js build-time lint/type gates → moved to REMEDIATION_ARCHIVE.md
- AUD-099 — Migrate from `next lint` to ESLint CLI and document SWC constraint → moved to REMEDIATION_ARCHIVE.md
### AUD-100 — Track upstream Next/SWC mismatch warning
- **Source**: Codex follow-up 2026-02-18
- **Severity**: LOW
- **Type**: Test/infra
- **Decision**: Defer (upstream)
- **Problem**: `npm run build` emits `Mismatching @next/swc version` while on `next@15.5.11` because upstream package metadata for `next@15.5.11` pins optional `@next/swc-*` to `15.5.7`, and matching `15.5.11` `@next/swc-*` packages are not published.
- **Acceptance checks**:
  - Constraint is documented in remediation ledger
  - Re-check when upstream Next metadata/packages change
  - Keep build gates green while warning remains
- **Status**: Blocked

---


- AUD-096 — Multi-batch ordering must be deterministic in API responses → moved to REMEDIATION_ARCHIVE.md
- AUD-095 — Input validation: regex-only dates + unchecked timezone/dayDate can produce 500s → moved to REMEDIATION_ARCHIVE.md
## Notes

- When closing an entry, add a short "Resolution" bullet linking to the PR and stating what changed.
- If an entry is resolved by changing the spec (instead of code), record the rationale explicitly.
