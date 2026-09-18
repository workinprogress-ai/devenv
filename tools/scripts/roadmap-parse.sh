#!/bin/bash
set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# roadmap-parse.sh - Parse a roadmap artifact into per-step truth JSON
# Version: 1.0.0
# Description: Given a roadmap markdown file (the doc_id-addressed artifact
#              pulled to a scratch copy), emit per-STEP JSON: issues (canonical
#              org/repo#N), status, plan progress annotation, dependencies.
#              Status precedence: closed-via-merge all -> done; any blocked ->
#              paused; any open with PR or plan pct > 0 -> in-progress; else
#              not-started; all closed-without-merge -> cancelled. Plan data is
#              supplied via --plan-file (repeats) or --plan-dir and is matched
#              to steps by STEP-NN backlink in the plan header.
# Requirements: Bash 4.0+, awk, jq
# Last Modified: 2026-09-13

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"

# shellcheck source=../lib/error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"

# shellcheck source=../lib/versioning.bash
source "$DEVENV_TOOLS/lib/versioning.bash"

enable_strict_mode

script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Parse roadmap artifact into per-step JSON"

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME ROADMAP_FILE [--plan-dir DIR] [--plan-file FILE]...

Emit per-STEP JSON for a roadmap markdown file. Each step object contains:
  step, phase, title, status, issues[], progress {done,total,pct}|null,
  dependencies[], plan_file (when plan data matched)

Status precedence (first match wins):
  1. all linked issues closed via merge  -> done
  2. any linked issue blocked/paused     -> paused
  3. any open with PR or plan pct > 0    -> in-progress
  4. else                                -> not-started
  5. all closed without merge            -> cancelled

Options:
    --plan-dir DIR    Directory of plan files (.local-artifacts) scanned for
                      STEP-NN backlinks in their headers
    --plan-file FILE  Specific plan file to match (repeatable)
    -h, --help        Show this help message
    -v, --version     Show version and exit

Exit codes:
    0 parsed OK
    1 invalid arguments / unreadable roadmap
EOF
    exit 0
}

# ---------------------------------------------------------------------------
# Extraction helpers (awk-based; the roadmap format is defined in
# copilot/skills/devenv-create-roadmap/references/roadmap-template.md)
# ---------------------------------------------------------------------------

# Emit "STEP-NN<TAB>phase<TAB>title" for each step heading in order.
list_steps() {
    local file="$1" phase=""
    # index()/substr-based heading detection (regex anchoring mis-evaluates in
    # this awk build — verified 2026-09-13)
    awk '
        index($0, "### PHASE-") == 1 {
            phase = substr($0, 5); sub(/:.*$/, "", phase)
        }
        index($0, "### STEP-") == 1 {
            step = substr($0, 5); sub(/:.*/, "", step)
            title = $0
            sub(/^### STEP-[0-9]+: */, "", title)
            printf "%s\t%s\t%s\n", step, phase, title
        }
    ' "$file"
}

# Emit the raw body lines of STEP-NN's section (up to next ### or ---).
step_body() {
    local file="$1" step="$2"
    awk -v want="$step" '
        $0 ~ "^### " want ":" { inblock=1; next }
        /^### / || /^---$/   { if (inblock) exit }
        inblock { print }
    ' "$file"
}

# Extract an Issues line's canonical refs from step body on stdin.
# Accepts bare #N (normalizes with default_org) and org/repo#N; one per line.
extract_issues() {
    local default_org="$1" default_repo="${2:-}"
    # Accepts: org/repo#N (canonical), repo#N (org added), bare #N (skipped —
    # unresolvable without a default repo). Output is always org/repo#N.
    # Uses index()/substr for field detection: this awk mis-evaluates the
    # anchored /^\*Issues\*\*/ regex form (verified 2026-09-13).
    awk -v org="$default_org" -v default_repo="$default_repo" '
        inissues && substr($0, 1, 2) == "**" && index($0, "**Issues**") != 1 { inissues = 0 }
        index($0, "**Issues**") == 1 { inissues = 1 }
        inissues {
            line = $0
            while (match(line, /([A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+#[0-9]+|#\/#[0-9]+|#[0-9]+/)) {
                ref = substr(line, RSTART, RLENGTH)
                line = substr(line, RSTART + RLENGTH)
                if (ref ~ /\//) {
                    # org/repo#N: canonical (org may differ; keep it)
                    print ref
                } else if (ref ~ /^[A-Za-z0-9_.-]+#/) {
                    # repo#N: org missing, add the configured org
                    print org "/" ref
                } else if (default_repo != "") {
                    # bare #N: resolve via the default repo
                    print org "/" default_repo ref
                } else {
                    print "UNRESOLVED:" ref
                }
            }
        }
    '
}

extract_status() {
    awk 'index($0, "**Status**") == 1 { sub(/^\*\*Status\*\*: */, ""); print; exit }'
}

extract_dependencies() {
    awk '
        index($0, "**Depends on**") == 1 {
            line=$0
            while (match(line, /STEP-[0-9]+/)) {
                print substr(line, RSTART, RLENGTH)
                line=substr(line, RSTART+RLENGTH)
            }
            exit
        }
    '
}

# Find the plan file (from a list) whose header contains STEP-NN backlink.
find_plan_for_step() {
    local step="$1"
    shift
    local pf
    for pf in "$@"; do
        [ -f "$pf" ] || continue
        if grep -qE "(^|[^A-Za-z0-9-])$step([^A-Za-z0-9-]|$)" "$pf" 2>/dev/null; then
            echo "$pf"
            return 0
        fi
    done
    return 1
}

# Emit progress JSON fragment {done,total,pct} for a plan file using plan-parse.
plan_progress_json() {
    local plan="$1"
    local json
    json=$("$DEVENV_TOOLS/plan-parse" "$plan" --summary 2>/dev/null) || return 1
    local done_total total_tasks pct_val
    done_total=$(echo "$json" | jq -r '.tasks_done // 0')
    total_tasks=$(echo "$json" | jq -r '.tasks_total // 0')
    pct_val=$(echo "$json" | jq -r '.pct_tasks // 0')
    [ "$total_tasks" -gt 0 ] 2>/dev/null || return 1
    printf '{"done":%s,"total":%s,"pct":%s}' "$done_total" "$total_tasks" "$pct_val"
}

# ---------------------------------------------------------------------------
# Main
# ============================================================================

main() {
    local roadmap="" default_org="" default_repo=""
    local -a plan_files=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) show_usage ;;
            -v|--version) echo "$SCRIPT_VERSION"; exit 0 ;;
            --plan-dir)
                [ -z "${2:-}" ] && invalid_args "Missing value for --plan-dir"
                local pf
                for pf in "$2"/*.md; do
                    [ -e "$pf" ] && plan_files+=("$pf")
                done
                shift 2 ;;
            --plan-file)
                [ -z "${2:-}" ] && invalid_args "Missing value for --plan-file"
                plan_files+=("$2"); shift 2 ;;
            --org)
                [ -z "${2:-}" ] && invalid_args "Missing value for --org"
                default_org="$2"; shift 2 ;;
            --repo)
                [ -z "${2:-}" ] && invalid_args "Missing value for --repo"
                default_repo="$2"; shift 2 ;;
            --*) invalid_args "Unknown option: $1" ;;
            *)
                [ -n "$roadmap" ] && invalid_args "Multiple roadmap files given"
                roadmap="$1"; shift ;;
        esac
    done

    [ -n "$roadmap" ] || invalid_args "ROADMAP_FILE is required"
    [ -f "$roadmap" ] || invalid_args "Roadmap file not found: $roadmap"

    # Default org: GH_ORG env, else first org/repo#N found in the file, else "org"
    if [ -z "$default_org" ]; then
        default_org="${GH_ORG:-}"
    fi
    [ -n "$default_org" ] || default_org=$(grep -oE '[A-Za-z0-9_.-]+/#[0-9]+' "$roadmap" | head -1 | cut -d/ -f1)
    [ -n "$default_org" ] || default_org="org"

    local steps_json="[]" step phase title body status
    local first=1
    local -a dep_arr issue_arr

    while IFS=$'\t' read -r step phase title; do
        [ -n "$step" ] || continue
        body=$(step_body "$roadmap" "$step")
        status=$(printf '%s\n' "$body" | extract_status)

        # issues: canonical refs, one per line
        issue_arr=()
        while IFS= read -r ref; do
            [ -n "$ref" ] && issue_arr+=("$ref")
        done < <(printf '%s\n' "$body" | extract_issues "$default_org" "$default_repo")

        # dependencies
        dep_arr=()
        while IFS= read -r dep; do
            [ -n "$dep" ] && dep_arr+=("$dep")
        done < <(printf '%s\n' "$body" | extract_dependencies)

        # plan progress
        local plan_file progress="null"
        if [ "${#plan_files[@]}" -gt 0 ]; then
            plan_file=$(find_plan_for_step "$step" "${plan_files[@]}") || plan_file=""
        else
            plan_file=""
        fi
        if [ -n "$plan_file" ]; then
            progress=$(plan_progress_json "$plan_file") || progress="null"
        fi

        # assemble step object
        local issues_json deps_json
        if [ "${#issue_arr[@]}" -gt 0 ]; then
            issues_json=$(printf '%s\n' "${issue_arr[@]}" | jq -R . | jq -s .)
        else
            issues_json="[]"
        fi
        if [ "${#dep_arr[@]}" -gt 0 ]; then
            deps_json=$(printf '%s\n' "${dep_arr[@]}" | jq -R . | jq -s .)
        else
            deps_json="[]"
        fi

        local step_obj
        step_obj=$(jq -n \
            --arg step "$step" --arg phase "$phase" --arg title "$title" \
            --arg status "$status" --arg plan "${plan_file:-}" \
            --argjson issues "$issues_json" --argjson deps "$deps_json" \
            --argjson progress "$progress" \
            '{step:$step, phase:$phase, title:$title, status:$status,
              issues:$issues, progress:$progress, dependencies:$deps,
              plan_file: (if $plan == "" then null else $plan end)}')

        if [ $first -eq 1 ]; then
            steps_json="[$step_obj]"; first=0
        else
            steps_json=$(echo "$steps_json" | jq --argjson s "$step_obj" '. + [$s]')
        fi
    done < <(list_steps "$roadmap")

    jq -n --arg file "$roadmap" --argjson steps "$steps_json" '{roadmap_file: $file, steps: $steps}'
}

main "$@"
