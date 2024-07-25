#!/bin/bash

script_path=$(readlink -f "$0") 
script_folder=$(dirname "$script_path")
repo_root=$(dirname "$script_folder")
current_folder="$(pwd)"

# if [[ ! -e "docker-compose.yml" || "$current_folder" == "$repo_root" ]]; then
#     echo "Run this script from the service folder";
#     exit 1;
# fi

if [[ -z "$1" ]]; then
    echo "Provide the container name to enable debugging"
    exit 1
fi;

container_name=$1

docker exec $container_name mkdir -p /remote_debugger
docker exec $container_name wget https://aka.ms/getvsdbgsh -O /remote_debugger/getvsdbg.sh
docker exec $container_name chmod a+x /remote_debugger/getvsdbg.sh
docker exec $container_name /bin/bash /remote_debugger/getvsdbg.sh -v latest -l /remote_debugger
