#!/bin/bash

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")

STARTUP_TIME=$(date +%s)
export STARTUP_TIME

sudo sysctl fs.inotify.max_user_instances=524288 &>/dev/null
grep -q '^nameserver 8\.8\.8\.8' /etc/resolv.conf || echo 'nameserver 8.8.8.8' | sudo tee -a /etc/resolv.conf > /dev/null

source $toolbox_root/.runtime/env-vars.sh
source $toolbox_root/.devcontainer/load-ssh.sh
nohup $toolbox_root/.devcontainer/load-docker.sh &>/dev/null &
nohup $toolbox_root/.devcontainer/background-check-devenv-updates.sh > /dev/null 2>&1 &

$toolbox_root/.devcontainer/sanity-check.sh

# Run organization-level custom startup (for forked repos)
if [ -f $toolbox_root/.devcontainer/org-custom-startup.sh ]; then
    echo "Running organization-level custom startup..."
    /bin/bash $toolbox_root/.devcontainer/org-custom-startup.sh
fi

# Run user-level custom startup (user-specific customizations)
if [ -f $toolbox_root/.devcontainer/user-custom-startup.sh ]; then
    echo "Running user-level custom startup..."
    /bin/bash $toolbox_root/.devcontainer/user-custom-startup.sh
fi



