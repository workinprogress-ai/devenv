---
name: devenv-gather-requirements
description: 'Conduct a structured three-phase requirements interview to produce a user-oriented requirements document. Also handles brainstorming and refinement on an existing Requirements-*.md — pass the file path to pick up where a previous session left off, explore new ideas, and integrate new input. USE WHEN the user says "gather requirements", "write up requirements", "define the requirements for", "continue gathering requirements", "add more requirements", "I have a new idea", "brainstorm this change", "what if we...", or hands off a system idea that needs functional definition before planning begins. Produces (or extends) a Requirements-<topic>-NNN.md covering system vision, concrete acceptance-criteria-bearing requirements with IDs and dependency graph, and stakeholder priority groupings (not a delivery roadmap — use /devenv-create-roadmap for that). Maintains a session_memory-requirements.md across sessions. DO NOT USE for correcting, rewording, or removing existing requirements when you already know what should change (use /devenv-refine-requirements instead), for quick feature clarifications that don''t warrant a formal document, or for code generation.'
argument-hint: '[system name | path-to-existing-notes | GitHub issue number]'
user-invocable: true
---

# Gather Requirements

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to emit a copyable diagnostic block for `/devenv-skill-maintenance`.

Produce a user-oriented, functional requirements document through a structured interview. The output describes *what* the system does — not how it does it — at a level both humans and AI can use to drive planning and implementation.

## When to Use

### Gathering from scratch

Trigger phrases:
- "gather requirements" / "requirements document" / "define the requirements for X"
- "what should the system do?" / "write up requirements"
- "interview me for requirements" / "help me capture requirements"
- A system idea is handed off before any planning has begun

### Continuing: brainstorming and exploring changes to existing doc

If you have an existing `Requirements-*.md` and want to explore new ideas, brainstorm implications, or integrate new input **before committing changes**, pass the file path as the argument. This mode treats the session as mid-gathering — a natural continuation where new thoughts have emerged. You'll:
- Brainstorm implications: "What would change if we added this? What would break?"
- Explore ripple effects across the existing requirement set
- Run consistency checks against the existing doc
- Integrate new requirements or revise existing ones

Trigger phrases (continuation mode):
- "I have a new idea for this" (with existing doc path)
- "brainstorm this change" (with existing doc path)
- "what if we..., and here's where I want to explore" (with existing doc path)
- "I have more requirements" (with existing doc path)
- Pass file path argument without other context

### Do NOT use for

- Correcting, rewording, or removing specific requirements when you already know what should change → [`/devenv-refine-requirements`](../devenv-refine-requirements/SKILL.md) (apply known changes directly)
- Quick inline feature clarification — just ask directly
- Code or implementation planning

## Philosophy

- **Think like a user, not an engineer.** Requirements describe behaviors and outcomes, not architectures or technologies.
- **Concrete beats abstract.** Every requirement should be specific enough that two independent teams would build recognizably similar things from it.
- **Completeness over speed.** Missing requirements cost far more to discover in implementation than to find here. Probe for gaps, edge cases, and the unhappy path.
- **The human owns the vision.** You structure and challenge; the stakeholder decides what the system does.
- **Iterate relentlessly.** Each phase refines understanding. Going back is expected, not a failure.
- **Wide before narrow.** Move from general to specific. Phase 1 establishes the landscape; Phase 2 fills in the detail. If the user volunteers specifics before the vision is clear, park them in session memory and continue wide-to-narrow — premature detail distorts the shape of the whole.

## Session Continuity

Requirements gathering can span multiple sessions, and brainstorming conversations benefit from continuity. Maintain a `session_memory-requirements.md` file in the **target repo root** to preserve state across sessions.

**At session start**: create it if it doesn't exist, or load and summarise it to the user if it does.

**For brainstorming sessions (continuation mode):** The session memory becomes especially valuable. Record:
- The new idea or concern that prompted the brainstorming
- Implications being explored ("REQ-003 assumes X, but new idea means X is no longer true")
- Trade-offs and tensions surfaced
- Tentative directions the user is leaning toward
- What's still unresolved or uncertain

**Parking early details:** If the user volunteers specific requirements, detailed acceptance criteria, or technical constraints before Phase 1 vision is established, record them in session memory under a `## Parked details` heading. Acknowledge briefly (*"Got it — I'll hold that for when we get to Phase 2"*) and continue the wide-to-narrow progression. Surface parked items when the relevant phase arrives.

Track (all sessions):
- Current phase and what has been completed
- Key decisions the human made
- **Open questions log** — tracked as `Q-001`, `Q-002`, etc. (see format below)
- Assumptions being treated as true
- Gaps identified in the vision or requirements
- Revision notes between cycles
- For brainstorming: implications being explored and tentative directions

Track open questions as `Q-001`, `Q-002`, etc. (see [Q-NNN format](../_conventions.md#open-questions-log-q-nnn) for the status-transition convention and format block). Every `Q-NNN` must end up `resolved` or `deferred` before the final file is written.

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

A single doc is the default. For large initiatives (multiple distinct epics, 30+ requirements, or distinct stakeholder groups), split into one `Requirements-<epic>-NNN.md` per epic with a category-prefix ID scheme (e.g. `ORD-NNN`). Produce an `Index.md` as the canonical entry point. Cross-doc dependencies use `Depends on: AUTH-003 (Requirements-auth-001.md)`.

See [multi-doc-projects.md](./references/multi-doc-projects.md) for the full conventions, splitting rules, and Index.md template.

## Process

This is a three-phase process for fresh requirements gathering. **Stop at each checkpoint** and wait for explicit approval before proceeding.

### Continuation mode (existing doc): brainstorming-first

If the argument is a path to an existing `Requirements-*.md`, enter **continuation mode** — a natural mid-gathering brainstorm where new ideas have emerged.

**Session arc:**

1. **Load and read the doc.** Note the last-used requirement ID, the current priority groups, current vision, and any open or deferred `Q-NNN` questions. Store the full current state in session memory for comparison at session end.

2. **Summarise the current state** back to the user in a brief block: vision in one sentence, number of existing requirements, any open/deferred questions. Confirm you've loaded it correctly.

3. **Establish the brainstorm frame.** Say: *"What's the new idea or thought you want to explore? I'll work through the implications, ripple effects, and tensions against what's already documented, and we'll decide what changes together."*

4. **Run the brainstorm.** As the user describes the new thought:
   - Ask probing questions about implications: *"Would that affect REQ-004 and REQ-012? How would [actor] experience that?"*
   - Explicitly surface ripple effects: *"If we do that, REQ-008's assumption about [X] breaks. What would that mean?"*
   - Identify tensions early and call them out: *"That conflicts with [vision section / REQ-XXX / GROUP-YY]. How do you want to resolve that?"*
   - Use the existing priority groups as context: *"This would change the MVP group — are you thinking it should stay in MVP or move to GROUP-02?"*
   - Check whether the vision itself needs to shift, not just individual requirements

5. **Explore implications systematically.** Don't jump straight to "what new requirements do we need": first work through the tension and see what actually changes. This often surfaces:
   - Requirements that become impossible or need revision
   - Dependencies that now loop or conflict
   - Priority groupings that need reshuffling
   - Vision gaps or shifts

6. **Update as you go** (in session memory, not the file). Track:
   - What the new idea is and why it emerged
   - Implications discovered
   - Which existing requirements are affected
   - What's still unclear or debated

7. **Once the direction is clear,** ask: *"Are you ready to lock in these changes, or do you want to brainstorm more?"* (You may need multiple loops.)

8. **When ready to commit:** present a delta — only the changed and new content. Ask for approval. Once approved:
   - Update the existing file: revise affected requirements, append new ones (with IDs continuing from the last), update vision if needed, reshuffle priority groups if needed
   - Add a `## Revision History` entry explaining what changed and why
   - Update or clear session memory based on whether more sessions are planned

9. **Maintain `session_memory-requirements.md`** — load it if it exists, update it at session end with the new brainstorm state.

---

### Phase 1: System Vision

**Goal:** Produce a clear narrative description of the system — its purpose, its actors, and how they experience it.

#### Step 1: Understand the problem space

**If the user provides existing documents** (product briefs, notes, diagrams):
- Read them and summarise your understanding back to the human
- Identify gaps and ambiguities, then ask targeted fill-in questions — don't re-interview from scratch

**Ask about existing communications** (transcripts, email threads, recordings, etc.) before starting cold. Dispatch the `Explore` subagent per artifact to produce structured summaries (see [Explore subagent dispatch](../_conventions.md#explore-subagent-dispatch)); surface each summary for validation before extracting requirements material. Cite the source in `session_memory-requirements.md` for any requirement that traces back to a communication.

**Start with:**
1. "What problem does this system solve? Who has this problem today?"
2. "What does success look like?"
3. "Who are the main actors — people or systems that interact with this?"
4. "Walk me through a day in the life of [actor]."
5. "What's the most important thing the system does?"
6. "What's explicitly out of scope?"
7. "Are there existing systems this replaces or integrates with?"
8. "What are the hard constraints? (regulatory, performance, security, budget, timeline)"
9. "Are there actors not yet mentioned — admin users, support staff, external partners, automated systems?"
10. "What worries you most about this project?"

#### Step 2: Identify actors and their goals

For each actor: who they are, their goals, their experience expectations, and their current pain points.

Push beyond the obvious — ask about admin users, support staff, automated systems, configuration/maintenance roles, output consumers, and external parties (partners, regulators, auditors).

#### Step 3: Develop usage scenarios

Scenarios are one of the most powerful tools in requirements gathering — they help stakeholders visualise the system in action and surface requirements that abstract descriptions miss. Aim for at least 3–5 concrete narrative walkthroughs; don't cap them artificially. The right number is however many it takes to cover the meaningful situations.

Each scenario should:
- Follow a specific actor through a specific goal, step by step
- Include decision points and branches ("if the order has already shipped…")
- Cover the happy path *and* common failure modes
- Stay at the **user experience level** — what happens, not how. No implementation details.

After drafting each scenario, ask: *"Does this match how you envision it? What did I get wrong or miss?"*

**Scenario → requirement backlinking (done in Phase 2):** Once Phase 2 requirements are written, come back to each scenario and add inline markdown links to the requirements it illustrates. Note in session memory that backlinking is pending for each scenario.

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

**Backlink scenarios to requirements.** After requirements are drafted, update each Phase 1 scenario in §1.3 to link the requirements it illustrates. Add *(see [REQ-004](#req-004-title), [REQ-012](#req-012-title))* at natural sentence breaks within the scenario — or at the end of the scenario paragraph where several requirements apply together. These are markdown heading anchors and must match the actual heading IDs in the document.

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

#### Step 6: Internal consistency review

Before the Phase 2 checkpoint, scan all requirements for internal consistency. **This step is not optional.** Requirements that will be used to drive AI must be free of contradictions — ambiguities a human resolves from context will cause AI to produce unpredictable results.

Check for:

- **Direct contradictions** — REQ-A asserts something that REQ-B explicitly denies. Both cannot be true.
- **Acceptance criteria conflicts** — two requirements' Given/When/Then clauses produce incompatible outcomes for the same actor/scenario combination.
- **Scope boundary violations** — requirements that describe behaviour the scope section marks as out of scope.
- **Ambiguous shared terms** — the same word used with different meanings in different requirements (e.g. "user" meaning customer in one place, admin in another). These are not contradictions but will cause AI misreading.
- **Dependency integrity gaps** — REQ-A depends on REQ-B, but REQ-B's acceptance criteria do not actually satisfy what REQ-A needs from it.
- **Implicit conflicts** — two requirements that don't directly contradict but together create an impossible or undesirable state.

For each finding, produce a labelled finding block:

```
CONFLICT: REQ-004 vs REQ-011
REQ-004: users may delete their account at any time.
REQ-011: all orders must retain a customer reference for 7 years (compliance).
Tension: hard-delete conflicts with the data-retention obligation.
```

For each finding, offer:
- **Resolve inline** — user provides a clarification; AI updates the affected requirements immediately.
- **Add to open questions log** as a new `Q-NNN` entry for brainstorming before the checkpoint.
- **Accept as known trade-off** — explicitly document the tension and the chosen resolution in both requirements.

**Do not present a requirement set with unresolved contradictions.** A document with known conflicts is not a useful artefact — not for humans, and especially not for AI.

#### Phase 2 Checkpoint

**STOP.** Present the full requirements list, then the consistency review findings (if any). Say:

> "Here are the concrete requirements derived from the vision.
>
> Consistency review: [N conflicts found / no conflicts found].
> [List each finding with proposed resolution if applicable.]
>
> Please review:
> - Are all requirements correct and clearly stated?
> - Are the acceptance criteria specific enough to test against?
> - Are the dependencies accurate?
> - Is anything missing?
> - Are you satisfied with how each conflict was resolved?
>
> Edit, add, remove, or reorder as needed. When satisfied, tell me to proceed to Phase 3."

Do not proceed until the human explicitly approves. Do not proceed if any consistency finding remains unresolved.

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

After approval, write the file per [Output File](#output-file) rules. Then offer to write Episodes and to run a Stability Audit before offering to delete `session_memory-requirements.md`.

---

## As-You-Go Health Checks

Requirements documents are built incrementally — inconsistencies accumulate naturally. Trigger a **health check** whenever a meaningful volume of material has landed: approximately every 8–10 requirements discussed, at every phase checkpoint, or after any non-trivial revision. The user can also ask for one at any time.

When the threshold is hit, state it:
> *"We've covered a fair amount of ground. Running a quick consistency pass before we go further."*

### Three-bucket handling

| Bucket | Description | Action |
|--------|-------------|--------|
| **Mechanical** | Terminology inconsistencies, broken cross-references, a term used two ways | Fix silently and note: *"Corrected: 'user' was ambiguous in REQ-003 and REQ-007 — unified to 'customer'."* |
| **Potential contradiction** | Two requirements that could conflict but might be reconcilable with a clarification | Surface with a proposed resolution and wait for confirmation before editing. |
| **Genuine gap or ambiguity** | An unclear requirement, a missing constraint, an implicit assumption needing a decision | Add to the open questions log as `Q-NNN` and interview the user. |

Health checks don't stop the session — scan, surface, resolve what can be resolved immediately, park the rest as `Q-NNN`, and continue.

---

## Requirement Episodes

Episodes are narrative walkthroughs of the system from a user's perspective — stories that illustrate how requirements combine in real use. Write them when the requirements alone feel abstract or when stakeholders need to see the system "in action" to validate completeness.

When to write, voice/tone guidance, REQ-NNN reference conventions, and the output file format: [episodes-guide.md](./references/episodes-guide.md).

## Stability Audit (Final Convergence Review)

When Phase 3 is approved and episodes are written (or the user signals the requirements are approaching final form), offer a stability audit:

> *"Before we call this done — want to run a final convergence check? It's a full top-to-bottom scan for remaining inconsistencies. We keep going until a pass comes up clean. Typically 1–4 rounds."*

### How it works

Each round scans the complete requirements document:
- Vision and scope for internal coherence
- Requirement descriptions against their acceptance criteria
- Cross-requirement dependencies for integrity
- Priority groupings for consistency with the stated MVP rationale
- Open questions log — anything still `open` must be resolved or explicitly deferred

After each round, present a structured findings list: finding ID, affected requirement(s), issue type, severity (`blocking` / `minor` / `cosmetic`), and proposed resolution. Handle findings the same three-bucket way as the as-you-go health checks.

### Exit criteria

The audit is complete when:
1. A round produces **no blocking findings** — only minor or cosmetic notes.
2. The number of findings is visibly declining across rounds.

After the final clean pass, declare stability explicitly:

> *"The document passed this round with only [minor/cosmetic] notes. I believe it's stable. Here's what was addressed across the [N] review rounds: [brief summary]. Ready to mark this final and delete the session memory?"*

Do not declare stability if blocking contradictions remain unresolved.

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
- **Skipping the internal consistency review.** It is not optional — especially when the output will drive AI.
- **Leaving known contradictions unresolved in the output.** Every conflict finding must be resolved, accepted as a documented trade-off, or added to the open questions log before the file is written.
- **Dropping open questions silently.** Every `Q-NNN` must end as `resolved` or `deferred` with a note.
- Writing requirements without acceptance criteria.
- Writing the output file before Phase 3 is approved.
- Merging `session_memory-requirements.md` to the main branch.
- Conflating priority groupings (this skill's Phase 3) with a delivery roadmap (`/devenv-create-roadmap`) or an implementation plan (`/devenv-create-implementation-plan`).
- **Jumping to detailed requirements during Phase 1** because the user mentioned specifics — park the details, finish the vision first.
- **Writing episodes before Phase 3 is approved** — they'll be stale before the ink is dry.
- **Putting implementation details or exception-path coverage into episodes** — episodes illustrate happy and common paths only.
- **Skipping health checks** when many requirements have accumulated. Contradictions don't self-report.

## Sibling Skills

This skill produces a requirements document that feeds directly into:
- [`/devenv-refine-requirements`](../devenv-refine-requirements/SKILL.md) — revise the document later when scope shifts or new communications arrive
- [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md) — translate requirements into an architectural blueprint for epic-scale work
- [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md) — produce a real delivery roadmap (after a blueprint exists); supersedes Phase 3's priority groupings for execution purposes
- [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md) — interview-driven planning for a specific requirement or group, or a complete spec/RFC

## Companion Tooling

This skill produces the requirements document but **does not create GitHub issues**. To create issues from the approved doc, run [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md):

- **Epic-scale work** — first run [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md), then `/devenv-create-roadmap` with both the blueprint and requirements as input. The roadmap creates the parent epic + per-step child issues across component repos.
- **Smaller work that doesn't warrant a blueprint** — run `/devenv-create-roadmap` with just the requirements doc. It supports a requirements-only mode that asks for the target component per step and creates the issues from there.

Going through `/devenv-create-roadmap` (rather than creating issues by hand) keeps the roadmap as the single source of truth for what's been issued, what's in flight, and what's left, and makes [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md) usable later.

---

## Brainstorming Modes

Brainstorming can happen in three contexts: during **continuation-mode sessions** (above), during **open-question exploration**, or ad-hoc whenever tension or ambiguity surfaces. All three use the same principles:

### Brainstorming a specific open question (Q-NNN)

At any point — during any phase, during continuation mode, or when the user says "let's brainstorm Q-003" — enter focused brainstorming for a specific question:

1. **Restate** the question in full, with context: which requirements are affected, what the tension is, and why the decision matters.
2. **Present 2–4 options** with trade-offs — not a recommendation unless the user asks for one.
3. **Ask probing questions** to help the user reach a decision:
   - "What's the dominant constraint here — UX, legal, or operational?"
   - "Is there a stakeholder who owns this decision?"
   - "Would option B still work if [edge case] occurs?"
4. **When the user decides**: mark the question `resolved` in the open questions log, add a one-line resolution note, and update every affected requirement.
5. **When the user defers**: mark it `deferred`, note the reason, and annotate each affected requirement with the open question number so the gap is visible in the output:

   ```markdown
   > ⚠️ Open question Q-003: latency target unit (p50 vs p99) not yet decided — see session notes.
   ```

6. **Never diagnose for the user.** Present options and trade-offs; let them decide. Avoid steering toward a specific answer unless asked.

### Brainstorming during continuation mode

When a new idea arrives in an existing doc (see *Continuation mode* above), the brainstorm is **implication-first**: work through ripple effects and tensions before deciding what to change. The same principles apply — surface options and trade-offs, surface unresolved questions as `Q-NNN` entries, let the user decide. The difference is the framing: you're exploring *how a change cascades*, not *which option to pick*.

---

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
