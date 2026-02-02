# Journal Distiller — Context Pack (for Claude Code)

## 0) What you are doing
You are assisting on Journal Distiller (Journal Distillation) v0.3. The goal is an auditable, deterministic pipeline that imports AI chat exports, classifies, filters, and generates day-bucketed outputs with receipts.

## 1) Non-negotiable invariants (do not violate)
- Determinism/reproducibility: stable IDs, deterministic ordering, frozen run config, deterministic stubs.
- Sequential tick processing: 1 job per tick; no concurrent ticks; concurrency guard; easy to debug.
- Auditability: preserve evidence and allow inspection; no silent loss.
- Minimal infra: no background queues, no redis, no “magic”; local-first.
- v0.3 scope: no embeddings/vector search, no multi-user auth, no cloud storage.

## 2) Current status
- Phase 4 continued complete: segmentation (segmenter_v1) + run controls (cancel/resume/reset).
- Deterministic segmentation: stable segment IDs, metadata in Output.outputJson.meta, greedy packing.
- Run controls: cancel is terminal, resume requeues only FAILED jobs, reset allows reprocessing specific days.
- API contract audit done: idempotency verified, error codes per SPEC 7.8.
- 190 tests passing.

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