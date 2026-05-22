---
name: devenv-create-blueprint
description: 'Conduct a structured architecture interview to produce a system blueprint — a high-level, architectural description of a system or change to a system. USE WHEN the user says "create a blueprint", "design this system", "architect this", "blueprint this epic", "produce an architectural design", or hands off a requirements doc / problem description that needs architectural decomposition before any planning can begin. Produces a Blueprint-<system>-NNN.md covering shared vocabulary, domains, bounded contexts (with ubiquitous language and aggregates), components (deployable units), domain and integration events, a Context Map of cross-BC relationships, and (for brownfield work) a per-component delta. Maintains a session_memory-blueprint.md across sessions. DO NOT USE for low-level implementation planning (use /devenv-create-implementation-plan), for ordering work into milestones (use /devenv-create-roadmap once the blueprint exists), or for capturing user-level functional requirements (use /devenv-gather-requirements).'
argument-hint: '[system name | one-or-more paths to Requirements-*.md | freeform problem description]'
user-invocable: true
---

# Create Blueprint

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

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

**Write the file early.** Write the initial draft at the start of Phase 2 — before domain and service decisions are made — and keep it updated as each Phase 2 step is completed. The user reviews markdown on disk, not chat output. Reviewing a file is easier than reading back through a conversation. The file is a working draft until Phase 3 is approved; mark it `Status: Draft` throughout and update it in place after each step.

Update `session_memory-blueprint.md` to track decisions and open questions across sessions, but the blueprint file itself is the primary review surface from Phase 2 onward.

### Splitting a large blueprint into multiple files

A single-file blueprint is the right default. For very large systems — many components, deep architecture, or a blueprint that has grown past comfortable reading length — split into multiple files. Splitting a blueprint is by **section** (not by epic; that's the requirements layer's job).

**When to split:**
- The single-file blueprint is approaching ~1,500 lines
- §4 Per-Component Changes contains so many components that no one can hold it in their head
- Different audiences need different parts (architects read §3; per-team leads read their slice of §4)
- The user explicitly asks to split it

**Split layout:** the blueprint becomes a **subfolder** in place of the single file:

```
docs/Architecture/
  Blueprint-orders-001/
    Index.md
    01-context.md         # §1 Context, §2 Domains
    02-architecture.md    # §3 Architecture (services, events, operations)
    03-components.md      # §4 Per-Component Changes
    04-risks.md           # §5 Risks, §6 Open Questions
```

Common split boundaries (offer these to the user; let them pick or override):
- **By section group** (default): `01-context.md`, `02-architecture.md`, `03-components.md`, `04-risks.md`
- **By domain within §3-§4** when there are several: `02-architecture-orders.md`, `02-architecture-fulfillment.md`, `03-components-orders.md`, `03-components-fulfillment.md`
- **A hybrid** when only one section is oversized

**File naming inside the subfolder:** `NN-<section-slug>.md` so files sort in canonical order.

**Section numbering is preserved across files.** A reader navigating from §3.2.5 to §4.1 follows the file boundary; the numbers themselves do not restart per file.

**Cross-file references** use the form `<see 02-architecture.md §3.2.5>` rather than just `§3.2.5`, so a reader knows which file to open.

**An `Index.md` is mandatory** when the blueprint is split. See *Index.md for multi-file artifacts* below.

### Index.md for multi-file artifacts

Whenever a planning artifact spans multiple files (split blueprint here; multi-doc requirements in [`/devenv-gather-requirements`](../devenv-gather-requirements/SKILL.md)), produce an `Index.md` alongside the files.

For a split blueprint, write `docs/Architecture/Blueprint-<system>-NNN/Index.md` with this structure:

```markdown
# Blueprint: <system> — Index

> Split blueprint. The full architectural design is spread across the files below.
> All section numbers are continuous across files — use the section map to locate any §N reference.

## Files

| File | Sections | Purpose |
|---|---|---|
| [01-context.md](01-context.md) | §1, §2 | Problem, requirements basis, domains, system survey |
| [02-architecture.md](02-architecture.md) | §3 | Services, events, operations, communication patterns |
| [03-components.md](03-components.md) | §4 | Per-component changes (deltas) |
| [04-risks.md](04-risks.md) | §5, §6 | Risks, open questions |

## Section map

- §1 Context → 01-context.md
- §2 Domains → 01-context.md
- §3 Architecture → 02-architecture.md
  - §3.1 Services
  - §3.2 Service dependencies
  - §3.3 Operations
  - §3.4 Events
  - §3.5 Communication patterns
- §4 Per-Component Changes → 03-components.md
  - §4.1 service.commerce.inventory
  - §4.2 service.commerce.fulfillment-orchestrator (new)
  - …
- §5 Risks → 04-risks.md
- §6 Open Questions → 04-risks.md

## Requirements basis

- [Requirements-orders-001.md](../../Requirements/Requirements-orders-001.md) (`ORD-NNN`)
- [Requirements-fulfillment-001.md](../../Requirements/Requirements-fulfillment-001.md) (`FUL-NNN`)

## Sibling blueprints (cross-blueprint references)

- None

## Revision history

Each file maintains its own `## Revision History` section. Most recent edits across the whole blueprint:

- 2026-05-13 — Added §3.2.7 reservation TTL (see [02-architecture.md](02-architecture.md))
- 2026-05-12 — Initial split from `Blueprint-orders-001.md`
```

Key rules for `Index.md`:
- The Index is **navigation, not content** — do not duplicate prose from the part files
- Update the section map whenever a section is added, split, or moved between files
- If the blueprint started as a single file and was later split, record the split as the first revision-history entry
- `Index.md` is the canonical entry point — link to it from roadmaps, parent epics, and other blueprints, never to a specific part file unless deep-linking to a section

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
4. "Are there meeting transcripts, email threads, design discussions, voice memos, or other communications records that capture architectural context or decisions? If so, where are they?"

If one or more `Requirements-*.md` files exist, read them and summarise the key actors/scenarios/constraints back to the user before going further.

**Multiple requirements docs are supported.** A multi-epic project may produce one `Requirements-<epic>-NNN.md` per epic (see [`/devenv-gather-requirements`](../devenv-gather-requirements/SKILL.md) §*Multi-document projects*). When multiple docs are handed off:

- Read all of them. Summarise each separately back to the user, then ask whether the blueprint should cover the whole project or only a subset of the epics.
- One blueprint can span multiple requirements docs — it is not required to be one-blueprint-per-doc. The choice depends on whether the epics share enough architecture to warrant a unified design.
- If the user wants separate blueprints per epic (or per cluster of epics), run this skill once per intended blueprint. Each invocation is a separate `Blueprint-<system>-NNN.md`. Cross-blueprint references use `<see Blueprint-<other-system>-NNN.md §X>` in the relevant section.
- Cross-doc dependency edges in the requirements (`Depends on: AUTH-003 (Requirements-auth-001.md)`) translate naturally into cross-service dependencies in §3.2 / §3.5 of the blueprint(s).
- The category prefix per requirements doc (e.g. `ORD-NNN`, `FUL-NNN`) becomes the natural way the blueprint references back to the requirements basis.

If the user provides communications artifacts:

1. **Summarise each one separately.** Prefer dispatching the `Explore` subagent (one invocation per artifact, in parallel where possible) with a prompt like *"Read FILE and produce a structured summary covering: architectural decisions discussed, components/services mentioned, integration points, QoS/constraint statements, trade-offs raised, and open architectural questions. Quote verbatim where wording matters."*
2. **Surface each summary back to the user** for confirmation before incorporating it. Ask: *"Does this match what was discussed? Anything mischaracterised?"*
3. **Use the approved summaries as input to Phase 2** — they often pre-answer domain boundaries, service ownership, sync/async choices, and constraint sources.
4. **Record the source in `session_memory-blueprint.md`** (e.g. "§3.2.4 service boundary follows 2026-04-18 architecture sync") so the rationale can be re-traced. The blueprint itself doesn't need to embed the communications — references are enough.

#### Step 2: Probe context

- "What QoS targets matter? (latency, throughput, availability, scale)"
- "What constraints are hard? (regulatory, organisational, deadline-driven)"
- "What external systems does this integrate with?"
- "Where is consistency critical? Where is eventual consistency acceptable?"

#### Step 3 (brownfield only): Survey the existing system

When the project extends an existing system, you need to know what's already there.

1. **Get the repo cache**: run `repo-cache-update`. This returns a path to a folder containing all organisation repos.
2. **Read the taxonomy**: `/workspaces/devenv/tools/config/repo-types.yaml` defines the naming patterns for repo types (`service.*`, `lib.cs.*`, `app.web.*`, etc.). Use it to interpret repo names.
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

**Goal:** Collaboratively decompose the system into shared vocabulary, domains, bounded contexts, components, operations, and events. For brownfield, capture the delta per component.

**Write the draft file now.** Before doing any architectural work, write `Blueprint-<system>-NNN.md` to disk using the template, with `Status: Draft`, and the context from Phase 1 filled into §1 and §2. All architectural sections are empty stubs. This gives the user a file to review against from this point forward. Announce the file path.

Then work through the steps below. After completing each step, update the file on disk before moving to the next. The user should be reviewing the file, not the chat.

**The collaborative rule:** At every decision point below, **propose options with trade-offs and ask the user to decide.** The user owns domain boundaries, bounded context definitions, and component decompositions — never impose these unilaterally. If one option is clearly stronger, say so and explain why — but still ask for confirmation before recording it.

#### Step 1: Identify business capabilities

From the requirements and context, list the main things the system needs to do in domain language. Group related capabilities.

Propose the groupings to the user:
> *"I see these natural capability groups. Do these groupings make sense, or do you see them differently?"*

Do not move to Step 2 until the user confirms the capability map.

#### Step 2: Establish shared vocabulary

Before drawing any boundaries, surface terms that matter at the system level — terms that should mean the same thing everywhere across the blueprint. These are concepts multiple parts of the system will reference.

Propose an initial list based on the requirements and capability map:
> *"Here are terms I think need a shared definition before we start drawing boundaries. Does this list feel right? Any to add, remove, or refine?"*

Record agreed terms in §3 of the blueprint file before proceeding.

#### Step 3: Define domains

For each candidate domain, propose it with:
- **Proposed boundary** — what's in, what's out
- **Why this is a natural boundary** — one sentence
- **Alternative** — what would change if this were split differently or merged with another domain

Present all candidate domains together, then ask:
> *"Do these domain boundaries make sense? Any that should be merged, split, or redrawn?"*

Avoid technical layers like "persistence domain" or "API domain" — those aren't business domains. Push back if the user proposes one.

Update the file (§4.1 Domains skeleton) before proceeding.

#### Step 4: Define Bounded Contexts within each domain

A Bounded Context is a model boundary. Within it, all terms have a single precise meaning, and the domain model is internally consistent. A domain may contain one BC (simple case) or several (when distinct internal vocabularies, teams, or models exist within it).

For each domain, propose candidate BCs with:
- **The BC name and one-sentence purpose**
- **Ubiquitous language** — terms specific to this BC, which may refine or specialise the global vocabulary from §3
- **Aggregates** — named roots with their consistency boundary and key invariants
- **Reason for a separate boundary** (if proposing more than one BC per domain)

Ask the user to confirm or adjust before recording. Never impose BC definitions.

Update the file (§4.1 BC entries) before proceeding.

#### Step 5: Define components within each Bounded Context

A component is a deployable unit — a runnable process, a service, an API gateway, a background worker, a batch processor, etc. In most cases a BC maps 1:1 to a component. One BC may contain multiple components when deployment or scaling reasons require it.

For each BC, propose the component(s) with:
- **Component name** (kebab-case, following the repo naming convention)
- **Type** — `new | existing | extended`
- **Purpose** — one sentence, business-focused
- **Whether it has a public-facing API** — if yes, flag that an API Gateway is required for auth and permission enforcement
- **Reason for multiple components** (if proposing more than one per BC)

**Brownfield — existing and extended components:** Use the `Explore` subagent to read the target repo's `docs/` folder and produce a structured summary: current purpose, owned aggregates, public API, events emitted/consumed, known dependencies. Present the summary to the user and ask:
> *"Does this accurately describe the current state? Anything I've misread or missed?"*
Only record the brownfield delta after the user confirms the current-state description.

Ask the user to confirm the component decomposition before recording.

Update the file (§4.1 Component entries) before proceeding.

#### Step 6: Map operations and events per component

For each component, collaboratively define what it handles and what it emits.

**Operations (commands handled):** For each significant flow, propose the sequence of components involved and the sync/async choice. Use this format:
> *"`CreateOrder`: I'd suggest this flows: API Gateway → OrderService (owns the aggregate) → emits `OrderConfirmed` → FulfillmentService picks up async. Alternative: FulfillmentService is called sync before the order is committed, which guarantees consistency at the cost of coupling. Which do you prefer?"*

**Domain Events** (internal to the BC — not a published contract): propose events as internal state transitions. Consumers are within the same BC.

**Integration Events** (crossing BC boundaries — these are a published contract): flag their stability expectation explicitly. Breaking changes to integration events require versioning. Ask the user to confirm each event's classification (domain vs. integration) before recording it — this has implications for how stable and backwards-compatible it needs to be.

Update the file (§4.1 operations/events under each component) before proceeding.

#### Step 7: Build the Context Map

For each cross-BC dependency identified in Steps 4–6, propose a relationship type and explain the implication:
- **Customer/Supplier** — downstream depends on upstream; upstream should consider downstream's needs
- **Conformist** — downstream blindly adopts upstream's model; no negotiation possible
- **Anti-Corruption Layer (ACL)** — downstream wraps upstream's model via an explicit adapter; insulates from upstream changes
- **Shared Kernel** — two BCs share a model subset; changes require mutual coordination
- **Partnership** — two BCs coordinate tightly; must plan changes together

Ask the user to confirm each relationship type — the type has direct implications for team autonomy, change management, and integration risk.

Update the file (§4.2 Context Map) before proceeding.

#### Step 8: Decide communication patterns

For each significant cross-component interaction where the sync/async choice isn't yet captured in the operations above, propose with explicit trade-offs:
> *"Between OrderService and PaymentService I'd propose async (event-driven) because payment latency is variable and we don't want order creation to wait on it. Trade-off: eventual consistency means an order can be confirmed before payment is verified — is that acceptable?"*

- Sync: immediate response, consistency critical, cost is coupling
- Async: eventual consistency acceptable, cost is complexity / ordering

Do not record the pattern without the user's agreement.

Update the file (§4.3 Communication Patterns) before proceeding.

#### Step 9: Reference patterns (optional)

If a `Pattern_Library` exists in the workspace (typically `repos/docs.engineering/docs/Pattern_Library/`), reference relevant patterns by full GitHub URL so the blueprint stays portable. The library is **optional** — skip if not present or no patterns clearly apply. Do not invent patterns to feel architectural.

#### Phase 2 Checkpoint

**STOP.** The blueprint file on disk now contains the full architecture draft. Point the user to the file and say:

> "The draft blueprint is at `[file path]`. Please review it there — it's easier to read in markdown than in chat.
>
> Check:
> - Shared vocabulary (§3) — any missing or mischaracterised terms?
> - Domain boundaries (§4.1) — do they feel right?
> - Bounded context definitions — vocabulary and aggregates correct?
> - Component decomposition — anything that should be merged, split, or renamed?
> - Operations and events — anything missing or wrong? Domain vs. integration classification correct?
> - Context Map (§4.2) — relationship types accurate?
> - Per-component brownfield deltas — complete and accurate?
>
> When you're satisfied, tell me to proceed to Phase 3."

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
- [ ] Shared vocabulary (§3) is defined — terms apply system-wide
- [ ] Domains are well-defined and bounded; no technical layers masquerading as domains
- [ ] Bounded contexts are clearly delimited with ubiquitous language and aggregates defined
- [ ] (Brownfield) Existing components surveyed and current-state confirmed with user
- [ ] Components are loosely coupled and independently deployable
- [ ] Domain events vs. integration events are classified correctly
- [ ] Operations are traced end-to-end through components
- [ ] Context Map records cross-BC relationship types
- [ ] Communication patterns (sync/async) are justified
- [ ] Public-facing components are flagged as requiring an API Gateway
- [ ] Consequences are documented (positive, negative, mitigations)
- [ ] Patterns referenced (if any) link to full URLs
- [ ] Assumptions and gaps are documented
- [ ] Blueprint is at the right level (sketch, not specification)

#### Phase 3 Checkpoint

**STOP.** The blueprint file has been updated with consequences, mitigations, and gaps. Update `Status: Draft` → `Status: Approved` only on explicit user sign-off. Say:

> "The blueprint is at `[file path]` and now includes consequences, risks, and open questions. Please give it a final read.
>
> When you're satisfied, say 'approved' and I'll mark it `Status: Approved`."

Do not mark it approved without explicit confirmation. The file is already on disk; no separate write step is needed.

---

## After the Blueprint Exists

Once written, surface the next-step options to the user:

- **Need to plan delivery order and create issues?** → [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md)
- **Need detailed task-level plans for a component?** → [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md) or [`/devenv-plan-from-spec`](../devenv-plan-from-spec/SKILL.md)
- **Architecture changed mid-stream?** → [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md)
- **Underlying requirements changed?** → [`/devenv-refine-requirements`](../devenv-refine-requirements/SKILL.md)
- **Specific design or coding-approach question surfaced during implementation?** → [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md)

## Anti-patterns

- Holding back the file until Phase 3 — write the draft at the start of Phase 2 and keep it updated
- Making domain, bounded-context, or component decomposition decisions unilaterally — always propose with trade-offs and ask
- Conflating blueprint with implementation plan (no per-task detail in a blueprint)
- Designing in technologies (`PostgreSQL`, `Kafka`) before designing in domains
- Using technical layers as domain names ("persistence domain", "API domain")
- Conflating domain events (internal) with integration events (published contract) — always clarify the classification
- Forgetting to flag public-facing components as requiring an API Gateway
- Skipping the brownfield survey and inventing component descriptions that may be wrong
- Using the `Explore` subagent for brownfield repo docs without confirming the summary with the user before recording it
- Inventing pattern references just to look architectural
- Treating `repo-cache-update` output as authoritative without user confirmation of relevance
- Forgetting to update `session_memory-blueprint.md` between sessions
