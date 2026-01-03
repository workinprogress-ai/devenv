#!/bin/bash

# shellcheck disable=SC2034 # debug is defined from DEVENV_ROOT
debug="${DEVENV_ROOT:-.}/.debug"

# Set container name
CONTAINER_NAME="sqlserver"

# Use Azure SQL Edge for ARM compatibility
IMAGE="mcr.microsoft.com/azure-sql-edge:1.0.3"
#IMAGE="mcr.microsoft.com/azure-sql-edge"

# Set data directory (optional: makes data persist between runs)
DATA_DIR="$debug/data/local/sqlserver"
PASSWORD="1Passw0rd"

# Ensure data directory exists and has the permissions for the mssql user in the container
sudo mkdir -p "$DATA_DIR"
#sudo chown -R 10001:10001 "$DATA_DIR"

# Stop and remove any existing container with the same name
if docker ps -a --format '{{.Names}}' | grep -q "^$CONTAINER_NAME$"; then
    echo "Starting existing container..."
    docker start "$CONTAINER_NAME" >/dev/null 2>&1
    #docker rm "$CONTAINER_NAME" >/dev/null 2>&1
else
    echo "Running new SQL Server container..."
    # docker run --user root --name "$CONTAINER_NAME" \
    #     -e "ACCEPT_EULA=Y" \
    #     -e "MSSQL_SA_PASSWORD=$PASSWORD" \
    #     -p 1433:1433 \
    #     -v "$DATA_DIR:/var/opt/mssql" \
    #     -d "$IMAGE"
    docker run --user root --name "$CONTAINER_NAME" \
        -e "ACCEPT_EULA=Y" \
        -e "MSSQL_SA_PASSWORD=$PASSWORD" \
        -p 1433:1433 \
        -d "$IMAGE"

    # Wait for SQL Server to start
    echo "Waiting for SQL Server to be ready..."
    sleep 10

    echo "Creating database 'test'..."
    docker exec -i "$CONTAINER_NAME" /opt/mssql-tools/bin/sqlcmd -S localhost -U SA -P "$PASSWORD" -Q "CREATE DATABASE test;"
fi

echo "Connect using: sqlcmd -S localhost -U SA -P '$PASSWORD'"
