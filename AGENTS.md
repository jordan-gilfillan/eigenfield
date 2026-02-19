# AGENTS.md

This file defines repo-local operating instructions for coding agents.
If guidance conflicts, prioritize in this order:
1. Direct user request
2. This file
3. Other repo docs

## Project Context
- App: `journal-distiller` (Next.js + Prisma + PostgreSQL).
- Remediation workflow is strict and task-scoped.
- Sensitive data domain: avoid exposing or leaking journal content.
- Repo history includes an exploratory phase; current workflow is PR-first + gates to keep `master` green.

## Canonical Docs (Single Source Rules)
- `SPEC.md`: product + backend behavior contract (authoritative).
- `UX_SPEC.md`: UI/UX behavior (must align with SPEC).
- `REMEDIATION.md`: canonical task ledger for **open** `AUD-###` items only.
- `REMEDIATION_ARCHIVE.md`: completed `AUD-###` history (append-only).
- `DECISIONS.md`: ADRs and rationale only.
- `README.md`: setup and public-facing usage.
- `CHANGELOG.md`: release notes only.

Do not create parallel TODO/control docs. If you discover work that is out of scope, add a new `AUD-###` entry to `REMEDIATION.md` (minimal contract + acceptance checks) instead of expanding scope.


## Task Scope Rules
- Work exactly one `AUD-###` per branch/PR unless user explicitly asks otherwise.
- Keep changes minimal and in-scope for the target AUD.
- If unrelated issues are discovered, record a new AUD entry instead of expanding scope.

## Stop Conditions
STOP and ask the user (or report) before proceeding if any of the following are true:
- Acceptance checks cannot be met without widening scope beyond the target AUD.
- Required gates fail and the fixes appear unrelated to the target AUD.
- SPEC/UX_SPEC/ledger language is ambiguous in a way that changes observable behavior.
- A change would weaken determinism, spend/rate-limit safeguards, or introduce background work.
- You believe the change might expose sensitive user content (logs, errors, fixtures).

## Execution Workflow
1. Read the target entry in `REMEDIATION.md` and restate its acceptance checks.
2. Confirm scope/touch set before coding. If unclear, STOP and ask.
3. Implement the smallest viable change.
4. Add/update tests for any behavior change.
5. Run the required validation commands.
6. Update `REMEDIATION.md` status + resolution only when all acceptance checks pass.

Work is **foreground / user-initiated only**. Do not add background scheduling, cron, or automatic jobs unless the user explicitly requests it and SPEC is updated accordingly.

## Verification Commands
Run these for any code change unless the AUD explicitly says otherwise:
- Lint: `npm run lint`
- Types: `npx tsc --noEmit`
- Build: `npm run build`
- Tests: `npx vitest run`

If database changes are required:
- Migrate: `npm run db:migrate`
- Seed: `npm run db:seed`

If a required command fails and fixing it would exceed scope, STOP and report. Do not broaden scope.

## AUD Entry Template
When creating a new `AUD-###` entry in `REMEDIATION.md`, keep it short and testable:

- **Title:** `AUD-### — <short title>`
- **Status:** `Not started | In progress | Blocked`
- **Goal:** one sentence describing the user-visible or contract-level outcome.
- **Touch set:** list allowed files/modules; explicitly forbid routes/schema/refactors if not needed.
- **Acceptance:** concrete checks (commands + expected outcomes); add golden/determinism tests when relevant.
- **Notes:** only if necessary (constraints, edge cases, stop rules).

## Git Hygiene
- Before edits: check branch and working tree status.
- Use PR-first for changes intended to land on master (including docs-only). If `gh` is available and authenticated, open a PR; otherwise provide the compare link.
- Keep `master` green: do not merge if lint/tsc/build/vitest fail.
- Use a dedicated branch per AUD: `fix/AUD-###-short-slug`.
- Do not revert unrelated local changes.
- Avoid destructive git commands unless explicitly requested.

## Change Discipline
- Prefer targeted edits over refactors.
- Keep docs synced with behavior changes (update owner doc first).
- `REMEDIATION.md` must remain short and navigable (open items only). Move completed entry blocks to `REMEDIATION_ARCHIVE.md` and leave one-line stubs.
- Do not duplicate volatile facts across multiple docs.

## Safety
- Assume imported chat data may contain sensitive information.
- Avoid adding test fixtures that contain realistic private journal content; use synthetic minimal text.
- Prefer redacted error messages; never include raw user content in thrown errors returned by API routes.
- Never add logging that prints raw conversation content or secrets.
- Preserve spend/rate-limit safeguards and dry-run defaults unless requested.
