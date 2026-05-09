# Implementation Plan — Copilot Skills Expansion

Build out a coherent set of Copilot skills that complement the three already created (`create-implementation-plan`, `pair-programming`, `delegation`), close the workflow loop from issue triage through PR review, add a meta "guru" to help users pick the right skill, document the whole catalog, and add the small set of `pr-*` / `issue-*` tooling enhancements needed to keep skills off direct `gh` calls.

## Revision history

### 2026-05-08 — Scope addition: `address-pr-comments` skill + supporting tooling

- Added 5.4 `address-pr-comments` — interactive per-comment workflow that walks through every unresolved PR review comment one at a time. For each: surface to user, ask whether AI or user addresses it, review the resulting change together, then offer to reply (with AI-suggested draft) or resolve the thread.
- Added 2.8 `pr-review-threads` — fetch unresolved review threads + inline comments with positions (current `pr-get` doesn't expose these).
- Added 2.9 Extend `pr-comment` with `--reply-to COMMENT_ID` and `--resolve-thread THREAD_ID` flags (or split into `pr-reply` + `pr-resolve-thread` if cleaner).
- Differentiates from the GitHub PR extension's existing `address-pr-comments` skill (which is batch-style: read all → fix all → resolve all). Ours is one-at-a-time with per-comment author choice and reply drafting.

### 2026-05-08 — Scope addition: `plan-update` skill

- Added 3.4 `plan-update` — lightweight sibling to `refine-implementation-plan` for small surgical edits (mark `[x]`, answer questions, add notes, single-task additions). Decision driven by gap between read-only `/plan-status` and full-interview `/refine-implementation-plan`. Hard limit of ~3 changes per invocation; anything larger redirects to `/refine-implementation-plan`.

### 2026-05-08 — Initial plan created

## Task list

### Phase 1 — Discovery & tooling baseline

- [x] 1.1 Audit existing skills as references
  Re-read the three existing skills to extract reusable patterns (frontmatter shape, reference-file split, confirmation flow, hotspot format, no-assumptions rule). Capture a short "skill conventions" note for use across all later phases.
  - See [Additional context](#task-1-1)

- [x] 1.2 Inventory existing `issue-*` and `pr-*` tooling
  Run `--help` on every `issue-*` and `pr-*` command in `tools/`. Map which capabilities exist, which are missing, and which should be enhanced rather than added.
  - depends on 1.1
  - See [Additional context](#task-1-2)

- [x] 1.3 Confirm `gh`-free policy and decide tooling gaps
  Lock in the strict policy: no skill may call `gh` directly. Cross-reference 1.2 against the skill list in phases 3–7 and produce a final list of tools to add/enhance in Phase 2.
  - depends on 1.2
  - See [Additional context](#task-1-3)

- [x] 1.4 Author skill conventions reference
  Write `.github/skills/_conventions.md` capturing the patterns from 1.1 (file layout, frontmatter keys, description-as-discovery-surface, confirmation flow, hotspot bullet format, anti-patterns). All later skill tasks reference this.
  - depends on 1.1
  - See [Additional context](#task-1-4)

### Phase 2 — Tooling enhancements

Each of these is independent of the others and may be done in parallel.

- [x] 2.1 Add `pr-get` — fetch PR as JSON
  Analog to `issue-get`. Returns: `number`, `title`, `body`, `state`, `headRefName`, `baseRefName`, `author`, `labels`, `assignees`, `reviewers`, `milestone`, `mergeable`, `url`, `createdAt`, `updatedAt`, `comments`, `reviewComments`.
  - See [Additional context](#task-2-1)

- [x] 2.2 Add `pr-comment` — comment on a PR
  Analog to `issue-comment`. Supports `--body`, `--body-file`, `--edit`, `--dry-run`. Optional `--review-comment` flag for an inline review comment with `--path` / `--line`.
  - See [Additional context](#task-2-2)

- [x] 2.3 Add `pr-diff` — fetch PR or branch diff as text
  Outputs unified diff for a given PR number, or the diff between two refs. Used by `code-review` and `pre-commit` skills.
  - See [Additional context](#task-2-3)

- [x] 2.4 Add `pr-list` — list PRs with filters
  Analog to `issue-list`. Supports filters by state, author, label, base/head branch.
  - See [Additional context](#task-2-4)

- [x] 2.5 Verify or add label support on `issue-update`
  Confirm whether `issue-update` already adds/removes labels; if not, extend it (`--add-label`, `--remove-label`, repeatable). Avoid creating a separate `issue-label` if the existing wrapper can absorb it.
  - See [Additional context](#task-2-5)
  - **Verified**: `issue-update` already supports `--add-label LABEL` and `--remove-label LABEL` (repeatable). No changes needed.

- [x] 2.6 Update tooling docs
  Add the new tools to `docs/Additional-Tooling.md` and `docs/README.md` "Key Scripts" lists. Same style as the existing `issue-*` entries.
  - depends on 2.1, 2.2, 2.3, 2.4, 2.5

- [x] 2.7 Fix buggy `pr-create-for-review`, `pr-get-review-link`, `pr-cleanup-review-branches`
  These wrappers currently fail before printing `--help`: `pr-create-for-review` references an unbound `CURRENT_BRANCH`, and the latter two `cd "$REPO_DIR"` before parsing `--help`. Add an early `case "${1:-}" in -h|--help) show_usage; exit 0;; esac` block in each script (after sourcing libs but before any side-effecting setup), and add bats coverage so each accepts `--help` cleanly.
  - blocks: skills that wrap PR review (e.g. 5.3 `open-pr`)

- [x] 2.8 Add `pr-review-threads` — fetch unresolved review threads with inline comments
  Current `pr-get` returns top-level PR data but not the inline review threads. New script `tools/scripts/pr-review-threads.sh` (+ symlink) fetches review threads via `gh api graphql` (the REST `pulls/comments` endpoint loses thread structure). Output: JSON array of threads, each with `id`, `isResolved`, `path`, `line`, `comments[]` (each with `id`, `author`, `body`, `createdAt`, `replyToId`). Supports `--unresolved-only` filter (default true), `--pretty`, `--devenv` flags consistent with siblings. **Blocks 5.4.**
  - blocks: 5.4 `address-pr-comments`

- [x] 2.9 Extend `pr-comment` with reply + resolve support
  Add `--reply-to COMMENT_ID` to post an inline reply on the same thread as a given review comment, and `--resolve-thread THREAD_ID` to mark a thread resolved (GraphQL `resolveReviewThread` mutation). If the existing script can't absorb these without breaking semantics, split into `tools/pr-reply` + `tools/pr-resolve-thread` (mirror `issue-comment` / `issue-update` style). Either way, all writes respect `--dry-run`. **Blocks 5.4.**
  - blocks: 5.4 `address-pr-comments`

### Phase 3 — Plan-lifecycle skills

- [x] 3.1 Create `refine-implementation-plan` skill
  Pick up an existing `Implementation_plan-*.md` (or issue body) and revise it after discovery work changed the picture. Re-numbers safely (insert sub-tasks, never reflow), preserves checkbox state, surfaces what changed in a diff summary.
  - depends on 1.4
  - See [Additional context](#task-3-1)

- [x] 3.2 Create `plan-status` skill
  Read a plan (file or issue body), report progress: % complete, which tasks/phases are done, which are blocked (dependencies unmet), open questions, time since last update. Read-only.
  - depends on 1.4
  - See [Additional context](#task-3-2)

- [x] 3.3 Create `plan-from-spec` skill
  Turn a single design doc / RFC / spec into a plan **without** an interview. Narrower than `create-implementation-plan` — used when the spec already contains acceptance criteria.
  - depends on 1.4
  - See [Additional context](#task-3-3)

- [x] 3.4 Create `plan-update` skill
  Lightweight sibling to `refine-implementation-plan` for small, surgical edits to an existing plan: mark tasks `[x]`, answer/resolve open questions, append a short note to a task, or add a single new task to a phase. Out of scope: rewording existing tasks, restructuring phases, large additions (those still go to `refine-implementation-plan`). Same auto-detect file-vs-issue input convention. Records all changes in `## Revision history`. One-line confirm before writing each operation. Hard limit: if more than ~3 changes are requested in one invocation, redirect to `/refine-implementation-plan`. Closes the gap between read-only `/plan-status` and full-interview `/refine-implementation-plan`.
  - depends on 1.4, 3.1
  - See [Additional context](#task-3-4)

### Phase 4 — Working-mode skills

- [x] 4.1 Create `code-review` skill
  Inverse of `delegation`: human implemented, AI reviews. Reads a PR (`pr-get`, `pr-diff`) or local diff (`get_changed_files`), produces structured feedback using the **same hotspot format** as `delegation`. Optionally posts as PR comments via `pr-comment`.
  - depends on 1.4, 2.1, 2.2, 2.3
  - See [Additional context](#task-4-1)

- [x] 4.2 Create `spike` skill
  Time-boxed exploratory work. AI investigates a question, builds a throwaway prototype, produces a "findings + recommendation" doc. No plan required, no production code expected. Output **explicitly marked throwaway**.
  - depends on 1.4
  - See [Additional context](#task-4-2)

- [x] 4.3 Create `rubber-duck` skill
  Pure conversation. AI asks questions to help the user think through a design or bug; **never implements**. Useful as a precursor to `/create-implementation-plan`.
  - depends on 1.4
  - Should be light hearted and lots of duck jokes and references and jokes.
  - See [Additional context](#task-4-3)

### Phase 5 — Workflow skills

- [x] 5.1 Create `triage-issue` skill
  Pull an issue with `issue-get`, classify it (bug/feature/question/duplicate), suggest labels, propose acceptance criteria if missing, and offer to update via `issue-update`. Gateway to `/create-implementation-plan`.
  - depends on 1.4, 2.5
  - See [Additional context](#task-5-1)

- [x] 5.2 Create `session-handoff` skill
  At end of any working session, generates a "next session starts here" comment (and/or appends to the plan). Captures: state, blockers, next concrete action, open questions. Reuses `delegation`'s summary format.
  - depends on 1.4
  - See [Additional context](#task-5-2)

- [x] 5.3 Create `open-pr` skill
  Once a phase is committable, package the work into a PR via the existing `pr-create-for-merge`. Drafts title + body from the plan and commits, links the issue. Confirmation required before invoking the wrapper.
  - depends on 1.4
  - uses convention commit protocol for pr title
  - determines what kind of change this is:  fix, feature, chore, etc. based on the tasks completed in the phase, and uses that to pick the right commit message prefix (e.g. "feat: add JSON output option").  This consideration is important and should be surfaced in the confirmation step.
  - See [Additional context](#task-5-3)

- [x] 5.4 Create `address-pr-comments` skill
  Interactive per-comment workflow that iterates through **every** unresolved review comment on a PR, one at a time. For each comment: (1) surface the comment + the file/line context, (2) ask the user whether AI or user will address it, (3) review the resulting change together, (4) offer to reply to the comment (with AI-drafted reply the user can edit) OR resolve the thread without replying OR skip. Then move to the next. Differentiates from the GitHub PR extension's existing batch-style `address-pr-comments` by being one-at-a-time and giving the user authorship choice per comment.
  - depends on 1.4, 2.1, 2.8, 2.9
  - See [Additional context](#task-5-4)

### Phase 6 — Quality / safety-net skills

- [ ] 6.1 Create `coverage-check` skill
  Run the project's test+coverage commands, compare to a baseline, report regressions per file. Mechanical enforcement of the "coverage doesn't regress" rule from the existing `phase-rules.md`.
  - depends on 1.4
  - See [Additional context](#task-6-1)

- [x] 6.2 Create `pre-commit` skill
  At the end of a phase, run the project's lint/format/test commands and surface failures with suggested fixes. **Stops short** of running `git commit` (skill suite stays silent on git workflow).
  - depends on 1.4
  - See [Additional context](#task-6-2)

### Phase 7 — Meta skill

- [x] 7.1 Create `skill-guru` skill
  Helps the user pick the right skill. Asks 1–3 clarifying questions about the work (plan exists? high-impact? PR or local? exploratory?), then recommends the best skill (or sequence of skills) with a one-line rationale.
  - depends on 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2
  - See [Additional context](#task-7-1)

### Phase 8 — Documentation

- [x] 8.1 Author `docs/Skills.md`
  Catalog of all skills (the original 3 + the 12 new). Each entry: name, slash command, one-line purpose, when to use, when NOT to use, tool dependencies. Includes a decision tree, workflow examples, anti-patterns, and a "how to author a new skill" pointer to the `agent-customization` skill.
  - depends on 7.1
  - Emphasize the principle skills:  `create-implementation-plan`, `pair-programming`, `delegation`, `spike`, `code-review`.
  - See [Additional context](#task-8-1)

- [x] 8.2 Link `docs/Skills.md` from `docs/README.md`
  Add a "🤖 Copilot Skills" section to `docs/README.md` linking to `Skills.md` and listing top skills inline. Same style as the existing sections.
  - depends on 8.1

- [x] 8.3 Cross-link existing skills to `docs/Skills.md`
  Add a one-line "See the [Skills catalog](../../docs/Skills.md) for the full list and decision tree" to each `SKILL.md`'s body so users discover siblings.
  - depends on 8.1

### Phase 9 — Cleanup & docs

- [x] 9.1 Remove or fold any throwaway scaffolding tests from earlier phases
- [ ] 9.2 Verify each new skill loads (slash command appears after reload)
  Manual smoke test: reload window, type `/`, confirm all 12 new skills appear with expected descriptions.
- [x] 9.3 Verify all internal markdown links resolve
  Check links from `Skills.md` to each `SKILL.md` and from each `SKILL.md` back to the catalog.
- [x] 9.4 Final pass: confirm no skill calls `gh` directly
  `grep -r '\bgh ' .github/skills/` should return zero hits inside skill bodies (other than possibly mentioning `gh` in "do not use" anti-pattern callouts).

## Contextual information

### Problem context

We have three solid skills (`create-implementation-plan`, `pair-programming`, `delegation`) that cover the *core* of human+AI collaboration. There are obvious gaps: no skill for the inverse of delegation (AI reviewing the human's work), no front-door for triaging incoming issues, no end-of-session handoff aid, no PR-creation step, no quality gates, and no way for a user to know which of the now-many skills to invoke. Filling these gaps closes the loop from "issue arrives" through "PR merged" while keeping the same vocabulary and conventions across all skills.

### Solution context

- **One coherent catalog**, not 12 disconnected utilities. Shared vocabulary (review hotspots, confirmation flow, no-assumptions rule, three-state suitability rating).
- **Strict tooling discipline**: skills go through `issue-*` / `pr-*` wrappers, never `gh` directly. This requires a small set of new wrappers up front (Phase 2).
- **One conventions document** (`.github/skills/_conventions.md`) so future skills don't re-invent shape decisions.
- **Discovery via `skill-guru`** — with 15 skills total, the meta-skill is necessary, not optional.
- **Documentation surfaces the catalog** in `docs/Skills.md`, linked from `docs/README.md`, with cross-links from each `SKILL.md` back to the catalog.

### Forces

- The three existing skills set hard precedents (frontmatter keys, reference-file split one level deep, description-as-discovery-surface). New skills must match or risk inconsistent UX.
- Skill descriptions are the **only** signal for auto-invocation. They must be keyword-rich and contain explicit "USE WHEN" and "DO NOT USE FOR" sections.
- `SKILL.md` body has a soft cap of ~5000 tokens; complex skills must use `references/` files (one level deep, per the official guidance).
- The repo's tooling philosophy is to wrap `gh` consistently in `issue-*` / `pr-*` scripts. Skills must respect this; skipping it would create drift.
- Skills are slash-invocable AND model-invocable by default. A poorly-named or poorly-described skill will pollute discovery. The catalog must keep names tight and non-overlapping.

### Additional considerations and notes

- **Don't** create user-scope skills (`~/.copilot/skills/`); everything stays workspace-scoped under `.github/skills/`.
- **Don't** add a `git`-touching skill (commit, push, branch). Skill suite is intentionally silent on git workflow.
- The `skill-guru` task depends on every other skill being defined first because its decision tree must reference real names.
- The conventions doc (1.4) is small and meant to be linked from every later skill task — not a reference loaded into each SKILL.md.
- All write-side tools (`pr-comment`, `pr-create-for-review`, `issue-comment`, `issue-update`, `issue-create`) follow the same confirmation flow already established in `pair-programming`'s `issue-integration.md`.

### Additional task context

#### <a id="task-1-1"></a>1.1 Audit existing skills as references

Files to read:
- [.github/skills/create-implementation-plan/SKILL.md](.github/skills/create-implementation-plan/SKILL.md) and its `references/`
- [.github/skills/pair-programming/SKILL.md](.github/skills/pair-programming/SKILL.md) and its `references/`
- [.github/skills/delegation/SKILL.md](.github/skills/delegation/SKILL.md) and its `references/`

Patterns to extract and write up in 1.4:
- YAML frontmatter shape (`name`, `description`, `argument-hint`, `user-invocable`)
- Description structure: opening sentence + "USE WHEN" + "DO NOT USE FOR"
- Section ordering inside `SKILL.md` (When to use → Core principles → Personality → Procedure → Anti-patterns)
- Reference-file split criteria (push concrete artifacts and verbose templates into `references/`, keep procedural language in `SKILL.md`)
- Confirmation flow for write commands
- Hotspot bullet format from `delegation/references/session-summary.md`
- The "Cross-link to sibling skills" pattern (`pair-programming` → `create-implementation-plan` → etc.)

#### <a id="task-1-2"></a>1.2 Inventory existing `issue-*` and `pr-*` tooling

Run `--help` on:
- `issue-create`, `issue-list`, `issue-update`, `issue-close`, `issue-comment`, `issue-get`, `issue-groom`, `issue-select`
- `pr-create-for-review`, `pr-create-for-merge`, `pr-complete-merge`, `pr-merge-pull-request`, `pr-cleanup-review-branches`, `pr-get-review-link`, `pr-get-merge-link`
- `project-add-issue`, `project-update-issue`

Output: short table mapping capability → tool. Identify what's missing for each planned skill.

#### <a id="task-1-3"></a>1.3 Confirm `gh`-free policy and decide tooling gaps

Likely additions (subject to 1.2 verification):
- `pr-get`, `pr-comment`, `pr-diff`, `pr-list` — covered in Phase 2 already.
- Label support on `issue-update` — verify before creating a separate `issue-label`.

If 1.2 reveals more gaps, append tasks to Phase 2 with sub-numbers (`2.7`, `2.8`, ...) — do **not** renumber existing tasks.

#### <a id="task-1-4"></a>1.4 Author skill conventions reference

Path: `.github/skills/_conventions.md` (leading underscore so it sorts above named skills and is clearly not itself a skill).

Sections:
1. Frontmatter template (copy-paste ready)
2. Description authoring guide (with "USE WHEN" / "DO NOT USE FOR" examples)
3. Section ordering for `SKILL.md` body
4. When to push content into `references/`
5. The shared confirmation flow (write commands)
6. The shared hotspot format
7. Sibling-cross-link rule
8. Anti-patterns (vague descriptions, name/folder mismatch, monolithic SKILL.md, calling `gh` directly)

Each later skill task should consult this doc before writing.

#### <a id="task-2-1"></a>2.1 Add `pr-get`

Location: `tools/scripts/pr-get.sh` + symlink in `tools/pr-get`. Pattern: mirror `tools/scripts/issue-get.sh` exactly. Use `gh pr view <N> --json ...` internally; surface as JSON. Include `--pretty` and `--devenv` safety flags identical to `issue-get`. Add `--help` matching the project's help convention.

#### <a id="task-2-2"></a>2.2 Add `pr-comment`

Mirror `tools/scripts/issue-comment.sh`. Conversational (top-level) comment by default. Optional `--review-comment --path FILE --line N` for an inline review comment. `--dry-run` mandatory.

#### <a id="task-2-3"></a>2.3 Add `pr-diff`

Two modes:
- `pr-diff <N>` → unified diff of PR N
- `pr-diff <baseRef> <headRef>` → diff between refs
Output to stdout. Used by `code-review` and `pre-commit`.

#### <a id="task-2-4"></a>2.4 Add `pr-list`

Mirror `issue-list`. Filters: `--state`, `--author`, `--label`, `--base`, `--head`, `--limit`. JSON output by default.

#### <a id="task-2-5"></a>2.5 Verify or add label support on `issue-update`

Run `issue-update --help`. If `--add-label` / `--remove-label` already exist, document and move on. Otherwise extend (repeatable flags). **Do not** create a separate `issue-label` script unless the existing wrapper genuinely can't absorb the change without breaking semantics.

#### <a id="task-3-1"></a>3.1 `refine-implementation-plan`

Inputs: existing plan file path or issue number. Behavior:
- Read current plan, parse phase/task structure and checkbox state.
- Interview user about what changed (new info, scope shift, learnings from discovery).
- Propose insertions/edits **without renumbering existing tasks** — new sub-tasks get `1.3.1`, `1.3.2`, ... new phase items insert with the next free number.
- Show diff in chat, get approval, write back to file or `issue-update --body-file`.
- Cross-link to `create-implementation-plan`.

#### <a id="task-3-2"></a>3.2 `plan-status`

Read-only. Inputs: plan file or issue number. Outputs:
- % complete (checked / total)
- Per-phase progress
- Blocked tasks (where `depends on N.N` references an unchecked task)
- Open questions / low-confidence sections from "Additional task context"
- Last-updated timestamp (file mtime or issue `updatedAt`)
No writes; no confirmation needed.

#### <a id="task-3-3"></a>3.3 `plan-from-spec`

Inputs: path to a design doc / RFC. Skill:
- Reads the doc.
- Extracts goals, non-goals, acceptance criteria.
- Produces a plan in the same format as `create-implementation-plan`'s template — but **without** the interview step.
- Asks user to confirm before writing the file.
- If acceptance criteria are missing from the spec, refuses and recommends `/create-implementation-plan` instead.

#### <a id="task-3-4"></a>3.4 `plan-update`

Lightweight sibling that closes the gap between read-only `/plan-status` and full-interview `/refine-implementation-plan`.

Inputs: file path OR GitHub issue number (auto-detect via `^[0-9]+$`), same convention as 3.1 / 3.2.

In scope (each operation requires a one-line user confirm):
- Mark a task `[x]` (or `[ ]` to undo a recent mark — must be on the most recent revision only).
- Answer/resolve an open question — either inline next to the question, or under a `## Resolved questions` section.
- Append a short note to a task line (e.g. `- 3.4 Foo — note: bar is the chosen approach`).
- Add a single new task to the end of a phase (next sequential number, never reflows).

Out of scope (redirect to `/refine-implementation-plan`):
- Rewording existing tasks
- Restructuring or reordering phases
- Cancelling tasks (strikethrough is a structural edit)
- Bulk additions

Behavior:
- Hard limit: if the request implies more than ~3 changes in one invocation, refuse and recommend `/refine-implementation-plan`.
- Records every change in `## Revision history` (same format as 3.1).
- Never silently unchecks `[x]` from a prior revision.
- For issue input: writes the updated body to a temp file, then offers `tools/issue-update N --body-file <path>`. Waits for explicit yes.
- No interview phase — the user invokes with a specific edit in mind. If the edit is unclear, ask one focused question, not a full interview.

Cross-link in description:
- USE WHEN the user says "mark 3.4 done", "answer that open question", "add a note to task X", "tick off 2.1".
- DO NOT USE FOR rewording, restructuring, or bulk changes — use `/refine-implementation-plan`. For read-only progress checks use `/plan-status`.

#### <a id="task-4-1"></a>4.1 `code-review`

Inputs: PR number (uses `pr-get` + `pr-diff`) OR a local diff (uses `get_changed_files`). Output structure mirrors `delegation`'s session summary:
- What changed (per file, brief)
- Review hotspots (same bullet format as `delegation`)
- Concerns (with reasoning)
- Missing tests / coverage gaps
- Style nits (separated, easy to ignore)
- Approve / request changes recommendation
Optional: post as PR comments via `pr-comment` with confirmation.

#### <a id="task-4-2"></a>4.2 `spike`

Inputs: a question or hypothesis. Behavior:
- Time-boxes the investigation (asks user for a soft cap: 1h / half-day / day).
- May write throwaway code in a clearly-marked location (e.g. `playground/spike-<short-name>/`).
- Produces a `Spike-findings-<name>.md` with: question, what was tried, what worked, what didn't, recommendation, links to throwaway code.
- Output is **explicitly marked throwaway** — top of the findings doc has a "THROWAWAY" banner.
- Does **not** modify production code paths.

#### <a id="task-4-3"></a>4.3 `rubber-duck`

Pure conversation. Hard rule: **does not edit any file, run any command that mutates state, or invoke any subagent**. Asks Socratic questions to help the user think through a problem. Ends by offering to summarize the conversation into the kickoff for `/create-implementation-plan` or `/spike`.

#### <a id="task-5-1"></a>5.1 `triage-issue`

Inputs: issue number. Behavior:
- `issue-get N --pretty`.
- Classify: bug / feature / question / duplicate / spike-needed / unclear.
- If unclear: ask 1–2 questions.
- Suggest labels (drawn from a `labels-config.yml` or the repo's existing label set — discover at runtime).
- Propose acceptance criteria if missing.
- Show proposed updates, get confirmation, run `issue-update <N> --add-label ... --body-file ...`.
- Recommend next skill (`/create-implementation-plan` for ready-to-implement issues, `/spike` for unclear ones).

#### <a id="task-5-2"></a>5.2 `session-handoff`

Inputs: the current session's chat context + optionally a plan path / issue number. Output: a "next session starts here" markdown block containing:
- Current state (what's done, what's in flight)
- Blockers / open questions
- The single most concrete next action
- File / line references for context restoration

Offers to: append to plan file, post as `issue-comment` on parent issue, or both. Reuses `delegation/references/session-summary.md` format.

#### <a id="task-5-3"></a>5.3 `open-pr`

Inputs: assumes a phase is committable. Behavior:
- Reads the plan and current branch.
- Drafts a PR title (from phase name) and body (from completed tasks + decisions made + summary of changes).
- Includes "Closes #N" / "Refs #N" link if a parent issue exists.
- Shows draft, gets approval.
- Invokes `pr-create-for-review` with the draft.
- **Does not** call `gh pr create` directly.
- Stays silent on git workflow (assumes the branch and commits already exist).

#### <a id="task-5-4"></a>5.4 `address-pr-comments`

Closing-the-loop skill for the receiving end of a PR review. Differs from the GitHub PR extension's existing `address-pr-comments` (batch: read all → fix all → resolve all). Ours is **one comment at a time** with per-comment author choice.

Inputs: PR number (auto-detect from current branch via `gh pr list --head <branch>` if not provided).

Procedure (loop until no unresolved threads remain):

1. **Fetch unresolved threads** via `tools/pr-review-threads <N> --unresolved-only`. Sort by file then line.
2. **For each thread**, surface to the user:
   - The file + line + a few lines of surrounding code context.
   - The comment thread (author, body, any existing replies).
   - Suggested classification (request-for-change / question / nit / praise).
3. **Ask: who addresses this?** Three options:
   - **AI addresses** — AI proposes the change, shows the diff, user reviews and approves before applying.
   - **User addresses** — user makes the change, AI waits and reviews the resulting diff with the user.
   - **Skip / no change needed** — proceed to the reply/resolve step without modifying code.
4. **After the change (or skip), ask: reply or just resolve?** Three options:
   - **Reply** — AI drafts a reply (e.g., "Done in <commit>", "Good catch — refactored to <approach>", "Disagree because <reason>"), user edits / approves, then post via `tools/pr-comment <N> --reply-to <comment-id>`.
   - **Resolve without replying** — use `tools/pr-comment <N> --resolve-thread <thread-id>` (or `tools/pr-resolve-thread <thread-id>` depending on the 2.9 split decision).
   - **Leave open** — skip both, move on (e.g., user wants to discuss further offline).
5. **Move to next thread.**

At the end:
- Summarise: N addressed (M by AI, K by user), R replied to, S resolved without reply, U left open.
- Suggest next step: `/pre-commit` if changes were made, or `/code-review` if user wants a fresh review pass on the responses.

Guardrails:
- Never auto-apply a code change. AI proposals always require user approval.
- Never auto-resolve a thread the user wanted to leave open.
- Skip threads where `canResolve: false` (informational note to user; don't try to resolve).
- If the PR has > N (configurable, default 20) unresolved threads, warn at the start and offer to filter (by file, by author) before iterating.
- Respects `--dry-run` end-to-end (shows what would be posted/resolved without doing it).

Cross-link in description:
- USE WHEN the user says "address PR comments", "work through the review feedback", "respond to reviewer comments one at a time", "go through the PR comments with me".
- DO NOT USE FOR batch-fix-all flows (use the GitHub PR extension's `address-pr-comments`), opening a PR (use `/open-pr`), or doing the review yourself (use `/code-review`).

#### <a id="task-6-1"></a>6.1 `coverage-check`

Inputs: project root or repo. Behavior:
- Detects project type (look for `*.csproj`, `package.json`, etc.) and selects the corresponding test+coverage command.
- Records baseline (or reads from prior run cached at `.coverage-baseline.json`).
- Runs tests with coverage.
- Compares to baseline, reports regressions **per file** with line numbers if tooling supports it.
- Refuses to update the baseline silently — requires user confirmation to re-baseline.

#### <a id="task-6-2"></a>6.2 `pre-commit`

Runs the project's lint/format/test commands. On failure:
- Surfaces the error with the offending file/line.
- Suggests a fix when obvious (formatter output, lint auto-fix).
- **Does not** run `git commit`, `git add`, or any git-mutating command.
- Skill explicitly states "this is the last step before *you* commit".

#### <a id="task-7-1"></a>7.1 `skill-guru`

Decision-tree skill. Asks the user 1–3 questions:
1. Is there an existing plan or issue with structure?
2. Is the work high-impact (public API / data shape / security / novel architecture)?
3. Are you implementing, reviewing, or exploring?

Then recommends one (or a sequence) of:
- `/triage-issue` → `/create-implementation-plan` → `/pair-programming` (high-impact greenfield)
- `/triage-issue` → `/create-implementation-plan` → `/delegation` (low-impact mechanical)
- `/code-review` (reviewing PR)
- `/spike` (uncertain, exploratory)
- `/rubber-duck` (just want to think out loud)
- `/refine-implementation-plan` / `/plan-status` (existing plan in flight)
- `/session-handoff` / `/open-pr` (wrap-up)
- `/pre-commit` / `/coverage-check` (quality gates)

Output: one recommendation with a one-line rationale, plus 1–2 alternatives with their rationale.

#### <a id="task-8-1"></a>8.1 Author `docs/Skills.md`

Sections:

1. **Overview** — what skills are, how they're discovered (slash command, auto-trigger by phrase).
2. **Decision tree / chooser** — the same logic baked into `skill-guru`, presented as a flowchart or short prose decision tree. So a user can find their own way without invoking the guru.
3. **Catalog** — alphabetical or by category. Each entry:
   - Skill name + slash command
   - One-line purpose
   - When to use
   - When NOT to use
   - Tool dependencies (which `issue-*` / `pr-*` tools it calls)
   - Link to the `SKILL.md`
4. **Workflow examples** — at least three end-to-end:
   - Triage → plan → pair → review → PR
   - Triage → plan → delegate → review → PR
   - Spike → plan-from-spec → delegate → PR
5. **Authoring a new skill** — short pointer to the `agent-customization` skill and the conventions doc (1.4).
6. **Anti-patterns** — common mistakes (skipping triage, delegating high-impact work, skipping the no-assumptions rule, calling `gh` from a skill).

### Reference information

- Existing skill: [.github/skills/create-implementation-plan/SKILL.md](.github/skills/create-implementation-plan/SKILL.md)
- Existing skill: [.github/skills/pair-programming/SKILL.md](.github/skills/pair-programming/SKILL.md)
- Existing skill: [.github/skills/delegation/SKILL.md](.github/skills/delegation/SKILL.md)
- Skill mechanics: agent-customization references at `~/.vscode-server/extensions/github.copilot-chat-*/assets/prompts/skills/agent-customization/references/skills.md`
- Existing tools: [tools/scripts/issue-get.sh](tools/scripts/issue-get.sh), [tools/scripts/issue-comment.sh](tools/scripts/issue-comment.sh), [tools/scripts/issue-update.sh](tools/scripts/issue-update.sh), [tools/scripts/issue-create.sh](tools/scripts/issue-create.sh)
- Existing tooling docs: [docs/Additional-Tooling.md](docs/Additional-Tooling.md), [docs/GitHub-Issues-Management.md](docs/GitHub-Issues-Management.md)
- Docs index: [docs/README.md](docs/README.md)
