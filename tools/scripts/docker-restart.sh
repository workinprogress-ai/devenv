#!/bin/bash
set -euo pipefail
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$DEVENV_TOOLS/lib/error-handling.bash"

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
