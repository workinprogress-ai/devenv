# Tools Reference

Quick reference for all CLI tools used by the skill suite. Skills invoke `tools/<name>` relative to the workspace root. For standard issue and PR operations, `gh` directly with `--repo "$GITHUB_REPO"` is also fine — see `copilot-instructions.md`. Use the wrappers listed here when they provide functionality `gh` alone can't replicate (e.g. thread-aware PR operations, branch-push-plus-create, org-wide Actions queries).

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

### issue-comment-list

List comments on an issue with comment IDs.

```
issue-comment-list ISSUE_NUMBER [--pretty] [--full]
```

Key flags:

- `--pretty` — pretty-print JSON array output
- `--full` — return full comment bodies instead of previews

Examples:

```bash
issue-comment-list 42 --pretty
issue-comment-list 42 --full | jq -r '.[0].id'
```

---

### issue-comment-update

Replace an existing issue comment by comment ID.

```
issue-comment-update COMMENT_ID (--body TEXT | --body-file FILE) [--dry-run]
```

Examples:

```bash
issue-comment-update 123456789 --body-file updated-artifact.md
```

---

### issue-artifact-upsert

Create or update an issue-comment artifact. Automatically extracts `doc_id` from the artifact body header (first 256 characters).

```
issue-artifact-upsert --issue N (--body TEXT | --body-file FILE) [--repo OWNER/REPO] [--dry-run]
```

The artifact file/body must include `doc_id: <value>` line in the first 256 characters.

Examples:

```bash
issue-artifact-upsert --issue 42 --body-file Implementation_plan-issue-42-001.md
```

---

### issue-artifact-get

Retrieve a single issue-comment artifact by `doc_id`.

```
issue-artifact-get --issue N --doc-id ID [--full] [--pretty] [--repo OWNER/REPO]
```

Examples:

```bash
issue-artifact-get --issue 42 --doc-id "$DOC_ID" --pretty
```

---

### issue-artifact-list

List issue-comment artifacts discovered from DEVENV metadata headers.

```
issue-artifact-list --issue N [--artifact-type TYPE] [--full] [--pretty] [--repo OWNER/REPO]
```

Examples:

```bash
issue-artifact-list --issue 42 --artifact-type implementation-plan --pretty
```

---

### issue-artifact-select

Resolve exactly one issue artifact for downstream work.

```
issue-artifact-select --issue N [--artifact-type TYPE] [--doc-id ID] [--latest] [--format json|doc-id|comment-id|url] [--pretty] [--repo OWNER/REPO]
```

Selection rules:

- `--doc-id` selects a specific artifact deterministically.
- Without `--doc-id`: selects automatically only when one match exists.
- `--latest` breaks ties by most recent update when multiple matches exist.
- Without `--latest`, multiple matches return an ambiguity payload and non-zero exit.

Examples:

```bash
issue-artifact-select --issue 42 --artifact-type implementation-plan --latest --format doc-id
issue-artifact-select --issue 42 --doc-id "$DOC_ID" --format url
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

### issue-select

Interactive GitHub issue selection using `fzf`.

```
issue-select [--state STATE] [--type TYPE] [--milestone NAME] [--label LABEL] [--multi] [--format number|url|json]
```

Key flags:

- `--state STATE` — `open`, `closed`, or `all` (default: `open`)
- `--type TYPE` — `epic`, `story`, or `bug`
- `--milestone NAME` — filter by milestone
- `--label LABEL` — filter by label
- `--multi` — enable multi-select mode
- `--format` — `number` (default), `url`, or `json`

Examples:

```bash
issue-select --type story
issue-select --multi --milestone "Sprint 5"
```

---

### issue-groom

Interactive issue grooming wizard for backlog management.

```
issue-groom [--project NAME] [--milestone NAME]
```

Examples:

```bash
issue-groom
issue-groom --project "Q1 2026"
issue-groom --milestone "Sprint 5"
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

---

### pr-create-for-review

Create a draft `REVIEW:` pull request comparing two commits.

```
pr-create-for-review <PR_DESCRIPTION> [REPO_DIR] [FROM_COMMIT] [TO_COMMIT]
```

If `FROM_COMMIT` and `TO_COMMIT` are omitted, the tool launches an `fzf` picker against the repo's version tags.

Examples:

```bash
pr-create-for-review "compare release candidates" . v1.2.0 v1.3.0
pr-create-for-review "review latest changes"
```

---

### pr-complete-merge

Complete an existing PR from the current branch to the target branch using a Conventional Commits merge message.

```
pr-complete-merge [--force] <ISSUE_ID | --select | --no-issue-id> "<CommitMessage>" [REPO_DIR]
```

Examples:

```bash
pr-complete-merge 42 "feat(api): add user endpoint"
pr-complete-merge --select "fix(auth): token refresh"
pr-complete-merge --force --no-issue-id "chore: merge branch cleanup"
```

---

### pr-merge-pull-request

Merge an open pull request from the current branch.

```
pr-merge-pull-request [commit-message] [--issue NUMBER] [--method squash|merge|rebase] [--base BRANCH] [--repo-dir PATH] [--branch NAME] [--force]
```

Examples:

```bash
pr-merge-pull-request
pr-merge-pull-request "feat(api): add user endpoint" --issue 42
pr-merge-pull-request --method merge --base develop
```

---

### pr-cleanup-review-branches

Delete remote `review/*` branches older than the configured threshold.

```
pr-cleanup-review-branches [REPO_DIR] [DAYS_OLD]
```

Examples:

```bash
pr-cleanup-review-branches
pr-cleanup-review-branches /path/to/repo 14
```

---

### pr-get-review-link

Get the GitHub URL for an open `REVIEW:` pull request in a repository.

```
pr-get-review-link [REPO_DIR]
```

Examples:

```bash
pr-get-review-link
pr-get-review-link /path/to/repo
```

---

### pr-get-merge-link

Get the GitHub URL for the current branch's open pull request.

```
pr-get-merge-link [REPO_DIR]
```

Examples:

```bash
pr-get-merge-link
pr-get-merge-link /path/to/repo
```

---

## Project tools

### project-add-issue

Add one or more issues to a GitHub Project (v2).

```
project-add-issue PROJECT_NAME ISSUE_NUMBER... [--field NAME=VALUE] [--dry-run]
```

Key flags:

- `--field NAME=VALUE` — set project field values; repeatable

Examples:

```bash
project-add-issue "Q1 2026" 123
project-add-issue "Sprint 5" 123 124 --field "Status=Ready"
```

---

### project-update-issue

Update project-specific field values for an issue in a GitHub Project (v2).

```
project-update-issue PROJECT_NAME ISSUE_NUMBER [--status STATUS] [--field NAME=VALUE] [--list-fields] [--dry-run]
```

Key flags:

- `--status STATUS` — set workflow status
- `--field NAME=VALUE` — set custom field values; repeatable
- `--list-fields` — list available fields in the project

Examples:

```bash
project-update-issue "Q1 2026" 123 --status "Ready"
project-update-issue "Sprint 5" 123 --field "Priority=High"
```

---

## Repo and markdown tools

### repo-cache-update

Refresh the C# repository cache and dependency index, then print the cache directory path on stdout.

```
repo-cache-update [--no-refresh]
```

Examples:

```bash
repo-cache-update
repo-cache-update --no-refresh
```

---

### markdown-plan-complete-task

Mark one or more implementation-plan task checkboxes complete or incomplete.

```
markdown-plan-complete-task [--uncomplete] TASK_NUMBER... [PLAN_FILE]
```

Examples:

```bash
markdown-plan-complete-task 2.3
markdown-plan-complete-task 1.1 1.2 /path/to/Implementation_plan-001.md
markdown-plan-complete-task --uncomplete 2.3 2.4
```

---

### markdown-plan-complete-ac

Mark one or more acceptance-criteria checkboxes complete or incomplete.

```
markdown-plan-complete-ac [--uncomplete] AC_NUMBER... [FILE]
```

Examples:

```bash
markdown-plan-complete-ac AC-3
markdown-plan-complete-ac AC-1 AC-2 /path/to/Implementation_plan-001.md
markdown-plan-complete-ac --uncomplete AC-3 AC-4
```
