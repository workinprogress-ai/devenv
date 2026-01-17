#!/bin/bash

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
