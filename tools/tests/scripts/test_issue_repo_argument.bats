#!/usr/bin/env bats
# issue-list.ts and issue-search.ts must hand the repo to the provider list
# verb exactly once, as the leading positional argument. The Azure provider
# consumes only that first positional, so a second copy reaches its flag loop
# and fails as an unknown option.

bats_require_minimum_version 1.5.0

load ../test_helper

REPO="Devenv-test/service.atlantis.claims"

# Runs the TS tool against a stubbed gh that records every argument it
# receives, pipe-joined, one call per line, in $ARGS_LOG.
run_ts_list_tool() {
  local tool="$1"; shift
  export ARGS_LOG="$TEST_TEMP_DIR/provider-args.log"
  : > "$ARGS_LOG"
  mkdir -p "$TEST_TEMP_DIR/bin"
  cat > "$TEST_TEMP_DIR/bin/gh" <<GHSTUB
#!/usr/bin/env bash
{ printf '%s|' "\$@"; printf '\n'; } >> "$ARGS_LOG"
case "\$*" in
  "issue list"*) echo '[]' ;;
  *) echo '{}' ;;
esac
GHSTUB
  chmod +x "$TEST_TEMP_DIR/bin/gh"
  run env PATH="$TEST_TEMP_DIR/bin:$PATH" DEVENV_REPO="$REPO" node "$tool" "$@"
  [ "$status" -eq 0 ] || { echo "tool failed: $output"; return 1; }
}

@test "issue-list passes the repo to the provider list verb exactly once, first" {
  run_ts_list_tool "$PROJECT_ROOT/tools/ts/issue-list.ts" --state all --limit 30
  [ "$status" -eq 0 ]
  grep -q "issue|list|-R|$REPO|" "$ARGS_LOG"
  [ "$(grep -o -- "-R|$REPO" "$ARGS_LOG" | wc -l)" -eq 1 ]
}

@test "issue-search passes the repo to the provider list verb exactly once, first" {
  run_ts_list_tool "$PROJECT_ROOT/tools/ts/issue-search.ts" term
  [ "$status" -eq 0 ]
  grep -q "issue|list|-R|$REPO|" "$ARGS_LOG"
  [ "$(grep -o -- "-R|$REPO" "$ARGS_LOG" | wc -l)" -eq 1 ]
}

@test "issue-list keeps its filter flags after the repo" {
  run_ts_list_tool "$PROJECT_ROOT/tools/ts/issue-list.ts" --state all --limit 30
  [ "$status" -eq 0 ]
  grep -q -- "--state|all" "$ARGS_LOG"
  grep -q -- "--limit|30" "$ARGS_LOG"
}
