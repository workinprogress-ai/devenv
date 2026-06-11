---
name: devenv-session-handoff
description: Produce a structured session handoff for the next contributor — work done, key decisions, next steps, review hotspots, open questions, and any throwaway/temporary code. USE WHEN the user says "wrap up this session", "write a handoff", "session summary for the next person", "I'm tagging out — leave a note for whoever picks this up", "summarise what we did and what's left", or ends a working session that someone else (or future-them) will resume. Auto-derives content from `git log` + `git diff` since branch divergence, current uncommitted changes, any active implementation plan, and session memory; fills gaps by asking the user. Default output is a comment posted on a related issue or PR (with confirm); also offers to update the associated plan via `/devenv-plan-update` or `/devenv-refine-implementation-plan`. DO NOT USE FOR updating an active plan with task progress (use `/devenv-plan-update`), drafting a fresh PR description (use `/create-pull-request`), requesting code review (use `/devenv-code-review`), or personal summaries with no audience.
argument-hint: Optional — issue/PR number to post the handoff on; otherwise the skill will ask
---

# Session handoff

A structured note for whoever picks up the work next — including future-you. Captures what was done, why, what's left, and where to look carefully.

> Use the shared [Tool help policy](../_conventions.md#shared-boilerplate-snippets) and [`../_tools-reference.md`](../_tools-reference.md).

## When to Use

- Ending a working session mid-task and someone else will continue.
- Pausing your own work for a while and want to leave breadcrumbs for future-you.
- Closing out a spike or investigation where the artifact isn't a plan or PR but the context still needs to live somewhere.

If a plan already tracks the work, `/devenv-plan-update` (small status changes) or `/devenv-refine-implementation-plan` (new tasks discovered) is usually the better home. If a PR is the natural endpoint, `/devenv-open-pr` includes a similar summary in the description. For a code-review request specifically, use `/devenv-code-review`.

## Sources

The skill assembles the handoff from multiple sources, in order of preference:

1. **`git log --oneline <merge-base>..HEAD`** — commits made this session.
2. **`git diff <merge-base>..HEAD --stat`** — files changed, scope.
3. **`git status`** — uncommitted / WIP state.
4. **Active implementation plan** (if any `Implementation_plan*.md` exists at workspace root) — completed and remaining tasks.
5. **Session memory** (`/memories/session/`) — any in-progress notes.
6. **The user** — anything the artifacts can't tell you (rationale, dead-ends explored, things deliberately deferred).

If git history is sparse (lots of "wip" commits, squashed work, or uncommitted-only), lean harder on asking the user. Don't fabricate rationale from filenames.

## Handoff structure

```markdown
## Session handoff — <YYYY-MM-DD> — <short topic>

### What was done
- <change 1> ([file:line](repos/path/file.ext#L42))
- <change 2>
- <change 3>

### Key decisions
- **<decision>** — <one-line rationale>. Alternatives considered: <X>, rejected because <Y>.
- **<decision>** — ...

### Next steps
1. <next action> — <why / acceptance criterion>
2. <next action>
3. <next action>

### Review hotspots
- [path/file.ext:42](repos/path/file.ext#L42) — <why this needs extra eyes>
- [path/other.ext:10](repos/path/other.ext#L10) — <reason>

### Open questions / blockers
- <question> — needs <person/info>
- <blocker> — workaround in place: <what>

### Throwaway / temporary code
- [path/scratch.ts](path/scratch.ts) — delete before merge
- `FIXME` markers left at: <list>

### State
- Branch: `<branch>`
- Last commit: `<sha> <subject>`
- Uncommitted: <yes/no — summary>
- Related: #<issue>, PR #<pr>
```

Sections with no content get omitted — don't pad with "N/A".

## Output

Default: **post as a comment on a related issue or PR**.

Flow:

1. Detect related issue/PR:
   - Check current branch name for `issue-NNN` / `NNN-` patterns.
   - Check `Implementation_plan*.md` for issue references.
   - Check open PRs from current branch via `pr-list --head <branch>`.
   - If none found, ask the user for an issue or PR number.
2. Draft the handoff to a temp file.
3. Show the draft in chat for review.
4. Confirm: "Post this as a comment on #<n>? (y/n)"
5. On `y`: post via `issue-comment <n> --body-file <draft>` for issues, or `pr-comment <n> --body-file <draft>` for PRs.

After posting (or instead, on `n`), **also offer**:

- "Update [Implementation_plan-X.md](Implementation_plan-X.md) with progress? (y/n)" — hands off to `/devenv-plan-update` or `/devenv-refine-implementation-plan`.

## Drafting guidance

- **Be specific about hotspots.** "Review the auth changes" is not a hotspot. "[auth/session.ts:88](repos/my-service/auth/session.ts#L88) — token refresh races with logout under load" is.
- **Decisions need rationale.** A bare "switched to X" is useless. Include why and what was rejected.
- **Next steps must be actionable.** "Improve performance" is not a next step. "Profile [api/handler.ts](repos/my-service/api/handler.ts) under 100 rps and identify hot path" is.
- **Mark throwaway code prominently.** If anything will rot if not deleted (scratch files, debug logging, FIXMEs, hardcoded test values), list it explicitly under "Throwaway / temporary code".
- **Don't editorialise.** "We made great progress" is noise; the bullet list speaks for itself.

## Anti-patterns

- **Auto-posting without confirm** — always show the draft and ask before posting.
- **Generating a handoff from filenames alone** — if git history is thin and the user wasn't asked, you're inventing rationale.
- **Padding with "N/A" sections** — omit empty sections.
- **Burying throwaway code** — temporary code goes in its own section, not hidden in "What was done".
- **Vague hotspots** — every hotspot needs a file:line and a one-line reason.
- **Duplicating an existing plan** — if there's an active plan, the handoff should reference it and offer to update it, not restate every completed task.
- **Posting to the wrong issue/PR** — when in doubt, ask the user which one is the right home for the comment.

## Sibling skills

- `/devenv-plan-update`, `/devenv-refine-implementation-plan` — when the active plan needs updating (often invoked right after a handoff).
- `/devenv-open-pr` — when the natural endpoint is a PR rather than a comment; the PR description includes a handoff-style summary.
- `/devenv-code-review` — when you want the next contributor to review what you did.
- `/devenv-spike` — if the session was an investigation, the spike doc is itself the handoff.

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
