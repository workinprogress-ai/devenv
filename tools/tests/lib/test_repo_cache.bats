#!/usr/bin/env bats
# Tests for repo-cache.bash library
# Tests for shallow-clone repository cache operations

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="$PROJECT_ROOT/tools"
    export REPO_CACHE_DIR="$TEST_TEMP_DIR/cache/repo_cache"

    # Provide required env vars for most tests
    export GH_ORG="test-org"
    export GH_USER="test-user"
    export GH_TOKEN="ghp_test1234567890abcdefghijklmnopqrstuvwxyz"
}

teardown() {
    test_helper_teardown
}

# ============================================================================
# Library Loading Tests
# ============================================================================

@test "repo-cache: library can be sourced" {
    run bash -c "source '$DEVENV_TOOLS/lib/repo-cache.bash' && echo 'loaded'"
    [ "$status" -eq 0 ]
    [[ "$output" == *"loaded"* ]]
}

@test "repo-cache: prevents multiple sourcing" {
    run bash -c "
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        _REPO_CACHE_LOADED=1
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        echo 'success'
    "
    [ "$status" -eq 0 ]
}

@test "repo-cache: has valid bash syntax" {
    run bash -n "$DEVENV_TOOLS/lib/repo-cache.bash"
    [ "$status" -eq 0 ]
}

@test "repo-cache: REPO_CACHE_DIR is set after sourcing" {
    run bash -c "
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        echo \"\$REPO_CACHE_DIR\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"cache/repo_cache"* ]]
}

# ============================================================================
# Environment Validation Tests
# ============================================================================

@test "repo-cache: refresh_repo_cache fails when GH_ORG is unset" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        unset GH_ORG
        export GH_USER='user'
        export GH_TOKEN='token'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        refresh_repo_cache 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"GH_ORG"* ]]
}

@test "repo-cache: refresh_repo_cache fails when GH_USER is unset" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export GH_ORG='test-org'
        unset GH_USER
        export GH_TOKEN='token'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        refresh_repo_cache 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"GH_USER"* ]]
}

@test "repo-cache: refresh_repo_cache fails when GH_TOKEN is unset" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export GH_ORG='test-org'
        export GH_USER='user'
        unset GH_TOKEN
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        refresh_repo_cache 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"GH_TOKEN"* ]]
}

# ============================================================================
# Filter Tests (using mocked list_organization_repositories)
# ============================================================================

@test "repo-cache: refresh_repo_cache fails when no repos found in org" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        # Override to return empty
        list_organization_repositories() { echo ''; }
        refresh_repo_cache 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"No repositories found"* ]]
}

@test "repo-cache: refresh_repo_cache fails when filter matches nothing" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'repo-alpha\nrepo-beta\nrepo-gamma\n'
        }
        refresh_repo_cache 'no-match-pattern' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"No repositories matched filter"* ]]
}

@test "repo-cache: refresh_repo_cache applies filter correctly" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'service.platform.auth\nlib.cs.common\nservice.platform.api\ndocs.readme\n'
        }
        # Mock git to track which repos are cloned
        git() {
            if [ \"\$1\" = 'clone' ]; then
                local dir=\"\${@: -1}\"
                local url=\"\${@: -2:1}\"
                mkdir -p \"\$dir/.git\"
                echo \"CLONED: \$url\" >> '$TEST_TEMP_DIR/clone_log.txt'
                return 0
            fi
            command git \"\$@\"
        }
        refresh_repo_cache '^service\.' >/dev/null 2>&1
        cat '$TEST_TEMP_DIR/clone_log.txt'
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"service.platform.auth"* ]]
    [[ "$output" == *"service.platform.api"* ]]
    [[ "$output" != *"lib.cs.common"* ]]
    [[ "$output" != *"docs.readme"* ]]
}

# ============================================================================
# Clone Behavior Tests
# ============================================================================

@test "repo-cache: refresh_repo_cache clones new repos into cache directory" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'repo-one\nrepo-two\n'
        }
        git() {
            if [ \"\$1\" = 'clone' ]; then
                local dir=\"\${@: -1}\"
                mkdir -p \"\$dir/.git\"
                return 0
            fi
            command git \"\$@\"
        }
        refresh_repo_cache 2>&1
    "
    [ "$status" -eq 0 ]
    [ -d "$TEST_TEMP_DIR/cache/repo_cache/repo-one/.git" ]
    [ -d "$TEST_TEMP_DIR/cache/repo_cache/repo-two/.git" ]
}

@test "repo-cache: refresh_repo_cache outputs cache directory path on success" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'repo-one\n'
        }
        git() {
            if [ \"\$1\" = 'clone' ]; then
                local dir=\"\${@: -1}\"
                mkdir -p \"\$dir/.git\"
                return 0
            fi
            command git \"\$@\"
        }
        refresh_repo_cache
    "
    [ "$status" -eq 0 ]
    # Last line of stdout should be the cache directory
    local last_line
    last_line=$(echo "$output" | tail -1)
    [[ "$last_line" == *"cache/repo_cache"* ]]
}

@test "repo-cache: clone uses --depth 1 --single-branch --no-tags" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'my-repo\n'
        }
        # Capture git args
        git() {
            echo \"GIT_ARGS: \$*\" >> '$TEST_TEMP_DIR/git_calls.txt'
            if [ \"\$1\" = 'clone' ]; then
                local dir=\"\${@: -1}\"
                mkdir -p \"\$dir/.git\"
                return 0
            fi
            command git \"\$@\"
        }
        refresh_repo_cache >/dev/null 2>&1
        cat '$TEST_TEMP_DIR/git_calls.txt'
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"--depth 1"* ]]
    [[ "$output" == *"--single-branch"* ]]
    [[ "$output" == *"--no-tags"* ]]
}

# ============================================================================
# Update Behavior Tests
# ============================================================================

@test "repo-cache: refresh_repo_cache updates existing cached repos" {
    # Pre-create a cached repo
    mkdir -p "$TEST_TEMP_DIR/cache/repo_cache/existing-repo/.git"

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'existing-repo\n'
        }
        git() {
            echo \"GIT: \$*\" >> '$TEST_TEMP_DIR/git_calls.txt'
            return 0
        }
        refresh_repo_cache >/dev/null 2>&1
        cat '$TEST_TEMP_DIR/git_calls.txt'
    "
    [ "$status" -eq 0 ]
    # Should fetch with --depth 1, not clone
    [[ "$output" == *"fetch --depth 1"* ]]
    [[ "$output" == *"reset --hard"* ]]
    [[ "$output" != *"clone"* ]]
}

@test "repo-cache: update runs gc --prune=all for space efficiency" {
    mkdir -p "$TEST_TEMP_DIR/cache/repo_cache/prune-repo/.git"

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'prune-repo\n'
        }
        git() {
            echo \"GIT: \$*\" >> '$TEST_TEMP_DIR/git_calls.txt'
            return 0
        }
        refresh_repo_cache >/dev/null 2>&1
        cat '$TEST_TEMP_DIR/git_calls.txt'
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"gc --prune=all"* ]]
}

# ============================================================================
# Mixed Clone/Update Tests
# ============================================================================

@test "repo-cache: handles mix of new and existing repos" {
    mkdir -p "$TEST_TEMP_DIR/cache/repo_cache/old-repo/.git"

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'old-repo\nnew-repo\n'
        }
        git() {
            if [ \"\$1\" = 'clone' ]; then
                local dir=\"\${@: -1}\"
                mkdir -p \"\$dir/.git\"
                echo \"CLONE: \$*\" >> '$TEST_TEMP_DIR/git_calls.txt'
                return 0
            fi
            echo \"OTHER: \$*\" >> '$TEST_TEMP_DIR/git_calls.txt'
            return 0
        }
        refresh_repo_cache >/dev/null 2>&1
        cat '$TEST_TEMP_DIR/git_calls.txt'
    "
    [ "$status" -eq 0 ]
    # old-repo should be fetched (update path)
    [[ "$output" == *"OTHER:"*"fetch --depth 1"* ]]
    # new-repo should be cloned
    [[ "$output" == *"CLONE:"*"new-repo"* ]]
}

# ============================================================================
# Error Handling Tests
# ============================================================================

@test "repo-cache: returns 2 on partial failure" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'good-repo\nbad-repo\n'
        }
        git() {
            if [ \"\$1\" = 'clone' ]; then
                local dir=\"\${@: -1}\"
                if [[ \"\$dir\" == *'bad-repo' ]]; then
                    return 1
                fi
                mkdir -p \"\$dir/.git\"
                return 0
            fi
            command git \"\$@\"
        }
        refresh_repo_cache 2>/dev/null
    "
    [ "$status" -eq 2 ]
}

@test "repo-cache: returns 1 when all repos fail" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'fail-one\nfail-two\n'
        }
        git() {
            if [ \"\$1\" = 'clone' ]; then
                return 1
            fi
            command git \"\$@\"
        }
        refresh_repo_cache 2>/dev/null
    "
    [ "$status" -eq 1 ]
}

@test "repo-cache: reports failed repos in warning" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'good-repo\nbad-repo\n'
        }
        git() {
            if [ \"\$1\" = 'clone' ]; then
                local dir=\"\${@: -1}\"
                if [[ \"\$dir\" == *'bad-repo' ]]; then
                    return 1
                fi
                mkdir -p \"\$dir/.git\"
                return 0
            fi
            command git \"\$@\"
        }
        refresh_repo_cache 2>&1
    "
    [ "$status" -eq 2 ]
    [[ "$output" == *"bad-repo"* ]]
}

@test "repo-cache: update fetch failure is reported" {
    mkdir -p "$TEST_TEMP_DIR/cache/repo_cache/fetch-fail/.git"

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'fetch-fail\n'
        }
        git() {
            if [ \"\$1\" = '-C' ] && [ \"\$3\" = 'fetch' ]; then
                return 1
            fi
            return 0
        }
        refresh_repo_cache 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"Failed to fetch"* ]]
}

# ============================================================================
# Cache Directory Tests
# ============================================================================

@test "repo-cache: creates cache directory if it does not exist" {
    local cache="$TEST_TEMP_DIR/new_cache/repo_cache"
    [ ! -d "$cache" ]

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$cache'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'some-repo\n'
        }
        git() {
            if [ \"\$1\" = 'clone' ]; then
                local dir=\"\${@: -1}\"
                mkdir -p \"\$dir/.git\"
                return 0
            fi
            command git \"\$@\"
        }
        refresh_repo_cache >/dev/null 2>&1
    "
    [ "$status" -eq 0 ]
    [ -d "$cache" ]
}

# ============================================================================
# No-Filter (all repos) Test
# ============================================================================

@test "repo-cache: caches all repos when no filter given" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'alpha\nbeta\ngamma\n'
        }
        cloned=()
        git() {
            if [ \"\$1\" = 'clone' ]; then
                local dir=\"\${@: -1}\"
                mkdir -p \"\$dir/.git\"
                echo \"\$(basename \"\$dir\")\" >> '$TEST_TEMP_DIR/cloned.txt'
                return 0
            fi
            command git \"\$@\"
        }
        refresh_repo_cache >/dev/null 2>&1
        sort '$TEST_TEMP_DIR/cloned.txt'
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"alpha"* ]]
    [[ "$output" == *"beta"* ]]
    [[ "$output" == *"gamma"* ]]
}

# ============================================================================
# Parallel Execution Tests
# ============================================================================

@test "repo-cache: REPO_CACHE_PARALLEL can be overridden" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_PARALLEL=2
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        echo \"\$REPO_CACHE_PARALLEL\"
    "
    [ "$status" -eq 0 ]
    [ "$output" = "2" ]
}

@test "repo-cache: parallel cloning caches all repos" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        export REPO_CACHE_PARALLEL=2
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'p-one\np-two\np-three\np-four\np-five\n'
        }
        git() {
            if [ \"\$1\" = 'clone' ]; then
                local dir=\"\${@: -1}\"
                mkdir -p \"\$dir/.git\"
                return 0
            fi
            command git \"\$@\"
        }
        refresh_repo_cache >/dev/null 2>&1
        ls '$TEST_TEMP_DIR/cache/repo_cache' | sort
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"p-one"* ]]
    [[ "$output" == *"p-two"* ]]
    [[ "$output" == *"p-three"* ]]
    [[ "$output" == *"p-four"* ]]
    [[ "$output" == *"p-five"* ]]
}

@test "repo-cache: parallel execution tracks failures correctly" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        export REPO_CACHE_PARALLEL=2
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'ok-a\nfail-b\nok-c\nfail-d\nok-e\n'
        }
        git() {
            if [ \"\$1\" = 'clone' ]; then
                local dir=\"\${@: -1}\"
                local name=\$(basename \"\$dir\")
                if [[ \"\$name\" == fail-* ]]; then
                    return 1
                fi
                mkdir -p \"\$dir/.git\"
                return 0
            fi
            command git \"\$@\"
        }
        refresh_repo_cache 2>&1
    "
    [ "$status" -eq 2 ]
    [[ "$output" == *"fail-b"* ]]
    [[ "$output" == *"fail-d"* ]]
}

@test "repo-cache: parallel execution returns 1 when all fail" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        export REPO_CACHE_PARALLEL=3
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'bad-1\nbad-2\nbad-3\n'
        }
        git() {
            return 1
        }
        refresh_repo_cache 2>/dev/null
    "
    [ "$status" -eq 1 ]
}

@test "repo-cache: logs repo count and parallelism" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/cache/repo_cache'
        export REPO_CACHE_PARALLEL=3
        source '$DEVENV_TOOLS/lib/repo-cache.bash'
        list_organization_repositories() {
            printf 'r1\nr2\nr3\nr4\n'
        }
        git() {
            if [ \"\$1\" = 'clone' ]; then
                local dir=\"\${@: -1}\"
                mkdir -p \"\$dir/.git\"
                return 0
            fi
            command git \"\$@\"
        }
        refresh_repo_cache 2>&1 >/dev/null
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"4 repositories"* ]]
    [[ "$output" == *"3 parallel"* ]]
}
