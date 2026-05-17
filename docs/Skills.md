# Copilot Skills Catalog

A complete reference for the Copilot skill suite available in this workspace. Skills are invoked with a `/skill-name` slash command in Copilot Chat.

**Not sure which skill to use?** Say `/devenv-skill-guru` and answer 1–3 questions.

---

## Decision tree

```text
What are you trying to do?
│
├─ 🔍 Explore / think
│   ├─ Thinking out loud, no artifact   →  /devenv-rubber-duck
│   ├─ Understand a codebase via chat   →  /devenv-chat-with-code
│   ├─ Investigate a question           →  /devenv-spike
│   ├─ Weigh design options (opinionated)→ /devenv-design-discussion
│   └─ Triage an incoming issue         →  /devenv-triage-issue
│
├─ 📝 Define requirements
│   ├─ System needs functional definition before planning  →  /devenv-gather-requirements
│   └─ Revise an existing requirements doc                →  /devenv-refine-requirements
│
├─ 🏛️  Architect a system
│   ├─ Create architectural blueprint            →  /devenv-create-blueprint
│   ├─ Revise existing blueprint                 →  /devenv-refine-blueprint
│   ├─ Build delivery roadmap from blueprint and/or requirements   →  /devenv-create-roadmap
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
│   ├─ AI reviews code you wrote        →  /devenv-code-review
│   ├─ You received PR review comments  →  /devenv-review-response
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

Loads the plan and runs an interactive driver/navigator handoff: both parties take turns driving (writing the code) and navigating (watching, asking questions, keeping the big picture in view). The navigator is active during the other person's turn — pre-reading ahead, looking things up, catching problems early. The AI pushes back when warranted, narrates its own reasoning as it works, and asks before assuming. High-engagement, high-quality — slows down appropriately for risky or novel work.

**Use for:** high-impact phases — public API changes, data shape changes, security, novel architecture; also any work where you want to stay closely involved  
**Don't use for:** mechanical/rote work (→ `/devenv-delegation`), pure exploration (→ `/devenv-spike`)  
**Tool deps:** `issue-get`, `pr-get`, `pr-diff`, `issue-comment`  
**New to pair programming?** See [How pair programming works](#how-pair-programming-works) below.

---

### `/devenv-delegation`

> **AI drives mechanical work, human reviews.**

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

### `/devenv-chat-with-code`

> **Conversational fact-finding with a codebase — the code talks back.**

Orients against README, project structure, entry points, and test layout for one or more repos, then answers questions in the voice of the code itself — witty, slightly sarcastic, always cited to `file:line`. Caches orientation in session memory. Handles architecture, data flow, history/intent, dependency, cross-cutting, and runbook questions. Suggests transitioning to a sibling skill when conversation drifts toward planning or implementation.

**Use for:** understanding an unfamiliar codebase; cross-repo questions; architecture, behaviour, data flow, dependency, and runbook questions  
**Don't use for:** writing or changing code (→ `/devenv-pair-programming` or `/devenv-delegation`); formal debt findings (→ `/devenv-tech-debt-audit`); architecture design (→ `/devenv-create-blueprint` or `/devenv-design-discussion`)  
**Tool deps:** none (reads codebase; writes only to session memory)

---

### `/devenv-code-review`

> **Close the loop after implementation.**

The inverse of `/devenv-delegation` — you (or another agent) wrote the code, the AI reviews it. Produces structured feedback grouped by severity (Blocker / Concern / Nit / Praise) using the same hotspot format as `/devenv-delegation`.

**Use for:** reviewing a PR, reviewing a local diff, reviewing code from a feature branch  
**Don't use for:** addressing comments on your own PR (→ `/devenv-review-response`)  
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
| `/devenv-pair-programming` | Collaborative build — human + AI both implement | Issue # or plan path |
| `/devenv-delegation` | AI-driven build — human reviews | Issue # or plan path |
| `/devenv-chat-with-code` | Conversational fact-finding with a codebase — the code talks back | Repo path(s), or nothing for current workspace |
| `/devenv-spike` | Exploratory investigation + findings doc | Question or issue # |
| `/devenv-rubber-duck` | Think out loud — no artifacts | Problem description |
| `/devenv-design-discussion` | Opinionated thinking partner for design/architecture choices; optional `Design-<topic>-NNN.md` | Design question or topic |

### Workflow

| Skill | Purpose | Argument |
|---|---|---|
| `/devenv-triage-issue` | Classify issue, suggest labels, propose ACs | Issue # or pasted text |
| `/devenv-open-pr` | Draft + open a PR from a finished phase | Branch or plan path |
| `/devenv-review-response` | Address PR review comments one at a time | PR # |
| `/devenv-session-handoff` | Summarise session for the next contributor | Issue/PR # (optional) |

### Quality

| Skill | Purpose | Argument |
|---|---|---|
| `/devenv-code-review` | AI reviews code you wrote | PR #, refs, or nothing |
| `/devenv-pre-commit` | Lint/format/test before committing | `--all` or nothing |

### Meta

| Skill | Purpose | Argument |
|---|---|---|
| `/devenv-skill-guru` | Pick the right skill | Problem description (optional) |

---

## Workflow examples

### From raw idea to merged PR

```text
/devenv-gather-requirements
  → /devenv-plan-from-spec              # or /devenv-create-implementation-plan per phase
    → /devenv-pair-programming          # high-impact phases
    → /devenv-delegation                # mechanical phases
    → /devenv-pre-commit
    → /devenv-open-pr
      → /devenv-review-response
        → /devenv-pre-commit
```

### Epic-scale: requirements → architecture → delivery

```text
/devenv-gather-requirements
  → /devenv-create-blueprint            # architectural decomposition
    → /devenv-create-roadmap            # phases + GitHub issues across component repos
      → /devenv-create-implementation-plan   # per roadmap step, as work begins
        → /devenv-pair-programming / /devenv-delegation
          → /devenv-pre-commit → /devenv-open-pr → /devenv-review-response

  Throughout delivery:
    /devenv-update-roadmap               # sync status from issues + PRs
    /devenv-refine-roadmap               # structural changes — split steps, re-sequence
    /devenv-refine-requirements          # when stakeholder priorities or scope shift
    /devenv-refine-blueprint             # when architecture changes mid-flight
```

### Smaller-scale: requirements → delivery (no blueprint needed)

```text
/devenv-gather-requirements
  → /devenv-create-roadmap              # requirements-only mode: asks for component per step,
                                        # then creates parent epic + child issues
    → /devenv-create-implementation-plan   # per roadmap step
      → /devenv-pair-programming / /devenv-delegation
        → /devenv-pre-commit → /devenv-open-pr → /devenv-review-response
```

### From issue to merged PR

```text
/devenv-triage-issue 42
  → /devenv-create-implementation-plan 42
    → /devenv-pair-programming 42          # high-impact phases
    → /devenv-delegation 42                # mechanical phases
    → /devenv-pre-commit
    → /devenv-open-pr
      → /devenv-review-response 99
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

### Design exploration → formalisation

```text
/devenv-design-discussion                  # weigh approaches with opinions
  → /devenv-create-blueprint               # if systemic, formalise architecture
      → /devenv-create-roadmap → ...
  → /devenv-create-implementation-plan     # if component-level, plan the work
      → /devenv-pair-programming / /devenv-delegation
```

The skill also fits **after** a blueprint exists, when a specific design question surfaces during implementation — feed the recommendation back into `/devenv-refine-blueprint` or directly into the implementation plan.

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
| `/devenv-create-blueprint` vs `/devenv-gather-requirements` | Requirements are user/functional perspective (*what*). Blueprint is technical/architectural perspective (*how* the system is structured). Both can exist for the same system. |
| `/devenv-create-roadmap` vs `/devenv-create-implementation-plan` | Roadmap is component-level sequencing across the whole epic with GH issues per step. Implementation plan is task-level for one component/deliverable. Each roadmap step typically gets its own implementation plan. |
| `/devenv-update-roadmap` vs `/devenv-refine-roadmap` | `update-roadmap` syncs **status** from issues (mechanical, frequent). `refine-roadmap` revises **structure** — split steps, re-sequence phases, add or supersede steps (deliberate). |
| `/devenv-refine-roadmap` vs `/devenv-refine-blueprint` | `refine-roadmap` adjusts delivery sequencing within the existing architecture. `refine-blueprint` changes the architecture itself. Architectural changes usually trigger a roadmap refine afterwards. |
| `/devenv-update-roadmap` vs `/devenv-refine-blueprint` | `update-roadmap` syncs status from issues (mechanical, frequent). `refine-blueprint` revises architectural decisions (rare, deliberate). |
| `/devenv-gather-requirements` Phase 3 vs `/devenv-create-roadmap` | Phase 3 produces stakeholder priority *groups* (`GROUP-NN`) — business sequencing intent only. `/devenv-create-roadmap` produces a real delivery roadmap (`PHASE-NN` / `STEP-NN`) with components, dependencies, and GH issues. The roadmap supersedes priority groups for execution. |
| `/devenv-refine-requirements` vs `/devenv-gather-requirements` | Refine preserves existing REQ-NNN IDs and dependency links; gather creates from scratch. Use refine for anything except a brand-new requirements doc. |
| `/devenv-refine-implementation-plan` vs `/devenv-plan-update` | Structural changes vs surgical edits. `/devenv-plan-update` refuses if you ask for >3 changes. |
| `/devenv-pair-programming` vs `/devenv-delegation` | Human-in-the-loop vs AI-drives. Prefer `/devenv-pair-programming` when in doubt. |
| `/devenv-code-review` vs `/devenv-review-response` | AI reviews your code vs you address a reviewer's comments. |
| `/devenv-review-response` vs GitHub PR extension | One-at-a-time with per-comment choice vs batch fix-all. |
| `/devenv-rubber-duck` vs `/devenv-spike` | No artifact vs produces a findings doc. |
| `/devenv-rubber-duck` vs `/devenv-design-discussion` | Rubber-duck has no opinions and produces no artifact. Design-discussion brings strong opinions, drives to a recommendation, and optionally produces a `Design-<topic>-NNN.md`. |
| `/devenv-chat-with-code` vs `/devenv-rubber-duck` | Chat-with-code reads actual code and answers specific questions, cited to `file:line`. Rubber-duck is for thinking out loud about a problem without needing to look at code. |
| `/devenv-chat-with-code` vs `/devenv-tech-debt-audit` | Chat-with-code is conversational Q&A — you ask, it answers. Tech-debt-audit is an unsupervised sweep that produces a structured findings document. |
| `/devenv-chat-with-code` vs `/devenv-design-discussion` | Chat-with-code surfaces facts about existing code. Design-discussion weighs trade-offs and drives to a recommendation for what to build or change. |
| `/devenv-design-discussion` vs `/devenv-spike` | Design-discussion narrows options by reasoning. Spike answers feasibility questions that require running code. |
| `/devenv-design-discussion` vs `/devenv-create-blueprint` | Design-discussion is exploratory and focused — picks between approaches. Blueprint is formal and broad — decomposes a chosen approach into domains, services, events, components. Design-discussion typically *precedes* a blueprint, or is invoked *after* one to settle a specific question. |
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

1. Read [`.github/skills/_conventions.md`](../.github/skills/_conventions.md) — frontmatter template, description structure, section ordering, reference-file criteria, confirmation flow.
2. Create `.github/skills/<name>/SKILL.md` (folder name must match `name:` frontmatter).
3. Keep `description:` ≤ 1024 chars — verify with `awk '/^description:/ {gsub(/^description: */,""); print length}' SKILL.md`.
4. Include explicit **USE WHEN** and **DO NOT USE FOR** phrases in the description.
5. Add a "Sibling skills" section at the bottom with a link back to this catalog.
6. Use the `agent-customization` Copilot skill for help with frontmatter and configuration.
