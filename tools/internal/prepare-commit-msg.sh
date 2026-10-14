#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# prepare-commit-msg.sh - Give a commit message its Change-Id trailer
# Version: 1.0.0
# Description: The prepare-commit-msg hook. Adds a stable Change-Id trailer when the
#              message has none, and an empty Devenv-Action placeholder when an
#              editor will open so the author can fill it in. An existing trailer is
#              never replaced, so amend, rebase and cherry-pick keep their identity.
# Requirements: Bash 4.0+, git

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/change-id.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME MESSAGE_FILE [SOURCE [SHA]]

Add a Change-Id trailer to the commit message in MESSAGE_FILE. SOURCE is the second
argument git passes to prepare-commit-msg:

    (empty), template     an editor will open: also add an empty Devenv-Action
    message, commit       -m/-F, cherry-pick, rebase pick, amend, reword: Change-Id only
    merge, squash         left untouched
    WIP: subject          left untouched (temporary by design)

Options:
    -h, --help            Show help and exit
    -v, --version         Show version and exit

Exit Codes:
    0 success
    2 invalid arguments
EOF
    exit 0
}

main() {
    case "${1:-}" in
        -h|--help) show_usage ;;
        -v|--version) echo "$SCRIPT_VERSION"; exit 0 ;;
    esac
    local file="${1:-}" source_kind="${2:-}" message existing
    local -a trailers=()
    [ -n "$file" ] || invalid_args "Provide the commit message file"
    [ -f "$file" ] || invalid_args "Message file not found: $file"

    case "$source_kind" in
        merge|squash) return 0 ;;
    esac
    case "$(head -n 1 "$file")" in
        WIP:*) return 0 ;;
    esac

    message="$(cat "$file")"
    existing="$(change_id_get_trailer "$message" "Change-Id")"
    if [ -z "$existing" ]; then
        trailers+=(--trailer "Change-Id: $(change_id_generate)")
    elif ! change_id_is_valid "$existing"; then
        echo "warning: the Change-Id '$existing' is not usable (8 to 64 characters from A-Z a-z 0-9 . _ -); fork-export will not export this commit" >&2
    fi
    case "$source_kind" in
        ""|template)
            [ -n "$(change_id_get_trailer "$message" "Devenv-Action")" ] || trailers+=(--trailer "Devenv-Action:")
            ;;
    esac
    [ "${#trailers[@]}" -eq 0 ] && return 0
    git interpret-trailers --in-place --if-exists doNothing "${trailers[@]}" "$file"
}

main "$@"
