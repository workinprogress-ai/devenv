#!/bin/bash

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")

env_file=$toolbox_root/_devops/default.env
if [ -f $toolbox_root/local.env ]; then
  env_file=$toolbox_root/local.env
fi

echo "Using env file $env_file"
docker compose --env-file $env_file -f ./_devops/docker-compose.yml build $@
