# UX_SPEC.md - Journal Mirror Demo v1

This document defines user-facing behavior for the fresh-start Journal Mirror product.

## 1) Scope

In scope for v1:
- one end-user page for ask-and-verify
- one optional builder-only ingest/index screen or script-driven ingest flow
- clear evidence inspection tied to each answer

Out of scope for v1:
- distill dashboards
- runs/jobs/stages/batches UI
- prompt administration UI
- background progress consoles
- multi-page workflow orchestration

## 2) Product UX Intent

The UI should feel like a calm journal reader with evidence.

A user should be able to:
1. ask a question about the imported archive
2. read a direct answer
3. inspect exactly which excerpts support that answer
4. judge trust quickly

If the user cannot explain what happened in under one minute, the UX is too complex.

## 3) Primary Surface

Primary route:
- `/` (or `/ask`) is the main end-user experience.

Primary layout:
- top: question input plus submit
- left/main: answer
- right/secondary (or stacked on mobile): citations list and excerpt viewer

Required visible elements:
- question input
- submit action
- answer area
- citations list
- excerpt inspection panel (inline or side panel)
- concise status/error line

No other primary navigation is required for v1.

## 4) Optional Builder Surface

Builder-only ingest can be either:
- script-first (preferred), or
- a small builder page (not part of end-user flow)

Rules:
- builder actions are explicit and manual
- no hidden background ingest/index jobs
- end-user page must remain usable without exposing builder controls

## 5) Interaction Contract

Ask flow:
1. user enters question
2. user clicks submit
3. UI shows loading state
4. system returns answer plus citations (or clear failure)
5. user selects citation to inspect excerpt details

Citation flow:
- selecting a citation reveals excerpt text and metadata
- metadata includes source label, timestamp/date when available, and stable ID/handle
- citation highlight stays synchronized between answer references and citation list

Retry flow:
- user can re-submit same question without page reload
- prior answer remains visible until replacement is ready (or explicitly cleared)

## 6) Answer Presentation Rules

Answer section must:
- separate observations from inferences
- avoid overconfident language when evidence is weak
- clearly state uncertainty or missing evidence

Recommended structure:
- Answer (direct response)
- What the archive directly shows (observations)
- Possible interpretation (tentative)

This structure can be simplified, but the observation/inference split is required.

## 7) Evidence Presentation Rules

Each citation row should include:
- source
- date/time when available
- stable ID/handle
- short excerpt preview

Excerpt viewer should include:
- fuller excerpt text
- same metadata as citation row
- optional previous/next citation controls

Evidence constraints:
- every substantive answer claim should map to at least one visible citation
- if evidence is insufficient, UI must say so and still show best matches if available

## 8) States And Feedback

Loading state:
- disable submit while request is active
- show concise loading indicator

Empty state:
- before first query, show one sentence explaining what questions work well

No-result state:
- say no strong evidence found
- suggest rephrasing or narrower question

Error state:
- short human-readable message
- one retry action
- do not expose raw sensitive text in errors

## 9) Mobile Behavior

On small screens:
- question input stays at top
- answer appears first
- citations collapse into an accordion/list below answer
- tapping citation opens inline excerpt panel

No horizontal scrolling for core content.

## 10) Voice And Copy

Tone:
- direct
- plain language
- low drama
- no pseudo-clinical claims

Preferred labels:
- Ask
- Answer
- Supporting excerpts
- Observed in archive
- Possible interpretation

Avoid labels like:
- run
- stage
- pipeline
- prompt slot
- job status

## 11) Manual Acceptance Checks

End-user flow:
- [ ] Ask a concrete question and receive answer plus citations in one submit.
- [ ] Click at least two citations and verify excerpt text plus metadata are inspectable.
- [ ] Verify answer distinguishes observation from inference.
- [ ] Re-submit another question without page reload.

Failure behavior:
- [ ] Trigger no-result scenario and verify clear no-evidence messaging.
- [ ] Trigger backend failure and verify concise error plus retry action.

Simplicity checks:
- [ ] No UI element references runs/jobs/stages/batches/prompts.
- [ ] Whole flow can be demoed in under one minute.

## 12) Hard UX Limits

Reject changes that add any of the following unless SPEC is explicitly amended:
- additional end-user workflow pages
- background progress dashboards
- configuration panels for hypothetical future needs
- UX complexity that serves architecture more than user trust

## 13) Design Decision Rule

When in doubt, choose the interface with fewer controls and clearer evidence.

Complexity is guilty until it improves the ask-answer-verify loop.
