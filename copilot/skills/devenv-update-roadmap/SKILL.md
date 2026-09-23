---
name: devenv-update-roadmap
description: 'Sync a roadmap artifact (doc_id-addressed comment on its parent epic) with the current state of its linked issues and PRs, optionally creating issues for steps that don''t yet have them. USE WHEN the user says "update the roadmap", "sync the roadmap", "refresh roadmap status", "update roadmap state from issues", or "the roadmap is out of date". Maps issue/PR state to step status (closed → ✅, open + linked PR → 🟡, open no PR → ⬜, blocking label → ⏸️), updates the epic task list, and republishes the artifact. Also detects steps without issues and offers to create them. DO NOT USE for creating a new roadmap (use /devenv-create-roadmap), for refining the underlying blueprint (use /devenv-refine-blueprint), or for structural roadmap edits (use /devenv-refine-roadmap).'
argument-hint: '<epic-number[:doc_id]> — the roadmap artifact to sync'
user-invocable: true
---

# Update Roadmap

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`.

> **Skill feedback:** If nothing is wrong but the user asks how the skill could be improved, follow the shared [Skill Feedback Protocol](../common/references/skill-feedback-protocol.md) to write `IMPROVEMENT_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`. Zero findings is a valid result; never offer unprompted.

Reconcile a roadmap artifact with reality: read every linked issue and PR, recompute each step's status, update the epic task list, and republish the artifact. Optionally create issues for steps that don't have them yet.

This skill keeps the roadmap a *current state of the work* document, not just a planning artifact. Roadmaps are issue artifacts (doc_id-addressed comments on their parent epic) — no local file is kept. Pull/edit/republish mechanics follow the shared [issue-backed artifact edit protocol](../common/references/issue-backed-artifact-edit-protocol.md).

## When to Use

Trigger phrases:

- "update the roadmap" / "sync the roadmap"
- "refresh roadmap status"
- "the roadmap is out of date"
- "update roadmap state from issues"

Do **not** use for:

- Creating a new roadmap → [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md)
- Refining the underlying blueprint → [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md)
- Editing roadmap step descriptions or sequencing → [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md)
- Combined plan + roadmap progress views → `/devenv-board` (read-only Answer class). This skill's summary stays single-artifact: it describes the roadmap it just synced, never an aggregate across plans and issues.

## Inputs

The user provides an epic number (optionally `:<doc_id>` when the epic holds more than one roadmap artifact) — e.g. `89`.

Resolution: `DOC_ID=$(issue-artifact-select --issue <N> --artifact-type roadmap [--latest] --format doc-id)` → `mkdir -p <repo-root>/.local-artifacts && issue-artifact-get --issue <N> --doc-id "$DOC_ID" --write-body <repo-root>/.local-artifacts/roadmap-sync.md` (session scratch copy under the [standard local markdown folder](../_conventions.md#standard-local-markdown-folder-local-artifacts)).

## Status Mapping (precedence — first match wins, per STEP)

A STEP may link **one or more issues** (canonical `org/repo#N`, one per line under
`Issues:`). Evaluate the set:

| Precedence | Condition across the STEP's linked issues | Status |
|---|---|---|
| 1 | All closed via merge | ✅ Done |
| 2 | Any has a `blocked` or `paused` label | ⏸️ Paused |
| 3 | Any open **and** (has a linked PR **or** its plan artifact reports progress > 0) | 🟡 In progress |
| 4 | All open, no PRs, no plan progress | ⬜ Not started |
| 5 | All closed without merge | ❌ Cancelled |

**Plan progress annotation.** When a linked issue has a plan artifact
(`issue-artifact-select --issue N --artifact-type plan`), run `plan-parse` on it
and append the annotation to the status line:

```
**Status**: 🟡 In progress — 12/20 tasks (60%)
```

The annotation is rewritten on every run so it cannot rot. Cross-check the
step's real progress with `/devenv-board` when its plan summary and the
issue state disagree.

**Status precedence summary** (apply manually at mapping time; the first match wins):
closed-merge → done; blocked → paused; open + PR/plan-activity → in-progress;
otherwise → not-started; all-closed-unmerged → cancelled.

## Workflow

### 1. Load and parse the roadmap

- Pull the artifact to a session scratch copy (see Inputs).
- Run `roadmap-parse <scratch-copy>` to get per-step JSON (issues, status,
  dependencies). For each `### STEP-NN: ...` heading, read the **Issues** field.
  Skip the step if it is empty or contains a placeholder — it'll be handled in
  step 4. Normalize any legacy bare `#N` refs and `Issue:` (singular) fields to
  canonical `org/repo#N` lines as you touch them.

### 2. Fetch issue and PR state

For each step that has a linked issue, run:

```bash
issue-get <issue-number> --pretty
```

`issue-get` returns the issue's open/closed state and labels — **not** merge state or linked PRs. Get merge state from `pr-get <PR_NUMBER>` (`mergeStateStatus`, `state`) after locating candidate PRs: scan issue comments for `Closes #N` / `Fixes #N` references and match with `pr-list --state all`.

Capture for each:
- `state`: open | closed
- `closedViaMerge`: true | false (only meaningful if closed)
- `labels`: list of label names
- `linkedPrs`: list of `{ number, state }` (open | closed | merged)

### 3. Compute new status per step

Apply the mapping table above. Build a diff:

```
STEP-01: ⬜ → 🟡  (PR #145 opened)
STEP-02: ⬜ → ✅  (closed via merge)
STEP-03: 🟡 → 🟡  (no change)
STEP-04: ⬜ → ⏸️  (blocked label added)
```

### 4. Detect steps without issues

For each step where the **Issue** field is empty or placeholder:

```
STEP-05: no linked issue
STEP-06: no linked issue
```

After computing both diffs (status changes + missing issues), surface them to the user:

> "Found 4 status changes and 2 steps without issues:
>
> Status changes:
> - STEP-01: ⬜ → 🟡 (PR #145 opened)
> - STEP-02: ⬜ → ✅ (closed via merge)
> - STEP-04: ⬜ → ⏸️ (blocked label added)
>
> Missing issues:
> - STEP-05, STEP-06
>
> "Apply status changes? Create issues for missing steps? Both? Neither?" — ask via the shared [direct query style](../_conventions.md#direct-query-style-questions-and-selections): present the four combinations as selectable options with freeform input.

### 5. Write status updates

On approval, update the **Status** line of each affected step in the scratch copy — no revision-history entry; the issue comment's edit history records when the sync happened.

Also update the parent epic body: re-run `issue-update <epic-number> --body-file <path>` with the regenerated task list, where `[ ]` becomes `[x]` for completed steps. Show the diff before applying. Then republish the roadmap artifact: `issue-artifact-upsert --issue <epic-number> --body-file <scratch-path>`. Before each republish, verify the working copy: all `### STEP-NN` headers present, step count unchanged from the published version, and anchor links resolve. When the roadmap uses a single tracking issue with an embedded checkbox ticker instead of an epic + child issues, the ticker body is the surface this step updates — artifact and ticker change in one pass.

### 6. (Optional) Create missing issues

For steps without issues, follow the **Issue Creation Procedure** from [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md): one issue per step in the appropriate component repo, with body referencing the roadmap step and blueprint sections. Then update the step's **Issue** field in the roadmap file.

After issue creation, also update the parent epic to include the new entries in its task list, and add a `STEP-NN` backlink to each created issue's body (greppable in both directions).

**Linking existing-but-unlinked issues.** A step's issues may already exist but be missing from the roadmap (created outside the flow). When step 4 flags them, search for candidates (`issue-search` by step component/title keywords), present matches in a summary table, and ask the user to confirm each link before writing it. Never link silently. After linking, add the `STEP-NN` backlink to the issue body via `issue-comment` or `issue-update` (with approval).

**Epic task list is a projection.** The parent epic's task list is regenerated from roadmap statuses on every sync — `[ ]`/`[x]` there is derived state, not hand-maintained content. Hand-edits to it are not durable by design; step-structure changes belong in `/devenv-refine-roadmap`, not in the epic body.

### 7. Summarise

Output a short summary:

```
✔ Updated 4 step statuses
✔ Created 2 new issues (STEP-05, STEP-06)
✔ Synced parent epic task list
✔ Republished roadmap artifact <doc_id> on <org>/<planning-repo>#<epic-number>
```

## Tooling

Uses existing tooling only:

- `issue-get N --pretty` — fetch issue state, labels, linked PRs
- `pr-list` / `pr-get` — fetch PR state when needed
- `issue-create --title <title> --body-file <path>` — create missing issues (resolve the target repo per the [repository targeting rules](../_shared/references/provider-protocols/github.md#repository-targeting); [exact invocation](../_shared/references/provider-protocols/github.md#issue-create))
- `issue-update <N> --body-file <path>` — update parent epic body
- `issue-artifact-select` / `issue-artifact-get` / `issue-artifact-upsert` — pull and republish the roadmap artifact

Do **not** invent new commands. If a needed capability isn't in tooling, surface it to the user as a tooling gap and stop.

## Anti-patterns

- Writing status changes without showing the diff first
- Creating issues without explicit user approval
- Updating the parent epic body or republishing the artifact silently — always show the diff
- Reformatting the roadmap (changing headings, reordering steps) — this skill only updates **Status** and **Issue** fields
- Appending revision-history entries — the issue comment's edit history records when; the artifact carries target state only
- Marking a step ✅ when the linked PR is open but the issue happens to be closed for an unrelated reason — always require closed via merge
- Skipping the `blocked` / `paused` label override

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
