#!/usr/bin/env bats
# Tests for roadmap-parse.sh

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup
  SCRIPT="$DEVENV_ROOT/tools/scripts/roadmap-parse.sh"
  WORK_DIR=$(mktemp -d)
  ROADMAP="$WORK_DIR/roadmap.md"
  cat > "$ROADMAP" << 'MD'
# Roadmap: Test System

## Phases

### PHASE-01: Foundation

## Steps

### STEP-01: Build the thing

**Status**: 🟡 In progress — 3/10 tasks (30%)
**Issues**: workinprogress-ai/service.foo#101
**Component**: `service.foo`
**Depends on**: None

<One paragraph.>

---

### STEP-02: Add events

**Status**: ⬜ Not started
**Issues**: workinprogress-ai/service.foo#102
service.bar#205
#999
**Component**: `service.bar`
**Depends on**: [STEP-01](#step-01-build-the-thing)

<One paragraph.>
MD
}

teardown() { rm -rf "$WORK_DIR"; }

@test "parses steps with phase, title, status" {
  run bash "$SCRIPT" "$ROADMAP" --org workinprogress-ai
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '[.steps[].step] | join(",")')" = "STEP-01,STEP-02" ]
  [ "$(echo "$output" | jq -r '[.steps[].phase] | unique | join(",")')" = "PHASE-01" ]
  [ "$(echo "$output" | jq -r '.steps[1].title')" = "Add events" ]
}

@test "canonicalizes bare #N and repo#N refs to org/repo#N" {
  run bash "$SCRIPT" "$ROADMAP" --org workinprogress-ai
  [ "$status" -eq 0 ]
  [[ "$output" == *'"workinprogress-ai/service.foo#101"'* ]]
  [[ "$output" == *'"workinprogress-ai/service.foo#102"'* ]]
  [[ "$output" == *'"workinprogress-ai/service.bar#205"'* ]]
}

@test "bare #N without --repo is flagged UNRESOLVED" {
  run bash "$SCRIPT" "$ROADMAP" --org workinprogress-ai
  [ "$status" -eq 0 ]
  [[ "$output" == *'UNRESOLVED:#999'* ]]
}

@test "STEP-02 extracts both issues and the STEP-01 dependency" {
  run bash "$SCRIPT" "$ROADMAP" --org workinprogress-ai
  [ "$status" -eq 0 ]
  local step2
  step2=$(echo "$output" | jq -c '.steps[] | select(.step == "STEP-02")')
  [ "$(echo "$step2" | jq -r '.issues | length')" -eq 3 ]
  [ "$(echo "$step2" | jq -r '.dependencies[0]')" = "STEP-01" ]
}

@test "STEP-01 status is preserved from the artifact" {
  run bash "$SCRIPT" "$ROADMAP" --org workinprogress-ai
  [ "$status" -eq 0 ]
  local step1
  step1=$(echo "$output" | jq -c '.steps[] | select(.step == "STEP-01")')
  [[ "$(echo "$step1" | jq -r '.status')" == *"In progress"* ]]
}

@test "missing roadmap file exits 1" {
  run bash "$SCRIPT" "$WORK_DIR/nope.md"
  [ "$status" -eq 1 ]
}
