#!/bin/bash
set -euo pipefail
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$DEVENV_TOOLS/lib/error-handling.bash"

################################################################################
# container-enable-dotnet-debugger.sh
#
# Enable debugging support in Docker containers for .NET applications
#
# Usage:
#   ./container-enable-dotnet-debugger.sh <container-id>
#
# Dependencies:
#   - docker (Docker daemon)
#
################################################################################

if [[ -z "$1" ]]; then
    echo "Provide the container name to enable debugging"
    exit 1
fi;

container_name=$1

docker exec $container_name mkdir -p /remote_debugger
docker exec $container_name wget https://aka.ms/getvsdbgsh -O /remote_debugger/getvsdbg.sh
docker exec $container_name chmod a+x /remote_debugger/getvsdbg.sh
docker exec $container_name /bin/bash /remote_debugger/getvsdbg.sh -v latest -l /remote_debugger
