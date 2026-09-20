# Incidental implementation protocol (micro-fix lane)

Shared protocol for non-execution skills when the user asks for a small code or file fix inside a session whose core purpose is something else — fixing review findings after a review completes, repairing a bash bug noticed mid-maintenance, and the like. Adopting skills cite this file; the lane exists so the user is not bounced to another skill for a small fix, without diluting the adopting skill's core focus.

## Who may adopt this lane

Skills whose deliverable is analysis, feedback, or artifact maintenance **and** whose sessions naturally surface adjacent defects (e.g. `/devenv-code-review` findings, `/devenv-skill-maintenance` tooling bugs), **or** skills that edit code in a constrained way and may be asked for one small fix outside that constraint (e.g. `/devenv-address-pr-comments` beyond-thread fixes, `/devenv-pre-commit` fixes of a reported failure, `/devenv-open-pr` pre-ship touch-ups). Two classes never open this lane:

- **Design/planning/conversation skills** (`/devenv-design-discussion`, `/devenv-create-plan`, `/devenv-write-specifications`, `/devenv-rubber-duck`, `/devenv-chat-with-code`, the refine-* family, roadmap skills) — they have no reason to drift into implementation and keep plain routing per their DO NOT USE clauses.
- **Execution skills** (`/devenv-pair-programming`, `/devenv-delegation`) — they are the routing targets below and already define their own small-work mechanics.

## Entry gate (required)

The lane opens only on:

- an **explicit user ask** within the session ("fix these two nits", "repair that script bug"), or
- a **one-time offered choice** after the skill's primary deliverable completes ("want me to apply the two nits?").

Never self-initiated. Never offered before the skill's own deliverable is complete.

## The micro ceiling

Qualifying work is **micro**: one concern, one sitting, directly tied to the session's just-delivered findings or the artifact under discussion, small localized edits, no scaffolding, no new test suites, no plan needed.

**The wall:** anything past micro — multiple concerns, a chunk list, scope beyond the session's findings, anything plan-shaped — is not done in this lane. Route in one line and proceed:

- interactive, continuing in-session → `/devenv-pair-programming`
- plan-sized → `/devenv-create-plan` first
- commissioned unattended run → `/devenv-delegation`

## Rules while in the lane

- **Supervised only.** No unattended stretch. Finish the item, hand back for review, wait.
- **One item at a time.** Each subsequent item — even from the same findings list — re-enters through the entry gate; the lane never becomes a standing grant for open-ended work.
- **Safety inheritance.** All standing workspace rules apply unchanged: no mutating git commands, `FIXME(DEVENV[...])`/`TODO(DEVENV[...])` markers for temporary code, decision gates on ambiguity, test-run discipline. This protocol adds nothing and waives nothing.
- **Skill state first.** The adopting skill's own deliverable is complete before the lane opens, and its outputs are not left dangling — a pending confirmation flow (e.g. posting review findings) is finished or explicitly deferred before touching code.
- **One line of provenance.** Note in the handback that the fix ran under this lane, so review hotspots attribute correctly.
