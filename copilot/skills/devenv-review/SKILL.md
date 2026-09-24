---
name: devenv-review
description: Adversarial review of changed code — hunt for ways to break it. Structured, actionable feedback on user-owned changes. USE WHEN the user says "review this PR", "review my changes", "code review", "look over this branch", "review the diff", or hands off a PR / branch / local diff for assessment. Supports both existing PRs and pre-PR branch reviews. Auto-detects input: a PR number → fetches via pr-get + pr-diff; two refs → diffs locally; nothing → defaults to current-branch-vs-default-branch. --plan <path>: plan-encoded review. Produces a 1–2 sentence summary, then findings grouped by severity (Blocker / Concern / Nit / Praise) using the same hotspot bullet format as /devenv-delegate. Saves the review to a gitignored tmpN file the user edits to select findings, then posts each kept finding as an inline PR review thread on its exact line via pr-review-comment (summary comment optional). Focuses only on what changed; flags missing tests; surfaces TODO/FIXME left in the diff. DO NOT USE for writing or refactoring code (use /devenv-pair or /devenv-delegate), for responding to review comments on your own PR (use /devenv-address-pr-comments), or for general codebase Q&A.
argument-hint: PR number, two refs (--base BASE --head HEAD), --plan <path>, or nothing (defaults to current branch vs. default branch)
user-invocable: true
---

# Review

Review code changes and produce structured, actionable feedback for work. Inverse of `/devenv-delegate`: this skill provides review assistance.

> Use the shared [Tool help policy](../_conventions.md#shared-boilerplate-snippets) and [`../_tools-reference.md`](../_tools-reference.md).

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`.

> **Skill feedback:** If nothing is wrong but the user asks how the skill could be improved, follow the shared [Skill Feedback Protocol](../common/references/skill-feedback-protocol.md) to write `IMPROVEMENT_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`. Zero findings is a valid result; never offer unprompted.

## When to Use

- Reviewing a PR before approving / requesting changes.
- Reviewing local work-in-progress before opening a PR.
- Reviewing a branch that is about to become a PR (no published PR required).
- Reviewing a branch's diff against the default branch as a self-check.
- **Reviewing uncommitted work before landing it** — "review for commit" / "review uncommitted": diff staged + working-tree changes against HEAD. The natural pre-commit review; pairs naturally with `/devenv-commit` afterward (see the two-session pattern in the workflow docs).

If the user wants the AI to *write* or refactor code, use `/devenv-pair`, or `/devenv-delegate` for a commissioned autonomous run, instead. Exception: a **micro fix** of this review's own findings (one concern, one sitting, directly tied to the findings) may run in-session under the [incidental implementation protocol](../common/references/incidental-implementation-protocol.md) once the review is complete — anything beyond micro routes as above. If the user wants to *respond to* review comments on their own PR, use `/devenv-address-pr-comments`.

## Inputs

The user provides one of:

- **A PR number** — e.g. `123`. Fetch via `pr-get N --pretty` (title, body, base/head refs, author, labels, draft state). Fetch the diff via `pr-diff N`.
- **Two refs** — e.g. `--base master --head my-feature`. Use `pr-diff --base BASE --head HEAD`. This is the preferred mode for pre-PR branch reviews.
- **Nothing** — ambiguous: resolve by what the working tree shows. **Uncommitted changes present** (staged or unstaged) → propose **uncommitted-diff mode** (diff of HEAD vs working tree + index, via `git diff HEAD`): "You have uncommitted changes — review those (for commit), or the branch vs default?" via structured interview; proceed on answer. **Clean tree** → default to current-branch-vs-default mode (announce it). `/devenv-commit branch` or a branch name given → branch mode, no ask.
- **`--plan <path>`** — plan-encoded review: the plan being executed encodes a dedicated Review phase. The diff source is still auto-detected (PR / refs / default); the plan file supplies the fold-in target. The path may be omitted — see the detection ladder in step 8.

**Auto-detection rule:** `^[0-9]+$` → PR number. Two refs given → ref-diff mode. Plan-encoded mode on top of the auto-detected diff source (announce both). No args → uncommitted changes → propose uncommitted-diff mode (interview when unclear); clean tree → current-branch-vs-default mode (announce). Branch review mode does not call GitHub PR APIs.

For branch-vs-default mode: detect the default branch via `git symbolic-ref refs/remotes/origin/HEAD` (or fall back to `master` then `main`), and use the current branch as head. For uncommitted-diff mode: `git diff HEAD` (covers staged + unstaged); untracked files are listed for awareness but hold no reviewable content until added.

## Workflow

### Stance: adversarial by default

A review that finds nothing is a hypothesis, not a result. Attack the diff the way a hostile reviewer would: *how do I make this fail?* Feed it empty input, concurrent access, huge input, unicode, missing files, expired tokens, network loss. Trace each changed function's callers — who else breaks when this signature or behavior shifts? Check the negative space: the test that asserts the error path, the cleanup that runs on failure, the lock that's released in a `finally`. Report what you tried to break and couldn't — the user can always choose to accept the risk on anything you flag, but they can only decide on risks that were surfaced. Severity stays honest: don't inflate a nit to look thorough, don't soften a real find to be polite.

### Event signal

When a review completes with changes merged or approved-for-merge, signal `_on_end_review <issue-number>` — a visible side effect of this already-approved boundary; state the signal in your normal output (one line). See the [event-signal convention](../_conventions.md#skill-event-signals-_on_).

### 1. Load context

- For PR mode: capture title, body, author, labels, draft status, base/head refs.
- For all modes: get the changed file list (`pr-diff --name-only` or `git diff --name-only`).
- Get the unified diff. If the diff exceeds ~1500 changed lines, warn the user and ask whether to proceed or narrow scope (e.g. specific files).
- If PR is in draft state, note it in the summary but proceed (drafts are valid review targets when explicitly requested).

### 2. Read the changes

- **Focus only on what changed.** Do not review unchanged code surrounding the diff unless context is needed to judge a change.
- Read each changed file's diff and any relevant unchanged context.
- Identify: new behavior, removed behavior, behavior changes, refactors, dead code removal, dependency changes, test changes.

### 3. Build the review

Output structure (markdown, in this order):

````markdown
## Code review — <PR title or "branch <head> vs. <base>">

**Source**: PR #123 (or `branch feature-x vs. master`)
**Files changed**: 12 (+340 / -85)
**Author**: @username (PR mode)
**Status note**: draft (only if applicable)

### Summary
<1–2 sentences: what this change does, plus your overall take ("looks good", "a few concerns", "needs significant rework", etc.)>

### Findings

#### 🛑 Blocker
- [repos/path/file.ts:42](repos/path/file.ts#L42) — <reason: correctness bug, security issue, breaking API change, missing critical test>
  <!-- @post: file=path/file.ts line=42 side=RIGHT -->

#### ⚠️ Concern
- [repos/path/file.ts:88](repos/path/file.ts#L88) — <reason: design issue, maintainability, performance, edge case not handled>
  <!-- @post: file=path/file.ts line=88 side=RIGHT -->

#### 💭 Nit
- (Skip this section unless a nit materially affects readability or correctness.)

#### ✅ Praise
- [repos/path/file.ts:120](repos/path/file.ts#L120) — <what's done well: clear abstraction, good test coverage, helpful comment, simplification>
  <!-- @post: file=path/file.ts line=120 side=RIGHT -->

### Missing tests
- <List new behavior in the diff that lacks corresponding test coverage. Empty list = explicit "tests cover the new behavior".>

### TODO/FIXME left in the diff
- [repos/path/file.ts:55](repos/path/file.ts#L55) — `// TODO: handle empty input`
  <!-- @post: file=path/file.ts line=55 side=RIGHT -->

### Ephemeral-artifact references in added comments
- [repos/path/file.ts:60](repos/path/file.ts#L60) — comment cites finding IDs / plan task numbers / audit filenames: that vocabulary belongs in the plan, audit, or commit messages — not durable code. Default Concern: strip the tag, keep the invariant prose.
  <!-- @post: file=path/file.ts line=60 side=RIGHT -->

### Questions for the author
- <Open questions where the diff isn't self-explanatory: "Is the retry count of 3 intentional or arbitrary?" "Why does this prefer X over Y?">
````

### 4. Severity rules

- **Blocker**: must change before merge. Correctness bugs, security issues, breaking changes without migration, missing critical tests, contract violations.
- **Concern**: should be discussed; may or may not block. Design choices that look risky, performance issues, edge cases, missing error handling at boundaries.
- **Nit**: only include if it materially affects readability or correctness. Skip pure style preferences.
- **Praise**: call out genuinely good work. Skip if there's nothing specific to praise — don't fabricate.

### 5. Hotspot format and `@post` markers

Every finding is a single bullet in the format:

```
- [file:line](workspace-root-relative-path#L42) — <one-line reason>
  <!-- @post: file=<repo-relative-path> line=42 side=RIGHT -->
```

Paths must be **workspace-root-relative** so VS Code renders them as clickable links — e.g. `repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs`, not just `BulkSyncWorker.cs`. Do not emit a path you haven't confirmed exists.

The indented `@post` HTML comment under the bullet is the machine-readable posting target — invisible when the markdown renders. Rules:

- `file=` is **repo-relative** (as shown in the PR diff — this is what `pr-review-comment --file` expects); it usually differs from the workspace-root display link above it.
- `side=` is `RIGHT` (default — new content) or `LEFT` (original content).
- **Postable sections** (get markers): Blocker, Concern, Nit, Praise, TODO/FIXME, Ephemeral-artifact findings. **Summary-only sections** (no markers): Summary, Missing tests, Questions for the author — these are not single-line findings and ride in the top-level summary comment instead.
- One marker per bullet, directly under it. Multi-line findings: use the first line; note the range in prose.
- The user controls posting purely by editing the file: deleting a finding (or its marker) skips it; adding a marker to a new bullet posts it. Deleted findings' markers are simply absent at parse time.

For ranges: `[file.ext:42-58](path/file.ext#L42-L58)`. For multiple non-contiguous lines: separate bullets.

### 6. Write the review to a file

Write the full review to `.local-artifacts/tmpN.md` in the target repo (next free number — see the [standard local markdown folder](../_conventions.md#standard-local-markdown-folder-local-artifacts); this is the session's working copy). Also print the full review to chat. Do **not** post to GitHub yet — the user edits the file first (see step 7).

### 7. Offer to post (PR mode only) — user edits the file, then per-line posting

After writing the file, tell the user:

> "Review saved to [.local-artifacts/tmpN.md](<workspace-relative-path>). **Edit it to control what gets posted** — delete any finding you don't want posted, add or reword others. Each finding with an `@post` marker becomes one inline PR thread pinned to that file and line. Then tell me to post."

When the user says post:

1. Re-read the saved file (the edited version is the source of truth — never post from memory or from what was printed to chat).
2. Parse remaining `@post:` markers; strip the marker comments from all bodies.
3. For each marker: `pr-review-comment <PR> --file <repo-relative-path> --line <N> --body-file <extracted-body>` — one standalone inline thread per finding, each with its own thread URL in the output. Re-confirm with the user before the batch if the count exceeds ~8, or use `--dry-run` on any finding whose path/line looks stale relative to the current diff.
4. **Summary comment is the user's discretion:** if the file still contains a top-level Summary section, offer to post it via `pr-comment <PR> --body-file` (extracted, minus findings — the inline threads carry those); if the user deleted it, skip. Same confirm-first rule.
5. Report back the list of posted thread URLs (and summary-comment URL if posted). Failures are surfaced individually — one failed thread does not abort the batch; ask whether to retry.
6. Offer to retire the file (y/n) per the standard local-markdown retirement rule — the PR now carries the findings.

**Inline posting requires PR mode.** Review threads attach to a PR diff; branch-diff mode (two refs / no-args) can only offer the top-level summary comment via `pr-comment`. The `@post` markers are still written in branch mode — they activate if the branch later becomes a PR and the review is re-run.

Tooling: inline threads are created via `pr-review-comment PR --file PATH --line N --body TEXT|--body-file FILE [--side RIGHT|LEFT]` (standalone — no pending review object needed), read via `pr-threads-get`, replied to via `pr-thread-reply`.

### 8. Plan-encoded review (`--plan <path>`, path optional)

When plan-encoded mode is active, the review runs inside a plan's dedicated Review phase: findings feed a fold-in cycle instead of (or alongside) PR posting. If a `/devenv-delegate` or `/devenv-pair` session encounters the Review-phase task itself, it does **not** switch skills — it follows the shared [plan-encoded review protocol](../common/references/plan-encoded-review.md) (subagent computation + stewardship fold-in). This section governs direct invocation.

**Plan resolution ladder (when `--plan` is omitted):**

1. `--plan <path>` given → use it.
2. A plan already loaded in the current session context → propose it by name ("plan-encoded review against `Plan-issue-45-001.md`?") and proceed on confirm.
3. Exactly one `Plan-*.md` in the target repo has an **open Review phase** (unticked round task) → propose it by name; the unticked round task also supplies the round number. Proceed on confirm.
4. Zero or multiple candidates → ask.

Announce which plan was resolved before reviewing.

**Concurrent-writer guard:** if an active execution session (pair or delegation) holds this plan as its ledger, do not fold in silently — either fold in while that session is paused/between phases, or re-read the plan immediately before writing and reconcile so the fold-in does not clobber ticks or task-state changes the executor made in the meantime. Surface the concurrent session to the user before the plan edit.

**Round scope:** each round reviews the **cumulative** diff (branch vs base) — including fixes from earlier rounds — so later rounds also verify earlier fixes held and catch regressions they introduced. `--plan` combines with any diff source (PR, refs, or default).

**Rejected-findings exclusion:** findings the user explicitly rejected at fold-in are recorded (with reason) in the round record and excluded from subsequent rounds' yield computation — a still-unfixed rejected finding may appear in a later round's diff, but it does not count toward the Blocker/Concern thresholds. Without this exclusion, a rejected Blocker would keep the yield bar high forever and the cycle could never converge.

**Output:** produce the standard review structure, then:

1. **Summary + local artifact.** Present the findings summary in chat and offer to write the review to a `.local-artifacts/tmpN.md` working copy as usual. The file is the durable round record; the user may edit findings there directly.
2. **Fold-in interview.** Then run the set-approval interview via `vscode_askQuestions`: propose the approved findings as plan-task encodings (blockers, concerns, missing tests; nits only when the user opts in — praise never folds in). The user approves, edits, or rejects the proposed set. If the user stops the interview, they may edit the working file directly and tell you to restart the fold-in from the edited file — never fold from memory when they have stopped to edit.
3. **Edit the plan.** Apply only the approved encodings to the plan file as new tasks in the plan's Review phase, using the plan's normal numeric task numbering (e.g. `4.2`, `4.3` — the Review phase is an ordinary phase; its number is whatever position it holds). Carry the round number in the task title (`Review round 2: fix X`) or a round-summary task, never in the task ID — plan tooling (`plan-parse`, `markdown-plan-complete-task`) only accepts dotted numeric IDs. Each task gets `Files:` where applicable, `depends on` where needed, and an `Additional context:` bullet citing the finding (file:line, severity). Mark each folded finding's origin in the round record (folded / rejected with reason).
4. **Issue-backed sync.** If the plan was published as an issue artifact comment, offer to re-upsert: run `plan-parse <path> --lint --require-header` first (errors block), then `issue-artifact-upsert --issue <N> --body-file <path>` on explicit confirmation.
5. **Convergence decision.** Compute the round's yield and present it (rejected findings per the exclusion rule above do not count):
   - **Continue** — the round found any non-rejected Blocker, or ≥ 3 non-rejected Concerns: offer the next round (user's choice; next round re-runs on the updated cumulative diff).
   - **Converged** — 0 Blockers and ≤ 2 Concerns: report convergence and offer to close the Review phase in the plan (tick the round's tasks, record the yield summary and decision).
   - The user always confirms the continue/stop decision; the yield bar informs it, it does not automate it.
6. **PR alongside (optional).** If a PR exists, offer once per round to also post the kept findings as inline PR threads from the round's working file. The fold-in and PR posting are independent channels — either, both, or neither.

**Shared rules.** Fold-in eligibility, rejection recording, task encoding, convergence bar, and the separate-from-in-line-review rule are defined once in the shared [plan-encoded review protocol](../common/references/plan-encoded-review.md) — direct invocation and executor runs (delegate/pair) follow the same rules, so behavior does not drift between the two doors.

**Eligibility mirror:** findings fold into the plan only with user approval; the plan edit is a governed write to the plan file itself, sanctioned in this skill only under plan-encoded mode (and for executors, only inside the shared protocol). Any other plan editing (unticked tasks, scope changes) still routes to `/devenv-refine-plan`.

## Next-step offer

Per the shared [next-step offer](../common/references/execution-gates.md#next-step-offer-wrap-up-convention) convention (one offer, mode-conditional): in plan-encoded mode the offer is the next round or the convergence close (user's choice); in PR mode it is `/devenv-address-pr-comments` (if a PR exists); otherwise back to `/devenv-pair` for the rework.

## Anti-patterns

- **Reviewing unchanged code** — out of scope. Stick to the diff. If unchanged context reveals a problem, mention it in the summary, not as a hotspot finding.
- **Padding with nits** — empty `Nit` section is better than 20 bullets about formatting. Skip the section entirely if nothing material.
- **Fabricating praise** — don't manufacture a "Praise" entry to soften critical feedback. Skip the section if there's nothing specific to call out.
- **Auto-posting** — every push to GitHub requires explicit confirmation, and the post always comes from the user-edited file, never from what was printed to chat earlier.
- **Reviewing without reading** — skim-based reviews produce vague findings. If the diff is too large to read carefully, narrow the scope or refuse.
- **Mixing review with rewrite** — this skill produces feedback. It does not modify the code under review while the review workflow is open. After the review is complete, a micro fix of the review's own findings may run under the [incidental implementation protocol](../common/references/incidental-implementation-protocol.md); anything beyond micro routes to `/devenv-pair` or `/devenv-delegate` (commissioned autonomous run).
- **Posting without re-reading the file** — if the user said they edited the review file, parsing from a cached earlier read posts deleted findings or misses their rewording. Always re-read at post time.

## Sibling skills

- `/devenv-delegate` — inverse: AI implements, human reviews. Same hotspot format.
- `/devenv-pair` — interactive collaboration with review checkpoints during the work.
- `/devenv-commit` — local-diff review before opening a PR (subset of this skill's no-args mode).
- `/devenv-address-pr-comments` — for the PR author responding to review comments.
- `/devenv-plan` — encodes the Review phase this mode folds into (plan-encoded review offer, step 4c).

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
