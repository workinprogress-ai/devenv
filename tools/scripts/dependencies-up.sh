#!/bin/bash
set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"

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
