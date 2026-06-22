---
name: devenv-create-implementation-plan
description: 'Create a structured Implementation_plan.md for a user story, task, or GitHub issue so a human + AI pair can execute it together. USE WHEN the user says "create an implementation plan", "plan this story", "break this task into phases", "break down this work", "write up a plan for this", or hands off a GitHub issue / user story to be implemented. Interviews the user, scans repo conventions, drafts phased atomic tasks, gets explicit approval, writes the file to the target repo root with a numbered suffix, and offers to push the plan into the associated GitHub issue. DO NOT USE for ad-hoc coding tasks where no plan file is wanted, for pure research/Q&A, or for editing an existing plan (just edit the file directly).'
argument-hint: '[issue-number | path-to-story | freeform description]'
user-invocable: true
---

# Create Implementation Plan

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to emit a copyable diagnostic block for `/devenv-skill-maintenance`.

Produce a phased, committable plan that gives a human or another AI enough context to execute a user story or task collaboratively. The plan is human-first: goals and orientation first, phase guidance second, detailed task tracking third.

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

If the primary upstream artifact is a design-discussion or spike output and there is no grooming artifact yet, route through [`/devenv-grooming`](../devenv-grooming/SKILL.md) first (unless the user explicitly asks to bypass grooming).

Exception: direct-plan mode is valid when the user intentionally wants to create a plan without grooming (for example from thin-air context, mixed pasted notes, or unclassified artifacts). In this mode, the skill disambiguates from user input and available sources.

## Inputs the Skill Collects

1. **Source material** (one or more of):
  - GitHub issue (number or URL) — fetch with `issue-get N --pretty` and `issue-comment-list N --full`; use both the issue body and comments as source material
   - Pasted user story / requirements text
   - Linked design docs or files in `planning.*` repos
2. **Related code** — read-only exploration via the `Explore` subagent
3. **Repo conventions** — `copilot/copilot-instructions.md`, `AGENTS.md`, and any `planning.*` repo in the workspace
4. **Acceptance criteria, scope boundaries, non-goals, risks** — gathered via interview

Source precedence rule:

- Side-stream artifacts (design discussion docs, spike output, copied text, issue comments, and other upstream artifacts) may be present with or without grooming. They are additional informational inputs and do not direct plan scope.
- If a grooming artifact exists for this work, it is the directing source for plan scope, slice boundaries, and coordination context.
- If no grooming artifact exists, the plan skill disambiguates scope from user-provided context and confirmation gates, using side-stream artifacts as supporting evidence.

## Procedure

### 1. Identify inputs and target repo

- Determine which repo the plan applies to (the plan file is written to **that** repo's root, not necessarily the current workspace root).
- If a GH issue number/URL is provided, fetch it. Capture the issue number for later.
- If a GH issue number/URL is provided, fetch the issue body and all comments. Treat comments as first-class source material; design docs often live there.
- Capture any pasted story / linked docs.

### 2. Scan repo conventions (always)

Read, in this order, if present:

- `<target-repo>/copilot/copilot-instructions.md`
- `<target-repo>/AGENTS.md`
- Any `planning.*` repo in the workspace that may contain related context

### 2.1 Classify component type and load context only when needed

Before exploring code, classify the target as one of:

- Service
- API gateway
- Frontend application

Use [`component-context/index.md`](/home/vscode/.copilot/knowledge/component-context/index.md) to select context. For service work, load only the relevant service file(s) needed for current planning decisions:

- `01-Service-Architecture.md`
- `02-Service-Implementation.md`
- `03-Service-Plugins.md`

If API gateway/frontend context is not yet present, continue using general repository and plan conventions and note that specialized context is pending.

### 3. Explore related code (read-only)

Use the `Explore` subagent (or `search_subagent`) to find existing modules, tests, and patterns the plan must respect. Do not edit anything in this step.

### 4. Interview the user

Use `vscode_askQuestions` to confirm/fill gaps. Always cover:

- Acceptance criteria — **infer these from the goals, scope, and codebase context rather than asking the user to define them directly.** Draft a candidate list and present it for the user to confirm or adjust. Mark each as `*(explicit)*` if it was stated directly in the input, or `*(inferred)*` if you deduced it from goals, "must"/"should" language, or domain context. The user is better positioned to recognise a good AC than to produce one from scratch.
- Scope boundaries and explicit non-goals
- Known risks / unknowns
- Decision points / pending questions — try to resolve as many as possible during planning. Leave questions pending only when they are implementation-level details or the user explicitly asks to defer.
- Target repo path (confirm)
- Any preferred phase breakdown or constraints
- Whether throwaway scaffolding tests are expected

Once the above is gathered, **draft the phase structure — names and one-line deliverable descriptions only — and discuss it before writing any task details.** Phase objectives should be agreed before the task list is written; tasks do not need to be discussed in detail. Present the phase outline like:

> *"Here's how I'd divide this work:*
> - *Phase 1 — Discovery & test scaffolding: read existing code, confirm assumptions, add/adjust tests that assert current observable behaviour (including stub/default behaviour where applicable), and end fully green*
> - *Phase 2 — Contracts & boundaries: define or tighten interfaces, request/response shapes, message schemas, extension points, or other contracts that later phases implement against; use temporary coverage exclusions only when unavoidable and always pair them with DEVENV TODOs*
> - *Phase 3 — [Name]: [deliverable]*
> - *Phase N — Cleanup & docs: remove scaffolding, update docs, verify coverage*
>
> *Does this structure make sense for what you're building? Any phases to merge, split, or reorder before I fill in the tasks?"*

Do **not** propose Phase 1 as "add failing tests for new behaviour" or any equivalent wording. A phase proposal is invalid unless each phase is independently committable (tests pass, coverage does not regress, and the phase has a clear standalone deliverable).

Bias toward defining important contracts early, before broad implementation begins. For medium/large work, initial phases should usually lock down the core interfaces, API shapes, message contracts, plugin seams, or persistence boundaries that the rest of the plan depends on. This improves shared understanding and exposes design problems earlier.

Wait for explicit approval of the phase structure before proceeding to draft tasks.

### 4a. Optional pressure-test pass (user-gated)

After phase-structure approval and before drafting detailed tasks, offer an optional pressure-test pass using [pressure-test-protocol.md](../common/references/pressure-test-protocol.md).

- Use this when the plan has high-impact contract decisions, brittle sequencing, or unresolved high-blast-radius assumptions.
- Never run automatically; proceed only on explicit user consent.
- Keep it bounded to at most two passes per draft state.
- If findings expose broader architecture drift instead of plan-local fixes, route to [`/devenv-grooming`](../devenv-grooming/SKILL.md) before continuing this skill.

### 4b. Scale/risk redivision gate

Before drafting detailed tasks, check whether the proposed plan is too large or risky for a single implementation issue.

Re-division signals:

- Multiple repos/components are required before any value can ship.
- The work does not split into independently deliverable production slices.
- Phase count or dependency density suggests high coordination risk.
- The user states uncertainty and high implementation risk for one combined plan.

If triggered, propose redivision through grooming and provide a copyable markdown handoff block the user can paste into `/devenv-grooming`:

```markdown
## Grooming Redivision Request

Current planning context indicates this should be split into multiple independently deliverable issues.

- Source issue/plan: <issue number or plan path>
- Target area: <component/repo scope>
- Why split: <risk/size/dependency summary>

Suggested split axes:
- Repo/component boundaries
- Feature vs Fix vs Task issue type
- Independent production deliverables

Please produce a grooming attack plan with proposed issues including:
- issue type (Feature/Fix/Task)
- repo
- size (S/M/L)
- independent production target statement
- expected implementation-plan artifact per issue

After grooming updates the upstream artifact, return with:
- grooming artifact location
- selected issue slice to plan now
```

After grooming returns an updated upstream artifact, use it to reshape this plan into a smaller, focused implementation plan for one selected issue slice.

Do not continue detailed task generation while redivision is unresolved.

### 5. Draft the plan in chat

Use the [plan template](./references/plan-template.md). Follow:

- [Task formatting rules](./references/task-format.md) — atomic `- [ ] **N.N [S|M|L] Title**` tasks written as concise step entries; keep optional metadata (`Files:` / `decision:` / `depends on`) and move deep detail to `(additional context)` when needed
- [Phase rules](./references/phase-rules.md) — Phase 1 is **Discovery & test scaffolding**; the last phase is **Cleanup & docs**; every phase must end committable (tests pass, coverage doesn't regress, single-PR sized)
- Where the work introduces or changes important boundaries, add an early **Contracts & boundaries** phase (usually Phase 2, sometimes merged into late Phase 1 for smaller work) before broad implementation starts
- The plan must follow this section order: `## Goals and Acceptance Criteria`, `## Context and Orientation`, `## Phases`, `## Detailed Task List`, `## Appendix` *(optional unless required by source complexity)*, `## Pending Questions` *(optional)*, `## Reference Information`, `## Additional Task Context`, `## Revision History`
- `## Goals and Acceptance Criteria` must include an end-state paragraph plus important scope boundaries before the AC checklist
- `## Context and Orientation` must be useful on its own to a human who may never read the task list
- `## Context and Orientation` should be concise but substantive: each subsection should usually be 2-4 sentences with concrete repo-specific details (affected components, current behaviour, target behaviour, and constraints), not placeholder-style one-liners
- `## Phases` is the human-facing phase summary section: each phase gets goal, end-state vision, suggested strategies, AC links, watch-outs / decisions, and deliverables
- Resolve pending questions as early as possible during plan creation. Unresolved items are allowed only for implementation-level details or explicit user deferral.
- When contract-first phases temporarily reduce meaningful coverage (for example because interfaces, schema holders, or placeholder adapters land before their implementations), the plan may use temporary coverage-exclusion mechanisms only when truly necessary. If it does, include explicit cleanup/removal tasks in a later phase and require `TODO:(DEVENV[plan-key]): ...` markers at the code locations that need real implementation or coverage restoration.
- Every unresolved decision that can block execution must appear in both places:
  - `## Phases` under the relevant phase's **Watch Outs / Decisions**
  - `## Detailed Task List` as a task-level `decision:` metadata line on the earliest task where the decision matters
- Pending-question placement is strict:
  - phase/task-specific unresolved questions stay inline under the relevant phase/task as `[QUESTION] ...`
  - only plan-level unresolved questions belong in `## Pending Questions`
- `## Phases` should carry practical execution guidance, not just labels: include at least 2 suggested strategies and at least 2 concrete deliverables per phase whenever the scope permits
- `## Detailed Task List` repeats the same phases with a short deliverable-summary blockquote and a condensed 3-6 step sequence per phase, pointing back to the fuller phase context above
- `## Appendix` is optional only for straightforward work. It is **required** when the plan is derived from an upstream design artifact (design doc, RFC, Blueprint, Redesign doc, or equivalent issue comment) and the work is medium/high complexity or risk.
- Use the explicit complexity triggers in [plan-template.md](./references/plan-template.md): appendix is required when design-derived work meets the threshold (any 1 high-complexity trigger, or any 2 medium-complexity triggers).
- When required, the appendix must summarize the important upstream design context, not just link to it: key decisions, constraints/invariants, interface contracts, migration/rollout considerations, and any explicitly rejected alternatives that affect implementation sequencing.
- Keep the appendix bounded (roughly 10-25 lines) so it stays focused and actionable.
- If the same rationale already appears in `## Phases`, `## Detailed Task List`, or `## Reference Information`, do not repeat it in the appendix; link instead.
- `## Pending Questions` is optional and sits immediately above `## Reference Information`. Use it only for unresolved plan-level questions that matter to execution; task- or phase-specific questions should be placed inline below the relevant task/phase using `[QUESTION] ...`
- Reference Information uses a **table** of key files with a relevance column, plus a separate links sub-list
- If upstream artifacts exist (grooming doc, design discussion, spike, blueprint, roadmap issue), link them explicitly in `## Reference Information`.
- If upstream artifacts exist (grooming doc, design discussion, spike, blueprint, roadmap issue), link them explicitly in `## Reference Information` and include the parent grooming artifact when this plan is one slice of a larger issue attack plan.
- Mark dependencies as `depends on N.N` inline; readers infer parallelism
- Every task with non-obvious context **must** link to its entry under *Additional task context* using a descriptive anchor slug (`#task-NN--short-slug`)
- Include the AC checklist in `## Goals and Acceptance Criteria` using the agreed format: `- [ ] <a id="ac-N"></a>**AC-N** criterion text *(explicit|inferred)*`.
- Every AC mention outside the checklist must be a link to the specific AC anchor (`[AC-N](#ac-N)`), not plain text.
- These criteria are formally reviewed and checked off in the Cleanup phase.

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

Write the approved plan to `<target-repo>/<resolved-filename>.md`. The plan must include a `## Revision History` section near the bottom of the file (after `## Additional Task Context`) with a single initial entry:

```markdown
## Revision History

### <today's date> — Initial plan created
```

Confirm the path back to the user.

### 9. Offer GitHub issue update (only if an issue is associated)

Ask, verbatim:

> Update issue #N description with this plan? (runs `issue-update N --body-file <path>`)

Only after explicit confirmation, run this preservation check first:

- Fetch the current issue description/body.
- If the existing body is significant, preserve it in a comment before replacing the body with the plan.
- Use this significance rule:
  - Significant when the current body is substantive narrative context (for example roughly 8 or more non-empty lines, or roughly 500+ characters), and not just a short placeholder.

If significant, post a comment with this exact heading at the top:

```markdown
# Original Issue Description

<original issue body>
```

Then run:

```bash
issue-update <N> --body-file <path-to-plan>
```

Run from the target repo's working directory. If it fails, surface the error; do not retry blindly.

## Phase Rules (summary)

See [phase-rules.md](./references/phase-rules.md) for the full checklist.

- **Phase 1 is always**: Discovery & test scaffolding
- **Last phase is always**: Cleanup & docs
- Each phase must be **atomic and committable**: tests pass, coverage does not regress, deliverable stands alone
- Include test tasks alongside code tasks in every phase — do not defer all testing to a final phase
- TDD red-green cycles must close within the same phase
- When legacy and new code mix across phases, prefer a dedicated early legacy cleanup phase — see [phase-rules.md](./references/phase-rules.md) for patterns
- **Coverage escape hatch** (Form A/B): see [phase-rules.md](./references/phase-rules.md); flag candidates at plan creation
- Tasks with no `depends on` between them may be done in parallel

## Task Formatting Rules (summary)

```
- [ ] **N.N [S|M|L] Task title** ([additional context](#task-NN--short-slug))
  - Files: `workspace-root-relative/path/File.cs`, `workspace-root-relative/path/FileTests.cs`
  - decision: <the choice to make, and why it's non-obvious> (omit if none)
  - owner: User | AI  (omit when either party can take it — default)
  - depends on N.N (omit if none)
```

- **Bold task header** with size label and optional inline `(additional context)` link.
- **Concise step entries, metadata optional** — each task line should read as a concrete step. Add `Files:` / `decision:` / `owner:` / `depends on` only when it meaningfully improves execution clarity.
- `[S/M/L]` size label on every task: S ≤ 30 min, M = 30 min–2 h, L > 2 h (consider splitting).
- `Files:` lists every file the task reads or modifies using workspace-root-relative paths. New files get a `(new)` suffix. Powers the **Files in scope** links in pair-programming and delegation at phase kickoff.
- `decision:` flags a non-obvious design choice — signals AI to stop and ask, signals pair-programming to discuss at handoff.
- `owner: User` flags tasks the human must drive (design intent, domain judgment). `owner: AI` flags mechanical tasks the AI should take by default. Omit when either party can take it.
- Anchor slugs are descriptive: `#task-21--mockstore-implementation`, not `#task-2-1`.
- `N.N` — first number is the phase. Sub-tasks extend the series: `1.3.1`, `1.3.2`, ...
- Push depth into *Additional task context* and link to it rather than bloating sub-bullets.
- If a sub-bullet would need its own paragraph, move that content into *Additional task context* instead of expanding the task header.

See [task-format.md](./references/task-format.md) for the full spec and examples.

## Document Skeleton

Use the full template at [plan-template.md](./references/plan-template.md). Required top-level structure:

```
# TITLE

Brief one-paragraph context.

## Goals and Acceptance Criteria

End-state paragraph, why the work is being done, and scope boundaries.

## Context and Orientation

Human-oriented context loading section. Useful even if the reader stops here.

## Phases

### Phase 1 — Discovery & test scaffolding

Goal, end-state vision, suggested strategies, AC links, watch-outs / decisions, deliverables.

### Phase 2 — ...

Same structure.

## Detailed Task List

### Phase 1 — Discovery & test scaffolding
> Deliverable summary blockquote.
>
> See the matching entry in `## Phases` for the full orientation and watch-outs.

### Phase 2 — ...
> Deliverable summary blockquote.

## Appendix *(optional unless required by source complexity)*

### Deep Context for Pairing *(optional)*

Supplemental deep context for complex/high-risk plans. Required when significant upstream design context must be preserved for execution.

## Pending Questions *(optional)*

- [QUESTION] <General plan or approach question that is still unresolved>

## Reference Information
  - Key files table (with relevance column)
  - Related links

## Additional Task Context

## Revision History
```

Every phase header in `## Detailed Task List` is followed by a short `> blockquote` deliverable summary and a condensed step list (typically 3-6 tasks). The fuller human-facing guidance lives in `## Phases`. If `## Appendix` is present, treat it as supplemental context and keep it intentionally brief. If `## Pending Questions` is present, keep it to genuinely unresolved execution questions rather than dumping notes. Section headings use Title Case.

## Anti-patterns

- Writing the file **before** the user approves the draft
- Vague tasks ("Implement the feature") with no acceptance signal
- Overloading task lines with context instead of linking to *Additional task context*
- Skipping the repo-conventions scan
- Overwriting an existing `Implementation_plan*.md` (always use a numbered suffix)
- Auto-running `issue-update` without explicit user confirmation
- Replacing a significant existing issue description without first preserving it in a comment titled `# Original Issue Description`

## Sibling skills

- `/devenv-create-blueprint` + `/devenv-create-roadmap` — for epic-scale work across multiple components; each roadmap step eventually becomes an implementation plan.
- `/devenv-grooming` — when the component's internal design direction is unsettled; classify it before writing tasks.
- `/devenv-design-discussion` — when the right approach for this work isn't settled yet; weigh options before planning tasks.
- `/devenv-plan-from-spec` — when the spec or issue body is already complete enough to skip the interview.
- `/devenv-refine-implementation-plan` — to revise this plan after scope changes.
- `/devenv-plan-update` — small surgical edits (tick boxes, add notes).
- `/devenv-plan-status` — read-only progress report.

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
