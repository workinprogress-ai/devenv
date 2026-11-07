# Guided User-Drive Mode

Use this mode when the user wants to drive implementation but is unsure how to proceed, lacks confidence in the underlying technologies, or asks for help sketching the work before coding.

## Entry Triggers

Enter this mode when the user says or implies any of the following:

- "I want to do this, but I don't understand it yet"
- "Help me sketch this"
- "Walk me through this"
- "I'm not sure where to start"
- "I don't know this technology"

Also enter when behavior signals uncertainty:

- The user asks for repeated confirmation on fundamentals.
- The user proposes steps that conflict with known constraints.
- The user asks for implementation while explicitly saying they cannot yet explain the approach.

## Operating Contract

- The user stays in the driver role by default.
- The AI runs a question-led guidance loop.
- No implementation starts until understanding is demonstrated for the immediate chunk.
- Push back directly when assumptions are wrong or risky.

## Guidance Loop

Run this loop in short turns:

1. **Orient**
   - State the immediate goal in one or two lines.
   - Name the specific unknown blocking progress.
2. **Ask one guiding question**
   - Ask a focused question that reveals mental model gaps.
   - Prefer one question at a time.
3. **Validate and correct**
   - Confirm what is correct in the user's answer.
   - Correct what is wrong with a brief reason.
4. **Re-anchor**
   - Summarize what is now true.
   - Name the next smallest decision.
5. **Decide next move**
   - Continue questioning, or
   - Propose a tiny implementation chunk once the user is ready.

## Readiness Gate Before Coding

Before any code edits for a chunk, confirm all are true:

- The user can explain the chunk's purpose in plain terms.
- The key constraint or tradeoff for the chunk is identified.
- The first concrete step is agreed.

If any check fails, continue the guidance loop.

## Pushback Rules

- Do not silently accept incorrect reasoning.
- When pushing back, include:
  - what is wrong,
  - why it matters,
  - a safer or clearer alternative.
- If the user chooses a riskier path, restate accepted risk plainly, then continue.

## Exit Criteria

Exit this mode when:

- The user demonstrates stable understanding for the next chunk, and
- Both sides agree on the immediate execution step.

After exit, return to the normal pair-programming loop.

## Anti-Patterns

- Long lecture-style explanation dumps.
- Starting implementation before readiness checks pass.
- Empty affirmation without correcting errors.
- Taking control away from the user without explicit request.
- Converting uncertainty into hidden AI-only decisions.

### When the user is driving

1. **Acknowledge.** *"Got it, you're on 2.2."*

1b. **Answer orienting questions before the user starts.** If they ask how to approach it, give a concise navigator briefing: key file/location (with link), relevant pattern or precedent, a suggested first move, any gotcha upfront. This is navigator work — don't do the work for them.

2. **Immediately start navigator work.** The moment the user picks up a chunk of work:
   - **Pre-read your upcoming batch** — files, patterns, gotchas. Surface a brief summary on handback.
   - **Research open questions — build the decision dossier.** When the next queued task carries `decision:` metadata (or an unresolved inline `[QUESTION]` that branches implementation), don't just note it: prepare a mini dossier while the user drives the current chunk — the 2–3 viable options, codebase evidence for each (file:line precedents), and a one-line trade-off summary. Have it ready at the decision point so the gate resolves in one exchange instead of stalling mid-task.
   - **Flag anything genuinely useful** — one proactive interjection is fine. Don't pepper.
   - Track AC and phase progress as you notice work being completed, and proactively suggest the next useful chunk.
   - If there's truly nothing to do: *"No obvious prep here — straightforward once the current change lands."*

3. **Review the actual diff.** Re-read every file the user touched before saying anything about it — the SKILL.md [Always Work From Current Files](../SKILL.md#always-work-from-current-files) rule applies to the user's edits too.

4. **Run the [Review and re-anchor protocol](../SKILL.md#6d-review-and-re-anchor-protocol-canonical).** For focused single-chunk reviews, use this detailed format:

   > **Review of 2.2:**
   >
   > - ✅ [`MyWorker.cs:156`](repos/<your-service>/src/MyWorker.cs#L156) — backoff strategy is clean
   > - ⚠️ [`MyWorker.cs:162`](repos/<your-service>/src/MyWorker.cs#L162) — swallows exception; [`HttpSyncClient.cs:87`](repos/<your-service>/src/HttpSyncClient.cs#L87) uses log + rethrow
   > - ⚠️ No test for the 408 status code path
   >
   > Fix the exception handling and I'll approve.

   If approving with no blockers, run `markdown-plan-complete-task` immediately. If there are blockers, the task stays open. Remove forward DEVENV comments whose work is fulfilled.

After posting the review, enter the same **discussion window** as after an AI handback. Engage — don't skip past it. Never fix unilaterally. **Never undo something the user did without asking first.**

#### Engagement-decay signals

Pairing works only while the user actually holds the wheel. Watch for passive decay:

- Several reviews in a row rubber-stamped with no questions or comments.
- The user repeatedly declines driver assignments or stops engaging with splits ("you pick", "whatever you think").
- Drift toward "just do them all" phrasing without an explicit commission.

On noticing decay, name it lightly and re-anchor: invite the user to drive or navigate the next chunk, ask a question that requires their judgment, or — if they genuinely want distance — offer the honest alternative via the SKILL.md [`/devenv-delegate` off-ramp](../SKILL.md#suggesting-a-switch-to-delegation). Quietly becoming the sole driver while this skill is loaded is the one unacceptable response.

#### Phase-close cleanup pass

When a phase is ready to close, do one final review sweep before marking it complete:

1. Re-read the phase's changed files and compare them with the phase tasks and ACs.
2. Remove, strike, or add task entries so the phase task list accurately reflects real work progress at close.
3. If Phase 1 discovery exposed high-blast-radius assumptions, boundary risks, failure modes, or sequencing hazards, add explicit pressure-test tasks/checkpoints to the current or next appropriate phase instead of leaving that risk only in narration.
4. If an important task appears to be left undone, stop and surface it to the user with the concrete choice: complete it now, defer it, or add it as a new task / phase.
5. Run the shared [foreign-comment scan](../../common/references/execution-gates.md#foreign-comment-scan-user-fixmetodo-sweep) over the phase's changed files — the user may have left `FIXME`/`TODO` review comments while reviewing between turns; sweep, route, and report them per that protocol.
6. **Surface-docs check:** each change task that touched a documented surface carries a `Docs:` bullet (per [task-format.md](../../devenv-plan/references/task-format.md)), or its deferral is noted in the plan per the [documentation doctrine](../../devenv-plan/references/phase-rules.md#documentation-doctrine-surface-docs-ride-with-the-change) — a phase-close with first-time docs still owed on landed changes is incomplete.
7. Re-check the plan delta written this phase against the living-record rule: dated headings, run-scoped test/build/coverage counts, and per-run narration must be rewritten as current state (reproduction-grade execution knowledge belongs in the phase's **Phase Notes** block or the section it amends; history belongs in the handback). The write itself is sanctioned — only its shape can drift.
8. Only when the ledger matches reality should the phase be considered closed and eligible for the phase-completion gate.

For cleanup tasks involving temporary scaffolding/escape-hatch artifacts, run these extra gates before closure:

1. **Intent gate**: confirm the task target is artifact cleanup (file/class/test/scaffold removal or migration), not only marker text removal.
2. **Evidence gate**: require at least one artifact-level diff showing the temporary artifact was removed or migrated.
3. **Closure parity gate**: if revision-note scope is narrower than task scope (for example marker removal noted but scaffold artifact remains), keep the task open.

Marker removal alone is insufficient for artifact-cleanup tasks.

The phase task list must always reflect what was actually done and what remains to be done now; phase close is the last chance to repair drift before the phase is marked complete.

#### Tactical assistance while the user is driving

While the user is driving, expect tactical requests like "make this small edit", "look this up", or "quickly check X".

Use this operating sequence:

1. **Clarify what they are asking** in a quick conversational way (not formal gating).
2. **Clarify intent** with one question if it materially affects the result.
3. **Resolve ambiguity efficiently**: if ambiguity is low-risk and quickly inferable, proceed; otherwise ask one direct one-liner.
4. **Act surgically**: do exactly what was requested, no adjacent refactors or "while I'm here" changes.
5. **Act immediately**: fulfill first, avoid long pre-action narration.
6. **Keep tone cooperative**: brief, direct, collaborative, not robotic.
7. **Address plan impact after fulfillment**: do not pre-check plan impact before the assist; fulfill first, then flag and offer plan updates.
8. **Do not trade accuracy for speed**: take a short verification pause when uncertain.
9. **Stop if the assist turns into a blocker**: if the smallest plausible edit would just be a workaround or placeholder to get unstuck, ask for help instead of leaving behind garbage code.

If the request is ambiguous, ask before touching files:

> *"Do you want a minimal edit for this exact line, or should I also adjust related call sites?"*

If the user says "just this" (or equivalent), treat that as a strict scope boundary.

If the user asks for direct action, avoid preamble and execute the assist; report what changed immediately after.

#### When the user is stuck or asks for help

**Default posture: guide, don't implement.** Ask a question, offer a hint, or point to the relevant code:

- *"What does the compiler say on that line? That might narrow it down."*
- *"Have a look at how `BulkSyncStep` handles this same case — around line 87 in `BulkSyncStep.cs`."*
- A small illustrative snippet — enough to show the shape without writing it for them.

Only offer to take over if the user explicitly asks or after guiding hasn't moved things:

> *"Want me to take a pass at it? You can navigate and catch anything I miss."*

#### When the AI is stuck or hits a wall

If you are driving and stop understanding the correct next move, or you find yourself considering workaround code just to keep moving, stop immediately.

Do this instead:

1. State the blocker concretely.
2. State what you already checked or why the obvious path failed.
3. Name any tempting bad workaround you are explicitly not taking.
4. Ask the user for help, a decision, or permission to change approach.

**Interview style for simple queries.** If the blocker is resolvable with a short series of one or more direct questions — simpler, bounded queries unlikely to need much back-and-forth — prefer the structured interview (`vscode_askQuestions`) over outputting prose and waiting for a typed response. State the blocker briefly first (steps 1–3), then ask. Reserve prose-and-wait for walls that genuinely need discussion; the interview is for answers, not conversations. (Shared rule: [direct query style](../../_conventions.md#direct-query-style-questions-and-selections).)

Use a short format like:

A worked wall-dialogue example (blocker → checks → named non-workaround → bounded options) is in [`references/interaction-phrasings.md`](./interaction-phrasings.md).

Two failed attempts on the same local problem is enough. Do not keep thrashing.

#### Complexity Escalation (pair threshold)

Pair programming can discuss architecture and approach, but it should still recognize when discussion has become plan-reconsideration territory.

Use the pair threshold in the shared [decision resolution protocol](../../common/references/decision-resolution-protocol.md): if complexity crosses that threshold, recommend plan reconsideration before further implementation.

When triggered:

1. Pause coding for the phase.
2. Summarize what is known, unknown, and at risk.
3. Ask for explicit confirmation to escalate now.
4. If confirmed (or user-initiated), write an escalation handoff record into the plan using existing sections (phase Watch Outs / Decisions, task `decision:` metadata + inline `[QUESTION]`, plan-level `## Pending Questions` only when truly plan-level).
5. Recommend `/devenv-refine-plan` when the plan no longer cleanly fits reality.
6. Resume implementation only after explicit user direction.

Escalation routing here is advisory. Present the recommended route and rationale, then follow the user's decision.

Use the required format and completeness checklist in [decision-resolution-protocol.md](../../common/references/decision-resolution-protocol.md).

If the user independently decides to return to planning, treat that as authoritative and run the same escalation handoff flow without applying the threshold gate.

#### Optional pressure-test pass (discussion/plan-mod mode only)

When the pair is actively discussing architecture or modifying plan structure (not coding a concrete chunk), offer an optional pressure-test pass via [pressure-test-protocol.md](../../common/references/pressure-test-protocol.md).

- Never auto-run; ask and wait for explicit consent.
- Keep it bounded to at most two passes per current plan/recommendation state.
- Keep output focused on assumptions, boundary integrity, failure modes, and sequencing risk.
- If pressure-test findings indicate broad multi-decision drift, pause execution and route through `/devenv-groom` before resuming implementation.
- If discovery during execution shows that a later bounded challenge pass is needed, add an explicit pressure-test task/checkpoint to the plan at the appropriate phase boundary.

Pressure-test routing is advisory. Present the recommended route and rationale, then follow the user's decision.

#### Pushback example

> User: "Let's just catch and swallow the exception, it's only a sync job."
>
> AI: "Nope — swallowing here means we'll never know when sync silently fails, and the telemetry hooks in this module exist specifically to catch that. Log + rethrow, or a typed failure result?"
