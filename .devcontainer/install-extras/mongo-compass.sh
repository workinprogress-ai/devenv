#!/usr/bin/env bash
set -euo pipefail

echo "# Installing MongoDB Compass"
echo "#############################################"

arch=$(uname -m)
is_arm=$([ "$arch" == "aarch64" ] && echo 1)

devenv_root=${devenv:-/workspaces/devenv}
mkdir -p "$devenv_root/.installs"
cd "$devenv_root/.installs"

if [ "$is_arm" == "1" ]; then
    echo "ARM: Cannot install MongoDB Compass"
else
    if [ ! -f ./mongodb-compass.deb ]; then
        wget -O ./mongodb-compass.deb https://downloads.mongodb.com/compass/mongodb-compass_1.43.5_amd64.deb
    fi
    sudo apt-get update -y
    sudo apt-get install -y ./mongodb-compass.deb
fi
