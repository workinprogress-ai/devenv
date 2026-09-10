# Progress Reporting

How progress is tracked and reported in this workspace — the doctrine behind `/devenv-query-progress` and the `Progress:` snapshot lines executor skills append to wrap-up comments.

## The doctrine: progress is a derived view

Progress is **computed, never stored**. Ground truth lives in exactly five places:

1. Task checkboxes in plans (`[x]` / `[ ]`)
2. GitHub issue state (open/closed, labels)
3. Linked pull requests
4. Issue labels (`blocked`, `paused`, …)
5. Git history

There are no stored percentages, no `percent complete` headers in plans, and no parallel `Progress_report-*` artifacts. A stored percentage is a cache with no invalidation discipline; a parallel report artifact duplicates ground truth and becomes curated noise. Every progress number anywhere in the workspace is derived at query time — mechanically via `plan-parse --summary` / `--census`, never hand-counted.

## The roll-up model

**Canonical chain: issue → plans.** A parent issue's plan set is:

- its **direct plans** (plan artifacts on the issue, plus legacy `implementation-plan` artifacts), plus
- all **descendant issues' plans** (children found via `--parent` linkage / task-list references).

**Roadmap status is an alternative view, never summed.** Roadmap step status is itself derived from issues — combining it with the issue→plans roll-up double-counts the same work. They are reported side by side, never aggregated.

**Coverage.** For scope whose children haven't started (no plans yet), report **plan coverage** — plans existing / plans needed — instead of a percentage. "0% complete" is dishonest for unstarted work; "2 of 5 planned" is honest. The denominator resolves in order: grooming attack-plan rows → roadmap steps → open child issues. When no denominator source exists, task-based progress is reported alone — a denominator is never invented.

**Honesty rules:**

- Raw task counts come first; size-weighted percentage is a secondary lens (weights S=1, M=2, L=4; missing size counts as M — the `sized_tasks` ratio in `--summary` output shows weighting quality).
- Phase position always accompanies a percentage: "66% (phase 3 of 5)", never a bare number.
- Issue/plan state drift is surfaced as a risk callout with both readings — read-only consumers never reconcile it.

## The `Progress:` snapshot line

The only durable progress narrative. Executor skills append one stable, greppable line to the wrap-up status comments they already post on issues (inside the existing confirm-then-post flow — no new ceremony):

```text
Progress: <done>/<total> tasks (<pct>%), phase <n> of <N> — <YYYY-MM-DD>
```

- Values come from `plan-parse --census` at draft time — never hand-counted.
- The ISO date suffix makes snapshot ordering body-derivable — trend and scope-delta readings never depend on comment metadata.
- Example: `Progress: 12/18 tasks (67%), phase 3 of 5 — 2026-09-10`

**Reading a trend:** grep the `Progress:` prefix in the issue thread. With ≥2 snapshots, report deltas between consecutive ones.

**Reading a scope delta:** diff consecutive snapshots' totals. `12/18` → `14/22` reads as "scope grew from 18 to 22 tasks since the last snapshot; 2 of 4 new tasks already done." The snapshot line is a scope witness — expansions are derived from totals, not stored as events. When an ADR exists for a material expansion (see `/devenv-refine-plan` revision mode), it supplies the narrative for the growth.

## Attribution model

Assignees are derived from the issues themselves (`issue-get` returns `assignees[]`), collected per issue in the tree:

- Report sections are headed with the responsible engineer (or "unassigned").
- Risk callouts that need engineer attention name that engineer: "@{login}: issue #3 closed but its plan shows 4 open tasks — reconcile?"
- Unassigned issues with open work are themselves a callout — an ownership gap.

## `/devenv-query-progress` usage

Read-only progress reporting across plans, grooming issues, and roadmaps.

**Inputs:**

- issue number → issue-tree roll-up
- plan path → direct metrics
- epic number (optionally `:doc_id`) → dual view (plan roll-up + roadmap artifact status)
- freeform question → resolved to a candidate set, confirmed with the user

**What it reports:** headline % + phase position, coverage when relevant, risk callouts (open questions, blocked/paused labels, drift, stale narrative, ownership gaps), trends and scope deltas from `Progress:` snapshots, and git-derived enrichment (unmerged branch commits excluding `WIP:`-prefixed titles, phantom progress — checked boxes with no corresponding commits, landed-but-unticked — commits referencing the issue with the task still open).

**Zoom-ins:** drill a phase, a single plan, recent commits touching the plan's `Files:`, or "what remains" — all rendered in chat first.

**Report modes:** ephemeral markdown (`tmpN.md` in the repo root) or a posted issue comment with explicit confirmation. Multi-issue reports: one section per issue, headed with its assigned engineer.

**Read-only guarantee:** no plan edits, no issue writes, no roadmap syncs, no labels; git access is `log`/`show`/`branch -r` only, against the repo cache or read-only against working repos. When the repo cache is too shallow to answer branch-level questions, the skill says so and offers `repo-cache-deepen` for the user to run (or confirms before running it) — it never deepens implicitly.

## Branch-level git signals

The repo cache (`tools/cache/repo_cache/`, populated by `repo-cache-update`) clones every org repo shallow and single-branch by default. Branch-level signals need deepening:

```bash
repo-cache-deepen --repo <name> [--depth N] [--branch <b>]...
```

Fetch-only and never checks out — cache working copies stay on the default branch; branches land as remote refs (`refs/remotes/origin/<b>`). Idempotent and additive; `repo-cache-update` does not undo deepening.

**Plan↔branch convention:** `Plan-issue-<N>-*.md` ↔ branches matching `issue-<N>*` or `<N>-*` in cached repos (the same pattern `open-pr` uses to extract parent issues from branch names).

**Merge-style caveat:** the unmerged/landed heuristics assume merge commits preserve branch history. Under squash-merge workflows, PR-based detection (merged PRs referencing the issue) is the merge-style-safe alternative.

## Cross-references

- [Workflow Guide](./Workflow.md) — the delivery methodology this reporting layer observes.
- [Skills Catalog](./Skills.md) — the `/devenv-query-progress` entry and its boundaries vs `/devenv-update-roadmap`, `/devenv-refine-plan`, `/devenv-session-handoff`.
- [Additional Tooling](./Additional-Tooling.md) — `plan-parse`, `repo-cache-update`, `repo-cache-deepen` reference pages.
