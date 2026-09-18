#!/bin/bash
set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
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
