#!/bin/bash
# csharp-debug - Drive the vsdbg .NET Core debugger (installed by bootstrap).
#
# Bridge between the workspace's vsdbg installation
# (.debug/remote_debugger/vsdbg, downloaded by download-csharp-debugger.sh at
# bootstrap) and CLI/DAP clients: hunt's Rung-3 instrumentation, a DAP client
# (the `--interpreter=vscode` mode speaks the debug adapter protocol), or an
# operator driving sessions by hand.
#
# Subcommands:
#   launch <dotnet-app.dll> [-- additional args]   Start the app under vsdbg.
#   attach <pid>                                   Attach to a running process.
#   version                                        Print the vsdbg version.
#
# In --interpreter=vscode mode vsdbg speaks DAP on stdin/stdout: set
# breakpoints, step, evaluate — the same primitives debugpy exposes for
# Python. All scratchpad-safe (Rung-3 instrumentation; never mutates the
# working tree).

set -euo pipefail

# Self-root contract: self-location wins; a foreign exported DEVENV_TOOLS is
# ignored unless it realpath-matches this checkout.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

# shellcheck source=../lib/error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"

# The debugger's installed home. Bootstrap downloads it on first run
# (download-csharp-debugger.sh); $DEVENV_ROOT/debugger_home overrides for
# tests and non-standard layouts.
debugger_home() {
    if [ -n "${DEVENV_ROOT_DEBUGGER_HOME:-}" ] && [ -d "$DEVENV_ROOT_DEBUGGER_HOME" ]; then
        printf '%s' "$DEVENV_ROOT_DEBUGGER_HOME"
        return 0
    fi
    local root="$DEVENV_ROOT"
    if [ -d "$root/.debug/remote_debugger" ]; then
        printf '%s' "$root/.debug/remote_debugger"
        return 0
    fi
    # Fall back to the workspace root two levels up from tools/ (the devenv
    # checkout itself), which is where bootstrap puts it.
    printf '%s' "$(cd "$DEVENV_TOOLS/.." && pwd)/.debug/remote_debugger"
}

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME launch <app.dll> [-- additional app args]
       $SCRIPT_NAME attach <pid>
       $SCRIPT_NAME version

Drive the vsdbg .NET Core debugger installed by bootstrap. The default
(--interpreter=vscode) mode speaks the debug adapter protocol on
stdin/stdout: point a DAP client at it for breakpoints, stepping, watch,
and expression evaluation.

  launch <app.dll>   Start a .NET app under the debugger and enter DAP mode.
  attach <pid>       Attach to a running .NET process and enter DAP mode.
  version            Print the vsdbg version and exit.

Scratchpad-safe (Rung-3 instrumentation): the debugger observes and controls
execution; it does not modify the working tree.

Exit codes:
    0   Session ended normally
    2   Invalid arguments (EXIT_MISUSE)
    4   Debugger not installed / process not found (EXIT_API_FAILURE)
EOF
    echo "Version: $SCRIPT_VERSION"
    exit 0
}

require_debugger() {
    local home
    home="$(debugger_home)"
    if [ ! -x "$home/vsdbg" ]; then
        echo "Error: vsdbg not found at $home/vsdbg — bootstrap installs it (download-csharp-debugger.sh). Run bootstrap, or set DEVENV_ROOT_DEBUGGER_HOME." >&2
        exit "$EXIT_API_FAILURE"
    fi
    printf '%s' "$home/vsdbg"
}

main() {
    if handle_global_flag "${1:-}"; then
        exit 0
    fi

    [ $# -ge 1 ] || { show_usage; }
    local cmd="$1"
    shift

    case "$cmd" in
        version)
            local vsdbg
            vsdbg="$(require_debugger)" || exit "$EXIT_API_FAILURE"
            "$vsdbg" --help 2>&1 | head -2
            ;;
        launch)
            [ $# -ge 1 ] || { echo "Error: launch requires an app dll" >&2; exit "$EXIT_MISUSE"; }
            local vsdbg app
            vsdbg="$(require_debugger)" || exit "$EXIT_API_FAILURE"
            app="$1"
            shift
            exec "$vsdbg" --interpreter=vscode --session-id=csharp-debug-$$ "$app" "$@"
            ;;
        attach)
            [ $# -eq 1 ] || { echo "Error: attach requires exactly one pid" >&2; exit "$EXIT_MISUSE"; }
            local vsdbg
            vsdbg="$(require_debugger)" || exit "$EXIT_API_FAILURE"
            exec "$vsdbg" --interpreter=vscode --attach "$1"
            ;;
        -h|--help) show_usage ;;
        -v|--version) echo "$SCRIPT_NAME"; exit 0 ;;
        *) echo "Error: unknown command '$cmd'" >&2; show_usage >&2; exit "$EXIT_MISUSE" ;;
    esac
}

main "$@"
