#!/bin/bash
# bootstrap.bash - Modular bootstrap library for devenv
# 
# This library contains all bootstrap functions that can be called individually
# or as a complete set. When forking this repository, you can source this library
# and call only the functions you need in your custom bootstrap script.
#
# Usage:
#   source /path/to/bootstrap.bash
#   run_bootstrap_tasks init_bootstrap_run_time initialize_paths ...
#
# Or call functions individually:
#   initialize_paths
#   load_config
#   install_os_packages_round1

# Guard against multiple sourcing
if [ -n "${_BOOTSTRAP_LOADED:-}" ]; then return 0; fi
_BOOTSTRAP_LOADED=1

# Provisioning bridge (temporary): the extracted provisioning half
# runs unchanged from provision-legacy.bash until the TypeScript
# first-time setup replaces it. Sourced, not exec'd — same shell,
# same exports, same behavior.
# FIXME:DEVENV[Plan-issue-72-001]: remove this bridge when the TS first-time setup (Phase 5) retires it
source "$(dirname "${BASH_SOURCE[0]}")/provision-legacy.bash"

# Error handler function
on_error() {
  local status=$?
  echo "An error occurred (exit status $status)${bootstrap_log:+; see $bootstrap_log}."
  exit 1
}

# NPM helper that filters out TLS warnings
call_npm() {
    npm "$@" 2>&1 | grep -v 'NODE_TLS_REJECT_UNAUTHORIZED is set to 0'
    return "${PIPESTATUS[0]}"
}

# Make sure a version constant from tool-versions.bash is set, loading that file
# (a sibling of this script) when it has not been: top-level sourcing of it
# no-ops when this library is sourced before initialize_paths sets DEVENV_ROOT.
# Usage: require_tool_version YQ_VERSION || return 1
require_tool_version() {
    local var_name="$1"
    if [ -z "${!var_name:-}" ]; then
        local _tv="${BASH_SOURCE[0]%/*}/tool-versions.bash"
        # shellcheck disable=SC1090 # source path is runtime-derived (sibling of this script)
        [ -f "$_tv" ] && source "$_tv"
    fi
    if [ -z "${!var_name:-}" ]; then
        echo "ERROR: $var_name is not set - tool-versions.bash could not be resolved" >&2
        return 1
    fi
}

# Download a file and verify its sha256 before anything uses it: on any failure
# or digest mismatch the file is removed and 1 is returned, so a caller can
# never act on unverified content. The pins live in tool-versions.bash.
# Usage: download_verified <url> <dest_file> <expected_sha256>
download_verified() {
    local url="$1" dest="$2" expected="$3" actual
    if [ -z "$expected" ]; then
        echo "ERROR: no sha256 pin for $url; refusing to download it unverified" >&2
        return 1
    fi
    if ! wget -q -O "$dest" "$url"; then
        rm -f "$dest"
        echo "ERROR: Failed to download $url" >&2
        return 1
    fi
    actual=$(sha256sum "$dest" | cut -d' ' -f1)
    if [ "$actual" != "$expected" ]; then
        rm -f "$dest"
        echo "ERROR: sha256 mismatch for $url (expected $expected, got $actual); refusing to use it. If this is a deliberate version bump, update the pin in tool-versions.bash." >&2
        return 1
    fi
}

# Initialize core paths used throughout bootstrap
initialize_paths() {
    script_path=$(readlink -f "$0")
    script_folder=$(dirname "$script_path")
    toolbox_root=$(dirname "$script_folder")
    devenv=$toolbox_root
    setup_dir=$toolbox_root/.setup
    # Consumed by the sourced provision-legacy library (load_setup_credentials);
    # ShellCheck cannot see the cross-file use.
    # shellcheck disable=SC2034
    name_file=$toolbox_root/.setup/name.txt
    # shellcheck disable=SC2034
    email_file=$toolbox_root/.setup/email.txt
    container_bootstrap_run_file="$HOME/.bootstrap_container_time"
    repo_bootstrap_run_file="$toolbox_root/.runtime/.bootstrap_run_time"
    config_file="$devenv/devenv.config"

    # Export early: the provider identity accessors (provider_org_get et al.)
    # fall back to DEVENV_ROOT/devenv.config when no explicit config path is
    # bound, and later tasks (debugger download, etc.) reference $DEVENV_ROOT
    # directly. Without this, those lookups resolve against an empty/root path.
    export DEVENV_ROOT="$toolbox_root"
    export DEVENV_TOOLS="$toolbox_root/tools"
}

# Load and initialize devenv.config file
load_config() {
    # Source the config-reader library
    local config_reader="$devenv/tools/lib/config-reader.bash"
    if [ ! -f "$config_reader" ]; then
        echo "ERROR: Config reader library not found at $config_reader"
        exit 1
    fi
    
    # Source config-reader
    # shellcheck source=../tools/lib/config-reader.bash
    source "$config_reader"
    
    # Config file is mandatory
    if [ ! -f "$config_file" ]; then
        echo "ERROR: devenv.config not found at $config_file"
        exit 1
    fi
    
    if ! config_init "$config_file"; then
        echo "ERROR: Failed to initialize config reader"
        exit 1
    fi

    # The identity check below calls the provider org accessor; the provider
    # seam must exist before this task runs (load_config precedes every other
    # accessor use, including the auth-status probe in load_setup_credentials).
    ensure_provider_seam

    # Org identity: config is the source; no session export (tools resolve
    # via the provider org accessor). Fail fast when unconfigured.
    if [ -z "$(provider_org_get 2>/dev/null || true)" ]; then
        echo "ERROR: org not configured in devenv.config [organization] section"
        exit 1
    fi

    # Optional Copilot knowledge repo settings.
    # knowledge_repo: if set, the repo is cloned/pulled into copilot/knowledge during bootstrap and update.
    # knowledge_subpath: subfolder inside the repo to link to ~/.copilot/knowledge.
    #   If empty or omitted, the entire repo root is linked.
    COPILOT_KNOWLEDGE_REPO=$(config_read_value "copilot" "knowledge_repo" "")
    COPILOT_KNOWLEDGE_SUBPATH=$(config_read_value "copilot" "knowledge_subpath" "")

    # Optional engineering standards repo settings (same import model as knowledge).
    # engineering_repo: if set, cloned/pulled into copilot/engineering and linked to ~/.copilot/engineering.
    # engineering_subpath: subfolder to link; empty or omitted links the repo root.
    COPILOT_ENGINEERING_REPO=$(config_read_value "copilot" "engineering_repo" "")
    COPILOT_ENGINEERING_SUBPATH=$(config_read_value "copilot" "engineering_subpath" "")

    export COPILOT_KNOWLEDGE_REPO
    export COPILOT_KNOWLEDGE_SUBPATH
    export COPILOT_ENGINEERING_REPO
    export COPILOT_ENGINEERING_SUBPATH
}

# Detect CPU architecture (ARM vs x86)
detect_architecture() {
    arch=$(uname -m)
    is_arm=$([ "$arch" == "aarch64" ] && echo 1)

    if [ "$is_arm" == "1" ]; then
        echo "ARM architecture detected"
    else
        echo "x86 architecture assumed"
    fi
}

# Ensure HOME environment variable is set
ensure_home_is_set() {
    if [[ -z "$HOME" ]]; then
        export HOME=/home/vscode
    fi
}

# Ensure bash is the default shell (unless changed later by install-extras/zsh.sh)
ensure_bash_is_default_shell() {
    local target_user="${SUDO_USER:-${USER:-vscode}}"
    local bash_path="/bin/bash"
    
    if getent passwd "$target_user" >/dev/null 2>&1; then
        local current_shell
        current_shell="$(getent passwd "$target_user" | cut -d: -f7)"
        
        if [[ "$current_shell" != "$bash_path" ]]; then
            echo "Setting default shell for $target_user to bash"
            sudo chsh -s "$bash_path" "$target_user"
        else
            echo "Default shell for $target_user already set to bash"
        fi
    else
        echo "WARNING: Could not look up user $target_user; skipping default shell configuration"
    fi
}

# Load version information from git tags
# Sets VERSION and MAJOR/MINOR/PATCH_VERSION from the latest git tag, for the
# custom bootstrap scripts that run after this task (docs/Bootstrap-Customization.md);
# nothing in this library reads them, hence the SC2034 waiver.
# shellcheck disable=SC2034
load_version_info() {
    VERSION=$(git tag -l 'v*' | sort -V | tail -n 1)
    if [[ $VERSION =~ ([0-9]+)\.([0-9]+)\.([0-9]+)(-([a-zA-Z0-9]+)\.([0-9]+))? ]]; then
        MAJOR_VERSION=${BASH_REMATCH[1]}
        MINOR_VERSION=${BASH_REMATCH[2]}
        PATCH_VERSION=${BASH_REMATCH[3]}
    else
        echo "Warning: VERSION format is not recognized"
        MAJOR_VERSION=0
        MINOR_VERSION=0
        PATCH_VERSION=0
    fi
}

# Create directories for installation files
prepare_install_directories() {
    mkdir -p "$devenv/.installs"
}

# Install yq (mikefarah version) for YAML processing
install_yq() {
    echo "# Install yq (YAML processor)"
    echo "#############################################"
    
    if command -v yq >/dev/null 2>&1; then
        echo "yq already installed"
        return 0
    fi
    
    # Detect architecture
    local arch
    arch=$(uname -m)
    local yq_arch="amd64"
    if [ "$arch" = "aarch64" ]; then
        yq_arch="arm64"
    fi
    
    require_tool_version YQ_VERSION || return 1
    local yq_version="$YQ_VERSION"
    local yq_sha_var="YQ_SHA256_${yq_arch^^}"
    require_tool_version "$yq_sha_var" || return 1

    local yq_url="https://github.com/mikefarah/yq/releases/download/${yq_version}/yq_linux_${yq_arch}"
    
    echo "Downloading yq ${yq_version}..."
    # A private temp file, not a fixed /tmp path: a predictable name in a
    # world-writable directory can be pre-created or swapped by another user
    # between the download and the move into /usr/local/bin.
    local yq_tmp
    yq_tmp=$(mktemp) || return 1
    if download_verified "$yq_url" "$yq_tmp" "${!yq_sha_var}"; then
        sudo chmod +x "$yq_tmp"
        sudo mv "$yq_tmp" /usr/local/bin/yq
        echo "✓ yq installed successfully"
    else
        # download_verified has already said why (download failure or digest mismatch)
        rm -f "$yq_tmp"
        exit 1
    fi
}

# Install first round of OS packages
install_os_packages_round1() {
    echo "# OS packages update and install - First round"
    echo "#############################################"
    sudo apt update
    sudo apt install -y \
        curl wget gnupg bash-completion iputils-ping uuid fzf gcc g++ make \
        xmlstarlet redis-tools cifs-utils xmlstarlet software-properties-common \
        sshfs apt-transport-https ca-certificates bats shellcheck ripgrep \
        parallel

    # Packages the active provider's tooling needs (its CLI, for instance)
    ensure_provider_seam
    local provider_packages
    provider_packages=$(provider_bootstrap_call apt_packages)
    if [ -n "$provider_packages" ]; then
        # Intentional word-splitting: the hook prints a space-separated package list.
        # shellcheck disable=SC2086
        sudo apt install -y $provider_packages
    fi
}

# Add specialized package repositories (HashiCorp, Kubernetes)
add_specialized_repositories() {
    echo "# Add specialized OS package repositories and keys"
    echo "#############################################"

    sudo mkdir -p /etc/apt/keyrings

    wget -O- https://apt.releases.hashicorp.com/gpg | \
    gpg --dearmor | \
    sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg > /dev/null
    echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] \
    https://apt.releases.hashicorp.com $(lsb_release -cs) main" | \
    sudo tee /etc/apt/sources.list.d/hashicorp.list

    require_tool_version K8S_APT_TRACK || return 1
    curl -fsSL "https://pkgs.k8s.io/core:/stable:/${K8S_APT_TRACK}/deb/Release.key" | sudo gpg --dearmor --yes -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
    sudo chmod 644 /etc/apt/keyrings/kubernetes-apt-keyring.gpg
    echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/${K8S_APT_TRACK}/deb/ /" | sudo tee /etc/apt/sources.list.d/kubernetes.list
    sudo chmod 644 /etc/apt/sources.list.d/kubernetes.list
}

# Install second round of OS packages (from specialized repos)
install_os_packages_round2() {
    echo "# OS packages update and install - Second round"
    echo "#############################################"
    sudo apt update
    sudo apt install -y \
        terraform kubectl
}

# Install .NET SDK
install_dotnet() {
    echo "# Install .NET"
    echo "#############################################"

    if ! command -v dotnet >/dev/null 2>&1; then
        require_tool_version DOTNET_CHANNELS || return 1
        wget https://dot.net/v1/dotnet-install.sh
        chmod +x ./dotnet-install.sh
        local dotnet_channel
        for dotnet_channel in $DOTNET_CHANNELS; do
            sudo ./dotnet-install.sh -c "$dotnet_channel" -i /usr/share/dotnet
        done
        sudo ln -sf /usr/share/dotnet/dotnet /usr/bin/dotnet
        rm -f dotnet-install.sh
    else
        echo "dotnet already installed: $(dotnet --version)"
    fi

    dotnet_cmd=/usr/bin/dotnet
    sudo $dotnet_cmd workload update
    $dotnet_cmd tool list -g | grep -q "dotnet-format" || $dotnet_cmd tool install -g dotnet-format
}

# Fail fast and loudly when the host `setup` answers are missing: nothing below can
# build a usable environment without them, and discovering that after the long
# install tasks wastes the whole run. timezone.txt and digitalocean_token.txt are
# optional and not checked here.
require_setup_files() {
    local required=(name.txt email.txt provider_org.txt provider_user.txt)
    local missing=() f
    if [ ! -d "$setup_dir" ]; then
        missing=("${required[@]}")
    else
        for f in "${required[@]}"; do
            [ -f "$setup_dir/$f" ] || missing+=("$f")
        done
    fi
    [ "${#missing[@]}" -eq 0 ] && return 0

    {
        echo "##############################################################"
        echo "ERROR: devenv setup has not been run (or is incomplete)."
        echo "Missing in $setup_dir: ${missing[*]}"
        echo "Run 'setup' on the host machine, then rebuild the container or re-run bootstrap."
        echo "##############################################################"
    } >&2
    return 1
}

# True when a person can answer a prompt: bootstrap also runs from non-interactive
# container-start hooks, where there is nobody to ask.
_bootstrap_is_interactive() {
    [ -t 0 ]
}

# The provider token must exist before the long install tasks run:
#   already authenticated  -> keep the stored token (and any seed file) untouched
#   seed file present      -> import it once and delete the plaintext seed
#   otherwise              -> ask for the token; no token (or no terminal) fails
# The token is read hidden, passed on stdin only, and never printed.
require_provider_token() {
    ensure_provider_seam

    if provider_auth_status >/dev/null 2>&1; then
        echo "Provider credential store is authenticated."
        if [ -f "$setup_dir/provider_token.txt" ]; then
            echo "Seed file $setup_dir/provider_token.txt is no longer needed while authenticated; remove it to reduce plaintext exposure."
        fi
        return 0
    fi

    if [ -f "$setup_dir/provider_token.txt" ]; then
        # Ask the provider whether the seed token is good before it is imported and the
        # plaintext deleted: 0 accepted, 1 rejected, 2 could not be verified (offline).
        # A provider with no validate hook counts as accepting.
        local seed_validation=0
        provider_bootstrap_call validate_token < "$setup_dir/provider_token.txt" || seed_validation=$?
        if [ "$seed_validation" -eq 1 ]; then
            echo "WARNING: provider_token.txt was rejected by the provider (expired or invalid?); it is kept so you can correct it."
        else
            if [ "$seed_validation" -ne 0 ]; then
                echo "WARNING: could not verify provider_token.txt with the provider (unreachable); importing it unverified."
            fi
            if provider_auth_import_token < "$setup_dir/provider_token.txt" >/dev/null 2>&1; then
                rm -f "$setup_dir/provider_token.txt"
                echo "Seed file imported into the provider credential store and deleted (one-shot; re-add only if you want replay-ability)."
                return 0
            fi
            echo "WARNING: provider_token.txt could not be imported (expired or invalid?)."
        fi
    else
        echo "Provider credential store is empty and no seed file found in $setup_dir."
    fi

    if ! _bootstrap_is_interactive; then
        {
            echo "ERROR: no provider token is available and there is no terminal to ask for one."
            echo "Run 'key-update-provider' (paste the token at the prompt), or put the token in $setup_dir/provider_token.txt, then re-run bootstrap."
        } >&2
        return 1
    fi

    local token=""
    read -r -s -p "Paste the provider access token (PAT): " token || token=""
    echo ""
    if [ -z "$token" ]; then
        echo "ERROR: no token provided; bootstrap cannot continue without a provider token." >&2
        return 1
    fi

    local typed_validation=0
    provider_bootstrap_call validate_token <<< "$token" || typed_validation=$?
    if [ "$typed_validation" -eq 1 ]; then
        echo "ERROR: the provider rejected that token (expired, invalid, or missing scopes); nothing was stored." >&2
        return 1
    fi
    if [ "$typed_validation" -ne 0 ]; then
        echo "WARNING: could not verify the token with the provider (unreachable); importing it unverified."
    fi
    if ! provider_auth_import_token <<< "$token" >/dev/null 2>&1; then
        echo "ERROR: the token could not be imported into the provider credential store." >&2
        return 1
    fi
    echo "Token imported into the provider credential store."
}

# Install or configure Node Version Manager
install_or_configure_nvm() {
    local marker_start="### nvm start"
    local marker_end="### nvm end"

    # NODE_VERSION lives in tool-versions.bash. Top-level sourcing of it can
    # no-op when this library is sourced before initialize_paths sets
    # DEVENV_ROOT, so resolve it here relative to this script's own location
    # (same guard as install_node_packages).
    if [ -z "${NODE_VERSION:-}" ]; then
        local _tv="${BASH_SOURCE[0]%/*}/tool-versions.bash"
        # shellcheck disable=SC1090 # source path is runtime-derived (sibling of this script)
        [ -f "$_tv" ] && source "$_tv"
    fi

    echo "# Install nvm"
    echo "#############################################"

    export NVM_DIR="/usr/local/share/nvm"
    if [ ! -f "$NVM_DIR/nvm.sh" ]; then
        if [ -z "${NODE_VERSION:-}" ]; then
            echo "ERROR: NODE_VERSION is not set - tool-versions.bash could not be resolved" >&2
            return 1
        fi
        require_tool_version NVM_VERSION || return 1
        require_tool_version NVM_INSTALL_SHA256 || return 1
        # Download, verify, then run: never pipe a remote script into a shell.
        local nvm_installer
        nvm_installer=$(mktemp) || return 1
        if ! download_verified "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" "$nvm_installer" "$NVM_INSTALL_SHA256"; then
            rm -f "$nvm_installer"
            return 1
        fi
        bash "$nvm_installer"
        rm -f "$nvm_installer"

        sudo mkdir -p $NVM_DIR
        sudo chown -R "$(whoami)":"$(whoami)" "$NVM_DIR"

        # shellcheck disable=SC1090 # User's bashrc is dynamic
        source ~/.bashrc
        source "$NVM_DIR/nvm.sh"
        nvm install "$NODE_VERSION"
        nvm use "$NODE_VERSION"
        nvm alias default "$NODE_VERSION"
        sudo chown -R "$(whoami)":"$(whoami)" "$NVM_DIR/versions"

        # Remove the NVM lines added by the installer script itself
        sed -i '/export NVM_DIR=/d' "$HOME/.bashrc"
        sed -i '/\[ -s.*NVM_DIR.*nvm.sh.*\]/d' "$HOME/.bashrc"
        sed -i '/\[ -s.*NVM_DIR.*bash_completion.*\]/d' "$HOME/.bashrc"

        # Ensure NVM is properly initialized in bashrc with interactive shell guard
        # Check if our custom NVM block is already present to avoid duplicates
        if ! grep -q "$marker_start" "$HOME/.bashrc"; then
            cat <<EOF >> "$HOME/.bashrc"
$marker_start
# Only load NVM in interactive shells to avoid interfering with VSCode's Node
if [[ \$- == *i* ]]; then
    export NVM_DIR="/usr/local/share/nvm"
    # Disable NVM symlink creation to avoid "File exists" errors
    export NVM_SYMLINK_CURRENT=false
    [ -s "\$NVM_DIR/nvm.sh" ] && \. "\$NVM_DIR/nvm.sh"  # This loads nvm
    [ -s "\$NVM_DIR/bash_completion" ] && \. "\$NVM_DIR/bash_completion"  # This loads nvm bash_completion
fi
$marker_end
EOF
        fi

    else
        echo "=> NVM already installed"

    fi    
}

# Configure .NET tools
configure_dotnet_tools() {
    echo "# Configure .net"
    echo "#############################################"

    $dotnet_cmd tool list -g | grep -q "dotnet-reportgenerator" || $dotnet_cmd tool install -g dotnet-reportgenerator-globaltool
    $dotnet_cmd tool list -g | grep -q "dotnet-outdated" || $dotnet_cmd tool install --global dotnet-outdated-tool
    sudo $dotnet_cmd dev-certs https
    sudo mkdir -p /usr/local/share/ca-certificates/aspnet
    sudo chmod 755 /usr/local/share/ca-certificates/aspnet
    sudo -E $dotnet_cmd dev-certs https -ep /usr/local/share/ca-certificates/aspnet/https.crt --format PEM || echo "WARNING: Failed to export HTTPS certificate"
    sudo update-ca-certificates
}

# Install Node.js packages
install_node_packages() {
    # Version constants live in tool-versions.bash. Top-level sourcing of it
    # can no-op when this library is sourced before initialize_paths sets
    # DEVENV_ROOT, so re-source here, resolving the file relative to this
    # script's own location (immune to $0 / DEVENV_ROOT state). The function
    # check (not just the vars) matters when PNPM_VERSION/NODE_VERSION leaked
    # in via an inherited environment without the function definitions.
    if [ -z "${PNPM_VERSION:-}" ] || [ -z "${NODE_VERSION:-}" ] || ! declare -F reclaim_global_pnpm_ownership >/dev/null; then
        local _tv="${BASH_SOURCE[0]%/*}/tool-versions.bash"
        # shellcheck disable=SC1090 # source path is runtime-derived (sibling of this script)
        [ -f "$_tv" ] && source "$_tv"
    fi
    if [ -z "${PNPM_VERSION:-}" ]; then
        echo "ERROR: PNPM_VERSION is not set - tool-versions.bash could not be resolved" >&2
        return 1
    fi
    require_tool_version TURBO_VERSION || return 1
    echo "# Node packages"
    echo "#############################################"
    call_npm install -g zx
    reclaim_global_pnpm_ownership
    call_npm install -g "pnpm@$PNPM_VERSION"
    call_npm install -g "turbo@$TURBO_VERSION"
}

# Install repository dependencies
install_repo_dependencies() {
    echo "# Configure local devenv repo hooks"
    echo "#############################################"
    PNPM_INSTALL_FAILED=0
    # HUSKY=0: bootstrap contexts (fresh container, CI) must not install git
    # hooks — a failed or unwanted husky prepare would fail the whole install
    # and break the bootstrap chain. Local dev installs run without this and
    # get hooks as usual.
    if ! CI=1 HUSKY=0 pnpm install; then
        PNPM_INSTALL_FAILED=1
        echo "WARNING: pnpm install failed; the repo's git hooks and node tooling may be missing"
    fi
}

# Initialize bootstrap run time tracking: both markers are removed so a run that
# fails before record_bootstrap_run_time leaves the container reporting
# "bootstrap not completed" rather than a stale or half-written marker.
init_bootstrap_run_time() {
    # The marker paths come from initialize_paths; resolving them here lets this task
    # run first, so no failure in a later task can leave the previous run's markers
    # behind to read as "completed".
    initialize_paths
    rm -f "$container_bootstrap_run_file" "$repo_bootstrap_run_file"
}

# Record bootstrap completion time
record_bootstrap_run_time() {
    echo "# Record bootstrap run time"
    echo "#############################################"
    mkdir -p "$(dirname "$repo_bootstrap_run_file")"
    date +%s > "$container_bootstrap_run_file"
    cp "$container_bootstrap_run_file" "$repo_bootstrap_run_file"
    echo "Bootstrap run time recorded"
}

# Display completion message
finish_message() {
    echo "Bootstrap complete"
    echo "--------------------------------------------------------------"
    if [ "${PNPM_INSTALL_FAILED:-0}" -eq 1 ]; then
        echo "ACTION REQUIRED: 'pnpm install' failed during bootstrap. Run it in $toolbox_root and check the output."
    fi
    echo "Please exit out of VS Code and let the container restart."
    echo "Please restart the container to complete the setup."
}

# Fresh-install task runner. Runs the full bootstrap sequence including
# destructive steps (bashrc reset, cleanup) appropriate for a new container.
# Usage: run_bootstrap_tasks [task1 task2 ...] or run_bootstrap_tasks (for default tasks)
run_bootstrap_tasks() {
    local tasks=("$@")
    local default_tasks=(
        init_bootstrap_run_time
        initialize_paths
        require_setup_files
        detect_architecture
        ensure_home_is_set
        ensure_bash_is_default_shell
        load_version_info
        load_config
        require_provider_token
        prepare_install_directories
        reset_bashrc_to_original
        install_yq
        install_os_packages_round1
        add_specialized_repositories
        install_os_packages_round2
        install_dotnet
        load_setup_credentials
        write_bash_functions_file
        generate_env_vars_file
        create_tool_symlinks
        write_devenvrc
        append_bashrc
        install_or_configure_nvm
        configure_dotnet_tools
        install_node_packages
        configure_git
        install_copilot_instructions
        install_claude_code_integration
        sync_copilot_knowledge
        sync_copilot_engineering
        ensure_directories_and_settings
        install_repo_dependencies
        configure_nuget_sources
        configure_user_npmrc
        run_custom_bootstrap_if_present
        cleanup_packages
        record_bootstrap_run_time
        finish_message
    )

    if [ ${#tasks[@]} -eq 0 ]; then
        tasks=("${default_tasks[@]}")
    fi

    for task in "${tasks[@]}"; do
        if ! declare -f "$task" >/dev/null; then
            echo "Unknown task: $task"
            exit 1
        fi
        echo "Running task: $task"
        if ! "$task"; then
            echo "Task failed: $task"
            exit 1
        fi
    done
}

# Convergent-update task runner. Re-runs the full bootstrap except destructive
# steps (no bashrc reset, no cleanup, no init_bootstrap_run_time).
# IMPORTANT: When adding tasks to run_bootstrap_tasks, add them here too (unless destructive).
run_update_tasks() {
    local update_tasks=(
        initialize_paths
        require_setup_files
        detect_architecture
        ensure_home_is_set
        ensure_bash_is_default_shell
        load_version_info
        load_config
        require_provider_token
        prepare_install_directories
        install_yq
        install_os_packages_round1
        add_specialized_repositories
        install_os_packages_round2
        install_dotnet
        load_setup_credentials
        write_bash_functions_file
        generate_env_vars_file
        create_tool_symlinks
        write_devenvrc
        append_bashrc
        install_or_configure_nvm
        configure_dotnet_tools
        install_node_packages
        configure_git
        install_copilot_instructions
        install_claude_code_integration
        sync_copilot_knowledge
        sync_copilot_engineering
        ensure_directories_and_settings
        install_repo_dependencies
        configure_nuget_sources
        configure_user_npmrc
        run_custom_bootstrap_if_present
        record_bootstrap_run_time
    )
    for task in "${update_tasks[@]}"; do
        if ! declare -f "$task" >/dev/null; then
            echo "Unknown task: $task"
            exit 1
        fi
        echo "Running task: $task"
        if ! "$task"; then
            echo "Task failed: $task"
            exit 1
        fi
    done
}
