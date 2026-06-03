## Requirement Episodes

Episodes are a companion document — separate from the requirements file and designed to be *interesting*. Their purpose is to help anyone who reads the requirements (product owner, engineers, testers, stakeholders) emotionally internalise the system. A reader who has met Helen and watched her struggle with the current process will relate every dry requirement back to that experience.

### When to write episodes

Offer to write episodes at Phase 3 approval, once the requirements set is stable enough to tell coherent narratives:

> *"We're at a good stopping point. Would you like me to write a companion Episodes document? These are narrative 'day in the life' pieces that bring the requirements to life — they help people connect the dry REQ-NNN statements to something memorable."*

Do not write episodes earlier — they'll be stale before the interview is done.

### What good episodes look like

- **Specific names and places.** Real names for characters (Helen, Marcus, Priya), real-feeling places (Northgate Distribution Centre, the Bluebell Café), real-feeling company names (Foxton Logistics, Thornwood & Associates). No "User A" or "the company."
- **Narrative arc.** Follow a character through a situation — a day, a task, a problem and its resolution.
- **Emotionally engaging.** Characters think and feel. Helen is frustrated. Marcus is quietly proud of his workaround. Priya's relief when something finally works. Make the reader care.
- **Conversational.** Characters talk to each other. Dip into internal monologue. Dialogue is more vivid than narration.
- **Showing, not telling.** Don't say "the system was easy to use." Show Helen completing the task in two minutes despite never having used it before.
- **User perspective only.** Episodes describe what happens, never how. No databases, APIs, or implementation details.

### Voice and tone of episodes

Episodes are the one place in the requirements process where the writing has a voice. The interview is neutral; the episodes are not.

**Emotional engagement first.** Readers remember characters, not requirement IDs. Write so the reader feels Helen's frustration, Marcus's quiet satisfaction, Priya's small moment of triumph. Concrete specifics do this better than adjectives — show her sighing and opening a second browser tab, not "Helen found this frustrating."

**Humor, sprinkled.** Aim for one or two genuinely funny moments per episode — not a punchline every paragraph. The richest seam is the absurdity already baked into the domain: the approval workflow that technically requires a VP's sign-off for a £4 expense, the confirmation email that arrives four minutes after the item has already shipped, the status field that says "Pending" for three days and then silently disappears. Point at this stuff deadpan and let the reader do the work.

Outright jokes are allowed. Use them sparingly. A character's internal monologue is often the right place: *Marcus had requested this report every month for two years. Forty-three clicks. He'd counted.* That's a joke. It doesn't announce itself as one.

**Tone calibration:**
- Warm and observational, not satirical. The target is knowing recognition, not mockery of anyone's product or company.
- Dry over broad. Understatement beats exclamation marks.
- Vary the register. A frustrated character's section reads differently from a triumphant one. Use this.
- Never funny at a character's expense in a mean way. Funny *with* Helen, not *at* her.

**What to avoid:**
- Humor that obscures what the requirement actually does — the joke has to serve the illustration, not replace it.
- Forcing a funny moment when the scenario doesn't have one — a quiet, well-observed scene is better than a strained joke.
- Starting every episode with the same structure. Vary the opening — in media res, a snippet of dialogue, an observation, a problem already in progress.

### What episodes are NOT for

Edge cases and exception handling stay in REQ-NNN. Episodes can acknowledge that something went wrong, but they don't dwell on exception paths — that's what the requirements are for. Episodes also don't need to cover every requirement. They illustrate *clusters* of requirements in context. The goal is that a reader can think *"I see how REQ-019 relates to what happened to Marcus"* even if REQ-019 isn't called out explicitly in that episode.

### REQ-NNN references

Keep the episode text clean and narrative. Two reference mechanisms:

1. **Inline markdown links** at natural sentence breaks where a requirement is directly illustrated — *(see [REQ-014](#req-014-title))* — not mid-sentence, not cluttering every line.
2. **"Requirements illustrated" footer** at the end of each episode — a concise list of primarily illustrated requirements with markdown links.

Footer format:
```markdown
---
**Requirements illustrated:** [REQ-002](#req-002), [REQ-007](#req-007), [REQ-014](#req-014), [REQ-019](#req-019)
```

### Output file

Episodes live in `Episodes-<topic>-NNN.md` in the same folder as the requirements doc. Structure:

```markdown
# [System Name] — Episodes

> Companion to `Requirements-<topic>-NNN.md`. Episodes are not specifications — they illustrate requirements in context. See the requirements document for acceptance criteria and normative detail.

## Episode 1: [Title]

[Narrative — typically 300–600 words. Shorter is fine if the point lands.]

---
**Requirements illustrated:** [REQ-001](#req-001), [REQ-007](#req-007)

---

## Episode 2: [Title]

[...]
```

### How many episodes

Let scope drive the count. A single-epic doc covering 10–15 requirements might need 2–3 episodes. A large doc with 30+ requirements might need 5–7. The goal isn't exhaustive coverage — it's enough episodes that a reader can mentally map the full requirements set to at least one human situation they've encountered.

---

