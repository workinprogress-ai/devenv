# Phase Gates

## AC Review Gate

Run this gate after all implementation phases are complete and **before starting the Cleanup phase**. The AC Review must finish before the DEVENV cleanup grep runs — the `[AC-N]` DEVENV comments are removed together with other DEVENV markers in Cleanup.

1. Scan for `[AC-N]` DEVENV comments in the codebase: `grep -rn "\[AC-" <repo-root>`
2. For each hit, navigate to the code or test and assess whether the acceptance criterion is now objectively verifiable:
   - **Objectively verifiable** (test passes, behavior is observable by anyone looking at the code): run `markdown-plan-complete-ac AC-N [<plan_file>]` to tick it. State which AC was ticked and what evidence was used.
   - **Requires human judgment** (usability, performance, business rule interpretation): present it to the user: *"AC-3 — [criterion text]: can you confirm this is satisfied?"* Tick it after they confirm.
3. For any AC not yet exercised (no matching DEVENV comment found), surface it explicitly: *"AC-4 has no matching implementation comment — was it addressed? If not, it's a gap."* Let the user decide: tick it, defer it, or add a follow-up task.
4. For any AC whose scope changed meaningfully during implementation, apply the deprecation / revision rules (see `/devenv-refine-implementation-plan`).
5. All ACs must be either ticked `[x]` or explicitly deferred/deprecated before proceeding to Cleanup.

Once all ACs are resolved, surface the AC summary in the handback (delegation mode) or proceed to Cleanup (pair-programming mode):

> **AC Review complete:** AC-1 ✅, AC-2 ✅, AC-3 ✅ (human-confirmed), AC-4 deferred (out-of-scope for this plan — new issue filed).

## Phase Completion Gate

Before declaring a phase complete, run the committability checklist from [phase-rules.md](../../devenv-create-implementation-plan/references/phase-rules.md):

- [ ] All tests pass — including any tests written in the failing state (TDD) during this phase; the red-green cycle must close before this gate
- [ ] Coverage has not regressed vs. the start of the phase
- [ ] Tests added this phase assert observable behavior — not just execute code
- [ ] No blocking TODOs
- [ ] No unresolved `[QUESTION]` items remain for this phase unless explicitly deferred or spun out to a follow-up issue
- [ ] No straggler forward DEVENV comments remain in files touched this phase for work already completed — run `grep -rn "DEVENV\[" <phase-files>` to check; remove any found

If coverage has dropped, **it is a blocker** — the phase is not committable. Use this three-step protocol:

1. **Try first.** Before surfacing to the user, make a genuine effort to add the missing tests. If the gap is addressable with reasonable effort, close it without interrupting the flow.

2. **Surface if unable.** If after reasonable effort coverage still hasn't recovered, surface it with context:

   > *"🛑 Coverage dropped from 87% to 84%. I've added tests for X and Y but can't get Z covered without [reason — e.g. 'the method is internal and only exercised through integration', 'it requires a real external dependency']. Options: (a) I apply `[ExcludeFromCodeCoverage]` on that code with a reason comment, or (b) accept a documented floor drop and restore it in the finalization phase. Which do you prefer?"*

   Wait for an explicit decision before proceeding.

3. **If the user approves a bypass**, apply the chosen form immediately:
   - **Form A** (exclusion annotation): apply `[ExcludeFromCodeCoverage]` or equivalent. Add a reason comment adjacent to the annotation.
   - **Form B** (floor drop): accept a documented floor drop. Note the baseline, the reason, and which phase restores it.

   Either form requires adding a cleanup task to the finalization phase **at that moment**, and noting the bypass in the session changelog. The escape hatch is a debt instrument; the cleanup task is its repayment schedule. Flag as a hotspot in the phase completion handback.

The exception path (documented last resort) must be explicitly surfaced and agreed with the user before the phase is marked done.

If a phase-level or task-level `[QUESTION]` is still open, surface it the same way you would a blocker:

> *"🛑 This phase still has an open plan question: [QUESTION] Should retry policy honor `Retry-After`? We need to answer it, defer it explicitly, or spin it out before calling the phase complete."*

The user can also override the rule for a phase by:

- **Explicitly rejecting it** for this phase — their call, no further argument needed.
- **Applying coverage exclusion** to the code in question using the appropriate language attribute.
- **Adding verbiage to the plan** that modifies or waives the rule for specific phases — if that's present, honor it without re-raising the blocker.

If the gate passes cleanly, announce it:

> *"✅ Gate clear — phase is committable."*
