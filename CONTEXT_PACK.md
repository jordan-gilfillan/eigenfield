# Journal Distiller — Context Pack (for Claude Code)

## 0) What you are doing
You are assisting on Journal Distiller (Journal Distillation) v0.3. The goal is an auditable, deterministic pipeline that imports AI chat exports, classifies, filters, and generates day-bucketed outputs with receipts.

## 1) Non-negotiable invariants (do not violate)
- Determinism/reproducibility: stable IDs, deterministic ordering, frozen run config, deterministic stubs.
- Sequential tick processing: 1 job per tick; no concurrent ticks; concurrency guard; easy to debug.
- Auditability: preserve evidence and allow inspection; no silent loss.
- Minimal infra: no background queues, no redis, no “magic”; local-first.
- v0.3 scope: no embeddings/vector search, no multi-user auth, no cloud storage.
- UI tick is user-driven and sequential: no background polling loops, no setInterval, no overlapping tick requests.
- UI must surface frozen run config exactly as stored (Run.configJson); no recomputation or hidden side effects.

## 2) Current status
- Phases 1–4 complete, including Phase 4 continued: segmentation (segmenter_v1) + run controls (cancel/resume/reset).
- Deterministic segmentation verified: stable segment IDs, metadata in Output.outputJson.meta, greedy packing.
- Run controls verified: cancel is terminal, resume requeues only FAILED jobs, reset allows reprocessing specific days; idempotency tests added.
- API contract audit done: error conventions per SPEC 7.8; idempotency gaps fixed; terminal status rule enforced.
- Current test count: 491 passing.
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
- Phase 3b LLM Plumbing (partial):
  - PR-3b0 complete: Shared LLM infrastructure (`src/lib/llm/`) — provider abstraction, env key management, rate limiting, spend caps, dry-run mode; 78 new tests
  - PR-3b.1 complete: Real-mode classify pipeline wired through `callLlm` — stage-aware dry-run (deterministic JSON), LLM output parsing/validation, `LlmBadOutputError`, budget guard integration, rate limiting; 36 new tests
  - PR-3b0.1 complete: Pricing book + cost calculator + run pricing snapshot — per-provider/per-model rates in `src/lib/llm/pricing.ts`, `pricingSnapshot` captured into `Run.configJson`, dry-run uses pricing book for cost simulation, tick uses snapshot for job cost; 40 new tests

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

**Note:** Real provider calls are not yet implemented (real LLM_MODE throws `PROVIDER_NOT_IMPLEMENTED`). The classify pipeline is fully wired through `callLlm` and works end-to-end in dry-run mode. Future PRs will add actual OpenAI/Anthropic SDK calls.

## 3) Canonical docs (source of truth)
- SPEC.md
- ACCEPTANCE.md
- DECISIONS.md (ADRs)
- EXECUTION_PLAN.md
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