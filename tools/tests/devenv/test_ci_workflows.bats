#!/usr/bin/env bats
# Structural checks for the CI/release pipeline. A real release is never run
# from here (a dry-run proves the analysis half); these tests pin the things
# whose absence makes the pipeline fail or silently do nothing.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    command -v yq >/dev/null 2>&1 || skip "yq not installed"
    PUBLISH="$PROJECT_ROOT/.github/workflows/publish-release.yml"
    TESTWF="$PROJECT_ROOT/.github/workflows/test.yml"
}

@test "package.json pins the pnpm major that matches the lockfile" {
    pm="$(jq -r '.packageManager // empty' "$PROJECT_ROOT/package.json")"
    [[ "$pm" =~ ^pnpm@([0-9]+)\. ]]
    major="${BASH_REMATCH[1]}"
    lock="$(grep -m1 '^lockfileVersion:' "$PROJECT_ROOT/pnpm-lock.yaml" | grep -oE "[0-9]+\.[0-9]+")"
    # pnpm 9 writes lockfileVersion 9.0
    [ "$major" = "9" ] && [ "$lock" = "9.0" ]
}

@test "publish workflow installs the pinned pnpm, not a different hardcoded major" {
    run grep -nE 'pnpm@[0-9]+\.[0-9]+\.[0-9]+' "$PUBLISH"
    [ "$status" -ne 0 ]
    grep -qE 'corepack enable|pnpm/action-setup' "$PUBLISH"
    grep -q -- '--frozen-lockfile' "$PUBLISH"
}

@test "publish workflow fetches full history and tags (semantic-release needs them)" {
    run yq '.jobs.tag.steps[] | select(.uses | test("actions/checkout")) | .with."fetch-depth"' "$PUBLISH"
    [ "$status" -eq 0 ]
    [ "$output" = "0" ]
}

@test "publish workflow can push tags and create releases (contents: write)" {
    run yq '.permissions.contents // .jobs.tag.permissions.contents' "$PUBLISH"
    [ "$output" = "write" ]
}

@test "publish workflow has no dead CURRENT_TAG variable" {
    run grep -n 'CURRENT_TAG' "$PUBLISH"
    [ "$status" -ne 0 ]
}

@test "every semantic-release plugin in release.config.js is a declared devDependency" {
    command -v node >/dev/null || skip "node not installed"
    plugins="$(node -e "const c=require('$PROJECT_ROOT/release.config.js'); console.log(c.plugins.map(p=>Array.isArray(p)?p[0]:p).join('\n'))")"
    [ -n "$plugins" ]
    for p in $plugins; do
        [ "$(jq -r --arg p "$p" '.devDependencies[$p] // empty' "$PROJECT_ROOT/package.json")" ] \
            || { echo "plugin $p is not in devDependencies"; false; }
    done
}

@test "the release pipeline actually publishes: a plugin that creates the release is configured" {
    command -v node >/dev/null || skip "node not installed"
    plugins="$(node -e "const c=require('$PROJECT_ROOT/release.config.js'); console.log(c.plugins.map(p=>Array.isArray(p)?p[0]:p).join('\n'))")"
    [[ "$plugins" == *"@semantic-release/github"* ]]
    [[ "$plugins" == *"@semantic-release/release-notes-generator"* ]]
}

@test "test workflow installs yq (suites invoke it)" {
    run yq '.jobs.test.steps[] | select(.name == "Install dependencies") | .run' "$TESTWF"
    [[ "$output" == *"yq"* ]]
}

@test "test workflow fetches full history for the SK007 git-history check" {
    run yq '.jobs.test.steps[] | select(.uses | test("actions/checkout")) | .with."fetch-depth"' "$TESTWF"
    [ "$output" = "0" ]
}

@test "both workflows serialize overlapping runs with a concurrency group" {
    for wf in "$PUBLISH" "$TESTWF"; do
        run yq '.concurrency.group // ""' "$wf"
        [ -n "$output" ] && [ "$output" != "null" ] || { echo "no concurrency group in $wf"; false; }
    done
}

@test "the release workflow never cancels an in-flight release" {
    run yq '.concurrency."cancel-in-progress"' "$PUBLISH"
    [ "$output" = "false" ]
}

@test "the test workflow's paths filter covers the files that can break the pipeline" {
    for want in 'package.json' 'commitlint.config.js' 'release.config.js' '.github/workflows/**' 'pnpm-lock.yaml'; do
        run yq '.on.pull_request.paths[]' "$TESTWF"
        [[ "$output" == *"$want"* ]] || { echo "paths filter misses $want"; false; }
    done
}

@test "markdown linters come from the lockfile, not a global unpinned install" {
    run grep -nE 'npm install -g' "$TESTWF"
    [ "$status" -ne 0 ]
    for tool in markdownlint-cli2 markdown-link-check; do
        [ "$(jq -r --arg t "$tool" '.devDependencies[$t] // empty' "$PROJECT_ROOT/package.json")" ] \
            || { echo "$tool missing from devDependencies"; false; }
    done
}

@test "CI validates the Devenv-Action trailer on pull-request commits" {
    grep -q 'check-commit-trailers' "$TESTWF"
}
