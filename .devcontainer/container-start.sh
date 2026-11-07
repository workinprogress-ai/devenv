#!/bin/bash

# Ensure that the script is not run with CRLF line endings
_self="$(readlink -f "${BASH_SOURCE[0]}")"; if [ -f "$_self" ] && LC_ALL=C grep -q $'\r' "$_self" 2>/dev/null; then sed -i 's/\r$//' "$_self" && exec bash "$_self" "$@"; fi; unset _self

export DEVCONTAINER=true
script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")
container_bootstrap_run_file="$HOME/.bootstrap_container_time"
repo_bootstrap_run_file="$toolbox_root/.runtime/.bootstrap_run_time"
bootstrap_lock_file="$HOME/.bootstrap.lock"

function get_run_time() {
    if [ ! -f "$1" ]; then
        echo "0"
    else
        cat "$1"
    fi
}

# A bootstrap counts as completed only when both markers exist and agree:
# bootstrap removes them when it starts and writes both when it finishes, so a
# run that failed part-way leaves them missing.
bootstrap_completed() {
    [ -f "$container_bootstrap_run_file" ] && [ -f "$repo_bootstrap_run_file" ] &&
        [ "$(get_run_time "$container_bootstrap_run_file")" = "$(get_run_time "$repo_bootstrap_run_file")" ]
}

function on_error() {
    echo "Error running script"
    exit 1
}

trap on_error ERR

# Desktop-integrating commands spawn a dbus-launch/gnome-keyring-d session pair
# per invocation; when the invoking shell exits, the pair is orphaned and never
# terminates, leaking ~2 PIDs each. Over a long-lived container this exhausts
# the cgroup pid budget and blocks test gates. Reap the orphans (parent is PID 1
# — the spawner is dead) on every container start; the live desktop session's
# own dbus (parented by the session) is spared. Always returns 0 — a clean
# sweep must not trip the ERR trap below.
reap_orphan_desktop_sessions() {
    local count=0
    for pid in $(ps -eo pid=,ppid=,comm= | awk '$2 == 1 && ($3 == "dbus-launch" || $3 == "dbus-daemon" || $3 == "gnome-keyring-d") {print $1}'); do
        kill "$pid" 2>/dev/null && count=$((count + 1))
    done
    if [ "$count" -gt 0 ]; then
        echo "Reaped $count orphaned desktop-session processes"
    fi
    return 0
}
reap_orphan_desktop_sessions

# Session-reaper watchdog. Containers can live for days or weeks and the
# one-shot reap above only sweeps at container start; this singleton loop
# keeps the leak bounded (~2 PIDs per desktop-integrating command) for the
# container's whole lifetime. Watchdog mode is a self-reinvoke of this script
# ("$0" --session-reaper-watchdog) so the pgrep guard can find it by command
# line and never spawn a second copy; it dies with the container (restart =
# fresh PID space), and an interrupted sleep exits the loop rather than
# cascading into the bootstrap flow below (the ERR trap is disarmed in this
# branch and the mode exits if the loop ever breaks).
if [ "${1:-}" = "--session-reaper-watchdog" ]; then
    trap - ERR
    exec >> /tmp/session-reaper.log 2>&1
    while :; do
        sleep 3600
        reap_orphan_desktop_sessions
    done
    exit 0
fi
if ! pgrep -f -- "--session-reaper-watchdog" >/dev/null 2>&1; then
    ( bash "$(readlink -f "${BASH_SOURCE[0]}")" --session-reaper-watchdog </dev/null >/dev/null 2>&1 & )
fi

# Function to run bootstrap with proper locking
run_bootstrap() {
    # shellcheck disable=SC2034
    local lock_fd=200
    local max_wait=300  # 5 minutes
    local wait_time=0
    
    # Try to acquire exclusive lock
    exec 200>"$bootstrap_lock_file"
    
    echo "Attempting to acquire bootstrap lock..."
    while ! flock -n 200; do
        if [ $wait_time -ge $max_wait ]; then
            echo "ERROR: Timeout waiting for bootstrap lock after ${max_wait}s"
            exit 1
        fi
        echo "Bootstrap is already running in another process. Waiting..."
        sleep 5
        wait_time=$((wait_time + 5))
    done
    
    echo "Lock acquired, running bootstrap..."
    
    # Run bootstrap
    sed -i 's/\r$//' "$toolbox_root/.devcontainer/bootstrap.sh"
    chmod +x "$toolbox_root/.devcontainer/bootstrap.sh"
    # bootstrap.sh takes the same lock for its other entry paths; tell it this
    # run already holds it so it does not wait on its own parent. The child runs
    # without the lock descriptors so nothing it starts in the background can
    # keep the lock held after bootstrap ends.
    export DEVENV_BOOTSTRAP_LOCK_HELD=1
    local rc=0
    "$toolbox_root/.devcontainer/bootstrap.sh" 200>&- 201>&- || rc=$?
    if [ "$rc" -ne 0 ]; then
        echo "ERROR: Bootstrap failed (exit $rc); see $toolbox_root/.runtime/bootstrap.log" >&2
        exit "$rc"
    fi

    echo "Bootstrap script executed"

    # The lock file is left in place: removing it while another process still
    # holds its descriptor would let a second process lock a new file.
    # The lock itself is released when fd 200 is closed.
}

if [ ! -f "$container_bootstrap_run_file" ] && [ ! -f "$repo_bootstrap_run_file" ]; then
    echo "Bootstrap has not yet been run, running now"
    run_bootstrap
elif ! bootstrap_completed; then
    echo "WARNING!!!!!  The container bootstrap run time does not match the repo bootstrap run time."
    echo "Bootstrap running NOW!!!!!!!!!"
    run_bootstrap
    echo "Please restart the container"
else
    "$toolbox_root/.devcontainer/startup.sh" 200>&- 201>&-
    echo "Startup script executed"

    cd "$toolbox_root/repos" || exit
    if [ -z "$(find . -mindepth 1 -maxdepth 1 -type d)" ]; then
        echo "No repos have been cloned yet.  If you want to clone a standard repo, run the following command:"
        echo "repo-get <repo name>"
    fi
fi

if ! bootstrap_completed; then
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "WARNING:  Bootstrap has not yet successfully run!"
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
fi

# Enforce declared tool versions (node/pnpm) on the running container. Sourced
# here because bootstrap.bash exports the functions only into its own shell.
# shellcheck source=/dev/null
if [ -f "$toolbox_root/.devcontainer/tool-versions.bash" ]; then
    # shellcheck disable=SC1091
    . "$toolbox_root/.devcontainer/tool-versions.bash"
    if ! ensure_tool_versions; then
        echo "WARNING: tool version enforcement failed - run 'ensure_tool_versions' manually to see details" >&2
    fi
fi
