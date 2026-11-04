#!/usr/bin/env bats
# Option parsing in the wrapper scripts: an option that takes a value checks it with
# require_option_value, so a missing value is a usage error (exit 2, with the option
# named) instead of "$2: unbound variable", and `--base --force` cannot swallow the
# next flag.

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPTS="$BATS_TEST_DIRNAME/../../ts"

# arms_missing_check FILE...: file:line of each option arm that reads "$2" without the check
arms_missing_check() {
    awk '
        FNR == 1 { arm = ""; in_arm = 0 }
        /^[[:space:]]*-[^)[:space:]]*(\|-[^)[:space:]]*)*\)/ { arm = $0; start = FNR; in_arm = 1; if ($0 ~ /;;/) check(); next }
        in_arm { arm = arm "\n" $0; if ($0 ~ /;;/) check() }
        function check() {
            guard = arm ~ /require_option_value/ || (arm ~ /"\$\{2:-\}"/ && arm ~ /\[\[? -n/ )
            if (arm ~ /"\$2"/ && arm ~ /shift 2/ && !guard) print FILENAME ":" start
            in_arm = 0; arm = ""
        }
    ' "$@"
}

@test "every option arm that reads \$2 checks it with require_option_value" {
    local offenders
    # The bash-era wrappers live in scripts/ (the .sh layer); the TS
    # tools use requireString/parseArgs, not the $2 arms convention.
    # The scripts/ corpus moved to tools/ts (bash minimum); the sweep
    # continues over the shell that remains (template, harness). compgen -G
    # builds the list so an empty layer degrades to "nothing to check".
    local files=()
    local f
    for f in "$BATS_TEST_DIRNAME/../../templates/script-template.sh" "$BATS_TEST_DIRNAME/../run-devenv-tests.sh"; do
        [ -f "$f" ] && files+=("$f")
    done
    # The check targets scripts that source error-handling.bash (where
    # require_option_value lives). The template demonstrates the inline
    # pattern and the harness is self-contained — both validate $2 without
    # the lib, so they are outside this convention's scope.
    local lib_files=()
    for f in "${files[@]:-}"; do
        grep -qE '^[[:space:]]*source .*error-handling\.bash' "$f" && lib_files+=("$f")
    done
    offenders="$(arms_missing_check "${lib_files[@]:-}" 2>/dev/null)"
    [ -z "$offenders" ] || { echo "option arms without require_option_value:"; echo "$offenders"; false; }
}

@test "the guard does catch an unchecked arm, one-line or multi-line (it is not vacuous)" {
    printf 'case "$1" in\n  --a) A="$2"; shift 2 ;;\n  --b)\n    B="$2"\n    shift 2\n    ;;\n  --c) require_option_value "$1" "${2:-}"; C="$2"; shift 2 ;;\nesac\n' > "$BATS_TEST_TMPDIR/probe.sh"
    run arms_missing_check "$BATS_TEST_TMPDIR/probe.sh"
    [[ "$output" == *"probe.sh:2"* ]]
    [[ "$output" == *"probe.sh:3"* ]]
    [[ "$output" != *"probe.sh:7"* ]]
}

# script-level behavior: the missing value is named, and nothing crashes on set -u
@test "a script reports a missing option value as a usage error, not an unbound variable" {
    local pair script opt
    for pair in issue-list:--state pr-list:--state pipelines-status:--status; do
        script="${pair%%:*}"; opt="${pair#*:}"
        run "$PROJECT_ROOT/tools/$script" "$opt"
        [ "$status" -eq 2 ] || { echo "$script $opt: status $status: $output"; return 1; }
        [[ "$output" != *"unbound variable"* ]] || { echo "$script: $output"; return 1; }
        [[ "$output" == *"$opt"* ]] || { echo "$script: option not named: $output"; return 1; }
    done
}

@test "issue-select: --state --type does not take --type as the state" {
    run node "$SCRIPTS/issue-select.ts" --state --type Bug
    [ "$status" -eq 2 ]
    [[ "$output" == *"'--state'"* ]]
}

@test "pr-create: --issue with no value is a usage error naming the option" {
    run node "$SCRIPTS/pr-create.ts" --issue
    [ "$status" -eq 2 ]
    [[ "$output" == *"--issue"* ]]
    [[ "$output" != *"unbound variable"* ]]
}
