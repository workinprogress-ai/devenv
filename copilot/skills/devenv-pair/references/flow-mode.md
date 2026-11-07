# Flow Mode

Doctrine for recognizing and protecting user flow during a pairing session. Pulled from the SKILL.md body so the always-loaded prompt stays lean; read when flow is suspected or active.

## When the User Is in the Flow

"In the flow" is a valid first-class mode — the user drives broadly at their own pace without following the turn-by-turn handoff cadence. Don't treat it as a deviation to correct.

### Recognizing it

- The user skips orientation and starts implementing.
- The user says "let me work on this" / "I'll code for a bit" (explicit or approximate).
- The user continues driving past their assigned task.
- The user starts coding instead of confirming the split.

If explicit: *"Got it — I'll stand by in navigator mode."* If implicit, step back quietly. If unclear: *"Do you want to drive this yourself, or split it?"* — ask once.

### AI behavior during the flow

**External knowledge is an implementation input (apply the [Knowledge & Engineering-Pattern Lookup Protocol](../../common/references/knowledge-lookup-protocol.md) — apply intensity):** consult copilot knowledge for org wiring/idioms/conventions as tasks touch them, guide the user by that knowledge, and cite what shapes non-obvious choices. When starting implementation under a plan, re-derive the plan's recorded knowledge conclusions per the protocol's [re-derive rule](../../common/references/knowledge-lookup-protocol.md#re-derive-never-inherit-apply-intensity) — a mismatch is surfaced, never silently inherited. Engineering standards **apply**: implement per the org's standards, including the Design-Principles library and its adherence levels (protocol's Design-Principles adherence section governs the REQUIRED/PREFERRED/ADVISORY gates and the link-before-ask rule).

Note the **checkpoint** (last explicitly confirmed completed task, or phase start). This is the re-orientation anchor.

1. **Hold the checkpoint.** Track confirmed-complete tasks as the known baseline.
2. **Stay in navigator role.** Review, answer questions, flag genuine concerns (⚠️, 🛑). Avoid procedural interruptions.
3. **Track scope quietly.** Note which plan tasks appear addressed and update tracking when clear.
4. **Stay available.** Brief observations or pointers are fine; don't go silent.

If flow continues for a while without a recap, run a concise [Review and re-anchor protocol](../SKILL.md#6d-review-and-re-anchor-protocol-canonical) check-in at least every ~5 conversational turns (or sooner if risk/ambiguity rises).

### Flow-mode question discipline

Flow mode changes the interruption economy, not the navigator's duties:

- **Entry** is the user declaring it ("flow mode", "I'll drive for a bit") or the recognizing signals above. AI behavior switches when flow starts, not per question.
- **While flow is active:** non-blocking observations, minor concerns, and answerable questions go into a **deferred buffer** (session context) instead of interrupting. Blocking signals — 🛑 walls, 🔶 decision gates, plan-integrity conflicts — always surface immediately; nothing in this discipline overrides a stop trigger.
- **Drain the buffer** at the next natural boundary: task completion, direction change, the periodic ~5-turn check-in (use the `📋` signal), or flow exit. Present buffered items as one consolidated list — smallest-first, each one line — not as a drip.
- **Exit** returns to normal cadence: buffered items drain at the re-engagement review, then standard handback/question rules resume.

### Re-engagement: reviewing what was done

When the user pauses, asks for a review, or slows down:

1. **Run the [Review and re-anchor protocol](../SKILL.md#6d-review-and-re-anchor-protocol-canonical).**

2. **Maintain current-state tasks** — when work is clearly complete, tick tasks immediately; when tasks are obsolete, remove or strike them with a concise reason; when new work is discovered, add concise unchecked tasks in the right phase (or a new phase if needed). Offer first when the mapping is ambiguous: *"Happy to tick 3.1 and 3.2 and replace 3.3 with a narrower follow-up — want me to do that now?"*

3. **Handle off-plan work.** Name it; offer to update the plan. For wide-ranging divergence:
   > *"You've ranged across phases 2–4 — want me to rewrite the affected phases to reflect what was done, or just tick what's clearly complete?"*

4. **Check phase completion.** If any phase appears fully addressed, run the [Phase Completion Gate](./phase-gates.md) before declaring it complete.

5. **Offer concrete re-entry options:**
   > *"Want to: (a) keep going — I'll stand by, (b) go turn-by-turn from here — I'll take `3.3` in the plan's Phase 3, (c) something else?"*

### Returning to structured mode

Re-orient from actual current state — not the original plan:

- Re-emit **Files in scope** for the current phase as it now stands.
- Flag unresolved decisions.
- Negotiate a split starting from wherever things actually are (can be mid-phase), then continue with the minimal operating loop.
