#!/usr/bin/env bats
# Tests for script template and create-script.sh

bats_require_minimum_version 1.5.0

load ../test_helper

@test "script template exists" {
  [ -f "$PROJECT_ROOT/templates/script-template.sh" ]
}

@test "script template is executable" {
  [ -x "$PROJECT_ROOT/templates/script-template.sh" ]
}

@test "script template has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes error handling setup" {
  run grep "enable_strict_mode" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes ERR trap" {
  run grep "enable_strict_mode" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes EXIT trap for cleanup" {
  run grep "trap.*cleanup.*EXIT" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes version header" {
  run grep "# Version:" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes show_usage function" {
  run grep "show_usage()" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes on_error function" {
  run grep "# on_error()" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes cleanup function" {
  run grep "cleanup()" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes validate_dependencies function" {
  run grep "validate_dependencies()" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes validate_arguments function" {
  run grep "validate_arguments()" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes main function" {
  run grep "^main()" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template sources error handling library" {
  run grep "source.*lib/error-handling.bash" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template sources logging library" {
  run grep "source.*lib/error-handling.bash" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template sources versioning library" {
  run grep "source.*lib/versioning.bash" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template sources retry library" {
  run grep "source.*lib/retry.bash" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes --help flag parsing" {
  run grep "\-h|--help" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes --version flag parsing" {
  run grep "\-v|--version" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes --verbose flag parsing" {
  run grep "\-V|--verbose" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes --dry-run flag parsing" {
  run grep "\-n|--dry-run" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes usage examples" {
  run bash -c "grep -A30 'show_usage()' $PROJECT_ROOT/templates/script-template.sh | grep 'Examples:'"
  [ "$status" -eq 0 ]
}

@test "template includes exit code documentation" {
  run grep "Exit Codes:" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template includes configuration section" {
  run grep "Configuration and Constants" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template defines SCRIPT_VERSION constant" {
  run grep "readonly SCRIPT_VERSION=" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template gets script directory properly" {
  run grep "DEVENV_TOOLS" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template gets project root properly" {
  run grep "source.*\$DEVENV_TOOLS/lib" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template only runs main when executed directly" {
  run grep 'if \[\[ "\${BASH_SOURCE\[0\]}" == "\${0}" \]\]' "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template has comprehensive function documentation" {
  run bash -c "grep -c '# Arguments:' $PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
  [ "${lines[0]}" -gt 5 ]
}

@test "template cleanup removes temp files" {
  run bash -c "grep -A10 'cleanup()' $PROJECT_ROOT/templates/script-template.sh | grep 'rm -f.*TEMP_FILE'"
  run grep "TEMP_FILE\|TEMP_DIR" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "template cleanup kills background processes" {
  run grep "kill.*BG_PID" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "create-script.sh exists" {
  [ -f "$PROJECT_ROOT/tools/scripts/create-script.sh" ]
}

@test "create-script.sh is executable" {
  [ -x "$PROJECT_ROOT/tools/scripts/create-script.sh" ]
}

@test "create-script.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/create-script.sh"
  [ "$status" -eq 0 ]
}

@test "create-script.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/create-script.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ Usage: ]]
}

@test "create-script.sh supports custom directory" {
  run bash "$PROJECT_ROOT/tools/scripts/create-script.sh" --help
  [[ "$output" =~ --dir ]]
}

@test "create-script.sh supports force overwrite" {
  run bash "$PROJECT_ROOT/tools/scripts/create-script.sh" --help
  [[ "$output" =~ --force ]]
}

@test "create-script.sh references template file" {
  run grep "TEMPLATE_FILE=" "$PROJECT_ROOT/tools/scripts/create-script.sh"
  [ "$status" -eq 0 ]
}

@test "create-script.sh makes created script executable" {
  run grep "chmod +x" "$PROJECT_ROOT/tools/scripts/create-script.sh"
  [ "$status" -eq 0 ]
}
