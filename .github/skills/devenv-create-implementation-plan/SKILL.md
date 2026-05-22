---
name: devenv-create-implementation-plan
description: 'Create a structured Implementation_plan.md for a user story, task, or GitHub issue so a human + AI pair can execute it together. USE WHEN the user says "create an implementation plan", "plan this story", "break this task into phases", "break down this work", "write up a plan for this", or hands off a GitHub issue / user story to be implemented. Interviews the user, scans repo conventions, drafts phased atomic tasks, gets explicit approval, writes the file to the target repo root with a numbered suffix, and offers to push the plan into the associated GitHub issue. DO NOT USE for ad-hoc coding tasks where no plan file is wanted, for pure research/Q&A, or for editing an existing plan (just edit the file directly).'
argument-hint: '[issue-number | path-to-story | freeform description]'
user-invocable: true
---

# Create Implementation Plan

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

Produce a phased, atomic, committable plan that gives a human or another AI enough context to execute a user story or task collaboratively.

## When to Use

Trigger phrases:

- "create an implementation plan" / "write an implementation plan"
- "plan this story" / "plan out this work"
- "break this task into phases" / "break down this work"
- A GitHub issue URL or number is handed off with intent to implement
- A pasted user story / requirements blob with intent to implement

Do **not** use for:

- Quick coding tasks where no plan file is desired
- Pure research / Q&A
- Editing an existing plan (edit the file in place)
- Epic-scale work spanning multiple components — use [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md) + [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md) first; each roadmap step then gets its own implementation plan

## Inputs the Skill Collects

1. **Source material** (one or more of):
   - GitHub issue (number or URL) — fetch with `issue-get N --pretty`
   - Pasted user story / requirements text
   - Linked design docs or files in `planning.*` repos
2. **Related code** — read-only exploration via the `Explore` subagent
3. **Repo conventions** — `.github/copilot-instructions.md`, `AGENTS.md`, and any `planning.*` repo in the workspace
4. **Acceptance criteria, scope boundaries, non-goals, risks** — gathered via interview

## Procedure

### 1. Identify inputs and target repo

- Determine which repo the plan applies to (the plan file is written to **that** repo's root, not necessarily the current workspace root).
- If a GH issue number/URL is provided, fetch it. Capture the issue number for later.
- Capture any pasted story / linked docs.

### 2. Scan repo conventions (always)

Read, in this order, if present:

- `<target-repo>/.github/copilot-instructions.md`
- `<target-repo>/AGENTS.md`
- Any `planning.*` repo in the workspace that may contain related context

### 3. Explore related code (read-only)

Use the `Explore` subagent (or `search_subagent`) to find existing modules, tests, and patterns the plan must respect. Do not edit anything in this step.

### 4. Interview the user

Use `vscode_askQuestions` to confirm/fill gaps. Always cover:

- Acceptance criteria (how do we know it's done?)
- Scope boundaries and explicit non-goals
- Known risks / unknowns
- Target repo path (confirm)
- Any preferred phase breakdown or constraints
- Whether throwaway scaffolding tests are expected

### 5. Draft the plan in chat

Use the [plan template](./references/plan-template.md). Follow:

- [Task formatting rules](./references/task-format.md) — atomic `- [ ] **N.N [S|M|L] Title**` tasks with descriptive sub-bullets, then `Files:` / `decision:` / `depends on` metadata, and an inline `(additional context)` link when needed
- [Phase rules](./references/phase-rules.md) — Phase 1 is **Discovery & test scaffolding**; the last phase is **Cleanup & docs**; every phase must end committable (tests pass, coverage doesn't regress, single-PR sized)
- Every phase header gets a `> blockquote` preamble describing the deliverable and committability
- Reference Information uses a **table** of key files with a relevance column, plus a separate links sub-list
- Mark dependencies as `depends on N.N` inline; readers infer parallelism
- Every task with non-obvious context **must** link to its entry under *Additional task context* using a descriptive anchor slug (`#task-NN--short-slug`)

### 6. Iterate until approved

Show the draft in chat. Revise based on feedback. **Do not write the file yet.**

### 7. Resolve target filename (numbered suffix, always)

In the target repo root:

- If a GH issue is associated → base name `Implementation_plan-issue-<N>`
- Otherwise → base name `Implementation_plan`
- Find the next available zero-padded numeric suffix (`-001`, `-002`, ...) so nothing is overwritten:
  - `Implementation_plan-issue-15-001.md`, `Implementation_plan-issue-15-002.md`, ...
  - `Implementation_plan-001.md`, `Implementation_plan-002.md`, ...

### 8. Write the file

Write the approved plan to `<target-repo>/<resolved-filename>.md`. Confirm the path back to the user.

### 9. Offer GitHub issue update (only if an issue is associated)

Ask, verbatim:

> Update issue #N description with this plan? (runs `issue-update N --body-file <path>`)

Only after explicit confirmation, run:

```bash
issue-update <N> --body-file <path-to-plan>
```

Run from the target repo's working directory. If it fails, surface the error; do not retry blindly.

## Phase Rules (summary)

See [phase-rules.md](./references/phase-rules.md) for the full checklist.

- **Phase 1 is always**: Discovery & test scaffolding
- **Last phase is always**: Cleanup & docs
- Each phase must be **atomic and committable**: tests pass, coverage does not regress, sized for a single PR
- Each phase's task list must include **test tasks alongside the code tasks** — do not defer all testing to a final phase
- Tests written in early phases assert the **current state** (including stubs); they evolve as implementation lands — they are not discarded
- Exception path: if a phase genuinely cannot satisfy the coverage rule without disproportionate cost, document why in the plan and restore coverage in the next phase. This is a last resort.
- Tasks within a phase that have no `depends on` between them may be done in parallel

## Task Formatting Rules (summary)

See [task-format.md](./references/task-format.md) for the full spec and examples.

```
- [ ] **N.N [S|M|L] Task title** ([additional context](#task-NN--short-slug))
  - <Concrete sub-step or behavioural note>
  - <Another sub-step — method signature, file to touch, edge case, etc.>
  - Files: `workspace-root-relative/path/File.cs`, `workspace-root-relative/path/FileTests.cs`
  - decision: <the choice to make, and why it's non-obvious> (omit if none)
  - owner: User | AI  (omit when either party can take it — default)
  - depends on N.N (omit if none)
```

- **Bold task header** with size label and optional inline `(additional context)` link.
- **Descriptive sub-bullets first, metadata last** — sub-bullets describe the work concretely (methods to add, behaviours, edge cases); `Files:` / `decision:` / `owner:` / `depends on` sit at the bottom of the bullet list.
- `[S/M/L]` size label on every task: S ≤ 30 min, M = 30 min–2 h, L > 2 h (consider splitting).
- `Files:` lists every file the task reads or modifies using workspace-root-relative paths. New files get a `(new)` suffix. Powers the **Files in scope** links in pair-programming and delegation at phase kickoff.
- `decision:` flags a non-obvious design choice — signals AI to stop and ask, signals pair-programming to discuss at handoff.
- `owner: User` flags tasks the human must drive (design intent, domain judgment). `owner: AI` flags mechanical tasks the AI should take by default. Omit when either party can take it.
- Anchor slugs are descriptive: `#task-21--mockstore-implementation`, not `#task-2-1`.
- `N.N` — first number is the phase. Sub-tasks extend the series: `1.3.1`, `1.3.2`, ...
- Push depth into *Additional task context* and link to it rather than bloating sub-bullets.

## Document Skeleton

Use the full template at [plan-template.md](./references/plan-template.md). Required top-level structure:

```
# TITLE

Brief one-paragraph context.

## Task List

### Phase 1 — Discovery & test scaffolding
> Phase preamble blockquote: deliverable, safety, committability.
>
> **Orientation:** What the relevant code currently does and why it falls short for this phase's goal. Ends with one specific thing to find first. *(Skip if already warm.)*

### Phase 2 — ...
> Phase preamble blockquote.
>
> **Orientation:** ...

## Contextual Information
### Problem Context
### Solution Context
### Forces
### Additional Considerations and Notes
### Additional Task Context
### Reference Information
  - Key files table (with relevance column)
  - Related links
```

Every phase header is followed by a `> blockquote` preamble. Section headings use Title Case.

## Anti-patterns

- Writing the file **before** the user approves the draft
- Vague tasks ("Implement the feature") with no acceptance signal
- Overloading task lines with context instead of linking to *Additional task context*
- Skipping the repo-conventions scan
- Overwriting an existing `Implementation_plan*.md` (always use a numbered suffix)
- Auto-running `issue-update` without explicit user confirmation

## Sibling skills

- `/devenv-create-blueprint` + `/devenv-create-roadmap` — for epic-scale work across multiple components; each roadmap step eventually becomes an implementation plan.
- `/devenv-create-technical-design` — when the component's internal design is unsettled; produce an `Architecture_and_implementation.md` before writing tasks.
- `/devenv-design-discussion` — when the right approach for this work isn't settled yet; weigh options before planning tasks.
- `/devenv-plan-from-spec` — when the spec or issue body is already complete enough to skip the interview.
- `/devenv-refine-implementation-plan` — to revise this plan after scope changes.
- `/devenv-plan-update` — small surgical edits (tick boxes, add notes).
- `/devenv-plan-status` — read-only progress report.

See the [Skills catalog](../../docs/Skills.md) for the full list and decision tree.
