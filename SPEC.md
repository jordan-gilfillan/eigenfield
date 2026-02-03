# Journal Distiller — Canonical Spec (Fresh Start) v0.3.0-draft

> This document is the single source of truth. If code, README, or UI disagree with this spec, the spec wins.

## 0) Bottleneck → Spec → Lever

**Bottleneck:** project drift + silent footguns (non-determinism, dedupe/data loss, unpinned prompt/label versions, polling pile-ups).

**Spec:** this file defines the stable contracts (IDs, schemas, API behavior, deterministic bundling, UI affordances).

**Levers (highest ROI):**
1) **Stable IDs** for atoms/bundles/outputs (referential backbone).
2) **Pinned versions** (prompt versions + label spec) for reproducibility.
3) **Sequential tick** (default 1 job/tick; no overlapping polls) for reliability.
4) **Search + inspector UI** to view “before/after” and debug quickly.

---

## 1) Purpose

Journal Distiller converts AI conversation exports (ChatGPT / Claude / Grok) into:
- normalized **MessageAtoms** (one per message)
- classifier **MessageLabels** (one label per atom)
- per-day **RawEntries** (materialized cache derived from atoms)
- curated per-day **Outputs** (summaries, and later optional redactions)

It exists to generate **auditable, reproducible curated datasets** suitable for downstream tools.

This stays aligned with the original motivation: multi-source ingestion, prompt control/versioning, filtering for “professional-only,” and reproducibility/cost visibility. (See project journal for the why.)

---

## 2) Non-goals (v0.3)

Explicitly out of scope:
- Authentication / multi-user tenancy
- Background job queues (BullMQ/Redis), cron, or serverless scheduling (tick loop only)
- WebSockets / SSE (polling only)
- Mirror QA retrieval UI, embeddings visualization, vector search
- Cloud storage (S3/GCS). Local upload → DB only
- Full export-format compatibility guarantees for every version of every product
- Custom category taxonomy editor
- Automatic prompt rewriting/compilation from user-defined categories
- Auto-retry with backoff (manual resume only)
- Automatic / background tick loops (user-driven tick only in Phase 5)
- Parallel job processing in UI (sequential polling only)
- UI polish / design system work beyond basic layouts (Phase 5 is operability-first)


## 2.1 Implementation stack and local dev (normative for this repo)

To reduce drift, v0.3 pins the implementation stack used by this repository:
- **Web**: Next.js (App Router) + TypeScript
- **DB**: Postgres 16
- **ORM/migrations**: Prisma
- **Runtime**: Node.js LTS

### 2.1.1 Docker Compose requirement
The repo MUST include a `docker-compose.yml` that brings up a local Postgres 16 database with a named volume.

Minimum service contract:
- service name: `db`
- image: `postgres:16`
- exposes `5432:5432`
- persists data in a named volume

Example (informative):
```yaml
services:
  db:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: journal_distill
    volumes:
      - journal_distill_pg:/var/lib/postgresql/data
volumes:
  journal_distill_pg:
```

### 2.1.2 Environment variables
The app MUST read its DB connection from:
- `DATABASE_URL` (required)

Recommended Prisma workflow:
- `prisma migrate dev`
- `prisma db seed`

### 2.1.3 Prisma schema is authoritative
The canonical DB schema for the implementation is `prisma/schema.prisma`.
- It MUST implement all entities and constraints from Section 6.
- If Section 6 and Prisma differ, Section 6 wins and Prisma MUST be updated.

Notes:
- Prisma is used to make migrations repeatable and to keep the app code and DB schema in lockstep.

---

## 3) Definitions

- **ImportBatch**: one upload + parse event.
- **MessageAtom**: one normalized message with stable identity.
- **MessageLabel**: classification result for one atom.
- **RawEntry**: day-bucketed text cache derived from atoms.
- **FilterProfile**: include/exclude rules over categories.
- **Run**: a frozen config snapshot for producing Outputs.
- **Job**: one per (Run, dayDate) eligible day.
- **Output**: model output for a Job and stage (summarize/redact).

---

## 4) Project Constitution (invariants)

These are the “physics laws.” Breaking them requires a spec change + explicit migration plan.

### 4.1 Determinism
- Given identical inputs + identical frozen config, a rerun must build the same day bundle bytes and use the same prompt versions.

### 4.2 No silent data loss
- Import must not drop legitimate repeated messages.
- Any dedupe must be **provably safe** per uniqueness constraints (see 6.2).

### 4.3 Stable IDs
- IDs used for joins, citations, and downstream references must be deterministic and not depend on DB insertion order, random UUIDs, or concurrency.
- If we change an ID algorithm, we must bump a version string and store it.

### 4.4 Reproducibility
- Run config must freeze:
  - summarizer prompt version(s)
  - redactor prompt version(s) (when used)
  - **label spec** used for filtering (classifier promptVersionId + model)
  - filter profile snapshot (not just an FK)

### 4.5 Bounded concurrency
- Default processing: **1 job per tick**.
- UI polling must be sequential (wait for tick response before next tick).

---

## 5) Stable Identity Model

Stable identities are the contract for everything downstream.

### 5.1 Normalization rules
Before hashing, text is normalized as:
- preserve original characters
- normalize line endings to `\n`
- trim trailing whitespace on each line
- preserve leading whitespace (don’t destroy code blocks)

### 5.2 Atom stable ID

**Timestamp canonicalization (required):**
- `timestampUtcISO` MUST be RFC 3339 / ISO 8601 in UTC with **exactly millisecond precision** and a `Z` suffix:
  - format: `YYYY-MM-DDTHH:mm:ss.SSSZ`
  - example: `2024-01-15T10:30:00.000Z`
- If a source has no millisecond precision, set milliseconds to `.000`.
- If a source provides an offset, convert to UTC and render with `Z`.

```
sha256(
  "atom_v1|" + source + "|" + (sourceConversationId||"") + "|" + (sourceMessageId||"") + "|" + timestampUtcISO + "|" + role + "|" + textHash
)
```

Notes:
- `sourceConversationId` and `sourceMessageId` are included when available; if absent, the empty string is used.
- This makes the ID stable across re-imports of the same file and robust against identical text appearing at different times/conversations.

### 5.3 Bundle hash
Two hashes are used for clarity:

- **bundleHash**: hashes the exact bytes of the deterministic bundle text (audit of “what the model saw”).
  
  ```
  sha256("bundle_v1|" + stableBundleText)
  ```

- **bundleContextHash**: hashes the *inputs that produced* the bundle (audit of “why this bundle exists”).

  ```
  sha256(
    "bundle_ctx_v1|" + importBatchId + "|" + dayDate + "|" + sourcesCsv + "|" + filterProfileSnapshotJson + "|" + labelSpecJson
  )
  ```

Notes:
- It is acceptable for different configs to produce identical `stableBundleText`; in that case `bundleHash` matches but `bundleContextHash` differs.
- Outputs MUST store both hashes.

### 5.4 Output stable key
Outputs are referenced by:
- `(runId, dayDate, stage)` (unique)
- and they store `bundleHash` + `bundleContextHash` + `promptVersionId` + `model` for auditing.

---

## 6) Core Data Model (DB)

### 6.1 ImportBatch
Minimum fields:
- id
- createdAt
- source (chatgpt|claude|grok|mixed)
- originalFilename
- fileSizeBytes
- timezone (IANA, e.g. `America/Los_Angeles`)
- statsJson: `{ message_count, day_count, coverage_start, coverage_end, per_source_counts }`

**ImportBatch.source semantics (v0.3):**
- v0.3 import accepts **one file per ImportBatch** and that file MUST parse as exactly one source (chatgpt OR claude OR grok). In this common case, `ImportBatch.source` equals the detected parser.
- `mixed` is reserved for a future “multi-file” import mode (zip or multiple uploads in one request). If `mixed` is ever used, each MessageAtom still carries its real `source`.

### 6.2 MessageAtom
Minimum fields:
- id (DB PK)
- atomStableId (unique)
- importBatchId (FK)
- source (chatgpt|claude|grok)
- sourceConversationId (nullable)
- sourceMessageId (nullable)
- timestampUtc (datetime)
- dayDate (date; derived using ImportBatch.timezone)
- role (user|assistant)
- text
- textHash (sha256 of normalized text)
- createdAt

**Uniqueness (required):**
- `atomStableId` unique

**No-silent-loss rule:**
- Do **not** use `createMany(skipDuplicates:true)` unless duplicates are defined by `atomStableId`.

### 6.3 MessageLabel
Minimum fields:
- id
- messageAtomId (FK)
- category (enum)
- confidence (0.0–1.0)
- model (string)
- promptVersionId (FK)
- createdAt

**Uniqueness (required):**
- (messageAtomId, promptVersionId, model) unique

### 6.4 Category enum (fixed)
Core:
- WORK, LEARNING, CREATIVE, MUNDANE, PERSONAL, OTHER

Risk buckets (for exclusion profiles):
- MEDICAL, MENTAL_HEALTH, ADDICTION_RECOVERY, INTIMACY, FINANCIAL, LEGAL

Additional bucket:
- EMBARRASSING

Notes:
- `EMBARRASSING` is part of the v0.3 schema and classifier taxonomy.
- No default include profile relies on it.

### 6.5 RawEntry
Represents per-source, per-day **raw text cache** derived from MessageAtoms.

Purpose:
- Fast UI display of “what was imported on this day” without re-joining MessageAtoms.
- Optional search indexing later (not required in v0.3).

Construction (required):
- A RawEntry is created for each `(importBatchId, source, dayDate)`.
- `contentText` is a deterministic rendering of *all* MessageAtoms for that day/source **without filtering**:
  - sort by `timestampUtc ASC`, then `role ASC (user before assistant)`, then `atomStableId ASC`
  - render lines as: `[<timestampUtcISO>] <role>: <text>`
- `contentHash = sha256(contentText)`.

Staleness:
- RawEntry is **independent of labeling/filtering** because it contains raw messages; re-labeling does not require recomputing RawEntry.
- If MessageAtom normalization rules change, RawEntry MUST be recomputed via a migration step.

**Uniqueness (required):**
- (importBatchId, source, dayDate) unique

### 6.6 FilterProfile
Fields:
- id
- name
- mode (include|exclude)
- categories (array of enum values)
- createdAt

Seeded profiles (required):
- `professional-only`: include WORK, LEARNING
- `professional-plus-creative`: include WORK, LEARNING, CREATIVE
- `safety-exclude`: exclude MEDICAL, MENTAL_HEALTH, ADDICTION_RECOVERY, INTIMACY, FINANCIAL, LEGAL, EMBARRASSING

Determinism:
- The default profile used by the UI MUST be `professional-only`.

### 6.7 Prompt / PromptVersion
Prompts exist per stage (classify/summarize/redact). One version may be active per stage.

Minimum fields (required):
- Prompt: `id`, `stage (classify|summarize|redact)`, `name`, `createdAt`
- PromptVersion: `id`, `promptId`, `versionLabel` (e.g. `v3`), `templateText`, `createdAt`, `isActive`

Rules:
- Exactly one active PromptVersion per stage at a time (for run creation defaults).
- Runs MUST record the exact PromptVersion IDs used.

### 6.8 Run
Fields:
- id
- status (queued|running|completed|cancelled|failed)
- importBatchId (FK)
- startDate, endDate
- sources[]
- filterProfileId (FK)
- model (string)
- outputTarget ("db" only)
- configJson (frozen snapshot; see below)
- createdAt, updatedAt

`configJson` **must include**:
- `promptVersionIds`: { summarize: <id> } plus:
  - `redact: <id>` only if the run includes a redact stage (not used in v0.3 processing)
  - `classify: <id>` only if the run triggers classification as part of run creation (optional; usually absent in v0.3)
- `labelSpec`: `{ model: <string>, promptVersionId: <id> }` (used for filtering)
- `filterProfileSnapshot`: `{ name, mode, categories[] }`
- `timezone` (MUST equal ImportBatch.timezone; runs may not override)

### 6.9 Job
Fields:
- id
- runId (FK)
- dayDate
- status (queued|running|succeeded|failed|cancelled)
- attempt (int)
- startedAt, finishedAt
- tokensIn, tokensOut
- costUsd
- error

**Uniqueness (required):**
- (runId, dayDate) unique

### 6.10 Output
Fields:
- id
- jobId (FK)
- stage (summarize|redact)
- outputText (string; markdown)
- outputJson (json; structured fields)
- model
- promptVersionId
- bundleHash
- bundleContextHash
- createdAt

**Uniqueness (required):**
- (jobId, stage) unique

---

## 7) User-facing workflow

### 7.1 Import
UI: `/distill/import`

POST `/api/distill/import`
- Input: multipart upload (`file`) + optional `sourceOverride` + optional `timezone`
- Defaults:
  - If `timezone` is omitted, it defaults to `America/Los_Angeles`.
  - v0.3 default behavior is **import only** (no auto-classification).
- Behavior:
  1) Detect source (or honor override)
  2) Parse messages **including both roles** (user + assistant)
  3) Create MessageAtoms with atomStableId
  4) v0.3 default: do NOT create MessageLabels during import; the user triggers classification via `/api/distill/classify`.
  5) Materialize RawEntries per (source, dayDate)
  6) Return import summary stats

Import summary must show:
- filename, size
- detected source
- date coverage
- total messages
- total days
- per-source counts

UI must include a **“Use this import”** CTA that routes to `/distill` with the ImportBatch preselected.

### 7.2 Classify (if not auto-run)
POST `/api/distill/classify`
- Input: `{ importBatchId, model, promptVersionId, mode: real|stub }`
- Output: progress + counts

Stub mode must be deterministic for tests.

**Deterministic stub algorithm (stub_v1):**
- For each MessageAtom, compute `h = sha256(atomStableId)`.
- Map to a category via `index = uint32(h[0..3]) % N`, where `N` is the number of **core** categories: `[WORK, LEARNING, CREATIVE, MUNDANE, PERSONAL, OTHER]`.
- Set `confidence = 0.5`.
- Record `model = "stub_v1"` and `promptVersionId` pointing at a seeded `classify_stub_v1` PromptVersion.

### 7.3 Run creation
UI: `/distill` dashboard

POST `/api/distill/runs`
- Input: `{ importBatchId, startDate, endDate, sources[], filterProfileId, model, outputTarget:"db" }`
- Behavior:
  1) Freeze `promptVersionIds` for summarize/redact (and classify if needed)
  2) Freeze `labelSpec` for filtering (classifier model + promptVersionId)
  3) Freeze `filterProfileSnapshot`
  4) Determine eligible days: days where at least one MessageAtom matches
     - importBatchId
     - sources
     - date range
     - has a MessageLabel matching **labelSpec**
     - passes filter profile
  5) Create one Job per eligible day
  6) If 0 eligible days → return HTTP 400 with a structured error (see 7.7 Error conventions).

### 7.4 Process (tick loop)
POST `/api/distill/runs/:runId/tick`
- Default processes **up to N queued jobs, N=1**.
- Must be safe under repeated calls and concurrency:
  - a job cannot be started twice
  - a run cannot have overlapping active ticks

**Concurrency guard (required):**
- The tick handler MUST acquire a per-run DB-level guard before starting work.
- MUST use a Postgres advisory lock using a stable lock key derived from `runId`.
- Advisory locks are **session-scoped** in Postgres.
  - The implementation MUST ensure the lock is acquired and released on the **same DB session/connection**.
  - If using a pooled ORM client (e.g., Prisma), the implementation MAY use a dedicated Postgres client connection for lock acquire/release to avoid releasing on a different pooled session.
- If the guard cannot be acquired, return HTTP 409 `{ error: { code: "TICK_IN_PROGRESS", message: "Tick already in progress" } }`.

UI polling:
- sequential: wait for each tick response before next tick
- no `setInterval` fire-and-forget
- The UI MUST NOT use setInterval for tick; it must be a sequential loop (manual or controlled play button).

### 7.5 Inspect
UI: `/distill/runs/:runId`
Must show:
- run config snapshot (import + prompts + labelSpec + filter snapshot)
- progress summary
- job table (status, tokens, cost, errors)
- per-day output viewer (rendered markdown)
- input inspector (see 10)

### 7.5.1 Phase 5 UI Shell (minimum operability slice)

Goal: make the system operable and debuggable end-to-end without adding new backend dependencies.

UI invariants (non-negotiable):
- No background polling loops. Tick is user-driven.
- No overlapping tick requests. The UI MUST await each tick response before sending the next.
- No “magic” side effects: buttons map 1:1 to API calls (import, classify, create run, tick, cancel, resume, reset).
- The UI must surface the frozen run config snapshot exactly as stored (no recomputation).

Minimum pages:
1) /distill (dashboard)
   - ImportBatch selector (must allow selecting an existing batch; default can be latest)
   - Date range picker
   - Sources selector
   - FilterProfile selector (default professional-only)
   - Model selector
   - Create Run CTA
   - Optional: link to latest runs list

2) /distill/runs/:runId (run detail)
   - Frozen config block (promptVersionIds, labelSpec, filterProfileSnapshot, timezone, maxInputTokens)
   - Progress summary (queued/running/succeeded/failed/cancelled)
   - Job table with per-day controls (reset day)
   - Manual Tick control (single request; show last tick result)
   - Output viewer (render markdown)
   - Input inspector (bundle text + bundleHash + bundleContextHash + segment metadata when present)

Minimum per-job inspector affordances:
- Show bundleHash and bundleContextHash.
- If segmented, show: segmented, segmentCount, segmentIds from Output.outputJson.meta.

Not required in Phase 5:
- Search UI
- Highlighting matches
- Import inspector day browser (can be Phase 6)
- Any charts/visualizations

### 7.6 Resume / Cancel
- Cancel: marks run cancelled and cancels queued jobs
- Resume: resets FAILED jobs back to QUEUED and sets run status back to QUEUED

Terminal status rule:
- If a Run is `cancelled`, tick processing MUST NOT transition it back to any non-terminal status (e.g., `running`, `queued`, `failed`, `completed`). Cancellation is authoritative.

### 7.7 Reset / Reprocess (rollback strategy)
To handle “succeeded but wrong” days, the API MUST support resetting specific days.

POST `/api/distill/runs/:runId/jobs/:dayDate/reset`
- Deletes Outputs for that job (all stages)
- Sets Job.status back to QUEUED
- Increments `attempt`

This enables targeted reprocessing without rerunning the whole date range.

Note (crash/manual recovery):
- v0.3 does not include automatic recovery for jobs stuck in `running` due to process crashes.
- The intended recovery mechanism is manual reset via this endpoint (and, if needed, marking the job back to `queued`).

### 7.8 Error conventions
All API errors use:

```json
{ "error": { "code": "STRING", "message": "Human readable", "details": { "...": "..." } } }
```

Conventions:
- 400 for validation / no eligible data (`NO_ELIGIBLE_DAYS`, `INVALID_INPUT`)
- 404 for missing resources (`NOT_FOUND`)
- 409 for concurrency conflicts (`TICK_IN_PROGRESS`)
- 500 for unexpected errors (`INTERNAL`)

Job.error:
- MUST store a structured object serialized as JSON string, containing at minimum: `{ code, message, at, retriable }`.
- MUST NOT store full stack traces by default in UI (keep them in server logs).

---

### 7.9 Success response schemas (normative)

All success responses are JSON.

#### POST /api/distill/import
Returns:

```json
{
  "importBatch": {
    "id": "string",
    "createdAt": "RFC3339",
    "source": "chatgpt|claude|grok",
    "originalFilename": "string",
    "fileSizeBytes": 0,
    "timezone": "IANA",
    "stats": {
      "message_count": 0,
      "day_count": 0,
      "coverage_start": "YYYY-MM-DD",
      "coverage_end": "YYYY-MM-DD",
      "per_source_counts": {"chatgpt": 0, "claude": 0, "grok": 0}
    }
  },
  "created": {
    "messageAtoms": 0,
    "rawEntries": 0
  },
  "warnings": ["string"]
}
```

Notes:
- `warnings` MAY be empty.

#### POST /api/distill/classify
Returns:

```json
{
  "importBatchId": "string",
  "labelSpec": {"model": "string", "promptVersionId": "string"},
  "mode": "real|stub",
  "totals": {
    "messageAtoms": 0,
    "labeled": 0,
    "newlyLabeled": 0,
    "skippedAlreadyLabeled": 0
  }
}
```

#### POST /api/distill/runs
Returns:

```json
{
  "id": "string",
  "status": "queued|running|completed|cancelled|failed",
  "importBatchId": "string",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "sources": ["chatgpt"],
  "filterProfileId": "string",
  "model": "string",
  "outputTarget": "db",
  "config": {
    "promptVersionIds": {"summarize": "string"},
    "labelSpec": {"model": "string", "promptVersionId": "string"},
    "filterProfile": {"name": "string", "mode": "include|exclude", "categories": ["WORK"]},
    "timezone": "IANA",
    "maxInputTokens": 12000
  },
  "jobCount": 0,
  "eligibleDays": ["YYYY-MM-DD"],
  "createdAt": "RFC3339",
  "updatedAt": "RFC3339"
}
```

Notes:
- `eligibleDays` MAY be truncated/paginated by implementation for very large ranges; if so, it MUST also return `eligibleDayCount`.

#### POST /api/distill/runs/:runId/tick
Returns:

```json
{
  "runId": "string",
  "processed": 0,
  "jobs": [
    {
      "dayDate": "YYYY-MM-DD",
      "status": "queued|running|succeeded|failed|cancelled",
      "attempt": 0,
      "tokensIn": 0,
      "tokensOut": 0,
      "costUsd": 0,
      "error": null
    }
  ],
  "progress": {
    "queued": 0,
    "running": 0,
    "succeeded": 0,
    "failed": 0,
    "cancelled": 0
  },
  "runStatus": "queued|running|completed|cancelled|failed"
}
```

Notes:
- `jobs` MUST include the jobs processed in this tick (may be empty if none).

#### GET /api/distill/search
Returns:

```json
{
  "items": [
    {
      "resultType": "atom",
      "rank": 0,
      "snippet": "string",
      "atom": {
        "atomStableId": "string",
        "source": "chatgpt|claude|grok",
        "dayDate": "YYYY-MM-DD",
        "timestampUtc": "RFC3339",
        "role": "user|assistant",
        "category": "WORK",
        "confidence": 0.0
      }
    },
    {
      "resultType": "output",
      "rank": 0,
      "snippet": "string",
      "output": {
        "runId": "string",
        "dayDate": "YYYY-MM-DD",
        "stage": "summarize|redact"
      }
    }
  ],
  "nextCursor": "string"
}
```

Rules:
- `nextCursor` MAY be omitted if there are no more results.
- `category`/`confidence` for atom results MUST be derived from labels matching the active `labelSpec` context:
  - If `runId` is provided, use that Run's `config.labelSpec`.
  - If `runId` is not provided and the caller requests category filtering, the request MUST include `labelModel` and `labelPromptVersionId`.

---

## 8) Filtering + label version pinning

### 8.1 Filtering is versioned
A Run’s filtering must be based on **only** MessageLabels matching `Run.configJson.labelSpec`.

If a MessageAtom has labels from other prompt versions/models:
- it is treated as **unlabeled for this run** and excluded from eligibility.

This prevents stale labels from leaking into new runs.

---

## 9) Deterministic day bundle construction

### 9.1 Bundle ordering
For a job/day:
1) Load eligible MessageAtoms (matching sources + date + filter + labelSpec)
2) Sort deterministically by:
   - source ASC
   - timestampUtc ASC
   - role ASC (user before assistant)
   - atomStableId ASC (tie-breaker)
3) Render bundle as:

```
# SOURCE: <source>
[<timestampUtc>] <role>: <text>
...

# SOURCE: <next source>
...
```

### 9.2 Bundle size constraints
If the day bundle exceeds the context budget, the worker MUST segment it using `segmenter_v1`.

Context budget (required):
- Run config includes `maxInputTokens`.
- Default `maxInputTokens` MUST be recorded in Run.configJson.
- If server config does not set it, `maxInputTokens` defaults to `12000`.

- segments are created by token count, preserving order
- segment IDs are stable: `sha256("segment_v1|" + bundleHash + "|" + segmentIndex)`
- The segmentation decision MUST be recorded in `Output.outputJson.meta` (v0.3).

Segment outputs (v0.3 behavior):
- The worker calls the summarizer once per segment.
- The final per-day Output is produced by **deterministically concatenating** segment summaries in order, with headings `## Segment <k>`.
- v0.3 does NOT perform an additional “merge summaries” model call.

---

## 10) New v0.3 features

### 10.1 Search (lexical, not embeddings)
Rationale: deterministic, cheap, inspectable.

Search covers:
- MessageAtoms (raw)
- Outputs (summaries)

Implementation:
- v0.3 uses Postgres Full-Text Search (tsvector) only.
- Trigram substring indexing is explicitly out of scope for v0.3.
- Index at minimum:
  - MessageAtom.text
  - Output.outputText

API:
- GET `/api/distill/search?query=...&scope=raw|outputs|both&importBatchId=...&runId=...&startDate=...&endDate=...&sources=...&categories=...&limit=...`
- Returns:
  - resultType (atom|output)
  - stable reference (atomStableId or {runId, dayDate, stage})
  - snippet + rank
  - metadata (source, dayDate, category if atom)

UI:
- `/distill/search` page with tabs (Raw / Outputs)
- Clicking a result opens the inspector with the match highlighted.

### 10.2 Better “before/after” viewing
Replace raw JSON popups with an inspector:

Import inspector (after import):
- day list (coverage)
- per-day view showing messages with:
  - timestamp, role, source
  - category + confidence
  - ability to filter by category/role/source

Run inspector (per day):
- left: **Input** (filtered bundle preview)
- right: **Output** rendered markdown
- collapsible “Raw JSON” pane for debugging

### 10.3 Pagination
List/search endpoints MUST support pagination:
- request: `limit` (default 50, max 200) and `cursor` (opaque)
- response: `{ items: [...], nextCursor?: string }`

---

## 11) Acceptance criteria (testable)

### 11.1 Data integrity
- Importing a file with two identical messages on different timestamps must store **both** (no silent loss).
- Import includes both `user` and `assistant` roles.
- Mixed-source days create **one RawEntry per source**.

### 11.2 Reproducibility
- Changing active summarize prompt after run creation must not change outputs for that run (uses frozen promptVersionId).
- Filtering uses only labels matching run.labelSpec.

### 11.3 Reliability
- Tick default is 1 job.
- Backend rejects overlapping ticks (409 TICK_IN_PROGRESS), and UI uses sequential polling (frontend e2e test).
- Resume continues from failed jobs without reprocessing succeeded days.

### 11.4 UI Shell (Phase 5)
- Run detail page shows frozen config snapshot values exactly as stored in Run.configJson.
- Run detail page allows manual tick; UI sends no overlapping tick requests (sequential await).
- UI exposes per-day reset and shows attempt increments after reset.
- For a processed day, UI can display output markdown and the input bundle hashes (bundleHash + bundleContextHash).

### 11.5 Search + Inspector
- Search returns results for known strings in MessageAtoms and Outputs.
- Inspector renders output as markdown and shows pre/post views.

---

## 12) Spec change protocol (anti-drift)

Any change that affects invariants, stable IDs, schemas, or API behavior must:
1) Update this spec first
2) Add/adjust acceptance criteria
3) Add at least one test that would have failed before the change

---

## 13) Notes / Known risks

- Timezone choice affects day bucketing; changing timezone requires re-import.
- Large RawEntry text is acceptable for local-first demo.

---

End Spec v0.3.0-draft