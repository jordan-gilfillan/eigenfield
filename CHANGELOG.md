# Changelog

All notable changes to Journal Distiller will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Classify progress: `POST /api/distill/classify` now returns `classifyRunId` in response
- New read-only endpoint: `GET /api/distill/classify-runs/:id` for polling classify progress
- Foreground polling in dashboard UI: live progress bar + "Processed X / Y" while classify runs
  - Uses setTimeout loop + AbortController (no setInterval, no background polling)
  - Stops on terminal status (succeeded/failed) or component unmount
- Stub mode now checkpoints progress during batch processing
- 10 new tests for classify progress, classify-runs endpoint shape, and read-only verification (582 total)

### Changed
- Docs: clarify PromptVersion mode selection rules (isActive is default only; real mode rejects stub prompt) + stats requirements (aggregate tokens/cost, last classify totals)

### Fixed
- Fix: classify real mode uses JSON prompt version (`classify_real_v1`); stub unaffected
  - Root cause: UI sent `classify_stub_v1` prompt ID for both modes; the stub template has no JSON formatting instructions, so the LLM returned prose → `LLM_BAD_OUTPUT`
  - UI now fetches both prompt versions by `versionLabel` and sends the correct one per mode
  - `GET /api/distill/prompt-versions` now supports `?versionLabel=` filter
  - Seed updated: `classify_real_v1` is now active (idempotent `update: { isActive: true }`)
  - Run creation `labelSpec` now reflects the classify mode actually used (was hardcoded `stub_v1`)

### Changed
- UI: dashboard classify supports stub/real mode
  - Mode selector (radio buttons): Stub (deterministic) / Real (LLM-backed)
  - Button label reflects selected mode: "Classify (stub)" or "Classify (real)"
  - Real mode helper text: "Requires LLM_MODE=real and provider API key. Spend caps apply."
  - Error display includes error code from API (e.g., `[MISSING_API_KEY] ...`)
  - Success message shows which mode was used
  - No background polling; buttons disabled during in-flight request

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

- Phase 7 Additional Parsers - PR-7.2: Grok export parser
  - Grok export parser (`src/lib/parsers/grok.ts`) supporting xAI Grok data export format
    - Supported shape: `{ conversations: [{ conversation: { id, title, ... }, responses: [{ response: { _id, message, sender, create_time, ... } }] }] }`
    - Timestamps use MongoDB extended JSON: `{ $date: { $numberLong: "epoch_ms" } }`
    - Role mapping: "human" → "user", "assistant"/"ASSISTANT" → "assistant" (case-insensitive); unknown senders skipped with warning
    - Deterministic ordering: timestamp ASC, role ASC (user before assistant), message ID ASC
  - Parser registered in `src/lib/parsers/index.ts` — available via `sourceOverride: "grok"` and auto-detection
  - `canParse()` validates Grok-specific structure (object with `conversations` array, nested `conversation`/`responses` keys, `_id`/`sender` fields)
  - Unit tests (27 new): canParse detection (positive + 6 negative cases), role mapping (including ASSISTANT uppercase), empty/missing messages, timestamp edge cases, deterministic ordering, multi-conversation, error handling
  - Integration tests (8 new): both roles imported, re-import idempotency (no duplicates), day bucketing with timezone, timestamp normalization (epoch ms → Date), millisecond precision preserved, import stats
  - `.gitignore` updated: `conversations_*.json` pattern excludes personal export data files
  - 297 tests passing (35 new)

- Phase 7 Additional Parsers - PR-7.3: Parser auto-detection + registry wiring
  - Parser auto-detection logic in `src/lib/parsers/index.ts`
    - Runs ALL parsers' `canParse()` on input (no short-circuit)
    - Exactly 1 match → use that parser
    - 0 matches → `UNSUPPORTED_FORMAT` error
    - >1 matches → `AMBIGUOUS_FORMAT` error with matched parser ids in `details.matched`
  - `Parser` interface extended with `id` property (`"chatgpt" | "claude" | "grok"`)
  - `AMBIGUOUS_FORMAT` error code added to `src/lib/api-utils.ts`
  - Import route (`POST /api/distill/import`) updated:
    - Uses typed `UnsupportedFormatError` / `AmbiguousFormatError` error classes
    - Auto-detection runs only when `sourceOverride` is absent
    - `sourceOverride` bypasses detection and uses the specified parser directly
  - Unit tests (30 new): parser id, getParser, auto-detect happy path (all 3 formats), zero-match errors, ambiguous-match errors, format discrimination (no cross-contamination), parseExport with/without override
  - Integration tests (10 new): auto-detect each format without override, sourceOverride bypass, unrecognized JSON → UNSUPPORTED_FORMAT, invalid JSON → UNSUPPORTED_FORMAT, synthetic ambiguous data → AMBIGUOUS_FORMAT with matched ids, DB source correctness, re-import idempotency preserved
  - 337 tests passing (40 new)

- **Phase 7 complete** — all PR-7.x items shipped (7.1 through 7.3). 337 tests passing.

- Phase 3b LLM Plumbing - PR-3b0: Shared LLM infrastructure
  - Provider abstraction (`src/lib/llm/types.ts`): ProviderId, LlmRequest, LlmResponse, LlmCallContext
  - Configuration (`src/lib/llm/config.ts`): env-based key management, mode selection (dry_run/real), spend caps
  - Rate limiter (`src/lib/llm/rateLimit.ts`): await-based min-delay limiter with injectable clock for testing
  - Budget guard (`src/lib/llm/budget.ts`): per-run and per-day spend caps with BudgetExceededError
  - LLM client (`src/lib/llm/client.ts`): callLlm() with dry-run path (deterministic placeholder) and real path stub
  - Typed error classes (`src/lib/llm/errors.ts`): MissingApiKeyError, ProviderNotImplementedError, BudgetExceededError
  - Env vars: LLM_MODE, LLM_PROVIDER_DEFAULT, LLM_MIN_DELAY_MS, LLM_MAX_USD_PER_RUN, LLM_MAX_USD_PER_DAY
  - 78 new unit tests (config, errors, rate limiter, budget, client)

- Phase 3b Real Classification - PR-3b.1: Wire classify mode="real" through LLM plumbing
  - Real-mode classification pipeline (`classifyBatch` mode="real") using `callLlm` from `src/lib/llm/`
  - Dry-run mode (default): deterministic classification JSON based on `sha256(atomStableId)` → category from core 6, confidence 0.7
  - Stage-aware dry-run in `callLlm`: `metadata.stage="classify"` triggers classify-specific response
  - LLM output parser (`parseClassifyOutput`): validates JSON structure, category in full Category enum, confidence 0..1
  - `LlmBadOutputError` error class (code `LLM_BAD_OUTPUT`) for unparseable LLM output → HTTP 502
  - `BudgetExceededError` → HTTP 402 in classify route
  - Rate limiting per atom via `RateLimiter`; budget guard via `assertWithinBudget`
  - Provider inference from model string (claude→anthropic, gpt→openai, fallback to env default)
  - Seed updated: `classify_real_v1` PromptVersion with classification system prompt template
  - Route updated: removed 501 Not Implemented guard for mode="real"; added LLM error handling
  - Idempotent: same (messageAtomId, promptVersionId, model) → skip
  - 36 new tests (7 client dry-run classify, 4 LlmBadOutputError, 25 real-mode integration)
  - 451 tests passing total
  - **Gate passed**: classify with mode="real" works end-to-end in dry-run, labels written with correct labelSpec

- Phase 3b Pricing - PR-3b0.1: Pricing book + cost calculator + run pricing snapshot
  - Pricing module (`src/lib/llm/pricing.ts`) with per-provider/per-model token rates
    - Rate table: OpenAI (gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano), Anthropic (claude-sonnet-4-5, claude-3-5-sonnet, claude-3-5-haiku)
    - `getRate(provider, model)`: returns Rate or throws UnknownModelPricingError
    - `estimateCostUsd()`: computes cost from token counts + rate table
    - `buildPricingSnapshot()`: captures rates at a point in time for auditability
    - `estimateCostFromSnapshot()`: computes cost using stored snapshot rates
    - `inferProvider()`: infers provider from model string (shared by classify + run services)
    - Stub models (prefix "stub") return zero rates (cost = $0)
  - `UnknownModelPricingError` (code `UNKNOWN_MODEL_PRICING`) with { provider, model } details
  - Run creation captures `pricingSnapshot` into `Run.configJson` at creation time
    - Unknown model → HTTP 400 `UNKNOWN_MODEL_PRICING`
  - Dry-run cost simulation uses pricing book (replaces hardcoded rates)
  - Tick job cost computation uses `pricingSnapshot` from run config for non-stub models
  - 40 new tests (33 unit: pricing module + error, 7 integration: run creation + DB persistence)
  - 491 tests passing total

- Phase 3b Provider SDKs - PR-3b.2: OpenAI + Anthropic real provider integrations
  - OpenAI provider (`src/lib/llm/providers/openai.ts`): Responses API wrapper
    - Extracts `output_text`, `usage.input_tokens`, `usage.output_tokens` from response
    - Maps `system` role to `developer` in input messages
    - Passes `instructions`, `temperature`, `max_output_tokens`
  - Anthropic provider (`src/lib/llm/providers/anthropic.ts`): Messages API wrapper
    - Extracts text from `content` blocks (type='text'), joins with newline
    - Extracts `usage.input_tokens`, `usage.output_tokens`
    - Filters system messages from messages array (uses `system` param instead)
    - Defaults `max_tokens` to 1024
  - `callLlm()` real mode now routes to provider SDKs (replaces `ProviderNotImplementedError`)
    - Validates API key via `getApiKey()` (throws `MissingApiKeyError` if missing)
    - Dispatches to `callOpenAi` or `callAnthropic` based on `req.provider`
    - Computes `costUsd` from actual token counts via pricing book
    - Returns `dryRun: false` with `raw` response object
  - `LlmProviderError` error class (code `LLM_PROVIDER_ERROR`) with optional `status` and `name` details
  - SDK dependencies: `openai`, `@anthropic-ai/sdk`
  - 49 new tests (14 OpenAI provider, 15 Anthropic provider, 15 client real-mode, 5 error class)
  - 540 tests passing total

- Phase 4b Real Summarization - PR-4b: Real LLM summarization during tick
  - Real summarization path in `src/lib/services/summarizer.ts`
    - Non-stub models (gpt-4o, claude-sonnet-4-5, etc.) call `callLlm()` via provider SDKs
    - Infers provider from model string, builds LlmRequest with system=promptVersion.templateText
    - Returns actual tokensIn/tokensOut/costUsd from provider response
  - Tick error handling (`src/lib/services/tick.ts`) for LLM-specific errors
    - `LlmProviderError` → FAILED + retriable=true (rate limits, server errors)
    - `BudgetExceededError` → FAILED + retriable=false
    - `MissingApiKeyError` → FAILED + retriable=false
    - Partial segment failure captures tokens/cost from completed segments
    - Generic `LlmError` subclasses use their `.code` with retriable=true
  - UTC date formatting fix in `formatDate()` (tick.ts, run.ts)
    - Changed `getFullYear()/getMonth()/getDate()` → `getUTCFullYear()/getUTCMonth()/getUTCDate()`
    - Fixes date-shift bug when server timezone ≠ UTC (dates no longer shift by -1 day)
  - 14 new integration tests (`tick-real-summarize.test.ts`)
    - Real model triggers summarize path (not stub), stores output, populates tokens/cost
    - Pricing snapshot overrides summarize costUsd with frozen rates
    - Multi-tick processing across all eligible days
    - Segmented bundles: multiple calls summed, meta records segmentation
    - Provider error → FAILED + correct error code + retriable flag
    - Partial segment failure captures partial tokens/cost
    - Run status transitions to FAILED when all jobs fail
    - Stub model unchanged (delegates to stub implementation)
    - Output metadata: bundleHash, bundleContextHash, promptVersionId stored
  - 554 tests passing total (14 new)

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
