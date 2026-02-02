# Journal Distiller v0.3 — Execution Plan

> This document captures the implementation plan derived from SPEC.md review and refinement sessions.

## Spec Review Summary

The spec went through multiple review passes to eliminate ambiguity and ensure testability:

### Pass 1: Initial Review
Identified issues with:
- Timestamp format ambiguity (now pinned to RFC3339 with millisecond precision)
- Bundle hash missing filter inputs (now split into `bundleHash` + `bundleContextHash`)
- RawEntry purpose unclear (now explicitly derived + deterministic)
- ImportBatch mixed semantics (now pinned to v0.3 single-file reality)
- Segmentation underspecified (now concrete with `maxInputTokens` default 12000)
- No rollback for "succeeded but wrong" (now has reset endpoint)
- Search scope ambiguity (now MessageAtoms + Outputs only, RawEntries excluded)

### Pass 2: Weasel Word Lint
Pinned remaining ambiguities:
- EMBARRASSING: explicitly in v0.3 enum, included in `safety-exclude`
- Import defaults: `timezone=America/Los_Angeles`, no auto-classification
- Tick guard: MUST use Postgres advisory lock (not "recommended")
- `maxInputTokens`: defaults to 12000 if not configured
- Search: tsvector only, trigram out of scope for v0.3
- Output: stores both `bundleHash` and `bundleContextHash`
- `configJson.promptVersionIds`: summarize required, redact/classify conditional
- `Run.timezone`: must equal `ImportBatch.timezone`
- Resume: sets run status to QUEUED
- Segmentation metadata: stored in `Output.outputJson.meta`

### Pass 3: Stack + Response Schemas
Added normative sections:
- Section 2.1: Implementation stack (Next.js App Router, TypeScript, Postgres 16, Prisma, Node LTS)
- Section 2.1.1: Docker Compose requirement
- Section 7.9: Success response schemas for all endpoints

### Pass 4: Second Model Review
Final refinements:
- Advisory lock session-scoping and pooled connection handling
- Terminal status rule: `cancelled` is authoritative
- Crash recovery: v0.3 uses manual reset only
- Run.timezone validation (must equal ImportBatch.timezone)

---

## Implementation Phases

### Phase 1: Foundation (Data Layer + Import)

**Step 1: Project Bootstrap**
```bash
npx create-next-app@latest journal-distiller --typescript --app --tailwind --eslint
cd journal-distiller
```

**Step 2: Docker Compose**
Create `docker-compose.yml` per spec 2.1.1:
- Service: `db`
- Image: `postgres:16`
- Port: `5432:5432`
- Named volume: `journal_distill_pg`

**Step 3: Environment Setup**
- `.env.example` with `DATABASE_URL`
- `.env.local` (gitignored)

**Step 4: Prisma Schema**
Install and initialize:
```bash
npm install prisma @prisma/client
npx prisma init
```

Implement all entities from Section 6:
- Enums: `Source`, `Role`, `Category`, `FilterMode`, `RunStatus`, `JobStatus`, `Stage`
- Models: `ImportBatch`, `MessageAtom`, `MessageLabel`, `RawEntry`, `FilterProfile`, `Prompt`, `PromptVersion`, `Run`, `Job`, `Output`
- All uniqueness constraints
- All foreign key relationships

**Step 5: Seed Data (idempotent)**
Create `prisma/seed.ts`:
- Filter profiles: `professional-only`, `professional-plus-creative`, `safety-exclude`
- Prompts for stages: `classify`, `summarize`, `redact`
- Stub prompt version: `classify_stub_v1`
- Placeholder active versions for summarize
- Seed MUST be idempotent: use `upsert` or check-before-insert pattern
- Running `prisma db seed` multiple times MUST NOT create duplicates or fail

**Step 6: Core Utilities**
Create `lib/` modules:

| File | Purpose | Spec Reference |
|------|---------|----------------|
| `lib/normalize.ts` | Text normalization (line endings, trailing whitespace) | 5.1 |
| `lib/timestamp.ts` | RFC3339 millisecond formatting | 5.2 |
| `lib/stableId.ts` | `atomStableId` generation | 5.2 |
| `lib/bundleHash.ts` | `bundleHash` + `bundleContextHash` | 5.3 |
| `lib/rawEntry.ts` | RawEntry `contentText` construction | 6.5 |

**Step 7: Unit Tests**
- ID stability: same input → same ID across calls
- Normalization edge cases: CRLF → LF, trailing whitespace, preserved leading whitespace
- Timestamp formatting: offset conversion, millisecond padding
- Bundle hash determinism

**Deliverables:**
- [ ] Next.js project with App Router
- [ ] `docker-compose.yml`
- [ ] Prisma schema with all entities
- [ ] Seed script
- [ ] Core utility functions
- [ ] Unit tests passing

**Phase Gate:**
- [ ] `docker compose up -d` starts Postgres
- [ ] `prisma migrate dev` succeeds
- [ ] `prisma db seed` succeeds (and is idempotent on re-run)
- [ ] All unit tests pass

---

### Phase 2: Import Pipeline

**Step 1: ChatGPT Parser**
Start with one format to prove the pipeline:
- Parse `conversations.json` export format
- Extract: timestamp, role, text, conversation ID, message ID
- Handle both user and assistant roles

**Step 2: Import Endpoint**
`POST /api/distill/import`:
- Multipart file upload
- Source detection (or honor override)
- Timezone handling (default: `America/Los_Angeles`)
- Create ImportBatch record
- Create MessageAtoms with `atomStableId`
- Materialize RawEntries
- Return response per 7.9 schema

**Step 3: Deduplication Safety**
- Use `atomStableId` for duplicate detection
- Never use `skipDuplicates` on other fields
- Test: importing same file twice doesn't lose data

**Step 4a: Read Endpoints**
- `GET /api/distill/import-batches` — list all ImportBatches (paginated)
- `GET /api/distill/import-batches/:id` — get single ImportBatch with stats

**Step 5: Import UI**
`/distill/import` page:
- File upload component
- Source override dropdown
- Timezone selector
- Display import summary stats
- "Use this import" CTA

**Deliverables:**
- [ ] ChatGPT parser
- [ ] Import API endpoint
- [ ] Import UI page
- [ ] Tests: both roles imported, no silent loss, RawEntry per source/day

**Phase Gate:**
- [ ] Can upload a ChatGPT export and see stats in response
- [ ] Re-importing same file doesn't duplicate atoms (atomStableId dedup)
- [ ] RawEntries created per (source, dayDate)

---

### Phase 3: Classification

**Step 1: Stub Classification**
Implement `stub_v1` algorithm per spec 7.2:
```typescript
const h = sha256(atomStableId)
const index = uint32(h.slice(0, 4)) % 6
const category = CORE_CATEGORIES[index]
const confidence = 0.5
```

**Step 2: Classify Endpoint**
`POST /api/distill/classify`:
- Input: `{ importBatchId, model, promptVersionId, mode: real|stub }`
- Stub mode: use `stub_v1`
- Real mode: call LLM (defer to Phase 3b)
- Skip already-labeled atoms (same promptVersionId + model)
- Return response per 7.9 schema

**Step 3: Real Classification (Phase 3b)**
- LLM integration (OpenAI/Anthropic)
- Batch processing with rate limiting
- Cost tracking

**Deliverables:**
- [ ] Stub classifier
- [ ] Classify API endpoint
- [ ] Tests: stub determinism, label version isolation

**Phase Gate:**
- [ ] Stub classification produces deterministic labels (same input → same category)
- [ ] Labels are scoped to (messageAtomId, promptVersionId, model)
- [ ] Re-classifying with same labelSpec skips already-labeled atoms

---

### Phase 4: Run Execution

**Step 1: Run Creation**
`POST /api/distill/runs`:
- Freeze `promptVersionIds` (summarize required)
- Freeze `labelSpec` (classifier model + promptVersionId)
- Freeze `filterProfileSnapshot`
- Validate `timezone` equals ImportBatch timezone
- Determine eligible days (atoms with matching labels + filter)
- Create Jobs (one per eligible day)
- Return 400 if 0 eligible days

**Step 2: Advisory Lock Setup**
Per spec 7.4, advisory locks are session-scoped. **Pinned approach:**
- Use a dedicated `pg` Pool (not Prisma) for advisory lock acquire/release
- Lock key: `hashtextextended(runId, 0)` to get a stable int64 for `pg_try_advisory_lock` / `pg_advisory_unlock`
- Acquire lock at start of tick, release at end (same connection)
- If lock acquisition fails (already held), return 409 immediately
- This avoids Prisma connection pooling releasing locks on the wrong session

**Step 3: Tick Endpoint**
`POST /api/distill/runs/:runId/tick`:
- Acquire advisory lock (409 if unavailable)
- Check run status (skip if `cancelled`)
- Select up to N=1 queued jobs
- For each job:
  - Set status to `running`
  - Build bundle (deterministic ordering per 9.1)
  - Check token count, segment if needed
  - Call summarizer
  - Store Output with both hashes
  - Update job (status, tokens, cost)
- Release lock
- Return response per 7.9 schema

**Step 4: Bundle Construction**
Per spec 9.1:
- Load eligible atoms
- Sort: source ASC, timestampUtc ASC, role ASC (user before assistant), atomStableId ASC
- Render format with `# SOURCE:` headers

**Step 5: Segmentation**
Per spec 9.2:
- If bundle > `maxInputTokens`, split into segments
- Stable segment IDs
- Concatenate summaries with `## Segment <k>` headers
- Record in `Output.outputJson.meta`

**Step 6: Resume/Cancel/Reset**
- Cancel: mark run + queued jobs as cancelled
- Resume: reset FAILED jobs to QUEUED, set run to QUEUED
- Reset: delete outputs for specific day, increment attempt

**Step 7: Read Endpoints**
- `GET /api/distill/runs` — list runs (paginated, filterable by importBatchId)
- `GET /api/distill/runs/:runId` — get single run with config and progress
- `GET /api/distill/runs/:runId/jobs` — list jobs for run (paginated)
- `GET /api/distill/runs/:runId/jobs/:dayDate` — get single job with outputs
- `GET /api/distill/outputs/:id` — get single output by ID

**Deliverables:**
- [ ] Run creation endpoint
- [ ] Advisory lock mechanism
- [ ] Tick endpoint with concurrency guard
- [ ] Bundle construction
- [ ] Segmentation (if over budget)
- [ ] Resume/Cancel/Reset endpoints
- [ ] Tests: frozen config, tick safety, bundle ordering, terminal status rule

**Phase Gate:**
- [ ] Run creation freezes config correctly
- [ ] Tick processes exactly 1 job and returns 409 on concurrent calls
- [ ] Cancelled runs cannot be resurrected by tick
- [ ] Bundle hash is deterministic (same atoms → same hash)
- [ ] Reset endpoint allows reprocessing a specific day

---

### Phase 5: UI Shell

**Step 1: Dashboard**
`/distill` page:
- ImportBatch selector
- Date range picker
- Source filter
- Filter profile selector
- Model selector
- "Create Run" button

**Step 2: Run Detail**
`/distill/runs/:runId` page:
- Config snapshot display
- Progress summary (queued/running/succeeded/failed)
- Job table with status, tokens, cost, errors
- Sequential polling implementation (no `setInterval`)

**Step 3: Output Viewer**
- Per-day output display
- Rendered markdown
- Collapsible raw JSON

**Deliverables:**
- [ ] Dashboard with run creation
- [ ] Run detail page
- [ ] Sequential polling
- [ ] Output viewer

**Phase Gate:**
- [ ] Dashboard shows import batches and allows run creation
- [ ] Run detail page polls sequentially (no overlapping requests)
- [ ] Output renders as markdown

---

### Phase 6: Search + Inspector

**Step 1: FTS Indexes**
Add Postgres Full-Text Search:
- `MessageAtom.text` → tsvector
- `Output.outputText` → tsvector

**Step 2: Search Endpoint**
`GET /api/distill/search`:
- Query params: `query`, `scope`, `importBatchId`, `runId`, `startDate`, `endDate`, `sources`, `categories`, `limit`, `cursor`
- Category/confidence from labelSpec context
- Pagination with cursor
- Return response per 7.9 schema

**Step 3: Search UI**
`/distill/search` page:
- Search input
- Scope tabs (Raw / Outputs)
- Result list with snippets
- Click to open inspector

**Step 4: Inspector Views**
Import inspector:
- Day list (coverage)
- Per-day message view
- Filter by category/role/source

Run inspector:
- Left: Input (filtered bundle preview)
- Right: Output (rendered markdown)
- Collapsible raw JSON

**Deliverables:**
- [ ] FTS indexes
- [ ] Search endpoint
- [ ] Search UI
- [ ] Import inspector
- [ ] Run inspector

**Phase Gate:**
- [ ] FTS query returns relevant atoms/outputs
- [ ] Pagination works with cursor
- [ ] Inspector shows before/after for a given day

---

### Phase 7: Additional Parsers

**Step 1: Claude Parser**
- Parse Claude export format
- Map fields to MessageAtom schema

**Step 2: Grok Parser**
- Parse Grok export format
- Map fields to MessageAtom schema

**Step 3: Parser Registry**
- Auto-detection logic
- Source override handling

**Deliverables:**
- [ ] Claude parser
- [ ] Grok parser
- [ ] Parser auto-detection

**Phase Gate:**
- [ ] All three parsers produce valid MessageAtoms
- [ ] Auto-detection correctly identifies source format

---

## Testing Strategy

### Unit Tests
- Core utilities (normalize, stableId, bundleHash, timestamp)
- Parsers (ChatGPT, Claude, Grok)
- Stub classifier determinism

### Integration Tests
- Import pipeline (file → DB)
- Classification pipeline
- Run execution (tick processing)
- Search queries

### E2E Tests (Playwright/Cypress)
- Import flow
- Run creation and polling
- Sequential polling behavior (no overlap)
- Search and inspector navigation

### Acceptance Criteria (from spec 11)
- [ ] 11.1: Two identical messages on different timestamps → both stored
- [ ] 11.1: Import includes both user and assistant roles
- [ ] 11.1: Mixed-source days create one RawEntry per source
- [ ] 11.2: Changing active prompt after run creation doesn't affect that run
- [ ] 11.2: Filtering uses only labels matching run.labelSpec
- [ ] 11.3: Tick default is 1 job
- [ ] 11.3: Backend rejects overlapping ticks (409)
- [ ] 11.3: Resume continues from failed jobs without reprocessing succeeded
- [ ] 11.4: Search returns results for known strings
- [ ] 11.4: Inspector renders markdown and shows pre/post views

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Advisory lock with Prisma pooling | Use dedicated `pg` Pool for lock operations |
| Large bundles exceeding context | Segmentation with deterministic merging |
| Stuck jobs from crashes | Manual reset endpoint; document recovery procedure |
| Schema drift | Prisma migrations; spec is authoritative |
| Response shape drift | Normative response schemas in spec 7.9 |

---

## Definition of Done (v0.3)

- [ ] All acceptance criteria passing
- [ ] Docker Compose brings up working local environment
- [ ] Import → Classify → Run → Output workflow complete
- [ ] Search functional with FTS
- [ ] Inspector views for import and run
- [ ] At least ChatGPT parser working
- [ ] Sequential polling verified (no overlapping ticks)
- [ ] Cost tracking visible in UI

---

*Generated from SPEC.md v0.3.0-draft review sessions*
