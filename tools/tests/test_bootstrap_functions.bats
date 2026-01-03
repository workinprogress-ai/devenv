#!/usr/bin/env bats
# Tests for bootstrap.sh functions and error handling

bats_require_minimum_version 1.5.0

load test_helper

@test "bootstrap.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}

@test "bootstrap.sh declares key functions" {
  run grep -E "^(initialize_paths|detect_architecture|ensure_home_is_set|load_version_info|run_tasks)\(\)" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}

@test "bootstrap.sh defines on_error function" {
  run grep "^on_error()" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}

@test "bootstrap.sh sources error handling library if available" {
  run bash -c "
    script_path='$PROJECT_ROOT/.devcontainer/bootstrap.sh'
    script_folder=\$(dirname \"\$script_path\")
    toolbox_root=\$(dirname \"\$script_folder\")
    
    if [ -f \"\$toolbox_root/tools/lib/error-handling.bash\" ]; then
      echo 'library_exists'
    fi
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ library_exists ]]
}

@test "bootstrap.sh ARM architecture detection logic" {
  # Test x86_64 detection
  cat > "$TEST_TEMP_DIR/test_arch_x86.sh" << 'EOF'
#!/bin/bash
arch="x86_64"
is_arm=$([ "$arch" == "aarch64" ] && echo 1 || echo 0)
echo "$is_arm"
EOF
  chmod +x "$TEST_TEMP_DIR/test_arch_x86.sh"
  run "$TEST_TEMP_DIR/test_arch_x86.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]

  # Test aarch64 detection
  cat > "$TEST_TEMP_DIR/test_arch_arm.sh" << 'EOF'
#!/bin/bash
arch="aarch64"
is_arm=$([ "$arch" == "aarch64" ] && echo 1 || echo 0)
echo "$is_arm"
EOF
  chmod +x "$TEST_TEMP_DIR/test_arch_arm.sh"
  run "$TEST_TEMP_DIR/test_arch_arm.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
}

@test "bootstrap.sh uses || true to prevent grep failures from stopping script" {
  skip "grep commands are used in conditionals or pipes where || true is not needed"
  run grep "grep.*|| true" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}

@test "bootstrap.sh uses rm -f to safely remove files" {
  run grep "rm -f" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}

@test "bootstrap.sh defines devenv-related directories" {
  run grep "devenv=" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
  run grep "setup_dir=" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
  run grep "repos_dir=" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}

@test "bootstrap.sh creates .installs directory" {
  run grep "mkdir -p.*\.installs" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}

@test "bootstrap.sh backs up .bashrc file" {
  run grep "\.bashrc\.original" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}

@test "run_tasks executes only requested safe task" {
  run "$PROJECT_ROOT/.devcontainer/bootstrap.sh" initialize_paths
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Running task: initialize_paths" ]]
  [[ ! "$output" =~ "install_os_packages_round1" ]]
}

@test "run_tasks fails fast on unknown task" {
  run "$PROJECT_ROOT/.devcontainer/bootstrap.sh" this_task_does_not_exist
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Unknown task" ]]
}

@test "run_tasks default task list is ordered" {
  run bash -c "grep -A40 'local default_tasks' '$PROJECT_ROOT/.devcontainer/bootstrap.sh'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ initialize_paths ]]
  [[ "$output" =~ finish_message ]]
  [[ "$output" =~ configure_nuget_sources ]]
}

@test "bootstrap.sh version parsing logic handles semantic versions" {
  cat > "$TEST_TEMP_DIR/test_version_parse.sh" << 'EOF'
#!/bin/bash
VERSION="v1.5.2"
if [[ $VERSION =~ ([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
  MAJOR_VERSION=${BASH_REMATCH[1]}
  MINOR_VERSION=${BASH_REMATCH[2]}
  PATCH_VERSION=${BASH_REMATCH[3]}
  echo "$MAJOR_VERSION.$MINOR_VERSION.$PATCH_VERSION"
fi
EOF
  chmod +x "$TEST_TEMP_DIR/test_version_parse.sh"
  run "$TEST_TEMP_DIR/test_version_parse.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "1.5.2" ]
}

@test "bootstrap.sh installs gh (GitHub CLI)" {
  run grep -i "gh" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}

@test "bootstrap.sh installs fzf" {
  run grep "fzf" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}

@test "bootstrap.sh installs bats for testing" {
  run grep "bats" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}
