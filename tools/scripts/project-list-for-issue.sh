#!/bin/bash
# project-list-for-issue.sh - List GitHub Projects containing an issue.
# Version: 1.0.0
# Description: Reverse lookup: every project an issue belongs to, with its
#              current Status value in each (read-only).
# Requirements: Bash 4.0+, gh CLI, jq
# Author: WorkInProgress.ai

set -uo pipefail

# Resolve the tools root from this script's own location (self-root contract).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/provider-loader.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "List projects containing an issue"

ISSUE_NUMBER=""
# shellcheck disable=SC2034  # read by check_target_repo in git-operations.bash
ALLOW_DEVENV_REPO=0
DRY_RUN=0
# shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
VERBOSE=0

usage() {
    cat <<EOF
Usage: $SCRIPT_NAME ISSUE_NUMBER [OPTIONS]

List every GitHub Project (v2) containing the given issue, with the issue's
current Status value in each project (dash when the project has no Status).

Arguments:
    ISSUE_NUMBER             Issue number to look up

Options:
    -h, --help               Show this help message and exit
    -v, --version            Show version information and exit
    -V, --verbose            Enable verbose output
    -n, --dry-run            No-op for symmetry with sibling wrappers

Output (one line per project):
    <project-title>\t<project-number>\t<status-or-dash>

Exit codes:
    0 — success (including zero projects: empty output)
    1 — usage error or query failure

Environment Variables:
    GITHUB_REPO              Repository in format owner/repo

Examples:
    $SCRIPT_NAME 42
    GITHUB_REPO=myorg/myrepo $SCRIPT_NAME 42
EOF
}

main() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                usage
                exit 0
                ;;
            -v|--version)
                echo "$SCRIPT_NAME version $SCRIPT_VERSION"
                exit 0
                ;;
            -V|--verbose)
                # shellcheck disable=SC2034  # read by log_verbose
                VERBOSE=1
                shift
                ;;
            -n|--dry-run)
                # shellcheck disable=SC2034  # reserved: fan-out wrapper symmetry
                DRY_RUN=1
                shift
                ;;
            -*)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
            *)
                if [ -z "$ISSUE_NUMBER" ]; then
                    ISSUE_NUMBER="$1"
                fi
                shift
                ;;
        esac
    done

    if [ -z "$ISSUE_NUMBER" ] || ! [[ "$ISSUE_NUMBER" =~ ^[0-9]+$ ]]; then
        log_error "A numeric ISSUE_NUMBER is required"
        echo "Use --help for usage information"
        exit 1
    fi

    check_dependencies
    check_target_repo

    local repo_spec owner repo issue_url
    repo_spec=$(resolve_target_repo) || exit 1
    owner="${repo_spec%%/*}"
    repo="${repo_spec#*/}"
    issue_url="$(provider_web_url "$owner/$repo" "issues/$ISSUE_NUMBER")"

    log_verbose "Looking up projects for $issue_url"
    provider_projects_for_issue "$issue_url" "$owner"
}

main "$@"
