# Session Coordination Registry (pair + delegate)

Shared contract for the coordination file used by the two executor skills to stay aware of each other across concurrent sessions. One definition, two consumers:

| Consumer | Reads at | Writes at |
|---|---|---|
| `/devenv-pair` | 0b resumption (every session start/compaction recovery), before check-before-touch | phase boundaries, AI handbacks, wrap-up, explicit "save state" |
| `/devenv-delegate` | commissioning, phase boundaries (registry check), before check-before-touch | commissioning, phase boundaries, handbacks, mid-phase stops, final exit |

Nothing else reads or writes this file. Bug-hunt, research, and every other skill are outside this contract by design.

## The file

One coordination file per plan instance, under the target repo's `.local-artifacts/`:

```
<repo-root>/.local-artifacts/session-state-<plan-stem>.md
```

Ad-hoc work (no plan) follows the opt-in form `session-state-adhoc-<topic>.md` — same semantics as plan-stemmed files, but never auto-discovered: resuming one requires the user to name it. Default home for ad-hoc awareness remains session memory.

The file is plain markdown, human-readable, never published to issues, never committed.

## What this file is — and is not

**Two layers, deliberately separate:**

- **The plan is the pickup record.** Everything another engineer or agent needs to continue the work — progress, decisions, as-built state — lives in the plan and is complete on its own. How many agents worked, or which skill, is never plan content. A crash recovery or a hand-off to a new person runs off the plan alone.
- **This file is the awareness layer.** It carries exactly three kinds of content: (1) *who is active right now, where, and in what mode* — so concurrent sessions don't clobber each other; (2) *local-only context* that does not deserve the plan but any local implementor should know (partial intent, stray-edit provenance, live debates, environment facts like "dev server holds port 5101"); (3) *session knowledge* — things learned while working that a future session in this repo would want before touching the area (generic, no plan/task IDs; see the knowledge entries rule below).

**Content fence — never in this file:** task ticks, progress state, decisions and their rationale, acceptance-criteria status, or any other as-built record. That is the plan's cargo; duplicating it here creates the shadow-ledger failure class. A coordination entry may *point* at the plan ("handed back for review of the contracts phase"); it never *replaces* plan content.

**Disposability doctrine.** This file is always disposable. Delete it mid-flight and nothing durable is lost: recovery runs off the plan, and the only cost is live awareness (one clarifying question to rebuild). Stale entries are the normal failure mode of a best-effort registry — they cost a question, never data. The file retires via `artifact-clean` when the plan instance closes; a coordination file for a finished plan is stale by definition.

**Best-effort, log-form, low-ceremony.** Entries are an activity log, not a state table: timestamped, attributed, one line per event, appended under the session's own section. No per-task file inventories — claimed territory is a coarse area ("the conflicts sweep, `src/Service/`"), precise where the plan is already precise, coarse everywhere else. The discipline to maintain this file must cost less than the coordination it buys; if an update would take more than a line or two, the content probably belongs in the plan instead.

**Status line + append-only history.** The first line of every section is its status — `status: active — <where>` | `status: boundary-wait — <where>` | `status: exited — <where>` — and this line is updated in place whenever the session's current state changes; it is the one legal in-place edit in the file. **Everything below it is append-only history**: event lines are written past-tense ("Phase 1 boundary passed; moving to Phase 2"), never rewritten, never reorganized. A cold reader answers "where is this session now?" from the status line alone and never has to parse prose to find it; the history exists for context (and as the compaction bridge), not for state. Event lines must not carry now-state — if you catch yourself writing "currently in", "now working", or "phase N complete" in a history line, that content belongs on the status line.

**Session knowledge entries.** Lines prefixed `knowledge:` record something genuinely learned while working — a tool behavior, a repo quirk, an environment fact — stated generically with no plan/task IDs, kept only when a future session in this repo would want it before touching the area. This is an occasion, not a duty: rare, worth-sharing lines, not a per-task chore. Any session may later mine `knowledge:` lines across files as candidates for the knowledge repos — harvesting goes through those repos' normal review gates; the registry itself stays disposable and is never the durable home of anything.

**Concurrent writes.** Sessions edit the file through read-modify-write, so two near-simultaneous saves can clobber each other — the loser loses one awareness line, never durable data (progress lives in the plan). Keep the window small: **re-read the file immediately before writing your section**, and if another session's section changed shape unexpectedly since you last read it, surface that rather than saving over it. Writes are boundary-driven and rare by design; this one line of care is the whole locking mechanism the file needs.

**Section compaction (own section only).** A session may collapse its own section's history at one of its own boundaries — replace older event lines with `— earlier: <one-line summary>` and carry the status line forward — when the section has grown long. A session never edits, tidies, or compacts another session's section, not even to help. File-level retirement at plan close (`artifact-clean`) remains the ultimate cleanup; there are no timers and no cross-section gardening.

**Single-session value.** The log also serves a solo session as a compaction bridge — "what was I just doing" survives context compression the same way it survives session hand-off. A file that is only useful when two sessions run is designed wrong.

## Format

```markdown
# Session state — <plan-stem>

<!-- One section per session that has been active on this plan instance.
     Section = status line (kept current, the one in-place edit) + append-only
     event history below it. A session that exits sets status "exited" rather
     than deleting its section — the history is the compaction bridge. -->

## delegate — commissioned <UTC timestamp>

status: boundary-wait — phase 2 (contracts) done; resuming Phase 4; Phase 3 reserved for pair

- 14:02 — commissioned, checkpoint mode (`src/Service/` area)
- 14:40 — contracts phase boundary passed; handed back for review
- 15:10 — review approved; resuming at Phase 4

## pair — active <UTC timestamp>

status: active — reviewing delegate's phase-2 handback (`IWorkingCopyRepository.cs`)

- 15:05 — picked up review of the delegate's handback
- 15:30 — knowledge: ADO strips HTML comments from work-item comments at write time — bare doc_id lines survive, comment-wrapped headers do not
- 15:35 — stepping away; no uncommitted edits outside `.local-artifacts/`
```

Rules:

- **Section key:** `<skill> — commissioned|active <UTC>`. One section per session run; two pair sessions on the same plan get two sections (never merge them).
- **Read rule:** current state of a session = its status line. Event lines are history (past tense, completed things) — never parse them for now-state.
- **Entry shape:** `- HH:MM — <event> [(<coarse area>)]`. Timestamps are UTC, local-clock is fine if consistent; staleness is judged by age.
- **Territory:** coarse area only — a phase/task name plus a directory or module hint. Never an exhaustive file list; the plan's `Files:` sets already carry precision.
- **Local context:** notes a colleague must know (partial intent, stray-edit provenance, live debates, environment facts) — the pair session-notes payload in log form.
- **Now-state discipline does not apply to history.** The append history is deliberate: it is the compaction bridge, it is disposable, and it dies with the plan instance. Do not rewrite event lines to current state; that is the plan's discipline, applied to the plan — the status line is where now lives in this file.

## Check-before-touch

Before editing files, a session checks the other sections' status lines:

- **Clear** — no other session claims an overlapping coarse area → proceed.
- **Crossing** — another active session claims the area → pair yields to a different task in its flow discipline (deferred buffer) or, when the user is driving, surfaces the collision immediately; delegate cannot yield (it executes the plan in order) and surfaces the crossing at the next boundary — or immediately when the collision touches files it has already edited.

The check is one file-read-plus-compare at task start (pair) or phase start (delegate). It prevents *announced* collisions; a session that dies without updating its section leaves stale claims — timestamps and the disposability doctrine absorb that.

## Registry-aware trigger semantics (canonical wording)

Both executor skills cite this section for their foreign-writer triggers:

- **Downgrade:** when observed plan edits or working-tree changes are explained by a session named **active** in the registry — whose claimed area and recorded activity account for the edits — the observing session **notes the edits and reconciles at its next boundary** instead of halting. A known colleague's sanctioned work is not an emergency.
- **No downgrade:** edits no active registry section explains — unknown writer, unexplained scope, or a section that exited but its edits keep growing — trigger the **full stop-and-surface** exactly as before. The registry explains peace; it never explains away strangers.
- **Attribute before alarm still applies first:** a session's own recent edits, the commissioning baseline, and then the registry — in that order — before any foreign-writer verdict.
- **The single-writer core is unchanged:** two commissioned *delegate* runs on one plan remain prohibited — colliding as-built ledgers are the collision the rule was built for. The registry softens delegate-vs-pair only, where pair's plan stewardship is sanctioned work, and pair-vs-pair via the same logic.
- **No shadow ledger:** the registry records presence and local awareness. It never records progress. A delegate run's state remains entirely in the plan file; this file records only that the run exists, where it works, and what it wants a colleague to know.

## Migration rule

The registry name is `session-state-*`. There is **no legacy scanning**: sessions never look for old `pairing-state-*` files, and no tool maps between the names. Existing files are orphans of the rename — they retire through `artifact-clean` when their plans close, exactly like any other finished-plan artifact. Do not add compatibility shims for the old name.

## Boundaries

- **Scope fence:** pair + delegate only. No other skill reads, writes, or is described by this contract.
- **Local only:** the file lives in `.local-artifacts/`, is gitignored by convention, and is never upserted to issues or included in PRs.
- **Relationship to the plan artifact:** independent. The plan may be published and synced; the coordination file never leaves the machine.
