#!/bin/bash
# background-check-devenv-updates.sh - silently fetch remote changes on a set interval
# Version: 1.0.0
# Description: Background daemon to periodically fetch git repository updates
# Features: PID file management, signal handling, max iteration limit
# Requirements: Bash 4.0+, Git 2.0+

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")
cd "$script_folder" || exit 1

# Configuration constants
readonly CHECK_INTERVAL_SECONDS=600  # Check every 10 minutes
readonly SLEEP_CHUNK_SECONDS=10      # Sleep in small chunks for responsive signal handling

# Environment floor check (the retired versioning.bash's contract, inlined:
# bash >= 4.0, git >= 2.0 — numeric MAJOR.MINOR compare, suffixes ignored).
version_ge() {
    # $1=installed, $2=required — both "N[.N[.N]][...]"
    local IFS=.
    local -a inst req
    read -r -a inst <<< "$1"
    read -r -a req <<< "$2"
    local i a b
    for i in "${!req[@]}"; do
        a="${inst[i]:-0}"; a="${a%%[!0-9]*}"; a="${a:-0}"
        b="${req[i]:-0}"; b="${b%%[!0-9]*}"; b="${b:-0}"
        [ "$a" -lt "$b" ] && return 1
    done
    return 0
}
if ! version_ge "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}" "4.0"; then
    echo "ERROR: bash >= 4.0 required" >&2
    exit 1
fi
if ! version_ge "$(git --version 2>/dev/null | awk '{print $3}')" "2.0"; then
    echo "ERROR: git >= 2.0 required" >&2
    exit 1
fi

# Configuration (can be overridden by environment variables)
DEVENV_UPDATE_INTERVAL=${DEVENV_UPDATE_INTERVAL:-$((2 * 3600))}  # Default: 2 hours
DEVENV_UPDATE_MAX_ITERATIONS=${DEVENV_UPDATE_MAX_ITERATIONS:-0}  # 0 = unlimited
# Per-instance state lives in .runtime/ (recreated per install), never
# alongside source files.
mkdir -p "$toolbox_root/.runtime"
UPDATE_FILE="$toolbox_root/.runtime/.update-time"
PID_FILE="$toolbox_root/.runtime/.update-check.pid"

# Iteration counter
iteration_count=0

# Cleanup function
cleanup() {
    echo "Shutting down background update checker (PID $$)..." >&2
    rm -f "$PID_FILE"
    exit 0
}

# Signal handlers for graceful shutdown
trap cleanup SIGTERM SIGINT SIGHUP

# Check if already running
if [ -f "$PID_FILE" ]; then
    old_pid=$(cat "$PID_FILE")
    if kill -0 "$old_pid" 2>/dev/null; then
        echo "Background update checker is already running (PID $old_pid)" >&2
        exit 1
    else
        echo "Removing stale PID file" >&2
        rm -f "$PID_FILE"
    fi
fi

# Write our PID
echo $$ > "$PID_FILE"

# Function to fetch remote changes silently and update the timestamp file
update_repo() {
    if git fetch --tags -f > /dev/null 2>&1; then
        date +%s > "$UPDATE_FILE"
        return 0
    else
        echo "Warning: git fetch failed" >&2
        return 1
    fi
}

# Function to check if we should continue
should_continue() {
    # Check max iterations limit (0 means unlimited)
    if [ "$DEVENV_UPDATE_MAX_ITERATIONS" -gt 0 ] && [ "$iteration_count" -ge "$DEVENV_UPDATE_MAX_ITERATIONS" ]; then
        echo "Reached maximum iteration limit ($DEVENV_UPDATE_MAX_ITERATIONS)" >&2
        return 1
    fi
    return 0
}

# Main update loop
while should_continue; do
    iteration_count=$((iteration_count + 1))
    
    # Create the update file if it does not exist
    if [ ! -f "$UPDATE_FILE" ]; then
        date +%s > "$UPDATE_FILE"
    else
        LAST_UPDATE=$(cat "$UPDATE_FILE")
        CURRENT_TIME=$(date +%s)
        TIME_DIFF=$((CURRENT_TIME - LAST_UPDATE))
        
        # If the time difference exceeds the update interval, perform a fetch
        if [ "$TIME_DIFF" -gt "$DEVENV_UPDATE_INTERVAL" ]; then
            update_repo
        fi
    fi
    
    # Sleep in small intervals to allow quick response to signals
    # shellcheck disable=SC2034  # Loop counter intentionally unused
    for i in $(seq 1 $((CHECK_INTERVAL_SECONDS / SLEEP_CHUNK_SECONDS))); do
        sleep "$SLEEP_CHUNK_SECONDS"
        # Check if we should stop during sleep
        if ! should_continue; then
            break 2
        fi
    done
done

# Cleanup on normal exit
cleanup
