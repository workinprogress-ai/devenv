#!/usr/bin/env bash
set -euo pipefail

# Install MongoDB Compass GUI
# MongoDB Compass provides a graphical interface for exploring and managing MongoDB databases.
# Note: Only available for AMD64 architecture (not ARM).

echo "# Installing MongoDB Compass"
echo "#############################################"

arch=$(uname -m)
is_arm=$([ "$arch" == "aarch64" ] && echo 1 || echo 0)

devenv_root=${devenv:-/workspaces/devenv}
mkdir -p "$devenv_root/.installs"
cd "$devenv_root/.installs"

if [ "$is_arm" == "1" ]; then
    echo "ARM: Cannot install MongoDB Compass"
else
    wget -O ./mongodb-compass.deb https://downloads.mongodb.com/compass/mongodb-compass_1.49.7_amd64.deb
    sudo apt-get update -y
    sudo apt-get install -y ./mongodb-compass.deb

    if [[ -f "${HOME}/.fluxbox/menu" ]]; then
        devenv-desktop-menu-add-folder "Applications"
        devenv-desktop-menu-add-shortcut "MongoDB Compass" "mongodb-compass" "Applications"
    fi
fi
