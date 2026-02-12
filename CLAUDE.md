# CLAUDE.md — Journal Distiller Agent Operating Guide

This repo uses a strict remediation workflow to preserve conceptual control, prevent scope creep, and keep documentation from drifting.

## Documentation discipline (single sources of truth)
Keep public-facing content in `README.md`. Avoid creating new “control docs.”

Doc ownership (what is canonical):
- `SPEC.md` — product/behavior contract (requirements, invariants). If two docs disagree about behavior, SPEC wins.
- `UX_SPEC.md` — user-facing UX behavior and UI rules. Must not restate backend contracts; link to SPEC instead.
- `REMEDIATION.md` — the only canonical task/todo source (AUD entries). No other TODO lists.
- `DECISIONS.md` — ADRs only (why we chose something). No requirements.
- `CHANGELOG.md` — release notes only (what changed), no “current status” facts.
- `CONTEXT_PACK.md` — agent context + volatile snapshot only (allowed to drift; keep short; prefer links/commands over facts).
- `EXECUTION_PLAN.md` and `ACCEPTANCE.md` — historical/supporting docs. Prefer archiving to `/docs/archive/` once the phase is complete.

Drift rules (hard):
- Do not duplicate volatile facts (test counts, status, PR lists) across multiple docs.
- If a doc needs a fact that changes, prefer a command (“run `npx vitest run`”) or a link to the single owning place.
- When adding or changing behavior: update SPEC first, then tests, then any links.

Doc changes per PR:
- Aim to update at most 1–2 docs per PR (plus tests/code). If you must touch more, stop and split work.

## Canonical task source
- `REMEDIATION.md` is the single source of truth for remediation work.
- Work on exactly one remediation entry per PR: `AUD-###`.
- Do not create competing TODO lists in other docs. If you discover new issues, add a new `AUD-###` entry.

## Prompt template (copy/paste)
Use this minimal template when instructing an agent. Keep prompts short and refer back to this guide instead of repeating it.

```
AUD-### — <short title>

Follow CLAUDE.md execution loop: one AUD per branch/PR, no scope creep, stop after merge + clean master.

Branch:
- git checkout -b fix/AUD-###-short-slug

Goal:
- <1–2 sentences: what “done” means>

Files to change (allowed scope): (include docs only if required by the owning-doc rules)
- <explicit list>

Acceptance checks (from REMEDIATION.md):
- <copy bullets exactly>

Verify:
- npx vitest run
- <any extra commands: migrations/lint/etc>
- <if docs changed: run doc drift check script if present>

Stop:
- Update REMEDIATION.md (Status=Done + Resolution), commit, merge to master, return to clean master.
```

Notes:
- If a task would require touching files outside “Files to change”, STOP and create a new AUD entry instead.
- If you discover adjacent issues, record them as a new AUD and STOP.

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
- Create a new branch per AUD: `fix/AUD-###-short-slug` (docs-only changes may use `docs/AUD-###-short-slug`).
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
   - plus any specific commands relevant to the change (e.g., `npx prisma migrate dev`, lint, etc.)
   - If a command fails and fixing it would expand scope beyond the AUD, STOP and record a new AUD.
7. Report:
   - files changed
   - test results
   - any risks/edge cases
8. Update `REMEDIATION.md` (Status=Done + short Resolution note), **commit**, then **merge to `master`** and return to a clean `master` state.

## Stopping rule
Stop once acceptance checks pass and `REMEDIATION.md` is updated.
Do not continue “improving” things beyond the single AUD.
If you are unsure whether a change is in-scope, assume it is out-of-scope and STOP.

## Doc consolidation / archiving playbook
Use this when a phase wraps up and docs have multiplied.

1) Choose keepers (active canon): SPEC, UX_SPEC, REMEDIATION, DECISIONS, README, CHANGELOG, CONTEXT_PACK.
2) For any non-keeper doc:
   - If it contains timeless rules/definitions → move that content into the owning doc above, then delete it from the old doc.
   - If it’s mostly historical planning/logs → move the whole file to `/docs/archive/<YYYY-MM-DD>-<name>.md` and add a short banner at top: “ARCHIVED: historical reference; not canonical.”
3) Replace removed content with links:
   - In README: link to SPEC/UX_SPEC/REMEDIATION/DECISIONS.
   - In archived docs: link forward to the new owning doc.
4) Run a quick drift scan:
   - search for duplicated “single source of truth” claims
   - search for volatile facts (test counts, statuses) and keep them in only one place (prefer CONTEXT_PACK or CI).

## Definition of done
- Only the single targeted AUD was addressed; no unrelated changes.
- Acceptance checks in the AUD entry pass
- Changes are committed on `fix/AUD-###-short-slug`
- `REMEDIATION.md` updated (Status=Done + Resolution note)
- Branch merged to `master`
- `master` checked out and clean (`git status` clean)