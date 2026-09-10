---
name: devenv-create-roadmap
description: 'Produce a delivery roadmap from a blueprint, a specifications doc, or both, publishing it as an artifact comment on a parent epic in the planning repo, then optionally creating child issues across component repos. USE WHEN the user says "create a roadmap", "plan delivery order", "build a roadmap from this blueprint", "build a roadmap from these specifications", "lay out the delivery phases", or hands off a blueprint or specifications doc that needs sequencing into deliverable phases. Produces a Roadmap-<system>-NNN artifact (doc_id-addressed comment on the epic) with PHASE-NN groupings of high-level STEP-NN entries and dependency arrows; the epic body holds a markdown task list of child issues. Roadmaps are GitHub artifacts, not source-controlled files — no long-lived local copy is kept. DO NOT USE for low-level task breakdown (use /devenv-create-plan), for syncing roadmap state to issue state (use /devenv-update-roadmap), or for structurally revising an existing roadmap (use /devenv-refine-roadmap).'
argument-hint: 'Path to a Blueprint-*.md and/or a Specifications-*.md (at least one required)'
user-invocable: true
---

# Create Roadmap

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` at the active project root for `/devenv-skill-maintenance`.

Take a blueprint, a specifications document, or both, and produce a **delivery roadmap** — a phased, high-level sequencing of work that respects dependencies and surfaces business priority. The roadmap is the link between intent (specifications / architecture) and execution: each step is the seed for one or more GitHub issues and (later) plans.

This skill is also the **canonical entry point for creating GitHub issues** from a specifications or blueprint document. Other skills that need bulk issue creation route through here.

## When to Use

Trigger phrases:

- "create a roadmap" / "build a roadmap from this blueprint" / "build a roadmap from these specifications"
- "plan delivery order" / "lay out the delivery phases"
- "sequence this work into phases"
- A blueprint and/or a specifications doc exists and the user is ready to plan delivery (and probably create issues)

Do **not** use for:

- Low-level task breakdown → [`/devenv-create-plan`](../devenv-create-plan/SKILL.md)
- Syncing roadmap state from existing issues → [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md)
- Structurally revising an existing roadmap (split steps, re-sequence, add new components) → [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md)
- Creating a brand-new specifications doc → [`/devenv-write-specifications`](../devenv-write-specifications/SKILL.md) first
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
- One or more paths to `Specifications-*.md` files (e.g. `docs/Specifications/Specifications-orders-001.md docs/Specifications/Specifications-fulfillment-001.md`), **or** a single `docs/Specifications/Index.md` which is followed to all listed epic docs

**Multiple specifications docs** are supported for multi-epic projects (one specifications doc per epic). One invocation → one roadmap → one parent epic in the planning repo, spanning all input docs. Cross-doc dependency edges declared in the specifications (`Depends on: AUTH-003 (Specifications-auth-001.md)`) are honoured when ordering steps.

**`Index.md` as input.** When a project's specifications or blueprint is multi-file, prefer handing the corresponding `Index.md` over enumerating part files — the index is the canonical entry point and ensures nothing is missed. The skill follows the index's file table to read every constituent doc.

Three input modes are supported:

| Mode | When to use | Step source | Component field |
|---|---|---|---|
| **Blueprint + Specifications** | Epic-scale work — architecture exists and stakeholder priority must inform sequencing | Per-component deltas (§4 of blueprint); priority groups (§3 of each specifications doc) inform phase ordering | From blueprint |
| **Blueprint only** | Architecture exists but stakeholder priority isn't a major factor | Per-component deltas (§4 of blueprint) | From blueprint |
| **Specifications only** (single or multiple docs) | Smaller work that doesn't warrant a blueprint, but still needs delivery sequencing and GitHub issues | Each `SPEC-NNN` (or category-prefixed ID) becomes a candidate step; priority groups (`GROUP-NN`) inform phase ordering | **Asked from the user per step** — there is no blueprint to derive it from |

If neither input is supplied, stop and redirect: specifications-first → `/devenv-write-specifications`; architecture-first → `/devenv-create-blueprint`.

## Session Continuity

Use `session_memory-roadmap.md` in the **target repo root** following the same protocol as [`/devenv-write-specifications`](../devenv-write-specifications/SKILL.md). The filename suffix lets it coexist with `session_memory-blueprint.md` and `session_memory-specifications.md`.

## Output Artifact

Produce a `Roadmap-<system>-NNN` artifact where:
- `<system>` matches the blueprint's system name
- `NNN` is a zero-padded numeric suffix

**Roadmaps are GitHub artifacts, not files in source control.** The roadmap lives as a `doc_id`-addressed artifact comment on the parent epic in the planning repo (same pattern as plan artifacts; see [issue-artifact-integration.md](../common/references/issue-artifact-integration.md)). The epic body is a short placeholder plus the task list of child issues; the roadmap content is in the artifact comment.

During the session, work on a local scratch copy (e.g. `/tmp/roadmap-<system>-NNN.md`). The scratch copy is session working state only — it is not committed and not kept after the roadmap is published. The published artifact comment is the single source of truth. Pull/edit/republish mechanics follow the shared [issue-backed artifact edit protocol](../common/references/issue-backed-artifact-edit-protocol.md).

A roadmap is downstream of the specifications and blueprint, and upstream of grooming: it is affected by changes arriving from upstream (spec/blueprint refinement) or pushed back from downstream (execution discoveries), but it is never itself an entry point for changes — those enter through the refine skills and the upstream-impact queue, never by editing a roadmap.

A roadmap is **optional**: added only when a larger effort needs delivery coordination across multiple components — usually associated with an epic — maintained while the change is in flight, and done when the change ships and the parent epic closes. It is a **change-bound artifact**.

See [roadmap-template.md](./references/roadmap-template.md) for the document structure.

## Process

### 1. Load and parse the inputs

**If a blueprint is provided**, read it and extract:
- Per-component delta entries (from §4 *Architecture* component entries) — every entry becomes a candidate step
- Service dependencies (from §4.2 Context Map; also §4.3 Communication Patterns)
- Operations and the services they participate in

**If a specifications doc is provided**, read it and extract:
- Every `SPEC-NNN` and its `Dependencies:` line (including cross-doc edges of the form `AUTH-003 (Specifications-auth-001.md)`)
- Priority groups (`GROUP-NN`) — used to inform phase ordering and the MVP boundary
- For specifications-only mode, each specification item becomes a candidate step (with the component field deferred to user input in step 2)

**If multiple specifications docs are provided**, parse each one in turn. Build a single unified candidate-step list keyed by specification ID (which is globally unique because of per-epic prefixes). Cross-doc `Depends on:` edges become normal step-level dependency edges in the roadmap. Priority groups from different docs do **not** merge — surface them in the phase-grouping interview (step 4) so the user can decide whether one epic's MVP runs before another's.

**If both are provided**, the blueprint drives candidate steps and the component field; the specifications doc informs phase ordering and surfaces user-visible priorities.

### 2. Identify candidate steps

**Blueprint-driven** (blueprint provided): for each per-component change in the blueprint, draft a candidate step:

```
Step: Extend service.commerce.inventory with reservation API
Component: service.commerce.inventory
Blueprint sections: §4.1, §4.1 (ReservationCreated integration event)
Depends on: <blueprint-derived service deps>
```

For each new component, draft a step:

```
Step: Build service.commerce.fulfillment-orchestrator
Component: service.commerce.fulfillment-orchestrator (new)
Blueprint sections: §4.2, §4.1 (CreateOrder operation)
Depends on: service.commerce.inventory reservation API, service.commerce.payment events
```

**Specifications-only** (no blueprint): for each `SPEC-NNN`, draft a candidate step:

```
Step: <REQ title>
Specification: SPEC-NNN
Component: <ASK USER — which repo will this land in?>
Depends on: <SPEC-NNN dependencies, mapped to step IDs>
```

When running in specifications-only mode, batch the component questions: present the full step list to the user once and ask them to fill in the component column for all steps in one pass, rather than asking one-at-a-time.

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

Show the draft. Revise. **Do not publish yet.**

### 7. Create the parent epic and publish the roadmap artifact

Once approved:

1. Create the parent epic in the planning repo (`GITHUB_REPO=<org>/<planning-repo> issue-create --title "Epic: <system> roadmap" --type "Epic" --no-template`) with a placeholder body (title, blueprint link, note that the roadmap artifact follows in a comment).
2. Publish the roadmap as an artifact comment on the epic: follow the shared [Artifact Identity Convention](../_conventions.md#artifact-identity-convention) with `artifact_type: roadmap` and `artifact_scope: issue-comment`. Resolve the deterministic `doc_id` with `issue-artifact-doc-id --issue <epic-number> --artifact-type roadmap --slug <system>-<NNN>` (form `dv1:<owner-repo>:issue-<epic-number>:roadmap:<system>-<NNN>`), stamp it into the scratch copy's `DEVENV_ARTIFACT_V1` header via `artifact-header <scratch-path> --set doc_id=<value>`, and run `issue-artifact-upsert --issue <epic-number> --body-file <scratch-path>`.
3. Note the epic number and artifact `doc_id` — every later roadmap skill (refine/update) addresses the roadmap by `doc_id`.

### 8. Offer to create child issues

Ask, verbatim:

> "Create child issues in the affected component repos? This will:
> - Create one child issue per roadmap step in the appropriate component repo
> - Link each roadmap step in the artifact to its issue
> - Update the epic task list
>
> Proceed? (Y / N / Choose subset)" — ask via the shared [direct query style](../_conventions.md#direct-query-style-questions-and-selections): present *yes, create all / choose a subset / no* as selectable options with freeform input.

Only on explicit approval, run the procedure in the next section.

## Issue Creation Procedure

This step uses the existing `issue-create` and `issue-update` tooling. Do not invent new commands. This mandate applies to **any** issue creation performed under this skill, including user-negotiated variants of the tracking model (e.g., a single tracking issue with embedded phase/step checkboxes instead of an epic + per-repo child issues). Only the issue structure is negotiable; the tooling is not.

### Step A — Create child issues

For each roadmap step where the component repo is known:

```bash
GITHUB_REPO=<org>/<component-repo> issue-create \
  --title "<step title>" \
  --type "<type>" \
  --body-file <temp-body-file> \
  --no-template
```

> **Note:** `issue-create` does not have a `--repo` flag. The repo is selected via the `GITHUB_REPO` env var (`owner/repo` form). If unset, the tool falls back to `GH_ORG` + current repo name, then to the current git repo. `--type` is required for non-interactive creation — valid values come from `tools/config/issues-config.yml` (Bug, Feature, Task, Epic); roadmap step issues are normally `Task` and the parent epic is `Epic`, unless the user approves otherwise.

The body should reference back to the roadmap artifact and blueprint:

```markdown
**Roadmap step**: STEP-NN on epic `<org>/<planning-repo>#<epic-number>` (roadmap artifact `<doc_id>`)
**Blueprint section**: [§N.N](<link to blueprint section on GitHub>)

<one-paragraph description of the step from the roadmap>

---
*This issue was created from roadmap artifact `<doc_id>` on the parent epic. Updates to the roadmap may sync state via `/devenv-update-roadmap`.*
```

Capture the resulting issue number. Show the user a running list:

```
✔ STEP-01 → workinprogress-ai/service.commerce.inventory#412
✔ STEP-02 → workinprogress-ai/service.commerce.inventory#413
...
```

### Step B — Regenerate the epic task list

The epic body carries the placeholder plus a markdown task list of every child issue (regenerated as steps gain issues):

```markdown
# Epic: <System Name> Roadmap

**Roadmap artifact**: `<doc_id>` on this issue (comment)
**Blueprint**: [Blueprint-<system>-NNN.md](<link>)

## Phases

### PHASE-01: <name>

- [ ] workinprogress-ai/service.commerce.inventory#412 — STEP-01: <title>
- [ ] workinprogress-ai/service.commerce.inventory#413 — STEP-02: <title>

### PHASE-02: <name>

- [ ] workinprogress-ai/service.commerce.fulfillment#56 — STEP-03: <title>
...
```

Update via `GITHUB_REPO=<planning-repo> issue-update <epic-number> --body-file <temp-body-file>`.

### Step C — Update the roadmap artifact with issue links

For each step in the scratch copy, append the issue link to the step heading and set status to `⬜ Not started`:

```markdown
### STEP-01: Extend inventory with reservation API
**Issue**: [workinprogress-ai/service.commerce.inventory#412](https://github.com/workinprogress-ai/service.commerce.inventory/issues/412)
**Status**: ⬜ Not started
```

Then republish: `issue-artifact-upsert --issue <epic-number> --body-file <scratch-path>`. Confirm the epic number, `doc_id`, and issue counts to the user.

## What Happens Next

After the roadmap is created and issues exist:

- **Track delivery progress**: [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md) syncs roadmap step status from issue/PR state.
- **Implement a step**: [`/devenv-create-plan`](../devenv-create-plan/SKILL.md) on the issue produces task-level detail.
- **Architecture changed**: [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) → then re-run this skill to add new steps.

## Anti-patterns

- Publishing the roadmap artifact before user approval
- Writing the roadmap into the repo as a source-controlled file (e.g. under `docs/Roadmap/`) — roadmaps are GitHub artifacts on the epic, not files in source control
- Committing the scratch copy or treating it as durable after publish
- Auto-creating issues without explicit confirmation
- Re-numbering steps when adding new ones (always append with next sequential number)
- Treating dependency-order as the only valid sequencing — surface the capability-slice alternative
- Creating issues outside the existing tooling (`issue-create`, `issue-update`, `issue-artifact-upsert`)
- Putting child issues in the planning repo (they belong in component repos)
- Putting the parent epic in a component repo (it belongs in the planning repo)
- Editing a roadmap as the entry point for an upstream change — upstream changes enter through the refine skills and the upstream-impact queue, never by editing a roadmap first

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
