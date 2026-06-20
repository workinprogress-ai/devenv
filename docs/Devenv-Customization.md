# Customization Guide for the Devenv

If you've forked this repository for your organization, this guide explains what to configure so the environment matches your org. The essentials live in `devenv.config`; repository-creation standards live in `tools/config/repo-types.yaml`.

## Quick Checklist

- ✅ Update `devenv.config` for org identity, container name, workflows, and bootstrap defaults
- ✅ (Optional) Update `copilot/copilot-instructions.md` with organization-specific AI coding guidelines
- ✅ (Optional) Add custom Copilot skills to `copilot/skills/` for domain-specific workflows
- ✅ (Optional) Configure shared Copilot knowledge sync in `devenv.config` (`[copilot]` section)
- ✅ (Optional) Create `org-custom-bootstrap.sh` and `org-custom-startup.sh` for organization-wide customizations
- ✅ (If you use repo creation tooling) Update `tools/config/repo-types.yaml` for naming, templates, branch protection, and post-creation scripts
- ✅ (If you use issue creation tooling) Update `tools/config/issues-config.yml` with your organization's issue types and GitHub issue type IDs
- ✅ Create/adjust template repos per type (recommended) so new repos start with CI, CODEOWNERS, and hooks

## Copilot Instructions

The file `copilot/copilot-instructions.md` contains AI coding guidelines that apply to the repository in VS Code (GitHub Copilot reads this file automatically when it exists in the workspace). During bootstrap, `~/.copilot/copilot-instructions.md` is **symlinked** to this file, making the same instructions available as the user-level Copilot instructions file.

When forking, you have two options:

1. **Write your own instructions in-place** — update `copilot/copilot-instructions.md` directly with your organization's conventions, code style, and AI guidance. Bootstrap will symlink it to `~/.copilot/copilot-instructions.md` automatically.

2. **Symlink to a different file** — if you prefer to keep your Copilot instructions elsewhere (e.g. in a shared config repo or a different path), create `~/.copilot/copilot-instructions.md` as a symlink to that file before or after bootstrap runs. The `install_copilot_instructions` task will detect the existing symlink and leave it untouched, regardless of where it points.

## Copilot Skills

This repository ships with a suite of 15 slash-command skills that cover the full development lifecycle — from issue triage through PR review. They live in `copilot/skills/` and are invoked with `/skill-name` in Copilot Chat.

See [docs/Skills.md](./Skills.md) for the full catalog and decision tree.

### Adding a custom skill

1. **Read the conventions** — `copilot/skills/_conventions.md` defines the required file layout, frontmatter fields, description rules (including the 1024-char limit), section ordering, and confirmation-flow patterns.

2. **Create the skill folder and SKILL.md**:

   ```text
   copilot/skills/<your-skill-name>/
   └── SKILL.md
   ```

   The folder name must match the `name:` field in the YAML frontmatter exactly.

3. **Write the description carefully** — it is the only signal Copilot uses to decide whether to auto-load the skill. Include explicit `USE WHEN` and `DO NOT USE FOR` clauses with the exact phrases users will say. Verify the length:

   ```bash
   awk '/^description:/ {gsub(/^description: */,""); print length}' copilot/skills/<name>/SKILL.md
   ```

4. **Register the skill for `/devenv-skill-guru` discoverability** — append a row to the appropriate category table in `copilot/skills/devenv-skill-guru/references/skills-registry.md`. This is the single file the `skill-guru` routing skill reads; without an entry here, the skill won't be surfaced when users ask "which skill should I use".

   Each row needs: skill name (with `/`), one-line purpose, 2–4 USE WHEN trigger phrases, and a NOT FOR clause.

5. **Add a "Sibling skills" section** at the bottom of your SKILL.md linking back to [docs/Skills.md](./Skills.md). Then add a row for the new skill to the appropriate table in `docs/Skills.md` so it appears in the human-readable catalog.

6. **Reload VS Code** (or run "Developer: Reload Window") for the new slash command to appear in Copilot Chat.

### Adding optional reference files

If your skill needs reusable artifacts (templates, cheatsheets, phrasing tables), put them in a `references/` subfolder:

```text
copilot/skills/<your-skill-name>/
├── SKILL.md
└── references/
    └── my-template.md
```

The agent loader walks one level deep only — do not nest further. See `_conventions.md` for guidance on what belongs in `references/` vs. inline in `SKILL.md`.

## Organization-Level Custom Scripts

For organization-wide customizations that should apply to all developers, create these scripts in `.devcontainer/`:

### org-custom-bootstrap.sh

Runs during container creation/bootstrap. Use this for:

- Installing organization-specific tools and dependencies
- Configuring company-wide settings
- Setting up organization-specific certificates or credentials
- Initializing shared development services

**Example:**

```bash
#!/bin/bash
set -euo pipefail

# Install organization-specific tools
echo "Installing company tools..."
sudo apt-get install -y custom-company-tool

# Configure organization settings
echo "Configuring company defaults..."
git config --global url."https://github.com/your-org/".insteadOf "https://gh/"
```

### org-custom-startup.sh

Runs each time VS Code starts. Use this for:

- Starting organization-specific services
- Validating required environment setup
- Displaying organization-specific welcome messages
- Connecting to shared development resources

**Example:**

```bash
#!/bin/bash
set -euo pipefail

echo "🏢 Welcome to YourOrg Development Environment"

# Start organization services if needed
if ! docker ps | grep -q company-service; then
    echo "Starting company service..."
    docker-compose -f $DEVENV_ROOT/.devcontainer/company-services.yml up -d
fi
```

**Important:** These scripts should be committed to the repository so all team members benefit from the customizations.

## User-Level Customizations

Individual developers can add their own customizations using:

- `user-custom-bootstrap.sh` - Personal bootstrap customizations (not committed)
- `user-custom-startup.sh` - Personal startup customizations (not committed)

Use the helper scripts to add commands:

```bash
devenv-add-custom-bootstrap "your-command"
devenv-add-custom-startup "your-command"
```

## Required: devenv.config

Edit `devenv.config` in the root directory:

### [organization]

```ini
[organization]
name=YourOrg
github_org=your-org
email_domain=yourorg.com
```

- **name**: Organization name (for docs/branding)
- **github_org**: GitHub org/user used for cloning and feeds
- **email_domain**: Enforced commit email domain (empty = any valid email)

### [container]

```ini
[container]
name=YourOrg Dev Environment
```

- **name**: Display name for the dev container

### [workflows]

```ini
[workflows]
status_workflow=Backlog,Ready,In Progress,In review,Done
```

- **status_workflow**: Your issue flow, ordered

### [copilot]

```ini
[copilot]
knowledge_repo=https://github.com/workinprogress-ai/docs.copilot-knowledge.git
knowledge_subpath=copilot-knowledge/
```

- **knowledge_repo**: Git repository URL for shared Copilot knowledge assets.
- **knowledge_subpath**: Folder inside that repository that should be linked to `~/.copilot/knowledge`.

Behavior:

- During bootstrap, devenv clones or pulls `knowledge_repo` into `copilot/knowledge` using your configured `GH_TOKEN`.
- It then symlinks `~/.copilot/knowledge` to `copilot/knowledge/<knowledge_subpath>`.
- During `devenv-update`, devenv refreshes that repo and updates the symlink target automatically.
- On container start, devenv runs a non-blocking pull for `copilot/knowledge` (when it is a git repo) via `pull_copilot_knowledge_on_container_start` in `tools/lib/copilot-knowledge.bash`.

### [bootstrap]

```ini
[bootstrap]
validate_config=true
```

- **validate_config**: Validate config on startup (recommended: true)

## Repo Creation Standards (repo-create.sh)

If you use `tools/scripts/repo-create.sh`, configure `tools/config/repo-types.yaml`:

### Configuration per type

- **Naming**: `naming_pattern` and `naming_example` per type (e.g., `service.<category>.<descriptor>`, `gateway.<category>.<descriptor>`, `app.web.<descriptor>`, `lib.cs.<category>.<descriptor>`)
- **Templates**: `template` per type (or null) to pre-bake CI, CODEOWNERS, and .repo scripts
- **Template marking**: `isTemplate` (boolean, default: false) marks the repository as a GitHub template, making it available for use with "Use this template" button
- **Post-creation**: `post_creation_script`, `delete_post_creation_script`, and `post_creation_commit_handling` (`none|amend|new`)
- **Merge types**: `allowedMergeTypes` - Controls which merge buttons appear in the GitHub UI (merge|squash|rebase)
  - This is a repository-level setting that applies globally
  - Should match the ruleset's `allowed_merge_methods` for consistency
  - Both settings work together: this controls UI, ruleset enforces on protected branches
- **PR branch deletion**: `deletePRBranchOnMerge` (boolean, default: true) - Automatically delete PR branches after merge
- **Wiki**: `hasWiki` (boolean, default: false) - Enable/disable the Wiki feature
  - Set to `true` for documentation repositories where you want a wiki
  - Most code repositories should keep this disabled to avoid confusion with repository documentation
- **Issues**: `hasIssues` (boolean, default: true) - Enable/disable the Issues tab
  - Set to `false` for template repositories since they shouldn't track issues
  - Keep enabled for active development repositories
- **Discussions**: `hasDiscussions` (boolean, default: false) - Enable GitHub Discussions
  - Useful for community-driven projects or public repositories
  - Provides a forum-like space separate from issues
- **Projects**: `hasProjects` (boolean, default: false) - Enable the Projects tab visibility
  - Controls whether the "Projects" tab appears in the repository navigation
  - Note: This only affects visibility/convenience - issues can be added to GitHub Projects regardless of this setting
  - Disable if using external project management tools (Jira, Azure DevOps, etc.) or want to reduce tab clutter
  - Enable only if your team actively uses GitHub Projects and wants easy access from the repo interface
- **Auto-merge**: `allowAutoMerge` (boolean, default: true) - Allow auto-merge on pull requests
  - Enables automation workflows to merge PRs after checks pass
  - Useful for Dependabot and other automated updates
- **Update branch**: `allowUpdateBranch` (boolean, default: true) - Show "Update branch" button on PRs
  - Allows contributors to easily update their PR branch with latest changes from base branch
  - Recommended for most repositories to keep PRs current
- **Forking**: `allowForking` (boolean, default: false for code, true for templates) - Allow others to fork the repository
  - Enable for template repositories so others can use them
  - Keep disabled for private/internal code repositories
- **Squash commit title**: `squashMergeCommitTitle` (string, default: PR_TITLE) - Format for squash merge commit titles
  - `PR_TITLE` - Use the pull request title as the commit title
  - `COMMIT_OR_PR_TITLE` - Use the first commit message title or PR title (GitHub's original default)
- **Squash commit message**: `squashMergeCommitMessage` (string, default: COMMIT_MESSAGES) - Format for squash merge commit message body
  - `PR_BODY` - Use the pull request description
  - `COMMIT_MESSAGES` - Use all commit messages from the PR (preserves commit history in message)
  - `BLANK` - No commit message body (clean single-line commits)
- **GitHub UI Mapping** for squash merge settings:
  - "Use PR title": `title=PR_TITLE, message=BLANK`
  - "Use PR title and commit details": `title=PR_TITLE, message=COMMIT_MESSAGES` (default)
  - "Use PR title and description": `title=PR_TITLE, message=PR_BODY`
  - "Default message": `title=COMMIT_OR_PR_TITLE, message=COMMIT_MESSAGES`
- **Rulesets** (GitHub Pro/public repos only):
  - `rulesetConfigFile`: Path to JSON ruleset file in `tools/config/` (e.g., `ruleset-default.json`)
  - Set to `null` or blank to disable rulesets for a type
  - JSON file is a GitHub ruleset export with token placeholders: `{{repo_name}}`, `{{owner}}`, `{{type_name}}`, `{{type_description}}`
  - Ruleset can also specify `allowed_merge_methods` for protected branches (more restrictive than repo-level setting)
- **Access**: `access` - List of teams or users with their permission levels (optional)
  - If not specified, no default permissions are applied (repository uses organization defaults)
  - Each entry contains:
    - `name`: Team or user name (GitHub team slug or username)
    - `type`: `team` or `user` (default: team)
    - `permission`: GitHub repository permission level:
      - `pull` (Read) - Can pull/clone, open issues, and comment
      - `triage` (Triage) - Can manage issues/PRs without write access
      - `push` (Write) - Can push, create branches, and manage issues/PRs
      - `maintain` (Maintain) - Push + manage releases and some settings
      - `admin` (Admin) - Full access including settings, webhooks, and team management
  - Applied automatically during repository creation and when running `repo-update-config`

#### Ruleset JSON tokens

Your ruleset JSON file can use these tokens, which are replaced during application:

- `{{repo_name}}` - Full repository name (e.g., `service.platform.identity`)
- `{{owner}}` - Organization/owner name
- `{{type_name}}` - Repository type (e.g., `service`, `documentation`)
- `{{type_description}}` - Type description from config

## GitHub Issue Types Configuration (issue-create.sh)

The `issue-create.sh` tool supports GitHub's native issue types. Issue types are configured in `tools/config/issues-config.yml`, which is the single source of truth for type names, descriptions, and GitHub API IDs.

### Configure Issue Types

Edit `tools/config/issues-config.yml` to define your organization's issue types:

```yaml
types:
  - name: Bug
    description: "A bug or defect that needs fixing"
    id: "IT_kwDOCk-E0c4BWVJJ"
  
  - name: Feature
    description: "A new feature or enhancement"
    id: "IT_kwDOCk-E0c4BWVJK"
  
  - name: Task
    description: "A task or work item"
    id: "IT_kwDOCk-E0c4BWVJI"
```

Each entry needs:

- **name**: The issue type name (displayed in GitHub UI and used for validation)
- **description**: Human-readable description for users selecting a type
- **id**: GitHub organization-level issue type ID (required for setting types via API)

### Getting Your Organization's Issue Type IDs

Get the IDs from your GitHub organization using the CLI:

```bash
gh api graphql -f query="query { organization(login: \"$GH_ORG\") { issueTypes(first: 100) { edges { node { id name } }
 } } }" | jq .
 ```

### Syncing with GitHub Organization Settings

To add or modify issue types in GitHub:

1. Go to your **GitHub Organization Settings**
2. Navigate to **Planning** section
3. Click on **Issue types**
4. From there, you can:
   - **Create** new issue types
   - **Edit** existing ones (name, icon, description)
   - **Disable/Delete** issue types you no longer need

After making changes in GitHub:

1. Get the updated IDs using the CLI command above
2. Update `tools/config/issues-config.yml` with the new types and IDs

### Example: Custom Issue Types

```yaml
types:
  - name: Bug
    description: "Production bug or critical issue"
    id: "IT_kwDOXXXXXXXXXXXXX1"
  
  - name: Enhancement
    description: "New feature or improvement"
    id: "IT_kwDOXXXXXXXXXXXXX2"
  
  - name: Documentation
    description: "Documentation or tutorial"
    id: "IT_kwDOXXXXXXXXXXXXX3"
  
  - name: Spike
    description: "Research task or investigation"
    id: "IT_kwDOXXXXXXXXXXXXX4"
```

Note: Replace the `id` values with your actual organization's issue type IDs from GitHub.

### Planning Type Mapping

The `planning` section in `issues-config.yml` maps concepts from a requirements document to GitHub issue types. This is used when creating issues from a requirements document to determine which issue type to assign for each level of the document hierarchy.

```yaml
planning:
  type_mapping:
    phases: Epic
    features: Feature
    tasks: Task
```

Each key under `type_mapping` corresponds to a concept in a requirements document:

- **phases**: High-level project phases, mapped to an issue type (default: `Epic`)
- **features**: Feature-level items, mapped to an issue type (default: `Feature`)
- **tasks**: Individual work items, mapped to an issue type (default: `Task`)

### Example configuration

```yaml
service:
  description: Backend microservices
  template: template.service
  naming_pattern: '^service\.[a-z0-9-]+\.[a-z0-9-]+$'
  naming_example: "service.platform.identity"
  mainBranch: master
  allowedMergeTypes:
    - squash
  rulesetConfigFile: ruleset-default.json
  post_creation_script: ".repo/post-create.sh"
  access:
    - name: Engineering
      type: team
      permission: push
    - name: DevOps
      type: team
      permission: admin
```

### Example ruleset JSON (ruleset-default.json)

```json
{
  "name": "{{repo_name}} Protection Ruleset",
  "target": "branch",
  "source": "{{owner}}/{{repo_name}}",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "require_code_owner_review": true
      }
    },
    {
      "type": "required_linear_history"
    }
  ]
}
```

**To create a ruleset JSON:**

1. Configure a ruleset manually in GitHub UI
2. Export it via API: `gh api repos/OWNER/REPO/rulesets/ID`
3. Save to `tools/config/your-ruleset.json`
4. Replace hardcoded values with tokens (`{{repo_name}}`, `{{owner}}`, etc.)
5. Reference the filename in `rulesetConfigFile` property

### Tip

Keep a lightweight template repo for each type so new repos start with pipelines, CODEOWNERS, and `.repo/` hooks already in place.

## devenv.config Examples

### Small Startup

```ini
[organization]
name=Acme Corp
github_org=acme-corp
email_domain=acme.com

[container]
name=Acme Dev Environment

[workflows]
status_workflow=Backlog,In Progress,Done
```

### Enterprise Organization

```ini
[organization]
name=Mega Corp
github_org=mega-corp-dev
email_domain=megacorp.com

[container]
name=Mega Corp Development Environment

[workflows]
status_workflow=Backlog,Ready,In Progress,In review,Testing,Done
```

## Adding New Tools and Libraries

This section explains the conventions for adding new scripts, bash libraries, and categories of tooling so that all contributions stay consistent and discoverable.

### Adding a new bash library

Libraries live in `tools/lib/` and are sourced by scripts at runtime via `$DEVENV_TOOLS/lib/<name>.bash`. Follow these conventions:

For the current shared-library catalog, see [Additional Tooling](./Additional-Tooling.md#shared-bash-libraries).

1. **File name**: `tools/lib/<category>.bash` using lowercase hyphenated names, e.g. `markdown.bash`.
2. **Guard against double-sourcing** at the top:

   ```bash
   if [ -n "${_MARKDOWN_LOADED:-}" ]; then return 0; fi
   _MARKDOWN_LOADED=1
   ```

   Use `_<NAME_UPPERCASED>_LOADED` as the guard variable name.
3. **Source dependencies explicitly** using the same guard pattern, loading from `$DEVENV_TOOLS/lib/`:

   ```bash
   if [ -z "${_ERROR_HANDLING_LOADED:-}" ] && [ -f "${DEVENV_TOOLS}/lib/error-handling.bash" ]; then
       source "${DEVENV_TOOLS}/lib/error-handling.bash"
   fi
   ```

4. **Function naming**: follow `snake_case` with clear verb prefixes (`get_`, `validate_`, `set_`, `find_`, etc.). For library functions, add a namespace prefix that matches the library name, e.g. `validate_plan_task_number`, `set_plan_task_complete`.
5. **Document every public function** with a Usage/Arguments/Returns block comment.
6. **Write tests** in `tools/tests/lib/test_<name>.bats`. Libraries are fully tested — every public function should have tests covering success paths, failure paths, and edge cases. Run with `bats tools/tests/lib/test_<name>.bats`.

### Adding a new script

Scripts live in `tools/scripts/<name>.sh` and are exposed via a symlink at `tools/<name>` (without the `.sh` extension).

1. **Start from the template**: `tooling-create-script <name>` scaffolds the file from `tools/templates/script-template.sh`.
2. **File location**: `tools/scripts/<group>-<action>.sh`, following the existing `group-action` naming pattern (e.g. `markdown-plan-complete-task.sh`).
3. **Symlink**: create a relative symlink from `tools/` to the script:

   ```bash
   ln -s scripts/<name>.sh tools/<name>
   ```

4. **Standard structure** (in order):
   - Shebang + header comment (name, version, description, requirements)
   - `source "$DEVENV_TOOLS/lib/error-handling.bash"` and `source "$DEVENV_TOOLS/lib/versioning.bash"`
   - `enable_strict_mode`
   - `SCRIPT_VERSION` and `SCRIPT_NAME` constants
   - `script_version` call
   - Additional library sources
   - Global variables
   - `show_usage()` function with `--help` support
   - `parse_args()` function
   - Helper functions
   - `main()` function called at the end
5. **Always implement `--help` and `--version`** using the `show_usage` / `script_version` pattern from the template.
6. **Tests**: test scripts according to their impact, complexity, and criticality. Script tests go in `tools/tests/scripts/`.

### Adding a new tool category

When adding a group of related tools (e.g. `markdown-*`), follow these steps:

1. Create the bash library at `tools/lib/<category>.bash` following the conventions above.
2. Create scripts in `tools/scripts/<category>-<action>.sh`.
3. Create symlinks in `tools/` for each script.
4. Write library tests in `tools/tests/lib/test_<category>.bats`.
5. If any third-party packages are required (e.g. Python packages via `pip`, Node packages via `pnpm`), install them in `.devcontainer/bootstrap.bash` inside the appropriate `install_*` function so the dependency survives container rebuilds.
6. Document the new tools in `docs/Additional-Tooling.md` under an appropriate section heading, following the existing format (usage, options, examples, features).

### Third-party dependencies

If a script requires an external tool not already present in the environment:

- **OS packages** (`apt`): add to `install_os_packages_round1` or `install_os_packages_round2` in `.devcontainer/bootstrap.bash`.
- **Node packages** (`npm`/`pnpm`): add to `install_node_packages` in `.devcontainer/bootstrap.bash`.
- **Python packages** (`pip`): add an `install_python_packages` function (or extend an existing one) in `.devcontainer/bootstrap.bash` and call it from `main`.
- **dotnet tools**: add alongside the existing `dotnet tool install` calls in `.devcontainer/bootstrap.bash`.

Always check for the tool's presence before installing (see the `yq` install pattern for an example of idempotent install logic).

---

## What You Should NOT Change (unless you want to maintain your fork)

- Test infrastructure (unless enhancing it)
- Error handling libraries
- Git configuration helpers
- Version comparison logic
- Core script templates
- Bootstrap framework

These are intended to be generic and reused across orgs.

## Advanced Customization

For deeper bootstrap tweaks, see [Bootstrap-Customization.md](./Bootstrap-Customization.md) (modular tasks, overrides, env-based flows).

## Contributing Improvements Back

1. Fork the main devenv repository
2. Create a feature branch
3. Make your improvements
4. Ensure all tests pass
5. Submit a pull request

See [Contributing](./Contributing.md) for more details.

## Getting Help

- Check the `docs/` folder for feature-specific topics
- Review test files in `tools/tests/` for usage examples
