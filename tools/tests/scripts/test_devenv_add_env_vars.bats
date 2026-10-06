#!/usr/bin/env bats
# devenv-add-env-vars.sh: values must survive being sourced back, exactly.
# The script writes to $DEVENV_ROOT/.runtime/env-vars.sh, so every test points
# DEVENV_ROOT at a throwaway directory; the real file is never touched.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    ROOT="$TEST_TEMP_DIR/devenv-root"
    mkdir -p "$ROOT/.runtime"
    printf '#!/bin/bash\n# generated\n' > "$ROOT/.runtime/env-vars.sh"
    ENV_FILE="$ROOT/.runtime/env-vars.sh"
    cd "$ROOT"   # a command that wrongly runs when sourcing would drop its marker here
}

add_vars() {
    DEVENV_ROOT="$ROOT" bash "$PROJECT_ROOT/tools/scripts/devenv-add-env-vars.sh" "$@"
}

# Print the value a fresh shell sees for NAME after sourcing the file.
sourced_value() {
    bash -c "source '$ENV_FILE'; printf '%s' \"\${$1-<unset>}\""
}

@test "a value with spaces and quotes round-trips exactly" {
    local value='two words, it'"'"'s "quoted" \back'
    run add_vars "MY_VAR=$value"
    [ "$status" -eq 0 ]
    [ "$(sourced_value MY_VAR)" = "$value" ]
}

@test "command substitution in a value is stored literally and never executed" {
    run add_vars 'MY_VAR=$(touch RAN_SUBSHELL)' 'OTHER=`touch RAN_BACKTICK`' 'THIRD=a;touch RAN_SEMICOLON'
    [ "$status" -eq 0 ]
    [ "$(sourced_value MY_VAR)" = '$(touch RAN_SUBSHELL)' ]
    [ "$(sourced_value OTHER)" = '`touch RAN_BACKTICK`' ]
    [ "$(sourced_value THIRD)" = 'a;touch RAN_SEMICOLON' ]
    [ ! -e RAN_SUBSHELL ]
    [ ! -e RAN_BACKTICK ]
    [ ! -e RAN_SEMICOLON ]
}

@test "shell metacharacters, globs and edge whitespace round-trip" {
    run add_vars 'A=a & b # not a comment' 'B=*.nomatch?[x]' 'C= padded '
    [ "$status" -eq 0 ]
    [ "$(sourced_value A)" = 'a & b # not a comment' ]
    [ "$(sourced_value B)" = '*.nomatch?[x]' ]
    [ "$(sourced_value C)" = ' padded ' ]
}

@test "a multi-line value stays one assignment and round-trips" {
    run add_vars $'MULTI=line one\nline two'
    [ "$status" -eq 0 ]
    [ "$(sourced_value MULTI)" = $'line one\nline two' ]
    # Updating it later must replace it as a unit, not leave half behind.
    run add_vars "MULTI=short"
    [ "$status" -eq 0 ]
    [ "$(sourced_value MULTI)" = "short" ]
    [ "$(grep -c '^export MULTI=' "$ENV_FILE")" -eq 1 ]
}

@test "an empty value sets the variable to empty" {
    run add_vars "EMPTY="
    [ "$status" -eq 0 ]
    [ "$(sourced_value EMPTY)" = "" ]
}

@test "a plain token is written the way it always was, readable and unquoted" {
    run add_vars "TS_AUTHKEY=tskey-abc123def456"
    [ "$status" -eq 0 ]
    grep -qx 'export TS_AUTHKEY=tskey-abc123def456' "$ENV_FILE"
}

@test "updating an existing variable replaces its line" {
    run add_vars "MY_VAR=first"
    run add_vars "MY_VAR=second value"
    [ "$status" -eq 0 ]
    [ "$(grep -c '^export MY_VAR=' "$ENV_FILE")" -eq 1 ]
    [ "$(sourced_value MY_VAR)" = "second value" ]
}

@test "an invalid variable name is still refused" {
    run add_vars "lower=case"
    [ "$status" -eq 2 ]
    [[ "$output" == *"Invalid environment variable format"* ]]
}
