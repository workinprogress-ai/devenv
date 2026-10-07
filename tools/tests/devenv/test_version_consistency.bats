#!/usr/bin/env bats
# One version mechanism for every script in tools/scripts: SCRIPT_VERSION is the
# source of truth, the header comment agrees with it, `--version` prints exactly
# that (and works with no provider authentication), and nothing relies on the
# env-gated script_version() printer.

bats_require_minimum_version 1.5.0

load ../test_helper

# Scripts that define SCRIPT_VERSION.
versioned_scripts() {
    grep -lE '^(readonly )?SCRIPT_VERSION=' "$PROJECT_ROOT"/tools/scripts/*.sh
}

script_version_constant() {
    grep -m1 -E '^(readonly )?SCRIPT_VERSION=' "$1" | sed -E 's/.*SCRIPT_VERSION="?([^"]*)"?.*/\1/'
}

@test "every script's '# Version:' header agrees with its SCRIPT_VERSION" {
    local f header want bad=""
    for f in $(versioned_scripts); do
        header="$(grep -m1 -E '^# Version:' "$f" | sed -E 's/^# Version:[[:space:]]*//')"
        [ -n "$header" ] || continue
        want="$(script_version_constant "$f")"
        [ "$header" = "$want" ] || bad+="$(basename "$f"): header '$header' != SCRIPT_VERSION '$want'"$'\n'
    done
    [ -z "$bad" ] || { printf '%s' "$bad"; return 1; }
}

@test "--version prints exactly SCRIPT_VERSION, with provider authentication failing" {
    local stub="$TEST_TEMP_DIR/bin" f want got bad=""
    mkdir -p "$stub"
    printf '#!/usr/bin/env bash\nexit 1\n' > "$stub/gh"
    chmod +x "$stub/gh"
    for f in $(versioned_scripts); do
        want="$(script_version_constant "$f")"
        got="$(cd "$TEST_TEMP_DIR" && env PATH="$stub:/usr/bin:/bin" HOME="$TEST_TEMP_DIR" \
            DEVENV_ROOT="$PROJECT_ROOT" DEVENV_TOOLS="$PROJECT_ROOT/tools" \
            timeout 10 bash "$f" --version < /dev/null 2>&1)" || true
        [ "$got" = "$want" ] || bad+="$(basename "$f"): wanted '$want', got '${got:0:80}'"$'\n'
    done
    [ -z "$bad" ] || { printf '%s' "$bad"; return 1; }
}

@test "no script calls script_version, and the library no longer gates output on SHOW_VERSION" {
    run grep -lE '^[[:space:]]*script_version[[:space:]]' "$PROJECT_ROOT"/tools/scripts/*.sh "$PROJECT_ROOT"/tools/templates/*.sh
    [ "$status" -eq 1 ] || { echo "$output"; return 1; }
    run grep -n 'SHOW_VERSION\|^script_version()' "$PROJECT_ROOT/tools/lib/versioning.bash"
    [ "$status" -eq 1 ] || { echo "$output"; return 1; }
}

@test "every script that calls handle_global_flag defines show_usage, so --help is never silent" {
    # handle_global_flag exits 0 without printing anything when show_usage is
    # not defined: a script that names its usage function differently has a
    # --help that answers with nothing.
    local f bad=""
    for f in $(grep -l 'handle_global_flag' "$PROJECT_ROOT"/tools/scripts/*.sh); do
        grep -qE '^show_usage\(\)' "$f" || bad+="$(basename "$f")"$'\n'
    done
    [ -z "$bad" ] || { printf '%s' "$bad"; return 1; }
}

@test "package.json packageManager names the pnpm version tool-versions.bash declares" {
    local declared pinned
    declared="$(grep -m1 -E '^export PNPM_VERSION=' "$PROJECT_ROOT/.devcontainer/tool-versions.bash" | sed -E 's/.*="([^"]*)".*/\1/')"
    pinned="$(jq -r '.packageManager' "$PROJECT_ROOT/package.json")"
    [ "$pinned" = "pnpm@$declared" ]
}

@test "bootstrap and tool-versions make the declared node the nvm default" {
    grep -q 'nvm alias default "\$NODE_VERSION"' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
    grep -q 'nvm alias default "\$NODE_VERSION"' "$PROJECT_ROOT/.devcontainer/tool-versions.bash"
}

@test "install_repo_dependencies reports a failed pnpm install in the finish banner and does not abort" {
    run bash -c "
        toolbox_root='$PROJECT_ROOT'
        pnpm() { return 1; }
        source <(sed -n '/^install_repo_dependencies()/,/^}/p;/^finish_message()/,/^}/p' '$PROJECT_ROOT/.devcontainer/bootstrap.bash')
        install_repo_dependencies
        finish_message
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"pnpm install' failed"* ]]
}
