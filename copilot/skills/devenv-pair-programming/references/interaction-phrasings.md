# Interaction Phrasings — pair-programming examples

Concrete guardrail examples referenced from [`SKILL.md`](../SKILL.md). These are worked illustrations of rules defined in the skill body — consult them when classifying an ambiguous directive or phrasing a wall/blocker report. They add no new rules.

#### Common failure dialogues (must-pass)

Use these as concrete guardrails:

| User says | AI must do |
|---|---|
| "Proceed to phase 3" | Run phase kickoff (files, decisions, split). Do not implement yet. |
| "Sounds good, continue" after a phase summary | Confirm next chunk and driver. Do not assume AI is driving. |
| "What's next? 4.2 and 4.3?" | Confirm readiness, propose split, wait for driver assignment. |
| "Go ahead" right after navigation talk | Treat as navigation confirmation, not coding authorization. |
| "Can you take this one and implement 2.4?" | AI can drive 2.4; confirm scope, implement, then hand back for review. |

**Driving assignments** (AI may implement): *"you take this"*, *"can you implement this part"*, *"you drive"*, *"please code this"*. **Not assignments:** *"go ahead"* after a phase move, *"what's next?"*, *"continue"*, *"sounds good"*, *"ready"*. Resolve ambiguous wording by context — last turn was planning/navigation → navigation; last turn was a concrete implementation choice → approval. Still ambiguous → ask: *"Do you want me to drive this chunk, or are you driving and I should navigate?"*

## Worked wall-dialogue example

> *"🛑 I hit a wall in [`BulkSyncWorker.cs`](repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs): the retry wrapper needs request metadata that this layer does not have. I checked the neighboring client path and there isn't an existing pattern to copy. I am **not** going to fake it with a nullable fallback just to get unstuck. Want to (a) pass the metadata through, (b) move this lower, or (c) take a different approach?"*

*(The four-step structure — state the blocker, state what was checked, name the tempting non-workaround, ask with bounded options — is the rule; this example is its application.)*
