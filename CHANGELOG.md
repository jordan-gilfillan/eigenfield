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
  - 78 unit tests passing
  - Idempotent seed script with filter profiles and prompt versions

### Planned (Phase 2: Import Pipeline)
- ChatGPT export parser
- `POST /api/distill/import` endpoint
- `GET /api/distill/import-batches` endpoint
- `GET /api/distill/import-batches/:id` endpoint
- Import UI page (`/distill/import`)
- Deduplication safety via atomStableId

### Planned (Phase 3: Classification)
- Stub classifier (`stub_v1` algorithm)
- `POST /api/distill/classify` endpoint
- Real classification with LLM integration

### Planned (Phase 4: Run Execution)
- Run creation with config freezing
- Tick endpoint with Postgres advisory lock
- Bundle construction (deterministic ordering)
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
