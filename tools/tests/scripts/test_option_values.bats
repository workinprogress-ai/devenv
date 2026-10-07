#!/usr/bin/env bats
# Option parsing in the wrapper scripts: an option that takes a value checks it with
# require_option_value, so a missing value is a usage error (exit 2, with the option
# named) instead of "$2: unbound variable", and `--base --force` cannot swallow the
# next flag.

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPTS="$BATS_TEST_DIRNAME/../../scripts"

# arms_missing_check FILE...: file:line of each option arm that reads "$2" without the check
arms_missing_check() {
    awk '
        FNR == 1 { arm = ""; in_arm = 0 }
        /^[[:space:]]*-[^)[:space:]]*(\|-[^)[:space:]]*)*\)/ { arm = $0; start = FNR; in_arm = 1; if ($0 ~ /;;/) check(); next }
        in_arm { arm = arm "\n" $0; if ($0 ~ /;;/) check() }
        function check() {
            if (arm ~ /"\$2"/ && arm ~ /shift 2/ && arm !~ /require_option_value/) print FILENAME ":" start
            in_arm = 0; arm = ""
        }
    ' "$@"
}

@test "every option arm that reads \$2 checks it with require_option_value" {
    local offenders
    offenders="$(arms_missing_check "$SCRIPTS"/*.sh)"
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
    for pair in issue-select:--state issue-list:--state pr-list:--state pipelines-status:--status; do
        script="${pair%%:*}"; opt="${pair#*:}"
        run bash "$SCRIPTS/$script.sh" "$opt"
        [ "$status" -eq 2 ] || { echo "$script $opt: status $status: $output"; return 1; }
        [[ "$output" != *"unbound variable"* ]] || { echo "$script: $output"; return 1; }
        [[ "$output" == *"$opt"* ]] || { echo "$script: option not named: $output"; return 1; }
    done
}

@test "issue-select: --state --type does not take --type as the state" {
    run bash "$SCRIPTS/issue-select.sh" --state --type Bug
    [ "$status" -eq 2 ]
    [[ "$output" == *"--state"* ]]
}

@test "pr-create: --issue with no value is a usage error naming the option" {
    run bash "$SCRIPTS/pr-create.sh" --issue
    [ "$status" -eq 2 ]
    [[ "$output" == *"--issue"* ]]
    [[ "$output" != *"unbound variable"* ]]
}
