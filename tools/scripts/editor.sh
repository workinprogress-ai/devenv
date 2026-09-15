#!/bin/bash
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
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
