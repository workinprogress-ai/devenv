#!/usr/bin/env bats
# issue-create.sh body handling, observed through --dry-run (which prints the
# final --body text). gh is stubbed so nothing leaves the machine.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    SCRIPT="$PROJECT_ROOT/tools/scripts/issue-create.sh"
    stub_dir="$(mktemp -d)"
    export STUB_DIR="$stub_dir"
    cat > "$stub_dir/gh" <<STUB
#!/usr/bin/env bash
echo "gh \$*" >> "$stub_dir/calls.log"
exit 0
STUB
    chmod +x "$stub_dir/gh"
    export PATH="$stub_dir:$PATH"
    export DEVENV_REPO="test-org/test-repo"
    unset GH_ORG
    # Backslash sequences that echo -e would turn into control characters.
    LITERAL_BODY='C:\new\table and \\server\share with a \n literal'
}

create_dry_run() {
    bash "$SCRIPT" --title "T" --type Task --no-interactive --dry-run "$@"
}

@test "--body keeps backslash sequences exactly as typed" {
    run create_dry_run --body "$LITERAL_BODY"
    [ "$status" -eq 0 ]
    [[ "$output" == *"$LITERAL_BODY"* ]]
}

@test "--body-file keeps backslash sequences exactly as written" {
    printf '%s\n' "$LITERAL_BODY" > "$TEST_TEMP_DIR/body.md"
    run create_dry_run --body-file "$TEST_TEMP_DIR/body.md"
    [ "$status" -eq 0 ]
    [[ "$output" == *"$LITERAL_BODY"* ]]
}

@test "--body-file - reads piped stdin and keeps backslash sequences" {
    run bash -c "printf '%s\n' '$LITERAL_BODY' | bash '$SCRIPT' --title T --type Task --no-interactive --dry-run --body-file -"
    [ "$status" -eq 0 ]
    [[ "$output" == *"$LITERAL_BODY"* ]]
}

@test "parent and blocked-by references become real lines, and the body stays literal" {
    run create_dry_run --parent 12 --blocked-by 7 --blocked-by 9 --body "$LITERAL_BODY"
    [ "$status" -eq 0 ]
    # Each reference is on its own line; the body follows after a blank line.
    [[ "$output" == *"Part of #12"$'\n\n'"Blocked by #7"$'\n'"Blocked by #9"$'\n\n'"$LITERAL_BODY"* ]]
}

@test "giving both --body and --body-file is a usage error" {
    printf 'x\n' > "$TEST_TEMP_DIR/body.md"
    run create_dry_run --body "text" --body-file "$TEST_TEMP_DIR/body.md"
    [ "$status" -eq 2 ]
    [[ "$output" == *"Only one"* ]]
}

@test "a missing --body-file is a usage error naming the file" {
    run create_dry_run --body-file "$TEST_TEMP_DIR/does-not-exist.md"
    [ "$status" -eq 2 ]
    [[ "$output" == *"does-not-exist.md"* ]]
}
