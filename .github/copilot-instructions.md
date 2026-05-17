# Copilot instructions

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- **Discussion is not a directive.** When the user asks for an opinion, thinks out loud, or raises a question, respond in kind — don't implement. Wait for an explicit instruction or clear agreement before writing code or editing files. If it's ambiguous: *"Want me to go ahead with that, or are we still thinking it through?"

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define a verifiable goal before starting. Loop until it's met.**

- Before coding, name what "done" looks like: a passing test, a file that exists, a command that succeeds.
- If the goal can't be stated clearly, stop and clarify it first.
- For multi-step work, state the steps and their success checks upfront — don't discover them as you go.

## 5. Communicate Confidence

**Say what you know. Say what you're guessing. Never conflate the two.**

- If you're confident: just state it.
- If you're inferring or estimating: say so explicitly (*"I believe…"*, *"I'd expect…"*, *"I'm not certain, but…"*).
- If you don't know: say *"I don't know"* and offer to look it up. Never confabulate.
- Low-confidence code should be flagged as such — don't let the user discover it after they've reviewed and approved.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 6. Workspace Conventions

This section is the single home for workspace-specific rules. Add new conventions here rather than scattering them across skills.

### WorkInProgress library repos

WorkInProgress (`workinprogress-ai`) library and service repos are cloned into the `repos/` folder of this workspace. When a task requires reading or editing one of these repos, look there first (e.g. `repos/lib.cs.services.bulk-sync/`).

If the needed repo is not present in `repos/`, ask the user to clone it before proceeding — do not guess at paths or attempt to work without the source.

### Prefer workspace tooling over raw CLIs

The `tools/` folder contains workspace-specific wrappers around common CLIs (`gh`, `git`, `dotnet`, `kubectl`, MongoDB, etc.). **When a wrapper exists for what you need to do, use it — don't reach for the underlying CLI.**

This applies even when the wrapper looks like a thin pass-through; wrappers encode workspace conventions (auth, repo targeting via `GITHUB_REPO=<org>/<repo>`, default flags, error handling) that bare CLI calls bypass.

GitHub-related wrappers (non-exhaustive):

| Need                                          | Use                                | Don't use                  |
|-----------------------------------------------|------------------------------------|----------------------------|
| Read an issue                                 | `tools/issue-get <N>`              | `gh issue view <N>`        |
| List issues                                   | `tools/issue-list`                 | `gh issue list`            |
| Create an issue                               | `tools/issue-create ...`           | `gh issue create`          |
| Update an issue body / labels / state         | `tools/issue-update <N> ...`       | `gh issue edit`            |
| Comment on an issue                           | `tools/issue-comment <N> ...`      | `gh issue comment`         |
| Close an issue                                | `tools/issue-close <N>`            | `gh issue close`           |
| Read a PR                                     | `tools/pr-get <N>`                 | `gh pr view`               |
| Create a feature-branch PR                    | `tools/pr-create-for-merge`        | `gh pr create`             |
| Comment on a PR                               | `tools/pr-comment <N> ...`         | `gh pr comment`            |
| Read PR review threads                        | `tools/pr-threads-get <N>`         | `gh api ...graphql`        |
| Reply to / resolve a review thread            | `tools/pr-thread-reply`, `tools/pr-thread-resolve` | `gh api ...`   |
| Get the diff for a PR                         | `tools/pr-diff <N>`                | `gh pr diff`               |
| Org-wide Actions run status / filter by repo  | `tools/actions-status`             | `gh run list`              |
| List workflow definitions across org          | `tools/actions-list`               | `gh workflow list`         |
| Trigger a workflow_dispatch run               | `tools/actions-run`                | `gh workflow run`          |
| Re-run a workflow run (or failed jobs only)   | `tools/actions-rerun`              | `gh run rerun`             |
| Stream live logs from an in-progress run      | `tools/actions-watch`              | `gh run watch`             |
| List / download artifacts from a run          | `tools/actions-artifacts`          | `gh run download`          |

When no wrapper exists for what you need (e.g. inline review comments, adding reviewers, project boards beyond `tools/project-*`), falling back to `gh` is fine — mention that you're falling back and why, so the gap is visible.

The same rule holds for `git` (prefer `tools/git-*` wrappers when one exists), `dotnet`/test wrappers, and any other category covered by `tools/`.

### Never run git operations that mutate repository state

The AI **never** runs git commands that change repository state, branch state, or working-tree state. The user owns every commit, every branch switch, every push.

**Forbidden** (no exceptions, no "since the tests passed", no "I'll just stash this"):

- `git commit`, `git add`, `git rm`, `git mv`
- `git push`, `git pull`, `git fetch`
- `git checkout` / `git switch` / `git restore` (anything that changes the working tree or HEAD)
- `git branch` (create, delete, rename)
- `git merge`, `git rebase`, `git cherry-pick`, `git revert`
- `git reset` (any mode)
- `git stash` (push, pop, apply, drop)
- `git tag`, `git notes`
- Any flag that bypasses safety: `--no-verify`, `--force`, `-f`, `--hard`

**Allowed:** read-only inspection — `git status`, `git log`, `git diff`, `git show`, `git rev-parse`, `git merge-base`, `git blame`, `git ls-files`, `git config --get`, etc.

**Wrappers that internally mutate** (e.g. `tools/pr-create-for-merge` pushes the branch, `tools/git-update` pulls) **are allowed** — wrappers encode the safety. The rule prohibits *raw* git mutations, not wrapper invocations.

If a task genuinely requires a mutation (e.g. "commit this and open a PR"), state the exact command(s) and ask the user to run them, or — when a wrapper exists — invoke the wrapper. Never invent a workaround that mutates state directly.