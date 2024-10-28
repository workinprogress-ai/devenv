#!/bin/bash

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")

export STARTUP_TIME=$(date +%s)

source $toolbox_root/.devcontainer/env-vars.sh
source $toolbox_root/.devcontainer/load-ssh.sh
nohup $toolbox_root/.devcontainer/load-docker.sh &>/dev/null &


sudo sysctl fs.inotify.max_user_instances=524288 &>/dev/null

grep -q -F "8.8.8.8" /etc/resolv.conf || echo "nameserver 8.8.8.8   8.8.4.4" | sudo tee -a /etc/resolv.conf &>/dev/null

$toolbox_root/.devcontainer/sanity-check.sh


