#!/usr/bin/env bash
# Test helper functions

# Guard against multiple sourcing
if [ -n "${_TEST_HELPER_LOADED:-}" ]; then return 0; fi
_TEST_HELPER_LOADED=1

# Common setup for tests
test_helper_setup() {
    # Create temporary test directory
    local temp_dir
    temp_dir="$(mktemp -d)"
    export TEST_TEMP_DIR="$temp_dir"
    export ORIGINAL_PWD="$PWD"
    
    # Source the project root - handle both test locations (tests/ and tests/lib/ or tests/scripts/ or tests/devenv/)
    # If we're in a subdirectory (lib, scripts, or devenv), go up one more level
    if [[ "$BATS_TEST_DIRNAME" =~ /tests/(lib|scripts|devenv)$ ]]; then
        export PROJECT_ROOT="${BATS_TEST_DIRNAME}/../../.."
    else
        export PROJECT_ROOT="${BATS_TEST_DIRNAME}/../.."
    fi
    export DEVENV_ROOT="$PROJECT_ROOT"
    export devenv="$PROJECT_ROOT"
    export DEVENV_TOOLS="$DEVENV_ROOT/tools"
    
    # Set up test environment variables
    export GH_USER="test-user"
    export GH_ORG="test-org"
    # GH_TOKEN is deliberately NOT exported: a session-scoped env token is
    # the escape-hatch credential form the provider auth seam gates via the
    # allowlist, and a fake value here makes any real-gh credential
    # resolution fail (and can surface host credential prompts). Suites
    # testing the env leg set GH_TOKEN scoped to the command under test;
    # transport is faked with the stub_gh fixture, never real credentials.
    export USER_EMAIL="test@example.com"
    export HUMAN_NAME="Test User"
    export DEVENV_ROOT="$PROJECT_ROOT"
    export HOME="$TEST_TEMP_DIR"

    # No interactive git credential resolution from tests: the askpass
    # program answers empty (git fails the transport offline instead of
    # asking the editor to authenticate — this is what surfaces as the
    # recurring GitHub auth popup during suite runs), terminal credential
    # prompts are disabled, and ssh runs non-interactive. Real credentials
    # never flow and no auth UI can be triggered by a suite. A suite that
    # specifically tests credential behavior overrides these after setup.
    export GIT_TERMINAL_PROMPT=0
    # command -v true cannot fail on any POSIX system; the split assignment
    # simply satisfies the masking warning (SC2155).
    local askpass
    askpass="$(command -v true)"
    export GIT_ASKPASS="$askpass"
    export GIT_SSH_COMMAND="ssh -o BatchMode=yes"

    _test_helper_install_gh_guard
}

# Install a gh guard for the current test process: a real gh binary on PATH
# keeps working (suites that mock or stub gh are unaffected — they shadow it
# first), but any gh invocation that would touch the network resolves through
# a recording stub whose auth always succeeds and whose API answers empty.
# This keeps suite outcomes independent of the host's login state and stops
# failing credential resolution from bubbling up to the editor's auth
# provider. Suites needing canned payloads use the stub_gh fixture or local
# mocks; this guard is only the fallback, never the assertion surface.
_test_helper_install_gh_guard() {
    # Per-suite opt-out: a suite owning its gh interactions end-to-end (and
    # asserting on real-gh-shaped behavior) can set TEST_GH_GUARD=0 before
    # sourcing this helper.
    if [ "${TEST_GH_GUARD:-1}" != "1" ]; then
        return 0
    fi
    GUARD_BIN_DIR="${TEST_TEMP_DIR}/gh-guard-bin"
    mkdir -p "$GUARD_BIN_DIR"
    case ":$PATH:" in
        *":$GUARD_BIN_DIR:"*) ;;
        *) PATH="$GUARD_BIN_DIR:$PATH"; export PATH ;;
    esac
    export GUARD_BIN_DIR
    # shellcheck disable=SC2016
    printf '%s\n' \
'#!/usr/bin/env bash' \
'# Test fallback gh: auth succeeds (no host prompts), everything else is a' \
'# no-op that logs and fails softly. Assertion suites shadow this with' \
'# stub_gh or local mocks; nothing here is an assertion surface.' \
'if [ "$1" = "auth" ] && [ "${2:-}" = "status" ]; then exit 0; fi' \
'if [ "$1" = "auth" ] && [ "${2:-}" = "token" ]; then' \
'    [ -n "${STUB_GH_AUTH_TOKEN:-}" ] && printf "%s\n" "$STUB_GH_AUTH_TOKEN"' \
'    exit 0' \
'fi' \
'if [ "${1:-}" = "auth" ] && [ "${2:-}" = "login" ]; then exit 0; fi' \
'exit 1' > "${GUARD_BIN_DIR}/gh"
    chmod +x "${GUARD_BIN_DIR}/gh"
}

setup() {
    test_helper_setup
}

# Common teardown for tests
test_helper_teardown() {
    # Clean up test directory
    if [ -d "$TEST_TEMP_DIR" ]; then
        rm -rf "$TEST_TEMP_DIR"
    fi
    
    # Return to original directory
    cd "$ORIGINAL_PWD" 2>/dev/null || true
}

teardown() {
    test_helper_teardown
}

# Helper function to create a mock git repository
create_mock_git_repo() {
    local repo_path="$1"
    mkdir -p "$repo_path"
    cd "$repo_path" || return 1
    git init
    git config user.email "test@example.com"
    git config user.name "Test User"
    
    # Add a dummy origin remote
    git remote add origin "git@github.com:test-org/dummy.git"
    
    touch README.md
    git add README.md
    git commit -m "Initial commit"
    git branch -M main
    cd "$ORIGINAL_PWD" || return 1
}

# Helper to check if a function exists
function_exists() {
    declare -f -F "$1" > /dev/null
    return $?
}

# ---------------------------------------------------------------------------
# Loader-composition harness
#
# Sources an entry point (or an arbitrary snippet) in a CLEAN bash shell and
# reports which named functions exist afterwards. This is the harness that
# catches loader drift: a lib that forgets to source a provider module fails
# here instead of failing at runtime in a script (the auth.bash loading gap
# class of bug).
#
# Usage:
#   compose_functions_defined <source-cmd> <func> [<func>...]
#     0 when every named function is defined after sourcing; 1 otherwise
#     (diagnostics on stderr name the missing functions).
#
# The helper runs the source command via `bash -c` with the test environment's
# DEVENV_ROOT/DEVENV_TOOLS exported, module-load flags unset, and stderr
# passed through. The command must be a single shell snippet, typically
# `source <path>` — e.g.:
#   compose_functions_defined "source $DEVENV_TOOLS/lib/provider-loader.bash" \
#       provider_auth_status_impl provider_issues_list
# ---------------------------------------------------------------------------

_compose_run() {
    local source_cmd="$1"; shift
    local -a wanted=("$@")
    local probe=""
    local f
    for f in "${wanted[@]}"; do
        probe+="declare -F $f >/dev/null 2>&1 || echo MISSING:$f;"
    done
    local missing
    missing=$(env -u _PROVIDER_CORE_LOADED -u _PROVIDER_TOKENS_LOADED \
        DEVENV_ROOT="$DEVENV_ROOT" DEVENV_TOOLS="$DEVENV_TOOLS" \
        bash -c "$source_cmd; $probe" 2>/dev/null | grep '^MISSING:' | sort -u)
    COMPOSE_MISSING="$missing"
    [[ -z "$missing" ]]
}

compose_functions_defined() {
    local source_cmd="$1"; shift
    if ! _compose_run "$source_cmd" "$@"; then
        echo "composition gap — not defined after sourcing:" >&2
        echo "$COMPOSE_MISSING" | sed 's/^MISSING:/  /' >&2
        return 1
    fi
}
