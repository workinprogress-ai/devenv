#!/bin/bash
set -euo pipefail
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
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
