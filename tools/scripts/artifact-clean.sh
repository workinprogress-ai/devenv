#!/bin/bash
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# artifact-clean.sh - Clean up `.local-artifacts/` folders by artifact family
# Version: 1.0.0
# Description: Interactive (default) or flag-driven cleanup of local artifact
#              folders. Files are grouped into the three convention families
#              from _conventions.md (ephemeral tmpN.md, session memory,
#              issue-artifact working copies) plus an "other" bucket. Deletion
#              confidence matches family: ephemeral needs no confirmation;
#              working/session/other require an explicit -y/--yes or
#              interactive confirmation. Never touches anything outside
#              .local-artifacts/.
# Requirements: Bash 4.0+, git (for repo root discovery)
# Last Modified: 2026-09-13

# Note: Strict error handling (set -euo pipefail and ERR trap) is configured
# via enable_strict_mode() from error-handling.bash after sourcing libraries

# ============================================================================
# Source Required Libraries
# ============================================================================

readonly SCRIPT_VERSION="1.0.0"
readonly FOLDER_NAME=".local-artifacts"
SCRIPT_NAME="$(basename "$0")"

# shellcheck source=../lib/error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"

# shellcheck source=../lib/versioning.bash
source "$DEVENV_TOOLS/lib/versioning.bash"

# Enable strict error handling (sets -euo pipefail and ERR trap)
enable_strict_mode

script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Clean local artifact folders by family"

# ============================================================================
# Helpers
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [PATH...] [OPTIONS]

Clean up $FOLDER_NAME/ folders by artifact family. With no PATH, operates on
the nearest directory (walking up from cwd) that contains a $FOLDER_NAME.

Families (per the .local-artifacts convention):
    ephemeral   tmpN.md scratch files (short-lived; deleted without confirmation)
    session     session_memory-*.md planning-skill memory (confirm or -y)
    working     Plan-issue-*.md / Grooming-*.md / Specifications-*.md /
                Blueprint-*.md / Roadmap-*.md — local working copies of
                issue-published artifacts (confirm or -y)
    other       anything else in the folder (confirm or -y; never silently
                deleted)

Options:
    -i, --interactive   Interactive family-by-family selection (default when
                        no family flags are given and stdin is a TTY)
    --tmp               Ephemeral family only
    --session           Session-memory family only
    --working           Issue working-copy family only
    --all               Every family, including other
    -y, --yes           Assume yes for all confirmations
    -l, --list          List what would be cleaned per family; delete nothing
    -h, --help          Show this help message
    -v, --version       Show version and exit

Exit codes:
    0 cleanup completed (or nothing to do)
    1 invalid arguments
    2 no artifact folder found

Examples:
    $SCRIPT_NAME                      # interactive selection
    $SCRIPT_NAME --tmp                # drop scratch files, no prompts
    $SCRIPT_NAME --working -y         # clear working copies, no prompts
    $SCRIPT_NAME repos/foo -l         # list-only for a specific repo
    $SCRIPT_NAME --all -y             # full sweep, no prompts
EOF
    exit 0
}

# Walk up from $PWD to the nearest directory containing the artifact folder.
discover_artifact_root() {
    local dir="$PWD"
    while [ "$dir" != "/" ]; do
        if [ -d "$dir/$FOLDER_NAME" ]; then
            echo "$dir"
            return 0
        fi
        dir=$(dirname "$dir")
    done
    return 1
}

# classify FILENAME -> family name (mirror of the _conventions.md families)
classify() {
    local f="$1"
    case "$f" in
        tmp[0-9]*.md) echo "ephemeral" ;;
        session_memory-*.md) echo "session" ;;
        Plan-issue-*.md|Grooming-*.md|Specifications-*.md|Blueprint-*.md|Roadmap-*.md) echo "working" ;;
        *) echo "other" ;;
    esac
}

# print files in FOLDER belonging to FAMILY, one per line
collect_family() {
    local folder="$1" family="$2"
    local f base
    [ -d "$folder" ] || return 0
    for f in "$folder"/*; do
        [ -e "$f" ] || continue
        base=$(basename "$f")
        if [ "$(classify "$base")" = "$family" ]; then
            echo "$f"
        fi
    done
}

delete_files() {
    local f
    for f in "$@"; do
        rm -f -- "$f"
    done
}

confirm_files() {
    local label="$1"
    shift
    local f answer
    echo "  $label:"
    for f in "$@"; do
        echo "    - $(basename "$f")"
    done
    printf "  Delete these %d file(s)? [y/N] " "$#"
    if ! read -r answer < /dev/tty; then
        echo "Non-interactive session: refusing deletion (pass --yes to skip the prompt)." >&2
        return 1
    fi
    [ "$answer" = "y" ] || [ "$answer" = "Y" ]
}

# ============================================================================
# Main
# ============================================================================

main() {
    local MODE="" ASSUME_YES=0 LIST_ONLY=0
    local -a USER_PATHS=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) show_usage ;;
            -v|--version) echo "$SCRIPT_VERSION"; exit 0 ;;
            -i|--interactive) MODE="interactive"; shift ;;
            --tmp) MODE="${MODE}tmp"; shift ;;
            --session) MODE="${MODE}session"; shift ;;
            --working) MODE="${MODE}working"; shift ;;
            --all) MODE="tmp session working other"; shift ;;
            -y|--yes) ASSUME_YES=1; shift ;;
            -l|--list) LIST_ONLY=1; shift ;;
            --*) invalid_args "Unknown option: $1" ;;
            *) USER_PATHS+=("$1"); shift ;;
        esac
    done

    # Resolve target roots
    local -a roots=()
    local p root
    if [ "${#USER_PATHS[@]}" -gt 0 ]; then
        for p in "${USER_PATHS[@]}"; do
            [ -e "$p" ] || invalid_args "Path not found: $p"
            if [ -d "$p/$FOLDER_NAME" ]; then
                roots+=("$p")
            elif [ "$(basename "$p")" = "$FOLDER_NAME" ]; then
                roots+=("$(dirname "$p")")
            else
                log_warn "No $FOLDER_NAME under $p — skipping"
            fi
        done
        [ "${#roots[@]}" -gt 0 ] || exit 2
    else
        if ! root=$(discover_artifact_root); then
            log_error "No $FOLDER_NAME found between $PWD and /"
            exit 2
        fi
        roots=("$root")
    fi

    # Default mode: interactive when no family flags and stdin is a TTY;
    # otherwise degrade to list-only across ALL families so non-interactive
    # callers get a full inventory and never prompt.
    if [ -z "$MODE" ]; then
        if [ -t 0 ]; then
            MODE="interactive"
        else
            MODE="tmp session working other" ; LIST_ONLY=1
            log_warn "No family flags given and stdin is not a TTY — defaulting to list-only"
        fi
    fi

    local deleted=0 folder family f
    for root in "${roots[@]}"; do
        folder="$root/$FOLDER_NAME"
        log_info "Scanning $folder"

        local -a families=()
        if [ "$MODE" = "interactive" ]; then
            families=(ephemeral session working other)
        else
            [[ "$MODE" == *tmp* ]] && families+=(ephemeral)
            [[ "$MODE" == *session* ]] && families+=(session)
            [[ "$MODE" == *working* ]] && families+=(working)
            [[ "$MODE" == *other* ]] && families+=(other)
        fi

        for family in "${families[@]}"; do
            local -a files=()
            while IFS= read -r f; do
                [ -n "$f" ] && files+=("$f")
            done < <(collect_family "$folder" "$family")
            [ "${#files[@]}" -gt 0 ] || continue

            if [ "$LIST_ONLY" -eq 1 ]; then
                echo "[$family] would clean ${#files[@]} file(s):"
                for f in "${files[@]}"; do echo "  - $(basename "$f")"; done
                continue
            fi

            case "$family" in
                ephemeral)
                    delete_files "${files[@]}"
                    deleted=$((deleted + ${#files[@]}))
                    log_info "[$family] deleted ${#files[@]} file(s) (no confirmation needed)"
                    ;;
                *)
                    if [ "$ASSUME_YES" -eq 1 ]; then
                        delete_files "${files[@]}"
                        deleted=$((deleted + ${#files[@]}))
                        log_info "[$family] deleted ${#files[@]} file(s) (-y)"
                    elif [ -t 0 ]; then
                        if confirm_files "[$family]" "${files[@]}"; then
                            delete_files "${files[@]}"
                            deleted=$((deleted + ${#files[@]}))
                            log_info "[$family] deleted ${#files[@]} file(s)"
                        else
                            log_info "[$family] skipped"
                        fi
                    else
                        log_warn "[$family] ${#files[@]} file(s) need confirmation; rerun with a TTY or -y"
                    fi
                    ;;
            esac
        done
    done

    if [ "$LIST_ONLY" -eq 1 ]; then
        log_info "List-only mode — nothing deleted"
    else
        log_info "Done. $deleted file(s) deleted."
    fi
    exit 0
}

main "$@"
