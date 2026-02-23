# Customization Guide for the Devenv

If you've forked this repository for your organization, this guide explains what to configure so the environment matches your org. The essentials live in `devenv.config`; repository-creation standards live in `tools/config/repo-types.yaml`.

## Quick Checklist

- ✅ Update `devenv.config` for org identity, container name, workflows, and bootstrap defaults
- ✅ (Optional) Update `.github/copilot-instructions.md` with organization-specific AI coding guidelines
- ✅ (Optional) Create `org-custom-bootstrap.sh` and `org-custom-startup.sh` for organization-wide customizations
- ✅ (If you use repo creation tooling) Update `tools/config/repo-types.yaml` for naming, templates, branch protection, and post-creation scripts
- ✅ (If you use issue creation tooling) Update `tools/config/issues-config.yml` to match your organization's GitHub issue types
- ✅ Create/adjust template repos per type (recommended) so new repos start with CI, CODEOWNERS, and hooks

## Copilot Instructions

The file `.github/copilot-instructions.md` contains AI coding guidelines that apply to the repository in VS Code (GitHub Copilot reads this file automatically when it exists in the workspace). During bootstrap the file is also copied to `~/.copilot/copilot-instructions.md`, making the same instructions available as the user-level Copilot instructions file.

When forking this repository, update `.github/copilot-instructions.md` with your organization's preferred conventions, code style expectations, and any AI-specific guidance. The copy to `~/.copilot/` is handled automatically by the `install_copilot_instructions` bootstrap task — no additional setup is needed.

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
issue_types=story,bug
```

- **status_workflow**: Your issue flow, ordered
- **issue_types**: Issue types used by your teams

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

The `issue-create.sh` tool supports GitHub's native issue types (Bug, Feature, Task). To customize your organization's issue types:

### Getting Your Organization's Issue Type IDs

Before configuring `issues-config.yml`, get the issue type IDs from your GitHub organization using the CLI:

```bash
gh api graphql -f query='query { 
  organization(login: "YOUR_ORG") { 
    issueTypes(first: 100) { 
      edges { 
        node { 
          id 
          name 
        } 
      } 
    } 
  } 
}' | jq '.data.organization.issueTypes.edges[] | {name: .node.name, id: .node.id}'
```

Example output:

```json
{
  "name": "Bug",
  "id": "IT_kwDOCk-E0c4BWVJJ"
}
{
  "name": "Feature",
  "id": "IT_kwDOCk-E0c4BWVJK"
}
```

### Configure Issue Types

Edit `tools/config/issues-config.yml` to define your organization's issue types with their IDs:

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

Each type must have:

- **name**: The issue type name (displayed in GitHub UI)
- **description**: Human-readable description for users selecting a type
- **id**: GitHub organization-level issue type ID (required for setting types via API)

### Syncing with GitHub Organization Settings

Your `issues-config.yml` must include the issue type IDs from your GitHub organization. The issue types you define in GitHub's UI will appear as native types in your repositories' issue creation workflow.

To add or modify issue types in GitHub:

1. Go to your **GitHub Organization Settings**
2. Navigate to **Planning** section
3. Click on **Issue types**
4. From there, you can:
   - **Create** new issue types
   - **Edit** existing ones (name, icon, description)
   - **Disable/Delete** issue types you no longer need

After making changes in GitHub, get the updated IDs using one of the methods above and update your `issues-config.yml` file. Keep your `issues-config.yml` synchronized with these settings so that `issue-create.sh` properly validates and applies them.

### Example: Custom Issue Types

If your organization uses different issue categories:

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
issue_types=story,bug
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
issue_types=story,bug
```

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
