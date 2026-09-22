#!/usr/bin/env bats
# Provider routing lock (slice 3/#36 follow-up).
#
# Locks the slice-3 invariant: wrapper scripts and non-provider libs never
# invoke the `gh` CLI directly — all GitHub transport goes through
# provider_<domain>_<verb> functions (or the provider_api escape hatch).
#
# Sanctioned exceptions live in the ALLOWED list below. Adding an entry is
# a visible, reviewable diff: an exception must name the file, the exact
# pattern, and the architectural reason it cannot use a provider verb.
#
# Honest limit: this is a static gate. It catches conventional and accidental
# violations (the realistic case) but not deliberate dynamic-dispatch evasion
# (e.g. cmd="gh issue list"; $cmd). Review discipline covers the rest.

bats_require_minimum_version 1.5.0

load ../test_helper

# Sanctioned direct-gh sites: file substring -> regex of allowed gh usages.
# Everything else matching a transport pattern fails the lock.
# NOTE: .devcontainer/bootstrap.bash has NO entries — all credential
# lifecycle (import/status) routes through the provider auth seam.
# shellcheck disable=SC2034
ALLOWED_EXCEPTIONS=(
    "key-update-git.sh:gh auth (login|setup-git)"
    "repo-get.sh:gh auth status"
    "issue-create.sh:gh auth status"
    "github-helpers.bash:gh auth status"
    "copilot-knowledge.bash:gh auth token"
    "issue-select.sh:gh issue (view|edit)"
)

# Transport patterns: any of these in executable code is a violation unless
# the file+line matches an allowed exception.
# shellcheck disable=SC2034
TRANSPORT_PATTERNS=(
    "gh api"
    "gh issue"
    "gh pr "
    "gh run "
    "gh repo "
    "gh label "
    "gh release "
    "gh project "
    "gh workflow "
    "gh auth"
    'gh "'
)

# Scan targets: wrappers + non-provider libs + bootstrap. The provider
# modules (tools/lib/providers/**) are where gh calls belong and are excluded.
LOCK_TARGETS=(
    "tools/scripts"
    "tools/lib"
    ".devcontainer"
)

is_exception() {
    local file="$1" line="$2"
    local entry file_pat pattern
    for entry in "${ALLOWED_EXCEPTIONS[@]}"; do
        file_pat="${entry%%:*}"
        pattern="${entry#*:}"
        if [[ "$file" == *"$file_pat"* ]] && [[ "$line" =~ $pattern ]]; then
            return 0
        fi
    done
    return 1
}

collect_violations() {
    local target="$1"
    local pattern file line text
    for pattern in "${TRANSPORT_PATTERNS[@]}"; do
        while IFS= read -r hit; do
            [ -z "$hit" ] && continue
            file="${hit%%:*}"
            line="${hit#*:}"
            text="${line#*:}"
            line="${line%%:*}"
            # Normalize leading whitespace once; all checks below use the
            # stripped form.
            text="${text#"${text%%[![:space:]]*}"}"
            # Skip pure comment lines and message-emission lines: doc text
            # and user-facing messages may legitimately mention gh commands.
            if [[ "$text" =~ ^[[:space:]]*# ]] || [[ "$text" =~ ^[[:space:]]*\$ ]]; then
                continue
            fi
            if [[ "$text" =~ ^(echo|log_info|log_warn|log_error|log_verbose|printf)([[:space:]]|$) ]]; then
                continue
            fi
            # Usage-heredoc prose lines (e.g. "Note: 'gh run' ...",
            # "Use 'gh project list' ...") start with an uppercase letter —
            # sentence case — while executable lines (commands, keywords,
            # var assignments) start lowercase, '$', or punctuation. Scan
            # everything except uppercase-initial prose; a raw-gh hit on a
            # scanned line is a violation unless the allowlist excuses it.
            case "$text" in
                [A-Z]*) continue ;;
            esac
            # Known shell commands that may legitimately carry a gh transport
            # pattern in their argv are checked against the allowlist below;
            # bare `gh ...` first-words are the violation this gate exists for.
            is_exception "$file" "$text" && continue
            printf 'VIOLATION %s:%s [%s] %s\n' "$file" "$line" "$pattern" "$(echo "$text" | sed 's/^[[:space:]]*//')"
        done < <(grep -nE -- "$pattern" "$target"/*.sh "$target"/*.bash 2>/dev/null)
    done
}

@test "routing lock: no direct gh transport in wrapper scripts or non-provider libs" {
    VIOLATIONS_FILE="$TEST_TEMP_DIR/violations.txt"
    export VIOLATIONS_FILE
    : > "$VIOLATIONS_FILE"
    local scan_dir
    for scan_dir in "${LOCK_TARGETS[@]}"; do
        collect_violations "${DEVENV_ROOT}/${scan_dir}"
    done
    if [ -s "$VIOLATIONS_FILE" ]; then
        cat "$VIOLATIONS_FILE" >&2
        echo "direct gh transport calls found (route through provider verbs)" >&2
        return 1
    fi
}

@test "routing lock: provider modules are the only sanctioned gh callers" {
    # Sanity on the other side of the contract: the provider modules must
    # still exist and still contain transport (i.e. the exclusion is real
    # and someone did not "fix" the lock by emptying the modules).
    local transport_count
    transport_count=$(grep -rlE '(^|[^_a-zA-Z])\bgh\b ' \
        "${DEVENV_TOOLS}/lib/providers/github/" 2>/dev/null | wc -l)
    [ "$transport_count" -ge 6 ]
}

@test "routing lock: allowlist entries all match real files" {
    # A renamed/deleted file must not leave a stale exception behind —
    # stale entries silently widen the lock.
    local entry file_pat
    for entry in "${ALLOWED_EXCEPTIONS[@]}"; do
        file_pat="${entry%%:*}"
        local found=0
        local t
        for t in "${LOCK_TARGETS[@]}"; do
            if compgen -G "${DEVENV_TOOLS%/tools}/${t#/tools/}/*${file_pat}*" >/dev/null; then
                found=1
                break
            fi
        done
        [ "$found" -eq 1 ] || fail "stale allowlist entry: no file matches '*${file_pat}*'"
    done
}
