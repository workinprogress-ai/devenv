#!/bin/bash
# self-root.bash — devenv self-location resolver.
#
# Contract: self-location wins unless the exported value realpath-resolves to
# the same root. devenv scripts derive their own checkout from the caller's
# BASH_SOURCE; an exported DEVENV_TOOLS/DEVENV_ROOT is honored only when it
# points at that same checkout (after normalization), so a foreign checkout's
# exports can never redirect a script onto the wrong tree (nested-clone
# development under repos/devenv/ must operate on the clone).
#
# Dependency-free: bash + coreutils (realpath, dirname, cd/pwd) only.
#
# Usage:
#   source "${BASH_SOURCE[0]%/*}/lib/self-root.bash"   # from tools/ scripts
#   DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
#   export DEVENV_TOOLS                                 # optional, for children
#
# The caller MUST pass its own ${BASH_SOURCE[0]}. For executed scripts that is
# the script path; for sourced files it is the sourcing file's path — this is
# the correct frame in both cases and prevents inheriting a wrong frame from
# an outer shell or wrapper.

# Derive the devenv checkout root (the directory containing tools/) from a
# script path inside that checkout. Works for scripts in tools/, tools/lib/,
# tools/scripts/, and tools/tests/. The script path is canonicalized BEFORE
# its directory is taken, so a script invoked through a symlink locates the
# checkout that actually contains it (not the link's directory). Prints the
# realpath of the root.
devenv_self_root() {
    local _srl_script_path="$1" _srl_script_dir _srl_root

    # Canonicalize the FILE path first: dirname of a symlinked path would
    # yield the link's directory, which may live outside the checkout.
    _srl_script_path="$(realpath "$_srl_script_path" 2>/dev/null || printf '%s' "$_srl_script_path")"
    _srl_script_dir="$(cd "$(dirname "$_srl_script_path")" && pwd -P)" || return 1

    case "$_srl_script_dir" in
        */tools|*/tools/lib|*/tools/scripts|*/tools/tests)
            _srl_root="${_srl_script_dir%/tools}"
            _srl_root="${_srl_root%/tools/lib}"
            _srl_root="${_srl_root%/tools/scripts}"
            _srl_root="${_srl_root%/tools/tests}"
            ;;
        */tools/tests/scripts|*/tools/tests/lib|*/tools/tests/fixtures)
            _srl_root="${_srl_script_dir%/tools/tests/scripts}"
            _srl_root="${_srl_root%/tools/tests/lib}"
            _srl_root="${_srl_root%/tools/tests/fixtures}"
            ;;
        */.devcontainer|*/.devcontainer/install-extras)
            _srl_root="${_srl_script_dir%/.devcontainer}"
            _srl_root="${_srl_root%/.devcontainer/install-extras}"
            ;;
        *)
            # Unrecognized layout: walk up until a dir containing tools/ is
            # found, or fail. Bounded walk — no infinite loop on /.
            _srl_root="$_srl_script_dir"
            while [ "$_srl_root" != "/" ] && [ ! -d "$_srl_root/tools" ]; do
                _srl_root="$(dirname "$_srl_root")"
            done
            [ -d "$_srl_root/tools" ] || return 1
            ;;
    esac

    realpath "$_srl_root" 2>/dev/null || printf '%s\n' "$_srl_root"
}

# Resolve the effective tools root for a script. Prints the exported
# DEVENV_TOOLS only when it realpath-matches this checkout's own tools root;
# otherwise prints the self-derived root. Never imports a foreign checkout.
devenv_resolve_tools_root() {
    local _srl_tools_root _srl_exported_real _srl_self_tools_real

    _srl_root="$(devenv_self_root "$1")" || return 1
    _srl_tools_root="$_srl_root/tools"

    if [ -n "${DEVENV_TOOLS:-}" ]; then
        _srl_exported_real="$(realpath "$DEVENV_TOOLS" 2>/dev/null || printf '%s' "$DEVENV_TOOLS")"
        _srl_self_tools_real="$(realpath "$_srl_tools_root" 2>/dev/null || printf '%s' "$_srl_tools_root")"
        if [ "$_srl_exported_real" = "$_srl_self_tools_real" ]; then
            printf '%s\n' "$_srl_tools_root"
            return 0
        fi
    fi

    printf '%s\n' "$_srl_tools_root"
}

# Establish DEVENV_ROOT once per process. The first lib to call this wins;
# later callers keep the established value. This is what makes multi-lib
# sourcing coherent: every lib in one source chain shares one root instead of
# the last-sourced lib clobbering the global.
devenv_ensure_root() {
    if [ -z "${DEVENV_ROOT_SET:-}" ]; then
        DEVENV_ROOT="$(devenv_self_root "$1")" || return 1
        export DEVENV_ROOT
        DEVENV_ROOT_SET=1
    fi
}
