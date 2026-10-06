#!/usr/bin/env bats
# issue-select.sh forwards its documented filters to the issue listing.
# gh is stubbed (records every call); fzf is stubbed to select nothing.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    SCRIPT="$PROJECT_ROOT/tools/scripts/issue-select.sh"
    stub_dir="$(mktemp -d)"
    export STUB_DIR="$stub_dir"
    cat > "$stub_dir/gh" <<STUB
#!/usr/bin/env bash
echo "gh \$*" >> "$stub_dir/calls.log"
case "\$1 \$2" in
    "issue list") echo "[]" ;;
esac
exit 0
STUB
    printf '%s\n' '#!/usr/bin/env bash' 'cat >/dev/null' 'exit 130' > "$stub_dir/fzf"
    chmod +x "$stub_dir/gh" "$stub_dir/fzf"
    export PATH="$stub_dir:$PATH"
    export DEVENV_REPO="test-org/test-repo"
    unset GH_ORG
}

@test "issue-select passes its filters to the listing as options, not positionals" {
    run bash "$SCRIPT" --state closed --type Bug --label "good first issue" --milestone "Sprint 5"
    [[ "$output" != *"Unknown option"* ]]
    grep -q "issue list" "$STUB_DIR/calls.log"
    grep -q -- "--state closed" "$STUB_DIR/calls.log"
    grep -q -- "--type Bug" "$STUB_DIR/calls.log"
    grep -q -- "--label good first issue" "$STUB_DIR/calls.log"
    grep -q -- "--milestone Sprint 5" "$STUB_DIR/calls.log"
}

# The fzf preview must show the issue, not "Loading...". fzf runs the preview
# command with {1} replaced by the (quoted) first field of the highlighted
# line; that is "#123", and the preview goes through the real issue-get.

install_previewing_fzf() {
    cat > "$STUB_DIR/fzf" <<'FZF'
#!/usr/bin/env bash
# Stand-in for fzf's preview step: expand {1} the way fzf does, run the
# preview command, record what it printed, then "select" the first line.
preview=""
for a in "$@"; do case "$a" in --preview=*) preview="${a#--preview=}" ;; esac; done
line="$(head -n 1)"
first="$(printf '%s' "$line" | awk '{print $1}')"
cmd="${preview//\{1\}/\'$first\'}"
printf '%s' "$cmd" > "$PREVIEW_CMD_LOG"
bash -c "$cmd" > "$PREVIEW_OUT" 2>&1 || true
printf '%s\n' "$line"
FZF
    chmod +x "$STUB_DIR/fzf"
    export PREVIEW_OUT="$TEST_TEMP_DIR/preview.out" PREVIEW_CMD_LOG="$TEST_TEMP_DIR/preview.cmd"
    : > "$PREVIEW_OUT"
    # gh: one listed issue, and its details for `issue view`.
    cat > "$STUB_DIR/gh" <<GH
#!/usr/bin/env bash
echo "gh \$*" >> "$STUB_DIR/calls.log"
case "\$1 \$2" in
    "issue list") echo '[{"number":123,"title":"Fix login","labels":[],"state":"OPEN","updatedAt":"2026-01-01T00:00:00Z"}]' ;;
    "issue view") echo '{"number":123,"title":"Fix login","body":"Steps to reproduce here","state":"OPEN","labels":[],"assignees":[],"milestone":null,"author":{"login":"alice"},"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z","closedAt":null,"url":"https://example.invalid/123","comments":[]}' ;;
esac
exit 0
GH
    chmod +x "$STUB_DIR/gh"
    export PATH="$PROJECT_ROOT/tools:$PATH"
}

@test "issue-select's preview command shows the highlighted issue's details" {
    install_previewing_fzf
    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [ "$output" = "123" ]
    [ -s "$PREVIEW_OUT" ]
    [[ "$(cat "$PREVIEW_OUT")" == *"Fix login"* ]]
    [[ "$(cat "$PREVIEW_OUT")" == *"Steps to reproduce here"* ]]
    [[ "$(cat "$PREVIEW_OUT")" != *"Loading..."* ]]
}

@test "issue-select's preview command uses only options issue-get supports" {
    install_previewing_fzf
    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    run ! grep -q -- "--json" "$PREVIEW_CMD_LOG"
    [[ "$(cat "$PREVIEW_OUT")" != *"Unknown option"* ]]
}
