---
name: devenv-board
description: 'On-demand board and issue-landscape management for the org''s project boards and full issue population — project members and unprojected tickets alike. Answers status/composition/progress questions, sweeps for drift and hygiene problems, recommends grooming/flow/state changes, and effects changes when explicitly asked. USE WHEN the user says "project status", "board status", "what''s in flight", "how is the epic going?", "show the roadmap for epic N", "clean up the board", "board hygiene", "what''s drifted?", "what''s stale?", "what should be groomed next?", "what should I look at?", "what changed while I was away?", "what''s unprojected?", "move #N to X", "add these issues to the project", "create issues from the roadmap steps", or asks any population-level question about issues and their states. DO NOT USE for updating plan files or running phases (use /devenv-refine-plan, /devenv-pair, /devenv-delegate), grooming a specific design topic (use /devenv-groom), triaging a single new issue at intake (use /devenv-triage), creating plans (use /devenv-plan), or syncing/revising roadmap artifacts (use /devenv-update-roadmap / /devenv-refine-roadmap).'
argument-hint: '<question | sweep | instruction (freeform)>'
user-invocable: true
---

# Board

The project-management counterpart to the executor skills: an on-demand planner assistant that owns the **full issue landscape** — issues carded in a project or not. It answers questions about state, sweeps for drift and hygiene problems, recommends next actions and flow changes, and effects changes when explicitly asked. Where the coding skills own *doing the work*, this skill owns *the truth of the board and the pipeline around it*.

Progress is a **derived view** — computed at query time from ground truth (task checkboxes, issue state, linked PRs, labels, git), never from stored percentages. Follows the shared [progress tracking conventions](../_conventions.md#progress-tracking-derived-view).

> **Write discipline (the four classes).** Every request is classified; the class sets write authority. Answer/Assess/Recommend never mutate. Act mutates only on an explicit single instruction or an explicitly-consented batch table. Ambiguous requests default to the read-only class and confirm before escalating.

> **Git access is `log` / `show` / `branch -r` only**, run against the repo cache (`tools/cache/repo_cache/`) or read-only against working repos under `repos/` — it never touches working state. If the cache is too shallow to answer, say so and offer the deepen command for the user to run (or confirm before running it yourself): `repo-cache-deepen --repo <name> [--branch <b>]`. Never deepen implicitly.

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`.

> **Skill feedback:** If nothing is wrong but the user asks how the skill could be improved, follow the shared [Skill Feedback Protocol](../common/references/skill-feedback-protocol.md) to write `IMPROVEMENT_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`. Zero findings is a valid result; never offer unprompted.

> Use the shared [Tool help policy](../_conventions.md#shared-boilerplate-snippets) and [`../_tools-reference.md`](../_tools-reference.md).

## When to Use

- Status and composition questions — board, epic, plan, issue, or the whole org constellation.
- Hygiene: membership gaps, status drift, staleness, label problems, orphan inventory.
- Recommendations: what to groom, what's blocked, what's next.
- Directed changes: single status/membership edits or consented batch corrections.
- Reports: compiled markdown on request (chat-first by default).

Do **not** use for: plan stewardship (executor/refine skills), single-issue intake triage (`/devenv-triage`), grooming execution (`/devenv-groom`), plan creation (`/devenv-plan`), roadmap status sync (`/devenv-update-roadmap`), or in-run status for the current pair/delegation session (those skills answer their own runs).

## Intake: classify the request

Map the ask to one of four classes; the class governs everything downstream:

| Class | Trigger examples | Authority |
|---|---|---|
| **Answer** | "what's in flight?", "how is #42 going?", "what's unprojected?", "what changed since yesterday?" | Read-only |
| **Assess** | "clean up the board", "what's drifted?", "what's stale?" | Read-only sweep → findings table |
| **Recommend** | "what should be groomed next?", "what's blocked and stuck?" | Advisory output, routed |
| **Act** | "move #42 to Ready", "add #17 #23 to the project", "apply the fixes" | Explicit instruction or consented batch only |

Ambiguity resolves to the read-only class; confirm before escalating to Act. A request may chain classes (Assess → user picks findings → Act on the approved subset) — each write still requires its own explicit approval.

## Resolution (before any call)

Issue and artifact calls inherit their repo from the environment (else cwd). Before the first call: identify which repo holds the issues in question and set the call's target repo explicitly per the [repository targeting rules](../_shared/references/provider-protocols/github.md#repository-targeting). Sources, in order: the active artifact's `DEVENV_ARTIFACT_V1` header (`issue_number`, `planning_repo`), the linked artifact's `doc_id` repo segment, the user's input, plan/branch references, or the `repos/` folder the work lives in. Tree walks that cross repos (epic in the planning repo, children in component repos) resolve each call's target individually. Follow the shared [repo-targeting guard](../_conventions.md#repo-targeting-guard-required-for-issueartifact-calls), including its planning-repo resolution chain — there are many planning repos (one per project); never assume a fixed one. If a wrapper refuses because the cwd is the devenv repo, that is a routing signal — never add `--devenv` to push through it.

For board scoping: resolve the project(s) from the org's configuration (`GH_ORG` — the as-built org identifier, the project the board work targets — confirm with the user when ambiguous which project is "the board"). Multi-repo questions iterate the repo constellation explicitly and say which repos they covered.

## Answer (read-only)

**Board status.** Counts by state, WIP by column, delivery-half vs. workflow-half split — all derived from the `status_workflow` config vocabulary (read with `config-read workflows status_workflow`; never hard-code state names). For **unprojected tickets** (no project card), state semantics come from the issue itself: open/closed, labels, linked PRs — report them as a distinct population, never mixed silently into carded counts.

**Skill-artifact signals.** The board reads more than issues: skill outputs are status evidence. Recognize and report — research docs (`research-NNN-*.md` under `.local-artifacts/`), review reports, pairing state files, and grooming documents — as signals of in-flight or recently-finished work per repo, each labeled with its provenance ("research findings exist, no plan yet" = work stalled between investigation and planning). Artifact presence without a matching board card is itself a drift signal worth surfacing.

**Epic/parent rollups.** Child progress → parent derivation uses the **same workflow-core minimum-state rollup** the engine uses (`tools/lib/workflow-core.bash`) — never reimplement the semantics. Plan-set assembly per issue: direct plan artifacts (`issue-artifact-list --artifact-type plan`, plus legacy `implementation-plan`), descendant issues' plans via issue-tree linkage, and local `Plan-*.md` working copies when discoverable (`.local-artifacts/` first; note which are local-only). Always run the **linkage audit**: name how children were detected; surface open issues referencing the scope but lacking parent links — missing linkage under-reports progress and must never fail silently.

**Roadmap view.** Resolve the roadmap artifact on an epic (`issue-artifact-select --artifact-type roadmap`) and render its phases and step statuses (✅ 🟡 ⬜ ⏸️) with step→issue links — the delivery view alongside the issue-tree roll-up, reported side by side, never summed. Detect **step-vs-issue drift** (step ⬜ but its issue closed; step 🟡 with no open PR) and surface both readings; reconciliation routes to `/devenv-update-roadmap`. Steps lacking issues are the input to backlog materialization (see Act).

**Per-plan metrics.** `plan-parse <plan> --summary` per plan: raw counts, weighted counts, current phase, open questions, unchecked ACs. Never hand-count. Headline is raw counts; size-weighted percentage is a secondary lens (meaningful only when `sized_tasks` is healthy). Phase position always accompanies a percentage ("66% — phase 3 of 5"). For unstarted scope, report **plan coverage** (plans existing / plans needed; denominator from grooming attack-plan rows → roadmap steps → open child issues) — never "0%", and never invent a denominator. Issue→plans roll-up and roadmap step status are separate views, never summed.

**Drill-downs.** "Why is #42 still To-Groom?" — issue + labels + project fields + linked PRs + plan state when an artifact identity exists. When plan and issue states disagree, surface **both readings** as a callout; reconciliation belongs to executor/closeout skills, never here (except via an explicit Act instruction).

**Return digest / standup.** "What changed since yesterday / while I was away?" — issues opened/closed, status transitions, PRs merged, new findings; composed from `issue-list` + timelines across the scoped repos; read-only.

**Personal work queue.** "What should I look at?" — fuses the user's review-requested PRs, their open PRs, Ready items, and items mentioning them; read-only; presented as one compact queue with reasons.

**Cross-repo portfolio view.** "What's in flight across the org?" — iterate the repo constellation, aggregate in-flight work into one rollup, and state which repos were covered.

**Trend from `Progress:` snapshots.** Grep prior `Progress:` lines from issue comments (`issue-comment-list --full`; stable prefix `Progress: <done>/<total> tasks`). With ≥2 snapshots report deltas, including scope-delta reading (`12/18` → `14/22` = "scope grew 18→22; 2 of 4 new tasks done"; cite the ADR if one exists).

**Git-derived signals (enrichment, cache-based).** Unmerged branch commits (`git log origin/<branch> --not origin/<default-branch> --oneline`), plan↔branch convention (`Plan-issue-<N>-*.md` ↔ `issue-<N>*` branches), phantom progress (ticked task, no corresponding commit — "possibly stale", never fact), landed-but-unticked (default-branch commits referencing the issue with the task open). **WIP-prefixed commits are excluded from all commit enumeration.** If the org squash-merges, switch to PR-based detection (`pr-list` / `pr-get`), which is merge-style-safe.

## Assess (hygiene sweep — findings only)

Sweep the scoped board and issue landscape; emit a reviewable table (issue, finding, evidence, proposed correction). Every finding carries **evidence** — issue state, project field value, last update, PR state — because the failure mode this class guards against is batch-overwriting a deliberately-set status.

1. **Membership gaps** — issues matching the project's criteria (org, type, labels, parent linkage) not in the project.
2. **Foreign cards** — cards not matching the project's criteria; closed issues sitting in active columns.
3. **Status drift** — project `Status` field contradicting issue reality: PR merged but card lagging; issue closed but card active; card holding a status no longer in `status_workflow`; children all delivered while the parent lags.
4. **Staleness by state** — thresholds from config (below), measured from last activity.
5. **Orphan hygiene** — unprojected issues meeting project criteria (add candidates), untriaged `TBD` orphans, orphans with stale labels.
6. **Label hygiene** — labels outside the configured vocabulary (the provider's issue-type/label configuration plus org labels), inconsistent type labels, missing labels the org's conventions require.
7. **Active-run flag** — drift findings on issues owned by an in-flight pair/delegation run are **flagged, never auto-corrected**: the run's signals will update them. Surface the apparent drift instead of fixing it.

**Risk callouts (shared with Answer):** open `[QUESTION]` items, `blocked`/`paused` labels, ⏸️ roadmap steps, open upstream-impact issues, drift (both readings), stale narrative (no recent `Progress:` snapshots), ownership gaps (open work, no assignee). Callouts needing attention refer to the assigned engineer by login; unassigned open work is itself a callout.

## Recommend (advisory — proposals, never execution)

- **Grooming candidates**: `To-Groom`/`TBD` past threshold, parentless `Ready` items, design-stale items — each with a one-line why; route → `/devenv-groom`.
- **Flow advice**: WIP imbalances, delivery-boundary congestion, items that should change state per the workflow's shape.
- **Priority hints**: rollup-informed ("epic X is one child from done").
- **Triage candidates**: unprojected/unlabeled new issues; route → `/devenv-triage`.
- Every recommendation names its route; this skill never executes its own recommendations. Dependency-ordered planning and blocked/unblocked queries depend on blocked-by/blocks links — when absent, surface the absence as an Assess finding ("Ready items with no dependencies recorded") rather than pretending to order them.

## Act (explicit writes)

Two legal forms, nothing else:

1. **Single change on explicit instruction** — "move #42 to Ready", "add #17 and #23 to the project". Confirm ambiguous targets; never guess an issue.
2. **Consented batch** — from a reviewable table: an Assess findings table, or a roadmap view's steps-lacking-issues list. Present the table, get explicit approval of the exact rows, apply only those rows.

Mechanics and limits:

- Writes go through `project-update-issue` / `project-add-issue` / the status machinery — the workflow engine's own validation governs (workflow states cannot be forced; the engine rejects illegal transitions and the skill reports the rejection, never bypasses it).
- **Backlog materialization from ratified scope only.** From a roadmap view, steps lacking issues may be materialized as backlog issues: proposal table (step → repo, title, type, parent-epic linkage) → explicit approval → `issue-create` per workspace conventions (native types, templates, no-template for determinism) → report created issue numbers → optional `project-add-issue` as a second consented step. Birth statuses follow the workflow engine's rules (TBD by default; Ready under a parent) — never forced. This authority extends **only** to ratified roadmap scope — the same authority `/devenv-create-roadmap` and `/devenv-update-roadmap` already hold for their flows; it never covers this skill's own Assess findings or Recommendations (those route to their owning skills).
- Every applied change is echoed in output (issue, from → to) — the transcript is the audit log.
- **Never touches**: plan file content, issue bodies (except via the artifact-sync skills), labels outside the configured vocabulary, or any state the workflow engine forbids — and never republishes roadmap artifacts or epic task lists (`/devenv-update-roadmap` owns those writes; one writer per artifact).
- Issues owned by an in-flight run are off-limits to batch correction (Assess flags them; Act declines them with the reason unless the user explicitly insists).

## Configuration

Staleness thresholds live in `devenv.config [workflows]` — read with `config-read`, never hard-coded:

```ini
stale_to_groom_days=14      # To-Groom items older than this are stale
stale_ready_days=21         # Ready items with no activity
stale_implementing_days=30  # In-flight items with no activity
stale_tbd_days=7            # TBD items never triaged
```

State vocabulary: `status_workflow` (single source — this skill derives column semantics from it and never hard-codes state names).

## Interaction model

- **First answer compact** (chat): headline + one-line context + callouts + offered zoom-ins. Never dump a full report unprompted.
- **Zoom-ins conversational**: drill a phase (task list rendered in chat first), a single plan, recent commits, "what remains".
- **Findings tables reviewable**: Assess output is a table the user can mark up ("apply rows 2 and 5") — that markup is the consent for exactly those rows.
- Follows the shared [direct query style](../_conventions.md#direct-query-style-questions-and-selections) for structured asks.
- **Reports on request**: explicit trigger only (`report` keyword, plural issue numbers, or `--report`). Compile one markdown report — front matter with timestamp and resolved scope; per-issue fixed shape (assignee → status line → progress block (`--summary` + `--census`) → what's left → callouts/drift with both readings → open questions); epic scope expands to a roll-up section plus per-child sections. Output to `.local-artifacts/tmpN.md` (ephemeral family); posting to an issue requires explicit confirmation (no natural host for multi-issue reports — posting defaults off). Reports add no write surface.

## Anti-patterns

- Mutating anything outside an explicit Act instruction or consented batch — including "helpful" auto-corrections found during Assess.
- Auto-correcting drift on issues owned by an in-flight run.
- Forcing a workflow transition the engine rejects, or routing around its validation.
- Editing plans, ticking checkboxes, syncing roadmaps, or posting comments without explicit confirmation.
- Reporting "0%" for unstarted children instead of coverage; a bare percentage without phase position; summing plan progress with roadmap step status; inventing a coverage denominator.
- Hand-counting tasks instead of running `plan-parse`; storing a percentage or writing `Progress_report-*` artifacts.
- Mixing unprojected tickets into carded counts silently, or treating orphans as errors by definition.
- Deepening the repo cache without saying so; counting WIP commits as progress signal.
- Running `issue-*` calls with unset `DEVENV_REPO` from the workspace root — or "fixing" the devenv-repo refusal with `--devenv`.
- Hard-coding state names or staleness days instead of reading config.
- Executing this skill's own recommendations instead of routing them — including creating issues from its own findings; only **ratified roadmap scope** may be materialized (see Act).

## Future capabilities (deliberately not yet)

Recorded so enhancement requests have an obvious home — adopt only with real usage evidence: iteration-batch proposal (needs dependency-link discipline), cycle-time/bottleneck metrics (needs honest timeline aggregation), snapshot diffing (standup digest covers it statelessly), milestone readiness (adopt iff milestone discipline emerges), consent-gated nudges (needs an owner field). Rejected: scheduled sweeps (on-demand by decision), assignment suggestions, filing issues from recommendations (starts triage/grooming's job without their gates — materializing **ratified roadmap steps** is the deliberate exception, owned by Act).

## Sibling skills

- `/devenv-triage` — single-issue intake routing; this skill recommends, that skill triages.
- `/devenv-groom` — grooming execution; this skill nominates candidates.
- `/devenv-plan` — plan creation; this skill routes plan-sized work there.
- `/devenv-update-roadmap` — writes roadmap status (this skill only reads roadmap artifacts).
- `/devenv-refine-plan` — edits plans after drift is surfaced here.
- `/devenv-pair` / `/devenv-delegate` — execute; answer their own in-run status; append the `Progress:` snapshots this skill trends.

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
