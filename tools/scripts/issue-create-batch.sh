#!/bin/bash
# issue-create-batch.sh - Create multiple GitHub issues in one command
# Version: 1.1.0
# Description: Preview-first batch creation using repeated --issue entries or a manifest file
# Requirements: Bash 4.0+, yq, issue-create on PATH
# Author: WorkInProgress.ai
# Last Modified: 2026-07-19

set -euo pipefail
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"

readonly SCRIPT_VERSION="1.1.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME

MANIFEST_FILE=""
ISSUE_ENTRIES=()
CREATE_MODE=0
DEFAULT_PARENT=""
DEFAULT_TYPE=""
DEFAULT_MILESTONE=""
DEFAULT_PROJECT=""
DEFAULT_BODY=""
DEFAULT_BODY_FILE=""
DEFAULT_LABELS=()
DEFAULT_ASSIGNEES=()
DEFAULT_BLOCKED_BY=()
CONTINUE_ON_ERROR=0
VERBOSE=0
TEMP_DIR=""

PARSED_TITLE=""
PARSED_TYPE=""
PARSED_PARENT=""
PARSED_LABELS=""
PARSED_ASSIGNEES=""
PARSED_BLOCKED_BY=""
PARSED_MILESTONE=""
PARSED_PROJECT=""
PARSED_SIZE=""
PARSED_TARGET=""
PARSED_BODY=""
PARSED_BODY_FILE=""

BUILT_TITLE=""
BUILT_MODE=""
BUILT_CMD_ARRAY=()

show_usage() {
    cat << EOF
Usage:
        $SCRIPT_NAME --issue "TITLE" [--issue "TITLE|key=value|..."] [OPTIONS]
        $SCRIPT_NAME --file MANIFEST [OPTIONS]

Create multiple GitHub issues in one pass.

Input (choose one):
        -i, --issue ENTRY           Add issue entry (repeatable)
                                                                ENTRY format: "Title|type=Feature|parent=123|labels=a,b"
        -f, --file FILE             Path to YAML/JSON manifest (advanced mode)

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
        --create                    Create issues (default is preview only)
        -n, --dry-run               Alias for preview mode
    --continue-on-error         Continue creating remaining issues after a failure
        --type TYPE                 Default issue type
    --parent ISSUE_NUM          Default parent issue number for items missing parent
        --label LABEL               Default label (repeatable)
        --assignee USER             Default assignee (repeatable)
        --blocked-by ISSUE_NUM      Default blocker (repeatable)
        --milestone NAME            Default milestone
        --project NAME              Default project
        --body TEXT                 Default body text
        --body-file FILE            Default body file

Rules:
- Exactly one input mode: --issue entries OR --file manifest.
- Preview is the default mode. Add --create to execute.
- Each issue must resolve a type from item \`type\` or default \`--type\`.
- Command always uses non-interactive creation (--no-template).

Fast mode entry keys (optional per entry):
- type
- parent
- labels          (comma-separated)
- assignees       (comma-separated)
- blocked_by      (comma-separated)
- milestone
- project
- size
- target
- body
- body_file

Manifest schema:

issues:
    - title: "Issue title"                   # required
        type: "Feature"                        # optional if defaults.type exists
        body: |                                 # optional
      Markdown text
        body_file: "path/to/body.md"           # optional; wins over body
        labels: ["priority:high", "backend"]  # optional
        assignees: ["@me"]                     # optional
        milestone: "Sprint 5"                  # optional
        project: "Q1 2026"                     # optional
        parent: 123                             # optional
        blocked_by: [42, 55]                    # optional
        size: "M"                              # optional metadata for generated body
        target: "deliverable scope"            # optional metadata for generated body

defaults:                                   # optional
    type: "Task"
    parent: 1
    labels: ["area:example"]
    assignees: ["@me"]
    blocked_by: [7]
    milestone: "Sprint 5"
    project: "Q3 2026"
    body: "Default body"
    body_file: "path/to/default-body.md"

Examples:
        $SCRIPT_NAME --issue "Feature A" --type Feature
        $SCRIPT_NAME --issue "A|size=M|target=Scope text" --issue "B|type=Task|labels=ops" --parent 1
        $SCRIPT_NAME --file issues.yaml --create

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

cleanup() {
    if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
    fi
}
trap cleanup EXIT

check_dependencies() {
    if ! command -v yq >/dev/null 2>&1; then
        log_error "yq is required but not installed"
        exit 1
    fi

    if ! command -v issue-create >/dev/null 2>&1; then
        log_error "issue-create is required but not found in PATH"
        exit 1
    fi
}

validate_inputs() {
    if [ -n "$MANIFEST_FILE" ] && [ "${#ISSUE_ENTRIES[@]}" -gt 0 ]; then
        log_error "Use either --file or --issue, not both"
        exit 1
    fi

    if [ -z "$MANIFEST_FILE" ] && [ "${#ISSUE_ENTRIES[@]}" -eq 0 ]; then
        log_error "Provide input via --issue (repeatable) or --file"
        exit 1
    fi

    if [ -n "$DEFAULT_BODY_FILE" ] && [ ! -f "$DEFAULT_BODY_FILE" ]; then
        log_error "Default body file not found: $DEFAULT_BODY_FILE"
        exit 1
    fi
}

validate_manifest() {
    if [ -z "$MANIFEST_FILE" ]; then
        return 0
    fi

    if [ ! -f "$MANIFEST_FILE" ]; then
        log_error "Manifest file not found: $MANIFEST_FILE"
        exit 1
    fi

    local count
    count=$(yq eval '.issues | length' "$MANIFEST_FILE" 2>/dev/null) || {
        log_error "Invalid manifest format: expected top-level 'issues' array"
        exit 1
    }

    if [ "$count" = "0" ]; then
        log_error "Manifest has no issues to create"
        exit 1
    fi

    if ! [[ "$count" =~ ^[0-9]+$ ]]; then
        log_error "Invalid issues count in manifest"
        exit 1
    fi
}

trim_ws() {
    local text="$1"
    text="${text#"${text%%[![:space:]]*}"}"
    text="${text%"${text##*[![:space:]]}"}"
    printf '%s' "$text"
}

split_csv_to_array() {
    local raw="$1"
    local -n out_ref="$2"
    local idx
    IFS=',' read -r -a out_ref <<< "$raw"
    for idx in "${!out_ref[@]}"; do
        out_ref[idx]="$(trim_ws "${out_ref[idx]}")"
    done
}

build_generated_body() {
    local title="$1"
    local size="$2"
    local target="$3"
    {
        echo "## Context"
        echo "Batch-generated issue for: $title"
        if [ -n "$target" ]; then
            echo
            echo "## Scope"
            echo "$target"
        fi
        if [ -n "$size" ]; then
            echo
            echo "## Size"
            echo "$size"
        fi
    }
}

parse_fast_issue() {
    local entry="$1"
    local -a segments=()

    PARSED_TITLE=""
    PARSED_TYPE=""
    PARSED_PARENT=""
    PARSED_LABELS=""
    PARSED_ASSIGNEES=""
    PARSED_BLOCKED_BY=""
    PARSED_MILESTONE=""
    PARSED_PROJECT=""
    PARSED_SIZE=""
    PARSED_TARGET=""
    PARSED_BODY=""
    PARSED_BODY_FILE=""

    IFS='|' read -r -a segments <<< "$entry"
    PARSED_TITLE="$(trim_ws "${segments[0]:-}")"

    local idx
    for ((idx=1; idx<${#segments[@]}; idx++)); do
        local pair
        local key
        local value
        pair="${segments[$idx]}"
        key="${pair%%=*}"
        value="${pair#*=}"
        key="$(trim_ws "$key")"
        value="$(trim_ws "$value")"
        case "$key" in
            type) PARSED_TYPE="$value" ;;
            parent) PARSED_PARENT="$value" ;;
            labels) PARSED_LABELS="$value" ;;
            assignees) PARSED_ASSIGNEES="$value" ;;
            blocked_by) PARSED_BLOCKED_BY="$value" ;;
            milestone) PARSED_MILESTONE="$value" ;;
            project) PARSED_PROJECT="$value" ;;
            size) PARSED_SIZE="$value" ;;
            target) PARSED_TARGET="$value" ;;
            body) PARSED_BODY="$value" ;;
            body_file) PARSED_BODY_FILE="$value" ;;
            "")
                ;;
            *)
                log_error "Unsupported key in --issue entry: $key"
                return 1
                ;;
        esac
    done

    if [ -z "$PARSED_TITLE" ]; then
        log_error "--issue entry must include a title"
        return 1
    fi
}

resolve_manifest_default() {
    local key="$1"
    yq eval ".defaults.$key // \"\"" "$MANIFEST_FILE"
}

resolve_manifest_array_csv() {
    local key="$1"
    yq eval ".defaults.$key // [] | join(\",\")" "$MANIFEST_FILE"
}

resolve_issue_field() {
    local index="$1"
    local field="$2"
    yq eval ".issues[$index].$field // \"\"" "$MANIFEST_FILE"
}

resolve_issue_array_csv() {
    local index="$1"
    local field="$2"
    yq eval ".issues[$index].$field // [] | join(\",\")" "$MANIFEST_FILE"
}

build_issue_command_for_manifest() {
    local index="$1"

    BUILT_MODE="manifest"
    BUILT_TITLE="$(resolve_issue_field "$index" "title")"
    local type
    type="$(resolve_issue_field "$index" "type")"
    if [ -z "$type" ]; then
        type="$(resolve_manifest_default "type")"
    fi
    if [ -z "$type" ]; then
        type="$DEFAULT_TYPE"
    fi
    if [ -z "$type" ]; then
        log_error "Issue[$index] missing type (item, manifest defaults, or --type)"
        return 1
    fi

    local parent
    local milestone
    local project
    local body
    local body_file
    local size
    local target
    local labels_csv
    local assignees_csv
    local blocked_csv

    parent="$(resolve_issue_field "$index" "parent")"
    milestone="$(resolve_issue_field "$index" "milestone")"
    project="$(resolve_issue_field "$index" "project")"
    body="$(resolve_issue_field "$index" "body")"
    body_file="$(resolve_issue_field "$index" "body_file")"
    size="$(resolve_issue_field "$index" "size")"
    target="$(resolve_issue_field "$index" "target")"
    labels_csv="$(resolve_issue_array_csv "$index" "labels")"
    assignees_csv="$(resolve_issue_array_csv "$index" "assignees")"
    blocked_csv="$(resolve_issue_array_csv "$index" "blocked_by")"

    if [ -z "$parent" ]; then
        parent="$(resolve_manifest_default "parent")"
    fi
    if [ -z "$parent" ]; then
        parent="$DEFAULT_PARENT"
    fi

    if [ -z "$milestone" ]; then
        milestone="$(resolve_manifest_default "milestone")"
    fi
    if [ -z "$milestone" ]; then
        milestone="$DEFAULT_MILESTONE"
    fi

    if [ -z "$project" ]; then
        project="$(resolve_manifest_default "project")"
    fi
    if [ -z "$project" ]; then
        project="$DEFAULT_PROJECT"
    fi

    if [ -z "$body" ]; then
        body="$(resolve_manifest_default "body")"
    fi
    if [ -z "$body" ]; then
        body="$DEFAULT_BODY"
    fi

    if [ -z "$body_file" ]; then
        body_file="$(resolve_manifest_default "body_file")"
    fi
    if [ -z "$body_file" ]; then
        body_file="$DEFAULT_BODY_FILE"
    fi

    if [ -z "$labels_csv" ]; then
        labels_csv="$(resolve_manifest_array_csv "labels")"
    fi
    if [ -z "$assignees_csv" ]; then
        assignees_csv="$(resolve_manifest_array_csv "assignees")"
    fi
    if [ -z "$blocked_csv" ]; then
        blocked_csv="$(resolve_manifest_array_csv "blocked_by")"
    fi

    if [ -z "$labels_csv" ] && [ "${#DEFAULT_LABELS[@]}" -gt 0 ]; then
        labels_csv="$(IFS=','; echo "${DEFAULT_LABELS[*]}")"
    fi
    if [ -z "$assignees_csv" ] && [ "${#DEFAULT_ASSIGNEES[@]}" -gt 0 ]; then
        assignees_csv="$(IFS=','; echo "${DEFAULT_ASSIGNEES[*]}")"
    fi
    if [ -z "$blocked_csv" ] && [ "${#DEFAULT_BLOCKED_BY[@]}" -gt 0 ]; then
        blocked_csv="$(IFS=','; echo "${DEFAULT_BLOCKED_BY[*]}")"
    fi

    if [ -z "$BUILT_TITLE" ]; then
        log_error "Issue[$index] missing title"
        return 1
    fi

    local final_body_file="$body_file"
    if [ -n "$final_body_file" ] && [ ! -f "$final_body_file" ]; then
        log_error "Issue[$index] body_file not found: $final_body_file"
        return 1
    fi

    if [ -z "$final_body_file" ]; then
        final_body_file="$TEMP_DIR/issue-$index-body.md"
        if [ -n "$body" ]; then
            printf "%s\n" "$body" > "$final_body_file"
        else
            build_generated_body "$BUILT_TITLE" "$size" "$target" > "$final_body_file"
        fi
    fi

    BUILT_CMD_ARRAY=(issue-create --title "$BUILT_TITLE" --type "$type" --body-file "$final_body_file" --no-template)
    if [ -n "$parent" ]; then
        BUILT_CMD_ARRAY+=(--parent "$parent")
    fi
    if [ -n "$milestone" ]; then
        BUILT_CMD_ARRAY+=(--milestone "$milestone")
    fi
    if [ -n "$project" ]; then
        BUILT_CMD_ARRAY+=(--project "$project")
    fi
    local -a csv_parts=()
    local part
    split_csv_to_array "$labels_csv" csv_parts
    for part in "${csv_parts[@]}"; do
        if [ -n "$part" ]; then
            BUILT_CMD_ARRAY+=(--label "$part")
        fi
    done
    csv_parts=()
    split_csv_to_array "$assignees_csv" csv_parts
    for part in "${csv_parts[@]}"; do
        if [ -n "$part" ]; then
            BUILT_CMD_ARRAY+=(--assignee "$part")
        fi
    done
    csv_parts=()
    split_csv_to_array "$blocked_csv" csv_parts
    for part in "${csv_parts[@]}"; do
        if [ -n "$part" ]; then
            BUILT_CMD_ARRAY+=(--blocked-by "$part")
        fi
    done
}

build_issue_command_for_fast() {
    local index="$1"

    BUILT_MODE="fast"
    parse_fast_issue "${ISSUE_ENTRIES[$index]}" || return 1
    BUILT_TITLE="$PARSED_TITLE"

    local type="${PARSED_TYPE:-$DEFAULT_TYPE}"
    if [ -z "$type" ]; then
        log_error "Issue[$index] missing type (entry type=... or --type)"
        return 1
    fi

    local parent="${PARSED_PARENT:-$DEFAULT_PARENT}"
    local milestone="${PARSED_MILESTONE:-$DEFAULT_MILESTONE}"
    local project="${PARSED_PROJECT:-$DEFAULT_PROJECT}"
    local size="${PARSED_SIZE:-}"
    local target="${PARSED_TARGET:-}"
    local body="${PARSED_BODY:-$DEFAULT_BODY}"
    local body_file="${PARSED_BODY_FILE:-$DEFAULT_BODY_FILE}"
    local labels_csv="${PARSED_LABELS:-}"
    local assignees_csv="${PARSED_ASSIGNEES:-}"
    local blocked_csv="${PARSED_BLOCKED_BY:-}"

    if [ -z "$labels_csv" ] && [ "${#DEFAULT_LABELS[@]}" -gt 0 ]; then
        labels_csv="$(IFS=','; echo "${DEFAULT_LABELS[*]}")"
    fi
    if [ -z "$assignees_csv" ] && [ "${#DEFAULT_ASSIGNEES[@]}" -gt 0 ]; then
        assignees_csv="$(IFS=','; echo "${DEFAULT_ASSIGNEES[*]}")"
    fi
    if [ -z "$blocked_csv" ] && [ "${#DEFAULT_BLOCKED_BY[@]}" -gt 0 ]; then
        blocked_csv="$(IFS=','; echo "${DEFAULT_BLOCKED_BY[*]}")"
    fi

    local final_body_file="$body_file"
    if [ -n "$final_body_file" ] && [ ! -f "$final_body_file" ]; then
        log_error "Issue[$index] body_file not found: $final_body_file"
        return 1
    fi
    if [ -z "$final_body_file" ]; then
        final_body_file="$TEMP_DIR/issue-$index-body.md"
        if [ -n "$body" ]; then
            printf "%s\n" "$body" > "$final_body_file"
        else
            build_generated_body "$BUILT_TITLE" "$size" "$target" > "$final_body_file"
        fi
    fi

    BUILT_CMD_ARRAY=(issue-create --title "$BUILT_TITLE" --type "$type" --body-file "$final_body_file" --no-template)
    if [ -n "$parent" ]; then
        BUILT_CMD_ARRAY+=(--parent "$parent")
    fi
    if [ -n "$milestone" ]; then
        BUILT_CMD_ARRAY+=(--milestone "$milestone")
    fi
    if [ -n "$project" ]; then
        BUILT_CMD_ARRAY+=(--project "$project")
    fi
    local -a csv_parts=()
    local part
    split_csv_to_array "$labels_csv" csv_parts
    for part in "${csv_parts[@]}"; do
        if [ -n "$part" ]; then
            BUILT_CMD_ARRAY+=(--label "$part")
        fi
    done
    csv_parts=()
    split_csv_to_array "$assignees_csv" csv_parts
    for part in "${csv_parts[@]}"; do
        if [ -n "$part" ]; then
            BUILT_CMD_ARRAY+=(--assignee "$part")
        fi
    done
    csv_parts=()
    split_csv_to_array "$blocked_csv" csv_parts
    for part in "${csv_parts[@]}"; do
        if [ -n "$part" ]; then
            BUILT_CMD_ARRAY+=(--blocked-by "$part")
        fi
    done
}

get_issue_count() {
    if [ -n "$MANIFEST_FILE" ]; then
        yq eval '.issues | length' "$MANIFEST_FILE"
    else
        echo "${#ISSUE_ENTRIES[@]}"
    fi
}

preview_batch() {
    local count
    count=$(get_issue_count)
    local index

    echo "index|mode|title|command"
    for ((index=0; index<count; index++)); do
        if [ -n "$MANIFEST_FILE" ]; then
            build_issue_command_for_manifest "$index" || return 1
        else
            build_issue_command_for_fast "$index" || return 1
        fi
        echo "$index|$BUILT_MODE|$BUILT_TITLE|${BUILT_CMD_ARRAY[*]}"
    done
}

create_batch() {
    local count
    count=$(get_issue_count)
    local created=0
    local failed=0
    local index

    echo "index|issue_number|title|url"
    for ((index=0; index<count; index++)); do
        if [ -n "$MANIFEST_FILE" ]; then
            build_issue_command_for_manifest "$index" || {
                failed=$((failed + 1))
                if [ "$CONTINUE_ON_ERROR" -eq 1 ]; then
                    continue
                fi
                return 1
            }
        else
            build_issue_command_for_fast "$index" || {
                failed=$((failed + 1))
                if [ "$CONTINUE_ON_ERROR" -eq 1 ]; then
                    continue
                fi
                return 1
            }
        fi
        :

        log_verbose "Creating issue[$index] from $BUILT_MODE mode: $BUILT_TITLE"
        local output
        if ! output=$("${BUILT_CMD_ARRAY[@]}" 2>&1); then
            log_error "Issue[$index] failed: $BUILT_TITLE"
            echo "$output" >&2
            failed=$((failed + 1))
            if [ "$CONTINUE_ON_ERROR" -eq 1 ]; then
                continue
            fi
            return 1
        fi

        local issue_url
        local issue_number
        issue_url=$(echo "$output" | grep -Eo 'https://github.com/[^[:space:]]+/issues/[0-9]+' | tail -1 || true)
        issue_number=$(echo "$issue_url" | grep -Eo '[0-9]+$' || true)
        if [ -z "$issue_url" ] || [ -z "$issue_number" ]; then
            log_error "Issue[$index] created but could not parse URL/number"
            echo "$output"
            failed=$((failed + 1))
            if [ "$CONTINUE_ON_ERROR" -eq 1 ]; then
                continue
            fi
            return 1
        fi

        echo "$index|$issue_number|$BUILT_TITLE|$issue_url"
        created=$((created + 1))
    done

    log_info "Batch complete: created=$created failed=$failed"
    if [ "$failed" -gt 0 ]; then
        return 1
    fi
}

main() {
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
            --create)
                CREATE_MODE=1
                shift
                ;;
            -n|--dry-run)
                CREATE_MODE=0
                shift
                ;;
            --continue-on-error)
                CONTINUE_ON_ERROR=1
                shift
                ;;
            --type)
                DEFAULT_TYPE="$2"
                shift 2
                ;;
            --parent)
                DEFAULT_PARENT="$2"
                shift 2
                ;;
            --label)
                DEFAULT_LABELS+=("$2")
                shift 2
                ;;
            --assignee)
                DEFAULT_ASSIGNEES+=("$2")
                shift 2
                ;;
            --blocked-by)
                DEFAULT_BLOCKED_BY+=("$2")
                shift 2
                ;;
            --milestone)
                DEFAULT_MILESTONE="$2"
                shift 2
                ;;
            --project)
                DEFAULT_PROJECT="$2"
                shift 2
                ;;
            --body)
                DEFAULT_BODY="$2"
                shift 2
                ;;
            --body-file)
                DEFAULT_BODY_FILE="$2"
                shift 2
                ;;
            -f|--file)
                MANIFEST_FILE="$2"
                shift 2
                ;;
            -i|--issue)
                ISSUE_ENTRIES+=("$2")
                shift 2
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done

    check_dependencies
    validate_inputs
    validate_manifest

    TEMP_DIR=$(mktemp -d /tmp/issue-create-batch.XXXXXX)

    if [ "$CREATE_MODE" -eq 1 ]; then
        create_batch
    else
        preview_batch
    fi
}

main "$@"
