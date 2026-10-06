#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# artifact-clean.sh - Clean up `.local-artifacts/` folders by artifact family
# Version: 1.3.0
# Description: Interactive (default) or flag-driven cleanup of local artifact
#              folders. Files are grouped into the three convention families
#              from _conventions.md (ephemeral tmpN.md, session memory,
#              issue-artifact working copies) plus an "other" bucket. A fifth
#              family, deliverables (research-*, bug-hunt-*, TECH_DEBT_AUDIT*),
#              is retained work product: no sweep touches it unless
#              --include-deliverables says so. Deletion
#              confidence matches family: ephemeral needs no confirmation;
#              working/session/other require an explicit -y/--yes or
#              interactive confirmation. Never touches anything outside
#              .local-artifacts/.
# Requirements: Bash 4.0+, git (for repo root discovery); fzf optional (richer
#               interactive selection with live preview)
# Last Modified: 2026-09-26

# Note: Strict error handling (set -euo pipefail and ERR trap) is configured
# via enable_strict_mode() from error-handling.bash after sourcing libraries

# ============================================================================
# Source Required Libraries
# ============================================================================

readonly SCRIPT_VERSION="1.3.0"
readonly FOLDER_NAME=".local-artifacts"
SCRIPT_NAME="$(basename "$0")"

# shellcheck source=../lib/error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"

# shellcheck source=../lib/versioning.bash
source "$DEVENV_TOOLS/lib/versioning.bash"

# shellcheck source=../lib/fzf-selection.bash
source "$DEVENV_TOOLS/lib/fzf-selection.bash"

# Enable strict error handling (sets -euo pipefail and ERR trap)
enable_strict_mode

# ============================================================================
# Helpers
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [PATH...] [OPTIONS]

Clean up $FOLDER_NAME/ folders by artifact family. With no PATH, operates on
the nearest directory (walking up from cwd) that contains a $FOLDER_NAME.

Families (per the .local-artifacts convention):
    ephemeral   tmpN.md scratch files (always cleaned automatically, even in
                interactive mode — the convention needs no confirmation)
    session     session_memory-*.md planning-skill memory (confirm or -y)
    working     Plan-issue-*.md / Grooming-*.md / Specifications-*.md /
                Blueprint-*.md / Roadmap-*.md — local working copies of
                issue-published artifacts (confirm or -y)
    other       anything else in the folder (confirm or -y; never silently
                deleted)
    deliverable research-*.md / bug-hunt-*.md / TECH_DEBT_AUDIT* — retained
                work product, not cleanup fodder. NEVER swept (not by --all,
                not by -y, not offered in interactive selection) unless
                --include-deliverables is passed; reported as "kept" instead

Options:
    -i, --interactive   Interactive selection (default when no family flags
                        are given and stdin is a TTY). With fzf installed:
                        one multi-select list of every deletable file, with
                        a live preview of each file's content as you move
                        through the list — TAB toggles, Enter confirms.
                        Without fzf: falls back to family-by-family prompts.
    --tmp               Ephemeral family only
    --session           Session-memory family only
    --working           Issue working-copy family only
    --all               Every family, including other (deliverables only
                        with --include-deliverables)
    --include-deliverables
                        Explicit override: with --all or interactive
                        selection, also sweep the deliverable family. The
                        usual rules still apply (-y or a confirmation).
    --keep-tmp          Override: do NOT auto-delete ephemeral tmpN.md files.
                        They flow through normal confirmation/selection like
                        every other family — nothing is deleted without an
                        explicit choice. (Safety hatch for auditing what the
                        convention would otherwise remove silently.)
    -y, --yes           Assume yes for all confirmations
    -l, --list          List what would be cleaned per family; delete nothing
    -h, --help          Show this help message
    -v, --version       Show version and exit

Exit codes:
    0 cleanup completed (or nothing to do)
    1 invalid arguments
    2 no artifact folder found

Examples:
    $SCRIPT_NAME                      # interactive selection
    $SCRIPT_NAME --tmp                # drop scratch files, no prompts
    $SCRIPT_NAME --working -y         # clear working copies, no prompts
    $SCRIPT_NAME repos/foo -l         # list-only for a specific repo
    $SCRIPT_NAME --all -y             # full sweep, no prompts (deliverables kept)
    $SCRIPT_NAME --all -y --include-deliverables   # ...deliverables too
EOF
    exit 0
}

# Walk up from $PWD to the nearest directory containing the artifact folder.
discover_artifact_root() {
    local dir="$PWD"
    while [ "$dir" != "/" ]; do
        if [ -d "$dir/$FOLDER_NAME" ]; then
            echo "$dir"
            return 0
        fi
        dir=$(dirname "$dir")
    done
    return 1
}

# classify FILENAME -> family name (mirror of the _conventions.md families)
classify() {
    local f="$1"
    case "$f" in
        tmp[0-9]*.md) echo "ephemeral" ;;
        session_memory-*.md|pairing-state-*.md) echo "session" ;;
        Plan-issue-*.md|Grooming-*.md|Specifications-*.md|Blueprint-*.md|Roadmap-*.md) echo "working" ;;
        research-*.md|bug-hunt-*.md|TECH_DEBT_AUDIT*) echo "deliverable" ;;
        *) echo "other" ;;
    esac
}

# print files in FOLDER belonging to FAMILY, one per line
collect_family() {
    local folder="$1" family="$2"
    local f base
    [ -d "$folder" ] || return 0
    for f in "$folder"/*; do
        [ -e "$f" ] || continue
        base=$(basename "$f")
        if [ "$(classify "$base")" = "$family" ]; then
            echo "$f"
        fi
    done
}

# Say which protected deliverables a sweep is leaving alone, so the protection
# is visible rather than silent.
report_kept_deliverables() {
    local folder="$1" count
    count=$(collect_family "$folder" deliverable | wc -l)
    if [ "$count" -gt 0 ]; then
        log_info "[deliverable] kept $count protected file(s) (retained work product, never swept; pass --include-deliverables to include them)"
    fi
}

delete_files() {
    local f
    for f in "$@"; do
        rm -f -- "$f"
    done
}

confirm_files() {
    local label="$1"
    shift
    local f answer
    echo "  $label:"
    for f in "$@"; do
        echo "    - $(basename "$f")"
    done
    printf "  Delete these %d file(s)? [y/N] " "$#"
    if ! read -r answer < /dev/tty; then
        echo "Non-interactive session: refusing deletion (pass --yes to skip the prompt)." >&2
        return 1
    fi
    [ "$answer" = "y" ] || [ "$answer" = "Y" ]
}

# Interactive per-file selection across families, with a live preview of
# each candidate's content (fzf multi-select). Ephemeral files are never
# offered — they are cleaned unconditionally by the convention.
# Args: folder, then deletable files (any family) as remaining args
# Returns: 0 with selected full paths on stdout (one per line); 1 on cancel
interactive_select_deletions() {
    local folder="$1"
    shift
    [ $# -gt 0 ] || return 1

    if ! command -v fzf >/dev/null 2>&1; then
        return 1
    fi

    # Each entry is "<label><TAB><full path>": --with-nth=1 shows only the
    # label, and the preview reads field 2 — the real file — so the right
    # pane shows its content as the cursor moves.
    local -a entries=()
    local f base family label
    for f in "$@"; do
        base=$(basename "$f")
        family=$(classify "$base")
        label=$(printf '[%s] %s\t%s' "$family" "$base" "$f")
        entries+=("$label")
    done

    local selected
    selected=$(printf '%s\n' "${entries[@]}" | fzf \
        --prompt="Select artifacts to delete: " \
        --multi \
        --border \
        --height=60% \
        --delimiter=$'\t' \
        --with-nth=1 \
        --bind="tab:toggle+down" \
        --header="TAB toggle | Shift-Tab toggle-all | Enter delete selection | Esc cancel" \
        --preview="cat {2}" \
        --preview-window="right:50%:wrap") || return 1

    # Strip the label column back off — field 2 is the full path.
    printf '%s\n' "$selected" | cut -f2
    return 0
}

# ============================================================================
# Main
# ============================================================================

main() {
    local MODE="" ASSUME_YES=0 LIST_ONLY=0 KEEP_TMP=0 INCLUDE_DELIVERABLES=0
    local -a USER_PATHS=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) show_usage ;;
            -v|--version) echo "$SCRIPT_VERSION"; exit 0 ;;
            -i|--interactive) MODE="interactive"; shift ;;
            --tmp) MODE="${MODE}tmp"; shift ;;
            --session) MODE="${MODE}session"; shift ;;
            --working) MODE="${MODE}working"; shift ;;
            --all) MODE="tmp session working other"; shift ;;
            --keep-tmp) KEEP_TMP=1; shift ;;
            --include-deliverables) INCLUDE_DELIVERABLES=1; shift ;;
            -y|--yes) ASSUME_YES=1; shift ;;
            -l|--list) LIST_ONLY=1; shift ;;
            --*) invalid_args "Unknown option: $1" ;;
            *) USER_PATHS+=("$1"); shift ;;
        esac
    done

    # Resolve target roots
    local -a roots=()
    local p root
    if [ "${#USER_PATHS[@]}" -gt 0 ]; then
        for p in "${USER_PATHS[@]}"; do
            [ -e "$p" ] || invalid_args "Path not found: $p"
            if [ -d "$p/$FOLDER_NAME" ]; then
                roots+=("$p")
            elif [ "$(basename "$p")" = "$FOLDER_NAME" ]; then
                roots+=("$(dirname "$p")")
            else
                log_warn "No $FOLDER_NAME under $p — skipping"
            fi
        done
        [ "${#roots[@]}" -gt 0 ] || exit 2
    else
        if ! root=$(discover_artifact_root); then
            log_error "No $FOLDER_NAME found between $PWD and /"
            exit 2
        fi
        roots=("$root")
    fi

    # Default mode: interactive when no family flags and stdin is a TTY;
    # otherwise degrade to list-only across ALL families so non-interactive
    # callers get a full inventory and never prompt.
    if [ -z "$MODE" ]; then
        if [ -t 0 ]; then
            MODE="interactive"
        else
            MODE="tmp session working other" ; LIST_ONLY=1
            log_warn "No family flags given and stdin is not a TTY — defaulting to list-only"
        fi
    fi

    local deleted=0 ephemeral_deleted=0 folder family f
    for root in "${roots[@]}"; do
        folder="$root/$FOLDER_NAME"
        log_info "Scanning $folder"
        if [ "$INCLUDE_DELIVERABLES" -eq 0 ]; then
            report_kept_deliverables "$folder"
        fi

        local -a families=()
        if [ "$MODE" = "interactive" ]; then
            # Interactive mode: clean ephemeral unconditionally, then offer
            # every remaining candidate in one multi-select with preview.
            local -a deletable=()
            local -a sweep_families=(ephemeral session working other)
            if [ "$INCLUDE_DELIVERABLES" -eq 1 ]; then
                sweep_families+=(deliverable)
            fi
            for family in "${sweep_families[@]}"; do
                while IFS= read -r f; do
                    [ -n "$f" ] && deletable+=("$f")
                done < <(collect_family "$folder" "$family")
            done

            if [ "${#deletable[@]}" -eq 0 ]; then
                log_info "Nothing to clean in $folder"
                continue
            fi

            # Ephemeral first — convention says no confirmation needed,
            # unless --keep-tmp was passed: then tmpN.md files flow through
            # normal selection like every other family.
            local -a offerable=()
            for f in "${deletable[@]}"; do
                if [ "$(classify "$(basename "$f")")" = "ephemeral" ] && [ "$KEEP_TMP" -eq 0 ]; then
                    rm -f -- "$f"
                    deleted=$((deleted + 1))
                    ephemeral_deleted=$((ephemeral_deleted + 1))
                else
                    offerable+=("$f")
                fi
            done
            if [ "${#offerable[@]}" -eq 0 ]; then
                log_info "Only ephemeral files present — cleaned"
                continue
            fi
            [ "$ephemeral_deleted" -gt 0 ] && \
                log_info "[ephemeral] auto-cleaned $ephemeral_deleted scratch file(s) (tmpN.md — no confirmation needed by convention)"
            [ "$KEEP_TMP" -eq 1 ] && \
                log_info "--keep-tmp: ephemeral tmpN.md files included in the selection (nothing auto-deleted)"

            local selected
            if selected=$(interactive_select_deletions "$folder" "${offerable[@]}"); then
                local -a chosen=()
                while IFS= read -r f; do
                    [ -n "$f" ] && chosen+=("$f")
                done <<< "$selected"
                if [ "${#chosen[@]}" -gt 0 ]; then
                    delete_files "${chosen[@]}"
                    deleted=$((deleted + ${#chosen[@]}))
                    log_info "Deleted ${#chosen[@]} selected file(s)"
                else
                    log_info "No files selected — nothing deleted"
                fi
            else
                # fzf missing or cancelled: fall back to family-by-family prompts.
                log_warn "fzf unavailable or selection cancelled — falling back to family prompts"
                # (ephemeral, the first entry, was already cleaned above)
                for family in "${sweep_families[@]:1}"; do
                    local -a files=()
                    while IFS= read -r f; do
                        [ -n "$f" ] && files+=("$f")
                    done < <(collect_family "$folder" "$family")
                    [ "${#files[@]}" -gt 0 ] || continue
                    if [ "$ASSUME_YES" -eq 1 ]; then
                        delete_files "${files[@]}"
                        deleted=$((deleted + ${#files[@]}))
                        log_info "[$family] deleted ${#files[@]} file(s) (-y)"
                    else
                        if confirm_files "[$family]" "${files[@]}"; then
                            delete_files "${files[@]}"
                            deleted=$((deleted + ${#files[@]}))
                            log_info "[$family] deleted ${#files[@]} file(s)"
                        else
                            log_info "[$family] skipped"
                        fi
                    fi
                done
            fi
            continue
        fi

        # Flag-driven mode: build the family list from the MODE string.
        [[ "$MODE" == *tmp* ]] && families+=(ephemeral)
        [[ "$MODE" == *session* ]] && families+=(session)
        [[ "$MODE" == *working* ]] && families+=(working)
        [[ "$MODE" == *other* ]] && families+=(other)
        # Deliverables join only when explicitly asked for, and only in a
        # full (--all) sweep; no other flag combination reaches them.
        if [ "$INCLUDE_DELIVERABLES" -eq 1 ] && [[ "$MODE" == *other* ]]; then
            families+=(deliverable)
        fi

        for family in "${families[@]}"; do
            local -a files=()
            while IFS= read -r f; do
                [ -n "$f" ] && files+=("$f")
            done < <(collect_family "$folder" "$family")
            [ "${#files[@]}" -gt 0 ] || continue

            if [ "$LIST_ONLY" -eq 1 ]; then
                echo "[$family] would clean ${#files[@]} file(s):"
                for f in "${files[@]}"; do echo "  - $(basename "$f")"; done
                continue
            fi

            case "$family" in
                ephemeral)
                    if [ "$KEEP_TMP" -eq 1 ] && [ "$ASSUME_YES" -ne 1 ] && [ -t 0 ]; then
                        if confirm_files "[$family] (--keep-tmp)" "${files[@]}"; then
                            delete_files "${files[@]}"
                            deleted=$((deleted + ${#files[@]}))
                            log_info "[$family] deleted ${#files[@]} file(s) (--keep-tmp)"
                        else
                            log_info "[$family] skipped"
                        fi
                    elif [ "$KEEP_TMP" -eq 1 ] && [ "$ASSUME_YES" -ne 1 ]; then
                        log_warn "[$family] --keep-tmp set but no TTY/-y: skipped (nothing auto-deleted)"
                    else
                        delete_files "${files[@]}"
                        deleted=$((deleted + ${#files[@]}))
                        log_info "[$family] deleted ${#files[@]} file(s) (no confirmation needed)"
                    fi
                    ;;
                *)
                    if [ "$ASSUME_YES" -eq 1 ]; then
                        delete_files "${files[@]}"
                        deleted=$((deleted + ${#files[@]}))
                        log_info "[$family] deleted ${#files[@]} file(s) (-y)"
                    elif [ -t 0 ]; then
                        if confirm_files "[$family]" "${files[@]}"; then
                            delete_files "${files[@]}"
                            deleted=$((deleted + ${#files[@]}))
                            log_info "[$family] deleted ${#files[@]} file(s)"
                        else
                            log_info "[$family] skipped"
                        fi
                    else
                        log_warn "[$family] ${#files[@]} file(s) need confirmation; rerun with a TTY or -y"
                    fi
                    ;;
            esac
        done
    done

    if [ "$LIST_ONLY" -eq 1 ]; then
        log_info "List-only mode — nothing deleted"
    elif [ "$ephemeral_deleted" -gt 0 ]; then
        log_info "Done. $((deleted - ephemeral_deleted)) file(s) deleted by your selection, plus $ephemeral_deleted ephemeral tmpN.md file(s) auto-cleaned by convention ($deleted total)."
    else
        log_info "Done. $deleted file(s) deleted."
    fi
    exit 0
}

main "$@"
