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
readonly SCRIPT_VERSION="1.0.0"
readonly CHECK_INTERVAL_SECONDS=600  # Check every 10 minutes
readonly SLEEP_CHUNK_SECONDS=10      # Sleep in small chunks for responsive signal handling

# Source versioning library if available
if [ -f "$toolbox_root/lib/versioning.bash" ]; then
    # shellcheck source=../lib/versioning.bash
    source "$toolbox_root/lib/versioning.bash"
    
    # Display version if requested
    script_version "background-check-devenv-updates.sh" "$SCRIPT_VERSION" "Background git update checker"
    
    # Check environment compatibility
    if ! check_environment_requirements; then
        echo "ERROR: Environment does not meet minimum requirements" >&2
        exit 1
    fi
fi

# Configuration (can be overridden by environment variables)
DEVENV_UPDATE_INTERVAL=${DEVENV_UPDATE_INTERVAL:-$((2 * 3600))}  # Default: 2 hours
DEVENV_UPDATE_MAX_ITERATIONS=${DEVENV_UPDATE_MAX_ITERATIONS:-0}  # 0 = unlimited
UPDATE_FILE="$script_folder/.update-time"
PID_FILE="$script_folder/.update-check.pid"

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
