#!/bin/bash

script_path=$(readlink -f "$0") 
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")

targ_folder=$toolbox_root/.debug/remote_debugger
echo "Copying debugger to $toolbox_root/.remote_debugger"
mkdir -p $targ_folder
wget https://aka.ms/getvsdbgsh -O $targ_folder/getvsdbg.sh
chmod a+x $targ_folder/getvsdbg.sh
/bin/bash $targ_folder/getvsdbg.sh -v latest -l $targ_folder
