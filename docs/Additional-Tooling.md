# Additional Tooling

This document provides comprehensive documentation for all additional tooling available in the development environment. These tools are located in the `scripts/` folder and are automatically added to the `PATH` when the development environment is set up.

## Repository Management

Tools for managing repositories, cloning, updating, and working with multiple repositories.

### `repo-get`

Clones a repository from GitHub into the `repos/` folder.

**Usage:**

```bash
repo-get [--select] [<repository-name>]
```

**Options:**

- `--select`: Show an interactive selection menu of repositories in the organization (excludes already cloned repos)
- `<repository-name>`: Name of the repository to clone/update
- No arguments: Update the current repository (based on git context)

**Examples:**

```bash
# Interactive selection from available repos
repo-get --select

# Clone or update a specific repository
repo-get devops

# Update current repository
repo-get
```

**Notes:**

- Automatically configures git settings from `git-config.sh`
- Supports SSH-first cloning with HTTPS fallback using `GH_TOKEN`
- Automatically detects default branch (main/master)
- Runs `.repo/init.sh` and `.repo/update.sh` hooks if present
- Supports partial repo names for convenience
- Prevents cloning into reserved directories
- Interactive selection requires `fzf` (pre-installed in dev container)

*Note: `get-repo` is a convenience alias for `repo-get`. Both forms work identically.*

### `repo-create`

Creates a new GitHub repository using standardized org rules, then clones it locally and optionally runs a post-creation script.

**Usage:**

```bash
repo-create.sh <repo-name> --type <type> [options]
repo-create.sh --interactive                  # prompts for type and name
```

**Key options:**

- `--type <type>`: Required (planning|service|gateway|app-web|cs-library|ts-package|none)
- `--interactive` / `-i`: fzf-driven type picker + name prompt
- `--public` | `--private`: Visibility (default: private)
- `--description <text>`: Repository description
- `--no-template`: Skip the type’s template repo
- `--no-branch-protection`: Skip ruleset setup
- `--no-clone`: Do not clone after creation
- `--no-post-creation`: Skip running the post-creation script (if defined)

**What it enforces:**

- Naming patterns per type (see `tools/config/repo-types.yaml`)
- GitHub repository rulesets on `master` (requires GitHub Pro or public repo)
- Template repos per type (optional, can be skipped)
- Template repository marking (via `isTemplate` config property)
- Local clone via `repo-get` after creation
- Post-creation script execution (per type) with configurable commit handling

**Architecture:**
The script uses the `repo-types` library (`tools/lib/repo-types.bash`) to manage repository configuration, validation, and ruleset application. The library provides common functions for:

- Loading and validating `repo-types.yaml`
- Validating repository names against type-specific patterns
- Applying GitHub rulesets via the GitHub API

**Post-creation behavior (from repo-types.yaml):**

- `post_creation_script`: Path in the repo (e.g., `.repo/post-create.sh`). If present, it runs after clone.
- `delete_post_creation_script`: If true, script is deleted after it runs (default: true).
- `post_creation_commit_handling`: `none` | `amend` | `new`
  - `amend`: Amend the initial commit and force-push if the script made changes
  - `new`: Create a new commit and push if there are changes

**Ruleset configuration (`rulesetConfigFile`):**
Each type can specify a GitHub repository ruleset JSON file:

- `rulesetConfigFile`: Filename in `tools/config/` (e.g., `ruleset-default.json`)
- Set to `null` or blank to skip ruleset application
- JSON file is a GitHub ruleset export (from `gh api repos/OWNER/REPO/rulesets/ID`)
- Supports token replacement:
  - `{{repo_name}}` - Repository name
  - `{{owner}}` - Organization/owner
  - `{{type_name}}` - Repository type key
  - `{{type_description}}` - Type description from config
- Rulesets require GitHub Pro or a public repository; failures gracefully degrade with a warning

**Creating custom ruleset JSON:**

1. Configure ruleset in GitHub UI for a test repo
2. Export: `gh api repos/YOUR_ORG/TEST_REPO/rulesets/RULESET_ID`
3. Save to `tools/config/my-ruleset.json`
4. Replace hardcoded values with tokens
5. Reference in type config: `rulesetConfigFile: my-ruleset.json`

**Commit message patterns:**
Commit message patterns use Conventional Commits format and support optional breaking-change marker (`!`):

```text
^(feat|fix|docs|chore|refactor|test|major|minor|patch)!?:\s.+
```

Examples:

- `feat: add new feature`
- `fix!: breaking change in fix`
- `docs: update README`

**Examples:**

```bash
# Create a service with description and custom visibility
repo-create.sh service.platform.auth --type service --description "Authentication service" --public

# Create a web app with custom description
repo-create.sh app.web.dashboard --type app-web --description "User dashboard application"

# Interactive mode
repo-create.sh --interactive
```

**Interactive mode:**

- Uses `fzf` to pick a type and shows an example name
- Prompts for repository name
- Prompts for optional description
- Applies all rules above after selection

**Config file:** `tools/config/repo-types.yaml` controls types, templates, naming patterns, rulesets, post-creation scripts, and commit handling.

**Note on rulesets:**
If repository rulesets cannot be applied during creation (e.g., your organization is not on GitHub Pro or the repo is private), use `repo-update-config.sh` later to apply the rulesets to an already-created repository. See the [Internal Scripts](#internal-scripts) section for details.

### `repo-update-all`

Updates all repositories in the `repos/` folder in parallel.

**Usage:**

```bash
repo-update-all [--jobs N]
```

**Options:**

- `--jobs N`: Set the number of parallel jobs (default: 4)

### `repo-get-web-url`

Outputs the GitHub web URL for the current repository.

**Usage:**

```bash
repo-get-web-url
```

## Git Extensions

Enhanced Git commands that extend basic Git functionality with additional features.

### `git graph`

Provides a graphical display of the commit history for the current branch.

```bash
git graph
```

### `git graph-all`

Provides a graphical display of the commit history for all branches.

```bash
git graph-all
```

### `git prune-branches`

Prunes local branches that are no longer needed (merged or deleted on remote).

```bash
git prune-branches
```

### `git repo`

The same as the `repo-get` command, but can be used as a Git subcommand.

```bash
git repo <repository-name>
```

### `git wip` / `git unwip` / `git wip-recover`

Work-in-progress commit management:

- `git-wip`: Stages all changes, creates a `WIP: <message>` commit, pushes it to the remote, and records the commit in `refs/wip/last` for later recovery.
  - `--staged-only`: Skip `git add -A` and commit only what is already staged.
- `git-unwip`: Soft-resets to the last non-WIP commit (restaging your changes) and safely force-pushes to clear the WIP commit from the remote. Does **not** delete `refs/wip/last`, so the WIP commit remains recoverable.
- `git-wip-recover`: Inspect or restore the most recently saved WIP commit from `refs/wip/last`.

```bash
git wip "saving progress"
git wip --staged-only "partial save"
git unwip

# After unwipping, recover if needed:
git wip-recover            # interactive: show summary, prompt to restore
git wip-recover --show     # print commit summary and diff stat
git wip-recover --branch   # check out a new branch 'wip-recovered' at the WIP commit
git wip-recover --branch my-branch  # check out as 'my-branch'
```

**Safety guards in `git-unwip`:**

1. **Protected branches** — refuses to run on `main`, `master`, or `develop`.
2. **Remote WIP check** — only force-pushes if the remote tip is itself a `WIP:` commit; skips the push otherwise.
3. **`--force-with-lease`** — aborts if the remote has new commits that weren't present when you last fetched, preventing accidental overwrites.

**Recovery with `refs/wip/last`:**

Every `git-wip` call updates the `refs/wip/last` ref to point at the new WIP commit. Because this is a named ref (outside `refs/heads/`), git's garbage collector will not collect the commit — the WIP state is preserved indefinitely until the ref is next overwritten by another `git-wip`. `git-unwip` deliberately leaves the ref intact so you can always recover.

**Global pre-commit hook:**

A global `pre-commit` hook (applied via `core.hooksPath` during bootstrap) prevents committing on top of a WIP commit. If `HEAD` or any unpushed commit on the branch is a `WIP:` commit, the commit is blocked with an error message directing you to run `git-unwip` first.

*NOTE*: `git-wip` bypasses hooks (`-n` flag) intentionally — WIP commits are scratch saves, not production-quality commits.

### `git update`

Updates the current repository with interactive options for handling uncommitted changes.

```bash
git update
```

**Features:**

- Interactive prompts for stashing or discarding uncommitted changes
- Automatically switches to default branch
- Pulls latest changes
- Returns to original branch if applicable

## Pull Request Management

Tools for creating, managing, and working with pull requests on GitHub using the `gh` CLI.

### `pr-create-for-review`

Creates a draft pull request for reviewing changes. Useful for code review before final merge.

```bash
pr-create-for-review
```

**Features:**

- Creates draft PRs
- Supports commit range specification
- Automatically formats title and body
- Can add reviewers and assignees

### `pr-create-for-merge`

Creates a pull request for merging code into a target branch (defaults to the repository's default branch).

```bash
pr-create-for-merge <title> --issue <number> [--base <branch>]
```

**Required Options:**

- `<title>`: PR title (should follow Conventional Commits format)
- `--issue <number>`: Issue number this PR addresses, OR use `--no-issue` if not associated with an issue

**Optional Options:**

- `--base <branch>`: Target branch for the PR (default: repository's default branch). Examples: `master`, `main`, `develop`, `release/v1.0`
- `--body <text>`: PR body text
- `--draft`: Create as a draft PR
- `--reviewer <handle>`: Add a reviewer (can be repeated)
- `--assignee <handle>`: Add an assignee (default: @me)
- `--repo-dir <path>`: Repository directory (default: current)

**Examples:**

```bash
# Create PR for merging to default branch
pr-create-for-merge "feat: add new feature" --issue 123

# Create PR targeting a different branch
pr-create-for-merge "fix: critical bug" --issue 456 --base develop

# Create draft PR with reviewer
pr-create-for-merge "docs: update README" --issue 789 --draft --reviewer @john
```

**Features:**

- Validates Conventional Commits format for title
- Supports targeting any branch via `--base` option
- Can add reviewers, assignees, and labels
- Generates PR description from commits

### `pr-get-merge-link`

Gets the GitHub URL for an open pull request on the current branch.

```bash
pr-get-merge-link
```

### `pr-get-review-link`

Gets the GitHub URL for a review pull request.

```bash
pr-get-review-link
```

### `pr-cleanup-review-branches`

Cleans up old review branches that are no longer needed.

```bash
pr-cleanup-review-branches [--days N]
```

**Options:**

- `--days N`: Delete review branches older than N days (default: 7)

### `pr-get`

Retrieves a pull request's details as structured JSON. Useful for scripting,
automation, and feeding PR context to AI agents.

```bash
pr-get PR# [--pretty]
```

**Examples:**

```bash
pr-get 123                              # Structured JSON
pr-get 123 --pretty                     # Pretty-printed
pr-get 123 | jq -r '.title'             # Extract title
pr-get 123 | jq -r '.headRefName'       # Source branch
pr-get 123 | jq -r '.labels[].name'     # Extract labels
```

### `pr-comment`

Adds a top-level conversation comment to a pull request. For inline review
comments, use `gh pr review` directly or the GitHub web UI.

```bash
pr-comment PR# (--body TEXT | --body-file FILE | --edit) [--dry-run]
```

**Comment sources** (exactly one required):

- `--body TEXT`: Inline comment text
- `--body-file FILE`: Read comment from a markdown file
- `--edit`: Open `$EDITOR` to compose

### `pr-diff`

Outputs a unified diff for a PR (via `gh`) or for a local diff between two
refs. Useful for code review and pre-commit workflows.

```bash
pr-diff PR# [--name-only]
pr-diff --base BASE_REF --head HEAD_REF [--name-only]
```

**Examples:**

```bash
pr-diff 123                                       # Full PR diff
pr-diff 123 --name-only                           # Just changed files
pr-diff --base master --head my-feature           # Local ref-to-ref diff
```

### `pr-list`

Lists pull requests with filters. JSON output by default for scripting.

```bash
pr-list [--state open|closed|merged|all] [--author USER] [--label LABEL] \
        [--base BRANCH] [--head BRANCH] [--limit N] [--pretty | --table]
```

**Examples:**

```bash
pr-list                                  # All open PRs (JSON)
pr-list --table                          # Pretty table
pr-list --author @me                     # My open PRs
pr-list --state closed --label bug       # Closed bug PRs
pr-list --base master                    # PRs targeting master
```

### `pr-threads-get`

Fetches inline review threads for a PR via GraphQL, preserving thread structure and parent/reply relationships. The REST API loses this context; this tool is the foundation for the `address-pr-comments` skill.

By default returns only unresolved threads, sorted by file path then line number.

```bash
pr-threads-get PR# [--all] [--pretty]
```

**Output:** JSON array of thread objects, each containing:

- `id` — GraphQL node ID (used by `pr-thread-resolve`)
- `isResolved` — boolean
- `path`, `line`, `startLine`, `diffSide` — comment location
- `comments[]` — each with `id` (numeric, used by `pr-thread-reply`), `author.login`, `body`, `createdAt`, `url`

**Examples:**

```bash
pr-threads-get 123                       # Unresolved threads (JSON)
pr-threads-get 123 --all                 # Include resolved threads
pr-threads-get 123 --pretty              # Pretty-print
pr-threads-get 123 | jq length          # Count unresolved threads
pr-threads-get 123 | jq -r '.[].path' | sort -u   # Files with open comments
pr-threads-get 123 | jq -r '.[0].comments[0].body' # First comment body
```

### `pr-thread-reply`

Posts a reply to an existing inline review comment. This is distinct from `pr-comment` (top-level PR conversation). Requires the numeric comment ID from `pr-threads-get`.

```bash
pr-thread-reply PR# --comment-id COMMENT_ID (--body TEXT | --body-file FILE | --edit) [--dry-run]
```

**Examples:**

```bash
pr-thread-reply 123 --comment-id 456 --body "Done — refactored in the latest commit."
pr-thread-reply 123 --comment-id 456 --body-file reply.md
pr-thread-reply 123 --comment-id 456 --edit          # Opens $EDITOR
pr-thread-reply 123 --comment-id 456 --body "LGTM" --dry-run
```

### `pr-thread-resolve`

Marks a PR review thread as resolved using the GitHub GraphQL `resolveReviewThread` mutation. Takes the GraphQL node ID (starts with `PRRT_`) returned by `pr-threads-get`.

```bash
pr-thread-resolve THREAD_ID [--dry-run]
```

**Examples:**

```bash
pr-thread-resolve PRRT_kwDOAbc123
pr-thread-resolve PRRT_kwDOAbc123 --dry-run

# Resolve all unresolved threads on PR 123 (use with care)
pr-threads-get 123 | jq -r '.[].id' | xargs -I{} pr-thread-resolve {}
```

## Artifact Management

Tools for listing, filtering, and managing artifacts in GitHub Packages.

### `artifacts-list`

Lists and filters artifacts (packages) from GitHub Packages with support for multiple package types and filtering by name.

**Usage:**

```bash
artifacts-list --owner <org> [--type <type>] [--name <pattern>] [--format <format>]
```

**Required Options:**

- `--owner <org>`: Repository owner or organization name (or use `GH_ORG` environment variable)

**Optional Filters:**

- `--type <type>`: Filter by package type. Supported types:
  - `npm` (JavaScript/Node.js packages)
  - `nuget` (C#/.NET packages)
  - `docker` (Container images)
  - `maven` (Java packages)
  - `rubygems` (Ruby packages)
  - `gradle` (Gradle packages)
  - `cargo` (Rust packages)
- `--name <pattern>`: Filter packages by name pattern (partial match, case-insensitive)
- `--repo <repo>`: Query a specific repository (optional)

**Output Options:**

- `--format <format>`: Output format: `table` (default) or `json`
- `--sort <field>`: Sort by field: `name` (default), `type`, `created_at`, or `updated_at`

**Version Listing:**

- `--versions`: List versions for a specific package. Requires `--type` and `--name`

**Examples:**

```bash
# List all npm packages in an organization
artifacts-list --owner myorg --type npm

# List all nuget packages with "service" in the name
artifacts-list --owner myorg --type nuget --name "service"

# List versions for a specific npm package
artifacts-list --owner myorg --type npm --name my-package --versions

# Output as JSON for scripting
artifacts-list --owner myorg --format json | jq '.[] | .name'

# List docker images sorted by creation date
artifacts-list --owner myorg --type docker --sort created_at
```

**Features:**

- Supports multiple package types from GitHub Packages
- Flexible filtering by type and name patterns
- Outputs formatted table with package information (name, type, URL)
- Can list versions for a specific package with publish dates
- JSON output for scripting and automation
- Case-insensitive name filtering for ease of use

**Output Format:**

The table format shows:

- **NAME**: Package name
- **TYPE**: Package type (npm, nuget, docker, etc.)
- **URL**: GitHub Packages URL for the artifact

When listing versions (`--versions`), the table shows:

- **VERSION**: Package version number
- **PUBLISHED**: Publication date and time
- **UPDATED**: Last update date and time

**Library Functions:**

The `artifacts-list` script is built on the `artifact-operations.bash` library, which provides reusable functions for querying packages:

- `query_packages`: Query packages with filtering by type and name
- `get_package_versions`: Get versions for a specific package
- `get_package_type_id`: Normalize package type names
- `is_supported_package_type`: Validate package type support
- `get_supported_package_types`: Get list of supported types

These core functions can be sourced and used in other scripts for artifact-related operations. Output formatting functions are part of the `artifacts-list` script itself since they are specific to that script's display requirements.

## GitHub Actions

Tools for inspecting, triggering, monitoring, and downloading outputs of GitHub Actions workflow runs.

### `actions-status`

Reports the latest GitHub Actions workflow run status across all repos in the org, with optional filtering by repo name and run conclusion.

**Usage:**

```bash
actions-status [OPTIONS]
```

**Options:**

- `-r, --repo REGEX`: Filter repos by name (extended regex, e.g. `'lib\.cs\.'`)
- `-s, --status STATUS`: Filter by conclusion: `success`, `failure`, `cancelled`, `skipped`
- `-w, --workflow NAME`: Filter by exact workflow name
- `--limit N`: Runs per repo to fetch (default: 1 — latest only)
- `--json`: Output as compact JSON
- `--pretty`: Output as pretty-printed JSON

**Examples:**

```bash
# Show latest run status for all repos
actions-status

# Only repos matching a name pattern
actions-status --repo 'lib\.cs\.'

# Only failed runs
actions-status --status failure

# Filter by repo and workflow
actions-status --repo 'services' --workflow CI

# Pipe into jq for further processing
actions-status --json | jq '.[] | select(.conclusion == "failure") | .url'
```

**Notes:**

- Uses `GH_ORG` to enumerate repos (up to 1000). Set `GH_ORG` or use `GITHUB_REPO`.
- Runs per-repo enumeration rather than the `/orgs/{org}/actions/runs` API to avoid requiring the `workflow` token scope.
- With many repos this is sequential; for very large orgs it may be slow.

---

### `actions-list`

Lists GitHub Actions workflow definitions (name, file, state) across org repositories. Shows what workflows *exist*, not their run history.

**Usage:**

```bash
actions-list [OPTIONS]
```

**Options:**

- `-r, --repo REGEX`: Filter repos by name (extended regex)
- `--state STATE`: Workflow state: `active`, `disabled_manually`, `disabled_inactivity`, `all` (default: `active`)
- `--json`: Output as compact JSON
- `--pretty`: Output as pretty-printed JSON

**Examples:**

```bash
# List all active workflows
actions-list

# Workflows for repos matching a pattern
actions-list --repo 'lib\.cs\.services\.'

# Include disabled workflows
actions-list --state all

# JSON output piped to jq
actions-list --json | jq '.[] | select(.state != "active")'
```

---

### `actions-run`

Triggers a `workflow_dispatch` event on a GitHub repository and reports the resulting run URL.

**Usage:**

```bash
actions-run WORKFLOW --repo OWNER/REPO [OPTIONS]
```

**Arguments:**

- `WORKFLOW`: Workflow file name (e.g. `ci.yml`) or display name

**Options:**

- `--repo OWNER/REPO`: Repository to run the workflow in (required)
- `--ref REF`: Branch or tag to run on (default: repo default branch)
- `--input KEY=VALUE`: Workflow dispatch input (repeatable)

**Examples:**

```bash
# Trigger CI on the default branch
actions-run ci.yml --repo workinprogress-ai/my-service

# Run on a specific branch
actions-run ci.yml --repo workinprogress-ai/my-service --ref feature/my-branch

# Pass workflow_dispatch inputs
actions-run deploy.yml --repo workinprogress-ai/my-service \
    --input environment=staging \
    --input version=1.2.3
```

**Notes:**

- `gh workflow run` does not return a run ID. The run URL is retrieved by polling `gh run list` after a ~2s delay — it may occasionally miss the run URL if the system is very busy.
- The workflow must be configured with a `workflow_dispatch` trigger.

---

### `actions-rerun`

Re-runs a GitHub Actions workflow run, with options to re-run only failed jobs or enable debug logging.

**Usage:**

```bash
actions-rerun RUN_ID --repo OWNER/REPO [OPTIONS]
```

**Arguments:**

- `RUN_ID`: The workflow run ID to re-run

**Options:**

- `--repo OWNER/REPO`: Repository containing the run (required)
- `--failed`: Re-run only failed jobs (not the whole workflow)
- `--debug`: Enable debug logging for the re-run

**Examples:**

```bash
# Re-run the full workflow
actions-rerun 12345678 --repo workinprogress-ai/my-service

# Re-run only failed jobs
actions-rerun 12345678 --repo workinprogress-ai/my-service --failed

# Re-run with debug output enabled
actions-rerun 12345678 --repo workinprogress-ai/my-service --debug
```

---

### `actions-watch`

Streams live output from a running GitHub Actions workflow run. If no `RUN_ID` is given, auto-detects the latest in-progress run in the repo.

**Usage:**

```bash
actions-watch [RUN_ID] --repo OWNER/REPO [OPTIONS]
```

**Arguments:**

- `RUN_ID`: Workflow run ID to watch (optional — auto-detects if omitted)

**Options:**

- `--repo OWNER/REPO`: Repository containing the run (required)
- `--exit-status`: Exit non-zero if the watched run fails (useful in CI pipelines)

**Examples:**

```bash
# Watch the latest in-progress run
actions-watch --repo workinprogress-ai/my-service

# Watch a specific run
actions-watch 12345678 --repo workinprogress-ai/my-service

# Exit with the run's exit code (for CI use)
actions-watch 12345678 --repo workinprogress-ai/my-service --exit-status
```

---

### `actions-artifacts`

Lists or downloads artifacts from a completed GitHub Actions workflow run. Default mode is list (no files are downloaded).

**Usage:**

```bash
actions-artifacts RUN_ID --repo OWNER/REPO [OPTIONS]
```

**Arguments:**

- `RUN_ID`: Workflow run ID

**Options:**

- `--repo OWNER/REPO`: Repository containing the run (required)
- `--json`: Output artifact list as compact JSON
- `--pretty`: Output artifact list as pretty-printed JSON
- `--download`: Download artifacts instead of just listing
- `--name NAME`: Specific artifact name to download (use with `--download`)
- `--dir DIR`: Download destination directory (default: `.`)

**Examples:**

```bash
# List artifacts for a run
actions-artifacts 12345678 --repo workinprogress-ai/my-service

# List as JSON and pipe to jq
actions-artifacts 12345678 --repo workinprogress-ai/my-service --json | jq '.[].name'

# Download all artifacts
actions-artifacts 12345678 --repo workinprogress-ai/my-service --download

# Download a specific artifact to a directory
actions-artifacts 12345678 --repo workinprogress-ai/my-service \
    --download --name coverage-report --dir /tmp/artifacts
```

**Notes:**

- List mode uses the GitHub REST API (`/actions/runs/{id}/artifacts`) to show metadata without downloading.
- When downloading all artifacts (no `--name`), warns if total size exceeds 100 MiB.

---

## GitHub Issues and Project Management

Tools for managing GitHub Issues, Projects, and Sprint/Milestone workflows.

### `issue-create`

Creates a new GitHub issue with labels, assignees, and project assignment. Supports interactive template selection and editing.

```bash
issue-create --title "Issue title" [OPTIONS]
```

**Options:**

- `--title TITLE`: Issue title (required)
- `--body TEXT`: Issue body/description
- `--body-file FILE`: Read body from markdown file
- `--type TYPE`: Issue type (epic, story, or bug) - adds `type:TYPE` label
- `--label LABEL`: Add additional labels (repeatable)
- `--assignee USER`: Assign to user (repeatable)
- `--milestone NAME`: Assign to milestone/sprint
- `--project NAME`: Add to project
- `--parent ISSUE_NUM`: Link to parent issue (for epics)
- `--template FILE`: Use specific template file (opens in editor)
- `--no-template`: Skip template selection (don't use any template)
- `--no-interactive`: Use template without opening editor (for scripting)
- `--devenv`: Safety override to allow creating issues in devenv repo itself
**Template Workflow:**

By default, `issue-create` discovers templates in `.github/ISSUE_TEMPLATE/` and lets you select one with fzf:

1. Script shows interactive template selection with preview
2. Selected template is copied to a temporary file
3. Template opens in your `$EDITOR` (defaults to `nano`)
4. You can customize the template content
5. When you save and close the editor, the edited content becomes the issue body

**Examples:**

```bash
# Interactive mode (select template with fzf, edit in $EDITOR)
issue-create --title "Login button not working" --type bug

# Use specific template without interactive selection
issue-create --title "User Authentication" --type epic \
    --template .github/ISSUE_TEMPLATE/epic_template.md

# Use template without opening editor (for automation)
issue-create --title "OAuth2 Integration" --type story \
    --template .github/ISSUE_TEMPLATE/story_template.md --no-interactive

# Create without any template
issue-create --title "Quick bug" --type bug --no-template \
    --body "Something is broken"

# Create story under an epic with template
issue-create --title "OAuth2 Integration" --type story \
    --parent 123 --project "Q1 2026" --milestone "Sprint 5"
```

**Safety Features:**

By default, `issue-create` prevents accidental creation of issues in the devenv repository itself. Issues should be created in your target project repositories.

If you need to create an issue in devenv, pass the `--devenv` flag:

```bash
issue-create --devenv --title "Internal issue" --type bug
```

### `issue-list`

Lists and filters GitHub issues.

```bash
issue-list [OPTIONS]
```

**Options:**

- `--state STATE`: Filter by state (open, closed, all) - default: open
- `--type TYPE`: Filter by type (epic, story, bug)
- `--label LABEL`: Filter by label (repeatable)
- `--assignee USER`: Filter by assignee (use "none" for unassigned)
- `--milestone NAME`: Filter by milestone
- `--format FORMAT`: Output format (table, json, simple)
- `--limit N`: Limit results (default: 30)
- `--web`: Open in browser

**Examples:**

```bash
# List all open bugs
issue-list --type bug

# List issues in current sprint
issue-list --milestone "Sprint 5"

# List unassigned high-priority items
issue-list --assignee none --label "priority:high"

# Get JSON for scripting
issue-list --format json --limit 100
```

### `issue-update`

Updates issue fields (title, body, labels, assignees, milestone, state).

```bash
issue-update ISSUE_NUMBER [OPTIONS]
```

**Options:**

- `--title TITLE`: Update title
- `--body TEXT`: Update body
- `--body-file FILE`: Read new body from file
- `--add-label LABEL`: Add label (repeatable)
- `--remove-label LABEL`: Remove label (repeatable)
- `--add-assignee USER`: Add assignee (repeatable)
- `--remove-assignee USER`: Remove assignee (repeatable)
- `--milestone NAME`: Set milestone
- `--state STATE`: Set state (open or closed)

**Examples:**

```bash
# Update title
issue-update 123 --title "New title"

# Add labels and assignee
issue-update 123 --add-label "priority:high" --add-assignee "john"

# Change milestone
issue-update 123 --milestone "Sprint 6"
```

### `issue-close`

Closes or reopens issues with optional comment and reason.

```bash
issue-close [ACTION] ISSUE_NUMBER... [OPTIONS]
```

**Actions:**

- `close` - Close issue(s) (default)
- `reopen` - Reopen issue(s)

**Options:**

- `--comment TEXT`: Add comment when closing/reopening
- `--reason REASON`: Close reason (completed or "not planned")

**Examples:**

```bash
# Close single issue
issue-close 123

# Close multiple issues
issue-close 123 124 125

# Close with comment
issue-close 123 --comment "Fixed in PR #456"

# Close as not planned
issue-close 123 --reason "not planned"

# Reopen issue
issue-close reopen 123
```

### `issue-select`

Interactive issue selection using fzf with preview.

```bash
issue-select [OPTIONS]
```

**Options:**

- `--state STATE`: Filter by state
- `--type TYPE`: Filter by type
- `--milestone NAME`: Filter by milestone
- `--label LABEL`: Filter by label
- `--multi`: Enable multi-select (use TAB)
- `--format FORMAT`: Output format (number, url, json)

**Examples:**

```bash
# Select an issue interactively
issue_num=$(issue-select --type story)

# Multi-select to bulk assign
for issue in $(issue-select --multi); do
    gh issue edit "$issue" --add-assignee "@me"
done
```

### `issue-groom`

Interactive issue grooming wizard for backlog management.

```bash
issue-groom [OPTIONS]
```

**Options:**

- `--project NAME`: Filter by project
- `--milestone NAME`: Filter by milestone

**Features:**

- Review issue details
- Set type (epic/story/bug)
- Edit title and description
- Set milestone (sprint)
- Add assignees and labels
- Link to parent issues
- Mark as Ready for implementation

**Workflow States:**

- **TBD**: Newly created, needs refinement
- **To Groom**: Ready for grooming session
- **Ready**: Groomed and ready for implementation

### `project-add`

Adds issues to GitHub Projects (v2).

```bash
project-add PROJECT_NAME ISSUE_NUMBER... [OPTIONS]
```

**Options:**

- `--field NAME=VALUE`: Set project field (repeatable)

**Examples:**

```bash
# Add issue to project
project-add "Q1 2026" 123

# Add multiple issues
project-add "Sprint 5" 123 124 125

# Add with field values
project-add "Q1 2026" 123 --field "Status=Ready" --field "Priority=High"
```

**Note:** The issue must exist before adding to a project.

### `project-update`

Updates issue field values in GitHub Projects (v2).

```bash
project-update PROJECT_NAME ISSUE_NUMBER [OPTIONS]
```

**Options:**

- `--status STATUS`: Set Status field (TBD, To Groom, Ready, Implementing, Review, Merged, Staging, Production)
- `--field NAME=VALUE`: Set custom field (repeatable)
- `--list-fields`: List available fields in project

**Status Workflow:**

1. **TBD** - Not ready for grooming
2. **To Groom** - Can be groomed
3. **Ready** - Groomed, ready to implement
4. **Implementing** - Active development
5. **Review** - In pull request
6. **Merged** - Merged to main, awaiting deployment
7. **Staging** - Deployed to staging
8. **Production** - Deployed to production (issue closed)

**Examples:**

```bash
# Move issue to Ready
project-update "Q1 2026" 123 --status "Ready"

# Track progress through workflow
project-update "Sprint 5" 123 --status "Implementing"
project-update "Sprint 5" 123 --status "Review"
project-update "Sprint 5" 123 --status "Merged"

# Set custom fields
project-update "Q1 2026" 123 --field "Priority=High"
```

**Note:** Project field updates currently provide instructions for manual updates or require GraphQL API implementation.

## Container Management

Tools for managing Docker containers and services.

### `dependencies-up`

Starts up dependency services (databases, message queues, etc.) using Docker Compose.

```bash
dependencies-up
```

### `dependencies-down`

Stops dependency services and cleans up resources.

```bash
dependencies-down
```

### `docker-restart`

Restarts the Docker daemon by killing it and reloading it. Useful when Docker becomes unresponsive or needs to be refreshed.

```bash
docker-restart
```

**What it does:**

1. Kills the Docker daemon using `sudo pkill docker`
2. Reloads Docker using `.devcontainer/load-docker.sh`

### `container-enable-dotnet-debugger.sh`

Injects and runs the .NET debugger into a locally running container for debugging purposes.

```bash
container-enable-dotnet-debugger.sh <container-name>
```

### `server-run-sql`

Starts a SQL Server container for local development (uses Azure SQL Edge for ARM compatibility).

```bash
server-run-sql
```

**Credentials:**

- Username: `SA`
- Password: `1Passw0rd`
- Default database: `test` (auto-created)

### `server-run-smb`

Starts an SMB/Samba server container for file sharing during development.

```bash
server-run-smb
```

**Credentials:**

- Username: `devenv`
- Password: `devenv123`
- Share: `Data`

## Database Management

Tools for managing databases, backups, and data operations.

### `mongo-backup-server`

Creates a backup of MongoDB server data.

```bash
mongo-backup-server <connection-string> <backup-directory>
```

**Features:**

- Backs up each non-built-in database individually
- Creates timestamped backup directories
- Skips admin, local, and config databases

### `mongo-restore-server`

Restores MongoDB server data from a backup.

```bash
mongo-restore-server <connection-string> <backup-directory>
```

**Features:**

- Automatically uses the latest backup if multiple exist
- Drops existing collections before restore
- Validates backup directory exists

## Build and Development Tools

Tools for building, versioning, and managing development workflows.

### `editor`

Opens a file in VS Code (blocking with `--wait`) with automatic fallback to a preferred editor when VS Code is unavailable.

```bash
editor <file> [file ...]
```

**Features:**

- Primary: Opens files in VS Code and **waits** until the file/tab is closed before returning
- Fallback chain: Uses `$PREF_EDITOR`, then `$FALLBACK_EDITOR` (default: `nano`) if VS Code fails or is unavailable
- Supports multiple files (each blocks until closed)
- Used as system `$EDITOR` and `$VISUAL` for git, gh, and other CLI tools

**Configuration:**

- `FALLBACK_EDITOR` - Fallback editor when VS Code is unavailable (default: `nano`)
- `PREF_EDITOR` - Preferred editor over fallback (defaults to `FALLBACK_EDITOR`)
- `EDITOR` - Usually set to `$DEVENV_TOOLS/editor` by bootstrap
- `VISUAL` - Usually set to `$DEVENV_TOOLS/editor` by bootstrap

**Examples:**

```bash
# Open file directly
editor /tmp/notes.txt

# Used automatically by git
git commit --allow-empty  # Opens in VS Code, waits until tab closes

# Used automatically by gh CLI
gh issue create --body ''  # Opens in VS Code, waits until tab closes

# Configure fallback
export FALLBACK_EDITOR=vim
editor somefile.sh  # Uses vim if VS Code fails
```

### `tooling-create-script`

Creates a new script from the standard template with error handling, versioning, and cleanup.

```bash
tooling-create-script <script-name>
```

**Features:**

- Uses `$DEVENV_TOOLS/templates/script-template.sh` as base
- Automatically makes script executable
- Includes error handling, cleanup traps, and library sourcing

### `lint-scripts`

Validates all shell scripts using shellcheck.

```bash
lint-scripts [--format <format>] [--fix]
```

**Options:**

- `--format`: Output format (tty, json, checkstyle, diff, gcc, quiet)
- `--fix`: Attempt to automatically fix issues (experimental)

**Features:**

- Scans all `.sh` files in scripts/ and lib/
- Provides statistics and summary
- Integrates with CI/CD pipelines

### `repo-version-list`

Lists all version tags in the current repository with colorized output.

```bash
repo-version-list
```

### `metrics-count-code-lines`

Counts lines of code in files or directories, with filtering options.

```bash
metrics-count-code-lines [file-or-directory]
```

### `cs-nuget-clear-local`

Clears local NuGet package cache for packages in the local debug feed.

```bash
cs-nuget-clear-local
```

**Features:**

- Clears `~/.nuget/packages` cache for local packages
- Removes all packages from `.debug/local-nuget-dev`
- Provides warnings if cleanup fails

### `cs-nuget-publish-local`

Publishes a NuGet package to local feed.

```bash
cs-nuget-publish-local [target-directory] [version] [configuration]
```

**Arguments:**

- `target-directory`: Directory containing .csproj files (default: current directory)
- `version`: Package version (default: calculated from git)
- `configuration`: Build configuration (default: Debug)

**Features:**

- Builds all .csproj files except test projects
- Includes symbols and source
- Clears cache after publishing
- Uses temporary directory for build artifacts

### `cs-open-coverage`

Open coverage reports in a browser (auto-detects chromium or firefox).

```bash
cs-open-coverage
```

## C# Dependency Management

Tools for tracing, updating, and propagating NuGet package changes across C# repositories.

### `repo-cache-update`

Refreshes the local repository cache (shallow-clones or updates all organization repositories) and rebuilds the dependency index. Prints the cache directory path on stdout.

**Usage:**

```bash
repo-cache-update [OPTIONS]
```

**Options:**

- `--no-refresh`: Skip refreshing the repository cache (rebuild index only)
- `-h, --help`: Show help and exit
- `-v, --version`: Show version and exit

**Output:** The absolute path to the cache directory (e.g. `$DEVENV_TOOLS/cache/repo_cache`).

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0`  | Success — cache directory path printed on stdout |
| `1`  | General error (missing credentials, clone failed, index build failed) |
| `2`  | Partial failure — some repos failed to cache, index still built |

**Examples:**

```bash
# Refresh everything and print the cache path
repo-cache-update

# Capture the path for use in another script
CACHE=$(repo-cache-update)

# Rebuild the index without re-cloning (cache already fresh)
repo-cache-update --no-refresh
```

**Related:** `cs-dependencies-trace`, `cs-dependencies-update-wizard` (both use this cache internally via `--no-refresh`)

### `cs-dependencies-trace`

Traces the reverse dependency tree for a C# repository — shows all repositories that depend on it, directly or transitively.

**Usage:**

```bash
cs-dependencies-trace [OPTIONS] [TARGET_DIR]
```

**Arguments:**

- `TARGET_DIR`: Path to a directory containing `.sln` or `.csproj` files. Defaults to the current directory.

**Options:**

- `--by-repo`: Collapse output to one line per dependent repo (omitting package detail)
- `--no-refresh`: Skip refreshing the repository cache
- `-h, --help`: Show help and exit
- `-v, --version`: Show version and exit

**Output format (default):**

```text
DEPTH:REPO:PACKAGE
```

For example: `0:lib.cs.services.chassis:WorkInProgress.Lib.Services.Chassis.Common`

**Output format (--by-repo):**

```text
DEPTH:REPO
```

**Examples:**

```bash
# Show all dependents of the essentials library
cd repos/lib.cs.common.essentials
cs-dependencies-trace

# Show only direct dependents, collapsed by repo
cs-dependencies-trace --by-repo | grep '^0:'
```

### `cs-references-update-wizard`

Runs the full NuGet dependency-update workflow for a **single** repository interactively. Useful for updating one repository without walking the entire dependency tree.

**Usage:**

```bash
cs-references-update-wizard [OPTIONS] [REPO_DIR]
```

**Arguments:**

- `REPO_DIR`: Path to the repository to update. Defaults to the current directory.

**Options:**

- `--branch NAME`: Branch to create for the update (default: `auto-update-references`)
- `--dry-run`: Show what would happen without making any changes
- `-h, --help`: Show help and exit
- `-v, --version`: Show version and exit

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0`  | Repository was updated (PR created and merged) |
| `10` | No-op — nothing changed after running `cs-references-update` |
| `20` | git operation failed (branch creation, commit, or push) |
| `21` | `cs-references-update` failed |
| `30` | Tests still failing after user had a chance to fix |
| `40` | PR could not be created |
| `41` | PR could not be merged |
| `1`–`5` | Argument / environment error (from `error-handling.bash`) |

**Workflow:**

1. Create branch (`auto-update-references` by default)
2. Run `cs-references-update` to update all NuGet packages
3. Detect major version bumps in non-test `.csproj` files
4. If nothing changed, clean up and exit with code `10`
5. Commit and push the branch
6. Run `./run-tests` if present — pause for the user to fix failures
7. If major bumps or test failures are detected, prompt the user to confirm the change level (`patch` or `major`)
8. Create a PR with the selected prefix (`patch:` or `major:`)
9. Merge the PR
10. Return to the default branch and clean up the local branch

**Examples:**

```bash
# Update a specific repository
cs-references-update-wizard ~/repos/lib.cs.services.chassis

# Dry run to see what would change
cs-references-update-wizard --dry-run

# Use a custom branch name
cs-references-update-wizard --branch deps/update-q2-2026
```

### `cs-dependencies-update-wizard`

Interactive wizard that updates C# NuGet dependencies across repositories. Supports two modes:

- **Single-target mode** (default): walks the reverse dependency tree of a specific library and updates every dependent repo in BFS order.
- **Global mode** (`--global`): computes a full topological ordering of *all* C# repos in the cache and updates them generation by generation — from foundational libraries up through services. Every repo gets `cs-references-update` run against it, including external package updates.

**Usage:**

```bash
# Single-target mode
cs-dependencies-update-wizard [OPTIONS] TARGET_DIR

# Global mode
cs-dependencies-update-wizard [OPTIONS] --global [N]
```

**Arguments:**

- `TARGET_DIR` *(single-target)*: Path to the released library. Must contain `.sln` or `.csproj` files. Defaults to the current directory.
- `N` *(global)*: Optional starting generation number (default: `0`). Use this to resume a run that was interrupted — pass the generation number shown in the output.

**Options:**

- `--global [N]`: Global mode — update all C# repos in topological order, optionally starting from generation `N`
- `--no-refresh`: Skip refreshing the repository cache
- `--dry-run`: Show what would be updated without making any changes
- `-h, --help`: Show help and exit
- `-v, --version`: Show version and exit

**Workflow (single-target):**

For each depth level (0 = direct dependents, 1 = transitive dependents, …):

1. Check whether each dependent repo already uses the latest published version — skip if so
2. Call `cs-references-update-wizard` for each repo that needs updating
3. If a repo fails, pause and prompt the user to fix it before continuing
4. After the level is complete, wait for GitHub Actions, refresh the cache, and advance

**Workflow (--global):**

Generation 0 contains repos with no org-internal dependencies. Generation N contains repos whose org-internal dependencies are all in generations < N.

For each generation:

1. Run `cs-references-update-wizard` for every repo (exit 10 = no changes → skipped silently)
2. If a repo fails, pause and prompt the user to fix it before continuing with the generation
3. After the generation is complete, wait for GitHub Actions, refresh the cache, and advance

**Resuming an interrupted global run:**

The generation number is printed in the output header. To resume from where you left off:

```bash
cs-dependencies-update-wizard --global 3   # restart from generation 3
```

**Examples:**

```bash
# Single-target: run after releasing lib.cs.common.essentials
cd repos/lib.cs.common.essentials
cs-dependencies-update-wizard

# Global: update every C# repo from scratch
cs-dependencies-update-wizard --global

# Global: resume from generation 4 after a previous run was interrupted
cs-dependencies-update-wizard --global 4

# Dry run — show which repos would be updated at each generation
cs-dependencies-update-wizard --global --dry-run

# Skip initial cache refresh (useful when cache is already fresh)
cs-dependencies-update-wizard --no-refresh
```

**Related:** `cs-references-update-wizard` (single-repo workflow), `cs-dependencies-trace` (view the dependency tree without making changes)

## Desktop Environment

Tools for managing the Fluxbox desktop application menu inside the dev container's graphical environment. The desktop is accessible via VNC — see [Dev-container-environment.md](./Dev-container-environment.md) for connection details.

### `devenv-desktop-menu-add-shortcut`

Adds a shortcut (exec entry) to the Fluxbox desktop application menu. If a shortcut with the same label already exists the command exits silently (idempotent).

**Usage:**

```bash
devenv-desktop-menu-add-shortcut <label> <command> [folder]
```

**Arguments:**

- `<label>`: Display label shown in the menu
- `<command>`: Shell command to run when the item is selected
- `[folder]`: Optional — name of an existing folder to add the shortcut into. Create the folder first with `devenv-desktop-menu-add-folder`.

**Examples:**

```bash
# Add a top-level shortcut
devenv-desktop-menu-add-shortcut "MongoDB Compass" "mongodb-compass"

# Add a shortcut inside an existing folder
devenv-desktop-menu-add-shortcut "Compass" "mongodb-compass" "Databases"
```

**Notes:**

- New shortcuts are placed immediately before the `[config]` or `[workspaces]` block (or the closing `[end]`) so Fluxbox built-in items remain at the bottom.
- The `FLUXBOX_MENU` environment variable can override the menu file path (default: `~/.fluxbox/menu`).

### `devenv-desktop-menu-add-folder`

Adds a folder (submenu block) to the Fluxbox desktop application menu. If a folder with the same name already exists the command exits silently (idempotent).

**Usage:**

```bash
devenv-desktop-menu-add-folder <folder-name> [parent-folder]
```

**Arguments:**

- `<folder-name>`: Display name for the new folder
- `[parent-folder]`: Optional — name of an existing folder to nest this one inside.

**Examples:**

```bash
# Create a top-level folder
devenv-desktop-menu-add-folder "Databases"

# Create a nested folder
devenv-desktop-menu-add-folder "MongoDB" "Databases"
```

**Notes:**

- Like shortcuts, new folders are placed before `[config]`/`[workspaces]`/root `[end]`.
- The folder must exist before shortcuts can be added into it.

**Typical workflow:**

```bash
# 1. Create the folder
devenv-desktop-menu-add-folder "Databases"

# 2. Add shortcuts into it
devenv-desktop-menu-add-shortcut "MongoDB Compass" "mongodb-compass" "Databases"
devenv-desktop-menu-add-shortcut "pgAdmin" "pgadmin4" "Databases"
```

## Networking and Utilities

Tools for managing network connections and performing utility functions.

### `get-public-ip`

Gets the current public IP address of the machine.

```bash
get-public-ip
```

## Configuration Management

### `install-extras`

Interactive menu to install optional tools from `.devcontainer/install-extras/`.

```bash
install-extras [OPTIONS] [FILTER]
```

**Options:**

- `-m, --multi` - Multi-select mode (install several extras at once)
- `--dir PATH` - Override the extras directory (default: `.devcontainer/install-extras/`)
- `FILTER` - Filter extras by name; auto-runs if only one match

**Features:**

- Interactive fzf menu with preview (using `bat` if available)
- Single or multi-select installation
- Filter by name for quick access
- Executes scripts in order with error handling

**Examples:**

```bash
# Interactive menu (single selection)
install-extras

# Multi-select mode
install-extras -m

# Auto-install by filter (runs immediately if unique match)
install-extras helm
install-extras tailscale

# Filter list (shows interactive menu if multiple matches)
install-extras mongo
```

**Available Extras:**

- `dns-hijack.sh` - DNS split horizon setup with dnsmasq
- `helm.sh` - Helm package manager for Kubernetes
- `minikube.sh` - Minikube for local Kubernetes
- `mongo-tools.sh` - MongoDB CLI tools
- `mongo-compass.sh` - MongoDB Compass GUI
- `chromium.sh`, `firefox.sh` - Web browsers
- `flatpak.sh` - Flatpak package manager
- `zsh.sh` - zsh with devenv bash configuration
- `tailscale.sh` - Tailscale VPN with SOCKS5 proxy
- `doctl.sh` - DigitalOcean CLI tool

#### DNS Hijack Setup

The `dns-hijack.sh` script configures split-horizon DNS using dnsmasq, allowing you to route specific domains to different DNS servers (useful for routing internal domains to VPN or local servers).

**Configuration File:** `.devcontainer/install-extras/config/dns-mapping.cfg`

The script requires a configuration file containing domain-to-server mappings. Each line should follow the dnsmasq server directive format:

```bash
server=/domain.name/IP_ADDRESS
```

**Example Configuration:**

```bash
# Route internal domains to corporate DNS
server=/company.local/192.168.1.201
server=/company.net/192.168.1.201

# Route Azure resources to Azure DNS
server=/company.azure/10.210.2.5
```

**Installation:**

```bash
install-extras dns-hijack
```

**Setup Steps:**

1. Ensure the config file exists at `.devcontainer/install-extras/config/dns-mapping.cfg`
2. Run `install-extras dns-hijack` to install and configure dnsmasq
3. The script will fail with a helpful error if the config file is missing

**Features:**

- Automatic dnsmasq installation and configuration
- Split-horizon DNS routing (specific domains to specific servers)
- Strict ordering to prioritize mapped domains
- Upstream DNS fallback for unmapped domains
- Configuration validation before installation

### `devenv-update`

Updates the devenv repository to the latest version from GitHub.

```bash
devenv-update
```

### `devenv-add-env-vars`

Adds or updates environment variables in `env-vars.sh`.

```bash
devenv-add-env-vars "VAR1=value1" "VAR2=value2" ...
```

**Features:**

- Validates environment variable format (uppercase with underscores)
- Updates existing variables (removes old values to prevent duplicates)
- Appends new variables to the file
- Provides clear logging of added/updated variables

**Example:**

```bash
devenv-add-env-vars "MY_API_KEY=abc123" "DEBUG_MODE=true"
```

**Note:** Restart your container or source the env-vars.sh file to apply changes.

### `devenv-add-custom-bootstrap`

Adds custom commands to `.devcontainer/user-custom-bootstrap.sh` that run whenever the devcontainer is created or the bootstrap sequence executes. These are user-level customizations that are not committed to the repository.

```bash
devenv-add-custom-bootstrap "command1" "command2" ...
```

**Features:**

- Validates bash syntax before adding commands
- Creates `user-custom-bootstrap.sh` if it doesn't exist
- Sets executable permissions automatically
- Adds documentation comments for each command

**Example:**

```bash
devenv-add-custom-bootstrap "echo 'Personal bootstrap step'" "apt-get update"
```

**Note:** For organization-wide bootstrap customizations, create `.devcontainer/org-custom-bootstrap.sh` and commit it to the repository.

### `devenv-add-custom-startup`

Adds custom commands to `.devcontainer/user-custom-startup.sh` that will run each time VS Code starts. These are user-level customizations that are not committed to the repository.

```bash
devenv-add-custom-startup "command1" "command2" ...
```

**Features:**

- Validates bash syntax before adding commands
- Creates `user-custom-startup.sh` if it doesn't exist
- Sets executable permissions automatically
- Adds documentation comments for each command

**Example:**

```bash
devenv-add-custom-startup "echo 'Container started'" "export MY_VAR=value"
```

**Note:** For organization-wide startup customizations, create `.devcontainer/org-custom-startup.sh` and commit it to the repository.

### `key-update-github`

Updates the GitHub personal access token stored in `.setup/github_token.txt`.

```bash
key-update-github [new-token]
```

**Interactive mode:** If no token is provided, prompts for input.

### `key-update-tailscale`

Updates the Tailscale auth key and re-authenticates the daemon without requiring a container restart.

```bash
key-update-tailscale
# Or use the bash function:
key-update-tailscale
```

**Features:**

- Prompts for new reusable auth key (input is hidden)
- Validates key format (must start with `tskey-`)
- Updates `TS_AUTHKEY` in `.runtime/env-vars.sh`
- Re-authenticates the Tailscale daemon immediately
- Sources the updated environment variables in the current shell

**When to use:**

- Your reusable auth key has expired (typically after 90 days)
- You need to switch to a different Tailscale network or organization
- Admin has rotated the team's auth key

**Note:** This script preserves your container's hostname and route settings during re-authentication.

### `key-update-do`

Updates the Digital Ocean API token and reloads the environment.

```bash
key-update-do [new-token]
```

**Interactive mode:** If no token is provided, prompts for input (hidden).

**Features:**

- Accepts token as command-line argument or interactive prompt
- Validates token format and length
- Stores token persistently in `.setup/do_token.txt` with secure permissions
- Updates `DO_TOKEN` environment variable
- Reloads environment variables in the current shell

**When to use:**

- Your Digital Ocean API token has been rotated
- You need to switch to a different Digital Ocean account or organization
- Updating token after regeneration for security reasons

**Note:** No container restart required after updating the token.

Or manually update the token file:

```bash
echo "your_new_token_here" > .setup/digitalocean_token.txt
```

The token is automatically loaded into the `DO_API_TOKEN` environment variable in the dev container, making it available to infrastructure and deployment scripts like `terraform-plan.sh` and `doctl` commands.

### `get-services-config`

Pulls service configuration from its repository into the local development environment.

```bash
get-services-config
```

The configuration is placed in `~/.debug/config`.

## Configuration Files

### `docker-compose-dependencies.yml`

Docker Compose configuration file for running development dependencies (databases, message queues, etc.).

## Internal Scripts

Internal utility scripts located in `tools/scripts/` that are not exposed on the global `PATH`. These scripts are designed to support other tools and workflows but may also be run directly when specialized configuration management is needed.

### `repo-update-config.sh`

Applies or updates GitHub repository configuration to an existing cloned repository. This is useful when configuration could not be applied during initial repository creation due to account limitations (e.g., GitHub Pro requirement for private repos) or if the configuration has changed and needs to be reapplied.

**Usage:**

```bash
tools/scripts/repo-update-config.sh <repo-path> [--type <type>]
```

**Arguments:**

- `<repo-path>`: Path to the cloned repository directory

**Options:**

- `--type <type>`: Repository type (optional; will be auto-detected from GitHub if not specified)

**Description:**
This script reads the repository type from either the command-line argument or by querying GitHub for repository topics. It then applies the standardized configuration for that type, including:

- **GitHub rulesets** - Branch protection rules (requires GitHub Pro or public repository)
- **Merge types** - Allowed merge strategies (merge, squash, rebase) per type
- **Template setting** - Marks template repositories for "Use this template" button
- **PR branch deletion** - Automatic deletion of PR branches after merge
- **Repository features** - Wiki, Issues, Discussions, Projects, Auto-merge, Update branch, Forking, and squash PR title settings
- **Repository permissions** - Team and user access with specific permission levels

**Use cases:**

- Applying configuration after upgrading to GitHub Pro
- Configuring repositories created before configuration support was available
- Manually updating repository settings without recreating the repository
- Bulk applying settings to multiple repositories via scripting

**Examples:**

```bash
# Auto-detect type from GitHub repository topics
tools/scripts/repo-update-config.sh ~/repos/my-service

# Explicitly specify repository type
tools/scripts/repo-update-config.sh ~/repos/my-docs --type documentation
```

**Configuration per type:**
Each repository type defines its configuration in `tools/config/repo-types.yaml`:

- `allowedMergeTypes` - Which merge strategies are permitted
- `rulesetConfigFile` - Path to GitHub ruleset JSON (null = skip)
- `isTemplate` - Whether to mark as a template repository
- `deletePRBranchOnMerge` - Whether to delete PR branches after merge (true/false)
- `hasWiki` - Enable/disable Wiki feature (default: false, true for documentation)
- `hasIssues` - Enable/disable Issues tab (default: true, false for templates)
- `hasDiscussions` - Enable GitHub Discussions (default: false)
- `hasProjects` - Enable Projects tab visibility (default: false) — Controls tab in repo; issues can be added to projects regardless
- `allowAutoMerge` - Allow auto-merge on PRs for automation (default: true)
- `allowUpdateBranch` - Show "Update branch" button on PRs (default: true)
- `allowForking` - Allow others to fork the repository (default: true for templates, false otherwise)
- `squashMergeCommitTitle` - Squash commit title format: PR_TITLE or COMMIT_OR_PR_TITLE (default: PR_TITLE)
- `squashMergeCommitMessage` - Squash commit message body: PR_BODY, COMMIT_MESSAGES, or BLANK (default: COMMIT_MESSAGES)
- `access` - List of teams or users with their permission levels (optional, no default)
  - Each entry contains:
    - `name`: Team or user name (GitHub team slug or username)
    - `type`: `team` or `user` (default: team)
    - `permission`: GitHub repository permission level:
      - `pull` (Read) - Can pull/clone, open issues, and comment
      - `triage` (Triage) - Can manage issues/PRs without write access
      - `push` (Write) - Can push, create branches, and manage issues/PRs
      - `maintain` (Maintain) - Push + manage releases and some settings
      - `admin` (Admin) - Full access including settings, webhooks, and team management

**Example access configuration in repo-types.yaml:**

```yaml
service:
  # ... other settings ...
  access:
    - name: Engineering
      type: team
      permission: push
    - name: DevOps
      type: team
      permission: admin
    - name: john-doe
      type: user
      permission: pull
```

**Dependencies:**

- `repo-types.bash` (shared library)
- GitHub CLI (`gh`)
- `yq` (YAML processor)

**Related:** See [repo-create](#repo-create) for initial repository creation details, and [Repo Creation Standards (repo-create.sh)](./Devenv-Customization.md#repo-creation-standards-repo-createsh) in the Devenv-Customization docs for configuration options.

## Shared Libraries

Reusable bash libraries located in `tools/lib/` that provide common functionality for scripts and other tools. These are sourced (not executed) and include guards to prevent double-loading.

### `repo-cache.bash`

Maintains shallow clones of all organization repositories in a local cache directory for use by cross-repo analysis tools.

**Provided function:**

#### `refresh_repo_cache [filter]`

Clones or updates all organization repositories into `$DEVENV_TOOLS/cache/repo_cache` using minimal shallow clones.

**Arguments:**

- `filter` (optional): A grep-compatible pattern to filter repository names

**Return codes:**

- `0`: All repositories cached successfully
- `1`: Complete failure (no repos found, missing credentials, or all clones failed)
- `2`: Partial failure (some repos failed, others succeeded)

**Behaviour:**

- New repos are cloned with `--depth 1 --single-branch --no-tags`
- Existing repos are updated with `fetch --depth 1` + `reset --hard` + `gc --prune=all`
- Writes a `.cache_timestamp` file (ISO timestamp + content hash) for staleness detection by downstream tools
- Outputs the cache directory path on success

**Required environment variables:** `GH_ORG`, `GH_USER`, `GH_TOKEN`

**Example:**

```bash
source "$DEVENV_TOOLS/lib/repo-cache.bash"

# Cache all org repos
refresh_repo_cache

# Cache only service repos
refresh_repo_cache "^service\."
```

### `desktop-menu.bash`

Provides idempotent functions for managing the Fluxbox desktop application menu. Used by `devenv-desktop-menu-add-shortcut` and `devenv-desktop-menu-add-folder`, and can be sourced directly by install-extras scripts to add menu entries as part of tool installation.

**Sourcing:**

```bash
source "$DEVENV_TOOLS/lib/desktop-menu.bash"
```

**Provided functions:**

#### `desktop_menu_get_file`

Returns the path to the Fluxbox menu file. Respects the `FLUXBOX_MENU` environment variable override; defaults to `~/.fluxbox/menu`.

```bash
menu_file="$(desktop_menu_get_file)"
```

#### `desktop_menu_shortcut_exists MENU_FILE LABEL`

Returns `0` if an `[exec]` entry with the given label exists, `1` otherwise.

```bash
if desktop_menu_shortcut_exists "$menu_file" "MongoDB Compass"; then
  echo "already present"
fi
```

#### `desktop_menu_folder_exists MENU_FILE FOLDER_NAME`

Returns `0` if a `[submenu]` entry with the given name exists, `1` otherwise.

```bash
if ! desktop_menu_folder_exists "$menu_file" "Databases"; then
  desktop_menu_add_folder "$menu_file" "Databases"
fi
```

#### `desktop_menu_add_shortcut MENU_FILE LABEL COMMAND [FOLDER]`

Adds an `[exec]` entry to the menu. Silently skips if a shortcut with the same label already exists. Calls `die` if the menu file or a specified folder does not exist.

| Argument | Description |
|----------|-------------|
| `MENU_FILE` | Path to the Fluxbox menu file |
| `LABEL` | Display label shown in the menu |
| `COMMAND` | Shell command to execute |
| `FOLDER` | Optional — existing folder to place the shortcut in |

#### `desktop_menu_add_folder MENU_FILE FOLDER_NAME [PARENT_FOLDER]`

Adds a `[submenu]` / `[end]` block to the menu. Silently skips if a folder with the same name already exists. Calls `die` if the menu file or a specified parent does not exist.

| Argument | Description |
|----------|-------------|
| `MENU_FILE` | Path to the Fluxbox menu file |
| `FOLDER_NAME` | Display name for the new folder |
| `PARENT_FOLDER` | Optional — existing folder to nest inside |

**Example — install-extras script:**

```bash
source "$DEVENV_TOOLS/lib/desktop-menu.bash"

menu_file="$(desktop_menu_get_file)"
desktop_menu_add_folder   "$menu_file" "Databases"
desktop_menu_add_shortcut "$menu_file" "MongoDB Compass" "mongodb-compass" "Databases"
```

**Menu format reference:**

```text
[begin] (  Application Menu  )
    [exec] (Label) { command } <>
    [submenu] (Folder Name) {}
        [exec] (Label) { command } <>
    [end]
    [config]     (Configuration)
    [workspaces] (Workspaces)
[end]
```

**Environment variables:**

- `FLUXBOX_MENU`: Override the default menu file path (`~/.fluxbox/menu`)

### `cs-dependency-graph.bash`

Builds and queries a reverse dependency graph across all cached C# organization repositories. Scans `.csproj` files to map NuGet package production and consumption relationships between repos.

**Configuration:**

- `CS_DEP_ORG_PREFIX` (default: `WorkInProgress.`): Only packages matching this prefix are considered org-internal
- `REPO_CACHE_DIR`: Inherited from `repo-cache.bash`
- `CS_DEP_INDEX_DIR`: Index storage location (default: `$REPO_CACHE_DIR/.index`)

**Provided functions:**

#### `is_index_stale`

Checks whether the dependency index needs rebuilding by comparing `.cache_timestamp` against `.index_timestamp`.

**Return codes:** `0` = stale (rebuild needed), `1` = fresh

#### `build_dependency_index`

Scans all cached repos' `src/**/*.csproj` files (skipping `test/` and `tests/` directories) and produces three TSV index files:

- `package_to_repo.tsv` — Maps each package name to its producing repo
- `repo_packages.tsv` — Lists all packages each repo publishes
- `repo_dependencies.tsv` — Lists org-internal package references per repo (excludes self-references and third-party packages)

#### `ensure_dependency_index`

Convenience wrapper: calls `build_dependency_index` only when `is_index_stale` indicates the index is outdated.

#### `list_repo_packages "repo-name"`

Returns the list of NuGet packages produced by a repository (one per line).

#### `list_repo_dependencies "repo-name"`

Returns the list of org-internal packages consumed by a repository (one per line).

#### `get_reverse_dependency_tree "repo-name-or-path"`

Performs a breadth-first traversal to find all repos that depend on the given repo, directly or transitively.

**Output format:** TSV with five columns:

| Column | Description |
|--------|-------------|
| DEPTH | Distance from root (0 = direct dependent) |
| REPO | Name of the dependent repository |
| PACKAGE_REF | The specific package being consumed |
| VERSION | The version of the referenced package |
| PATH | Full dependency chain (`>` delimited) |

**Example:**

```bash
source "$DEVENV_TOOLS/lib/cs-dependency-graph.bash"

# Ensure cache and index are current
refresh_repo_cache
ensure_dependency_index

# Show what depends on the essentials library
get_reverse_dependency_tree "lib.cs.common.essentials"

# Filter to direct dependents only
get_reverse_dependency_tree "lib.cs.common.essentials" | awk -F'\t' '$1 == 0'
```

## Bash Functions and Aliases

The following convenience aliases are available in the dev container:

**Navigation:**

- `devenv` - Navigate to devenv root
- `playground` - Navigate to playground directory
- `repos` - Navigate to repos directory

**Repository Management:**

- `repo-get` - Clone/navigate to repository
- `repo-update-all` - Update all repositories in parallel
- `repo-get-web-url` - Get GitHub web URL for current repository

**Pull Request Management:**

- `pr-create-for-merge` - Create PR for merging
- `pr-create-for-review` - Create draft review PR
- `pr-get-merge-link` - Get PR link for current branch
- `pr-get-review-link` - Get review PR link
- `pr-cleanup-review-branches` - Cleanup old review branches

**Issue Management:**

- `issue-create` - Create new issue
- `issue-list` - List/filter issues
- `issue-update` - Update issue fields
- `issue-close` - Close or reopen issues
- `issue-select` - Interactive issue selection with fzf
- `issue-groom` - Interactive grooming wizard

**Project Management:**

- `project-add` - Add issues to projects
- `project-update` - Update issue fields in projects

**Development Tools:**

- `editor` - Open files in VS Code (blocking) with fallback editor support
- `tooling-create-script` - Create new script from template
- `lint-scripts` - Validate shell scripts with shellcheck
- `repo-version-list` - List version tags

**Containers & Services:**

- `dependencies-up` / `dependencies-down` - Start/stop dependencies
- `server-run-sql` / `server-run-smb` - Start development servers

**Database:**

- `mongo-backup-server` / `mongo-restore-server` - MongoDB backup/restore

**NuGet:**

- `cs-nuget-clear-local` / `cs-nuget-publish-local` - Local NuGet development

**Desktop Environment:**

- `devenv-desktop-menu-add-shortcut` - Add a shortcut to the Fluxbox desktop menu
- `devenv-desktop-menu-add-folder` - Add a folder to the Fluxbox desktop menu

**Utilities:**

- `get-public-ip` - Get current public IP
- `key-update-github` - Update GitHub token in setup
- `key-update-tailscale` - Update Tailscale auth key
- `key-update-do` - Update Digital Ocean API token
- `devenv-vscode-fix-sockets` - Fix stale VS Code IPC sockets (see [Troubleshooting](./Dev-container-environment.md#troubleshooting))

## Markdown and Implementation Plan Tools

Tools for working with markdown documents, specifically implementation plans
generated by Copilot skills such as `devenv-create-implementation-plan` and
`devenv-plan-from-spec`.

### `markdown-plan-complete-task`

Marks one or more task checkboxes in an implementation plan as complete (`[x]`)
or incomplete (`[ ]`). Tasks are identified by their dotted number as they
appear in the plan (e.g. `2.3` or `1.4.2`).

**Usage:**

```bash
markdown-plan-complete-task [OPTIONS] TASK_NUMBER... [PLAN_FILE]
```

**Arguments:**

- `TASK_NUMBER...`: One or more dotted task numbers to update (`X.Y` or `X.Y.Z`).
  Multiple task numbers can be supplied in a single invocation.
- `PLAN_FILE`: Path to the markdown plan file. Defaults to the first
  `Implementation_plan-*.md` file found in the current directory.
  Positional arguments are classified automatically: anything matching the
  `X.Y` / `X.Y.Z` pattern is treated as a task number; everything else is
  treated as the plan file. The plan file may appear anywhere in the argument
  list — before, after, or mixed in with task numbers.

**Options:**

- `--uncomplete`: Mark the tasks as incomplete (`[ ]`) instead of complete (`[x]`)
- `-V, --verbose`: Enable verbose output

**Examples:**

```bash
# Mark task 2.3 complete in the auto-detected plan file
markdown-plan-complete-task 2.3

# Mark several tasks complete at once
markdown-plan-complete-task 1.1 1.2 1.3

# Mark tasks complete in a specific plan file (file can appear anywhere)
markdown-plan-complete-task 1.1 1.2 /path/to/Implementation_plan-001.md

# Undo — mark tasks as incomplete
markdown-plan-complete-task --uncomplete 2.3 2.4
```

**Notes:**

- After updating all checkboxes, the tool prints overall plan progress
  (completed / total tasks) once.
- If any individual task fails (e.g. task number not found), the tool reports
  it and continues with the remaining tasks, then exits non-zero.
- The operation is idempotent: marking an already-complete task as complete
  (or incomplete as incomplete) produces no error and no file change.
- Relies on `tools/lib/markdown.bash` for all checkbox manipulation logic.

---

### `markdown-plan-complete-ac`

Marks one or more acceptance-criteria checkboxes as complete (`[x]`) or
incomplete (`[ ]`). AC items are identified by their number, e.g. `AC-3` or
`AC-1.2`, as they appear in requirements or plan documents.

**Usage:**

```bash
markdown-plan-complete-ac [OPTIONS] AC_NUMBER... [FILE]
```

**Arguments:**

- `AC_NUMBER...`: One or more AC numbers to update (`AC-N`, `AC-N.N`, `AC-N.N.N`).
- `FILE`: Path to the markdown file. Defaults to the first `Requirements-*.md`
  found in the current directory; if none exists, the first
  `Implementation_plan-*.md` is tried. As with `markdown-plan-complete-task`,
  the file may appear anywhere among the arguments.

**Options:**

- `--uncomplete`: Mark the criteria as incomplete (`[ ]`) instead of complete (`[x]`)
- `-V, --verbose`: Enable verbose output

**Examples:**

```bash
# Mark AC-3 complete in the auto-detected requirements file
markdown-plan-complete-ac AC-3

# Mark several criteria complete at once
markdown-plan-complete-ac AC-1 AC-2 AC-3

# Mark criteria complete in a specific file
markdown-plan-complete-ac AC-1 AC-2 /path/to/Requirements-001.md

# Undo — mark criteria as incomplete
markdown-plan-complete-ac --uncomplete AC-3 AC-4
```

**AC item format:**

```markdown
- [ ] **AC-3** Criterion text *(inferred)* — *revised: brief note*
- [x] **AC-1.2** Sub-criterion already verified
```

**Notes:**

- After updating all checkboxes, the tool prints overall AC progress
  (completed / total criteria) once.
- Partial failures are reported individually; the tool exits non-zero if any
  criterion could not be updated.
- Relies on `tools/lib/markdown.bash` for all checkbox manipulation logic.

---

## Usage Notes

- Most tools require proper environment variables to be set (e.g., `GH_USER`, `GH_TOKEN`)
- GitHub operations prefer SSH but fall back to HTTPS with token authentication
- Tools automatically handle error conditions and provide helpful error messages
- Scripts follow consistent naming conventions (prefix-based: `repo-`, `pr-`, `git-`)
- Many tools are designed to work within the development container environment

## Environment Variables

The following environment variables should be configured for full functionality:

- `GH_USER`: GitHub username
- `GH_ORG`: GitHub organization name (owner of repositories)
- `GH_TOKEN`: GitHub personal access token with:
  - `repo` (full control of private repositories)
  - `workflow` (update GitHub Actions workflows)
  - `read:packages` (download packages from GitHub Package Registry)
  - `read:org` (read org and team membership, read org projects)
  - `write:discussion` (write access to discussions)
  - `project` (full control of projects)
- `DEVENV_ROOT`: Path to devenv root directory (auto-set)
- `DEVENV_TOOLS`: Path to scripts/ directory (auto-set)
- `devenv`: Lowercase alias for DEVENV_ROOT (auto-set)
- `SSH_AUTH_SOCK`: SSH agent socket (auto-configured with host forwarding)

For more information about setting up the development environment, see [Dev-container-environment.md](./Dev-container-environment.md).

## See Also

- [Contributing Guidelines](./Contributing.md) - How to contribute to the project
- [Coding Standards](./Coding-standards.md) - Code style and conventions
- [Function Naming Conventions](./Function-Naming-Conventions.md) - Naming standards
