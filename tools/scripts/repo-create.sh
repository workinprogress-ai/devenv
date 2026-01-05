#!/bin/bash
set -euo pipefail
source "$DEVENV_TOOLS/lib/repo-operations.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"

usage() {
    echo "Usage: $(basename "$0") <repo-name> [--public|--private] [--description \"text\"]" >&2
    echo "Creates a GitHub repository under GH_ORG using gh CLI." >&2
}

require_cmd() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: '$cmd' is required but not installed." >&2
        exit 1
    fi
}

ensure_env() {
    if [ -z "${GH_ORG:-}" ]; then
        echo "ERROR: GH_ORG is not set. Run 'setup' first." >&2
        exit 1
    fi
    if [ -z "${GH_USER:-}" ]; then
        echo "ERROR: GH_USER is not set. Run 'setup' first." >&2
        exit 1
    fi
}

create_repo() {
    local repo_name="$1"
    local visibility="$2"
    local description="$3"
    local full_name="${GH_ORG}/${repo_name}"

    # Check if repo already exists
    if gh repo view "$full_name" >/dev/null 2>&1; then
        echo "Repository '$full_name' already exists. Nothing to do." >&2
        return 0
    fi

    local args=("repo" "create" "$full_name" "--${visibility}" "--confirm" "--disable-wiki")
    if [ -n "$description" ]; then
        args+=("--description" "$description")
    fi

    gh "${args[@]}"
    echo "Repository created: git@github.com:${full_name}.git"
}

main() {
    if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
        usage
        exit 0
    fi

    if [ $# -lt 1 ]; then
        usage
        exit 1
    fi

    local repo_name="$1"
    shift

    # Validate repository name using library function
    if ! validate_repository_name "$repo_name"; then
        echo "ERROR: Invalid repository name '$repo_name'." >&2
        exit 1
    fi

    local visibility="private"
    local description=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --public)
                visibility="public"
                ;;
            --private)
                visibility="private"
                ;;
            --description)
                shift
                description="${1:-}"
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            *)
                echo "ERROR: Unknown option '$1'" >&2
                usage
                exit 1
                ;;
        esac
        shift || true
    done

    require_cmd gh
    ensure_env
    # Use ensure_gh_login from github-helpers if available, otherwise inline check
    if declare -f ensure_gh_login >/dev/null 2>&1; then
        ensure_gh_login
    else
        gh auth status --hostname github.com >/dev/null 2>&1 || {
            echo "ERROR: Not authenticated with GitHub CLI. Run: gh auth login" >&2
            exit 1
        }
    fi
    create_repo "$repo_name" "$visibility" "$description"
}

main "$@"
