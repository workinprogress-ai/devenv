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

    (empty), template     an editor will open: also add Devenv-Action: nothing
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

    # NOTE: no comment-only guard here. The editor flow pre-fills trailers
    # (below) even into the bare `-e -n` scaffold; commit-action-check's
    # subject-presence guard then fails the commit at commit-msg time if
    # the author closes without typing a subject. Removing the prefill
    # instead would break the editor-populates-footers flow.
    message="$(cat "$file")"
    existing="$(change_id_get_trailer "$message" "Change-Id")"
    if [ -z "$existing" ]; then
        trailers+=(--trailer "Change-Id: $(change_id_generate)")
    elif ! change_id_is_valid "$existing"; then
        echo "warning: the Change-Id '$existing' is not usable (8 to 64 characters from A-Z a-z 0-9 . _ -); fork-export will not export this commit" >&2
    fi
    case "$source_kind" in
        ""|template)
            # A no-op editor (':'/'true'/'.') means git never opens anything: the
            # author never sees the buffer, and the prefilled trailers ship
            # as-is as the message. Warn loudly so the failure is visible at
            # the moment it happens instead of a mystery in the commit log.
            local editor
            editor="$(git var GIT_EDITOR 2>/dev/null || true)"
            case "$editor" in
                ":"|"true"|".")
                    echo "warning: the effective editor is '$editor' (a no-op) — no editor will open and the prefilled trailers will be committed as the message; unset the GIT_EDITOR/core.editor override to restore the interactive flow" >&2
                    ;;
            esac
            [ -n "$(change_id_get_trailer "$message" "Devenv-Action")" ] || trailers+=(--trailer "Devenv-Action: nothing")
            ;;
    esac
    # NOTE: no subject-placeholder seeding here. Seeding a placeholder line
    # (`<type>: <subject>`) into the editor buffer made lazy closes commit it
    # as the literal subject — the editor shows it, the author closes, and
    # the placeholder ships as a garbage commit subject. The editor pops with
    # the prefilled trailers only; the author types the subject.
    [ "${#trailers[@]}" -eq 0 ] && return 0
    git interpret-trailers --in-place --if-exists doNothing "${trailers[@]}" "$file"
}

main "$@"
