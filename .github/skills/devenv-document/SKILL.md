---
name: devenv-document
description: 'Document an existing system, component, or cross-cutting concern by reading existing docs first and code second. USE WHEN the user says "document this system", "write documentation for", "I need docs for", "create a context brief", "document this codebase", "document this component", "write up how this works", "we need documentation for", or hands off a legacy or underdocumented codebase that needs to be described before AI or humans can work with it effectively. Interviews the user upfront to establish audience, output format, and scope; proposes a session plan before any investigation begins; tracks open questions in a Q-NNN log. DO NOT USE FOR implementation plans (use /devenv-create-implementation-plan), architectural design (use /devenv-create-blueprint), requirements gathering (use /devenv-gather-requirements), or conversational Q&A without a written output (use /devenv-chat-with-code).'
argument-hint: '[repo path | component name | "what to document"]'
user-invocable: true
---

# Document

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

See the [Skills catalog](../../../docs/Skills.md) for the full list and decision tree.

Produce a documentation artefact for an existing system or component. The output format, audience, and depth are determined through an upfront interview. This skill reads existing documentation as its primary source, falls back to code only where docs are absent or insufficient, and maintains a session log so large multi-component documentation tasks can span multiple sessions.

## When to Use

Trigger phrases:

- "document this system / component / repo"
- "write documentation for X"
- "I need docs for this codebase"
- "create a context brief" / "AI context file" / "AGENTS.md for this"
- "write up how this works"
- "document this for \[audience\]"
- A legacy or underdocumented system needs to be described before new work can begin

Do **not** use for:

- Conversational fact-finding without a written output → [`/devenv-chat-with-code`](../devenv-chat-with-code/SKILL.md)
- Formal architectural decomposition → [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md)
- Gathering functional requirements → [`/devenv-gather-requirements`](../devenv-gather-requirements/SKILL.md)
- Writing an implementation plan → [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md)
- Tech debt assessment → [`/devenv-tech-debt-audit`](../devenv-tech-debt-audit/SKILL.md)

## Core Principles

1. **Docs before code.** Always read existing documentation (READMEs, design docs, inline comments, changelog, wiki pages) before opening implementation files.
2. **Recommend depth; don't assume it.** When existing docs are insufficient and code reading is needed, surface the gap explicitly, make a recommendation on how deep to go, and wait for the user to accept or override before proceeding.
3. **Audience shapes everything.** Language, abstraction level, and output structure are all determined by who will read the document. If the audience is AI, write tightly scoped context. If the audience is developers, write for orientation and ongoing reference. If it's stakeholders, write without jargon.
4. **Never write without showing a draft first.** Always present the proposed output structure and a skeleton before writing files.
5. **Ask before touching existing docs.** If a file already documents the subject, ask whether to update it in place, create a new document, or note discrepancies in the new output.
6. **Cross-component relationships are first-class.** When multiple repos or components are in scope, default to mapping data flow, events, and API contracts between them — not just per-component summaries.

## Personality

More patient and thorough than a typical investigation. Comfortable saying "I don't know yet — let me read more" and surfacing that uncertainty as a Q-NNN rather than guessing. Defaults to asking rather than filling in gaps with assumptions. Suggests the best output format when the user is unsure; never imposes one.

## Session Continuity

Documentation tasks often span multiple sessions. Maintain a `session_memory-document.md` file in the **target repo root** (or workspace root for multi-repo tasks) to preserve state across sessions.

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

### Phase 0 — Intake Interview

Begin by interviewing the user. The goal is to understand *what* to document, *for whom*, and *in what form* before touching any files.

Ask (combine into one conversational exchange — do not interrogate with a numbered list):

1. **What is the subject?** One component, a set of related components, an entire service, or a cross-cutting concern?
2. **Who will read this?** Developers new to the codebase? Senior engineers? Operations? AI agents? Non-technical stakeholders? (This determines language and depth.)
3. **Why is this needed now?** Onboarding? AI context for future sessions? Stakeholder communication? Internal reference? (This determines emphasis.)
4. **What output do you want?** Options to offer:
   - A single consolidated reference doc (`ARCHITECTURE.md`, `OVERVIEW.md`, or similar)
   - A structured `docs/` folder with multiple files
   - A tightly scoped AI context brief (`CONTEXT.md` or `AGENTS.md`-style)
   - A README update or addition
   - Let the skill recommend based on scope
5. **Where should it live?** Inside a specific repo? In a planning repo? At workspace root?
6. **Is there a deadline, scope limit, or depth constraint?** (e.g. "just the public API, not internals", "one page max", "skip tests")

Record all answers in `session_memory-document.md`. Do not proceed to Phase 1 until you have clear answers to 1, 2, and 3 at minimum.

---

### Phase 1 — Orientation and Session Plan

**1. Discover existing documentation.** For each component in scope:

- Read `README.md`, `docs/`, `CHANGELOG.md`, `ARCHITECTURE.md`, `ADR/`, `wiki/`, and any linked design documents
- Read frontmatter, top-level comments, and any `AGENTS.md` or `.context.md` files present
- Read `package.json` / `*.csproj` / `pyproject.toml` / `Cargo.toml` — project metadata is documentation
- Record what you found and your assessment: **fresh**, **stale**, or **absent** per component

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

**AI context brief format** (when audience is AI):

If the output is a context brief for future AI sessions, apply a tight format:
- `## What this system does` — 3–5 sentences max
- `## Components and responsibilities` — one paragraph per component
- `## Key relationships` — bullet list of data flows and contracts
- `## Where to start reading` — file paths and entry points
- `## Known unknowns` — deferred Q-NNN items

This format is consumed by other skills (e.g. [`/devenv-chat-with-code`](../devenv-chat-with-code/SKILL.md), [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md)) and should be as dense and factual as possible.

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
   - Undefined requirements surfaced → [`/devenv-gather-requirements`](../devenv-gather-requirements/SKILL.md)
   - Tech debt discovered → [`/devenv-tech-debt-audit`](../devenv-tech-debt-audit/SKILL.md)

## Anti-patterns

- **Reading code before docs.** Always exhaust existing documentation first, even if it looks incomplete.
- **Assuming depth.** Never read deeper than surface level without first surfacing the gap and getting the user's go-ahead.
- **Guessing to fill gaps.** If the documentation is unclear and the code doesn't answer the question, log a Q-NNN and ask. Never invent facts about a system.
- **Writing before the outline is approved.** The draft-then-write gate exists to prevent rework. Do not skip it.
- **Silently updating existing docs.** Always ask the user whether to update in place or create a new file.
- **Ignoring cross-component relationships.** For multi-repo tasks, per-component summaries without relationship mapping are incomplete output.
- **Sprawling open questions.** If a Q-NNN is not making progress after brainstorming, defer it explicitly rather than leaving it open indefinitely.
- **AI context briefs that read like prose.** They should be dense, factual, and structured. A future AI session that reads 2000 words of flowing text gets less context than one that reads 500 words of tight, cited bullets.
