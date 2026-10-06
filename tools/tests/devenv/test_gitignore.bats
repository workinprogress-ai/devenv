#!/usr/bin/env bats
# .gitignore: the update-time marker is a runtime file under .runtime/, which
# the .runtime/ patterns already cover; a bare ".update-time" entry would only
# hide a stray file of that name at any depth.

bats_require_minimum_version 1.5.0

load ../test_helper

@test ".gitignore has no redundant bare .update-time entry" {
    run grep -nx '\.update-time' "$PROJECT_ROOT/.gitignore"
    [ "$status" -eq 1 ]
}

@test "the real update-time file is still ignored through the .runtime/ patterns" {
    run git -C "$PROJECT_ROOT" check-ignore -q .runtime/.update-time
    [ "$status" -eq 0 ]
}

@test "the repo-wide runtime directory pattern is present" {
    grep -qx '\.runtime/' "$PROJECT_ROOT/.gitignore"
}
