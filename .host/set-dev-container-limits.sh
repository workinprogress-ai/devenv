#!/bin/bash

set -euo pipefail

# Detect host OS from uname. This script supports macOS and Linux only.
OS_NAME="$(uname -s 2>/dev/null || echo unknown)"
case "$OS_NAME" in
    Linux|Darwin)
        ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
        echo "Error: Windows is not supported by this script. Please run it from macOS or Linux."
        exit 1
        ;;
    *)
        echo "Error: Unsupported OS '$OS_NAME'. This script supports macOS and Linux only."
        exit 1
        ;;
esac

# 1. Validate that the user provided exactly 3 parameters
if [ "$#" -ne 3 ]; then
    echo "Error: Missing parameters."
    echo "Usage: $0 <memory> <swap> <cpus>"
    echo "Example: $0 16g 4g 8"
    exit 1
fi

MEM=$1
SWAP=$2
CPUS=$3
BASHRC="$HOME/.bashrc"

echo "Setting VS Code Dev Container limits in $BASHRC..."

# 2. Helper function to safely update or append the export statement
update_or_append() {
    local var_name=$1
    local var_val=$2

    # Create the rc file if it does not exist yet.
    touch "$BASHRC"

    # Use awk + mv for cross-platform in-place updates (GNU/BSD sed differ on -i).
    local tmp_file
    tmp_file="$(mktemp "${TMPDIR:-/tmp}/set-dev-container-limits.XXXXXX")"

    awk -v key="$var_name" -v val="$var_val" '
        BEGIN { updated = 0 }
        $0 ~ "^export " key "=" {
            print "export " key "=\"" val "\""
            updated = 1
            next
        }
        { print }
        END {
            if (!updated) {
                print "export " key "=\"" val "\""
            }
        }
    ' "$BASHRC" > "$tmp_file"

    mv "$tmp_file" "$BASHRC"
}

# 3. Apply the limits
update_or_append "DEVCONT_MEM" "$MEM"
update_or_append "DEVCONT_SWAP" "$SWAP"
update_or_append "DEVCONT_CPUS" "$CPUS"

echo "Success! Limits updated to: Memory=$MEM, Swap=$SWAP, CPUs=$CPUS"
echo "Run 'source ~/.bashrc' or restart your terminal to apply the changes."