# Journal Distiller — Glossary

> Terms used throughout the codebase, spec, and documentation. If a term is unclear in context, this is the canonical definition.

---

## Core Entities

### Atom (MessageAtom)
A single normalized message from an AI conversation. The atomic unit of imported data. Each atom has:
- A deterministic **atomStableId** (computed via SHA-256)
- A timestamp in UTC
- A role (user or assistant)
- The original text (normalized but not modified)

### Label (MessageLabel)
A classification result attached to an atom. Labels are versioned—each label records which model and prompt version produced it. Labels determine filtering eligibility.

### RawEntry
A per-source, per-day cache of all messages. Created during import for fast display. Contains **unfiltered** content—filtering happens at query/bundle time.

### ImportBatch
One upload event. Contains metadata about the uploaded file and associates all atoms parsed from it.

### FilterProfile
A named set of category rules. Either INCLUDE mode (keep only listed categories) or EXCLUDE mode (drop listed categories). Used to control which atoms appear in outputs.

### Run
A frozen processing configuration. When you start a run, it snapshots:
- The summarize prompt version
- The label spec (which classifier was used)
- The filter profile rules
- The timezone

This ensures reproducibility—changing prompts or filters after run creation doesn't affect that run.

### Job
One unit of work: processing a single day within a run. A run with 30 eligible days creates 30 jobs.

### Output
The result of a job. Contains the summarized text, audit hashes, and metadata about what model/prompt produced it.

---

## Identifiers & Hashes

### atomStableId
A deterministic identifier for a message atom. Computed as:
```
sha256("atom_v1|" + source + "|" + conversationId + "|" + messageId + "|" + timestampISO + "|" + role + "|" + textHash)
```
This ensures the same message always gets the same ID, regardless of import order or database state.

### bundleHash
Hash of the exact text sent to the model. Answers: "What did the model see?"
```
sha256("bundle_v1|" + bundleText)
```

### bundleContextHash
Hash of the inputs that produced the bundle. Answers: "Why was this bundle created?"
```
sha256("bundle_ctx_v1|" + importBatchId + "|" + dayDate + "|" + sourcesCsv + "|" + filterJson + "|" + labelSpecJson)
```

### textHash
SHA-256 hash of the normalized message text. Used as part of atomStableId computation.

---

## Processes

### Import
Parsing an export file (ChatGPT JSON, Claude JSON, Grok) into MessageAtoms and RawEntries. Does not classify by default.

### Classification
Running a classifier (real LLM or stub) over atoms to produce MessageLabels. Labels are versioned by model + promptVersion.

### Distillation
The overall pipeline: import → classify → run → outputs. Converts raw conversations into curated summaries.

### Bundle Construction
Assembling the filtered, sorted messages for a single day into text for the model. Follows deterministic ordering:
1. source ASC
2. timestampUtc ASC
3. role ASC (user before assistant)
4. atomStableId ASC

### Tick
One processing cycle. The UI calls `/tick` repeatedly, and each tick processes up to N jobs (default 1). Sequential polling prevents race conditions.

---

## Modes & Configurations

### Stub Mode
A deterministic fake for testing. `stub_v1` classifier assigns categories based on SHA-256 hash of atomStableId. `stub_summarizer_v1` returns predictable summary text. Zero cost, instant, reproducible.

### Label Spec
The combination of (model, promptVersionId) that identifies which classification results to use for filtering. A run is pinned to a specific label spec.

### Filter Mode
- **INCLUDE**: Only keep atoms whose labels match the listed categories
- **EXCLUDE**: Drop atoms whose labels match the listed categories

### Frozen Config
The snapshot stored in `Run.configJson`. Captures all parameters needed to reproduce the run's behavior, even if prompts or filters change later.

---

## Categories

### Core Categories
- **WORK**: Professional tasks, coding, meetings
- **LEARNING**: Educational content, research, tutorials
- **CREATIVE**: Writing, art, brainstorming
- **MUNDANE**: Everyday tasks, logistics, admin
- **PERSONAL**: Personal life, relationships, self-reflection
- **OTHER**: Doesn't fit elsewhere

### Risk Categories (for safety-exclude)
- **MEDICAL**: Health conditions, symptoms, treatments
- **MENTAL_HEALTH**: Therapy, emotional struggles
- **ADDICTION_RECOVERY**: Substance use, recovery
- **INTIMACY**: Romantic/sexual content
- **FINANCIAL**: Banking, investments, debt
- **LEGAL**: Legal matters, disputes
- **EMBARRASSING**: Content the user might regret sharing

---

## Seeded Profiles

### professional-only
INCLUDE mode with [WORK, LEARNING]. The default filter—shows only professional content.

### professional-plus-creative
INCLUDE mode with [WORK, LEARNING, CREATIVE]. Adds creative work to professional content.

### safety-exclude
EXCLUDE mode with all risk categories + EMBARRASSING. Removes potentially sensitive content.

---

## Status States

### Run Status
- **queued**: Created, not yet started
- **running**: At least one job is actively processing
- **completed**: All jobs succeeded
- **failed**: At least one job failed (others may have succeeded)
- **cancelled**: User cancelled; terminal state

### Job Status
- **queued**: Waiting to be processed
- **running**: Currently being processed
- **succeeded**: Completed successfully, output created
- **failed**: Encountered an error
- **cancelled**: Parent run was cancelled

---

## Timestamps

### Canonical Format
RFC 3339 with millisecond precision and Z suffix:
```
2024-01-15T10:30:00.000Z
```
All timestamps are stored and compared in UTC.

### dayDate
The calendar date (YYYY-MM-DD) derived from a timestamp using the import batch's timezone. Used for bucketing messages into days.

---

## API Patterns

### Sequential Polling
UI must wait for each `/tick` response before requesting the next. No fire-and-forget intervals. Prevents race conditions and duplicate processing.

### Advisory Lock
A Postgres session-scoped lock that prevents concurrent tick processing for the same run. Returns 409 if another tick is already running.

### Pagination
List endpoints use cursor-based pagination:
- Request: `limit` (default 50, max 200) + optional `cursor`
- Response: `{ items: [...], nextCursor?: string }`

---

## File Formats

### ChatGPT Export
JSON with `conversations` array, each containing `mapping` with message nodes.

### Claude Export
Top-level JSON array of conversation objects (not wrapped in `{ conversations: [...] }`). Each object has `uuid`, `name`, `created_at`, `updated_at`, and a `chat_messages` array of messages with `uuid`, `text`, `sender` (`"human"` or `"assistant"`), and `created_at`:
```json
[
  {
    "uuid": "conv-id",
    "name": "Title",
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601",
    "chat_messages": [
      {
        "uuid": "msg-id",
        "text": "content",
        "sender": "human" | "assistant",
        "created_at": "ISO 8601"
      }
    ]
  }
]
```
Sender `"human"` maps to role `"user"`. Timestamps may include microsecond precision or timezone offsets.

### Grok Export
Top-level JSON object (not an array) with a `conversations` array. Each element wraps a `conversation` metadata object and a `responses` array of message wrappers:
```json
{
  "conversations": [{
    "conversation": { "id": "uuid", "title": "...", "create_time": "ISO 8601" },
    "responses": [{
      "response": {
        "_id": "uuid",
        "message": "content",
        "sender": "human" | "assistant",
        "create_time": { "$date": { "$numberLong": "epoch_ms_string" } }
      }
    }]
  }],
  "projects": [],
  "tasks": []
}
```
Sender is case-insensitive (`"ASSISTANT"` treated as `"assistant"`). Timestamps use MongoDB extended JSON (epoch milliseconds as a string).

---

## Error Codes

All API errors follow the shape `{ error: { code, message, details? } }`.

### API layer (`api-utils.ts`)

| Code | HTTP | Meaning |
|------|------|---------|
| `INVALID_INPUT` | 400 | Request validation failed |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `UNSUPPORTED_FORMAT` | 400 | No parser matches the input format |
| `AMBIGUOUS_FORMAT` | 400 | Multiple parsers match the input format |
| `NOT_IMPLEMENTED` | 501 | Feature not yet implemented |
| `INTERNAL` | 500 | Unexpected server error |

### Run / domain layer (route handlers)

| Code | HTTP | Meaning |
|------|------|---------|
| `NO_ELIGIBLE_DAYS` | 400 | Filter/date range matched zero days |
| `TICK_IN_PROGRESS` | 409 | Another tick is already running for this run |
| `ALREADY_COMPLETED` | 400 | Cannot cancel a completed run |
| `CANNOT_RESUME_CANCELLED` | 400 | Cancelled runs cannot be resumed |
| `CANNOT_RESET_CANCELLED` | 400 | Cannot reset jobs in a cancelled run |

### LLM layer (`llm/errors.ts`)

| Code | HTTP | Meaning |
|------|------|---------|
| `BUDGET_EXCEEDED` | 402 | Budget limit exceeded |
| `LLM_BAD_OUTPUT` | 502 | Model returned unparseable/invalid output |
| `UNKNOWN_MODEL_PRICING` | 400 | No pricing data for provider+model |
| `MISSING_API_KEY` | 500 | API key not configured for provider |
| `PROVIDER_NOT_IMPLEMENTED` | 500 | Provider not yet implemented |
| `LLM_PROVIDER_ERROR` | 500 | SDK/API error from upstream provider |
