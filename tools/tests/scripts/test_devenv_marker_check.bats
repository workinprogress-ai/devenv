#!/usr/bin/env bats
# Tests for devenv-marker-check.sh

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup
  WORK_DIR=$(mktemp -d)
  SCRIPT="$DEVENV_ROOT/tools/scripts/devenv-marker-check.sh"
}

teardown() {
  rm -rf "$WORK_DIR"
}

write_file() {
  printf '%s\n' "$2" > "$WORK_DIR/$1"
}

# ---------------------------------------------------------------------------
# Gate mode (default): plan-bounded FIXME(DEVENV[...]) blocks; cross-plan
# TODO(DEVENV[...]) is sanctioned to ship and must NOT block.
# ---------------------------------------------------------------------------

@test "gate mode: FIXME(DEVENV[ marker fails the gate" {
  write_file "a.cs" "// FIXME(DEVENV[Plan-issue-1-001]): temporary stub"
  run bash "$SCRIPT" "$WORK_DIR"
  [ "$status" -eq 1 ]
}

@test "gate mode: condition-bearing TODO(DEVENV[ marker does NOT block" {
  write_file "a.cs" "// TODO(DEVENV[Plan-issue-1-001]): swap provider — remove when #40 is merged"
  run bash "$SCRIPT" "$WORK_DIR"
  [ "$status" -eq 0 ]
}

@test "gate mode: clean tree passes" {
  write_file "a.cs" "int x = 1;"
  run bash "$SCRIPT" "$WORK_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Clean:"* ]]
}

# ---------------------------------------------------------------------------
# --all audit mode: FIXME, TODO, and legacy bare forms are all reported.
# ---------------------------------------------------------------------------

@test "--all: reports FIXME and TODO and legacy bare forms" {
  printf '// FIXME(DEVENV[p1]): a\n// TODO(DEVENV[p1]): b — remove when x\n// DEVENV[p1]: legacy bare\n' > "$WORK_DIR/a.cs"
  run bash "$SCRIPT" --all "$WORK_DIR"
  [ "$status" -eq 1 ]
  [[ "$output" == *"FIXME(DEVENV[p1]): a"* ]]
  [[ "$output" == *"TODO(DEVENV[p1]): b"* ]]
  [[ "$output" == *"DEVENV[p1]: legacy bare"* ]]
}

@test "--all: clean tree passes" {
  write_file "a.cs" "int x = 1;"
  run bash "$SCRIPT" --all "$WORK_DIR"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# --todo-report finder mode: lists TODOs, warns on missing discharge
# condition and malformed (no-plan-key) entries; always exit 0.
# ---------------------------------------------------------------------------

@test "--todo-report: lists conditioned TODO and exits 0 with no warning" {
  write_file "a.cs" "// TODO(DEVENV[p1]): swap provider — remove when #40 is merged"
  run bash "$SCRIPT" --todo-report "$WORK_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"TODO(DEVENV[p1]): swap provider"* ]]
  [[ "$output" != *"missing a discharge condition"* ]]
}

@test "--todo-report: warns when a TODO lacks a discharge condition" {
  write_file "a.cs" "// TODO(DEVENV[p1]): swap provider once #40 lands"
  run bash "$SCRIPT" --todo-report "$WORK_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"missing a discharge condition"* ]]
}

@test "--todo-report: warns on malformed TODO(DEVENV) without a plan key" {
  write_file "a.cs" "// TODO(DEVENV) Review for changes"
  run bash "$SCRIPT" --todo-report "$WORK_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"without a plan key"* ]]
}

@test "--todo-report: no markers yields a clean message" {
  write_file "a.cs" "int x = 1;"
  run bash "$SCRIPT" --todo-report "$WORK_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No scoped TODO(DEVENV markers found"* ]]
}

@test "--todo-report: FIXME(DEVENV markers are not reported" {
  write_file "a.cs" "// FIXME(DEVENV[p1]): stub"
  run bash "$SCRIPT" --todo-report "$WORK_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No scoped TODO(DEVENV markers found"* ]]
}

# ---------------------------------------------------------------------------
# Option interactions.
# ---------------------------------------------------------------------------

@test "--ac and --todo-report are mutually exclusive" {
  run bash "$SCRIPT" --ac --todo-report "$WORK_DIR"
  [ "$status" -eq 2 ]
  [[ "$output" == *"mutually exclusive"* ]]
}

@test "--all cannot be combined with finder modes" {
  run bash "$SCRIPT" --all --todo-report "$WORK_DIR"
  [ "$status" -eq 2 ]
  run bash "$SCRIPT" --all --ac "$WORK_DIR"
  [ "$status" -eq 2 ]
}

# ---------------------------------------------------------------------------
# Default noise-class exclusions (cache, node_modules, .git, repos) and the
# --no-exclude escape hatch for exhaustive audits.
# ---------------------------------------------------------------------------

@test "default gate skips markers under excluded dirs (cache/repos/node_modules/.git)" {
  mkdir -p "$WORK_DIR/src" "$WORK_DIR/cache/devenv" "$WORK_DIR/repos/devenv" "$WORK_DIR/node_modules/pkg" "$WORK_DIR/.git/hooks"
  write_file "src/a.cs" "// FIXME(DEVENV[p1]): real marker in scanned path"
  write_file "cache/devenv/a.cs" "// FIXME(DEVENV[p1]): cache clone copy"
  write_file "repos/devenv/a.cs" "// FIXME(DEVENV[p1]): repo clone copy"
  write_file "node_modules/pkg/a.cs" "// FIXME(DEVENV[p1]): vendored copy"
  write_file ".git/hooks/pre-commit" "// FIXME(DEVENV[p1]): vcs internals"
  run bash "$SCRIPT" "$WORK_DIR"
  [ "$status" -eq 1 ]
  [[ "$output" == *"src/a.cs"* ]]
  [[ "$output" != *"cache/devenv"* ]]
  [[ "$output" != *"repos/devenv"* ]]
  [[ "$output" != *"node_modules"* ]]
  [[ "$output" != *".git/"* ]]
}

@test "--todo-report also honors exclusions" {
  mkdir -p "$WORK_DIR/repos/devenv"
  write_file "repos/devenv/a.cs" "// TODO(DEVENV[p1]): clone copy — remove when x"
  run bash "$SCRIPT" --todo-report "$WORK_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No scoped TODO(DEVENV markers found"* ]]
}

@test "--no-exclude scans excluded dirs too" {
  mkdir -p "$WORK_DIR/cache/devenv"
  write_file "cache/devenv/a.cs" "// FIXME(DEVENV[p1]): cache clone copy"
  run bash "$SCRIPT" --no-exclude "$WORK_DIR"
  [ "$status" -eq 1 ]
  [[ "$output" == *"cache/devenv/a.cs"* ]]
}

@test "--no-exclude --all audits every form everywhere" {
  mkdir -p "$WORK_DIR/repos/devenv"
  write_file "repos/devenv/a.cs" "// TODO(DEVENV[p1]): clone copy — remove when x"
  run bash "$SCRIPT" --no-exclude --all "$WORK_DIR"
  [ "$status" -eq 1 ]
  [[ "$output" == *"TODO(DEVENV[p1]): clone copy"* ]]
}

@test "explicitly naming an excluded path still scans it" {
  mkdir -p "$WORK_DIR/repos/devenv"
  write_file "repos/devenv/a.cs" "// FIXME(DEVENV[p1]): explicit target"
  run bash "$SCRIPT" "$WORK_DIR/repos/devenv"
  [ "$status" -eq 1 ]
  [[ "$output" == *"explicit target"* ]]
}

@test "plain TODO/FIXME comments never match in any mode" {
  printf '// TODO: normal todo\n# FIXME: normal fixme\n// TODO no colon\n' > "$WORK_DIR/a.cs"
  run bash "$SCRIPT" "$WORK_DIR"
  [ "$status" -eq 0 ]
  run bash "$SCRIPT" --all "$WORK_DIR"
  [ "$status" -eq 0 ]
  run bash "$SCRIPT" --todo-report "$WORK_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No scoped TODO(DEVENV markers found"* ]]
}
