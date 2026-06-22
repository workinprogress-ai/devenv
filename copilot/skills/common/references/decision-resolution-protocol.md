# Decision Resolution Protocol

Use this protocol when unresolved plan decisions or pending questions block execution.

## Purpose

- Resolve blocking decisions without losing plan integrity.
- Keep decision handling explicit, traceable, and phase-scoped.
- Escalate to plan reconsideration when complexity exceeds mode limits.

## Hard Gate Rule

When a skill emits a `🔶` decision prompt or otherwise says a decision is required before continuing, treat that as a hard execution stop, not a suggestion.

- Stop immediately after presenting the decision.
- Ask for an explicit user choice or approval.
- Perform no mutating action until that approval is received.
- Treat silence, topic changes, or generic navigation phrases as not approved.

Mutating actions include any file edit, plan write, issue/comment write, terminal command that changes workspace state, or other write-capable tool invocation.

Before any mutating action while a decision is open, run this check:

- Is there an unresolved decision gate?
- Did the user explicitly approve a path?
- Is the intended action mutating?
- If mutating, does the approval cover this exact scope?
- If any answer is no, stop and ask one direct question.

## Classification

Classify each unresolved item before discussion:

1. Immediate unblock decision
   - Must be answered to execute a current-phase task.
2. Deferred implementation detail
   - Can be tracked and decided later without invalidating current-phase execution.
3. Plan-invalidating conflict
   - Changes acceptance criteria, phase boundaries, sequencing, or architecture assumptions enough that the plan is no longer reliable.

## Resolution Loop

1. Restate the decision in one sentence.
2. Present 2-3 concrete options with tradeoffs.
3. Recommend one option and why.
4. Ask for explicit user choice.
5. Do not perform any mutating action until that choice is explicit and scope-matched.
5. Record the result in the plan:
   - Phase-level under Watch Outs / Decisions.
   - Task-level as decision metadata on the earliest affected task.
   - Keep plan-level unresolved items in Pending Questions only when truly plan-level.

## Escalation Triggers

Escalate to plan reconsideration if any apply:

- Multiple interdependent architectural decisions emerge.
- Decision changes AC meaning, phase boundaries, or core sequencing.
- New constraints invalidate previously chosen strategy.
- Discussion no longer remains phase-scoped.

## Mode-Specific Thresholds

Delegation threshold (lower):

- Escalate when 1 plan-invalidating conflict appears, or
- 2 unresolved immediate decisions remain for the same phase.

Pair programming threshold (higher):

- Escalate when 2 plan-invalidating conflicts appear, or
- 3 unresolved immediate decisions remain across the active phase after a bounded attempt to resolve.

## Escalation Outcome

When escalation is triggered:

1. Pause coding for that phase.
2. Summarize what is known, unknown, and at risk.
3. Recommend either:
   - plan reconsideration via /devenv-refine-implementation-plan, or
   - mode switch (delegation to pair programming) if collaboration depth is now required.
4. Ask for explicit user confirmation before escalating: proceed now, defer, or continue with a bounded attempt.
5. Resume only after user direction is explicit.

## User-Initiated Escalation

If the user asks to return to planning directly, treat that as authoritative even if thresholds are not crossed.

- Acknowledge the user decision.
- Run the escalation handoff record steps.
- Recommend `/devenv-refine-implementation-plan` as the default planning path unless the user requests a different one.

Do not require threshold justification when escalation is user-initiated.

## Escalation Handoff Record (required)

When escalating back to planning, record unresolved decisions/questions thoroughly using existing plan sections:

1. Relevant phase in `## Phases`
   - Add or update entries under **Watch Outs / Decisions** for each blocking decision.
2. Relevant task in `## Detailed Task List`
   - Add `decision:` metadata on the earliest affected task.
   - Add inline `[QUESTION] ...` when the unresolved item is task/phase-specific.
3. `## Pending Questions`
   - Use only for genuinely plan-level unresolved questions.
4. `## Revision History`
   - Add a dated escalation entry with:
     - what was attempted,
     - options considered,
     - what remains unresolved,
     - why execution paused,
     - recommended next step.
   - Include a deterministic marker line at the top of the entry for downstream skills:
       - `[ESCALATION-HANDOFF] source=<pair|delegation> phase=<N> status=<needs-refine|user-deferred>`

Minimum completeness for escalation handoff:

- Decision statement
- Why it blocks execution now
- Options + tradeoffs already discussed
- Missing information/assumption
- Owner and trigger for next revisit

Suggested `## Revision History` entry shape:

```markdown
### <date> — Escalation handoff from <pair|delegation> (Phase <N>)

- [ESCALATION-HANDOFF] source=<pair|delegation> phase=<N> status=<needs-refine|user-deferred>
- Decision: <one-sentence decision statement>
- Blocker now: <why execution cannot proceed safely>
- Options considered: <A/B/C with brief tradeoffs>
- Missing info/assumption: <what is unknown>
- Recommended next step: `/devenv-refine-implementation-plan` (or user-chosen alternative)
- Revisit trigger/owner: <trigger and owner>
```
