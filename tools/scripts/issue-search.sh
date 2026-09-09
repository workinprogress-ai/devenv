#!/bin/bash
# issue-search.sh - Keyword search across GitHub issue titles and bodies
# Version: 1.0.0
# Description: Client-side any-keyword, case-insensitive search over title and
#              body of issues, ranked by keyword-hit count. Complements
#              issue-list (structured filtering) with fuzzy duplicate detection.
# Requirements: Bash 4.0+, gh CLI, jq
# Author: WorkInProgress.ai
# Last Modified: 2026-09-08

set -euo pipefail
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME

# ============================================================================
# Global Variables
# ============================================================================

SEARCH_TERMS=()
FILTER_STATE="all"
FILTER_LABELS=()
FILTER_TYPE=""
FILTER_ASSIGNEE=""
FILTER_MILESTONE=""
OUTPUT_FORMAT="table"
LIMIT=30
FETCH_LIMIT=200
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS] TERM [TERM...]

Keyword search across GitHub issue titles and bodies. Client-side,
case-insensitive, any-keyword matching (an issue matches if ANY term appears in
its title or body); results are ranked by number of distinct terms matched.
Complements issue-list, which does structured filtering (labels, type,
assignee) without keyword matching.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output

Scope filters (applied server-side before search):
    -s, --state STATE           Filter by state: open, closed, or all (default:
all)
    -t, --type TYPE             Filter by native issue type: Bug, Feature, Task,
 or Epic
    -l, --label LABEL           Filter by label (can be specified multiple times)
    -a, --assignee USER         Filter by assignee (use "none" for unassigned)
    -m, --milestone NAME        Filter by milestone

Output:
    -f, --format FORMAT         Output format: table, json, simple (default: tab
le)
    -n, --limit NUMBER          Limit number of results shown (default: 30)
    --fetch-limit NUMBER        Number of issues fetched for searching
                                (default: 200; raise for large repos)
    --devenv                    Safety override to search issues in devenv repo

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: curren
t repo)

Examples:

    # Find issues mentioning "session timeout" (either word matches)
    $SCRIPT_NAME session timeout

    # Duplicate check: search closed+open bugs for keywords of a new report
    $SCRIPT_NAME --state all --type Bug login failed

    # JSON output with matched terms per issue, for scripting
    $SCRIPT_NAME --format json reservation TTL

    # Search within a label
    $SCRIPT_NAME --label "area/auth" token expiry

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

# Escape a term for safe use in a jq regex (output is a jq STRING, not source).
# Retained for callers/tests; the search itself no longer uses regex — see
# search_issues (ascii_downcase + contains: substring match, no escaping).
jq_escape_regex() {
    printf '%s' "$1" | jq -Rr 'gsub("[\\\\^$.*+?()\\[\\]{}|]"; "\\\\$0")'
}

# Search issues: fetch title+body per scope filters, match any term
# case-insensitively, rank by distinct-term hit count.
# The jq program is STATIC (terms arrive via --args). Matching is substring
# (ascii_downcase + contains), not regex — metacharacters in terms (. [ ] etc.)
# are matched literally with no escaping hazards.
search_issues() {
    local gh_args=()
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"
    gh_args+=("${repo_spec[@]}")

    local filter_string
    filter_string=$(build_issue_filters --state "$FILTER_STATE" --type "$FILTER_TYPE" --limit "$FETCH_LIMIT") || exit 1
    read -ra filter_args <<< "$filter_string"
    gh_args+=("${filter_args[@]}")

    for label in "${FILTER_LABELS[@]}"; do
        gh_args+=(--label "$label")
    done
    if [ -n "$FILTER_ASSIGNEE" ]; then
        gh_args+=(--assignee "$FILTER_ASSIGNEE")
    fi
    if [ -n "$FILTER_MILESTONE" ]; then
        gh_args+=(--milestone "$FILTER_MILESTONE")
    fi

    # shellcheck disable=SC2054  # gh CLI uses comma-separated fields
    gh_args+=(--json number,title,body,state,url)

    log_verbose "Running: gh issue list ${gh_args[*]} (searching ${#SEARCH_TERMS[@]} term(s))"

    # Static jq program. Terms come in as $ARGS.positional; each is lowercased
    # and tested as a substring against the lowercased title + body (body
    # coerced from null). Matched terms are collected per issue; issues with at
    # least one hit pass through (any-keyword OR), ranked downstream by count.
    # Strip the body from output — it was fetched only for matching.
    local jq_program='
        .[]
        | . as $issue
        | [ $ARGS.positional[] as $term
            | ($issue.title + " " + ($issue.body // "")) | ascii_downcase
            | select(contains($term | ascii_downcase))
            | $term
          ] as $matched
        | select(($matched | length) > 0)
        | del(.body) + {matchedTerms: $matched, matchCount: ($matched | length)}
    '

    gh issue list "${gh_args[@]}" \
        | jq -r --args "${jq_program}" -- "${SEARCH_TERMS[@]}" \
        | jq -s --argjson limit "$LIMIT" 'sort_by(-.matchCount) | .[0:$limit]'
}

# Render results per OUTPUT_FORMAT from the ranked JSON array on stdin.
render_results() {
    case "$OUTPUT_FORMAT" in
        json)
            jq .
            ;;
        simple)
            jq -r '.[] | "#\(.number) - \(.title) [\(.matchCount) term\(if .matchCount == 1 then "" else "s" end)]"'
            ;;
        table)
            jq -r '.[] | "#\(.number)  \(.matchCount) match\(if .matchCount == 1 then "" else "es" end)  \(.state)  \(.title)  (\(.matchedTerms | join(", ")))"'
            ;;
        *)
            log_error "Invalid format: $OUTPUT_FORMAT (must be table, json, or simple)"
            exit 1
            ;;
    esac
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    # Parse command-line arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                show_usage
                ;;
            -v|--version)
                echo "$SCRIPT_VERSION"
                exit 0
                ;;
            -V|--verbose)
                VERBOSE=1
                shift
                ;;
            -s|--state)
                FILTER_STATE="$2"
                shift 2
                ;;
            -t|--type)
                FILTER_TYPE="$2"
                shift 2
                ;;
            -l|--label)
                FILTER_LABELS+=("$2")
                shift 2
                ;;
            -a|--assignee)
                FILTER_ASSIGNEE="$2"
                shift 2
                ;;
            -m|--milestone)
                FILTER_MILESTONE="$2"
                shift 2
                ;;
            -f|--format)
                OUTPUT_FORMAT="$2"
                shift 2
                ;;
            -n|--limit)
                LIMIT="$2"
                shift 2
                ;;
            --fetch-limit)
                FETCH_LIMIT="$2"
                shift 2
                ;;
            --devenv)
                # shellcheck disable=SC2034  # Used by check_target_repo
                ALLOW_DEVENV_REPO=1
                shift
                ;;
            --)
                shift
                while [[ $# -gt 0 ]]; do
                    SEARCH_TERMS+=("$1")
                    shift
                done
                ;;
            -*)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
            *)
                SEARCH_TERMS+=("$1")
                shift
                ;;
        esac
    done

    # Validate inputs
    if [ ${#SEARCH_TERMS[@]} -eq 0 ]; then
        log_error "At least one search term is required"
        echo "Use --help for usage information"
        exit 1
    fi

    # Check dependencies
    check_dependencies

    # Validate target repo
    check_target_repo

    # Ensure GitHub CLI authentication
    ensure_gh_login

    # Run the search and render
    search_issues | render_results
}

# Run main function
main "$@"
