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
    "copilot/copilot-instructions.md"
)

# Forbidden transport tokens in skill bodies.
FORBIDDEN_PATTERNS=(
    "GITHUB_REPO="
    "GITHUB_REPO"
    "GITHUB_REPO=workinprogress"
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

@test "decoupling gate: no forbidden transport tokens in skill bodies" {
    local violations=""
    while IFS= read -r f; do
        [ -z "$f" ] && continue
        for pat in "${FORBIDDEN_PATTERNS[@]}"; do
            while IFS= read -r hit; do
                [ -z "$hit" ] && continue
                # Skip comment lines — prose documentation of the gate itself.
                violations+="VIOLATION $f: $hit"$'\n'
            done < <(grep -n -- "$pat" "$f" 2>/dev/null)
        done
    done < <(setup_file_list)
    if [ -n "$violations" ]; then
        printf '%s\n' "$violations" >&2
        echo "GitHub-specific transport tokens found in skill bodies (move to provider-protocols/github.md)" >&2
        return 1
    fi
}

@test "decoupling gate: protocol reference exists with required sections" {
    local ref="copilot/skills/_shared/references/provider-protocols/github.md"
    [ -f "$ref" ]
    grep -q "Provider Protocol" "$ref"
    grep -q "Credential lifecycle" "$ref"
    grep -q "Canonical recipes" "$ref"
    grep -q "Prohibitions" "$ref"
}
