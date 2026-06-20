# Skills Registry

Single source of truth for the skill catalog. The `skill-guru` SKILL.md reads this file to answer questions about what skills exist, what triggers them, and how they chain together.

**For fork maintainers:** to add a custom skill, append a row to the appropriate category table below and, if the skill is part of a multi-step workflow, add or extend a chain entry in the Chains section.

---

## Category: Document

Skills for producing written documentation of existing systems and components.

| Skill | One-line purpose | USE WHEN triggers | NOT FOR |
| --- | --- | --- | --- |
| `/devenv-document` | Interview-driven documentation of an existing system, component, or cross-cutting concern — reads docs first, code second | "document this system", "write documentation for", "I need docs for", "create a context brief", "document this codebase", "document this component", "write up how this works", "we need documentation for" | conversational Q&A without a written output → `/devenv-chat-with-code`; formal architectural design → `/devenv-create-blueprint`; functional requirements → `/devenv-gather-requirements`; tech debt assessment → `/devenv-tech-debt-audit` |

---

## Category: Explore

Skills for thinking, investigating, and triaging — before any plan or code exists.

| Skill | One-line purpose | USE WHEN triggers | NOT FOR |
| --- | --- | --- | --- |
| `/devenv-rubber-duck` | Think out loud — no artifact produced | "think out loud", "rubber duck", "I'm stuck and need to talk it through", "help me think through X" | when opinions and a recommendation are wanted → `/devenv-design-discussion`; when an artifact (findings doc, plan) is needed → `/devenv-spike` |
| `/devenv-chat-with-code` | Conversational fact-finding session with one or more codebases — the code talks back | "chat with this code", "explain this repo", "how does X work", "walk me through the architecture", "what does this codebase do", "explain this service", "I want to understand this code" | writing or changing code → `/devenv-pair-programming` or `/devenv-delegation`; formal debt assessment → `/devenv-tech-debt-audit`; architecture design → `/devenv-create-blueprint` or `/devenv-design-discussion` |
| `/devenv-design-discussion` | Opinionated thinking partner for design / architectural choices at any zoom level; especially useful for one bounded blocker or design question; outputs `Solution_Proposal_<topic>-NNN.md` by default | "discuss the design", "weigh the options", "talk through the approach", "what's the right way to structure this", "discuss an architectural change", "single blocker in this plan needs brainstorming" | fuzzy articulation with no opinions → `/devenv-rubber-duck`; feasibility prototyping → `/devenv-spike`; formal architectural decomposition → `/devenv-create-blueprint`; task breakdown when approach is already chosen → `/devenv-create-implementation-plan` |
| `/devenv-spike` | Investigate a question and produce a structured findings doc | "spike on X", "investigate whether we can Y", "feasibility of Z", "throwaway prototype", "proof-of-concept" | writing production code → `/devenv-pair-programming`, lightweight thinking → `/devenv-rubber-duck`, opinionated approach comparison → `/devenv-design-discussion` |
| `/devenv-tech-debt-audit` | Opinionated codebase audit that surfaces tech debt and correctness/bug risks, optionally focused by module or bug class | "hunt for bugs", "find bug risks", "look for race conditions", "audit this area for bugs", "bug hunt in <module>", "scan for null/date/idempotency bugs" | single known bug root-cause/fix → `/devenv-bug-fix`; single PR review → `/devenv-code-review`; collaborative implementation → `/devenv-pair-programming` |
| `/devenv-bug-fix` | Investigate a bug from a GH issue or description, trace root cause through the codebase, produce findings report with proposed fix — user then chooses: create a plan, fix now, or fix themselves | "fix this bug", "investigate this issue", "find the root cause", "why is X broken", "diagnose this", GH issue # with a bug report | feature work → `/devenv-create-implementation-plan`; general codebase Q&A → `/devenv-chat-with-code`; feasibility research → `/devenv-spike` |
| `/devenv-triage-issue` | Classify an issue, suggest labels, check for duplicates | "triage this issue", "triage #123", "label and size this", "is this a duplicate" | implementing the issue → `/devenv-pair-programming`, turning it into a plan → `/devenv-create-implementation-plan` |

---

## Category: Requirements

Skills for capturing and formalising what a system should do, before any implementation planning begins.

| Skill | One-line purpose | USE WHEN triggers | NOT FOR |
| --- | --- | --- | --- |
| `/devenv-gather-requirements` | Structured interview to produce a requirements doc OR brainstorm changes to an existing doc (pass file path) | "gather requirements", "requirements document", "define the requirements for", "I have a new idea", "brainstorm this change", "what if we...", "interview me for requirements", pass an existing Requirements-*.md file path | quick inline feature clarification; code generation; applying known changes to an existing doc → `/devenv-refine-requirements` |
| `/devenv-refine-requirements` | Revise an existing requirements doc when you already know what to change (apply known changes directly) | "refine the requirements", "update the requirements", "the requirements need updating" | creating a new requirements doc → `/devenv-gather-requirements`; brainstorming changes to an existing doc → `/devenv-gather-requirements` (pass file path); ad-hoc one-line edits (just edit the file); revising the blueprint → `/devenv-refine-blueprint` |

---

## Category: Architecture

Skills for architectural design at all zoom levels — system (blueprint), component (technical design), and delivery sequencing (roadmap).

| Skill | One-line purpose | USE WHEN triggers | NOT FOR |
| --- | --- | --- | --- |
| `/devenv-create-blueprint` | Architectural decomposition into domains, services, events, and per-component deltas | "create a blueprint", "design this system", "architect this epic", "produce an architectural design", "blueprint this" | low-level task breakdown → `/devenv-create-implementation-plan`; sequencing into milestones → `/devenv-create-roadmap`; user-level requirements → `/devenv-gather-requirements` |
| `/devenv-grooming` | Consolidated intake for component-level design work; classifies/routes design decisions and produces a Feature/Fix/Task issue attack plan by repo with independently shippable slices; default return point for accumulated plan design issues | "groom this", "help decide design path", "which component design workflow", "plan has architectural issues", "accumulated architectural issues in this plan", "shape this feature before planning" | system-level architecture decomposition → `/devenv-create-blueprint`; pure task planning with no architecture decision → `/devenv-refine-implementation-plan`; coding execution → `/devenv-pair-programming` or `/devenv-delegation` |
| `/devenv-refine-blueprint` | Revise an existing blueprint when architecture change direction is known | "refine the blueprint", "update the blueprint", "revise the architecture", "the blueprint needs updating" | broad non-surgical architecture rethink → `/devenv-create-blueprint`; unresolved option-weighing before edits are known → `/devenv-design-discussion`; ad-hoc one-line edits (just edit the file); structural roadmap changes → `/devenv-refine-roadmap`; status-only roadmap sync → `/devenv-update-roadmap` |
| `/devenv-create-roadmap` | Phased delivery sequencing from a blueprint and/or requirements doc, with optional GH issue creation. Canonical entry point for bulk issue creation from a planning doc. | "create a roadmap", "plan delivery order", "build a roadmap from this blueprint", "build a roadmap from these requirements", "lay out the delivery phases" | low-level task breakdown → `/devenv-create-implementation-plan`; syncing roadmap state from issues → `/devenv-update-roadmap`; structural revisions → `/devenv-refine-roadmap`; nothing to plan from yet → `/devenv-gather-requirements` or `/devenv-create-blueprint` |
| `/devenv-refine-roadmap` | Structurally revise an existing roadmap — split steps, re-sequence, add components | "refine the roadmap", "revise the roadmap", "split this step", "re-sequence the phases", "the roadmap structure needs updating" | status-only sync from issues/PRs → `/devenv-update-roadmap`; creating a new roadmap → `/devenv-create-roadmap`; revising the underlying blueprint → `/devenv-refine-blueprint` |
| `/devenv-update-roadmap` | Sync roadmap step status from linked issues and PRs; create missing issues | "update the roadmap", "sync the roadmap", "refresh roadmap status", "the roadmap is out of date" | creating a new roadmap → `/devenv-create-roadmap`; structural revisions (split, re-sequence, add steps) → `/devenv-refine-roadmap`; refining the underlying blueprint → `/devenv-refine-blueprint` |

---

## Category: Plan

Skills for creating, updating, and inspecting implementation plans.

| Skill | One-line purpose | USE WHEN triggers | NOT FOR |
| --- | --- | --- | --- |
| `/devenv-create-implementation-plan` | Interview the user and write a phased `Implementation_plan-*.md`; loads issue body + comments when a GitHub issue is the source; triggers grooming redivision when scope is too large/risky; supports direct-plan mode and treats side-stream artifacts as additional (non-directing) context | "create an implementation plan", "plan this story", "break this task into phases", "write up a plan for this" | when a spec already exists with ACs → `/devenv-plan-from-spec`; editing existing plan → `/devenv-refine-implementation-plan` |
| `/devenv-plan-from-spec` | Generate a plan from an existing spec, RFC, design doc, or issue body; triggers grooming redivision when scope is too large/risky; supports direct-plan mode and treats side-stream artifacts as additional (non-directing) context | "turn this spec into a plan", "make a plan from this RFC", "plan from this design doc", "convert this issue into a plan" | vague/incomplete ideas (use `/devenv-create-implementation-plan` for the interview); revising existing plan → `/devenv-refine-implementation-plan` |
| `/devenv-refine-implementation-plan` | Revise a plan after scope changes, new requirements, or discoveries | "refine the plan", "update the plan", "the plan needs updating", "rework the plan based on what we learned" | small surgical edits (tick a box, add a note) → `/devenv-plan-update`; creating a new plan → `/devenv-create-implementation-plan` |
| `/devenv-refresh-implementation-plan` | Assess how stale an existing plan is, then route to the right remediation — light patch, structured revision, or guided rewrite | "refresh the plan", "is this plan still valid?", "how stale is this plan?", "bring this plan up to date", "freshen the plan", "the plan might be out of date" | when you already know exactly what needs updating → `/devenv-refine-implementation-plan`; read-only progress reporting → `/devenv-plan-status` |
| `/devenv-plan-update` | Small surgical edit to an existing plan — tick a box, add a note | "mark 3.4 done", "tick off task 2.1", "add a note to task X", "record progress" | restructuring or reordering phases → `/devenv-refine-implementation-plan`; read-only progress check → `/devenv-plan-status` |
| `/devenv-plan-status` | Report progress on a plan — read-only, no changes made | "what's the status of the plan", "how's the plan going", "where are we", "what's left on this plan" | modifying the plan → `/devenv-refine-implementation-plan` or `/devenv-plan-update` |

---

## Category: Build

Skills for implementing work from a plan.

| Skill | One-line purpose | USE WHEN triggers | NOT FOR |
| --- | --- | --- | --- |
| `/devenv-pair-programming` | Collaborative implementation — human and AI take turns, human stays in control | "pair program", "let's pair on this", "work on this issue with me", "implement this together" | solo "do this for me" tasks → `/devenv-delegation`; pure exploration → `/devenv-spike` |
| `/devenv-delegation` | Delegated implementation support — assistant-led execution with user review, using phase task-list refresh as the execution ledger | "delegate this to you", "you take this", "run with this", "implement this plan", "do this for me" | high-impact phases (public API, data shape, security, novel architecture) → `/devenv-pair-programming`; work without a plan → create one first |

---

## Category: Review

Skills for reviewing code and addressing feedback.

| Skill | One-line purpose | USE WHEN triggers | NOT FOR |
| --- | --- | --- | --- |
| `/devenv-code-review` | Review assistance for your changes — structured feedback by severity | "review this PR", "review my changes", "code review", "look over this branch", "review the diff" | addressing comments on your own PR → `/devenv-address-pr-comments`; general codebase Q&A |
| `/devenv-address-pr-comments` | Work through PR review comments — grouped by type, split between AI and user, full control over code/replies/resolution | "address PR comments", "work through the review feedback", "go through the PR comments with me", "respond to reviewer comments" | batch fix-all without review (use GitHub PR extension's `address-pr-comments`); opening a PR → `/devenv-open-pr` |
| `/devenv-pre-commit` | Run lint, format, type-check, and test as a final gate before committing | "run pre-commit checks", "lint and test before I commit", "is this ready to commit", "check my changes before commit" | opening a PR → `/devenv-open-pr`; code review → `/devenv-code-review` |

---

## Category: Wrap-up

Skills for closing out a session or shipping work.

| Skill | One-line purpose | USE WHEN triggers | NOT FOR |
| --- | --- | --- | --- |
| `/devenv-open-pr` | Draft and open a GitHub PR from a finished plan phase | "open a PR", "raise a PR", "create a PR", "open a pull request", "let's open a PR", "ship this phase", "wrap this branch into a PR" | responding to existing PR feedback → `/devenv-address-pr-comments`; wrapping up without a PR → `/devenv-session-handoff` |
| `/devenv-session-handoff` | Produce a structured handoff summary for the next contributor | "wrap up this session", "write a handoff", "session summary for the next person", "I'm tagging out" | updating plan task progress → `/devenv-plan-update`; drafting a PR → `/devenv-open-pr` |

---

## Category: Meta

| Skill | One-line purpose | USE WHEN triggers | NOT FOR |
| --- | --- | --- | --- |
| `/devenv-skill-guru` | Ask 1–3 questions and recommend the right skill | "which skill should I use", "help me pick a skill", "I'm not sure what to use", "skill guru" | executing any skill — just routes to them |
| `/devenv-skill-maintenance` | Maintain and correct the custom skill system while keeping docs, registry, and routing artifacts in sync | "fix this skill", "update SKILL.md", "repair the skills catalog", "sync skill docs", "correct skill routing", "here is diagnostic output from another skill" | general coding tasks unrelated to customization; feature implementation in product code; runtime bug diagnosis unrelated to skill docs |

---

## Chains

Known multi-step workflows. When the user's stated goal maps to a chain, recommend the full sequence and tell them where to start.

### Chain A — From issue to merged PR

The full lifecycle: triage → plan → implement → quality check → ship → address feedback.

```
/devenv-triage-issue
  → /devenv-create-implementation-plan
    → /devenv-pair-programming      (high-impact phases)
    → /devenv-delegation            (mechanical phases)
    → /devenv-pre-commit
    → /devenv-open-pr
      → /devenv-address-pr-comments
        → /devenv-pre-commit
```

**Start here:** `/devenv-triage-issue` (or `/devenv-create-implementation-plan` if already triaged)

---

### Chain B — Understand → investigate → shipped code

For work where understanding the codebase comes first, then feasibility, then implementation.

```
/devenv-chat-with-code              (understand the codebase)
  → /devenv-rubber-duck            (think through the problem)
    → /devenv-spike                (investigate feasibility)
      → /devenv-create-implementation-plan
        → /devenv-delegation       (implement)
          → /devenv-code-review   (review before opening PR)
            → /devenv-open-pr
```

**Start here:** `/devenv-chat-with-code` (or `/devenv-spike` if the codebase is already understood)

---

### Chain C — Quick maintenance cycle

For in-flight work: check where things stand, progress the plan, ship.

```
/devenv-refresh-implementation-plan  (if returning after a gap — is the plan still valid?)
  ↓ (or skip if plan is fresh)
/devenv-plan-status
  → /devenv-plan-update             (tick off completed tasks)
    → /devenv-delegation            (run the next phase)
      → /devenv-pre-commit
        → /devenv-session-handoff
```

**Start here:** `/devenv-refresh-implementation-plan` (if unsure) or `/devenv-plan-status` (if plan is known-current)

---

### Chain D — From raw idea to merged PR (full lifecycle)

For new systems or features where requirements are undefined. Default happy path: requirements, then blueprint, then component design, then executable plan, then delivery.

```
/devenv-gather-requirements
  → /devenv-create-blueprint
    → /devenv-grooming
      → /devenv-create-implementation-plan
        → /devenv-pair-programming       (high-impact phases)
        → /devenv-delegation             (mechanical phases)
        → /devenv-pre-commit
        → /devenv-open-pr
          → /devenv-address-pr-comments
            → /devenv-pre-commit
```

**Start here:** `/devenv-gather-requirements`

---

### Chain E — From requirements to delivery roadmap (architecture-driven)

For epic-scale work where requirements need to translate into architecture and a sequenced delivery plan with GitHub issues. Each roadmap step then spawns a technical design (for new components) and an implementation plan as work begins.

```
/devenv-gather-requirements
  → /devenv-create-blueprint
    → /devenv-create-roadmap         (creates GH issues across component repos)
      → /devenv-grooming             (classify component-level design work before tasks are written)
        → /devenv-design-discussion  (if approaches need weighing)
          → /devenv-create-implementation-plan   (per roadmap step, draws from the current design delta)
            → (Chain A continues from here)

  Throughout delivery:
    /devenv-update-roadmap            (sync status from issues + PRs)
    /devenv-refine-roadmap            (structural changes — split steps, re-sequence)
    /devenv-refine-requirements       (when stakeholder priorities or scope shift)
    /devenv-refine-blueprint          (when architecture changes mid-flight)
    /devenv-grooming                  (when a component's internal design needs a delta for in-flight work)
```

**Start here:** `/devenv-gather-requirements` (or `/devenv-create-blueprint` if requirements already exist)

---

### Chain G — Design a new component from a blueprint

For building a single new component identified in a blueprint. The grooming step confirms whether component-level design work is actually needed before planning.

```
/devenv-create-blueprint             (or existing blueprint as input)
  → /devenv-grooming                   (confirm whether component-level design work is needed)
    → /devenv-design-discussion        (if approaches need weighing)
      → /devenv-create-implementation-plan   (task breakdown draws from the current design)
        → /devenv-pair-programming / /devenv-delegation
          → /devenv-pre-commit → /devenv-open-pr
```

**Start here:** `/devenv-grooming` (if blueprint already exists)

---

### Chain F — Document an existing system, then plan future work

For legacy or underdocumented systems that need to be understood before any new work begins. Document first, then use the output to bootstrap planning.

```
/devenv-document                     (understand and write up the existing system)
  → /devenv-create-blueprint         (if architecture changes are coming)
  → /devenv-gather-requirements      (if functional requirements need to be defined)
  → /devenv-create-implementation-plan   (if a specific deliverable is already defined)
```

**Start here:** `/devenv-document`

---

### Chain H — Existing-component feature discovery to delivery

For adding a feature to an existing component when the implementation approach is not yet clear. Start with grooming; use design-discussion only when one bounded question needs deeper option-weighing; then flow back into plan updates and execution.

```
/devenv-grooming
  → /devenv-design-discussion            (only when one bounded blocker needs deeper option-weighing)
  → /devenv-grooming                     (when the component design artifact needs updating)
  → /devenv-create-implementation-plan or /devenv-refine-implementation-plan
    → /devenv-pair-programming / /devenv-delegation
```

**Start here:** `/devenv-grooming`

---

### Chain J — Design/spike artifact to delivery

For work that starts from a design-discussion or spike artifact, route through grooming first to produce coordination slices before planning execution details.

```
/devenv-design-discussion or /devenv-spike
  → /devenv-grooming                     (capture design delta + issue attack plan)
    → /devenv-create-implementation-plan or /devenv-plan-from-spec   (one selected issue slice)
      → /devenv-pair-programming / /devenv-delegation
```

**Start here:** `/devenv-grooming` (unless grooming already exists for the artifact)

Direct-plan exception:

- If the user explicitly chooses to skip grooming and provides sufficient context, start with `/devenv-create-implementation-plan` or `/devenv-plan-from-spec`.
- Side-stream artifacts may be provided whether or not grooming exists; they inform planning but do not direct scope.
- If a grooming artifact exists, grooming remains the directing source for scope/slice boundaries.

---

### Chain I — Plan trouble during execution

For work already in execution when the plan starts to hurt. Route by problem size rather than sending every problem back through the same step.

```
/devenv-pair-programming or /devenv-delegation
  → stay in execution                     (small local problem / question)
  → /devenv-design-discussion            (single bounded blocker)
    → /devenv-refine-implementation-plan
      → back to execution
  → /devenv-grooming                     (accumulated questions / architectural drift)
    → /devenv-refine-implementation-plan
      → back to execution
  → /devenv-refine-blueprint             (if grooming finds the real problem is upstream)
    → /devenv-grooming
      → /devenv-refine-implementation-plan
        → back to execution
```

**Start here:** stay in the current execution skill unless it is clear that the problem is larger than a local plan update

---

## Fork extension guide

To extend this catalog after forking:

1. **Add a skill row** to the appropriate category table above. Use the same column format: skill name (with `/`), one-line purpose, 2–4 USE WHEN trigger phrases (comma-separated), NOT FOR clause.

2. **Create a new category** if the skill doesn't fit any existing one — add a new `## Category: <Name>` section before the Chains section.

3. **Add a chain** if the new skill participates in a multi-step workflow — follow the chain block format with a `**Start here:**` line.

4. The `skill-guru` skill reads this file at invocation time, so no changes to `SKILL.md` are needed for simple additions. If the skill requires new Q1 options (a new work stage), update the question protocol in `SKILL.md` as well.
