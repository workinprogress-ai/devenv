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

### `git wip` / `git unwip`

Work-in-progress commit management:

- `git-wip`: Creates a temporary WIP commit
- `git-unwip`: Removes the last WIP commit and restages changes

```bash
git wip
git unwip
```

*NOTE*: `git wip` will bypass the normal git hooks. This allows you to create a WIP commit even if your pre-commit hook would normally block the commit. However, be aware that this means that any checks or formatting done by the hooks will not be applied to the WIP commit.

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

**Utilities:**

- `get-public-ip` - Get current public IP
- `key-update-github` - Update GitHub token in setup
- `key-update-tailscale` - Update Tailscale auth key
- `key-update-do` - Update Digital Ocean API token
- `devenv-vscode-fix-sockets` - Fix stale VS Code IPC sockets (see [Troubleshooting](./Dev-container-environment.md#troubleshooting))

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
