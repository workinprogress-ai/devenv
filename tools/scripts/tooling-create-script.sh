#!/bin/bash
# create-script.sh - Create a new script from template
# Version: 1.0.0
# Description: Creates a new shell script from the standard template

set -euo pipefail

readonly TEMPLATE_FILE="$DEVENV_TOOLS/templates/script-template.sh"

show_usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS] SCRIPT_NAME

Create a new shell script from the standard template.

Arguments:
    SCRIPT_NAME     Name of the script to create (without .sh extension)

Options:
    -h, --help      Show this help message
    -d, --dir DIR   Output directory (default: scripts/)
    -f, --force     Overwrite existing file

Examples:
    # Create script in scripts/ directory
    $(basename "$0") my-new-script

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
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                ;;
            -d|--dir)
                output_dir="$2"
                shift 2
                ;;
            -f|--force)
                force=1
                shift
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
    
    # Ensure .sh extension
    if [[ ! "$script_name" =~ \.sh$ ]]; then
        script_name="${script_name}.sh"
    fi
    
    # Check template exists
    if [ ! -f "$TEMPLATE_FILE" ]; then
        echo "ERROR: Template file not found: $TEMPLATE_FILE" >&2
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
    
    sed "s/SCRIPT_NAME\.sh/$script_name/g" "$TEMPLATE_FILE" > "$output_file"
    
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
    echo "  4. Create tests in tests/test_${script_name%.sh}.bats"
    echo "  5. Run: bats tests/test_${script_name%.sh}.bats"
    
    return 0
}

main "$@"
