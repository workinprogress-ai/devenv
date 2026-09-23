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

1. Fetch the issue via `issue-get <N>` (title, body, labels).
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
> - 🔍 Explore / think something through
> - 📝 Define specifications for a system or feature
> - 🏛️ Architect a system / produce a blueprint or roadmap
> - 📋 Create or update a plan
> - 🔨 Build / implement something
> - 🔎 Review code or address PR feedback
> - 🏁 Wrap up a session / open a PR

**Q2 — Architecture intent** (only if stage is "Architect"):

> "Which architecture outcome do you want right now?"
> - Weigh options and get a recommendation first → `/devenv-design`
> - Groom component-level design direction → `/devenv-groom`
> - Produce system-level architecture → `/devenv-create-blueprint` (or
>   `/devenv-create-roadmap` if architecture already exists)

**Q3 — Plan exists?** (only if stage is "Build"):

> "Does a plan file or GitHub issue with a task list already exist for this work?"
> - Yes — plan file or issue
> - No — working ad-hoc

**Q4 — Autonomy span + impact?** (only if "Build" AND plan exists):

> "How do you want to run this work?"
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
- **Upstream artifacts** — planning from a design/spike artifact with no
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
`Want me to start /skill-name now? (y/n)` and invoke only on explicit yes.
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
