---
name: devenv-gather-requirements
description: 'Conduct a structured three-phase requirements interview to produce a user-oriented requirements document. USE WHEN the user says "gather requirements", "write up requirements", "define the requirements for", "capture requirements", "what should the system do", "requirements document", "interview me for requirements", or hands off a system idea that needs functional definition before planning begins. Produces a Requirements-<topic>-NNN.md covering system vision, concrete acceptance-criteria-bearing requirements with IDs and dependency graph, and stakeholder priority groupings (not a delivery roadmap — use /devenv-create-roadmap for that). Maintains a session_memory-requirements.md across sessions. DO NOT USE when requirements already exist (use /devenv-plan-from-spec or /devenv-create-implementation-plan), for quick feature clarifications that don''t warrant a formal document, or for code generation.'
argument-hint: '[system name | path-to-existing-notes | GitHub issue number]'
user-invocable: true
---

# Gather Requirements

Produce a user-oriented, functional requirements document through a structured interview. The output describes *what* the system does — not how it does it — at a level both humans and AI can use to drive planning and implementation.

## When to Use

Trigger phrases:

- "gather requirements" / "requirements document" / "define the requirements"
- "what should the system do?" / "write up requirements for X"
- "interview me for requirements" / "help me capture requirements"
- A system idea is handed off before any planning has begun

Do **not** use for:

- Requirements already exist → [`/devenv-plan-from-spec`](../devenv-plan-from-spec/SKILL.md) or [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md)
- Quick inline feature clarification — just ask the user directly
- Code or implementation planning

## Philosophy

- **Think like a user, not an engineer.** Requirements describe behaviors and outcomes, not architectures or technologies.
- **Concrete beats abstract.** Every requirement should be specific enough that two independent teams would build recognizably similar things from it.
- **Completeness over speed.** Missing requirements cost far more to discover in implementation than to find here. Probe for gaps, edge cases, and the unhappy path.
- **The human owns the vision.** You structure and challenge; the stakeholder decides what the system does.
- **Iterate relentlessly.** Each phase refines understanding. Going back is expected, not a failure.

## Session Continuity

Requirements gathering can span multiple sessions. Maintain a `session_memory-requirements.md` file in the **target repo root** to preserve state across sessions.

**At session start**: create it if it doesn't exist, or load and summarise it to the user if it does.

Track:
- Current phase and what has been completed
- Key decisions the human made
- Open questions not yet resolved
- Assumptions being treated as true
- Gaps identified in the vision or requirements
- Revision notes between cycles

**At session end**: update it with the current state.

**When requirements are complete and approved**: offer to delete it. Do not merge it to the main branch.

## Output File

Produce a `Requirements-<topic>-NNN.md` file where:
- `<topic>` is a short kebab-case name agreed with the user (e.g. `search`, `user-management`, `billing`)
- `NNN` is a zero-padded numeric suffix (`001`, `002`, …) so multiple documents for the same topic can coexist

**Location:**
- If the target repo name starts with `planning.` → write to `docs/Requirements/` (create the folder if needed)
- Otherwise → ask the user where to put it

See [requirements-template.md](./references/requirements-template.md) for the full document structure.

Do not write the file until Phase 3 is approved. During the session, work in chat and update `session_memory-requirements.md`.

### Multi-document projects (one doc per epic)

A single requirements doc is the right default. For large initiatives — multiple distinct epics, multiple stakeholder groups, or a system whose scope outgrows one document — split into one `Requirements-<epic>-NNN.md` per epic.

**When to split:**
- The vision section starts describing two largely independent capabilities
- Different stakeholder groups own different parts and would prioritise them independently
- The doc is heading past ~30 requirements or ~3 distinct functional areas
- The user explicitly frames the work as "Epic 1", "Epic 2", etc.

**Conventions when splitting:**
- One `<topic>` per epic, e.g. `Requirements-orders-001.md`, `Requirements-fulfillment-001.md`, `Requirements-returns-001.md`
- **Use category-prefix IDs unique per epic** (`ORD-NNN`, `FUL-NNN`, `RET-NNN`) so requirement IDs are globally unique across the project. Agree the prefix list with the user before writing any doc.
- Each doc has its own `session_memory-requirements-<topic>.md` during gathering, allowing parallel work on different epics without state collision.
- **Cross-document dependencies are explicit.** A requirement in one doc can declare a dependency on a requirement in another doc using the form:

  ```
  Depends on: AUTH-003 (Requirements-auth-001.md)
  ```

  In-doc dependencies stay bare (`Depends on: ORD-002`).
- Each doc has its own `GROUP-NN` priority groups, scoped to that epic. There is no project-wide priority grouping at the requirements layer — cross-epic sequencing is the roadmap's job, see [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md).

**Process for a multi-doc project:**
1. In Phase 1, agree the epic split and the prefix-per-epic scheme up front, in chat. Record the split in each `session_memory-requirements-<topic>.md`.
2. Run the full three-phase process per epic doc. The same skill invocation completes one doc at a time — do not interleave.
3. When all epic docs are complete, hand them all to [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md) in a single invocation — it accepts multiple requirements paths and produces one roadmap (one parent epic) spanning them.
4. **Produce an `Index.md`** alongside the epic docs (see *Index.md for multi-file artifacts* below). The Index is the canonical entry point — link to it from blueprints, roadmaps, and parent epics, not to individual epic docs.

### Index.md for multi-file artifacts

Whenever a multi-doc project produces more than one `Requirements-<epic>-NNN.md`, produce an `Index.md` alongside them at `docs/Requirements/Index.md` (or wherever the docs live).

Structure:

```markdown
# Requirements: <project name> — Index

> Multi-document project. Each epic has its own requirements doc with its own ID prefix.
> Use this index as the canonical entry point.

## Epics

| Doc | Prefix | Scope |
|---|---|---|
| [Requirements-orders-001.md](Requirements-orders-001.md) | `ORD-NNN` | Order placement, modification, cancellation |
| [Requirements-fulfillment-001.md](Requirements-fulfillment-001.md) | `FUL-NNN` | Pick, pack, ship, track |
| [Requirements-returns-001.md](Requirements-returns-001.md) | `RET-NNN` | Customer-initiated returns and refunds |

## Cross-doc dependencies

- `FUL-003` depends on `ORD-007` (Requirements-orders-001.md)
- `RET-002` depends on `ORD-005` (Requirements-orders-001.md)
- `RET-004` depends on `FUL-009` (Requirements-fulfillment-001.md)

## Stakeholder priority across epics

Each doc has its own `GROUP-NN` priority groups, scoped to that epic. Cross-epic sequencing is the roadmap's job (see [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md)). If stakeholders have an explicit cross-epic ordering preference, capture it here as plain prose:

> Stakeholder priority: orders MVP → fulfillment MVP → returns MVP, then post-launch hardening across all three.

## Revision history

Each doc maintains its own `## Revision History`. Recent project-wide events:

- 2026-05-13 — Added `Requirements-returns-001.md`
- 2026-05-10 — Initial multi-doc structure (split from `Requirements-orders-001.md`)
```

Key rules:
- The Index is **navigation, not content** — do not duplicate requirements text from the epic docs
- Update the cross-doc dependencies section whenever a cross-doc `Depends on:` edge is added or removed
- If the project started as a single doc and was later split, record the split as the first revision-history entry on the Index

## Process

This is a three-phase process. **Stop at each checkpoint** and wait for explicit approval before proceeding.

---

### Phase 1: System Vision

**Goal:** Produce a clear narrative description of the system — its purpose, its actors, and how they experience it.

#### Step 1: Understand the problem space

**If the user provides existing documents** (product briefs, notes, diagrams):
- Read them and summarise your understanding back to the human
- Identify gaps and ambiguities, then ask targeted fill-in questions — don't re-interview from scratch

**Ask about human communications.** Before starting cold, ask:

> "Are there meeting transcripts, email threads, Slack/Teams exports, recordings, voice memos, or other communications records that contain relevant context? If so, where are they?"

If the user provides any:

1. **Summarise each one separately.** Prefer dispatching the `Explore` subagent (one invocation per artifact, in parallel where possible) with a prompt like *"Read FILE and produce a structured summary covering: stated goals, decisions reached, open questions, named actors, constraints mentioned, and any concrete behaviours described. Quote verbatim where wording matters."* This keeps the main conversation uncluttered.
2. **Surface each summary back to the user** before extracting requirements. Ask: *"Does this summary match what you remember? Anything mischaracterised?"*
3. **Extract requirements material from the approved summaries** — actors, scenarios, constraints, scope hints, explicit asks. Treat these as starting material, not as final requirements; the interview still validates them.
4. **Cite the source.** When a requirement traces back to a communication, note it in `session_memory-requirements.md` (e.g. "REQ-007 derived from 2026-04-12 standup transcript"). Do not embed verbatim quotes from communications in the final requirements file unless the user wants them — references are typically enough.

**Otherwise, start with:**
1. "What problem does this system solve? Who has this problem today?"
2. "What does success look like? If this system works perfectly, what's different?"
3. "Who are the main actors — the people or systems that interact with this?"

**Then probe deeper:**
- "Walk me through a day in the life of [actor]. How do they interact with the system?"
- "What's the most important thing the system does? If it only did one thing well, what would that be?"
- "What's explicitly out of scope? What should this system NOT do?"
- "Are there existing systems this replaces or integrates with?"
- "What are the hard constraints? (regulatory, performance, security, budget, timeline)"

#### Step 2: Identify actors and their goals

For each actor: who they are, their goals, their experience expectations, and their current pain points.

Push beyond the obvious — ask about admin users, support staff, automated systems, configuration/maintenance roles, output consumers, and external parties (partners, regulators, auditors).

#### Step 3: Develop usage scenarios

Create 3–5 concrete narrative walkthroughs showing how specific actors accomplish specific goals. Include decision points, variations, and what happens when things go wrong. Stay at the user experience level, not the implementation level.

After drafting each scenario, ask: "Does this match how you envision it? What did I get wrong or miss?"

#### Step 4: Establish scope and constraints

Document explicitly:
- **In scope** / **Out of scope** (with rationale for out-of-scope items)
- **Constraints:** performance, security, compliance, scale, integrations, timeline
- **Assumptions:** things being treated as given that may not be true

#### Phase 1 Checkpoint

**STOP.** Present the Section 1 (Vision) draft. Say:

> "Here is the system vision based on our conversation. Please review:
> - Does this accurately capture what you want the system to do?
> - Are the actors and their goals correct?
> - Do the scenarios match your expectations?
> - Is anything missing from the scope or constraints?
>
> Edit as needed. When satisfied, tell me to proceed to Phase 2."

Do not proceed until the human explicitly approves or provides corrections.

---

### Phase 2: Concrete Requirements

**Goal:** Break the vision into specific, acceptance-criteria-bearing, dependency-ordered requirements.

#### Step 1: Agree on ID prefix scheme

For smaller systems with a single requirements doc, `REQ-NNN` is sufficient.

For larger systems with distinct functional areas in **one doc**, use category prefixes (e.g. `AUTH-001`, `ORD-003`).

For **multi-document projects** (one doc per epic), the prefix scheme is mandatory — one prefix per epic doc, agreed up front in Phase 1 (see *Multi-document projects* in the Output File section). Do not start Phase 2 until the prefix list is recorded in `session_memory-requirements-<topic>.md`.

#### Step 2: Derive requirements from the vision

Work through the vision systematically:
- For each actor/goal pair → what functional capabilities does the system need?
- For each scenario → what specific behaviors are described?
- For each constraint → what requirements does it imply?

Validate as you derive: "I see [scenario] implies the system needs to [capability]. Is that right?"

Ask explicitly: "Are there requirements that aren't implied by the scenarios but are still needed? What about administrative or operational requirements — monitoring, backup, user management?"

#### Step 3: Write individual requirements

Each requirement follows the template:

```markdown
#### REQ-001: [Title]
**Description:** [What the system does, from the user's perspective. No implementation details.]

**Acceptance Criteria:**
- Given [context], when [action], then [outcome]

**Dependencies:** None (or markdown links to other requirement headings)

---
```

**Good vs. bad:**
- Good: "The system displays order status to the customer."
- Bad: "The API returns a JSON payload with order status fields."
- Good: "Search results return within 200ms for queries matching fewer than 10,000 products."
- Bad: "The system shall be fast."

Every requirement ID referenced anywhere in the document must be a **markdown link** to that requirement's section heading.

#### Step 4: Map the dependency graph

After all requirements are drafted:
- Check for circular dependencies (these reveal a requirements problem — resolve them)
- Identify foundational requirements that many others depend on
- Verify the ordering is implementable: can a team start with no-dependency requirements and work forward?

#### Step 5: Check completeness

Before presenting to the human, verify:
- [ ] Every actor from Phase 1 has at least one requirement addressing their goals
- [ ] Every scenario from Phase 1 is covered by one or more requirements
- [ ] Every constraint has corresponding requirements
- [ ] Error cases and edge cases are covered
- [ ] Non-functional requirements are included where they affect behavior (audit logging, access control, data retention, etc.)
- [ ] No requirement violates the out-of-scope boundaries from Phase 1

Then ask: "I've identified [N] requirements across [M] functional areas. Before I present them, is there anything you know is needed that we haven't discussed? What about [specific uncovered area]?"

#### Phase 2 Checkpoint

**STOP.** Present the full requirements list. Say:

> "Here are the concrete requirements derived from the vision. Please review:
> - Are all requirements correct and clearly stated?
> - Are the acceptance criteria specific enough to test against?
> - Are the dependencies accurate?
> - Is anything missing?
>
> Edit, add, remove, or reorder as needed. When satisfied, tell me to proceed to Phase 3."

Do not proceed until the human explicitly approves.

---

### Phase 3: Priority Grouping

**Goal:** Group requirements into stakeholder-priority buckets that capture business sequencing intent. This is **not a delivery roadmap** — it carries no architectural ordering, no component assignments, and no implementation sizing.

> **Important boundary.** Phase 3 produces *priority groups* of requirements (e.g. "GROUP-01: MVP", "GROUP-02: Post-launch hardening"). These reflect the stakeholder's view of what must come first. Actual delivery sequencing — step-by-step, dependency-respecting, component-aware, with GitHub issues — is the job of [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md), which runs *after* a blueprint exists. Each requirement here may later span multiple roadmap steps and multiple `Implementation_plan-*.md` files.

#### Step 1: Identify natural groupings

Ask:
- "Are there business priorities that should drive sequencing? (e.g. 'We need auth before anything else because of compliance')"
- "Are there external deadlines certain requirements must hit?"
- "What's the minimum set that delivers usable value — the MVP?"

Look for requirements that share a stakeholder-visible outcome or belong to a coherent business capability. Do **not** group by component, dependency depth, or technical layering — those are roadmap concerns.

#### Step 2: Define groups

Use IDs `GROUP-01`, `GROUP-02`, etc. (zero-padded). For each group:
- Name and one-line stakeholder rationale, as a linkable heading
- Requirements listed as markdown links to their definitions
- Optional: priority label (`MVP` / `P1` / `P2` / `Later`)

The first group should be the MVP — the smallest set of requirements that delivers usable value. Identify it explicitly.

#### Step 3: Validate

- [ ] Every requirement appears in exactly one group
- [ ] No requirement's dependency sits in a later group (use the Phase 2 dependency graph to check)
- [ ] The MVP group is genuinely minimal

#### Step 4: Add stakeholder guidance

- **MVP rationale:** why these requirements form the minimum viable set
- **Stakeholder priorities:** the business reasons behind the ordering
- **Open priority questions:** trade-offs the stakeholder hasn't decided yet

#### Phase 3 Checkpoint

**STOP.** Present the priority groups. Say:

> "Here are the priority groupings. Please review:
> - Does the prioritisation match stakeholder intent?
> - Is the MVP set truly minimal and useful?
> - Are there business priorities I've misread?
>
> When satisfied, tell me to write the output file."

After approval, write the file per [Output File](#output-file) rules. Offer to delete `session_memory-requirements.md`.

---

## Tips for Success

**During interviewing:**
- Let the human tell the story before you structure it. Don't jump to organising too early.
- If they give you a document, summarise it back and ask what's wrong or missing — don't assume the document is complete.
- Push for concrete scenarios. "How would [actor] do [task]?" is your most powerful question.
- Capture the *why* behind features. Understanding motivation helps identify missing requirements later.

**During requirements:**
- Write requirements that are testable. If you can't imagine how to verify it, it's too vague.
- Don't sneak implementation into requirements. Describe behavior, not mechanism.
- Look for implicit requirements: "real-time updates" implies WebSocket support, notification systems, etc.
- For every "the system does X," ask "what happens when X fails?"

**During roadmap planning:**
- The MVP group should be the smallest set that delivers usable value, not everything.
- Keep groupings stakeholder-facing — if you're talking about components or dependencies, you've slipped into delivery sequencing (which is `/devenv-create-roadmap`'s job).
- Flag priority trade-offs the stakeholder hasn't decided yet as open questions, not as decisions.

## Common Pitfalls

**"This requirement is really an implementation choice"**
- Bad: "The system shall use a message queue for order processing."
- Good: "The system shall process orders asynchronously, ensuring no order is lost even if a component is temporarily unavailable."
- Fix: Ask "Why do you want [technical choice]?" — the answer reveals the real requirement.

**"The requirement is too vague"**
- Bad: "The system shall be fast."
- Good: "Search results shall return within 200ms for queries matching fewer than 10,000 products."
- Fix: Ask "How would you test this? What number would make you happy? What would be unacceptable?"

**"We forgot a whole category"**
- Common misses: error handling, audit logging, access control, data migration, admin tools, reporting, notifications, rate limiting.
- Fix: Run the completeness checklist in Phase 2 Step 5.

**"The dependency graph is a mess"**
- Symptom: circular dependencies, or everything depends on everything.
- Fix: Look for requirements that are actually two combined. Split them. The shared part becomes a foundational requirement.

## Anti-patterns

- Proceeding past a phase checkpoint without explicit human approval.
- Writing implementation details into requirements ("shall use PostgreSQL").
- Skipping the completeness checklist.
- Writing requirements without acceptance criteria.
- Writing the output file before Phase 3 is approved.
- Merging `session_memory-requirements.md` to the main branch.
- Conflating priority groupings (this skill's Phase 3) with a delivery roadmap (`/devenv-create-roadmap`) or an implementation plan (`/devenv-create-implementation-plan`).

## Sibling Skills

This skill produces a requirements document that feeds directly into:
- [`/devenv-refine-requirements`](../devenv-refine-requirements/SKILL.md) — revise the document later when scope shifts or new communications arrive
- [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md) — translate requirements into an architectural blueprint for epic-scale work
- [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md) — produce a real delivery roadmap (after a blueprint exists); supersedes Phase 3's priority groupings for execution purposes
- [`/devenv-plan-from-spec`](../devenv-plan-from-spec/SKILL.md) — generate a detailed implementation plan from a specific requirement or group
- [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md) — interview-driven planning for a specific requirement or group

## Companion Tooling

This skill produces the requirements document but **does not create GitHub issues**. To create issues from the approved doc, run [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md):

- **Epic-scale work** — first run [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md), then `/devenv-create-roadmap` with both the blueprint and requirements as input. The roadmap creates the parent epic + per-step child issues across component repos.
- **Smaller work that doesn't warrant a blueprint** — run `/devenv-create-roadmap` with just the requirements doc. It supports a requirements-only mode that asks for the target component per step and creates the issues from there.

Going through `/devenv-create-roadmap` (rather than creating issues by hand) keeps the roadmap as the single source of truth for what's been issued, what's in flight, and what's left, and makes [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md) usable later.

See the [Skills catalog](../../docs/Skills.md) for the full list and decision tree.
