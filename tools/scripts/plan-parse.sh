#!/bin/bash
# plan-parse.sh - Deterministic plan structure parsing
# Version: 1.2.0
# Description: Extracts phases, tasks, completion state, and file-path anchors
#              from Plan-*.md (or legacy Implementation_plan-*.md) as JSON — replaces model-side
#              heading/checkbox/Files-bullet harvesting and staleness scans.
# Requirements: Bash 4.0+, jq, grep

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"

readonly SCRIPT_VERSION="1.2.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Parse plan structure into JSON"

FILE=""
MODE="structure"   # structure | anchors | census | summary | lint
REQUIRE_HEADER=0

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME FILE [OPTIONS]

Parse a Plan-*.md (or legacy Implementation_plan-*.md) deterministically.

Modes:
    --structure  (default) Phases with tasks and completion state:
                 {phases:[{number,title,start_line,tasks:[{id,text,done,
                 decision,files:[]}]}], acs:[{id,text,done}]}
    --anchors    File paths mentioned in the plan (Files: bullets and inline
                 path-like tokens) with existence check relative to the
                 plan's directory: {anchors:[{path,exists}]}
    --census     One-line completion summary per phase:
                 {census:[{phase,total,done,open}], totals:{tasks,done,open}}
    --summary   Single-object progress summary (derived-view metrics for
                 progress reporting; values never hand-counted) with the
                 artifact header routing fields (null when absent):
                 {plan_file, doc_id, issue_number, planning_repo,
                 phases_total, phases_complete, current_phase,
                 tasks_done/open/total, pct_tasks, weighted{done,total,pct}
                 (S=1 M=2 L=4, missing size counts as M), sized_tasks ratio,
                 open_questions, unchecked_acs}
    --lint      Structural lint: parse + invariants as JSON
                 {errors, warnings, checks, ok}; exit 1 on any error.
                 Errors: no phases, alphabetic task suffixes (2.1a), duplicate
                 task ids, Revision History section. Warnings: phases with no
                 tasks, missing size tokens, numbering gaps (informational).

Options:
    --require-header  With --lint only: make the DEVENV_ARTIFACT_V1 header
                 mandatory and validated (presence, doc_id format + first-256
                 placement, artifact_type=plan, planning_repo owner/repo form)
                 — the gate to run before issue-artifact-upsert
    -V, --verbose   Enable verbose logs
    -h, --help      Show help and exit
    -v, --version   Show version and exit

Exit Codes:
    0 success (lint: no errors)
    1 lint errors found (--lint mode)
    2 invalid arguments
EOF
    exit 0
}

invalid_args() {
    log_error "$1"
    echo "Use --help for usage information"
    exit 2
}

# Lint a plan: parse + structural invariants. JSON report {errors, warnings,
# checks, ok}; exit 1 when any error is present. With REQUIRE_HEADER=1 the
# DEVENV_ARTIFACT_V1 header is mandatory and validated (upsert gate).
lint_plan() {
    local file="$1"
    local errors=()
    local warnings=()

    # Reuse the same extraction pipeline for structural checks
    local lint_parsed
    lint_parsed=$(awk '
        BEGIN { inphase = 0; phasenum = ""; inac = 0 }
        /^#+[[:space:]]*Phase[[:space:]]+[0-9]+/ {
            heading = $0
            sub(/^#+[[:space:]]*/, "", heading)
            phasenum = heading
            match(phasenum, /[0-9]+/)
            phasenum = substr(phasenum, RSTART, RLENGTH)
            printf "PHASE\t%s\t%d\n", phasenum, NR
            inphase = 1; next
        }
        inphase && /^-[[:space:]]*\[[ xX]\][[:space:]]*(\*\*)?[0-9]+\.[0-9]+/ {
            line = $0
            rest = line
            sub(/^-[[:space:]]*\[[ xX]\][[:space:]]*/, "", rest)
            sub(/^\*\*/, "", rest)
            id = rest
            match(id, /^[0-9]+(\.[0-9]+)+/)
            id = substr(id, RSTART, RLENGTH)
            done = (line ~ /^-[[:space:]]*\[[xX]\]/) ? "1" : "0"
            text = rest
            sub(/^[0-9]+(\.[0-9]+)+[[:space:]]*/, "", text)
            sub(/^\*\*/, "", text)
            size = "-"
            if (text ~ /^\[[SsMmLl]\]/) {
                size = toupper(substr(text, 2, 1))
            }
            # Alphabetic suffix (2.1a): id token followed immediately by a letter.
            # Anchor on the full rest: number(.number)+ then a letter, else no suffix.
            bad = rest; match(bad, /^[0-9]+(\.[0-9]+)*[A-Za-z]/)
            badtok = (RSTART > 0) ? substr(bad, RSTART, RLENGTH) : "-"
            printf "TASK\t%s\t%s\t%s\t%s\t%s\t%d\n", id, done, size, phasenum, badtok, NR
            next
        }
    ' "$file")

    local n_phases n_tasks
    n_phases=$(printf '%s\n' "$lint_parsed" | awk -F'\t' '$1 == "PHASE"' | wc -l | tr -d ' ')
    n_tasks=$(printf '%s\n' "$lint_parsed" | awk -F'\t' '$1 == "TASK"' | wc -l | tr -d ' ')

    [ "$n_phases" -gt 0 ] || errors+=("no Phase headings found — a plan must have at least one phase")

    # Alphabetic task suffixes (2.1a) — hard rule
    # shellcheck disable=SC2034  # positional fields exist to document the record layout
    while IFS=$'\t' read -r kind id is_done size ph bad nr; do
        [ "$kind" = "TASK" ] || continue
        if [ "$bad" != "-" ] && [ -n "$bad" ]; then
            errors+=("task id '$id' at line $nr carries an alphabetic suffix ('$bad') — use numeric ids or hierarchical subtasks (7.1.1)")
        fi
    done <<< "$lint_parsed"

    # Duplicate task ids
    local dups
    dups=$(printf '%s\n' "$lint_parsed" | awk -F'\t' '$1 == "TASK" { print $2 }' | sort | uniq -d)
    if [ -n "$dups" ]; then
        while IFS= read -r d; do
            [ -n "$d" ] && errors+=("duplicate task id '$d'")
        done <<< "$dups"
    fi

    # Revision History section — hard rule (plans are current-state only)
    if grep -q '^##[[:space:]]*Revision History' "$file"; then
        errors+=("'## Revision History' section present — plans are current-state artifacts; revision history is never created")
    fi

    # Phases with zero tasks (warning)
    local empty_phases
    empty_phases=$(printf '%s\n' "$lint_parsed" | awk -F'\t' '
        $1 == "PHASE" { phase_seen[$2] = 1 }
        $1 == "TASK" { has_task[$5] = 1 }
        END { for (p in phase_seen) if (!(p in has_task)) print p }
    ' | sort -n)
    if [ -n "$empty_phases" ]; then
        while IFS= read -r p; do
            [ -n "$p" ] && warnings+=("phase $p has no tasks")
        done <<< "$empty_phases"
    fi

    # Tasks missing size tokens (warning) — only when any task carries one
    local sized unsized
    sized=$(printf '%s\n' "$lint_parsed" | awk -F'\t' '$1 == "TASK" && ($4 == "S" || $4 == "M" || $4 == "L")' | wc -l | tr -d ' ')
    unsized=$(printf '%s\n' "$lint_parsed" | awk -F'\t' '$1 == "TASK" && $4 == "-"' | wc -l | tr -d ' ')
    if [ "$sized" -gt 0 ] && [ "$unsized" -gt 0 ]; then
        warnings+=("$unsized of $n_tasks tasks carry no [S|M|L] size token (weights default to M)")
    fi

    # Task-numbering gaps (informational) — gaps are expected after clean deletions
    local gap_phases
    gap_phases=$(printf '%s\n' "$lint_parsed" | awk -F'\t' '
        $1 == "TASK" {
            split($2, parts, ".")
            ph = parts[1]; sub_id = parts[2] + 0
            if (sub_id > max[ph]) max[ph] = sub_id
            cnt[ph]++
        }
        END {
            for (p in max) if (max[p] != cnt[p]) print p
        }
    ' | sort -n)
    if [ -n "$gap_phases" ]; then
        while IFS= read -r p; do
            [ -n "$p" ] && warnings+=("phase $p task numbering has gaps (expected after clean deletions — informational)")
        done <<< "$gap_phases"
    fi

    # Header validation (only under --require-header — the upsert gate)
    local header_found=0
    if [ -n "$header_parsed" ]; then
        header_found=1
    fi
    if [ "$REQUIRE_HEADER" -eq 1 ]; then
        if [ "$header_found" -eq 0 ]; then
            errors+=("DEVENV_ARTIFACT_V1 header missing — required before issue-artifact-upsert")
        else
            local h_doc_id h_type h_planning
            h_doc_id=$(header_field doc_id)
            h_type=$(header_field artifact_type)
            h_planning=$(header_field planning_repo)
            if [ "$h_doc_id" = "null" ]; then
                errors+=("header key doc_id missing — required before issue-artifact-upsert")
            elif ! printf '%s' "$h_doc_id" | grep -qE '^dv1:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+:(issue-[0-9]+|local):[a-z-]+:[A-Za-z0-9_.-]+$'; then
                errors+=("doc_id '$h_doc_id' does not match the deterministic format dv1:<owner/repo>:<issue-N|local>:<type>:<slug>")
            elif ! head -c 256 "$file" | grep -q "doc_id"; then
                errors+=("doc_id not within the first 256 characters of the file")
            fi
            if [ "$h_type" != "null" ] && [ "$h_type" != "plan" ]; then
                errors+=("artifact_type is '$h_type' — expected 'plan' for a plan artifact")
            fi
            if [ "$h_planning" != "null" ] && ! printf '%s' "$h_planning" | grep -qE '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'; then
                errors+=("planning_repo '$h_planning' is not in owner/repo form — a malformed value misroutes issue/artifact calls silently")
            fi
        fi
    fi

    # Assemble JSON report
    local err_json warn_json
    if [ "${#errors[@]}" -gt 0 ]; then
        err_json=$(printf '%s\n' "${errors[@]}" | jq -R . | jq -s .)
    else
        err_json="[]"
    fi
    if [ "${#warnings[@]}" -gt 0 ]; then
        warn_json=$(printf '%s\n' "${warnings[@]}" | jq -R . | jq -s .)
    else
        warn_json="[]"
    fi
    local ok=true
    [ "${#errors[@]}" -eq 0 ] || ok=false
    printf '{"errors": %s, "warnings": %s, "checks": {"phases": %d, "tasks": %d, "header": %s, "header_required": %s}, "ok": %s}\n' \
        "$err_json" "$warn_json" "$n_phases" "$n_tasks" \
        "$([ "$header_found" -eq 1 ] && echo true || echo false)" \
        "$([ "$REQUIRE_HEADER" -eq 1 ] && echo true || echo false)" \
        "$ok"
    [ "${#errors[@]}" -eq 0 ]
}

main() {
    if [ $# -eq 0 ]; then
        invalid_args "Required arguments are missing"
    fi

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) show_usage ;;
            -v|--version)
                echo "$SCRIPT_VERSION"
                exit 0
                ;;
            -V|--verbose) shift ;;
            --structure|--anchors|--census|--summary|--lint)
                MODE="${1#--}"; shift ;;
            --require-header)
                REQUIRE_HEADER=1; shift ;;
            *) FILE="$1"; shift ;;
        esac
    done

    if [ -z "$FILE" ]; then
        invalid_args "FILE is required"
    fi
    if [ ! -f "$FILE" ]; then
        invalid_args "File not found: $FILE"
    fi

    if [ "$REQUIRE_HEADER" -eq 1 ] && [ "$MODE" != "lint" ]; then
        invalid_args "--require-header is only valid together with --lint"
    fi

    local plan_dir
    plan_dir=$(dirname "$FILE")
    # Extract the DEVENV_ARTIFACT_V1 header block as key<TAB>value lines (empty when absent)
    local header_parsed
    header_parsed=$(awk '
        /DEVENV_ARTIFACT_V1/ { inblock = 1; next }
        inblock && /^-->/ { inblock = 0; exit }
        inblock && /^[[:space:]]*[A-Za-z_]+[[:space:]]*:/ {
            line = $0
            key = line; sub(/^[[:space:]]+/, "", key); sub(/[[:space:]]*:.*$/, "", key)
            val = line; sub(/^[[:space:]]*[A-Za-z_]+[[:space:]]*:[[:space:]]*/, "", val)
            gsub(/[[:space:]]+$/, "", val)
            print key "\t" val
        }
    ' "$FILE")

    header_field() {
        # Print one header value or "null" when the key/file is absent
        local v
        v=$(printf '%s\n' "$header_parsed" | awk -F'\t' -v k="$1" '$1 == k { print $2; exit }')
        if [ -n "$v" ]; then echo "$v"; else echo "null"; fi
    }

    if [ "$MODE" = "lint" ]; then
        if lint_plan "$FILE"; then
            exit 0
        else
            exit 1
        fi
    fi
    if [ "$MODE" = "anchors" ]; then
        # Path-like tokens: Files: bullets plus inline paths ending in source extensions
        local paths_json
        paths_json=$(grep -oE '[A-Za-z0-9_./-]+\.(cs|ts|tsx|js|json|csproj|sh|md|sql|yaml|yml|py)' "$FILE" \
            | grep -v '://' | sort -u \
            | while IFS= read -r p; do
                if [ -e "$plan_dir/$p" ] || [[ "$p" == /* && -e "$p" ]]; then
                    echo "{\"path\": \"$p\", \"exists\": true},"
                else
                    echo "{\"path\": \"$p\", \"exists\": false},"
                fi
              done | sed '$ s/,$//' | sed 's/^/ /' )
        echo "{"
        echo "  \"anchors\": [${paths_json//[[:space:]]+$//}]"
        echo "}"
        exit 0
    fi

    # structure + census share the same extraction pipeline
    local parsed
    parsed=$(awk '
        BEGIN { inphase = 0; phasenum = ""; inac = 0 }
        /^#+[[:space:]]*Phase[[:space:]]+[0-9]+/ {
            heading = $0
            sub(/^#+[[:space:]]*/, "", heading)
            phasenum = heading
            match(phasenum, /[0-9]+/)
            phasenum = substr(phasenum, RSTART, RLENGTH)
            title = heading
            sub(/^Phase[[:space:]]+[0-9]+[[:space:]]*[—–-]?[[:space:]]*/, "", title)
            # strip any leading non-alphanumeric residue (em-dash encodings)
            sub(/^[^A-Za-z0-9]+/, "", title)
            printf "PHASE\t%s\t%s\t%d\n", phasenum, title, NR
            inphase = 1
            next
        }
        # AC checklist: "- [ ] <a id="ac-1"></a>**AC-1** ..." or "- [x] **AC-1** ..."
        /^-[[:space:]]*\[[ xX]\].*AC-[0-9]+/ {
            line = $0
            id = line
            match(id, /AC-[0-9]+/)
            id = substr(id, RSTART, RLENGTH)
            # AC list bullet "- [AC-8](#ac-8)" has no checkbox — excluded by the regex above
            done = (line ~ /^-[[:space:]]*\[[xX]\]/) ? "1" : "0"
            printf "AC\t%s\t%s\n", id, done
            next
        }
        # Task line: "- [x] **1.1 [S] title**" or "- [ ] 1.2 title" (bold optional)
        inphase && /^-[[:space:]]*\[[ xX]\][[:space:]]*(\*\*)?[0-9]+\.[0-9]+/ {
            line = $0
            id = line
            sub(/^[^(0-9)]*[0-9]+\.[0-9]+.*$/, "") # placeholder, replaced below
            rest = line
            sub(/^-[[:space:]]*\[[ xX]\][[:space:]]*/, "", rest)
            sub(/^\*\*/, "", rest)
            id = rest
            match(id, /^[0-9]+\.[0-9]+/)
            id = substr(id, RSTART, RLENGTH)
            done = (line ~ /^-[[:space:]]*\[[xX]\]/) ? "1" : "0"
            text = rest
            sub(/^[0-9]+\.[0-9]+[[:space:]]*/, "", text)
            sub(/^\*\*/, "", text)
            sub(/\*\*[[:space:]]*$/, "", text)
            # Size token: "[S]" / "[M]" / "[L]" in the task header; empty when absent
            size = ""
            if (text ~ /^\[[SsMmLl]\]/) {
                size = toupper(substr(text, 2, 1))
                sub(/^\[[SsMmLl]\][[:space:]]*/, "", text)
            }
            printf "TASK\t%s\t%s\t%s\t%s\t%s\t%d\n", id, done, text, size, phasenum, NR
            next
        }
    ' "$FILE")

    if [ "$MODE" = "structure" ]; then
        local js='[]'
        local acs='[]'
        while IFS=$'\t' read -r kind a b c _ e; do
            case "$kind" in
                PHASE)
                    js=$(echo "$js" | jq --arg n "$a" --arg t "$b" --argjson l "$c" \
                        '. + [{number: $n, title: $t, start_line: $l, tasks: []}]')
                    ;;
                TASK)
                    js=$(echo "$js" | jq --arg id "$a" --arg dn "$b" --arg text "$c" --arg ph "$e" \
                        '.[-1].tasks += [{id: $id, done: ($dn == "1"), text: $text}]')
                    ;;
                AC)
                    acs=$(echo "$acs" | jq --arg id "$a" --arg dn "$b" \
                        '. + [{id: $id, done: ($dn == "1")}]')
                    ;;
            esac
        done <<< "$parsed"
        echo "$js" | jq --slurpfile acs <(echo "$acs") '{phases: ., acs: $acs[0]}'
        exit 0
    fi

    if [ "$MODE" = "summary" ]; then
        # Open [QUESTION] items: any line carrying an inline [QUESTION] token
        local open_questions
        open_questions=$(grep -c '\[QUESTION\]' "$FILE" || true)

        # Header routing fields (null when absent) — escaped for JSON embedding
        local h_doc_id h_issue h_planning
        h_doc_id=$(header_field doc_id | jq -R .)
        h_issue=$(header_field issue_number | jq -R .)
        h_planning=$(header_field planning_repo | jq -R .)

        echo "$parsed" | awk -F'\t' -v plan_file="$(basename "$FILE")" -v open_questions="$open_questions" \
            -v h_doc_id="$h_doc_id" -v h_issue="$h_issue" -v h_planning="$h_planning" '
            $1 == "PHASE" {
                phase_order[++phase_count] = $2
            }
            $1 == "TASK" {
                total_tasks++
                ph = $6
                phase_has_task[ph] = 1
                size = $5
                w = (size == "S") ? 1 : (size == "L") ? 4 : 2   # unsized counts as M
                if (size == "S" || size == "M" || size == "L") sized_tasks++
                weighted_total += w
                if ($3 == "1") {
                    done_tasks++
                    weighted_done += w
                    phase_done[ph]++
                } else {
                    phase_open[ph]++
                }
            }
            $1 == "AC" {
                ac_total++
                if ($3 != "1") ac_unchecked++
            }
            END {
                for (i = 1; i <= phase_count; i++) {
                    p = phase_order[i]
                    if (phase_has_task[p]) {
                        phases_with_tasks++
                        if (!(p in phase_open) || phase_open[p] == 0) phases_complete++
                    }
                }
                current_phase = ""
                for (i = 1; i <= phase_count; i++) {
                    p = phase_order[i]
                    if (phase_has_task[p] && (p in phase_open) && phase_open[p] > 0) {
                        current_phase = p
                        break
                    }
                }
                if (current_phase == "") {
                    for (i = phase_count; i >= 1; i--) {
                        if (phase_has_task[phase_order[i]]) { current_phase = phase_order[i]; break }
                    }
                }
                pct = (total_tasks > 0) ? sprintf("%.1f", 100 * done_tasks / total_tasks) : "0.0"
                wpct = (weighted_total > 0) ? sprintf("%.1f", 100 * weighted_done / weighted_total) : "0.0"
                sized_ratio = (total_tasks > 0) ? sprintf("%.2f", sized_tasks / total_tasks) : "0.00"
                printf "{\n"
                printf "  \"plan_file\": \"%s\",\n", plan_file
                printf "  \"doc_id\": %s,\n", h_doc_id
                printf "  \"issue_number\": %s,\n", h_issue
                printf "  \"planning_repo\": %s,\n", h_planning
                printf "  \"phases_total\": %d,\n", phases_with_tasks + 0
                printf "  \"phases_complete\": %d,\n", phases_complete + 0
                printf "  \"current_phase\": \"%s\",\n", current_phase
                printf "  \"tasks_done\": %d,\n", done_tasks + 0
                printf "  \"tasks_open\": %d,\n", (total_tasks - done_tasks) + 0
                printf "  \"tasks_total\": %d,\n", total_tasks + 0
                printf "  \"pct_tasks\": %s,\n", pct
                printf "  \"weighted\": {\"done\": %d, \"total\": %d, \"pct\": %s},\n", weighted_done + 0, weighted_total + 0, wpct
                printf "  \"sized_tasks\": %s,\n", sized_ratio
                printf "  \"open_questions\": %d,\n", open_questions + 0
                printf "  \"unchecked_acs\": %d\n", ac_unchecked + 0
                printf "}\n"
            }
        '
        exit 0
    fi

    # census mode
    echo "$parsed" | awk -F'\t' '
        $1 == "PHASE" { phase[$2] = 0; total[$2] = 0 }
        $1 == "TASK" { total[$6]++; if ($3 == "1") phase[$6]++ }
        END {
            print "{"
            printf "  \"census\": ["
            first = 1
            gt = 0; gd = 0
            for (p in total) {
                if (!first) printf ", "
                first = 0
                printf "{\"phase\": \"%s\", \"total\": %d, \"done\": %d, \"open\": %d}", p, total[p], phase[p], total[p] - phase[p]
                gt += total[p]; gd += phase[p]
            }
            printf "],\n"
            printf "  \"totals\": {\"tasks\": %d, \"done\": %d, \"open\": %d}\n", gt, gd, gt - gd
            print "}"
        }
    '
}

main "$@"
