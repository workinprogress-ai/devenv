#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# Clone or update a repository from the organization
# Usage: 
#   repo-get.sh <repository-name>          # Clone/update specific repo
#   repo-get.sh --select                   # Interactive selection from available repos
#   repo-get.sh --all                      # Clone all repos not yet present locally
#   repo-get.sh                             # Update current repo (git context)
set -euo pipefail

repos_dir="$DEVENV_ROOT/repos"

source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/repo-operations.bash"
source "$DEVENV_TOOLS/lib/fzf-selection.bash"
source "$DEVENV_TOOLS/lib/error-handling.bash"

usage() {
  echo "Usage: $(basename "$0") [--select|--all] [<repository-name>|<repository-url>]" >&2
  echo "  --select: Show a selection list of repositories in the organization (excludes already cloned repos)" >&2
  echo "  --all: Clone all repositories in the organization not already present locally" >&2
  echo "  repository-name: Name of the GitHub repository (alphanumeric, hyphens, and dots)" >&2
  echo "  repository-url: Full URL to a foreign repository (https:// or git@); cloned flat into repos/ by its basename" >&2
}

# True when the argument is a repository URL (foreign repo) rather than an
# org repo name: https://host/owner/repo[.git], git@host:owner/repo[.git],
# ssh://, or any value ending in .git.
is_foreign_url() {
  local arg="${1:-}"
  case "$arg" in
    https://*|http://*|git@*|ssh://git@*|*.git) return 0 ;;
    *) return 1 ;;
  esac
}

# Foreign URL -> local folder name: URL basename minus .git, sanitized with
# the same character rules as org repo names (defends against URL tricks —
# path traversal, embedded whitespace, control characters).
foreign_repo_name() {
  local url="${1%/}"
  local name
  name="${url##*/}"
  name="${name%.git}"
  if ! [[ "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]; then
    echo "ERROR: Cannot derive a valid folder name from URL: $url" >&2
    return 1
  fi
  case "$name" in
    repos|devenv|.|..)
      echo "ERROR: Derived folder name is reserved: $name" >&2
      return 1
      ;;
  esac
  printf '%s' "$name"
}

# Function to select a repo using fzf
select_repo_interactive() {
    check_fzf_installed || exit 1
    
    local org_repos
    local local_repos
    local available_repos
    
    org_repos=$(list_organization_repositories "$(provider_org_get)" 1000) || {
        echo "ERROR: Failed to list organization repositories" >&2
        exit 1
    }
    
    local_repos=$(list_local_repositories "$repos_dir")
    available_repos=$(filter_available_repositories "$org_repos" "$local_repos")
    
    if [ -z "$available_repos" ]; then
        echo "ERROR: No repositories available to clone (all repos already exist in $repos_dir)" >&2
        exit 1
    fi
    
    local selected
    selected=$(fzf_select_single "$available_repos" "Select repository to clone: ")
    
    if [ -z "$selected" ]; then
        echo "ERROR: No repository selected" >&2
        exit 1
    fi
    
    echo "$selected"
}

# Function to get all repos not yet cloned locally
get_available_repos() {
    local org_repos
    local local_repos
    local available_repos

    org_repos=$(list_organization_repositories "$(provider_org_get)" 1000) || {
        echo "ERROR: Failed to list organization repositories" >&2
        exit 1
    }

    local_repos=$(list_local_repositories "$repos_dir")
    available_repos=$(filter_available_repositories "$org_repos" "$local_repos")

    echo "$available_repos"
}

# Parse options
SELECT_MODE=false
ALL_MODE=false
if [ "${1:-}" = "--select" ]; then
    SELECT_MODE=true
    shift
elif [ "${1:-}" = "--all" ]; then
    ALL_MODE=true
    shift
elif [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    usage
    exit 0
fi

# Validate repo arg or infer from current git repo
if [ "$SELECT_MODE" = true ]; then
    REPO_NAME=$(select_repo_interactive)
elif [ "$ALL_MODE" = true ]; then
    REPO_NAME=""
elif [ -z "${1:-}" ]; then
    REPO_NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" || echo "")
    if [ -z "$REPO_NAME" ]; then
        usage
        exit 1
    fi
    # Check if we're in the devenv repo itself (not a target repo)
    if [ "$REPO_NAME" = "devenv" ] || [ ! -d "$repos_dir/$REPO_NAME" ]; then
        usage
        exit 1
    fi
else
    input_repo="${1%/}"
    if is_foreign_url "$input_repo"; then
        FOREIGN_URL="$input_repo"
        if ! REPO_NAME="$(foreign_repo_name "$input_repo")"; then
            exit 1
        fi
    elif ! validate_repository_name "$input_repo"; then
        echo "ERROR: Invalid repository name: $input_repo" >&2
        usage
        exit 1
    else
        REPO_NAME="$input_repo"
    fi
fi

# Foreign mode: a full URL was given — clone/update from that URL directly.
# Org resolution, the provider auth precheck, and configure_git_repo's org
# credential-helper wiring do not apply; auth is the user's own git config.
if [ -n "${FOREIGN_URL:-}" ]; then
    TARGET_DIR="$repos_dir/$REPO_NAME"
    GIT_URL="$FOREIGN_URL"
    if [ -d "$TARGET_DIR/.git" ]; then
        existing_remote="$(git -C "$TARGET_DIR" remote get-url origin 2>/dev/null || echo "")"
        if [ -n "$existing_remote" ] && [ "$existing_remote" != "$GIT_URL" ]; then
            # Redact embedded credentials before displaying — remotes may carry
            # user:token@ auth, and error output must never echo secrets.
            display_remote="${existing_remote//:*@/:***@}"
            display_remote="${display_remote//https:\/\/[^\/]*@/https://}"
            echo "ERROR: $TARGET_DIR already exists as a clone of a different repository:" >&2
            echo "  existing remote: $display_remote" >&2
            echo "  requested URL  : $GIT_URL" >&2
            echo "Refusing to mix remotes. Remove the folder if it is truly the same repo." >&2
            exit 1
        fi
        echo "Foreign repository '$REPO_NAME' already exists. Fetching latest changes..." >&2
        git -C "$TARGET_DIR" fetch --all --tags -f
        default_branch="$(git -C "$TARGET_DIR" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
        default_branch="${default_branch#origin/}"
        [ -n "$default_branch" ] || default_branch=main
        current_branch="$(git -C "$TARGET_DIR" rev-parse --abbrev-ref HEAD)"
        if [ "$current_branch" != "$default_branch" ]; then
            git -C "$TARGET_DIR" pull --rebase
        else
            git -C "$TARGET_DIR" pull --ff-only
        fi
    else
        echo "Cloning foreign repository '$REPO_NAME' from $GIT_URL..." >&2
        git clone "$GIT_URL" "$TARGET_DIR"
    fi
    if [ -f "$TARGET_DIR/.repo/update.sh" ]; then
        echo "=> Running update script for $REPO_NAME..." >&2
        (cd "$TARGET_DIR" && ./.repo/update.sh)
    fi
    if [ -f "$TARGET_DIR/.repo/init.sh" ] && [ ! -f "$TARGET_DIR/.repo/.inited" ]; then
        echo "=> Running init script for $REPO_NAME..." >&2
        (cd "$TARGET_DIR" && ./.repo/init.sh)
    fi
    echo "Foreign repository operation completed successfully." >&2
    exit 0
fi

# Resolve the org via the provider accessor (env override → config → seed).
if ! ORG="$(provider_org_get)"; then
    exit 1
fi

# gh must be authenticated (keychain or session export); clones use clean
# URLs with git auth via the provider credential helper.
if ! provider_auth_status >/dev/null 2>&1; then
    echo "ERROR: provider CLI is not authenticated. Run 'key-update-git' first." >&2
    exit 1
fi

TARGET_DIR="$repos_dir/$REPO_NAME"
# Clean URL: authentication flows through gh's credential helper
# (gh auth setup-git), never embedded in the remote.
GIT_URL="$(provider_git_transport_url "$ORG" "$REPO_NAME")"

detect_default_branch() {
    local ref
    ref=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
    ref=${ref#origin/}
    if [ -n "$ref" ]; then
        echo "$ref"
    elif git show-ref --verify --quiet refs/heads/main; then
        echo "main"
    else
        echo "master"
    fi
}

update_existing_repo() {
    local default_branch
    default_branch=$(detect_default_branch)

    echo "Repository '$REPO_NAME' already exists. Fetching latest changes..." >&2
    cd "$TARGET_DIR"
    configure_git_repo "." "$GIT_URL"
    git fetch --all --tags -f

    local current_branch
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    if [ "$current_branch" != "$default_branch" ]; then
        git branch -f "$default_branch" "origin/$default_branch" || true
        git pull --rebase
    else
        git reset --hard "origin/$default_branch"
    fi

    local update_script=".repo/update.sh"
    if [ -f "$update_script" ]; then
        echo "=> Running update script for $REPO_NAME..." >&2
        "$update_script"
    fi

    cd - &>/dev/null
}

clone_repo() {
    echo "Repository '$REPO_NAME' does not exist. Attempting to clone..." >&2
    git clone "$GIT_URL" "$TARGET_DIR"
    cd "$TARGET_DIR"
    configure_git_repo "." "$GIT_URL"
    git fetch --all --tags -f

    local init_script=".repo/init.sh"
    if [ -f "$init_script" ]; then
        echo "=> Running init script for $REPO_NAME..." >&2
        "$init_script"
    fi

    cd - &>/dev/null
}

if [ "$ALL_MODE" = true ]; then
    available=$(get_available_repos)
    if [ -z "$available" ]; then
        echo "All organization repositories are already cloned in $repos_dir" >&2
        exit 0
    fi

    failed=()
    while IFS= read -r repo; do
        [ -z "$repo" ] && continue
        REPO_NAME="$repo"
        TARGET_DIR="$repos_dir/$REPO_NAME"
        GIT_URL="$(provider_git_transport_url "$ORG" "$REPO_NAME")"
        echo "==> Cloning $REPO_NAME..." >&2
        if ! clone_repo; then
            echo "WARNING: Failed to clone $REPO_NAME" >&2
            failed+=("$REPO_NAME")
        fi
    done <<< "$available"

    if [ ${#failed[@]} -gt 0 ]; then
        echo "WARNING: The following repositories could not be cloned:" >&2
        for r in "${failed[@]}"; do echo "  $r" >&2; done
        exit 1
    fi

    echo "All available repositories cloned successfully." >&2
    exit 0
fi

if [ -d "$TARGET_DIR" ]; then
    update_existing_repo
else
    clone_repo
fi

echo "Operation completed successfully." >&2