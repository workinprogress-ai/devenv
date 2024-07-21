#!/bin/bash

# Ensure that the script is not run with CRLF line endings
scriptdir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"; scriptfile="$0"; if [[ "$(file ${scriptdir}/${scriptfile})" =~ "CRLF" && -f "${scriptdir}/${scriptfile}" && "$(head -n 100 ${scriptdir}/${scriptfile} | grep "^scriptdir.\+dg4MbsIfhbv4-Bash-CRLF-selfheal_Written_By_Kenneth_Lutzke-8Nds9NclkU4sgE" > /dev/null 2>&1 ; echo "$?" )" == "0" ]]; then echo "$(cat ${scriptdir}/${scriptfile} | sed 's/\r$//')" > ${scriptdir}/${scriptfile} ; bash ${scriptdir}/${scriptfile} $@ ; exit ; fi ; echo "" > /dev/null 2>&1

export DEVCONTAINER=true
script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")

if ! [ -f $HOME/.ran_bootstrap ]; then
    echo "Bootstrap has not yet been run, running now"
    sed -i 's/\r//g' $toolbox_root/.devcontainer/bootstrap.sh
    chmod +x $toolbox_root/.devcontainer/bootstrap.sh
    $toolbox_root/.devcontainer/bootstrap.sh

    # If there is a custom startup, run it
    if [ -f $toolbox_root/.devcontainer/devcontainer/custom_bootstrap.sh ]; then
        /bin/bash $toolbox_root/.devcontainer/custom_bootstrap.sh
    fi
fi

# If there is a custom startup, run it
if [ -f $toolbox_root/.devcontainer/devcontainer/custom_startup.sh ]; then
    /bin/bash $toolbox_root/.devcontainer/custom_startup.sh
fi

if ! [ -f $HOME/.ran_bootstrap ]; then
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "WARNING:  Bootstrap has not yet successfully run!"
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
else
    cd $HOME/repos
    if [ -z "$(find . -mindepth 1 -maxdepth 1 -type d)" ]; then
        echo "No repos have been cloned yet.  If you want to clone the standard repos, run the following command:"
        echo "update-repos.sh"
    fi
fi
