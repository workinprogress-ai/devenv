# Additional Tooling

This document provides comprehensive documentation for all additional tooling available in the development environment. These tools are located in the `scripts/` folder and are automatically added to the `PATH` when the development environment is set up.

## Repository Management

Tools for managing repositories, cloning, updating, and working with multiple repositories.

### `repo-get`

Clones a repository from GitHub into the `repos/` folder.

**Usage:**
```bash
repo-get <repository-name>
```

**Notes:**
- Automatically configures git settings from `git-config.sh`
- Supports SSH-first cloning with HTTPS fallback using `GH_TOKEN`
- Automatically detects default branch (main/master)
- Runs `.repo/init.sh` and `.repo/update.sh` hooks if present
- Supports partial repo names for convenience
- Prevents cloning into reserved directories

*Note: `get-repo` is a convenience alias for `repo-get`. Both forms work identically.*

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

Creates a pull request for merging code to the main branch.

```bash
pr-create-for-merge
```

**Features:**
- Validates Conventional Commits format for title
- Supports auto-merge flag
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

## Docker and Container Management

Tools for building, running, and managing Docker containers and services.

### `docker-build.sh`

Builds a project using Docker with proper environment configuration.

```bash
docker-build.sh [service-name]
```

### `docker-up.sh`

Brings up a local Docker configuration using docker-compose.

```bash
docker-up.sh
```

### `docker-down.sh`

Brings down a local Docker configuration and cleans up containers.

```bash
docker-down.sh
```

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

### `enable-container-dotnet-debugger.sh`

Injects and runs the .NET debugger into a locally running container for debugging purposes.

```bash
enable-container-dotnet-debugger.sh <container-name>
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

### `create-script`

Creates a new script from the standard template with error handling, versioning, and cleanup.

```bash
create-script <script-name>
```

**Features:**
- Uses `templates/script-template.sh` as base
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

### `count-code-lines`

Counts lines of code in files or directories, with filtering options.

```bash
count-code-lines [file-or-directory]
```

### `nuget-clear-local`

Clears local NuGet package cache for packages in the local debug feed.

```bash
nuget-clear-local
```

**Features:**
- Clears `~/.nuget/packages` cache for local packages
- Removes all packages from `.debug/local-nuget-dev`
- Provides warnings if cleanup fails

### `nuget-publish-debug-local`

Publishes a debug version of a NuGet package to local feed.

```bash
nuget-publish-debug-local [target-directory] [version] [configuration]
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

### `coverage-open-report`

Opens the code coverage report in a browser.

```bash
coverage-open-report
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
- `helm.sh` - Helm package manager for Kubernetes
- `minikube.sh` - Minikube for local Kubernetes
- `mongo-tools.sh` - MongoDB CLI tools
- `mongo-compass.sh` - MongoDB Compass GUI
- `chromium.sh`, `firefox.sh` - Web browsers
- `flatpak.sh` - Flatpak package manager
- `tailscale.sh` - Tailscale VPN with SOCKS5 proxy
- `doctl.sh` - DigitalOcean CLI tool

### `add-env-vars`

Adds or updates environment variables in `.devcontainer/env-vars.sh`.

```bash
add-env-vars "VAR1=value1" "VAR2=value2" ...
```

**Features:**
- Validates environment variable format (uppercase with underscores)
- Updates existing variables (removes old values to prevent duplicates)
- Appends new variables to the file
- Provides clear logging of added/updated variables

**Example:**

```bash
add-env-vars "MY_API_KEY=abc123" "DEBUG_MODE=true"
```

**Note:** Restart your container or source the env-vars.sh file to apply changes.

### `add-custom-startup-commands`

Adds custom commands to `.devcontainer/custom_startup.sh` that will run each time VS Code starts.

```bash
add-custom-startup-commands "command1" "command2" ...
```

**Features:**
- Validates bash syntax before adding commands
- Creates `custom_startup.sh` if it doesn't exist
- Sets executable permissions automatically
- Adds documentation comments for each command

**Example:**

```bash
add-custom-startup-commands "echo 'Container started'" "export MY_VAR=value"
```

### `update-github-token`

Updates the GitHub personal access token stored in `.setup/github_token.txt`.

```bash
update-github-token [new-token]
```

**Interactive mode:** If no token is provided, prompts for input.

### `update-tailscale-key`

Updates the Tailscale auth key and re-authenticates the daemon without requiring a container restart.

```bash
update-tailscale-key
# Or use the bash function:
update-tailscale-key
```

**Features:**
- Prompts for new reusable auth key (input is hidden)
- Validates key format (must start with `tskey-`)
- Updates `TS_AUTHKEY` in `.devcontainer/env-vars.sh`
- Re-authenticates the Tailscale daemon immediately
- Sources the updated environment variables in the current shell

**When to use:**
- Your reusable auth key has expired (typically after 90 days)
- You need to switch to a different Tailscale network or organization
- Admin has rotated the team's auth key

**Note:** This script preserves your container's hostname and route settings during re-authentication.

### Digital Ocean API Token

Your Digital Ocean API token is stored in `.setup/digitalocean_token.txt` after initial setup. To update it:

```bash
# Re-run the setup script and select the Digital Ocean token option
./setup
```

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

## Bash Functions and Aliases

The following convenience aliases are available in the dev container:

**Navigation:**
- `devenv` - Navigate to devenv root
- `playground` - Navigate to playground directory
- `repos` - Navigate to repos directory

**Repository Management:**
- `repo-get` - Clone/navigate to repository
- `repo-update-all` - Update all repositories in parallel
- `update-dev-env` - Update the devenv repository itself
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
- `create-script` - Create new script from template
- `lint-scripts` - Validate shell scripts with shellcheck
- `repo-version-list` - List version tags

**Containers & Services:**
- `dependencies-up` / `dependencies-down` - Start/stop dependencies
- `server-run-sql` / `server-run-smb` - Start development servers

**Database:**
- `mongo-backup-server` / `mongo-restore-server` - MongoDB backup/restore

**NuGet:**
- `nuget-clear-local` / `nuget-publish-debug-local` - Local NuGet development

**Utilities:**
- `get-public-ip` - Get current public IP
- `load-ssh-agent` - Load SSH agent from host
- `update-github-token` - Update GitHub token in setup

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
