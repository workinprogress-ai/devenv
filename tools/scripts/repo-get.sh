#!/bin/bash
set -euo pipefail

repos_dir="$DEVENV_ROOT/repos"

source "$DEVENV_ROOT/tools/lib/git-config.bash"
if [ -f "$DEVENV_ROOT/tools/lib/error-handling.bash" ]; then
    # Optional helper for explode-like helpers if present upstream
    source "$DEVENV_ROOT/tools/lib/error-handling.bash"
fi

usage() {
  echo "Usage: $(basename "$0") <repository-name>" >&2
  echo "  repository-name: Name of the GitHub repository (alphanumeric, hyphens, and dots)" >&2
}

# Validate required environment variables
if [ -z "${GH_USER:-}" ]; then
    echo "ERROR: 'GH_USER' is not set. Cannot continue." >&2
    exit 1
fi

if [ -z "${GH_TOKEN:-}" ]; then
    echo "ERROR: 'GH_TOKEN' is not set. Cannot continue." >&2
    exit 1
fi

# Validate repo arg or infer from current git repo
if [ -z "${1:-}" ]; then
    REPO_NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" || echo "")
    if [ -z "$REPO_NAME" ]; then
        echo "ERROR: Failed to detect repository name. Provide it explicitly." >&2
        usage
        exit 1
    fi
    if [ ! -d "$repos_dir/$REPO_NAME" ]; then
        echo "ERROR: Repository '$REPO_NAME' does not exist in $repos_dir" >&2
        exit 1
    fi
else
    input_repo="${1%/}"
    if [[ ! "$input_repo" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]; then
        echo "ERROR: Invalid repository name: $input_repo" >&2
        usage
        exit 1
    fi
    case "$input_repo" in
        .|..|repos)
            echo "ERROR: Invalid repository name: $input_repo" >&2
            usage
            exit 1
            ;;
    esac
    REPO_NAME="$input_repo"
fi

# Ensure GH_ORG is set
if [ -z "${GH_ORG:-}" ]; then
    echo "ERROR: GH_ORG environment variable is not set. Run 'setup' first." >&2
    exit 1
fi

TARGET_DIR="$repos_dir/$REPO_NAME"
GIT_URL_PREFIX="https://${GH_USER}:${GH_TOKEN}@github.com/${GH_ORG}"
GIT_URL="${GIT_URL_PREFIX}/${REPO_NAME}.git"

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

if [ -d "$TARGET_DIR" ]; then
    update_existing_repo
else
    clone_repo
fi

echo "Operation completed successfully." >&2