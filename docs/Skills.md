# Copilot Skills Catalog

A complete reference for the Copilot skill suite available in this workspace. Skills are invoked with a `/skill-name` slash command in Copilot Chat.

**Not sure which skill to use?** Say `/devenv-skill-guru` and answer 1–3 questions.

**Need the full workflow, not just the catalog?** See [Workflow Guide](./Workflow.md).

---

## Decision tree

```text
What are you trying to do?
│
├─ 🔍 Explore / think
│   ├─ Thinking out loud, no artifact   →  /devenv-rubber-duck
│   ├─ Understand a codebase via chat   →  /devenv-chat-with-code
│   ├─ Investigate a question           →  /devenv-spike
│   ├─ Investigate and fix a bug        →  /devenv-bug-fix
│   ├─ Weigh design options (opinionated)→ /devenv-design-discussion
│   └─ Triage an incoming issue         →  /devenv-triage-issue
│
├─ 📄 Document
│   └─ Write docs for an existing system, component, or cross-cutting concern  →  /devenv-document
│
├─ 📝 Define requirements
│   ├─ System needs functional definition before planning  →  /devenv-gather-requirements
│   └─ Revise an existing requirements doc                →  /devenv-refine-requirements
│
├─ 🏛️  Architect a system
│   ├─ Create architectural blueprint            →  /devenv-create-blueprint
│   ├─ Revise existing blueprint                 →  /devenv-refine-blueprint
│   ├─ Groom component-level design direction    →  /devenv-grooming
│   ├─ Build delivery roadmap from blueprint and/or requirements  →  /devenv-create-roadmap
│   ├─ Structurally revise roadmap (split, re-sequence) → /devenv-refine-roadmap
│   └─ Sync roadmap state from issues / PRs      →  /devenv-update-roadmap
│
├─ 📋 Plan
│   ├─ Create from idea / issue         →  /devenv-create-implementation-plan
│   ├─ Create from existing spec / RFC  →  /devenv-plan-from-spec
│   ├─ Revise after scope change        →  /devenv-refine-implementation-plan
│   ├─ Small surgical edit (tick / note)→  /devenv-plan-update
│   └─ Check progress, read-only        →  /devenv-plan-status
│
├─ 🔨 Build
│   ├─ No plan yet                      →  /devenv-create-implementation-plan first
│   ├─ Plan exists, high-impact work    →  /devenv-pair-programming
│   └─ Plan exists, mechanical work     →  /devenv-delegation
│
├─ 🔎 Review / address feedback
│   ├─ Review your changes              →  /devenv-code-review
│   ├─ You received PR review comments  →  /devenv-address-pr-comments
│   └─ Quality gates before commit      →  /devenv-pre-commit
│
└─ 🏁 Wrap up
    ├─ Open a PR from finished phase     →  /devenv-open-pr
    └─ Hand off the session             →  /devenv-session-handoff
```

---

## Principle skills

These are the backbone of the catalog. Start here if you're unsure.

### `/devenv-gather-requirements`

> **Before planning begins, when requirements are undefined.**

Conducts a structured three-phase interview (vision → requirements → roadmap) and produces a `Requirements-<topic>-NNN.md`. Maintains a `session_memory-requirements.md` across sessions. The requirements document then feeds into `/devenv-create-blueprint`, `/devenv-plan-from-spec`, or `/devenv-create-implementation-plan`.

**Use for:** new systems or features where what the system should do isn't yet defined  
**Don't use for:** requirements already exist (→ `/devenv-create-blueprint` for epic-scale work, `/devenv-plan-from-spec` for single deliverables), quick inline clarifications  
**Tool deps:** none

---

### `/devenv-create-blueprint`

> **Architecture before planning, when the work spans multiple components.**

Conducts a three-phase architectural interview (context → architecture → consequences) and produces a `Blueprint-<system>-NNN.md` covering domains, services, events, communication patterns, and per-component deltas. For brownfield work, surveys existing components via `repo-cache-update` before designing. Maintains `session_memory-blueprint.md` across sessions.

**Use for:** epic-scale work touching multiple components; brownfield system extensions; greenfield system design  
**Don't use for:** single-component work (→ `/devenv-create-implementation-plan`), low-level task breakdown (→ `/devenv-create-implementation-plan`), sequencing into milestones (→ `/devenv-create-roadmap`)  
**Tool deps:** `repo-cache-update` (brownfield only)

---

### `/devenv-create-implementation-plan`

> **Before any significant work begins.**

Interviews the user, scans repo conventions, drafts phased atomic tasks, and writes an `Implementation_plan-*.md`. Offers to push the plan into the associated GitHub issue. The gateway to all build-phase skills.

**Use for:** planning a user story, breaking down a GitHub issue, writing up work before starting  
**Don't use for:** pure research (→ `/devenv-spike`), editing an existing plan (→ `/devenv-refine-implementation-plan`)  
**Tool deps:** `issue-get`, `issue-update`

---

### `/devenv-pair-programming`

> **Collaborative, human stays in control.**

Loads the plan and runs an interactive driver/navigator handoff: both parties take turns driving (writing the code) and navigating (watching, asking questions, keeping the big picture in view). The navigator is active during the other person's turn — pre-reading ahead, looking things up, catching problems early. The AI also acts as plan steward during execution: it keeps progress honest, captures newly discovered scope or unresolved questions back into the plan, and raises plan revisions when the work proves the plan needs to change. The AI pushes back when warranted, narrates its own reasoning as it works, and asks before assuming. High-engagement, high-quality — slows down appropriately for risky or novel work.

**Use for:** high-impact phases — public API changes, data shape changes, security, novel architecture; also any work where you want to stay closely involved  
**Don't use for:** mechanical/rote work (→ `/devenv-delegation`), pure exploration (→ `/devenv-spike`)  
**Tool deps:** `issue-get`, `pr-get`, `pr-diff`, `issue-comment`  
**New to pair programming?** See [How pair programming works](#how-pair-programming-works) below.

---

### `/devenv-delegation`

> **Delegated execution support for mechanical work, with user review and ownership.**

Analyzes a plan, proposes work-session groupings, implements phase-by-phase, keeps the user engaged with brief pings and inline concern surfacing. Ends each session with a summary including review hotspots.

**Use for:** refactors, renames, test scaffolding, cleanup, docs — mechanical, low-risk phases  
**Don't use for:** high-impact work (→ `/devenv-pair-programming`), ad-hoc work without a plan  
**Tool deps:** `issue-get`, `issue-comment`

---

### `/devenv-spike`

> **When you don't know if something is feasible yet.**

Investigates a question, builds a throwaway prototype if needed, and produces a structured `spike-NNN-<topic>.md` findings doc. Everything is explicitly marked NOT FOR PRODUCTION.

**Use for:** feasibility questions, proofs-of-concept, technical investigations before planning  
**Don't use for:** thinking out loud with no artifact (→ `/devenv-rubber-duck`), production code  
**Tool deps:** none (reads codebase; writes only to `playground/devenv-spike-*/`)

---

### `/devenv-document`

> **Write documentation for an existing system, component, or cross-cutting concern.**

Interviews the user to establish audience, output format, and scope before touching any files. Reads existing docs first (READMEs, design docs, ADRs, inline comments) and falls back to code only where docs are absent or insufficient — always surfacing the gap and recommending a depth level before reading deeper. Tracks open questions as Q-NNN items; resolves or defers all of them before writing. Proposes a session plan upfront for multi-component tasks. Maintains a `session_memory-document.md` for continuity across sessions.

**Use for:** documenting a legacy codebase; writing an onboarding guide; creating AI context briefs for future sessions; cross-cutting documentation that spans multiple repos  
**Don't use for:** conversational Q&A without a written output (→ `/devenv-chat-with-code`); formal architectural decomposition (→ `/devenv-create-blueprint`); tech debt assessment (→ `/devenv-tech-debt-audit`)  
**Tool deps:** none

---

### `/devenv-chat-with-code`

> **Conversational fact-finding with a codebase — the code talks back.**

Orients against README, project structure, entry points, and test layout for one or more repos, then answers questions in the voice of the code itself — witty, slightly sarcastic, always cited to `file:line`. Caches orientation in session memory. Handles architecture, data flow, history/intent, dependency, cross-cutting, and runbook questions. Suggests transitioning to a sibling skill when conversation drifts toward planning or implementation.

**Use for:** understanding an unfamiliar codebase; cross-repo questions; architecture, behaviour, data flow, dependency, and runbook questions  
**Don't use for:** writing or changing code (→ `/devenv-pair-programming` or `/devenv-delegation`); formal debt findings (→ `/devenv-tech-debt-audit`); architecture design (→ `/devenv-create-blueprint` or `/devenv-design-discussion`)  
**Tool deps:** none (reads codebase; writes only to session memory)

---

### `/devenv-code-review`

> **Close the loop after implementation.**

The inverse of `/devenv-delegation` — this skill provides review assistance for your changes. Produces structured feedback grouped by severity (Blocker / Concern / Nit / Praise) using the same hotspot format as `/devenv-delegation`.

**Use for:** reviewing a PR, reviewing a local diff, reviewing code from a feature branch  
**Don't use for:** addressing comments on your own PR (→ `/devenv-address-pr-comments`)  
**Tool deps:** `pr-get`, `pr-diff`, `pr-comment`

---

## All skills — quick reference

### Plan lifecycle

| Skill | Purpose | Argument |
|---|---|---|
| `/devenv-gather-requirements` | Three-phase requirements interview → requirements doc | System name or existing notes |
| `/devenv-refine-requirements` | Revise an existing requirements doc, preserve REQ-NNN IDs | Requirements file path |
| `/devenv-create-blueprint` | Architectural decomposition → blueprint doc | System name or path to requirements |
| `/devenv-refine-blueprint` | Revise an existing blueprint, preserve decisions | Blueprint file path |
| `/devenv-grooming` | Consolidated component-level design intake and routing; produces a Feature/Fix/Task issue attack plan by repo with independently shippable slices; default return point for accumulated design issues in a plan | Problem statement, component path, design doc path, plan path, or issue # |
| `/devenv-create-roadmap` | Phased delivery sequencing + GH issue creation | Blueprint and/or requirements file path (at least one) |
| `/devenv-refine-roadmap` | Structurally revise a roadmap — split, re-sequence, add | Roadmap file path |
| `/devenv-update-roadmap` | Sync roadmap status from issues + PRs | Roadmap file path |
| `/devenv-create-implementation-plan` | Create a plan via interview | Issue # or description |
| `/devenv-plan-from-spec` | Create a plan from an existing spec/RFC/doc | File path, URL, or issue # |
| `/devenv-refine-implementation-plan` | Revise a plan after scope changes | Plan file path or issue # |
| `/devenv-plan-update` | Small surgical edit (tick box, add note) | Plan file path or issue # |
| `/devenv-plan-status` | Progress report, read-only | Plan file path or issue # |

### Working modes

| Skill | Purpose | Argument |
|---|---|---|
| `/devenv-pair-programming` | Collaborative build — human + AI both implement, while keeping the plan current as scope/questions emerge | Issue # or plan path |
| `/devenv-delegation` | Delegated build support — assistant-led execution with user review and ownership | Issue # or plan path |
| `/devenv-document` | Produce documentation for an existing system or component — audience, format, and scope set by interview | Repo path, component name, or description |
| `/devenv-chat-with-code` | Conversational fact-finding with a codebase — the code talks back | Repo path(s), or nothing for current workspace |
| `/devenv-spike` | Exploratory investigation + findings doc | Question or issue # |
| `/devenv-rubber-duck` | Think out loud — no artifacts | Problem description |
| `/devenv-design-discussion` | Opinionated thinking partner for design/architecture choices; best for one bounded blocker or design question; outputs `Solution_Proposal_<topic>-NNN.md` by default | Design question or topic |

### Workflow

| Skill | Purpose | Argument |
|---|---|---|
| `/devenv-triage-issue` | Classify issue, suggest labels, propose ACs | Issue # or pasted text |
| `/devenv-open-pr` | Draft + open a PR from a finished phase | Branch or plan path |
| `/devenv-address-pr-comments` | Address PR review comments — auto-fixes clear threads, surfaces complex ones for direction | PR # |
| `/devenv-session-handoff` | Summarise session for the next contributor | Issue/PR # (optional) |

### Quality

| Skill | Purpose | Argument |
|---|---|---|
| `/devenv-bug-fix` | Investigate a bug, trace root cause, propose resolution — optionally fix immediately | Issue # or description |
| `/devenv-code-review` | Review assistance for your changes | PR #, refs, or nothing |
| `/devenv-pre-commit` | Lint/format/test before committing | `--all` or nothing |
| `/devenv-tech-debt-audit` | Opinionated codebase audit — file-cited findings across debt + correctness/bug risks, severity, effort; optional focus area; offers to create a GH issue after the audit | Repo path(s), optionally + focus area description; or GH issue # |

### Meta

| Skill | Purpose | Argument |
|---|---|---|
| `/devenv-skill-guru` | Pick the right skill | Problem description (optional) |
| `/devenv-skill-maintenance` | Correct and synchronize the custom skill system (skills, guru routing, registry, and related docs) while preserving workflow principles | Skill problems to fix, plus optional target skill names, file paths, or diagnostic output |

---

## Workflow examples

For the complete version of these flows, see [Workflow Guide](./Workflow.md).

### Default delivery flow

```text
/devenv-gather-requirements
  → /devenv-create-blueprint
    → /devenv-grooming
      → /devenv-create-implementation-plan
        → /devenv-pair-programming / /devenv-delegation
          → /devenv-pre-commit
            → /devenv-open-pr
              → /devenv-address-pr-comments
                → /devenv-pre-commit
```

### Issue or task to delivery

```text
/devenv-triage-issue 42
  → /devenv-create-implementation-plan 42
    → /devenv-pair-programming 42          # high-impact phases
    → /devenv-delegation 42                # mechanical phases
    → /devenv-pre-commit
    → /devenv-open-pr
      → /devenv-address-pr-comments 99
        → /devenv-pre-commit
```

### Understand → plan → build

```text
/devenv-chat-with-code                                # understand the codebase
  → /devenv-create-implementation-plan                # turn findings into a plan
    → /devenv-delegation / /devenv-pair-programming   # implement
      → /devenv-code-review                           # review before opening PR
        → /devenv-open-pr
```

### Plan problems during execution

```text
Execution skill
  +--> small local problem
  |      -> stay in execution and update the plan directly
  |
  +--> single large blocker/question
  |      -> /devenv-design-discussion
  |      -> /devenv-refine-implementation-plan
  |      -> back to execution
  |
  +--> accumulated questions / architectural drift
  |      -> /devenv-grooming
  |      -> /devenv-refine-implementation-plan
  |      -> back to execution
  |
  +--> upstream architecture artifact is wrong
         -> /devenv-refine-blueprint
         -> /devenv-grooming
         -> /devenv-refine-implementation-plan
         -> back to execution
```

### Existing-component feature: discovery first, delivery second

```text
Existing-component feature request
  +--> approach already chosen
  |      -> /devenv-create-implementation-plan or /devenv-refine-implementation-plan
  |      -> execution
  |
  +--> approach unclear
         -> /devenv-grooming
         -> /devenv-design-discussion (if one bounded blocker needs deeper option-weighing)
         -> planning and execution
```

### Design/spike artifact to delivery

```text
/devenv-design-discussion or /devenv-spike
  -> /devenv-grooming                        # capture design delta + issue attack plan
  -> /devenv-create-implementation-plan
     or /devenv-plan-from-spec              # one selected issue slice
  -> execution
```

Direct-plan exception:

- If the user explicitly chooses to skip grooming and provides sufficient context, start planning directly.
- Side-stream artifacts (design/spike/copied/unclassified inputs) may be present with or without grooming and are informational, not scope-directing.
- If a grooming artifact exists, grooming remains the directing source for scope and slice boundaries.

### Plan too large during creation

```text
/devenv-create-implementation-plan or /devenv-plan-from-spec
  -> scope/risk too large for one issue?
     -> yes: /devenv-grooming (redivide into Feature/Fix/Task issues)
     -> then: create focused plan for one selected issue slice
```

### Upstream change cascade

```text
Requirements changed
  -> /devenv-refine-requirements
  -> /devenv-refine-blueprint or /devenv-create-blueprint
  -> /devenv-grooming
  -> /devenv-refine-implementation-plan
  -> execution resumes

Blueprint changed
  -> /devenv-refine-blueprint
  -> /devenv-grooming
  -> /devenv-refine-implementation-plan
  -> execution resumes
```

### Quick maintenance cycle

```text
/devenv-plan-status Implementation_plan-5.md
  → /devenv-plan-update                    # tick off completed tasks
    → /devenv-delegation                   # run the next phase
      → /devenv-pre-commit
        → /devenv-session-handoff          # hand off to team
```

---

## Skill coexistence notes

| Potential confusion | Clarification |
|---|---|
| `/devenv-create-implementation-plan` vs `/devenv-plan-from-spec` | Interview vs no-interview. Use `plan-from-spec` when the spec already has acceptance criteria. |
| `/devenv-gather-requirements` vs `/devenv-create-implementation-plan` | Requirements describe *what* the system does (user perspective). Implementation plans describe *how* to build it (engineering tasks). One requirements phase may produce multiple implementation plans. |
| `/devenv-create-blueprint` vs `/devenv-create-implementation-plan` | Blueprint is high-level architecture across multiple components (domains, services, events, deltas). Implementation plan is task-level for one deliverable. A blueprint typically spawns several implementation plans. |
| `/devenv-grooming` vs specialized component design skills | Use grooming when you are not sure whether the work is option-weighing or design update, or when plan problems are accumulating and may require broader reshaping. It routes to `/devenv-design-discussion` when the real need is one bounded design question. |
| `/devenv-create-blueprint` vs `/devenv-gather-requirements` | Requirements are user/functional perspective (*what*). Blueprint is technical/architectural perspective (*how* the system is structured). Both can exist for the same system. |
| `/devenv-create-roadmap` vs `/devenv-create-implementation-plan` | Roadmap is component-level sequencing across the whole epic with GH issues per step. Implementation plan is task-level for one component/deliverable. Each roadmap step typically gets its own implementation plan. |
| `/devenv-update-roadmap` vs `/devenv-refine-roadmap` | `update-roadmap` syncs **status** from issues (mechanical, frequent). `refine-roadmap` revises **structure** — split steps, re-sequence phases, add or supersede steps (deliberate). |
| `/devenv-refine-roadmap` vs `/devenv-refine-blueprint` | `refine-roadmap` adjusts delivery sequencing within the existing architecture. `refine-blueprint` changes the architecture itself. Architectural changes usually trigger a roadmap refine afterwards. |
| `/devenv-update-roadmap` vs `/devenv-refine-blueprint` | `update-roadmap` syncs status from issues (mechanical, frequent). `refine-blueprint` revises architectural decisions (rare, deliberate). |
| `/devenv-gather-requirements` Phase 3 vs `/devenv-create-roadmap` | Phase 3 produces stakeholder priority *groups* (`GROUP-NN`) — business sequencing intent only. `/devenv-create-roadmap` produces a real delivery roadmap (`PHASE-NN` / `STEP-NN`) with components, dependencies, and GH issues. The roadmap supersedes priority groups for execution. |
| `/devenv-refine-requirements` vs `/devenv-gather-requirements` | Refine preserves existing REQ-NNN IDs and dependency links; gather creates from scratch. Use refine for anything except a brand-new requirements doc. |
| `/devenv-refine-implementation-plan` vs `/devenv-plan-update` | Structural changes vs surgical edits. `/devenv-plan-update` refuses if you ask for >3 changes. |
| `/devenv-pair-programming` vs `/devenv-delegation` | Human-in-the-loop vs AI-drives. Prefer `/devenv-pair-programming` when in doubt. |
| `/devenv-code-review` vs `/devenv-address-pr-comments` | Review assistance for your changes vs you address a reviewer's comments. |
| `/devenv-address-pr-comments` vs GitHub PR extension | Auto-fixes clear threads + surfaces complex ones with recommendations vs batch fix-all with no per-thread direction. |
| `/devenv-rubber-duck` vs `/devenv-spike` | No artifact vs produces a findings doc. |
| `/devenv-rubber-duck` vs `/devenv-design-discussion` | Rubber-duck has no opinions and produces no artifact. Design-discussion brings strong opinions, drives to a recommendation, and outputs a `Solution_Proposal_<topic>-NNN.md` by default. |
| `/devenv-chat-with-code` vs `/devenv-rubber-duck` | Chat-with-code reads actual code and answers specific questions, cited to `file:line`. Rubber-duck is for thinking out loud about a problem without needing to look at code. |
| `/devenv-chat-with-code` vs `/devenv-tech-debt-audit` | Chat-with-code is conversational Q&A — you ask, it answers. Tech-debt-audit is an unsupervised sweep that produces a structured findings document. |
| `/devenv-chat-with-code` vs `/devenv-design-discussion` | Chat-with-code surfaces facts about existing code. Design-discussion weighs trade-offs and drives to a recommendation for what to build or change. |
| `/devenv-document` vs `/devenv-create-blueprint` | Document describes an *existing* system as it is (reference, orientation, context). Blueprint *designs* how a system should be structured (architecture, new components, deltas). Use document to understand the present; use blueprint to plan the future. |
| `/devenv-document` vs `/devenv-tech-debt-audit` | Document aims to produce useful reference material. Tech-debt-audit aims to surface problems and prioritise remediation. |
| `/devenv-design-discussion` vs `/devenv-spike` | Design-discussion narrows options by reasoning. Spike answers feasibility questions that require running code. |
| `/devenv-design-discussion` vs `/devenv-create-blueprint` | Design-discussion is exploratory and focused — picks between approaches. Blueprint is formal and broad — decomposes a chosen approach into domains, services, events, components. Design-discussion typically *precedes* a blueprint, or is invoked *after* one to settle a specific question. |
| `/devenv-design-discussion` vs `/devenv-create-implementation-plan` | Use design-discussion when the approach is still unclear or one bounded blocker needs deeper option-weighing. Use create-implementation-plan when the approach is already chosen and you need executable tasks. |
| `/devenv-session-handoff` vs `/devenv-plan-update` | Narrative summary vs structured task-state update. |

---

## How pair programming works

Pair programming is a collaborative coding technique where two people work together at the same workstation — one **drives** (writes the code) while the other **navigates** (watches, thinks ahead, catches problems, looks things up). Roles swap regularly.

With `/devenv-pair-programming`, the AI fills one of those two roles at a time — driver or navigator — and you fill the other. Here's what to expect:

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

If implementation reveals the plan is wrong (an API doesn't exist, a task is much bigger than expected, you went a different direction), the AI names what changed and proposes an edit to the plan. You confirm before anything is written. Plan edits happen inline — no need to switch to a different skill.

### Swapping roles

At any point you can say "I'll take this one" or "you take this one" and the AI adjusts. The split is a starting proposal, not a contract.

---

## How to author a new skill

1. Read [`copilot/skills/_conventions.md`](../copilot/skills/_conventions.md) — frontmatter template, description structure, section ordering, reference-file criteria, confirmation flow.
2. Create `copilot/skills/<name>/SKILL.md` (folder name must match `name:` frontmatter).
3. Keep `description:` ≤ 1024 chars — verify with `awk '/^description:/ {gsub(/^description: */,""); print length}' SKILL.md`.
4. Include explicit **USE WHEN** and **DO NOT USE FOR** phrases in the description.
5. Add a "Sibling skills" section at the bottom with a link back to this catalog.
6. Use the `agent-customization` Copilot skill for help with frontmatter and configuration.
