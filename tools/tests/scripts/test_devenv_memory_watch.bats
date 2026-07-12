#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPT_PATH="$DEVENV_TOOLS/scripts/devenv-memory-watch.sh"

@test "devenv-memory-watch.sh exists" {
  [ -f "$SCRIPT_PATH" ]
}

@test "devenv-memory-watch.sh is executable" {
  [ -x "$SCRIPT_PATH" ]
}

@test "devenv-memory-watch.sh has valid bash syntax" {
  run bash -n "$SCRIPT_PATH"
  [ "$status" -eq 0 ]
}

@test "devenv-memory-watch.sh exposes useful options" {
  run bash "$SCRIPT_PATH" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"--interval-minutes"* ]]
  [[ "$output" == *"--state-dir"* ]]
  [[ "$output" == *"--once"* ]]
}

@test "devenv-memory-watch.sh persists samples across runs" {
  state_dir="$TEST_TEMP_DIR/memory-watch-state"

  run bash "$SCRIPT_PATH" --once --state-dir "$state_dir" --max-processes 5 --top 3 --interval-minutes 1
  [ "$status" -eq 0 ]
  [[ "$output" == *"Captured sample #1"* ]]
  [[ -f "$state_dir/samples.tsv" ]]
  [[ -f "$state_dir/processes.tsv" ]]
  [[ -f "$state_dir/current-culprits.tsv" ]]

  run bash "$SCRIPT_PATH" --once --state-dir "$state_dir" --max-processes 5 --top 3 --interval-minutes 1
  [ "$status" -eq 0 ]
  [[ "$output" == *"Captured sample #2"* ]]
  [[ "$output" == *"Current culprit summary:"* ]]
}

@test "devenv-memory-watch.sh writes a current culprit summary" {
  state_dir="$TEST_TEMP_DIR/memory-watch-compact-state"

  run bash "$SCRIPT_PATH" --once --state-dir "$state_dir" --max-processes 5 --top 3 --interval-minutes 1
  [ "$status" -eq 0 ]
  [[ "$output" == *"Current culprit summary:"* ]]
  [[ "$output" == *"Top current culprit:"* ]]
  [[ "$output" != *"Likely culprits by RSS growth:"* ]]
  [[ "$output" != *"Largest current RSS consumers:"* ]]

  run head -n 2 "$state_dir/current-culprits.tsv"
  [ "$status" -eq 0 ]
  [[ "$output" == *$'rank\tlabel\tcurrent\tdelta\tpeak\tsamples\tfirst_sample\tlast_sample\tfirst_seen\tlast_seen\tsignature'* ]]
  [[ "$output" == *$'\n1\t'* ]]
}

@test "devenv-memory-watch.sh reset clears persisted history" {
  state_dir="$TEST_TEMP_DIR/memory-watch-reset-state"

  run bash "$SCRIPT_PATH" --once --state-dir "$state_dir" --max-processes 5 --top 3 --interval-minutes 1
  [ "$status" -eq 0 ]
  [[ "$output" == *"Captured sample #1"* ]]

  run bash "$SCRIPT_PATH" --once --state-dir "$state_dir" --reset --max-processes 5 --top 3 --interval-minutes 1
  [ "$status" -eq 0 ]
  [[ "$output" == *"Captured sample #1"* ]]
  run awk -F '\t' '$1 == "S" { count++ } END { print count + 0 }' "$state_dir/samples.tsv"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}
