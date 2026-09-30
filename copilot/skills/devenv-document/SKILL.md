---
name: devenv-document
description: 'Bootstrap or refresh a repo''s documentation family — the docs/Architecture_and_implementation.md + Usage_guide.md pair and the thin AGENTS.md dispatcher — so AI sessions and humans can find and load the repo''s context by convention. USE WHEN the user says "document this repo", "bootstrap docs for", "create the docs family", "add an AGENTS.md", "refresh the docs", "write up how this works", or hands off a new or underdocumented repo that needs its docs brought into the fold. Also handles the heavier case: documenting a legacy or underdocumented system where a real investigation (multi-session, open-questions log) is warranted. Default shape follows the workspace docs-family convention; every output is draft-first (outline approved before any file is written). DO NOT USE FOR read-only session warm-up (use /devenv-load), conversational Q&A with no written output (use /devenv-chat), planning a larger docs overhaul as execution work (use /devenv-plan), architectural decomposition (use /devenv-create-blueprint), or specs authoring (use /devenv-write-specifications).'
argument-hint: '[repo path | component name | "what to document"]'
user-invocable: true
---

# Document

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`.

> **Skill feedback:** If nothing is wrong but the user asks how the skill could be improved, follow the shared [Skill Feedback Protocol](../common/references/skill-feedback-protocol.md) to write `IMPROVEMENT_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`. Zero findings is a valid result; never offer unprompted.

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.

Produce a documentation artefact for an existing system or component. The output format, audience, and depth are determined through an upfront interview. This skill reads existing documentation as its primary source, falls back to code only where docs are absent or insufficient, and maintains a session log so large multi-component documentation tasks can span multiple sessions.

## When to Use

Trigger phrases:

- "document this repo" / "bootstrap docs for this repo"
- "create the docs family" / "refresh the docs" — the `docs/Architecture_and_implementation.md` + `Usage_guide.md` pair
- "add an AGENTS.md" — the thin AI/human dispatcher file at repo root
- "write up how this works"
- A new or underdocumented repo needs its documentation brought into the fold
- A legacy system needs a real investigation (docs absent or badly stale — the multi-session machinery below)

Do **not** use for:

- Read-only session warm-up → [`/devenv-load`](../devenv-load/SKILL.md) (load orients and writes nothing; this skill authors durable files)
- Conversational fact-finding without a written output → [`/devenv-chat`](../devenv-chat/SKILL.md)
- A docs overhaul large enough to be execution work (multi-repo, phased, needs review rounds) → plan it via [`/devenv-plan`](../devenv-plan/SKILL.md) — this skill is the docs-execution specialist for single-repo bootstrap/refresh
- Formal architectural decomposition → [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md)
- Authoring functional specifications → [`/devenv-write-specifications`](../devenv-write-specifications/SKILL.md)
- Tech debt assessment → [`/devenv-audit`](../devenv-audit/SKILL.md)

## Core Principles

1. **The family convention is the default shape.** This workspace's repos carry a de facto docs family: `docs/Architecture_and_implementation.md` (purpose, package structure, architecture, request lifecycle, component detail, interface contracts, design decisions, test architecture, extension points — the authoritative reference, written to be loaded as context by humans and AI agents) plus `docs/Usage_guide.md` (how callers consume it: call patterns, endpoint reference, worked examples, shapes). Unless the user says otherwise, bootstrap produces exactly this pair; refresh brings an existing family back to parity with the code. Do not invent a novel structure per repo.
2. **AGENTS.md is a thin dispatcher, never a second docs layer.** The repo-root `AGENTS.md` exists so standard AI-tool discovery (and this workspace's own skills — plan, load, chat — which all read it "if present") finds the repo's context: build/test/lint commands, one-line layout, and pointers into the docs family. Target ~30 lines. It duplicates nothing — it routes.
3. **Docs before code; depth is a decision.** Exhaust existing documentation first. When a gap needs code reading, state the question, recommend surface/medium/deep, and get approval for medium-or-deeper.
4. **Draft-first, always.** Present the proposed structure as a skeleton before writing any file. Existing file touched → ask: update in place or new document.
5. **Never guess.** Unclear system facts become logged Q-NNN questions, answered by the user or deferred — never invented.
6. **Cross-component relationships are first-class.** Multi-repo scope means mapping data flow, contracts, and coupling — not per-component summaries.
7. **Match the exemplars.** When unsure about shape or depth, read an existing family member (e.g. `repos/<exemplar-repo>/docs/`) and match its register: fact-dense, cited, no prose padding.

The heavier legacy-system case (docs absent/stale and the system genuinely needs a multi-session investigation) keeps the full machinery below — session plans, Q-NNN open-questions log, depth gates. The common bootstrap/refresh case runs the same phases in compressed form: Phase 0 shrinks to confirming scope + family assessment, Phase 1 is the discovery sweep, Phases 4–5 are the draft-first write.

## Personality

More patient and thorough than a typical investigation. Comfortable saying "I don't know yet — let me read more" and surfacing that uncertainty as a Q-NNN rather than guessing. Defaults to asking rather than filling in gaps with assumptions. Suggests the best output format when the user is unsure; never imposes one.

## Session Continuity

Documentation tasks often span multiple sessions. Maintain a `session_memory-document.md` file in the target repo's `.local-artifacts/` folder (workspace root's `.local-artifacts/` for multi-repo tasks) — see the [standard local markdown folder](../_conventions.md#standard-local-markdown-folder-local-artifacts).

**At session start:** create it if it doesn't exist, or load and summarise it to the user if it does.

Track:
- Scope decided in Phase 0 (components, audience, output format, output location)
- Session plan and which components have been covered
- **Open questions log** — tracked as `Q-001`, `Q-002`, etc. (see format below)
- Key discoveries that changed the understanding of the system
- Existing docs found and their assessed quality (fresh / stale / absent)
- Revision notes (if this is a follow-on session)

**Open questions log format** (record in `session_memory-document.md`):

```
Q-001 | open | How does X communicate with Y? — no docs found, code unclear | Affects: [COMPONENT-A, COMPONENT-B]
Q-002 | resolved | What triggers the migration step? | Resolution: controlled by a feature flag (see src/config.ts:14)
Q-003 | deferred | What is the intended production deployment topology? | User: "we'll document this later"
```

Status values: `open` → `brainstorming` → `resolved` / `deferred`

Every Q-NNN must reach `resolved` or `deferred` before writing the final output. Never silently drop an open question.

## Procedure

### Phase 0 — Intake (compressed for the common case)

**First, classify the run** — this decides how much ceremony applies:

- **Bootstrap** (no docs family, or an `AGENTS.md`-only gap) → default shape applies: the family pair per Core Principle 1, plus the thin `AGENTS.md` dispatcher per Principle 2. Interview shrinks to three confirmations: scope (whole repo or a component), any known stale areas, and whether the repo already has partial docs to preserve. Present the skeleton (Phase 4) early — bootstrap usually needs no code reading beyond surface orientation.
- **Refresh** (family exists but drifted from the code) → discovery sweep first, present the drift list (sections stale/missing/contradicted), get the fix list approved, then write in place per the update rules.
- **Legacy investigation** (docs absent AND the system is genuinely complex, or the user asks for a deep write-up) → full interview below, session plan, Q-NNN machinery, multi-session if needed.

For legacy runs, interview the user (one conversational exchange, not a numbered interrogation):

1. **What is the subject?** One component, related components, an entire service, or a cross-cutting concern?
2. **Who will read this?** Developers? AI agents? Operations? Stakeholders? (Language and depth.)
3. **Why now?** Onboarding? AI context? Reference? (Emphasis.)
4. **What output?** Default: the docs family (Principle 1). Alternatives when the family doesn't fit: single consolidated doc, README addition, AI context brief.
5. **Where does it live?** The repo itself (default), or elsewhere for cross-repo scope.
6. **Scope limits?** ("public API only", "one page", "skip internals")

Record answers in `session_memory-document.md`. Do not proceed until scope, audience, and purpose are clear.

---

### Phase 1 — Orientation and Session Plan

**1. Discover existing documentation.** For each component in scope:

- Read `README.md`, `docs/` (especially any existing `Architecture_and_implementation.md` / `Usage_guide.md`), `CHANGELOG.md`, `ARCHITECTURE.md`, `ADR/`, and any linked design documents
- Read any `AGENTS.md` / `copilot-instructions.md` — note whether the dispatcher exists, and whether it points at the docs family
- Read `package.json` / `*.csproj` / `pyproject.toml` / `Cargo.toml` — project metadata is documentation
- Record what you found and your assessment: **fresh**, **stale**, or **absent** per component — and for the family pair specifically, whether each section still matches the code

**2. Identify gaps.** For each component, note what is undocumented or where docs contradict what you observed. Log these as `Q-NNN` entries.

**3. Assess code reading needs.** For each gap:
- State the specific question that requires code reading
- Recommend a depth level: **surface** (entry points, exports, folder structure only), **medium** (key implementation files, config, tests), or **deep** (follow call chains as needed)
- Flag your reasoning: e.g. "surface is enough to document the API contract; no need to read internals"

**4. Propose the session plan.** Present to the user:

```
## Proposed session plan

### Scope confirmed
[List of components / repos]

### Output format
[Single doc / docs folder / AI context brief / etc.]
[Proposed filename and location]

### What I found
[Per-component: docs quality + key gaps]

### What I need to investigate further
[Per-component: specific questions + recommended depth]

### Session structure
Session 1: [Component A — orientation + gap fill]
Session 2: [Component B + cross-component relationships]
Session N: [Draft + review]

### Gate level
[Proposed checkpoints — e.g. "one approval gate after outline, then write"]
```

Wait for the user to approve, adjust, or reject the plan before proceeding. Do not start reading code until approved.

---

### Phase 2 — Investigation

Work through the approved plan component by component.

**For each component:**

1. Read existing docs first. Summarise what they tell you.
2. Identify what is still unclear. Log as Q-NNN.
3. If code reading was approved for this component, read at the agreed depth. Surface new Q-NNNs as you go — do not guess.
4. After finishing a component, give the user a brief status report:
   - What you now understand
   - What is still unclear (open Q-NNN items)
   - Whether you recommend changing depth for remaining components

**Cross-component pass** (when multiple repos are in scope):

After per-component passes, explicitly investigate the *relationships* between components:
- Shared data contracts (types, schemas, event envelopes)
- Communication channels (HTTP, message queues, shared storage, direct calls)
- Dependency direction and coupling
- Deployment/operational topology if visible from config

Log any gaps in these relationships as Q-NNN items.

**Do not move to Phase 3 while critical Q-NNN items are open and unresolved.**

---

### Phase 3 — Open Questions Brainstorm

For any Q-NNN that remains open after Phase 2:

1. Restate the question clearly.
2. Offer 2–4 possible answers (with trade-offs or evidence for each).
3. Ask the user to decide.
4. Update the Q-NNN to `resolved` or `deferred` based on their answer.

Never diagnose for the user ("it must be X because..."). Present options; let the human decide.

Once all Q-NNN items are `resolved` or `deferred`, move to Phase 4.

---

### Phase 4 — Draft

Present the proposed documentation structure as a skeleton outline before writing any files:

```
## Proposed documentation structure

### [Output filename]
- Section 1: Overview
  - Purpose and scope
  - Who this document is for
- Section 2: System components
  - [Component A] — one-liner
  - [Component B] — one-liner
- Section 3: How they fit together
  - Data flow
  - Event contracts
- Section 4: Key concepts and terminology
- Section 5: [audience-specific section, e.g. "Getting started" for devs]
- Appendix: Open questions and deferred items
```

Ask the user to approve the structure. They may add, remove, or rename sections. Do not begin writing until approved.

**If an existing file will be updated:** show the user which file, what will change, and ask explicitly whether to update in place or create a new document.

---

### Phase 5 — Write

Write the documentation according to the approved skeleton.

Rules:
- Stay within the agreed scope and audience
- Use the audience's natural language — technical for engineers, plain for stakeholders, terse and fact-dense for AI
- Cite sources inline where helpful (`<!-- Source: src/foo.ts:42 -->` or a brief parenthetical)
- Mark deferred Q-NNN items clearly: `> ⚠️ **Open question (Q-NNN):** [question text — deferred to a later session]`
- Do not write files until the user has approved the outline
- If writing multiple files, write one at a time and pause for confirmation before proceeding to the next

**AI context brief format** (when the output is a standalone brief rather than the family):

- `## What this system does` — 3–5 sentences max
- `## Components and responsibilities` — one paragraph per component
- `## Key relationships` — bullet list of data flows and contracts
- `## Where to start reading` — file paths and entry points
- `## Known unknowns` — deferred Q-NNN items

This format is consumed by other skills (e.g. [`/devenv-chat`](../devenv-chat/SKILL.md), [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md)) and should be as dense and factual as possible.

**AGENTS.md dispatcher format** (the thin file — Principle 2):

```markdown
# AGENTS.md — <repo name>

One line: what this repo is.

## Commands
- Build: <command>
- Test: <command>
- Lint/format: <command>

## Layout
- `src/<...>` — <one line>
- `tests/<...>` — <one line>

## Repo context
Read `docs/Architecture_and_implementation.md` for the authoritative system
reference (purpose, architecture, contracts, design decisions) and
`docs/Usage_guide.md` for caller-facing usage. Load them at session start when
working on this repo.
```

Rules for the dispatcher: it points, it never duplicates — system facts live in the family, commands live here; keep it under ~30 lines; regenerate it whenever build commands or layout change. `copilot-instructions.md` (when a repo has one) is the *workspace-skills* conventions file and stays separate — AGENTS.md is the general AI-tooling entry point.

---

### Phase 6 — Wrap-up

After writing:

1. Update `session_memory-document.md`: mark completed components, record key decisions, note deferred Q-NNN items.
2. Give the user a brief summary:
   - What was produced (file path(s))
   - What was not covered (deferred scope, unresolved open questions)
   - Suggested next steps
3. Suggest follow-on skills if natural:
   - Architecture gaps visible in the docs → [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md)
   - Undefined specifications surfaced → [`/devenv-write-specifications`](../devenv-write-specifications/SKILL.md)
   - Tech debt discovered → [`/devenv-audit`](../devenv-audit/SKILL.md)

## Anti-patterns

- **Reading code before docs.** Always exhaust existing documentation first, even if it looks incomplete.
- **Inventing a novel structure per repo.** The docs family and the thin AGENTS.md dispatcher are conventions; deviate only when the user explicitly asks.
- **Duplicating content between AGENTS.md and the docs family.** The dispatcher points; the family carries the facts. An AGENTS.md that restates architecture is a maintenance liability.
- **Assuming depth.** Never read deeper than surface level without first surfacing the gap and getting the user's go-ahead.
- **Guessing to fill gaps.** If the documentation is unclear and the code doesn't answer the question, log a Q-NNN and ask. Never invent facts about a system.
- **Writing before the outline is approved.** The draft-then-write gate exists to prevent rework. Do not skip it.
- **Silently updating existing docs.** Always ask the user whether to update in place or create a new file.
- **Ignoring cross-component relationships.** For multi-repo tasks, per-component summaries without relationship mapping are incomplete output.
- **Sprawling open questions.** If a Q-NNN is not making progress after brainstorming, defer it explicitly rather than leaving it open indefinitely.
- **AI context briefs that read like prose.** They should be dense, factual, and structured. A future AI session that reads 2000 words of flowing text gets less context than one that reads 500 words of tight, cited bullets.
