#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# check-commit-trailers.sh - Enforce the Devenv-Action commit trailer
# Version: 1.0.0
# Description: One home for the Devenv-Action rule. Message-file mode serves the
#              local commit-msg hook; commit-range mode serves CI, so a clone
#              without hooks cannot land trailer-less commits on master.
# Requirements: Bash 4.0+, git

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME

readonly VALID_ACTIONS="nothing|restart|bootstrap|recreate"

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME BASE HEAD
       $SCRIPT_NAME --message-file FILE

Validate the Devenv-Action trailer (valid values: ${VALID_ACTIONS//|/, }).

Modes:
    BASE HEAD             Check every commit in BASE..HEAD (CI). A WIP: commit is
                          an error: WIP commits never reach master.
    --message-file FILE   Check one commit message (the commit-msg hook). A
                          WIP: subject is exempt — it is temporary by design.

Options:
    -h, --help            Show help and exit
    -v, --version         Show version and exit

Exit Codes:
    0 every checked commit carries a valid trailer
    1 one or more commits are missing or have an invalid trailer
    2 invalid arguments
EOF
    exit 0
}

# True when the message text carries a valid trailer line.
has_valid_trailer() {
    grep -qiE "^Devenv-Action: ($VALID_ACTIONS)$" <<<"$1"
}

print_guidance() {
    cat >&2 << EOF

error: Missing or invalid 'Devenv-Action' trailer.

  Every commit to this repository must include a Devenv-Action trailer in the
  commit body telling consumers what to do after pulling.

  Add one of the following lines to the end of your commit message:

    Devenv-Action: nothing    (no action needed)
    Devenv-Action: restart    (restart the dev container)
    Devenv-Action: bootstrap  (re-run bootstrap, then restart)
    Devenv-Action: recreate   (rebuild/recreate the dev container)

  Use the lowest action that is actually needed.
  See docs/Dev-container-environment.md for guidance.

EOF
}

check_message_file() {
    local file="$1" subject message
    [ -f "$file" ] || invalid_args "Message file not found: $file"
    subject="$(head -n 1 "$file")"
    case "$subject" in
        WIP:*) return 0 ;;
    esac
    message="$(cat "$file")"
    if ! has_valid_trailer "$message"; then
        print_guidance
        return 1
    fi
}

check_range() {
    local base="$1" head="$2" failures=0 sha subject message
    git rev-parse --verify --quiet "$base^{commit}" >/dev/null || invalid_args "Unknown revision: $base"
    git rev-parse --verify --quiet "$head^{commit}" >/dev/null || invalid_args "Unknown revision: $head"
    while IFS= read -r sha; do
        [ -n "$sha" ] || continue
        subject="$(git log -1 --format=%s "$sha")"
        message="$(git log -1 --format=%B "$sha")"
        case "$subject" in
            WIP:*)
                echo "${sha:0:12} $subject — WIP commits must not reach master" >&2
                failures=$((failures + 1))
                continue ;;
        esac
        if ! has_valid_trailer "$message"; then
            echo "${sha:0:12} $subject — missing or invalid Devenv-Action trailer" >&2
            failures=$((failures + 1))
        fi
    done < <(git rev-list --reverse "$base..$head")
    if [ "$failures" -gt 0 ]; then
        echo "$failures commit(s) failed the Devenv-Action trailer check." >&2
        return 1
    fi
}

main() {
    local message_file="" positional=()
    if [ $# -eq 0 ]; then
        invalid_args "Provide BASE HEAD or --message-file FILE"
    fi
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) show_usage ;;
            -v|--version) echo "$SCRIPT_VERSION"; exit 0 ;;
            -V|--verbose) shift ;;
            --message-file)
                require_option_value "$1" "${2:-}"
                [ -z "${2:-}" ] && invalid_args "Missing value for --message-file"
                message_file="$2"; shift 2 ;;
            --*) invalid_args "Unknown option: $1" ;;
            *) positional+=("$1"); shift ;;
        esac
    done

    if [ -n "$message_file" ]; then
        [ ${#positional[@]} -eq 0 ] || invalid_args "--message-file cannot be combined with BASE HEAD"
        check_message_file "$message_file"
        return
    fi
    [ ${#positional[@]} -eq 2 ] || invalid_args "Provide exactly BASE and HEAD (or --message-file FILE)"
    check_range "${positional[0]}" "${positional[1]}"
}

main "$@"
