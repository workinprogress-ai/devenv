#!/usr/bin/env bats
# Tests for config-read.sh

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup
  SCRIPT="$DEVENV_ROOT/tools/scripts/config-read.sh"
  WORK_DIR=$(mktemp -d)
  CONF="$WORK_DIR/devenv.config"
  printf '[copilot]\nengineering_repo=my-standards\nknowledge_subpath=${PROVIDER_ORG}/k/\n[workflows]\nstatus_workflow=A,B\n' > "$CONF"
}

teardown() { rm -rf "$WORK_DIR"; }

@test "reads a value by section and key" {
  run bash "$SCRIPT" copilot engineering_repo --config "$CONF"
  [ "$status" -eq 0 ]
  [ "$output" = "my-standards" ]
}

@test "expands template variables via the provider accessors" {
  # Expansion is accessor-fed (config -> seed): scope identity to a temp
  # seed root; env vars carry no identity.
  mkdir -p "$TEST_TEMP_DIR/ident/.setup"
  printf 'acme\n' > "$TEST_TEMP_DIR/ident/.setup/provider_org.txt"
  run env DEVENV_ROOT="$TEST_TEMP_DIR/ident" DEVENV_ROOT_SET=1 \
      bash "$SCRIPT" copilot knowledge_subpath --config "$CONF"
  [ "$status" -eq 0 ]
  [ "$output" = "acme/k/" ]
}

@test "returns the default when key is absent" {
  run bash "$SCRIPT" copilot nope "fallback" --config "$CONF"
  [ "$status" -eq 0 ]
  [ "$output" = "fallback" ]
}

@test "reads array-style values verbatim" {
  run bash "$SCRIPT" workflows status_workflow --config "$CONF"
  [ "$status" -eq 0 ]
  [ "$output" = "A,B" ]
}

@test "missing config file exits 1" {
  run bash "$SCRIPT" copilot engineering_repo --config "$WORK_DIR/none.config"
  [ "$status" -eq 1 ]
}

@test "missing section/key arguments exit 1" {
  run bash "$SCRIPT" copilot
  [ "$status" -eq 1 ]
}
