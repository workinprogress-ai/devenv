#!/usr/bin/env bash
# Extract .snupkg symbol packages into a target directory for inspection

set -euo pipefail

# shellcheck source=lib/error-handling.bash
source "$DEVENV_ROOT/tools/lib/error-handling.bash"

usage() {
    cat <<'EOF'
Usage: extract-snupkgs.sh <snupkg-path> [output-dir]

Extracts a .snupkg (NuGet symbols) into the specified directory.
If output-dir is omitted, extracts to ./snupkg-extracted/<name> under the current directory.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
fi

require_command unzip "unzip is required to extract snupkgs"

if [ $# -lt 1 ]; then
    usage
    exit $EXIT_INVALID_ARGUMENT
fi

SNUPKG_PATH="$1"
OUTPUT_ROOT="${2:-snupkg-extracted}"

if [ ! -f "$SNUPKG_PATH" ]; then
    die "File not found: $SNUPKG_PATH" "$EXIT_NOT_FOUND"
fi

mkdir -p "$OUTPUT_ROOT"
base_name="$(basename "$SNUPKG_PATH" .snupkg)"
target_dir="$OUTPUT_ROOT/$base_name"

mkdir -p "$target_dir"

log_info "Extracting $SNUPKG_PATH -> $target_dir"
unzip -q -o "$SNUPKG_PATH" -d "$target_dir"

success "Extracted to $target_dir"
