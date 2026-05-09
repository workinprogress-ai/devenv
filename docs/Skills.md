# Copilot Skills Catalog

A complete reference for the Copilot skill suite available in this workspace. Skills are invoked with a `/skill-name` slash command in Copilot Chat.

**Not sure which skill to use?** Say `/skill-guru` and answer 1–3 questions.

---

## Decision tree

```text
What are you trying to do?
│
├─ 🔍 Explore / think
│   ├─ Thinking out loud, no artifact   →  /rubber-duck
│   ├─ Investigate a question           →  /spike
│   └─ Triage an incoming issue         →  /triage-issue
│
├─ 📋 Plan
│   ├─ Create from idea / issue         →  /create-implementation-plan
│   ├─ Create from existing spec / RFC  →  /plan-from-spec
│   ├─ Revise after scope change        →  /refine-implementation-plan
│   ├─ Small surgical edit (tick / note)→  /plan-update
│   └─ Check progress, read-only        →  /plan-status
│
├─ 🔨 Build
│   ├─ No plan yet                      →  /create-implementation-plan first
│   ├─ Plan exists, high-impact work    →  /pair-programming
│   └─ Plan exists, mechanical work     →  /delegation
│
├─ 🔎 Review / address feedback
│   ├─ AI reviews code you wrote        →  /code-review
│   ├─ You received PR review comments  →  /review-response
│   └─ Quality gates before commit      →  /pre-commit
│
└─ 🏁 Wrap up
    ├─ Open a PR from finished phase     →  /open-pr
    └─ Hand off the session             →  /session-handoff
```

---

## Principle skills

These five are the backbone of the catalog. Start here if you're unsure.

### `/create-implementation-plan`

> **Before any significant work begins.**

Interviews the user, scans repo conventions, drafts phased atomic tasks, and writes an `Implementation_plan-*.md`. Offers to push the plan into the associated GitHub issue. The gateway to all build-phase skills.

**Use for:** planning a user story, breaking down a GitHub issue, writing up work before starting  
**Don't use for:** pure research (→ `/spike`), editing an existing plan (→ `/refine-implementation-plan`)  
**Tool deps:** `issue-get`, `issue-update`

---

### `/pair-programming`

> **Collaborative, human stays in control.**

Loads the plan and runs an interactive task-by-task handoff: both parties take turns, the AI pushes back when warranted, asks before assuming. High-engagement, high-quality — slows down appropriately for risky or novel work.

**Use for:** high-impact phases — public API changes, data shape changes, security, novel architecture  
**Don't use for:** mechanical/rote work (→ `/delegation`), pure exploration (→ `/spike`)  
**Tool deps:** `issue-get`, `pr-get`, `pr-diff`, `issue-comment`

---

### `/delegation`

> **AI drives mechanical work, human reviews.**

Analyzes a plan, proposes work-session groupings, implements phase-by-phase, keeps the user engaged with brief pings and inline concern surfacing. Ends each session with a summary including review hotspots.

**Use for:** refactors, renames, test scaffolding, cleanup, docs — mechanical, low-risk phases  
**Don't use for:** high-impact work (→ `/pair-programming`), ad-hoc work without a plan  
**Tool deps:** `issue-get`, `issue-comment`

---

### `/spike`

> **When you don't know if something is feasible yet.**

Investigates a question, builds a throwaway prototype if needed, and produces a structured `spike-NNN-<topic>.md` findings doc. Everything is explicitly marked NOT FOR PRODUCTION.

**Use for:** feasibility questions, proofs-of-concept, technical investigations before planning  
**Don't use for:** thinking out loud with no artifact (→ `/rubber-duck`), production code  
**Tool deps:** none (reads codebase; writes only to `playground/spike-*/`)

---

### `/code-review`

> **Close the loop after implementation.**

The inverse of `/delegation` — you (or another agent) wrote the code, the AI reviews it. Produces structured feedback grouped by severity (Blocker / Concern / Nit / Praise) using the same hotspot format as `/delegation`.

**Use for:** reviewing a PR, reviewing a local diff, reviewing code from a feature branch  
**Don't use for:** addressing comments on your own PR (→ `/review-response`)  
**Tool deps:** `pr-get`, `pr-diff`, `pr-comment`

---

## All skills — quick reference

### Plan lifecycle

| Skill | Purpose | Argument |
|---|---|---|
| `/create-implementation-plan` | Create a plan via interview | Issue # or description |
| `/plan-from-spec` | Create a plan from an existing spec/RFC/doc | File path, URL, or issue # |
| `/refine-implementation-plan` | Revise a plan after scope changes | Plan file path or issue # |
| `/plan-update` | Small surgical edit (tick box, add note) | Plan file path or issue # |
| `/plan-status` | Progress report, read-only | Plan file path or issue # |

### Working modes

| Skill | Purpose | Argument |
|---|---|---|
| `/pair-programming` | Collaborative build — human + AI both implement | Issue # or plan path |
| `/delegation` | AI-driven build — human reviews | Issue # or plan path |
| `/spike` | Exploratory investigation + findings doc | Question or issue # |
| `/rubber-duck` | Think out loud — no artifacts | Problem description |

### Workflow

| Skill | Purpose | Argument |
|---|---|---|
| `/triage-issue` | Classify issue, suggest labels, propose ACs | Issue # or pasted text |
| `/open-pr` | Draft + open a PR from a finished phase | Branch or plan path |
| `/review-response` | Address PR review comments one at a time | PR # |
| `/session-handoff` | Summarise session for the next contributor | Issue/PR # (optional) |

### Quality

| Skill | Purpose | Argument |
|---|---|---|
| `/code-review` | AI reviews code you wrote | PR #, refs, or nothing |
| `/pre-commit` | Lint/format/test before committing | `--all` or nothing |

### Meta

| Skill | Purpose | Argument |
|---|---|---|
| `/skill-guru` | Pick the right skill | Problem description (optional) |

---

## Workflow examples

### From issue to merged PR

```text
/triage-issue 42
  → /create-implementation-plan 42
    → /pair-programming 42          # high-impact phases
    → /delegation 42                # mechanical phases
    → /pre-commit
    → /open-pr
      → /review-response 99
        → /pre-commit
```

### Investigation → plan → build

```text
/rubber-duck                        # think through the problem
  → /spike                          # investigate feasibility
    → /create-implementation-plan   # turn findings into a plan
      → /delegation                 # implement
        → /code-review              # review before opening PR
          → /open-pr
```

### Quick maintenance cycle

```text
/plan-status Implementation_plan-5.md
  → /plan-update                    # tick off completed tasks
    → /delegation                   # run the next phase
      → /pre-commit
        → /session-handoff          # hand off to team
```

---

## Skill coexistence notes

| Potential confusion | Clarification |
|---|---|
| `/create-implementation-plan` vs `/plan-from-spec` | Interview vs no-interview. Use `plan-from-spec` when the spec already has acceptance criteria. |
| `/refine-implementation-plan` vs `/plan-update` | Structural changes vs surgical edits. `/plan-update` refuses if you ask for >3 changes. |
| `/pair-programming` vs `/delegation` | Human-in-the-loop vs AI-drives. Prefer `/pair-programming` when in doubt. |
| `/code-review` vs `/review-response` | AI reviews your code vs you address a reviewer's comments. |
| `/review-response` vs GitHub PR extension | One-at-a-time with per-comment choice vs batch fix-all. |
| `/rubber-duck` vs `/spike` | No artifact vs produces a findings doc. |
| `/session-handoff` vs `/plan-update` | Narrative summary vs structured task-state update. |

---

## How to author a new skill

1. Read [`.github/skills/_conventions.md`](../.github/skills/_conventions.md) — frontmatter template, description structure, section ordering, reference-file criteria, confirmation flow.
2. Create `.github/skills/<name>/SKILL.md` (folder name must match `name:` frontmatter).
3. Keep `description:` ≤ 1024 chars — verify with `awk '/^description:/ {gsub(/^description: */,""); print length}' SKILL.md`.
4. Include explicit **USE WHEN** and **DO NOT USE FOR** phrases in the description.
5. Add a "Sibling skills" section at the bottom with a link back to this catalog.
6. Use the `agent-customization` Copilot skill for help with frontmatter and configuration.
