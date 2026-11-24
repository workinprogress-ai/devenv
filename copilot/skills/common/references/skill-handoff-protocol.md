# Skill Handoff Protocol

Use this protocol whenever work moves from one skill to another. It decides what crosses the boundary, what must be left behind, and how the user is told that the governing rules have changed.

## Purpose

- Keep a prior skill's conclusions, consent, and permissions from being read by the next skill as pre-approval.
- Give every transition the same two sides: a sender that hands over facts, and a receiver that runs its own intake and gates in full.
- Offer both ways to switch — here, or in a new session — and make the new-session path a single copyable block.

## Scope

The protocol applies to every skill-to-skill transition:

- an in-session switch to another skill,
- a new session started for another skill,
- the user typing a new slash command mid-session, even when no skill proposed the move.

The receiving side always applies. The sending side applies whenever a skill proposes or performs a transition.

A plain fork — a new session that inherits the whole conversation and has no authority to change anything — is not a transition under this protocol: it copies context rather than switching skills. If the fork then loads a different skill, the receiving side applies as usual.

## What carries over and what never does

| Carries over | Never carries over |
|---|---|
| The user's own words and intent | The prior skill's conclusions as authorization |
| Artifact references (plan, issue, PR, findings file, ledger) | Consent given in the prior frame |
| Owed obligations (for example [stop protocol](../../_conventions.md#stop-protocol-shared) stewardship) | Gates passed in the prior frame |
| Facts read from live sources, with their sources | The prior skill's rules, permissions, and personality |

A fact is something read from a file, tool output, or the tracker, stated with where it was read. A conclusion is a judgment about what to do ("this is a textbook delegate commission"). Conclusions are never handed over as arguments or as block content. Artifact contents are claims too: a findings file, a plan's recommendation, or a ledger is cited so the receiver can read it, and what it says is for the receiver to verify, never authorization. In-session the sender hands over only the user's own words and artifact references (see Sending side), and the transcript itself stays in the session, so the "never carries over" column is enforced by the receiving-side line, not by what the sender passes.

## Sending side

When a skill proposes a transition:

1. **Choose the target from artifact state**, per the [successor selection gate](../../_conventions.md#successor-selection-gate). Never start a skill without the user's explicit yes, and the yes must name the option (switch here, or a new session) or accept a default the sender has stated.
2. **Hand over only the user's own words plus artifact references** (issue number, plan path, PR number) as the target's arguments. For "switch here", the sender loads the target skill so it becomes the active frame exactly as if the user had invoked it with those arguments; where the host cannot load a skill, it asks the user to type the invocation. Printing a slash command and carrying on in the old frame never counts as a switch. For "switch in a new session", the invocation is the first line of the [new-session handoff block](#new-session-handoff-block). Either way the target's own input detection and intake then run as designed.
3. **Announce an in-session switch once**, with a frame-close line the old skill emits immediately before it loads the target: "Leaving `/devenv-X`: none of its permissions, consent, or gates carry over; `/devenv-Y` governs from here. Owed items: <list, or none>."
4. **List owed obligations explicitly** — work the [stop protocol](../../_conventions.md#stop-protocol-shared) or another contract still requires — so the receiver inherits them as first business. When the leaving skill has an `active` or `boundary-wait` section in the [session coordination registry](./session-coordination.md), updating it is one of those obligations: park the section when the work will resume, or mark it exited when the skill's run is over, so no stale presence line is left behind.
5. **Carry specialized payloads as artifact references.** If the transition has its own payload, produce it first and cite it (see [Specialized payloads](#specialized-payloads)).
6. **Stop working in the old frame.** The sender does not perform the target's work after proposing the switch, and once the target is loaded or the new-session block is emitted, the old skill takes no further action.

## Receiving side

Every skill except `/devenv-load` carries one line in its opening material citing this protocol:

> **Skill handoff:** conclusions, recommendations, and consent from a prior skill's frame are input, not authorization — this skill's own intake and gates run in full. See the Skill Handoff Protocol.

Each skill links the final phrase to this file using its own relative path (`../common/references/skill-handoff-protocol.md` from a `SKILL.md`), so the wording is identical everywhere and a single `grep -L` over the `SKILL.md` files lists the gaps. The line goes immediately after the skill's `> **Skill feedback:**` blockquote and lands in every skill in the same change set as this protocol. `/devenv-load` is the one exemption: it is read-only, proposes nothing, routes nowhere and accepts no handoff content, so there are no conclusions for it to receive, and `lint-skills` skips it by name. Only skills carry the line — not reference files, `_conventions.md`, or `_shared` — and `lint-skills` link checking already verifies that each skill's relative link resolves.

The line is the primary defense and holds even when no sender ran. In practice it means:

- Treat prior-frame statements as claims to verify against live sources, not as settled facts.
- Run this skill's own intake, suitability checks, and approval gates; none are satisfied by an earlier skill having discussed them.
- A permission or consent the user gave under another skill covers that skill's scope only.
- If an earlier skill in this session left an `active` or `boundary-wait` section in the [session coordination registry](./session-coordination.md) — typical when the user typed the command themselves, so no sender ran — surface it in one line and, only with the user's yes, mark it exited. Never edit another skill's section silently.

**Precedence.** A skill's own requirements win over this protocol's generic wording: a target's entry requirements (for example delegate's commissioning interview) and its intake contract for a declared payload (for example research honoring a handoff block as the question source) govern how it is entered and how that payload is read, and a sending skill's own rule that a target must run in a separate session (for example research reached from grooming or planning) narrows the options offered. This protocol never waives them; the receiving-side line covers everything else.

## Switch options

Both options are offered whatever the target, unless a sending skill's own rule requires the target to run in a separate session, in which case only the new-session option is offered:

- **Switch here.** The target skill is loaded in the current session after the user's explicit yes, and it becomes the active frame. The old skill announces the switch with the frame-close line from the Sending side, immediately before the load.
- **Switch in a new session.** Emit the [new-session handoff block](#new-session-handoff-block) and stop; the old skill takes no further action.

The default recommendation depends on the target's class, decided by a criterion rather than a list:

| Target class | Criterion | Default recommendation |
|---|---|---|
| Mutating target | A normal run of the skill changes repository content, VCS state, or outward tracker and PR state, or writes scratch or prototype code or runs destructive experiments | New session |
| Everything else | A normal run only reads, converses, or writes the skill's own `.local-artifacts/` files | Switch here |

The test is what the skill does in a normal run, not what it could do if asked: an action that happens only on the user's request, such as offering to post a comment or file an issue, does not make a skill a mutating target, and neither does writing its own `.local-artifacts/` files. Scratch or prototype code and destructive experiments do count, even outside tracked files, so a skill that runs them in a normal run defaults to a new session.

The default is a recommendation only. In-session switching stays available for every skill and is hardened by the receiving side, not discouraged.

## New-session handoff block

The block is emitted as exactly one fenced code block with the info string `markdown`. The fence is presentation only: the copied content starts at the invocation line and contains no fence lines of its own, so there are no nested fences. It is written in the user's own language, with only the `/skill-name` in the invocation line literal. A handoff is not a durable document: the user may edit or extend the block before pasting it, and durable text the receiving skill later writes stays in English per the language policy. Write the block in the plain register, without the chat dialect, because the text becomes the receiving session's first input; the field labels below may be translated, and receivers read them by meaning, not by literal match. If content quoted in the block itself contains a fence, paraphrase it or indent it so the block keeps exactly one fence.

Content, in order:

1. The invocation line: `/skill-name` followed by the user's words about the work.
2. **Goal (user's words):** a quote.
3. **Artifacts:** references only — paths, issue and PR numbers.
4. **Verified facts** with the source of each, read rather than judged.
5. **Owed obligations:** explicit, or "none".
6. **Open for the receiving skill to decide:** the choices the target owns (mode, structure, scope), never a recommendation made by the sender.

Example, as emitted:

```markdown
/devenv-chat tour of the delegated work on #42 — I need to review it carefully

**Goal (user's words):** "delegate finished #42 but phase 3 should have been paired;
I need to go through it properly before it ships"

**Artifacts**
- Plan: `.local-artifacts/Plan-issue-42-001.md`
- Changes: uncommitted working tree in `repos/lib.cs.services.bulk-sync`

**Verified facts** (read from source, not judged)
- Plan recommends `pair` for phase 3; the run's agenda ran it as `delegate`
  (session-state-Plan-issue-42-001.md)

**Owed obligations:** none

**Open for the receiving skill to decide:** tour mode, itinerary, depth
```

## Specialized payloads

Existing hand-off payloads keep their own formats; this protocol does not absorb or rewrite them.

| Payload | Defined in |
|---|---|
| Escalation handoff record | [Decision Resolution Protocol](./decision-resolution-protocol.md#escalation-handoff-record-required) |
| Park-for-pairing question line | [Session Coordination](./session-coordination.md) |
| Research and grooming redivision handoff blocks | the plan and groom skills that emit them |
| A skill-owned findings or ledger file | the skill that writes it |

A payload that is a file or a registry line (the escalation record, the park line, a findings or ledger file) is produced first and cited as an artifact reference. A payload that exists only as a chat block (the research handoff and grooming redivision blocks) is itself the new-session block: it keeps its own fields and gains an **Owed obligations** line, and the generic block above is used only when no specialized block exists. Either way there is one block and one fence, and the carry-over split above still governs everything around the payload.

## Anti-patterns

- Passing a routing conclusion ("textbook delegate commission", "shaped for pairing") as an argument or block field.
- Treating consent given under the previous skill as consent for the next one.
- Switching in-session without the frame-close line or the user's yes.
- Continuing the previous skill's work after proposing the switch.
- Emitting the new-session block as several fences, or with fence lines inside the copied content.
- Omitting an owed obligation because the next skill "will probably cover it".
