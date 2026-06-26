---
name: devenv-grooming
description: Consolidate component-level design intake into a single grooming workflow that classifies work as option-weighing or design update, maintains the current design target state, and produces an issue attack plan (Feature/Fix/Task) grouped by repo and independent production deliverables. Always works with a grooming document — creates one if it does not exist, or loads and updates an existing one. USE WHEN the user says "groom this work", "help me decide the right design path", "which component design workflow should we use", "this plan has architectural issues", "we need to shape this feature before planning/building", or returns an in-flight implementation plan with open architectural decisions. Recommends options and trade-offs but does not make final design decisions without explicit user confirmation. DO NOT USE FOR system-level architecture decomposition (use /devenv-create-blueprint), pure implementation planning once design is settled (use /devenv-refine-implementation-plan for existing plans or /devenv-create-implementation-plan for new work), or coding execution (use /devenv-pair-programming or /devenv-delegation).
argument-hint: '[problem statement | component repo path | design doc path | implementation plan path | issue number]'
user-invocable: true
---

# Devenv Grooming

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to emit a copyable diagnostic block for `/devenv-skill-maintenance`.

Use this as the default intake for **component-level architecture and design direction** when the right next step is not obvious.

`/devenv-grooming` standardizes how we choose among the remaining design paths.

## Purpose

Grooming is the **design steward** for a piece of work. It always works with a **grooming document** — a single artifact that tracks design decisions (confirmed, pending, deferred), outstanding questions, and links to any implementation plans spawned from the work.

Grooming also produces a **suggested issue attack plan** as a set of GitHub issues classified as **Feature**, **Fix**, or **Task**. Each suggested issue must:

- map to one repo/component,
- include a size signal (`S|M|L`), and
- represent a fully deliverable production target that can ship independently.

Each suggested issue is expected to have its own implementation plan.

Given a component-level change request (from user text, issue, or returned plan), grooming either:

1. **Creates a new grooming document** and classifies the work into the right design track.
2. **Loads an existing grooming document** and surgically updates only the affected parts.

When regrooming, keep the document body focused on the current target design. Do not narrate prior states in main sections (for example, "previously" or "before" phrasing). Historical notes belong only in `## Revision History`.

Grooming recommends options and trade-offs but never finalises a design decision without explicit user confirmation.

The grooming document is mandatory, not implied. Conversational design iteration never substitutes for the written artifact.

## When to Use

Use when the user says things like:

- "Let's groom this before we implement"
- "I need to decide if this is redesign vs refinement"
- "Which design workflow should I run?"
- "This implementation plan has architectural faults"
- "We changed scope and need to reassess design direction"

Do not use for:

- System-wide architecture decomposition -> [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md)
- Pure plan/task editing with no architecture decision -> [`/devenv-refine-implementation-plan`](../devenv-refine-implementation-plan/SKILL.md)
- Coding execution -> [`/devenv-pair-programming`](../devenv-pair-programming/SKILL.md) or [`/devenv-delegation`](../devenv-delegation/SKILL.md)

## Intake flow

### Phase 0: Find or create the grooming document

Before anything else, locate the grooming document for this work.

**Step 1 — Accept input.** One of:

- Problem statement or feature description
- Component repo path
- `Architecture_and_implementation.md` path
- `Implementation_plan-*.md` path (returned from implementation)
- GitHub issue number

**Step 2 — Search for an existing grooming document.** A grooming document may live:

- On the same GH issue (as a comment or linked file)
- In a `planning.*` repo (e.g. `docs/Grooming/Grooming-<topic>-NNN.md`)
- In the component repo's `docs/` folder
- Referenced from the implementation plan's `## Reference Information` section

Ask the user if the location is not obvious:

> "Is there an existing grooming document for this work? It may be in a planning repo, on a GH issue, or alongside the implementation plan."

**Step 3 — Load or create.**

- If an existing grooming document is found: load it, show a brief status summary (confirmed decisions, pending decisions, open questions, linked plans), and ask the user to confirm before proceeding.
- If no grooming document exists: create a new one using [grooming-doc-template.md](./references/grooming-doc-template.md). Agree with the user on the location and filename (`Grooming-<topic>-NNN.md`) before writing.

Do not continue to Phase 1 until the grooming document exists either on disk or as an issue artifact. If the session started conversationally and no artifact exists yet, stop and create it before continuing.

For every grooming artifact (local file or issue comment), follow the shared [Artifact Identity Convention](../_conventions.md#artifact-identity-convention) with `artifact_type: grooming`.

- Always keep the `DEVENV_ARTIFACT_V1` header at the top of the artifact body (with `doc_id` in the first 256 characters).
- For local files, generate deterministic `doc_id` as `dv1:<owner-repo>:local:grooming:<artifact-slug>`.

If the grooming document is stored in a GitHub issue comment:

- Generate `doc_id` with `issue-artifact-doc-id --issue <N> --artifact-type grooming --slug <artifact-slug>`
- Update via `issue-artifact-upsert` rather than manual comment matching

**Step 4 — Classify component type** (needed for context loading):

- Service
- API gateway
- Frontend application

Then use the `component-context/index.md` file from the configured Copilot knowledge location. Resolve that location from `devenv.config` `[copilot]` (`knowledge_repo`, `knowledge_subpath`) before loading context. For services, choose among `01-Service-Architecture.md`, `02-Service-Implementation.md`, and `03-Service-Plugins.md` as needed.

**Step 5 — If input is a returned implementation plan:** run the [plan architectural review protocol](../common/references/plan-architectural-review.md) to produce a scoped architectural brief, then map its pending decisions back to the grooming document's `Pending` table before Phase 1.

### Phase 1: Classification interview (max 4 questions)

Ask only what is missing (the grooming document may already answer some of these):

1. Is the approach still undecided, or already chosen?
2. Is this a new component or an existing component?
3. For existing components: are we patching drift/gaps, or replacing the core approach?
4. Is the relevant `docs/Architecture_and_implementation.md` up to date?

### Phase 2: Route with rationale

Respond with:

- **Recommended skill**
- **Why this is the best fit (1-2 sentences)**
- **Also consider** (optional fallback)
- **Start command** (`Say /skill-name to start.`)

If the user asks you to continue directly, continue in the selected track's style and constraints.

## Routing guardrails

- If the user primarily needs alternatives/trade-offs -> route to `/devenv-design-discussion`.
- If existing design doc mostly stands and only sections changed -> stay in grooming and produce the doc delta for the current work.
- If this is really task-level reprioritization with no architecture shift -> route back to `/devenv-refine-implementation-plan`.
- If the session needs a formal component design artifact, keep working in grooming until the design boundary is explicit and ready to write down.

### Issue attack plan construction rules

When grooming is active, propose a deliverable issue attack plan in issue-sized slices:

- Use **Feature** for net-new user/business capability.
- Use **Fix** for defect/risk remediation.
- Use **Task** for enabling or operational work that does not stand as user-facing capability.
- Split by repo/component and independent production deliverability.
- Avoid bundles that require multiple repos to be completed before anything can ship.

Placement guidance:

- **Single repo + small/medium scope:** one issue can be enough; grooming and implementation plan may live on the same GitHub issue.
- **Multiple repos/components or multiple production deliverables:** grooming should live at epic level (typically in a planning repo issue) and coordinate multiple downstream implementation-plan issues.

The grooming document is the coordination artifact across those implementation plans.

### Upstream artifact intake policy

Design-discussion and spike artifacts should normally flow through grooming before implementation planning.

- For straightforward cases, grooming may be brief: capture key decisions/constraints from the upstream artifact, generate the issue attack plan, and then hand off to implementation-plan generation.
- Do not route design-discussion/spike output directly to implementation planning unless the user explicitly asks to bypass grooming.

### Decision rules (explicit handoff)

- **Precedence rule:** if an `Implementation_plan-*.md` is in-flight and the user's goal is to unblock active implementation, stay in `/devenv-grooming` by default and facilitate decision closure here.
- Route to `/devenv-design-discussion` when two or more viable approaches are still live and the team needs an explicit recommendation.
- Route to `/devenv-design-discussion` for a single large blocker/question when it needs deeper option-weighing, but the expected outcome is still a bounded plan change rather than a broader design reset.
- Stay in grooming when the approach is already chosen and the work is to capture/update the architecture delta for in-flight implementation.
- Stay in grooming when questions are accumulating, multiple decisions are entangled, or the current design may need sweeping revision, replacement, or upstream artifact changes.
- Route to `/devenv-refine-implementation-plan` when architecture is settled and the remaining work is sequencing/scope edits in tasks.
- If uncertain between grooming and design-discussion after Phase 1, ask one tie-breaker question: "Are we deciding between approaches broadly, or picking the fastest safe decision to unblock the current plan phase?"

### Artifact gate before any implementation handoff

Before routing onward to implementation planning or execution, verify all of the following:

- A grooming document already exists on disk or as an issue artifact.
- The current design decisions are recorded in that document's `Confirmed`, `Pending`, or `Deferred` tables.
- Any decisions discussed in the current session have been written into the document before proposing the next skill.

If any of those checks fail, write or update the grooming document first. Never treat conversational design iteration as a substitute for the written artifact.

When the user signals closure with ambiguous phrases like "let's do it", "let's write it", or "go ahead":

- In an active grooming session, default "it" to the grooming artifact, not production code.
- If the user's intent is still unclear, ask: "Do you want me to write/update the grooming document now, or are you asking to hand off to implementation work?"
- Do not create code, project files, or implementation scaffolding from grooming unless the user explicitly asks to leave grooming and start the next skill.

### Optional pressure-test pass (user-gated)

Before final routing or decision closure on medium/high-impact design choices, offer an optional pressure-test pass using [pressure-test-protocol.md](../common/references/pressure-test-protocol.md).

- Never run automatically; ask and wait for explicit consent.
- Keep it bounded (max two passes per current grooming-doc state).
- Use findings to either close decisions safely in grooming, route one bounded blocker to `/devenv-design-discussion`, or route broader drift to upstream design reshaping.

### In-flight decision facilitation loop

When the input is an in-flight plan with pending architectural decisions, run a conversational loop one decision at a time:

1. Surface the decision with source evidence (phase/task/decision marker in the plan).
2. Present 2-3 viable options with trade-offs.
3. Give a recommendation and why.
4. Ask the user to choose (or explicitly defer).
5. Record the confirmed/deferred outcome in the grooming document immediately.
6. Repeat for the next unresolved decision.

Do not batch-resolve all decisions in one monologue and do not proceed as if decisions are closed until the user confirms each one.
If no grooming document exists yet, create it before recording the first confirmed or deferred outcome.

### Surgical grooming document updates

When iterating on a returned plan, update the grooming document **only in the affected parts**. Never rewrite unrelated decisions or questions.

For each resolved decision:
- Move the row from `Pending` → `Confirmed` with the chosen option, rationale, and date.
- Leave all other `Pending` rows untouched.

For each deferred decision:
- Move the row from `Pending` → `Deferred` with a reason and a revisit trigger.

For each resolved question:
- Update its status to `[resolved]` with the resolution text inline.

After updates, show the user a summary of what changed in the grooming document and confirm before writing.

When all architecture/design decisions required for execution are confirmed, explicitly hand off plan/task updates to [`/devenv-refine-implementation-plan`](../devenv-refine-implementation-plan/SKILL.md) instead of editing the implementation plan directly in grooming.
Do not hand off until the grooming document on disk or on the issue reflects those confirmed decisions.

### Current-target writing rule (required)

- Keep `## Design decisions`, `## Outstanding questions`, and `## Design notes` written as the current target state.
- Do not include narrative comparisons to prior designs in those sections.
- If a change from an earlier design must be recorded, put it in `## Revision History` only.

## Escalation compatibility

This skill is escalation-aware:

- If invoked from `/devenv-pair-programming` or `/devenv-delegation` handoff context, preserve escalation evidence and classification context.
- Keep the deterministic marker format from the shared decision protocol when quoting handoff excerpts.

See [decision-resolution-protocol.md](../common/references/decision-resolution-protocol.md).

## Output format

**Routing recommendation** (when classifying and routing):

```text
Recommended: `/skill-name`
Why: <fit rationale>

Also consider:
- `/other-skill` — <when that would be better>

Say `/skill-name` to start.
```

Omit "Also consider" when unnecessary.

**Grooming document status summary** (shown when a grooming doc is loaded):

```text
Grooming doc: <path or issue ref>
Confirmed decisions: N
Pending decisions: N  (<titles>)
Open questions: N
Linked plans: N
```

**Suggested attack plan** (required when scope is being shaped):

```text
Suggested issue attack plan:

1. [Feature] <title>
	Repo: <repo>
	Size: <S|M|L>
	Independent production target: yes/no (if no, split further)
	Planned implementation artifact: <issue + Implementation_plan-...>

2. [Fix] <title>
	Repo: <repo>
	Size: <S|M|L>
	Independent production target: yes/no
	Planned implementation artifact: <issue + Implementation_plan-...>
```

**Per-decision facilitation** (one at a time):

```text
Decision: <short decision title>
Evidence: <where this appears in plan/issue>

Options:
- A: <trade-offs>
- B: <trade-offs>
(- C: <trade-offs>, optional)

Recommendation: <A|B|C> because <reason>
Your call: choose A/B(/C) or defer.
```

## Anti-patterns

- Running a full design session before classifying.
- Routing to redesign just because implementation is hard.
- Routing to grooming for an existing component that already has a healthy design doc.
- Ignoring plan-provided context when a plan path/issue is supplied.
- Suggesting implementation skills before architecture path is settled.
- Treating recommendations as decisions without explicit user confirmation.
- Dumping all pending decisions at once and moving on without interactive closure.
- Skipping Phase 0 (grooming document lookup) and working without a grooming document.
- Creating a new grooming document without first searching for an existing one.
- Rewriting unrelated parts of the grooming document when doing a surgical update from a returned plan.
- Writing "previously/before" design narrative in main document sections instead of `## Revision History`.

## Sibling skills

- [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md)
- [`/devenv-refine-implementation-plan`](../devenv-refine-implementation-plan/SKILL.md)

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
