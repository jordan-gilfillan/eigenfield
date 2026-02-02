# Journal Distiller — Architecture Decision Records

> Each decision captures: what we chose, why, and what we gave up. These are drafts—they document the reasoning at implementation time, not immutable truths.

---

## ADR-001: Deterministic Stable IDs via SHA-256

### Context
We need to reference atoms, bundles, and outputs across re-imports, runs, and downstream tools. Random UUIDs break reproducibility. DB-generated IDs depend on insertion order.

### Decision
Use SHA-256 hashes of canonical inputs as stable identifiers:
- `atomStableId`: hash of source + conversationId + messageId + timestamp + role + textHash
- `bundleHash`: hash of exact bundle text
- `bundleContextHash`: hash of inputs that produced the bundle

### Consequences
**Good:**
- Same input always produces same ID
- Re-importing a file produces identical atomStableIds
- Auditable: you can verify the ID by recomputing the hash

**Tradeoff:**
- IDs are long hex strings (64 chars), not human-readable
- Changing normalization rules requires version bumps (hence `atom_v1`, `bundle_v1`)
- Hash collisions are theoretically possible but practically negligible for SHA-256

### Alternatives Considered
- **UUIDs**: Simple but non-deterministic
- **Composite natural keys**: Complex joins, can't encode in a single string
- **Content-addressable storage (CAS)**: Overkill for our scale

---

## ADR-002: Frozen Run Config for Reproducibility

### Context
Users might change prompts, filters, or classifier settings between creating a run and processing jobs. Without freezing, we'd get inconsistent outputs within the same run.

### Decision
When a run is created, snapshot all relevant config into `Run.configJson`:
- `promptVersionIds` (summarize, optionally redact)
- `labelSpec` (which classifier results to use)
- `filterProfileSnapshot` (mode + categories, not just a foreign key)
- `timezone` (from import batch)
- `maxInputTokens`

### Consequences
**Good:**
- Run is reproducible: same config always filters/processes the same way
- Safe to modify active prompts without affecting in-progress runs
- Auditable: stored config shows exactly what was used

**Tradeoff:**
- Storage overhead (duplicated filter profile data)
- Can't "update" a run's config—must create a new run
- If filter profile is deleted, run still has the snapshot (which is the point)

### Alternatives Considered
- **Foreign keys only**: Breaks if referenced entities change
- **Version numbers on entities**: Complex, still need snapshot logic
- **Immutable entities**: Would prevent legitimate prompt updates

---

## ADR-003: Sequential Tick Polling (No Concurrent Ticks)

### Context
The original design allowed parallel job processing, but this caused:
- Race conditions (same job started twice)
- Overlapping API requests overwhelming the system
- Hard-to-debug state corruption

### Decision
- Default to 1 job per tick
- Use Postgres advisory locks to prevent concurrent ticks per run
- UI must wait for tick response before requesting next tick
- Return 409 `TICK_IN_PROGRESS` if lock can't be acquired

### Consequences
**Good:**
- Simple mental model: one thing happens at a time
- No race conditions on job status transitions
- Easy to debug: state changes are sequential
- Advisory locks are session-scoped, automatically released on disconnect

**Tradeoff:**
- Slower for large runs (sequential, not parallel)
- UI must implement sequential polling (can't just `setInterval`)
- Requires dedicated Postgres connection for reliable lock handling

### Alternatives Considered
- **Optimistic locking with retry**: Complex, still has edge cases
- **Job queue (BullMQ/Redis)**: Infrastructure overhead, out of scope for v0.3
- **Row-level locking**: Finer-grained but more complex to reason about

---

## ADR-004: Labels Versioned by (atom, promptVersion, model)

### Context
The same atom might be classified multiple times:
- Different classifier prompts
- Different models
- Re-classification with improved prompts

Old labels shouldn't contaminate new runs.

### Decision
`MessageLabel` uniqueness is `(messageAtomId, promptVersionId, model)`. A run's filtering uses only labels matching its `labelSpec`.

### Consequences
**Good:**
- Can A/B test classifiers without data loss
- Old labels preserved for audit
- Run filtering is deterministic given its labelSpec
- No "which label is current?" ambiguity

**Tradeoff:**
- Must specify labelSpec when creating runs
- Atoms without matching labels are treated as unlabeled (excluded)
- Storage grows with each classification pass

### Alternatives Considered
- **Single label per atom**: Loses history, can't compare classifiers
- **"Current" flag on labels**: Mutable state, hard to audit
- **Label versioning via timestamps**: Ambiguous, timezone-dependent

---

## ADR-005: RawEntry as Unfiltered Cache

### Context
UI needs fast display of "what was imported today" without re-joining MessageAtoms. But filtering happens per-run with different filter profiles.

### Decision
`RawEntry` contains **all** messages for a (source, day) pair, with no filtering applied:
- Created at import time
- Never modified by classification or filtering
- Uses deterministic sort order for rendering

Filtering happens at query/bundle time using MessageLabels.

### Consequences
**Good:**
- Fast UI rendering without joins
- Single source of truth for "raw" import data
- Filter profiles can change without invalidating RawEntries
- Search can index full content

**Tradeoff:**
- Contains sensitive content even after "safety-exclude" filtering
- Larger storage than filtered caches would be
- Must be recomputed if normalization rules change

### Alternatives Considered
- **No cache, always join atoms**: Slow for large days
- **Pre-filtered caches per profile**: Combinatorial explosion
- **Lazy materialization**: Complex cache invalidation

---

## ADR-006: Stub Mode for Testing

### Context
Real LLM calls are:
- Slow (seconds per request)
- Expensive (API costs)
- Non-deterministic (model temperature, API changes)
- Rate-limited

Testing needs fast, free, deterministic results.

### Decision
Implement stub classifiers and summarizers:
- `stub_v1` classifier: category = `hash(atomStableId) % N`
- `stub_summarizer_v1`: returns predictable markdown with stats
- Zero cost, instant response, fully deterministic

### Consequences
**Good:**
- Tests run in milliseconds
- No API keys needed for CI
- Results are reproducible across environments
- Can test full pipeline without spending money

**Tradeoff:**
- Stub outputs aren't meaningful (just stats, not real summaries)
- Must test real LLM path separately (Phase 3b/4 continued)
- Two code paths to maintain

### Alternatives Considered
- **Mocked HTTP responses**: Brittle, requires mock maintenance
- **Test-only in-memory DB**: Doesn't test real Postgres behavior
- **Reduced-rate real calls**: Still slow and costs money

---

## ADR-007: ISO 8601 Timestamps with Millisecond Precision

### Context
Different sources provide timestamps in various formats:
- Unix seconds
- Unix milliseconds
- ISO strings with/without timezone
- Local time with timezone offset

Day bucketing depends on consistent timestamp handling.

### Decision
Canonical format is RFC 3339 / ISO 8601 in UTC:
```
YYYY-MM-DDTHH:mm:ss.SSSZ
```
- Always UTC (Z suffix)
- Always milliseconds (even if .000)
- Stored as `DateTime` in DB, rendered consistently

### Consequences
**Good:**
- Single format for all sources
- Lexicographic sorting works
- No timezone ambiguity in storage
- Day bucketing uses import batch's timezone at query time

**Tradeoff:**
- Sources without millisecond precision get `.000`
- Must parse/convert various input formats
- Display may need localization (not in v0.3)

### Alternatives Considered
- **Unix timestamps only**: Lose precision info, harder to read
- **Source-native formats**: Inconsistent, complex comparisons
- **Local time storage**: Timezone bugs

---

## ADR-008: Postgres Advisory Locks for Tick Concurrency

### Context
Need to prevent concurrent `/tick` calls from processing the same run simultaneously. Row-level locks are complex with ORM pooling.

### Decision
Use Postgres advisory locks:
- `pg_try_advisory_lock(key)` with key derived from runId
- Session-scoped (released on disconnect)
- Use dedicated connection to avoid pool returning different session

Return 409 if lock can't be acquired.

### Consequences
**Good:**
- Database-level guarantee
- Automatic cleanup on connection close
- Simple semantics: acquire or fail
- Works across multiple server instances

**Tradeoff:**
- Requires numeric key (hash runId to int64)
- Pool management complexity
- Lock not released if process crashes mid-tick (clears on reconnect)

### Alternatives Considered
- **Application-level mutex**: Doesn't work multi-instance
- **Redis distributed lock**: Extra infrastructure
- **Status-based optimistic locking**: Race window between check and update

---

## ADR-009: Bundle Ordering for Determinism

### Context
Multiple messages might have the same timestamp (especially with second precision). The bundle must be identical across re-runs.

### Decision
Sort bundle entries by:
1. `source` ASC (alphabetical: chatgpt, claude, grok)
2. `timestampUtc` ASC
3. `role` ASC (user before assistant)
4. `atomStableId` ASC (tie-breaker)

### Consequences
**Good:**
- Fully deterministic
- atomStableId tie-breaker handles all edge cases
- Same filtering produces same bundleHash
- User messages appear before assistant responses at the same timestamp (semantic ordering)

**Tradeoff:**
- Ordering by source groups similar content (may not be chronological across sources)
- Adding a source changes bundle structure

### Alternatives Considered
- **Pure chronological**: Ties need arbitrary resolution
- **Source-first without stable sort**: Non-deterministic ties
- **Random-but-seeded**: Harder to audit/debug

---

## ADR-010: Category Enum vs Custom Taxonomy

### Context
Users might want custom categories. But custom taxonomies require:
- UI for editing
- Prompt rewriting to understand new categories
- Migration paths
- Testing combinatorics

### Decision
Fixed category enum for v0.3:
- Core: WORK, LEARNING, CREATIVE, MUNDANE, PERSONAL, OTHER
- Risk: MEDICAL, MENTAL_HEALTH, ADDICTION_RECOVERY, INTIMACY, FINANCIAL, LEGAL
- Additional: EMBARRASSING

### Consequences
**Good:**
- Simple implementation
- Prompts can be hand-tuned for known categories
- Filter profiles are combinations of fixed set
- No migration needed for taxonomy changes

**Tradeoff:**
- Can't add custom categories without code change
- "OTHER" is a catch-all
- Some content might not fit neatly

### Alternatives Considered
- **Freeform string tags**: No structure, hard to filter
- **User-defined categories**: UI complexity, prompt complexity
- **Hierarchical taxonomy**: Overkill for v0.3

---

## ADR-011: Single-File Import (No Multi-File Zip)

### Context
Users might want to upload multiple export files at once. But this adds:
- File format detection complexity
- Deduplication across files
- Mixed-source handling
- UI for file selection

### Decision
v0.3 accepts one file per ImportBatch. The `mixed` source type is reserved but not implemented.

### Consequences
**Good:**
- Simple parsing logic
- Clear file-to-batch mapping
- Each import is independent

**Tradeoff:**
- Multiple files require multiple imports
- Can't combine ChatGPT + Claude in one batch
- User must manage multiple import batches

### Alternatives Considered
- **ZIP upload**: Complex extraction, format detection
- **Multiple file inputs**: Complex UI, ordering questions
- **Automatic deduplication across imports**: Dangerous, silent data decisions

---

## ADR-012: No Auto-Retry, Manual Resume Only

### Context
Jobs might fail due to transient errors (rate limits, network issues). Auto-retry systems add:
- Backoff logic
- Retry limits
- Idempotency concerns
- State complexity

### Decision
v0.3 uses manual resume only:
- Failed jobs stay failed
- User can reset specific jobs via `/reset` endpoint
- Resume requeues all failed jobs for another attempt

### Consequences
**Good:**
- Simple state machine
- User controls when to retry
- No runaway retry loops
- Easy to debug (explicit state changes)

**Tradeoff:**
- Transient failures require manual intervention
- No exponential backoff
- Large batches might need many manual resumes

### Alternatives Considered
- **Automatic retry with limit**: State complexity
- **Background retry queue**: Infrastructure dependency
- **Retry on next tick**: Unclear when to give up

---

## ADR-013: Deterministic Segmentation (segmenter_v1)

### Context
Day bundles can exceed the LLM context window (`maxInputTokens`). We need to split large bundles into segments while maintaining determinism and auditability.

### Decision
Implement `segmenter_v1` with greedy packing:
1. Estimate tokens for each atom (chars / 4 heuristic)
2. Pack atoms into segments until `maxInputTokens` exceeded
3. Never split an atom across segments
4. Generate stable segment IDs: `sha256("segment_v1|" + bundleHash + "|" + segmentIndex)`
5. Concatenate segment summaries with `## Segment <k>` headers

### Consequences
**Good:**
- Deterministic: same atoms + config always produces same segments
- Auditable: segment IDs can be verified by recomputing hash
- Preserves atom boundaries (no mid-message splits)
- Works with any maxInputTokens value

**Tradeoff:**
- Greedy packing may not be optimal (last segment could be small)
- Header overhead (~20 tokens per source) is estimated, not exact
- No "merge summaries" step in v0.3 (simple concatenation)
- Segment boundaries may split conversation context

### Alternatives Considered
- **Sliding window with overlap**: Complex, duplicates content
- **Semantic chunking**: Requires understanding of content, non-deterministic
- **Fixed-size segments**: Ignores atom boundaries, may split mid-message
- **Two-pass with merge**: More LLM calls, higher cost

---

## ADR-014: Run Control State Machine (Cancel/Resume/Reset)

### Context
Users need to:
- Stop a run that's taking too long or using wrong config
- Retry failed jobs without reprocessing succeeded ones
- Reprocess specific days that "succeeded but wrong"

### Decision
Simple three-operation state machine:
- **Cancel**: Marks run and queued jobs as CANCELLED. Terminal—cannot be undone.
- **Resume**: Requeues FAILED jobs to QUEUED, sets run to QUEUED. Preserves succeeded jobs.
- **Reset**: Deletes outputs for specific job, increments attempt, requeues. For "succeeded but wrong."

Terminal status rule: cancelled runs cannot transition to any other status.

### Consequences
**Good:**
- Simple mental model (three clear operations)
- Preserves work: resume doesn't reprocess succeeded jobs
- Auditable: attempt counter tracks reprocessing history
- Terminal cancel prevents zombie runs

**Tradeoff:**
- Cannot undo cancel (must create new run)
- Reset deletes outputs (no history preserved)
- No partial cancel (all queued jobs cancelled together)
- Manual operation required (no automatic recovery)

### Alternatives Considered
- **Soft cancel with restore**: Complex state machine
- **Output versioning**: Storage overhead, which version to use?
- **Per-job cancel**: Complicates run status calculation
- **Automatic retry on resume**: Conflicts with ADR-012 (manual only)
