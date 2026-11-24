# Routing mechanics

The procedural half of `/devenv-help`'s routing mode: how to get from an unclear
workflow intent to a skill recommendation. The *what exists* half is the
[skills registry](skills-registry.md) — categories, trigger phrases, NOT-FOR
conditions, chains. This file is the *how to route*.

## Shortcut rule — skip questions when intent is unambiguous

Before asking anything, check whether the user's message unambiguously maps to
exactly one skill or one chain in the registry. Examples of unambiguous intent:

- "I want to open a PR" → `/devenv-open-pr`
- "Run pre-commit checks" → `/devenv-commit`
- "Triage issue #42" → `/devenv-triage`
- "Which skill handles issue #42?" → Issue mode (below)
- "Fix problems in our custom skills" → `/devenv-skill-maintenance`
- "I want to go from raw idea to merged PR" → Chain D from the registry

If unambiguous: give the recommendation directly with a one-line rationale.
Skip Q1–Q4.

Bug-routing shortcut:

- Broad/class/focus-area bug hunting (no single known bug) → `/devenv-audit`.
- One specific known bug to root-cause or fix → `/devenv-hunt` (diagnose mode).
- Suspected but unconfirmed bug (specific observation + expected behavior) → `/devenv-hunt` (verify mode).
- A Critical/High correctness risk from `/devenv-audit` is unconfirmed until hunted → `/devenv-hunt` (verify mode); on FOUND the same skill continues to diagnose and fix.

## Issue mode

When the user hands over an issue number asking which skill should handle it:
read-only fetch + classify + recommend. No labels, no type, no priority, no
comments, no writes — full metadata triage stays with `/devenv-triage`.

1. Fetch the issue via `issue-get <N>` (title, body, labels). A bare number
   is fine to try read-only — `provider-explain issues` states whether the
   active provider needs a repo target (the repo-targeting guard is the
   fallback). A not-found read is reported, never guessed past.
2. Classify the issue shape using the workflow routing table in
   `/devenv-triage` — it is the canonical issue-shape → skill mapping.
   Do not duplicate or re-derive it here. Check `upstream-impact` labels first;
   ask one question on genuine two-route ambiguity; give a chain when multiple
   skills are needed.
3. Recommend (output format below) and offer to start. Never start unprompted.

Route to `/devenv-triage` instead when the user clearly wants the full
treatment: "triage", "label and size", "is this a duplicate", "set priority",
or a batch of issues.

## Question protocol

Ask only what you need. If the initial message already answers a question, skip
it. At most four questions, one at a time; most sessions need two or three.

**Q1 — Work stage** (ask if not already clear):

> "What are you trying to do right now?"
>
> - 🔍 Explore / think something through
> - 📝 Define specifications for a system or feature
> - 🏛️ Architect a system / produce a blueprint or roadmap
> - 📋 Create or update a plan
> - 🔨 Build / implement something
> - 🔎 Review code or address PR feedback
> - 🏁 Wrap up a session / open a PR

**Q2 — Architecture intent** (only if stage is "Architect"):

> "Which architecture outcome do you want right now?"
>
> - Weigh options and get a recommendation first → `/devenv-design`
> - Groom component-level design direction → `/devenv-groom`
> - Produce system-level architecture → `/devenv-create-blueprint` (or
>   `/devenv-create-roadmap` if architecture already exists)

**Q3 — Plan exists?** (only if stage is "Build"):

> "Does a plan file or GitHub issue with a task list already exist for this work?"
>
> - Yes — plan file or issue
> - No — working ad-hoc

**Q4 — Autonomy span + impact?** (only if "Build" AND plan exists):

> "How do you want to run this work?"
>
> - Task-by-task with me reviewing each chunk — high-impact work (public APIs,
>   data shape, security, novel architecture) belongs here regardless
> - A longer mechanical run the AI executes autonomously, phase by phase

Routing: task-by-task / high-impact → `/devenv-pair`; commissioned
autonomous mechanical run → `/devenv-delegate` (never route casual "do it"
requests there when the user is actively collaborating).

## Decision logic and guardrails

Match Q1 to a registry category, then the sub-goal to trigger phrases, then
apply guardrails before finalizing:

- **Meta-maintenance** — fixing skill definitions, aligning skill docs/registry,
  diagnostics from other skills, acting on `IMPROVEMENT_REPORT.md` →
  `/devenv-skill-maintenance`.
- **Feature discovery vs delivery** — adding a feature to an existing component
  while still deciding the approach → `/devenv-design` first;
  approach already chosen → Plan/Build.
- **Architecture intake** — default component-level architecture intake to
  `/devenv-groom` unless the user explicitly requests one specialized design
  skill. Alternatives/trade-offs wanted → `/devenv-design`. "The
  current approach is wrong" → `/devenv-groom`, not refine. One bounded
  blocker → `/devenv-design`; accumulating questions / sweeping
  redesign → `/devenv-groom`.
- **Upstream artifacts** — planning from a design/research artifact with no
  grooming artifact → `/devenv-groom` first unless explicitly bypassed.
  Where a grooming artifact exists, it directs scope/slice boundaries;
  side-stream artifacts are informational, never scope-directing.
- **Direct-plan exception** — user explicitly wants a plan without grooming
  (thin-air context, pasted notes, concrete spec) → `/devenv-plan`.
  Plan too large/risky for one issue → `/devenv-groom` for
  Feature/Fix/Task redivision, then back to `/devenv-plan` for one slice.
- **Build** — no high-impact phases to `/devenv-delegate`; delegation needs an
  explicit commission — actively collaborating means `/devenv-pair`
  even for mechanical work.
- **Escalation mid-execution** — small local plan adjustment → stay in the
  execution skill; broader plan surgery → `/devenv-refine-plan`; one large
  blocker → `/devenv-design`; accumulated architecture issues →
  `/devenv-groom`.
- **Status queries** — "how is X going?" across plans/issues, board hygiene,
  what's blocking → `/devenv-board` (executor skills answer only
  their own in-run status).

Check for a **chain**: multi-step goals map to a named chain in the registry —
recommend the full sequence with a start point. After the primary
recommendation, scan the registry for fork-added skills outside the standard
categories and surface them in one line.

## Output format

Single skill:

```
Recommended: `/skill-name`
Why: <one sentence tied to the user's answers>

Also consider:
- `/skill-name` — <when this would be the better pick instead>

Say `/skill-name` to start.
```

Omit "Also consider" when the recommendation is clear-cut.

Chain:

```
This goal spans multiple skills. Here's the full sequence:

1. `/first-skill` — <why this step>
2. `/second-skill` — <why this step>

Start here: `/first-skill`
```

**Offer to start** (single skill, invocation supported): close with
`Want me to start /skill-name now? (y/n)` and invoke only on explicit yes. To invoke is the [Skill Handoff Protocol](../../common/references/skill-handoff-protocol.md#switch-options)'s switch-here: after the yes, help loads the skill so it becomes the active frame, announces the move with the protocol's frame-close line, and hands over only the user's own words and artifact references; where the host cannot load a skill, help asks the user to type `/skill-name`.
Otherwise close with the plain `Say /skill-name to start.` Never start without
permission either way.

## Existing-component feature ambiguity breaker

If the wording contains both "existing component" and "new feature", ask one
direct question:

> "Are you trying to implement the feature now, or decide the
> architecture/design direction first?"

- Implement now → no plan → `/devenv-plan`; plan + high-impact →
  `/devenv-pair`; plan + mechanical + commissioned autonomous run →
  `/devenv-delegate`.
- Decide direction first → weigh alternatives → `/devenv-design`;
  component-level intake → `/devenv-groom`; specialized design skills only
  on explicit request.
- "Not sure yet" counts as decide-direction-first.

## Trip-wires and route-out

Help's lane is answering questions about this devenv and running the tooling commands the user asks for, including light issue operations. It never performs another skill's work. Three trip-wires mark the edge of that lane:

1. **Repo-content reads beyond docs.** Reading project-repo source, tests, or config to answer, rather than the devenv's own docs, tooling, and registry. The behavior of project code is `/devenv-chat`'s lane.
2. **Repository edits, or another skill's multi-step work.** Editing repository content, or running a multi-step workflow that a registry row assigns to a skill. Commands the user explicitly asked for stay in [execution mode](../SKILL.md#execution-mode), and light, user-directed issue operations stay there however many commands they take: log an issue, comment on it, label it; update or fetch an issue; handle the few issues the user listed. What leaves the lane is the work itself — full metadata triage of a new issue, grooming, creating issues in bulk from a roadmap or plan, or any repository edit.
3. **Another skill's lane.** Planning, implementing, reviewing, debugging, grooming or design deep-dives, issue triage, committing — any work a registry row assigns to a skill.

When a trip-wire fires, stop and run the route-out as an interview, per the [direct query style](../../_conventions.md#direct-query-style-questions-and-selections):

1. **Name the owning skill** and why, citing its registry row.
2. **Offer both ways to move**, per the [Skill Handoff Protocol](../../common/references/skill-handoff-protocol.md): switch now — help loads the skill after the user's explicit yes and announces the move with the protocol's frame-close line, which states that the new skill governs from here — or stay in help and switch in a new session with the handoff block. Recommend by the target's class: a mutating target defaults to a new session, anything else to switching here.
3. **Hand over only the user's own words and artifact references** — never help's recommendation or a mode label.
4. **If the user declines both**, stay in lane: answer what help can, and say plainly what it cannot do here.

Exits for the lanes help trips on most. The [skills registry](./skills-registry.md) is the routing truth: read the row before naming a skill.

| Lane | Owning skill |
|---|---|
| Behavior of project code, codebase walk-throughs | `/devenv-chat` |
| Planning a story or task | `/devenv-plan` |
| Implementing a plan together, or as a commissioned unattended run | `/devenv-pair`, `/devenv-delegate` |
| Reviewing a diff or PR | `/devenv-review` |
| Responding to PR feedback | `/devenv-address-pr-comments` |
| Committing, opening a PR | `/devenv-commit`, `/devenv-open-pr` |
| Investigating a suspected bug | `/devenv-hunt` |
| Design trade-offs, component-level grooming | `/devenv-design`, `/devenv-groom` |
| Issue metadata triage, board and population status | `/devenv-triage`, `/devenv-board` |
| Fixing the skill system itself | `/devenv-skill-maintenance` |
