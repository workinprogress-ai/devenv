#!/bin/bash

env_file=""
if [ -f "$DEVENV_ROOT/local.env" ]; then
  env_file="--env-file $DEVENV_ROOT/local.env"
fi

docker compose $env_file -f "$DEVENV_TOOLS/docker-compose-dependencies.yml" build "$@"
