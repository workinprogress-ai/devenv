#!/bin/bash

################################################################################
# dependencies-up.sh
#
# Start development dependency containers
#
# Usage:
#   ./dependencies-up.sh
#
# Dependencies:
#   - docker (Docker daemon)
#   - docker compose
#
################################################################################

docker compose -f "$DEVENV_TOOLS/other/docker-compose-dependencies.yml" up
