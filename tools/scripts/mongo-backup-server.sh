#!/bin/bash
set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"
# backup.sh: Back up each non-built-in MongoDB database individually from a MongoDB cluster.
# Usage: ./backup.sh "<connection_string>" "/path/to/backup_directory"
# Safety: the database listing is validated before any dump runs — a mongosh
# failure or a malformed name aborts the backup loudly instead of producing a
# partial or garbage-named dump tree.

source "$DEVENV_TOOLS/lib/database-operations.bash"

require_command mongodump
require_command mongosh

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <connection_string> <backup_directory>"
    exit "$EXIT_MISUSE"
fi

CONNECTION_STRING="$1"
BACKUP_DIR="$2"

# Create the backup directory if it doesn't exist.
mkdir -p "$BACKUP_DIR"

# Use the current date and time to create a unique subfolder for this backup.
TIMESTAMP=$(date +'%Y%m%d_%H%M%S')
OUTPUT_DIR="${BACKUP_DIR}/${TIMESTAMP}"
mkdir -p "$OUTPUT_DIR"

echo "Listing non-built-in databases from the MongoDB cluster..."

# Run mongosh to a temp file and capture its exit code directly: a mongosh
# failure must abort, not feed warnings/failures into the backup loop as
# database names.
DB_LIST_FILE=$(mktemp)
trap 'rm -f "$DB_LIST_FILE"' EXIT
if ! mongosh "$CONNECTION_STRING" --quiet --eval "var dbs = db.adminCommand('listDatabases'); dbs.databases.forEach(function(d) { print(d.name); });" > "$DB_LIST_FILE"; then
    echo "Error: failed to list databases from the cluster (mongosh exited non-zero)." >&2
    exit "$EXIT_API_FAILURE"
fi

# Filter and validate: built-ins are skipped; anything that is not a legal
# database name aborts the whole backup (a partial backup that looks complete
# is worse than a loud failure).
databases=()
while IFS= read -r line; do
    # Skip empty lines
    [ -z "$line" ] && continue
    # Exclude built-in databases.
    if [ "$line" = "admin" ] || [ "$line" = "local" ] || [ "$line" = "config" ]; then
        echo "Skipping built-in database: $line"
        continue
    fi
    if ! [[ "$line" =~ ^[A-Za-z0-9_-]+$ ]]; then
        echo "Error: mongosh returned an invalid database name: '$line' — aborting backup." >&2
        exit "$EXIT_API_FAILURE"
    fi
    databases+=("$line")
done < "$DB_LIST_FILE"

if [ "${#databases[@]}" -eq 0 ]; then
    echo "Error: no non-built-in databases found to back up." >&2
    exit "$EXIT_API_FAILURE"
fi

echo "Found databases: ${databases[*]}"

# Back up each database individually; a failed dump aborts the backup (the
# completed dumps stay on disk, the failure is reported non-zero).
for db in "${databases[@]}"; do
    echo "Backing up database: $db"
    if ! mongodump --uri="$CONNECTION_STRING" --db "$db" --out "$OUTPUT_DIR"; then
        echo "Error: Backup failed for database: $db" >&2
        exit "$EXIT_GENERAL_ERROR"
    fi
done

echo "Backup completed! Your backup is stored in: $OUTPUT_DIR"
