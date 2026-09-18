#!/bin/bash

# shellcheck disable=SC2034 # May be used in future enhancements
script_path=$(readlink -f "$0")

function get_run_time() {
    if [ ! -f \$1 ]; then
        echo "0"
    else
        cat \$1
    fi
}

$DEVENV_ROOT/.devcontainer/check-update-devenv-repo.sh

# shellcheck disable=SC2050  # literal \$ is intentional: this file is written to be eval-expanded (see header note); under plain source this branch degrades to a no-op
if [ "\$(get_run_time \$container_bootstrap_run_file)" != "\$(get_run_time \$repo_bootstrap_run_file)" ]; then
    echo "WARNING!!!!!  The container bootstrap run time does not match the repo bootstrap run time."
    echo "Please rebuild dev env!!!!!!!!!"
fi

# ============================================================================
# Tool smoke checks — this file is sourced at shell startup (plain source, no
# eval), so plain $ expansion applies. Failures print a loud warning but never
# block the shell.
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
