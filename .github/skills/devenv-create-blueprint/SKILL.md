---
name: devenv-create-blueprint
description: 'Conduct a structured architecture interview to produce a system blueprint — a high-level, architectural description of a system or change to a system. USE WHEN the user says "create a blueprint", "design this system", "architect this", "blueprint this epic", "produce an architectural design", or hands off a requirements doc / problem description that needs architectural decomposition before any planning can begin. Produces a Blueprint-<system>-NNN.md covering domains, services, events, communication patterns, and (for brownfield work) a per-component "what changes" delta. Maintains a session_memory-blueprint.md across sessions. DO NOT USE for low-level implementation planning (use /devenv-create-implementation-plan), for ordering work into milestones (use /devenv-create-roadmap once the blueprint exists), or for capturing user-level functional requirements (use /devenv-gather-requirements).'
argument-hint: '[system name | path-to-requirements-doc | freeform problem description]'
user-invocable: true
---

# Create Blueprint

Produce a system **blueprint** — a high-level architectural design that unifies how an epic is built. A blueprint describes domains, services, events, communication patterns, and (for brownfield work) the delta between current and target state for every affected component. It is **not** an implementation plan; it is the architectural ground truth that one or more implementation plans will draw from.

## When to Use

Trigger phrases:

- "create a blueprint" / "blueprint this" / "design this system"
- "architect this epic" / "produce an architectural design"
- A `Requirements-*.md` is handed off and needs translation into architecture
- A new system, subsystem, or major change is being scoped

Do **not** use for:

- Low-level task breakdown → [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md) or [`/devenv-plan-from-spec`](../devenv-plan-from-spec/SKILL.md)
- Ordering work into milestones / creating issues → [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md)
- User-level functional requirements → [`/devenv-gather-requirements`](../devenv-gather-requirements/SKILL.md)
- Editing an existing blueprint → [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md)

## Philosophy

- **Think in domains first, not technologies.** What are the areas of business expertise? Where are the boundaries?
- **Loose coupling is paramount.** Services should change independently; if they don't, they're the same service.
- **Make trade-offs explicit.** Every design choice costs something — document what and why.
- **Think operationally.** A design is only good if it can be built, deployed, and operated.
- **Use patterns, but don't over-pattern.** Reference patterns where they apply; don't apply patterns just to look architectural.
- **Sketch, don't specify.** A blueprint guides implementation; it isn't a 100-page spec.
- **Brownfield is the default.** Most blueprints describe a *delta* — what changes in an existing system, not a clean greenfield design.

## Session Continuity

Blueprint creation typically spans multiple sessions. Maintain a `session_memory-blueprint.md` file in the **target repo root** to preserve state across sessions.

The filename includes the skill suffix (`-blueprint`) so it can coexist with other in-progress skills (e.g. `session_memory-requirements.md` from a concurrent requirements interview).

**At session start**: create it if it doesn't exist; load and summarise it to the user if it does.

Track:
- Current phase and what has been completed
- Key architectural decisions and their rationale
- Components surveyed (for brownfield) and what was found
- Open questions not yet resolved
- Trade-offs acknowledged and pending

**At session end**: update it with the current state.

**When the blueprint is approved**: offer to delete it. Do not merge to main.

## Output File

Produce `Blueprint-<system>-NNN.md` where:
- `<system>` is a short kebab-case name agreed with the user (e.g. `order-fulfillment`, `auth-revamp`)
- `NNN` is a zero-padded numeric suffix (`001`, `002`, …) so multiple blueprints for the same system can coexist

**Location:**
- If the target repo name starts with `planning.` → write to `docs/Architecture/` (create the folder if needed)
- Otherwise → ask the user where to put it

See [blueprint-template.md](./references/blueprint-template.md) for the full document structure.

Do not write the file until Phase 3 is approved. During the session, work in chat and update `session_memory-blueprint.md`.

## Process

This is a three-phase process. **Stop at each checkpoint** and wait for explicit approval before proceeding.

---

### Phase 1: Context & System Survey

**Goal:** Establish what problem the blueprint addresses, gather the requirements basis, and (for brownfield) survey the existing system landscape.

#### Step 1: Identify inputs

Ask the user:

1. "What's the problem this blueprint addresses? Is there a requirements document, GitHub issue, or written brief?"
2. "Is this **greenfield** (new system from scratch) or **brownfield** (extending/changing an existing system)?"
3. "What's the rough scope — a feature, a subsystem, or an epic spanning multiple services?"

If a `Requirements-*.md` exists, read it and summarise the key actors/scenarios/constraints back to the user before going further.

#### Step 2: Probe context

- "What QoS targets matter? (latency, throughput, availability, scale)"
- "What constraints are hard? (regulatory, organisational, deadline-driven)"
- "What external systems does this integrate with?"
- "Where is consistency critical? Where is eventual consistency acceptable?"

#### Step 3 (brownfield only): Survey the existing system

When the project extends an existing system, you need to know what's already there.

1. **Get the repo cache**: run `repo-cache-update`. This returns a path to a folder containing all organisation repos.
2. **Read the taxonomy**: `tools/config/repo-types.yaml` defines the naming patterns for repo types (`service.*`, `lib.cs.*`, `app.web.*`, etc.). Use it to interpret repo names.
3. **Propose a candidate list**: based on the problem description and the taxonomy, propose to the user a list of repos that look relevant. Example:
   > "Based on the problem mentioning order fulfillment and inventory, these repos look relevant:
   > - `service.commerce.order-management`
   > - `service.commerce.inventory`
   > - `lib.cs.commerce.order-models`
   > - `app.web.admin-portal`
   >
   > Should I survey these? Add or remove any?"
4. **Survey only the confirmed list** (read-only). For each repo, capture:
   - Purpose and primary responsibility
   - Public API / events emitted / events consumed
   - Key dependencies
   - Anything that already does what the new feature needs

For greenfield work, skip Step 3 entirely.

#### Phase 1 Checkpoint

**STOP.** Present the context summary. Say:

> "Here's what I understand about the problem, requirements basis, and existing landscape. Please review:
> - Is the problem framing correct?
> - Are the QoS / constraints accurately captured?
> - (Brownfield) Are the surveyed components correct? Any I missed or shouldn't have included?
>
> When satisfied, tell me to proceed to Phase 2."

Do not proceed without explicit approval.

---

### Phase 2: Architecture

**Goal:** Decompose the system into domains, services, events, and communication patterns. For brownfield, capture the delta per component.

Work through these in order, validating with the user at each substep. Don't try to nail everything in one pass — iterate.

#### Step 1: Identify business capabilities

What are the main things the system needs to do, in domain language? Group related capabilities. Identify dependencies between groups.

#### Step 2: Define domains

For each domain:
- **Purpose and scope** — what's in, what's out, why this is a natural boundary
- **Key vocabulary** — concepts central to the domain (table: term + definition)
- **Relationships** — how this domain depends on or interacts with others

Avoid technical layers like "persistence domain" or "API domain" — those aren't business domains.

#### Step 3: Identify services within domains

For each potential service:
- **Name and purpose** — clear, business-focused
- **Owns** — what data/aggregates it manages
- **Operations** — what actions it performs
- **Dependencies** — other services it calls
- **Status** — `existing` / `new` / `extended`

**Service-boundary red flags**: services that always change together; long synchronous call chains (A → B → C); shared databases; thin wrappers around a library. Surface these and discuss.

#### Step 4: Map domain operations and events

- **Operations** (TitleCase names like `CreateOrder`, `ProcessPayment`): which services participate, in what order, sync vs. async, success path and failure paths.
- **Events**: significant state changes that other services react to. Table format:

  | Event | Emitted By | Consumed By | Purpose |
  |---|---|---|---|

#### Step 5: Decide communication patterns

For each significant interaction: **synchronous or asynchronous?** Document the why.

- Sync: immediate response, consistency critical, cost is coupling
- Async: eventual consistency acceptable, cost is complexity / ordering

#### Step 6: Reference patterns (optional)

If a `Pattern_Library` exists in the workspace (typically `repos/docs.engineering/docs/Pattern_Library/`), reference relevant patterns by full GitHub URL so the blueprint stays portable. The library is **optional** — skip if not present or no patterns clearly apply. Do not invent patterns to feel architectural.

#### Step 7 (brownfield only): Per-component "What Changes"

For every existing component touched by this blueprint, write a delta entry:

```markdown
#### service.commerce.inventory

**Current state**: Owns inventory levels per SKU. Synchronous read API. No events emitted.

**Target state**: Same ownership; emits `InventoryReserved` and `InventoryReleased` events; new async reservation endpoint.

**Changes**:
- Add event publishing for reservations
- Add `POST /reservations` endpoint
- Add `Reservation` aggregate to data model
```

For new components, record:

```markdown
#### service.commerce.fulfillment-orchestrator (new)

**Purpose**: Coordinates the fulfillment saga across inventory, payment, and shipping.
**Owns**: Saga state.
**Triggered by**: `OrderConfirmed` event.
```

#### Phase 2 Checkpoint

**STOP.** Present the architecture draft. Say:

> "Here's the architecture: domains, services, operations, events, and per-component deltas. Please review:
> - Are the domain boundaries right?
> - Are the service boundaries right? Any of the red flags above present?
> - Are operations and events accurate?
> - Are the per-component deltas complete and accurate?
>
> When satisfied, tell me to proceed to Phase 3."

Do not proceed without explicit approval.

---

### Phase 3: Consequences, Validation & Gaps

**Goal:** Make trade-offs explicit, identify risks, and validate completeness.

#### Step 1: Document consequences

- **Positive consequences**: what improves vs. alternatives, what forces this resolves
- **Negative consequences**: what new complexity is introduced, what could go wrong
- **Mitigations**: for each negative, how the impact is reduced (patterns, monitoring, operational practices)

#### Step 2: Document assumptions and gaps

- **Assumptions** about scale, latency, consistency, team capacity — what would force a redesign?
- **Known gaps**: what isn't designed in detail yet
- **Future work**: explicitly out of scope for this blueprint, deferred to later

#### Step 3: Validation checklist

- [ ] Problem and requirements basis are clearly stated
- [ ] (Brownfield) Existing components surveyed and per-component delta is complete
- [ ] Domains are well-defined and bounded
- [ ] Services are loosely coupled and independently deployable
- [ ] Operations are traced end-to-end through services
- [ ] Events are identified for async communication
- [ ] Communication patterns (sync/async) are justified
- [ ] Consequences are documented (positive, negative, mitigations)
- [ ] Patterns referenced (if any) link to full URLs
- [ ] Vocabulary is clear and consistent
- [ ] Assumptions and gaps are documented
- [ ] Blueprint is at the right level (sketch, not specification)

#### Phase 3 Checkpoint

**STOP.** Present the full draft (vision + architecture + consequences). Say:

> "Here's the complete blueprint. Please review the consequences, mitigations, and gaps. When satisfied, tell me to write the file."

Only after explicit approval, write `<target-repo>/docs/Architecture/Blueprint-<system>-NNN.md` (or the user-confirmed location).

---

## After the Blueprint Exists

Once written, surface the next-step options to the user:

- **Need to plan delivery order and create issues?** → [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md)
- **Need detailed task-level plans for a component?** → [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md) or [`/devenv-plan-from-spec`](../devenv-plan-from-spec/SKILL.md)
- **Architecture changed mid-stream?** → [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md)

## Anti-patterns

- Writing the file before Phase 3 approval
- Conflating blueprint with implementation plan (no per-task detail in a blueprint)
- Skipping the brownfield survey and inventing components that may already exist
- Inventing pattern references just to look architectural
- Designing in technologies (`PostgreSQL`, `Kafka`) before designing in domains
- Treating `repo-cache-update` output as authoritative without user confirmation of relevance
- Forgetting to update `session_memory-blueprint.md` between sessions
