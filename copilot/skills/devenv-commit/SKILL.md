---
name: devenv-commit
description: 'Create a commit — the only skill that commits, and only through the repo-commit tool. USE WHEN the user says "commit this", "let''s commit", "craft a commit message", "wip this", or is ready to land the current work. Runs a light staged-glance (obvious hazards + the DEVENV marker gate), evaluates atomicity and master-worthiness (suggests the WIP lane for low-value work), crafts a convention-aware suggested message (commitlint config as oracle; plan context when present), warns on ephemeral plan references, then commits via repo-commit — which always opens the git editor (the editor save is the permission gate) or, on the user''s choice, takes the WIP lane. Deep pre-commit code review lives in /devenv-review ("review uncommitted"). Never stages (WIP lane excepted, via git-wip), never runs tests, never checks hooks (infrastructure owns enforcement). DO NOT USE FOR running quality gates without committing (say "run pre-commit checks" — the checks-only flow applies, still no commit unless you confirm), opening a PR (use /devenv-open-pr), or code review (use /devenv-review).'
argument-hint: 'Optional: "--all" quality-gate scope, or a hint like "WIP" / "split this"'
user-invocable: true
---

# Commit

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`.

> **Skill feedback:** If nothing is wrong but the user asks how the skill could be improved, follow the shared [Skill Feedback Protocol](../common/references/skill-feedback-protocol.md) to write `IMPROVEMENT_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`. Zero findings is a valid result; never offer unprompted.

This is the only skill in the workspace permitted to create a commit — and it does so exclusively through the `repo-commit` tool, which always opens the user's configured git editor with the suggested message. **The editor save is the permission gate**: if the user empties the message or aborts the editor, no commit exists. The skill never commits directly with `git commit`. A `--wip` lane exists for low-value snapshots: on the user's explicit choice, `repo-commit --wip` delegates to `git-wip` (stage-all, hooks bypassed, `WIP:` prefix, push) — WIP commit shape lives in `git-wip` alone.

## The two lanes

**Checks lane** — the historical behavior, kept intact: run the project's quality gates (lint, format, type-check, tests) against changed files, report all failures together, suggest (never silently apply) auto-fixes. Trigger phrases: "run pre-commit checks", "is this ready to commit". **The checks lane never commits.**

**Commit lane** — review the staged work lightly, craft the message, and create the commit through `repo-commit` (normal editor lane or WIP lane). Deep pre-commit code review is `/devenv-review`'s job — invoke it ("review uncommitted") when the user wants the diff attacked before landing; this skill keeps only the glance it needs to judge the commit itself.

## Invocation interview (commit lane, always)

At invocation, ask via the structured interview:

1. **Scope** — "Commit what's staged?" (yes, commit the staged work / no — wait, I'll stage first / checks only — no commit)
2. If staging is empty at invocation, surface it immediately: *"Nothing is staged. Staging is manual — stage what you want committed (I never run `git add`), then tell me to proceed."* Stop there.

**WIP predecessor check (interview).** If `git log -1 --format=%s` shows the last commit starts with `WIP:`: this commit would sit on top of throwaway history that still needs to be squashed or unwipped. Ask: *"The last commit is a WIP snapshot. How do you want to proceed?"* — (a) proceed with a **normal commit** on top (the WIP gets squashed/unwipped later), (b) make this a **WIP commit too** (the WIP lane, below), or (c) stop so the user can `git-unwip` first. Never silently stack a permanent commit on un-wipped WIP history.

## Shared orientation (commit lane)

Run `skill-orient` at invocation for the staged/unstaged/untracked counts and any active plan (its context feeds message crafting).

## Staged-glance (commit lane — light, by design)

Glance at **what is staged** — `git diff --cached` — never the working tree at large. This is a commit-decision glance, not a code review; deep adversarial review of uncommitted work routes to [`/devenv-review`](../devenv-review/SKILL.md) ("review uncommitted").

- **Unstaged modifications** to files that also have staged changes → warn: *"foo.ts has staged changes AND further unstaged edits — only the staged state will commit."*
- **Untracked files** → list them; ask whether their absence is intentional (do not stage them, ever — the WIP lane's stage-all is the only sanctioned exception, and it requires the user's explicit WIP choice).
- **Obvious hazards only**: debug leftovers, commented-out code, conflict markers, generated files. Anything deeper → suggest `/devenv-review`.
- **DEVENV marker gate** (below) still applies in full.

**Questions beget questions.** When the glance surfaces something worth confirming — an unexpectedly large deletion, a file unrelated to the stated intent, a suspicious-looking constant — **ask before proposing the message**, batched into one structured interview. Don't interrogate over trivia — ask only what would change the message, the commit split, or the go-ahead.

## DEVENV marker gate (staged diff, blocking)

Run `devenv-marker-check` scoped to the staged files before proposing the commit:

- Any **plan-bounded `FIXME:DEVENV[...]`** marker added by this work → blocker: *"The staged diff introduces a FIXME marker — resolve it or convert it to the TODO form with a discharge condition before committing."*
- Any **condition-less `TODO:DEVENV[...]`** → blocker per the marker spec (a TODO without a discharge condition is a defect).
- Cross-plan `TODO:DEVENV[...]: ... — remove when <condition>` markers → sanctioned to ship; surface each in one line as a session constraint for the record.

## Atomicity and master-worthiness evaluation

Judge the staged work as a candidate for the permanent record:

- **Atomic?** One concern per commit. Mixed concerns → suggest splitting: name the groups (files + suggested message each) and let the user stage per group; offer per-group commits through this skill.
- **Master-worthy?** Would we want this permanently in the record? Red flags: broken intermediate state, debugging scaffolding, throwaway experiments, changes whose message would have to apologize for them.
- **Low-value verdict → suggest alternatives, never execute them:** the WIP lane (`git-wip` — a temporary snapshot commit recoverable via `git-unwip`) for not-yet-worthy work; a pairing session (`/devenv-pair`) for work that needs reshaping before it's worth recording. Suggestion only — the user decides and runs the tool.

## Commit message crafting

Derive the suggestion from the staged diff, in the target repo's convention:

- **Oracle:** the repo's `commitlint.config.js` — read it; repos extend `@commitlint/config-conventional` and may add custom types (this workspace's own config adds `major`/`minor`/`patch`). The config, not memory, is the authority on legal types. No commitlint config → conventional-commits defaults; say which convention you're following.
- **Subject:** `type(optional-scope): subject` — imperative mood, ≤ 72 chars, no trailing period. Derived from the dominant change.
- **Body:** short by default. Omit it for most commits — a well-written subject usually suffices. Add bullets only when the subject genuinely can't carry the information (non-obvious rationale, a deliberate trade-off, a follow-up obligation). Never pad; two high-value bullets beat five procedural ones.
- **Plan context:** when an active plan file exists (`.local-artifacts/Plan-*.md` in the repo), read its goals/ACs so the message describes how the change serves the whole, not just the diff mechanics. The plan informs the *message* — plan task numbers still never appear in it.
- **Mixed changes:** suggest split commits — one message per group, in order.

### Ephemeral-reference warning (message hygiene)

Before proposing the message, scan the draft for ephemeral workflow vocabulary: `Phase \d+`, `task \d+\.\d+`, `Plan-\d+`, `WIP`, `TODO`, `FIXME`, audit/report filenames, dates-as-annotations ("Phase 2 complete, all tests passing"). The commit is the permanent record: **durable information only** — what changed and why it matters, stated so it stays true after the workflow that produced it is forgotten. Workflow state belongs to the plan and the handbacks, not the history. Rewrite offenders as durable statements of what changed and why.

**Attribution is human-only.** Per the workflow principle (docs/Workflow.md), commit messages and trailers never attribute authorship or assistance to AI or a specific model — no `Co-Authored-By:` AI trailers, no "Generated with …" lines. Authorship is the engineer's, full stop.

**Issue references are durable — include them when applicable.** An issue number is permanent, resolvable history, not ephemeral workflow state. When the staged work demonstrably relates to an issue — it implements it, fixes it, or advances it — reference it: `(#N)` at the end of the subject line, or on the relevant body bullet. Relevance is the bar: cite the issues the commit genuinely touches (check the branch name, staged content, and any active plan's issue linkage); never decorate a commit with numbers it doesn't relate to.

## Executing the commit — `repo-commit` only

When the craft is done, present the suggested message, then **confirm via structured interview** (never chat prose): *"Run repo-commit with this message?"* (run it — I'll edit in the editor / run it, WIP lane instead / edit the message first — freeform / stop). Only on confirmation, run:

```bash
repo-commit --file <message-file>   # preferred: write the message to a temp file, pass the path
repo-commit "<message>"             # short messages only — long argv strings risk shell mangling
```

**`--file` is the default shape for anything longer than a one-line subject**: write the suggested message to a temp file and pass the path — the file content becomes the editor's pre-load verbatim, immune to quoting/terminal mangling.

**WIP lane** (`repo-commit --wip [--file <file>] [--staged-only] [--message-words…]`): chosen explicitly by the user (from the confirm interview or the WIP-predecessor interview). It delegates to `git-wip` — stages everything (unless `--staged-only`), bypasses hooks (the documented WIP exception), prefixes `WIP: `, pushes, and records `refs/wip/last`. The message produced has no conventional-commit prefix by design. There is no editor step on this lane — the user's choice of the WIP lane IS the confirmation, so make sure the interview answer is unambiguous before invoking.

Contract of the tool (enforced by the tool, not just this skill):

- The suggested message is pre-loaded into the **git editor, which always opens** (normal lane) — `repo-commit` prefers VS Code (`code --wait`) with nano as fallback; it has no non-interactive path and refuses `-m`, `--yes`, option-shaped arguments, and known non-interactive editors (`true`, `:`, `echo`, `cat`, …).
- The commit is created from the **existing index only**; unstaged work is never swept in (the `--wip` lane's stage-all is git-wip's documented behavior, chosen explicitly by the user).
- The user may edit the message freely in the editor; **their saved text is the commit message** — the suggestion is a starting point.
- Editor emptied or aborted → no commit, staged state untouched. **This is the user declining — do not retry, do not hand back a paste-command.** One structured ask: *"Editor closed without a save — the commit didn't happen. Re-open the editor with the same message?"* (yes, retry / no, stop / edit the message first). Only a yes re-invokes `repo-commit`.
- Hooks run normally on the normal lane — the tool never bypasses them (`--no-verify` appears nowhere in its vocabulary; the `--wip` lane's `-n` is git-wip's documented exception, not a flag this skill passes).

After the commit: report the landed `hash subject`, and offer `/devenv-open-pr` if the branch's work is complete.

## Checks lane detail (unchanged behavior)

**Scope:** default changed files only — staged or modified since `git merge-base HEAD <default-branch>`; `--all` overrides to whole-project. Group by project root (`package.json`, `*.csproj`, `pyproject.toml`, `Cargo.toml`, `go.mod`); resolve commands from README → package scripts → devenv conventions (`pnpm test`, `dotnet test`) → ask. If detection finds nothing, stop and ask — don't guess.

**Checks, all run, all reported together:** format → lint → type-check → tests. Per-tool failure sections with file:line links; suggest auto-fixes, apply only with confirm (one confirm per tool), re-run only the fixed tool.

**Compatibility Layer Gate** (checks lane and commit lane both): scan changed files for shim-like markers (`shim`, `compat`, `adapter`, `legacy`, `bridge`); newly added test-only compatibility shapes require explicit user approval of the workaround path — unapproved, the gate is not clear. Shared [workaround decision policy](../common/references/workaround-decision-policy.md).

**Sequence with the commit lane:** if the user wants both checks and a commit, run the checks first; any failure blocks the commit proposal until fixed or explicitly waived by the user.

## What this skill never does

- **Never runs `git commit` directly** — commits go through `repo-commit`, whose editor gate makes every normal commit human-confirmed.
- **Never runs `git add`** — staging is the user's decision, always (the `--wip` lane's stage-all happens inside git-wip, on the user's explicit WIP choice, not as a skill action).
- **Never bypasses with `--no-verify`** or equivalent skip flags; the normal lane doesn't, and the WIP lane's hook bypass lives inside git-wip where it's documented.
- **Never runs tests as a commit prerequisite** and never checks whether hooks are installed — infrastructure owns enforcement; the commit lane's gates are the marker gate and message hygiene, not test re-runs.
- **Never modifies hooks** (`.git/hooks/`, `.husky/`, …).
- **Never executes the WIP lane uninvited** — it runs only on the user's explicit choice from an interview; `git-wip` alone remains a suggestion for the user to run themselves.
- **Never re-runs all checks after a single auto-fix** — only the fixed tool.

> **Micro-fix lane:** an explicit user ask to fix one reported failure ("just fix that lint error for me") may run in-session under the shared [incidental implementation protocol](../common/references/incidental-implementation-protocol.md) (micro ceiling, supervised handback). The never-runs boundaries above still apply inside the lane.

## Anti-patterns

- **Committing via raw `git commit` "since everything passed"** — the only commit path is `repo-commit`.
- **Staging on the user's behalf** — including "helpfully" staging a stray file; propose, never stage (WIP lane excepted, and that's git-wip acting on the user's explicit choice).
- **Confirming the commit in chat prose** ("shall I run repo-commit?") — the confirm is a structured interview, always.
- **Passing long messages as one giant argv string** — use `--file`; the argv shape risks shell-quoting and terminal mangling.
- **Retrying after an editor abort, or handing back a paste-command** — abort is the user declining; one structured ask, then a clean re-invoke only on yes.
- **Stacking a permanent commit silently on WIP history** — the WIP-predecessor interview runs whenever the last commit is a WIP snapshot.
- **Treating an empty editor abort as a failure to retry** — it is the user declining the commit; stop (then the single structured ask above applies).
- **Sweeping unstaged changes into the commit** — the tool prevents it on the normal lane; the skill must not route around it.
- **Skipping the marker gate** because "it's just a small commit."
- **Ephemeral vocabulary in the message** ("Phase 2 complete, all tests passing") — the permanent record must read as durable history, not session bookkeeping.
- **Running deep code review inside the commit lane** — that's `/devenv-review`'s job ("review uncommitted"); this skill's glance exists only to judge the commit itself.
- **Executing the WIP lane for low-value work without the user's explicit choice** — suggest it in the interview; the user picks.
- **Running hooks/tests as a commit precondition** — not this skill's job (the checks lane exists because the user asked for it, not as a hidden gate).
- **Stopping on first check failure** — run everything, report once.
- **Inventing commands** — if you can't detect a lint/test command, ask.
- **Suppressing or misclassifying failures** — report what the tool reported; match the project's strictness.

## Sibling skills

- `/devenv-open-pr` — once the work is committed and the branch is complete.
- `/devenv-review` — deep review of the diff; "review uncommitted" targets the staged + working-tree changes before they're committed (the recommended pre-commit review — two-session pattern, see the workflow docs).
- `/devenv-address-pr-comments` — if checks reveal issues that came from PR feedback.
- `/devenv-pair` / `/devenv-delegate` — execution skills; they never commit, and hand off here when the user says "commit this".

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
