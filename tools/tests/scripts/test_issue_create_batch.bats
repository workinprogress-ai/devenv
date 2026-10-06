#!/usr/bin/env bats
# issue-create-batch.sh: characterization of how an issue entry becomes an
# `issue-create` command, in both input modes (fast --issue entries and
# --file manifests). The preview prints the assembled command per issue; with
# --create a stand-in `issue-create` records its arguments and the body file's
# content. gh/yq-independent apart from the manifest parser.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    SCRIPT="$PROJECT_ROOT/tools/scripts/issue-create-batch.sh"
    mkdir -p "$TEST_TEMP_DIR/bin"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$TEST_TEMP_DIR/bin/gh"
    # issue-create stand-in: log argv (one per line) and the body file content.
    cat > "$TEST_TEMP_DIR/bin/issue-create" <<'STUB'
#!/usr/bin/env bash
{ echo "CALL"; printf 'ARG:%s\n' "$@"; } >> "$CREATE_LOG"
prev=""
for a in "$@"; do
    [ "$prev" = "--body-file" ] && { echo "BODY<<"; cat "$a"; echo ">>BODY"; } >> "$CREATE_LOG"
    prev="$a"
done
if [ -n "${FAKE_CREATE_OUT:-}" ]; then printf '%b\n' "$FAKE_CREATE_OUT"; else echo "https://example.invalid/test/repo/issues/$RANDOM"; fi
STUB
    chmod +x "$TEST_TEMP_DIR/bin/gh" "$TEST_TEMP_DIR/bin/issue-create"
    export CREATE_LOG="$TEST_TEMP_DIR/create.log"
    : > "$CREATE_LOG"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
    export DEVENV_REPO="test-org/test-repo"
    unset GH_ORG
}

# Preview output with the per-run temp directory made stable.
norm() { sed -E 's#[^ |]*/issue-create-batch\.[A-Za-z0-9]+/#<TMP>/#g'; }

preview() { run bash "$SCRIPT" "$@"; }

@test "fast: every field becomes the right option, in order" {
    preview --issue "First thing|type=Bug|parent=12|labels=a,b|assignees=u1|blocked_by=7,9|milestone=M1|project=P1|size=M|target=2026-Q1"
    [ "$status" -eq 0 ]
    [ "$(printf '%s\n' "$output" | norm | sed -n 2p)" = "0|fast|First thing|issue-create --title First thing --type Bug --body-file <TMP>/issue-0-body.md --no-template --parent 12 --milestone M1 --project P1 --label a --label b --assignee u1 --blocked-by 7 --blocked-by 9" ]
}

@test "fast: command-line defaults fill what an entry leaves out, and entries override them" {
    preview --type Task --parent 5 --milestone MD --project PD --label dl --assignee da --blocked-by 1 \
        --issue "Plain" --issue "Own|type=Bug|parent=6|milestone=MO|project=PO|labels=ol|assignees=oa|blocked_by=2"
    [ "$status" -eq 0 ]
    [ "$(printf '%s\n' "$output" | norm | sed -n 2p)" = "0|fast|Plain|issue-create --title Plain --type Task --body-file <TMP>/issue-0-body.md --no-template --parent 5 --milestone MD --project PD --label dl --assignee da --blocked-by 1" ]
    [ "$(printf '%s\n' "$output" | norm | sed -n 3p)" = "1|fast|Own|issue-create --title Own --type Bug --body-file <TMP>/issue-1-body.md --no-template --parent 6 --milestone MO --project PO --label ol --assignee oa --blocked-by 2" ]
}

@test "fast: an inline body is written to the body file" {
    run bash "$SCRIPT" --create --type Task --issue "With body|body=Hello there"
    grep -qx "Hello there" "$CREATE_LOG"
}

@test "fast: with no body a generated body is written, carrying the title" {
    run bash "$SCRIPT" --create --type Task --issue "No body given|size=L|target=2026-Q2"
    sed -n '/^BODY<</,/^>>BODY/p' "$CREATE_LOG" | grep -q "No body given"
}

@test "fast: an existing body_file is used as it is" {
    printf 'from a file\n' > "$TEST_TEMP_DIR/mine.md"
    preview --type Task --issue "Filed|body_file=$TEST_TEMP_DIR/mine.md"
    [ "$status" -eq 0 ]
    [[ "$output" == *"--body-file $TEST_TEMP_DIR/mine.md --no-template"* ]]
}

@test "fast: a missing body_file is refused naming the issue and the file" {
    preview --type Task --issue "Filed|body_file=$TEST_TEMP_DIR/nope.md"
    [ "$status" -ne 0 ]
    [[ "$output" == *"Issue[0] body_file not found: $TEST_TEMP_DIR/nope.md"* ]]
}

@test "fast: missing type, unsupported key and missing title are each refused" {
    preview --issue "No type"
    [ "$status" -ne 0 ]
    [[ "$output" == *"Issue[0] missing type"* ]]
    preview --type Task --issue "Odd|colour=red"
    [ "$status" -ne 0 ]
    [[ "$output" == *"Unsupported key in --issue entry: colour"* ]]
    preview --type Task --issue "|labels=x"
    [ "$status" -ne 0 ]
    [[ "$output" == *"--issue entry must include a title"* ]]
}

@test "fast: a missing type is reported before a missing body_file" {
    preview --issue "Both wrong|body_file=$TEST_TEMP_DIR/nope.md"
    [ "$status" -ne 0 ]
    [[ "$output" == *"missing type"* ]]
    [[ "$output" != *"body_file not found"* ]]
}

write_manifest() {
    cat > "$TEST_TEMP_DIR/m.yaml" <<'YAML'
defaults:
  type: Task
  milestone: M9
  labels: [x, y]
  body: "Default body"
issues:
  - title: One
    parent: 3
  - title: Two
    type: Bug
    assignees: [al]
    body: "Own body"
YAML
}

@test "manifest: item beats manifest defaults beats command-line defaults" {
    write_manifest
    preview --file "$TEST_TEMP_DIR/m.yaml" --type Epic --milestone CLI --project PCLI
    [ "$status" -eq 0 ]
    [ "$(printf '%s\n' "$output" | norm | sed -n 2p)" = "0|manifest|One|issue-create --title One --type Task --body-file <TMP>/issue-0-body.md --no-template --parent 3 --milestone M9 --project PCLI --label x --label y" ]
    [ "$(printf '%s\n' "$output" | norm | sed -n 3p)" = "1|manifest|Two|issue-create --title Two --type Bug --body-file <TMP>/issue-1-body.md --no-template --milestone M9 --project PCLI --label x --label y --assignee al" ]
}

@test "manifest: item body beats the manifest default body, and both reach the body file" {
    write_manifest
    run bash "$SCRIPT" --create --continue-on-error --file "$TEST_TEMP_DIR/m.yaml"
    grep -qx "Default body" "$CREATE_LOG"
    grep -qx "Own body" "$CREATE_LOG"
}

@test "manifest: a body_file from the manifest defaults is used" {
    printf 'manifest-wide\n' > "$TEST_TEMP_DIR/wide.md"
    printf 'defaults:\n  type: Task\n  body_file: %s\nissues:\n  - title: One\n' "$TEST_TEMP_DIR/wide.md" > "$TEST_TEMP_DIR/m2.yaml"
    preview --file "$TEST_TEMP_DIR/m2.yaml"
    [ "$status" -eq 0 ]
    [[ "$output" == *"--body-file $TEST_TEMP_DIR/wide.md --no-template"* ]]
}

@test "manifest: a missing body_file is refused naming the issue and the file" {
    printf 'defaults:\n  type: Task\nissues:\n  - title: One\n    body_file: %s\n' "$TEST_TEMP_DIR/nope.md" > "$TEST_TEMP_DIR/m3.yaml"
    preview --file "$TEST_TEMP_DIR/m3.yaml"
    [ "$status" -ne 0 ]
    [[ "$output" == *"Issue[0] body_file not found: $TEST_TEMP_DIR/nope.md"* ]]
}

@test "manifest: a missing type is reported before a missing body_file" {
    printf 'issues:\n  - title: One\n    body_file: %s\n' "$TEST_TEMP_DIR/nope.md" > "$TEST_TEMP_DIR/m4.yaml"
    preview --file "$TEST_TEMP_DIR/m4.yaml"
    [ "$status" -ne 0 ]
    [[ "$output" == *"missing type"* ]]
    [[ "$output" != *"body_file not found"* ]]
}

@test "manifest: a missing title is reported before a missing body_file" {
    printf 'defaults:\n  type: Task\nissues:\n  - labels: [a]\n    body_file: %s\n' "$TEST_TEMP_DIR/nope.md" > "$TEST_TEMP_DIR/m5.yaml"
    preview --file "$TEST_TEMP_DIR/m5.yaml"
    [ "$status" -ne 0 ]
    [[ "$output" == *"missing title"* ]]
    [[ "$output" != *"body_file not found"* ]]
}

@test "--continue-on-error skips a bad entry and still creates the rest" {
    run bash "$SCRIPT" --create --continue-on-error --type Task --issue "|labels=x" --issue "Good one"
    [ "$(grep -c '^CALL' "$CREATE_LOG")" -eq 1 ]
    grep -qx "ARG:Good one" "$CREATE_LOG"
}


# ---------------------------------------------------------------------------
# --create: the creation result is read provider-neutrally. issue-create prints a
# URL on GitHub but a bare work-item id on Azure, and its log lines share the
# stream; the batch used to pattern-match "issues/<n>" through a function it never
# loaded, so every successful creation was reported as a parse failure (exit 1,
# inviting duplicate creations on retry).
# ---------------------------------------------------------------------------

@test "create: a GitHub issue URL result is a success with the number parsed" {
    FAKE_CREATE_OUT="https://github.com/acme/widgets/issues/321" run bash "$SCRIPT" --create --type Task --issue "One"
    [ "$status" -eq 0 ]
    [[ "$output" == *"0|321|One|https://github.com/acme/widgets/issues/321"* ]]
    [[ "$output" != *"could not parse"* ]]
}

@test "create: an Azure bare work-item id result is a success" {
    FAKE_CREATE_OUT="4821" run bash "$SCRIPT" --create --type Task --issue "One"
    [ "$status" -eq 0 ]
    [[ "$output" == *"0|4821|One|"* ]]
}

@test "create: an Azure work-item URL result is a success with the id parsed" {
    FAKE_CREATE_OUT="https://dev.azure.com/acme/proj/_workitems/edit/4821" run bash "$SCRIPT" --create --type Task --issue "One"
    [ "$status" -eq 0 ]
    [[ "$output" == *"0|4821|One|"* ]]
}

@test "create: log lines (even ones containing URLs) before the result do not masquerade as it" {
    FAKE_CREATE_OUT="[t] INFO: Created issue: https://github.com/acme/widgets/issues/9\n[t] WARN: see https://github.com/acme/widgets/issues/10\nhttps://github.com/acme/widgets/issues/42" \
        run bash "$SCRIPT" --create --type Task --issue "One"
    [ "$status" -eq 0 ]
    [[ "$output" == *"0|42|One|"* ]]
}

@test "create: output with no result line is still reported as a parse failure" {
    FAKE_CREATE_OUT="[t] INFO: nothing useful here" run bash "$SCRIPT" --create --type Task --issue "One"
    [ "$status" -ne 0 ]
    [[ "$output" == *"could not parse"* ]]
}

@test "create: a batch of successes exits 0 and reports each created issue once" {
    FAKE_CREATE_OUT="https://github.com/acme/widgets/issues/7" run bash "$SCRIPT" --create --type Task --issue "A" --issue "B"
    [ "$status" -eq 0 ]
    [[ "$output" == *"created=2 failed=0"* ]]
    [ "$(grep -c '^CALL' "$CREATE_LOG")" -eq 2 ]
}

@test "create: preview needs no provider seam (nothing is looked up)" {
    run bash "$SCRIPT" --type Task --issue "One"
    [ "$status" -eq 0 ]
    [[ "$output" != *"command not found"* ]]
}
