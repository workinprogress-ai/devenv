#!/bin/bash

# Set container name
CONTAINER_NAME="samba_server"

# Use Samba for simulate a smb server
IMAGE="dockurr/samba"

# Set the share
SHARE="Data"

# Set files directory, username and password
DATA_DIR="$debug/smb-server/local"
USERNAME="devenv"
PASSWORD="devenv123"

# Ensure files directory exists
sudo mkdir -p "$DATA_DIR"

# Start existing container
if docker ps -a --format '{{.Names}}' | grep -q "^$CONTAINER_NAME$"; then
    echo "Starting existing container..."
    docker start "$CONTAINER_NAME" >/dev/null 2>&1
else
    echo "Running new SMB Server container..."

    # Start new container
    docker run --user root --name "$CONTAINER_NAME" \
        -e "NAME=$SHARE" \
        -e "USER=$USERNAME" \
        -e "PASS=$PASSWORD" \
        -p 445:445 \
        -v $DATA_DIR:/storage \
        -d "$IMAGE"

    # Wait for SMB Server to start
    echo "Waiting for SMB Server to be ready..."
    sleep 10
fi

# Prints to the user how to execute it
echo "Connect using: smbclient //127.0.0.1/$SHARE -U '$USERNAME%$PASSWORD'"
