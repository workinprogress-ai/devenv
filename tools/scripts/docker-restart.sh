#!/bin/bash

################################################################################
# docker-restart.sh
#
# Restarts the Docker daemon by killing it and reloading it
#
# Usage:
#   ./docker-restart.sh
#
# Dependencies:
#   - sudo access
#   - .devcontainer/load-docker.sh
#
################################################################################

echo "Stopping Docker daemon..."
sudo pkill docker

echo "Restarting Docker daemon..."
"$DEVENV_ROOT/.devcontainer/load-docker.sh"

echo "Docker daemon restart complete."
