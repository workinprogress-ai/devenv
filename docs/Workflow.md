# Workflow Guide

This document describes the delivery methodology used in this workspace.

The workflow stands on its own regardless of who is doing the work: a human engineer, an AI assistant, or a mix of both. The Devenv skills are one way to carry out this workflow consistently, but they are not the workflow itself.

Use this guide when you want the end-to-end methodology rather than a tool catalog.

## Core idea

The workflow moves downward through a stack of increasingly specific artifacts:

```text
Idea / request
  -> Requirements
  -> Blueprint
  -> Grooming
  -> Implementation plan
  -> Execution
  -> Review / merge
```

Each layer answers a different question:

- Requirements: what should the system do?
- Blueprint: how should the system be structured at the system level?
- Grooming: what is the current component-level design direction or design delta?
- Implementation plan: what are the executable phases and tasks?
- Execution: build and validate the work.

The important rule is that you do not skip to a lower layer when the uncertainty still belongs to an upper layer.

## Default delivery flow

This is the normal happy path.

```text
Raw idea / request
  |
  v
Requirements
  |
  v
Blueprint
  |
  v
Grooming
  |
  v
Implementation plan
  |
  +--> Execution: collaborative / high-impact mode
  |
  +--> Execution: delegated / mechanical mode
          |
          v
      Review / merge / follow-up feedback
```

In Devenv, the usual skill mapping is:

- Requirements -> `/devenv-gather-requirements`
- Blueprint -> `/devenv-create-blueprint`
- Grooming -> `/devenv-grooming`
- Implementation plan -> `/devenv-create-implementation-plan`
- Collaborative execution -> `/devenv-pair-programming`
- Delegated execution -> `/devenv-delegation`
- Review / merge -> `/devenv-pre-commit`, `/devenv-open-pr`, `/devenv-address-pr-comments`

Supporting view: the same happy path with Devenv skill support looks like this:

```text
Raw idea / request
  |
  v
Requirements
  |   supported by: /devenv-gather-requirements
  v
Blueprint
  |   supported by: /devenv-create-blueprint
  v
Grooming
  |   supported by: /devenv-grooming
  v
Implementation plan
  |   supported by: /devenv-create-implementation-plan
  v
Execution
  |   supported by: /devenv-pair-programming
  |              or /devenv-delegation
  v
Review / merge / follow-up feedback
      supported by: /devenv-pre-commit
                 -> /devenv-open-pr
                 -> /devenv-address-pr-comments
```

Read this as tool support layered onto the workflow, not as a replacement for the workflow itself.

## Choose the execution mode

Once a plan exists, execution branches by risk and collaboration needs.

```text
Implementation plan exists?
  |
  +-- no  --> Create or refine the plan first
  |
  +-- yes --> Is the work high-impact, novel, or strongly collaborative?
                |
                +-- yes --> Collaborative execution
                |
                +-- no  --> Delegated / mechanical execution
```

Methodologically:

- Use collaborative execution when the human should stay tightly involved in decisions.
- Use delegated execution when the work is mostly mechanical and review can happen at larger checkpoints.

In Devenv, that usually maps to `/devenv-pair-programming` vs `/devenv-delegation`.

Supporting view with skill selection:

```text
Implementation plan exists?
  |
  +-- no  --> /devenv-create-implementation-plan
  |
  +-- yes --> Is the work high-impact, novel, or strongly collaborative?
                |
                +-- yes --> /devenv-pair-programming
                |
                +-- no  --> /devenv-delegation
```

## Plan problems during execution

When execution reveals that the plan or design is wrong, route by problem size and blast radius.

```text
Execution discovers a problem
  |
  +-- Small local problem / question
  |      |
  |      +--> Resolve locally
  |      +--> Update the plan in place
  |      +--> Continue execution
  |
  +-- Single large blocker / design question
  |      |
  |      +--> Focused design discussion
  |      +--> Update the plan
  |      +--> Continue execution
  |
  +-- Accumulated questions / architectural drift
  |      |
  |      +--> Return to grooming
  |      +--> Re-settle the design direction
  |      +--> Refresh the plan
  |      +--> Continue execution
  |
  +-- Upstream architecture artifact is wrong
         |
         +--> Go back up to blueprint-level work
         +--> Then flow back down through grooming and plan refresh
```

Rule of thumb:

- One bounded blocker that should change only a limited slice of the plan: use a focused design discussion.
- Multiple entangled questions, broader design drift, or likely sweeping plan redesign: return to grooming.
- If architecture is already settled and only tasks/phases need to change: refresh the implementation plan.

In Devenv, the usual mapping is:

- Small local issue -> stay in `/devenv-pair-programming` or `/devenv-delegation`
- Focused design discussion -> `/devenv-design-discussion`, then `/devenv-refine-implementation-plan`
- Broader reshaping -> `/devenv-grooming`, then `/devenv-refine-implementation-plan`
- Upstream architecture change -> `/devenv-refine-blueprint`, then grooming and plan refresh

Supporting view with skill mapping:

```text
/devenv-pair-programming or /devenv-delegation
  |
  v
Problem discovered in the plan or design
  |
  +-- Small local problem / question
  |      -> stay in the execution skill
  |
  +-- Single large blocker / design question
  |      -> /devenv-design-discussion
  |      -> /devenv-refine-implementation-plan
  |      -> back to execution
  |
  +-- Accumulated questions / architectural drift
  |      -> /devenv-grooming
  |      -> /devenv-refine-implementation-plan
  |      -> back to execution
  |
  +-- Upstream architecture artifact is wrong
         -> /devenv-refine-blueprint
         -> /devenv-grooming
         -> /devenv-refine-implementation-plan
         -> back to execution
```

### Pivot rule: bounded blocker becomes broader redesign

Sometimes a problem looks like one bounded blocker but turns out to expose a broader design fault.

```text
Focused design discussion starts
  |
  +-- stays bounded
  |      -> finish the discussion
  |      -> update the plan
  |      -> resume execution
  |
  +-- reveals broader design drift
         -> stop treating it as a one-question discussion
         -> return to grooming
         -> re-settle the broader design
         -> refresh the plan
         -> resume execution
```

Do not force a broad redesign through the narrow “single blocker” path just because that was the original entry point.

Supporting view with skill pivot:

```text
/devenv-design-discussion starts on a bounded blocker
  |
  +-- stays bounded
  |      -> /devenv-refine-implementation-plan
  |      -> resume execution
  |
  +-- reveals broader design drift
         -> /devenv-grooming
         -> /devenv-refine-implementation-plan
         -> resume execution
```

## Upstream changes cascade downstream

Changes can flow back upward, but once an upstream artifact changes, downstream artifacts must be revisited.

```text
Requirements changed
  -> refine requirements
  -> update blueprint if needed
  -> revisit grooming
  -> refresh implementation plan
  -> resume execution

Blueprint changed
  -> refine blueprint
  -> revisit grooming
  -> refresh implementation plan
  -> resume execution

Component design changed
  -> grooming or focused design discussion
  -> refresh implementation plan
  -> resume execution
```

The key idea is that downstream artifacts are not independent. If the upstream design changed materially, the plan should be refreshed rather than quietly carried forward.

Supporting view with common skill mapping:

```text
Requirements changed
  -> /devenv-refine-requirements
  -> /devenv-refine-blueprint or /devenv-create-blueprint
  -> /devenv-grooming
  -> /devenv-refine-implementation-plan
  -> execution

Blueprint changed
  -> /devenv-refine-blueprint
  -> /devenv-grooming
  -> /devenv-refine-implementation-plan
  -> execution

Component design changed
  -> /devenv-grooming or /devenv-design-discussion
  -> /devenv-refine-implementation-plan
  -> execution
```

## Existing-component feature workflow

For a new feature in an existing component, the path depends on whether the approach is already known.

```text
Existing-component feature request
  |
  +-- Approach already chosen
  |      |
  |      +--> Create or refresh the implementation plan
  |      +--> Execute
  |
  +-- Approach unclear
         |
         +--> Groom the work
                |
                +--> If one bounded blocker needs deep option-weighing,
                |    run a focused design discussion
                |
                +--> Settle the component design direction
                +--> Create or refresh the plan
                +--> Execute
```

In Devenv, that usually maps to grooming first, with design-discussion used only when the real need is one focused design question.

Supporting view with skill mapping:

```text
Existing-component feature request
  |
  +-- Approach already chosen
  |      -> /devenv-create-implementation-plan
  |         or /devenv-refine-implementation-plan
  |      -> /devenv-pair-programming or /devenv-delegation
  |
  +-- Approach unclear
      -> /devenv-grooming
      -> /devenv-design-discussion   (only for one bounded blocker)
      -> /devenv-create-implementation-plan
        or /devenv-refine-implementation-plan
      -> /devenv-pair-programming or /devenv-delegation
```

## Artifact roles in the workflow

The core artifacts are:

- Requirements doc: functional intent
- Blueprint: system architecture
- Grooming artifact: component-level design decisions and deltas
- Implementation plan: executable phases and tasks
- Solution proposal: focused answer to one design question; canonical as a file, optionally published elsewhere for context

Do not treat these as interchangeable. Each exists to answer a different question.

## How to use this guide with the tooling

This guide is the methodology. The skills catalog is the tooling map.

- Use [Skills Catalog](./Skills.md) when you need to choose one skill quickly.
- Use this guide when you want to understand how the work should flow even outside of Copilot-assisted execution.
- Use `/devenv-skill-guru` when you want help mapping a real situation onto the workflow.

The ASCII diagrams in this document come in two forms:

- workflow-first diagrams: the methodology with no tool assumption
- supporting diagrams: how Devenv/Copilot skills can support that same workflow in practice

Keep the distinction intact. If the tooling changes, the workflow should still make sense.
