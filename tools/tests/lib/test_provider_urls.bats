#!/usr/bin/env bats
# Host-sensitivity tests for the URL seam: provider_extract_url and
# provider_remote_to_web must derive their host literals from
# provider_web_host, so a provider swap edits one function and every
# URL helper follows. The test overrides the host and asserts both
# functions follow — the single-point-swap proof (audit F014).

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    unset _PROVIDER_GITHUB_URLS_LOADED || true
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/urls.bash"
}

@test "urls: extract_url derives its host from provider_web_host" {
    provider_web_host() { printf 'gitlab.example.invalid\n'; }
    local url
    url=$(printf '%s' 'opened https://gitlab.example.invalid/org/repo/-/issues/7 today' | provider_extract_url 'issues')
    [ "$url" = "https://gitlab.example.invalid/org/repo/-/issues/7" ]
}

@test "urls: extract_url rejects foreign hosts (default host)" {
    run bash -c 'source "$1"; printf %s "see https://gitlab.com/org/repo/issues/7" | provider_extract_url' _ \
        "$DEVENV_TOOLS/lib/providers/github/urls.bash"
    # A foreign-host URL must not match: empty output, rc 1.
    [ "$status" -ne 0 ]
    [ -z "$output" ]
}

@test "urls: remote_to_web derives host in all three transport forms" {
    provider_web_host() { printf 'gitlab.example.invalid\n'; }
    run provider_remote_to_web "git@gitlab.example.invalid:org/repo.git"
    [ "$output" = "https://gitlab.example.invalid/org/repo" ]
    run provider_remote_to_web "https://gitlab.example.invalid/org/repo.git"
    [ "$output" = "https://gitlab.example.invalid/org/repo" ]
    run provider_remote_to_web "http://gitlab.example.invalid/org/repo"
    [ "$output" = "https://gitlab.example.invalid/org/repo" ]
}

@test "urls: default github host unchanged (real config)" {
    run provider_remote_to_web "git@github.com:org/repo.git"
    [ "$output" = "https://github.com/org/repo" ]
    run bash -c 'source "$1"; printf %s "merged https://github.com/org/repo/pull/9" | provider_extract_url "pull/"' _ \
        "$DEVENV_TOOLS/lib/providers/github/urls.bash"
    [ "$output" = "https://github.com/org/repo/pull/9" ]
}
