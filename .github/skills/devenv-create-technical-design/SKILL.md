---
name: devenv-create-technical-design
description: 'Design the internals of a component from scratch through a structured interview with brainstorming and explicit decision-making, producing a living docs/Architecture_and_implementation.md inside the component repo. USE WHEN the user says "design this component", "create a technical design for", "design this service", "we need an Architecture.md for", "design the internals of", or a blueprint identifies a new component that needs to be designed before implementation begins. Records interface contract, internal structure, data model, error handling, test strategy, and key decisions with rationale. DO NOT USE FOR documenting an already-built system without design decisions (use /devenv-document), system-level architectural decomposition (use /devenv-create-blueprint), or task-level planning (use /devenv-create-implementation-plan).'
argument-hint: '[component name | repo path | blueprint section]'
user-invocable: true
---

# Create Technical Design

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

See the [Skills catalog](../../../docs/Skills.md) for the full list and decision tree.

Design the internals of a component — a service, library, or significant module — by working through its interface contract, internal structure, data model, error handling, and test strategy. This skill involves active brainstorming and decision-making: approaches are weighed, trade-offs are surfaced, decisions are recorded with rationale. The output is a living `docs/Architecture_and_implementation.md` inside the component repo that enables future AI sessions and engineers to understand and work with the component without reading all the code.

## When to Use

Trigger phrases:

- "design this component / service / library"
- "create a technical design for X"
- "we need an Architecture.md for this"
- "design the internals of X"
- A blueprint has identified a new component that doesn't yet exist
- An implementation plan is about to be written but the component's internal design is unsettled

Do **not** use for:

- System-level architectural decomposition → [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md)
- Documenting a component that already exists and is already designed → [`/devenv-document`](../devenv-document/SKILL.md)
- Weighing implementation approaches without producing a formal spec → [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md)
- Task-level implementation planning → [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md)
- Updating an existing technical design (small drift, gaps, resolved unknowns) → [`/devenv-refine-technical-design`](../devenv-refine-technical-design/SKILL.md)
- Fundamentally rethinking an existing component's approach → [`/devenv-redesign-component`](../devenv-redesign-component/SKILL.md)

## Core Principles

1. **Interface contract first, always.** The boundary between the component and the outside world is the most important design decision. Settle the contract before discussing internals.
2. **Decisions must be recorded.** Every non-obvious choice needs a rationale entry — not just the outcome, but *why* and what trade-off was accepted. Future engineers and AI sessions depend on this.
3. **Push back on weak designs.** If a proposed approach has unexamined trade-offs, surface them. "We'll deal with that later" is not an architecture decision.
4. **The output serves two audiences.** An engineer reading `Architecture_and_implementation.md` should be able to orient within the codebase. An AI session loading it should be able to make correct decisions without reading implementation files.
5. **Don't over-specify internals.** Internal structure should be described at the module/layer level — not as a class diagram or pseudocode. Leave implementation detail to implementation.
6. **Track open questions.** Design sessions surface unknowns. Log them as Q-NNN; resolve or defer all of them before writing.

## Personality

Technically opinionated. Comfortable challenging the user's initial direction if it creates unnecessary coupling, misplaces responsibility, or introduces fragility. Pushes for explicit interface contracts and named error states rather than vague hand-waving. Patient with ambiguity early in the session; increasingly precise as decisions accumulate.

## Session Memory

For large or complex components, maintain a `session_memory-technical-design.md` file in the component repo root to preserve progress across sessions.

Track:
- Which phases are complete
- **Open questions log** — `Q-NNN` items (same format as gather-requirements)
- Key decisions already made
- Assumptions being treated as true

**Open questions log format:**

```
Q-001 | open | How should cache invalidation be triggered? — event-driven vs. TTL | Affects: [Data Model, Error Handling]
Q-002 | resolved | Should this component own its own DB schema? | Resolution: yes — owns schema, no shared tables
Q-003 | deferred | Multi-tenancy strategy | User: out of scope for this phase
```

Status: `open` → `brainstorming` → `resolved` / `deferred`. Every Q-NNN must reach `resolved` or `deferred` before writing the output.

---

## Procedure

### Phase 0 — Intake

Begin with a concise intake interview. Ask in one conversational exchange:

1. **What is this component?** Name, purpose, and which system or blueprint it belongs to.
2. **Greenfield or brownfield?** Does code already exist, or is this being designed from scratch?
3. **What inputs do we have?** Blueprint section for this component? Requirements doc? Existing README or docs?
4. **What is the primary driver for creating this now?** (About to write an implementation plan? Onboarding a new engineer? Establishing a contract with another team?)
5. **Any known constraints?** Technology stack, performance requirements, team conventions.

If a blueprint section for this component exists, read it before proceeding. It defines the component's place in the wider system — do not design against it.

---

### Phase 1 — Context Survey

**For brownfield components:**

1. Read `README.md`, existing `docs/`, and any design docs or ADRs
2. Read entry points: `Program.cs`, `Startup.cs`, `index.ts`, or equivalent; note what the component exposes
3. Read key interface definitions (interfaces, abstract classes, event schemas, API route declarations)
4. Note what the component's current shape is vs. what the blueprint says it should become
5. Log gaps and contradictions as Q-NNN items

**For greenfield components:**

1. Read the relevant blueprint section if available
2. Read equivalent components in the codebase (sibling services, existing patterns) to understand conventions
3. Note the technology stack, DI patterns, project structure conventions

Summarise what you found before proceeding to Phase 2.

---

### Phase 2 — Interface Contract

The interface contract is the component's public boundary. Design this before internals.

Work through each surface collaboratively with the user:

**Exposed surface** — What does this component provide?
- HTTP/gRPC endpoints (routes, request/response shapes, auth requirements)
- Events published (name, schema, when triggered)
- Messages consumed (queue/topic, schema, expected idempotency behaviour)
- Exported packages / public library API (types, functions, classes)
- CLI / configuration surface (env vars, config file schema)

**Consumed surface** — What does this component depend on?
- Other services it calls (synchronously or asynchronously)
- Infrastructure it uses (databases, caches, queues, file systems)
- Libraries or packages it imports that are non-trivial (i.e. shape the design)
- Dependency direction: note which direction each dependency flows; flag any that look backwards

For each item: brainstorm, push back if the contract looks wrong, and record the decision with rationale before moving on.

Log unresolved questions as Q-NNN.

---

### Phase 3 — Internal Structure

With the boundary settled, design the interior at the module/layer level.

Work through:

**Layering** — How is the component divided internally? What are the layers, and what responsibilities does each have? (e.g. HTTP handler → domain service → repository; or: command handler → domain aggregate → event store)

**Key modules** — What are the main units of organisation? Not a file list — more like "the domain model lives here; the infrastructure adapters live here; the background workers live here".

**Key types** — What are the core domain types, value objects, or data structures that carry the component's essential state? Not implementation-level detail — conceptual.

**Entry points** — For someone reading the code cold, where do they start?

Keep this section at the right altitude. The test: "Can an engineer orient within the codebase from this description without reading code?" If yes, it's specific enough.

Log unresolved structural questions as Q-NNN.

---

### Phase 4 — Data Model

What state does this component own?

- What persistent data does it hold? (Tables, collections, blobs, file store)
- What is the ownership boundary — does it share data with other components, or is its data exclusively its own?
- Sketch the key entities and their relationships (narrative or minimal schema — not full DDL)
- What consistency guarantees apply? (Eventual? Strong? Per-aggregate?)
- What is the migration / evolution strategy? (Schema migrations, versioned events, etc.)

---

### Phase 5 — Error Handling Strategy

Explicit error handling is one of the most frequently underdocumented things in a component. Cover:

- **Expected error types** — what errors are part of the domain (validation failures, not-found, conflicts) vs. infrastructure failures
- **Error propagation** — which errors bubble to the caller, which are absorbed and logged, which trigger compensating actions
- **Retry and idempotency** — what is safe to retry? What is idempotent by design?
- **Circuit breaking / fallback** — does this component have graceful degradation behaviour?
- **Error response surface** — what does the outside world see when something goes wrong? (HTTP status codes, error event schemas, exception types in a library)

---

### Phase 6 — Test Strategy

- **Unit tests**: what is tested in isolation, and what is the unit boundary? (Domain logic? Individual handlers? Pure functions?)
- **Integration tests**: what infrastructure boundaries are crossed? What is a real dependency vs. a test double?
- **Contract tests**: if this component exposes an HTTP API or publishes events consumed by other components, how are contracts verified?
- **What is explicitly out of scope for tests** at this level (e.g. "E2E tests are owned by the platform team")

---

### Phase 7 — Open Questions Brainstorm

For any Q-NNN that remains open after Phases 2–6:

1. Restate the question clearly
2. Offer 2–4 options with trade-offs
3. Ask the user to decide
4. Update Q-NNN to `resolved` or `deferred`

Do not move to Phase 8 while critical design questions are open.

---

### Phase 8 — Draft and Write

**First, show the proposed document skeleton:**

```
## Proposed Architecture_and_implementation.md structure

0. Scope and acceptance criteria — in/out of scope; observable ACs at the interface level
1. Overview — what this component does and why it exists
2. Context — where it fits in the wider system
3. Interface contract — exposed and consumed surfaces
4. Internal structure — layers, modules, entry points
5. Data model — owned state, entities, consistency
6. Error handling — error types, propagation, retry
7. Test strategy — unit / integration / contract split
8. Key decisions — recorded with rationale
9. Known unknowns — deferred Q-NNN items
```

Wait for the user to approve the structure. They may adjust sections or scope.

**Before writing, establish the scope and acceptance criteria.** These are the most important inputs for anyone picking up the work later — including `/devenv-plan-from-spec`. Ask:

> *"Before I write the doc, two quick questions:*
> *1. What's explicitly out of scope for this design? (Helps bound the implementation plan.)*
> *2. What does done look like from the outside? Name 2–4 observable behaviours the component must exhibit when the work is complete."*

If the interface contract work in Phase 2 already made the ACs obvious, infer them and present for confirmation rather than asking cold. Mark each `*(explicit)*` if stated by the user or `*(inferred)*` if derived from the contract.

**Then write `docs/Architecture_and_implementation.md`** in the component repo. Follow the [output format](#output-format) below.

If the file already exists (stub or prior version), show the user what will change and ask whether to update in place.

After writing and confirming with the user, ask:

> *"Want to track this in a GitHub issue? I can create a new one, or post the design to an existing issue number. The document will go in a comment; the description stays as a short placeholder for `/devenv-plan-from-spec`."*

If yes:

1. **New issue or existing?** Ask whether to create a new issue or use an existing one. If the user provides an issue number, skip to step 4.

2. **Draft the issue title** — propose and ask the user to confirm or adjust:
   - `Technical Design: <component name> — <YYYY-MM-DD>`

3. **Draft the issue body** (placeholder — design goes in the comment):
   ```
   Technical design document is in the first comment below.

   Next step: use `/devenv-create-implementation-plan` or
   `/devenv-plan-from-spec <issue number>` to generate a task-level implementation plan.
   Document file: `<workspace-relative path to docs/Architecture_and_implementation.md>`
   ```

4. **Show a preview** (title + body for new issues; first ~15 lines of the document content for existing) and ask:
   > *"Ready to post the design? (y/n)"*

5. On confirmation:

   **If creating a new issue:**
   - `issue-create --repo "$GITHUB_REPO" --title "<title>" --body "<body>"`
   - Note the new issue number.
   - Write the design document to a temp file.
   - `issue-comment <N> --body-file <temp-file>`
   - Surface the issue URL.

   **If posting to an existing issue:**
   - Write the design document to a temp file.
   - `issue-comment-list <N>` — scan for an existing design comment (a comment whose body begins with `# Architecture and Implementation`).
   - If found: `issue-comment-update <COMMENT_ID> --body-file <temp-file>` (replaces the prior version).
   - If not found: `issue-comment <N> --body-file <temp-file>` (adds a new comment).
   - Surface the issue URL.

   The GH issue comment is the canonical record. The local `docs/Architecture_and_implementation.md` is the git-tracked working copy — both should be kept in sync.

Never create an issue or post a comment without explicit "yes" confirmation.

---

## Output Format

```markdown
# Architecture and Implementation — [Component Name]

> [One sentence: what this component does and why it exists.]

**Status:** [In design | Stable | Under revision]  
**Last updated:** [date]  
**Blueprint reference:** [link to relevant blueprint section, if any]

---

## Scope and acceptance criteria

**In scope:** [What this design covers — the bounded set of changes being made. Be explicit so that an implementation plan author knows where to start and stop.]

**Out of scope:** [What is explicitly excluded, even if adjacent or related.]

**Acceptance criteria:** Observable behaviours the component must exhibit when the work is done. Written at the interface level — not internal assertions.
- [ ] **AC-1** *(explicit | inferred)*
- [ ] **AC-2** *(explicit | inferred)*

---

## Context

[Where this component sits in the wider system. Which domain it belongs to. What problem it exists to solve. Cross-links to relevant blueprint, requirements, or sibling components.]

---

## Interface contract

### Exposed surface

[What this component provides to the outside world: HTTP endpoints, published events, consumed messages, exported API, config surface. Each item on one line with schema/shape noted briefly.]

### Dependencies

[What this component consumes from other components or infrastructure. Direction noted. Flag any backwards-pointing dependencies.]

---

## Internal structure

[Layers and their responsibilities. Key modules. Entry points for a reader new to the code. Keep at module/concept level — not a file list.]

---

## Data model

[Owned state. Key entities and relationships. Ownership boundary. Consistency guarantees. Evolution/migration strategy.]

---

## Error handling

[Expected error types. Propagation rules. Retry / idempotency. Graceful degradation. External error surface.]

---

## Test strategy

[Unit / integration / contract split. What the unit boundary is. What infrastructure is real vs. doubled in tests. Contract test ownership.]

---

## Key decisions

| Decision | Choice | Rationale | Trade-off accepted |
|---|---|---|---|
| [topic] | [what was chosen] | [why] | [what we gave up] |

---

## Known unknowns

[Any Q-NNN items deferred to a later session. Explicitly note what is unresolved and why it was deferred.]
```

---

## Anti-patterns

- **Starting with internals before the interface contract is settled.** Internal structure is downstream of the boundary. Get the boundary right first.
- **Recording decisions without rationale.** "We use event sourcing" is not a decision record. "We use event sourcing because audit log requirements demand full history; trade-off: higher complexity in read-model projections" is.
- **Over-specifying internals.** Class-level detail, method signatures, and pseudocode belong in the implementation, not the design doc.
- **Under-specifying the interface.** Vague descriptions like "exposes some endpoints" are useless to an AI session loading this file. Be precise about shapes and contracts.
- **Skipping error handling.** It is almost never documented. It is always important. Do not skip it.
- **Deferring all decisions.** Some unknowns are genuinely deferred; most can be resolved with 10 minutes of discussion. Default to resolving, not deferring.
- **Writing before the skeleton is approved.** The approval gate exists to prevent rework.
- **Confusing this with a blueprint.** Blueprint describes the system. Technical design describes one component's internals. If the conversation is sprawling into domain boundaries and service topology, escalate to [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md).

## Sibling skills

- [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md) — system-level design; precedes this skill for new systems
- [`/devenv-refine-technical-design`](../devenv-refine-technical-design/SKILL.md) — update this document as the component evolves (small, surgical changes)
- [`/devenv-redesign-component`](../devenv-redesign-component/SKILL.md) — when the current approach is no longer right and a full rethink is needed
- [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md) — exploratory option-weighing before the design is settled
- [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md) — task breakdown that draws from this document
- [`/devenv-document`](../devenv-document/SKILL.md) — documenting a component that already exists without design decisions
