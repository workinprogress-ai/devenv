#!/bin/bash

################################################################################
# dependencies-down.sh
#
# Stop and remove development dependency containers
#
# Usage:
#   ./dependencies-down.sh
#
# Dependencies:
#   - docker (Docker daemon)
#   - docker compose
#
################################################################################

docker compose -f "$DEVENV_TOOLS/other/docker-compose-dependencies.yml" down
