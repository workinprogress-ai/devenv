#!/usr/bin/env bats
# Tests for lib/versioning.bash

bats_require_minimum_version 1.5.0

load ../test_helper

@test "versioning.bash has valid bash syntax" {
    run bash -n "$PROJECT_ROOT/tools/lib/versioning.bash"
    [ "$status" -eq 0 ]
}

@test "parse_version extracts version components" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash && parse_version '1.2.3'"
    [ "$status" -eq 0 ]
    [ "$output" = "1 2 3" ]
}

@test "compare_versions handles equality" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash && compare_versions '1.2.3' '1.2.3'"
    [ "$status" -eq 0 ]
}

@test "compare_versions identifies greater/less" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash && compare_versions '2.0.0' '1.5.0'"
    [ "$status" -eq 1 ]
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash && compare_versions '1.0.0' '2.0.0'"
    [ "$status" -eq 2 ]
}

@test "version_gte returns correct truthiness" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash && version_gte '2.0.0' '1.0.0'"
    [ "$status" -eq 0 ]
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash && version_gte '1.0.0' '2.0.0'"
    [ "$status" -ne 0 ]
}

@test "get_bash_version returns a version" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash && get_bash_version"
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^[0-9]+\.[0-9]+ ]]
}

@test "get_git_version returns a version" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash && get_git_version"
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^[0-9]+\.[0-9]+ ]]
}

@test "check_bash_version and check_git_version succeed for current tools" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash && check_bash_version '4.0'"
    [ "$status" -eq 0 ]
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash && check_git_version '2.0'"
    [ "$status" -eq 0 ]
}

@test "check_bash_version fails for impossible requirement" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash && check_bash_version '999.0'"
    [ "$status" -ne 0 ]
    [[ "$output" =~ ERROR ]]
}

@test "check_git_version fails for impossible requirement" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash && check_git_version '999.0'"
    [ "$status" -ne 0 ]
    [[ "$output" =~ ERROR ]]
}

@test "script_version outputs when SHOW_VERSION set" {
    run bash -c "export SHOW_VERSION=1 && source $PROJECT_ROOT/tools/lib/versioning.bash && script_version 'test.sh' '1.0.0' 'Test script'"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "test.sh version 1.0.0" ]]
    [[ "$output" =~ "Test script" ]]
}

@test "script_version silent when SHOW_VERSION not set" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash && script_version 'test.sh' '1.0.0' 'Test script'"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "require_script_version enforces minimums" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash && require_script_version '2.0.0' '1.5.0' 'test.sh'"
    [ "$status" -eq 0 ]
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash && require_script_version '1.0.0' '2.0.0' 'test.sh'"
    [ "$status" -ne 0 ]
    [[ "$output" =~ ERROR ]]
    [[ "$output" =~ test.sh ]]
}

@test "MIN version constants are defined" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash; echo \$MIN_BASH_VERSION"
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^[0-9]+\.[0-9]+ ]]
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash; echo \$MIN_GIT_VERSION"
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^[0-9]+\.[0-9]+ ]]
}
