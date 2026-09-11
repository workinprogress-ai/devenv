# Tools Reference

Quick reference for all CLI tools used by the skill suite. Skills invoke `tools/<name>` relative to the workspace root.

**This file is the complete invocation reference — do not run `--help` on any tool at runtime.** Every tool a skill is expected to call has its stable invocation pattern here; when a skill needs a command shape, it quotes it inline or cites this file.

**The AI never runs the `gh` CLI directly — for any GitHub domain.** Issue management uses the `issue-*` tools exclusively (reads and writes); PR, project, Actions, and repository-inspection operations use their wrappers (`pr-*`, `project-*`, `actions-*`, `release-list`, `ruleset-export`, `org-issue-types`, `artifacts-list`). If an operation is not covered by any wrapper, surface it to the user as a tooling gap — `gh` is not a fallback. The wrappers are the workspace's abstraction layer over GitHub; the backing CLI is an implementation detail that may change.

**Common flags available on all tools (not repeated per-entry):**

- `-n, --dry-run` — show what would happen without executing
- `-V, --verbose` — enable debug output
- `--devenv` — safety override to run against the devenv repo itself; **reserved for work that is genuinely about the devenv repo** — never as a shortcut past the devenv-repo refusal. When a wrapper refuses because the cwd is the devenv repo, target the actual project repo instead (see the [repo-targeting guard](./_conventions.md#repo-targeting-guard-required-for-issueartifact-calls))
- `GITHUB_REPO` env var — override repo (`owner/repo`); **resolution order: `GITHUB_REPO`, else `GH_ORG` + current directory's repo name, else current repo — the terminal location silently decides the target when the env var is unset.** Prefix issue/artifact calls with `GITHUB_REPO=<owner>/<repo>` whenever the target is anything other than the cwd's repo

---

## Issue tools

### next-id

Resolve the next free numeric identifier deterministically — filename suffixes and in-document ID sequences.

```
next-id --pattern 'Plan-issue-42-{N}.md' [--dir DIR] [--width W] [--filename]
next-id --file DOC.md --prefix 'SPEC-' [--full]
```

Filename mode scans a directory for the pattern's `{N}` digit run and prints the next free number (or full filename with `--filename`). In-doc mode scans a document for `PREFIX-NNN` tokens and prints the next number (or `PREFIX-NNN` with `--full`). Use for every "next available suffix" / "next sequential ID" need — never hand-count.

Examples:

```bash
next-id --pattern 'spike-{N}-*' --width 3          # 004
next-id --pattern 'Blueprint-orders-{N}.md' --filename
next-id --file Specifications-orders-001.md --prefix 'SPEC-' --full   # SPEC-015
```

### artifact-header

Parse, verify, and stamp `DEVENV_ARTIFACT_V1` headers in local artifact files.

```
artifact-header FILE [--field KEY] [--stamp] [--set KEY=VALUE]
```

Without options prints the parsed header as JSON (`{"found": true, "header": {...}}`; exit 1 when no header block exists). `--field KEY` prints one raw value. `--stamp` rewrites `updated_at_utc` to now. `--set` sets/replaces one key (any key — including `planning_repo`, the planning-repo back-link for governed work; see the [repo-targeting guard](./_conventions.md#repo-targeting-guard-required-for-issueartifact-calls)). Use instead of hand-parsing or hand-editing metadata blocks in local files.

Examples:

```bash
artifact-header Plan-issue-42-001.md --field doc_id
artifact-header Plan-issue-42-001.md --field planning_repo
artifact-header Grooming-orders-001.md --set planning_repo=workinprogress-ai/planning.development.main
artifact-header Grooming-orders-001.md --stamp
```

### devenv-marker-check

Deterministic DEVENV-marker and AC-comment scanning (replaces hand-run grep sweeps).

```
devenv-marker-check [PATH...] [--ac] [--marker REGEX] [--require]
```

Gate mode (default): exit 1 when any `DEVENV[` marker remains. `--ac` lists `[AC-N]` comments for the AC review gate (always exit 0). `--marker` scans a custom pattern (e.g. `DEVENV\\[bug-hunt\\]`). `--require` inverts the gate — pass only when at least one match exists.

Examples:

```bash
devenv-marker-check .                       # cleanup gate
devenv-marker-check --ac repos/my-service   # AC review finder
devenv-marker-check --marker 'DEVENV\\[bug-hunt\\]' repos/my-service
```

### plan-parse

Deterministic plan structure parsing.

```
plan-parse PLAN_FILE [--structure] [--census] [--anchors] [--summary] [--lint [--require-header]]
```

`--structure` (default): phases with tasks and completion state plus the AC checklist as JSON. `--census`: per-phase done/open counts. `--anchors`: file paths mentioned in the plan with existence flags (staleness scans). `--summary`: single-object progress summary — `{plan_file, doc_id, issue_number, planning_repo (header routing fields; null when absent), phases_total, phases_complete, current_phase, tasks_done/open/total, pct_tasks, weighted{done,total,pct}, sized_tasks, open_questions, unchecked_acs}`; size weights S=1 M=2 L=4, missing size counts as M. `--lint`: structural lint — `{errors, warnings, checks, ok}`, exit 1 on errors; checks no-phases, alphabetic task suffixes (`2.1a`), duplicate ids, `## Revision History` presence; warns on empty phases, missing size tokens, numbering gaps. `--lint --require-header`: additionally validates the `DEVENV_ARTIFACT_V1` header (presence, `doc_id` format + first-256 placement, `artifact_type: plan`, `planning_repo` owner/repo form) — **the gate to run before any plan-artifact `issue-artifact-upsert`** (errors block; only explicit user acceptance of a documented deviation bypasses). Use instead of hand-scanning headings, checkboxes, or `Files:` bullets — and instead of hand-counting progress (the `Progress:` snapshot line derives from `--summary`/`--census`).

Examples:

```bash
plan-parse Plan-issue-42-001.md --census
plan-parse Plan-issue-42-001.md --summary | jq '{issue_number, planning_repo, pct_tasks}'
plan-parse Plan-issue-42-001.md --lint --require-header
plan-parse Plan-issue-42-001.md --structure | jq '.phases[] | select(.number=="2")'
plan-parse Plan-issue-42-001.md --anchors | jq '.anchors[] | select(.exists==false)'
```

### spec-dependency-check

Validate `Specifications-*.md` dependency graphs and ID anchors.

```
spec-dependency-check FILE [FILE...]
```

Checks unknown dependency references, dependency cycles (incl. transitive), group-order violations, and broken SPEC-ID links. Multiple files = cross-doc edges (informational). Output JSON `{errors, warnings, edges, ok}`; exit 1 on errors.

Examples:

```bash
spec-dependency-check Specifications-orders-001.md
spec-dependency-check Specifications-orders-001.md Specifications-auth-001.md
```

### issue-get

Retrieve a single issue as structured JSON.

```
issue-get ISSUE_NUMBER [--pretty] [--format FIELD]
```

Key flags:

- `--pretty` — human-readable indented JSON
- `--format FIELD` — print one field as raw text (`title`, `body`, `state`, `url`, `number`, `author`; `labels` joins label names with commas) — replaces `jq -r` pipelines

Output fields: `number`, `title`, `body`, `state`, `labels[]`, `assignees[]`, `milestone`, `author`, `createdAt`, `updatedAt`, `url`, `comments`

Examples:

```bash
issue-get 42 --pretty
issue-get 42 --format title
issue-get 42 --format body > /tmp/issue-body.md
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
- `-t, --type` — native issue type: `Bug`, `Feature`, `Task`, `Epic` (case-insensitive; same vocabulary as `issue-create`; legacy lowercase aliases `epic`/`story`/`bug` still accepted, `story` → `Task`)
- `-l, --label` — repeatable
- `-a, --assignee` — use `none` for unassigned, `@me` for self
- `-f, --format` — `table` (default), `json`, `simple`
- `-n, --limit` — default 30

Examples:

```bash
issue-list --format json | jq -r '.[] | "\(.number) \(.title)"'
issue-list --type Bug --assignee @me
issue-list --state all --label "priority:high"
```

---

### issue-search

Keyword search across issue titles and bodies — any-keyword, case-insensitive, substring match; results ranked by distinct-term hit count with the matched terms annotated per issue. Complements `issue-list` (structured filtering) with fuzzy duplicate detection and queue scavenging.

```
issue-search [OPTIONS] TERM [TERM...]
```

Key flags:

- `-s, --state` — `all` (default), `open`, `closed`
- `-t, --type` / `-l, --label` / `-a, --assignee` / `-m, --milestone` — scope filters applied before search
- `-f, --format` — `table` (default), `json`, `simple`
- `-n, --limit` — results shown (default 30); `--fetch-limit` — issues fetched for searching (default 200; raise for large repos)

Matching is substring-based (`ascii_downcase` + `contains`), so regex metacharacters in terms (`.`, `[`, `]`, …) match literally. An issue matches if ANY term appears in its title or body; ranking favors issues matching more distinct terms.

Examples:

```bash
issue-search session timeout
issue-search --state all --type Bug login failed   # duplicate check
issue-search --format json reservation TTL
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
issue-comment-list ISSUE_NUMBER [--pretty] [--full] [--repo OWNER/REPO]
```

Key flags:

- `--pretty` — pretty-print JSON array output
- `--full` — return full comment bodies instead of previews
- `--repo OWNER/REPO` — override the target repository

Examples:

```bash
issue-comment-list 42 --pretty
issue-comment-list 42 --full | jq -r '.[0].id'
```

---

### issue-comment-update

Replace an existing issue comment by comment ID.

```
issue-comment-update COMMENT_ID (--body TEXT | --body-file FILE) [--repo OWNER/REPO] [--dry-run]
```

Key flags:

- `--repo OWNER/REPO` — override the target repository

Examples:

```bash
issue-comment-update 123456789 --body-file updated-artifact.md
```

---

### issue-artifact-upsert

Create or update an issue-comment artifact. Automatically extracts `doc_id` from the artifact body header (first 256 characters) and **stamps `updated_at_utc` to the current UTC time** inside the `DEVENV_ARTIFACT_V1` block before publishing.

```
issue-artifact-upsert --issue N (--body TEXT | --body-file FILE) [--repo OWNER/REPO] [--dry-run] [--no-stamp]
```

Key flags:

- `--no-stamp` — publish byte-exact without rewriting `updated_at_utc`

The artifact file/body must include `doc_id: <value>` line in the first 256 characters.

Examples:

```bash
issue-artifact-upsert --issue 42 --body-file Plan-issue-42-001.md
```

### issue-artifact-doc-id

Generate a deterministic doc_id for an issue-comment artifact (see the Artifact Identity Convention in `_conventions.md`).

```
issue-artifact-doc-id --issue N --artifact-type TYPE (--slug TEXT | --source-file FILE)
```

Key flags:

- `--issue N` — issue number (required)
- `--artifact-type TYPE` — one of: `spike`, `redesign`, `design`, `blueprint`, `requirements`, `specifications`, `grooming`, `roadmap`, `plan` (current for plans); `implementation-plan` (accepted as legacy alias for pre-rename artifacts), `solution-proposal`
- `--slug TEXT` — slug source text (normalized to kebab-case), or `--source-file FILE` — basename without extension

Output: `dv1:<owner>/<repo>:issue-<N>:<type>:<slug>` on stdout.

---

### issue-artifact-get

Retrieve a single issue-comment artifact by `doc_id`. Output includes a `header` object with the parsed `DEVENV_ARTIFACT_V1` metadata (`doc_id`, `artifact_type`, `artifact_scope`, `issue_number`, `source_file`, `updated_at_utc` — keys present only when found in the artifact).

```
issue-artifact-get --issue N --doc-id ID [--full] [--write-body PATH] [--pretty] [--repo OWNER/REPO]
```

`--write-body PATH` writes the raw unescaped markdown body to a file and reports it as `bodyFile` — prefer this over `--full` + manual JSON unescaping whenever the body will be diffed, edited, or materialized (freshness checks, pull-edit-publish).

Examples:

```bash
issue-artifact-get --issue 42 --doc-id "$DOC_ID" --pretty
issue-artifact-get --issue 42 --doc-id "$DOC_ID" --write-body /tmp/artifact.md
```

---

### issue-artifact-list

List issue-comment artifacts discovered from DEVENV metadata headers.

```
issue-artifact-list --issue N [--artifact-type TYPE] [--full] [--pretty] [--repo OWNER/REPO]
```

Examples:

```bash
issue-artifact-list --issue 42 --artifact-type plan --pretty
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
issue-artifact-select --issue 42 --artifact-type plan --latest --format doc-id
issue-artifact-select --issue 42 --doc-id "$DOC_ID" --format url
```

---

### issue-update

Update fields on an existing issue.

```
issue-update ISSUE_NUMBER [--title TITLE] [--body TEXT] [--body-file FILE]
             [--type TYPE] [--remove-type]
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

Wrapper policy:

- This wrapper is the **required** path for all issue creation in workspace repos — never raw `gh issue create` (enforces native types, templates, labels; repo selection stays behind the abstraction).
- No `--repo` flag exists. The target repo is selected via the `GITHUB_REPO` env var (`owner/repo`); unset, it falls back to `GH_ORG` + current repo name, then to the current repo.

```
issue-create [--title TITLE] [--body TEXT | --body-file FILE] [--type TYPE]
             [--label LABEL] [--assignee USER] [--milestone NAME] [--project NAME]
             [--parent ISSUE_NUM] [--blocked-by ISSUE_NUM]
             [--template FILE] [--no-template] [--no-interactive]
```

Key flags:

- `--type TYPE` — GitHub native issue type; **required for deterministic runs** (validated against `tools/config/issues-config.yml`: Bug, Feature, Task, Epic). Without it the tool prompts via `fzf`.
- `--no-template --no-interactive` — non-interactive creation (`--no-interactive` requires `--title`; pair with `--type` to avoid the `fzf` prompt)
- `--parent ISSUE_NUM` — links as child of an epic
- `--blocked-by ISSUE_NUM` — repeatable

Deterministic call shape (no editor, no fzf, no template):

```bash
GITHUB_REPO=<org>/<repo> issue-create --title "<title>" --type "<type>" \
  --body-file <path> --no-template
```

Examples:

```bash
issue-create --title "Add OAuth" --type Feature --no-template --no-interactive \
  --body-file spike-findings.md
issue-create --parent 10 --type Task --title "Write unit tests"
```

---

### issue-create-batch

Create multiple issues in one pass using preview-first, deterministic, non-interactive creation.

Wrapper policy:

- This wrapper is the **required** path for batch issue creation — never raw `gh issue create` loops.

```
issue-create-batch --issue "TITLE" [--issue "TITLE|key=value|..."] [--create] [defaults...]
issue-create-batch --file MANIFEST [--create] [defaults...] [--continue-on-error]
```

Key flags:

- `--issue` — fast mode; repeatable entry format: `Title|type=Feature|parent=123|labels=a,b`
- `--file` — advanced mode; YAML/JSON manifest with top-level `issues` array
- `--create` — execute creation (default is preview)
- `--type`, `--parent`, `--label`, `--assignee`, `--blocked-by`, `--milestone`, `--project`, `--body`, `--body-file` — shared defaults for rows/items
- `--dry-run` — explicit preview alias
- `--continue-on-error` — keep processing after a failed row

Rules:

- Use exactly one input mode: `--issue` entries or `--file`.
- Each issue must resolve a type from per-item `type` or default `--type`.

Manifest row fields:

- required: `title` (`type` may come from defaults)
- optional: `body` or `body_file`, `labels[]`, `assignees[]`, `milestone`, `project`, `parent`, `blocked_by[]`

Examples:

```bash
issue-create-batch \
  --issue "Immutable commit graph|type=Feature|size=L" \
  --issue "Ops hardening|type=Task|labels=ops" \
  --parent 1

issue-create-batch \
  --issue "Immutable commit graph|type=Feature" \
  --issue "Ops hardening|type=Task" \
  --parent 1 \
  --create

issue-create-batch --file child-issues.yaml --parent 1 --create
issue-create-batch --file child-issues.yaml --dry-run
```

---

### issue-label-list

List a repository's available issue labels (name, description, color). Read-only — use before suggesting labels so only existing ones are proposed.

```
issue-label-list [--format table|json|simple] [--search TERM]
```

Example: `issue-label-list --search priority --format simple`

### issue-label-create

Create (or idempotently ensure) an issue label. `--seed` creates the standard triage vocabulary from `tools/config/labels-config.yml`; existing labels are skipped unless `--update`.

```
issue-label-create NAME [--color HEX] [--description TEXT] [--update]
issue-label-create --seed
```

Example: `issue-label-create --seed` (bootstrap a new repo's labels)

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

- `-s, --state STATE` — `open`, `closed`, or `all` (default: `open`)
- `-t, --type TYPE` — native issue type: `Bug`, `Feature`, `Task`, `Epic` (case-insensitive; legacy lowercase aliases `epic`/`story`/`bug` still accepted, `story` → `Task`)
- `--milestone NAME` — filter by milestone
- `--label LABEL` — filter by label
- `--multi` — enable multi-select mode
- `--format` — `number` (default), `url`, or `json`

Examples:

```bash
issue-select --type Task
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
- `--repo-dir PATH` — repository directory (default: current)
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

### pr-review-comment

Create an inline review comment on a PR — starts a NEW review thread tied to a specific file and line (GraphQL `addPullRequestReviewThread`). Complements `pr-comment` (top-level conversation) and `pr-thread-reply` (reply inside an existing thread).

```
pr-review-comment PR_NUMBER --file PATH --line N (--body TEXT | --body-file FILE) [--side RIGHT|LEFT] [--dry-run]
```

Key flags:

- `-f, --file PATH` — repo-relative path as shown in the diff (required)
- `-l, --line N` — line number on the chosen side (required)
- `-s, --side` — `RIGHT` (new content, default) or `LEFT` (original)
- `-n, --dry-run` — show what would be posted

Example:

```bash
pr-review-comment 123 --file src/Service.cs --line 42 --body "Null check missing"
```

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

## GitHub Actions tools

Org-wide GitHub Actions operations — views `gh` alone can't replicate in one call.

### actions-status

Report workflow run status across the org (latest run per repo; uses `GH_ORG`).

```
actions-status [OPTIONS]
```

Key flags: `-r, --repo REGEX` (filter repos by name), `-s, --status STATUS` (`success`/`failure`/`cancelled`/`skipped`), `--json`/`--pretty`.

### actions-list

List workflow definitions across the org.

```
actions-list [OPTIONS]
```

Key flags: `-r, --repo REGEX`, `--state STATE` (`active`, `disabled_manually`, …), `--json`/`--pretty`.

### actions-run

Trigger a `workflow_dispatch` run.

```
actions-run WORKFLOW --repo OWNER/REPO [--ref REF] [--input KEY=VALUE...]
```

Key flags: `--repo OWNER/REPO` (required), `--ref REF` (default: repo default branch), `--input KEY=VALUE` (repeatable). Note: `gh workflow run` returns no run ID; the tool polls `gh run list` (~2s) to surface the run URL.

### actions-rerun

Re-run a workflow run, or its failed jobs only.

```
actions-rerun RUN_ID --repo OWNER/REPO [--failed]
```

Key flags: `--repo OWNER/REPO` (required), `--failed` (failed jobs only).

### actions-watch

Stream live logs from an in-progress run.

```
actions-watch [RUN_ID] --repo OWNER/REPO [--exit-status]
```

Key flags: `--repo OWNER/REPO` (required), `--exit-status` (exit non-zero if the watched run fails).

### actions-artifacts

List or download artifacts from a run.

```
actions-artifacts RUN_ID --repo OWNER/REPO [--download [--name NAME] [--dir DIR]] [--json|--pretty]
```

Key flags: `--repo OWNER/REPO` (required), `--download` (download instead of list; `--name`/`--dir` qualify it).

---

## Repository inspection tools

### release-list

List GitHub releases for the target repository (tag, name, published date, prerelease/draft flags). Read-only. Note: repos that use plain git tags without GitHub Releases return empty.

```
release-list [--format table|json|simple] [--limit N]
```

Example: `release-list --format json --limit 5`

### ruleset-export

Export a repository ruleset as JSON (branch-protection backup/inspection). With no ID, lists the repo's rulesets (`id  name  enforcement`). Read-only.

```
ruleset-export [RULESET_ID] [--output FILE]
```

Examples:

```bash
ruleset-export                      # list this repo's rulesets
ruleset-export 8612 --output b.json # export one to a file
```

### org-issue-types

List the GitHub organization's configured issue types (name + node ID) via GraphQL — mirrors `tools/config/issues-config.yml`. Read-only.

```
org-issue-types [--format table|json|simple]
```

Org resolution: `GH_ORG`, else the owner part of `GITHUB_REPO`.

Example: `org-issue-types --format json`

---

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

### repo-cache-deepen

Fetch-only deepening of one cached repository for branch-level git signals (progress reporting). Never checks out — the cache working copy stays on the default branch; branches land as remote refs (`refs/remotes/origin/<b>`). Idempotent and additive; safe to re-run. `repo-cache-update` does not undo deepening (fetch/deepen are additive by nature), though its `gc --prune=all` may drop unreachable objects.

```
repo-cache-deepen --repo <name> [--depth N] [--branch <b>]...
```

Key flags:

- `--repo <name>` — repository name in the cache (required)
- `--depth N` — deepen history by N commits via `git fetch --deepen=<N>` (default 200)
- `--branch <b>` — repeatable; fetch branch into `refs/remotes/origin/<b>` (forced ref update)

Examples:

```bash
repo-cache-deepen --repo lib.cs.common.essentials
repo-cache-deepen --repo service.reqord.identity --depth 500 --branch issue-42-query-progress
```

---

### markdown-plan-complete-task

Mark one or more plan task checkboxes complete or incomplete.

```
markdown-plan-complete-task [--uncomplete] TASK_NUMBER... [PLAN_FILE]
```

Examples:

```bash
markdown-plan-complete-task 2.3
markdown-plan-complete-task 1.1 1.2 /path/to/Plan-001.md
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
markdown-plan-complete-ac AC-1 AC-2 /path/to/Plan-001.md
markdown-plan-complete-ac --uncomplete AC-3 AC-4
```
