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
- Current test count: 218 passing.
- Phase 5 UI Shell complete:
  - PR-5.1 complete: run detail page (`/distill/runs/:runId`) + frozen config display
  - PR-5.2 complete: job table + per-day reset control on run detail page
  - PR-5.3 complete: manual tick control + last tick result display
  - PR-5.4 complete: output viewer (markdown) + inspector metadata on run detail page
  - PR-5.5 complete: dashboard run creation wiring (`/distill` with form + navigation)
- Phase 6 Search + Inspector in progress:
  - PR-6.1 complete: Postgres FTS indexes (tsvector + GIN) + `GET /api/distill/search` endpoint + cursor pagination
  - PR-6.2 complete: Search UI (`/distill/search`) with scope tabs (Raw/Outputs), snippet rendering, cursor pagination (Load more), result links, dashboard wiring
  - PR-6.3 complete: Import inspector (`/distill/import/inspect`) with day list, per-day atom view (deterministic ordering), source filter, category/confidence display, search deep-linking
  - Next: PR-6.4 (Run inspector).

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