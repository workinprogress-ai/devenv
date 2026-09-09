#!/usr/bin/env bats
# Tests for issue-search.sh — keyword search across issue titles and bodies

bats_require_minimum_version 1.5.0

load ../test_helper

@test "issue-search.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-search.sh"
  [ "$status" -eq 0 ]
}

@test "issue-search.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-search.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-search.sh help documents search semantics and key flags" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-search.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "--fetch-limit" ]]
  [[ "$output" =~ "--state" ]]
  [[ "$output" =~ "titles and bodies" ]]
}

@test "issue-search.sh requires at least one search term" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-search.sh"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "At least one search term" ]]
}

@test "issue-search.sh --version prints version" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-search.sh" --version
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^1\.0\.0$ ]]
}

# ---------------------------------------------------------------------------
# Offline matcher tests: run the exact static jq program used by search_issues
# against fixture JSON, so the matching/ranking semantics are pinned without
# network access. Keep this program in sync with search_issues in the script.
# ---------------------------------------------------------------------------

MATCHER='
    .[]
    | . as $issue
    | [ $ARGS.positional[] as $term
        | ($issue.title + " " + ($issue.body // "")) | ascii_downcase
        | select(contains($term | ascii_downcase))
        | $term
      ] as $matched
    | select(($matched | length) > 0)
    | del(.body) + {matchedTerms: $matched, matchCount: ($matched | length)}
'

@test "matcher: plain term matches title case-insensitively" {
  result=$(jq -r --args "$MATCHER" -- "RESERVATION" \
    <<< '[{"number":1,"title":"Reservation TTL","body":null}]' \
    | jq -s 'sort_by(-.matchCount) | .[0].number')
  [ "$result" = "1" ]
}

@test "matcher: term matches body content" {
  run jq -r --args "$MATCHER" -- "ledger" \
    <<< '[{"number":2,"title":"Audit service","body":"append-only ledger"}]'
  [ "$status" -eq 0 ]
  [[ "$output" =~ "ledger" ]]
}

@test "matcher: regex metacharacters in terms are matched literally" {
  run jq -r --args "$MATCHER" -- "task.assigned" \
    <<< '[{"number":3,"title":"uses task.assigned event"},{"number":4,"title":"uses taskXassigned event"}]'
  [ "$status" -eq 0 ]
  [[ "$output" =~ '"number": 3' ]]
  ! [[ "$output" =~ '"number": 4' ]]
}

@test "matcher: bracketed terms match literally" {
  run jq -r --args "$MATCHER" -- "API [v2]" \
    <<< '[{"number":5,"title":"API [v2] fail"},{"number":6,"title":"API v2 fail"}]'
  [ "$status" -eq 0 ]
  [[ "$output" =~ '"number": 5' ]]
  ! [[ "$output" =~ '"number": 6' ]]
}

@test "matcher: null body does not error" {
  run jq -r --args "$MATCHER" -- "anything" \
    <<< '[{"number":7,"title":"t","body":null}]'
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "matcher: any-keyword OR semantics — one term of many suffices" {
  run jq -r --args "$MATCHER" -- "zzznope" "identity" \
    <<< '[{"number":8,"title":"Identity MVP","body":null}]'
  [ "$status" -eq 0 ]
  [[ "$output" =~ '"number": 8' ]]
}

@test "matcher: ranking puts multi-term hits first" {
  fixture='[{"number":9,"title":"identity only"},{"number":10,"title":"identity and blueprint","body":"blueprint"}]'
  result=$(jq -r --args "$MATCHER" -- "identity" "blueprint" <<< "$fixture" \
            | jq -s 'sort_by(-.matchCount) | .[].number')
  [ "$(echo "$result" | head -1)" = "10" ]
  [ "$(echo "$result" | tail -1)" = "9" ]
}

@test "matcher: body is stripped from output" {
  run jq -r --args "$MATCHER" -- "ledger" \
    <<< '[{"number":11,"title":"Audit","body":"append-only ledger detail"}]'
  [ "$status" -eq 0 ]
  ! [[ "$output" =~ "append-only ledger detail" ]]
  [[ "$output" =~ '"matchedTerms"' ]]
  [[ "$output" =~ '"matchCount"' ]]
}
