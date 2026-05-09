---
name: open-pr
description: Open a GitHub PR from the current branch — builds a structured title and body from the active plan, git diff, and parent issue, then submits via `pr-create-for-merge`. USE WHEN the user says "open a PR", "raise a PR", "create a PR", "open a pull request", "raise a pull request", "create a pull request", "let's open a PR", "ship this phase", or "wrap this branch into a PR". Always shows the draft for approval before submitting; defaults to ready-for-review, not draft. DO NOT USE FOR responding to existing PR feedback (use `/address-pr-comments`), wrapping up without opening a PR (use `/session-handoff`), getting a code review without a PR (use `/code-review`), or the GitHub extension's reviewer-suggesting flow (use `/create-pull-request`).
argument-hint: Optional — branch name or plan path; otherwise uses current branch and detected plan
---

# Open PR

Take a committable phase of work from a plan-driven workflow and open a GitHub PR with a structured title and body. Always uses `pr-create-for-merge`; never calls `gh pr create` directly.

> Consult [`../_tools-reference.md`](../_tools-reference.md) for exact flags before invoking any tool.

## When to use this skill

- A phase of an implementation plan is complete and ready to ship.
- The branch has commits, the work is reviewable, and you want a PR opened with a proper body.
- You want the PR description auto-built from the plan + git history rather than typed by hand.

If a PR already exists and you're responding to feedback, use `/address-pr-comments`. If you're ending a session without opening a PR yet, use `/session-handoff`. If you want a code review and don't need a PR opened, use `/code-review`. If you want the GitHub extension's flow with reviewer suggestions and richer integration, use `/create-pull-request`.

## Prerequisites

- Branch exists, has at least one commit, and is pushed (or `pr-create-for-merge` will fail).
- An implementation plan (`Implementation_plan*.md`) is present, OR the user provides title/context to compensate.

If the branch has no commits ahead of base, stop and tell the user — there's nothing to open.

## Sources

Assemble the PR draft from, in order:

1. **Active implementation plan** — `Implementation_plan*.md` at workspace root. Use phase name for title, completed `[x]` tasks for the changes list, `## Revision history` and decision blocks for rationale.
2. **`git log --oneline <merge-base>..HEAD`** and **`git diff --stat`** — actual changes shipped, file scope.
3. **Parent issue** — extract from plan body (`refs #N`, `closes #N`) or branch name (`issue-NNN-...`, `NNN-...`). If found, fetch via `tools/issue-get` for issue title (used in PR title context) and to confirm `Closes #N` is appropriate.
4. **Session-handoff comment** — if one was posted on the parent issue/PR already, reuse its hotspots and decision sections rather than regenerating.
5. **The user** — for anything missing: title clarification, testing notes, anything the artifacts don't show.

## PR title

Format: `<type>: <short description> (refs #N)` or `<type>: <short description> (closes #N)`.

- `<type>` matches the project's commit convention if present (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`). Default to `feat` for new functionality, `fix` for bug fixes, otherwise infer from plan phase name.
- Keep under 72 chars. If the phase name is long, summarize.
- `closes #N` only if the PR fully resolves the issue. Otherwise `refs #N`.

Show the proposed title; the user can edit before submission.

## PR body structure

```markdown
## Summary
<1-2 sentences — what this PR does and why>

## Changes
- <bullet from completed task>
- <bullet from completed task>
- <bullet from git diff>

## Key decisions
- **<decision>** — <rationale>. Alternatives considered: <X>, rejected because <Y>.
- **<decision>** — ...

## Testing
- <what tests were added / what was manually verified>
- <test command to run, if non-obvious>

## Review hotspots
- [path/file.ext:42](path/file.ext#L42) — <why this needs extra eyes>
- [path/other.ext:10](path/other.ext#L10) — <reason>

## Related
- Closes #N    <!-- or "Refs #N" -->
- Implementation plan: [Implementation_plan-X.md](Implementation_plan-X.md)
- Session handoff: <link to comment, if any>
```

Sections with no content get omitted — don't pad.

If a session-handoff comment exists on the parent issue, reuse its **Key decisions**, **Review hotspots**, and **Throwaway/temporary code** sections verbatim (with attribution: "From session handoff <date>"). Don't regenerate; the handoff already captured the rationale freshly.

## Mode

**Default: ready-for-review.** The skill assumes a plan-driven workflow where reaching this point means the work is done and reviewable.

User can opt into draft mode explicitly ("open as draft", "draft PR"). If they do, pass the appropriate flag to `pr-create-for-review`.

## Flow

1. Detect branch, plan, parent issue, prior handoff.
2. Build draft title and body.
3. Show the full draft in chat.
4. Ask for edits / confirmation: "Open this PR? (y/n/edit)"
5. On `y`: invoke `tools/pr-create-for-merge "<title>" --issue <N> --body "$(cat <draft>)"` (add `--draft` if requested; use `--no-issue` if no parent issue was found).
6. On `edit`: incorporate the user's changes, re-show, re-confirm.
7. On `n`: stop. Print the draft so the user can use it manually if they want.

After the PR is opened, print the PR URL and number.

## Anti-patterns

- **Calling `gh pr create` or `pr-create-for-review` directly** — always go through `pr-create-for-merge`. (`pr-create-for-review` is a different tool that creates "REVIEW:" diff PRs between two commits — not for feature branches.)
- **Auto-submitting without showing the draft** — title and body must be reviewed before submission.
- **Inventing testing notes** — if the user didn't run tests and you don't see them in CI, ask. Don't write "tested locally" speculatively.
- **Padding the body** — omit empty sections rather than writing "N/A".
- **Inferring `closes #N` for partial work** — if the PR doesn't fully resolve the issue, use `refs #N`.
- **Regenerating decisions when a handoff exists** — reuse the handoff's rationale; the freshly-written version is more accurate than reverse-engineering from commits.
- **Mixing this with the GitHub extension's flow** — if the user wants reviewer suggestions, labels, project assignment, etc., redirect to `/create-pull-request`.
- **Opening a PR with no commits ahead of base** — stop and tell the user; don't open an empty PR.

## Sibling skills

- `/address-pr-comments` — once the PR has review feedback to address.
- `/session-handoff` — wrap-up that doesn't (yet) open a PR; often runs before this skill.
- `/code-review` — if you want review feedback without opening a PR.
- `/create-pull-request` (GitHub extension) — for the richer reviewer-suggesting / label / project flow.
- `/plan-update`, `/refine-implementation-plan` — if opening the PR reveals plan tasks to mark or add.

See the [Skills catalog](../../docs/Skills.md) for the full list and decision tree.
