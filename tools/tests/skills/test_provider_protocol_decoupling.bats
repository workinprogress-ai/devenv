#!/usr/bin/env bats
# Provider protocol decoupling gate (slice 8/#37).
#
# Locks the D-008 invariant: skill bodies carry provider-neutral intent only.
# GitHub-specific transport tokens are confined to the protocol reference
# (provider-protocols/github.md), the neutral tool reference's sanctioned
# residue, and this test file.
#
# Skill bodies keep: wrapper NAMES, intent sentences, devenv-own paths.
# Skill bodies must NOT keep: invocation env prefixes, org hard-codes,
# config-file invocation details, credential-file paths.

bats_require_minimum_version 1.5.0

load ../test_helper

# Repo-relative scan targets: skill bodies + shared reference prose.
SCAN_TARGETS=(
    "copilot/skills/*/SKILL.md"
    "copilot/skills/common/references/*.md"
    "copilot/skills/_conventions.md"
    "copilot/copilot-instructions.md"
)

# Paths where GitHub transport detail is SANCTIONED (the protocol reference,
# the neutral tool reference, shared docs mirror, and this gate itself).
ALLOWED_PATHS=(
    "copilot/skills/_shared/references/provider-protocols/"
    "copilot/skills/_tools-reference.md"
    "copilot/skills/_shared/docs/"
    "tools/tests/skills/"
)

# Forbidden transport tokens in skill bodies.
FORBIDDEN_PATTERNS=(
    "GITHUB_REPO"
    "workinprogress-ai"
    "issues-config.yml"
    "provider_token.txt"
    "gh auth token"
    "gh auth login"
)

setup_file_list() {
    local all=""
    for t in "${SCAN_TARGETS[@]}"; do
        # Expand the glob directly (nullglob-safe: unmatched globs yield the
        # literal string, which compgen filters out below).
        for f in $t; do
            [ -f "$f" ] && all+="$f"$'\n'
        done
    done
    # filter out allowlisted paths
    local filtered=""
    while IFS= read -r f; do
        [ -z "$f" ] && continue
        local skip=0
        for a in "${ALLOWED_PATHS[@]}"; do
            if [[ "$f" == *"$a"* ]]; then skip=1; break; fi
        done
        [ "$skip" -eq 0 ] && filtered+="$f"$'\n'
    done <<< "$all"
    printf '%s' "$filtered"
}

@test "decoupling gate: scan targets resolve to a non-empty file list" {
    local files
    files=$(setup_file_list)
    [ "$(echo "$files" | grep -c .)" -ge 20 ]
}

# scan_violations: reads file paths on stdin, prints one VIOLATION line per
# offending line (a line matching several patterns is reported once). Comment
# lines are scanned like any other: the gate has no skip-comments carve-out.
scan_violations() {
    local f pat hit
    while IFS= read -r f; do
        [ -z "$f" ] && continue
        while IFS= read -r hit; do
            [ -z "$hit" ] && continue
            echo "VIOLATION $f: $hit"
        done < <(
            for pat in "${FORBIDDEN_PATTERNS[@]}"; do grep -n -- "$pat" "$f" 2>/dev/null; done | sort -t: -k1,1n -u
        )
    done
}

@test "decoupling gate: no forbidden transport tokens in skill bodies" {
    local violations
    violations=$(setup_file_list | scan_violations)
    if [ -n "$violations" ]; then
        printf '%s\n' "$violations" >&2
        echo "GitHub-specific transport tokens found in skill bodies (move to provider-protocols/github.md)" >&2
        return 1
    fi
}

@test "decoupling gate: copilot-instructions.md is actually scanned" {
    setup_file_list | grep -qx "copilot/copilot-instructions.md"
}

@test "decoupling gate: a line matching overlapping patterns is reported once" {
    local f="$BATS_TEST_TMPDIR/overlap.md"
    echo 'export GITHUB_REPO=workinprogress-ai/x' > "$f"
    local out
    out=$(echo "$f" | scan_violations)
    [ "$(echo "$out" | grep -c VIOLATION)" -eq 1 ]
}

@test "decoupling gate: a comment line is not exempt" {
    local f="$BATS_TEST_TMPDIR/comment.md"
    echo '# GITHUB_REPO is documented here' > "$f"
    [ "$(echo "$f" | scan_violations | grep -c VIOLATION)" -eq 1 ]
}

@test "decoupling gate: protocol references exist with required sections" {
    # Two-file contract: protocol-common.md (neutral) + per-provider transport
    local common="copilot/skills/_shared/references/protocol-common.md"
    local gh="copilot/skills/_shared/references/provider-protocols/github.md"
    local az="copilot/skills/_shared/references/provider-protocols/azure.md"
    [ -f "$common" ]
    [ -f "$gh" ]
    [ -f "$az" ]
    # Neutral contract carries the shared sections.
    grep -q "Provider Protocol" "$common"
    grep -q "Canonical recipes" "$common"
    grep -q "Prohibitions" "$common"
    # Each transport file carries its credential lifecycle + the fixed structure.
    grep -q "Credential lifecycle" "$gh"
    grep -q "Credential lifecycle" "$az"
    grep -q "Repository targeting" "$az"
    grep -q "Provider-visible behavior" "$az"
}
