

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

> SPEC ↔ Code audit (AUD-086–092). Correctness + determinism fixes first, then contract alignment.

## Open entries

### Active sequence (execute in order)
- AUD-086 — `determineRunStatus` returns QUEUED for all-cancelled jobs (HIGH)
- AUD-087 — `bundleContextHash` non-deterministic in production (HIGH)
- AUD-088 — GET /runs/:runId response shape mismatches SPEC §7.9 (HIGH)
- AUD-089 — Tick does not guard COMPLETED/FAILED terminal states (MED)
- AUD-090 — cancelRun/resumeRun incomplete terminal state guards (MED)
- AUD-091 — ConflictError uses HTTP 400 instead of SPEC 409 (LOW)
- AUD-092 — Search atom results include importBatchId not in SPEC (LOW)

---

## Buckets

### Bucket A — Test/Infra (P0)
- AUD-001

### Bucket B — Contract breaks (P0–P1)
- AUD-002
- AUD-003
- AUD-004
- AUD-005
- AUD-006
- AUD-007
- AUD-045
- AUD-046

### Bucket C — Docs drift (P1)
- AUD-008
- AUD-009
- AUD-010
- AUD-011
- AUD-012
- AUD-013
- AUD-024
- AUD-025
- AUD-061

### Bucket B+ — Contract alignment (P1)
- AUD-022
- AUD-023

### Bucket E — Git Export pipeline (P1)
- AUD-064
- AUD-065
- AUD-066
- AUD-067
- AUD-068
- AUD-069
- AUD-070
- AUD-082
- AUD-083

### Bucket F — Refactor Roadmap (P0–P1, merged audit)
- AUD-071
- AUD-072
- AUD-073
- AUD-074
- AUD-075
- AUD-076
- AUD-077
- AUD-078
- AUD-079
- AUD-080
- AUD-081

### Bucket G — SPEC ↔ Code audit (P0–P1)
- AUD-086
- AUD-087
- AUD-088
- AUD-089
- AUD-090
- AUD-091
- AUD-092

### Bucket D — UX roadmap gaps (P2 unless explicitly promoted)
- AUD-014
- AUD-015
- AUD-016
- AUD-017
- AUD-018
- AUD-019
- AUD-043
- AUD-055
- AUD-056
- AUD-057

---

## Ledger entries

### AUD-001 — Search FTS columns missing in test DB (16 failing tests)
- **Source**: Claude #12; Codex verification
- **Severity**: HIGH
- **Type**: Test/infra
- **Docs cited**: CONTEXT_PACK note about “FTS column issue” (unexplained)
- **Code refs**: `src/lib/services/__tests__/search.test.ts`; raw SQL migration `prisma/migrations/*add_fts_indexes*/migration.sql` (adds `text_search`, `output_text_search`)
- **Problem**: Tests query `text_search` / `output_text_search` but Prisma schema/migrations applied during tests do not reliably create these columns.
- **Decision**: Fix code / schema / migrations so fresh DB has required FTS columns.
- **Planned PR**: `fix/fts-tests`
- **Acceptance checks**:
  - `npx vitest run` → 0 failing
  - Fresh DB created from migrations includes FTS columns
- **Status**: Done
- **Resolution**: Added repair migration `20260208220000_repair_fts_columns` to enforce `message_atoms.text_search` and `outputs.output_text_search` (idempotent for fresh/existing DBs), added an explicit schema assertion in `search.test.ts`, and verified with `npx vitest run` (593 passed).

### AUD-002 — Advisory lock is not guaranteed same-session
- **Source**: Codex (HIGH)
- **Severity**: HIGH
- **Type**: Contract break
- **Docs cited**: SPEC “same-session advisory lock handling”; EXECUTION_PLAN “pins dedicated pg pool”
- **Code refs**: `src/*/advisory-lock.ts` (acquire/release and helper functions)
- **Problem**: Postgres advisory locks are session-scoped; pooled queries can acquire on one connection and attempt to release on another.
- **Decision**: Fix code to guarantee same-session (e.g., transaction-scoped lock, `pg_advisory_xact_lock`, or ensure acquire/work/release uses same client).
- **Planned PR**: `fix/advisory-lock-session`
- **Acceptance checks**:
  - Concurrency test: two ticks contend; only one enters critical section
  - Lock released on error paths
- **Status**: Done
- **Resolution**: Replaced Prisma `$queryRawUnsafe` with a dedicated `pg.Pool` for advisory lock operations, guaranteeing same-session acquire/release. Added concurrency contention test (two `withLock` callers on same runId; second gets `TICK_IN_PROGRESS`) and error-path release test. Also configured vitest to load `.env` via `loadEnv` so the `pg` Pool can read `DATABASE_URL`. All 592 tests pass.

### AUD-003 — Run totals exclude partial tokens/cost from failed jobs
- **Source**: Codex (HIGH)
- **Severity**: HIGH
- **Type**: Contract break
- **Docs cited**: SPEC aggregate totals include partial segment success
- **Code refs**: `src/app/api/distill/runs/.../route.ts` (totals aggregation)
- **Problem**: If a job fails after incurring usage, totals omit partial usage/cost.
- **Decision**: Fix code to persist usage incrementally and aggregate regardless of final job status.
- **Planned PR**: `fix/run-totals-partials`
- **Acceptance checks**:
  - Test: induce failure after 1+ LLM calls; totals include those calls' usage
- **Status**: Done
- **Resolution**: Removed `status: 'SUCCEEDED'` filter from `prisma.job.aggregate()` in the run detail route handler (`GET /api/distill/runs/:runId`). SQL SUM naturally ignores NULL token columns on QUEUED jobs while now including partial usage from FAILED jobs, per SPEC §11.4 ("including partial segment success where recorded"). Updated existing aggregate tests to match the corrected behavior. All 592 tests pass.

### AUD-004 — Search results missing labelSpec-derived atom metadata (category, confidence)
- **Source**: Codex (HIGH)
- **Severity**: HIGH
- **Type**: Contract break
- **Docs cited**: SPEC requires category + confidence derived from active labelSpec rules
- **Code refs**: `src/lib/services/search.ts` (search result shaping)
- **Problem**: Search API omits required metadata.
- **Decision**: Fix code OR change spec if confidence/category not supported yet. Prefer fixing code if data exists.
- **Planned PR**: `fix/search-atom-metadata`
- **Acceptance checks**:
  - Integration test: classify fixture → search → atoms include `category` + `confidence` as specified
- **Status**: Done
- **Resolution**: Added label context resolution to `searchRaw()` via LEFT JOIN to `message_labels`. Label context is derived from explicit `labelModel`+`labelPromptVersionId` query params (precedence) or from the Run's `config.labelSpec` when `runId` is provided, per SPEC §7.9 rules. Route handler passes new params through. Added 4 integration tests covering: label context via explicit params, null without context, resolution from runId, and explicit-params-take-precedence. All 596 tests pass.

### AUD-005 — Run creation incorrectly requires labelSpec
- **Source**: Codex (HIGH)
- **Severity**: HIGH
- **Type**: Contract break
- **Docs cited**: SPEC says labelSpec optional; server chooses default
- **Code refs**: `src/app/api/distill/runs/route.ts`; `src/lib/services/run.ts`
- **Problem**: API rejects create-run without labelSpec; violates spec.
- **Decision**: Fix code to allow omission and select default labelSpec server-side; persist chosen labelSpecId on the run.
- **Planned PR**: `fix/run-create-default-labelspec`
- **Acceptance checks**:
  - API test: create run without labelSpec succeeds and persists selected default
- **Status**: Done
- **Resolution**: Made `labelSpec` optional in both the route handler (`CreateRunRequest`) and the service (`CreateRunOptions`). When omitted, `createRun()` selects the default per SPEC §7.3: active CLASSIFY PromptVersion (most recently created) + default classifier model `stub_v1`. Route handler validates partial labelSpec (must include both fields if provided). Added integration test confirming run creation without labelSpec succeeds and persists the server-selected default. All 597 tests pass.

### AUD-006 — Prisma vs SPEC mismatch: `ClassifyRun.status` includes `cancelled`
- **Source**: Claude #4 (HIGH)
- **Severity**: HIGH
- **Type**: Contract break
- **Docs cited**: SPEC: `running|succeeded|failed|cancelled`
- **Code refs**: `schema.prisma` ClassifyRun.status comment/shape
- **Problem**: Schema/code do not clearly support `cancelled`.
- **Decision**: Choose one:
  - Fix code+schema to support `cancelled`, OR
  - Change spec to remove `cancelled` until implemented.
- **Planned PR**: `fix/classifyrun-cancelled-contract`
- **Acceptance checks**:
  - SPEC + schema + validators agree
  - If implemented: tests cover cancellation transitions
- **Status**: Done
- **Resolution**: Aligned spec to code by removing `cancelled` from ClassifyRun.status in SPEC.md (now `running|succeeded|failed`). Schema comment already listed only 3 values. Added `CLASSIFY_RUN_STATUS_VALUES` type array and `isClassifyRunStatus()` type guard to `enums.ts`. Added 4 unit tests verifying the valid values, exclusion of `cancelled`, and type guard behavior. All 601 tests pass.

### AUD-007 — Seed violates “exactly one active PromptVersion per stage (classify)”
- **Source**: Codex (MEDIUM)
- **Severity**: MEDIUM
- **Type**: Contract break
- **Docs cited**: SPEC requirement for one active PromptVersion per stage
- **Code refs**: `prisma/seed.ts`
- **Problem**: Seed creates multiple active prompt versions for classify stage.
- **Decision**: Fix seed to enforce exactly one active per stage.
- **Planned PR**: `fix/seed-promptversion-active`
- **Acceptance checks**:
  - Seed idempotency preserved
  - After seed, invariants hold (exactly one active per stage)
- **Status**: Done
- **Resolution**: Fixed seed to set `classify_stub_v1` as `isActive: false` (stub mode ignores promptVersionId per CONTEXT_PACK.md), keeping only `classify_real_v1` as the sole active CLASSIFY version. Added post-seed invariant check that fails loudly if any stage has >1 active PromptVersion. Added 4 integration tests verifying: correct active count, violation detection, cross-stage independence, and `findFirst` default selection. All 605 tests pass.

---

### AUD-008 — GLOSSARY: Grok format description is wrong
- **Source**: Claude #1 (HIGH)
- **Severity**: HIGH
- **Type**: Doc drift
- **Docs cited**: GLOSSARY.md incorrect; MEMORY.md/CHANGELOG.md correct
- **Code refs**: `src/lib/parsers/grok.ts`
- **Problem**: GLOSSARY describes non-existent Grok export structure.
- **Decision**: Fix docs (rewrite Grok section to match parser + MEMORY description).
- **Planned PR**: `docs/glossary-grok-format`
- **Acceptance checks**:
  - GLOSSARY matches parser + MEMORY/CHANGELOG
- **Status**: Done
- **Resolution**: Rewrote the Grok Export section in GLOSSARY.md to match the actual parser structure: top-level object with nested `conversations` → `conversation`/`responses` wrappers, MongoDB extended JSON timestamps (`{ $date: { $numberLong } }`), and correct field names (`_id`, `message`, `sender`). Matches parser code, MEMORY.md, and CHANGELOG.md.

### AUD-009 — GLOSSARY: Claude format description ambiguous
- **Source**: Claude #2 (MEDIUM)
- **Severity**: MEDIUM
- **Type**: Doc drift
- **Docs cited**: GLOSSARY.md
- **Code refs**: `src/lib/parsers/claude.ts`
- **Problem**: Doc implies wrapper `{ conversations: [...] }` but actual is top-level JSON array.
- **Decision**: Fix docs.
- **Planned PR**: `docs/glossary-claude-format`
- **Acceptance checks**:
  - GLOSSARY explicitly states “top-level JSON array of conversation objects”
- **Status**: Done
- **Resolution**: Rewrote the Claude Export section in GLOSSARY.md to explicitly state "top-level JSON array of conversation objects (not wrapped in `{ conversations: [...] }`)" with a full JSON example showing the structure, matching the parser code (`claude.ts` checks `Array.isArray(data)`), MEMORY.md, and CHANGELOG.md.

### AUD-010 — GLOSSARY: Error codes table incomplete
- **Source**: Claude #3 (MEDIUM)
- **Severity**: MEDIUM
- **Type**: Doc drift
- **Docs cited**: GLOSSARY.md
- **Code refs**: `src/lib/api-utils.ts`; `src/lib/llm/errors.ts`; `src/lib/llm/pricing.ts`; run control logic
- **Problem**: GLOSSARY lists only 5 codes; codebase uses 14+.
- **Decision**: Fix docs by expanding the table to include all codes used.
- **Planned PR**: `docs/error-codes-table`
- **Acceptance checks**:
  - Table includes all codes and maps to HTTP status + layer
- **Status**: Done
- **Resolution**: Expanded GLOSSARY.md error codes table from 5 entries to 17, organized by layer (API, Run/domain, LLM). Each code maps to its HTTP status and meaning. Covers all codes from `api-utils.ts`, route handlers, and `llm/errors.ts`.

### AUD-011 — Test count mismatch across docs (582 vs actual 592)
- **Source**: Claude #5 (HIGH)
- **Severity**: HIGH
- **Type**: Doc drift
- **Docs cited**: MEMORY.md, CONTEXT_PACK.md, CHANGELOG.md (all claim 582)
- **Code refs**: test runner output
- **Problem**: Docs stale; mismatch undermines trust.
- **Decision**: Fix docs and reduce duplication (choose one canonical location for test counts).
- **Planned PR**: `docs/test-count-canonical`
- **Acceptance checks**:
  - Grep shows no stale “582” claims
  - Canonical source defined
- **Status**: Done
- **Resolution**: Designated CONTEXT_PACK.md line 21 as the canonical test count location (bold, with "(Canonical)" marker). Updated from stale "582 passing (576 excluding pre-existing search FTS column issue)" to "605 passing" — the FTS caveat was removed since AUD-001 fixed it. Removed the inline "(582 total)" from the CHANGELOG.md [Unreleased] entry to eliminate the other stale claim. Remaining "582" references in REMEDIATION.md are historical descriptions of the AUD-011 problem itself, not current claims.

### AUD-012 — CONTEXT_PACK: "576 excluding pre-existing search FTS column issue" is unexplained
- **Source**: Claude #6 (MEDIUM)
- **Severity**: MEDIUM
- **Type**: Doc drift
- **Docs cited**: CONTEXT_PACK.md
- **Problem**: Arithmetic doesn’t match current failing tests; lacks clear explanation.
- **Decision**: Fix docs; link to AUD-001 and describe the precise failure mode and resolution.
- **Planned PR**: `docs/context-pack-fts-note`
- **Acceptance checks**:
  - Note references AUD-001 and is numerically consistent
- **Status**: Done
- **Resolution**: Added historical note to CONTEXT_PACK.md (line 22) explaining the "576 excluding FTS" caveat: 16 search tests failed due to missing tsvector columns, resolved by AUD-001's repair migration. Note references AUD-001 by ID and is numerically consistent (576 + 16 failures = 592 at the time; now 605 with all search tests passing).

### AUD-013 — EXECUTION_PLAN: broken markdown fence; and read endpoints drift
- **Source**: Claude #7 (LOW), #8 (INFO); Codex (LOW)
- **Severity**: LOW
- **Type**: Doc drift
- **Docs cited**: EXECUTION_PLAN.md
- **Problem**: Phase 5 markdown renders oddly; Phase 4 lists read endpoints not present in API.
- **Decision**: Fix docs to reflect actual approach (jobs embedded in run detail) and repair markdown.
- **Planned PR**: `docs/execution-plan-sync`
- **Acceptance checks**:
  - Markdown renders correctly
  - Endpoint list matches implemented API surface
- **Status**: Done
- **Resolution**: Removed stray code fence (` ``` `) wrapping Phase 5 status/PR list so it renders as formatted markdown. Updated Phase 4 Step 7 endpoint list to match implemented API: removed 3 non-existent endpoints (`/runs/:runId/jobs`, `/runs/:runId/jobs/:dayDate`, `/outputs/:id`) and replaced with actual routes (jobs embedded in run detail, `/jobs/:dayDate/output`, `/jobs/:dayDate/input`).

---

### AUD-014 — UX_SPEC: PR list (UX-8.1–UX-8.8) not implemented and lacks status markers
- **Source**: Claude #9 (INFO)
- **Severity**: INFO
- **Type**: UX roadmap
- **Docs cited**: UX_SPEC.md
- **Problem**: No status indicators; reads like commitments.
- **Decision**: Fix docs by adding status markers (all NOT STARTED) and clarifying roadmap vs binding.
- **Planned PR**: `docs/ux-spec-status`
- **Acceptance checks**:
  - Each UX-8.x item has an explicit status
- **Status**: Done
- **Resolution**: Added roadmap disclaimer blockquote to Section 8 header ("Roadmap, not commitment") and explicit `**Status**: Not started` marker to each UX-8.x item (UX-8.1 through UX-8.8). Promoted UX-8.x headings from `##` to `###` for consistent hierarchy. All 605 tests pass.

### AUD-015 — Shared distill shell/nav not implemented (no `src/app/distill/layout.tsx`)
- **Source**: Claude #10 (LOW); Codex (MEDIUM)
- **Severity**: MEDIUM
- **Type**: UX roadmap
- **Docs cited**: UX_SPEC requires shared shell
- **Code refs**: distill pages hand-roll nav; missing `src/app/distill/layout.tsx`
- **Decision**: Defer unless UX_SPEC is binding; otherwise implement in UX-8.1.
- **Planned PR**: `ux/8.1-distill-shell`
- **Acceptance checks**:
  - Shared layout exists; pages use it
- **Status**: Done
- **Resolution**: Created `src/app/distill/layout.tsx` — a shared client layout with persistent top nav bar and active tab state (derived from `usePathname()`). Nav links: Home, Dashboard, Import, Inspector, Search. Active state uses most-specific-path-first matching (Inspector before Import; Run Detail falls back to Dashboard). Removed hand-rolled breadcrumb/link divs from all 5 distill pages (Dashboard, Search, Import, Inspector, Run Detail). Removed unused `Link` import from Run Detail. All 605 tests pass.

### AUD-016 — Dashboard “Create Run” gated by local classifyResult instead of persisted classify status
- **Source**: Codex (MEDIUM)
- **Severity**: MEDIUM
- **Type**: UX roadmap
- **Docs cited**: UX_SPEC
- **Code refs**: dashboard `page.tsx` create-run gating
- **Decision**: Implement as UX-8.x work if binding.
- **Planned PR**: `ux/dashboard-create-run-gating`
- **Acceptance checks**:
  - Create-run gating uses persisted classify status from server
- **Status**: Done
- **Resolution**: Replaced ephemeral `classifyResult` gate in the dashboard "Create Run" card with `lastClassifyStats` (persisted server state from `GET /last-classify`). Three gate states: no stats → "Classify the batch first"; status=running → "Classification in progress..."; terminal (succeeded/failed) → show create-run form. Page refresh or navigation no longer hides the form when classification has already been performed. All 605 tests pass.

### AUD-017 — UI data loads have silent failure handling (need actionable errors)
- **Source**: Codex (MEDIUM)
- **Severity**: MEDIUM
- **Type**: UX roadmap
- **Docs cited**: UX_SPEC actionable errors
- **Code refs**: `page.tsx` load paths with silent catch/ignore
- **Decision**: Implement error surfacing patterns (toast/inline) per UX_SPEC.
- **Planned PR**: `ux/actionable-errors`
- **Acceptance checks**:
  - Simulated 500/404 yields visible actionable UI error
- **Status**: Done
- **Resolution**: Replaced 5 silent `catch {}` blocks across 2 pages with visible inline error UI. Dashboard (`page.tsx`): added `loadError` state for batch/prompt-version/filter-profile fetch failures (shown as red banner below heading), and `lastClassifyStatsError` for classify-stats fetch failures (shown inline near stats section). Run Detail (`runs/[runId]/page.tsx`): added `classifyStatsError` state for classify-stats fetch failures (shown inline). All error handlers extract API error messages from response bodies when available, falling back to HTTP status codes or generic messages. Non-ok responses (`!res.ok`) now surface errors instead of being silently ignored. All 605 tests pass.

### AUD-018 — Run detail missing grouped tick/reset/resume/cancel controls
- **Source**: Codex (MEDIUM)
- **Severity**: MEDIUM
- **Type**: UX roadmap
- **Docs cited**: UX_SPEC run detail controls grouping
- **Code refs**: run detail `page.tsx`
- **Decision**: Implement as UX-8.x if binding.
- **Planned PR**: `ux/run-detail-controls-grouping`
- **Acceptance checks**:
  - Controls rendered as grouped block with required actions
- **Status**: Done
- **Resolution**: Replaced standalone `TickControl` component with grouped `RunControls` component in run detail page. Block contains Tick, Resume, and Cancel buttons side-by-side, each with a description of its side effect (e.g., "Process the next batch of queued jobs", "Requeue failed jobs for retry", "Cancel all queued jobs (irreversible)"). Controls are state-aware: Tick/Cancel disabled when run is terminal; Resume disabled when no failed jobs or run is terminal. In-flight status messages and last-action results (success/error) displayed for all three actions. All 605 tests pass.

### AUD-019 — Search scope switch clears results immediately without explicit rerun cue
- **Source**: Codex (MEDIUM)
- **Severity**: MEDIUM
- **Type**: UX roadmap
- **Docs cited**: UX_SPEC search scope switching behavior
- **Code refs**: search `page.tsx`
- **Decision**: Implement UX behavior (keep results + show “rerun” cue, or auto-rerun with clear affordance) per UX_SPEC.
- **Planned PR**: `ux/search-scope-switch`
- **Acceptance checks**:
  - Changing scope shows explicit rerun state and does not silently wipe results
- **Status**: Done
- **Resolution**: Replaced silent result-wipe on scope change with stale-result preservation and explicit rerun cue. Added `searchedScope` state to track the scope used for the last executed search. When scope differs from `searchedScope` and results exist, an amber banner appears: "Scope changed to {X} — click Search to update results" with a Rerun button. Extracted `executeSearch()` from `handleSubmit` so both the form and the rerun button share the same logic. `searchedScope` updates only after a successful search. Previous results remain visible until the user explicitly reruns. All 605 tests pass.

---

## Spec/doc internal inconsistencies to resolve

These are not necessarily code bugs, but they create recurring audit noise.

### AUD-020 — SPEC conflicts on search scope and polling interval
- **Source**: Codex (LOW)
- **Severity**: LOW
- **Type**: Doc drift
- **Docs cited**: SPEC scope statement vs route implementation; SPEC polling interval vs UX_SPEC minimum
- **Decision**: Choose one truth and align SPEC + UX_SPEC + code.
- **Planned PR**: `docs/spec-consistency-search-polling`
- **Acceptance checks**:
  - SPEC and UX_SPEC agree; code matches
- **Status**: Done
- **Resolution**: Two conflicts resolved. (1) Search scope: removed `both` from SPEC.md `scope=raw|outputs|both` → `scope=raw|outputs` to match code (`SearchScope = 'raw' | 'outputs'` in `search.ts`, `VALID_SCOPES` in route handler). (2) Polling interval: aligned UX_SPEC.md from "Minimum interval: 2s; default 3-5s" to "750–1500 ms (or exponential backoff)" to match SPEC §4.6 and code (`POLL_INTERVAL_MS = 1000`). All 605 tests pass.

### AUD-021 — Flaky test: run.test.ts "selects default labelSpec when omitted" fails in parallel
- **Source**: Discovered during AUD-011
- **Severity**: MEDIUM
- **Type**: Test/infra
- **Code refs**: `src/lib/services/__tests__/run.test.ts` line ~314
- **Problem**: Test passes in isolation but intermittently fails when run with the full suite. Likely DB state contamination from parallel test files that modify PromptVersion active status (e.g., seed invariant tests from AUD-007). Same class of issue as the known `listImportBatches` pagination flakiness.
- **Decision**: Fix test isolation (e.g., dedicated test setup/teardown, or per-file DB transactions).
- **Acceptance checks**:
  - `npx vitest run` passes reliably (10 consecutive runs with no flakes in this test)
- **Status**: Done
- **Resolution**: Fixed two sources of parallel-test interference in the default labelSpec selection path. In `run.test.ts`, pinned the test's CLASSIFY PromptVersion with `createdAt: 2099-01-01` so it deterministically wins `createRun`'s `findFirst orderBy createdAt desc` selection regardless of competing versions from parallel test files. In `seed-invariants.test.ts`, scoped the "findFirst with orderBy desc" test query from global (`prompt: { stage: 'CLASSIFY' }`) to per-Prompt (`promptId: classifyPromptId`) to prevent cross-test interference. Both changes eliminate the race condition where labels pointed at a foreign version that could be deleted before `createRun` executed. 10 consecutive `npx vitest run` executions passed (605 tests each).

### AUD-022 — Search endpoint missing `sources` and `categories` filter params
- **Source**: Audit 2026-02-08
- **Severity**: MEDIUM
- **Type**: Contract break
- **Docs cited**: SPEC §10.1 (line 829): `GET /api/distill/search?q=...&scope=raw|outputs&importBatchId=...&runId=...&startDate=...&endDate=...&sources=...&categories=...&limit=...&cursor=...`
- **Code refs**: `src/app/api/distill/search/route.ts` (lines 17-27), `src/lib/services/search.ts`
- **Problem**: SPEC lists `sources` and `categories` as query params for the search endpoint. Neither the route handler nor the service accepts or uses them. A client passing `sources=chatgpt` or `categories=WORK` gets unfiltered results with no error — params are silently ignored.
- **Decision**: Fix code (add filter support) OR fix spec (remove params if intentionally deferred to a future version).
- **Planned PR**: `fix/AUD-022-search-filters`
- **Acceptance checks**:
  - `GET /api/distill/search?q=test&scope=raw&sources=chatgpt` returns only chatgpt atoms
  - `GET /api/distill/search?q=test&scope=raw&categories=WORK` returns only atoms labeled WORK (requires label context)
  - OR: SPEC §10.1 no longer lists `sources`/`categories` if deferred
- **Status**: Done
- **Resolution**: Implemented `sources` and `categories` query params for `GET /api/distill/search` per SPEC §10.1. Route handler parses comma-separated values and validates against `SOURCE_VALUES`/`CATEGORY_VALUES` enums (400 on invalid). Service `searchRaw()` adds `ma."source" IN (...)` WHERE clause for sources (cast to `"Source"` enum). For categories: when label context is available, filters via `ml."category" IN (...)` on the existing label JOIN; when no label context, uses `EXISTS` subquery against any `message_labels` row. Both filters only apply to raw scope (atoms). Added 10 integration tests covering: single/multi/empty source filtering, category filtering with and without label context, and combined sources+categories. All 615 tests pass.

### AUD-023 — Classify-runs `progress` field shape differs from SPEC §7.2.1
- **Source**: Audit 2026-02-08
- **Severity**: LOW
- **Type**: Contract break
- **Docs cited**: SPEC §7.2.1 (lines 434-448) normative response schema for `GET /api/distill/classify-runs/:id`
- **Code refs**: `src/app/api/distill/classify-runs/[id]/route.ts` (lines 45-57)
- **Problem**: SPEC defines `progress` as `{"processedAtoms": 0, "totalAtoms": 0, "skippedBadOutput": 0, "aliasedCount": 0}`. Code returns `progress: {"processedAtoms", "totalAtoms"}` plus a separate `warnings: {"skippedBadOutput", "aliasedCount"}` key. Data is present but shape differs. A client following the spec would get `undefined` from `response.progress.skippedBadOutput`.
- **Decision**: Fix spec (update §7.2.1 to reflect the `progress` + `warnings` split) since the code design is semantically cleaner.
- **Planned PR**: `docs/AUD-023-classify-runs-schema`
- **Acceptance checks**:
  - SPEC §7.2.1 normative JSON schema matches code response shape
  - `progress` contains only progress fields; `warnings` contains warning fields
- **Status**: Done
- **Resolution**: Updated SPEC §7.2.1 normative JSON schema to match code response shape: `progress` now contains only `processedAtoms` + `totalAtoms`; warning counters (`skippedBadOutput`, `aliasedCount`) moved to a separate `warnings` key. Also added `startedAt` and `finishedAt` timestamp fields that were present in code but missing from the schema. Added notes clarifying `warnings` semantics. Added 1 contract-shape integration test asserting exact key sets for `progress`, `warnings`, and top-level response. All 616 tests pass.

### AUD-024 — ACCEPTANCE.md test coverage table stale
- **Source**: Audit 2026-02-08
- **Severity**: LOW
- **Type**: Doc drift
- **Docs cited**: ACCEPTANCE.md (lines 49-63)
- **Code refs**: 41 test files under `src/__tests__/` and `src/lib/services/__tests__/`
- **Problem**: Table lists 13 test files with stale paths. Specific issues: `__tests__/hash.test.ts` does not exist; `__tests__/stable-id.test.ts` should be `stableId.test.ts`; `services/__tests__/classifier.test.ts` should be `classify.test.ts`. 28 test suites added since table was written are not listed (LLM, pricing, providers, classify variants, import-claude/grok, seed-invariants, etc.).
- **Decision**: Fix docs — update table with all 41 test files and correct paths.
- **Planned PR**: `docs/AUD-024-acceptance-test-table`
- **Acceptance checks**:
  - Every test file in the repo appears in the table with correct path
  - No table entry references a non-existent file
- **Status**: Done
- **Resolution**: Replaced the stale 13-entry table in ACCEPTANCE.md with all 41 test files using correct full paths. Removed non-existent `__tests__/hash.test.ts`, fixed `stable-id.test.ts` → `stableId.test.ts`, fixed `classifier.test.ts` → `classify.test.ts`, and added all `src/` prefixes. Added 28 missing test suites (LLM, pricing, providers, classify variants, import-claude/grok, seed-invariants, inspectors, search, etc.) organized by component group. Also fixed the stale path reference in AC-02 code example. All 616 tests pass.

### AUD-025 — EXECUTION_PLAN references non-existent E2E tests
- **Source**: Audit 2026-02-08
- **Severity**: INFO
- **Type**: Doc drift
- **Docs cited**: EXECUTION_PLAN.md (lines 612-616)
- **Code refs**: `package.json` (no Playwright/Cypress dependency)
- **Problem**: Testing Strategy section lists "E2E Tests (Playwright/Cypress)" with 4 bullet items. Neither framework is installed and no E2E test files exist. SPEC §2 non-goals exclude UI polish. The section is aspirational but reads as implemented.
- **Decision**: Fix docs — add "Not implemented in v0.3" annotation or move to future-work section.
- **Planned PR**: `docs/AUD-025-e2e-caveat`
- **Acceptance checks**:
  - EXECUTION_PLAN E2E section clearly marked as not yet implemented
- **Status**: Done
- **Resolution**: Added "Not implemented in v0.3" annotation to the E2E Tests heading and a status blockquote noting neither Playwright nor Cypress is installed. Bullet items retained as aspirational targets. References SPEC §2 non-goals.

### AUD-026 — Search `categories` filter bypasses required labelSpec context
- **Source**: Audit 2026-02-09
- **Severity**: HIGH
- **Type**: Contract break
- **Docs cited**: `SPEC.md` §7.9 rules (category filtering requires `labelModel` + `labelPromptVersionId` when `runId` is absent)
- **Code refs**: `src/app/api/distill/search/route.ts` (no context-required validation); `src/lib/services/search.ts` (`categories` fallback uses `EXISTS` over any label context); `src/lib/services/__tests__/search.test.ts` (explicitly tests no-context `categories` behavior)
- **Problem**: SPEC requires explicit label context for category filtering without `runId`, but implementation accepts no-context category filters and applies them across any labels. This can return semantically different results than labelSpec-pinned filtering.
- **Decision**: Fix code to enforce required context OR change spec to explicitly permit global/no-context category filtering.
- **Planned PR**: `fix/AUD-026-search-category-context`
- **Acceptance checks**:
  - `GET /api/distill/search?...&categories=...` without `runId` and without `labelModel`/`labelPromptVersionId` is either rejected with `400 INVALID_INPUT` (code fix path) or explicitly documented as supported (spec fix path).
  - Search tests reflect the chosen contract and remove ambiguous behavior.
- **Status**: Done
- **Resolution**: Fixed code path (enforce required label context per SPEC §7.9). Route handler now rejects `categories` filter on raw scope without label context (`runId` or both `labelModel`+`labelPromptVersionId`) with 400 INVALID_INPUT. Removed the `EXISTS` fallback in `searchRaw()` that matched categories against any label regardless of labelSpec context, replacing it with a defensive throw. Updated test from exercising the old no-context `EXISTS` behavior to verifying the rejection. All 616 tests pass.

### AUD-027 — Stub mode PromptVersion contract differs from SPEC
- **Source**: Audit 2026-02-09
- **Severity**: MEDIUM
- **Type**: Contract break
- **Docs cited**: `SPEC.md` §7.2 (stub mode labels should reference seeded `classify_stub_v1`)
- **Code refs**: `src/lib/services/classify.ts` (stub mode records caller-provided `promptVersionId`); `src/__tests__/services/classify.test.ts` (expects stub mode to accept non-stub PromptVersion IDs)
- **Problem**: SPEC states stub mode labels should point to `classify_stub_v1`, but implementation intentionally supports arbitrary PromptVersion IDs in stub mode (deterministic execution, versioned labels).
- **Decision**: Change spec to match implementation intent OR change code/tests to force `classify_stub_v1` recording in stub mode.
- **Planned PR**: `docs/AUD-027-stub-promptversion-contract`
- **Acceptance checks**:
  - SPEC, route/service behavior, and tests all agree on whether stub mode may record non-stub `promptVersionId`.
  - Guardrail behavior is explicit and covered by tests.
- **Status**: Done
- **Resolution**: Changed spec to match implementation intent. Updated SPEC §7.2 line 415 to state stub mode records the caller-provided `promptVersionId` unchanged with no guardrails, and line 461 to drop the `classify_stub_v1` requirement. Added explicit assertion to existing guardrail test confirming `result.labelSpec.promptVersionId` equals the caller-provided (non-stub) value. SPEC, code, and tests now agree: stub mode accepts any `promptVersionId`. All 616 tests pass.

### AUD-028 — “Exactly one active PromptVersion per stage” conflicts with seeded state
- **Source**: Audit 2026-02-09
- **Severity**: MEDIUM
- **Type**: Contract break
- **Docs cited**: `SPEC.md` §6.7 ("Exactly one active PromptVersion per stage"); `EXECUTION_PLAN.md` classify guardrail block
- **Code refs**: `prisma/seed.ts` (`redact v1` seeded inactive); `prisma/seed.ts` invariant check enforces `>1` failure (at-most-one), not exactly-one
- **Problem**: Docs assert exactly one active PromptVersion per stage, but seeded v0.3 data has no active redact version and code enforces only at-most-one.
- **Decision**: Either enforce exactly-one for all stages (including redact) or revise docs to at-most-one with stage-specific requirements for v0.3.
- **Planned PR**: `docs/AUD-028-active-prompt-invariant`
- **Acceptance checks**:
  - Declared invariant is unambiguous in SPEC/plan/seed comments.
  - Post-seed invariant check enforces the declared rule (exactly-one vs at-most-one) consistently.
- **Status**: Done
- **Resolution**: Changed spec to at-most-one. Updated SPEC §6.7 from "Exactly one active PromptVersion per stage" to "At most one active PromptVersion per stage" with note that unimplemented stages (e.g. redact in v0.3) may have zero. Updated EXECUTION_PLAN.md guardrail note and seed.ts comment to match. Code and tests already enforced at-most-one (`>1` failure check, `activeCount = 0` accepted). All 616 tests pass.

### AUD-029 — Canonical test count is stale again (regression of AUD-011)
- **Source**: Audit 2026-02-09
- **Severity**: LOW
- **Type**: Doc drift
- **Docs cited**: `CONTEXT_PACK.md` line with canonical test count
- **Code refs**: `npx vitest run` output (current passing test count)
- **Problem**: Canonical count says `605 passing`, but current suite is `616 passing`, so the designated source-of-truth is stale.
- **Decision**: Fix docs and tighten update discipline for canonical count updates.
- **Planned PR**: `docs/AUD-029-refresh-canonical-test-count`
- **Acceptance checks**:
  - Canonical count matches latest `npx vitest run`.
  - No conflicting "current test count" claims across primary docs.
- **Status**: Done
- **Resolution**: Updated CONTEXT_PACK.md canonical test count from 605 to 616 (matching `npx vitest run` output). No other primary docs had stale current-count claims — remaining "605" references in REMEDIATION.md are historical resolution notes, not current assertions.

### AUD-030 — ACCEPTANCE test-suite commands reference non-existent paths
- **Source**: Audit 2026-02-09
- **Severity**: LOW
- **Type**: Doc drift
- **Docs cited**: `ACCEPTANCE.md` Test Suites command block
- **Code refs**: Repo test directories under `src/__tests__/...` and `src/lib/services/__tests__/...`
- **Problem**: `ACCEPTANCE.md` recommends `src/lib/parsers/__tests__/` and `src/lib/__tests__/`, which do not exist; this misleads verification workflow.
- **Decision**: Fix docs to use existing test paths.
- **Planned PR**: `docs/AUD-030-acceptance-test-paths`
- **Acceptance checks**:
  - Every documented path in Test Suites command block exists.
  - Running documented subset commands executes expected suites.
- **Status**: Done
- **Resolution**: Fixed ACCEPTANCE.md Test Suites command block: replaced non-existent `src/lib/parsers/__tests__/` with `src/__tests__/parsers/`, replaced non-existent `src/lib/__tests__/` with `src/__tests__/`, and added `src/__tests__/services/`. All four documented subset paths now resolve to existing directories with test files.

### AUD-031 — REMEDIATION "Current top priorities" lists already-done items
- **Source**: Audit 2026-02-09
- **Severity**: INFO
- **Type**: Doc drift
- **Docs cited**: `REMEDIATION.md` Current top priorities section vs AUD statuses
- **Code refs**: `REMEDIATION.md` entries AUD-022/AUD-023/AUD-024/AUD-025 marked `Done`
- **Problem**: Priority list still points to completed AUDs, reducing ledger reliability for triage.
- **Decision**: Fix docs so top priorities reflect open work only (or explicitly state none open).
- **Planned PR**: `docs/AUD-031-remediation-priority-refresh`
- **Acceptance checks**:
  - Current top priorities include only non-Done AUDs.
  - Priority section remains consistent after status changes.
- **Status**: Done
- **Resolution**: Replaced stale "Current top priorities" list (AUD-022/023/024/025, all Done) with a summary noting all AUD-001 through AUD-031 are Done, directing readers to check for new entries below.

### AUD-032 — UX_SPEC Section 8 status markers are stale
- **Source**: UX backlog review
- **Severity**: LOW
- **Type**: Doc drift
- **Docs cited**: `UX_SPEC.md` Section 8 (UX-8.1 through UX-8.8)
- **Problem**: All 8 UX-8.x items say "**Status**: Not started" despite AUD-015 through AUD-019 delivering work on several of them. Misrepresents project state and creates audit noise.
- **Decision**: Fix docs
- **Planned PR**: `docs/AUD-032-ux-spec-status-refresh`
- **Acceptance checks**:
  - Each UX-8.x status marker reflects actual state (Done / Partial / Not started) with AUD cross-references where applicable.
  - No stale "Not started" on completed or partially completed work.
- **Status**: Done
- **Resolution**: Updated UX_SPEC.md Section 8 status markers to reflect work delivered by AUD-015–019. No code changes.

### AUD-033 — Dashboard 2-column layout + latest run card (UX-8.3)
- **Source**: UX backlog (UX_SPEC.md §4.1, §8.3)
- **Severity**: LOW
- **Type**: UX roadmap
- **Docs cited**: `UX_SPEC.md` §4.1 (Dashboard requirements), §8.3 (Dashboard IA Pass)
- **Problem**: Dashboard is single-column. No "latest run" card — after creating a run, no way to return to it from the dashboard. UX_SPEC §4.1 requires 2-column layout (primary flow + status/context).
- **Decision**: Implement 2-column layout + latest run summary card
- **Planned PR**: `fix/AUD-033-dashboard-2col-layout`
- **Acceptance checks**:
  - Desktop: 2-column layout visible (primary flow left, status/context right).
  - Latest run card shows status badge, progress counters, "View Run" link.
  - Empty states have explicit next-action text.
  - Mobile: graceful single-column fallback.
  - Changes limited to `src/app/distill/page.tsx` and `REMEDIATION.md`.
  - `npx vitest run` passes (616+ tests).
  - No new API routes or Prisma schema changes.
- **Status**: Done
- **Resolution**: Converted dashboard to 2-column layout (primary flow left, status/context right). Added latest run card with status badge, progress counters, and "View Run" link. Responsive single-column fallback on mobile. Reorganized feature cards into right-column quick links. No new API routes or schema changes.

### AUD-034 — Import Inspector context bar + filter reset (UX-8.6)
- **Source**: UX backlog (UX_SPEC.md §4.3, §8.6)
- **Severity**: LOW
- **Type**: UX roadmap
- **Docs cited**: `UX_SPEC.md` §4.3 (Import Inspector requirements), §8.6 (Inspector Orientation Pass)
- **Problem**: No top context bar summarizing batch/day/filter state. No clear/reset affordance when source filter is active. Empty states lack recovery guidance.
- **Decision**: Implement context bar + filter reset + actionable empty states
- **Planned PR**: `fix/AUD-034-inspector-context-bar`
- **Acceptance checks**:
  - Context bar visible when batch selected (filename, source, coverage, selected day, source filter, atom count).
  - Clear-filter button appears when source filter active; clicking resets to "all".
  - Empty states have actionable recovery text and buttons.
  - Changes limited to `src/app/distill/import/inspect/page.tsx` and `REMEDIATION.md`.
  - `npx vitest run` passes (616+ tests).
  - No new API routes or Prisma schema changes.
- **Status**: Done
- **Resolution**: Enhanced Import Inspector with context bar (filename, source badge, coverage, selected day, active source filter with clear button, atom count). Added clear/reset controls for source filter in both context bar and dropdown. Improved empty states with actionable recovery (clear filter button when filtered, sidebar guidance when no day selected). Source filter dropdown now syncs to URL for shareability. No new API routes or schema changes.


### AUD-035 — Run detail top status rail + collapsible config (UX-8.7)
- **Source**: UX backlog (UX_SPEC.md §4.4, §8.7)
- **Severity**: LOW
- **Type**: UX roadmap
- **Docs cited**: `UX_SPEC.md` §4.4 (Run Detail requirements), §8.7 (Run Detail Task-Focus Pass)
- **Problem**: Status badge is small and buried in header. Progress is below frozen config. Controls (Tick/Resume/Cancel) are below progress, requiring scroll. Frozen config always expanded, pushing everything down.
- **Decision**: Add top status rail, move controls above config, make config collapsible
- **Planned PR**: `fix/AUD-035-run-detail-status-rail`
- **Acceptance checks**:
  - Status rail is first visible element after heading (prominent badge, progress counters, completion percent).
  - Controls visible without scrolling past config.
  - Config collapse toggle works (starts expanded, user can collapse/expand).
  - Changes limited to `src/app/distill/runs/[runId]/page.tsx` and `REMEDIATION.md`.
  - `npx vitest run` passes (616+ tests).
  - No new API routes or Prisma schema changes.
- **Status**: Done
- **Resolution**: Added top status rail (prominent badge, progress bar, inline counters, completion percent, token/cost totals). Moved RunControls immediately below status rail so controls are visible without scrolling past config. Made frozen config collapsible with toggle (starts expanded, user can collapse). Removed separate Progress Summary section (merged into status rail). No new API routes or schema changes.


### AUD-042 — Dashboard classify gating not scoped to selected batch
- **Source**: Manual smoke test after AUD-033/AUD-034 (dashboard shows “needs classify” for a batch that was previously classified)
- **Severity**: MEDIUM
- **Type**: UX roadmap
- **Docs cited**: `UX_SPEC.md` §4.1 (dashboard primary flow), AUD-016 (“Create Run” gated by persisted classify status)
- **Code refs**: `src/app/distill/page.tsx` (dashboard create-run gating), `GET /api/distill/last-classify` (or equivalent endpoint used by dashboard)
- **Problem**: Selecting an import batch that has already been classified can still show the dashboard as if it has not been classified. The persisted classify gating appears to be using unscoped “last classify” state (not filtered by `importBatchId`) or the UI is not passing/using `importBatchId` correctly. This blocks the expected “classify once, create multiple runs” workflow and makes manual smoke tests ambiguous.
- **Decision**: Fix code
- **Planned PR**: `fix/AUD-042-dashboard-classify-scope`
- **Acceptance checks**:
  - When selecting a batch that has a terminal classify run (`succeeded` or `failed`), the dashboard gating recognizes it and shows the Create Run form (or terminal classify status UI) without requiring re-classify.
  - When selecting a different batch with no classify run, the dashboard correctly shows “Classify the batch first.”
  - The server/API behavior is batch-scoped: the dashboard’s “last classify” request is filtered by `importBatchId` (query param) or otherwise deterministically returns stats for the selected batch.
  - Add/adjust tests to cover two batches: only one classified → endpoint/UI reflects correct per-batch behavior.
  - `npx vitest run` passes (616+ tests).
  - No new API routes (extend existing endpoint behavior if needed) and no Prisma schema changes.
- **Status**: Done
- **Resolution**: Fixed two root causes: (1) Race condition — replaced effect-based `fetchLastClassifyStats` call with inline fetch using cleanup-based cancellation flag, preventing stale responses from batch A overwriting batch B's state on rapid switch. (2) Loading state gap — added `loadingLastClassifyStats` state and "Loading classify status..." gating in Create Run section, preventing false "Classify first" during async fetch. Also set loading flag in `handleBatchSelect` to avoid single-render flash. Added 2 integration tests (two-batch and cross-batch leak scenarios) to `classify-audit-trail.test.ts`. No new API routes or schema changes. 618 tests pass.

### AUD-043 — Support creating runs across multiple import batches (multi-batch selection)
- **Source**: User UX discovery during manual smoke tests; Create Run "Sources" checkboxes are constrained by single-batch selection
- **Severity**: LOW
- **Type**: UX roadmap
- **Docs cited**: `UX_SPEC.md` (Create Run flow), `SPEC.md` run creation contract currently keyed to a single `importBatchId`
- **Code refs**: `src/app/distill/page.tsx` (batch selection + create-run form), `POST /api/distill/runs` contract, run config persistence
- **Problem**: Dashboard allows selecting sources via checkboxes when creating a run, but the UI currently supports selecting only one `importBatchId` at a time. This makes "include sources" effectively redundant/misleading for most batches (which are single-source). The desired end state is to create a run over a union of atoms from multiple import batches (e.g., ChatGPT + Claude + Grok) while preserving deterministic ordering and stable IDs.
- **Decision**: Split into AUD-043a (design/spec) + AUD-043b–043f (implementation). See sub-entries below.
- **Planned PR**: split across `docs/AUD-043a-*`, `fix/AUD-043b-*` through `fix/AUD-043f-*`
- **Acceptance checks** (overall):
  - Create-run supports selecting 2+ batches and produces a run over the combined atom set.
  - Deterministic ordering across batches (stable sort key defined; no duplicates).
  - Run config persists selected batches (and/or derived selection rules) as frozen config.
  - Search/run detail behaviors remain correct with multi-batch runs.
  - `npx vitest run` passes.
- **Status**: Done (AUD-043a–043f all complete)

### AUD-036 — Search metadata hierarchy + empty state (UX-8.5)
- **Source**: UX backlog (UX_SPEC.md §8.5)
- **Severity**: LOW
- **Type**: UX roadmap
- **Docs cited**: `UX_SPEC.md` §4.5 (Search requirements), §8.5 (Search Readability Pass)
- **Problem**: Result count lacks "more available" cue when paginated. Empty state lacks query/scope context and suggestion. Error state lacks retry button.
- **Decision**: Fix UI
- **Planned PR**: `fix/AUD-036-search-metadata-empty`
- **Acceptance checks**:
  - "more available" indicator visible when `nextCursor` exists.
  - Empty state shows query + scope + suggestion text.
  - Error state has clickable Retry that re-executes last search.
  - Changes limited to `src/app/distill/search/page.tsx` and `REMEDIATION.md`.
  - `npx vitest run` passes.
  - No new API routes or Prisma schema changes.
- **Status**: Done
- **Resolution**: Added three UX improvements to search page: (1) Result count shows "(more available)" when nextCursor exists. (2) Empty state displays query text, scope, and actionable suggestion. (3) Error block includes Retry button that re-executes with current params (hidden when no query). No new API routes or schema changes.

### AUD-037 — Dashboard classify checkpoint timestamp (UX-8.4)
- **Source**: UX backlog (UX_SPEC.md §8.4)
- **Severity**: LOW
- **Type**: UX roadmap
- **Docs cited**: `UX_SPEC.md` §6 (line 197: "Show latest checkpoint timestamp when available"), §8.4 (Dashboard Progress Surface)
- **Problem**: During running classify state, no checkpoint timestamp is shown. Users cannot tell when the last progress update occurred.
- **Decision**: Fix UI
- **Planned PR**: `fix/AUD-037-classify-checkpoint-timestamp`
- **Acceptance checks**:
  - "Last checkpoint: {time}" visible during running classify progress.
  - Uses existing data (no new API routes or schema changes).
  - Timestamp clears on classify completion or batch switch.
  - Changes limited to `src/app/distill/page.tsx` and `REMEDIATION.md`.
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Added client-side `lastCheckpointAt` state that records the time of each successful poll update during classify running state. Displayed as "Last checkpoint: {time}" in the live classify progress panel. Clears on batch switch and classify completion. No new API routes or schema changes.

### AUD-038 — Extract shared UI utility functions and types
- **Source**: UX backlog (UX_SPEC.md §8.2)
- **Severity**: LOW
- **Type**: UX roadmap (refactor)
- **Docs cited**: `UX_SPEC.md` §8.2 (Shared Components)
- **Problem**: `getStatusColor`, `getClassifyStatusColor`, `getJobStatusColor`, `formatProgressPercent` copy-pasted between dashboard and run detail. `LastClassifyStats` interface (26 lines) duplicated identically.
- **Decision**: Extract to shared modules
- **Planned PR**: `fix/AUD-038-shared-ui-utils`
- **Acceptance checks**:
  - No duplicate function/interface definitions across pages.
  - No behavioral or visual change.
  - Changes limited to `src/app/distill/page.tsx`, `src/app/distill/runs/[runId]/page.tsx`, new `src/app/distill/lib/ui-utils.ts`, new `src/app/distill/lib/types.ts`, and `REMEDIATION.md`.
  - `npx vitest run` passes.
  - No new API routes or Prisma schema changes.
- **Status**: Done
- **Resolution**: Extracted `getClassifyStatusColor`, `getStatusColor` (unified from dashboard `getRunStatusColor` + run detail `getStatusColor`), `getJobStatusColor`, and `formatProgressPercent` into `src/app/distill/lib/ui-utils.ts`. Extracted `LastClassifyStats` interface into `src/app/distill/lib/types.ts`. Both pages now import from shared modules. Zero duplicate definitions remain. No behavioral or visual changes. No new API routes or schema changes.

---

### AUD-039 — Extract usePolling hook (UX-8.8)
- **Source**: UX backlog (UX_SPEC.md §8.8)
- **Severity**: LOW
- **Type**: UX roadmap (refactor)
- **Docs cited**: `UX_SPEC.md` §8.8 (Polling Hook)
- **Problem**: ~60 lines of polling logic (setTimeout + AbortController + unmount cleanup) inline in dashboard. Needed in run detail too. UX_SPEC §6 + UX-8.8 call for reusable hook.
- **Decision**: Extract to reusable hook; refactor dashboard to use it
- **Planned PR**: `fix/AUD-039-use-polling-hook`
- **Acceptance checks**:
  - `usePolling<T>` hook exists at `src/app/distill/hooks/usePolling.ts`.
  - Hook uses setTimeout (not setInterval), no concurrent requests, aborts on unmount/disable, stops on terminal data.
  - Dashboard refactored to use hook; no behavioral change.
  - Hook tests pass (fake timers + mock fetch).
  - Changes limited to new hook file, dashboard page, new test file, and `REMEDIATION.md`.
  - `npx vitest run` passes.
  - No new API routes or Prisma schema changes.
- **Status**: Done
- **Resolution**: Created `usePolling<T>` hook + `startPollingLoop<T>` testable engine at `src/app/distill/hooks/usePolling.ts`. Refactored dashboard to replace inline polling (pollAbortRef, pollTimerRef, stopPolling, startPolling, pollForRunId) with `usePolling` driven by `classifyPollUrl` state. Removed dead `ClassifyRunStatus` interface and `classifyProgress` state. 7 new tests in `src/__tests__/hooks/usePolling.test.ts` (625 total). No behavioral or visual changes.

---

### AUD-044 — Create Run UI: provider/model selection is unclear (model is free-text)
- **Source**: UX discovery during manual smoke tests
- **Severity**: MED
- **Type**: UX roadmap
- **Docs cited**: `src/lib/llm/pricing.ts` (rate table), `src/lib/services/run.ts` (inferProvider at run creation)
- **Problem**: The "Create Run" card on the Dashboard had a free-text Model input. This provided no clarity on which provider is used, invited typos, and made it hard to run a real-cost test safely.
- **Decision**: Replace free-text with constrained Provider + Model dropdowns
- **Planned PR**: `fix/AUD-044-provider-model-selects`
- **Acceptance checks**:
  - Provider dropdown with stub / openai / anthropic options.
  - Model dropdown constrained to valid models for the selected provider (mirrors pricing table).
  - Default: stub / stub_summarizer_v1 (safe, no API cost).
  - "Will run with: Provider / Model" effective selection line visible.
  - Warning shown for non-stub providers ("This will use paid API credits").
  - API payload unchanged (sends `model` string; provider inferred server-side).
  - Changes limited to `src/app/distill/page.tsx` and `REMEDIATION.md`.
  - `npx vitest run` passes.
  - No new API routes or Prisma schema changes.
- **Status**: Done
- **Resolution**: Replaced free-text Model input with Provider select (stub/openai/anthropic) + Model select (constrained allowlist per provider). Added `PROVIDER_MODELS` constant mirroring the pricing table. Shows effective selection line and paid-API warning for non-stub providers. Default remains stub/stub_summarizer_v1. API payload unchanged. No new API routes or schema changes.

---

### AUD-040 — Wire usePolling into run detail (auto-refresh progress)
- **Source**: UX backlog (UX-8.8)
- **Severity**: LOW
- **Type**: UX roadmap
- **Docs cited**: `src/app/distill/hooks/usePolling.ts` (AUD-039), `src/app/distill/runs/[runId]/page.tsx`
- **Problem**: Run detail required manual Tick/Resume/Cancel actions to see progress updates. No auto-polling.
- **Decision**: Wire existing `usePolling` hook into run detail page
- **Planned PR**: `fix/AUD-040-run-detail-polling`
- **Acceptance checks**:
  - Run detail auto-polls `GET /api/distill/runs/:runId` when status is non-terminal.
  - Polling stops when run becomes terminal (cancelled/completed).
  - Manual Tick/Resume/Cancel still work (they call `fetchRun()` independently).
  - No new API routes or Prisma schema changes.
  - Changes limited to `src/app/distill/runs/[runId]/page.tsx` and `REMEDIATION.md`.
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Imported `usePolling` hook and wired it to poll run detail endpoint every 3s when run is non-terminal. `onTerminal` stops polling when status becomes cancelled/completed. Manual controls (Tick/Resume/Cancel) continue to work via independent `fetchRun()` calls.

### AUD-043a — Multi-batch run support: spec & UX_SPEC design updates
- **Source**: UX backlog (AUD-043 deferral)
- **Severity**: LOW
- **Type**: Doc drift / spec extension
- **Docs cited**: `SPEC.md` §6.8, §7.3, §9.1; `UX_SPEC.md` §4.1, §4.4
- **Problem**: SPEC §6.8, §7.3, §9.1 and UX_SPEC §4.1 define single-batch run scoping with no multi-batch contract.
- **Decision**: Define multi-batch semantics in spec + UX_SPEC; capture implementation roadmap as AUD-043b–043f.
- **Planned PR**: `docs/AUD-043a-multi-batch-design`
- **Acceptance checks**:
  - SPEC.md updated: §6.8 Run model has `importBatchIds` + §6.8a RunBatch junction, §7.3 input contract accepts `importBatchIds` XOR `importBatchId` with TZ validation, §9.1 cross-batch dedup in bundle construction.
  - UX_SPEC.md updated: §4.1 multi-select batch picker + TZ validation, §4.4 multi-batch display.
  - REMEDIATION.md has AUD-043a = Done and AUD-043b–043f = Not started.
  - Zero code changes.
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Updated SPEC.md (§6.8 `importBatchIds` via RunBatch junction, §6.8a RunBatch model, §7.3 input contract with `importBatchIds` XOR `importBatchId` + TZ validation steps 0a/0b, §9.1 cross-batch dedup in bundle construction keeping first atom in canonical sort order). Updated UX_SPEC.md (§4.1 multi-select batch picker with TZ validation + sources union, §4.4 multi-batch display in frozen config). Captured implementation roadmap as AUD-043b–043f.

### AUD-043b — Schema: RunBatch junction table + data migration
- **Source**: AUD-043a implementation roadmap
- **Severity**: LOW
- **Type**: Contract break
- **Docs cited**: `SPEC.md` §6.8a (RunBatch)
- **Code refs**: `prisma/schema.prisma`, migration SQL
- **Problem**: No `RunBatch` junction table exists. Runs use singular `importBatchId` FK.
- **Decision**: Add `RunBatch` model, keep deprecated `importBatchId` column, backfill existing runs.
- **Planned PR**: `fix/AUD-043b-runbatch-schema`
- **Acceptance checks**:
  - `RunBatch` model in Prisma schema (id, runId FK, importBatchId FK, @@unique).
  - `runBatches RunBatch[]` relation on Run model.
  - Existing `importBatchId` column retained (deprecated, not removed).
  - Data migration: every existing Run gets exactly 1 RunBatch row.
  - `npx prisma migrate dev` succeeds.
  - `npx vitest run` passes (no behavioral change).
- **Status**: Done
- **Resolution**: Added `RunBatch` junction model to `prisma/schema.prisma` (id, runId FK, importBatchId FK, @@unique, cascade deletes). Backfilled existing runs via `INSERT ... ON CONFLICT DO NOTHING` in migration SQL — every existing Run now has exactly 1 RunBatch row. Existing `Run.importBatchId` column retained for backward compatibility. No service-layer or API changes. 625 tests pass.

### AUD-043c — Backend: multi-batch service + bundle dedup
- **Source**: AUD-043a implementation roadmap
- **Severity**: LOW
- **Type**: Contract break
- **Docs cited**: `SPEC.md` §7.3 (Run creation), §9.1 (Bundle ordering)
- **Code refs**: `src/lib/services/run.ts`, `src/lib/services/bundle.ts`, `src/lib/services/tick.ts`
- **Problem**: `createRun()`, `findEligibleDays()`, `buildBundle()`, and `processTick()` are all scoped to a single `importBatchId`.
- **Decision**: Accept `importBatchIds[]`, validate TZ uniformity, write RunBatch rows, query across batches, dedup by `atomStableId`.
- **Depends on**: AUD-043b
- **Planned PR**: `fix/AUD-043c-multi-batch-service`
- **Acceptance checks**:
  - `createRun()` accepts `importBatchIds: string[]`, validates TZ uniformity, writes RunBatch rows.
  - `findEligibleDays()` queries `importBatchId: { in: importBatchIds }`.
  - `buildBundle()` queries atoms from all batches, deduplicates by `atomStableId` (keep first in canonical sort order).
  - `processTick()` reads `importBatchIds` from RunBatch junction.
  - `configJson` includes `importBatchIds[]`.
  - Test: createRun with 2 batches (same TZ) → 2 RunBatch rows.
  - Test: createRun with 2 batches (different TZ) → 400 TIMEZONE_MISMATCH.
  - Test: buildBundle deduplicates cross-batch atoms by `atomStableId`.
  - Test: findEligibleDays unions days across batches.
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Updated `createRun()` to accept `importBatchIds[]` (XOR with `importBatchId`), validate TZ uniformity (`TimezoneMismatchError`), create RunBatch junction rows, and freeze `importBatchIds` in `configJson`. Updated `findEligibleDays()` to query `importBatchId: { in: importBatchIds }`. Updated `buildBundle()` to load atoms from all batches and deduplicate by `atomStableId`. Updated `processTick()` to read `importBatchIds` from RunBatch junction. 12 new tests (637 total).

### AUD-043d — API: POST /runs accepts importBatchIds[]
- **Source**: AUD-043a implementation roadmap
- **Severity**: LOW
- **Type**: Contract break
- **Docs cited**: `SPEC.md` §7.3 (Run creation input)
- **Code refs**: `src/app/api/distill/runs/route.ts`
- **Problem**: POST /runs only accepts singular `importBatchId`.
- **Decision**: Accept `importBatchIds` XOR `importBatchId` (mutual exclusion per SPEC §7.3).
- **Depends on**: AUD-043c
- **Planned PR**: `fix/AUD-043d-api-importBatchIds`
- **Acceptance checks**:
  - POST `importBatchIds: [a, b]` → run with 2 batches.
  - POST `importBatchId: a` → run with 1 batch (backward compat).
  - POST with both → 400 INVALID_INPUT.
  - POST with neither → 400 INVALID_INPUT.
  - POST with duplicates → 400 INVALID_INPUT.
  - GET returns `importBatchIds` array in response.
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Updated `src/app/api/distill/runs/route.ts`: POST accepts `importBatchIds` XOR `importBatchId` with validation (both/neither/empty/duplicates → 400 INVALID_INPUT), catches `TimezoneMismatchError` → 400 TIMEZONE_MISMATCH, passes through to service. GET includes `importBatchIds` from RunBatch junction via Prisma `include`. Added 8 route-level tests (645 total).

### AUD-043e — Dashboard UI: multi-batch selector + TZ validation
- **Source**: AUD-043a implementation roadmap
- **Severity**: LOW
- **Type**: UX roadmap
- **Docs cited**: `UX_SPEC.md` §4.1 (Dashboard)
- **Code refs**: `src/app/distill/page.tsx`
- **Problem**: Dashboard only allows selecting a single import batch for run creation.
- **Decision**: Replace single-batch dropdown with multi-select; validate TZ uniformity; send `importBatchIds[]`.
- **Depends on**: AUD-043d
- **Planned PR**: `fix/AUD-043e-multi-batch-ui`
- **Acceptance checks**:
  - Multi-select works; single-select still works.
  - TZ mismatch blocks creation with visible inline error.
  - Sources reflect union across selected batches.
  - Payload sends `importBatchIds` array.
  - Per-batch classification status check.
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Replaced single-batch dropdown with multi-select checkboxes in `page.tsx`. Added timezone mismatch validation (inline error + Create Run disabled). Sources reflect union across selected batches. Run creation sends `importBatchIds[]`. Per-batch classify status check gates Create Run. Classify batch picker added for multi-batch scenarios.


### AUD-043f — Run detail + search: multi-batch display
- **Source**: AUD-043a implementation roadmap
- **Severity**: LOW
- **Type**: UX roadmap
- **Docs cited**: `UX_SPEC.md` §4.4 (Run detail)
- **Code refs**: `src/app/distill/runs/[runId]/page.tsx`
- **Problem**: Run detail shows single "Import Batch" line; no multi-batch display.
- **Decision**: Show batch list when >1 batch in Run Info section.
- **Depends on**: AUD-043d
- **Planned PR**: `fix/AUD-043f-run-detail-multi-batch`
- **Acceptance checks**:
  - Multi-batch run shows all batch IDs/filenames in Run Info.
  - Single-batch run display unchanged.
  - Search: no change needed (search doesn't filter by run batch).
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Added `importBatchIds` and `importBatches` (id, filename, source) to GET `/api/distill/runs/:id` response via RunBatch junction include. Updated run detail page Run Info section: multi-batch runs show batch list with IDs, filenames, and sources; single-batch display unchanged. 645 tests pass.

### AUD-045 — Multi-batch correctness for job input inspector endpoint
- **Source**: Audit 2026-02-09 (multi-batch review)
- **Severity**: HIGH
- **Type**: Contract break
- **Docs cited**: `SPEC.md` §9.1 (multi-batch atoms loaded from ALL importBatchIds)
- **Code refs**: `src/app/api/distill/runs/[runId]/jobs/[dayDate]/input/route.ts` (uses deprecated single batch ID)
- **Problem**: `GET /api/distill/runs/:runId/jobs/:dayDate/input` builds the input preview/hash using the deprecated singular `run.importBatchId`, while ticking uses RunBatch junction `importBatchIds`. For multi-batch runs, the input preview/hash can differ from the actual processed bundle.
- **Decision**: Fix code
- **Planned PR**: `fix/AUD-045-multi-batch-input-endpoint`
- **Acceptance checks**:
  - Route resolves `importBatchIds` from the canonical source (RunBatch junction, or frozen `configJson.importBatchIds`) and never from deprecated `run.importBatchId`.
  - Multi-batch regression test: for a multi-batch run + dayDate, input endpoint’s preview/hash matches the bundle used by tick/output (same importBatchIds and dedup behavior).
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Changed input route to resolve `importBatchIds` from RunBatch junction (with `configJson.importBatchIds` fallback), replacing deprecated `run.importBatchId`. Added 6 route-level tests: multi-batch includes atoms from both batches, hashes match `buildBundle` with `importBatchIds`, regression test proves old single-batch behavior would have fewer atoms/different hashes, single-batch unchanged, 404 cases. 651 tests pass.

### AUD-046 — Runs list filtering should respect RunBatch membership
- **Source**: Audit 2026-02-09 (multi-batch review)
- **Severity**: MEDIUM
- **Type**: Contract break
- **Docs cited**: `SPEC.md` guidance: new code should read from RunBatch junction; multi-batch semantics
- **Code refs**: `src/app/api/distill/runs/route.ts` (GET list filter uses deprecated field)
- **Problem**: `GET /api/distill/runs?importBatchId=...` filters on deprecated `Run.importBatchId` (primary/first batch). Multi-batch runs that include the batch as non-primary are omitted. Dashboard “latest run” depends on this filter.
- **Decision**: Fix code
- **Planned PR**: `fix/AUD-046-runs-list-membership-filter`
- **Acceptance checks**:
  - GET list filter uses `runBatches.some(importBatchId=...)` semantics (or equivalent join) so any membership matches.
  - Test: create multi-batch run where queried batch is not the primary/first; list endpoint still returns that run.
  - Dashboard latest-run behavior continues to work (no regressions).
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Changed GET `/api/distill/runs` filter from deprecated `Run.importBatchId` to `runBatches: { some: { importBatchId } }` (Prisma relation filter). Added 3 route-level tests: non-primary batch returns multi-batch run, primary batch still works, unfiltered list unchanged. 654 tests pass.

### AUD-047 — Distill bundles must include USER text only (exclude assistant)
- **Source**: Audit 2026-02-09 (bundle content review)
- **Severity**: HIGH
- **Type**: Correctness bug
- **Docs cited**: `SPEC.md` §9.1, §7.3 step 6
- **Code refs**: `src/lib/services/bundle.ts` (buildBundle), `src/lib/services/run.ts` (findEligibleDays)
- **Problem**: Run input bundles included both user and assistant MessageAtoms. The distiller's purpose is to summarize the user's journal, so bundles MUST only contain role=user messages. Assistant atoms should stay in DB for audit/debug but not appear in the bundle the model sees, and assistant-only days should not make a day eligible.
- **Decision**: Fix code + update spec
- **Planned PR**: `fix/AUD-047-user-only-bundles`
- **Acceptance checks**:
  - `buildBundle()` filters to `role: 'USER'` before dedup/sort/render.
  - `findEligibleDays()` only considers `role: 'USER'` atoms.
  - SPEC.md §9.1 and §7.3 updated to state role=user constraint.
  - Tests: bundle excludes assistant lines, assistant-only days are not eligible, multi-batch dedup still works.
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Added `role: 'USER'` filter to Prisma queries in `buildBundle()` and `findEligibleDays()`. Updated SPEC.md §9.1 and §7.3 step 6 to require role=user. Updated 6 existing tests with corrected atom counts. Added 3 new tests: bundle excludes assistant atoms, assistant-only day produces empty bundle, assistant-only day not eligible for run creation. 657 tests pass.

### AUD-048 — Foreground auto-run tick: spec + UX updates (DOC-ONLY)
- **Source**: UX/operability discovery — manual ticking is tedious for large runs
- **Severity**: LOW
- **Type**: Doc drift / spec extension
- **Docs cited**: `SPEC.md` §2, §4.5, §4.6, §7.4; `UX_SPEC.md` §4.4, §6, §7.4
- **Problem**: SPEC §2 non-goals forbid "automatic tick loops" without distinguishing background automation from user-initiated foreground tick loops on the run detail page. No spec or UX contract exists for a "Start Auto-run" feature.
- **Decision**: Update spec + UX spec (doc-only, no code changes)
- **Planned PR**: `docs/AUD-048-foreground-autorun-spec`
- **Acceptance checks**:
  - SPEC.md explicitly allows foreground auto-run tick and still forbids background scheduling.
  - SPEC.md defines auto-run invariants: user-initiated, sequential tick calls (maxJobs=1), stop on unmount, stop on terminal, stop on first tick error, no auto-retry.
  - SPEC.md distinguishes "polling" (read-only) from "foreground auto-run tick loop" (work-triggering).
  - UX_SPEC.md defines run detail auto-run controls, state indicator, and stop conditions.
  - UX_SPEC.md specifies manual Tick button disabled or guarded while auto-run is active.
  - Only SPEC.md, UX_SPEC.md, REMEDIATION.md changed.
  - `npx vitest run` passes.
  - Branch merged to master, clean working tree.
- **Status**: Done
- **Resolution**: Updated SPEC.md (§2 non-goals, §4.5, §4.6, §7.4, new §7.4.2) and UX_SPEC.md (§4.4, §6, §7.4) to define foreground auto-run tick loop contract. Four clarifications: (1) "polling" reserved for read-only; work-triggering loops are "foreground auto-run tick loop" governed by §7.4.2; (2) auto-run locked to maxJobs=1; (3) stop on first error, no auto-retry; (4) manual Tick disabled or guarded while auto-run active. No code changes.


### AUD-049 — Run detail "Auto-run" foreground tick loop (SPEC §7.4.2)
- **Source**: UX/operability — manual ticking is tedious for large runs; spec §7.4.2 defines the contract
- **Severity**: LOW
- **Type**: Feature implementation
- **Docs cited**: `SPEC.md` §7.4.2; `UX_SPEC.md` §4.4, §6, §7.4
- **Problem**: Spec and UX spec define foreground auto-run tick loop but no implementation exists.
- **Decision**: Implement auto-run loop engine + run detail UI controls
- **Planned PR**: `feat/AUD-049-run-detail-autorun`
- **Acceptance checks**:
  - Start/Stop Auto-run buttons on run detail page.
  - Auto-run calls POST /tick sequentially (no overlapping ticks), maxJobs=1.
  - Stops on terminal status (completed/cancelled/failed).
  - Stops on first tick error, no auto-retry.
  - Abort in-flight request on stop/unmount.
  - Manual Tick disabled while auto-run is active.
  - "Auto-running..." indicator visible while active.
  - Auto-run error displayed inline on stop.
  - Uses setTimeout (not setInterval) + AbortController.
  - No new API routes, no Prisma/schema changes.
  - `npx vitest run` passes.
  - Branch merged to master, clean working tree.
- **Status**: Done
- **Resolution**: Added `startAutoRunLoop` engine in `src/app/distill/hooks/useAutoRun.ts` and wired into run detail page. Start/Stop Auto-run buttons in RunControls, "Auto-running..." indicator, manual Tick disabled during auto-run, auto-run error display. 10 new tests for the loop engine (sequential calls, stop-on-error, stop-on-terminal, abort-on-stop, idempotent stop). 667 tests pass.

### AUD-051 — Align Run.status transitions with SPEC §7.4.1
- **Source**: Stabilization audit after AUD-049
- **Severity**: HIGH
- **Type**: Contract break
- **Docs cited**: `SPEC.md` §7.4.1
- **Code refs**: `src/lib/services/tick.ts`; `src/lib/services/__tests__/tick.test.ts`
- **Problem**: `determineRunStatus()` returned `QUEUED` whenever queued jobs remained, even after tick had processed jobs (e.g., `{ queued: 1, succeeded: 1 }`), violating SPEC §7.4.1 (“once work begins, non-terminal runs remain RUNNING until terminal”).
- **Decision**: Fix code
- **Planned PR**: `fix/AUD-051-run-status-transitions`
- **Acceptance checks**:
  - After any successful tick work, `runStatus` is `RUNNING` while queued jobs remain.
  - Terminal transitions remain correct (`COMPLETED` when all succeeded; `FAILED` when any failed and none queued/running).
  - Tests updated: existing assertion fixed; new regression test added for multi-job run.
  - `npx vitest run` passes (flake aside).
- **Status**: Done
- **Resolution**: Updated `determineRunStatus()` so when `queued > 0` and any work has occurred (`succeeded + failed + cancelled > 0`), it returns `RUNNING` (not `QUEUED`). Updated one existing test assertion and added a new regression test covering multi-job runs. Merged to master (9235de5), clean working tree.


### AUD-050 — Run detail must treat FAILED as terminal (polling + auto-run)
- **Source**: Stabilization audit after AUD-049/AUD-051
- **Severity**: MEDIUM
- **Type**: Contract break
- **Docs cited**: `SPEC.md` §4.6, §7.4.2; `UX_SPEC.md` §6
- **Code refs**: `src/app/distill/runs/[runId]/page.tsx`; related terminal checks in `usePolling` / `useAutoRun` if duplicated
- **Problem**: Run detail UI does not consistently treat `failed` as terminal, so polling and/or auto-run may continue and controls may be inconsistent.
- **Decision**: Fix code to treat `failed` as terminal everywhere run terminality is checked.
- **Planned PR**: `fix/AUD-050-run-detail-failed-terminal`
- **Acceptance checks**:
  - Run detail polling stops when `run.status === 'FAILED'`
  - Auto-run stops when run becomes `FAILED`
  - Controls reflect terminal state consistently
  - Tests added/updated to cover FAILED terminal handling
  - `npx vitest run` passes
- **Status**: Done
- **Resolution**: Added `'failed'` to all 3 terminal checks in run detail page (polling enable guard, `usePolling` `onTerminal`, `RunControls` `isTerminal`). Added 2 new tests: `usePolling` stops on `failed` terminal status, `useAutoRun` stops on `failed` terminal status — both using real predicates matching page logic. 670 tests pass.

### AUD-052 — Reject `sourceOverride=mixed` in import API (v0.3 reserved)
- **Source**: Stabilization audit (SPEC intent check)
- **Severity**: MEDIUM
- **Type**: Contract alignment
- **Docs cited**: `SPEC.md` §6.1
- **Code refs**: import route handler validation + `SOURCE_VALUES` in `enums.ts`
- **Problem**: API accepts `sourceOverride=mixed` even though v0.3 reserves `mixed` for a future multi-file import mode.
- **Decision**: Fix code to reject `mixed` with `400 INVALID_INPUT` and a clear message.
- **Planned PR**: `fix/AUD-052-reject-mixed-sourceoverride`
- **Acceptance checks**:
  - Import request with `sourceOverride=mixed` returns `400 INVALID_INPUT` with a clear message
  - Valid overrides (`chatgpt|claude|grok`) unchanged
  - Route-level tests cover mixed rejection + valid overrides
  - `npx vitest run` passes
- **Status**: Done
- **Resolution**: Added explicit `mixed` rejection before general `SOURCE_VALUES.includes()` check in `src/app/api/distill/import/route.ts`. Reordered validations so sourceOverride is checked before file presence (enables DB-free tests). Added 3 route-level tests in `src/app/api/distill/import/__tests__/route.test.ts`: mixed→400 with `validSources` excluding mixed, bogus→400, chatgpt passes source validation (falls through to file-missing check). 673 tests pass.

### AUD-054 — Flaky test: listImportBatches pagination
- **Source**: Repeated stabilization runs (noted during AUD-051 completion)
- **Severity**: MEDIUM
- **Type**: Test/infra
- **Docs cited**: (none)
- **Code refs**: listImportBatches pagination test + underlying query ordering
- **Problem**: A pre-existing pagination test intermittently fails under full-suite execution, undermining red/green confidence.
- **Decision**: Fix test isolation and/or make ordering deterministic (explicit `orderBy`, stable cursor semantics, per-test cleanup).
- **Planned PR**: `fix/AUD-054-listImportBatches-pagination-flake`
- **Acceptance checks**:
  - `npx vitest run` passes reliably (10 consecutive runs with no flakes in this test)
  - Assertions remain meaningful (no weakening)
  - Ordering/cursor assumptions are explicit in code + tests (e.g., `orderBy createdAt,id`)
- **Status**: Done
- **Resolution**: Added `id` as secondary sort key (`orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`) in `listImportBatches` for deterministic cursor pagination. Rewrote pagination test as a page-walk with strict invariants: no duplicate IDs across pages, cursor advances each page, all 3 test batches found, correct relative order (desc by createdAt). Stops early once all test batches are found (avoids exhausting table when parallel tests create many records). 5 consecutive full-suite runs with 0 flakes (673 tests each).


### AUD-055 — Studio inspect panel (collapsible input/output view)
- **Source**: Studio UX redesign plan §3d
- **Severity**: LOW
- **Type**: UX roadmap
- **Problem**: Studio shows journal output but no way to inspect what the model saw (input bundle) or compare input/output side-by-side.
- **Decision**: Implement collapsible inspect panel below journal entry
- **Planned PR**: `feat/AUD-055-studio-inspect-panel`
- **Acceptance checks**:
  - "Inspect" toggle below journal entry metadata opens/closes panel.
  - Panel lazy-fetches `GET /runs/:runId/jobs/:dayDate/input` on open (not before).
  - Left column: bundle preview text (monospace), atom count, bundle hash (truncated).
  - Right column: output markdown + output hash, segmentation metadata.
  - Raw JSON collapsible in each column (collapsed by default).
  - Panel closes when switching days.
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Created `InspectPanel.tsx` (two-column input/output view with lazy-fetch, collapsible raw JSON, hash/atom metadata). Modified `JournalEntry.tsx` to add Inspect toggle + expanded OutputData. Panel closes on day switch via `useEffect([dayDate])`. 673 tests pass.


### AUD-056 — Studio status bar + cost anomaly badges
- **Source**: Studio UX redesign plan §3e, §3i, §3j
- **Severity**: LOW
- **Type**: UX roadmap
- **Problem**: Studio has no run progress visibility, no tick/auto-run/resume controls, and no cost anomaly detection.
- **Decision**: Implement bottom status bar with progress + controls; add cost anomaly badges to day sidebar
- **Planned PR**: `feat/AUD-056-studio-status-bar`
- **Acceptance checks**:
  - Status bar shows segmented progress bar + counters (succeeded/failed/total/cost).
  - Tick button processes a job, status bar updates via `refreshRun()`.
  - Auto-run imports `startAutoRunLoop` from existing hook — no duplication.
  - Auto-run starts → polling stops; auto-run stops → polling resumes (if non-terminal).
  - Manual Tick disabled during auto-run.
  - Resume button visible when `run.progress.failed > 0`; requeues failed jobs.
  - Terminal runs (`completed`, `cancelled`, `failed`) disable all buttons and stop all refresh.
  - Cost anomaly badges: amber `$` on days with `costUsd > 2 * median` (≥3 succeeded costs with costUsd > 0).
  - Unit test for `getMedianCost` + anomaly threshold logic.
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Created `StatusBar.tsx` (segmented progress bar, tick/auto-run/resume controls using existing hooks). Updated `page.tsx` with `refreshRun()`, `usePolling`, anomaly detection via `useMemo`. Added `anomaly.ts` pure functions (`getMedianCost`, `getAnomalousDays`) + amber `$` badges on `DaySidebar`. 12 unit tests (685 total).


### AUD-057 — Journal-friendly summarize prompt versions (seed data)
- **Source**: Studio UX redesign plan §4
- **Severity**: LOW
- **Type**: UX roadmap
- **Problem**: The only summarize prompt (`v1`) produces report-style output. Need journal-friendly alternatives.
- **Decision**: Add 3 inactive PromptVersion rows via seed upsert (`journal_v1`, `journal_v2`, `journal_v3`)
- **Planned PR**: `feat/AUD-057-journal-prompt-versions`
- **Acceptance checks**:
  - `npx prisma db seed` succeeds without error.
  - Post-seed invariant validation passes (≤1 active per stage).
  - 3 new SUMMARIZE versions appear (all `isActive: false`).
  - Re-running seed is idempotent (no duplicates, no errors).
  - Existing `v1` (active) is unaffected.
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Added 3 journal-friendly PromptVersion upserts (`journal_v1`, `journal_v2`, `journal_v3`) to `prisma/seed.ts` under existing `default-summarizer` Prompt. All created with `isActive: false`. `update: { templateText }` allows re-seed to update text without touching `isActive`. Post-seed invariant check passes (1 active SUMMARIZE version unchanged).

### AUD-058 — Enforce spend caps during summarize/tick execution
- **Source**: README accuracy audit 2026-02-11
- **Severity**: HIGH
- **Type**: Correctness / safety control gap
- **Code refs**: `src/lib/services/tick.ts`, `src/lib/services/summarizer.ts`, `src/lib/llm/budget.ts`, `src/lib/llm/config.ts`
- **Problem**: Spend caps are enforced in classify real mode but not in summarize/tick execution. In real mode, long runs can call providers without budget checks, which conflicts with the intended server-side spend guardrails.
- **Decision**: Fix code
- **Planned PR**: `fix/AUD-058-summarize-spend-cap-enforcement`
- **Acceptance checks**:
  - Budget checks run before every summarize LLM call in tick processing (single bundle and segmented paths).
  - Enforcement applies across the full run, not only per-segment.
  - Exceeded cap results in `BUDGET_EXCEEDED` with `retriable=false` on job failure payload.
  - Existing classify budget behavior remains unchanged.
  - Integration tests cover: within cap succeeds; cap exceeded in non-segmented flow; cap exceeded mid-segmentation.
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Two-phase budget enforcement in `processJob()` (tick.ts): pre-call `assertWithinBudget({nextCostUsd:0})` blocks if already exceeded; post-call check uses actual cost to stop remaining segments/jobs. `processTick()` queries existing run spend from DB and accumulates `tickSpentUsd` across jobs in one tick. 8 new integration tests in `tick-budget.test.ts` (→ 700 total).

### AUD-059 — Apply `LLM_MIN_DELAY_MS` rate limiting to summarize/tick path
- **Source**: README accuracy audit 2026-02-11
- **Severity**: MEDIUM
- **Type**: Operational safety / throttling gap
- **Code refs**: `src/lib/services/tick.ts`, `src/lib/services/summarizer.ts`, `src/lib/llm/rateLimit.ts`, `src/lib/llm/config.ts`
- **Problem**: Rate limiting is currently applied in classify real mode, but summarize/tick calls can execute back-to-back without honoring `LLM_MIN_DELAY_MS`.
- **Decision**: Fix code
- **Planned PR**: `fix/AUD-059-summarize-rate-limit`
- **Acceptance checks**:
  - Summarize provider calls are serialized through `RateLimiter` using configured `LLM_MIN_DELAY_MS`.
  - Delay enforcement applies across multiple jobs in one tick and across segments within a job.
  - `LLM_MIN_DELAY_MS=0` preserves no-delay behavior.
  - Tests verify delay enforcement with fake clock and no-delay mode.
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: `RateLimiter` created in `processTick()` with `getMinDelayMs()`, shared across all jobs in one tick, passed into `processJob()` context. Non-stub models call `rateLimiter.acquire()` before each `summarize()` (both single-bundle and segmented paths). Ordering: rate limit → budget check → summarize. 5 new integration tests in `tick-rate-limit.test.ts` (→ 702 total).

### AUD-060 — Correct `LLM_MAX_USD_PER_DAY` semantics to calendar-day spend
- **Source**: README accuracy audit 2026-02-11
- **Severity**: HIGH
- **Type**: Contract / semantics bug
- **Code refs**: `src/lib/llm/budget.ts`, `src/lib/services/classify.ts`, `src/lib/services/tick.ts`
- **Problem**: Current `per_day` budget checks reuse a generic running spend total, so "per day" is not enforced as actual calendar-day spend. This can over-block or under-block depending on run shape and duration.
- **Decision**: Fix code + align explicit semantics in docs/spec as needed
- **Planned PR**: `fix/AUD-060-true-per-day-budget`
- **Acceptance checks**:
  - Budget guard accepts distinct run-level and day-level spend inputs.
  - `LLM_MAX_USD_PER_DAY` compares against spend accumulated for the same calendar day only.
  - Day boundary behavior is deterministic and documented (timezone basis explicitly defined).
  - Tests verify per-day reset behavior and independence from per-run cap.
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Split `BudgetCheckInput.spentUsdSoFar` into `spentUsdRunSoFar` + `spentUsdDaySoFar`. New `budget-queries.ts` provides `getCalendarDaySpendUsd()` which sums Job + ClassifyRun `costUsd` for the UTC calendar day. `tick.ts` and `classify.ts` both query day spend at start and pass both dimensions to `assertWithinBudget()`. Day boundary uses UTC (deterministic). 17 budget unit tests (5 new independence tests) + 7 integration tests for day-spend query (→ 710 total).

### AUD-061 — Docs reckoning: archive stale docs, fix volatile facts, slim ACCEPTANCE
- **Source**: Doc drift audit 2026-02-12
- **Severity**: LOW
- **Type**: Doc drift
- **Problem**: CONTEXT_PACK.md cites 616 tests (actual: 710), UX_SPEC.md §8 status markers lag behind completed AUDs, EXECUTION_PLAN.md is fully historical, ACCEPTANCE.md restates SPEC requirements verbatim.
- **Decision**: Fix docs — archive EXECUTION_PLAN.md, fix volatile facts, slim ACCEPTANCE.md, add README docs table
- **Planned PR**: `docs/AUD-061-docs-reckoning`
- **Acceptance checks**:
  - EXECUTION_PLAN.md archived to `docs/archive/`; root file is redirect stub.
  - CONTEXT_PACK.md test count is dated and has reproduction command; no other doc contains test counts.
  - UX_SPEC.md §8 status markers reflect completed AUDs.
  - ACCEPTANCE.md contains commands + checklists only; no restated requirements.
  - README.md has navigational docs table (no volatile claims).
  - `npx vitest run` passes.
- **Status**: Done
- **Resolution**: Archived EXECUTION_PLAN.md to `docs/archive/`; fixed CONTEXT_PACK.md test count (616→710, dated, with reproduction command); updated 7 UX_SPEC.md §8 status markers; slimmed ACCEPTANCE.md to procedural-only (removed restated requirements + pseudo-code, added SPEC §11 cross-refs); added navigational docs table to README.md.

---

### AUD-062 — V1 export renderer + SPEC §14 + ADR-015/016
- **Type**: New feature
- **Priority**: P1
- **Decision**: Implement
- **Description**: Pure TypeScript renderer that converts structured Run data into an in-memory file tree (`Map<string, string>`). Produces `README.md` (static), `views/timeline.md` (navigation index), `views/YYYY-MM-DD.md` (per-day summaries with provenance frontmatter), `.journal-meta/manifest.json` (machine-readable metadata). No DB, no filesystem I/O.
- **Acceptance checks**:
  - `renderExportTree` returns Map with keys: `README.md`, `views/timeline.md`, `views/YYYY-MM-DD.md` (per day), `.journal-meta/manifest.json`
  - Golden fixture: exact string equality for all 5 files against inline expected values
  - Determinism: calling `renderExportTree` twice with identical input produces byte-identical output
  - Byte stability: trailing newline, no CRLF, no trailing whitespace on any line
  - View frontmatter field order: date, model, runId, createdAt, bundleHash, bundleContextHash, segmented, segmentCount (if segmented)
  - exportedAt isolation: changing exportedAt changes ONLY manifest.json
  - Timeline determinism: newest-first, no timestamps, byte-identical for same set of days
  - Timeline >14 days: renders Recent (14) + All entries sections
  - Manifest hash integrity: sha256(file content) matches manifest hashes
  - Empty run: zero days → README + timeline (empty) + manifest
  - §14 added to SPEC.md
  - ADR-015 + ADR-016 added to DECISIONS.md
  - `npx vitest run` passes (all existing + new tests)
- **Status**: Done
- **Resolution**: Added pure export renderer (`src/lib/export/{types,helpers,renderer}.ts`) with 28 golden fixture + determinism + byte-stability tests. SPEC §14 (Git Export) added with §14.1–§14.9. ADR-015 (export as post-processing read) and ADR-016 (hand-rendered YAML frontmatter) added to DECISIONS.md. Renderer produces `README.md` (static), `views/timeline.md` (navigation index), `views/YYYY-MM-DD.md` (per-day summaries with provenance frontmatter), `.journal-meta/manifest.json` (metadata + file hashes). No DB, no filesystem I/O.

### AUD-063 — Export DB orchestrator (buildExportInput)
- **Source**: AUD-062 follow-on (plan v3)
- **Severity**: MEDIUM
- **Type**: New feature
- **Priority**: P1
- **Decision**: Implement
- **Description**: Service function that loads a COMPLETED Run from the DB, validates §14.7 preconditions (Run COMPLETED, all Jobs SUCCEEDED, each Job has exactly 1 SUMMARIZE output), maps DB records to `ExportInput`, and returns it for the pure renderer.
- **Acceptance checks**:
  - `buildExportInput(runId, exportedAt)` returns correctly shaped `ExportInput` from DB records
  - Run fields mapped from Run + configJson.filterProfileSnapshot + configJson.timezone
  - Batches from RunBatch→ImportBatch (source lowercased)
  - Days from Jobs ordered by dayDate ASC, each with outputText, createdAt ISO, bundleHash, bundleContextHash, segmented/segmentCount
  - exportedAt passed through unchanged
  - Unknown runId → ExportPreconditionError code EXPORT_NOT_FOUND
  - Run.status !== COMPLETED → EXPORT_PRECONDITION with details.runStatus
  - Any Job.status !== SUCCEEDED → EXPORT_PRECONDITION with details.failedJobs
  - SUCCEEDED job with 0 SUMMARIZE outputs → EXPORT_PRECONDITION
  - Empty run (0 jobs, COMPLETED) → empty days array, no error
  - `npx vitest run` passes (all existing + new tests)
- **Status**: Done
- **Resolution**: Added `src/lib/export/orchestrator.ts` with `buildExportInput()` + `ExportPreconditionError`. Single Prisma query with nested includes (Run→RunBatch→ImportBatch, Run→Jobs→Outputs). 12 integration tests in `src/lib/services/__tests__/export-orchestrator.test.ts` covering happy path, field mapping, precondition failures, and data integrity.

### AUD-064 — Filesystem writer (writeExportTree)
- **Source**: Export pipeline (§14)
- **Severity**: MEDIUM
- **Type**: New feature
- **Priority**: P1
- **Decision**: Implement
- **Description**: Takes an `ExportTree` (Map<string, string>) and writes it to a directory on disk. Creates directories as needed, writes UTF-8 with LF endings. Pure I/O layer — no DB, no rendering logic.
- **Acceptance checks**:
  - `writeExportTree(tree, outputDir)` creates all files with correct content
  - Creates intermediate directories as needed
  - Overwrites existing files (idempotent re-export)
  - Unit tests with temp directories
  - `npx vitest run` passes
- **Status**: Done
- **Resolution**: Added `src/lib/export/writer.ts` with `writeExportTree()`. 6 unit tests in `src/__tests__/export-writer.test.ts` covering file writes, intermediate directories, idempotent overwrite, empty tree, UTF-8, and deep nesting.

### AUD-065 — Export API endpoint
- **Source**: Export pipeline (§14)
- **Severity**: MEDIUM
- **Type**: New feature
- **Priority**: P1
- **Decision**: Implement
- **Description**: `POST /api/distill/runs/:id/export` route that calls `buildExportInput()` → `renderExportTree()` → `writeExportTree()`, returns export metadata. Maps `ExportPreconditionError` to appropriate HTTP status codes (EXPORT_NOT_FOUND → 404, EXPORT_PRECONDITION → 400).
- **Acceptance checks**:
  - POST triggers full export pipeline and returns success response
  - EXPORT_NOT_FOUND → 404 with standard error body
  - EXPORT_PRECONDITION → 400 with standard error body
  - Integration tests covering happy path + error cases
  - `npx vitest run` passes
- **Status**: Done
- **Resolution**: Added `POST /api/distill/runs/:runId/export` route. Wires `buildExportInput()` → `renderExportTree()` → `writeExportTree()`. Returns `{ exportedAt, outputDir, fileCount, files }`. Maps `ExportPreconditionError` to 404/400. 6 integration tests covering happy path, error codes, validation, and idempotent re-export.

### AUD-066 — Atoms export (v2, §14.1 follow-on)
- **Source**: SPEC §14.1 follow-on directories
- **Severity**: LOW
- **Type**: New feature
- **Priority**: P2
- **Decision**: Implement
- **Description**: Add `atoms/YYYY-MM-DD.md` per-day source atoms (user role only, §9.1 ordering) to the export tree. Requires extending `ExportInput` with atom data and adding a new renderer section.
- **Acceptance checks**:
  - `atoms/YYYY-MM-DD.md` files rendered for each day
  - Contains only user-role atoms in §9.1 ordering
  - Determinism contract maintained (byte-identical output)
  - Golden fixture updated
  - `npx vitest run` passes
- **Status**: Done
- **Resolution**: Added `ExportAtom` type, optional `atoms` field on `ExportDay`, `renderAtomsFile()` in renderer, atom-loading query in orchestrator (user-only, §9.1 sort, cross-batch dedup). 11 new tests (6 renderer + 5 orchestrator) → 776 total.

### AUD-067 — Sources metadata (v2, §14.1 follow-on)
- **Source**: SPEC §14.1 follow-on directories
- **Severity**: LOW
- **Type**: New feature
- **Priority**: P2
- **Decision**: Implement
- **Description**: Add `sources/<slug>.md` one per ImportBatch to the export tree. Provides source-level metadata (original filename, import source, timezone, atom counts).
- **Acceptance checks**:
  - `sources/<slug>.md` files rendered for each ImportBatch
  - Slug derived from ImportBatch fields (deterministic)
  - Determinism contract maintained
  - Golden fixture updated
  - `npx vitest run` passes
- **Status**: Done
- **Resolution**: Added `renderSourceFile()` + `generateSourceSlugs()` to renderer.ts. Slug = `{source}-{filename_sans_ext}`, sanitized to lowercase alphanumeric+hyphens, collision suffix `-2`, `-3`. Frontmatter: batchId, source, originalFilename, timezone. 9 new tests (785 total). No type/orchestrator changes needed — ExportBatch already had all data.

### AUD-068 — Privacy tiers (§14.8)
- **Source**: SPEC §14.8
- **Severity**: LOW
- **Type**: New feature
- **Priority**: P2
- **Decision**: Implement
- **Description**: Support Public vs Private export modes. Public: only `views/` + `README.md` + manifest (no raw text). Private (default): full tree including `atoms/` and `sources/`. FilterProfile already excludes sensitive categories; export inherits this.
- **Acceptance checks**:
  - Public mode omits atoms/ and sources/ directories
  - Private mode includes full tree
  - Default is Private
  - `npx vitest run` passes
- **Status**: Done
- **Resolution**: `PrivacyTier` type on `ExportInput`; renderer single switch point skips atoms/sources for public; orchestrator + route accept optional `privacyTier` param. 10 new tests (8 renderer + 2 route). 795 tests pass.

### AUD-069 — CI determinism guard
- **Source**: §14.4 determinism contract
- **Severity**: LOW
- **Type**: Test/infra
- **Priority**: P2
- **Decision**: Implement
- **Description**: CI check that re-exporting the same Run with the same `exportedAt` produces byte-identical output. Guards against accidental non-determinism in the renderer (locale, timezone, floating-point, etc.).
- **Acceptance checks**:
  - Test or CI step that exports twice and asserts byte equality
  - Covers all file types (README, views, timeline, manifest)
  - `npx vitest run` passes
- **Status**: Done
- **Resolution**: `src/__tests__/export-determinism.test.ts` — 3 tests: byte-identical output via SHA-256 comparison, file-type coverage assertion, manifest hash consistency check. 765 tests pass.

### AUD-070 — Extract shared formatDate() utility
- **Source**: Code duplication (5 copies across run.ts, tick.ts, import.ts, search.ts, orchestrator.ts)
- **Severity**: LOW
- **Type**: Refactor
- **Priority**: P2
- **Decision**: Implement
- **Description**: Extract the `formatDate(d: Date): string` utility (UTC-safe YYYY-MM-DD formatting) into a shared module. Replace all 5 copies with imports from the shared location.
- **Acceptance checks**:
  - Single `formatDate()` in a shared module (e.g., `src/lib/date-utils.ts`)
  - All 5 call sites import from shared module
  - No duplicate implementations remain
  - All existing tests still pass
  - `npx vitest run` passes
- **Status**: Done
- **Resolution**: Created `src/lib/date-utils.ts` with shared `formatDate()`. Replaced 5 local implementations in run.ts, tick.ts, import.ts, search.ts, orchestrator.ts with imports. No behavior change.

### AUD-071 — Shared RunConfig Type + parseRunConfig()
- **Source**: Merged audit (Claude + Codex)
- **Severity**: MEDIUM
- **Type**: Refactor
- **Priority**: P1
- **Decision**: Implement
- **Description**: Replace all inline `configJson as unknown as { ... }` casts with a single `RunConfig` interface and a `parseRunConfig(json: unknown): RunConfig` validation function. One type, one parse point, compile-time safety when the config shape changes. Delete the local `RunConfig` interface in `orchestrator.ts`.
- **Allowed files**: `src/lib/types/run-config.ts` (new), `src/lib/services/tick.ts`, `src/lib/services/run.ts`, `src/lib/services/search.ts`, `src/lib/export/orchestrator.ts`, `src/app/api/distill/runs/[runId]/route.ts`, `src/app/api/distill/runs/[runId]/jobs/[dayDate]/input/route.ts`
- **Acceptance checks**:
  - `parseRunConfig()` throws on missing required fields (unit test)
  - `parseRunConfig()` passes through optional fields (`pricingSnapshot`, `importBatchIds`) when present (unit test)
  - All existing tests pass unchanged (no behavioral change)
  - `grep -rn 'configJson as' src/lib/ src/app/` returns zero hits in production code
  - `npx tsc --noEmit` passes
  - Local `RunConfig` interface deleted from `orchestrator.ts`
- **Status**: Done
- **Resolution**: Created `src/lib/types/run-config.ts` with shared `RunConfig` interface and `parseRunConfig()` validator. Replaced 6 production `configJson as` casts and deleted 2 local `RunConfig` interfaces. 14 new unit tests. Fixed pre-existing test fixture typo (`filterProfile` → `filterProfileSnapshot` in search.test.ts).

### AUD-072 — Test Fixture Factory Extraction
- **Source**: Merged audit (Codex)
- **Severity**: LOW
- **Type**: Refactor
- **Priority**: P2
- **Decision**: Implement
- **Description**: Extract 6+ inline `createTestExport()` / `createChatGptExport()` into shared `src/__tests__/fixtures/export-factories.ts`.
- **Acceptance checks**:
  - Shared factory file exists with all extracted helpers
  - All existing tests still pass
  - `npx vitest run` passes
- **Status**: Done
- **Resolution**: Created `src/__tests__/fixtures/export-factories.ts` with shared `createTestExport()`. Replaced 6 inline copies across classify, classify-real, import, classify-progress, classify-stats, classify-audit-trail test files. No behavior change.

### AUD-073 — Typed Service Errors: Shared Classes + run.ts + Run Routes
- **Source**: Merged audit (Claude + Codex)
- **Severity**: MEDIUM
- **Type**: Refactor
- **Priority**: P1
- **Decision**: Implement
- **Description**: Create shared typed error classes (`ServiceError`, `NotFoundError`, `InvalidInputError`, `NoEligibleDaysError`, `ConflictError`) and migrate `run.ts` (8 string-throw sites) and its route handlers to use `instanceof` instead of `message.includes()` / `message.startsWith()`. Move `InvalidInputError` from `classify.ts` to shared `errors.ts`; add re-export for backward compat.
- **Allowed files**: `src/lib/errors.ts` (new), `src/lib/services/run.ts`, `src/app/api/distill/runs/route.ts`, `src/app/api/distill/runs/[runId]/cancel/route.ts`, `src/app/api/distill/runs/[runId]/resume/route.ts`, `src/app/api/distill/runs/[runId]/reset/route.ts`, `src/lib/services/classify.ts` (re-export only)
- **Acceptance checks**:
  - All existing error-path tests pass with identical HTTP status codes and `error.code` values
  - `grep -rn 'message\.includes\|message\.startsWith' src/app/api/distill/runs/` returns zero hits
  - New unit tests for error classes
  - `classify.ts` still exports `InvalidInputError` (re-export); existing classify route tests pass
- **Status**: Done
- **Resolution**: Created `src/lib/errors.ts` with `ServiceError`, `InvalidInputError`, `NotFoundError`, `NoEligibleDaysError`, `ConflictError`. Migrated 18 string-throw sites in `run.ts` and all 14 `message.includes`/`startsWith` checks in 4 run route handlers to `instanceof`. Re-exported `InvalidInputError` from `classify.ts` for backward compat. 18 new unit tests for error classes. All 831 tests pass. Note: `tick/route.ts` retains 1 `message.includes` hit — deferred to AUD-074. Note: REMEDIATION allowlist path for reset route should be `runs/[runId]/jobs/[dayDate]/reset/route.ts`.

### AUD-074 — Typed Service Errors: Tick, Classify, Advisory Lock + Remaining Routes
- **Source**: Merged audit (Claude + Codex)
- **Severity**: MEDIUM
- **Type**: Refactor
- **Priority**: P1
- **Decision**: Implement
- **Description**: Complete typed error migration for all remaining service→route boundaries. Add `TickInProgressError` to `errors.ts`. Replace ad-hoc error code casting in `advisory-lock.ts`. Migrate `tick/route.ts` and `classify/route.ts` from string matching to `instanceof`. Optionally add `handleServiceError()` in `api-utils.ts`.
- **Allowed files**: `src/lib/errors.ts`, `src/lib/services/tick.ts`, `src/lib/services/advisory-lock.ts`, `src/lib/services/classify.ts`, `src/app/api/distill/runs/[runId]/tick/route.ts`, `src/app/api/distill/classify/route.ts`, `src/lib/api-utils.ts`
- **Acceptance checks**:
  - `grep -rn 'message\.includes\|message\.startsWith' src/app/api/` returns zero hits across ALL route files
  - `grep -rn 'as Error &.*code' src/lib/` returns zero hits
  - `TickInProgressError` used in `advisory-lock.ts`; `tick/route.ts` handles it via `instanceof`
  - All existing error-path tests pass with identical HTTP status codes
- **Status**: Done
- **Resolution**: Added `TickInProgressError` to `errors.ts`. Migrated `advisory-lock.ts` to throw it (removing `as Error & { code }` cast). Migrated `tick.ts` and `classify.ts` to throw `NotFoundError`. Replaced `message.includes` in `tick/route.ts` and `classify/route.ts` with `instanceof` dispatch. All 831 tests pass, zero `message.includes`/`startsWith` hits in classify+tick routes, zero `as Error &` casts in `src/lib/`. Note: `import/route.ts` has 3 remaining `message.includes` hits — filed as AUD-085.

### AUD-075 — Cost Overwrite Correctness Fix (Segmented Jobs)
- **Source**: Merged audit (Claude exploration)
- **Severity**: HIGH
- **Type**: Correctness fix
- **Priority**: P0
- **Decision**: Implement
- **Description**: Fix bug where `tick.ts:334-337` unconditionally overwrites accumulated actual segment costs with a pricing-snapshot estimate. Change to fallback: only apply when `totalCostUsd === 0`. After this fix, `Job.costUsd` for segmented jobs reflects the sum of actual per-segment costs from the provider.
- **Allowed files**: `src/lib/services/tick.ts` (~L334-337), `src/__tests__/services/tick*.test.ts` (new tests only)
- **Acceptance checks**:
  - New test: 3-segment job, each segment returns `costUsd = 0.01` → `Job.costUsd = 0.03`
  - New test: non-segmented job → `Job.costUsd` equals provider-reported cost
  - Fallback test: `totalCostUsd === 0` + pricingSnapshot + non-stub → estimate from snapshot
  - All existing tick tests pass unchanged
- **Status**: Done
- **Resolution**: Added `&& totalCostUsd === 0` guard to pricing snapshot block in tick.ts (line 324). Updated existing overwrite test to assert corrected semantics. Added 3 new tests: segmented cost preservation, non-segmented provider cost, and zero-cost snapshot fallback.

### AUD-076 — Budget Guard Consolidation
- **Source**: Merged audit (Claude + Codex)
- **Severity**: HIGH
- **Type**: Correctness fix
- **Priority**: P0
- **Decision**: Implement
- **Description**: Reduce budget bypass paths. Policy: throw `UnknownModelPricingError` in real mode (no silent $0). Replace classify's hardcoded `0.001` estimate with pricing-book-derived value. Add post-call budget check in classify loop. Optionally add `createBudgetSession()` helper.
- **Allowed files**: `src/lib/llm/budget.ts`, `src/lib/llm/client.ts`, `src/lib/services/classify.ts`, `src/lib/services/tick.ts`, `src/__tests__/`
- **Acceptance checks**:
  - New test: classify loop cost exceeding budget → stops processing further atoms
  - New test: `callLlm()` real mode + unknown model → throws `UnknownModelPricingError`
  - `grep -rn '0\.001' src/lib/services/classify.ts` returns zero hits
  - Existing budget tests in tick pass unchanged
- **Status**: Done
- **Resolution**: `callLlm()` real mode now propagates `UnknownModelPricingError` (no silent $0). Classify pre-call estimate derived from pricing book via `getRate()`. Post-call `assertWithinBudget()` added after cost accumulation. Tick budget behavior unchanged. 813 tests pass.

### AUD-077 — Multi-Batch Identity Canonicalization
- **Source**: Merged audit (Codex)
- **Severity**: LOW
- **Type**: Refactor
- **Priority**: P1
- **Decision**: Implement
- **Description**: Add `importBatchIds: string[]` to `getRun()` return value (sourced from `RunBatch` junction). Fix run detail page classify stats query to use canonical source. Do NOT drop `Run.importBatchId` column.
- **Allowed files**: `src/lib/services/run.ts`, `src/app/distill/runs/[runId]/page.tsx`, `src/app/api/distill/runs/[runId]/route.ts`
- **Acceptance checks**:
  - `getRun()` return type includes `importBatchIds: string[]` from RunBatch
  - `npx tsc --noEmit` passes (catch type ripple)
  - `grep -rn 'run\.importBatchId[^s]' src/app/ src/lib/services/` — count decreases
  - Existing multi-batch tests pass
- **Status**: Done
- **Resolution**: `getRun()` now includes `runBatches` (ordered by importBatchId asc) and returns `importBatchIds: string[]`. All three allowed files derive `importBatchId` from the RunBatch junction with a defensive `?? run.importBatchId` fallback. Run detail page classify stats and display both use canonical `importBatchIds`. 831 tests pass, no new TS errors.

### AUD-078 — Test Harness DB Preflight + Teardown
- **Source**: Merged audit (Claude + Codex)
- **Severity**: MEDIUM
- **Type**: Test harness
- **Priority**: P0
- **Decision**: Implement
- **Description**: Add vitest `globalSetup` (raw `pg` connectivity check, fails fast with actionable message) and `globalTeardown` (calls `closeLockPool()` from `advisory-lock.ts`). Today a missing DB produces hundreds of cascading errors.
- **Allowed files**: `vitest.config.ts`, `src/__tests__/global-setup.ts` (new), `src/__tests__/global-teardown.ts` (new)
- **Acceptance checks**:
  - With DB running: `npx vitest run` passes all existing tests
  - With DB stopped: single clear failure mentioning `DATABASE_URL` / Postgres
  - Advisory lock pool closed after suite (no leaked pg connections)
  - `grep -r 'globalSetup\|globalTeardown' vitest.config.ts` shows both configured
- **Status**: Done
- **Resolution**: Added `globalSetup` (raw pg connectivity check with 5s timeout, actionable error) and `globalTeardown` (closes advisory lock pool). Wired both in `vitest.config.ts`.

### AUD-079 — Orchestration Decomposition (tick.ts / classify.ts)
- **Source**: Merged audit (Codex)
- **Severity**: MEDIUM
- **Type**: Refactor
- **Priority**: P1
- **Decision**: Defer
- **Description**: Extract pure state-transition logic and LLM execution loops from `tick.ts` (494 LOC) and `classify.ts` (939 LOC) into smaller, independently testable modules. Depends on AUD-073/074/075/076 completing first.
- **Status**: Done
- **Resolution**: Thin slice — extracted `determineRunStatus` into `src/lib/services/tick-logic.ts` with pure unit tests (9 cases); no behavior changes.

### AUD-080 — Import Scalability Batching
- **Source**: Merged audit (Codex)
- **Severity**: LOW
- **Type**: Refactor
- **Priority**: P2
- **Decision**: Defer
- **Description**: Chunk the large `IN (...)` dedupe query and `createMany` writes in `import.ts` to bound peak memory. No current failure reports.
- **Status**: Done
- **Resolution**: Chunked both dedupe `findMany` (IN clause) and `createMany` writes in `import.ts` with `IMPORT_CHUNK_SIZE=1000`. Added defensive `chunkArray<T>` helper (throws on size≤0). Single debug log line for diagnostics. 9 new unit tests for chunkArray. All 879 tests pass. No schema, API, or behavior changes.

### AUD-081 — Route Validation Helpers / Zod
- **Source**: Merged audit (Codex)
- **Severity**: LOW
- **Type**: Refactor
- **Priority**: P2
- **Decision**: Defer
- **Description**: Replace manual if/return validation chains in POST route handlers with schema-based validation. Depends on AUD-073/074 (clean error surfaces).
- **Status**: Done
- **Resolution**: Added `src/lib/route-validate.ts` with 6 lightweight helpers (requireField, requireXor, requireNonEmptyArray, validateNonEmptyArray, requireUniqueArray, requireDateFormat) returning `string | undefined`. Refactored POST /runs and POST /classify to use them. No Zod dependency added; no response-shape changes; all existing tests pass unchanged.

### AUD-082 — Export button on Run Detail page
- **Source**: Smoke test — Git export (AUD-062–068) not reachable from UI
- **Severity**: MEDIUM
- **Type**: UX roadmap
- **Priority**: P1
- **Decision**: Implement
- **Description**: Add an "Export" button to the `RunControls` section of the Run Detail page (`page.tsx`). Enabled only when `run.status === 'completed'`; disabled for queued/running/failed/cancelled. Calls existing `POST /api/distill/runs/:runId/export` with a user-editable `outputDir` (default `./exports/<runId>`, relative paths only) and a privacy tier selector (Private default / Public). Displays success (file count + path) or error (code + message) inline, following the tick/resume/cancel feedback pattern already in `RunControls`.
- **Allowed files**:
  - `src/app/distill/runs/[runId]/page.tsx` (UI control + handler)
  - `REMEDIATION.md` (this entry)
- **Acceptance checks**:
  - Export button visible in Run Controls when run status is `completed`
  - Button disabled + grayed when run is not `completed` (queued, running, failed, cancelled)
  - Clicking Export calls `POST /api/distill/runs/:runId/export` with `{ outputDir, privacyTier }`
  - Button shows "Exporting..." and is disabled during in-flight request (no double-click)
  - Success: inline message shows file count and output directory path
  - Failure: inline error shows error code + message (EXPORT_PRECONDITION, INVALID_INPUT, etc.)
  - Default outputDir is `./exports/<runId>` (editable text input)
  - UI rejects outputDir containing `..` or starting with `/` with an inline validation error (no API call made)
  - Privacy tier selector: Private (default) / Public, with hint text "Private includes user text; Public excludes atoms/sources."
  - `npx vitest run` passes (no test regressions)
  - **Smoke test**: Import a batch → classify → create + auto-run to completion → click Export → see success message with file count → verify files exist at outputDir
- **Stop rule**: If this requires new API routes, schema changes, or touching files outside the allowlist, STOP and create a new AUD.
- **Status**: Done
- **Resolution**: Added Export button + options panel to `RunControls` in run detail page. Button enabled only when `run.status === 'completed'`; shows "Exporting..." during in-flight. Editable `outputDir` (default `./exports/<runId>`, rejects `..` and absolute paths client-side). Privacy tier dropdown (Private/Public) with hint text. Success shows file count + path + expandable file list. Error shows code + message inline. Follows existing tick/resume/cancel feedback pattern. No new routes/schema. 795 tests pass.

> **Note — former AUD-083 (Export v2: Topic tracking + "diff of thinking")** was reclassified
> as an **EPIC / future direction**, not an actionable remediation entry.
> See **SPEC.md § "Future Work / Roadmap (Non-binding)"** → EPIC-083 for the current roadmap sketch.

### AUD-084 — Flaky test: listImportBatches pagination (cursor invalidation)
- **Source**: Continued flakiness despite AUD-054 fix; cursor-based page walk over shared `ImportBatch` table breaks when concurrent test cleanup deletes the cursor row
- **Severity**: MEDIUM
- **Type**: Test/infra
- **Code refs**: `src/__tests__/services/import.test.ts` — `supports pagination` test
- **Problem**: AUD-054 added a deterministic `orderBy` tiebreaker but the page-walk loop still used `page.nextCursor` which could reference a foreign row. When 10+ parallel test files concurrently insert/delete `ImportBatch` rows, the cursor row gets deleted between page fetches, causing Prisma to return an empty page and failing the `>=1` assertion (~20% failure rate).
- **Decision**: Restructure the test into two parts: (1) a cursor-free large-limit fetch to verify all 3 test batches are present and correctly ordered (immune to cursor invalidation), (2) a minimal 2-page pagination check to verify limit, cursor advancement, and no duplicates between adjacent pages.
- **Acceptance checks**:
  - `npx vitest run` passes reliably (20 consecutive runs, 0 flakes in this test)
  - Assertions remain meaningful: ordering, presence, limit, cursor advances, no duplicates
- **Status**: Done
- **Resolution**: Replaced the multi-page walk with a two-part test. Part 1 uses `limit: 200` (single fetch, no cursor) to find all 3 test batches and assert DESC ordering by `originalFilename`. Part 2 makes two back-to-back `limit: 2` fetches to verify pagination mechanics (limit respected, cursor defined/advances, no duplicate IDs between pages). 20 consecutive full-suite runs with 0 flakes (795 tests each).


### AUD-085 — Typed Service Errors: Import Route + Parsers
- **Source**: AUD-074 spillover
- **Severity**: MEDIUM
- **Type**: Refactor
- **Priority**: P2
- **Decision**: Implement
- **Description**: `src/app/api/distill/import/route.ts` still relies on brittle `message.includes(...)` checks for parser failures (e.g. "is not implemented", "No messages found", "must be an array"). Migrate parser throw sites to typed errors and replace the route’s string matching with `instanceof` dispatch, preserving existing HTTP statuses and `error.code` values.
- **Allowed files**:
  - `src/app/api/distill/import/route.ts`
  - `src/lib/parsers/index.ts`
  - `src/lib/parsers/chatgpt.ts`
  - `src/lib/parsers/claude.ts`
  - `src/lib/parsers/grok.ts`
  - `src/lib/errors.ts`
  - `src/lib/services/import.ts` _(scope expansion: "No messages found" throw)_
- **Acceptance checks**:
  - `grep -rn 'message\\.includes\\|message\\.startsWith' src/app/api/distill/import/` returns zero hits.
  - Import route still returns **400 INVALID_INPUT** for "No messages found" and "must be an array" parser failures (message text can change slightly but must remain user-actionable).
  - Import route still returns **400 INVALID_INPUT** for unsupported/unknown formats (was previously matched via "is not implemented").
  - All existing import route + parser tests pass.
  - `npx vitest run` passes.
- **Stop rule**: If this requires changing error response shape (fields/status/code) or touching files outside the allowlist, STOP and file a new AUD.
- **Status**: Done
- **Resolution**: Converted 5 throw sites from `new Error(...)` to `new InvalidInputError(...)` (chatgpt.ts, claude.ts, grok.ts, parsers/index.ts, services/import.ts). Rewrote route catch block: replaced 3 `message.includes()` branches with single `instanceof InvalidInputError` check. Also mapped `UnsupportedFormatError` → `INVALID_INPUT` (was `UNSUPPORTED_FORMAT`). Scope expanded to include `src/lib/services/import.ts` for "No messages found" throw. Side-effect fix: Grok validation errors now correctly return 400 (were 500 due to substring mismatch bug).

### AUD-086 — `determineRunStatus` returns QUEUED for all-cancelled jobs
- **Source**: SPEC.md §7.4.1
- **Severity**: HIGH
- **Type**: Correctness
- **Priority**: P0
- **Decision**: Fix code
- **Description**: SPEC §7.4.1 says: "When all jobs are terminal: if any job failed → failed; else if run was cancelled → cancelled; else → completed." The current `determineRunStatus()` function only looks at job counts and never checks the run's own status. When all jobs are cancelled (failed=0, succeeded=0), it falls through to `return 'QUEUED'` instead of `'CANCELLED'`. AUD-051 addressed other transition issues but this edge case remains.
- **Code refs**: `src/lib/services/tick-logic.ts:14-31`, `src/lib/services/tick.ts:84-87`
- **Planned PR**: fix/AUD-086-determine-run-status-cancelled
- **Acceptance checks**:
  - `determineRunStatus` accepts a `runStatus` parameter (or equivalent) so it can check "if run was cancelled"
  - When all jobs are cancelled and run status is CANCELLED, returns `'CANCELLED'`
  - When all jobs are cancelled and run status is not CANCELLED, returns `'QUEUED'` or fails explicitly
  - Tick guards all three terminal states (CANCELLED, COMPLETED, FAILED), not just CANCELLED
  - `npx vitest run src/__tests__/tick-logic` passes with new cases
  - `npx vitest run` — all tests pass
- **Stop rule**: If this requires changing the tick API contract or DB schema, STOP and file a separate AUD.
- **Status**: Done
- **Resolution**: `determineRunStatus` now accepts optional `runStatus` param; returns CANCELLED for all-cancelled when run is CANCELLED. Tick terminal guard expanded to CANCELLED/COMPLETED/FAILED (subsumes AUD-089). 3 new tests (1 unit, 2 integration).

### AUD-087 — `bundleContextHash` in bundle.ts diverges from SPEC and bundleHash.ts
- **Source**: SPEC.md §5.3, §4.1 (determinism)
- **Severity**: HIGH
- **Type**: Correctness / Determinism
- **Priority**: P0
- **Decision**: Fix code
- **Description**: Two competing implementations of `computeBundleContextHash` exist. The live production path in `bundle.ts:210-225` uses `JSON.stringify(filterProfile)` without sorted keys and accepts `filterProfile: { mode, categories }` (missing `name`). The standalone `bundleHash.ts:50-71` correctly uses `JSON.stringify(obj, Object.keys(obj).sort())` and includes `name` in `filterProfileSnapshot`. The live version is non-deterministic (key order depends on insertion order) and produces different hashes than the tested version due to the missing `name` field.
- **Code refs**: `src/lib/services/bundle.ts:210-225` (live, broken), `src/lib/bundleHash.ts:50-71` (correct, unused in production), `src/lib/services/bundle.ts:25-28` (options interface missing `name`)
- **Planned PR**: fix/AUD-087-bundle-context-hash-determinism
- **Acceptance checks**:
  - `bundle.ts` uses sorted-key JSON serialization for both `filterProfile` and `labelSpec`
  - `bundle.ts` includes `name` in the filterProfile hash input (matching `filterProfileSnapshot` semantics from SPEC §5.3/§6.8)
  - No duplicate `computeBundleContextHash` implementations exist (one canonical version)
  - `grep -r "computeBundleContextHash" src/` shows exactly one definition (plus tests)
  - `npx vitest run src/__tests__/bundle` passes
  - `npx vitest run` — all tests pass
- **Stop rule**: If existing stored hashes in the DB need migration, STOP and file a separate AUD for the data migration.
- **Status**: Done
- **Resolution**: `bundle.ts` now uses canonical `bundleHash.ts` implementation with sorted-key JSON serialization and `filterProfile.name` included. Multi-batch accounted for via `importBatchIds` array hashing. Local duplicate deleted. Forward-only: existing stored hashes are not migrated.

### AUD-088 — GET /runs/:runId response shape mismatches SPEC §7.9
- **Source**: SPEC.md §7.9 (POST /api/distill/runs response schema)
- **Severity**: HIGH
- **Type**: Contract break
- **Priority**: P0
- **Decision**: Fix code
- **Description**: The GET run detail route returns several fields in wrong format/case: (1) `sources` as DB-cased uppercase array (e.g., `["CHATGPT"]`) instead of SPEC lowercase `["chatgpt"]`; (2) `startDate` and `endDate` as raw JS Date objects (serialize to `"2024-01-15T00:00:00.000Z"`) instead of SPEC `"YYYY-MM-DD"` strings; (3) `importBatches[].source` as uppercase enum. The POST /runs creation response (`run.ts:getRun`) correctly formats these, but the GET route does its own Prisma query and skips the formatting.
- **Code refs**: `src/app/api/distill/runs/[runId]/route.ts:96` (importBatches source uppercase), `:99` (sources uppercase), `:100-101` (startDate/endDate raw Date)
- **Planned PR**: fix/AUD-088-get-run-response-shape
- **Acceptance checks**:
  - `sources` array contains lowercase strings (`.map(s => s.toLowerCase())`)
  - `startDate` and `endDate` are `"YYYY-MM-DD"` strings (use `formatDate()` from `src/lib/format.ts`)
  - `importBatches[].source` is lowercase
  - `npx vitest run` — all tests pass
- **Stop rule**: If this requires changing the UI to handle new response shapes, STOP and file a separate AUD.
- **Status**: Done
- **Resolution**: GET /runs/:runId now lowercases `sources`/`importBatches[].source` and formats `startDate`/`endDate` as YYYY-MM-DD via `formatDate()`; aligns with SPEC §7.9. No schema/API additions.

### AUD-089 — Tick does not guard COMPLETED/FAILED terminal states
- **Source**: SPEC.md §7.4.1, §6.8 (terminal states)
- **Severity**: MED
- **Type**: Correctness
- **Priority**: P1
- **Decision**: Fix code
- **Description**: SPEC §6.8 defines Run terminal states as `completed`, `cancelled`, `failed`. SPEC §7.4.1 says tick must not transition terminal runs. The tick handler (`tick.ts:84-87`) only guards against `CANCELLED` — if a `COMPLETED` or `FAILED` run receives a tick call, it proceeds to look for queued jobs. A FAILED run could still have remaining queued jobs. Processing them would violate the terminal status invariant.
- **Code refs**: `src/lib/services/tick.ts:84-87` (only checks CANCELLED)
- **Planned PR**: fix/AUD-089-tick-terminal-guard
- **Acceptance checks**:
  - Tick returns early (no-op) for all terminal statuses: CANCELLED, COMPLETED, FAILED
  - Test: calling tick on a FAILED run returns immediately with zero processed jobs
  - Test: calling tick on a COMPLETED run returns immediately with zero processed jobs
  - `npx vitest run src/__tests__/tick` passes
  - `npx vitest run` — all tests pass
- **Stop rule**: If fixing this requires changing how FAILED runs are resumed, STOP and file a separate AUD.
- **Status**: Not started

### AUD-090 — cancelRun/resumeRun incomplete terminal state guards
- **Source**: SPEC.md §6.8 (terminal states: completed, cancelled, failed), §7.6
- **Severity**: MED
- **Type**: Correctness
- **Priority**: P1
- **Decision**: Fix code
- **Description**: `cancelRun` checks for CANCELLED (idempotent) and COMPLETED (throws) but not FAILED. A failed run can be transitioned to cancelled, violating the terminal status invariant. `resumeRun` checks for CANCELLED (throws) but not COMPLETED. Calling resume on a completed run is a functional no-op (no failed jobs to requeue) but doesn't error — clients get a misleading `{ status: "completed", jobsRequeued: 0 }` instead of a clear rejection.
- **Code refs**: `src/lib/services/run.ts:443-454` (cancelRun missing FAILED check), `src/lib/services/run.ts:503-506` (resumeRun missing COMPLETED check)
- **Planned PR**: fix/AUD-090-terminal-state-guards
- **Acceptance checks**:
  - `cancelRun` on a FAILED run throws `ConflictError` with code `ALREADY_FAILED`
  - `resumeRun` on a COMPLETED run throws `ConflictError` with code `ALREADY_COMPLETED`
  - Existing behavior preserved: cancelRun on CANCELLED is idempotent, resumeRun on CANCELLED throws
  - `npx vitest run src/__tests__/run` passes
  - `npx vitest run` — all tests pass
- **Stop rule**: If the UX auto-run or dashboard depends on these being no-ops rather than errors, STOP and file a separate AUD.
- **Status**: Done
- **Resolution**: cancelRun now rejects FAILED with ConflictError(ALREADY_FAILED); resumeRun now rejects COMPLETED with ConflictError(ALREADY_COMPLETED). Existing test for resumeRun-on-COMPLETED changed from no-op assertion to ConflictError assertion. New test for cancelRun-on-FAILED added. 883 tests pass.

### AUD-091 — ConflictError uses HTTP 400 instead of SPEC 409
- **Source**: SPEC.md §7.8
- **Severity**: LOW
- **Type**: Contract break
- **Priority**: P1
- **Decision**: Fix code
- **Description**: SPEC §7.8 says "409 for concurrency conflicts." `TickInProgressError` correctly uses 409, but `ConflictError` (used for `ALREADY_COMPLETED` and `CANNOT_RESUME_CANCELLED`) uses HTTP 400. These are state-conflict errors — the class is named `ConflictError` yet returns the wrong status code.
- **Code refs**: `src/lib/errors.ts:49-53` (`ConflictError` class, `httpStatus: 400`)
- **Planned PR**: fix/AUD-091-conflict-error-409
- **Acceptance checks**:
  - `ConflictError` class uses `httpStatus: 409`
  - Cancel a completed run → HTTP 409 (not 400)
  - Resume a cancelled run → HTTP 409 (not 400)
  - `TickInProgressError` remains 409 (no change)
  - `npx vitest run` — all tests pass
  - `grep -n "httpStatus.*400" src/lib/errors.ts` does not match ConflictError
- **Stop rule**: If any UI code relies on 400 status for these errors, STOP and file a separate AUD.
- **Status**: Done
- **Resolution**: Changed `ConflictError` httpStatus from 400 to 409 in `src/lib/errors.ts`. Updated test assertion in `src/__tests__/errors.test.ts`. No route handler changes needed (all use generic `error.httpStatus` dispatch). No UI dependency on 400 for these errors.

### AUD-092 — Search atom results include importBatchId not in SPEC
- **Source**: SPEC.md §7.9 (GET /api/distill/search response schema)
- **Severity**: LOW
- **Type**: Contract break
- **Priority**: P1
- **Decision**: Fix spec
- **Description**: The search endpoint returns `importBatchId` inside atom result objects, but SPEC §7.9 search response schema does not include this field. The SPEC-defined atom shape is: `{ atomStableId, source, dayDate, timestampUtc, role, category, confidence }`. While extra fields don't break clients, this is a normative schema deviation. The field is useful for client navigation back to the import batch, so the fix is to update the SPEC rather than remove it.
- **Code refs**: `src/lib/services/search.ts:247` (returns `importBatchId: row.importBatchId`)
- **Planned PR**: fix/AUD-092-search-atom-schema
- **Acceptance checks**:
  - SPEC §7.9 search atom schema includes `importBatchId` field
  - Code and SPEC match
  - `npx vitest run src/__tests__/search` passes
  - `npx vitest run` — all tests pass
- **Stop rule**: If removing the field would break the search UI, fix spec instead.
- **Status**: Done
- **Resolution**: Added `importBatchId` to SPEC §7.9 search atom schema. Code already returns this field (`search.ts:247`); SPEC now matches.

---

## Notes

- When closing an entry, add a short "Resolution" bullet linking to the PR and stating what changed.
- If an entry is resolved by changing the spec (instead of code), record the rationale explicitly.
