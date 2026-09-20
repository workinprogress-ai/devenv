#!/usr/bin/env bats
# Anti-drift guard for the self-root resolver headers (Plan-005).
#
# Canonical wrapper header (depth-2 files: tools/scripts/, tools/tests/):
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
#
# The old depth-probing block (_srl=… through unset _srl _srl_lib) must never
# reappear, and no depth-1-relative source line may return.

CANONICAL_LINE='source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"'
PROBE_LINE='[ -f "$_srl/../lib/self-root.bash" ] && _srl_lib="$_srl/../lib"'
DEPTH1_LINE='source "$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)/self-root.bash"'

SCRIPTS_DIR="${BATS_TEST_DIRNAME}/../../scripts"
TOOLS_DIR="${BATS_TEST_DIRNAME}/../../.."

@test "pattern setup: canonical header matches a known converted file" {
    local line
    line=$(grep -m1 "self-root.bash" "$SCRIPTS_DIR/issue-get.sh")
    [ "$line" = "$CANONICAL_LINE" ]
}

@test "pattern: every tools/scripts file with self-root uses the canonical line" {
    local bad=0
    while IFS= read -r -d '' f; do
        if ! grep -qF "$CANONICAL_LINE" "$f"; then
            echo "NON-CANONICAL HEADER: $f" >&2
            bad=$((bad + 1))
        fi
    done < <(find "$SCRIPTS_DIR" -maxdepth 1 -type f -exec grep -lZ "self-root.bash" {} +)
    [ "$bad" -eq 0 ]
}

@test "pattern: harness uses the canonical line" {
    grep -qF "$CANONICAL_LINE" "${BATS_TEST_DIRNAME}/../run-devenv-tests.sh"
}

@test "pattern: the old _srl depth probe is gone from all of tools/" {
    local hits
    hits=$(grep -rlF "$PROBE_LINE" "$TOOLS_DIR/tools" --exclude-dir=cache --exclude=test_selfroot_header_pattern.bats 2>/dev/null | wc -l)
    [ "$hits" -eq 0 ]
}

@test "pattern: no depth-1-relative source line in scripts/ or tests/" {
    local hits
    hits=$(grep -rlF "$DEPTH1_LINE" "$SCRIPTS_DIR" "${BATS_TEST_DIRNAME}/.." --exclude=test_selfroot_header_pattern.bats 2>/dev/null | wc -l)
    [ "$hits" -eq 0 ]
}

@test "lib files use devenv_self_root (their own canonical form), not the wrapper line" {
    local bad=0
    while IFS= read -r -d '' f; do
        if grep -qF "$CANONICAL_LINE" "$f"; then
            echo "WRAPPER HEADER IN LIB: $f" >&2
            bad=$((bad + 1))
        fi
    done < <(find "${BATS_TEST_DIRNAME}/../lib" -maxdepth 1 -name "*.bash" -not -name "self-root.bash" -print0)
    [ "$bad" -eq 0 ]
}
