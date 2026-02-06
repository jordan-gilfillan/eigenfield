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
    - Deterministic ordering: source ASC, timestampUtc ASC, role ASC (user before assistant), atomStableId ASC
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

- Phase 4 continued: Segmentation + Run Controls complete
  - Deterministic segmentation (`segmenter_v1`) per spec 9.2
    - Greedy packing: fills segments until maxInputTokens exceeded
    - Never splits atoms across segments
    - Stable segment IDs: `sha256("segment_v1|" + bundleHash + "|" + index)`
    - Segment metadata stored in `Output.outputJson.meta` (segmentCount, segmentIds)
    - Concatenates segment summaries with `## Segment <k>` headers
  - Run controls (cancel/resume/reset) per spec 7.6-7.7
    - `POST /api/distill/runs/:runId/cancel` — marks run + queued jobs as CANCELLED
    - `POST /api/distill/runs/:runId/resume` — requeues FAILED jobs, sets run to QUEUED
    - `POST /api/distill/runs/:runId/jobs/:dayDate/reset` — deletes outputs, increments attempt, requeues job
  - Terminal status rule enforced: cancelled runs cannot transition to other states
  - 190 tests passing (34 new tests for segmentation + run controls + idempotency)
  - **Gate passed**: segmentation determinism verified, run controls work as intended

- Phase 5 UI Shell - PR-5.1: Run detail page + frozen config
  - `/distill/runs/:runId` page route
  - Frozen config block displaying values exactly as stored in `Run.configJson`:
    - `promptVersionIds` (summarize)
    - `labelSpec` (model, promptVersionId)
    - `filterProfileSnapshot` (name, mode, categories)
    - `timezone`
    - `maxInputTokens`
  - Progress summary (queued/running/succeeded/failed/cancelled counts)
  - Run info section (import batch, model, sources, date range)
  - Error handling for run not found
  - Fixed `GET /api/distill/runs/:runId` to include `promptVersionIds` in response
  - UI invariant: no background polling, frozen config displayed exactly as stored

- Phase 5 UI Shell - PR-5.2: Job table + per-day reset control
  - Job table on `/distill/runs/:runId` with columns:
    - `dayDate`, `status`, `attempt`, `tokensIn`, `tokensOut`, `costUsd`, `error`
  - Per-row Reset button calling `POST /api/distill/runs/:runId/jobs/:dayDate/reset`
  - After reset: re-fetch run data, UI shows incremented attempt + job returns to queued
  - Reset disabled for cancelled runs (terminal status rule enforced in UI)
  - Extended `GET /api/distill/runs/:runId` to include `jobs` array
  - Error handling for reset failures with user-visible error message
  - UI invariant: no background polling, no setInterval

- Phase 5 UI Shell - PR-5.3: Manual tick control + last tick result
  - Tick button on `/distill/runs/:runId` calling `POST /api/distill/runs/:runId/tick`
  - Button disabled during in-flight request (prevents overlapping tick requests)
  - Tick disabled for terminal run states (cancelled, completed)
  - Last tick result panel showing:
    - Processed count (number of jobs processed in this tick)
    - Run status after tick
    - Error code and message if tick failed
    - List of processed jobs with their status
  - Re-fetches run details after successful tick to update job table and progress
  - UI invariant enforced: no overlapping tick requests (sequential await), no setInterval, no background polling

- Phase 5 UI Shell - PR-5.4: Output viewer (markdown) + inspector metadata
  - `GET /api/distill/runs/:runId/jobs/:dayDate/output` endpoint
    - Returns output data for a specific job (on-demand fetch)
    - Includes outputText, bundleHash, bundleContextHash, segmentation metadata
    - Returns raw outputJson for collapsible viewer
  - OutputViewer component (`src/app/distill/runs/[runId]/components/OutputViewer.tsx`)
    - Renders Output.outputText as markdown (using react-markdown)
    - Displays bundleHash and bundleContextHash
    - Shows segmentation metadata when present (segmented, segmentCount, segmentIds)
    - Collapsible raw JSON viewer for Output.outputJson
    - On-demand data fetching (avoids loading all outputs in run detail)
  - Integrated into job table rows on run detail page
  - "View Output" toggle appears for succeeded jobs
  - UI invariant: no polling, no setInterval, output fetched on user action only
  - 190 tests passing (no regressions)

- Phase 5 UI Shell - PR-5.5: Dashboard run creation wiring
  - `GET /api/distill/filter-profiles` endpoint (lists all filter profiles)
  - Run creation form on `/distill` dashboard:
    - Import batch selector (existing, auto-selects latest)
    - Date range picker (auto-fills from batch coverage)
    - Sources checkboxes (chatgpt, claude, grok)
    - Filter profile dropdown (defaults to professional-only)
    - Model input field (defaults to stub_summarizer_v1)
  - Create Run button calling `POST /api/distill/runs`
  - On success: navigates to `/distill/runs/:runId`
  - Error display for run creation failures
  - Requires classification before run creation (enforced in UI)
  - UI invariant: no background polling, user-driven actions only
  - 190 tests passing (no regressions)

- Documentation suite
  - `GLOSSARY.md`: Terms and definitions used throughout the codebase
  - `DECISIONS.md`: Architecture Decision Records (ADRs) explaining design choices
  - `ACCEPTANCE.md`: Testable acceptance criteria and verification steps
  - Updated `SPEC.md` to align response schemas with implementation

- Phase 6 Search + Inspector - PR-6.1: FTS indexes + search API
  - Prisma migration: tsvector generated columns + GIN indexes on `MessageAtom.text` and `Output.outputText`
  - `GET /api/distill/search` endpoint with params: `q`, `scope` (raw|outputs), `limit`, `cursor`, `importBatchId`, `runId`, `startDate`, `endDate`
  - Raw scope returns: atomStableId, timestampUtc, source, role, snippet, rank
  - Outputs scope returns: runId, dayDate, stage, snippet, rank
  - Cursor pagination (opaque base64url cursor, keyset on rank+id)
  - Deterministic ordering: rank DESC, id ASC (stable tie-breakers)
  - ts_headline snippets with `<<`/`>>` markers
  - Integration tests for both scopes, pagination, filtering, and result shape

- Phase 6 Search + Inspector - PR-6.2: Search UI (results list)
  - `/distill/search` page with search input, scope tabs (Raw / Outputs), results list
  - Snippet rendering with `<<`/`>>` highlight markers
  - Cursor pagination via "Load more" button (appends results, no duplicates)
  - Raw results link to import inspector day view (PR-6.3)
  - Output results link to existing run detail page (`/distill/runs/:runId`)
  - URL-driven state for shareable search links (`?q=...&scope=...`)
  - Dashboard Search card updated: links to `/distill/search`
  - No background polling, no setInterval — search is user-driven (submit button)

- Phase 6 Search + Inspector - PR-6.3: Import inspector (day view)
  - `/distill/import/inspect` page with query params: `importBatchId`, `dayDate`, `source`
  - Batch selector when `importBatchId` is missing (lists all batches, user selects)
  - Day list sidebar showing coverage (day dates ASC, atom counts, sources per day)
  - Per-day message view: atoms in deterministic order (timestampUtc ASC, role ASC [user before assistant], atomStableId ASC)
  - Source filter dropdown (filters atoms by source)
  - Category + confidence displayed when labels exist
  - `GET /api/distill/import-batches/:id/days` endpoint (day list with coverage info)
  - `GET /api/distill/import-batches/:id/days/:dayDate/atoms` endpoint (atoms in deterministic order, optional `source` filter)
  - Search results (PR-6.2) now include `importBatchId` and deep-link correctly to the inspector
  - Integration tests: days list ordering, atoms deterministic ordering, source filter, label inclusion
  - 218 tests passing (28 new)

- Phase 6 Search + Inspector - PR-6.4: Run inspector (pre/post view)
  - `GET /api/distill/runs/:runId/jobs/:dayDate/input` endpoint
    - Returns input bundle preview for a specific job day
    - Reuses `buildBundle()` from tick/job execution (same deterministic ordering + hashes)
    - Uses run's frozen config (labelSpec, filterProfileSnapshot) from Run.configJson
    - Returns: hasInput, bundlePreviewText, bundleHash, bundleContextHash, atomCount, previewItems, rawBundleJson
    - 404 for nonexistent runId or dayDate not in run's jobs
    - hasInput=false for days with no eligible atoms (not an error)
  - InputViewer component (`src/app/distill/runs/[runId]/components/InputViewer.tsx`)
    - Displays input bundle preview (monospace/preformatted, scrollable)
    - Shows bundleHash + bundleContextHash prominently
    - Collapsible raw JSON viewer for bundle data
    - On-demand data fetching (avoids loading all inputs on page load)
  - Run detail page updated: job rows now show both "View Input" and "View Output" controls
    - Left: InputViewer (filtered bundle preview)
    - Right: OutputViewer (existing markdown + hashes)
    - Hashes match between input and output viewers for succeeded jobs
  - Integration tests: 11 tests covering all acceptance criteria
    - 404 for bad runId, 404 for dayDate not in run
    - hasInput=false for day with no eligible atoms
    - Deterministic ordering of preview items (source ASC, timestampUtc ASC, role ASC, atomStableId ASC)
    - Hash fields present (sha256 hex format)
    - Input hashes match stored Output hashes for succeeded days
    - Filtering correctly applied (PERSONAL excluded from INCLUDE WORK/LEARNING profile)
    - Bundle text format matches spec 9.1
  - 229 tests passing (11 new)

- **Phase 6 complete** — all PR-6.x items shipped (6.1 through 6.4). 229 tests passing.

- Phase 7 Additional Parsers - PR-7.1: Claude export parser
  - Claude export parser (`src/lib/parsers/claude.ts`) supporting Anthropic official data export format
    - Supported shape: array of conversations with `uuid`, `name`, `chat_messages` array
    - Each message has `uuid`, `text`, `sender` ("human"/"assistant"), `created_at` (ISO 8601)
    - Role mapping: "human" → "user", "assistant" → "assistant"; unknown senders skipped with warning
    - Deterministic ordering: timestamp ASC, role ASC (user before assistant), message ID ASC
  - Parser registered in `src/lib/parsers/index.ts` — available via `sourceOverride: "claude"` and auto-detection
  - `UNSUPPORTED_FORMAT` error code added to `src/lib/api-utils.ts` for unimplemented parser requests
  - Import route updated to return `UNSUPPORTED_FORMAT` error for unsupported sources
  - Timestamp normalization: handles ISO with/without milliseconds, timezone offsets, microsecond precision
  - Unit tests (24 new): canParse detection, role mapping, empty/missing messages, timestamp edge cases, multi-conversation, deterministic ordering
  - Integration tests (9 new): both roles imported, re-import idempotency (no duplicates), day bucketing with timezone, timestamp normalization (non-ms → ms), import stats
  - 262 tests passing (33 new)

### Planned (Phase 3b: Real Classification)
- Real classification with LLM integration (mode="real")
- Reuses LLM plumbing from Phase 4
- Rate limiting to prevent wallet-fire
- **Gate**: classify with mode="real" works, labels written with correct labelSpec

### Planned (Phase 4b: Real LLM Integration)
- Real summarization with OpenAI/Anthropic APIs
- Rate limiting and cost tracking
- Error handling for API failures

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
