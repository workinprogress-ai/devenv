#!/usr/bin/env bats
# Tests for scripts/spec-dependency-check.sh

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPT="$BATS_TEST_DIRNAME/../../scripts/spec-dependency-check.sh"

setup() {
    test_helper_setup
}

teardown() {
    test_helper_teardown
}

# spec_file <name> <content...>: write a Specifications document, print its path
spec_file() {
    local path="$TEST_TEMP_DIR/$1"
    shift
    printf '%s\n' "$@" > "$path"
    echo "$path"
}

@test "spec-dependency-check.sh has valid bash syntax" {
    run bash -n "$SCRIPT"
    [ "$status" -eq 0 ]
}

@test "--help exits 0 and lists the checks" {
    run bash "$SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
    [[ "$output" == *"group-order"* ]]
}

@test "--version exits 0 and prints the version" {
    run bash "$SCRIPT" --version
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

@test "no arguments is a usage error (exit 2)" {
    run bash "$SCRIPT"
    [ "$status" -eq 2 ]
}

@test "an unknown option is a usage error (exit 2)" {
    run bash "$SCRIPT" --bogus
    [ "$status" -eq 2 ]
}

@test "a missing file is a usage error (exit 2)" {
    run bash "$SCRIPT" "$TEST_TEMP_DIR/absent.md"
    [ "$status" -eq 2 ]
}

@test "a consistent document is ok with its edge count" {
    f="$(spec_file ok.md '## SPEC-001' 'Dependencies: SPEC-002' '## SPEC-002' 'Dependencies:')"
    run bash "$SCRIPT" "$f"
    [ "$status" -eq 0 ]
    [ "$(jq -r '.ok' <<<"$output")" = "true" ]
    [ "$(jq -r '.edges' <<<"$output")" = "1" ]
}

@test "a dependency on an undefined SPEC-ID is an 'unknown' error (exit 1)" {
    f="$(spec_file unknown.md '## SPEC-001' 'Dependencies: SPEC-099')"
    run bash "$SCRIPT" "$f"
    [ "$status" -eq 1 ]
    [ "$(jq -r '.errors[0].type' <<<"$output")" = "unknown" ]
}

@test "a dependency cycle is reported (exit 1)" {
    f="$(spec_file cycle.md '## SPEC-001' 'Dependencies: SPEC-002' '## SPEC-002' 'Dependencies: SPEC-001')"
    run bash "$SCRIPT" "$f"
    [ "$status" -eq 1 ]
    [ "$(jq -r '[.errors[].type] | index("cycle") != null' <<<"$output")" = "true" ]
}

@test "a transitive cycle is reported" {
    f="$(spec_file tcycle.md '## SPEC-001' 'Dependencies: SPEC-002' '## SPEC-002' 'Dependencies: SPEC-003' '## SPEC-003' 'Dependencies: SPEC-001')"
    run bash "$SCRIPT" "$f"
    [ "$status" -eq 1 ]
    [ "$(jq -r '[.errors[].type] | index("cycle") != null' <<<"$output")" = "true" ]
}

@test "depending on an item in a later group is a 'group-order' error" {
    f="$(spec_file group.md '## SPEC-001' 'Group: 1' 'Dependencies: SPEC-002' '## SPEC-002' 'Group: 2')"
    run bash "$SCRIPT" "$f"
    [ "$status" -eq 1 ]
    [ "$(jq -r '.errors[0].type' <<<"$output")" = "group-order" ]
}

@test "depending on an item in an earlier group is fine" {
    f="$(spec_file group-ok.md '## SPEC-001' 'Group: 2' 'Dependencies: SPEC-002' '## SPEC-002' 'Group: 1')"
    run bash "$SCRIPT" "$f"
    [ "$status" -eq 0 ]
}

@test "multiple files resolve cross-file dependencies" {
    a="$(spec_file a.md '## SPEC-001' 'Dependencies: SPEC-002')"
    b="$(spec_file b.md '## SPEC-002')"
    run bash "$SCRIPT" "$a" "$b"
    [ "$status" -eq 0 ]
    [ "$(jq -r '.edges' <<<"$output")" = "1" ]
}

@test "the same cross-file dependency is unknown when the other file is not given" {
    a="$(spec_file a2.md '## SPEC-001' 'Dependencies: SPEC-002')"
    run bash "$SCRIPT" "$a"
    [ "$status" -eq 1 ]
}

@test "a document without any SPEC heading fails with a no-spec-ids error" {
    f="$(spec_file empty.md '# Just a title' 'no specs here')"
    run bash "$SCRIPT" "$f"
    [ "$status" -eq 1 ]
    [[ "$output" == *"no-spec-ids"* ]]
}

@test "a link to a SPEC without a heading warns on stderr but does not fail" {
    f="$(spec_file links.md '## SPEC-001' 'See [SPEC-077](#spec-077)')"
    run --separate-stderr bash "$SCRIPT" "$f"
    [ "$status" -eq 0 ]
    [[ "$stderr" == *"SPEC-077"* ]]
}

# ============================================================================
# Link anchors are compared against the generated heading slugs
# ============================================================================

@test "a link whose anchor matches the heading slug produces no warning" {
    f="$(spec_file anchor-ok.md '## SPEC-001: Order Intake' 'See [SPEC-001](#spec-001-order-intake)')"
    run --separate-stderr bash "$SCRIPT" "$f"
    [ "$status" -eq 0 ]
    [ -z "$stderr" ]
}

@test "a link to an existing SPEC with a wrong anchor warns about the anchor" {
    f="$(spec_file anchor-bad.md '## SPEC-001: Order Intake' 'See [SPEC-001](#completely-wrong)')"
    run --separate-stderr bash "$SCRIPT" "$f"
    [ "$status" -eq 0 ]
    [[ "$stderr" == *"completely-wrong"* ]]
}

@test "heading punctuation is dropped when slugging (colon, parentheses, slash)" {
    f="$(spec_file anchor-punct.md '## SPEC-002: Pay (card/cash) now!' 'See [SPEC-002](#spec-002-pay-cardcash-now)')"
    run --separate-stderr bash "$SCRIPT" "$f"
    [ -z "$stderr" ]
}

@test "a repeated heading gets the -1 suffix GitHub assigns" {
    f="$(spec_file anchor-dup.md '## SPEC-003: Same' '### SPEC-003: Same' 'See [SPEC-003](#spec-003-same-1)')"
    run --separate-stderr bash "$SCRIPT" "$f"
    [ -z "$stderr" ]
}

@test "an anchor wrong in case-only is accepted (anchors are lowercase slugs)" {
    f="$(spec_file anchor-case.md '## SPEC-004: Mixed Case' 'See [SPEC-004](#spec-004-mixed-case)')"
    run --separate-stderr bash "$SCRIPT" "$f"
    [ -z "$stderr" ]
}
