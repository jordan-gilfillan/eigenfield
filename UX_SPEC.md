# UX_SPEC.md — Journal Distiller v0.3

## 1) Scope and Boundaries

### In scope (this doc)
- UX behavior, information architecture, interaction rules, and visual consistency for:
  - `/distill` (dashboard)
  - `/distill/search`
  - `/distill/import/inspect`
  - `/distill/runs/:runId`
- Manual acceptance checks for those pages.
- Incremental PR slicing for UX delivery.
- This is a UX specification, not an implementation plan or refactor.

### Out of scope (owned by `SPEC.md`)
- Engine semantics, data contracts, and business invariants.
- Changes to determinism, auditability, frozen config rules.
- Hidden side effects or implicit workflows.

### Non-negotiable UX guardrails
- Buttons/actions map 1:1 to explicit API calls.
- No hidden writes, no hidden retries, no hidden background jobs.
- No background polling.
- Foreground polling is allowed only while page is open for read-only progress/status endpoints, and must use:
  - `setTimeout` loop (no `setInterval`)
  - `AbortController` per request
  - stop on unmount
  - stop on terminal state (`succeeded`, `failed`, `cancelled`, `completed`) or user toggles it off.

---

## 2) Reference UX Signals From Old Journal UI

Reference source from prompt: `archive/journal` (present in this repo as `archve/journal`, used as UX reference only).

### What felt good (convert to requirements)
- Persistent app-level nav with active tab state.
  - Reference: `archve/journal/src/components/Nav.tsx`, `archve/journal/src/app/distill/layout.tsx`
- Consistent card + table system across pages.
  - Reference: `archve/journal/src/app/globals.css` (`.card`, `.table`, `.badge`, `.progress`)
- Two-column action + context layout on core pages.
  - Reference: `archve/journal/src/app/distill/page.tsx`, `archve/journal/src/app/distill/import/page.tsx`, `archve/journal/src/app/distill/filters/page.tsx`, `archve/journal/src/app/distill/prompts/page.tsx`
- Dense status visibility (badge + progress + counters) near primary CTA.
  - Reference: `archve/journal/src/app/distill/page.tsx`, `archve/journal/src/app/distill/runs/page.tsx`
- Explicit "Back to Dashboard" and clear next action links.
  - Reference: `archve/journal/src/app/distill/import/page.tsx`, `archve/journal/src/app/distill/filters/page.tsx`

---

## 3) Top 10 Current Clunk Points and Required Fixes

Derived from current `src/app/distill/**` code plus provided old-UI screenshots.

1. No shared distill shell/nav; each page hand-rolls breadcrumbs/links.
- Fix: Add a shared distill layout shell with persistent top nav and active state.

2. Dashboard mixes import selection, classify, create run, and feature cards in one long flow.
- Fix: Split into 2-column layout: left = primary flow, right = status/context/next action.

3. Dashboard "Create Run" is gated by local `classifyResult` instead of persisted classify state.
- Fix: Gate create-run readiness from last persisted classify stats for selected label spec.

4. Many load failures are silent (`catch {}`), leaving blank UI with no diagnosis.
- Fix: Replace silent failures with inline actionable error blocks + retry button.

5. Search scope switch wipes results with no explicit cue to rerun.
- Fix: Show "scope changed, press Search" notice and preserve previous query/results until submit.

6. Search cards are visually similar; low scanability for source/day/stage context.
- Fix: Add stronger metadata row hierarchy and stable density rules (badge order, fixed meta slots).

7. Import Inspector has weak orientation when deep-linked; day/source context can be unclear.
- Fix: Add persistent context bar (batch, coverage, selected day/source, atom count) and quick clear filters.

8. Run detail is vertically heavy; key status/progress is not sticky and next action is buried.
- Fix: Add compact run status rail at top (status, progress, tick control, primary next action).

9. Job table rows include embedded viewers inline for every row, increasing visual noise.
- Fix: Collapse viewer panels by default (expand per row) and keep table density compact.

10. UX language and affordances vary by page (Back/Home labels, button styles, empty-state tone).
- Fix: Standardize button hierarchy, empty/error templates, and "next action" copy.

---

## 4) Per-Page UX Requirements

## 4.1 `/distill` Dashboard

### Goals
- Complete the core sequence with minimal ambiguity:
  - choose import batch
  - classify (or verify classification status)
  - create run
  - jump to run detail.

### Requirements
- [x] Page uses shared distill shell nav (Dashboard active).
- [x] Layout: 2 columns on desktop (`primary flow` + `status/context`), 1 column on mobile.
- [ ] "Select import batch" card supports multi-select (checkboxes or multi-select list):
  - When 1 batch selected: behaves identically to current single-batch flow.
  - When 2+ batches selected:
    - Display selected batch count and filenames.
    - Timezone validation: if timezones differ, show inline error
      ("Selected batches have different timezones: {tz1}, {tz2}. All must match.")
      and disable Create Run button.
    - Sources checkboxes reflect the UNION of sources across all selected batches.
    - Classification: must exist for each selected batch (with matching labelSpec).
      If any batch lacks classification, show per-batch warning.
  - Each batch card shows: filename, source, coverage, timezone, message/day counts.
- [ ] Create-run card shows "{N} batches selected" with expandable list when multi-batch.
- [x] Classification card shows:
  - current mode, label spec, status badge
  - processed/total progress and percent when running
  - last run timestamp
  - explicit `Refresh` button.
- [ ] Create-run card shows frozen inputs with clear dependency states:
  - disabled reason text when blocked
  - next required action with direct link/button.
- [x] Latest/last run summary card shows run status, progress bar, and "View Run" CTA.
- [x] Empty states include explicit next action links.
- [ ] No auto updates unless user enabled foreground polling for visible progress.

## 4.2 `/distill/search`

### Goals
- Fast triage across raw atoms and outputs with minimal context switching.

### Requirements
- [x] Search bar + scope controls remain visible at top while scanning results.
- [x] Scope change does not silently discard user context; show explicit re-run cue.
- [x] Result card hierarchy is consistent:
  - type badge
  - source/day/stage metadata
  - snippet with highlights
  - destination CTA.
- [x] Show result count + whether more pages are available.
- [x] Error block includes retry action.
- [x] Empty state includes query + scope and one next action suggestion.

## 4.3 `/distill/import/inspect`

### Goals
- Inspect imported atoms by day/source quickly and with strong orientation.

### Requirements
- [x] Batch selection state is explicit and URL-shareable.
- [x] Day list + atom panel support clear active state and count visibility.
- [x] Top context bar includes: batch filename, source, coverage, selected day, source filter.
- [x] Source filter has clear/reset affordance.
- [x] Atom cards maintain compact metadata row (time, role, source, category/confidence).
- [x] Empty day/empty filter states include a recoverable next step.
- [x] Keep manual navigation links to Dashboard and Search visible.

## 4.4 `/distill/runs/:runId`

### Goals
- Operate and diagnose a run with confidence and low cognitive load.

### Requirements
- [x] Top status rail includes run status badge, progress counters, and primary controls.
- [x] Tick, reset, resume/cancel style controls are grouped and clearly state side effects.
- [x] Last classify stats card includes status, processed/total, percent, error summary, refresh.
- [x] Frozen config remains visible but collapsible after first view.
  - Multi-batch runs: Run Info section shows list of batch IDs/filenames instead of single "Import Batch" line.
- [x] Jobs table defaults to compact rows; heavy inspectors are progressive disclosure.
- [ ] Error copy includes code + human-readable action guidance.
- [x] All controls remain 1:1 with explicit API actions.
- [x] Auto-run controls (foreground tick loop per SPEC §7.4.2):
  - "Start Auto-run" button visible when run is non-terminal and auto-run is not active.
  - "Stop Auto-run" button visible when auto-run is active.
  - While auto-run is active, manual "Tick" button is disabled OR guarded to prevent overlap (either disable or serialize behind the same loop).
  - Auto-run state indicator ("Auto-running..." with visual cue) visible while active.
  - Sequential tick calls only (await each response before next).
  - Auto-run stops on: navigation/unmount, terminal run status, first tick error.
  - On error stop: show error inline; manual Tick and "Restart Auto-run" remain available after stop.

---

## 5) Shared UI Patterns

### Layout and spacing
- [ ] Max content width: `~1200px` desktop; edge padding consistent across pages.
- [ ] Vertical rhythm tokens: 8 / 12 / 16 / 24 / 32.
- [ ] Cards: consistent border radius, border contrast, heading spacing.

### Typography scale
- [ ] Page title: 30-32 px semibold.
- [ ] Section title: 20-24 px semibold.
- [ ] Card title: 16-18 px medium/semibold.
- [ ] Body text: 14-16 px.
- [ ] Meta text and badges: 12-13 px.

### Table density
- [ ] Default row height optimized for scanability (~40-44 px).
- [ ] Right-align numeric columns.
- [ ] Keep one-line truncation with tooltip for long IDs/errors.
- [ ] Row actions aligned right and consistently named.

### Error and empty states
- [ ] Use consistent alert blocks: title, message, action.
- [ ] Include API code when available.
- [ ] Every empty state provides one explicit next action.

### Next-action guidance
- [ ] Each page has one primary CTA and at most one secondary CTA in each card.
- [ ] Disabled controls explain "why disabled" directly below or beside control.

---

## 6) Long-Running Operations UX

### Classification progress
- [x] Source of truth: `ClassifyRun` (`status`, `processedAtoms`, `totalAtoms`, counters, error).
- [x] Show processed/total and percent whenever `status=running`.
- [x] Show latest checkpoint timestamp (`updatedAt` or equivalent) when available.
- [x] Expose manual `Refresh` everywhere progress is shown.

### Run progress
- [x] Show queued/running/succeeded/failed/cancelled counters and overall completion percent.
- [x] Tick actions must remain explicit user actions.

### Foreground polling policy (optional, page-open only)
- [x] Poll only read endpoints for progress/status.
- [ ] Start polling only when page is visible and operation is non-terminal.
- [x] Use `setTimeout` + `AbortController`, abort previous request before next tick.
- [ ] Stop on unmount, on terminal status, or when user disables auto-refresh.
- [ ] Interval: 750–1500 ms (or exponential backoff); no concurrent requests. *(Aligned with SPEC §4.6; code uses 1 000 ms.)*

### Run auto-run (foreground tick loop)
- [x] "Start Auto-run" / "Stop Auto-run" toggle in run detail controls.
- [x] Auto-run state indicator visible while active ("Auto-running...").
- [x] While auto-run is active, manual "Tick" button is disabled OR guarded to prevent overlap.
- [x] Sequential POST /tick calls with maxJobs=1 (no overlap).
- [x] Stops on unmount, terminal status, or first tick error.
- [x] On error: stop, show error, allow manual Tick or restart auto-run.
- [x] Uses `setTimeout` + `AbortController` (same lifecycle pattern as read-only polling).

---

## 7) Manual Acceptance Checks

## 7.1 Dashboard
- [ ] Select a batch and verify batch summary updates immediately.
- [ ] Trigger classify and verify running progress is visible with processed/total + %.
- [ ] Click Refresh and confirm stats update without page reload.
- [ ] Validate create-run disabled reasons are explicit and actionable.
- [ ] Create run and confirm direct navigation to run detail.

## 7.2 Search
- [ ] Run query in `raw`; confirm highlighted snippets and metadata are clear.
- [ ] Switch scope; confirm UI prompts user to re-run (no silent confusion).
- [ ] Load more; confirm appended results and count continuity.
- [ ] Force API error; confirm error block with retry.

## 7.3 Import Inspector
- [ ] Open without batch param; select batch; confirm URL is updated.
- [ ] Select day and source filter; confirm context bar and atom counts stay accurate.
- [ ] Clear source filter; confirm recovery path and atom list refresh.
- [ ] Verify empty states are actionable (not dead ends).

## 7.4 Run Detail
- [ ] Verify top status rail reflects live run state and available controls.
- [ ] Use Tick; verify 1:1 action and result feedback.
- [ ] Verify last classify card shows status + progress + refresh.
- [ ] Expand a job inspector and confirm table remains readable.
- [ ] Verify failed states show code, message, and a next step.
- [ ] Start auto-run; verify sequential tick calls with visible progress updates.
- [ ] Verify auto-run stops automatically when run completes (terminal status).
- [ ] Force a tick error during auto-run; verify auto-run stops and error is displayed.
- [ ] Navigate away during auto-run; verify it stops cleanly (no orphaned requests).
- [ ] Verify manual Tick button is disabled or guarded while auto-run is active.

---

## 8) Incremental PR Plan

> **Roadmap, not commitment.** The items below are planned UX improvements listed in suggested delivery order. None are binding until work begins. Each item will be updated with a status marker as it progresses.

### UX-8.1 Distill Shell + Navigation
- Add shared distill layout with persistent nav and active tab state.
- Independently useful: immediate orientation and consistency.
- **Status**: Done (AUD-015) — shared layout with persistent nav and active tab state

### UX-8.2 Shared State Components
- Introduce shared alert/empty/loading/next-action components.
- Independently useful: consistent error and empty handling everywhere.
- **Status**: Partial (AUD-017, AUD-038) — shared ui-utils/types extracted; shared alert/empty/loading components remain

### UX-8.3 Dashboard IA Pass
- Recompose dashboard into primary flow + status/context column.
- Fix create-run gating to persisted classify status.
- **Status**: Done (AUD-016, AUD-033)

### UX-8.4 Dashboard Progress Surface
- Add standardized progress panel for classify status with manual refresh and percent.
- **Status**: Done (AUD-037)

### UX-8.5 Search Readability Pass
- Improve scope-change affordance, metadata hierarchy, and retry UX.
- **Status**: Done (AUD-019, AUD-036)

### UX-8.6 Import Inspector Orientation Pass
- Add context bar, better filter controls, and stronger empty-state recovery.
- **Status**: Done (AUD-034)

### UX-8.7 Run Detail Task-Focus Pass
- Add top status rail and progressive disclosure for heavy job inspectors.
- **Status**: Done (AUD-018, AUD-035)

### UX-8.8 Foreground Progress Hook
- Add reusable foreground polling hook (read-only status endpoints, abort-safe lifecycle).
- Wire only where explicitly enabled in UI.
- **Status**: Done (AUD-039, AUD-040)

---

## 9) Demo Wizard (EPIC-104, Non-binding)

This section defines a UX roadmap for a guided single-page wizard intended for invite-only demos. It does not change current `/distill/*` contract behavior. Detailed design and AUD slicing live in `UX_DEMO_SPEC.md`.

## 9.1 Demo flow summary

Planned route:
- `/demo` (single page with 4 steps)

Planned step labels:
- `1. Import Conversations`
- `2. Classify Messages`
- `3. Summarize Days`
- `4. Use Distilled Output`

Step completion expectations:
- Import completes after successful import summary response.
- Classify completes at terminal classify status `succeeded`.
- Summarize completes when run reaches terminal success path and outputs are available.
- Use completes when a rendered output is opened and export/advanced actions are available.

## 9.2 Defaults and safety requirements
- Dry-run mode is the default for classify/summarize.
- Safe spend caps are visible and explicit before real-mode calls.
- Error messages must be actionable and must not include raw imported journal content.
- No hidden retries, no hidden writes, and no background jobs.

## 9.3 Information architecture direction
- `/demo` becomes the default guided entry for invited demo users.
- Existing `/distill/*` pages remain available as advanced tooling.
- Advanced includes dashboard controls, inspector, search, studio, and run diagnostics routes.

## 9.4 Implementation slicing
- Proposed sequence: `AUD-102` through `AUD-111`.
- Each slice includes goal, touch set, acceptance checks, and explicit stop rules in `UX_DEMO_SPEC.md`.
