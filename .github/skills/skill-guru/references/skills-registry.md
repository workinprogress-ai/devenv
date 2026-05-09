# Skills Registry

Single source of truth for the skill catalog. The `skill-guru` SKILL.md reads this file to answer questions about what skills exist, what triggers them, and how they chain together.

**For fork maintainers:** to add a custom skill, append a row to the appropriate category table below and, if the skill is part of a multi-step workflow, add or extend a chain entry in the Chains section.

---

## Category: Explore

Skills for thinking, investigating, and triaging — before any plan or code exists.

| Skill | One-line purpose | USE WHEN triggers | NOT FOR |
|---|---|---|---|
| `/rubber-duck` | Think out loud — no artifact produced | "think out loud", "rubber duck", "I'm stuck and need to talk it through", "help me think through X" | when an artifact (findings doc, plan) is needed → `/spike` |
| `/spike` | Investigate a question and produce a structured findings doc | "spike on X", "investigate whether we can Y", "feasibility of Z", "throwaway prototype", "proof-of-concept" | writing production code → `/pair-programming`, lightweight thinking → `/rubber-duck` |
| `/triage-issue` | Classify an issue, suggest labels, check for duplicates | "triage this issue", "triage #123", "label and size this", "is this a duplicate" | implementing the issue → `/pair-programming`, turning it into a plan → `/create-implementation-plan` |

---

## Category: Plan

Skills for creating, updating, and inspecting implementation plans.

| Skill | One-line purpose | USE WHEN triggers | NOT FOR |
|---|---|---|---|
| `/create-implementation-plan` | Interview the user and write a phased `Implementation_plan-*.md` | "create an implementation plan", "plan this story", "break this task into phases", "write up a plan for this" | when a spec already exists with ACs → `/plan-from-spec`; editing existing plan → `/refine-implementation-plan` |
| `/plan-from-spec` | Generate a plan from an existing spec, RFC, design doc, or issue body | "turn this spec into a plan", "make a plan from this RFC", "plan from this design doc", "convert this issue into a plan" | vague/incomplete ideas (use `/create-implementation-plan` for the interview); revising existing plan → `/refine-implementation-plan` |
| `/refine-implementation-plan` | Revise a plan after scope changes, new requirements, or discoveries | "refine the plan", "update the plan", "the plan needs updating", "rework the plan based on what we learned" | small surgical edits (tick a box, add a note) → `/plan-update`; creating a new plan → `/create-implementation-plan` |
| `/plan-update` | Small surgical edit to an existing plan — tick a box, add a note | "mark 3.4 done", "tick off task 2.1", "add a note to task X", "record progress" | restructuring or reordering phases → `/refine-implementation-plan`; read-only progress check → `/plan-status` |
| `/plan-status` | Report progress on a plan — read-only, no changes made | "what's the status of the plan", "how's the plan going", "where are we", "what's left on this plan" | modifying the plan → `/refine-implementation-plan` or `/plan-update` |

---

## Category: Build

Skills for implementing work from a plan.

| Skill | One-line purpose | USE WHEN triggers | NOT FOR |
|---|---|---|---|
| `/pair-programming` | Collaborative implementation — human and AI take turns, human stays in control | "pair program", "let's pair on this", "work on this issue with me", "implement this together" | solo "do this for me" tasks → `/delegation`; pure exploration → `/spike` |
| `/delegation` | AI-driven implementation — AI does the bulk, human reviews | "delegate this to you", "you take this", "run with this", "implement this plan", "do this for me" | high-impact phases (public API, data shape, security, novel architecture) → `/pair-programming`; work without a plan → create one first |

---

## Category: Review

Skills for reviewing code and addressing feedback.

| Skill | One-line purpose | USE WHEN triggers | NOT FOR |
|---|---|---|---|
| `/code-review` | AI reviews code you wrote — structured feedback by severity | "review this PR", "review my changes", "code review", "look over this branch", "review the diff" | addressing comments on your own PR → `/address-pr-comments`; general codebase Q&A |
| `/address-pr-comments` | Walk through PR review comments one at a time with per-comment choices | "address PR comments", "work through the review feedback", "go through the PR comments with me", "respond to reviewer comments one at a time" | batch fix-all without review (use GitHub PR extension's `address-pr-comments`); opening a PR → `/open-pr` |
| `/pre-commit` | Run lint, format, type-check, and test as a final gate before committing | "run pre-commit checks", "lint and test before I commit", "is this ready to commit", "check my changes before commit" | opening a PR → `/open-pr`; code review → `/code-review` |

---

## Category: Wrap-up

Skills for closing out a session or shipping work.

| Skill | One-line purpose | USE WHEN triggers | NOT FOR |
|---|---|---|---|
| `/open-pr` | Draft and open a GitHub PR from a finished plan phase | "open a PR", "raise a PR", "create a PR", "open a pull request", "let's open a PR", "ship this phase", "wrap this branch into a PR" | responding to existing PR feedback → `/address-pr-comments`; wrapping up without a PR → `/session-handoff` |
| `/session-handoff` | Produce a structured handoff summary for the next contributor | "wrap up this session", "write a handoff", "session summary for the next person", "I'm tagging out" | updating plan task progress → `/plan-update`; drafting a PR → `/open-pr` |

---

## Category: Meta

| Skill | One-line purpose | USE WHEN triggers | NOT FOR |
|---|---|---|---|
| `/skill-guru` | Ask 1–3 questions and recommend the right skill | "which skill should I use", "help me pick a skill", "I'm not sure what to use", "skill guru" | executing any skill — just routes to them |

---

## Chains

Known multi-step workflows. When the user's stated goal maps to a chain, recommend the full sequence and tell them where to start.

### Chain A — From issue to merged PR

The full lifecycle: triage → plan → implement → quality check → ship → address feedback.

```
/triage-issue
  → /create-implementation-plan
    → /pair-programming      (high-impact phases)
    → /delegation            (mechanical phases)
    → /pre-commit
    → /open-pr
      → /address-pr-comments
        → /pre-commit
```

**Start here:** `/triage-issue` (or `/create-implementation-plan` if already triaged)

---

### Chain B — Investigation to shipped code

For work where feasibility is unknown before planning begins.

```
/rubber-duck                 (think through the problem)
  → /spike                   (investigate feasibility)
    → /create-implementation-plan
      → /delegation          (implement)
        → /code-review       (review before opening PR)
          → /open-pr
```

**Start here:** `/rubber-duck` (or `/spike` if the problem is already clear)

---

### Chain C — Quick maintenance cycle

For in-flight work: check where things stand, progress the plan, ship.

```
/plan-status
  → /plan-update             (tick off completed tasks)
    → /delegation            (run the next phase)
      → /pre-commit
        → /session-handoff
```

**Start here:** `/plan-status`

---

## Fork extension guide

To extend this catalog after forking:

1. **Add a skill row** to the appropriate category table above. Use the same column format: skill name (with `/`), one-line purpose, 2–4 USE WHEN trigger phrases (comma-separated), NOT FOR clause.

2. **Create a new category** if the skill doesn't fit any existing one — add a new `## Category: <Name>` section before the Chains section.

3. **Add a chain** if the new skill participates in a multi-step workflow — follow the chain block format with a `**Start here:**` line.

4. The `skill-guru` skill reads this file at invocation time, so no changes to `SKILL.md` are needed for simple additions. If the skill requires new Q1 options (a new work stage), update the question protocol in `SKILL.md` as well.
