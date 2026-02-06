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
- Shared LLM plumbing (mode, keys, rate limiting, spend caps, dry-run)
- Pricing book + cost calculator (compute cost from token usage)
- Provider SDK integrations (OpenAI/Anthropic)
- Batch processing with rate limiting (await-based)
- Cost tracking + auditability (pricing snapshot + per-call costUsd)

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
  - Compute `tokensIn`/`tokensOut` and `costUsd` via pricing book (stub = 0, real = computed)
  - Enforce spend caps before each real call (abort safely if exceeded)
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

### Phase 5: UI Shell (minimum operability slice)

Goal: make the system operable and debuggable end-to-end without adding new backend dependencies.

```

**Status:** ✅ Complete (PR-5.1 through PR-5.5)

Completed PRs:
- PR-5.1: Run detail page scaffold + frozen config
- PR-5.2: Job table + per-day reset control
- PR-5.3: Manual tick control (single-request) + last tick result
- PR-5.4: Output viewer (markdown) + inspector metadata (on-demand output fetch)
- PR-5.5: Dashboard run creation wiring (+ filter profiles list endpoint)

Notes:
- UI invariants held throughout: no background polling loops, no setInterval, sequential tick only, buttons map 1:1 to API calls, frozen config displayed exactly as stored.
```

UI invariants (non-negotiable):
- No background polling loops. Tick is user-driven.
- No overlapping tick requests. The UI MUST await each tick response before sending the next.
- The UI MUST NOT use setInterval for tick; it must be a sequential loop (manual or controlled play button).
- No “magic” side effects: buttons map 1:1 to API calls (import, classify, create run, tick, cancel, resume, reset).
- The UI must surface the frozen run config snapshot exactly as stored (no recomputation).

Implementation strategy: ship Phase 5 as small PRs. Each PR should be mergeable and keep tests green.

#### PR-5.1: Run detail page scaffold + frozen config
Pages:
- `/distill/runs/:runId`

Work:
- Create the route and basic layout.
- Fetch run detail from `GET /api/distill/runs/:runId`.
- Render a Frozen Config block showing values from `Run.configJson`:
  - `promptVersionIds`
  - `labelSpec`
  - `filterProfileSnapshot`
  - `timezone`
  - `maxInputTokens`

Acceptance (manual):
- Run detail page renders for an existing run.
- Frozen config values match the API response exactly.

#### PR-5.2: Job table + per-day reset control
Work:
- Add a Job table (dayDate, status, attempt, tokensIn/out, costUsd, error).
- Add a per-day Reset button calling `POST /api/distill/runs/:runId/jobs/:dayDate/reset`.
- After reset, re-fetch and verify `attempt` increments and job returns to `queued`.

Acceptance (manual):
- Reset works for a single day without affecting other days.
- Attempt increments are visible in the UI.

#### PR-5.3: Manual tick control (single-request) + last tick result
Work:
- Add a Tick button calling `POST /api/distill/runs/:runId/tick`.
- Disable the Tick button while a request is in-flight.
- Show the last tick response summary (processed count, run status, any error code).

Acceptance (manual):
- UI never sends overlapping tick requests.
- If a second tick is attempted while one is in-flight, UI prevents it.

#### PR-5.4: Output viewer (markdown) + minimal inspector metadata
Work:
- For days with outputs, add an Output viewer that renders `Output.outputText` as markdown.
- Add a collapsible raw JSON view for `Output.outputJson`.
- Surface `bundleHash` and `bundleContextHash`.
- If segmented, surface `segmented`, `segmentCount`, `segmentIds` from `Output.outputJson.meta`.

Acceptance (manual):
- Output markdown renders.
- Hashes and segmentation metadata are visible.

#### PR-5.5: Minimal dashboard run creation wiring
Pages:
- `/distill` (dashboard)

Work:
- ImportBatch selector (must allow selecting an existing batch; default can be latest).
- Date range picker.
- Sources selector.
- FilterProfile selector (default `professional-only`).
- Model selector.
- Create Run button calling `POST /api/distill/runs`.
- After creation, navigate to `/distill/runs/:runId`.

Acceptance (manual):
- Can create a run from an existing batch and land on the run detail page.

Phase Gate (Phase 5):
- Dashboard supports run creation and navigates to run detail.
- Run detail page shows frozen config snapshot values exactly as stored in Run.configJson.
- UI allows manual tick with no overlapping requests (sequential await).
- UI exposes per-day reset and shows attempt increments after reset.
- For a processed day, UI can display output markdown and the input bundle hashes (bundleHash + bundleContextHash).

---

### Phase 6: Search + Inspector

Goal: make the dataset and outputs inspectable at scale (find, filter, and open a concrete pre/post view) without adding new model dependencies.

**Status:** ✅ Complete (PR-6.1 through PR-6.4)

Completed PRs:
- PR-6.1: FTS indexes (`tsvector` + GIN on `MessageAtom.text` and `Output.outputText`) + `GET /api/distill/search` endpoint + cursor pagination
- PR-6.2: `/distill/search` UI with scope tabs (Raw/Outputs), snippet rendering, "Load more" pagination, deep-links to inspector views
- PR-6.3: `/distill/import/inspect` day view with `GET .../days` and `GET .../days/:dayDate/atoms` endpoints, deterministic ordering, source filter, category display
- PR-6.4: Run pre/post inspector with `GET /api/distill/runs/:runId/jobs/:dayDate/input` endpoint, InputViewer component, side-by-side input/output on run detail page

Notes:
- 229 tests passing after Phase 6 (11 new in PR-6.4, 28 new in PR-6.3, 17 new in PR-6.1).
- Input endpoint reuses `buildBundle()` from tick/job execution so hashes match stored Output hashes.
- No background polling introduced; all fetches are user-driven and on-demand.

Implementation strategy: ship Phase 6 as small PRs. Each PR should be mergeable and keep tests green.

#### PR-6.1: FTS indexes + search API (minimal)
Work:
- Add Postgres FTS support:
  - `MessageAtom.text` → stored/generated `tsvector` + GIN index
  - `Output.outputText` → stored/generated `tsvector` + GIN index
- Add `GET /api/distill/search` endpoint (minimal fields + cursor pagination):
  - Query params (v0): `q`, `scope` (raw|outputs), `limit`, `cursor`, optional `importBatchId`, optional `runId`, optional `startDate`, optional `endDate`.
  - Raw scope returns: `messageAtomId`, `timestampUtc`, `source`, `role`, `snippet`, `rank`.
  - Outputs scope returns: `runId`, `dayDate`, `outputId` (or stable locator), `snippet`, `rank`.
- Deterministic ordering:
  - Order by `rank DESC`, then stable tie-breakers (id/dayDate).

Acceptance (manual):
- Known strings in MessageAtoms and Outputs are found in their respective scopes.
- Pagination works (cursor advances, no duplicates across pages).

#### PR-6.2: Search UI (results list)
Pages:
- `/distill/search`

Work:
- Search input + submit (no background polling).
- Scope tabs: Raw / Outputs.
- Results list with snippets and stable links:
  - Raw hit → link to Import inspector day view (PR-6.3).
  - Output hit → link to Run detail day output viewer (existing Phase 5 UI).

Acceptance (manual):
- Searching returns results and clicking a result navigates to the correct target.

#### PR-6.3: Import inspector (day view)
Work:
- Import inspector views:
  - Day list (coverage) for an ImportBatch.
  - Per-day message view (atoms ordered per spec), with filters for `source` and `role`.
- Minimal endpoints as needed:
  - `GET /api/distill/import-batches/:id/days`
  - `GET /api/distill/import-batches/:id/days/:dayDate/atoms`

Acceptance (manual):
- Can open an ImportBatch, select a day, and view ordered atoms with filters.
- A raw search result can deep-link into this day view.

#### PR-6.4: Run inspector (pre/post view)
Work:
- Run inspector on the run detail page (or dedicated view):
  - Left: input bundle preview for that day (filtered, deterministic render)
  - Right: output viewer (already exists)
  - Collapsible raw JSON
- Minimal endpoint as needed:
  - `GET /api/distill/runs/:runId/jobs/:dayDate/input` (returns rendered bundle preview + hashes)

Acceptance (manual):
- For a given day, inspector shows before/after (bundle preview + output markdown).
- Output hashes match those shown in Phase 5 output viewer.

Phase Gate (Phase 6):
- [x] FTS query returns relevant atoms/outputs with stable ordering
- [x] Cursor pagination works
- [x] Search UI navigates correctly to raw day view and run output
- [x] Inspector shows concrete pre/post view for a day

---

### Next Steps

Two independent work streams are available. Either can be started next; they share no dependencies.

#### Path A: Phase 7 — Additional Parsers (Claude + Grok)

##### PR-7.1: Claude export parser
- Parse Claude conversation export format (JSON)
- Map fields to MessageAtom schema (timestamp normalization, role mapping, conversation/message IDs)
- Unit tests: field mapping, both roles, timestamp edge cases

##### PR-7.2: Grok export parser
- Parse Grok export format
- Map fields to MessageAtom schema
- Unit tests: same coverage as Claude parser

##### PR-7.3: Parser registry + auto-detection
- Auto-detection logic (inspect file structure to determine source)
- Source override handling (user can force a parser)
- Integration test: upload file without `sourceOverride`, verify correct parser selected

**Acceptance:**
- All three parsers produce valid MessageAtoms with correct atomStableId
- Auto-detection correctly identifies each source format
- Re-import idempotency works across all parsers

#### Path B: Phase 3b/4b — Real LLM Integration

Prerequisites (set up before writing code):
- API key management (env vars: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)
- Rate limiting strategy (min-delay or token bucket; MUST be await-based, no background timers)
- Spend caps / budget guard (max cost per run/day; abort if exceeded)
- Dry-run mode (log prompt shape + estimated tokens/cost without calling the API)
- Pricing “price book” + cost calculator (per-provider/per-model rates; compute cost from tokens)
- Pricing snapshot for auditability (capture rates into `Run.configJson` at run creation)

##### PR-3b0: LLM plumbing (shared)
**Status:** ✅ Complete
- Provider-agnostic request/response types
- Env-based config (mode, keys, caps)
- Await-based rate limiting (no background loops)
- Spend cap guards (per-run/per-day)
- Dry-run path (no external calls)

##### PR-3b.1: Real classification wiring (mode="real")
**Status:** ✅ Complete (dry-run end-to-end)
- `POST /api/distill/classify` supports `mode: "real"` using LLM plumbing
- Strict JSON output parsing + validation (`category`, `confidence`)
- Idempotent label writes (skip existing labels for same labelSpec)
- Budget exceeded → 402; bad LLM output → 502

##### PR-3b0.1: Pricing book + cost calculator + run pricing snapshot
- Add `src/lib/llm/pricing.ts` with per-provider/per-model rates (source: official provider pricing pages)
- Add `estimateCostUsd({ provider, model, tokensIn, tokensOut, cachedIn? })`
- Wire dry-run and real paths to compute `costUsd` via pricing (dry-run = “would-have-cost”)
- Capture `pricingSnapshot` into `Run.configJson` at run creation for auditability

##### PR-3b.2: Provider SDK integrations (OpenAI/Anthropic)
- Implement real provider calls in `callLlm()` for OpenAI and Anthropic
- Populate `tokensIn`, `tokensOut`, and `costUsd` from usage + pricing book
- Ensure missing keys produce `MISSING_API_KEY` and unknown models produce a clear error

##### PR-4b: Real summarization
- Wire tick summarization to real LLM when model is not `stub_*`
- Track `tokensIn`/`tokensOut`/`costUsd` on Job using pricing book
- Error handling: transient API failures → mark job FAILED (retriable)
- Tests: Output stored with correct hashes; costs visible in run detail

**Suggested order:** PR-3b0.1 (pricing) → PR-3b.2 (SDKs) → PR-4b (summarization)

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
- [ ] 11.4: UI shell shows frozen config exactly as stored; manual tick is sequential; reset increments attempt; per-day view shows output markdown + bundle hashes.
- [ ] 11.5: Search returns results for known strings in MessageAtoms and Outputs; inspector renders markdown and shows pre/post views.

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
