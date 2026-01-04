#!/bin/bash

# Ensure that the script is not run with CRLF line endings
scriptdir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"; scriptfile="$0"; if [[ "$(file ${scriptdir}/${scriptfile})" =~ "CRLF" && -f "${scriptdir}/${scriptfile}" && "$(head -n 100 ${scriptdir}/${scriptfile} | grep "^scriptdir.\+dg4MbsIfhbv4-Bash-CRLF-selfheal_Written_By_Kenneth_Lutzke-8Nds9NclkU4sgE" > /dev/null 2>&1 ; echo "$?" )" == "0" ]]; then echo "$(cat ${scriptdir}/${scriptfile} | sed 's/\r$//')" > ${scriptdir}/${scriptfile} ; bash ${scriptdir}/${scriptfile} "$@" ; exit ; fi ; echo "" > /dev/null 2>&1

export DEVCONTAINER=true
script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")
container_bootstrap_run_file="$HOME/.bootstrap_container_time"
repo_bootstrap_run_file="$toolbox_root/.runtime/.bootstrap_run_time"
bootstrap_lock_file="$HOME/.bootstrap.lock"

function get_run_time() {
    if [ ! -f $1 ]; then
        echo "0"
    else
        cat $1
    fi
}

function on_error() {
    echo "Error running script"
    exit 1
}

trap on_error ERR

# Function to run bootstrap with proper locking
run_bootstrap() {
    # shellcheck disable=SC2034
    local lock_fd=200
    local max_wait=300  # 5 minutes
    local wait_time=0
    
    # Try to acquire exclusive lock
    exec 200>"$bootstrap_lock_file"
    
    echo "Attempting to acquire bootstrap lock..."
    while ! flock -n 200; do
        if [ $wait_time -ge $max_wait ]; then
            echo "ERROR: Timeout waiting for bootstrap lock after ${max_wait}s"
            exit 1
        fi
        echo "Bootstrap is already running in another process. Waiting..."
        sleep 5
        wait_time=$((wait_time + 5))
    done
    
    echo "Lock acquired, running bootstrap..."
    
    # Run bootstrap
    sed -i 's/\r//g' $toolbox_root/.devcontainer/bootstrap.sh
    chmod +x $toolbox_root/.devcontainer/bootstrap.sh
    $toolbox_root/.devcontainer/bootstrap.sh
    
    echo "Bootstrap script executed"
    
    # Lock is automatically released when fd 200 is closed
}

if [ ! -f $container_bootstrap_run_file ]; then
    echo "Bootstrap has not yet been run, running now"
    run_bootstrap
elif [ "$(get_run_time "$container_bootstrap_run_file")" != "$(get_run_time "$repo_bootstrap_run_file")" ]; then
    echo "WARNING!!!!!  The container bootstrap run time does not match the repo bootstrap run time."
    echo "Bootstrap running NOW!!!!!!!!!"
    run_bootstrap
    echo "Please restart the container"
else
    $toolbox_root/.devcontainer/startup.sh
    echo "Startup script executed"

    cd "$toolbox_root/repos" || exit
    if [ -z "$(find . -mindepth 1 -maxdepth 1 -type d)" ]; then
        echo "No repos have been cloned yet.  If you want to clone a standard repo, run the following command:"
        echo "repo-get <repo name>"
    fi
fi

if ! [ -f $container_bootstrap_run_file ]; then
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "WARNING:  Bootstrap has not yet successfully run!"
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
fi
