#!/usr/bin/env bats
# provider_issues_label_ensure on GitHub: it must see every label of a repository
# (gh label list stops at 30 unless asked for more) and compare names literally.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    mkdir -p "$TEST_TEMP_DIR/bin"
    export GH_CALL_LOG="$TEST_TEMP_DIR/gh.log"; : > "$GH_CALL_LOG"
    export LABELS_FILE="$TEST_TEMP_DIR/labels.txt"; : > "$LABELS_FILE"
    cat > "$TEST_TEMP_DIR/bin/gh" <<'STUB'
#!/usr/bin/env bash
printf 'gh %s\n' "$*" >> "$GH_CALL_LOG"
case "$*" in
    "label list"*) cat "$LABELS_FILE" ;;
    "label create"*) exit 0 ;;
esac
exit 0
STUB
    chmod +x "$TEST_TEMP_DIR/bin/gh"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
}

teardown() {
    test_helper_teardown
}

ensure() {
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        source '$DEVENV_TOOLS/lib/providers/github/repos.bash'
        source '$DEVENV_TOOLS/lib/providers/github/issues.bash'
        provider_issues_label_ensure o/r \"\$1\"
    " _ "$1"
}

@test "label_ensure asks gh for up to 1000 labels, not its default of 30" {
    ensure "bug"
    [ "$status" -eq 0 ]
    grep -q 'label list.*--limit 1000' "$GH_CALL_LOG"
}

@test "label_ensure does not create a label that already exists" {
    printf 'bug\nfeature\n' > "$LABELS_FILE"
    ensure "bug"
    [ "$status" -eq 0 ]
    run ! grep -q 'label create' "$GH_CALL_LOG"
}

@test "label_ensure creates a label that is absent" {
    printf 'bug\n' > "$LABELS_FILE"
    ensure "feature"
    [ "$status" -eq 0 ]
    grep -q 'label create feature' "$GH_CALL_LOG"
}

@test "label_ensure compares names literally: a.b is not matched by axb" {
    printf 'axb\n' > "$LABELS_FILE"
    ensure "a.b"
    [ "$status" -eq 0 ]
    grep -q 'label create a.b' "$GH_CALL_LOG"
}

@test "label_ensure does not read a name as a pattern: c++ and brackets are plain text" {
    printf 'c++\n[x]\n' > "$LABELS_FILE"
    ensure "c++"
    [ "$status" -eq 0 ]
    run ! grep -q 'label create' "$GH_CALL_LOG"
    : > "$GH_CALL_LOG"
    ensure "[x]"
    [ "$status" -eq 0 ]
    run ! grep -q 'label create' "$GH_CALL_LOG"
}

@test "label_ensure reports a listing failure instead of trying to create" {
    printf '#!/usr/bin/env bash\necho "gh $*" >> "$GH_CALL_LOG"\n[ "$1 $2" = "label list" ] && { echo "HTTP 403" >&2; exit 1; }\nexit 0\n' > "$TEST_TEMP_DIR/bin/gh"
    ensure "bug"
    [ "$status" -ne 0 ]
    run ! grep -q 'label create' "$GH_CALL_LOG"
}
