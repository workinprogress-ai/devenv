#!/bin/bash
# backup.sh: Back up each non-built-in MongoDB database individually from a MongoDB cluster.
# Usage: ./backup.sh "<connection_string>" "/path/to/backup_directory"

# Check if mongodump is installed.
if [ "$(which mongodump)" ]; then
    echo "mongodump is installed."
else
    echo "mongodump is not installed. Please install it before running this script."
    exit 1
fi
# Check if mongorestore is installed.
if [ "$(which mongosh)" ]; then
    echo "mongosh is installed."
else
    echo "mongosh is not installed. Please install it before running this script."
    exit 1
fi

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <connection_string> <backup_directory>"
    exit 1
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

# List all databases using the mongo shell.
# The output will be one database name per line.
databases=()
while IFS= read -r line; do
    # Skip empty lines
    [ -z "$line" ] && continue
    # Exclude built-in databases.
    if [ "$line" = "admin" ] || [ "$line" = "local" ] || [ "$line" = "config" ]; then
        echo "Skipping built-in database: $line"
        continue
    fi
    databases+=("$line")
done < <(mongosh "$CONNECTION_STRING" --quiet --eval "var dbs = db.adminCommand('listDatabases'); dbs.databases.forEach(function(d) { print(d.name); });")

echo "Found databases: ${databases[*]}"

# Back up each database individually.
for db in "${databases[@]}"; do
    echo "Backing up database: $db"
    mongodump --uri="$CONNECTION_STRING" --db "$db" --out "$OUTPUT_DIR"
    if [ $? -ne 0 ]; then
        echo "Error: Backup failed for database: $db"
    fi
done

echo "Backup completed! Your backup is stored in: $OUTPUT_DIR"
