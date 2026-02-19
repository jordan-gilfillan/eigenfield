# Journal Distiller — Canonical Spec (Fresh Start) v0.3.0-draft

> This document is the single source of truth. If code, README, or UI disagree with this spec, the spec wins.

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
- WebSockets / SSE (polling/streaming upgrades). v0.3 uses request/response + optional foreground polling only.
- Mirror QA retrieval UI, embeddings visualization, vector search
- Cloud storage (S3/GCS). Local upload → DB only
- Full export-format compatibility guarantees for every version of every product
- Custom category taxonomy editor
- Automatic prompt rewriting/compilation from user-defined categories
- Auto-retry with backoff (manual resume only)
- Background / always-on tick automation (cron, queues, server-scheduled loops)
- Foreground auto-run tick loops initiated by the user on the run detail page ARE allowed (see §7.4.2)
- Parallel job processing in UI (sequential polling only)
- UI polish / design system work beyond basic layouts (Phase 5 is operability-first)

---

## 2.1) Implementation stack and local dev (normative)

> Note: These subsections define positive constraints on the implementation stack. They are grouped under §2 for numbering stability but are normative requirements, not non-goals.

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
- **Terminal status**: a status from which no further state transitions occur. Terminal states are entity-specific:
  - Run: `completed`, `cancelled`, `failed` (see §6.8)
  - Job: `succeeded`, `failed`, `cancelled` (see §6.9)
  - ClassifyRun: `succeeded`, `failed` (see §7.2.1)

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
- UI tick calls (manual or auto-run) MUST be sequential: await each tick response before sending the next. No overlapping ticks.

### 4.6 Foreground polling (allowed) vs background polling (forbidden)
- **Background polling is forbidden**: no always-on refresh loops, no hidden timers that run when the user is not actively viewing an in-progress operation.
- **Foreground polling is allowed** only for user-initiated, long-running operations (e.g., classify/run progress) **while the relevant page is open**.
- Foreground polling MUST:
  - use `setTimeout` (NOT `setInterval`)
  - cancel in-flight requests via `AbortController`
  - stop immediately on terminal status (succeeded/failed/cancelled) or on navigation/unmount
  - poll **read-only status endpoints** that do not trigger work
  - use an interval in the 750–1500ms range (or exponential backoff)

**Terminology:** "Polling" in this spec refers exclusively to read-only GET requests against status/progress endpoints (no side effects). The repeated calling of work-triggering endpoints (e.g., POST /tick) is a "foreground auto-run tick loop" governed by §7.4.2, not by the polling rules above.

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
    "bundle_ctx_v1|" + importBatchIdsCsv + "|" + dayDate + "|" + sourcesCsv + "|" + filterProfileSnapshotJson + "|" + labelSpecJson
  )
  ```

  Notes on CSV fields:
  - `importBatchIdsCsv`: batch IDs sorted lexicographically, joined with `,`. For single-batch runs this equals the single ID (backward compatible).
  - `sourcesCsv`: source names sorted lexicographically, joined with `,`.

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
- v0.3 import does not produce `mixed`; it is reserved. The API SHOULD reject `mixed` as a `sourceOverride` value (TODO: enforce at API validation layer).
- `mixed` is reserved for a future "multi-file" import mode (zip or multiple uploads in one request). If `mixed` is ever used, each MessageAtom still carries its real `source`.

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
- At most one active PromptVersion per stage at a time (used only as the server/UI default). Stages not yet implemented (e.g. redact in v0.3) may have zero active versions.
- `isActive` is a default selector only. It MUST NOT be used to choose prompt behavior by "mode" (e.g., stub vs real).
- Any endpoint that executes an LLM call MUST use an explicit PromptVersionId appropriate to that stage.
- Runs MUST record the exact PromptVersion IDs used.

### 6.8 Run

**Terminal states:** `completed`, `cancelled`, `failed`.

Fields:
- id
- status (queued|running|completed|cancelled|failed)
- importBatchIds (FK[], via RunBatch junction table; see §6.8a)
  - At least one required.
  - All referenced ImportBatches MUST share the same timezone.
- startDate, endDate
- sources[]
- filterProfileId (FK)
- model (string)
- outputTarget ("db" only)
- configJson (frozen snapshot; see below)
- createdAt, updatedAt

`configJson` **must include**:
- `promptVersionIds`: v0.3 contains only `{ summarize: <id> }`. The `redact` and `classify` keys are reserved for future stages and MUST NOT be present in v0.3 configJson.
- `labelSpec`: `{ model: <string>, promptVersionId: <id> }` (used for filtering)
- `filterProfileSnapshot`: `{ name, mode, categories[] }`
- `timezone` (MUST equal ImportBatch.timezone; runs may not override)
- `importBatchIds`: `string[]` (frozen list of selected batch IDs at run creation)

**Migration notes (backward compatibility):**
- The API accepts singular `importBatchId` (normalized to `importBatchIds: [id]`). See §7.3 input rules.
- `importBatchId` column is retained on the Run row for backward compatibility. Equals `importBatchIds[0]` for single-batch runs. New code SHOULD read from the RunBatch junction (§6.8a).

### 6.8a RunBatch (junction)
Fields:
- id
- runId (FK → Run)
- importBatchId (FK → ImportBatch)

Constraints:
- UNIQUE(runId, importBatchId)
- Both FKs cascade on delete.

### 6.9 Job

**Terminal states:** `succeeded`, `failed`, `cancelled`.

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
- Output: classifyRunId + counts (and optional progress when available; see 7.2.1).

**PromptVersion selection (normative):**
- `mode="real"` MUST use a PromptVersion whose Prompt.stage is `classify` and whose templateText constrains the model to output strict JSON matching the classify output contract.
- `mode="real"` MUST NOT use the seeded stub prompt version (`classify_stub_v1`). If the request provides a stub promptVersionId in real mode, the server MUST reject the request with HTTP 400 `INVALID_INPUT`.
- `mode="stub"` MUST be deterministic and MUST NOT make any external LLM/provider call. The server records the caller-provided `promptVersionId` unchanged in labels; it need not be `classify_stub_v1`. No guardrails are applied to `promptVersionId` in stub mode.

Stub mode must be deterministic for tests.

### 7.2.1 Classify progress + stats (v0.3)
Classification may be long-running in real mode. v0.3 supports progress visibility without background polling.

Normative behavior:
- The server MUST create a durable `ClassifyRun` record for each successful classify request.
- The server SHOULD update progress fields during execution (batching DB writes every N atoms to avoid write amplification).
- The UI MAY use **foreground polling** (per 4.6) to fetch status while the user is viewing the page.

Endpoints:
- `POST /api/distill/classify` returns `classifyRunId`.
- `GET /api/distill/classify-runs/:id` returns progress/status for that classify run.

`ClassifyRun.status` is: `running|succeeded|failed`. **Terminal states:** `succeeded`, `failed`.

Status endpoint response (normative):
```json
{
  "id": "string",
  "importBatchId": "string",
  "labelSpec": {"model": "string", "promptVersionId": "string"},
  "mode": "real|stub",
  "status": "running|succeeded|failed",
  "totals": {"messageAtoms": 0, "labeled": 0, "newlyLabeled": 0, "skippedAlreadyLabeled": 0},
  "progress": {"processedAtoms": 0, "totalAtoms": 0},
  "usage": {"tokensIn": 0, "tokensOut": 0, "costUsd": 0},
  "warnings": {"skippedBadOutput": 0, "aliasedCount": 0},
  "lastError": null,
  "createdAt": "RFC3339",
  "updatedAt": "RFC3339",
  "startedAt": "RFC3339",
  "finishedAt": "RFC3339 | null"
}
```
Notes:
- `progress`, `usage`, and `warnings` MAY be partial while `status="running"`.
- `warnings` contains classification-quality counters separate from progress tracking.
- The status endpoint MUST be read-only and MUST NOT trigger classification work.

**Deterministic stub algorithm (stub_v1):**
- For each MessageAtom, compute `h = sha256(atomStableId)`.
- Map to a category via `index = uint32(h[0..3]) % N`, where `N` is the number of **core** categories: `[WORK, LEARNING, CREATIVE, MUNDANE, PERSONAL, OTHER]`.
- Set `confidence = 0.5`.
- Record `model = "stub_v1"` and the caller-provided `promptVersionId`.

### 7.3 Run creation
UI: `/distill` dashboard

- Input: `{ importBatchId?, importBatchIds?, startDate, endDate, sources[], filterProfileId, model, outputTarget:"db", labelSpec?: { model: string, promptVersionId: string }, maxInputTokens? }`
  - `importBatchId` (string) and `importBatchIds` (string[]) are **mutually exclusive**.
  - Exactly one must be provided; both → HTTP 400 `INVALID_INPUT`; neither → HTTP 400 `INVALID_INPUT`.
  - If `importBatchId` provided alone → normalized to `importBatchIds: [importBatchId]`.
  - `importBatchIds` must be non-empty and contain unique elements; else HTTP 400 `INVALID_INPUT`.
  - `maxInputTokens` is optional; defaults to `12000` (see §9.2 for segmentation rules).
- Behavior:
  1) Resolve `importBatchIds` (see Input rules above). All referenced ImportBatches MUST exist; else HTTP 404 `NOT_FOUND`.
  2) Timezone uniformity: all selected batches must share the same timezone. If not → HTTP 400 `TIMEZONE_MISMATCH` `{ message, timezones: string[], batchIds: string[] }`.
  3) Freeze `promptVersionIds` for summarize (and redact/classify when those stages are added).
  4) Freeze `labelSpec` for filtering (classifier model + promptVersionId):
     - If `labelSpec` is provided in the request, it MUST be used as-is (and the referenced PromptVersion MUST exist).
     - If `labelSpec` is omitted, the server MUST select a default labelSpec using the active `classify` PromptVersion and the default classifier model for the chosen mode (v0.3 default: `stub_v1`).
     - If the selected batches have no labels matching the chosen labelSpec, run creation MUST fail with HTTP 400 `NO_ELIGIBLE_DAYS` (no silent fallback to other label versions).
  5) Freeze `filterProfileSnapshot`
  6) Determine eligible days: days where at least one **role = user** MessageAtom matches
     - role = user (assistant atoms do not make a day eligible)
     - importBatchId IN (`importBatchIds`)
     - sources
     - date range
     - has a MessageLabel matching **labelSpec**
     - passes filter profile
  7) Create one Job per eligible day
  8) If 0 eligible days → return HTTP 400 with a structured error (see §7.8 Error conventions).

### 7.4 Process (tick loop)
POST `/api/distill/runs/:runId/tick`
- Default processes **up to N queued jobs, N=1**.
- Each job is processed by constructing a deterministic day bundle (§9) and passing it to the summarizer.
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

UI tick calls MUST follow §4.5 (bounded concurrency). Read-only progress polling MUST follow §4.6. Foreground auto-run tick loops MUST follow §7.4.2.


#### 7.4.1 Run status transitions (normative)
Run.status is a coarse, user-facing summary and MUST follow these rules:
- On run creation: `queued`.
- When any job is started or completed by tick: transition to `running` (unless run is already terminal).
- When all jobs are terminal:
  - if any job `failed` -> `failed`
  - else if run was cancelled -> `cancelled`
  - else -> `completed`
- Tick MUST NOT transition a cancelled run to any non-terminal status (terminal status rule in 7.6).

Note: `progress` in tick responses is the ground truth for counts; `runStatus` MUST be consistent with it.

#### 7.4.2 Foreground auto-run (normative)

The run detail UI MAY provide a "foreground auto-run" mode that repeatedly calls POST /runs/:runId/tick while the page is open. This is NOT background automation and is NOT polling (§4.6); it is a user-initiated, work-triggering tick loop.

Rules:
- The user MUST explicitly start auto-run (e.g., "Start Auto-run" button). Auto-run MUST NOT begin automatically on page load.
- Each tick call MUST use default behavior: `maxJobs` omitted or explicitly `maxJobs=1`. Any future support for `maxJobs > 1` in auto-run requires a spec change.
- Tick calls MUST be sequential: await each tick response before sending the next. No overlapping ticks (per §4.5).
- Auto-run MUST stop immediately when:
  - the user navigates away or the page unmounts
  - the Run reaches a terminal status (completed, cancelled, failed)
  - any tick returns an error (stop on first error)
- **No auto-retry:** on tick error, auto-run MUST stop and surface the error to the user. Auto-run MUST NOT implement backoff or retry loops. The user may manually retry (single tick) or restart auto-run.
- MUST use `setTimeout` (not `setInterval`) between ticks.
- MUST cancel in-flight requests via `AbortController` on stop/unmount.

### 7.5 Inspect (behavioral contract)

> §7.5 defines **what** the run detail page must display. §7.5.1 defines the Phase 5 minimum implementation.

UI: `/distill/runs/:runId`
Must show:
- run config snapshot (import + prompts + labelSpec + filter snapshot)
- progress summary
- job table (status, tokens, cost, errors)
- per-day output viewer (rendered markdown)
- input inspector (see 10)
- `aggregate tokens + aggregate cost (sum over jobs processed so far)`
- `last classify run stats for the selected labelSpec (totals/newlyLabeled/skippedAlreadyLabeled) when available`

### 7.5.1 Phase 5 UI Shell (minimum operability slice)

Goal: make the system operable and debuggable end-to-end without adding new backend dependencies.

UI invariants (non-negotiable):
- No background polling loops. Tick is user-driven. Foreground polling is allowed only for progress/status visibility (see 4.6).
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
  "classifyRunId": "string",
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
Query params (v0.3): use `q` for the search string (not `query`). All other filters are optional.
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
        "importBatchId": "string",
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

Bundle construction is invoked by the tick handler (§7.4) for each queued job.

### 9.1 Bundle ordering
For a job/day:
1) Load eligible MessageAtoms (matching **role = user** + sources + date + filter + labelSpec).
   Assistant atoms are stored in the DB for audit/debug but MUST NOT appear in the bundle the model sees.
   - Multi-batch runs: atoms are loaded from ALL `importBatchIds` for the given day.
   - Cross-batch dedup: if the same `atomStableId` appears in atoms from multiple batches,
     keep only the first occurrence in the canonical sort order below. This is the single
     canonical dedup point — no dedup elsewhere in the pipeline.
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

## 10) Search & Inspector

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

- GET `/api/distill/search?q=...&scope=raw|outputs&importBatchId=...&runId=...&startDate=...&endDate=...&sources=...&categories=...&limit=...&cursor=...`
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
- response: `{ items: [...], nextCursor?: string }` (for search endpoints, `nextCursor` is the pagination token)

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
- `Run detail page shows aggregate tokensIn/tokensOut and total costUsd summed over jobs (including partial segment success where recorded).`
- `If classification has been run for the selected ImportBatch, the dashboard or run detail page can display the last classify totals (newlyLabeled, skippedAlreadyLabeled, labeled).`

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

## 14) Git Export

Git Export is a **post-processing step** that reads a completed Run's Outputs and renders them as a deterministic directory of markdown files. The pipeline (§1–§10) is unchanged; export is a read-only consumer of immutable Output records.

### 14.1 Directory structure

```
<export-dir>/
├── README.md                   # Static format tour
├── views/
│   ├── timeline.md             # Navigation index (newest-first, deterministic)
│   └── YYYY-MM-DD.md           # One per SUCCEEDED job
└── .journal-meta/
    └── manifest.json           # Machine-readable metadata + file hashes
```

Follow-on directories (not in v1):
- `atoms/YYYY-MM-DD.md` — Per-day source atoms (user role only, §9.1 ordering)
- `sources/<slug>.md` — One per ImportBatch (append-only)

### 14.2 File contents

**`README.md`** — Static format tour.
- Contains: format version string (`export_v1`), directory layout, pointer to `views/timeline.md` as browse entry point, pointer to `manifest.json` for machine-readable metadata.
- Contains NO volatile data: no dates, no counts, no `exportedAt`, no source lists.
- Changes only when the export format version changes (requires ADR).

**`views/YYYY-MM-DD.md`** — Per-day summary.
- YAML frontmatter (fixed field order):
  1. `date` (string, `"YYYY-MM-DD"`) — the day
  2. `model` (string) — summarization model
  3. `runId` (string) — which Run produced this output
  4. `createdAt` (string, ISO 8601) — Output.createdAt (immutable)
  5. `bundleHash` (string, hex) — sha256 of input bundle text (§5.3)
  6. `bundleContextHash` (string, hex) — sha256 of config context (§5.3)
  7. `segmented` (boolean) — whether bundle was split into segments
  8. `segmentCount` (number, present only when `segmented: true`)
- Body: `Output.outputText` verbatim.
- No `exportedAt` — that field appears only in `manifest.json`.

All frontmatter fields are immutable for a given Output record. Re-exporting the same Run produces byte-identical view files.

**`views/timeline.md`** — Navigation index.
- Heading: `# Timeline`
- When ≤14 days: flat list, newest-first, each line `- [YYYY-MM-DD](YYYY-MM-DD.md)`
- When >14 days: `## Recent` section (latest 14) followed by `## All entries` (complete list)
- No frontmatter, no timestamps, no `exportedAt`.
- Deterministic: same set of days → byte-identical file. Ordering is reverse lexicographic on dayDate string.

**`.journal-meta/manifest.json`** — Machine-readable metadata.
- Top-level keys (alphabetically sorted): `batches`, `dateRange`, `exportedAt`, `files`, `formatVersion`, `run`.
- `exportedAt` (ISO 8601) is the ONLY volatile field in the entire export tree.
- `files` maps each file path (except manifest.json itself) to `{ sha256: "<hex>" }`.
- All keys sorted alphabetically at every nesting level.

### 14.3 Byte-stable rendering rules

These rules are normative. The renderer MUST produce byte-identical output for identical input.

| Rule | Specification |
|------|--------------|
| Line endings | LF only (`\n`). No CRLF. |
| Trailing newline | Every file ends with exactly one `\n`. |
| Trailing whitespace | No trailing whitespace on any line. |
| Encoding | UTF-8. No BOM. |
| YAML frontmatter | Hand-rendered via array-of-tuples. Fixed field order per file type. No YAML library. |
| JSON | `JSON.stringify(sortKeysDeep(obj), null, 2) + '\n'`. Keys sorted alphabetically at every level. |
| Format version | `export_v1` — embedded in README and manifest. Format changes require version bump + ADR. |

### 14.4 Determinism contract

Given the same `ExportInput`, `renderExportTree()` MUST produce byte-identical files.

- `README.md`: static template. Always identical for a given format version.
- `views/YYYY-MM-DD.md`: deterministic from `outputText` + immutable frontmatter fields.
- `views/timeline.md`: deterministic from the set of dayDates. No timestamps.
- `manifest.json`: contains caller-supplied `exportedAt`. Changing `exportedAt` changes ONLY this file.

**Churn isolation**: re-exporting identical data at a different time changes ONLY `.journal-meta/manifest.json`.

### 14.5 Minimal-churn rules

| Path | Churns when | Stable when |
|------|-------------|-------------|
| `README.md` | Format version changes (rare, requires ADR) | Always (static template) |
| `views/YYYY-MM-DD.md` | Output.outputText or Output metadata changes (re-run) | Same Run, no reprocessing |
| `views/timeline.md` | Set of days changes (day added or removed) | Same set of days |
| `manifest.json` | Any file content changes, OR `exportedAt` changes | Byte-identical tree + same `exportedAt` |

### 14.6 Provenance chain

A single view file's frontmatter answers: what day (`date`), what model (`model`), which run (`runId`), when created (`createdAt`), what input data (`bundleHash`), what config (`bundleContextHash`).

Manifest provides the full run config (filter profile, timezone, sources) and batch details (original filenames, import source) for deeper investigation.

### 14.7 Preconditions

- Run status MUST be `COMPLETED`.
- All Jobs in the Run MUST be `SUCCEEDED` (partial exports deferred).

### 14.8 Privacy tiers (deferred)

- **Public**: Only `views/` + `README.md` + manifest. No raw text.
- **Private** (default): Full tree including `atoms/` and `sources/`.
- FilterProfile already excludes sensitive categories. Export inherits this.

### 14.9 Golden fixture test requirement

V1 MUST include a golden fixture test that locks exact byte output of every rendered file. The test uses a fixed input and asserts string equality against inline expected values. Any renderer change that affects output bytes MUST update the golden fixtures — this is intentional friction that prevents accidental format drift.

### 14.10 Export v2 — directory structure

Export v2 adds a **topic layer** and an optional **changelog** to the v1 tree. All v1 files retain their exact content format — v2 is purely additive.

```
<export-dir>/
├── README.md                      # Updated for v2 layout
├── views/
│   ├── timeline.md                # Unchanged from v1
│   └── YYYY-MM-DD.md              # Unchanged from v1
├── atoms/                         # Private tier only (unchanged from v1)
│   └── YYYY-MM-DD.md
├── sources/                       # Private tier only (unchanged from v1)
│   └── {source}-{filename}.md
├── topics/                        # NEW: topic index + per-topic pages
│   ├── INDEX.md                   # Topic navigation hub
│   └── <topicId>.md               # Per-topic page (one per active category)
├── changelog.md                   # NEW: export-to-export diff (omitted when no previous)
└── .journal-meta/
    └── manifest.json              # Schema v2
```

**Privacy tiers for new files:**
- `topics/` — Present in BOTH public and private tiers. Topic pages contain category names and day links but NOT raw atom text.
- `changelog.md` — Present in BOTH tiers. Contains topic-level deltas, not raw text. Omitted entirely when no `previousManifest` is supplied.

**Backward compatibility:** A v1 consumer that ignores unknown directories/files sees byte-identical v1 data.

### 14.11 Topic identity model (topic_v1)

**Topic version:** `topic_v1`

In topic_v1, topics are a **1:1 mapping from the Category enum (§6.4) to topic pages**. Every category that has at least one classified atom in the exported corpus produces exactly one topic. Categories with zero atoms produce no topic page. There are at most 13 topics (one per Category enum value).

**Topic ID algorithm:**

```
topicId = categoryApi value (lowercase)
```

Examples: `work`, `learning`, `mental_health`, `addiction_recovery`

The topicId IS the category name. No hashing is needed because topics are 1:1 with categories. The `topicVersion` field in the manifest signals the ID scheme, so future versions (e.g., `topic_v2` with embedding-based clustering) can introduce hash-based IDs without ambiguity.

**Stability properties:**
- Adding atoms to an existing category does NOT change the topicId — only counts/days are updated.
- Removing all atoms from a category removes the topic page, but the topicId remains reserved (it reappears if atoms return).
- The same category across different runs/exports always produces the same topicId.

**Merge/split rules (topic_v1):** Not applicable. Categories are a closed enum (§6.4). No merge or split is possible. Future topic versions with sub-topic clustering MUST define merge/split rules and a migration path from topic_v1 IDs.

**Atom category assignment:** The orchestrator queries `MessageLabel` records matching the Run's frozen `labelSpec` (model + promptVersionId from `Run.configJson`). If no matching label exists for an atom, it is assigned to the `other` topic.

### 14.12 Topic file contents — INDEX.md

`topics/INDEX.md` is the topic navigation hub.

```markdown
# Topics

| Topic | Category | Days | Atoms |
|-------|----------|------|-------|
| [Work](work.md) | work | 12 | 45 |
| [Learning](learning.md) | learning | 8 | 23 |
| [Other](other.md) | other | 4 | 10 |
```

**Ordering:** Rows sorted by atom count **descending**, then category name **ascending** (tie-breaker).

**Columns:**
- **Topic** — Display name in Title Case, linked to the topic page file.
- **Category** — The categoryApi value (lowercase).
- **Days** — Count of distinct dayDates with ≥1 atom in this category.
- **Atoms** — Total atom count for this category.

**Display name mapping** (hardcoded, deterministic):

| categoryApi | Display Name |
|---|---|
| `work` | Work |
| `learning` | Learning |
| `creative` | Creative |
| `mundane` | Mundane |
| `personal` | Personal |
| `other` | Other |
| `medical` | Medical |
| `mental_health` | Mental Health |
| `addiction_recovery` | Addiction Recovery |
| `intimacy` | Intimacy |
| `financial` | Financial |
| `legal` | Legal |
| `embarrassing` | Embarrassing |

If the Category enum is extended (spec change to §6.4 required), this mapping MUST be updated in the same change.

**No frontmatter, no timestamps, no `exportedAt`.** Deterministic: same corpus + same labelSpec → byte-identical file.

### 14.13 Topic file contents — per-topic pages

Each `topics/<topicId>.md` file has YAML frontmatter followed by a day listing.

**YAML frontmatter (fixed field order):**
1. `topicId` (string) — e.g., `"work"`
2. `topicVersion` (string) — `"topic_v1"`
3. `category` (string) — e.g., `"work"` (same as topicId in topic_v1)
4. `displayName` (string) — Title Case, e.g., `"Work"`
5. `atomCount` (number) — total atoms in this category
6. `dayCount` (number) — distinct days with ≥1 atom in this category
7. `dateRange` (string) — `"YYYY-MM-DD to YYYY-MM-DD"` (earliest to latest)

**Body:**

```markdown
## Days

- [2024-01-16](../views/2024-01-16.md) (5 atoms)
- [2024-01-15](../views/2024-01-15.md) (3 atoms)
- [2024-01-14](../views/2024-01-14.md) (1 atom)
```

**Rules:**
- Days listed **newest-first** (reverse lexicographic on dayDate string).
- Each line: day link (relative path from `topics/` to `views/`) and atom count for that category on that day.
- Singular "atom" when count is 1, plural "atoms" otherwise.
- No raw atom text is included (safe for public tier). The atom text is available in `atoms/YYYY-MM-DD.md` (private tier) and in summarized form in `views/YYYY-MM-DD.md`.
- Section heading is `## Days` followed by one blank line before the list.

### 14.14 Changelog file contents

The changelog represents the "diff of thinking" between two consecutive exports. It is computed by comparing the current export's topic structure against a previous export's manifest.

**Prerequisite:** The caller supplies a `previousManifest` (the parsed `.journal-meta/manifest.json` from the prior v2 export). If not supplied, no `changelog.md` is generated and the manifest's `changelog` key is `null`.

**`changelog.md` — YAML frontmatter (fixed field order):**
1. `exportedAt` (string, ISO 8601) — current export timestamp
2. `previousExportedAt` (string, ISO 8601) — from previous manifest
3. `topicVersion` (string) — `"topic_v1"`
4. `changeCount` (number) — total entries across all sections

**Body sections** (empty sections are omitted entirely):

```markdown
## New topics

- **Work** (`work`) — 12 days, 45 atoms

## Removed topics

- **Creative** (`creative`) — was 3 days, 8 atoms

## Changed topics

### Work (`work`)
- Days added: 2024-01-18, 2024-01-19
- Days removed: (none)
- Atom count: 40 → 45 (+5)
```

**Change detection algorithm:**

```
currentTopics  = set of topicIds in current export
previousTopics = set of topicIds from previousManifest.topics

newTopics     = currentTopics − previousTopics
removedTopics = previousTopics − currentTopics
commonTopics  = currentTopics ∩ previousTopics

For each topic in commonTopics:
  Compare: days set, atomCount
  If any differ → add to changedTopics with delta details
```

**Ordering rules:**
- Entries within each section: **display name ascending** (alphabetical).
- Days added/removed: ascending date order, comma-separated.
- Atom count change: `<prev> → <curr> (+N)` or `(-N)`.
- `changeCount` in frontmatter = count of entries across all three sections.

**Determinism:** Given the same current `ExportInput` and the same `previousManifest`, the changelog is byte-identical.

### 14.15 Manifest v2 schema

`formatVersion` changes from `"export_v1"` to `"export_v2"`.

**New top-level keys** (shown in alphabetical order alongside existing keys):

```json
{
  "batches": [ ... ],
  "changelog": { "previousExportedAt": "...", "changeCount": 5 },
  "dateRange": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "exportedAt": "ISO 8601",
  "files": { "README.md": { "sha256": "..." }, ... },
  "formatVersion": "export_v2",
  "run": { ... },
  "topics": {
    "work": {
      "atomCount": 45,
      "category": "work",
      "dayCount": 12,
      "days": ["2024-01-05", "2024-01-06", "2024-01-07"],
      "displayName": "Work"
    }
  },
  "topicVersion": "topic_v1"
}
```

**`topics`** — Object keyed by topicId. Each entry:
- `atomCount` (number)
- `category` (string, categoryApi)
- `dayCount` (number)
- `days` (array of `"YYYY-MM-DD"` strings, sorted ascending)
- `displayName` (string, Title Case)
- All object keys sorted alphabetically per §14.3.

**`changelog`** — `null` when no `previousManifest` supplied. Otherwise: `{ previousExportedAt: string, changeCount: number }`.

**`topicVersion`** — String, `"topic_v1"`. Documents which topic ID algorithm was used. Consumers compare this to decide if topic IDs are comparable across exports.

**`files`** — Includes entries for all new files (`topics/INDEX.md`, `topics/<topicId>.md`, `changelog.md` when present), following the same `{ sha256: "<hex>" }` format.

### 14.16 v2 determinism contract

All v1 determinism rules (§14.4) continue to hold. Additional guarantees for v2 files:

- `topics/INDEX.md`: deterministic from the set of (category, atomCount, dayCount) tuples. No timestamps.
- `topics/<topicId>.md`: deterministic from (topicId, category, atoms-per-day counts, day list). No timestamps.
- `changelog.md`: deterministic from (current topic metadata, previous manifest topic metadata, exportedAt).
- `manifest.json`: `exportedAt` remains the ONLY volatile field. Topic metadata is derived from corpus data (deterministic). Changelog metadata references `exportedAt` (volatile).

**Churn isolation (v2 additions):**

| Path | Churns when | Stable when |
|------|-------------|-------------|
| `topics/INDEX.md` | Category membership or atom/day counts change | Same corpus + same labelSpec |
| `topics/<topicId>.md` | Day list or atom count for that category changes | Same atoms in same category |
| `changelog.md` | Always unique per (exportedAt, previousManifest) pair | N/A (inherently volatile) |
| `manifest.json` | Any file content changes, OR `exportedAt` changes | Byte-identical tree + same `exportedAt` |

### 14.17 v2 golden fixture test requirement

V2 MUST include a golden fixture test that extends the v1 pattern with:
- At least 2 categories with atoms (to test INDEX.md ordering and multiple topic pages).
- At least 1 category spanning multiple days (to test day listing).
- A test case WITH `previousManifest` (changelog generated).
- A test case WITHOUT `previousManifest` (no changelog.md, manifest `changelog` is `null`).
- Byte-identical assertions for all new files (`topics/INDEX.md`, `topics/<topicId>.md`, `changelog.md`).

The v1 golden fixture test continues to pass unchanged against v1-mode inputs.

### 14.18 v2 stop rules

STOP and redesign if any of the following would be required:

1. **Topic ID depends on corpus content** — topicId must be stable across atom additions/removals. Only the category name feeds the ID in topic_v1.
2. **Changelog requires filesystem reads** — the renderer must remain a pure function of its inputs. The previous manifest is supplied as a parameter, not read from disk.
3. **Non-deterministic ordering** — if any file's content would depend on Map/Set iteration order or any non-deterministic source, STOP. All iterations must be over sorted arrays.
4. **Background job requirement** — if topic computation is too expensive for a foreground request, STOP and design a separate architecture. (In topic_v1, computation is trivial: group atoms by category.)
5. **Embedding/ML dependency** — topic_v1 MUST NOT depend on embeddings, vector stores, or any ML model. Category-based grouping is purely algorithmic.
6. **Category enum extension** — if topic_v1 needs categories beyond the 13 in §6.4, STOP. That requires a spec change to §6.4 first.

---

## Appendix A) Design philosophy

> This section captures the project's design rationale. It is informative, not normative.

**Core levers (highest ROI):**
1) **Stable IDs** for atoms/bundles/outputs (referential backbone).
2) **Pinned versions** (prompt versions + label spec) for reproducibility.
3) **Sequential tick** (default 1 job/tick; no overlapping polls) for reliability.
4) **Search + inspector UI** to view "before/after" and debug quickly.

These levers address the recurring risks of non-determinism, silent data loss, unpinned prompt/label versions, and polling pile-ups.

---

## Future Work / Roadmap (Non-binding)

> This section lists potential directions that are **not committed work**. Each entry must be decomposed into AUD-sized slices (with spec-first design) before any implementation begins.

### EPIC-083 — Export v2: Topic tracking + "diff of thinking"

- **Origin**: Export smoke test — v1 output is a flat per-day markdown set; v2 needs topic evolution
- **Status**: EPIC-083a (spec) complete — see §14.10–§14.18 for the normative v2 file contract

Git Export v1 is intentionally minimal (§14.1–§14.9). Export v2 adds a **topic layer** (category-based grouping with stable IDs) and an optional **changelog** (diff between consecutive exports). The full v2 contract is specified in §14.10–§14.18.

**Invariants (must hold for any v2 design):**
- Determinism preserved: identical corpus + parameters → identical outputs / topic IDs / files
- No background jobs / no automatic scheduling (foreground/user-initiated only)
- Stable topic identifiers with documented merge/split rules (§14.11)
- Reproducibility: parameters/config recorded in export metadata (§14.15)

**Remaining slices:**
- **EPIC-083b** — Scaffold: types, constants, stub functions (no behavioral change)
- **EPIC-083c** — Topic pages + changelog rendering (pure renderer, no DB)
- **EPIC-083d** — Orchestrator wiring (MessageLabel join, API endpoint updates)
- **EPIC-083e+** — Future: embedding-based sub-topics (`topic_v2`), requires separate spec-first design

**Stop rule:** If topic tracking requires weakening determinism or introducing background jobs, STOP and design a separate architecture (§14.18).

### EPIC-104 — Demo Wizard: Import -> Classify -> Summarize -> Use (invite-only readiness)

- **Origin**: UX-first demo flow request (single-page, point-and-click) for later invite-only multi-tenant demos.
- **Status**: Spec-only proposal (non-binding); implementation not started.
- **Design doc**: `UX_DEMO_SPEC.md` (flow, IA, safety copy rules, multi-tenant readiness, AUD-102..AUD-111 slicing).

This epic does not change current normative backend behavior. It proposes a guided `/demo` route that sits on top of existing `/distill/*` contracts while keeping determinism, foreground-only execution, and spend safeguards intact.

**Invariants (must hold for any EPIC-104 implementation):**
- No background jobs, cron, or hidden scheduling loops.
- No weakening of determinism/frozen config guarantees.
- Dry-run-safe defaults with explicit spend controls before real-mode calls.

---

End Spec v0.4.0-draft
