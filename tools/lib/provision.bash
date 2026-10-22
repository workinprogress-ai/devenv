#!/bin/bash
# provision.bash — the provisioning library: env vars, bashrc, credentials,
# tool symlinks, copilot/claude integration, side-repo syncs, package
# sources. Invoked by the bootstrap's run_setup_first_run task THROUGH
# tools/scripts/setup-first-run.ts, which sources this file and calls the
# step functions in bootstrap order. Function-by-function this library
# retires as its steps port to TypeScript in the migration's cleanup phase.
#
# TODO:DEVENV[Plan-issue-72-001]: retire this library when every
# provisioning step is TS-native and setup-first-run no longer sources it
# — remove when the migration's cleanup phase deletes the bridge

# Step functions below consume bootstrap-owned environment (dotnet_cmd,
# email_file, name_file, setup_dir, toolbox_root) defined in
# .devcontainer/bootstrap.bash, which sources this library at runtime.
# shellcheck disable=SC2154

add_nuget_source_if_not_exists() {
    local sourceName="$1"
    local sourceUrl="$2"
    local username="$3"
    local password="$4"

    if ! $dotnet_cmd nuget list source | grep -q "$sourceUrl"; then
        if [ -n "$username" ] && [ -n "$password" ]; then
            $dotnet_cmd nuget add source "$sourceUrl" -n "$sourceName" -u "$username" -p "$password" --store-password-in-clear-text
            echo "NuGet source $sourceName with credentials added."
        else
            $dotnet_cmd nuget add source "$sourceUrl" -n "$sourceName"
            echo "NuGet source $sourceName added."
        fi
    elif [ -n "$username" ] && [ -n "$password" ]; then
        # The source exists, but its stored password may predate a token rotation.
        $dotnet_cmd nuget update source "$sourceName" -s "$sourceUrl" -u "$username" -p "$password" --store-password-in-clear-text
        echo "NuGet source $sourceName credentials refreshed."
    else
        echo "NuGet source $sourceName already exists."
    fi
}

# Load credentials from .setup directory
load_setup_credentials() {
    # require_setup_files has already guaranteed the identity seed files exist.
    USER_EMAIL=$(cat "$email_file")
    HUMAN_NAME="$(cat "$name_file")"

    # No exports — the provider accessors read the seeds (and config) themselves
    # when identity is needed.

    if [ -f "$setup_dir/digitalocean_token.txt" ]; then
        DO_API_TOKEN=$(cat "$setup_dir/digitalocean_token.txt")
        export DO_API_TOKEN
    else
        echo "WARNING: No Digital Ocean API token found in $setup_dir/digitalocean_token.txt (optional)"
    fi
}

# Create bash functions file with shell aliases and convenience functions
write_bash_functions_file() {
    echo "# Create aliases and bash functions script"
    echo "#############################################"
    mkdir -p "$toolbox_root/.runtime"
    rm -f "$toolbox_root/.runtime/bash-functions.sh"
    cat <<'EOF' >"$toolbox_root/.runtime/bash-functions.sh"
#!/bin/bash
# bash-functions.sh - Special functions that need to modify shell environment
# All other scripts are accessible via symlinks in $DEVENV_TOOLS (without .sh extension)

alias ll='ls -lah'

repo-get() {
    bash "$DEVENV_ROOT/tools/scripts/repo-get.sh" "$@"
    if [ -d "$DEVENV_ROOT/repos/$1" ]; then
        cd "$DEVENV_ROOT/repos/$1" || return
    fi
}

devenv() {
    cd "$DEVENV_ROOT" || return
}

playground() {
    cd "$DEVENV_ROOT/playground" || return
}

repos() {
    cd "$DEVENV_ROOT/repos" || return
}

devenv-update() {
    local current_dir pre_update_hash rc=0
    current_dir=$(pwd)
    cd "$DEVENV_ROOT" || return
    pre_update_hash=$(git rev-parse HEAD 2>/dev/null)

    # git-update exports GIT_UPDATE_SCAN_BASE when the update crossed a
    # rewritten remote (fork sync): the scan then covers exactly the new
    # upstream commits, not the whole rewritten span. Capture and unset it
    # immediately — the export would otherwise leak into the user's shell and
    # mis-scope a later update's scan (a stale base can mask real trailers).
    local scan_base=""
    if [ -n "${GIT_UPDATE_SCAN_BASE:-}" ]; then
        scan_base="$GIT_UPDATE_SCAN_BASE"
        unset GIT_UPDATE_SCAN_BASE
    fi
    if ! git-update; then
        cd "$current_dir" || return
        return 1
    fi
    if [ -n "${GIT_UPDATE_SCAN_BASE:-}" ]; then
        scan_base="$GIT_UPDATE_SCAN_BASE"
        unset GIT_UPDATE_SCAN_BASE
    fi

    "$DEVENV_ROOT/.devcontainer/bootstrap.sh" run_update_tasks
    # shellcheck source=/dev/null
    source "$DEVENV_ROOT/.devcontainer/post-update.bash"
    if [ -n "$scan_base" ]; then
        devenv_post_update "$pre_update_hash" "HEAD" "$scan_base" || rc=$?
    else
        devenv_post_update "$pre_update_hash" || rc=$?
    fi

    cd "$current_dir" || return
    return "$rc"
}

key-update-tailscale() {
    "$DEVENV_ROOT/tools/scripts/_key-update-tailscale.sh" "$@"
    if [ -f "$DEVENV_ROOT/.runtime/env-vars.sh" ]; then
        source "$DEVENV_ROOT/.runtime/env-vars.sh"
    fi
}

# Run one provider's key-update script (tools/lib/providers/<name>/key-update.sh)
# and reload the environment afterwards. Unknown providers fail with the list of
# providers that ship a script.
_key_update_run() {
    local provider="$1"
    shift
    local script="$DEVENV_ROOT/tools/lib/providers/$provider/key-update.sh"
    if [ ! -f "$script" ]; then
        echo "key-update: provider '$provider' has no key-update script." >&2
        echo "Available:" >&2
        ls "$DEVENV_ROOT/tools/lib/providers/"*/key-update.sh 2>/dev/null | sed 's|.*/providers/||; s|/key-update.sh|  —  |; s|^|  |' >&2
        return 1
    fi
    bash "$script" "$@"
    local rc=$?
    if [ -f "$DEVENV_ROOT/.runtime/env-vars.sh" ]; then
        source "$DEVENV_ROOT/.runtime/env-vars.sh"
    fi
    return $rc
}

# Provider credential rotation: run the active provider's key-update script. The
# provider is the [provider] name in devenv.config, read with the one INI reader
# the tools use (tolerant of spaces, CRLF, comments and blank lines).
key-update-provider() {
    local provider="${DEVENV_KEY_UPDATE_PROVIDER:-}"
    if [ -z "$provider" ]; then
        local reader="$DEVENV_ROOT/tools/lib/config-reader.bash"
        # shellcheck disable=SC1090
        [ -f "$reader" ] && source "$reader" && provider=$(config_get_raw "$DEVENV_ROOT/devenv.config" provider name "" 2>/dev/null)
    fi
    if [ -z "$provider" ]; then
        echo "key-update-provider: no [provider] name in $DEVENV_ROOT/devenv.config (or set DEVENV_KEY_UPDATE_PROVIDER)." >&2
        return 1
    fi
    _key_update_run "$provider" "$@"
}

# One key-update-<provider> command per provider that ships a key-update script
# (for example key-update-azure): rotate that provider's credential directly,
# whichever provider is active.
_key_update_define_provider_commands() {
    local script name
    for script in "$DEVENV_ROOT"/tools/lib/providers/*/key-update.sh; do
        [ -f "$script" ] || continue
        name="$(basename "$(dirname "$script")")"
        eval "key-update-${name}() { _key_update_run '${name}' \"\$@\"; }"
    done
}
_key_update_define_provider_commands

key-update-do() {
    "$DEVENV_ROOT/tools/scripts/_key-update-do.sh" "$@"
    if [ -f "$DEVENV_ROOT/.runtime/env-vars.sh" ]; then
        source "$DEVENV_ROOT/.runtime/env-vars.sh"
    fi
}

# Fix stale VS Code IPC sockets (for git credential helper, code CLI, etc.)
# Run this if you see "Unable to connect to VS Code" errors in long-running terminals
devenv-vscode-fix-sockets() {
    local fixed=0
    
    # Fix VS Code CLI socket - find newest socket that is actively listening
    # Capture listening sockets once; stale socket *files* won't appear in ss output
    local listening sock cli_socket=""
    listening=$(ss -lxH 2>/dev/null | awk '{print $NF}')
    for sock in /tmp/vscode-ipc-*.sock; do
        [[ -S "$sock" ]] || continue
        grep -qF "$sock" <<< "$listening" || continue
        [[ -z "$cli_socket" || "$sock" -nt "$cli_socket" ]] && cli_socket="$sock"
    done
    if [[ -n "$cli_socket" ]]; then
        export VSCODE_IPC_HOOK_CLI="$cli_socket"
        ((fixed++))
    fi

    # Fix Dev Containers IPC socket (git credential helper)
    local newest_dc_socket
    newest_dc_socket=$(ls -t /tmp/vscode-remote-containers-ipc-*.sock 2>/dev/null | head -1)
    if [[ -n "$newest_dc_socket" && -S "$newest_dc_socket" ]]; then
        export REMOTE_CONTAINERS_IPC="$newest_dc_socket"
        ((fixed++))
    fi

    if [[ $fixed -gt 0 ]]; then
        echo "✓ VS Code IPC sockets refreshed"
    else
        echo "⚠ No VS Code sockets found in /tmp"
    fi
}

load-docker() {
    "$DEVENV_ROOT/.devcontainer/load-docker.sh" "$@"
}

EOF
    chmod +x "$toolbox_root/.runtime/bash-functions.sh"
}

# Generate environment variables file
generate_env_vars_file() {
    echo "# Generate env-vars.sh from .setup configuration"
    echo "#############################################"

    if [ -f "$setup_dir/timezone.txt" ]; then
        SETUP_TZ=$(cat "$setup_dir/timezone.txt")
    else
        SETUP_TZ="${TZ:-UTC}"
    fi

    mkdir -p "$toolbox_root/.runtime"
    cat <<EOF >"$toolbox_root/.runtime/env-vars.sh"
#!/bin/bash
# This file is auto-generated by bootstrap.sh from .setup/*.txt files
# Do not edit manually - changes will be overwritten on next bootstrap

# Timezone
export TZ="$SETUP_TZ"

# .NET settings
export DOTNET_HOSTBUILDER__RELOADCONFIGONCHANGE=false
export DOTNET_USE_POLLING_FILE_WATCHER=true

# Core paths
export DEVENV_ROOT="$toolbox_root"
export devenv="$toolbox_root"
export DEVENV_TOOLS="$toolbox_root/tools"
export CONFIG_FOLDER="$toolbox_root/.debug/config"
export DATA_FOLDER="$toolbox_root/.debug/data"

# Environment
export ENV_NAME="${ENV_NAME:-local}"
export DICTIONARY_SERVER="${DICTIONARY_SERVER:-localhost:6379}"
export DOCUMENT_SERVER="${DOCUMENT_SERVER:-mongodb://localhost}"
export MESSAGE_BROKER_SERVER="${MESSAGE_BROKER_SERVER:-nats://localhost:4222}"
export GIT_TERMINAL_PROMPT=1

# Cloud / registry
export DIGITALOCEAN_API_TOKEN="${DO_API_TOKEN:-}"
export DIGITALOCEAN_REGISTRY="${DIGITALOCEAN_REGISTRY:-}"
export DO_APP_NAME="${DO_APP_NAME:-}"
export DO_REGION="${DO_REGION:-}"

# Provider identity: no GH_* exports — tools resolve identity via the
# provider accessors (config → seed); no env var participates.

# User identity
export USER_EMAIL="${USER_EMAIL:-}"

# Update-check interval
export DEVENV_UPDATE_INTERVAL="${DEVENV_UPDATE_INTERVAL:-7200}"

# Convenience paths 
export repos="$toolbox_root/repos"
export playground="$toolbox_root/playground"
export debug="$toolbox_root/.debug"
# Editor defaults
# Preferred editor fallback (used when VS Code is not available)
export FALLBACK_EDITOR="${FALLBACK_EDITOR:-nano}"
export PREF_EDITOR="${PREF_EDITOR:-${FALLBACK_EDITOR}}"
# Point EDITOR/VISUAL to the tool wrapper, which blocks until closed
export EDITOR="${EDITOR:-$toolbox_root/tools/editor}"
export VISUAL="${VISUAL:-$toolbox_root/tools/editor}"
EOF
    # Sourced, never executed, and it accumulates secrets (tokens, auth keys):
    # owner-only, not executable.
    chmod 600 "$toolbox_root/.runtime/env-vars.sh"
}

# Create tool entry points (stubs) via the idempotent sync script
create_tool_symlinks() {
    echo "# Syncing tool entry points in tools/"
    echo "#############################################"
    mkdir -p "$toolbox_root/tools"

    "$toolbox_root/.devcontainer/entry-stubs-sync.sh"

    # Ensure system editor points to our wrapper (done after entry points exist)
    local system_editor_symlink="/bin/editor"
    local target_editor="$toolbox_root/tools/editor"
    if [ -L "$system_editor_symlink" ] || [ -e "$system_editor_symlink" ]; then
        sudo rm -f "$system_editor_symlink" || true
    fi
    sudo ln -sfn "$target_editor" "$system_editor_symlink"
    echo "✓ Linked $system_editor_symlink -> $target_editor"
}

# Write shared devenvrc configuration file
write_devenvrc() {
    echo "# Write shared shell config to ~/.devenvrc"
    echo "#############################################"

    # Fallback default must be this clone's actual path, not a hardcoded
    # literal — forks/renames (e.g. /workspaces/devenv.omsnic.beta) would
    # otherwise fall back to a sibling path that doesn't exist.
    cat > "$HOME/.devenvrc" <<DEVENVRC_HEADER
# Auto-generated by devenv bootstrap. Do not edit manually.

export DEVENV_ROOT="\${DEVENV_ROOT:-$toolbox_root}"
DEVENVRC_HEADER

    cat >> "$HOME/.devenvrc" <<'DEVENVRC_EOF'
export DEVENV_TOOLS="${DEVENV_ROOT}/tools"
export devenv="${DEVENV_ROOT}"

# Append a directory to PATH once: this file is sourced by every nested shell, so
# an unconditional append would grow PATH on each one.
_devenv_path_add() {
    case ":${PATH}:" in
        *":$1:"*) ;;
        *) PATH="${PATH}:$1" ;;
    esac
}

# Order: devenv tools first, then tool-local entries, then each repo's scripts, so
# a repo script can never shadow a devenv tool of the same name.
_devenv_path_add "${DEVENV_ROOT}/tools"
_devenv_path_add "${DEVENV_ROOT}/.debug/scripts"
_devenv_path_add "/home/vscode/.dotnet/tools"

# Add repo scripts to PATH (best-effort for both bash and zsh)
if [ -d "${DEVENV_ROOT}/repos" ]; then
    for dir in "${DEVENV_ROOT}/repos"/*/; do
        [ -d "$dir" ] || continue
        if [ -d "${dir}scripts" ]; then
            _devenv_path_add "${dir%/}/scripts"
        fi
    done
fi
export PATH

# Shell-specific helpers
# git-completion.bash is vendored in .devcontainer/ (see tool-versions.bash)
if [ -n "${BASH_VERSION:-}" ] && [ -f "${DEVENV_ROOT}/.devcontainer/git-completion.bash" ]; then
    source "${DEVENV_ROOT}/.devcontainer/git-completion.bash"
fi

# Core devenv environment
[ -f "${DEVENV_ROOT}/.runtime/env-vars.sh" ] && source "${DEVENV_ROOT}/.runtime/env-vars.sh"
[ -f "${DEVENV_ROOT}/.runtime/bash-functions.sh" ] && source "${DEVENV_ROOT}/.runtime/bash-functions.sh"
[ -f "${DEVENV_ROOT}/.devcontainer/sanity-check.sh" ] && source "${DEVENV_ROOT}/.devcontainer/sanity-check.sh"
[ -f "${DEVENV_ROOT}/.devcontainer/tool-versions.bash" ] && source "${DEVENV_ROOT}/.devcontainer/tool-versions.bash"

# Shell-specific helpers
if [ -n "${BASH_VERSION:-}" ]; then
    [ -f "${DEVENV_ROOT}/.devcontainer/bash-prompt.sh" ] && source "${DEVENV_ROOT}/.devcontainer/bash-prompt.sh"
    [ -f "${DEVENV_ROOT}/.devcontainer/bash_completion_custom" ] && source "${DEVENV_ROOT}/.devcontainer/bash_completion_custom"
elif [ -n "${ZSH_VERSION:-}" ]; then
    [ -f "${DEVENV_ROOT}/.devcontainer/zsh-prompt.sh" ] && source "${DEVENV_ROOT}/.devcontainer/zsh-prompt.sh"
fi

# SSH setup (works in both shells)
#[ -f "${DEVENV_ROOT}/.devcontainer/load-ssh.sh" ] && source "${DEVENV_ROOT}/.devcontainer/load-ssh.sh"

# Fix stale VS Code IPC sockets in dev containers
# When VS Code reconnects, it creates new sockets but old terminals retain stale env vars
# This affects: code CLI, git credential helper, Dev Containers extension IPC
__fix_vscode_ipc_sockets() {
    # Fix VS Code CLI socket (used by 'code' command)
    # Capture listening sockets once; stale socket *files* won't appear in ss output
    local listening sock newest_cli_socket=""
    listening=$(ss -lxH 2>/dev/null | awk '{print $NF}')
    for sock in /tmp/vscode-ipc-*.sock; do
        [[ -S "$sock" ]] || continue
        if [[ -n "$listening" ]]; then
            grep -qF "$sock" <<< "$listening" || continue
        fi
        [[ -z "$newest_cli_socket" || "$sock" -nt "$newest_cli_socket" ]] && newest_cli_socket="$sock"
    done
    if [[ -n "$newest_cli_socket" ]]; then
        export VSCODE_IPC_HOOK_CLI="$newest_cli_socket"
    fi

    # Fix Dev Containers IPC socket (used by git credential helper)
    local newest_dc_socket
    newest_dc_socket=$(ls -t /tmp/vscode-remote-containers-ipc-*.sock 2>/dev/null | head -1)
    if [[ -n "$newest_dc_socket" && -S "$newest_dc_socket" ]]; then
        export REMOTE_CONTAINERS_IPC="$newest_dc_socket"
    fi
    
    # Remove stale git credential helpers that reference deleted temp files
    # VS Code Dev Containers injects these into both global and system configs
    local has_stale_helpers=false
    git config --list 2>/dev/null | grep -q '/tmp/vscode-remote-containers-.*.js' && has_stale_helpers=true
    
    if $has_stale_helpers; then
        # Simple approach: remove all VS Code credential helpers, they'll be recreated when needed
        git config --global --unset-all credential.helper 2>/dev/null || true
        sudo git config --system --unset-all credential.helper 2>/dev/null || true
    fi
}

# Run the fix on shell startup (defensive: avoid startup errors if function is unavailable)
if typeset -f __fix_vscode_ipc_sockets >/dev/null 2>&1; then
    __fix_vscode_ipc_sockets
fi

# VS Code CLI wrapper - ensures we always use the newest *listening* socket even in long-running terminals
code() {
    local listening sock newest_socket=""
    listening=$(ss -lxH 2>/dev/null | awk '{print $NF}')
    for sock in /tmp/vscode-ipc-*.sock; do
        [[ -S "$sock" ]] || continue
        grep -qF "$sock" <<< "$listening" || continue
        [[ -z "$newest_socket" || "$sock" -nt "$newest_socket" ]] && newest_socket="$sock"
    done
    if [[ -n "$newest_socket" ]]; then
        VSCODE_IPC_HOOK_CLI="$newest_socket" command code "$@"
    else
        command code "$@"
    fi
}

# Convenience: move to repos if starting in repo root (bash-only behavior preserved)
# if [ -n "${BASH_VERSION:-}" ] && [ "$(pwd)" = "${DEVENV_ROOT}" ]; then
#     cd "${DEVENV_ROOT}/repos"
# fi
DEVENVRC_EOF
}

# Append devenvrc sourcing to bashrc
append_bashrc() {
    echo "# Add additional stuff in .bashrc"
    echo "#############################################"
    local marker_start="### devenv rc start"
    # marker_end is not referenced: the heredoc embeds the literal marker
    # (grep -Fq on marker_start above is the idempotence guard).
    # shellcheck disable=SC2034
    local marker_end="### devenv rc end"

    if ! grep -Fq "$marker_start" "$HOME/.bashrc"; then
        cat <<EOF >> "$HOME/.bashrc"
### devenv rc start
# Only apply interactive customizations for interactive shells
if [[ \$- == *i* ]]; then
    if [ -f "$HOME/.devenvrc" ]; then
        source "$HOME/.devenvrc"
    fi
fi
### devenv rc end
EOF
    fi
}

# Configure git globally
configure_git() {
    echo "# Configure git"
    echo "#############################################"
    
    # Source git-operations library for shared functions
    local git_ops_lib="$toolbox_root/tools/lib/git-operations.bash"
    # shellcheck source=../tools/lib/git-operations.bash
    source "$git_ops_lib"
    
    # Ensure DEVENV_ROOT is exported so configure_git_global can locate the hooks directory
    export DEVENV_ROOT="$toolbox_root"

    # Configure global git settings with user identity
    configure_git_global "$HUMAN_NAME" "$USER_EMAIL"
    
    # Add the devenv root to safe directories
    add_git_safe_directory "$toolbox_root"
}

# Normalize configured knowledge subpath; empty values resolve to repo root.
normalize_copilot_knowledge_subpath() {
    local subpath="$1"
    subpath="${subpath#./}"
    subpath="${subpath%/}"
    if [ -z "$subpath" ]; then
        subpath="."
    fi
    echo "$subpath"
}

# Clone or update a Copilot-side external repo and symlink its content into ~/.copilot/.
# Shared implementation for the knowledge and engineering standards imports:
#   sync_copilot_side_repo <repo-url> <subpath> <checkout-dir> <link-path> <label> <backup-dir>
sync_copilot_side_repo() {
    ensure_provider_seam
    local repo_url="$1"
    local subpath="$2"
    local repo_dir="$3"
    local link_path="$4"
    local label="$5"
    local backup_parent="$6"
    local header
    local default_branch
    local token

    # Keychain-first auth (#35): resolve the token through the provider
    # auth seam — never from env, never via raw gh.
    token=$(provider_secret_get token 2>/dev/null) || token=""
    if [ -z "$token" ]; then
        echo "WARNING: provider credentials are not available; skipping $label sync (run 'key-update-provider')"
        return 0
    fi

    subpath=$(normalize_copilot_knowledge_subpath "$subpath")
    # The header scheme is the provider's own (its bootstrap hook). It rides git's
    # argv via -c http.extraheader, so it is briefly visible in process listings to
    # local container users; it lives only for the fetch or pull.
    header=$(provider_bootstrap_call git_auth_header "$token")

    if [ -d "$repo_dir/.git" ]; then
        git -C "$repo_dir" remote set-url origin "$repo_url"
        if ! git -C "$repo_dir" -c http.extraheader="$header" fetch --prune origin; then
            echo "WARNING: $label fetch failed; keeping the existing clone (it may be stale). Not a bootstrap blocker."
            return 0
        fi
        default_branch=$(git -C "$repo_dir" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
        if [ -z "$default_branch" ]; then
            default_branch=$(git -C "$repo_dir" rev-parse --abbrev-ref HEAD)
        fi
        git -C "$repo_dir" checkout "$default_branch" >/dev/null 2>&1 || true
        if git -C "$repo_dir" -c http.extraheader="$header" pull --ff-only origin "$default_branch"; then
            :
        else
            # Local modifications blocked the fast-forward. These clones are
            # machine-managed views; the sync must never block bootstrap on
            # them. Recovery ladder: stash the local edits, retry, and re-apply
            # when the stashed work is not superseded by upstream. A conflicted
            # stash stays in the stash stack (nothing is lost) with a loud
            # warning; the clone updates regardless.
            local stash_ref=""
            local dirty
            dirty=$(git -C "$repo_dir" status --porcelain)
            if [ -n "$dirty" ]; then
                if git -C "$repo_dir" stash push -m "pre-sync auto-stash $(date +%Y-%m-%dT%H:%M:%S)" >/dev/null 2>&1 && stash_ref=$(git -C "$repo_dir" rev-parse -q --verify refs/stash); then
                    echo "$label: local changes stashed to make the fast-forward possible"
                else
                    echo "WARNING: $label has local changes that could not be stashed; the clone may be stale. Not a bootstrap blocker."
                    return 0
                fi
            fi
            if git -C "$repo_dir" -c http.extraheader="$header" pull --ff-only origin "$default_branch"; then
                if [ -n "$stash_ref" ]; then
                    # Re-apply the stashed edits unless upstream already made
                    # them. Redundancy is judged per changed file: a stash whose
                    # post-image matches the updated HEAD content is a no-op
                    # (the common "same rename made upstream" case) and is
                    # dropped; anything else re-applies via apply --check, and
                    # a true conflict stays in the stash stack, never lost.
                    local redundant=true
                    local f
                    while IFS= read -r f; do
                        [ -n "$f" ] || continue
                        if ! git -C "$repo_dir" diff --quiet "$stash_ref^" "$stash_ref" -- "$f" 2>/dev/null; then
                            if ! git -C "$repo_dir" show "$stash_ref":"$f" 2>/dev/null | \
                               git -C "$repo_dir" hash-object --stdin 2>/dev/null | \
                               grep -qFx "$(git -C "$repo_dir" rev-parse "$default_branch:$f" 2>/dev/null)"; then
                                redundant=false
                                break
                            fi
                        fi
                    done < <(git -C "$repo_dir" diff --name-only "$stash_ref^" "$stash_ref" 2>/dev/null)
                    if [ "$redundant" = true ]; then
                        git -C "$repo_dir" stash drop "$stash_ref" >/dev/null 2>&1 || true
                        echo "$label: stashed local changes were already made upstream; dropped as redundant"
                    elif git -C "$repo_dir" stash show -p "$stash_ref" 2>/dev/null | git -C "$repo_dir" apply --check --quiet 2>/dev/null; then
                        git -C "$repo_dir" stash pop >/dev/null 2>&1 || true
                        echo "$label: stashed local changes re-applied on top of the updated clone"
                    else
                        echo "WARNING: $label local changes could not be re-applied onto the updated clone (upstream reworked the same areas); they are preserved in the stash stack — recover with 'git stash pop' in $repo_dir. Not a bootstrap blocker."
                    fi
                fi
            else
                echo "WARNING: $label could not be fast-forwarded (non-fast-forwardable state); the clone may be stale. Not a bootstrap blocker."
            fi
        fi
    else
        if [ -d "$repo_dir" ] && [ -n "$(ls -A "$repo_dir" 2>/dev/null)" ]; then
            local backup_dir
            mkdir -p "$backup_parent"
            backup_dir="$backup_parent/pre-sync.$(date +%Y%m%d%H%M%S)"
            mv "$repo_dir" "$backup_dir"
            echo "Existing non-git $label folder moved to $backup_dir"
        fi
        rm -rf "$repo_dir"
        git -c http.extraheader="$header" clone "$repo_url" "$repo_dir"
    fi

    local content_source="$repo_dir/$subpath"
    if [ ! -d "$content_source" ]; then
        echo "ERROR: $label subpath not found: $content_source"
        return 1
    fi

    mkdir -p "$HOME/.copilot"
    rm -rf "$link_path"
    ln -s "$content_source" "$link_path"
    echo "$label symlinked: $link_path → $content_source"
}

# Ensure the provider auth seam is loaded. Both bootstrap flows source
# git-operations (via configure_git) before reaching the sync/config functions
# that need it, but this guard makes the seam's availability explicit rather
# than call-order-dependent.
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
        # A [provider] name that is not shipped stops bootstrap with the reason, rather than
        # carrying on as another provider.
        provider_detect "$toolbox_root/devenv.config" || {
            echo "ERROR: cannot determine the provider from $toolbox_root/devenv.config (see above)"
            exit 1
        }
        local auth_mod
        # seam_lib already resides in providers/, so the per-provider module
        # is a direct child dir — not providers/providers/<name>.
        auth_mod="$(dirname "$seam_lib")/${PROVIDER_NAME}/auth.bash"
        # shellcheck disable=SC1090,SC1091
        if [ -f "$auth_mod" ]; then
            source "$auth_mod"
        fi
        # The provider's bootstrap hooks (validation, package feeds).
        local hooks_mod
        hooks_mod="$(dirname "$seam_lib")/${PROVIDER_NAME}/bootstrap.bash"
        # shellcheck disable=SC1090,SC1091
        if [ -f "$hooks_mod" ]; then
            source "$hooks_mod"
        fi
    fi
}

# Clone or update configured Copilot knowledge repo and link ~/.copilot/knowledge
sync_copilot_knowledge() {
    echo "# Sync Copilot knowledge"
    echo "#############################################"

    local repo_url="${COPILOT_KNOWLEDGE_REPO:-}"
    local subpath="${COPILOT_KNOWLEDGE_SUBPATH:-}"
    local knowledge_repo_dir="$toolbox_root/copilot/knowledge"

    if [ -z "$repo_url" ]; then
        echo "No [copilot] knowledge_repo configured; skipping knowledge sync"
        return 0
    fi

    sync_copilot_side_repo \
        "$repo_url" "$subpath" "$knowledge_repo_dir" \
        "$HOME/.copilot/knowledge" \
        "Copilot knowledge" \
        "$toolbox_root/.runtime/copilot-knowledge-backups"
}

# Clone or update configured engineering standards repo and link ~/.copilot/engineering
sync_copilot_engineering() {
    echo "# Sync engineering standards"
    echo "#############################################"

    local repo_url="${COPILOT_ENGINEERING_REPO:-}"
    local subpath="${COPILOT_ENGINEERING_SUBPATH:-}"
    local engineering_repo_dir="$toolbox_root/copilot/engineering"

    if [ -z "$repo_url" ]; then
        echo "No [copilot] engineering_repo configured; skipping engineering standards sync"
        return 0
    fi

    sync_copilot_side_repo \
        "$repo_url" "$subpath" "$engineering_repo_dir" \
        "$HOME/.copilot/engineering" \
        "Engineering standards" \
        "$toolbox_root/.runtime/copilot-engineering-backups"
}

# Copy Copilot instructions to ~/.copilot/copilot-instructions.md
# and symlink ~/.copilot/skills → <devenv>/copilot/skills so that
# Copilot's default user-home skills path picks them up in every workspace.
# Point DEST at SRC. A symlink at DEST is (re)pointed; anything that is not a
# symlink (a real file or directory the user keeps there) is left untouched with
# a warning and never deleted.
#
# Usage: link_replacing_symlink_only SRC DEST
link_replacing_symlink_only() {
    local src="$1" dest="$2"
    if [ -L "$dest" ]; then
        [ "$(readlink "$dest")" = "$src" ] && return 0
        ln -sfn "$src" "$dest"
    elif [ -e "$dest" ]; then
        echo "WARNING: $dest exists and is not a symlink; left in place (move it aside to link it to $src)"
        return 0
    else
        ln -s "$src" "$dest"
    fi
    echo "Linked: $dest → $src"
}

install_copilot_instructions() {
    echo "# Install Copilot instructions"
    echo "#############################################"
    local src="$toolbox_root/copilot/copilot-instructions.md"
    local dest="$HOME/.copilot/copilot-instructions.md"
    if [ -f "$src" ]; then
        mkdir -p "$HOME/.copilot"
        link_replacing_symlink_only "$src" "$dest"
    else
        echo "WARNING: copilot/copilot-instructions.md not found, skipping"
    fi

    # Symlink ~/.copilot/skills → devenv's skills folder so skills are
    # available in every VS Code window regardless of which repo is open.
    local skills_src="$toolbox_root/copilot/skills"
    local skills_link="$HOME/.copilot/skills"
    if [ -d "$skills_src" ]; then
        mkdir -p "$HOME/.copilot"
        link_replacing_symlink_only "$skills_src" "$skills_link"
    else
        echo "WARNING: copilot/skills not found, skipping skills symlink"
    fi

}

# Link Copilot instructions and individual skills into ~/.claude/, so the
# Claude Code VS Code
# extension reads the same instructions and skills as GitHub Copilot.
install_claude_code_integration() {
    echo "# Install Claude Code integration"
    echo "#############################################"
    local src="$toolbox_root/copilot/copilot-instructions.md"
    local dest="$HOME/.claude/CLAUDE.md"
    if [ -f "$src" ]; then
        mkdir -p "$HOME/.claude"
        link_replacing_symlink_only "$src" "$dest"
    else
        echo "WARNING: copilot/copilot-instructions.md not found, skipping"
    fi

    # Link skills and shared references without replacing Claude's personal
    # skills directory or its synced account skills.
    local skills_src="$toolbox_root/copilot/skills"
    local skills_link="$HOME/.claude/skills"
    if [ -d "$skills_src" ]; then
        mkdir -p "$HOME/.claude"
        if [ -L "$skills_link" ]; then
            echo "WARNING: Claude skills root must be a real directory; leaving it unchanged"
            return 1
        fi
        mkdir -p "$skills_link"
        local entry entry_name target
        for entry in "$skills_src"/*; do
            [ -e "$entry" ] || continue
            entry_name="${entry##*/}"
            [ "$entry_name" != "synced" ] || continue
            target="$skills_link/$entry_name"
            if [ -e "$target" ] && [ ! -L "$target" ]; then
                echo "WARNING: existing Claude skills entry preserved: $target"
                continue
            fi
            ln -sfn "$entry" "$target"
        done
        echo "Claude Code skill links installed under: $skills_link"
    else
        echo "WARNING: copilot/skills not found, skipping skills symlink"
    fi

}

# Ensure required directories exist and configure system settings
ensure_directories_and_settings() {
    echo "# Other configuration"
    echo "#############################################"
    mkdir -p $toolbox_root/.debug/data
    mkdir -p $toolbox_root/.debug/config
    mkdir -p $toolbox_root/repos
    mkdir -p $toolbox_root/tmp
    mkdir -p $toolbox_root/playground
    mkdir -p $toolbox_root/tools/custom
    mkdir -p "$toolbox_root/.runtime"
    if [[ ! -d "$toolbox_root/.debug/remote_debugger" ]]; then
        debugger_script="$DEVENV_ROOT/.devcontainer/download-csharp-debugger.sh"
        if [ -f "$debugger_script" ]; then
            $debugger_script
        else
            echo "INFO: download-csharp-debugger.sh not found (optional)"
        fi
    fi
    # Sanity: the C# debugger must actually work after install (Plan-004
    # follow-up: hunts drive it via tools/csharp-debug). A downloaded-but-
    # broken vsdbg fails LATE (mid-hunt) instead of early — verify here.
    if [ -x "$toolbox_root/.debug/remote_debugger/vsdbg" ]; then
        if ! "$toolbox_root/.debug/remote_debugger/vsdbg" --help >/dev/null 2>&1; then
            echo "WARN: vsdbg downloaded but not executable-functional — C# debugging unavailable this session" >&2
        fi
    else
        echo "INFO: vsdbg not installed (optional; C# debugger attach unavailable)"
    fi
    # dotnet diagnostic optics (hunt Rung-5/6: traces, counters, dumps) —
    # installed as local dotnet tools, best-effort (network-independent boot).
    if command -v dotnet >/dev/null 2>&1; then
        for _diag_tool in dotnet-trace dotnet-counters dotnet-dump; do
            if ! dotnet tool list --global 2>/dev/null | grep -q "$_diag_tool"; then
                dotnet tool install --global "$_diag_tool" >/dev/null 2>&1 \
                    || echo "INFO: $_diag_tool not installed (optional diagnostic optic)"
            fi
        done
    fi
    if ! grep -qF 'fs.inotify.max_user_instances=524288' /etc/sysctl.conf 2>/dev/null; then
        echo fs.inotify.max_user_instances=524288 | sudo tee -a /etc/sysctl.conf &>/dev/null
    fi
    sudo sysctl -p 2>/dev/null || echo "INFO: Some sysctl settings may not be applicable in container environment"
    sudo usermod -aG docker vscode
    sudo mkdir -p /etc/docker
    #sudo echo '{}' | sudo tee /etc/docker/daemon.json &>/dev/null
    #echo '{ "default-runtime": "runc", "runtimes": { "runc": { "path": "runc" } }, "exec-opts": ["native.cgroupdriver=cgroupfs"], "storage-driver": "overlay2" }' | sudo tee /etc/docker/daemon.json &>/dev/null
}

# Configure NuGet sources: the local development source here, the provider's own
# package feed through its bootstrap hook (a provider with no feed registers nothing).
configure_nuget_sources() {
    ensure_provider_seam
    echo "# Configure nuget"
    echo "#############################################"

    local_nuget_dev=$toolbox_root/.debug/local-nuget-dev
    mkdir -p $local_nuget_dev

    add_nuget_source_if_not_exists "dev" $local_nuget_dev

    provider_bootstrap_call configure_nuget
}

# Configure user npmrc file: keep it owner-only, and let the provider authenticate
# its own registry through its bootstrap hook.
configure_user_npmrc() {
    ensure_provider_seam
    echo "# Configure user npmrc file"
    echo "#############################################"
    local npmrc_file="$HOME/.npmrc"
    if [ -f "$npmrc_file" ]; then
        chmod 600 "$npmrc_file"
        # Drop an exact status line that ended up in the file as if it were a setting.
        sed -i '/^Skipping npmrc auth token (gh not authenticated)$/d' "$npmrc_file"
    fi
    provider_bootstrap_call configure_npmrc "$npmrc_file"
}

# Run custom bootstrap scripts if present
run_custom_bootstrap_if_present() {
    # Run organization-level custom bootstrap (for forked repos)
    if [ -f "$toolbox_root/.devcontainer/org-custom-bootstrap.sh" ]; then
        echo "Running organization-level custom bootstrap..."
        /bin/bash "$toolbox_root/.devcontainer/org-custom-bootstrap.sh"
    fi
    
    # Run user-level custom bootstrap (user-specific customizations)
    if [ -f "$toolbox_root/.devcontainer/user-custom-bootstrap.sh" ]; then
        echo "Running user-level custom bootstrap..."
        /bin/bash "$toolbox_root/.devcontainer/user-custom-bootstrap.sh"
    fi
}

# Cleanup packages
cleanup_packages() {
    echo "# Cleanup"
    echo "#############################################"
    # `|| true`: pkill exits 1 when no process matches, which must not fail
    # the step under the tool's set -e session (the old chain swallowed it).
    pkill ssh-agent &>/dev/null || true
    sudo apt autoremove -y
}
