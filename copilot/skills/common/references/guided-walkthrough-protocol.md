# Guided Walkthrough Protocol

The shared shape of a walkthrough stop: how a skill shows one piece of code, a finding, or a change so the user can judge it. A full guided tour — an itinerary with modes, marks, and a ledger — belongs to `/devenv-chat`. Pair, delegate, review, and address-pr-comments run *limited* walkthroughs of a single stop, under this protocol.

A walkthrough is read-only: it explains and shows, it never edits.

## Stop anatomy

Every stop carries these parts, in this order:

1. **Where** — a navigable link to the code, `file:line`, following the [hotspot link location rule](../../_conventions.md#hotspot-bullet-format-shared).
2. **Why it matters** — one or two sentences on what this code is for.
3. **Drives / depends on** — what it calls or feeds, and what it relies on, each linked.
4. **Heads-up** — anything the user should weigh before judging (see [Heads-up callout](#heads-up-callout)); omit when there is none.
5. **What to look for** — the specific things worth checking.
6. **Your call** — **✅ fine · 🚩 flag · ❓ ask more · ⏭️ skip**.

## Show it before pointing at it

A stop is visual-first, so the user can take it in before opening any file:

- **Link** — the navigable `file:line` above.
- **Excerpt** — a short code excerpt in a language-fenced block, with its line range stated. It is re-read from the live file at stop time, never quoted from memory, and kept short (about fifteen lines; trim with `…` and say what was trimmed).
- **Illustration** — where it helps, a plain-text diagram in a fenced block: a flow, a dependency, a before and after. Plain-text diagrams render everywhere; use Mermaid only where the viewer is known to render it. An illustration that infers something not directly in the cited code says so.

## Heads-up callout

A heads-up is a plain-text callout marked ⚠️ that states the fact — for example, "the plan reserved this choice for you, and the run made it without a gate". The skill's personality never softens it or buries it in a joke; a change of voice is the signal that the user's attention is needed. The chat dialect, where one is in force, still governs the wording; only the personality drops.

## Limited single-stop walkthroughs

Pair, delegate, review, and address-pr-comments run a walkthrough when the user asks for one — "walk me through F5", "walk me through what you changed in phase 2". The skill shows the one stop (or the few stops that scope needs) in the anatomy above and answers questions in place. A limited walkthrough has no ledger, no modes, no marks that outlive the conversation, and no chaining.

The user's call is handled in the skill's own domain: a 🚩 in review becomes a finding or a fold-in candidate, in pair or delegate it becomes a task or a handback item, in address-pr-comments it becomes a thread disposition.

## Bright line

If a walkthrough needs a ledger — a route to resume, coverage that must be proven, or findings to hand to another skill — it is a chat tour, not a limited walkthrough. Offer to move it, per the [Skill Handoff Protocol](./skill-handoff-protocol.md), instead of growing the walkthrough in place.

## Anti-patterns

- Quoting an excerpt from memory, or from a stale read.
- A wall of code where a short excerpt and a link would do.
- Presenting an inference in an illustration as if it were in the code.
- Recording the user's call on their behalf.
- Letting a single-stop walkthrough quietly become a tour.
