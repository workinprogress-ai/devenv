#!/bin/bash
set -euo pipefail
source "$DEVENV_TOOLS/lib/error-handling.bash"
# restore.sh: Restore all databases to a MongoDB cluster from a backup.
# Usage: ./restore.sh "<connection_string>" "/path/to/backup_directory" [--yes]
# Note: This script assumes the backup folder contains subdirectories created
#       by the backup script.
# Safety: the restore runs with --drop (existing collections are replaced).
# The target host and backup directory are shown and an explicit confirmation
# is required unless --yes / YES=1 is given. Non-interactive runs without
# consent are refused rather than hanging on a prompt.

source "$DEVENV_TOOLS/lib/database-operations.bash"

require_command mongorestore

ASSUME_YES=0
BACKUP_DIR=""
CONNECTION_STRING=""

# Argument parsing (order-independent flags).
while [ "$#" -gt 0 ]; do
    case "$1" in
        --yes|-y)
            ASSUME_YES=1
            shift
            ;;
        -*)
            echo "Unknown option: $1. Usage: $0 <connection_string> <backup_directory> [--yes]" >&2
            exit "$EXIT_MISUSE"
            ;;
        *)
            if [ -z "$CONNECTION_STRING" ]; then
                CONNECTION_STRING="$1"
            elif [ -z "$BACKUP_DIR" ]; then
                BACKUP_DIR="$1"
            else
                echo "Too many arguments. Usage: $0 <connection_string> <backup_directory> [--yes]" >&2
                exit "$EXIT_MISUSE"
            fi
            shift
            ;;
    esac
done

if [ -z "$CONNECTION_STRING" ] || [ -z "$BACKUP_DIR" ]; then
    echo "Usage: $0 <connection_string> <backup_directory> [--yes]" >&2
    exit "$EXIT_MISUSE"
fi

# Verify that the backup directory exists.
if [ ! -d "$BACKUP_DIR" ]; then
    echo "Error: Backup directory '$BACKUP_DIR' does not exist." >&2
    exit "$EXIT_API_FAILURE"
fi

# Optionally, pick the latest backup folder (based on directory name timestamp).
LATEST_BACKUP=$(ls -td "$BACKUP_DIR"/*/ 2>/dev/null | head -1)

if [ -z "$LATEST_BACKUP" ]; then
    echo "No backup subdirectories found in $BACKUP_DIR." >&2
    exit "$EXIT_API_FAILURE"
fi

# Redact credentials from the connection string for display.
# Supports mongodb://user:pass@host:port/db and mongodb+srv://... forms.
DISPLAY_URI=$(printf '%s' "$CONNECTION_STRING" | sed -E 's#(^[a-zA-Z0-9+]+://)[^/@:]+:[^/@]+@#\1***@#')

echo "Target   : $DISPLAY_URI"
echo "Backup   : $LATEST_BACKUP"
echo "Mode     : restore with --drop (existing collections will be REPLACED)"
echo

# Consent gate: explicit --yes / YES=1, or an interactive confirmation.
# Non-interactive runs without consent are refused (never hang, never guess).
if [ "$ASSUME_YES" -ne 1 ] && [ "${YES:-0}" != "1" ]; then
    if [ -t 0 ]; then
        printf "Proceed with destructive restore? [y/N] "
        read -r answer < /dev/tty || true
        if ! [[ "${answer:-}" =~ ^[Yy]$ ]]; then
            echo "Aborted."
            exit 0
        fi
    else
        echo "Refusing destructive restore without --yes (non-interactive session)." >&2
        exit "$EXIT_MISUSE"
    fi
fi

echo "Restoring backup from: $LATEST_BACKUP"

# Run mongorestore; the error path is reachable (checked directly, not via $?
# after a set -e command).
if ! mongorestore --uri="$CONNECTION_STRING" --drop "$LATEST_BACKUP"; then
    echo "Restore failed. Check the mongorestore output for details." >&2
    exit "$EXIT_GENERAL_ERROR"
fi

echo "Restore completed successfully!"
