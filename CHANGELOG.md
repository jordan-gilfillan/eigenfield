# Changelog

All notable changes to Journal Distiller will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Phase 1: Foundation complete
  - Next.js 15 with App Router and TypeScript
  - Docker Compose with Postgres 16
  - Prisma ORM with full schema per SPEC.md Section 6
  - Vitest for unit testing
  - Core utilities: normalize, timestamp, hash, stableId, bundleHash, rawEntry, enums
  - Idempotent seed script with filter profiles and prompt versions

- Phase 2: Import Pipeline complete
  - ChatGPT export parser with full conversation.json support
  - `POST /api/distill/import` endpoint (multipart file upload)
  - `GET /api/distill/import-batches` endpoint (paginated list)
  - `GET /api/distill/import-batches/:id` endpoint
  - Import UI page (`/distill/import`) with file upload, source override, timezone selector
  - Deduplication safety via atomStableId (check-before-insert + skipDuplicates)
  - RawEntry materialization per (source, dayDate)
  - Dashboard placeholder page (`/distill`)

- Phase 3: Classification (stub mode) complete
  - `POST /api/distill/classify` endpoint with stub/real mode
  - Deterministic stub classifier (`stub_v1` algorithm per spec 7.2)
  - Label versioning: uniqueness on (messageAtomId, promptVersionId, model)
  - Idempotent classification (same labelSpec = skip already-labeled atoms)
  - Version isolation (different promptVersionId creates separate labels)
  - Seed updated: `classify_stub_v1` PromptVersion for classify stage
  - Dashboard UI: batch selector dropdown, auto-selects latest, classify button
  - `GET /api/distill/prompt-versions` endpoint for UI to fetch active prompts

- Phase 4: Run Execution (minimal slice) complete
  - Run service with config freezing (promptVersionIds, labelSpec, filterProfileSnapshot, timezone, maxInputTokens)
  - `POST /api/distill/runs` endpoint (creates run with frozen config, jobs for eligible days)
  - `GET /api/distill/runs` endpoint (paginated list)
  - `GET /api/distill/runs/:runId` endpoint (run details with progress)
  - `POST /api/distill/runs/:runId/tick` endpoint (processes queued jobs)
  - Bundle construction utility (`src/lib/services/bundle.ts`)
    - Deterministic ordering: source ASC, timestampUtc ASC, role ASC, atomStableId ASC
    - bundleHash and bundleContextHash per spec 5.3
    - Category filtering (INCLUDE/EXCLUDE modes)
  - Advisory lock mechanism (`src/lib/services/advisory-lock.ts`)
    - Postgres pg_try_advisory_lock for tick concurrency control
    - Automatic lock release with withLock() helper
  - Tick service (`src/lib/services/tick.ts`)
    - Processes N=1 job per tick (configurable)
    - Builds bundle, calls summarizer, stores Output
    - Updates job status and run progress
  - Stub summarizer (`src/lib/services/summarizer.ts`)
    - Deterministic stub mode for testing (models starting with "stub")
    - Token estimation (chars/4 heuristic)
    - Ready for real LLM integration
  - 156 tests passing (unit + integration)
  - **Gate passed**: one day through the machine end-to-end (stub mode)

- Documentation suite
  - `GLOSSARY.md`: Terms and definitions used throughout the codebase
  - `DECISIONS.md`: Architecture Decision Records (ADRs) explaining design choices
  - `ACCEPTANCE.md`: Testable acceptance criteria and verification steps
  - Updated `SPEC.md` to align response schemas with implementation

### Planned (Phase 3b: Real Classification)
- Real classification with LLM integration (mode="real")
- Reuses LLM plumbing from Phase 4
- Rate limiting to prevent wallet-fire
- **Gate**: classify with mode="real" works, labels written with correct labelSpec

### Planned (Phase 4 continued)
- Segmentation for large bundles
- Resume/Cancel/Reset endpoints

### Planned (Phase 5: UI Shell)
- Dashboard with run creation
- Run detail page with job table
- Sequential polling implementation
- Output viewer (rendered markdown)

### Planned (Phase 6: Search + Inspector)
- Postgres FTS indexes on MessageAtom.text and Output.outputText
- `GET /api/distill/search` endpoint
- Search UI with tabs (Raw / Outputs)
- Import inspector (day list, per-day message view)
- Run inspector (input/output side-by-side)

### Planned (Phase 7: Additional Parsers)
- Claude export parser
- Grok export parser
- Parser auto-detection

---

## Version History

### v0.3.0-draft (In Progress)
- Initial implementation based on SPEC.md v0.3.0-draft
- Target: auditable, reproducible curated datasets from AI conversation exports

### Pre-v0.3 (Legacy)
- Previous iterations had issues with:
  - Non-determinism in stable IDs
  - Silent data loss from unsafe deduplication
  - Unpinned prompt/label versions
  - Polling pile-ups from concurrent ticks
- These issues are addressed in the v0.3 spec rewrite
