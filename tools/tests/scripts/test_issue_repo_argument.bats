#!/usr/bin/env bats
# issue-list and issue-search must hand the repo to provider_issues_list exactly once, as the
# leading positional argument. The Azure provider consumes only that first positional, so a
# second copy reaches its flag loop and fails as an unknown option.

bats_require_minimum_version 1.5.0

load ../test_helper

REPO="Devenv-test/service.atlantis.claims"

# Runs <function> from <script> with stubbed collaborators. The stub provider records every
# argument it receives, one per line, in $ARGS_LOG and answers with an empty issue list.
run_script_function() {
  local script="$1" fn="$2"
  export ARGS_LOG="$TEST_TEMP_DIR/provider-args.log"
  : > "$ARGS_LOG"
  run bash -c "
    log_verbose() { :; }
    get_repo_spec() { echo '$REPO'; }
    build_issue_filters() { local -n out=\$1; out+=(--state all --limit 30); }
    provider_issues_list() { printf '%s\n' \"\$@\" > \"\$ARGS_LOG\"; echo '[]'; }
    FILTER_STATE=all FILTER_TYPE='' FILTER_LABELS=() FILTER_ASSIGNEE='' FILTER_MILESTONE=''
    OUTPUT_FORMAT=table LIMIT=30 FETCH_LIMIT=30 SEARCH_TERMS=(term)
    source <(sed -n '/^$fn()/,/^}/p' '$PROJECT_ROOT/tools/scripts/$script')
    $fn
  "
}

@test "issue-list passes the repo to provider_issues_list exactly once, first" {
  run_script_function issue-list.sh list_issues
  [ "$status" -eq 0 ]
  [ "$(head -1 "$ARGS_LOG")" = "$REPO" ]
  [ "$(grep -cxF "$REPO" "$ARGS_LOG")" -eq 1 ]
}

@test "issue-search passes the repo to provider_issues_list exactly once, first" {
  run_script_function issue-search.sh search_issues
  [ "$status" -eq 0 ]
  [ "$(head -1 "$ARGS_LOG")" = "$REPO" ]
  [ "$(grep -cxF "$REPO" "$ARGS_LOG")" -eq 1 ]
}

@test "issue-list keeps its filter flags after the repo" {
  run_script_function issue-list.sh list_issues
  [ "$status" -eq 0 ]
  grep -qxF -- "--state" "$ARGS_LOG"
  grep -qxF -- "--limit" "$ARGS_LOG"
}
