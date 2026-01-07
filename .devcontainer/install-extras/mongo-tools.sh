#!/usr/bin/env bash
set -euo pipefail

# Install MongoDB command-line tools
# Includes mongosh (MongoDB Shell), mongodump, mongorestore, and other database utilities.
# Supports both ARM64 and AMD64 architectures.

tmp_dir=$(mktemp -d)
cd "$tmp_dir"

arch=$(uname -m)
is_arm=$([ "$arch" == "aarch64" ] && echo 1)

if [ "$is_arm" == "1" ]; then
    wget -O mongo-shell.deb https://downloads.mongodb.com/compass/mongodb-mongosh_2.1.5_arm64.deb
    wget -O mongo-tools.deb https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-arm64-100.9.4.deb
else
    wget -O mongo-tools.deb https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-x86_64-100.9.4.deb
    wget -O mongo-shell.deb https://downloads.mongodb.com/compass/mongodb-mongosh_2.1.5_amd64.deb
fi

sudo apt-get update -y
sudo apt-get install -y ./mongo-tools.deb
sudo apt-get install -y ./mongo-shell.deb

cd - >/dev/null 2>&1
rm -rf "$tmp_dir"
