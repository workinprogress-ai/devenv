#!/bin/bash
set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# config-read.sh - Read a value from devenv.config for skills and scripts
# Version: 1.0.0
# Description: Thin CLI over the shared config-reader: prints one value from
#              devenv.config by section and key, with env expansion and an
#              optional default. Gives skills a deterministic way to read
#              org-configurable settings (e.g. the engineering-patterns repo
#              name) without hand-parsing INI files.
# Requirements: Bash 4.0+, awk
# Last Modified: 2026-09-13

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"

# shellcheck source=../lib/error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"

# shellcheck source=../lib/versioning.bash
source "$DEVENV_TOOLS/lib/versioning.bash"

# shellcheck source=../lib/config-reader.bash
source "$DEVENV_TOOLS/lib/config-reader.bash"

enable_strict_mode

script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Read a value from devenv.config"

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME SECTION KEY [DEFAULT] [--config FILE]

Read one value from devenv.config (INI-style: [section] + key=value).
Environment variables (\${GH_ORG} etc.) are expanded. Prints the value, or
DEFAULT when the key is absent.

Options:
    --config FILE   Config file to read (default: \$DEVENV_ROOT/devenv.config)
    -h, --help      Show this help message
    -v, --version   Show version and exit

Exit codes:
    0 value printed
    1 invalid arguments / config problem

Examples:
    $SCRIPT_NAME copilot engineering_repo
    $SCRIPT_NAME copilot knowledge_repo
    $SCRIPT_NAME workflows status_workflow
EOF
    exit 0
}

main() {
    local section="" key="" default="" config_file="${DEVENV_ROOT}/devenv.config"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) show_usage ;;
            -v|--version) echo "$SCRIPT_VERSION"; exit 0 ;;
            --config)
                [ -z "${2:-}" ] && { log_error "Missing value for --config"; exit 1; }
                config_file="$2"; shift 2 ;;
            --*) { log_error "Unknown option: $1"; exit 1; } ;;
            *)
                if [ -z "$section" ]; then section="$1"
                elif [ -z "$key" ]; then key="$1"
                elif [ -z "$default" ]; then default="$1"
                else { log_error "Too many arguments"; exit 1; }
                fi
                shift ;;
        esac
    done

    [ -n "$section" ] && [ -n "$key" ] || { log_error "Usage: $SCRIPT_NAME SECTION KEY [DEFAULT]"; exit 1; }
    [ -f "$config_file" ] || { log_error "Config file not found: $config_file"; exit 1; }

    config_init "$config_file" || exit 1
    config_read_value "$section" "$key" "$default"
}

main "$@"
