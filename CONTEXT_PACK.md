# Journal Distiller — Context Pack (for Claude Code)

## 0) What you are doing
You are assisting on Journal Distiller (Journal Distillation) v0.3. The goal is an auditable, deterministic pipeline that imports AI chat exports, classifies, filters, and generates day-bucketed outputs with receipts.

## 1) Non-negotiable invariants (do not violate)
- Determinism/reproducibility: stable IDs, deterministic ordering, frozen run config, deterministic stubs.
- Sequential tick processing: 1 job per tick; no concurrent ticks; concurrency guard; easy to debug.
- Auditability: preserve evidence and allow inspection; no silent loss.
- Minimal infra: no background queues, no redis, no “magic”; local-first.
- v0.3 scope: no embeddings/vector search, no multi-user auth, no cloud storage.
- UI tick is user-driven and sequential: no background polling; no setInterval; no overlapping tick requests.
- Foreground polling is allowed only for progress/status visibility of user-initiated long-running operations, while the relevant page is open (use setTimeout + AbortController; stop on terminal/unmount; read-only status endpoints only).
- UI must surface frozen run config exactly as stored (Run.configJson); no recomputation or hidden side effects.

## 2) Current status
- Phases 1–4 complete, including Phase 4 continued: segmentation (segmenter_v1) + run controls (cancel/resume/reset).
- Deterministic segmentation verified: stable segment IDs, metadata in Output.outputJson.meta, greedy packing.
- Run controls verified: cancel is terminal, resume requeues only FAILED jobs, reset allows reprocessing specific days; idempotency tests added.
- API contract audit done: error conventions per SPEC 7.8; idempotency gaps fixed; terminal status rule enforced.
- **Last verified test count: 710 passing (2026-02-12).** Run `npx vitest run` to reproduce. *(Canonical — no other doc should contain test counts.)*
- Phase 5 UI Shell complete:
  - PR-5.1 complete: run detail page (`/distill/runs/:runId`) + frozen config display
  - PR-5.2 complete: job table + per-day reset control on run detail page
  - PR-5.3 complete: manual tick control + last tick result display
  - PR-5.4 complete: output viewer (markdown) + inspector metadata on run detail page
  - PR-5.5 complete: dashboard run creation wiring (`/distill` with form + navigation)
- Phase 6 Search + Inspector complete:
  - PR-6.1 complete: Postgres FTS indexes (tsvector + GIN) + `GET /api/distill/search` endpoint + cursor pagination
  - PR-6.2 complete: Search UI (`/distill/search`) with scope tabs (Raw/Outputs), snippet rendering, cursor pagination (Load more), result links, dashboard wiring
  - PR-6.3 complete: Import inspector (`/distill/import/inspect`) with day list, per-day atom view (deterministic ordering), source filter, category/confidence display, search deep-linking
  - PR-6.4 complete: Run inspector pre/post view with `GET /api/distill/runs/:runId/jobs/:dayDate/input` endpoint, InputViewer component, side-by-side input/output display on run detail page
- Phase 7 Additional Parsers complete:
  - PR-7.1 complete: Claude export parser (`src/lib/parsers/claude.ts`) with full integration into import pipeline, 33 new tests
  - PR-7.2 complete: Grok export parser (`src/lib/parsers/grok.ts`) with full integration into import pipeline, 35 new tests
  - PR-7.3 complete: Parser auto-detection + registry wiring — runs all parsers' `canParse()`, requires exactly 1 match; `UNSUPPORTED_FORMAT` (0 matches) / `AMBIGUOUS_FORMAT` (>1 matches) errors; 40 new tests
- Phase 3b LLM Plumbing:
  - PR-3b0 complete: Shared LLM infrastructure (`src/lib/llm/`) — provider abstraction, env key management, rate limiting, spend caps, dry-run mode; 78 new tests
  - PR-3b.1 complete: Real-mode classify pipeline wired through `callLlm` — stage-aware dry-run (deterministic JSON), LLM output parsing/validation, `LlmBadOutputError`, budget guard integration, rate limiting; 36 new tests
  - PR-3b0.1 complete: Pricing book + cost calculator + run pricing snapshot — per-provider/per-model rates in `src/lib/llm/pricing.ts`, `pricingSnapshot` captured into `Run.configJson`, dry-run uses pricing book for cost simulation, tick uses snapshot for job cost; 40 new tests
  - PR-3b.2 complete: OpenAI + Anthropic provider SDKs — `callLlm()` real mode routes to provider modules, returns actual token counts, computes `costUsd` via pricing book; `LlmProviderError` for SDK errors; 49 new tests
  - PR-3b.X complete: PromptVersion guardrails for classify — real mode rejects stub prompt versions and requires JSON-constraining template; fails fast before any LLM calls; HTTP 400 INVALID_INPUT on violation; tests added.
  - PR-3b.Y complete: Progress/stats visibility — durable ClassifyRun stats recorded; dashboard shows last classify totals; run detail shows last classify totals for the run’s frozen labelSpec; user-driven fetch only (no background polling).
- Phase 4b Real Summarization:
  - PR-4b complete: Real LLM summarization during tick — non-stub models call `callLlm()` via provider SDKs, LLM error handling (LlmProviderError→retriable, BudgetExceededError→not retriable, MissingApiKeyError→not retriable), partial segment failure captures partial tokens/cost, UTC date formatting fix in formatDate(); 14 new tests
- Classify Progress + Foreground Polling:
  - `POST /classify` returns `classifyRunId` in response
  - `GET /api/distill/classify-runs/:id` — read-only status endpoint for polling
  - Dashboard foreground polling: setTimeout loop + AbortController, live progress bar
  - Stub mode checkpointing added; 10 new tests

## Dashboard: running real classification from UI

The `/distill` dashboard has a Mode selector in the Classification section:
- **Stub (deterministic)**: default, uses `stub_v1` model + `classify_stub_v1` prompt version, no env vars needed.
- **Real (LLM-backed)**: uses `gpt-4o` model + `classify_real_v1` prompt version (JSON-constraining template), requires:
  1. `LLM_MODE=real` in `.env.local`
  2. `OPENAI_API_KEY=sk-...` in `.env.local`
  3. (Optional) spend caps: `LLM_MAX_USD_PER_RUN`, `LLM_MAX_USD_PER_DAY`

**Prompt version selection**: The UI fetches both classify prompt versions by `versionLabel` on mount (`classify_stub_v1` and `classify_real_v1`) and sends the correct `promptVersionId` based on the selected mode. This ensures real mode always uses the JSON-formatted system prompt.

> **Important:** Active prompt versions (`isActive`) are defaults only — they select which prompt to pre-fill in the UI. They MUST NOT be used to choose prompt behavior by mode. Real mode uses an explicit `promptVersionId` (the JSON-constraining `classify_real_v1`); stub mode ignores prompt versions for execution (deterministic algorithm).

If prerequisites are missing, the API returns a structured error (e.g., `MISSING_API_KEY`) and the UI displays it inline — no crash.

If `classify_real_v1` is not in the database, the "Classify (real)" button is disabled with guidance to run `npx prisma db seed`.

Manual verification:
1. Start dev server (`npm run dev`)
2. Select an ImportBatch on `/distill`
3. Stub: select "Stub (deterministic)", click "Classify (stub)" → completes, UI shows success
4. Real: set env vars above, run `npx prisma db seed` if needed, select "Real (LLM-backed)", click "Classify (real)" → completes
5. Real without key: select "Real" without API key → UI shows `[MISSING_API_KEY] ...` error
6. No background polling, no overlapping requests (button disabled while in-flight)
7. If progress/status polling is implemented for classify, it MUST be foreground-only (per SPEC) and MUST stop on terminal status or navigation/unmount.

## LLM plumbing

The `src/lib/llm/` module provides shared infrastructure for LLM calls used by both classification (PR-3b.1) and summarization (PR-4b).

**How to enable real mode:**
1. Set `LLM_MODE=real` in `.env.local`
2. Set the API key for your provider: `OPENAI_API_KEY=sk-...` or `ANTHROPIC_API_KEY=sk-ant-...`
3. (Optional) Set `LLM_PROVIDER_DEFAULT=openai` or `anthropic`

**Safeguards:**
- **Dry-run mode** (default): `LLM_MODE=dry_run` — returns deterministic placeholder text, no API calls, costUsd=0
- **Rate limiting**: `LLM_MIN_DELAY_MS=250` (default) — enforces minimum delay between API calls; await-based, no background intervals
- **Spend caps**: `LLM_MAX_USD_PER_RUN` and `LLM_MAX_USD_PER_DAY` — throws `BUDGET_EXCEEDED` if next call would exceed cap
- **Key validation**: Real mode throws `MISSING_API_KEY` if the provider's key is not set

**Pricing:**
- **Pricing book**: `src/lib/llm/pricing.ts` — per-provider/per-model rates (USD per 1M tokens)
- **How to add a new model rate**: Add an entry to the `RATE_TABLE` object in `src/lib/llm/pricing.ts` under the provider key. Each entry needs `inputPer1MUsd`, `outputPer1MUsd`, and optionally `cachedInputPer1MUsd`.
- **pricingSnapshot**: Captured into `Run.configJson` at run creation. Records the exact rates used, with a `capturedAt` timestamp. If the model has no known pricing, run creation fails with `UNKNOWN_MODEL_PRICING` (HTTP 400).
- **Stub models** (prefix `stub`): always cost $0; no snapshot rates needed.
- **Cost computation**: `estimateCostUsd()` for rate-table lookups; `estimateCostFromSnapshot()` for stored snapshots in tick processing.

**Provider SDKs (PR-3b.2):**
- Real mode now calls providers via `src/lib/llm/providers/openai.ts` and `src/lib/llm/providers/anthropic.ts`
- OpenAI uses the Responses API; Anthropic uses the Messages API
- `costUsd` is computed from actual token counts via the pricing book
- Provider errors are wrapped in `LlmProviderError` (code `LLM_PROVIDER_ERROR`)
- Dependencies: `openai`, `@anthropic-ai/sdk` (only constructed in real mode)

**Real Summarization (PR-4b):**
- `summarize()` in `src/lib/services/summarizer.ts` routes non-stub models through `callLlm()`
- System prompt comes from `PromptVersion.templateText`; user message is the bundle text
- Tick error handling: `LlmProviderError` → retriable, `BudgetExceededError` / `MissingApiKeyError` → not retriable
- Partial segment failure: tokens/cost from completed segments are captured even on error
- `formatDate()` in tick.ts and run.ts now uses UTC methods to prevent timezone-dependent date shifts

## Running real classification safely (checklist)

1. Set `LLM_MODE=real` in `.env.local`
2. Set the provider API key: `OPENAI_API_KEY=sk-...` or `ANTHROPIC_API_KEY=sk-ant-...`
3. (Recommended) Set spend caps: `LLM_MAX_USD_PER_RUN`, `LLM_MAX_USD_PER_DAY`
4. Run `npx prisma db seed` to ensure `classify_real_v1` prompt version exists
5. Confirm the run's `configJson.pricingSnapshot` is present (created at run creation time)
6. Select "Real (LLM-backed)" mode in the dashboard — the UI sends the correct `promptVersionId` for `classify_real_v1`

## If you see `LLM_BAD_OUTPUT`

This error (HTTP 502) means the LLM returned text that could not be parsed as valid classify JSON.

Common causes:
- **Wrong prompt version**: The stub prompt (`classify_stub_v1`) was used in real mode. The stub template has no JSON formatting instructions, so the LLM returns prose instead of `{ "category": "...", "confidence": 0.X }`.
- **Prompt not constraining JSON**: The prompt version's `templateText` does not instruct the model to output strict JSON matching the classify contract.

Next steps:
1. Verify `classify_real_v1` prompt version exists in the database (`npx prisma db seed`)
2. Verify the UI/API is sending the correct `promptVersionId` for real mode (not the stub ID)
3. Inspect the prompt version's `templateText` — it must instruct the model to return JSON with `category` and `confidence` fields

## 3) Canonical docs (source of truth)
- SPEC.md
- ACCEPTANCE.md
- DECISIONS.md (ADRs)
- CHANGELOG.md
- GLOSSARY.md

## 4) Working style
- Small diffs; one prompt/task at a time.
- Prefer updating docs/comments + minimal code changes + tests.
- Provide summary + list of files changed + test results.
- Checkin often with informative comments.
- Update CHANGELOG.md and CONTEXT_PACK.md current status.

## 5) Git hygiene (non-negotiable)
Before starting any work session or PR:
- Print repo state:
  - `git branch --show-current`
  - `git status -sb`
  - `git log --oneline -5`
- Do NOT create/switch branches unless explicitly requested by the user.
- For PR work, assume a new branch is desired unless the user says otherwise.
  - Branch naming: `phase<PHASE>/<short-topic>-pr<NN>` (e.g., `phase6/search-ui-pr62`).
- Commits:
  - Stage only files relevant to the PR.
  - Ensure working tree is clean after commit.
- Always report back:
  - current branch
  - commit hash
  - files changed summary
  - test status
