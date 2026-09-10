---
name: devenv-query-progress
description: 'Read-only progress reporting across plans, grooming issues, and roadmaps. USE WHEN the user says "how is X going?", "what''s the progress on issue N / this plan?", "what''s left on the audit work?", "are we on track?", "what''s blocking the epic?", or asks for any cross-plan / cross-issue status roll-up. Derives progress from task checkboxes + issue state via `plan-parse --summary`; rolls up the issue tree; reports risk callouts and trends; drills down conversationally; writes ephemeral or posted-on-request reports. DO NOT USE for updating anything (progress is read-only; tick tasks in the executor skills or /devenv-refine-plan), for syncing roadmap status (→ /devenv-update-roadmap), for plan revision (→ /devenv-refine-plan), or for session summaries (→ /devenv-session-handoff).'
argument-hint: '<issue-number | plan-path | epic-number[:doc_id] | freeform question>'
user-invocable: true
---

# Query Progress

Read-only answers to "how is the work going?" — derived at query time from ground truth (task checkboxes, issue state, linked PRs, labels, git), never from stored percentages or parallel report artifacts. Follows the shared [progress tracking conventions](../_conventions.md#progress-tracking-derived-view).

> **Strictly read-only.** No plan edits, no issue writes, no roadmap syncs, no labels, no comments — the only exception is an explicitly-confirmed report posting (see Reports below). No mutating git. Fixing anything that looks wrong belongs to the executor skills or `/devenv-refine-plan`; this skill only reports.

> **Git access is `log` / `show` / `branch -r` only**, run against the repo cache (`tools/cache/repo_cache/`) or read-only against working repos under `repos/` — it never touches working state. If the cache is too shallow to answer (shallow single-branch clones cannot see branch history), say so and offer the deepen command for the user to run (or confirm before running it yourself): `repo-cache-deepen --repo <name> [--branch <b>]`. Never deepen implicitly.

> **Never reconcile drift.** When plan and issue states disagree (issue closed but plan open, or the inverse), surface it as a risk callout with both readings. Reconciliation belongs to executor/closeout skills.

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` at the active project root for `/devenv-skill-maintenance`.

> Use the shared [Tool help policy](../_conventions.md#shared-boilerplate-snippets) and [`../_tools-reference.md`](../_tools-reference.md).

## When to Use

Trigger phrases:

- "how is X going?" / "what's the progress on issue N / this plan?"
- "what's left on the audit work?"
- "are we on track?"
- "what's blocking the epic?"
- Any cross-plan / cross-issue status roll-up request

Do **not** use for:

- Updating anything — ticking tasks, syncing roadmaps, editing plans (executor skills, `/devenv-refine-plan`)
- Syncing roadmap status → [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md)
- Revising a plan after hearing the status → [`/devenv-refine-plan`](../devenv-refine-plan/SKILL.md)
- Session summaries / handoffs → [`/devenv-session-handoff`](../devenv-session-handoff/SKILL.md)
- In-run status for the current delegation or pairing session (those skills answer their own runs)

## Core Principles

1. **Progress is a derived view.** Compute, never store. Every number in every answer comes from `plan-parse --summary` / `--census` or issue state at query time.
2. **Raw counts first, weighted second.** Raw task counts are the headline; size-weighted percentage is a secondary lens (and only meaningful when `sized_tasks` is healthy).
3. **Phase position always accompanies a percentage.** "66% (phase 3 of 5)" — never a bare number.
4. **Coverage before percentage for unstarted scope.** When children have no plans yet, report plan coverage (plans existing / plans needed) — never "0%".
5. **Never combine the two aggregates.** Issue→plans roll-up and roadmap step status are separate views; summing them double-counts.
6. **Drift is surfaced, never fixed.** Both readings shown; the callout names who should reconcile.
7. **Scope deltas are derived from totals.** `12/18` → `14/22` reads as "scope grew from 18 to 22; 2 of 4 new tasks done" — expansions are witnesses in snapshot totals, not stored events.

## Resolution Flow

### 0. Resolve the target repo (before any issue call)

Issue and artifact calls inherit their repo from the environment (`GITHUB_REPO`, else cwd). Before the first call: identify which repo holds the issue(s) in question, and prefix every call with `GITHUB_REPO=<owner>/<repo>`. Sources, in order: the active plan/grooming artifact's `DEVENV_ARTIFACT_V1` header (`issue_number` for the artifact's own repo; `planning_repo` for the governing planning repo), the linked upstream artifact's `doc_id` repo segment, then the user's input, plan/branch references, or the `repos/` folder the work lives in. Tree walks that cross repos (epic in the planning repo, children in component repos) resolve each call's target individually. Follow the shared [repo-targeting guard](../_conventions.md#repo-targeting-guard-required-for-issueartifact-calls), including its planning-repo resolution chain — there are many planning repos (one per project); never assume a fixed one. If a wrapper refuses because the cwd is the devenv repo, that is a routing signal — never add `--devenv` to push through it.

### 1. Classify the input

- **Issue number** → tree walk (below).
- **Plan path** → direct: `plan-parse --summary` on it, plus the linked issue (if any) for state/enrichment.
- **Epic number (+ optional `:doc_id`)** → dual view: issue→plans roll-up **and** roadmap artifact status (via `issue-artifact-select` / `issue-artifact-get` on the epic), reported side by side, never summed.
- **Freeform question** → resolve to a candidate issue/plan set (`issue-search`, `issue-list`), then confirm with the user via the shared [direct query style](../_conventions.md#direct-query-style-questions-and-selections): one question, options listed.

### 2. Assemble the plan set (roll-up)

- **Direct plans** on the issue: `issue-artifact-list --issue N --artifact-type plan`, plus legacy `implementation-plan` artifacts.
- **Descendant issues' plans**: find children via issue-tree linkage (`--parent` metadata / task-list references), collect their plan artifacts the same way.
- **Local plans**: `Plan-*.md` / `Implementation_plan-*.md` files in linked repos count when discoverable; note which are local-only (no issue narrative / snapshot history available).
- **Linkage audit (always):** the roll-up output names how children were detected, and surfaces open issues that reference the scope but lack parent links — "2 unlinked issues reference this scope — include?" Missing linkage under-reports progress and must never fail silently.
- **Attribution derivation:** assignees come from the issues themselves (`issue-get` returns `assignees[]`) — collect per issue in the tree; issues with no assignee record as unassigned (and become ownership-gap callouts when they carry open work).

### 3. Per-plan metrics

`plan-parse <plan> --summary` per plan: raw counts, weighted counts, current phase, open questions, unchecked ACs. Never hand-count.

### 4. Aggregate

- Totals across the plan set (raw first, then weighted).
- **Coverage** = plans existing / plans needed; denominator resolved in order: grooming attack-plan rows → roadmap steps → open child issues. When no denominator source exists, report task-based progress only and **omit coverage** — never invent a denominator.

### 5. Enrich with risk callouts

- Open `[QUESTION]` items (from `--summary` `open_questions`).
- `blocked` / `paused` labels on issues in the tree.
- ⏸️ roadmap steps (epic input).
- Open upstream-impact issues naming the scope.
- **Drift**: issue-closed-but-plan-open, and the inverse.
- **Stale narrative**: no recent `Progress:` snapshots in the issue thread.
- **Callouts are personalized by name**: when a callout needs engineer attention (drift to reconcile, blocker to clear, stale plan to tick), it refers to the issue's assigned engineer by login ("@<login>: issue #3 closed but its plan shows 4 open tasks — reconcile?"). Unassigned issues with open work are themselves a callout: an ownership gap.

### 6. Trend from `Progress:` snapshots

- Grep prior `Progress:` lines from issue comments (`issue-comment-list --full`; stable prefix `Progress: <done>/<total> tasks`).
- Report deltas when ≥2 snapshots exist; otherwise say "no snapshots".
- **Scope-delta reading (required when ≥2 snapshots):** diff consecutive snapshots' totals — `12/18` → `14/22` reads as "scope grew from 18 to 22 tasks since the last snapshot; 2 of 4 new tasks already done." If an ADR exists for the expansion, cite it as the narrative.

### 7. Git-derived signals (enrichment, cache-based)

Apply when relevant to the question; all git access read-only:

- **Unmerged branch commits:** `git log origin/<branch> --not origin/master --oneline -i --grep '^wip:' --invert-grep` → work claimed but not landed. **WIP commits (title prefixed `WIP:`/`wip:`) are excluded from all commit enumeration** — unmerged counts, phantom-progress checks, landed-but-unticked, and drill-downs.
- **Plan↔branch convention:** `Plan-issue-<N>-*.md` ↔ branches matching `issue-<N>*` or `<N>-*` in cached repos.
- **Phantom progress:** checkbox `[x]` with no corresponding commit touching the task's `Files:` — surface as "possibly stale", never as fact.
- **Landed-but-unticked:** commits referencing the plan/issue (`refs #N`, `Closes #N`) on the default branch with the task still open.
- **Merge-style limitation:** the unmerged/landed heuristics assume merge commits preserve branch history. If the org's repos squash-merge, switch to PR-based detection (`pr-list` / `pr-get` — merged PRs referencing the issue/plan), which is merge-style-safe.

## Interaction Model

- **First answer compact (chat):** headline % + phase position, coverage when relevant, one-line recent progress, risk callouts, offered zoom-ins. Never dump the full report unprompted.
- **Zoom-ins are conversational:** drill a phase (task list rendered in chat first — referenced-material rule), a single plan, recent commits touching the plan's `Files:` (`git log --oneline -10 <file>`), or "what remains".
- **Reports on request:** markdown to `tmpN.md` (ephemeral, repo root, next free number — see [ephemeral markdown conventions](../_conventions.md#ephemeral-markdown-files-tmpnmd)), or posted as an issue comment with explicit confirmation. Multi-issue reports: one section per issue, same metrics block, each section headed with its assigned engineer (or "unassigned").
- Follows the shared [direct query style](../_conventions.md#direct-query-style-questions-and-selections) (referenced-material rule included) for structured asks.

## Anti-patterns

- Storing a percentage, writing a `Progress_report-*` artifact, or adding progress headers to plans — progress is derived, not recorded.
- Editing plans, ticking checkboxes, syncing roadmaps, adding labels, or posting comments without explicit confirmation.
- Reconciling drift silently instead of surfacing both readings.
- Reporting "0%" for unstarted children instead of coverage.
- A bare percentage without phase position.
- Summing plan progress with roadmap step status.
- Hand-counting tasks instead of running `plan-parse`.
- Deepening the repo cache without saying so / without confirmation when the cache is too shallow.
- Counting WIP commits as progress signal.
- Running `issue-*` calls with an unset `GITHUB_REPO` from the workspace root or devenv repo — or "fixing" the wrapper's devenv-repo refusal with `--devenv` — querying the wrong repo and reporting its (empty) results as the answer.
- Inventing a coverage denominator when no source exists.

## Sibling skills

- `/devenv-update-roadmap` — writes roadmap status (this skill only reads roadmap artifacts).
- `/devenv-refine-plan` — edits plans after drift is surfaced here.
- `/devenv-session-handoff` — narrative handoff for the next contributor (this skill answers live progress).
- `/devenv-pair-programming` / `/devenv-delegation` — answer in-run status for their own sessions; both append the `Progress:` snapshot lines this skill trends.
- `/devenv-code-review` — reviews diffs; this skill reports progress state.

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
