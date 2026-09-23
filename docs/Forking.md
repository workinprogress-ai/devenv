# Forking Guide

If you've forked this repository for your organization, this guide tells you what you may change safely, what you must override deliberately, and how to adapt the environment to a different git/work-item provider — Azure DevOps first among them. The devenv separates *what a fork decides* (values in config, policy modules, provider modules, protocol references) from *how the tooling works* (everything else), so upstream changes keep merging with minimal conflict.

The essentials live in `devenv.config`; repository-creation standards live in `tools/config/repo-types.yaml`; issue-type vocabulary lives in `tools/config/issues-config.yml`; provider behavior lives in `tools/lib/providers/<provider>/`.

## Quick Checklist

- ✅ Read [The fork-stable surfaces contract](#the-fork-stable-surfaces-contract) below — it defines what you may change without carrying maintenance burden
- ✅ Update `devenv.config` for org identity (the neutral `org` key; the legacy `github_org` still works as a fallback), provider name, container name, workflows, and bootstrap defaults
- ✅ (If you customize the issue workflow) Read [Issue Workflow](./Issue-Workflow.md) first — the `[workflows]` vocabulary carries engine contracts, documented in its section below. You will need to re-write [Issue Workflow](./Issue-Workflow.md) to reflect your workflow.
- ✅ (If you use issue creation tooling) Update `tools/config/issues-config.yml` with your organization's issue types and provider issue-type IDs
- ✅ (If you adapt to a non-GitHub provider) Follow [Adapting to Azure DevOps](#adapting-to-azure-devops) — provider modules, protocol reference, and config keys
- ✅ (If you use repo creation tooling) Update `tools/config/repo-types.yaml` for naming, templates, branch protection, and post-creation scripts
- ✅ (Optional) Update `copilot/copilot-instructions.md` with organization-specific AI coding guidelines
- ✅ (Optional) Add custom Copilot skills to `copilot/skills/` for domain-specific workflows
- ✅ (Optional) Configure shared Copilot knowledge sync in `devenv.config` (`[copilot]` section)
- ✅ (Optional) Create `org-custom-bootstrap.sh` and `org-custom-startup.sh` for organization-wide customizations
- ✅ Create/adjust template repos per type (recommended) so new repos start with CI, CODEOWNERS, and hooks

## The fork-stable surfaces contract

The devenv keeps a deliberately small set of fork-owned surfaces. **Everything inside these surfaces is yours** — change values, add modules, rewrite content. **Everything outside them is upstream-stable**: upstream changes should merge cleanly, and local edits there are maintained at your own cost.

| # | Surface | Path(s) | What a fork changes here |
| - | ------- | ------- | ------------------------ |
| 1 | Data policy (config values) | `devenv.config`, `tools/config/issues-config.yml` | Org identity, provider name, workflow vocabulary, issue types, staleness thresholds, nuget/npm feeds |
| 2 | Behavior policy (policy overrides) | `tools/lib/policy/*.bash` | Org policy decisions as config-driven knobs (`policy_define` accessors) — see the [policy library README](../tools/lib/policy/README.md) for the full knob catalog |
| 3 | Provider modules | `tools/lib/providers/*` | Add or replace per-provider domain modules; set `[provider] name`; manage the token-env allowlist — see the [provider abstraction README](../tools/lib/providers/README.md) |
| 4 | Provider protocol references | `copilot/skills/_shared/references/provider-protocols/<provider>.md` | The concrete wrapper signatures, env vars, config paths, and invocation recipes the skills point at. A fork replaces `github.md` with its own provider's file; skill bodies don't change |
| 5 | Shared references a fork may re-skin | `copilot/skills/common/references/*.md` (e.g. `issue-creation.md`) | Provider-coupled phrasing inside shared skill references |

**One deliberate exception:** `setup` (and the bootstrap flow it feeds) is git-host-oriented by nature. The working assumption is that any fork **rewrites `setup`** rather than adapting it. It is neither fork-stable nor upstream-stable — treat it as fork-replaced, and expect upstream changes to `setup` to need manual reconciliation.

Everything not listed in the table and not named as an exception follows the upstream-stable rule: prefer expressing a difference through a config key, a policy knob, a provider module, or a protocol reference. If none of those fit, raise it upstream — a new override point benefits every fork.

## Provider configuration

The tools layer talks to the git host and work-item provider through an abstraction, not directly. The active provider is a config value:

```ini
[provider]
name=github
# token_env_allowlist=  # escape hatch: space-separated env-var names honored
                         # as token sources despite the keychain-first policy
```

- **name**: Which module set under `tools/lib/providers/<name>/` answers the `provider_<domain>_<verb>` facade calls. Default `github`; forks adapting to another backend change this key (see [Adapting to Azure DevOps](#adapting-to-azure-devops)).
- **token_env_allowlist**: Session-scoped token exports are ignored by default — credentials resolve env-if-allowlisted → keychain → error. The allowlist ships empty; add entries only with a documented justification (see the [provider abstraction README](../tools/lib/providers/README.md)).

Dispatch is by naming convention with no registry: adding a provider means adding module files — the core never changes. Domain modules and scripts never read token env vars directly; they call `provider_secret_get`, so the credential backing store swaps in behind the seam. Rotation runs through `key-update-git` (imports via the provider auth seam into the keychain and wires the git credential helper — no token ever lands in env files or remote URLs).

### Capability flags

Providers differ in what they support. GH-only surfaces — rulesets, project boards, native issue types, releases, CI pipelines — are declared capabilities. Modules gate those code paths with `provider_require_capability`, which fails with a defined "provider does not support this" error instead of failing mid-command. A fork's provider module declares the capabilities it honors; scripts degrade or substitute accordingly (labels-based typing instead of native types, for example).

## Adapting to Azure DevOps

The ADO path follows the fixed minimal mapping from the provider-agnostic effort (epic #29, slice 7):

| Concept | GitHub (as-built) | Azure DevOps mapping |
| ------- | ----------------- | -------------------- |
| Project scope | Organization → repos | **Single project** per devenv instance |
| Work item types | Native issue types (Bug/Feature/Task/Epic) | **Type map**: ADO work item types via `[issues]`/`issues-config.yml` values |
| Repo ↔ area | Org-wide area paths | **area-path = repo** (one area path per repository) |
| Board states | Project Status field | **board columns = `status_workflow`** — the `[workflows]` vocabulary drives column names |
| Auth | PAT in keychain via credential helper | **PAT auth** — same keychain-first seam, ADO token store behind `provider_auth_import_token` |

Procedure:

1. **Copy the protocol reference** — duplicate `copilot/skills/_shared/references/provider-protocols/github.md` to `ado.md` and adapt the wrapper signatures, env-var names, and invocation recipes to ADO's CLI/API. Skill bodies keep pointing at the reference by name; the file swap is the fork surface.
2. **Add provider modules** — create `tools/lib/providers/ado/` with domain modules answering the `provider_<domain>_<verb>` calls (`issues`, `prs`, `repos`, `actions`, …). Start from the GitHub modules as templates; replace the transport, keep the function signatures.
3. **Flip the config key** — set `[provider] name=ado` in `devenv.config`.
4. **Map the capabilities** — decide which GH-only capabilities your ADO setup substitutes: rulesets → ADO branch policies, project boards → board columns over `status_workflow`, native issue types → ADO work item type map. Gate what you don't support; degrade what you substitute.
5. **Replace provider-specific config values** — native type IDs in `issues-config.yml` (GitHub `IT_kwDO…` IDs, discovered via the GraphQL recipe in that file's header) and the nuget feed URL (`nuget.pkg.github.com/...`) are GitHub-specific values a fork replaces.
6. **Rewrite `setup`** — per the contract exception above, credential intake and bootstrap wiring are expected to be fork-replaced for a new provider.

## Copilot Instructions

The file `copilot/copilot-instructions.md` contains AI coding guidelines that apply to the repository in VS Code (GitHub Copilot reads this file automatically when it exists in the workspace). During bootstrap, `~/.copilot/copilot-instructions.md` is **symlinked** to this file, making the same instructions available as the user-level Copilot instructions file.

When forking, you have two options:

1. **Write your own instructions in-place** — update `copilot/copilot-instructions.md` directly with your organization's conventions, code style, and AI guidance. Bootstrap will symlink it to `~/.copilot/copilot-instructions.md` automatically.

2. **Symlink to a different file** — if you prefer to keep your Copilot instructions elsewhere (e.g. in a shared config repo or a different path), create `~/.copilot/copilot-instructions.md` as a symlink to that file before or after bootstrap runs. The `install_copilot_instructions` task will detect the existing symlink and leave it untouched, regardless of where it points.

## Copilot Skills

This repository ships with a suite of slash-command skills that cover the full development lifecycle — from issue triage through PR review. They live in `copilot/skills/` and are invoked with `/skill-name` in Copilot Chat. The full catalog lives in [docs/Skills.md](./Skills.md); it is the source of truth for what ships, so this guide intentionally does not repeat a count.

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

4. **Register the skill for `/devenv-help` discoverability** — append a row to the appropriate category table in `copilot/skills/devenv-help/references/skills-registry.md`. This is the single file the `devenv-help` routing skill reads; without an entry here, the skill won't be surfaced when users ask "which skill should I use".

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

## Configuring within the surfaces: devenv.config reference

This section is the reference for the config keys a fork most commonly changes. Surface #1 of the contract — everything here is a data value, not code.

Edit `devenv.config` in the root directory:

### [organization]

```ini
[organization]
name=YourOrg
github_org=your-org
email_domain=yourorg.com
```

- **name**: Organization name (for docs/branding)
- **github_org**: Git host org/user used for cloning and feeds (the name predates provider neutrality and remains the as-built key)
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
status_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production
# Staleness thresholds (days) for project-manager Assess/Recommend passes.
stale_to_groom_days=14
stale_ready_days=21
stale_implementing_days=30
stale_tbd_days=7
```

- **status_workflow**: The issue status vocabulary, ordered. Everything downstream — project boards, the workflow engine, `workflow-signal`, parent status rollup — reads this single key.
- **stale_to_groom_days**: How long an issue may sit in `To-Groom` before `/devenv-board` flags it as stale (Assess findings, grooming-candidate recommendations).
- **stale_ready_days**: Inactivity threshold for `Ready` items (ready but nobody picking them up).
- **stale_implementing_days**: Inactivity threshold for in-flight items (`Implementing`, `Review`-adjacent work that has gone quiet).
- **stale_tbd_days**: How long an untriaged `TBD` issue may wait before it surfaces in hygiene sweeps.

All four are read via `config-read workflows <key>` — never hard-coded in skills. Tune per org; the defaults fit a two-week delivery cadence.

This is **not a free-form list**: the engine derives behavior from the vocabulary's shape. If you customize it, keep the contract:

1. **Two ordered halves.** Workflow states first (planning and implementation states), delivery states after (merge/deploy states). The split is the delivery boundary.
2. **`Implementing` is the load-bearing boundary token.** The engine locates the delivery boundary by looking up `Implementing` in this list — it drives the rollup floor (pre-delivery children of an active parent count as Implementing) and the "workflow states cannot be forced" gate. Keep the token name, or update both lookups in `tools/lib/workflow-core.bash`.
3. **`TBD` and `Ready` are the birth tokens.** New issues are born at `TBD`; a Task created under a parent is born `Ready`. Renaming either requires updating the birth rule in `tools/scripts/issue-create.sh`.
4. **`tools/config/skill-events.yml` names statuses too.** Every event's `status:` value must exist in `status_workflow` — rename there in the same change or signals will write statuses no board defines.

Safe rename/reorder procedure:

1. Edit `status_workflow` in `devenv.config`.
2. Update the matching `status:` values in `tools/config/skill-events.yml`.
3. If you renamed `Implementing`, `Ready`, or `TBD`, update the boundary lookups in `tools/lib/workflow-core.bash` and the birth rule in `tools/scripts/issue-create.sh`.
4. Migrate live board cards to the new names (project fields hold the old strings — the engine treats foreign values as unreadable).
5. Run the test suites (`bats tools/tests/lib tools/tests/scripts`) — the workflow suites fail loudly on contract breaks.
6. Re-write [Issue Workflow](./Issue-Workflow.md) to reflect the updated status workflow.

Do not duplicate states, and do not interleave the two halves — status derivation (minimum-state rollup) is order-sensitive by design. The semantics each state carries, and what moves a card, are documented in [Issue Workflow](./Issue-Workflow.md); that guide is the model, this section is only the customization contract.

### [copilot]

```ini
[copilot]
knowledge_repo=https://github.com/workinprogress-ai/docs.copilot-knowledge.git
knowledge_subpath=copilot-knowledge/
engineering_repo=docs.engineering
```

- **knowledge_repo**: Git repository URL for shared Copilot knowledge assets.
- **knowledge_subpath**: Folder inside that repository that should be linked to `~/.copilot/knowledge`.
- **engineering_repo**: Git repository URL for the engineering standards repo — imported with the same bootstrap/container-start machinery as knowledge, canonical copy at `copilot/engineering/`, linked to `~/.copilot/engineering`. Skills read it through the link; modifications happen in `repos/docs.engineering/` via branches/PRs. Forks may point it at their own standards repo without editing any skill. See [Knowledge & Engineering Patterns](./Knowledge-and-Engineering-Patterns.md).
- **engineering_subpath**: Folder inside the engineering repo to link as `~/.copilot/engineering` (empty = repo root).

Behavior:

- During bootstrap, devenv clones or pulls `knowledge_repo` into `copilot/knowledge` using credentials resolved through the provider secret seam (keychain-first; no token is exported into the environment).
- It then symlinks `~/.copilot/knowledge` to `copilot/knowledge/<knowledge_subpath>`.
- During `devenv-update`, devenv refreshes that repo and updates the symlink target automatically.
- On container start, devenv runs a non-blocking pull for `copilot/knowledge` (when it is a git repo) via `pull_copilot_knowledge_on_container_start` in `tools/lib/copilot-knowledge.bash`.

These three keys wire the whole repo constellation — the machine-managed knowledge clone, its `repos/` modification workspace, and the engineering-standards clone. For the full relationship map (who manages which copy, what refreshes when, where edits go), see [How devenv relates to the sub-repos](./Knowledge-and-Engineering-Patterns.md#how-devenv-relates-to-the-sub-repos).

### [bootstrap]

```ini
[bootstrap]
validate_config=true
```

- **validate_config**: Validate config on startup (recommended: true)

## Repo Creation Standards (repo-create.sh)

> **Provider capability note:** rulesets, templates, merge-button control, Discussions, and most of the toggles below are GitHub-provider capabilities (gated by `provider_require_capability` in the modules). A fork on a provider without them either substitutes (ADO branch policies for rulesets) or leaves them unset — creation degrades with a warning, not a failure.

If you use `tools/scripts/repo-create.sh`, configure `tools/config/repo-types.yaml`:

### Configuration per type

- **Naming**: `naming_pattern` and `naming_example` per type (e.g., `service.<category>.<descriptor>`, `gateway.<category>.<descriptor>`, `app.web.<descriptor>`, `lib.cs.<category>.<descriptor>`)
- **Templates**: `template` per type (or null) to pre-bake CI, CODEOWNERS, and .repo scripts
- **Template marking**: `isTemplate` (boolean, default: false) marks the repository as a template, making it available for use with the provider's "use as template" flow
- **Post-creation**: `post_creation_script`, `delete_post_creation_script`, and `post_creation_commit_handling` (`none|amend|new`)
- **Merge types**: `allowedMergeTypes` - Controls which merge buttons appear in the provider's PR UI (merge|squash|rebase)
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
- **Discussions**: `hasDiscussions` (boolean, default: false) - Enable provider-hosted Discussions
  - Useful for community-driven projects or public repositories
  - Provides a forum-like space separate from issues
- **Projects**: `hasProjects` (boolean, default: false) - Enable the Projects tab visibility
  - Controls whether the "Projects" tab appears in the repository navigation
  - Note: This only affects visibility/convenience - issues can be added to provider Projects regardless of this setting
  - Disable if using external project management tools (Jira, Azure DevOps, etc.) or want to reduce tab clutter
  - Enable only if your team actively uses provider Projects and wants easy access from the repo interface
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
  - `COMMIT_OR_PR_TITLE` - Use the first commit message title or PR title (the provider's original default)
- **Squash commit message**: `squashMergeCommitMessage` (string, default: COMMIT_MESSAGES) - Format for squash merge commit message body
  - `PR_BODY` - Use the pull request description
  - `COMMIT_MESSAGES` - Use all commit messages from the PR (preserves commit history in message)
  - `BLANK` - No commit message body (clean single-line commits)
- **Provider UI mapping** for squash merge settings:
  - "Use PR title": `title=PR_TITLE, message=BLANK`
  - "Use PR title and commit details": `title=PR_TITLE, message=COMMIT_MESSAGES` (default)
  - "Use PR title and description": `title=PR_TITLE, message=PR_BODY`
  - "Default message": `title=COMMIT_OR_PR_TITLE, message=COMMIT_MESSAGES`
- **Rulesets** (GitHub capability: Pro/public repos only; see the capability note above):
  - `rulesetConfigFile`: Path to JSON ruleset file in `tools/config/` (e.g., `ruleset-default.json`)
  - Set to `null` or blank to disable rulesets for a type
  - JSON file is a provider ruleset export (GitHub ruleset export today) with token placeholders: `{{repo_name}}`, `{{owner}}`, `{{type_name}}`, `{{type_description}}`
  - Ruleset can also specify `allowed_merge_methods` for protected branches (more restrictive than repo-level setting)
- **Access**: `access` - List of teams or users with their permission levels (optional)
  - If not specified, no default permissions are applied (repository uses organization defaults)
  - Each entry contains:
    - `name`: Team or user name (provider team slug or username)
    - `type`: `team` or `user` (default: team)
    - `permission`: Provider repository permission level:
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

## Issue Types Configuration (issue-create.sh)

> **Provider capability note:** native issue types are a GitHub-provider capability (`native-issue-types`). A fork without the capability runs the same type vocabulary as labels via the `[issues] types` policy knob — see the [policy library README](../tools/lib/policy/README.md). The `IT_kwDO…` IDs and the GraphQL discovery recipe in `issues-config.yml`'s header are GitHub-specific values.

The `issue-create.sh` tool supports native issue types on providers that declare the capability. Issue types are configured in `tools/config/issues-config.yml`, which is the single source of truth for type names, descriptions, and provider API IDs.

Type names are **load-bearing** for the workflow model: Features and Bugs are deliverables, Tasks are work toward someone else's change (the only type that nests, and the only one born `Ready` under a parent — `issue-create.sh` string-matches `Task` for that birth rule), and Epics group deliverables. Keep these four names, or update the birth rule and the `planning.type_mapping` consumers when renaming. See [Issue Workflow](./Issue-Workflow.md) for the roles.

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

- **name**: The issue type name (displayed in the provider UI and used for validation)
- **description**: Human-readable description for users selecting a type
- **id**: Provider organization-level issue type ID (required for setting types via API; GitHub `IT_kwDO…` IDs today)

### Getting Your Organization's Issue Type IDs (GitHub-native path)

Get the IDs from your GitHub organization using the workspace wrapper (one-time setup inspection — day-to-day issue operations always go through the `issue-*` tools):

```bash
issue-types --format json
```

### Syncing with GitHub Organization Settings (GitHub-native path)

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

Note: Replace the `id` values with your actual organization's issue type IDs from the provider.

### Planning Type Mapping

The `planning` section in `issues-config.yml` maps concepts from a specifications document to issue types (GitHub native types on the GitHub-native path). This is used when creating issues from a specifications document to determine which issue type to assign for each level of the document hierarchy.

```yaml
planning:
  type_mapping:
    phases: Epic
    features: Feature
    tasks: Task
```

Each key under `type_mapping` corresponds to a concept in a specifications document:

- **phases**: High-level project phases, mapped to an issue type (default: `Epic`). Note the workspace convention: Epic means a long-lived orchestration issue coordinating multiple repos/efforts — for single-repo deliverable phases, map `phases` to `Feature` instead.
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

1. Configure a ruleset manually in the provider UI (GitHub UI today)
2. Export it via the workspace wrapper: `policy-export <RULESET_ID> --output <file>` (list IDs first with `policy-export`)
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
status_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged
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
status_workflow=TBD,To-Groom,Ready,Implementing,Review,Testing,Merged,Staging,Production
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

Scripts live in `tools/scripts/<name>.sh`. Depth-1 entries at `tools/<name>` (without the `.sh` extension) are generated — not hand-made: `.devcontainer/entry-stubs-sync.sh` (run by bootstrap and by the test runner) creates a stub for every `tools/scripts/` script except underscore-prefixed internal scripts (`_*.sh` get no depth-1 entry — call them via their `tools/scripts/` path). Never hand-edit or hand-create a stub.

1. **Start from the template**: `tooling-create-script <name>` scaffolds the file from `tools/templates/script-template.sh`.
2. **File location**: `tools/scripts/<group>-<action>.sh`, following the existing `group-action` naming pattern (e.g. `markdown-plan-complete-task.sh`).
3. **Entry point**: none needed by hand — run `.devcontainer/entry-stubs-sync.sh` (or bootstrap) and the `tools/<name>` stub is generated automatically.

4. **Standard structure** (in order):
   - Shebang + header comment (name, version, description, specifications)
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

## What stays upstream

The [fork-stable surfaces contract](#the-fork-stable-surfaces-contract) at the top of this guide is the authoritative list of what you may change freely. Everything outside it — test infrastructure, error-handling libraries, git configuration helpers, version comparison logic, core script templates, the bootstrap framework, and the tooling library structure — is upstream-stable: keep it unmodified and upstream improvements keep flowing to your fork with minimal conflict.

When you need a difference the surfaces can't express, add an override point (a policy knob, a config key, a capability gate) and contribute it upstream — a new override point benefits every fork.

## Advanced Customization

For deeper bootstrap tweaks, see [Bootstrap-Customization.md](./Bootstrap-Customization.md) (modular tasks, overrides, env-based flows).

## Contributing Improvements Back

1. Fork the main devenv repository
2. Create a feature branch
3. Make your improvements
4. Ensure all tests pass (`bash tools/tests/run-devenv-tests.sh`)
5. Submit a pull request

See the [Tooling Standards](./Tooling-Standards.md) guide for the testing and linting bar your changes must meet.

## Getting Help

- Check the `docs/` folder for feature-specific topics
- Review test files in `tools/tests/` for usage examples
