#!/usr/bin/env bats
# Tests for tools/lib/self-root.bash — the self-location resolver.
# Contract: self-location wins unless the exported value realpath-resolves to
# the same root.

load ../test_helper

LIB_PATH="${BATS_TEST_DIRNAME}/../../lib/self-root.bash"

# Helper: build a fake devenv checkout (root/tools/lib sentinel) in a temp dir.
# Echoes the fake root.
_make_fake_checkout() {
    local root="$1"
    mkdir -p "$root/tools/lib" "$root/tools/scripts"
    echo '#!/bin/bash' > "$root/tools/scripts/sentinel.sh"
}

# Helper: source the lib with a script path pretending to live in a checkout.
# Echoes the resolved root. The script path is passed as a positional argument
# (argv), never interpolated into the command string — quoting nesting inside
# command substitution silently dropped it otherwise.
_resolve_from() {
    local script_path="$1"
    bash -c "source '$LIB_PATH'; devenv_resolve_tools_root \"\$1\"" _ "$script_path"
}

@test "unsets: no exported DEVENV_TOOLS -> self-derived tools root wins" {
    local root
    root="$(mktemp -d)"
    _make_fake_checkout "$root"

    unset DEVENV_TOOLS
    result="$(_resolve_from "$root/tools/scripts/whatever.sh")"
    [ "$result" = "$root/tools" ]

    rm -rf "$root"
}

@test "matching env: exported DEVENV_TOOLS equal to self root -> honored" {
    local root
    root="$(mktemp -d)"
    _make_fake_checkout "$root"

    export DEVENV_TOOLS="$root/tools"
    result="$(_resolve_from "$root/tools/scripts/whatever.sh")"
    [ "$result" = "$root/tools" ]

    unset DEVENV_TOOLS
    rm -rf "$root"
}

@test "foreign env: exported DEVENV_TOOLS at another checkout -> overridden by self" {
    local foreign_root own_root
    foreign_root="$(mktemp -d)"
    own_root="$(mktemp -d)"
    _make_fake_checkout "$foreign_root"
    _make_fake_checkout "$own_root"

    export DEVENV_TOOLS="$foreign_root/tools"
    result="$(_resolve_from "$own_root/tools/scripts/whatever.sh")"
    [ "$result" = "$own_root/tools" ]

    unset DEVENV_TOOLS
    rm -rf "$foreign_root" "$own_root"
}

@test "cache-mirror env: exported DEVENV_TOOLS inside a mirror tree -> overridden" {
    # Mirror = a fake checkout nested UNDER another fake checkout's cache dir,
    # modeling tools/cache/repo_cache/devenv/tools.
    local own_root mirror_root
    own_root="$(mktemp -d)"
    _make_fake_checkout "$own_root"
    mirror_root="$own_root/tools/cache/repo_cache/devenv-mirror"
    _make_fake_checkout "$mirror_root"

    export DEVENV_TOOLS="$mirror_root/tools"
    result="$(_resolve_from "$own_root/tools/scripts/whatever.sh")"
    [ "$result" = "$own_root/tools" ]

    unset DEVENV_TOOLS
    rm -rf "$own_root"
}

@test "symlinked self-location: script invoked via symlink -> self root still derives" {
    local root link_dir
    root="$(mktemp -d)"
    _make_fake_checkout "$root"
    link_dir="$(mktemp -d)"
    ln -s "$root/tools/scripts/whatever.sh" "$link_dir/aliased.sh"

    unset DEVENV_TOOLS
    result="$(_resolve_from "$link_dir/aliased.sh")"
    [ "$result" = "$root/tools" ]

    rm -rf "$root" "$link_dir"
}

@test "foreign env via symlinked path -> overridden (realpath-normalized comparison)" {
    local foreign_root own_root link_dir
    foreign_root="$(mktemp -d)"
    own_root="$(mktemp -d)"
    _make_fake_checkout "$foreign_root"
    _make_fake_checkout "$own_root"
    link_dir="$(mktemp -d)"
    ln -s "$foreign_root/tools" "$link_dir/foreign-tools-link"

    export DEVENV_TOOLS="$link_dir/foreign-tools-link"
    result="$(_resolve_from "$own_root/tools/scripts/whatever.sh")"
    [ "$result" = "$own_root/tools" ]

    unset DEVENV_TOOLS
    rm -rf "$foreign_root" "$own_root" "$link_dir"
}

@test "matching env via symlinked path -> honored (realpath-normalized comparison)" {
    local root link_dir
    root="$(mktemp -d)"
    _make_fake_checkout "$root"
    link_dir="$(mktemp -d)"
    ln -s "$root/tools" "$link_dir/own-tools-link"

    export DEVENV_TOOLS="$link_dir/own-tools-link"
    result="$(_resolve_from "$root/tools/scripts/whatever.sh")"
    [ "$result" = "$root/tools" ]

    unset DEVENV_TOOLS
    rm -rf "$root" "$link_dir"
}

@test "relative-path env resolving to the same root -> honored" {
    local root
    root="$(mktemp -d)"
    _make_fake_checkout "$root"

    export DEVENV_TOOLS="$root/tools/../tools"
    result="$(_resolve_from "$root/tools/scripts/whatever.sh")"
    [ "$result" = "$root/tools" ]

    unset DEVENV_TOOLS
    rm -rf "$root"
}

@test "nonexistent foreign env path -> overridden by self" {
    local root
    root="$(mktemp -d)"
    _make_fake_checkout "$root"

    export DEVENV_TOOLS="/nonexistent/path/tools"
    result="$(_resolve_from "$root/tools/scripts/whatever.sh")"
    [ "$result" = "$root/tools" ]

    unset DEVENV_TOOLS
    rm -rf "$root"
}

@test "devcontainer layout: script in .devcontainer/install-extras derives repo root" {
    local root
    root="$(mktemp -d)"
    mkdir -p "$root/.devcontainer/install-extras"

    unset DEVENV_TOOLS
    result="$(bash -c "source '$LIB_PATH'; devenv_self_root \"\$1\"" _ "$root/.devcontainer/install-extras/zsh.sh")"
    [ "$result" = "$root" ]

    rm -rf "$root"
}

@test "lib from tests dir layout: script in tools/tests/lib derives repo root" {
    local root
    root="$(mktemp -d)"
    _make_fake_checkout "$root"
    mkdir -p "$root/tools/tests/lib"

    unset DEVENV_TOOLS
    result="$(bash -c "source '$LIB_PATH'; devenv_self_root \"\$1\"" _ "$root/tools/tests/lib/probe.bats")"
    [ "$result" = "$root" ]

    rm -rf "$root"
}
