

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

1. **AUD-001** — Make tests green by resolving missing FTS columns (blocks signal from CI).
2. **AUD-002** — Fix advisory lock to guarantee acquire/release on the same DB session.
3. **AUD-003** — Include partial tokens/cost totals from failed jobs per SPEC.
4. **AUD-004** — Search results must include label-spec-derived atom metadata (category, confidence).
5. **AUD-005** — Run creation must allow optional labelSpec with server default selection.

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
- **Status**: Not started

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
- **Status**: Not started

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
- **Status**: Not started

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
- **Status**: Not started

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
- **Status**: Not started

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
- **Status**: Not started

### AUD-012 — CONTEXT_PACK: “576 excluding pre-existing search FTS column issue” is unexplained
- **Source**: Claude #6 (MEDIUM)
- **Severity**: MEDIUM
- **Type**: Doc drift
- **Docs cited**: CONTEXT_PACK.md
- **Problem**: Arithmetic doesn’t match current failing tests; lacks clear explanation.
- **Decision**: Fix docs; link to AUD-001 and describe the precise failure mode and resolution.
- **Planned PR**: `docs/context-pack-fts-note`
- **Acceptance checks**:
  - Note references AUD-001 and is numerically consistent
- **Status**: Not started

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
- **Status**: Not started

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
- **Status**: Not started

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
- **Status**: Not started

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
- **Status**: Not started

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
- **Status**: Not started

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
- **Status**: Not started

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
- **Status**: Not started

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
- **Status**: Not started

---

## Notes

- When closing an entry, add a short “Resolution” bullet linking to the PR and stating what changed.
- If an entry is resolved by changing the spec (instead of code), record the rationale explicitly.
