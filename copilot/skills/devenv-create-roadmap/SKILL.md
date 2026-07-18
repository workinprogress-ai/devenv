---
name: devenv-create-roadmap
description: 'Produce a delivery roadmap from a blueprint, a requirements doc, or both, then optionally create the corresponding parent epic and child issues across component repos. USE WHEN the user says "create a roadmap", "plan delivery order", "build a roadmap from this blueprint", "build a roadmap from these requirements", "lay out the delivery phases", or hands off a blueprint or requirements doc that needs sequencing into deliverable phases. Produces a Roadmap-<system>-NNN.md with PHASE-NN groupings of high-level STEP-NN entries and dependency arrows. After approval, offers to create a parent epic in the planning repo with a markdown task list of child issues in component repos. DO NOT USE for low-level task breakdown (use /devenv-create-implementation-plan), for syncing roadmap state to issue state (use /devenv-update-roadmap), or for structurally revising an existing roadmap (use /devenv-refine-roadmap).'
argument-hint: 'Path to a Blueprint-*.md and/or a Requirements-*.md (at least one required)'
user-invocable: true
---

# Create Roadmap

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` at the active project root for `/devenv-skill-maintenance`.

Take a blueprint, a requirements document, or both, and produce a **delivery roadmap** — a phased, high-level sequencing of work that respects dependencies and surfaces business priority. The roadmap is the link between intent (requirements / architecture) and execution: each step is the seed for one or more GitHub issues and (later) implementation plans.

This skill is also the **canonical entry point for creating GitHub issues** from a requirements or blueprint document. Other skills that need bulk issue creation route through here.

## When to Use

Trigger phrases:

- "create a roadmap" / "build a roadmap from this blueprint" / "build a roadmap from these requirements"
- "plan delivery order" / "lay out the delivery phases"
- "sequence this work into phases"
- A blueprint and/or a requirements doc exists and the user is ready to plan delivery (and probably create issues)

Do **not** use for:

- Low-level task breakdown → [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md)
- Syncing roadmap state from existing issues → [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md)
- Structurally revising an existing roadmap (split steps, re-sequence, add new components) → [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md)
- Creating a brand-new requirements doc → [`/devenv-gather-requirements`](../devenv-gather-requirements/SKILL.md) first
- Creating a brand-new blueprint → [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md) first (when the work warrants architectural design)

## Philosophy

- **Roadmap follows architecture.** Step ordering must respect the dependency tree from the blueprint. A consumer can't ship before its producer.
- **Balance dependency with visible progress.** Pure dependency-order is technically optimal but often demoralising. Where possible, group early steps so each phase delivers something demonstrable.
- **The human owns the priorities.** You surface trade-offs (deeper-dependency-first vs. visible-progress-first); the human decides.
- **Steps are component-level, not task-level.** A roadmap step is the size of "extend service.commerce.inventory with reservation API" — not "add the `Reservation` record class".
- **Roadmap is a living document.** It will be updated frequently as work progresses. Keep it scannable.

## Inputs

The user provides at least one of:

- Path to a `Blueprint-*.md` (single-file) **or** `Blueprint-<system>-NNN/Index.md` (split blueprint — the Index is followed to all part files)
- One or more paths to `Requirements-*.md` files (e.g. `docs/Requirements/Requirements-orders-001.md docs/Requirements/Requirements-fulfillment-001.md`), **or** a single `docs/Requirements/Index.md` which is followed to all listed epic docs

**Multiple requirements docs** are supported for multi-epic projects (one requirements doc per epic). One invocation → one roadmap → one parent epic in the planning repo, spanning all input docs. Cross-doc dependency edges declared in the requirements (`Depends on: AUTH-003 (Requirements-auth-001.md)`) are honoured when ordering steps.

**`Index.md` as input.** When a project's requirements or blueprint is multi-file, prefer handing the corresponding `Index.md` over enumerating part files — the index is the canonical entry point and ensures nothing is missed. The skill follows the index's file table to read every constituent doc.

Three input modes are supported:

| Mode | When to use | Step source | Component field |
|---|---|---|---|
| **Blueprint + Requirements** | Epic-scale work — architecture exists and stakeholder priority must inform sequencing | Per-component deltas (§4 of blueprint); priority groups (§3 of each requirements doc) inform phase ordering | From blueprint |
| **Blueprint only** | Architecture exists but stakeholder priority isn't a major factor | Per-component deltas (§4 of blueprint) | From blueprint |
| **Requirements only** (single or multiple docs) | Smaller work that doesn't warrant a blueprint, but still needs delivery sequencing and GitHub issues | Each `REQ-NNN` (or category-prefixed ID) becomes a candidate step; priority groups (`GROUP-NN`) inform phase ordering | **Asked from the user per step** — there is no blueprint to derive it from |

If neither input is supplied, stop and redirect: requirements-first → `/devenv-gather-requirements`; architecture-first → `/devenv-create-blueprint`.

## Session Continuity

Use `session_memory-roadmap.md` in the **target repo root** following the same protocol as [`/devenv-gather-requirements`](../devenv-gather-requirements/SKILL.md). The filename suffix lets it coexist with `session_memory-blueprint.md` and `session_memory-requirements.md`.

## Output File

Produce `Roadmap-<system>-NNN.md` where:
- `<system>` matches the blueprint's system name
- `NNN` is a zero-padded numeric suffix

**Location:**
- If the target repo name starts with `planning.` → write to `docs/Roadmap/` (create the folder if needed)
- Otherwise → ask the user where to put it

See [roadmap-template.md](./references/roadmap-template.md) for the document structure.

## Process

### 1. Load and parse the inputs

**If a blueprint is provided**, read it and extract:
- Per-component delta entries (from §4 *Per-Component Changes*) — every entry becomes a candidate step
- Service dependencies (from §3.2 / §3.5)
- Operations and the services they participate in

**If a requirements doc is provided**, read it and extract:
- Every `REQ-NNN` and its `Dependencies:` line (including cross-doc edges of the form `AUTH-003 (Requirements-auth-001.md)`)
- Priority groups (`GROUP-NN`) — used to inform phase ordering and the MVP boundary
- For requirements-only mode, each requirement becomes a candidate step (with the component field deferred to user input in step 2)

**If multiple requirements docs are provided**, parse each one in turn. Build a single unified candidate-step list keyed by requirement ID (which is globally unique because of per-epic prefixes). Cross-doc `Depends on:` edges become normal step-level dependency edges in the roadmap. Priority groups from different docs do **not** merge — surface them in the phase-grouping interview (step 4) so the user can decide whether one epic's MVP runs before another's.

**If both are provided**, the blueprint drives candidate steps and the component field; the requirements doc informs phase ordering and surfaces user-visible priorities.

### 2. Identify candidate steps

**Blueprint-driven** (blueprint provided): for each per-component change in the blueprint, draft a candidate step:

```
Step: Extend service.commerce.inventory with reservation API
Component: service.commerce.inventory
Blueprint sections: §4.1, §3.2.3, §3.4 (ReservationCreated event)
Depends on: <blueprint-derived service deps>
```

For each new component, draft a step:

```
Step: Build service.commerce.fulfillment-orchestrator
Component: service.commerce.fulfillment-orchestrator (new)
Blueprint sections: §4.2, §3.3 (CreateOrder operation)
Depends on: service.commerce.inventory reservation API, service.commerce.payment events
```

**Requirements-only** (no blueprint): for each `REQ-NNN`, draft a candidate step:

```
Step: <REQ title>
Requirement: REQ-NNN
Component: <ASK USER — which repo will this land in?>
Depends on: <REQ-NNN dependencies, mapped to step IDs>
```

When running in requirements-only mode, batch the component questions: present the full step list to the user once and ask them to fill in the component column for all steps in one pass, rather than asking one-at-a-time.

### 3. Build the dependency graph

Map step → step dependencies based on:
- Producer/consumer relationships (a service that consumes an event needs the producer first)
- Sync API consumers need the API to exist first
- New-component steps typically depend on the existing components they integrate with

Surface cycles as architectural problems — don't paper over them.

### 4. Propose phases

Group steps into `PHASE-01`, `PHASE-02`, ... where:
- Phase 1 contains steps with **no dependencies** (foundational)
- Each subsequent phase contains steps whose dependencies all sit in earlier phases
- Within a phase, steps may proceed in parallel
- Each phase should ideally produce a demonstrable increment

**Trade-off conversation with the user:**

> "Two ways to organise this:
> - **Dependency-first**: PHASE-01 = foundation libraries; PHASE-02 = inventory service; PHASE-03 = order service; PHASE-04 = orchestrator. Strict dependency order, slower visible progress.
> - **Capability-slice**: each phase delivers a thinner end-to-end slice — minimum viable inventory + minimum viable order, then full inventory + full order. Faster visible progress, more rework risk.
>
> Which trade-off do you prefer? Hybrids are fine too."

### 5. Draft the roadmap in chat

Use [roadmap-template.md](./references/roadmap-template.md). Each step gets:
- A linkable heading with the step ID (e.g. `STEP-03`)
- The component(s) it touches
- A link back to the relevant blueprint section(s)
- Dependencies as markdown links to other step headings
- Status placeholder: `⬜ Not started` (issue links populated later)

### 6. Iterate until approved

Show the draft. Revise. **Do not write the file yet.**

### 7. Write the roadmap file

Once approved, write `<target-repo>/docs/Roadmap/Roadmap-<system>-NNN.md` (or user-confirmed location).

### 8. Offer to create GitHub issues

Ask, verbatim:

> "Create the parent epic in the planning repo and child issues in the affected component repos? This will:
> - Create one parent epic in `<planning-repo>` with a markdown task list of all child issues
> - Create one child issue per roadmap step in the appropriate component repo
> - Link each roadmap step in the file to its issue
>
> Proceed? (Y / N / Choose subset)"

Only on explicit approval, run the procedure in the next section.

## Issue Creation Procedure

This step uses the existing `issue-create` and `issue-update` tooling. Do not invent new commands.

### Step A — Create child issues

For each roadmap step where the component repo is known:

```bash
GITHUB_REPO=<org>/<component-repo> issue-create \
  --title "<step title>" \
  --body-file <temp-body-file>
```

> **Note:** `issue-create` does not have a `--repo` flag. The repo is selected via the `GITHUB_REPO` env var (`owner/repo` form). If unset, the tool defaults to the current git repo.

The body should reference back to the roadmap and blueprint:

```markdown
**Roadmap step**: [STEP-NN](<link to roadmap step heading on GitHub>)
**Blueprint section**: [§N.N](<link to blueprint section on GitHub>)

<one-paragraph description of the step from the roadmap>

---
*This issue was created from `<roadmap filename>`. Updates to that file may sync state via `/devenv-update-roadmap`.*
```

Capture the resulting issue number. Show the user a running list:

```
✔ STEP-01 → workinprogress-ai/service.commerce.inventory#412
✔ STEP-02 → workinprogress-ai/service.commerce.inventory#413
...
```

### Step B — Create the parent epic

In the planning repo, create one epic issue containing a markdown task list of every child issue:

```markdown
# Epic: <System Name> Roadmap

**Roadmap file**: [Roadmap-<system>-NNN.md](<link>)
**Blueprint**: [Blueprint-<system>-NNN.md](<link>)

## Phases

### PHASE-01: <name>

- [ ] workinprogress-ai/service.commerce.inventory#412 — STEP-01: <title>
- [ ] workinprogress-ai/service.commerce.inventory#413 — STEP-02: <title>

### PHASE-02: <name>

- [ ] workinprogress-ai/service.commerce.fulfillment#56 — STEP-03: <title>
...
```

Use `GITHUB_REPO=<planning-repo> issue-create --title "Epic: <system> roadmap" --body-file <temp-body-file>`.

### Step C — Update the roadmap file with issue links

For each step in the roadmap file, append the issue link to the step heading and set status to `⬜ Not started`:

```markdown
### STEP-01: Extend inventory with reservation API
**Issue**: [workinprogress-ai/service.commerce.inventory#412](https://github.com/workinprogress-ai/service.commerce.inventory/issues/412)
**Status**: ⬜ Not started
```

Also add the parent epic reference at the top:

```markdown
**Parent epic**: [planning.development.main#89](<link>)
```

Write the file back. Confirm the path and issue counts to the user.

## What Happens Next

After the roadmap is created and issues exist:

- **Track delivery progress**: [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md) syncs roadmap step status from issue/PR state.
- **Implement a step**: [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md) on the issue produces task-level detail.
- **Architecture changed**: [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) → then re-run this skill to add new steps.

## Anti-patterns

- Writing the roadmap file before user approval
- Auto-creating issues without explicit confirmation
- Re-numbering steps when adding new ones (always append with next sequential number)
- Treating dependency-order as the only valid sequencing — surface the capability-slice alternative
- Creating issues outside the existing tooling (`issue-create`, `issue-update`)
- Putting child issues in the planning repo (they belong in component repos)
- Putting the parent epic in a component repo (it belongs in the planning repo)

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
