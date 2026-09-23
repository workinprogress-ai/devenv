#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# devenv-marker-check.sh - Deterministic DEVENV-marker and AC-comment scanning
# Version: 1.3.0
# Description: Replaces hand-run grep sweeps: verify no plan-bounded
#              FIXME:DEVENV[ markers remain (gate mode), list [AC-N]: comments
#              (finder mode), list scoped TODO:DEVENV[ markers with discharge
#              conditions (--todo-report), audit all markers (--all), or check
#              custom markers with --require inversion.
# Requirements: Bash 4.0+, grep

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"

readonly SCRIPT_VERSION="1.3.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Scan for DEVENV markers and AC comments"

MARKER='DEVENV\['
AC_MODE=0
TODO_REPORT=0
ALL_MARKERS=0
REQUIRE=0
NO_EXCLUDE=0
INCLUDE_COPILOT=0
# Default noise-class exclusions: gitignored caches (repo-cache clones,
# node_modules), VCS internals, and workspace-root per-repo clone dirs.
# --no-exclude restores exhaustive traversal for audit sweeps.
readonly EXCLUDE_DIRS=(cache node_modules .git repos)
PATHS=()

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [PATH...] [OPTIONS]

Deterministic marker scanning for DEVENV workflows.

Default (gate mode): fail (exit 1) when any plan-bounded FIXME:DEVENV[ (or paren-form FIXME(DEVENV[
marker remains under the scanned paths — cross-plan TODO:DEVENV[ markers
are sanctioned to ship and do not block. Print each hit as
file:line:match.

Options:
    --all                        Audit mode: report ALL DEVENV markers
                                 (FIXME, TODO, and bare/malformed legacy
                                 forms) instead of FIXME-only; same exit
                                 semantics as the gate.
    --ac                         Finder mode: list [AC-N] DEVENV comments with
                                 file:line:match; exit 0 regardless (the AC
                                 review gate assesses them, this only finds them)
    --todo-report                Finder mode: list scoped TODO:DEVENV[ markers
                                 with file:line:match and flag any that are
                                 missing a discharge condition ("remove when
                                 ..."); exit 0 regardless. Also surfaces
                                 paren-form TODO(DEVENV) entries lacking a plan
                                 key (paren form is detected but not canonical)
                                 key. Supports the kickoff Scoped-TODO
                                 discovery rule.
    --marker REGEX               Custom marker regex (default 'DEVENV\['), e.g.
                                 'DEVENV\[bug-hunt\]' for bug-hunt sweeps
    --require                    Invert the gate: succeed only when at least one
                                 match exists (verification sweeps like
                                 "protocol reference present in every skill")
    --include-copilot            Gate/audit modes: also scan copilot/ (devenv's own
                                 skill files carry example markers by design; they are
                                 excluded from gate/audit modes by default, but still
                                 scanned by --todo-report and --ac)
    --no-exclude                 Scan ALL directories including the default
                                 noise-class exclusions (cache, node_modules,
                                 .git, repos). Use for exhaustive audits.
    -V, --verbose                Enable verbose logs
    -h, --help                   Show help and exit
    -v, --version                Show version and exit

Exit Codes:
    0 gate passed (no markers) / finder mode done / --require satisfied
    1 gate failed (markers found) or --require not satisfied
    2 invalid arguments
EOF
    exit 0
}

main() {
    if [ $# -eq 0 ]; then
        PATHS=(".")
    fi

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) show_usage ;;
            -v|--version)
                echo "$SCRIPT_VERSION"
                exit 0
                ;;
            -V|--verbose) shift ;;
            --ac) AC_MODE=1; shift ;;
            --todo-report) TODO_REPORT=1; shift ;;
            --all) ALL_MARKERS=1; shift ;;
            --marker)
                [ -z "${2:-}" ] && invalid_args "Missing value for --marker"
                MARKER="$2"; shift 2 ;;
            --require) REQUIRE=1; shift ;;
            --no-exclude) NO_EXCLUDE=1; shift ;;
            --include-copilot) INCLUDE_COPILOT=1; shift ;;
            --*) invalid_args "Unknown option: $1" ;;
            *) PATHS+=("$1"); shift ;;
        esac
    done

    if [ "${#PATHS[@]}" -eq 0 ]; then
        PATHS=(".")
    fi
    for p in "${PATHS[@]}"; do
        if [ ! -e "$p" ]; then
            invalid_args "Path not found: $p"
        fi
    done

    if [ "$AC_MODE" -eq 1 ] && [ "$TODO_REPORT" -eq 1 ]; then
        invalid_args "--ac and --todo-report are mutually exclusive"
    fi
    if [ "$ALL_MARKERS" -eq 1 ] && { [ "$AC_MODE" -eq 1 ] || [ "$TODO_REPORT" -eq 1 ]; }; then
        invalid_args "--all is a gate-mode option; it cannot be combined with --ac or --todo-report"
    fi

    local regex hits=0
    if [ "$AC_MODE" -eq 1 ]; then
        regex='\[AC-[0-9]+'
    elif [ "$TODO_REPORT" -eq 1 ]; then
        # surface scoped TODOs in the canonical colon form AND paren-form
        # entries so off-spec forms cannot hide from the discovery rule
        regex='TODO:?\(DEVENV|TODO:DEVENV\['
    elif [ "$ALL_MARKERS" -eq 1 ]; then
        regex='(FIXME|TODO):?\(DEVENV|(FIXME|TODO):DEVENV\[|DEVENV\['
    else
        # PR-blocking gate: plan-bounded FIXME markers only (colon form
        # canonical, paren form detected) — cross-plan TODOs must not block
        regex='FIXME:?\(DEVENV|FIXME:DEVENV\['
    fi

    local result
    set +e
    if [ "$NO_EXCLUDE" -eq 1 ]; then
        result=$(grep -rnE "$regex" "${PATHS[@]}" 2>/dev/null)
    else
        local -a excl_args=()
        local d
        for d in "${EXCLUDE_DIRS[@]}"; do
            excl_args+=(--exclude-dir="$d")
        done
        # copilot/ carries example markers by design: excluded from the
        # PR-blocking gate and audit modes unless --include-copilot is given.
        # --todo-report and --ac always scan it.
        if [ "$INCLUDE_COPILOT" -eq 0 ] && [ "$TODO_REPORT" -eq 0 ] && [ "$AC_MODE" -eq 0 ]; then
            excl_args+=(--exclude-dir="copilot")
        fi
        result=$(grep -rnE "$regex" "${excl_args[@]}" "${PATHS[@]}" 2>/dev/null)
    fi
    set -e

    if [ -n "$result" ]; then
        hits=$(echo "$result" | wc -l)
        echo "$result"
    fi

    if [ "$AC_MODE" -eq 1 ]; then
        if [ "$hits" -eq 0 ]; then
            echo "No AC comments found under: ${PATHS[*]}"
        fi
        exit 0
    fi

    if [ "$TODO_REPORT" -eq 1 ]; then
        if [ "$hits" -eq 0 ]; then
            echo "No scoped TODO(DEVENV markers found under: ${PATHS[*]}"
            exit 0
        fi
        local missing malformed
        missing=$(echo "$result" | grep -cv 'remove when .\{1,\}' || true)
        malformed=$(echo "$result" | grep -cvE 'TODO:?\(DEVENV\[|TODO:DEVENV\[' || true)
        if [ "$malformed" -gt 0 ]; then
            log_warn "$malformed malformed TODO entry(ies) without a plan key found (paren form or no key) — plan keys are mandatory; fix or convert to TODO:DEVENV[key]: ..."
        fi
        if [ "$missing" -gt 0 ]; then
            log_warn "$missing of $hits scoped TODO(s) missing a discharge condition ('remove when ...') — condition-less TODOs are defects per the marker spec; resolve with the user"
        fi
        exit 0
    fi

    if [ "$REQUIRE" -eq 1 ]; then
        if [ "$hits" -eq 0 ]; then
            log_error "Required marker '$MARKER' not found under: ${PATHS[*]}"
            exit 1
        fi
        exit 0
    fi

    if [ "$hits" -gt 0 ]; then
        log_error "$hits plan-bounded FIXME marker(s) found — remove or convert them before completion"
        exit 1
    fi
    if [ "$ALL_MARKERS" -eq 1 ]; then
        echo "Clean: no DEVENV markers of any form under: ${PATHS[*]}"
    else
        echo "Clean: no FIXME(DEVENV markers under: ${PATHS[*]} (use --all to audit TODO/legacy forms)"
    fi
    exit 0
}

main "$@"
