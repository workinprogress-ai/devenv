#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"

set -euo pipefail

source "$DEVENV_TOOLS/lib/editor.bash"

usage() {
  echo "Usage: editor <file> [file ...]" >&2
  echo "Opens the file(s) using the editor function (blocking)." >&2
}

if [ "$#" -lt 1 ]; then
  usage
  exit 1
fi

# Open each path provided, blocking per file until closed via the function
for target in "$@"; do
  open_in_editor "$target"
done
