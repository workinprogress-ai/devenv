#!/bin/bash

# Ensure that the script is not run with CRLF line endings
scriptdir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"; scriptfile="$0"; if [[ "$(file ${scriptdir}/${scriptfile})" =~ "CRLF" && -f "${scriptdir}/${scriptfile}" && "$(head -n 100 ${scriptdir}/${scriptfile} | grep "^scriptdir.\+dg4MbsIfhbv4-Bash-CRLF-selfheal_Written_By_Kenneth_Lutzke-8Nds9NclkU4sgE" > /dev/null 2>&1 ; echo "$?" )" == "0" ]]; then echo "$(cat ${scriptdir}/${scriptfile} | sed 's/\r$//')" > ${scriptdir}/${scriptfile} ; bash ${scriptdir}/${scriptfile} $@ ; exit ; fi ; echo "" > /dev/null 2>&1

export DEVCONTAINER=true
script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")
container_bootstrap_run_file="$HOME/.bootstrap_run_time"
repo_bootstrap_run_file="$toolbox_root/.devcontainer/.bootstrap_run_time"
bootstrap_running_file="$HOME/.bootstrap_running"

function get_run_time() {
    if [ ! -f $1 ]; then
        echo "0"
    else
        cat $1
    fi
}

function on_error() {
    echo "Error running script"
    rm $bootstrap_running_file &> /dev/null
    exit 1
}

trap on_error ERR

if [ ! -f $container_bootstrap_run_file ] && ! [ -f $bootstrap_running_file ]; then
    touch $bootstrap_running_file
    echo "Bootstrap has not yet been run, running now"
    sed -i 's/\r//g' $toolbox_root/.devcontainer/bootstrap.sh
    chmod +x $toolbox_root/.devcontainer/bootstrap.sh
    $toolbox_root/.devcontainer/bootstrap.sh

    # If there is a custom startup, run it
    if [ -f $toolbox_root/.devcontainer/custom_bootstrap.sh ]; then
        /bin/bash $toolbox_root/.devcontainer/custom_bootstrap.sh
    fi
    rm $bootstrap_running_file
elif [ $(get_run_time $container_bootstrap_run_file) != $(get_run_time $repo_bootstrap_run_file) ]; then
    echo "WARNING!!!!!  The container bootstrap run time does not match the repo bootstrap run time."
    echo "Please rebuild dev env!!!!!!!!!"
    exit 1;
fi

# If there is a custom startup, run it
if [ -f $toolbox_root/.devcontainer/custom_startup.sh ]; then
    /bin/bash $toolbox_root/.devcontainer/custom_startup.sh
fi

if ! [ -f $container_bootstrap_run_file ]; then
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "WARNING:  Bootstrap has not yet successfully run!"
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
else
    cd $toolbox_root/repos
    if [ -z "$(find . -mindepth 1 -maxdepth 1 -type d)" ]; then
        echo "No repos have been cloned yet.  If you want to clone a standard repo, run the following command:"
        echo "get-repo <repo name>"
    fi
fi
