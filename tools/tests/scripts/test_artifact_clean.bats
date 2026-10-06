#!/usr/bin/env bats
# Tests for artifact-clean.sh

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup
  SCRIPT="$DEVENV_ROOT/tools/scripts/artifact-clean.sh"
  WORK_DIR=$(mktemp -d)
  mkdir -p "$WORK_DIR/repo/.local-artifacts"
  FOLDER="$WORK_DIR/repo/.local-artifacts"
  touch "$FOLDER/tmp1.md" "$FOLDER/tmp2.md" \
        "$FOLDER/session_memory-design.md" \
        "$FOLDER/Plan-issue-33-001.md" "$FOLDER/Roadmap-22.md" \
        "$FOLDER/random-notes.md"
}

teardown() {
  rm -rf "$WORK_DIR"
}

@test "--list reports all four families and deletes nothing" {
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null -l
  [ "$status" -eq 0 ]
  [[ "$output" == *"[ephemeral] would clean 2"* ]]
  [[ "$output" == *"[session] would clean 1"* ]]
  [[ "$output" == *"[working] would clean 2"* ]]
  [[ "$output" == *"[other] would clean 1"* ]]
  [ -f "$FOLDER/tmp1.md" ]
}

@test "--tmp deletes ephemeral files without confirmation, nothing else" {
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null --tmp
  [ "$status" -eq 0 ]
  [ ! -f "$FOLDER/tmp1.md" ]
  [ ! -f "$FOLDER/tmp2.md" ]
  [ -f "$FOLDER/session_memory-design.md" ]
  [ -f "$FOLDER/Plan-issue-33-001.md" ]
}

@test "--working -y deletes working copies only" {
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null --working -y
  [ "$status" -eq 0 ]
  [ ! -f "$FOLDER/Plan-issue-33-001.md" ]
  [ ! -f "$FOLDER/Roadmap-22.md" ]
  [ -f "$FOLDER/tmp1.md" ]
  [ -f "$FOLDER/random-notes.md" ]
}

@test "--working without -y and without TTY refuses to delete" {
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null --working
  [ "$status" -eq 0 ]
  [[ "$output" == *"need confirmation"* ]]
  [ -f "$FOLDER/Plan-issue-33-001.md" ]
}

@test "--all -y clears every family including other" {
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null --all -y
  [ "$status" -eq 0 ]
  [ -z "$(ls -A "$FOLDER")" ]
}

@test "no flags with no TTY defaults to list-only (never prompts, never deletes)" {
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"list-only"* ]]
  [ -f "$FOLDER/tmp1.md" ]
  [ -f "$FOLDER/random-notes.md" ]
}

@test "path without an artifact folder exits 2" {
  mkdir -p "$WORK_DIR/plain"
  run bash "$SCRIPT" "$WORK_DIR/plain"
  [ "$status" -eq 2 ]
}

@test "accepts the .local-artifacts folder itself as target" {
  run bash "$SCRIPT" "$FOLDER" -l < /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"[ephemeral] would clean 2"* ]]
}

@test "unknown option exits 2 (canonical invalid-args contract)" {
  run bash "$SCRIPT" --bogus "$WORK_DIR/repo" < /dev/null
  [ "$status" -eq 2 ]
}

@test "--version prints version" {
  run bash "$SCRIPT" --version < /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

@test "interactive with fzf: selected working copy deleted, rest untouched, ephemeral auto-cleaned" {
  # Fake fzf that "selects" the Plan working copy entry (label<TAB>path).
  mkdir -p "$TEST_TEMP_DIR/bin"
  cat > "$TEST_TEMP_DIR/bin/fzf" <<'EOF'
#!/usr/bin/env bash
while IFS= read -r line; do
  case "$line" in
    *"Plan-issue-33-001.md"*) printf '%s\n' "$line" ;;
  esac
done
EOF
  chmod +x "$TEST_TEMP_DIR/bin/fzf"
  # --interactive explicitly: bats --jobs workers have no TTY, so the
  # default-mode TTY heuristic would otherwise pick list-only.
  run env PATH="$TEST_TEMP_DIR/bin:$PATH" bash "$SCRIPT" --interactive "$WORK_DIR/repo" < /dev/null
  [ "$status" -eq 0 ]
  # Ephemeral cleaned without confirmation
  [ ! -f "$FOLDER/tmp1.md" ]
  [ ! -f "$FOLDER/tmp2.md" ]
  # Selected working copy deleted
  [ ! -f "$FOLDER/Plan-issue-33-001.md" ]
  # Everything else untouched
  [ -f "$FOLDER/session_memory-design.md" ]
  [ -f "$FOLDER/Roadmap-22.md" ]
  [ -f "$FOLDER/random-notes.md" ]
  [[ "$output" =~ "Deleted 1 selected file(s)" ]]
}

@test "interactive with fzf: empty selection deletes nothing beyond ephemeral" {
  mkdir -p "$TEST_TEMP_DIR/bin"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$TEST_TEMP_DIR/bin/fzf"
  chmod +x "$TEST_TEMP_DIR/bin/fzf"
  run env PATH="$TEST_TEMP_DIR/bin:$PATH" bash "$SCRIPT" --interactive "$WORK_DIR/repo" < /dev/null
  [ "$status" -eq 0 ]
  [ ! -f "$FOLDER/tmp1.md" ]
  [ -f "$FOLDER/Plan-issue-33-001.md" ]
  [ -f "$FOLDER/random-notes.md" ]
  [[ "$output" =~ "No files selected" ]]
}

@test "interactive without fzf and without TTY defaults to list-only (never deletes)" {
  run env PATH="/usr/bin:/bin" bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null
  [ "$status" -eq 0 ]
  [ -f "$FOLDER/tmp1.md" ]
  [[ "$output" =~ "list-only" ]]
}

@test "fzf invocation carries multi-select and content-preview contract" {
  # Capture the fzf invocation args to assert the UI contract: multi-select
  # on, label-only display, and a preview that cats the real file (field 2).
  mkdir -p "$TEST_TEMP_DIR/bin"
  cat > "$TEST_TEMP_DIR/bin/fzf" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CAPTURE_FILE"
exit 0
EOF
  chmod +x "$TEST_TEMP_DIR/bin/fzf"
  run env PATH="$TEST_TEMP_DIR/bin:$PATH" CAPTURE_FILE="$TEST_TEMP_DIR/fzf-args.txt" bash "$SCRIPT" --interactive "$WORK_DIR/repo" < /dev/null
  [ "$status" -eq 0 ]
  grep -q -- "--preview=cat {2}" "$TEST_TEMP_DIR/fzf-args.txt"
  grep -q -- "--multi" "$TEST_TEMP_DIR/fzf-args.txt"
  grep -q -- "--with-nth=1" "$TEST_TEMP_DIR/fzf-args.txt"
}

@test "--keep-tmp interactive: ephemeral files offered in the picker instead of auto-deleted" {
  mkdir -p "$TEST_TEMP_DIR/bin"
  cat > "$TEST_TEMP_DIR/bin/fzf" <<'EOF'
#!/usr/bin/env bash
# Select nothing — assert only that nothing was auto-deleted
exit 0
EOF
  chmod +x "$TEST_TEMP_DIR/bin/fzf"
  run env PATH="$TEST_TEMP_DIR/bin:$PATH" bash "$SCRIPT" --interactive --keep-tmp "$WORK_DIR/repo" < /dev/null
  [ "$status" -eq 0 ]
  # Ephemeral files survived — the override held
  [ -f "$FOLDER/tmp1.md" ]
  [ -f "$FOLDER/tmp2.md" ]
  [[ "$output" =~ "--keep-tmp: ephemeral tmpN.md files included in the selection" ]]
  [[ "$output" =~ "No files selected" ]]
}

@test "--keep-tmp --tmp without TTY: refuses rather than silently deleting" {
  run bash "$SCRIPT" --keep-tmp --tmp "$WORK_DIR/repo" < /dev/null
  [ "$status" -eq 0 ]
  [ -f "$FOLDER/tmp1.md" ]
  [ -f "$FOLDER/tmp2.md" ]
  [[ "$output" =~ "skipped (nothing auto-deleted)" ]]
}

@test "--keep-tmp --tmp -y: still deletes (explicit confirmation path)" {
  run bash "$SCRIPT" --keep-tmp --tmp -y "$WORK_DIR/repo" < /dev/null
  [ "$status" -eq 0 ]
  [ ! -f "$FOLDER/tmp1.md" ]
  [ ! -f "$FOLDER/tmp2.md" ]
  # Working copies untouched — only the tmp family was targeted
  [ -f "$FOLDER/Plan-issue-33-001.md" ]
}

# ---------------------------------------------------------------------------
# Deliverables are retained work product, never cleanup fodder
# ---------------------------------------------------------------------------

make_deliverables() {
  touch "$FOLDER/research-001-claude-code-interop.md" \
        "$FOLDER/bug-hunt-azure-git-npm-auth.md" \
        "$FOLDER/TECH_DEBT_AUDIT.md"
}

@test "--all -y never deletes deliverables (research, bug-hunt, tech-debt audit)" {
  make_deliverables
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null --all -y
  [ "$status" -eq 0 ]
  [ -f "$FOLDER/research-001-claude-code-interop.md" ]
  [ -f "$FOLDER/bug-hunt-azure-git-npm-auth.md" ]
  [ -f "$FOLDER/TECH_DEBT_AUDIT.md" ]
  # The rest of the sweep still happens.
  [ ! -f "$FOLDER/random-notes.md" ]
  [ ! -f "$FOLDER/Plan-issue-33-001.md" ]
}

@test "the sweep says which deliverables it kept and how to include them" {
  make_deliverables
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null --all -y
  [ "$status" -eq 0 ]
  [[ "$output" == *"[deliverable] kept 3 protected file(s)"* ]]
  [[ "$output" == *"--include-deliverables"* ]]
}

@test "--list reports deliverables as protected, not as cleanable 'other'" {
  make_deliverables
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null -l
  [ "$status" -eq 0 ]
  [[ "$output" == *"[other] would clean 1"* ]]
  [[ "$output" == *"[deliverable] kept 3 protected file(s)"* ]]
  [ -f "$FOLDER/TECH_DEBT_AUDIT.md" ]
}

@test "--all -y --include-deliverables is the explicit override that deletes them" {
  make_deliverables
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null --all -y --include-deliverables
  [ "$status" -eq 0 ]
  [ ! -f "$FOLDER/research-001-claude-code-interop.md" ]
  [ ! -f "$FOLDER/bug-hunt-azure-git-npm-auth.md" ]
  [ ! -f "$FOLDER/TECH_DEBT_AUDIT.md" ]
}

@test "--include-deliverables alone does not delete without -y or a confirmation" {
  make_deliverables
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null --all --include-deliverables
  [ "$status" -eq 0 ]
  [ -f "$FOLDER/TECH_DEBT_AUDIT.md" ]
  [ -f "$FOLDER/random-notes.md" ]
}

@test "family-only sweeps (--working, --session, --tmp) leave deliverables alone" {
  make_deliverables
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null --tmp --session --working -y
  [ "$status" -eq 0 ]
  [ -f "$FOLDER/research-001-claude-code-interop.md" ]
  [ -f "$FOLDER/bug-hunt-azure-git-npm-auth.md" ]
  [ -f "$FOLDER/TECH_DEBT_AUDIT.md" ]
}

@test "pair's pairing-state files are session memory, swept with --session" {
  touch "$FOLDER/pairing-state-issue-7.md"
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null -l
  [[ "$output" == *"[session] would clean 2"* ]]
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null --session -y
  [ "$status" -eq 0 ]
  [ ! -f "$FOLDER/pairing-state-issue-7.md" ]
  [ ! -f "$FOLDER/session_memory-design.md" ]
}

@test "an unknown option is still rejected" {
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null --include-deliverable
  [ "$status" -eq 2 ]
}
