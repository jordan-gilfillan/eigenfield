

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

> All entries (AUD-001 through AUD-034) are Done. See open entries below if new AUDs are added.

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

### Bucket C — Docs drift (P1)
- AUD-008
- AUD-009
- AUD-010
- AUD-011
- AUD-012
- AUD-013
- AUD-024
- AUD-025

### Bucket B+ — Contract alignment (P1)
- AUD-022
- AUD-023

### Bucket D — UX roadmap gaps (P2 unless explicitly promoted)
- AUD-014
- AUD-015
- AUD-016
- AUD-017
- AUD-018
- AUD-019

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

---

## Notes

- When closing an entry, add a short "Resolution" bullet linking to the PR and stating what changed.
- If an entry is resolved by changing the spec (instead of code), record the rationale explicitly.
