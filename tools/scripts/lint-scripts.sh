#!/bin/bash
# lint-scripts.sh - Run shellcheck on all shell scripts in the project
# Version: 1.0.0
# Description: Validates all .sh files with shellcheck and generates a report

set -euo pipefail

# Configuration
readonly SCRIPT_VERSION="1.0.0"
readonly SHELLCHECK_SEVERITY="${SHELLCHECK_SEVERITY:-warning}"
readonly OUTPUT_FORMAT="${OUTPUT_FORMAT:-tty}"

# Colors
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Statistics
total_files=0
passed_files=0
failed_files=0
skipped_files=0

show_usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Run shellcheck on all shell scripts in the project.

Options:
    -h, --help          Show this help message
    -v, --version       Show version information
    -f, --format FMT    Output format: tty, json, gcc, checkstyle (default: tty)
    -s, --severity LVL  Minimum severity: error, warning, info, style (default: warning)
    -q, --quiet         Only show failures
    -d, --dir DIR       Directory to scan (default: project root)
    --fix               Show suggestions for auto-fixable issues
    --no-color          Disable colored output

Environment:
    SHELLCHECK_SEVERITY  Default severity level
    OUTPUT_FORMAT        Default output format
    NO_COLOR            Set to disable colors

Examples:
    # Check all scripts with default settings
    $(basename "$0")
    
    # Check only errors
    $(basename "$0") --severity error
    
    # Generate JSON report
    $(basename "$0") --format json > report.json
    
    # Check specific directory
    $(basename "$0") --dir scripts/

Exit Codes:
    0   All scripts passed
    1   One or more scripts failed
    2   Invalid arguments or shellcheck not found
EOF
    exit 0
}

log_info() {
    if [ "${QUIET:-0}" -eq 0 ]; then
        echo -e "${BLUE}ℹ${NC} $*"
    fi
}

log_success() {
    if [ "${QUIET:-0}" -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $*"
    fi
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $*" >&2
}

log_error() {
    echo -e "${RED}✗${NC} $*" >&2
}

check_dependencies() {
    if ! command -v shellcheck &> /dev/null; then
        log_error "shellcheck not found"
        echo "Install with: sudo apt-get install shellcheck"
        exit 2
    fi
}

find_shell_scripts() {
    local search_dir="${1:-$project_root}"
    
    # Find all .sh files, excluding certain directories
    find "$search_dir" -type f -name "*.sh" \
        ! -path "*/node_modules/*" \
        ! -path "*/.git/*" \
        ! -path "*/tmp/*" \
        ! -path "*/.debug/*" \
        2>/dev/null | sort
}

lint_script() {
    local script="$1"
    local relative_path="${script#$project_root/}"
    
    ((total_files++))
    
    # Skip if file doesn't have execute permission and doesn't start with shebang
    if [ ! -x "$script" ] && ! head -n 1 "$script" | grep -q '^#!.*sh'; then
        if [ "${QUIET:-0}" -eq 0 ]; then
            log_warning "Skipping: $relative_path (not executable, no shebang)"
        fi
        ((skipped_files++))
        return 0
    fi
    
    if [ "${QUIET:-0}" -eq 0 ]; then
        echo -n "Checking: $relative_path ... "
    fi
    
    # Run shellcheck
    local shellcheck_args=(-x -S "$SHELLCHECK_SEVERITY")
    
    if [ "$OUTPUT_FORMAT" != "tty" ]; then
        shellcheck_args+=(-f "$OUTPUT_FORMAT")
    fi
    
    if [ "${SHOW_FIX:-0}" -eq 1 ]; then
        shellcheck_args+=(--color=always)
    fi
    
    if shellcheck "${shellcheck_args[@]}" "$script" 2>&1; then
        if [ "${QUIET:-0}" -eq 0 ]; then
            echo -e "${GREEN}✓${NC}"
        fi
        ((passed_files++))
        return 0
    else
        if [ "${QUIET:-0}" -eq 0 ]; then
            echo -e "${RED}✗${NC}"
        else
            log_error "Failed: $relative_path"
        fi
        ((failed_files++))
        return 1
    fi
}

print_summary() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Shellcheck Summary"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Total files:   $total_files"
    echo -e "${GREEN}Passed:        $passed_files${NC}"
    
    if [ "$failed_files" -gt 0 ]; then
        echo -e "${RED}Failed:        $failed_files${NC}"
    else
        echo "Failed:        $failed_files"
    fi
    
    if [ "$skipped_files" -gt 0 ]; then
        echo -e "${YELLOW}Skipped:       $skipped_files${NC}"
    fi
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

main() {
    local search_dir="$project_root"
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                ;;
            -v|--version)
                echo "lint-scripts.sh version $SCRIPT_VERSION"
                exit 0
                ;;
            -f|--format)
                OUTPUT_FORMAT="$2"
                shift 2
                ;;
            -s|--severity)
                SHELLCHECK_SEVERITY="$2"
                shift 2
                ;;
            -q|--quiet)
                QUIET=1
                shift
                ;;
            -d|--dir)
                search_dir="$2"
                shift 2
                ;;
            --fix)
                SHOW_FIX=1
                shift
                ;;
            --no-color)
                # Disable colors by unsetting color variables
                RED=''
                GREEN=''
                YELLOW=''
                BLUE=''
                NC=''
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 2
                ;;
        esac
    done
    
    # Validate arguments
    if [ ! -d "$search_dir" ]; then
        log_error "Directory not found: $search_dir"
        exit 2
    fi
    
    check_dependencies
    
    log_info "Scanning for shell scripts in: $search_dir"
    log_info "Severity level: $SHELLCHECK_SEVERITY"
    log_info "Output format: $OUTPUT_FORMAT"
    echo ""
    
    # Find and lint all scripts
    local scripts
    scripts=$(find_shell_scripts "$search_dir")
    
    if [ -z "$scripts" ]; then
        log_warning "No shell scripts found"
        exit 0
    fi
    
    # Lint each script
    while IFS= read -r script; do
        lint_script "$script" || true
    done <<< "$scripts"
    
    # Print summary
    if [ "$OUTPUT_FORMAT" = "tty" ]; then
        print_summary
    fi
    
    # Exit with appropriate code
    if [ "$failed_files" -gt 0 ]; then
        exit 1
    else
        exit 0
    fi
}

# Run main function
main "$@"
