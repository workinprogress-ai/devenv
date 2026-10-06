#!/bin/bash
# sanity-check.sh - startup sanity checks.
#
# Sourced by the generated shell rc at every shell start (and executed by
# startup.sh). Plain bash throughout: nothing in this file is eval-expanded. A
# failing check prints a loud warning but never blocks the shell. Helpers are
# unset at the end so nothing leaks into the caller's shell.

_sanity_run_time() {
    if [ ! -f "$1" ]; then
        echo "0"
    else
        cat "$1"
    fi
}

"$DEVENV_ROOT/.devcontainer/check-update-devenv-repo.sh"

# The container's bootstrap run time must match the repo's; a difference means
# the environment needs rebuilding.
if [ "$(_sanity_run_time "$HOME/.bootstrap_container_time")" != "$(_sanity_run_time "$DEVENV_ROOT/.runtime/.bootstrap_run_time")" ]; then
    echo "WARNING!!!!!  The container bootstrap run time does not match the repo bootstrap run time."
    echo "Please rebuild dev env!!!!!!!!!"
fi
unset -f _sanity_run_time

# ============================================================================
# Tool smoke checks. Failures print a loud warning but never block the shell.
# ============================================================================

# Declared tool versions must match reality (node/npm/pnpm; see
# tool-versions.bash). Version mismatches warn here; ensure_tool_versions at
# container start performs repairs. Skipped when the devenv root is unknown
# (sanity-check sourced outside the devenv workspace).
_smoke_root="${DEVENV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
if [ -n "$DEVENV_ROOT" ] && [ -f "$_smoke_root/.devcontainer/tool-versions.bash" ]; then
    # shellcheck disable=SC1091
    . "$_smoke_root/.devcontainer/tool-versions.bash"
    if ! verify_node_version 2>/dev/null || ! verify_pnpm_version 2>/dev/null; then
        echo "WARNING!!!!!  Tool versions do not match the declared standard (expected node $NODE_VERSION / pnpm $PNPM_VERSION)."
        echo "Run 'ensure_tool_versions' to repair, or rebuild the dev container."
    fi
fi

# Core wrapper tooling must initialize (self-root contract). A broken wrapper
# surfaces at startup instead of mid-session. Resolved via the devenv root
# (PATH may not carry workspace tools yet at shell-init time).
if [ -x "$_smoke_root/tools/next-id" ]; then
    if ! "$_smoke_root/tools/next-id" --pattern 'sanity-{N}.md' --dir "${TMPDIR:-/tmp}" >/dev/null 2>&1; then
        echo "WARNING!!!!!  devenv wrapper 'next-id' failed to execute — workspace tool installation is broken."
    fi
elif [ -d "$_smoke_root/tools" ]; then
    echo "WARNING!!!!!  devenv wrapper 'next-id' not found at $_smoke_root/tools — workspace tool installation is broken."
fi
unset _smoke_root
