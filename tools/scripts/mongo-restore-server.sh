#!/bin/bash
# restore.sh: Restore all databases to a MongoDB cluster from a backup.
# Usage: ./restore.sh "<connection_string>" "/path/to/backup_directory"
# Note: This script assumes the backup folder contains subdirectories created by the backup script.

# Check if mongorestore is installed.
if [ $(which mongorestore) ]; then
    echo "mongorestore is installed."
else
    echo "mongorestore is not installed. Please install it before running this script."
    exit 1
fi

# Check if proper arguments are provided.
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <connection_string> <backup_directory>"
    exit 1
fi

CONNECTION_STRING="$1"
BACKUP_DIR="$2"

# Verify that the backup directory exists.
if [ ! -d "$BACKUP_DIR" ]; then
    echo "Error: Backup directory '$BACKUP_DIR' does not exist."
    exit 1
fi

# Optionally, pick the latest backup folder (based on directory name timestamp).
LATEST_BACKUP=$(ls -td "$BACKUP_DIR"/*/ 2>/dev/null | head -1)

if [ -z "$LATEST_BACKUP" ]; then
    echo "No backup subdirectories found in $BACKUP_DIR."
    exit 1
fi

echo "Restoring backup from: $LATEST_BACKUP"

# Run mongorestore using the connection string. The --drop option will drop existing collections before restoring.
mongorestore --uri="$CONNECTION_STRING" --drop "$LATEST_BACKUP"

if [ $? -eq 0 ]; then
    echo "Restore completed successfully!"
else
    echo "Restore failed. Check the mongorestore output for details."
    exit 1
fi
