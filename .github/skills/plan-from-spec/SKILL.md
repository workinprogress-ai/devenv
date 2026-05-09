---
name: plan-from-spec
description: Generate an Implementation_plan-*.md from an existing design doc, RFC, GitHub issue, URL, or pasted spec text — without the discovery interview that `/create-implementation-plan` runs. USE WHEN the user says "turn this spec into a plan", "make a plan from this RFC", "plan from this design doc", "convert this issue body into a plan", or hands off a complete-looking spec and asks for a plan. Auto-detects input type (file path, GitHub issue number, URL, or inline text), shows a proposed phase outline for approval before writing the full plan, infers acceptance criteria from goals when not explicit, and writes the plan to the target repo root using the same numbered-suffix filename convention as `/create-implementation-plan`. DO NOT USE for vague or incomplete ideas (use `/create-implementation-plan` for the full discovery interview), for revising an existing plan (use `/refine-implementation-plan`), or for small edits to an existing plan (use `/plan-update`).
argument-hint: File path, GitHub issue number, URL, or pasted spec text containing the source spec
---

# Plan from spec

Convert an existing spec — design doc, RFC, GitHub issue body, URL, or pasted text — into an `Implementation_plan-*.md` without running the full discovery interview that `/create-implementation-plan` requires.

## When to use this skill

- A spec already exists and is reasonably complete (goals stated, scope clear).
- The user wants a plan derived from that spec, not from a brainstorm.
- The spec lives in any of: a markdown file, a GitHub issue body, a remote URL, or pasted text.

If the spec is vague or incomplete, redirect to `/create-implementation-plan` (which interviews the user to fill the gaps).

## Inputs

The user provides exactly one of:

- **A file path** — e.g. `docs/design/feature-x.md`. Read directly.
- **A GitHub issue number** — e.g. `42`. Fetch the body via `tools/issue-get N --pretty`.
- **A URL** — e.g. `https://example.com/rfc.html`. Fetch via `fetch_webpage`.
- **Inline text** — pasted directly in the conversation.

**Auto-detection rules:**

- `^[0-9]+$` → issue number
- `^https?://` → URL
- File exists at the given path → file
- Multiple lines of prose with no other match → inline text
- Ambiguous → ask which the user meant.

## Workflow

### 1. Load the spec

- Resolve the input per the rules above.
- For URL input, prefer `fetch_webpage` with a query that pulls structure-relevant content (goals, requirements, acceptance criteria).
- Strip obvious non-spec content (navigation, footers).

### 2. Extract structure

Identify, where present:

- **Title / one-line summary**
- **Goals** (what the work achieves)
- **Non-goals** (what's explicitly out of scope)
- **Acceptance criteria** (explicit "must", "should", numbered requirements, given/when/then blocks)
- **Risks / open questions**
- **Dependencies on other work or systems**

If acceptance criteria are not explicit, **infer** them from the goals and any "must"/"should" statements. Mark each inferred criterion clearly so the user knows it wasn't lifted verbatim.

### 3. Propose a phase outline (approval gate)

Before writing the full plan, present just the phase headings and a one-line summary of each:

```markdown
Proposed phase outline for the plan:

1. Phase 1 — Discovery & test scaffolding
   Set up failing tests for each acceptance criterion before any production code.
2. Phase 2 — Core data model
   ...
3. Phase 3 — API surface
   ...
4. Phase 4 — Integration & wiring
   ...
5. Phase 5 — Cleanup & docs

OK to proceed with full task breakdown? (yes / adjust phases / cancel)
```

Use `vscode_askQuestions`. Wait for explicit approval before writing the file.

### 4. Generate the full plan

Use the same template as `/create-implementation-plan`:

- Phase 1 is **always Discovery + test scaffolding** (write failing tests for each acceptance criterion).
- Last phase is **always Cleanup & docs**.
- Tasks numbered `N.M` per phase. Each task: short imperative title, 1–2 sentence description, optional `depends on N.M` line.
- Include a top-level `## Source spec` metadata block with the resolved spec location (file path, issue URL, fetched URL, or "inline text"), so the generated plan is traceable to its origin.
- Include a `## Acceptance criteria` section listing each criterion (explicit and inferred, marked).

### 5. Write the file

- Target location: same convention as `/create-implementation-plan`:
  - Issue input → `Implementation_plan-issue-N-NNN.md` at the target repo root.
  - All other inputs → `Implementation_plan-NNN.md` at the target repo root (or workspace root if no clear target repo).
- `NNN` is the next unused 3-digit suffix; never overwrite an existing file.

### 6. Offer issue-body push (issue input only)

If the source was a GitHub issue, after writing the file ask:

> "Push the generated plan into issue #N's body via `tools/issue-update N --body-file <path>`?"

Wait for explicit yes. Do not auto-push.

### 7. Report

Brief summary: file path written, phase count, task count, count of inferred-vs-explicit acceptance criteria, source spec location.

## Anti-patterns

- **Skipping the phase-outline approval** — even with a complete spec, scope interpretation can drift. The outline gate is the user's chance to course-correct cheaply.
- **Hiding inferred criteria** — if you guessed at acceptance criteria, label them. The user must be able to tell signal from inference.
- **Overwriting existing plan files** — always pick the next numbered suffix.
- **Auto-pushing to issue body** — same rule as elsewhere: writes to GitHub require explicit confirmation.
- **Running a full discovery interview** — that's `/create-implementation-plan`'s job. This skill trusts the spec.

## Sibling skills

- `/create-implementation-plan` — for vague or incomplete starting material; runs a full interview.
- `/refine-implementation-plan` — for revising an existing plan after discovery.
- `/plan-update` — for small surgical edits to an existing plan.
- `/plan-status` — for read-only progress reports.

See the [Skills catalog](../../docs/Skills.md) for the full list and decision tree.
