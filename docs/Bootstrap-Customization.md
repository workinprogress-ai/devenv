# Bootstrap Customization Guide

## Overview

The devenv bootstrap process is now modular and customizable. All bootstrap functions are defined in [`.devcontainer/bootstrap.bash`](../.devcontainer/bootstrap.bash), a library that can be sourced and used selectively in custom bootstrap scripts.

This design allows anyone forking this repository to:

- Pick and choose which bootstrap functions to run
- Override specific functions with custom implementations
- Add their own bootstrap tasks
- Create completely custom bootstrap flows

## Architecture

### Files

1. **`.devcontainer/bootstrap.bash`** - Bootstrap function library
   - Contains all bootstrap functions
   - Can be sourced independently
   - Provides `run_tasks()` function for executing bootstrap steps

2. **`.devcontainer/bootstrap.sh`** - Main bootstrap entry point
   - Sources `bootstrap.bash`
   - Runs all default bootstrap tasks
   - Can accept specific task names as arguments

3. **`.devcontainer/custom-bootstrap.sh`** (optional)
   - Run automatically at the end of default bootstrap
   - For organization-specific customizations
   - Not tracked in git (add to `.gitignore`)

## Default Bootstrap Flow

The default bootstrap process executes these tasks in order:

1. `init_bootstrap_run_time` - Initialize timing tracking
2. `initialize_paths` - Set up core path variables
3. `detect_architecture` - Detect ARM vs x86
4. `ensure_home_is_set` - Ensure HOME variable is set
5. `load_version_info` - Load version from git tags
6. `load_config` - Load and validate devenv.config
7. `prepare_install_directories` - Create installation directories
8. `reset_bashrc_to_original` - Reset bashrc to clean state
9. `install_os_packages_round1` - Install base OS packages
10. `add_specialized_repositories` - Add HashiCorp, Kubernetes repos
11. `install_os_packages_round2` - Install specialized packages
12. `install_dotnet` - Install .NET SDK
13. `download_container_scripts` - Download helper scripts
14. `load_setup_credentials` - Load credentials from .setup/
15. `write_bash_functions_file` - Create bash functions
16. `generate_env_vars_file` - Generate environment variables
17. `create_tool_symlinks` - Create tool symlinks
18. `write_devenvrc` - Write shell configuration
19. `append_bashrc` - Update .bashrc
20. `install_or_configure_nvm` - Install/configure nvm
21. `configure_dotnet_tools` - Configure .NET tools
22. `install_node_packages` - Install Node.js packages
23. `configure_git` - Configure git globally
24. `ensure_directories_and_settings` - Create required directories
25. `install_repo_dependencies` - Install devenv repo dependencies
26. `configure_nuget_sources` - Configure NuGet sources
27. `configure_user_npmrc` - Configure npm registry auth
28. `run_custom_bootstrap_if_present` - Run custom bootstrap if exists
29. `cleanup_packages` - Clean up apt packages
30. `record_bootstrap_run_time` - Record completion time
31. `finish_message` - Display completion message

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
git config --global url."https://github.com/my-org/".insteadOf "https://gh/"

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
run_tasks \
    initialize_paths \
    load_config \
    install_os_packages_round1 \
    configure_git \
    finish_message
```

### Option 3: Override Functions

Source the library and override specific functions:

```bash
#!/bin/bash
# my-custom-bootstrap.sh

source "$(dirname "${BASH_SOURCE[0]}")/bootstrap.bash"

# Override the git configuration function
configure_git() {
    echo "# Custom git configuration"
    git config --global user.name "My Name"
    git config --global user.email "myemail@example.com"
    # Add custom git aliases
    git config --global alias.co checkout
    git config --global alias.br branch
}

# Run all tasks (including overridden one)
run_tasks
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
run_tasks \
    init_bootstrap_run_time \
    initialize_paths \
    load_config \
    install_os_packages_round1 \
    install_my_tools \
    configure_git \
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
    TASKS=(
        initialize_paths
        add_specialized_repositories
        install_os_packages_round2  # Includes kubectl
    )
else
    TASKS=(
        initialize_paths
        install_os_packages_round1  # Basic packages only
    )
fi

run_tasks "${TASKS[@]}"
```

## Available Bootstrap Functions

### Core Setup Functions

- `initialize_paths` - Initialize all path variables
- `load_config` - Load and validate devenv.config
- `detect_architecture` - Detect CPU architecture
- `ensure_home_is_set` - Ensure HOME is set
- `load_version_info` - Load version from git tags
- `prepare_install_directories` - Create .installs directory

### Package Installation Functions

- `install_os_packages_round1` - Install base packages (curl, wget, git, etc.)
- `add_specialized_repositories` - Add HashiCorp and Kubernetes repos
- `install_os_packages_round2` - Install terraform, kubectl
- `install_dotnet` - Install .NET SDK
- `install_or_configure_nvm` - Install/configure Node Version Manager
- `install_node_packages` - Install global npm packages
- `install_repo_dependencies` - Install devenv repo dependencies

### Configuration Functions

- `reset_bashrc_to_original` - Reset .bashrc to original state
- `load_setup_credentials` - Load credentials from .setup/
- `write_bash_functions_file` - Create shell functions file
- `generate_env_vars_file` - Generate environment variables
- `create_tool_symlinks` - Create symlinks for tools
- `write_devenvrc` - Write shell configuration
- `append_bashrc` - Append devenvrc sourcing to bashrc
- `configure_dotnet_tools` - Install .NET global tools
- `configure_git` - Configure git settings
- `configure_nuget_sources` - Configure NuGet package sources
- `configure_user_npmrc` - Configure npm registry authentication
- `ensure_directories_and_settings` - Create directories and system settings

### Helper Functions

- `call_npm` - Run npm with output filtering
- `add_nuget_source_if_not_exists` - Add NuGet source if not present
- `download_container_scripts` - Download helper scripts
- `cleanup_packages` - Clean up apt packages
- `on_error` - Error handler

### Lifecycle Functions

- `init_bootstrap_run_time` - Initialize bootstrap timing
- `record_bootstrap_run_time` - Record completion time
- `run_custom_bootstrap_if_present` - Run org-custom-bootstrap.sh and user-custom-bootstrap.sh if they exist
- `finish_message` - Display completion message
- `run_tasks` - Execute a list of bootstrap tasks

## Testing Custom Bootstrap

To test your organization-level bootstrap without rebuilding the container:

```bash
# Run your organization bootstrap script directly
bash /workspaces/devenv/.devcontainer/org-custom-bootstrap.sh

# Or test user-level bootstrap
bash /workspaces/devenv/.devcontainer/user-custom-bootstrap.sh

# Run specific tasks from bootstrap.bash
cd /workspaces/devenv/.devcontainer
source bootstrap.bash
configure_git
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

run_tasks \
    initialize_paths \
    load_config \
    configure_git \
    create_tool_symlinks \
    write_devenvrc \
    append_bashrc
```

### Cloud-Only Bootstrap (CI/CD)

```bash
#!/bin/bash
# Cloud-only bootstrap for CI/CD environments

source "$(dirname "${BASH_SOURCE[0]}")/bootstrap.bash"

# Skip interactive tools, focus on build dependencies
run_tasks \
    initialize_paths \
    load_config \
    install_dotnet \
    install_node_packages \
    configure_nuget_sources
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
    echo "# Configuring compliance requirements"
    git config --global commit.gpgsign true
    # Additional compliance setup
}

# Run full bootstrap with enterprise additions
run_tasks \
    initialize_paths \
    load_config \
    install_os_packages_round1 \
    install_security_tools \
    configure_git \
    configure_compliance \
    finish_message
```

## Troubleshooting

### Bootstrap fails on specific task

Run tasks individually to isolate the issue:

```bash
source /workspaces/devenv/.devcontainer/bootstrap.bash
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
run_tasks \
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
run_tasks
```

## See Also

- [Dev Container Environment](./Dev-container-environment.md) - Development container overview
- [Customization Guide](./Devenv-Customization.md) - General customization options
- [Contributing Guide](./Contributing.md) - How to contribute improvements
