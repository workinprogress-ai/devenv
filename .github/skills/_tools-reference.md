# Tools Reference

Quick reference for all CLI tools used by the skill suite. Skills invoke `tools/<name>` relative to the workspace root. Never call `gh` directly — always use these wrappers.

**Do NOT run `--help` on any tool at runtime.** This file contains all signatures — use it instead.

**Common flags available on all tools (not repeated per-entry):**
- `-n, --dry-run` — show what would happen without executing
- `-V, --verbose` — enable debug output
- `--devenv` — safety override to run against the devenv repo itself
- `GITHUB_REPO` env var — override repo (`owner/repo`); defaults to current repo

---

## Issue tools

### issue-get

Retrieve a single issue as structured JSON.

```
issue-get ISSUE_NUMBER [--pretty]
```

Key flags:
- `--pretty` — human-readable indented JSON

Output fields: `number`, `title`, `body`, `state`, `labels[]`, `assignees[]`, `milestone`, `author`, `createdAt`, `updatedAt`, `url`, `comments`

Examples:
```bash
issue-get 42 --pretty
issue-get 42 | jq -r '.title'
issue-get 42 | jq -r '.labels[].name'
```

---

### issue-list

List and filter open (or closed) issues. Outputs a table by default; use `--format json` for scripting.

```
issue-list [--state open|closed|all] [--type TYPE] [--label LABEL] [--assignee USER]
           [--milestone NAME] [--author USER] [--format table|json|simple] [--limit N]
```

Key flags:
- `-s, --state` — `open` (default), `closed`, `all`
- `-t, --type` — `epic`, `story`, `bug`
- `-l, --label` — repeatable
- `-a, --assignee` — use `none` for unassigned, `@me` for self
- `-f, --format` — `table` (default), `json`, `simple`
- `-n, --limit` — default 30

Examples:
```bash
issue-list --format json | jq -r '.[] | "\(.number) \(.title)"'
issue-list --type bug --assignee @me
issue-list --state all --label "priority:high"
```

---

### issue-comment

Add a comment to an issue (also works on PRs via issue number).

```
issue-comment ISSUE_NUMBER (--body TEXT | --body-file FILE | --edit)
```

Key flags:
- `-b, --body TEXT` — inline body text
- `-f, --body-file FILE` — read body from a markdown file
- `-e, --edit` — open `$EDITOR` to compose

Examples:
```bash
issue-comment 42 --body "Fixed in the latest commit."
issue-comment 42 --body-file handoff.md
```

---

### issue-update

Update fields on an existing issue.

```
issue-update ISSUE_NUMBER [--title TITLE] [--body TEXT] [--body-file FILE]
             [--add-label LABEL] [--remove-label LABEL]
             [--add-assignee USER] [--remove-assignee USER]
             [--milestone NAME] [--state open|closed]
```

Key flags:
- `--add-label` / `--remove-label` — repeatable; one label per flag
- `--body-file FILE` — replace body from a file
- `--state closed` — close the issue

Examples:
```bash
issue-update 42 --add-label "status:in-review" --add-assignee "@me"
issue-update 42 --body-file updated-plan.md
issue-update 42 --state closed
```

---

### issue-create

Create a new issue, optionally from a template.

```
issue-create [--title TITLE] [--body TEXT | --body-file FILE] [--type TYPE]
             [--label LABEL] [--assignee USER] [--milestone NAME] [--project NAME]
             [--parent ISSUE_NUM] [--blocked-by ISSUE_NUM]
             [--template FILE] [--no-template] [--no-interactive]
```

Key flags:
- `--no-template --no-interactive` — non-interactive creation (requires `--title`)
- `--parent` — links as child of an epic
- `--blocked-by` — repeatable

Examples:
```bash
issue-create --title "Add OAuth" --type Feature --no-template --no-interactive \
  --body-file spike-findings.md
issue-create --parent 10 --type Task --title "Write unit tests"
```

---

### issue-close

Close (or reopen) one or more issues.

```
issue-close [close|reopen] ISSUE_NUMBER... [--comment TEXT] [--reason completed|"not planned"]
```

Key flags:
- `--comment TEXT` — add a comment when closing
- `--reason` — `completed` or `"not planned"` (close only)
- `reopen` action — first positional arg

Examples:
```bash
issue-close 42 --comment "Duplicate of #10" --reason "not planned"
issue-close reopen 42 --comment "Revisiting this."
```

---

## PR tools

### pr-list

List open (or filtered) PRs. Outputs JSON by default.

```
pr-list [--state open|closed|merged|all] [--author USER] [--label LABEL]
        [--base BRANCH] [--head BRANCH] [--limit N] [--pretty] [--table]
```

Key flags:
- `--head BRANCH` — filter by source branch (use to detect PR for current branch)
- `--base BRANCH` — filter by target branch
- `--table` — human-readable output

Examples:
```bash
# Find PR number for current branch
pr-list --head "$(git branch --show-current)" | jq -r '.[0].number'

pr-list --author @me --table
```

---

### pr-get

Retrieve a single PR as structured JSON.

```
pr-get PR_NUMBER [--pretty]
```

Output fields: `number`, `title`, `body`, `state`, `isDraft`, `headRefName`, `baseRefName`, `author`, `labels[]`, `assignees[]`, `reviewRequests[]`, `milestone`, `mergeable`, `mergeStateStatus`, `url`, `createdAt`, `updatedAt`, `comments[]`, `reviews[]`

Examples:
```bash
pr-get 99 --pretty
pr-get 99 | jq -r '.headRefName'
pr-get 99 | jq -r '.state'
```

---

### pr-diff

Fetch a unified diff for a PR, or between two local refs.

```
pr-diff PR_NUMBER [--name-only]
pr-diff --base BASE_REF --head HEAD_REF [--name-only]
```

Key flags:
- `--name-only` — list changed file paths only (no diff content)

Examples:
```bash
pr-diff 99
pr-diff 99 --name-only
pr-diff --base master --head my-feature-branch
```

---

### pr-comment

Add a top-level conversation comment to a PR (not an inline review comment).

```
pr-comment PR_NUMBER (--body TEXT | --body-file FILE | --edit)
```

Key flags:
- `-b, --body TEXT` — inline body
- `-f, --body-file FILE` — read from a markdown file
- `-e, --edit` — open `$EDITOR`

Examples:
```bash
pr-comment 99 --body "Reviewed — looks good. Approved."
pr-comment 99 --body-file code-review-notes.md
```

---

### pr-create-for-merge

**Create a standard feature branch PR.** Use this to open a PR from the current branch targeting the default branch.

```
pr-create-for-merge <title> --issue NUMBER | --no-issue
                    [--base BRANCH] [--branch BRANCH]
                    [--body TEXT] [--body-file FILE]
                    [--draft] [--reviewer HANDLE] [--assignee HANDLE] [--label NAME]
```

Key flags:
- `--issue NUMBER` — issue this PR addresses (required unless `--no-issue`)
- `--no-issue` — explicitly no associated issue
- `--base BRANCH` — target branch (default: repo default branch)
- `--branch BRANCH` — source branch (default: current branch)
- `--body TEXT` — PR body as inline text
- `--body-file FILE` — read PR body from a file (preferred for multi-section bodies)
- `--draft` — open as draft
- `--reviewer` / `--assignee` / `--label` — repeatable

Examples:
```bash
# Open a ready-for-review PR closing issue #42, body from a file
pr-create-for-merge "feat: add OAuth login (closes #42)" --issue 42 \
  --body-file /tmp/pr-body.md

# Inline body for short descriptions
pr-create-for-merge "fix: null check in parser" --issue 55 \
  --body "Fixes null dereference."

# Draft PR with no issue
pr-create-for-merge "wip: experimenting with new cache layer" --no-issue --draft

# With reviewer
pr-create-for-merge "feat: add OAuth login" --issue 42 \
  --body-file /tmp/pr-body.md --reviewer alice
```

> **Note:** `pr-create-for-review` is a *different* tool — it creates "REVIEW:" diff PRs between two commits for version comparison. Do not use it for standard feature PRs.

---

### pr-threads-get

Fetch inline review threads (unresolved by default) for a PR.

```
pr-threads-get PR_NUMBER [--all] [--pretty]
```

Key flags:
- `--all` — include resolved threads (default: unresolved only)

Output: JSON array of thread objects. Key fields per thread:
- `id` — GraphQL node ID (e.g. `PRRT_kwDO...`); pass to `pr-thread-resolve`
- `isResolved` — boolean
- `path` — file path
- `line` — line number
- `comments[]` — array; each has `id` (numeric REST ID for `pr-thread-reply`), `author.login`, `body`, `url`

Examples:
```bash
pr-threads-get 99 --pretty
pr-threads-get 99 | jq length          # count unresolved
pr-threads-get 99 | jq -r '.[0].comments[0].body'
```

---

### pr-thread-reply

Reply to an existing inline review comment.

```
pr-thread-reply PR_NUMBER --comment-id COMMENT_ID (--body TEXT | --body-file FILE | --edit)
```

Key flags:
- `--comment-id COMMENT_ID` — **numeric** REST API comment ID from `pr-threads-get` output (`comments[].id`); **required**

Examples:
```bash
pr-thread-reply 99 --comment-id 456 --body "Fixed — refactored in the latest commit."
pr-thread-reply 99 --comment-id 456 --body-file reply.md
```

---

### pr-thread-resolve

Mark an inline review thread as resolved.

```
pr-thread-resolve THREAD_ID
```

- `THREAD_ID` — **GraphQL node ID** of the thread (starts with `PRRT_`); from `pr-threads-get` output (top-level `id` field). **Not** the PR number.

Examples:
```bash
pr-thread-resolve PRRT_kwDOAbc123

# Resolve all unresolved threads on PR 99
pr-threads-get 99 | jq -r '.[].id' | xargs -I{} pr-thread-resolve {}
```
