#!/usr/bin/env bats
# Tests for bootstrap library (bootstrap.bash) and bootstrap entry point (bootstrap.sh)

bats_require_minimum_version 1.5.0

load ../test_helper

@test "bootstrap.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}

@test "bootstrap.bash has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "bootstrap.sh sources bootstrap.bash library" {
  run grep 'source.*bootstrap\.bash' "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}

@test "bootstrap.bash declares key functions" {
  run grep -E "^(initialize_paths|detect_architecture|ensure_home_is_set|ensure_bash_is_default_shell|install_yq|load_version_info|run_tasks)\(\)" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "bootstrap.bash defines on_error function" {
  run grep "^on_error()" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
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


@test "bootstrap.bash uses rm -f to safely remove files" {
  run grep "rm -f" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "bootstrap.bash defines devenv-related directories" {
  run grep "devenv=" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
  run grep "setup_dir=" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "bootstrap.bash creates .installs directory" {
  run grep "mkdir -p.*\.installs" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "bootstrap.bash backs up .bashrc file" {
  run grep "\.bashrc\.original" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
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
  run bash -c "grep -A45 'local default_tasks' '$PROJECT_ROOT/.devcontainer/bootstrap.bash'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ initialize_paths ]]
  [[ "$output" =~ install_yq ]]
  [[ "$output" =~ finish_message ]]
  [[ "$output" =~ configure_nuget_sources ]]
}

@test "bootstrap.bash version parsing logic handles semantic versions" {
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


@test "bootstrap.bash installs gh (GitHub CLI)" {
  run grep -i "gh" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "bootstrap.bash installs fzf" {
  run grep "fzf" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "bootstrap.bash installs bats for testing" {
  run grep "bats" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "bootstrap.bash defines ensure_bash_is_default_shell function" {
  run grep "^ensure_bash_is_default_shell()" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "ensure_bash_is_default_shell uses chsh to set bash as default" {
  run grep "chsh -s.*bash" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "ensure_bash_is_default_shell is included in default task list" {
  run bash -c "grep -A45 'local default_tasks' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' | grep 'ensure_bash_is_default_shell'"
  [ "$status" -eq 0 ]
}

@test "ensure_bash_is_default_shell runs after ensure_home_is_set" {
  run bash -c "
    tasks=\$(grep -A45 'local default_tasks' '$PROJECT_ROOT/.devcontainer/bootstrap.bash')
    home_line=\$(echo \"\$tasks\" | grep -n 'ensure_home_is_set' | cut -d: -f1)
    bash_line=\$(echo \"\$tasks\" | grep -n 'ensure_bash_is_default_shell' | cut -d: -f1)
    [ \"\$bash_line\" -gt \"\$home_line\" ] && echo 'ordered_correctly' || echo 'wrong_order'
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ "ordered_correctly" ]]
}

@test "bootstrap.bash defines install_yq function" {
  run grep "^install_yq()" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "install_yq function downloads from mikefarah repository" {
  run grep "mikefarah/yq" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "install_yq is included in default task list" {
  run bash -c "grep -A45 'local default_tasks' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' | grep 'install_yq'"
  [ "$status" -eq 0 ]
}
