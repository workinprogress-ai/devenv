#!/bin/bash
# Bootstrap script for devenv
# 
# This is the main entry point for bootstrapping the development environment.
# It sources the bootstrap library and runs the default set of bootstrap tasks.
#
# For custom bootstrap behavior, you can:
# 1. Organization level: Create org-custom-bootstrap.sh (committed to repo)
# 2. User level: Use devenv-add-custom-bootstrap to create user-custom-bootstrap.sh
# 3. Fork this script and call specific bootstrap functions from bootstrap.bash

# Ensure that the script is not run with CRLF line endings
_self="$(readlink -f "${BASH_SOURCE[0]}")"; if [ -f "$_self" ] && LC_ALL=C grep -q $'\r' "$_self" 2>/dev/null; then sed -i 's/\r$//' "$_self" && exec bash "$_self" "$@"; fi; unset _self

# Source the bootstrap library
# shellcheck source=./bootstrap.bash
source "$(dirname "${BASH_SOURCE[0]}")/bootstrap.bash"

# Tool versions are declared in ONE place: .devcontainer/tool-versions.bash
# (sourced by bootstrap.bash below). Do not re-declare them here — duplicate
# defaults drift, which is exactly how node/pnpm version skew happened before.

# Serialize every entry path (container start, devenv-update, a manual run) on
# one lock file. container-start.sh already holds it when it launches this
# script and says so via DEVENV_BOOTSTRAP_LOCK_HELD; a second flock on the
# same file from the child would otherwise wait on its own parent forever.
if [ -z "${DEVENV_BOOTSTRAP_LOCK_HELD:-}" ]; then
    bootstrap_lock_file="${HOME:-/tmp}/.bootstrap.lock"
    exec 201>"$bootstrap_lock_file"
    if ! flock -n 201; then
        echo "Bootstrap is already running (lock: $bootstrap_lock_file); not starting a second run. Try again when it finishes." >&2
        exit 1
    fi
fi

# Report top-level failures through the library's handler. No errtrace (-E) on
# purpose: tasks keep their own tolerant semantics and run_bootstrap_tasks
# already stops on a failing task; this covers the entry path itself (same
# pattern as container-start.sh).
trap on_error ERR

# Keep a durable log of every run next to the other runtime state. Piped
# through tee rather than `exec > >(tee ...)`: the shell then waits for the log
# to be flushed, and pipefail preserves the task runner's exit status. The log
# can echo secrets, so it is owner-only like the other generated files.
bootstrap_root="$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")"
bootstrap_log="$bootstrap_root/.runtime/bootstrap.log"
mkdir -p "$bootstrap_root/.runtime"
# Relative paths in the tasks resolve against the toolbox root, not wherever the
# caller happened to be standing.
cd "$bootstrap_root" || exit 1
(umask 077; touch "$bootstrap_log")
chmod 600 "$bootstrap_log"

# Run bootstrap tasks (all default tasks or specific tasks passed as arguments)
set -o pipefail
run_bootstrap_tasks "$@" 2>&1 | tee -a "$bootstrap_log"
