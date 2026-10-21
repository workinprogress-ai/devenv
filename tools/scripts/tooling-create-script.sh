#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"
# create-script.sh - Create a new script from template
# Version: 1.0.0
# Description: Creates a new shell script from the standard template

set -euo pipefail

readonly TEMPLATE_TS="$DEVENV_TOOLS/templates/script-template.ts"
readonly TEMPLATE_BASH="$DEVENV_TOOLS/templates/script-template.sh"
PROJECT_ROOT="${PROJECT_ROOT:-$DEVENV_ROOT}"

show_usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS] SCRIPT_NAME

Create a new script from the standard template. TypeScript is the default
language; bash remains available for recovery-path/bootstrap-adjacent tools.

Arguments:
    SCRIPT_NAME     Name of the script to create (extension added per --lang)

Options:
    -h, --help      Show this help message
    -d, --dir DIR   Output directory (default: scripts/)
    -f, --force     Overwrite existing file
    -l, --lang LANG Template language: ts (default) or bash

Examples:
    # Create a TypeScript tool (default)
    $(basename "$0") my-new-tool

    # Create a bash script (recovery-path/bootstrap-adjacent tools)
    $(basename "$0") --lang bash my-legacy-script

    # Create script in custom directory
    $(basename "$0") --dir tools/ my-tool

    # Overwrite existing script
    $(basename "$0") --force my-script

EOF
    exit 0
}

main() {
    local script_name=""
    local output_dir="$PROJECT_ROOT/scripts"
    local force=0
    local lang="ts"

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                ;;
            -d|--dir)
                require_option_value "$1" "${2:-}"
                output_dir="$2"
                shift 2
                ;;
            -f|--force)
                force=1
                shift
                ;;
            -l|--lang)
                require_option_value "$1" "${2:-}"
                lang="$2"
                shift 2
                ;;
            -*)
                echo "ERROR: Unknown option: $1" >&2
                exit 2
                ;;
            *)
                script_name="$1"
                shift
                ;;
        esac
    done
    
    # Validate input
    if [ -z "$script_name" ]; then
        echo "ERROR: Script name is required" >&2
        echo "Use --help for usage information" >&2
        exit 2
    fi
    
    # Validate language selection
    case "$lang" in
        ts) local ext="ts"; local template_file="$TEMPLATE_TS" ;;
        bash) local ext="sh"; local template_file="$TEMPLATE_BASH" ;;
        *)
            echo "ERROR: Unknown language: $lang (expected ts or bash)" >&2
            exit 2
            ;;
    esac

    # Ensure correct extension for the chosen language
    if [[ ! "$script_name"\.$ext =~ \.$ext$ ]]; then
        :
    fi
    if [[ ! "$script_name" =~ \.$ext$ ]]; then
        script_name="${script_name}.${ext}"
    fi

    # Check template exists
    if [ ! -f "$template_file" ]; then
        echo "ERROR: Template file not found: $template_file" >&2
        exit 1
    fi

    # Create output directory if it doesn't exist
    mkdir -p "$output_dir"

    local output_file="$output_dir/$script_name"

    # Check if file exists
    if [ -f "$output_file" ] && [ $force -eq 0 ]; then
        echo "ERROR: File already exists: $output_file" >&2
        echo "Use --force to overwrite" >&2
        exit 1
    fi

    # Copy template and customize
    echo "Creating script: $output_file"

    sed -e "s/SCRIPT_NAME\.$ext/$script_name/g" \
        -e "s|DEVENV_TOOLS|$DEVENV_TOOLS|g" \
        "$template_file" > "$output_file"

    # Update modification date
    local current_date
    current_date=$(date +%Y-%m-%d)
    sed -i "s/YYYY-MM-DD/$current_date/g" "$output_file"

    # Make executable
    chmod +x "$output_file"

    echo "✓ Script created successfully"
    echo ""
    echo "Next steps:"
    echo "  1. Edit $output_file"
    echo "  2. Update the description and version"
    echo "  3. Implement your script logic"
    if [ "$lang" = "ts" ]; then
        echo "  4. Create tests in tools/tests/ts/test_${script_name%.ts}.test.ts"
        echo "  5. Run: pnpm test:ts"
    else
        echo "  4. Create tests in tests/test_${script_name%.sh}.bats"
        echo "  5. Run: bats tests/test_${script_name%.sh}.bats"
    fi
    
    return 0
}

main "$@"
