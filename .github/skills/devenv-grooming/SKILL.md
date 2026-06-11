---
name: devenv-grooming
description: Consolidate component-level design intake into a single grooming workflow that classifies work as option-weighing or design update, then handles the current design-doc delta for the work in flight. USE WHEN the user says "groom this work", "help me decide the right design path", "which component design workflow should we use", "this plan has architectural issues", or "we need to shape this feature before planning/building". Supports plan/issue/path input and uses plan architectural review when a plan is provided. DO NOT USE FOR system-level architecture decomposition (use /devenv-create-blueprint), pure implementation planning once design is settled (use /devenv-create-implementation-plan), or coding execution (use /devenv-pair-programming or /devenv-delegation).
argument-hint: '[problem statement | component repo path | design doc path | implementation plan path | issue number]'
user-invocable: true
---

# Devenv Grooming

Use this as the default intake for **component-level architecture and design direction** when the right next step is not obvious.

`/devenv-grooming` standardizes how we choose among the remaining design paths.

## Purpose

Given a component-level change request (from user text, issue, or plan), quickly classify the work into one of two tracks:

1. **Option-weighing needed** -> [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md)
2. **Design update needed for work in flight** -> stay in grooming and record the delta against the current architecture doc before planning or implementation continues.

When the request is already unambiguous, skip extra questions and route immediately.

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

### Phase 0: Confirm input type

Accept one of:

- Problem statement
- Component repo path
- `Architecture_and_implementation.md` path
- `Implementation_plan-*.md` path
- GitHub issue number

If the input is a plan path or issue linked to a plan, run the [plan architectural review protocol](../common/references/plan-architectural-review.md) first and summarize a scoped architectural brief.

Before Phase 1, classify the component type:

- Service
- API gateway
- Frontend application

Then use [`component-context/index.md`](../common/references/component-context/index.md) to load only relevant component context when needed. For services, load only the necessary file(s): `01-Service-Architecture.md`, `02-Service-Implementation.md`, and/or `03-Service-Plugins.md`.

### Phase 1: Classification interview (max 4 questions)

Ask only what is missing:

1. Is the approach still undecided, or already chosen?
2. Is this a new component or an existing component?
3. For existing components: are we patching drift/gaps, or replacing the core approach?
4. Is there a current `docs/Architecture_and_implementation.md`?
5. What component type are we grooming (service, API gateway, or frontend application)?

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

### Decision rules (explicit handoff)

- Route to `/devenv-design-discussion` when two or more viable approaches are still live and the team needs an explicit recommendation.
- Stay in grooming when the approach is already chosen and the work is to capture/update the architecture delta for in-flight implementation.
- Route to `/devenv-refine-implementation-plan` when architecture is settled and the remaining work is sequencing/scope edits in tasks.
- If uncertain between grooming and design-discussion after Phase 1, ask one tie-breaker question: "Are we deciding between approaches, or documenting a chosen approach?"

## Escalation compatibility

This skill is escalation-aware:

- If invoked from `/devenv-pair-programming` or `/devenv-delegation` handoff context, preserve escalation evidence and classification context.
- Keep the deterministic marker format from the shared decision protocol when quoting handoff excerpts.

See [decision-resolution-protocol.md](../common/references/decision-resolution-protocol.md).

## Output format

Use this exact concise structure:

```text
Recommended: `/skill-name`
Why: <fit rationale>

Also consider:
- `/other-skill` — <when that would be better>

Say `/skill-name` to start.
```

Omit "Also consider" when unnecessary.

## Anti-patterns

- Running a full design session before classifying.
- Routing to redesign just because implementation is hard.
- Routing to grooming for an existing component that already has a healthy design doc.
- Ignoring plan-provided context when a plan path/issue is supplied.
- Suggesting implementation skills before architecture path is settled.

## Sibling skills

- [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md)
- [`/devenv-refine-implementation-plan`](../devenv-refine-implementation-plan/SKILL.md)

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
