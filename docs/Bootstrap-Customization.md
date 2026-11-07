# Bootstrap Customization Guide

## Overview

The devenv bootstrap process is modular and customizable. The bash bootstrap ([`.devcontainer/bootstrap.bash`](../.devcontainer/bootstrap.bash)) is the **thin pre-node stage**: paths, config read, seed checks, the provider token gate, and node resolution — everything after node exists belongs to the TypeScript setup orchestrator (`tools/ts/setup.ts`).

This design allows anyone forking this repository to:

- Pick and choose which bootstrap functions to run
- Override specific functions with custom implementations
- Add their own bootstrap tasks
- Create completely custom bootstrap flows

## The two-stage bootstrap

Provisioning runs in two stages:

1. **bash stage** (`.devcontainer/bootstrap.bash`) — the thin pre-node
   stage: paths, minimal config read (provider seam + identity), seed-file
   checks, the provider token gate, and node resolution. The container image
   guarantees node (the `node:1` feature, pinned in `devcontainer.json`);
   the stage resolves it onto PATH — it does not install one.
2. **TypeScript stage** (`run_setup_first_run` →
   `tools/ts/setup.ts --all`) — everything else: OS packages, dotnet, node
   globals (pnpm/turbo), repo dependencies, and everything that composes the
   workspace (env vars, bashrc integration, credentials, tool symlinks,
   copilot/claude integration, side-repo syncs, package sources). It runs
   non-interactively and idempotently; every step is safe to re-run, and
   `run_update_tasks` re-executes it on container updates.

The handoff point is deliberate: the TS stage only starts once `node` is
installed. If node is missing or broken, `run_setup_first_run` prints the
manual recovery path (`node tools/ts/setup.ts --all`) instead of
failing obscurely. The step functions the TS stage calls live in
TypeScript step modules under `tools/ts/setup-steps/`; they retired to TypeScript as their provisioning
steps become TS-native.

## Architecture

### Files

1. **`.devcontainer/bootstrap.bash`** - Bootstrap function library
   - Contains all bootstrap functions
   - Can be sourced independently
   - Provides `run_bootstrap_tasks()` for full bootstrap and `run_update_tasks()` for convergent reruns

2. **`.devcontainer/bootstrap.sh`** - Main bootstrap entry point
   - Sources `bootstrap.bash`
   - Runs all default bootstrap tasks
   - Can accept specific task names as arguments

3. **`.devcontainer/org-custom-bootstrap.sh`** (optional)
   - Run by `run_custom_bootstrap_if_present` near the end of the bootstrap (before cleanup)
   - For organization-wide customizations
   - Committed to the repository

4. **`.devcontainer/user-custom-bootstrap.sh`** (optional)
   - Run by `run_custom_bootstrap_if_present` right after the org script
   - For personal customizations (created by `devenv-add-custom-bootstrap`)
   - Not tracked in git (ignored)

## Default Bootstrap Flow

The default bootstrap process executes these tasks in order (mirrors the
`default_tasks` array in `run_bootstrap_tasks` in `.devcontainer/bootstrap.bash`
— that array is the source of truth):

1. `init_bootstrap_run_time` — clear the run-time markers, so a failed run is never read as completed
2. `initialize_paths` — set up core path variables
3. `require_setup_files` — verify the .setup/ prerequisites exist
4. `ensure_home_is_set` — ensure HOME variable is set
5. `ensure_bash_is_default_shell` — verify bash is the login shell
6. `load_version_info` — load version from git tags
7. `load_config` — load and validate devenv.config
8. `require_provider_token` — verify a provider credential is present
9. `prepare_install_directories` — create installation directories
10. `reset_bashrc_to_original` — reset bashrc to clean state (set `PRESERVE_BASHRC=1` to keep direct edits)
11. `install_yq` — install the yq YAML processor (verified download)
12. `run_setup_first_run` — resolve node onto PATH and run the setup orchestrator (`setup.ts --all`: OS packages, dotnet, node globals, repo deps, then all provisioning steps)
13. `record_bootstrap_run_time` — stamp the completed marker
14. `finish_message` — print the completion summary

## Update Bootstrap Flow

The convergent update runner executes `run_update_tasks` (used by `devenv-update`) and intentionally excludes destructive steps used for fresh installs.

- Included: the whole thin stage plus `setup.ts --all` (idempotent — every step reconciles), custom bootstrap hooks
- Excluded: `init_bootstrap_run_time`, `reset_bashrc_to_original`, `finish_message`

Important: when adding/reordering tasks in `run_bootstrap_tasks`, update `run_update_tasks` too unless the task is intentionally destructive.

## Customization Options

### Option 1: Organization-Level Custom Bootstrap Script

Create `.devcontainer/org-custom-bootstrap.sh` for organization-wide customizations that should be committed to the repository:

```bash
#!/bin/bash
# org-custom-bootstrap.sh - Runs automatically at end of default bootstrap
# This file is committed to the repository and applies to all developers

set -euo pipefail

echo "Running organization bootstrap..."

# Add organization-specific tools
sudo apt install -y company-vpn-client

# Configure organization-specific settings
git config --global url."https://<git-host>/my-org/".insteadOf "https://gh/"   # example: rewrite host prefixes to your org

# Set up organization services
echo "Starting company services..."
```

Similarly, create `.devcontainer/org-custom-startup.sh` for organization startup tasks that run each time the container starts.

### Option 1b: User-Level Custom Scripts

For personal customizations that should NOT be committed, use the helper commands:

```bash
# Add personal bootstrap commands
devenv-add-custom-bootstrap "echo 'Personal setup complete'"

# Add personal startup commands
devenv-add-custom-startup "echo 'Welcome back!'"
```

These create `user-custom-bootstrap.sh` and `user-custom-startup.sh` which are automatically ignored by git.

### Option 2: Selective Bootstrap

Create your own bootstrap script that runs only specific tasks:

```bash
#!/bin/bash
# my-minimal-bootstrap.sh

source "$(dirname "${BASH_SOURCE[0]}")/bootstrap.bash"

# Run only essential tasks
run_bootstrap_tasks \
    initialize_paths \
    load_config \
    install_yq \
    finish_message
```

### Option 3: Override Functions

Source the library and override specific functions:

```bash
#!/bin/bash
# my-custom-bootstrap.sh

source "$(dirname "${BASH_SOURCE[0]}")/bootstrap.bash"

# Add custom git aliases in a task that runs after the setup stage
# (git-config is a TS step — setup.ts's git-config module — not a bash
# function to override; augment it by running after the handoff).
my_git_aliases() {
    git config --global alias.co checkout
    git config --global alias.br branch
}

# Run the thin stage, then the setup orchestrator, then your additions
run_bootstrap_tasks initialize_paths load_config run_setup_first_run
my_git_aliases
```

### Option 4: Add Custom Tasks

Extend the bootstrap process with additional tasks:

```bash
#!/bin/bash
# extended-bootstrap.sh

source "$(dirname "${BASH_SOURCE[0]}")/bootstrap.bash"

# Define new custom tasks
install_my_tools() {
    echo "# Installing custom tools"
    curl -sSL https://my-tool.com/install.sh | bash
}

configure_my_services() {
    echo "# Configuring custom services"
    cp /custom/config.yml ~/.myservice/config.yml
}

# Run default tasks plus custom ones
run_bootstrap_tasks \
    init_bootstrap_run_time \
    initialize_paths \
    load_config \
    install_yq \
    install_my_tools \
    run_setup_first_run \
    configure_my_services \
    finish_message
```

### Option 5: Environment-Based Bootstrap

Use environment variables to control bootstrap behavior:

```bash
#!/bin/bash
# conditional-bootstrap.sh

source "$(dirname "${BASH_SOURCE[0]}")/bootstrap.bash"

# Conditional task list based on environment
if [ "${INSTALL_KUBERNETES:-false}" = "true" ]; then
    # Kubernetes arrives via setup.ts's apt-repos + apt-packages-extra steps;
    # custom forks needing a bespoke apt set should do it in a custom task.
    TASKS=(
        initialize_paths
        load_config
        run_setup_first_run
    )
else
    TASKS=(
        initialize_paths
        load_config
        run_setup_first_run
    )
fi

run_bootstrap_tasks "${TASKS[@]}"
```

## Available Bootstrap Functions

### Thin-Stage (bash) Functions

- `initialize_paths` - Initialize all path variables
- `load_config` - Load and validate devenv.config (provider seam + identity)
- `ensure_home_is_set` - Ensure HOME is set
- `ensure_bash_is_default_shell` - Verify bash is the login shell
- `load_version_info` - Load version from git tags
- `prepare_install_directories` - Create .installs directory
- `install_yq` - Install the yq YAML processor (verified download)
- `require_setup_files` - Fail fast when the .setup/ seeds are missing
- `require_provider_token` - Ensure a provider credential is present (seed import / interactive paste)
- `resolve_node_on_path` - PATH-resolve the image's pinned node (17.0; no runtime install)
- `reset_bashrc_to_original` - Reset .bashrc to original state (set `PRESERVE_BASHRC=1` to preserve direct edits)
- `init_bootstrap_run_time` / `record_bootstrap_run_time` - bootstrap timing markers
- `run_setup_first_run` - The handoff: `node tools/ts/setup.ts --all`
- `finish_message` - Display completion message
- `run_custom_bootstrap_if_present` - Run org-custom-bootstrap.sh and user-custom-bootstrap.sh if they exist (a setup step; also callable directly)

### Setup-Stage Functions (TS step modules, `tools/ts/setup-steps/`)

Every retired bash provisioning function is now a step module invoked by
`setup.ts --all` (name in parentheses = the registry's step name):

- OS/toolchain: `apt-packages.ts` (apt-packages), `apt-repos.ts` (apt-repos),
  `apt-packages-extra.ts` (apt-packages-extra), `dotnet.ts` (dotnet),
  `dotnet-tools.ts` (dotnet-tools), `node-globals.ts` (node-globals),
  `repo-deps.ts` (repo-deps)
- Workspace composition: `credentials.ts` (credentials),
  `bash-functions.ts` (bash-functions), `env-vars.ts` (env-vars),
  `tool-symlinks.ts` (tool-symlinks), `devenvrc.ts` (devenvrc),
  `bashrc.ts` (bashrc), `git-config.ts` (git-config),
  `copilot-instructions.ts` (copilot-instructions),
  `claude-integration.ts` (claude-integration),
  `knowledge-sync.ts` (knowledge-sync), `engineering-sync.ts` (engineering-sync),
  `directories.ts` (directories), `nuget-sources.ts` (nuget-sources),
  `npmrc.ts` (npmrc), `custom-bootstrap.ts` (custom-bootstrap),
  `cleanup.ts` (cleanup)
- Shared: `provider-seam.ts` (token resolution + git auth header),
  `side-repo-sync.ts` (the clone/update engine behind both side-repo syncs)

## Testing Custom Bootstrap

To test your organization-level bootstrap without rebuilding the container:

```bash
# Run your organization bootstrap script directly
bash $DEVENV_ROOT/.devcontainer/org-custom-bootstrap.sh

# Or test user-level bootstrap
bash $DEVENV_ROOT/.devcontainer/user-custom-bootstrap.sh

# Run specific tasks from bootstrap.bash
cd $DEVENV_ROOT/.devcontainer
source bootstrap.bash
load_config
run_setup_first_run
install_my_tools
```

## Fork-Friendly Design

When forking this repository:

1. **Keep `bootstrap.bash` unchanged** - This is the shared library
2. **Modify `bootstrap.sh`** - Customize the default bootstrap flow if needed
3. **Add `org-custom-bootstrap.sh`** - Organization-wide setup (committed to repo)
4. **Add `org-custom-startup.sh`** - Organization-wide startup tasks (committed to repo)
5. **Update `devenv.config`** - Configure organization settings
6. **Document your changes** - Update this file with your customizations

Users can then add personal customizations using:

- `devenv-add-custom-bootstrap` - Adds commands to `user-custom-bootstrap.sh`
- `devenv-add-custom-startup` - Adds commands to `user-custom-startup.sh`

## Examples from Forks

### Minimal Bootstrap (Development Workstation)

```bash
#!/bin/bash
# Minimal bootstrap for local development workstations

source "$(dirname "${BASH_SOURCE[0]}")/bootstrap.bash"

run_bootstrap_tasks \
    initialize_paths \
    load_config \
    run_setup_first_run
```

### Cloud-Only Bootstrap (CI/CD)

```bash
#!/bin/bash
# Cloud-only bootstrap for CI/CD environments

source "$(dirname "${BASH_SOURCE[0]}")/bootstrap.bash"

# Skip interactive tools, focus on build dependencies
# Build deps arrive via setup.ts's dotnet/node-globals/nuget-sources steps;
# CI just needs the thin stage + the orchestrator.
run_bootstrap_tasks \
    initialize_paths \
    load_config \
    run_setup_first_run
```

### Full Enterprise Bootstrap

```bash
#!/bin/bash
# Enterprise bootstrap with additional security and compliance

source "$(dirname "${BASH_SOURCE[0]}")/bootstrap.bash"

install_security_tools() {
    echo "# Installing security scanners"
    curl -sSL https://security.enterprise.com/scanner.sh | bash
}

configure_compliance() {
    echo "# Configuring compliance specifications"
    git config --global commit.gpgsign true
    # Additional compliance setup
}

# Run full bootstrap with enterprise additions
run_bootstrap_tasks \
    initialize_paths \
    load_config \
    install_security_tools \
    run_setup_first_run \
    configure_compliance \
    finish_message
```

## Troubleshooting

### Bootstrap fails on specific task

Run tasks individually to isolate the issue:

```bash
source $DEVENV_ROOT/.devcontainer/bootstrap.bash
initialize_paths
load_config
# Run tasks one at a time
```

### Need to skip a task

Create custom bootstrap without that task:

```bash
#!/bin/bash
source bootstrap.bash

# Copy default tasks, remove the problematic one
run_bootstrap_tasks \
    init_bootstrap_run_time \
    initialize_paths \
    # ... (skip problematic task) ...
    finish_message
```

### Override behavior of existing function

```bash
#!/bin/bash
source bootstrap.bash

# Override the function
problematic_function() {
    echo "Skipping problematic function"
    return 0
}

# Run all tasks (using overridden version)
run_bootstrap_tasks
```

## See Also

- [Dev Container Environment](./Dev-container-environment.md) - Development container overview
- [Forking Guide](./Forking.md) - Fork-stable surfaces, provider adaptation, and customization options
- [Workflow Guide](./Workflow.md) - Delivery methodology and working agreements
