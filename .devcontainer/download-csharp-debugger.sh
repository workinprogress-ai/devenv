#!/bin/bash
set -euo pipefail

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")

# Pinned sha256 of getvsdbg.sh. Empty means unpinned: the script is run and a
# warning is printed. The vendor updates the script in place, so refresh the
# pin whenever the vendor publishes a new one.
GETVSDBG_SHA256="${GETVSDBG_SHA256:-}"

targ_folder=$toolbox_root/.debug/remote_debugger
echo "Copying debugger to $targ_folder"
mkdir -p "$targ_folder"
wget https://aka.ms/getvsdbgsh -O "$targ_folder/getvsdbg.sh"

if [ -n "$GETVSDBG_SHA256" ]; then
    if ! echo "$GETVSDBG_SHA256  $targ_folder/getvsdbg.sh" | sha256sum --check --status; then
        rm -f "$targ_folder/getvsdbg.sh"
        echo "getvsdbg.sh does not match the pinned sha256; refusing to run it." >&2
        exit 1
    fi
else
    echo "WARNING: getvsdbg.sh run without a pinned sha256." >&2
fi

chmod a+x "$targ_folder/getvsdbg.sh"
/bin/bash "$targ_folder/getvsdbg.sh" -v latest -l "$targ_folder"
