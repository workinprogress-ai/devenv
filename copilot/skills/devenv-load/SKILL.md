---
name: devenv-load
description: 'Pre-load working context for the current repo (or a directed area of it) into the live session, so the next skill the user invokes starts warm. USE WHEN the user says "load this repo", "load context", "orient on this codebase", "warm up for work on X", or wants the repository context ready before choosing which workflow skill to use. Runs read-only orientation only: skill-orient census, scoped TODO markers, conventions files, and targeted codebase orientation — then hands back with no proposals and no routing. Deliberately writes nothing and decides nothing. DO NOT USE FOR durable written documentation of a system (use /devenv-document), answering questions about code in conversation (use /devenv-chat), devenv tooling/config questions (use /devenv-help), or starting any actual work — just invoke the work skill directly; this skill only warms the window.'
argument-hint: '[repo path | subdirectory | plan file] — optional; defaults to cwd repo'
user-invocable: true
---

# Load

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`.

> **Skill feedback:** If nothing is wrong but the user asks how the skill could be improved, follow the shared [Skill Feedback Protocol](../common/references/skill-feedback-protocol.md) to write `IMPROVEMENT_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`. Zero findings is a valid result; never offer unprompted.

Load the working context of a repository — or a directed area of it — into the live session so the next skill the user invokes starts warm. This skill exists for the moment the user knows work is coming but not yet which skill will do it: loading a worker skill prematurely would park its full procedure in the window and pollute the context for whatever actually runs. Load is deliberately minimal for the same reason: **its own instructions are designed to leave fast.** The whole skill in one line: **load the context, hand back, STOP.**

Same-session only, by design. What load reads lives in the conversation window, not on disk. Context loaded here dies with the session — that is the contract, not a limitation. Anything worth keeping has a dedicated door already (see Fences).

## When to Use

Trigger phrases:

- "load this repo" / "load context"
- "orient on this codebase" / "get familiar with this area"
- "warm up — I'll decide what to do next"
- The user names a repo or subdirectory with clear work intent but no skill chosen yet

Do **not** use for:

- Durable written documentation of a system or component (→ [`/devenv-document`](../devenv-document/SKILL.md) — its context briefs are authored artifacts)
- Answering questions about code in conversation (→ [`/devenv-chat`](../devenv-chat/SKILL.md) — load asks nothing and answers nothing)
- Devenv tooling, config, workflow, or docs questions (→ [`/devenv-help`](../devenv-help/SKILL.md))
- Starting actual work — just invoke the work skill; executor skills re-verify state on entry anyway (see Core Principles)

## Core Principles

1. **Read-only.** Load never edits a file, writes an artifact, or creates a note. Session memory is not used either — the window is the storage.
2. **Same-session only.** No durable output exists by design. If the user wants context that survives the session, name the right door: a context brief is `/devenv-document`'s job; work-in-progress durability is the pairing-state / plan-ify doctrine the executor skills already own. Load never authors either.
3. **No proposals, no routing.** The handback is one line. No plan suggestions, no findings lists, no "shall I proceed to X". If the user asks "what should I do next?", answer conversationally as the default agent — do not slide into another skill's intake.
4. **Head start, not ground truth.** Executor skills deliberately re-derive their state on entry (skill-orient, provenance baselines, marker scans). Load's context accelerates that; it never substitutes for it. Never tell the user "already done" about a kickoff step a worker skill will still run.
5. **Stay tiny.** The skill's value is that it adds almost nothing to the window. No references/ directory, no templates, no optional deep-dive modes that grow the footprint.
6. **Load expires at the next skill invocation.** Skill instructions do not unload — the next skill runs with this one still in the window. That is fine by design, but the precedence is fixed: once any other skill is invoked, **this skill's rules retire** — its prohibitions (writes nothing, no proposals, stay silent) are NOT standing orders over the worker, and the worker's own procedure wins wherever the two could conflict. What persists is exactly what load was for: the repo context — the oriented facts, the marker inventory, the conventions knowledge. Keep the cargo, retire the vehicle. Never re-assert a load rule to constrain a later skill.

## Procedure

1. **Resolve the target.** The cwd's repo unless the user named a repo path, subdirectory, or plan file. All reads scope to that target.
2. **Orient census.** Run `skill-orient` (scoped to the target if a subdirectory was named; pass `--plan <file>` when a plan file was named). Surface the JSON in one compact line: staged/unstaged/untracked counts, active plan if any, provenance hint.
3. **Marker discovery.** Run `devenv-marker-check --todo-report <target>`. Surface each cross-plan `TODO:DEVENV[...]` marker in one line (file + discharge condition) — these are prior sessions' messages the next skill will need; surfacing them here is load's main labor-saving act.
4. **Conventions skim.** Read `<target>/copilot/copilot-instructions.md` and `<target>/AGENTS.md` if present. Internalize; do not recite them back in full — one line noting they exist and any headline constraint.
5. **Directed orientation.** Only as the user directs (a subsystem, a file set, a plan's context): skim the named area's structure — entry points, module layout, test location. Default with no direction: repo top-level layout plus the areas the census flags (where the staged work sits, what the active plan touches). Use the `Explore` subagent for anything larger than a quick look; keep the volume bounded to what fits a warm-up.
6. **Handback — one line, then stop.** *"Oriented. Context is loaded for this session — invoke whichever skill you want; nothing was assumed."* Then be silent unless spoken to. The silence is load-mode behavior only: it expires the moment another skill is invoked (Core Principle 6) — the loaded repo context persists, the rules do not.

## Anti-patterns

**The contract in one line: load the context, hand back, STOP.** The list below is what the STOP means — the predictable drift shapes of an assistant told to orient. These govern load's own run; they are not standing orders over a later skill (per Core Principle 6, every rule here retires when the next skill is invoked — only the loaded repo context carries forward).

- **Writing any artifact** — a "loaded context" file, session-memory note, or summary doc. Same-session means the window is the only store.
- **Proposing next steps at handback** — "you could plan this", "want me to pair on that?" pollutes the exact window load cleaned. The one-line handback is the whole ceremony.
- **Sliding into a work skill's intake** — capturing a task mid-load, starting an interview. If the user states work intent during load, acknowledge and let them invoke the skill (or ask if they want to switch now).
- **Claiming worker-skill steps as done** — "markers already surfaced, so delegation can skip its discovery" is false; executors re-verify by design. Load is a head start, never a substitute.
- **Deep code exploration by default** — without direction, load skims layout; it does not read every module. Volume discipline is what keeps the window clean for the worker.
- **Reciting conventions verbatim** — internalize them; a full quote-back doubles the footprint for zero value.

## Sibling skills

- [`/devenv-chat`](../devenv-chat/SKILL.md) — conversational Q&A about code; load orients and says nothing.
- [`/devenv-document`](../devenv-document/SKILL.md) — authored, durable context briefs for a system; load is ephemeral session warm-up.
- [`/devenv-help`](../devenv-help/SKILL.md) — devenv/tooling/config/docs questions; load handles the repo's working context.
- [`/devenv-pair`](../devenv-pair/SKILL.md) / [`/devenv-delegate`](../devenv-delegate/SKILL.md) — the executors that typically run next; they re-derive state on kickoff by design.
