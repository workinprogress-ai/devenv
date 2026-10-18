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
- **This file is the awareness layer.** It carries exactly two kinds of content: (1) *who is active right now, where, and in what mode* — so concurrent sessions don't clobber each other; (2) *local-only context* that does not deserve the plan but any local implementor should know (partial intent, stray-edit provenance, live debates, environment facts like "dev server holds port 5101").

**Content fence — never in this file:** task ticks, progress state, decisions and their rationale, acceptance-criteria status, or any other as-built record. That is the plan's cargo; duplicating it here creates the shadow-ledger failure class. A coordination entry may *point* at the plan ("handed back for review of the contracts phase"); it never *replaces* plan content.

**Disposability doctrine.** This file is always disposable. Delete it mid-flight and nothing durable is lost: recovery runs off the plan, and the only cost is live awareness (one clarifying question to rebuild). Stale entries are the normal failure mode of a best-effort registry — they cost a question, never data. The file retires via `artifact-clean` when the plan instance closes; a coordination file for a finished plan is stale by definition.

**Best-effort, log-form, low-ceremony.** Entries are an activity log, not a state table: timestamped, attributed, one line per event, appended under the session's own section. The last lines in a section are its current awareness. No per-task file inventories — claimed territory is a coarse area ("the conflicts sweep, `src/Service/`"), precise where the plan is already precise, coarse everywhere else. The discipline to maintain this file must cost less than the coordination it buys; if an update would take more than a line or two, the content probably belongs in the plan instead.

**Single-session value.** The log also serves a solo session as a compaction bridge — "what was I just doing" survives context compression the same way it survives session hand-off. A file that is only useful when two sessions run is designed wrong.

## Format

```markdown
# Session state — <plan-stem>

<!-- One section per session that has been active on this plan instance.
     Newest events last within a section. A session that exits marks its
     final line "handed back" / "exited" rather than deleting its section —
     the recent history is the compaction bridge. -->

## delegate — commissioned <UTC timestamp>

- 14:02 — commissioned, checkpoint mode, working the contracts phase (`src/Service/` area)
- 14:40 — contracts phase handed back, awaiting review
- 15:10 — resumed, continuing into implementation (`src/Service/`, `tests/`)

## pair — active <UTC timestamp>

- 15:05 — picked up review of the delegate's handback; reading `IWorkingCopyRepository.cs`
- 15:30 — note: the intentionally-red test at L142 closes in the cleanup phase — do not "fix"
- 15:35 — stepping away; no uncommitted edits outside `.local-artifacts/`
```

Rules:

- **Section key:** `<skill> — commissioned|active <UTC>`. One section per session run; two pair sessions on the same plan get two sections (never merge them).
- **Entry shape:** `- HH:MM — <event> [(<coarse area>)]`. Timestamps are UTC, local-clock is fine if consistent; staleness is judged by age.
- **Territory:** coarse area only — a phase/task name plus a directory or module hint. Never an exhaustive file list; the plan's `Files:` sets already carry precision.
- **Local context:** notes a colleague must know (partial intent, stray-edit provenance, live debates, environment facts) — the pair session-notes payload in log form.
- **Now-state discipline does not apply here.** This file's append history is deliberate: it is the compaction bridge, it is disposable, and it dies with the plan instance. Do not "clean it up" to current state; that is the plan's discipline, not this file's.

## Check-before-touch

Before editing files, a session checks the other active sections:

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
