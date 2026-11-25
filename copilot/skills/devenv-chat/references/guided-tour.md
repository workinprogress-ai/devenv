# Guided Tour

The tour mode of `/devenv-chat`: the AI sets the route, the human makes the judgment, and the human sets the pace. A tour is read-only like the rest of chat — it explains and shows, and its one write is the tour ledger. Each stop follows the stop anatomy and the show-it-first rules of the [guided walkthrough protocol](../../common/references/guided-walkthrough-protocol.md); findings a tour records follow the [findings format](../../common/references/findings-format.md).

## Two modes, and how they nest

Chat has an **answer mode** (every question type in `SKILL.md`) and a **tour mode**. They nest in both directions:

- A question that leaves the current stop's code is a [side trip](#side-trips).
- "Show me around" in the middle of a Q&A starts a tour.

A tour starts on explicit tour words ("tour", "guide me through", "show me around", "help me review this carefully") or on "walk me through" plus something with a route: a diff, a plan, a PR, commits, findings, delegated work, or a use case. A plain "walk me through the architecture" stays in answer mode: chat gives the overview and ends with one line offering a guided tour of it.

A tour itself runs in one of two modes, inferred from its source, announced when the tour starts, and switchable by the user at any time:

| Tour mode | Inferred from | Marks | Ledger is |
|---|---|---|---|
| **Assurance** | AI review findings, plan × diff, a PR, unmerged commits | Every stop needs a mark; ⏭️ is a deliberate "not reviewed"; the tour cannot close with an unmarked stop | The proof of coverage |
| **Comprehension** | Codebase acquaintance, merged history, a plan before execution, a scenario trace | None; the user moves on with "next", questions, and tangents | A resume bookmark |

## Intake and the route map

Chat confirms the source, the mode, the register, and the scope before the first stop. For a composed source it interviews the user: the area, the depth, their familiarity with the code and the stack, and the goal (learn it, or warm up to work on it).

Before stop 1, chat shows the whole itinerary as a plain-text route map — the stops, their order, and how they connect — so the user sees the shape of the tour before taking the first step:

```
Route — delegated work on a plan (assurance), 5 stops

 [1 contract] ──► [2 policy] ──► [3 worker]
       │                              ▲
       └─────────► [4 tests] ─────────┘
                                        [5 wiring]

 not on the route: 6 files (renames, generated, docs) — acknowledged before close
```

## Itinerary sources

**Derived** — the source supplies the stops:

- AI review findings.
- Human review or PR threads.
- A subset of an earlier tour's ledger.
- A plan: before execution, the existing code the plan will touch; after execution, the diff.
- **Plan × diff**, for unreviewed delegated work: the plan's phases mapped onto the changed code, prioritized by phases the plan recommended pairing on that ran as delegated, judgment calls the run made without a gate, and the handback's hotspots.
- **Net-change commit tour**: dependency order over the net diff, each stop annotated with the commits that shaped it.
- **Change-by-change commit tour**: commit order, provenance first.

**Composed** — chat builds the route from the intake:

- **Codebase acquaintance**, from the docs and the code.
- **Scenario trace**: a use case walked through the code in execution order. It stays read-only; anything that needs running code routes to [`/devenv-research`](../../devenv-research/SKILL.md) or [`/devenv-hunt`](../../devenv-hunt/SKILL.md).

## Coverage guarantee (assurance)

An assurance tour accounts for the whole change. Chat computes the changed-file set from the source — staged, unstaged, and untracked paths, plus renames and deletions, because a plain diff omits untracked files — and accounts for it at **hunk grain**: a file counts as covered only when every one of its changed hunks sits in a stop. Every changed hunk ends up in exactly one place:

- a stop of its own,
- folded into a named stop, or
- a **not on the route** appendix, grouped by change class (for example renames, generated files, docs-only edits, mechanical sweeps). Each group lists its hunks (file and range), and the user acknowledges the group after seeing that list, before the tour closes.

A group chat cannot classify with confidence is promoted to stops. A source with no diff — AI review findings — has no changed-file set: its itinerary is the findings themselves, and coverage means every finding is a stop. The user never has to trust that the route covered everything: the accounting shows it.

## Side trips

A question about the current stop's code is answered in place; the stop stays current and no depth is added. A question that leaves the stop's code is a side trip:

- A breadcrumb shows on every turn: `🧭 Tour › stop 4/11 <name> › side trip: <topic>`.
- It is logged in the ledger, never counts toward coverage, and the origin stop's mark is still owed on return.
- Depth is capped at 2 in assurance and 3 in comprehension. Past the cap, chat offers to park the topic as an optional stop at the end of the tour.
- "Back" works from any depth.
- A side trip that grows into its own topic is offered as a separate tour with its own ledger.

## Chaining and close

Ledgers link through a `parent:` header line. At close, chat offers a follow-on tour only when seeds exist: parked side trips, unresolved ❓ stops, or — after a comprehension tour — natural next deep-dives. An assurance tour normally closes by routing its findings.

At close chat names the route and hands over the ledger; it never performs the route. A plan-backed tour routes to the plan-encoded fold-in in `/devenv-review`, a PR-backed tour to the review posting path or `/devenv-address-pr-comments`, and an ad-hoc tour to `/devenv-pair` intake. The move follows the [Skill Handoff Protocol](../../common/references/skill-handoff-protocol.md): the ledger travels as an artifact reference, not as authorization.

## Situational awareness

Chat tracks its mode, route position, register, coverage, and ledger state, and notices sibling outputs for the current source (reviews, plans, ledgers, handbacks), so it can offer a resume, announce a mode change, or route a request out.

## Ledger

A tour keeps one file, the **tour ledger**: `tour-ledger-<topic>.md` in the target repo's `.local-artifacts/`. It is chat's one sanctioned write, and it is written in plain English with no persona and no chat dialect, because other skills read it and its findings may end up in PR threads and plans.

**Links only.** The ledger holds links, line ranges, hashes, and a one-line anchor per stop. Excerpts and illustrations are regenerated from live code at each stop and never stored in it. Line links can drift as the code changes, so chat relocates and rewrites every stop and finding link when the tour closes or hands over, and a consumer re-verifies a link's range text against the live file before acting on a link or an `@post` line. Links follow the hotspot link location rule: the ledger sits one level below the repo root, so repo links carry a single `../` prefix.

### Header

```markdown
# Tour ledger — <topic>

- source: <canonical source key>
- mode: assurance | comprehension
- register: simple | terse
- created: <date>
- source-hash: <content hash, review-report sources only>
- parent: <earlier ledger, optional>
```

The `source:` key has one canonical form per source, so a ledger can be matched to the work it belongs to:

| Source | `source:` form |
|---|---|
| A plan, before execution | `plan:<file stem>` |
| A plan after execution, run other than as unreviewed delegated work (the diff) | `plan-after:<file stem>` |
| A plan × diff, after execution (unreviewed delegated work) | `plan-diff:<file stem>` |
| A PR's diff | `pr:<n>` |
| A PR's human review threads | `pr-threads:<n>` |
| A review report | `review:<report path>` |
| A diff or working tree | `diff:<base>..<head>` or `diff:<base>..working-tree` |
| Commits, net-change tour | `commits-net:<a>..<b>` |
| Commits, change-by-change tour | `commits-seq:<a>..<b>` |
| A subset of an earlier ledger | `ledger:<earlier ledger file>` |
| A scenario trace | `trace:<topic>` |
| Codebase acquaintance | `acquaintance:<topic>` |

A review-report source also carries `source-hash:`, a content hash of the report file, and such a ledger matches only when the hash matches — so a reused review file name cannot match the wrong ledger. A consumer that finds a hash mismatch says the report changed since the tour and asks, rather than skipping the ledger. No other source carries a hash: a plan is ticked and edited as work proceeds, so plan and ledger sources match on the key alone. A ledger is matched on `source:` and `mode:` together, so an assurance tour and a comprehension tour of the same range keep separate ledgers.

### Body

1. **Itinerary** — the numbered stops, each with its `file:line` link, its mark (✅ 🚩 ❓ ⏭️) or *unvisited*, a marker for "you are here", and — once visited — `hash:<hex>` of the range text and `anchor:` the range's first line.
2. **Side-trip log** — each side trip, its origin stop, and where it ended.
3. **Not on the route** — assurance tours only: the grouped appendix, each group with its acknowledgement.
4. **Findings** — each 🚩 as **F1…Fn** in the [findings format](../../common/references/findings-format.md), with an explicit severity token after the ID — `(Blocker)`, `(Concern)`, or `(Nit)` — defaulting to Concern, so a consumer can tell them apart even though the ledger keeps one flat findings list.

```markdown
## Itinerary
1. ✅ [RetryPolicy.cs:40-72](../src/RetryPolicy.cs#L40-L72) — retry policy · hash:9f2c41a7 · anchor:`public sealed class RetryPolicy`
2. 🚩 [SyncWorker.cs:88-120](../src/SyncWorker.cs#L88-L120) — backoff choice (see F1) · hash:51be07d3 · anchor:`var delay = Backoff.Next(attempt);`
3. ▶ unvisited — [Daemon.cs:15-60](../src/Daemon.cs#L15-L60) — you are here

## Findings
- **F1** (Concern) [SyncWorker.cs:88](../src/SyncWorker.cs#L88) — backoff strategy chosen without a recorded decision (from stop 2)
  <!-- @post: file=src/SyncWorker.cs line=88 side=RIGHT -->
```

### Integrity

- The ledger is written at every mark and every side-trip event, so it is the compaction bridge: after the context is compressed, chat resumes from the file.
- Each mark records a content hash of the stop's range **text**, with a short anchor line (the range's first line). On resume chat relocates each stop by content: if the same text is found, possibly at different line numbers because lines were inserted or removed above it, the mark stays and the stop's numbers update; if it is not found, the stop is un-marked as "changed since you marked it". When the same text occurs more than once, the match nearest the old position wins; if two are equally near, the stop is un-marked rather than guessed. A deleted hunk has no live range: its stop links the deletion point, records the base-side range and the hash of the deleted text, and is labeled deleted. Edits elsewhere in the same file therefore do not un-mark, and the check works for uncommitted work because it reads content, not commits.
- Each finding records the stop it came from. At close or hand-over, chat rewrites the finding's link and `@post` line from that stop's relocated range, and a consumer re-verifies the range text before using either.

### Discovery and consumption

- Chat looks for an unfinished ledger whose `source:` and `mode:` match the current tour, and offers to resume it.
- Other skills may detect a ledger by source match when it holds findings they have not yet used, and they ask before using it, following the [tour ledger handoff](../../common/references/tour-ledger-handoff.md). Consumption is recorded in the consumer's own output (a plan task citing `tour-ledger-<topic> F3`, a review round listing the finding IDs it folded in), so detection compares the ledger's finding IDs with those citations. Consumers never write to the ledger.

### Retirement

A ledger is retired by the artifact cleanup tool or by the user, once its findings are consumed. It is never deleted automatically.

## Illustrating a stop

A stop usually makes several distinct points — a before and after, a design choice, why a field exists, how call sites changed. Each point gets its own visual, so the user can follow the whole stop without opening a file. A point that is only narrated, with a citation the user must go and read, has not been shown.

- **One point, one excerpt.** Put a short excerpt from the live file, with its line range, next to the sentence that makes the point. The protocol's fifteen-line cap applies per excerpt, not per stop. A point with no code behind it (a design reason) gets a small diagram or a one-line contrast instead. Points that fit one excerpt share it.
- **Show before and after for a change.** When a point is about what changed — a refactor, a rename, a moved responsibility — show the base-side text and the new text as two labeled fenced blocks (`Before — <file>:<range> @ <base>`, `After — <file>:<range>`), each read from the actual base and head with read-only git inspection, never from memory. Trim to the lines that differ in meaning and say what was trimmed. For a signature that shrank, show both signatures; for a call-site sweep, show one representative before and after and link the rest.
- **Point inside the code.** Number the points and mark the lines they refer to with a short end-of-line marker in the excerpt (`◄ ①`), with a one-line legend under the block saying the markers are annotations, not code. The prose then says "see ①", not "see line 42". The code itself stays verbatim.
- **Draw shape, not syntax.** For data flow, who calls whom, or structure before and after, use the protocol's plain-text diagram, and say so when it infers something the cited code does not state.
- **Split rather than shrink.** When a stop's points, with their visuals, would not read comfortably in one turn (about four points), break it into parts with a "next" between them. Do not cut the visuals to fit.

A stop in this style (the code speaking; the refactor is invented for the example):

````markdown
**Stop 3 — RetryPolicy.** I used to take seventeen parameters. We don't talk about that.

Before — `send()` @ main: five of the arguments were really about retrying:

```python
def send(msg, url, timeout, retries, backoff, jitter, retry_on, fail_fast, ...):   # ◄ ①
```

After — `send()` takes one policy object, and `RetryPolicy` carries the five (`send.py:12-30`):

```python
@dataclass(frozen=True)
class RetryPolicy:
    retries: int = 3          # ◄ ②
    backoff: float = 0.5
    ...
def send(msg, url, timeout, policy: RetryPolicy | None = None):
    policy = policy or RetryPolicy()     # ◄ ③
```

① retry knobs smuggled in as loose arguments · ② the new home, frozen so nobody changes it mid-flight · ③ "no policy" means all defaults, the same as the old kwargs — which is why the body reads exactly as before.
(Markers are annotations, not code. Excerpts trimmed with `…`.)

```
before:  send(…, retries, backoff, jitter, …)      after:  send(…, policy) ──► RetryPolicy
```
````

## Register

**Register.** Chat starts in the simple-explanation register: plain vocabulary, terms defined on first use, what a thing is for before how it works, concrete examples from the code, and an honest note where the simple version leaves out real nuance. The intake calibrates the register up or down, and an expert may opt into a terse register. The amount of visual aid scales with it: the simple register gets the fullest excerpts and illustrations, the terse register trims a stop to its link and a minimal excerpt.

