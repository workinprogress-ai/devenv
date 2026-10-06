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

# Pre-release / build suffixes ("-rc.1", "+build5") are ignored: versions compare
# by their numeric MAJOR.MINOR.PATCH core.

@test "compare_versions: a pre-release suffix on the patch compares by its numeric core" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash; compare_versions 1.2.4-rc.1 1.2.3 2>&1; echo \"rc=\$?\""
    [[ "$output" == "rc=1" ]]
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash; compare_versions 1.2.2-rc.1 1.2.3 2>&1; echo \"rc=\$?\""
    [[ "$output" == "rc=2" ]]
}

@test "compare_versions: a version equals its own pre-release (numeric core only)" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash; compare_versions 1.2.3-rc.1 1.2.3 2>&1; echo \"rc=\$?\""
    [[ "$output" == "rc=0" ]]
}

@test "compare_versions: a build suffix on any segment is ignored without noise" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash; compare_versions 2.0.0+build5 1.9.9 2>&1; echo \"rc=\$?\""
    [[ "$output" == "rc=1" ]]
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash; compare_versions 1.2-beta 1.2.0 2>&1; echo \"rc=\$?\""
    [[ "$output" == "rc=0" ]]
}

@test "version_gte works with a pre-release suffix" {
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash; version_gte 2.1.0-rc.2 2.0.0"
    [ "$status" -eq 0 ]
    run bash -c "source $PROJECT_ROOT/tools/lib/versioning.bash; version_gte 1.9.0-rc.2 2.0.0"
    [ "$status" -ne 0 ]
}
