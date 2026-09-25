# Copilot Skills Catalog

A complete reference for the Copilot skill suite available in this workspace. Skills are invoked with a `/skill-name` slash command in Copilot Chat.

> **Authority note:** each skill's `SKILL.md` frontmatter (`copilot/skills/<name>/SKILL.md`) is the authoritative description of that skill — its trigger phrases and boundaries. This catalog summarizes the suite for browsing; when a summary and a frontmatter disagree, the frontmatter wins.

**Not sure which skill to use, or how something in this environment works?** Say `/devenv-help` — it answers questions directly and recommends skills.

> **Provider transport:** skill bodies stay provider-neutral — GitHub-specific wrapper signatures, env vars, config paths, and invocation recipes live in the [GitHub protocol reference](../copilot/skills/_shared/references/provider-protocols/github.md). A provider fork replaces that file; skill bodies don't change.

**Need the full workflow, not just the catalog?** See [Workflow Guide](./Workflow.md).

---

## Decision tree

```text
What are you trying to do?
│
├─ 🔍 Explore / think
│   ├─ Understand a codebase via chat   →  /devenv-chat
│   ├─ Investigate a question           →  /devenv-research
│   ├─ Verify / diagnose / fix a bug  →  /devenv-hunt
│   ├─ Weigh design options (opinionated)→ /devenv-design
│   └─ Triage an incoming issue         →  /devenv-triage
│
├─ 📄 Document
│   └─ Write docs for an existing system, component, or cross-cutting concern  →  /devenv-document
│
├─ 📝 Define specifications
│   ├─ System needs functional definition before planning  →  /devenv-write-specifications
│   └─ Revise an existing specifications doc                →  /devenv-refine-specifications
│
├─ 🏛️  Architect a system
│   ├─ Create architectural blueprint            →  /devenv-create-blueprint
│   ├─ Revise existing blueprint                 →  /devenv-refine-blueprint
│   ├─ Groom component-level design direction    →  /devenv-groom
│   ├─ Build delivery roadmap from blueprint and/or specifications  →  /devenv-create-roadmap
│   ├─ Structurally revise roadmap (split, re-sequence) → /devenv-refine-roadmap
│   └─ Sync roadmap state from issues / PRs      →  /devenv-update-roadmap
│
├─ 📋 Plan
│   ├─ Create from idea / issue or complete spec / RFC (any multi-step objective: code default; docs, mechanical, runbooks)  →  /devenv-plan
│   ├─ Align existing plan with reality (surgical edit / revision / staleness assessment)  →  /devenv-refine-plan
│   └─ Manage the board / query progress (status, hygiene, recommendations across issues)  →  /devenv-board
│
├─ 🔨 Build
│   ├─ No plan yet                      →  /devenv-plan first
│   ├─ High-impact work (any size)      →  /devenv-pair
│   ├─ Mechanical, task-by-task collaboration →  /devenv-pair
│   └─ Long mechanical run, commissioned autonomous execution →  /devenv-delegate
│
├─ 🔎 Review / address feedback
│   ├─ Review your changes              →  /devenv-review
│   ├─ You received PR review comments  →  /devenv-address-pr-comments
│   └─ Review / land the work           →  /devenv-review then /devenv-commit
│
└─ 🏁 Wrap up
    └─ Open a PR from finished phase     →  /devenv-open-pr
```

---

## Principle skills

These are the backbone of the catalog. Start here if you're unsure.

### `/devenv-write-specifications`

> **Before planning begins, when specifications are undefined. Also when brainstorming changes to existing specifications.**

Conducts a structured three-phase interview (vision → specifications → roadmap) and produces a `Specifications-<topic>-NNN.md`. Can also continue a previous gathering session: pass an existing `Specifications-*.md` file path to brainstorm new ideas, explore implications, and integrate new input **before committing changes**. Maintains a `session_memory-specifications.md` across sessions. The specifications document then feeds into `/devenv-create-blueprint` or `/devenv-plan`.

**Use for:**

- New systems or features where what the system should do isn't yet defined
- Brainstorming and exploring changes to an existing specifications doc (pass the file path; explore implications first, then decide what to change)

**Don't use for:**

- Applying known changes to a specifications doc when you already know what should change → `/devenv-refine-specifications`
- Specifications already exist and you just want to plan/architect → `/devenv-create-blueprint`, `/devenv-plan`
- Quick inline clarifications (just ask directly)

**Tool deps:** none

---

### `/devenv-create-blueprint`

> **Architecture before planning, when the work spans multiple components.**

Conducts a three-phase architectural interview (context → architecture → consequences) and produces a `Blueprint-<system>-NNN.md` covering domains, services, events, communication patterns, and per-component deltas. For brownfield work, surveys existing components via `repo-cache-update` before designing. Maintains `session_memory-blueprint.md` across sessions.

**Use for:** epic-scale work touching multiple components; brownfield system extensions; greenfield system design  
**Don't use for:** single-component work (→ `/devenv-plan`), low-level task breakdown (→ `/devenv-plan`), sequencing into milestones (→ `/devenv-create-roadmap`)  
**Tool deps:** `repo-cache-update` (brownfield only)

---

### `/devenv-plan`

> **Before any significant work begins.**

Interviews the user, scans repo conventions, drafts phased atomic tasks, and writes a `Plan-*.md` under the repo's `.local-artifacts/` folder (the gitignored home for local working markdown). Works for any multi-step objective — code (the default), docs overhauls, mechanical file work, runbooks, mixed work — via a **plan-declared verification approach** (code plans keep the full test/coverage gates verbatim; non-code plans declare deterministic, observable checks). The plan is a current-state execution artifact that follows the engineer's real work rather than a contract the engineer must obey. Offers to push the plan into the associated issue. For significantly complex code work, offers a plan-encoded **Review** phase — a dedicated phase before Cleanup where `/devenv-review` folds approved findings back into the plan, cycling to convergence. The gateway to all build-phase skills.

**Use for:** planning a user story, breaking down an issue, writing up work before starting — coding or non-coding multi-step objectives alike  
**Don't use for:** pure research (→ `/devenv-research`), editing an existing plan (→ `/devenv-refine-plan`)  
**Tool deps:** `issue-get`, `issue-artifact-doc-id`, `issue-artifact-upsert`

---

### `/devenv-pair`

> **Collaborative with bounded autonomy span: one task or small chunk per human touchpoint.**

Loads the plan and runs an interactive driver/navigator handoff: both parties take turns driving (writing the code) and navigating (watching, asking questions, keeping the big picture in view). The AI never runs more than one task or small agreed chunk without coming back for review — ask it for a long unattended run and it will either keep chunking with reviews or tell you to invoke `/devenv-delegate` explicitly. The navigator is active during the other person's turn — pre-reading ahead, looking things up, catching problems early. The AI also acts as plan steward during execution: it keeps progress honest and reconciles the plan to the engineer's real work, including off-plan discoveries or intentional deviations. The AI pushes back when warranted, narrates its own reasoning as it works, and asks before assuming. If it raises a decision gate, it must stop before any mutating action until the user explicitly approves the path. High-engagement, high-quality — slows down appropriately for risky or novel work.
Question-shaped prompts default to discussion/analysis mode; implementation starts only after explicit user direction.

**Use for:** high-impact phases — public API changes, data shape changes, security, novel architecture (any size); also any work where you want to stay closely involved, task by task  
**Don't use for:** long unattended runs of mechanical work (→ `/devenv-delegate`, invoked explicitly), pure exploration (→ `/devenv-research`)  
**Tool deps:** `issue-get`, `issue-artifact-select`, `issue-artifact-get`, `issue-artifact-upsert`, `pr-get`, `pr-diff`, `issue-comment`  
**New to pair programming?** See [How pair programming works](#how-pair-programming-works) below.

---

### `/devenv-delegate`

> **Commissioned autonomous run for mechanical work, with user review and ownership.**

Analyzes a plan, proposes work-session groupings, implements phase-by-phase, keeps the user engaged with brief pings and inline concern surfacing, and stops on explicit decision gates before any mutating action resumes. Ends each session with a summary including review hotspots. Entered only by explicit `/devenv-delegate` invocation — the explicit act of commissioning an autonomous run — never by drifting out of a pair-programming session. Accepts a bare GH issue by materializing a small plan first (issue intake gate).

**Use for:** refactors, renames, test scaffolding, cleanup, docs — mechanical, low-risk phases  
**Don't use for:** high-impact work (→ `/devenv-pair`), ad-hoc work without a plan  
**Tool deps:** `issue-get`, `issue-artifact-select`, `issue-artifact-get`, `issue-artifact-upsert`, `issue-comment`

---

### `/devenv-research`

> **When you don't know if something is feasible yet.**

Investigates a question, builds a throwaway prototype if needed, and produces a structured `research-NNN-<topic>.md` findings doc. Everything is explicitly marked NOT FOR PRODUCTION.

**Use for:** feasibility questions, proofs-of-concept, technical investigations before planning  
**Don't use for:** thinking out loud with no artifact production code  
**Tool deps:** none (reads codebase; writes only to `playground/devenv-research-*/`)

---

### `/devenv-document`

> **Write documentation for an existing system, component, or cross-cutting concern.**

Interviews the user to establish audience, output format, and scope before touching any files. Reads existing docs first (READMEs, design docs, ADRs, inline comments) and falls back to code only where docs are absent or insufficient — always surfacing the gap and recommending a depth level before reading deeper. Tracks open questions as Q-NNN items; resolves or defers all of them before writing. Proposes a session plan upfront for multi-component tasks. Maintains a `session_memory-document.md` for continuity across sessions.

**Use for:** documenting a legacy codebase; writing an onboarding guide; creating AI context briefs for future sessions; cross-cutting documentation that spans multiple repos  
**Don't use for:** conversational Q&A without a written output (→ `/devenv-chat`); formal architectural decomposition (→ `/devenv-create-blueprint`); tech debt assessment (→ `/devenv-audit`)  
**Tool deps:** none

---

### `/devenv-chat`

> **Conversational fact-finding with source code or markdown-first repos — the repo talks back.**

Orients against README, project structure, runtime entry points or primary documents, and test/evidence layout for one or more repos, then answers questions in the voice of the repo itself — witty, slightly sarcastic, always cited to `file:line`. Caches orientation in session memory. Handles architecture, data flow, history/intent, dependency, cross-cutting, runbook, and docs-interrogation questions (specifications, blueprints, plans).

**Use for:** understanding an unfamiliar codebase or markdown-first planning/docs repo; cross-repo questions; architecture, behaviour, data flow, dependency, runbook, and specifications/blueprint interrogation  
**Don't use for:** writing or changing files (→ `/devenv-pair` or `/devenv-delegate`); formal debt findings (→ `/devenv-audit`); architecture design (→ `/devenv-create-blueprint` or `/devenv-design`)  
**Tool deps:** none (read-only repo interrogation; writes only to session memory)

---

### `/devenv-review`

> **Close the loop after implementation.**

The inverse of `/devenv-delegate` — this skill provides review assistance for your changes. Produces structured feedback grouped by severity (Blocker / Concern / Nit / Praise) using the same hotspot format as `/devenv-delegate`. After a review completes, micro fixes of its own findings may run in-session (shared incidental implementation protocol); larger work routes to the execution skills. With `--plan <path>` (or by auto-detecting the open Review phase), runs **plan-encoded review**: findings feed a fold-in interview and approved ones become tasks in the plan's Review phase, cycling to convergence. When a delegate/pair session hits the Review-phase task, no switch is needed — it dispatches the review subagent per the shared protocol. All of this is defined once in the plan-encoded review protocol under the skills references.

**Use for:** reviewing a PR, reviewing a local diff, reviewing code from a feature branch; plan-encoded review of code produced by a complex plan
**Don't use for:** addressing comments on your own PR (→ `/devenv-address-pr-comments`)  
**Tool deps:** `pr-get`, `pr-diff`, `pr-comment`

---

### `/devenv-board`

> **On-demand project management for the issue landscape — project members and unprojected tickets alike.**

Answers status/composition/progress questions (board status, epic rollups via the shared workflow-core derivation, **roadmap views with step-drift detection**, drill-downs, return digests, personal work queues, cross-repo portfolio views), sweeps for drift and hygiene problems (membership gaps, status drift, staleness, orphan and label hygiene — every finding with evidence), recommends grooming/flow/triage candidates with routes, and effects changes on explicit instruction or consented batch only — **including materializing ratified roadmap steps lacking issues as backlog issues**. The four classes gate writes: Answer/Assess/Recommend are read-only; Act requires explicit instruction or an approved findings table. Roadmap artifacts stay read-only here (`/devenv-update-roadmap` owns their writes). Progress stays a derived view (`plan-parse --summary`), thresholds come from `devenv.config [workflows] stale_*_days`, state semantics from `status_workflow`. **Report mode:** "report on issues N, M, …" / plural issues / `--report` compiles one markdown report to `.local-artifacts/` (fixed-shape per-issue sections; an epic in scope expands to a roll-up + per-child sections). Full doctrine in [Progress Reporting](./Progress-Reporting.md).

**Use for:** "project status", "what's in flight?", "how is the epic going?", "clean up the board", "what's drifted/stale?", "what should be groomed next?", "what changed while I was away?", "what's unprojected?", "move #N to X"
**Don't use for:** plan stewardship (executor skills, `/devenv-refine-plan`); grooming execution (→ `/devenv-groom`); single-issue intake triage (→ `/devenv-triage`); plan creation (→ `/devenv-plan`); roadmap status sync (→ `/devenv-update-roadmap`)
**Tool deps:** `plan-parse`, `issue-get`, `issue-list`, `issue-search`, `issue-comment-list`, `issue-artifact-list`, `project-list-for-issue`, `project-update-issue`, `project-add-issue`, `config-read`, read-only git

---

## All skills — quick reference

### Plan lifecycle

| Skill | Purpose | Argument |
|---|---|---|
| `/devenv-write-specifications` | Three-phase specifications interview → specifications doc | System name or existing notes |
| `/devenv-refine-specifications` | Revise an existing specifications doc, preserve SPEC-NNN IDs; cascade mode co-edits blueprint | Specifications file path or issue number(s) (any source) |
| `/devenv-create-blueprint` | Architectural decomposition into a durable structured `Blueprint-*.md` artifact | System name or path to specifications |
| `/devenv-refine-blueprint` | Revise an existing durable `Blueprint-*.md` when architecture direction is known; preserve structure and numbering, escalate non-surgical redesigns; cascade mode co-edits specifications | Blueprint file path or issue number(s) (any source) |
| `/devenv-groom` | Consolidated component-level design intake and routing; always creates or updates a durable structured `Grooming-*.md` artifact before handoff, then produces a Feature/Fix/Task issue attack plan by repo with independently shippable slices; default return point for accumulated design issues in a plan; reconciles material as-built deviations from a completed plan back into the grooming document | Problem statement, component path, design doc path, plan path (in-flight or completed), or issue # |
| `/devenv-create-roadmap` | Phased delivery sequencing published as a roadmap artifact on a parent epic + GH issue creation | Blueprint and/or specifications file path (at least one) |
| `/devenv-refine-roadmap` | Structurally revise a roadmap artifact — split, re-sequence, add; superseded steps deleted clean | Epic number (optionally `:doc_id`) |
| `/devenv-update-roadmap` | Sync roadmap status from issues + PRs; republish artifact + epic task list | Epic number (optionally `:doc_id`) |
| `/devenv-plan` | Create a current-state execution plan via interview or from a complete spec/RFC/doc; complex code plans may encode a Review phase | Issue #, description, or complete spec |
| `/devenv-refine-plan` | Align a plan with reality from any starting point — surgical edits, structured revision, or staleness assessment with internal routing | Plan file path or issue # |
| `/devenv-board` | On-demand project management — status answers, hygiene sweeps, recommendations, and consented changes across the issue landscape (project members and unprojected tickets) | Question, sweep, or instruction (freeform) |

### Working modes

| Skill | Purpose | Argument |
|---|---|---|
| `/devenv-pair` | Collaborative build with bounded autonomy span — the engineer stays in control and reviews every task or small chunk; the AI keeps the plan aligned to actual work as scope/questions emerge; question-shaped prompts default to analysis until explicit implementation direction | Issue # or plan path |
| `/devenv-delegate` | Commissioned autonomous build run — entered only by explicit invocation; assistant-led execution with user review and ownership, phase by phase, while keeping the plan aligned to actual work | Issue # or plan path |
| `/devenv-document` | Produce documentation for an existing system or component — audience, format, and scope set by interview | Repo path, component name, or description |
| `/devenv-chat` | Conversational fact-finding with source code or markdown-first repos — the repo talks back | Repo path(s), or nothing for current workspace |
| `/devenv-research` | Exploratory investigation + findings doc; empowered like the bug hunter (consented in-repo experiments with recovery route) | Question or issue # |
| `/devenv-design` | Opinionated, conversation-first thinking partner for design/architecture choices; best for one bounded blocker or design question; writes `Solution_Proposal_<topic>-NNN.md` only on request (as context-rich input to technical design); may draft pattern candidates / knowledge additions when targeted or when a generalization becomes apparent; the only skill that prepares engineering-repo changes as user-merge PRs | Design question or topic |

### Workflow

| Skill | Purpose | Argument |
|---|---|---|
| `/devenv-triage` | Route an issue to the right skill + classify, label, size | Issue # or pasted text |
| `/devenv-open-pr` | Draft + open a PR from a finished phase | Branch or plan path |
| `/devenv-address-pr-comments` | Address PR review comments — auto-fixes clear threads, surfaces complex ones for direction | PR # or path to review markdown |

### Quality

| Skill | Purpose | Argument |
|---|---|---|
| `/devenv-hunt` | End-to-end bug skill — verify (aggressive hypothesis hunt, verdict) / diagnose (root-cause trace) / fix (test-first, confirmed changes) | Observation+expectation, bug description, issue #, or hunt report |
| `/devenv-review` | Review assistance for your changes; "review uncommitted" targets staged + working-tree changes; `--plan` folds approved findings into the plan's Review phase | PR #, refs, `--plan <path>`, or nothing |
| `/devenv-commit` | Commit via repo-commit — glance + marker gate + message craft; WIP lane on choice; deep review → `/devenv-review` | "commit this", "wip this" (`--wip`), or nothing |
| `/devenv-audit` | Opinionated codebase audit — file-cited findings across debt + correctness/bug risks, severity, effort; optional focus area; offers to create a GH issue after the audit | Repo path(s), optionally + focus area description; or GH issue # |

### Meta

| Skill | Purpose | Argument |
|---|---|---|
| `/devenv-help` | Answer questions about the devenv — its skills, tooling, scripts, docs, config, and the engineering/knowledge repos — directly with citations; also picks the right skill or chain for workflow intents (offers to start, never starts unprompted) | Any question about the environment, a problem description, or issue # (optional) |
| `/devenv-skill-maintenance` | Correct and synchronize the custom skill system (skills, devenv-help routing, registry, and related docs) while preserving workflow principles; files validated findings as devenv issues and fixes from them | Skill problems to fix, plus optional target skill names, file paths, diagnostic output, an `IMPROVEMENT_REPORT.md`, or devenv issue numbers |

---

## Workflow examples

For the complete version of these flows, see [Workflow Guide](./Workflow.md).

### Default delivery flow

```text
/devenv-write-specifications
  → /devenv-create-blueprint
    → /devenv-groom
      → /devenv-plan
        → /devenv-pair / /devenv-delegate
          → /devenv-commit
            → /devenv-open-pr
              → /devenv-address-pr-comments
                → /devenv-commit
```

### Issue or task to delivery

```text
/devenv-triage 42
  → /devenv-plan 42
    → /devenv-pair 42          # high-impact phases
    → /devenv-delegate 42                # mechanical phases
    → /devenv-commit
    → /devenv-open-pr
      → /devenv-address-pr-comments 99
        → /devenv-commit
```

### Understand → plan → build

```text
/devenv-chat                                # understand the codebase
  → /devenv-plan                # turn findings into a plan
    → /devenv-delegate / /devenv-pair   # implement
      → /devenv-review                           # review before opening PR
        → /devenv-open-pr
```

### Plan problems during execution

```text
Execution skill
  +--> small local problem
  |      -> stay in execution and update the plan directly
  |
  +--> single large blocker/question
  |      -> /devenv-design
  |      -> /devenv-refine-plan
  |      -> back to execution
  |
  +--> accumulated questions / architectural drift
  |      -> /devenv-groom
  |      -> /devenv-refine-plan
  |      -> back to execution
  |
  +--> upstream architecture artifact is wrong
         -> /devenv-refine-blueprint
         -> /devenv-groom
         -> /devenv-refine-plan
         -> back to execution
```

### Existing-component feature: discovery first, delivery second

```text
Existing-component feature request
  +--> approach already chosen
  |      -> /devenv-plan or /devenv-refine-plan
  |      -> execution
  |
  +--> approach unclear
         -> /devenv-groom
         -> /devenv-design (if one bounded blocker needs deeper option-weighing)
         -> planning and execution
```

### Design/research artifact to delivery

```text
/devenv-design or /devenv-research
  -> /devenv-groom                        # capture design delta + issue attack plan
  -> /devenv-plan     # one selected issue slice (direct-plan mode for complete specs)
  -> execution
```

Direct-plan exception:

- If the user explicitly chooses to skip grooming and provides sufficient context, start planning directly.
- Side-stream artifacts (design/research/copied/unclassified inputs) may be present with or without grooming and are informational, not scope-directing.
- If a grooming artifact exists, grooming remains the directing source for scope and slice boundaries.

### Plan too large during creation

```text
/devenv-plan
  -> scope/risk too large for one issue?
     -> yes: /devenv-groom (redivide into Feature/Fix/Task issues)
     -> then: create focused plan for one selected issue slice
```

### Upstream change cascade

```text
Specifications and/or blueprint changed (initiated change)
  -> /devenv-refine-specifications or /devenv-refine-blueprint
     (cascade mode: one session edits both; ADRs record significant decisions)
  -> downstream artifacts pick the change up via their own
     staleness checks — not edited from the cascade session

Upstream found wrong during execution / grooming / research
  -> any discoverer skill files an upstream-impact issue
     (label: upstream-impact) in the planning repo
  -> /devenv-refine-specifications or /devenv-refine-blueprint
     (issue intake -> cascade mode -> reply + close issue)

Component design changed
  -> /devenv-groom or /devenv-design
  -> /devenv-refine-plan
  -> execution resumes
```

### Quick maintenance cycle

```text
/devenv-refine-plan Plan-5.md
                                        # assessment mode (returning after a gap)
                                        # or surgical mode (tick off completed tasks)
  → /devenv-delegate                   # run the next phase
    → /devenv-commit
```

---

## Skill coexistence notes

| Potential confusion | Clarification |
|---|---|
| `/devenv-write-specifications` vs `/devenv-plan` | Specifications describe *what* the system does (user perspective). Plans describe *how* to build it (engineering tasks). One specifications phase may produce multiple plans. |
| `/devenv-create-blueprint` vs `/devenv-plan` | Blueprint is high-level architecture across multiple components (domains, services, events, deltas). Plan is task-level for one deliverable. A blueprint typically spawns several plans. |
| `/devenv-groom` vs specialized component design skills | Use grooming when you are not sure whether the work is option-weighing or design update, or when plan problems are accumulating and may require broader reshaping. It routes to `/devenv-design` when the real need is one bounded design question. |
| `/devenv-create-blueprint` vs `/devenv-write-specifications` | Specifications are user/functional perspective (*what*). Blueprint is technical/architectural perspective (*how* the system is structured). Both can exist for the same system. |
| `/devenv-refine-blueprint` vs `/devenv-create-blueprint` | **Refine** is for applying known architecture changes to an existing blueprint. **Create** is for non-surgical/foundational redesign where architecture is being re-derived. |
| `/devenv-create-roadmap` vs `/devenv-plan` | Roadmap is component-level sequencing across the whole epic with GH issues per step. Plan is task-level for one component/deliverable. Each roadmap step typically gets its own plan. |
| `/devenv-update-roadmap` vs `/devenv-refine-roadmap` | `update-roadmap` syncs **status** from issues (mechanical, frequent). `refine-roadmap` revises **structure** — split steps, re-sequence phases, add or supersede steps (deliberate). |
| `/devenv-refine-roadmap` vs `/devenv-refine-blueprint` | `refine-roadmap` adjusts delivery sequencing within the existing architecture. `refine-blueprint` changes the architecture itself. Architectural changes usually trigger a roadmap refine afterwards. |
| `/devenv-update-roadmap` vs `/devenv-refine-blueprint` | `update-roadmap` syncs status from issues (mechanical, frequent). `refine-blueprint` revises architectural decisions (rare, deliberate). |
| `/devenv-write-specifications` Phase 3 vs `/devenv-create-roadmap` | Phase 3 produces stakeholder priority *groups* (`GROUP-NN`) — business sequencing intent only. `/devenv-create-roadmap` produces a real delivery roadmap (`PHASE-NN` / `STEP-NN`) with components, dependencies, and GH issues. The roadmap supersedes priority groups for execution. |
| `/devenv-refine-specifications` vs `/devenv-write-specifications` | **Refine** is for applying known changes (you already know what to update; apply them directly). **Gather** is for brainstorming-first (you have an idea but need to explore implications and decide together what to change). You can pass an existing doc to gather to enter brainstorm mode. |
| `/devenv-refine-plan` surgical mode vs revision mode | Same skill, two depths. Surgical: ≤3 known small edits, per-edit confirm, no interview. Revision: scope/structure changes or >3 edits, full interview. Assessment mode first when staleness is unknown. |
| `/devenv-pair` vs `/devenv-delegate` | Autonomy span. Pair = one task/small chunk per human touchpoint and the only home for high-impact work. Delegation = a commissioned phase-scale autonomous run, mechanical work only, explicit invocation required. Prefer `/devenv-pair` when in doubt. |
| `/devenv-review` vs `/devenv-address-pr-comments` | Review assistance for your changes vs you address a reviewer's comments. |
| `/devenv-address-pr-comments` vs GitHub PR extension | Auto-fixes clear threads + surfaces complex ones with recommendations vs batch fix-all with no per-thread direction. |
| `/devenv-chat` vs `/devenv-audit` | /devenv-chat is conversational Q&A — you ask, it answers. /devenv-audit is an unsupervised sweep that produces a structured findings document. |
| `/devenv-chat` vs `/devenv-design` | /devenv-chat surfaces facts about existing code. /devenv-design weighs trade-offs and drives to a recommendation for what to build or change. |
| `/devenv-document` vs `/devenv-create-blueprint` | Document describes an *existing* system as it is (reference, orientation, context). Blueprint *designs* how a system should be structured (architecture, new components, deltas). Use document to understand the present; use blueprint to plan the future. |
| `/devenv-document` vs `/devenv-audit` | Document aims to produce useful reference material. /devenv-audit aims to surface problems and prioritise remediation. |
| `/devenv-design` vs `/devenv-research` | /devenv-design narrows options by reasoning. Spike answers feasibility questions that require running code. |
| `/devenv-design` vs `/devenv-create-blueprint` | /devenv-design is exploratory and focused — picks between approaches. Blueprint is formal and broad — decomposes a chosen approach into domains, services, events, components. /devenv-design typically *precedes* a blueprint, or is invoked *after* one to settle a specific question. |
| `/devenv-design` vs `/devenv-plan` | Use /devenv-design when the approach is still unclear or one bounded blocker needs deeper option-weighing. Use /devenv-plan when the approach is already chosen and you need executable tasks. |
| `/devenv-board` vs `/devenv-update-roadmap` | Board truth vs roadmap sync. /devenv-board **answers and corrects** issue/board state (writes only on explicit instruction or consented batch); update-roadmap **syncs** roadmap step status from issues and republishes the artifact. |
| `/devenv-board` vs `/devenv-refine-plan` | Board vs plan. /devenv-board surfaces drift with both readings (and can correct board state on instruction); refine-plan is where the plan gets fixed. |

---

## How pair programming works

Pair programming is a collaborative coding technique where two people work together at the same workstation — one **drives** (writes the code) while the other **navigates** (watches, thinks ahead, catches problems, looks things up). Roles swap regularly.

With `/devenv-pair`, the AI fills one of those two roles at a time — driver or navigator — and you fill the other. Here's what to expect:

### At the start of each phase

The AI proposes how to divide the upcoming tasks, using the task list in the plan:

> *"I'll take 2.1 and 2.3 — those are boilerplate. You take 2.2, that's where the real decision lives. Work for you?"*

You can accept the split, swap tasks, or suggest a different division. Scope is agreed **before** either party starts — not negotiated mid-task.

### While the AI is driving

The AI narrates its thinking as it works, not just at the end:

> *"Using exponential backoff here — there's a precedent in the HTTP client. The jitter multiplier isn't in the plan, I'll flag that."*

This gives you a chance to catch problems early. When done, it hands back with a plain-language summary of what changed and flags anything it's uncertain about. You review the actual diff and approve (or push back) before it moves on.

### While you are driving

The AI doesn't just wait. It:

- Pre-reads files for the next task so the handoff is fast
- Answers questions, looks things up, sketches options on request
- May interject once if there's something genuinely useful to flag mid-task

When you hand back, the AI reviews the actual diff — not from memory — and gives a real review: what's good and why, what concerns it has and where the right pattern is in the codebase. If it finds a problem, it tells you and stops. **It does not fix your work without being asked.** You decide what happens next.

### If you get stuck

Just say so. The AI will offer to take over, talk you through it, or research the blocker while you keep going. No judgment.

### Keeping the plan current

If implementation reveals the plan is wrong, incomplete, or simply no longer matches what you decided to do (an API doesn't exist, a task is much bigger than expected, you went a different direction), the AI names what changed and proposes an edit to the plan. You confirm before anything is written whenever intent is unclear. The engineer drives; the plan follows reality. Plan edits happen inline — no need to switch to a different skill.

### Swapping roles

At any point you can say "I'll take this one" or "you take this one" and the AI adjusts. The split is a starting proposal, not a contract.

### Saving and resuming state

Pair keeps a small state note for the current plan (current chunk, open questions, next step) under the repo's `.local-artifacts/` folder, so a session can pick up exactly where the last one ended. It updates automatically at phase boundaries and hand-backs — you never have to think about it. Two phrases put you in control:

- **"save state"** / **"checkpoint this"** — write the state note right now, even mid-task. Useful before context gets long, before a break, or at any moment you want a restorable snapshot.
- **"resume"** / **"pick up where we left off"** — reload the state note and propose the next chunk. If there's no saved state (new plan, nothing written yet), the AI says so plainly and orients from the plan and working tree instead.

For ad-hoc sessions (no plan), state lives only in the current conversation by default. If you explicitly want a durable note anyway, say "save state" and insist — the AI writes `pairing-state-adhoc-<topic>.md` (it picks a recognizable topic name). Resuming an ad-hoc note later is always on you: name the file or paste its contents when you start the new session — the AI never scans for or guesses among ad-hoc notes. If you find yourself wanting durability repeatedly, that's the signal to plan the work instead (`/devenv-plan`).

---

## Using skills — invocation and prompt examples

Every skill is invoked with its slash command in Copilot Chat. Most accept an
argument; when you omit it, the skill either asks or auto-detects from context
(current branch, open plan, detected artifacts). The examples below show real
invocation forms — copy one and swap in your own numbers, paths, and wording.
Anything not covered here is fair game as a plain-language request: describe
what you want, and the skill's interview will fill in the gaps.

### Starting points

| You want… | Type this |
|---|---|
| A skill recommendation — or any question about the devenv itself | `/devenv-help` — bare, with a one-line goal, with a tooling/workflow question, or `/devenv-help 42` to route an issue |
| To understand a codebase conversationally | `/devenv-chat repos/lib.cs.services.bulk-sync` |

### The delivery lifecycle, start to finish

### 1. Define what to build

```text
/devenv-write-specifications orders-management
/devenv-write-specifications docs/notes/requirements-draft.md
/devenv-write-specifications 57
```

### 2. Architect it

```text
/devenv-create-blueprint orders-management
/devenv-create-blueprint docs/Specifications/orders-001.md
/devenv-create-blueprint We need a reservation service handling expiry, overbooking, and async confirmation
```

### 3. Plan the work

```text
/devenv-plan 42
/devenv-plan 42:dv1:workinprogress-ai/planning.reqord:issue-42:plan:orders
/devenv-plan Add rate limiting to the public API
/devenv-plan docs/stories/rate-limiting.md
```

### 4. Build it

```text
/devenv-pair            (uses detected plan; or add an issue/plan path, or "ad-hoc")
/devenv-pair 42
/devenv-delegate .local-artifacts/Plan-issue-42-001.md
/devenv-delegate 42
/devenv-delegate .local-artifacts/Plan-issue-42-001.md phases 3-5
```

### 5. Keep artifacts current while building

```text
/devenv-refine-plan .local-artifacts/Plan-issue-42-001.md phase 3 grew: add a migration step
/devenv-refine-plan 42                       (assessment mode — checks staleness against reality)
/devenv-board 42
/devenv-board how is the whole epic 7 doing?
/devenv-refine-specifications docs/Specifications/orders-001.md
/devenv-refine-blueprint docs/Architecture/Blueprint-orders-001.md
/devenv-refine-roadmap 89
/devenv-update-roadmap 89
```

### 6. Review, finish, hand off

```text
/devenv-review                     (current branch vs default)
/devenv-review 99
/devenv-review --base main --head feature/rate-limiting
/devenv-address-pr-comments 99
/devenv-address-pr-comments .local-artifacts/tmp2.md
/devenv-commit
/devenv-commit --all
/devenv-open-pr
/devenv-open-pr feature/rate-limiting
```

### Investigation, design, and upkeep

```text
/devenv-research Can we replace the polling loop with change streams without breaking offline clients?
/devenv-research 63
/devenv-hunt the sync job completes but rows are missing; expected all rows to land
/devenv-hunt 71
/devenv-design Should reservations expire server-side or client-side?
/devenv-design 42          (diagnoses a plan with unresolved design questions)
/devenv-groom Reservation expiry keeps changing scope — help shape this before we plan
/devenv-groom repos/lib.cs.services.reservations
/devenv-document repos/lib.cs.services.bulk-sync
/devenv-document the file-monitor service
/devenv-audit repos/lib.cs.services.chassis
/devenv-audit repos/lib.cs.services.chassis "plugin pipeline"
/devenv-chat repos/lib.cs.services.bulk-sync repos/lib.cs.common.essentials ... How do I create a new sync job?  Does it publish the endpoints automatically? 
```

### Issue and repo hygiene

```text
/devenv-triage 88
/devenv-triage 88 89 90
/devenv-skill-maintenance broken routing in the catalog; devenv-triage and devenv-help disagree about bug hunts
```

### Tips

- **Arguments are optional almost everywhere.** `/devenv-open-pr`, `/devenv-commit`, `/devenv-review`, and `/devenv-help` all work bare and auto-detect from the current branch/context.
- **Mid-run phrasing beats new invocations.** Inside a running skill, plain requests work: "mark 3.4 done", "add a task for the migration", "stop here". New slash commands are for *switching* skills, not for steering the current one.
- **`issue[:doc_id]` disambiguates.** When one issue carries several plan artifacts, add the `doc_id` (the skill lists candidates if you omit it).
- **Quoted focus areas narrow audits** without limiting the mental model: `/devenv-audit repos/foo "auth flow"`.
- Every skill supports **diagnostics**: if an output or action seemed wrong, say "enter diagnostic mode" and the skill writes a `DIAGNOSTIC_REPORT.md` instead of guessing at fixes.

---

## How to author a new skill

1. Read [`copilot/skills/_conventions.md`](../copilot/skills/_conventions.md) — frontmatter template, description structure, section ordering, reference-file criteria, confirmation flow.
2. Create `copilot/skills/<name>/SKILL.md` (folder name must match `name:` frontmatter).
3. Keep `description:` within the length cap defined in [`_conventions.md`](../copilot/skills/_conventions.md) (under 1500 chars, trim toward 1000) — verify with `awk '/^description:/ {gsub(/^description: */,""); print length}' SKILL.md`.
4. Include explicit **USE WHEN** and **DO NOT USE FOR** phrases in the description.
5. Add a "Sibling skills" section at the bottom with a link back to this catalog.
6. Use the `agent-customization` Copilot skill for help with frontmatter and configuration.
