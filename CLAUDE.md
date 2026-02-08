# CLAUDE.md — Journal Distiller Agent Operating Guide

This repo uses a strict remediation workflow to preserve conceptual control and prevent scope creep.

## Canonical task source
- `REMEDIATION.md` is the single source of truth for remediation work.
- Work on exactly one remediation entry per PR: `AUD-###`.
- Do not create competing TODO lists in other docs. If you discover new issues, add a new `AUD-###` entry.

## Scope rules (hard)
- Fix exactly one `AUD-###` per branch/PR.
- No refactors, no “nice-to-haves,” no unrelated cleanup.
- If adjacent issues are found, note them in `REMEDIATION.md` and stop.

## Git hygiene (must)
Before making changes:
- `git status`
- `git branch --show-current`
- `git log -5 --oneline`

Branching:
- Create a new branch per AUD: `fix/AUD-###-short-slug`
- Do not create/switch branches unless needed for the PR.
- Keep `master` clean; merge back and return to `master` in a clean state after PR completion.

Commits:
- Commit in small, descriptive commits.
- Prefer separating code/test changes from doc updates when practical.

Merge requirement:
- When acceptance checks pass, **commit** all changes on the feature branch.
- Ensure `master` has not diverged unexpectedly (fetch/pull if needed) before merging.
- **Merge to `master`** (or open a PR if that is your workflow), then return to `master`.
- End in a **clean working tree** (`git status` shows nothing to commit).

## Execution loop for an AUD
1. Open `REMEDIATION.md` and locate the target entry.
2. Restate the acceptance checks in your own words.
3. Identify minimal files/functions to change.
4. Implement the smallest change that satisfies acceptance checks.
5. Add/adjust tests to lock the behavior.
6. Run:
   - `npx vitest run`
   - plus any specific commands relevant to the change (migrations, lint, etc.)
7. Report:
   - files changed
   - test results
   - any risks/edge cases
8. Update `REMEDIATION.md` (Status=Done + short Resolution note), **commit**, then **merge to `master`** and return to a clean `master` state.

## Stopping rule
Stop once acceptance checks pass and `REMEDIATION.md` is updated.
Do not continue “improving” things beyond the single AUD.

## Definition of done
- Acceptance checks in the AUD entry pass
- Changes are committed on `fix/AUD-###-short-slug`
- `REMEDIATION.md` updated (Status=Done + Resolution note)
- Branch merged to `master`
- `master` checked out and clean (`git status` clean)