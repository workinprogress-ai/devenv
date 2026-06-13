---
name: devenv-plan-from-spec
description: Generate an Implementation_plan-*.md from an existing design doc, RFC, GitHub issue, URL, or pasted spec text — without the discovery interview that `/devenv-create-implementation-plan` runs. USE WHEN the user says "turn this spec into a plan", "make a plan from this RFC", "plan from this design doc", "convert this issue body into a plan", or hands off a complete-looking spec and asks for a plan. Auto-detects input type (file path, GitHub issue number, URL, or inline text), shows a proposed phase outline for approval before writing the full plan, infers acceptance criteria from goals when not explicit, and writes the plan to the target repo root using the same numbered-suffix filename convention as `/devenv-create-implementation-plan`. DO NOT USE for vague or incomplete ideas (use `/devenv-create-implementation-plan` for the full discovery interview), for revising an existing plan (use `/devenv-refine-implementation-plan`), or for small edits to an existing plan (use `/devenv-plan-update`).
argument-hint: File path, GitHub issue number, URL, or pasted spec text containing the source spec
---

# Plan from spec

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

Convert an existing spec — design doc, RFC, GitHub issue body, URL, or pasted text — into an `Implementation_plan-*.md` without running the full discovery interview that `/devenv-create-implementation-plan` requires.

## When to Use

- A spec already exists and is reasonably complete (goals stated, scope clear).
- The user wants a plan derived from that spec, not from a brainstorm.
- The spec lives in any of: a markdown file, a GitHub issue body, a remote URL, or pasted text.

If the spec is vague or incomplete, redirect to `/devenv-create-implementation-plan` (which interviews the user to fill the gaps).

If the spec is a `Blueprint-*.md`, prefer [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md) first — it decomposes by component and creates per-step issues. Then use this skill (or `/devenv-create-implementation-plan`) on each roadmap step.

If the spec is primarily a design-discussion or spike artifact and no grooming artifact exists yet, route through [`/devenv-grooming`](../devenv-grooming/SKILL.md) first unless the user explicitly asks to bypass grooming.

Exception: direct-plan mode is valid when the user intentionally wants a plan without grooming and provides sufficient context directly (including mixed/unclassified artifacts). In this mode, artifacts are used to inform disambiguation rather than to direct scope.

## Inputs

The user provides exactly one of:

- **A file path** — e.g. `docs/design/feature-x.md`. Read directly.
- **A GitHub issue number** — e.g. `42`. Fetch the body via `issue-get N`, then fetch all comments via `issue-comment-list N --full`. Use both as the spec: issue body first, then each comment in chronological order, separated by a `--- Comment by @login ---` marker. Later comments may refine or contradict earlier content — give them more weight.
- **A URL** — e.g. `https://example.com/rfc.html`. Fetch via `fetch_webpage`.
- **Inline text** — pasted directly in the conversation.

**Auto-detection rules:**

- `^[0-9]+$` → issue number
- `^https?://` → URL
- File exists at the given path → file
- Multiple lines of prose with no other match → inline text
- Ambiguous → ask which the user meant.

Source precedence rule:

- Side-stream artifacts (provided spec, auxiliary docs, copied context, issue comments) may be present with or without grooming. They are additional informational inputs and do not direct scope.
- If a grooming artifact exists, it is the directing source for scope and slice boundaries.
- If no grooming artifact exists, the planning skill resolves ambiguity from combined context and user confirmation gates, using side-stream artifacts as supporting evidence.

## Workflow

### 1. Load the spec

- Resolve the input per the rules above.
- For **GitHub issue input**: fetch the body (`issue-get N`) **and** all comments (`issue-comment-list N --full`). Combine them as one spec — body first, each comment appended with a `--- Comment by @login ---` separator. Later comments often refine or supersede earlier content; weight accordingly.
- For URL input, prefer `fetch_webpage` with a query that pulls structure-relevant content (goals, requirements, acceptance criteria).
- Strip obvious non-spec content (navigation, footers).

### 2. Extract structure

Identify, where present:

- **Title / one-line summary**
- **Goals** (what the work achieves)
- **Non-goals** (what's explicitly out of scope)
- **Acceptance criteria** (explicit "must", "should", numbered requirements, given/when/then blocks)
- **Risks / open questions**
- **Decision points** that must be answered before a phase can execute
- **Dependencies on other work or systems**

If acceptance criteria are not explicit, **infer** them from the goals and any "must"/"should" statements. Mark each inferred criterion clearly so the user knows it wasn't lifted verbatim.

### 3. Propose a phase outline (approval gate)

Before writing the full plan, present just the phase headings and a one-line summary of each:

```markdown
Proposed phase outline for the plan:

1. Phase 1 — Discovery & test scaffolding
   Explore the codebase; stub out interfaces or methods the acceptance criteria will exercise; write tests that assert the **current observable behaviour** (stubs, throws, baseline state). Every test added in this phase must pass at the end of it — do not write tests that assert behaviour the code does not yet have.
2. Phase 2 — Contracts & boundaries
   Define or tighten the interfaces, request/response shapes, message schemas, extension points, or other contracts that the later implementation phases will build against. If temporary coverage exclusions are unavoidable at this stage, they must be explicitly tracked with DEVENV TODO markers and later cleanup tasks.
3. Phase 3 — Core data model
   ...
4. Phase 4 — API surface
   ...
5. Phase 5 — Integration & wiring
   ...
6. Phase 6 — Cleanup & docs

OK to proceed with full task breakdown? (yes / adjust phases / cancel)
```

Use `vscode_askQuestions`. Wait for explicit approval before writing the file.

### 3a. Optional pressure-test pass (user-gated)

After the phase-outline gate and before generating the full task breakdown, offer an optional pressure-test pass using [pressure-test-protocol.md](../common/references/pressure-test-protocol.md).

- Use it when the source spec carries high-risk assumptions, contract ambiguity, or sequencing fragility.
- Never run automatically; proceed only with explicit user consent.
- Keep it bounded to at most two passes per artifact state.
- If the pass reveals broad architecture drift, pause plan generation and route to [`/devenv-grooming`](../devenv-grooming/SKILL.md) or [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md) as appropriate.

### 3b. Scale/risk redivision gate

Before generating the full task breakdown, evaluate whether this should remain one implementation-plan issue.

If the scope is too large or risky (multi-repo coupling, no independent production slices, high dependency density), pause and propose redivision via grooming.

Provide this copyable handoff block:

```markdown
## Grooming Redivision Request

The current spec appears too large/risky for one implementation-plan issue.

- Source spec: <path/url/issue>
- Current target scope: <repo/component>
- Why split: <risk + dependency summary>

Please produce a grooming attack plan as Feature/Fix/Task issues, each with:
- repo
- size (S/M/L)
- independent production target
- expected implementation-plan artifact per issue

Return with the selected issue slice and grooming artifact link so plan generation can continue on that focused slice.
```

When the updated grooming artifact is provided, continue this skill for the selected slice only.

Do not continue full-plan generation while redivision is unresolved.

### 4. Generate the full plan

Read and follow the plan template at [`../devenv-create-implementation-plan/references/plan-template.md`](../devenv-create-implementation-plan/references/plan-template.md). Use it verbatim as the structural skeleton.

For spec-derived plans, record the source spec inside `## Reference Information` rather than creating a separate top-level section. The human-first section order still applies.

If upstream artifacts exist (grooming doc, design discussion, spike, blueprint, roadmap issue), add explicit links to them in `## Reference Information`, including the parent grooming artifact when the plan is one slice of a larger issue attack plan.

```markdown
**Source spec:** <resolved spec location: file path, issue URL, fetched URL, or "inline text">
```

Mark each criterion as `*(explicit)*` (lifted verbatim from the spec) or `*(inferred)*` (deduced from goals / "must"/"should" statements). The user must be able to tell signal from inference. Use `**AC-N**` bold identifiers on every criterion so they can be tracked with `markdown-plan-complete-ac`.

Beyond those two sections, follow all rules from `/devenv-create-implementation-plan`:

- Phase 1 is **always Discovery + test scaffolding** (explore codebase; stub new interfaces; write tests that assert **current observable behaviour** — including stubs that throw as expected — all tests must pass at the end of Phase 1; do **not** write tests that assert behaviour not yet implemented).
- Bias toward an early **Contracts & boundaries** phase before broad implementation begins whenever the work introduces or changes important interfaces, schema shapes, extension seams, or persistence boundaries.
- Last phase is **always Cleanup & docs**.
- Resolve as many pending questions as possible while generating the plan. Keep unresolved items only for implementation-level details or explicit user-requested deferral.
- Any unresolved decision that can block execution must be represented in both places:
   - `## Phases` under the relevant phase's **Watch Outs / Decisions**
   - `## Detailed Task List` as `decision:` metadata on the earliest affected task
- Pending-question placement stays strict: phase/task-specific `[QUESTION] ...` inline under the relevant phase/task; `## Pending Questions` only for plan-level unresolved items.
- For specs derived from upstream design artifacts (design docs, RFCs, Blueprints, Redesign docs, or equivalent detailed issue comments), include a `## Appendix` section whenever the work is medium/high complexity or risk. In that appendix, summarize the important upstream design context directly: key decisions, constraints/invariants, interface contracts, migration/rollout implications, and rejected alternatives that affect implementation choices.
- If early contract-definition phases use temporary coverage-exclusion attributes or mechanisms because the concrete implementation lands later, add explicit cleanup/removal tasks in a later phase and require `TODO:(DEVENV[plan-key]): ...` markers at the affected code locations.
- **If the spec is a `Solution_Proposal_*.md` (or equivalent design-decision artifact)**, the Cleanup phase must include two additional tasks:
   1. *"Update `docs/Architecture_and_implementation.md` using the selected option and recommendation as the source — use `/devenv-grooming` to capture the design delta for in-flight work."*
   2. *"Delete the local temporary design artifact working copy once the architecture doc is updated (unless the file itself is the intended canonical artifact)."*
- Tasks follow the **full format** — see [task-format.md](../devenv-create-implementation-plan/references/task-format.md): `- [ ] **N.M [S|M|L] Title** ([additional context](#anchor))` header; descriptive sub-bullets first; `Files:` / `decision:` / `owner:` / `depends on` metadata last. Every task gets an `[S|M|L]` size label. Do not generate title-only or abbreviated tasks.
- Phase rules — see [phase-rules.md](../devenv-create-implementation-plan/references/phase-rules.md): each phase must end committable (tests pass, coverage does not regress, single-PR sized); tests appear alongside code tasks in each phase (not deferred to the end); the human-facing guidance lives in `## Phases`, while `## Detailed Task List` uses short deliverable-summary blockquotes that point back to the richer phase summaries.

### 5. Write the file

- Target location: same convention as `/devenv-create-implementation-plan`:
  - Issue input → `Implementation_plan-issue-N-NNN.md` at the target repo root.
  - All other inputs → `Implementation_plan-NNN.md` at the target repo root (or workspace root if no clear target repo).
- `NNN` is the next unused 3-digit suffix; never overwrite an existing file.
- Include a `## Revision History` section near the bottom of the plan (after `## Additional Task Context`) with a single initial entry:
  ```markdown
   ## Revision History

  ### <today's date> — Initial plan created
  ```

### 6. Offer issue-body push (issue input only)

If the source was a GitHub issue, after writing the file ask:

> "Push the generated plan into issue #N's body via `issue-update N --body-file <path>`?"

Wait for explicit yes. Do not auto-push.

### 7. Report

Brief summary: file path written, phase count, task count, count of inferred-vs-explicit acceptance criteria, source spec location.

## Anti-patterns

- **Skipping the phase-outline approval** — even with a complete spec, scope interpretation can drift. The outline gate is the user's chance to course-correct cheaply.
- **Hiding inferred criteria** — if you guessed at acceptance criteria, label them. The user must be able to tell signal from inference.
- **Omitting the appendix for complex design-derived work** — if the source spec carries substantial design rationale, summarize it in `## Appendix` rather than relying on links only.
- **Overwriting existing plan files** — always pick the next numbered suffix.
- **Auto-pushing to issue body** — same rule as elsewhere: writes to GitHub require explicit confirmation.
- **Running a full discovery interview** — that's `/devenv-create-implementation-plan`'s job. This skill trusts the spec.
- **Generating one oversized plan after a triggered redivision gate** — pause and route through grooming first.

## Sibling skills

- `/devenv-create-roadmap` — if the spec is a Blueprint-*.md, use this first to decompose by component before writing per-step plans.
- `/devenv-create-implementation-plan` — for vague or incomplete starting material; runs a full interview.
- `/devenv-refine-implementation-plan` — for revising an existing plan after discovery.
- `/devenv-plan-update` — for small surgical edits to an existing plan.
- `/devenv-plan-status` — for read-only progress reports.

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
