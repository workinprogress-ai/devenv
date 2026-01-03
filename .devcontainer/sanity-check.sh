#!/bin/bash

container_bootstrap_run_file="\$HOME/.bootstrap_run_time"
repo_bootstrap_run_file="$toolbox_root/.devcontainer/.bootstrap_run_time"
script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")

function get_run_time() {
    if [ ! -f \$1 ]; then
        echo "0"
    else
        cat \$1
    fi
}

$DEVENV_ROOT/.devcontainer/check-update-devenv-repo.sh

if [ $(get_run_time \$container_bootstrap_run_file) != $(get_run_time \$repo_bootstrap_run_file) ]; then
    echo "WARNING!!!!!  The container bootstrap run time does not match the repo bootstrap run time."
    echo "Please rebuild dev env!!!!!!!!!"
fi
