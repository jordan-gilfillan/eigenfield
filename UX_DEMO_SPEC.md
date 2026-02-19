# UX_DEMO_SPEC.md — Demo Wizard (EPIC-104, Non-binding)

## 1) Scope and Intent

This document defines a UX-first, point-and-click demo flow for a single-page wizard:
`Import -> Classify -> Summarize -> Use`.

Status: proposed roadmap only. This is not committed implementation work.

Authority boundaries:
- `SPEC.md` remains authoritative for engine/data/API contracts.
- `UX_SPEC.md` remains authoritative for current `/distill/*` UX behavior.
- This doc adds a future demo UX contract suitable for invite-only multi-tenant demos.

Hard constraints (must remain true):
- No hidden writes and no hidden retries.
- No background jobs, cron, or always-on workers.
- Determinism, frozen config, and spend safeguards from `SPEC.md` remain intact.

---

## 2) Demo Wizard UX Flow (Single Page)

## 2.1 Route and page frame
- New route: `/demo` (single-page wizard).
- Four visible numbered steps at top of page with status chips (`Not started`, `In progress`, `Complete`, `Blocked`).
- Exactly one primary CTA per step.
- "Advanced" link is always visible; it opens current power-user routes (see IA section).

## 2.2 Step definitions (click-by-click)

### Step 1: Import
- **User-visible label:** `1. Import Conversations`
- **Primary action:** click `Choose file` -> select one export file -> click `Import file`
- **Defaults:**
  - timezone defaults to current app default behavior (`America/Los_Angeles` when omitted)
  - source detection remains automatic unless explicitly overridden in advanced controls
- **Success criteria (step completes):**
  - `POST /api/distill/import` succeeds
  - UI shows import summary (filename, detected source, date coverage, total messages, total days)
  - "Continue to Classify" button becomes enabled

### Step 2: Classify
- **User-visible label:** `2. Classify Messages`
- **Primary action:** leave mode at default and click `Classify now`
- **Defaults:**
  - classification mode defaults to `Dry run (Recommended)` (maps to deterministic stub mode)
  - selected prompt/version is visible before submit
- **Success criteria (step completes):**
  - classify run reaches `succeeded`
  - UI shows totals (`messageAtoms`, `labeled`, `newlyLabeled`, `skippedAlreadyLabeled`)
  - "Continue to Summarize" button becomes enabled

### Step 3: Summarize
- **User-visible label:** `3. Summarize Days`
- **Primary action:** review defaults -> click `Create run` -> click `Start summarizing`
- **Defaults:**
  - summarizer mode defaults to dry-run/stub path
  - filter profile defaults to `professional-only`
  - sources default to all sources present in the imported batch
  - `maxInputTokens` defaults to `12000`
  - safe spend caps are prefilled for real mode (`$5.00 per run`, `$20.00 per day`) and shown before submit
- **Success criteria (step completes):**
  - run is created successfully
  - foreground summarize loop reaches terminal run status `completed` (or explicit, user-visible terminal state with next action)
  - at least one day output is available to view

### Step 4: Use
- **User-visible label:** `4. Use Distilled Output`
- **Primary action:** click a day result card -> view rendered output -> choose `Export` or `Open Advanced Tools`
- **Defaults:**
  - output list is newest day first
  - output viewer opens in read mode first
- **Success criteria (step completes):**
  - user opens at least one rendered output
  - export action and advanced navigation are visible and actionable
  - user can continue without touching advanced pages

## 2.3 Error messaging guidelines (all steps)
- Never render raw imported journal content inside error messages.
- Use a fixed error block structure: `Title`, `Code`, `What happened`, `Next action`.
- Show machine code when available (`INVALID_INPUT`, `NOT_FOUND`, `TICK_IN_PROGRESS`, etc.).
- Keep user-facing copy short and actionable; place diagnostics in redacted `details`.
- Include one recovery action per error (`Retry`, `Go back`, `Adjust settings`).
- Generic fallback copy when server payload is missing: "Something went wrong. Retry or return to the previous step."

---

## 3) Information Architecture (Current vs Proposed)

## 3.1 Routes that exist now

Current user-facing pages:
- `/` (home)
- `/distill` (dashboard)
- `/distill/import`
- `/distill/import/inspect`
- `/distill/runs/:runId`
- `/distill/search`
- `/distill/studio`

## 3.2 New route(s) for demo wizard

Proposed:
- `/demo` — primary invite-only demo wizard route with all four steps on one page.

Optional ergonomic extension (same page, URL state only):
- `/demo?step=import|classify|summarize|use`

## 3.3 What becomes "Advanced"

For demo users, advanced tools are linked but not required:
- `/distill` (power dashboard controls)
- `/distill/import` (raw import controls)
- `/distill/import/inspect` (atom-level inspection)
- `/distill/runs/:runId` (run diagnostics and recovery controls)
- `/distill/search` (cross-corpus search)
- `/distill/studio` (studio inspector)

Navigation expectation:
- `/demo` is the default entry for invited demo users.
- Existing `/distill/*` routes remain available as advanced paths, not removed.

---

## 4) Multi-tenant Readiness Requirements (Not Implemented Yet)

## 4.1 Tenant isolation expectations
- Every request executes under a resolved `tenantId`.
- Data reads and writes are tenant-scoped; cross-tenant reads return `NOT_FOUND` or authorization errors without leaking record existence.
- Imports, classify runs, summarize runs, outputs, and exports are all tenant-bound.
- Logs and error payloads remain tenant-safe and content-redacted.

## 4.2 Invite-only auth gate
- `/demo` and `/distill/*` require authenticated invite acceptance.
- Invite links are single-use, expiring, and revocable by admins.
- Unauthorized users see a generic gate page; no tenant/user existence leaks.
- Session must carry both `userId` and `tenantId` before any distill API call.

## 4.3 Delete-my-data UX
- Account menu exposes `Delete my data`.
- UX requires explicit confirmation phrase and names the deletion scope.
- On success, user is signed out and shown completion state.
- If deletion cannot complete in a foreground-safe way, STOP and design a separate architecture before implementation.

---

## 5) AUD Slicing Proposal (AUD-102 .. AUD-111)

All slices below inherit these non-negotiables:
- no background jobs or automatic schedulers
- determinism/frozen config invariants preserved
- no spend surprises (dry-run default; explicit real-mode confirmation + caps)

### AUD-102 — Demo wizard spec lock (docs-only)
- **Goal:** Freeze UX-first contract for `/demo` flow and future readiness requirements.
- **Touch set:** `SPEC.md`, `UX_SPEC.md`, `UX_DEMO_SPEC.md` only.
- **Acceptance checks:**
  - Demo flow, IA, multi-tenant readiness, and AUD slices are documented and cross-referenced.
  - No conflicts with `SPEC.md` invariants.
- **Stop rules:**
  - Stop if this requires code changes.
  - Stop if determinism rules in `SPEC.md` would be weakened.
  - Stop if spend defaults become ambiguous.

### AUD-103 — `/demo` route shell and stepper scaffold
- **Goal:** Add a single-page wizard shell with 4 visible steps and status chips.
- **Touch set:** `src/app/demo/page.tsx`, optional `src/app/demo/components/*`, `src/app/distill/layout.tsx` (nav link only).
- **Acceptance checks:**
  - `/demo` renders all four step labels in order.
  - No API calls are triggered on initial page load.
  - `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npx vitest run` pass.
- **Stop rules:**
  - Stop if implementation introduces hidden timers/background loops.
  - Stop if this requires route removals from `/distill/*`.
  - Stop if UI auto-triggers any write action.

### AUD-104 — Import step wiring
- **Goal:** Implement Step 1 with explicit upload/import and success state handoff.
- **Touch set:** `src/app/demo/page.tsx`, `src/app/api/distill/import/route.ts` (only if contract gaps), targeted tests.
- **Acceptance checks:**
  - Clicking `Import file` maps 1:1 to one `POST /api/distill/import`.
  - Import success state shows summary fields and enables Step 2.
  - Required gates pass (`lint`, `tsc`, `build`, `vitest`).
- **Stop rules:**
  - Stop if parser/source contracts in `SPEC.md` need widening.
  - Stop if errors include raw imported message text.
  - Stop if import starts auto-classify by default.

### AUD-105 — Classify step wiring with dry-run default
- **Goal:** Implement Step 2 classify action and progress/status UX.
- **Touch set:** `src/app/demo/page.tsx`, classify progress hooks/utilities, targeted tests.
- **Acceptance checks:**
  - Default mode is dry-run/stub and clearly labeled as recommended.
  - Classify runs only after explicit button click.
  - Success state captures terminal `succeeded` and enables Step 3.
  - Required gates pass (`lint`, `tsc`, `build`, `vitest`).
- **Stop rules:**
  - Stop if classify requires background processing outside user-initiated flow.
  - Stop if mode defaults to real LLM calls.
  - Stop if status polling triggers writes.

### AUD-106 — Summarize configuration defaults + safe caps UX
- **Goal:** Implement Step 3 configuration with safe defaults and explicit cap visibility.
- **Touch set:** `src/app/demo/page.tsx`, run creation form/state helpers, targeted tests.
- **Acceptance checks:**
  - Defaults: dry-run path, `professional-only`, union sources, `maxInputTokens=12000`.
  - Real mode reveals/uses prefilled spend caps (`$5.00/run`, `$20.00/day`) before submit.
  - Blocking validation prevents run creation on invalid cap inputs.
  - Required gates pass (`lint`, `tsc`, `build`, `vitest`).
- **Stop rules:**
  - Stop if real mode becomes default.
  - Stop if cap validation is bypassed.
  - Stop if run creation changes frozen config semantics.

### AUD-107 — Foreground summarize execution loop
- **Goal:** Implement explicit start/stop summarize execution and completion state.
- **Touch set:** `src/app/demo/page.tsx`, shared tick-loop hook(s), targeted tests.
- **Acceptance checks:**
  - `Start summarizing` is user-initiated and sends sequential tick calls (`maxJobs=1`).
  - Loop stops on terminal state, first error, unmount, or user stop.
  - Step 3 completion is visible and unlocks Step 4.
  - Required gates pass (`lint`, `tsc`, `build`, `vitest`).
- **Stop rules:**
  - Stop if any overlapping ticks are introduced.
  - Stop if retry/backoff loops run without user action.
  - Stop if run determinism/audit fields become optional.

### AUD-108 — Use step output and export handoff
- **Goal:** Implement Step 4 output browsing and export CTA in wizard context.
- **Touch set:** `src/app/demo/page.tsx`, output viewer components, optional route links, targeted tests.
- **Acceptance checks:**
  - User can open at least one rendered day output from wizard.
  - Export CTA is explicit and maps 1:1 to current export endpoint.
  - Advanced tool links are visible and preserve selected run context.
  - Required gates pass (`lint`, `tsc`, `build`, `vitest`).
- **Stop rules:**
  - Stop if step leaks raw source atoms in general UI error states.
  - Stop if export becomes auto-triggered.
  - Stop if wizard requires leaving flow for basic success.

### AUD-109 — Advanced IA split and navigation polish
- **Goal:** Make `/demo` the guided default while keeping `/distill/*` as advanced tooling.
- **Touch set:** distill/demo nav surfaces, route labels/copy, `UX_SPEC.md` updates, targeted tests.
- **Acceptance checks:**
  - `/demo` entry point is discoverable from home/nav.
  - "Advanced" grouping is explicit and includes existing power routes.
  - No existing route is removed or behaviorally regressed.
  - Required gates pass (`lint`, `tsc`, `build`, `vitest`).
- **Stop rules:**
  - Stop if route churn causes broken deep links.
  - Stop if navigation introduces hidden write side effects.
  - Stop if IA change requires unplanned large refactors.

### AUD-110 — Invite-only auth gate + tenant-aware session context
- **Goal:** Add invite-only gating and session-level tenant resolution for demo surfaces.
- **Touch set:** auth/middleware/session modules, `/demo` + `/distill/*` guards, API auth checks, tests.
- **Acceptance checks:**
  - Uninvited/unauthenticated users cannot access `/demo` or `/distill/*`.
  - Invited users resolve to session `{ userId, tenantId }`.
  - API rejects missing/mismatched tenant context with safe generic errors.
  - Required gates pass (`lint`, `tsc`, `build`, `vitest`).
- **Stop rules:**
  - Stop if auth flow leaks whether a user/tenant exists.
  - Stop if tenant context is optional for write APIs.
  - Stop if this depends on background invite processing.

### AUD-111 — Tenant isolation enforcement + Delete-my-data UX
- **Goal:** Enforce tenant data boundaries and ship a user-facing delete-my-data flow.
- **Touch set:** `prisma/schema.prisma`, migrations, tenant-scoped service queries, delete UX, tests, docs.
- **Acceptance checks:**
  - All distill-domain records are tenant-scoped and queried by tenant.
  - Delete-my-data flow requires explicit confirmation and removes tenant-owned distill data.
  - Post-delete access returns safe non-leaking errors for removed data.
  - `npm run db:migrate`, `npm run db:seed`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npx vitest run` pass.
- **Stop rules:**
  - Stop if delete requires cross-tenant operations.
  - Stop if purge requires non-foreground/background job machinery.
  - Stop if spend/rate-limit safeguards are weakened during tenant work.
