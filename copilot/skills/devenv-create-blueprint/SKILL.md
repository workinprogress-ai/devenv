---
name: devenv-create-blueprint
description: 'Conduct a structured architecture interview to produce a system blueprint — a high-level, architectural description of a system or change to a system. USE WHEN the user says "create a blueprint", "design this system", "architect this", "blueprint this epic", "produce an architectural design", or hands off a requirements doc / problem description that needs architectural decomposition before any planning can begin. Produces a Blueprint-<system>-NNN.md covering shared vocabulary, domains, bounded contexts (with ubiquitous language and aggregates), components (deployable units), domain and integration events, a Context Map of cross-BC relationships, and (for brownfield work) a per-component delta. Maintains a session_memory-blueprint.md across sessions. DO NOT USE for low-level implementation planning (use /devenv-create-implementation-plan), for ordering work into milestones (use /devenv-create-roadmap once the blueprint exists), or for capturing user-level functional requirements (use /devenv-gather-requirements).'
argument-hint: '[system name | one-or-more paths to Requirements-*.md | freeform problem description]'
user-invocable: true
---

# Create Blueprint

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to emit a copyable diagnostic block for `/devenv-skill-maintenance`.

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

For very large blueprints (approaching ~1,500 lines or many components in §4), split into a subfolder with one file per section group (e.g. `01-context.md`, `02-architecture.md`, `03-components.md`, `04-risks.md`). Section numbers are continuous across files; use `<see NN-slug.md §N>` for cross-file references. Produce an `Index.md` as the canonical entry point.

For the Index.md template, see [multi-doc-projects.md](../devenv-gather-requirements/references/multi-doc-projects.md) (requirements-specific; the Index.md template structure applies to blueprints as well).

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

**Multiple requirements docs are supported.** When multiple `Requirements-<epic>-NNN.md` files are handed off: read all of them; summarise each; ask whether the blueprint covers all epics or a subset. One blueprint can span multiple docs. Cross-doc dependency edges (`Depends on: AUTH-003 (Requirements-auth-001.md)`) translate directly to cross-service dependencies in §3.2/§3.5. Category prefixes (`ORD-NNN`, `FUL-NNN`) are the natural requirements-basis references in the blueprint.

If the user provides communications artifacts (transcripts, design discussions, voice memos), dispatch the `Explore` subagent per artifact (see [Explore subagent dispatch](../_conventions.md#explore-subagent-dispatch)); surface each summary for validation before incorporating. Record the source in `session_memory-blueprint.md` so rationale can be re-traced.

#### Step 2: Probe context

- "What QoS targets matter? (latency, throughput, availability, scale)"
- "What constraints are hard? (regulatory, organisational, deadline-driven)"
- "What external systems does this integrate with?"
- "Where is consistency critical? Where is eventual consistency acceptable?"

Classify the primary component type(s) in scope before surveying architecture details:

- Service
- API gateway
- Frontend application

Use the `component-context/index.md` file from the configured Copilot knowledge location. Resolve that location from `devenv.config` `[copilot]` (`knowledge_repo`, `knowledge_subpath`) before loading context. For service-heavy work, select only the needed service context files (`01-Service-Architecture.md`, `02-Service-Implementation.md`, `03-Service-Plugins.md`). If API gateway/frontend context is not yet available, proceed with general architecture rules and record that specialized context is pending.

#### Step 3 (brownfield only): Survey the existing system

1. Run `repo-cache-update` to get the repo cache path.
2. Read `/workspaces/devenv/tools/config/repo-types.yaml` for repo naming conventions (`service.*`, `lib.cs.*`, etc.).
3. Propose a candidate repo list to the user; confirm before surveying.
4. Survey only the confirmed list (read-only): purpose, public API, events emitted/consumed, key dependencies.

Skip for greenfield.

#### Phase 1 Checkpoint

**STOP.** Present the context summary. Say:

> "Here's what I understand about the problem, requirements basis, and existing landscape. Please review:
> - Is the problem framing correct?
> - Are the QoS / constraints accurately captured?
> - (Brownfield) Are the surveyed components correct? Any I missed or shouldn't have included?
>
> When satisfied, tell me to proceed to Phase 2."

Do not proceed without explicit approval.

#### Optional pressure-test pass (user-gated)

After Phase 2 is approved and before finalizing consequences in Phase 3, offer an optional pressure-test pass using [pressure-test-protocol.md](../common/references/pressure-test-protocol.md).

- Use it to challenge boundary choices, integration/event contracts, and sequencing assumptions while edits are still cheap.
- Never run automatically; wait for explicit user consent.
- Keep it bounded to at most two passes for the current draft state.
- If findings indicate upstream architecture mismatch, pause and route to [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) before continuing.

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

Avoid technical layers like "persistence domain" or "API domain" — those aren't business domains. Push back if the user proposes one. Update the file (§4.1 Domains skeleton) before proceeding.

#### Step 4: Define Bounded Contexts within each domain

A Bounded Context is a model boundary. Within it, all terms have a single precise meaning, and the domain model is internally consistent. A domain may contain one BC (simple case) or several (when distinct internal vocabularies, teams, or models exist within it).

For each domain, propose candidate BCs with:
- **The BC name and one-sentence purpose**
- **Ubiquitous language** — terms specific to this BC, which may refine or specialise the global vocabulary from §3
- **Aggregates** — named roots with their consistency boundary and key invariants
- **Reason for a separate boundary** (if proposing more than one BC per domain)

Confirm with the user before recording; never impose BC definitions. Update the file (§4.1 BC entries) before proceeding.

#### Step 5: Define components within each Bounded Context

A component is a deployable unit — a runnable process, a service, an API gateway, a background worker, a batch processor, etc. In most cases a BC maps 1:1 to a component. One BC may contain multiple components when deployment or scaling reasons require it.

For each BC, propose the component(s) with:
- **Component name** (kebab-case, following the repo naming convention)
- **Type** — `new | existing | extended`
- **Purpose** — one sentence, business-focused
- **Whether it has a public-facing API** — if yes, flag that an API Gateway is required for auth and permission enforcement
- **Reason for multiple components** (if proposing more than one per BC)

**Brownfield — existing and extended components:** Dispatch the `Explore` subagent to read the target repo's `docs/` folder and summarise: current purpose, owned aggregates, public API, events emitted/consumed, known dependencies (see [Explore subagent dispatch](../_conventions.md#explore-subagent-dispatch)). Present the summary for validation before recording the delta.

Update the file (§4.1 Component entries) before proceeding.

#### Step 6: Map operations and events per component

For each component, collaboratively define what it handles and what it emits.

**Operations (commands handled):** Propose the component sequence and sync/async choice for each significant flow; offer the main alternative with its trade-off.

**Domain Events** (internal to BC — not a published contract): internal state transitions; consumers within the same BC.

**Integration Events** (crossing BC boundaries — a published contract): flag stability expectation; confirm classification with user before recording — breaking changes require versioning.

Update the file (§4.1 operations/events under each component) before proceeding.

#### Step 7: Build the Context Map

For each cross-BC dependency identified in Steps 4–6, propose a relationship type and explain the implication:
- **Customer/Supplier** — downstream depends on upstream; upstream should consider downstream's needs
- **Conformist** — downstream blindly adopts upstream's model; no negotiation possible
- **Anti-Corruption Layer (ACL)** — downstream wraps upstream's model via an explicit adapter; insulates from upstream changes
- **Shared Kernel** — two BCs share a model subset; changes require mutual coordination
- **Partnership** — two BCs coordinate tightly; must plan changes together

Confirm each relationship type with the user — the type has direct implications for team autonomy, change management, and integration risk. Update the file (§4.2 Context Map) before proceeding.

#### Step 8: Decide communication patterns

For each significant cross-component interaction where the sync/async choice isn't yet captured in the operations above, propose with explicit trade-offs:
> *"Between OrderService and PaymentService I'd propose async (event-driven) because payment latency is variable and we don't want order creation to wait on it. Trade-off: eventual consistency means an order can be confirmed before payment is verified — is that acceptable?"*

- Sync: immediate response, consistency critical, cost is coupling
- Async: eventual consistency acceptable, cost is complexity / ordering

Do not record the pattern without the user's agreement. Update the file (§4.3 Communication Patterns) before proceeding.

#### Step 9: Reference patterns (optional)

If a `Pattern_Library` exists in the workspace, reference relevant patterns by full GitHub URL so the blueprint stays portable. The library is **optional** — skip if not present or no patterns clearly apply. Do not invent patterns to feel architectural.

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

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
