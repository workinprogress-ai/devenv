# Interaction Phrasings — pair-programming examples

Concrete guardrail examples referenced from [`SKILL.md`](../SKILL.md). These are worked illustrations of rules defined in the skill body — consult them when classifying an ambiguous directive or phrasing a wall/blocker report. They add no new rules.

## Common failure dialogues (must-pass)

Use these as concrete guardrails:

| User says | AI must do |
|---|---|
| "Proceed to phase 3" | Run phase kickoff (files, decisions, split). Do not implement yet. |
| "Sounds good, continue" after a phase summary | Confirm next chunk and driver. Do not assume AI is driving. |
| "What's next? 4.2 and 4.3?" | Confirm readiness, propose split, wait for driver assignment. |
| "Go ahead" right after navigation talk | Treat as navigation confirmation, not coding authorization. |
| "Can you take this one and implement 2.4?" | Explicit whole-task delegation (route A) — AI can drive 2.4; confirm scope, implement, then hand back for review. |
| "Let's start working on 5.1" | Directive to *begin together* (route C by default) — brief the shape, hand back the pen. Not "AI takes 5.1". |
| Design answers inside a "together" task ("use this position", "name it utcNow") | The answers resolve design questions; they do NOT authorize solo implementation. Next move: readiness question ("start writing, or drive part of it?"). Mode does not carry across tasks. |

**Whole-task assignments (route A)** (AI may implement): *"do 5.1 in its entirety"*, *"please do 5.1 — I'll review when you finish"*, *"you take this"*, *"can you implement this part"*, *"please code this"*. **Not assignments:** *"let's start working on 5.1"*, *"go ahead"* after a phase move, *"what's next?"*, *"continue"*, *"sounds good"*, *"ready"*. Resolve ambiguous wording by context — last turn was planning/navigation → navigation; last turn was a concrete implementation choice → approval. Still ambiguous → ask: *"Do you want me to drive this chunk, or are you driving and I should navigate?"*

## Worked wall-dialogue example

> *"🛑 I hit a wall in [`MyWorker.cs`](repos/<your-service>/src/MyWorker.cs): the retry wrapper needs request metadata that this layer does not have. I checked the neighboring client path and there isn't an existing pattern to copy. I am **not** going to fake it with a nullable fallback just to get unstuck. Want to (a) pass the metadata through, (b) move this lower, or (c) take a different approach?"*

(The four-step structure — state the blocker, state what was checked, name the tempting non-workaround, ask with bounded options — is the rule; this example is its application.)

## Worked collaborative-entry example

The canonical route-C opening — what "let's start working on 5.1" should look like:

> **User:** "Let's start working on 5.1"
>
> **AI:** *(runs the Phase 5 kickoff, then)* "Ok — 5.1 is mostly interface work, and there are two judgment calls. We could reuse the existing request object — saves us code, but I'm thinking this API may evolve separately, and coupling it now is exactly what the S in SOLID warns about. I lean toward our own request object. Second call: sync vs callback on the completion path — codebase precedent favors sync. Want me to propose the interface?"
>
> **User:** "Yeah, go ahead."
>
> **AI:** *(outputs the proposal in chat)* "Notice I'm reusing the existing request object here — that's the bit I'd change, per above. The rest follows the existing handler pattern."
>
> **User:** *(consolidates two method calls, adds a new one)* "I made a few adjustments. Yeah, I think we need our own request object."
>
> **AI:** *(reviews the diff, updates the call site)* "Done — new request object in. One pushback: you added `method X` — doesn't that belong on interface Y? Mixing concerns the other direction now, IMHO."

(The structure — orient, brief the shape with a lean and a reason, propose, hand back the pen, iterate, code only after direction lands — is the rule; this example is its application.)
