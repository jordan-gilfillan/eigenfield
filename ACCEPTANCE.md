# Journal Distiller — Acceptance Checks

> Verification commands and checklists only.
> Requirements: [SPEC.md §11](SPEC.md).
> Audit ledger: [REMEDIATION.md](REMEDIATION.md).

---

## Quick Start: Verify the System

```bash
# 1. Start the database
docker compose up -d

# 2. Run migrations
npx prisma migrate dev

# 3. Seed the database
npx prisma db seed

# 4. Run all tests
npm test

# 5. Start the dev server
npm run dev
```

If all tests pass and the server starts, the core system is functional.

---

## Test Suites

The codebase includes comprehensive tests. Run them to verify each component:

```bash
# All tests
npm test

# Specific test directories
npm test -- src/__tests__/parsers/
npm test -- src/__tests__/services/
npm test -- src/__tests__/
npm test -- src/lib/services/__tests__/

# Watch mode for development
npm test -- --watch
```

### Test Coverage by Component

| Component | Test File | What It Verifies |
|-----------|-----------|------------------|
| **Unit tests** | | |
| Stable IDs | `src/__tests__/stableId.test.ts` | atomStableId is deterministic |
| Timestamps | `src/__tests__/timestamp.test.ts` | Canonical timestamp formatting |
| Normalization | `src/__tests__/normalize.test.ts` | Text normalization |
| Bundle Hash | `src/__tests__/bundleHash.test.ts` | Bundle hash computation |
| RawEntry | `src/__tests__/rawEntry.test.ts` | RawEntry per source per day |
| Enums | `src/__tests__/enums.test.ts` | Enum type guards and values |
| **Parsers** | | |
| ChatGPT Parser | `src/__tests__/parsers/chatgpt.test.ts` | Parses ChatGPT JSON exports correctly |
| Claude Parser | `src/__tests__/parsers/claude.test.ts` | Parses Claude JSON exports correctly |
| Grok Parser | `src/__tests__/parsers/grok.test.ts` | Parses Grok JSON exports correctly |
| Parser Auto-detect | `src/__tests__/parsers/autodetect.test.ts` | Format detection + registry wiring |
| **LLM** | | |
| LLM Config | `src/__tests__/llm-config.test.ts` | LLM configuration loading |
| LLM Errors | `src/__tests__/llm-errors.test.ts` | LLM error types and codes |
| LLM Budget | `src/__tests__/llm-budget.test.ts` | Budget tracking and enforcement |
| LLM Rate Limit | `src/__tests__/llm-rateLimit.test.ts` | Rate limiting |
| LLM Pricing | `src/__tests__/llm-pricing.test.ts` | Pricing book + cost estimation |
| LLM Client (stub) | `src/__tests__/llm-client.test.ts` | LLM client dry-run mode |
| LLM Client (real) | `src/__tests__/llm-client-real.test.ts` | LLM client real mode routing |
| OpenAI Provider | `src/__tests__/llm-provider-openai.test.ts` | OpenAI Responses API wrapper |
| Anthropic Provider | `src/__tests__/llm-provider-anthropic.test.ts` | Anthropic Messages API wrapper |
| **Import services** | | |
| Import (ChatGPT) | `src/__tests__/services/import.test.ts` | Import service for ChatGPT exports |
| Import (Claude) | `src/__tests__/services/import-claude.test.ts` | Import service for Claude exports |
| Import (Grok) | `src/__tests__/services/import-grok.test.ts` | Import service for Grok exports |
| Import (auto-detect) | `src/__tests__/services/import-autodetect.test.ts` | Import with format auto-detection |
| **Classify services** | | |
| Classify (stub) | `src/__tests__/services/classify.test.ts` | Stub classification is deterministic |
| Classify (real) | `src/__tests__/services/classify-real.test.ts` | Real-mode classify pipeline |
| Classify Audit Trail | `src/__tests__/services/classify-audit-trail.test.ts` | Classification audit trail |
| Classify Stats | `src/__tests__/services/classify-stats.test.ts` | ClassifyRun stats persistence |
| Classify Progress | `src/__tests__/services/classify-progress.test.ts` | Classify progress polling |
| **Run + tick services** | | |
| Run Aggregates | `src/__tests__/services/run-aggregates.test.ts` | Run aggregate totals (partial usage) |
| Seed Invariants | `src/__tests__/seed-invariants.test.ts` | Seed idempotency + active-per-stage |
| Bundle Service | `src/lib/services/__tests__/bundle.test.ts` | Bundle ordering and hashing |
| Run Service | `src/lib/services/__tests__/run.test.ts` | Run creation with frozen config |
| Tick Service | `src/lib/services/__tests__/tick.test.ts` | Job processing and status transitions |
| Tick (real summarize) | `src/lib/services/__tests__/tick-real-summarize.test.ts` | Tick with real LLM summarization |
| Advisory Lock | `src/lib/services/__tests__/advisory-lock.test.ts` | Concurrent tick prevention |
| Segmentation | `src/lib/services/__tests__/segmentation.test.ts` | Deterministic segment splitting |
| Run Controls | `src/lib/services/__tests__/run-controls.test.ts` | Cancel/resume/reset operations |
| **Inspectors + search** | | |
| Import Inspector | `src/lib/services/__tests__/import-inspector.test.ts` | Import batch inspection |
| Run Inspector | `src/lib/services/__tests__/run-inspector.test.ts` | Run detail inspection |
| Search | `src/lib/services/__tests__/search.test.ts` | Search service + FTS + filters |
| Pricing Integration | `src/lib/services/__tests__/pricing-integration.test.ts` | Pricing snapshot integration |

---

## Core Acceptance Tests

### AC-01: No Silent Data Loss on Import

**Spec ref:** SPEC.md §11.1

**Tested in:** `src/__tests__/services/import.test.ts`

**Manual verification:**
1. Create a test export with two "Hello" messages at different times
2. Import via POST `/api/distill/import`
3. Query MessageAtoms: should have 2 entries with different timestamps but same text

---

### AC-02: Deterministic atomStableId

**Spec ref:** SPEC.md §11.2

**Tested in:** `src/__tests__/stableId.test.ts`

**Manual verification:**
1. Import a file
2. Note the atomStableId for a specific message
3. Delete the import batch
4. Re-import the same file
5. The same message should have the identical atomStableId

---

### AC-03: Frozen Run Config

**Spec ref:** SPEC.md §11.2

**Tested in:** `src/lib/services/__tests__/run.test.ts`

**Manual verification:**
1. Create a run with the current active summarize prompt
2. Note the `config.promptVersionIds.summarize` in the response
3. Update the active summarize prompt to a new version
4. Process the run via `/tick`
5. Check Output.promptVersionId matches the original frozen ID

---

### AC-04: Label Spec Filtering

**Spec ref:** SPEC.md §11.2

**Tested in:** `src/lib/services/__tests__/bundle.test.ts`

**Manual verification:**
1. Import a file
2. Classify with `stub_v1` model
3. Create a run with `labelSpec: { model: "stub_v1", promptVersionId: "..." }`
4. Atoms without labels matching that spec are excluded
5. Classify again with `stub_v2` (hypothetically)
6. Original run still uses only `stub_v1` labels

---

### AC-05: Sequential Tick Processing

**Spec ref:** SPEC.md §11.3

**Tested in:** `src/lib/services/__tests__/advisory-lock.test.ts`

**Manual verification:**
1. Create a run with multiple jobs
2. Start a tick that processes slowly (or add artificial delay)
3. While it's running, send another tick request
4. Second request should return 409 `TICK_IN_PROGRESS`

---

### AC-06: Deterministic Bundle Ordering

**Spec ref:** SPEC.md §11.2

**Tested in:** `src/lib/services/__tests__/bundle.test.ts`

**Manual verification:**
1. Create a run
2. Process day 1
3. Note the bundleHash in the output
4. Reset the job for day 1
5. Process again
6. bundleHash should be identical

---

### AC-07: RawEntry Per Source Per Day

**Spec ref:** SPEC.md §11.1

**Tested in:** `src/__tests__/services/import.test.ts`

**Manual verification:**
1. Import a ChatGPT file covering Jan 15
2. Import a Claude file also covering Jan 15
3. Query RawEntries for Jan 15: should have 2 (one per source)

---

### AC-08: Run Status Transitions

**Spec ref:** SPEC.md §11.3

**Tested in:** `src/lib/services/__tests__/tick.test.ts`

---

### AC-09: Job Reset and Reprocess

**Spec ref:** SPEC.md §11.3

**Tested in:** `src/lib/services/__tests__/run-controls.test.ts`

**Manual verification:**
1. Create a run with 3 days
2. Process all jobs to completion
3. Reset job for day 2 via POST `/api/distill/runs/:runId/jobs/:dayDate/reset`
4. Day 2 should be `queued`, days 1 and 3 remain `succeeded`
5. Process ticks again
6. Day 2 is reprocessed; new Output replaces old

---

### AC-10: Run Control Idempotency

**Spec ref:** SPEC.md §11.3

**Tested in:** `src/lib/services/__tests__/run-controls.test.ts`

**Error codes:**
- Cancel on completed run: 400 `ALREADY_COMPLETED`
- Resume on cancelled run: 400 `CANNOT_RESUME_CANCELLED`
- Reset on cancelled run: 400 `CANNOT_RESET_CANCELLED`
- Not found: 404 `NOT_FOUND`

---

### AC-11: Deterministic Segmentation

**Spec ref:** SPEC.md §11.2

**Tested in:** `src/lib/services/__tests__/segmentation.test.ts`

**Segment metadata in Output.outputJson.meta:**
- `segmented: true/false`
- `segmentCount: number`
- `segmentIds: string[]`

---

### AC-12: Resume Continues from Failed Jobs Only

**Spec ref:** SPEC.md §11.3

**Tested in:** `src/lib/services/__tests__/run-controls.test.ts`

---

### AC-13: Cancel is Terminal

**Spec ref:** SPEC.md §11.3

**Tested in:** `src/lib/services/__tests__/run-controls.test.ts`

---

### AC-14: Canonical Timestamp Format

**Spec ref:** SPEC.md §11.2

**Tested in:** `src/__tests__/timestamp.test.ts`

---

### AC-15: UI Shell (Phase 5) — Operability + Inspection

**Spec ref:** SPEC.md §11.4

**Manual verification:**
1. Navigate to `/distill` and select an existing ImportBatch (do not re-import).
2. Create a run and confirm navigation to `/distill/runs/:runId`.
3. On the run detail page:
   - Frozen config values are displayed exactly as stored in `Run.configJson` (promptVersionIds, labelSpec, filterProfileSnapshot, timezone, maxInputTokens).
   - Job table renders (dayDate, status, attempt, tokens, cost, error).
   - Reset a single day; confirm only that job becomes `queued` and `attempt` increments.
   - Click Tick repeatedly to process jobs.
4. Verify tick is sequential and user-driven:
   - UI disables Tick while a tick request is in-flight.
   - No background polling loops (no `setInterval` fire-and-forget).
   - If you try to trigger another tick while one is in-flight, UI prevents it.
5. For a processed day, verify the page can show:
   - Output markdown
   - `bundleHash` and `bundleContextHash`
   - Segmentation metadata when present (`segmented`, `segmentCount`, `segmentIds` from `Output.outputJson.meta`).

---

See [SPEC.md §7](SPEC.md) for API contracts and expected response shapes.

---

## Database Integrity Checks

### Verify Unique Constraints

```sql
-- Should return 0 rows (no duplicate atomStableIds)
SELECT atomStableId, COUNT(*)
FROM "MessageAtom"
GROUP BY atomStableId
HAVING COUNT(*) > 1;

-- Should return 0 rows (no duplicate labels for same spec)
SELECT "messageAtomId", "promptVersionId", model, COUNT(*)
FROM "MessageLabel"
GROUP BY "messageAtomId", "promptVersionId", model
HAVING COUNT(*) > 1;

-- Should return 0 rows (no duplicate RawEntries)
SELECT "importBatchId", source, "dayDate", COUNT(*)
FROM "RawEntry"
GROUP BY "importBatchId", source, "dayDate"
HAVING COUNT(*) > 1;
```

### Verify Referential Integrity

```sql
-- All MessageAtoms should have valid ImportBatch
SELECT COUNT(*) FROM "MessageAtom" ma
LEFT JOIN "ImportBatch" ib ON ma."importBatchId" = ib.id
WHERE ib.id IS NULL;  -- Should be 0

-- All Jobs should have valid Run
SELECT COUNT(*) FROM "Job" j
LEFT JOIN "Run" r ON j."runId" = r.id
WHERE r.id IS NULL;  -- Should be 0
```

---

## Performance Benchmarks (Informative)

These are guidelines, not hard requirements for v0.3:

| Operation | Target | Notes |
|-----------|--------|-------|
| Import 10K messages | < 30s | Includes atom creation and RawEntry |
| Stub classify 10K atoms | < 10s | Hash-based, no LLM calls |
| Build bundle for 100 atoms | < 100ms | In-memory sort and render |
| Tick with 1 job (stub) | < 500ms | Including lock acquire/release |

---

## Manual Smoke Test Checklist

Before release, verify these work manually:

**Import & Classify:**
- [ ] Import a ChatGPT export file
- [ ] Import a Claude export file
- [ ] View import stats in response
- [ ] Classify import with stub mode

**Run Execution:**
- [ ] Create a run with professional-only filter
- [ ] Tick until all jobs complete
- [ ] Verify outputs exist in database

**Segmentation:**
- [ ] Create a run with `maxInputTokens: 100` (forces segmentation on most days)
- [ ] Tick to process a job
- [ ] Verify Output.outputJson.meta contains `segmented: true`, `segmentCount`, `segmentIds`
- [ ] Verify outputText contains `## Segment 1`, `## Segment 2`, etc.

**Run Controls:**
- [ ] Reset a specific job
- [ ] Reprocess the reset job (attempt counter increments)
- [ ] Cancel a queued run
- [ ] Verify cancelled run cannot be resumed via tick (returns processed=0)
- [ ] Verify resume on cancelled run returns 400 CANNOT_RESUME_CANCELLED
- [ ] Create a new run, fail a job manually, resume, verify only failed job requeued

**UI Shell (Phase 5):**
- [ ] Open `/distill` and select an existing ImportBatch
- [ ] Create a run from the dashboard and land on `/distill/runs/:runId`
- [ ] Confirm frozen config block matches `Run.configJson` values
- [ ] Tick manually until at least one job succeeds
- [ ] Reset one day and confirm attempt increments + job returns to queued
- [ ] Confirm Tick is sequential (button disabled during request; no overlapping requests)
- [ ] Confirm output viewer shows markdown + `bundleHash` + `bundleContextHash`
- [ ] If segmented, confirm UI shows `segmented`, `segmentCount`, `segmentIds`

---

## Regression Prevention

When adding features or fixing bugs:

1. **Add a failing test first** that demonstrates the issue
2. **Fix the code** to make the test pass
3. **Update this document** if acceptance criteria change
4. **Update SPEC.md** if behavior contracts change

The test suite is the executable acceptance criteria. If tests pass, the system meets spec.
