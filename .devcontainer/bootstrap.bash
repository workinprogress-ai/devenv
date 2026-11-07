#!/bin/bash
# bootstrap.bash - the thin pre-node stage of the devenv bootstrap.
#
# 17.3 (bash-native phase): everything after node exists lives in the
# TypeScript setup orchestrator (tools/ts/setup.ts) — one convergence path
# for first-run provisioning AND the post-node install stage. This file keeps
# ONLY what must precede node:
#   - paths + minimal config read (provider seam, identity)
#   - seed-file checks and the provider token gate
#   - node resolution from the image's pinned install (17.0: the node:1
#     feature; nvm-dir onto PATH — no runtime nvm install)
#   - verified-download helper + yq (a pre-node GitHub-release binary; its
#     consumers are the bash-era repo-types lib and the ops tool that uses it)
#   - the bootstrap run-time markers container-start.sh reconciles on
#   - the handoff: exec the setup orchestrator with --all
#
# Fork usage (docs/Bootstrap-Customization.md): source this library and call
# run_bootstrap_tasks [tasks...] — or the setup orchestrator directly:
#   node tools/ts/setup.ts --all
#
# Retired with 17.2/17.3: install_os_packages_*, add_specialized_repositories,
# install_dotnet, configure_dotnet_tools, install_node_packages,
# install_repo_dependencies, install_or_configure_nvm (superseded by the
# image's pinned node feature), and the whole provision.bash bridge.

# Guard against multiple sourcing
if [ -n "${_BOOTSTRAP_LOADED:-}" ]; then return 0; fi
_BOOTSTRAP_LOADED=1

# Reset .bashrc to the captured original on fresh install (destructive:
# bootstrap-list only, never the convergent update runner).
reset_bashrc_to_original() {
    if [ ! -f ~/.bashrc.original ]; then
        cp ~/.bashrc ~/.bashrc.original
    fi
    # Reset .bashrc to the captured original by default.
    # Set PRESERVE_BASHRC=1 to skip the reset and keep any direct edits.
    if [ "${PRESERVE_BASHRC:-0}" != "1" ]; then
        cp ~/.bashrc.original ~/.bashrc
    fi
}

# Provider seam: the provider-layer modules stay bash (bootstrap-chain rule);
# the thin stage needs the seam for its token gate, so the loader lives here.
ensure_provider_seam() {
    if declare -F provider_secret_get >/dev/null; then
        # The core defines provider_secret_get itself, so its presence does
        # not imply the active provider's auth module is loaded; the
        # credential lifecycle verbs below need that module.
        if declare -F provider_auth_status >/dev/null && \
           declare -F provider_auth_status_impl >/dev/null && \
           declare -F provider_bootstrap_validate_token >/dev/null; then
            return 0
        fi
    fi
    local seam_lib="$toolbox_root/tools/lib/providers/provider-core.bash"
    if [ -f "$seam_lib" ]; then
        # shellcheck disable=SC1090
        source "$seam_lib"
        # A [provider] name that is not shipped stops bootstrap with the reason,
        # rather than carrying on as another provider.
        provider_detect "$toolbox_root/devenv.config" || {
            echo "ERROR: cannot determine the provider from $toolbox_root/devenv.config (see above)"
            exit 1
        }
        local auth_mod
        auth_mod="$(dirname "$seam_lib")/${PROVIDER_NAME}/auth.bash"
        # shellcheck disable=SC1090,SC1091
        if [ -f "$auth_mod" ]; then
            source "$auth_mod"
        fi
        local hooks_mod
        hooks_mod="$(dirname "$seam_lib")/${PROVIDER_NAME}/bootstrap.bash"
        # shellcheck disable=SC1090,SC1091
        if [ -f "$hooks_mod" ]; then
            source "$hooks_mod"
        fi
    fi
}

# Error handler function
on_error() {
  local status=$?
  echo "An error occurred (exit status $status)${bootstrap_log:+; see $bootstrap_log}."
  exit 1
}

# Make sure a version constant from tool-versions.bash is set, loading that file
# when it has not been: top-level sourcing of it no-ops when this library is
# sourced before initialize_paths sets DEVENV_ROOT.
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

# Initialize core paths used throughout the thin stage (and exported for the
# setup orchestrator + provider accessors).
initialize_paths() {
    # The entry wrapper exports _self (its own absolute path) before sourcing
    # this library. $0 cannot be used: the wrapper cds to the repo root
    # before the tasks run, so a relative $0 would re-resolve against the
    # new cwd and put the toolbox root one directory too high. Fall back to
    # $0 only when _self is absent (direct `bash bootstrap.bash` use).
    local self="${_self:-$(readlink -f "$0")}"
    script_path=$(readlink -f "$self")
    script_folder=$(dirname "$script_path")
    toolbox_root=$(dirname "$script_folder")
    devenv=$toolbox_root
    setup_dir=$toolbox_root/.setup
    # Consumed by sourced bash libraries (git-operations et al. read the
    # seed paths from these globals); ShellCheck cannot see the cross-file
    # use in a sourced library chain.
    # shellcheck disable=SC2034
    name_file=$toolbox_root/.setup/name.txt
    # shellcheck disable=SC2034
    email_file=$toolbox_root/.setup/email.txt
    container_bootstrap_run_file="$HOME/.bootstrap_container_time"
    repo_bootstrap_run_file="$toolbox_root/.runtime/.bootstrap_run_time"
    config_file="$devenv/devenv.config"

    # Export early: the provider identity accessors (provider_org_get et al.)
    # fall back to DEVENV_ROOT/devenv.config when no explicit config path is
    # bound, and the setup orchestrator's tooling references $DEVENV_ROOT.
    export DEVENV_ROOT="$toolbox_root"
    export DEVENV_TOOLS="$toolbox_root/tools"
}

# Load and initialize devenv.config file (the one config read the thin stage
# performs: provider seam + org identity fail-fast + the copilot side-repo
# settings the shell functions and container-start pulls still consume).
load_config() {
    local config_reader="$devenv/tools/lib/config-reader.bash"
    if [ ! -f "$config_reader" ]; then
        echo "ERROR: Config reader library not found at $config_reader"
        exit 1
    fi
    # shellcheck source=../tools/lib/config-reader.bash
    source "$config_reader"

    if [ ! -f "$config_file" ]; then
        echo "ERROR: devenv.config not found at $config_file"
        exit 1
    fi
    if ! config_init "$config_file"; then
        echo "ERROR: Failed to initialize config reader"
        exit 1
    fi

    # The identity check below calls the provider org accessor; the provider
    # seam must exist before this task runs.
    ensure_provider_seam

    # Org identity: config is the source; no session export (tools resolve
    # via the provider org accessor). Fail fast when unconfigured.
    if [ -z "$(provider_org_get 2>/dev/null || true)" ]; then
        echo "ERROR: org not configured in devenv.config [organization] section"
        exit 1
    fi

    # Optional Copilot knowledge repo settings (consumed by the shell env
    # generation inside setup and by container-start's startup pulls).
    COPILOT_KNOWLEDGE_REPO=$(config_read_value "copilot" "knowledge_repo" "")
    COPILOT_KNOWLEDGE_SUBPATH=$(config_read_value "copilot" "knowledge_subpath" "")
    COPILOT_ENGINEERING_REPO=$(config_read_value "copilot" "engineering_repo" "")
    COPILOT_ENGINEERING_SUBPATH=$(config_read_value "copilot" "engineering_subpath" "")
    export COPILOT_KNOWLEDGE_REPO COPILOT_KNOWLEDGE_SUBPATH
    export COPILOT_ENGINEERING_REPO COPILOT_ENGINEERING_SUBPATH
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

# Load version information from git tags — for the custom bootstrap scripts
# that run after the tasks (docs/Bootstrap-Customization.md); nothing in this
# library reads them.
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

# Create the install scratch directory
prepare_install_directories() {
    mkdir -p "$devenv/.installs"
}

# Install yq (mikefarah version) for YAML processing — a verified-download
# GitHub release binary (pre-node; its verified-download helper lives here).
install_yq() {
    echo "# Install yq (YAML processor)"
    echo "#############################################"

    if command -v yq >/dev/null 2>&1; then
        echo "yq already installed"
        return 0
    fi

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

# Fail fast and loudly when the host `setup` answers are missing: nothing below
# can build a usable environment without them, and discovering that after the
# long install tasks wastes the whole run. timezone.txt and digitalocean_token.txt
# are optional and not checked here.
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

# The provider token must exist before the setup orchestrator runs: already
# authenticated -> keep the stored token; seed file present -> import once and
# delete the plaintext; otherwise -> ask for the token; no token (or no
# terminal) fails. The token is read hidden, passed on stdin only, never printed.
_bootstrap_is_interactive() {
    [ -t 0 ]
}

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

resolve_node_on_path() {
    local nvm_dir="/usr/local/share/nvm"
    local pinned=""
    if [ -f "${BASH_SOURCE[0]%/*}/tool-versions.bash" ]; then
        # NODE_VERSION lives in tool-versions.bash (must equal the feature pin
        # in devcontainer.json — enforced by the setup consistency tests).
        require_tool_version NODE_VERSION || return 1
        pinned="$NODE_VERSION"
    fi
    if [ -x "$nvm_dir/versions/node/$pinned/bin/node" ]; then
        export PATH="$nvm_dir/versions/node/$pinned/bin:$PATH"
        return 0
    fi
    # Fall back to the highest installed version (converges containers built
    # before the pin existed; the version check in tool-versions still guards).
    local best
    best=$(ls -1 "$nvm_dir/versions/node" 2>/dev/null | sort -V | tail -1)
    if [ -n "$best" ] && [ -x "$nvm_dir/versions/node/$best/bin/node" ]; then
        export PATH="$nvm_dir/versions/node/$best/bin:$PATH"
        echo "NOTE: pinned node $pinned not found; using $best from the image's nvm dir"
        return 0
    fi
    return 1
}

# Initialize bootstrap run-time tracking: both markers are removed so a run
# that fails before record_bootstrap_run_time leaves the container reporting
# "bootstrap not completed" rather than a stale or half-written marker.
init_bootstrap_run_time() {
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
    echo "Please exit out of VS Code and let the container restart."
    echo "Please restart the container to complete the setup."
}

# Setup handoff: run the TypeScript setup orchestrator non-interactively
# (idempotent steps, safe unattended) — first-run provisioning AND the
# post-node install stage (setup.ts registries). When node itself is absent
# (broken image), print the manual recovery path instead of failing obscurely.
run_setup_first_run() {
    local setup_tool="$toolbox_root/tools/ts/setup.ts"
    if [ ! -f "$setup_tool" ]; then
        echo "setup tool missing: $setup_tool"
        return 1
    fi
    if ! resolve_node_on_path; then
        echo "node not available — cannot run the TS setup orchestrator."
        echo "Manual recovery:"
        echo "  1. ensure the container image provides node >= the TS floor"
        echo "     (devcontainer.json pins the node feature version)"
        echo "  2. node tools/ts/setup.ts --all"
        return 1
    fi
    # The tool composes its own prelude from DEVENV_TOOLBOX_ROOT; hand the
    # bootstrap-resolved root over explicitly so a cross-checkout invocation
    # (or a relocated tool) cannot mis-target the toolbox.
    DEVENV_TOOLBOX_ROOT="$toolbox_root" node "$setup_tool" --all
}

# Fresh-install task runner. The thin pre-node stage, then the single TS
# convergence path. Usage: run_bootstrap_tasks [task1 ...] (default = all).
run_bootstrap_tasks() {
    local tasks=("$@")
    local default_tasks=(
        init_bootstrap_run_time
        initialize_paths
        require_setup_files
        ensure_home_is_set
        ensure_bash_is_default_shell
        load_version_info
        load_config
        require_provider_token
        prepare_install_directories
        reset_bashrc_to_original
        install_yq
        run_setup_first_run
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

# Convergent-update task runner. Re-runs the thin stage except destructive
# steps (no bashrc reset, no run-time init) — the install/provisioning work
# happens inside run_setup_first_run's --all, which is idempotent.
# IMPORTANT: when adding tasks to run_bootstrap_tasks, add them here too
# (unless destructive).
run_update_tasks() {
    local update_tasks=(
        initialize_paths
        require_setup_files
        ensure_home_is_set
        ensure_bash_is_default_shell
        load_version_info
        load_config
        require_provider_token
        prepare_install_directories
        install_yq
        run_setup_first_run
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


# detect_architecture retired with the install-stage ports (each TS step
# resolves arch itself: apt-repos/dotnet/yq handle arm64 vs amd64 inline).
