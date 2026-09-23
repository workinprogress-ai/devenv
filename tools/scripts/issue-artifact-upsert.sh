#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# issue-artifact-upsert.sh - Deterministically create/update an issue comment by doc_id
# Version: 1.1.0
# Description: Upserts an issue comment by matching the exact metadata line
#              "doc_id: <doc_id>" within the first 256 characters.
# Concurrency: single-writer per doc_id is assumed. The fetch-match-update
#              sequence is not atomic; two concurrent upserts with the same
#              doc_id can both POST and leave duplicate comments (reported as
#              a conflict on the next run). Do not run concurrent upserts of
#              the same artifact.
# Requirements: Bash 4.0+, gh CLI, jq

set -euo pipefail
# shellcheck disable=SC2034  # VERBOSE is written here; read by log_verbose in error-handling.bash

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/provider-loader.bash"
source "$DEVENV_TOOLS/lib/artifact-header.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"
source "$DEVENV_TOOLS/lib/fzf-selection.bash"
source "$DEVENV_TOOLS/lib/body-source.bash"

readonly SCRIPT_VERSION="1.2.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Deterministically upsert a GitHub issue comment by doc_id"

ISSUE_NUMBER=""
COMMENT_BODY=""
COMMENT_FILE=""
REPO_OVERRIDE=""
DRY_RUN=0
NO_STAMP=0
ALL_FILES=0
# shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
VERBOSE=0

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

Create or update a GitHub issue comment by stable doc_id marker.

Issue Target:
    --issue, --issue-number N     Issue number override (optional if body contains issue_number metadata or a doc_id with issue-<N>)

Comment Source (exactly one required unless stdin is piped or a TTY):
    -b, --body TEXT               Comment body text
    -f, --body-file FILE          Read comment body from file (doc_id extracted
                                  from DEVENV_ARTIFACT_V1 header); '-' reads stdin
    (no source flag)              Body read from piped stdin automatically; with
                                  a TTY, an interactive picker over .local-artifacts
                                  is offered (requires fzf)

Options:
    -n, --dry-run                 Resolve intended action without writing
    --no-stamp                    Do not rewrite updated_at_utc (byte-exact republish)
    --all                         Interactive list includes tmp*.md (default: excluded)
    --repo OWNER/REPO             Repository override (defaults to GITHUB_REPO)
    -V, --verbose                 Enable verbose logs
    -h, --help                    Show this help and exit
    -v, --version                 Show version and exit

Behavior:
    1) Read comment body from --body or --body-file
    2) Stamp updated_at_utc to the current UTC time inside the DEVENV_ARTIFACT_V1
       block (unless --no-stamp; no-op when the block has no such line)
    3) Resolve issue number from --issue, "issue_number: <N>" in the body header, or a doc_id containing issue-<N>
    3) Extract doc_id from "doc_id: <ID>" line in first 256 characters
    4) Search all issue comments for matching doc_id in first 256 characters
    5) 1 match   -> update comment
    6) 0 matches -> create new comment
    7) >1 match  -> conflict (exit "$EXIT_CONFLICT")

Output JSON:
    Success: {"action":"created|updated","issue_number":N,"comment_id":ID,"comment_url":"..."}
    Conflict: {"action":"conflict","issue_number":N,"matches":[ID, ...]}

Exit Codes:
    0 success (created/updated)
    2 invalid arguments
    3 duplicate doc_id conflict
    4 API/tool failure

Examples:
    $SCRIPT_NAME --body-file artifact.md
    $SCRIPT_NAME --issue 42 --body-file artifact.md
    $SCRIPT_NAME --issue 42 --body-file - < artifact.md
    cat artifact.md | $SCRIPT_NAME
    $SCRIPT_NAME                          # interactive picker over .local-artifacts
    $SCRIPT_NAME --all                    # picker including tmp*.md
    $SCRIPT_NAME --issue-number 56 --body "doc_id: dv1:...\n..." --dry-run
EOF
    exit 0
}

load_comment_body() {
    if [ -n "$COMMENT_FILE" ]; then
        if [ "$COMMENT_FILE" = "-" ]; then
            if body_source_stdin_is_tty; then
                invalid_args "--body-file - requires piped stdin (refusing to read the terminal)"
            fi
            cat
            return
        fi
        if [ ! -f "$COMMENT_FILE" ]; then
            invalid_args "File not found: $COMMENT_FILE"
        fi
        cat "$COMMENT_FILE"
        return
    fi

    echo "$COMMENT_BODY"
}

# Resolve .local-artifacts/ against the git repo root of the cwd (decision D2),
# falling back to ./.local-artifacts outside a repository.
resolve_local_artifacts_dir() {
    local root
    root=$(git rev-parse --show-toplevel 2>/dev/null || true)
    if [ -n "$root" ]; then
        printf '%s/.local-artifacts' "$root"
    else
        printf '%s/.local-artifacts' "$PWD"
    fi
}

# Interactive picker over .local-artifacts/*.md (decision D1: TTY-only).
# tmp*.md are excluded by default (ephemeral per the artifact convention);
# --all removes the exclusion.
interactive_pick_artifact() {
    local dir
    dir=$(resolve_local_artifacts_dir)
    if [ ! -d "$dir" ]; then
        log_error "No .local-artifacts directory found at $dir"
        return 1
    fi

    local files=""
    local f base
    while IFS= read -r f; do
        base=$(basename "$f")
        if [ "$ALL_FILES" -eq 0 ] && [[ "$base" == tmp*.md ]]; then
            continue
        fi
        files+="${base}"$'\n'
    done < <(find "$dir" -maxdepth 1 -name '*.md' -type f | sort)

    if [ -z "$files" ]; then
        log_error "No eligible markdown files in $dir (use --all to include tmp*.md)"
        return 1
    fi

    check_fzf_installed || return 1
    local picked
    picked=$(fzf_select_single "$files" "Upsert which artifact? ") || return 1
    printf '%s/%s' "$dir" "$picked"
}

infer_issue_number_from_doc_id() {
    local doc_id="$1"
    local inferred=""

    if [ -n "$doc_id" ]; then
        inferred=$(printf '%s
' "$doc_id" | sed -nE 's/.*issue[-_:]([0-9]+).*/\1/p' | head -1)
    fi

    if [ -n "$inferred" ] && validate_issue_number "$inferred"; then
        echo "$inferred"
        return 0
    fi

    return 1
}

main() {
    # Zero arguments is valid: interactive mode (fzf picker over
    # .local-artifacts) or piped stdin. Missing-argument errors are raised
    # later, by the source-resolution block, only when no body source and no
    # interactive terminal are available.

    # Global flags before auth/validation: --help must work without
    # a valid GitHub session or any positional args.
    if handle_global_flag "${1:-}"; then
        exit 0
    fi

    ensure_gh_login

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
                # shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
                VERBOSE=1
                shift
                ;;
            -n|--dry-run)
                DRY_RUN=1
                shift
                ;;
            --no-stamp)
                NO_STAMP=1
                shift
                ;;
            --all)
                ALL_FILES=1
                shift
                ;;
            --issue|--issue-number|--issue_number)
                require_option_value "$1" "${2:-}"
                ISSUE_NUMBER="${2:-}"
                shift 2
                ;;
            -b|--body)
                require_option_value "$1" "${2:-}"
                COMMENT_BODY="${2:-}"
                shift 2
                ;;
            -f|--body-file|--body_file)
                require_option_value "$1" "${2:-}"
                COMMENT_FILE="${2:-}"
                shift 2
                ;;
            --repo)
                require_option_value "$1" "${2:-}"
                REPO_OVERRIDE="${2:-}"
                shift 2
                ;;
            *)
                invalid_args "Unknown option: $1"
                ;;
        esac
    done

    local sources=0
    [ -n "$COMMENT_BODY" ] && sources=$((sources + 1))
    [ -n "$COMMENT_FILE" ] && sources=$((sources + 1))

    if [ "$sources" -gt 1 ]; then
        invalid_args "Only one of --body or --body-file may be specified"
    fi

    if [ "$sources" -eq 0 ]; then
        # No explicit source: piped stdin auto-reads (D1); a TTY offers the
        # interactive picker; anything else is the normal argument error.
        if ! body_source_stdin_is_tty; then
            # Resolve through the shared contract: empty/closed stdin is a
            # hard error ("Refusing empty stdin body"), never an empty body.
            local resolved
            if ! resolved=$(body_source_resolve "" ""); then
                echo "Use --help for usage information"
                exit "$EXIT_MISUSE"
            fi
            COMMENT_BODY="$resolved"
            log_verbose "No source flag; body read from piped stdin"
        else
            local picked
            if picked=$(interactive_pick_artifact); then
                COMMENT_FILE="$picked"
                log_verbose "Interactive selection: $COMMENT_FILE"
            else
                invalid_args "One comment source is required: --body or --body-file"
            fi
        fi
    fi

    # Single repo-resolution entry point (override > GITHUB_REPO > cwd),
    # devenv-repo safety gate included; the printed value feeds the provider
    # calls below explicitly.
    TARGET_REPO="$(resolve_target_repo "$REPO_OVERRIDE")"

    local body
    body="$(load_comment_body)"

    # Deterministic timestamp stamping: rewrite updated_at_utc inside the
    # DEVENV_ARTIFACT_V1 block before publishing (skip with --no-stamp).
    if [ "$NO_STAMP" -eq 0 ]; then
        local now_utc
        now_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
        local stamped
        stamped=$(printf '%s\n' "$body" | awk -v ts="$now_utc" '
            BEGIN { inblock = 0; stamped = 0 }
            /DEVENV_ARTIFACT_V1/ { inblock = 1; print; next }
            inblock && /^-->/ {
                if (!stamped) print "updated_at_utc: " ts
                print; inblock = 0; next
            }
            inblock && /^[[:space:]]*updated_at_utc[[:space:]]*:/ {
                line = $0
                indent = line
                sub(/[^[:space:]].*$/, "", indent)
                print indent "updated_at_utc: " ts
                stamped = 1
                next
            }
            { print }
        ')
        if [ -n "$stamped" ]; then
            body="$stamped"
            log_verbose "Stamped updated_at_utc: $now_utc"
        fi
    fi

    # Extract header metadata from body prefix (first 256 chars)
    local body_prefix
    body_prefix="${body:0:256}"

    local header_issue_number=""
    header_issue_number=$(artifact_header_field "$body_prefix" "issue_number")

    if [ -n "$header_issue_number" ]; then
        if [ "$header_issue_number" = "none" ]; then
            header_issue_number=""
        elif ! validate_issue_number "$header_issue_number"; then
            exit "$EXIT_MISUSE"
        fi
    fi

    if [ -n "$ISSUE_NUMBER" ] && ! validate_issue_number "$ISSUE_NUMBER"; then
        exit "$EXIT_MISUSE"
    fi

    local doc_id
    doc_id=$(artifact_header_field "$body_prefix" "doc_id")
    local inferred_issue_number=""

    if [ -n "$doc_id" ]; then
        if inferred_issue_number=$(infer_issue_number_from_doc_id "$doc_id"); then
            log_verbose "Resolved issue number from doc_id: $inferred_issue_number"
        fi
    fi

    if [ -z "$ISSUE_NUMBER" ] && [ -n "$header_issue_number" ]; then
        ISSUE_NUMBER="$header_issue_number"
        log_verbose "Resolved issue number from body header: $ISSUE_NUMBER"
    fi

    if [ -z "$ISSUE_NUMBER" ] && [ -n "$inferred_issue_number" ]; then
        ISSUE_NUMBER="$inferred_issue_number"
    fi

    if [ -n "$ISSUE_NUMBER" ] && [ -n "$header_issue_number" ] && [ "$ISSUE_NUMBER" != "$header_issue_number" ]; then
        invalid_args "Issue number mismatch: --issue $ISSUE_NUMBER does not match body metadata issue_number: $header_issue_number"
    fi

    if [ -n "$ISSUE_NUMBER" ] && [ -n "$inferred_issue_number" ] && [ "$ISSUE_NUMBER" != "$inferred_issue_number" ]; then
        invalid_args "Issue number mismatch: --issue $ISSUE_NUMBER does not match doc_id issue-<N>: $inferred_issue_number"
    fi

    if [ -z "$ISSUE_NUMBER" ]; then
        invalid_args "issue_number is required via --issue, body metadata line 'issue_number: <N>', or a doc_id containing issue-<N>"
    fi

    if [ -z "$doc_id" ]; then
        invalid_args "Comment body must include 'doc_id: <value>' in first 256 characters"
    fi
    log_verbose "Extracted doc_id from body: $doc_id"

    if [[ "$doc_id" == *$'\n'* ]]; then
        invalid_args "doc_id must be a single line"
    fi

    if [ "$(artifact_header_field "$body_prefix" "doc_id")" != "$doc_id" ]; then
        invalid_args "doc_id metadata line must appear within first 256 characters"
    fi

    log_verbose "Fetching comments for issue #$ISSUE_NUMBER"
    local comments_raw
    if ! comments_raw=$(provider_issues_comments "$ISSUE_NUMBER" "$TARGET_REPO" 2>/dev/null); then
        api_failure "Failed to fetch comments for issue #$ISSUE_NUMBER"
    fi

    local matches
        if ! matches=$(echo "$comments_raw" | jq --arg doc_id "$doc_id" '
        [ .[]
                    | select(((.body // "")[0:256] | split("\n")
                            | any((select(test("^[[:space:]]*doc_id:[[:space:]]*"))
                                        | sub("^[[:space:]]*doc_id:[[:space:]]*"; "")
                                        | sub("[[:space:]]+$"; "")) == $doc_id)))
          | {id: .id, url: .html_url}
        ]
    ' 2>/dev/null); then
        api_failure "Failed to parse issue comments"
    fi

    local match_count
    match_count=$(echo "$matches" | jq 'length')

    if [ "$match_count" -gt 1 ]; then
        local conflict_ids
        conflict_ids=$(echo "$matches" | jq '[.[].id]')
        jq -n \
            --arg action "conflict" \
            --argjson issue_number "$ISSUE_NUMBER" \
            --argjson matches "$conflict_ids" \
            '{action: $action, issue_number: $issue_number, matches: $matches}'
        exit "$EXIT_CONFLICT"
    fi

    if [ "$match_count" -eq 1 ]; then
        local comment_id
        local comment_url
        comment_id=$(echo "$matches" | jq '.[0].id') || api_failure "Failed to extract comment id"
        comment_url=$(echo "$matches" | jq -r '.[0].url') || api_failure "Failed to extract comment url"

        if [ "$DRY_RUN" -eq 1 ]; then
            jq -n \
                --arg action "updated" \
                --argjson issue_number "$ISSUE_NUMBER" \
                --argjson comment_id "$comment_id" \
                --arg comment_url "$comment_url" \
                '{action: $action, issue_number: $issue_number, comment_id: $comment_id, comment_url: $comment_url}'
            exit 0
        fi

        log_verbose "Updating comment ID $comment_id"
        local updated
        if ! updated=$(provider_api PATCH "repos/${TARGET_REPO}/issues/comments/${comment_id}" \
            -f "body=${body}" 2>/dev/null); then
            api_failure "Failed to update comment ID $comment_id"
        fi

        local out_id
        local out_url
        out_id=$(echo "$updated" | jq '.id') || api_failure "Failed to extract updated comment id"
        out_url=$(echo "$updated" | jq -r '.html_url') || api_failure "Failed to extract updated comment url"

        jq -n \
            --arg action "updated" \
            --argjson issue_number "$ISSUE_NUMBER" \
            --argjson comment_id "$out_id" \
            --arg comment_url "$out_url" \
            '{action: $action, issue_number: $issue_number, comment_id: $comment_id, comment_url: $comment_url}'
        exit 0
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
        jq -n \
            --arg action "created" \
            --argjson issue_number "$ISSUE_NUMBER" \
            '{action: $action, issue_number: $issue_number}'
        exit 0
    fi

    log_verbose "Creating new comment on issue #$ISSUE_NUMBER"
    local created
    if ! created=$(provider_api POST "repos/${TARGET_REPO}/issues/${ISSUE_NUMBER}/comments" \
        -f "body=${body}" 2>/dev/null); then
        api_failure "Failed to create issue comment on issue #$ISSUE_NUMBER"
    fi

    local created_id
    local created_url
    created_id=$(echo "$created" | jq '.id') || api_failure "Failed to extract created comment id"
    created_url=$(echo "$created" | jq -r '.html_url') || api_failure "Failed to extract created comment url"

    jq -n \
        --arg action "created" \
        --argjson issue_number "$ISSUE_NUMBER" \
        --argjson comment_id "$created_id" \
        --arg comment_url "$created_url" \
        '{action: $action, issue_number: $issue_number, comment_id: $comment_id, comment_url: $comment_url}'
}

main "$@"
