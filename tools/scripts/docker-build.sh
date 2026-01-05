#!/bin/bash
source "$DEVENV_TOOLS/lib/container-operations.bash"

env_file=""
if [ -f "$DEVENV_ROOT/local.env" ]; then
  env_file="--env-file $DEVENV_ROOT/local.env"
fi

docker compose $env_file -f "$DEVENV_TOOLS/other/docker-compose-dependencies.yml" build "$@"
