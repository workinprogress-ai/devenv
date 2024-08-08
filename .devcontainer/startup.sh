#!/bin/bash

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")

export STARTUP_TIME=$(date +%s)

source $toolbox_root/.devcontainer/env_vars.sh
source $toolbox_root/.devcontainer/load-ssh.sh
$toolbox_root/.devcontainer/load-docker.sh

$toolbox_root/.devcontainer/sanity-check.sh

if $toolbox_root/.devcontainer/check-update-devenv-repo.sh ; then 
    #source \$HOME/.bashrc
    echo "Devenv repo updated!"
fi

