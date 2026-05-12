---
name: devenv-gather-requirements
description: 'Conduct a structured three-phase requirements interview to produce a user-oriented requirements document. USE WHEN the user says "gather requirements", "write up requirements", "define the requirements for", "capture requirements", "what should the system do", "requirements document", "interview me for requirements", or hands off a system idea that needs functional definition before planning begins. Produces a Requirements-<topic>-NNN.md covering system vision, concrete acceptance-criteria-bearing requirements with IDs and dependency graph, and a requirements-level roadmap. Maintains a session_memory.md across sessions. DO NOT USE when requirements already exist (use /devenv-plan-from-spec or /devenv-create-implementation-plan), for quick feature clarifications that don''t warrant a formal document, or for code generation.'
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

Requirements gathering can span multiple sessions. Maintain a `session_memory.md` file in the **target repo root** to preserve state across sessions.

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

Do not write the file until Phase 3 is approved. During the session, work in chat and update `session_memory.md`.

## Process

This is a three-phase process. **Stop at each checkpoint** and wait for explicit approval before proceeding.

---

### Phase 1: System Vision

**Goal:** Produce a clear narrative description of the system — its purpose, its actors, and how they experience it.

#### Step 1: Understand the problem space

**If the user provides existing documents** (product briefs, notes, diagrams):
- Read them and summarise your understanding back to the human
- Identify gaps and ambiguities, then ask targeted fill-in questions — don't re-interview from scratch

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

For smaller systems, `REQ-NNN` is sufficient. For larger systems with distinct functional areas, use category prefixes (e.g. `AUTH-001`, `ORD-003`). Ask the human which to use and agree on the prefix list before writing requirements.

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

### Phase 3: Requirements Roadmap

**Goal:** Organise requirements into logical phases for a high-level implementation roadmap.

> **Important distinction:** This is a *requirements-level* roadmap — phases are grouped by functional cohesion and business priority. It is **not** an implementation plan. A single requirement here may later spawn one or more detailed `Implementation_plan-*.md` files produced by [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md) or [`/devenv-plan-from-spec`](../devenv-plan-from-spec/SKILL.md).

#### Step 1: Identify natural groupings

Ask:
- "Are there business priorities that should influence the order? (e.g. 'We need auth before anything else because of compliance')"
- "Are there external deadlines certain features must hit?"
- "Are there team constraints? (e.g. 'Only one person knows the payment system')"

Look for requirements that share dependencies, form a coherent demonstrable unit, or belong to the same functional area.

#### Step 2: Define phases

Use IDs `PHASE-01`, `PHASE-02`, etc. (zero-padded). For each phase:
- Name and goal statement as a linkable heading
- Requirements listed as markdown links to their definitions
- Prerequisites as markdown links to prior phases
- Size estimate (Small / Medium / Large)
- Risks and open questions

The first phase should be the smallest coherent foundation. Identify the MVP subset explicitly.

#### Step 3: Validate

- [ ] Every requirement appears in exactly one phase
- [ ] No phase includes a requirement whose dependency is in a later phase
- [ ] Each phase is demonstrable — at the end, something concrete works
- [ ] Risks are identified per phase

#### Step 4: Add roadmap guidance

- **Critical path:** which phases does everything else depend on?
- **Parallelisable:** which phases or requirements can proceed simultaneously?
- **MVP:** the minimum set of phases that delivers usable value
- **Risk-first vs. value-first:** guidance for the team on sequencing strategy

#### Phase 3 Checkpoint

**STOP.** Present the roadmap. Say:

> "Here is the requirements roadmap. Please review:
> - Does the phasing make sense for your team and timeline?
> - Are there business priorities that should change the order?
> - Are the scope estimates reasonable?
> - Are the risks and open questions accurate?
>
> When satisfied, tell me to write the output file."

After approval, write the file per [Output File](#output-file) rules. Offer to delete `session_memory.md`.

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
- The first phase should be the smallest coherent foundation, not everything.
- Keep phases demonstrable — "at the end of this phase, we can show [specific thing]."
- Flag risks early. Unproven tech or external dependencies deserve explicit phase-level notes.

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
- Merging `session_memory.md` to the main branch.
- Conflating a requirements roadmap (this skill's Phase 3) with an implementation plan.

## Sibling Skills

This skill produces a requirements document that feeds directly into:
- [`/devenv-plan-from-spec`](../devenv-plan-from-spec/SKILL.md) — generate a detailed implementation plan from a specific requirement or phase
- [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md) — interview-driven planning for a specific requirement or phase

See the [Skills catalog](../../docs/Skills.md) for the full list and decision tree.
