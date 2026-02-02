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
- Role-order drift bug fixed: tie-breaking ordering uses semantic role order (user before assistant) and is guarded by tests.
- Tests are green.

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

## 5) Next task (paste the prompt below verbatim)
[PASTE ONE PROMPT: A or B or C]