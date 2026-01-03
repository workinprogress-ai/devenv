#!/bin/bash

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")

STARTUP_TIME=$(date +%s)
export STARTUP_TIME

sudo sysctl fs.inotify.max_user_instances=524288 &>/dev/null
grep -q '^nameserver 8\.8\.8\.8' /etc/resolv.conf || echo 'nameserver 8.8.8.8' | sudo tee -a /etc/resolv.conf > /dev/null

source $toolbox_root/.devcontainer/env-vars.sh
source $toolbox_root/.devcontainer/load-ssh.sh
nohup $toolbox_root/.devcontainer/load-docker.sh &>/dev/null &
nohup $toolbox_root/.devcontainer/background-check-devenv-updates.sh > /dev/null 2>&1 &

$toolbox_root/.devcontainer/sanity-check.sh

# If there is a custom startup, run it
if [ -f $toolbox_root/.devcontainer/custom-startup.sh ]; then
    /bin/bash $toolbox_root/.devcontainer/custom-startup.sh
fi



