#!/bin/bash
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# issue-label-create.sh - Create (or idempotently ensure) an issue label
# Version: 1.0.0
# Description: Creates a GitHub issue label with name, color, description.
#              Idempotent by default: skips when the label already exists
#              (unless --update). Supports --seed to create the standard
#              triage vocabulary from tools/config/labels-config.yml.
# Requirements: Bash 4.0+, gh CLI, jq, yq
# Author: WorkInProgress.ai
# Last Modified: 2026-09-08

set -euo pipefail
# shellcheck disable=SC2034  # VERBOSE is written here; read by log_verbose in error-handling.bash

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Create (or ensure) an issue label"

# ============================================================================
# Global Variables
# ============================================================================

LABEL_NAME=""
LABEL_COLOR=""
LABEL_DESCRIPTION=""
SEED=0
UPDATE=0
DRY_RUN=0
# shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME NAME [--color HEX] [--description TEXT] [OPTIONS]
       $SCRIPT_NAME --seed [OPTIONS]

Create a GitHub issue label. Idempotent: when the label already exists the
command skips it (exit 0) unless --update is given, in which case color and
description are updated.

Arguments:
    NAME                        Label name to create

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without creating
    -c, --color HEX             Label color as 6-digit hex, no '#' (e.g. d73a4a)
    -d, --description TEXT      Label description
    --update                    If the label exists, update color/description
                                instead of skipping
    --seed                      Create the standard triage vocabulary from
                                tools/config/labels-config.yml (ignores NAME)
    --devenv                    Safety override to create labels in devenv repo

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: curren
t repo)

Examples:
    # Create a single label (skips if it exists)
    $SCRIPT_NAME "area/auth" --color 1d76db --description "Authentication area"

    # Create or update
    $SCRIPT_NAME "priority/P1" --color d93f0b --update

    # Seed the standard triage vocabulary in a new repo
    $SCRIPT_NAME --seed

EOF
    exit 0
}

# Ensure a single label exists (create, or skip/update per flags).
# Usage: ensure_label NAME COLOR DESCRIPTION
ensure_label() {
    local name="$1" color="$2" description="$3"
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"

    local exists=0
    gh label list "${repo_spec[@]}" --limit 200 --json name 2>/dev/null \
        | jq -r --arg n "$name" 'any(.[]; .name == $n)' | grep -q true && exists=1

    if [ "$exists" -eq 1 ]; then
        if [ "$UPDATE" -eq 1 ]; then
            if [ "$DRY_RUN" -eq 1 ]; then
                log_info "[DRY RUN] Would update label: $name (color: ${color:-unchanged}, description: ${description:-unchanged})"
                return 0
            fi
            local args=("${repo_spec[@]}" "$name")
            [ -n "$color" ] && args+=(--color "$color")
            [ -n "$description" ] && args+=(--description "$description")
            if gh label edit "${args[@]}"; then
                log_info "Updated label: $name"
            else
                log_error "Failed to update label: $name"
                return 1
            fi
        else
            log_info "Label already exists (skipped): $name"
        fi
        return 0
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
        log_info "[DRY RUN] Would create label: $name (color: ${color:-default}, description: ${description:-none})"
        return 0
    fi

    local args=("${repo_spec[@]}" "$name")
    [ -n "$color" ] && args+=(--color "$color")
    [ -n "$description" ] && args+=(--description "$description")
    if gh label create "${args[@]}"; then
        log_info "Created label: $name"
    else
        log_error "Failed to create label: $name"
        return 1
    fi
}

seed_from_config() {
    local config="${DEVENV_TOOLS}/config/labels-config.yml"
    if [ ! -f "$config" ]; then
        log_error "Seed config not found: $config"
        exit $EXIT_API_FAILURE
    fi

    local count
    count=$(yq '.labels | length' "$config")
    if [ "$count" = "0" ] || [ -z "$count" ] || [ "$count" = "null" ]; then
        log_error "No labels defined in $config"
        exit "$EXIT_GENERAL_ERROR"
    fi

    log_info "Seeding $count labels from $(basename "$config")"
    local i name color description
    for ((i = 0; i < count; i++)); do
        name=$(yq ".labels[$i].name" "$config")
        color=$(yq ".labels[$i].color // \"\"" "$config")
        description=$(yq ".labels[$i].description // \"\"" "$config")
        ensure_label "$name" "$color" "$description" || exit "$EXIT_GENERAL_ERROR"
    done
    log_info "Seed complete"
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)          show_usage ;;
            -v|--version)       echo "$SCRIPT_VERSION"; exit 0 ;;
            -V|--verbose)
                # shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
                VERBOSE=1
                shift
                ;;
            -n|--dry-run)       DRY_RUN=1; shift ;;
            -c|--color)         LABEL_COLOR="$2"; shift 2 ;;
            -d|--description)   LABEL_DESCRIPTION="$2"; shift 2 ;;
            --update)           UPDATE=1; shift ;;
            --seed)             SEED=1; shift ;;
            --devenv)
                # shellcheck disable=SC2034  # Used by check_target_repo
                ALLOW_DEVENV_REPO=1; shift ;;
            *)
                if [ -z "$LABEL_NAME" ]; then
                    LABEL_NAME="$1"
                    shift
                else
                    log_error "Unknown option: $1"
                    echo "Use --help for usage information"
                    exit $EXIT_MISUSE
                fi
                ;;
        esac
    done

    # Validate inputs (before any network dependency)
    if [ "$SEED" -eq 0 ] && [ -z "$LABEL_NAME" ]; then
        log_error "Label NAME is required (or use --seed)"
        exit $EXIT_MISUSE
    fi
    if [ -n "$LABEL_COLOR" ] && ! [[ "$LABEL_COLOR" =~ ^[0-9a-fA-F]{6}$ ]]; then
        log_error "Invalid color: $LABEL_COLOR (must be 6-digit hex, no '#')"
        exit $EXIT_MISUSE
    fi

    check_dependencies
    check_target_repo
    # Global flags before auth/validation: --help must work without
    # a valid GitHub session or any positional args.
    if handle_global_flag "${1:-}"; then
        exit 0
    fi

    ensure_gh_login

    if [ "$SEED" -eq 1 ]; then
        seed_from_config
    else
        ensure_label "$LABEL_NAME" "$LABEL_COLOR" "$LABEL_DESCRIPTION"
    fi
}

# Run main function
main "$@"
