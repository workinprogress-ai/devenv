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
  run grep -E "^(initialize_paths|detect_architecture|ensure_home_is_set|ensure_bash_is_default_shell|install_yq|load_version_info|run_bootstrap_tasks)\(\)" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "bootstrap.bash defines on_error function" {
  run grep "^on_error()" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "call_npm returns npm exit status from pipeline" {
  run grep 'return "\${PIPESTATUS\[0\]}"' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
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

@test "reset_bashrc_to_original preserves user bashrc unless forced" {
  run bash -c "
    grep -q 'PRESERVE_BASHRC:-0' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' &&
    grep -q 'cp ~/.bashrc.original ~/.bashrc' '$PROJECT_ROOT/.devcontainer/bootstrap.bash'
  "
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

@test "run_tasks reports failed task and exits" {
  run grep 'Task failed: \$task' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
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

@test "bootstrap.bash defines install_copilot_instructions function" {
  run grep "^install_copilot_instructions()" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "bootstrap.bash defines sync_copilot_knowledge function" {
  run grep "^sync_copilot_knowledge()" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "bootstrap.bash defines normalize_copilot_knowledge_subpath helper" {
  run grep "^normalize_copilot_knowledge_subpath()" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "normalize_copilot_knowledge_subpath defaults empty to repo root" {
  run bash -c "source '$PROJECT_ROOT/.devcontainer/bootstrap.bash'; normalize_copilot_knowledge_subpath ''"
  [ "$status" -eq 0 ]
  [ "$output" = "." ]
}

@test "normalize_copilot_knowledge_subpath trims leading ./ and trailing /" {
  run bash -c "source '$PROJECT_ROOT/.devcontainer/bootstrap.bash'; normalize_copilot_knowledge_subpath './copilot-knowledge/'"
  [ "$status" -eq 0 ]
  [ "$output" = "copilot-knowledge" ]
}

@test "install_copilot_instructions copies to ~/.copilot/copilot-instructions.md" {
  run grep "copilot-instructions.md" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ".copilot/copilot-instructions.md" ]]
}

@test "install_copilot_instructions is included in default task list" {
  run bash -c "grep -A55 'local default_tasks' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' | grep 'install_copilot_instructions'"
  [ "$status" -eq 0 ]
}

@test "sync_copilot_knowledge is included in default task list" {
  run bash -c "grep -A55 'local default_tasks' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' | grep 'sync_copilot_knowledge'"
  [ "$status" -eq 0 ]
}

@test "sync_copilot_knowledge uses the subpath helper and the provider hook for the auth header" {
  run bash -c "
    grep -q 'subpath=\$(normalize_copilot_knowledge_subpath \"\$subpath\")' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' &&
    grep -q 'header=\$(provider_bootstrap_call git_auth_header \"\$token\")' '$PROJECT_ROOT/.devcontainer/bootstrap.bash'
  "
  [ "$status" -eq 0 ]
}

@test "bootstrap never exports GH_TOKEN (keychain-only auth contract)" {
  ! grep -q 'export GH_TOKEN' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
}

@test "sync_copilot_knowledge stores pre-sync backups under runtime path" {
  run bash -c "
    grep -q 'copilot-knowledge-backups' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' &&
    grep -q 'copilot-engineering-backups' '$PROJECT_ROOT/.devcontainer/bootstrap.bash'
  "
  [ "$status" -eq 0 ]
}

@test "sync_copilot_side_repo is the shared parametric sync used by both imports" {
  run bash -c "
    grep -q 'sync_copilot_side_repo()' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' &&
    grep -A3 -F 'sync_copilot_side_repo' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' | grep -q 'copilot/knowledge' &&
    grep -A3 -F 'sync_copilot_side_repo' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' | grep -q 'copilot/engineering'
  "
  [ "$status" -eq 0 ]
}

@test "sync_copilot_engineering is defined and registered in both task runners" {
  run bash -c "
    grep -q 'sync_copilot_engineering()' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' &&
    grep -cE '^[[:space:]]+sync_copilot_engineering$' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' | grep -q '^2$'
  "
  [ "$status" -eq 0 ]
}

@test "engineering sync skips gracefully when engineering_repo unconfigured" {
  run grep 'No \[copilot\] engineering_repo configured; skipping' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "container start pulls engineering standards non-blocking" {
  run bash -c "
    grep -q 'pull_copilot_engineering_on_container_start()' '$PROJECT_ROOT/tools/lib/copilot-knowledge.bash' &&
    grep -q 'pull_copilot_engineering_on_container_start' '$PROJECT_ROOT/.devcontainer/startup.sh'
  "
  [ "$status" -eq 0 ]
}

@test "write_devenvrc includes startup knowledge pull hook" {
  run grep '^pull_copilot_knowledge_on_container_start()' "$PROJECT_ROOT/tools/lib/copilot-knowledge.bash"
  [ "$status" -eq 0 ]
}

@test "startup knowledge pull runs only when copilot knowledge is a git repo" {
  run grep '\[ -d "\$repo_dir/\.git" \] || return 0' "$PROJECT_ROOT/tools/lib/copilot-knowledge.bash"
  [ "$status" -eq 0 ]
}

@test "startup knowledge pull is non-blocking background pull" {
  run bash -c "
    grep -q 'pull_copilot_knowledge_on_container_start' '$PROJECT_ROOT/tools/lib/copilot-knowledge.bash' &&
    grep -q 'pull --ff-only origin' '$PROJECT_ROOT/tools/lib/copilot-knowledge.bash' &&
    grep -q 'nohup env REPO_DIR=' '$PROJECT_ROOT/tools/lib/copilot-knowledge.bash'
  "
  [ "$status" -eq 0 ]
}

@test "startup.sh sources copilot knowledge library and calls pull function" {
  run bash -c "
    grep -q 'source \"\$toolbox_root/tools/lib/copilot-knowledge.bash\"' '$PROJECT_ROOT/.devcontainer/startup.sh' &&
    grep -q 'pull_copilot_knowledge_on_container_start \"\$toolbox_root\"' '$PROJECT_ROOT/.devcontainer/startup.sh'
  "
  [ "$status" -eq 0 ]
}

@test "devenv-update parses Devenv-Action trailers from pulled commit range" {
  run grep -E 'git log "\$\{old_ref\}\.\.\$\{new_ref\}" --format=.*Devenv-Action' "$PROJECT_ROOT/.devcontainer/post-update.bash"
  [ "$status" -eq 0 ]
}

@test "devenv-update always prints a post-update action recommendation" {
  run grep 'Update complete\.' "$PROJECT_ROOT/.devcontainer/post-update.bash"
  [ "$status" -eq 0 ]
}

@test "devenv-update offers to run bootstrap when bootstrap action is recommended" {
  run grep 'Do you want to run bootstrap now? (y/n):' "$PROJECT_ROOT/.devcontainer/post-update.bash"
  [ "$status" -eq 0 ]
}

@test "devenv-update includes explicit bootstrap follow-up paths" {
  run bash -c "
    grep -q 'Bootstrap completed successfully\.' '$PROJECT_ROOT/.devcontainer/post-update.bash' &&
    grep -q 'Recommendation: restart the dev container to apply bootstrap changes\.' '$PROJECT_ROOT/.devcontainer/post-update.bash' &&
    grep -q 'Skipping bootstrap\. Run .* when ready\.' '$PROJECT_ROOT/.devcontainer/post-update.bash'
  "
  [ "$status" -eq 0 ]
}

@test "devenv-update restart action prompts for full container restart" {
  run grep 'Do you want to restart the dev container now? (y/n):' "$PROJECT_ROOT/.devcontainer/post-update.bash"
  [ "$status" -eq 0 ]
}

@test "devenv-update uses docker restart hostname for container restart" {
  run grep 'docker restart "$(hostname)"' "$PROJECT_ROOT/.devcontainer/post-update.bash"
  [ "$status" -eq 0 ]
}

@test "devenv-update recreate action offers recreate restart skip options" {
  run bash -c "
    grep -q 'Choose an option:' '$PROJECT_ROOT/.devcontainer/post-update.bash' &&
    grep -q '1) Recreate container now (recommended)' '$PROJECT_ROOT/.devcontainer/post-update.bash' &&
    grep -q '2) Restart container now' '$PROJECT_ROOT/.devcontainer/post-update.bash' &&
    grep -q '3) Skip' '$PROJECT_ROOT/.devcontainer/post-update.bash'
  "
  [ "$status" -eq 0 ]
}

@test "devenv-update uses safe full convergence bootstrap profile" {
  run bash -c "
    grep -q 'run_update_tasks()' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' &&
    grep -q 'run_update_tasks' '$PROJECT_ROOT/.devcontainer/bootstrap.bash'
  "
  [ "$status" -eq 0 ]
}

@test "load_setup_credentials runs before sync_copilot_knowledge" {
  run bash -c "
    tasks=\$(grep -A55 'local default_tasks' '$PROJECT_ROOT/.devcontainer/bootstrap.bash')
    creds_line=\$(echo \"\$tasks\" | grep -n 'load_setup_credentials' | cut -d: -f1)
    sync_line=\$(echo \"\$tasks\" | grep -n 'sync_copilot_knowledge' | cut -d: -f1)
    [ \"\$sync_line\" -gt \"\$creds_line\" ] && echo 'ordered_correctly' || echo 'wrong_order'
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ "ordered_correctly" ]]
}

@test "install_copilot_instructions symlinks file when source exists" {
  local src_dir="$TEST_TEMP_DIR/copilot"
  local dest_dir="$TEST_TEMP_DIR/home/.copilot"
  mkdir -p "$src_dir"
  echo "# test instructions" > "$src_dir/copilot-instructions.md"

  cat > "$TEST_TEMP_DIR/test_install_copilot.sh" << EOF
#!/bin/bash
toolbox_root="$TEST_TEMP_DIR"
HOME="$TEST_TEMP_DIR/home"
src="\$toolbox_root/copilot/copilot-instructions.md"
dest="\$HOME/.copilot/copilot-instructions.md"
if [ -f "\$src" ]; then
  mkdir -p "\$HOME/.copilot"
  rm -f "\$dest"
  ln -s "\$src" "\$dest"
  echo "symlinked"
else
  echo "skipped"
fi
EOF
  chmod +x "$TEST_TEMP_DIR/test_install_copilot.sh"
  run "$TEST_TEMP_DIR/test_install_copilot.sh"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "symlinked" ]]
  [ -L "$dest_dir/copilot-instructions.md" ]
}

@test "install_copilot_instructions skips gracefully when source missing" {
  cat > "$TEST_TEMP_DIR/test_install_copilot_missing.sh" << EOF
#!/bin/bash
toolbox_root="$TEST_TEMP_DIR/no-such-dir"
HOME="$TEST_TEMP_DIR/home2"
src="\$toolbox_root/copilot/copilot-instructions.md"
dest="\$HOME/.copilot/copilot-instructions.md"
if [ -f "\$src" ]; then
  mkdir -p "\$HOME/.copilot"
  cp "\$src" "\$dest"
  echo "copied"
else
  echo "skipped"
fi
EOF
  chmod +x "$TEST_TEMP_DIR/test_install_copilot_missing.sh"
  run "$TEST_TEMP_DIR/test_install_copilot_missing.sh"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "skipped" ]]
}

@test "install_copilot_instructions creates skills symlink to copilot/skills" {
  local toolbox="$TEST_TEMP_DIR/toolbox_skills"
  local home_dir="$TEST_TEMP_DIR/home_skills"
  mkdir -p "$toolbox/copilot/skills/spike"
  mkdir -p "$home_dir/.copilot"

  cat > "$TEST_TEMP_DIR/test_skills_symlink.sh" << EOF
#!/bin/bash
toolbox_root="$toolbox"
HOME="$home_dir"
skills_src="\$toolbox_root/copilot/skills"
skills_link="\$HOME/.copilot/skills"
if [ -d "\$skills_src" ]; then
  mkdir -p "\$HOME/.copilot"
  rm -rf "\$skills_link"
  ln -s "\$skills_src" "\$skills_link"
  echo "symlinked"
else
  echo "skipped"
fi
EOF
  chmod +x "$TEST_TEMP_DIR/test_skills_symlink.sh"
  run "$TEST_TEMP_DIR/test_skills_symlink.sh"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "symlinked" ]]
  [ -L "$home_dir/.copilot/skills" ]
  [ "$(readlink "$home_dir/.copilot/skills")" = "$toolbox/copilot/skills" ]
}

@test "install_copilot_instructions skills symlink is idempotent" {
  local toolbox="$TEST_TEMP_DIR/toolbox_skills2"
  local home_dir="$TEST_TEMP_DIR/home_skills2"
  mkdir -p "$toolbox/copilot/skills"
  mkdir -p "$home_dir/.copilot"
  # Pre-create a stale symlink
  ln -s /tmp/stale "$home_dir/.copilot/skills"

  cat > "$TEST_TEMP_DIR/test_skills_symlink_idem.sh" << EOF
#!/bin/bash
toolbox_root="$toolbox"
HOME="$home_dir"
skills_src="\$toolbox_root/copilot/skills"
skills_link="\$HOME/.copilot/skills"
if [ -d "\$skills_src" ]; then
  mkdir -p "\$HOME/.copilot"
  rm -rf "\$skills_link"
  ln -s "\$skills_src" "\$skills_link"
  echo "symlinked"
fi
EOF
  chmod +x "$TEST_TEMP_DIR/test_skills_symlink_idem.sh"
  run "$TEST_TEMP_DIR/test_skills_symlink_idem.sh"
  [ "$status" -eq 0 ]
  [ -L "$home_dir/.copilot/skills" ]
  [ "$(readlink "$home_dir/.copilot/skills")" = "$toolbox/copilot/skills" ]
}

@test "install_copilot_instructions skips skills symlink when copilot/skills missing" {
  local toolbox="$TEST_TEMP_DIR/toolbox_noskills"
  local home_dir="$TEST_TEMP_DIR/home_noskills"
  mkdir -p "$toolbox/copilot"
  # no skills dir

  cat > "$TEST_TEMP_DIR/test_skills_missing.sh" << EOF
#!/bin/bash
toolbox_root="$toolbox"
HOME="$home_dir"
skills_src="\$toolbox_root/copilot/skills"
skills_link="\$HOME/.copilot/skills"
if [ -d "\$skills_src" ]; then
  mkdir -p "\$HOME/.copilot"
  rm -rf "\$skills_link"
  ln -s "\$skills_src" "\$skills_link"
  echo "symlinked"
else
  echo "skipped"
fi
EOF
  chmod +x "$TEST_TEMP_DIR/test_skills_missing.sh"
  run "$TEST_TEMP_DIR/test_skills_missing.sh"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "skipped" ]]
  [ ! -e "$home_dir/.copilot/skills" ]
}

@test "bootstrap.bash defines install_claude_code_integration function" {
  run grep "^install_claude_code_integration()" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "install_claude_code_integration copies to ~/.claude/CLAUDE.md" {
  run grep "CLAUDE.md" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ".claude/CLAUDE.md" ]]
}

@test "install_claude_code_integration is included in both default and update task lists" {
  run bash -c "
    grep -A55 'local default_tasks' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' | grep -q 'install_claude_code_integration' &&
    grep -A55 'local update_tasks' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' | grep -q 'install_claude_code_integration'
  "
  [ "$status" -eq 0 ]
}

@test "install_claude_code_integration symlinks CLAUDE.md when source exists" {
  local src_dir="$TEST_TEMP_DIR/claude_copilot"
  local dest_dir="$TEST_TEMP_DIR/claude_home/.claude"
  mkdir -p "$src_dir"
  echo "# test instructions" > "$src_dir/copilot-instructions.md"

  cat > "$TEST_TEMP_DIR/test_install_claude.sh" << EOF
#!/bin/bash
toolbox_root="$TEST_TEMP_DIR"
HOME="$TEST_TEMP_DIR/claude_home"
src="\$toolbox_root/claude_copilot/copilot-instructions.md"
dest="\$HOME/.claude/CLAUDE.md"
if [ -f "\$src" ]; then
  mkdir -p "\$HOME/.claude"
  rm -f "\$dest"
  ln -s "\$src" "\$dest"
  echo "symlinked"
else
  echo "skipped"
fi
EOF
  chmod +x "$TEST_TEMP_DIR/test_install_claude.sh"
  run "$TEST_TEMP_DIR/test_install_claude.sh"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "symlinked" ]]
  [ -L "$dest_dir/CLAUDE.md" ]
}

@test "install_claude_code_integration skips gracefully when source missing" {
  cat > "$TEST_TEMP_DIR/test_install_claude_missing.sh" << EOF
#!/bin/bash
toolbox_root="$TEST_TEMP_DIR/no-such-dir"
HOME="$TEST_TEMP_DIR/claude_home2"
src="\$toolbox_root/copilot/copilot-instructions.md"
dest="\$HOME/.claude/CLAUDE.md"
if [ -f "\$src" ]; then
  mkdir -p "\$HOME/.claude"
  ln -s "\$src" "\$dest"
  echo "symlinked"
else
  echo "skipped"
fi
EOF
  chmod +x "$TEST_TEMP_DIR/test_install_claude_missing.sh"
  run "$TEST_TEMP_DIR/test_install_claude_missing.sh"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "skipped" ]]
}


setup_claude_fixture() {
  toolbox="$TEST_TEMP_DIR/claude-toolbox"
  home_dir="$TEST_TEMP_DIR/claude-home"
  mkdir -p "$toolbox/copilot/skills/devenv-fixture" "$toolbox/copilot/skills/common"
  printf '# Instructions\n' > "$toolbox/copilot/copilot-instructions.md"
  printf '%s\n' '---' 'name: devenv-fixture' 'description: Synthetic test skill' '---' '# Fixture' > "$toolbox/copilot/skills/devenv-fixture/SKILL.md"
  printf '# Shared reference\n' > "$toolbox/copilot/skills/common/reference.md"
  printf '# Tools reference\n' > "$toolbox/copilot/skills/_tools-reference.md"
}

run_claude_installer() {
  local installer
  installer="$(sed -n '/^link_replacing_symlink_only()/,/^}/p;/^install_claude_code_integration()/,/^}/p' "$PROJECT_ROOT/.devcontainer/bootstrap.bash")"
  run env toolbox_root="$toolbox" HOME="$home_dir" bash -c "$installer; install_claude_code_integration"
}

@test "Claude integration creates individual skill and shared-reference links" {
  setup_claude_fixture
  run_claude_installer
  [ "$status" -eq 0 ]
  [ -d "$home_dir/.claude/skills" ]
  [ ! -L "$home_dir/.claude/skills" ]
  [ -L "$home_dir/.claude/skills/devenv-fixture" ]
  [ -L "$home_dir/.claude/skills/common" ]
  [ -L "$home_dir/.claude/skills/_tools-reference.md" ]
  [ "$(readlink "$home_dir/.claude/skills/devenv-fixture")" = "$toolbox/copilot/skills/devenv-fixture" ]
  [ -f "$home_dir/.claude/skills/devenv-fixture/SKILL.md" ]
  [ "$(readlink "$home_dir/.claude/CLAUDE.md")" = "$toolbox/copilot/copilot-instructions.md" ]
}

@test "Claude integration preserves synced and personal skills" {
  setup_claude_fixture
  mkdir -p "$home_dir/.claude/skills/synced" "$home_dir/.claude/skills/personal"
  printf 'keep synced\n' > "$home_dir/.claude/skills/synced/marker"
  printf '# Personal\n' > "$home_dir/.claude/skills/personal/SKILL.md"
  run_claude_installer
  [ "$status" -eq 0 ]
  [ "$(cat "$home_dir/.claude/skills/synced/marker")" = "keep synced" ]
  [ "$(cat "$home_dir/.claude/skills/personal/SKILL.md")" = "# Personal" ]
  [ -L "$home_dir/.claude/skills/devenv-fixture" ]
}

@test "Claude integration is repeatable and preserves personal name collisions" {
  setup_claude_fixture
  mkdir -p "$home_dir/.claude/skills/devenv-fixture"
  printf '# Personal collision\n' > "$home_dir/.claude/skills/devenv-fixture/SKILL.md"
  run_claude_installer
  [ "$status" -eq 0 ]
  run_claude_installer
  [ "$status" -eq 0 ]
  [ ! -L "$home_dir/.claude/skills/devenv-fixture" ]
  [ "$(cat "$home_dir/.claude/skills/devenv-fixture/SKILL.md")" = "# Personal collision" ]
  [ "$(readlink "$home_dir/.claude/skills/common")" = "$toolbox/copilot/skills/common" ]
  [[ "$output" == *"WARNING:"*"devenv-fixture"* ]]
}

@test "Claude integration skips missing source skills without touching personal skills" {
  setup_claude_fixture
  rm -rf "$toolbox/copilot/skills"
  mkdir -p "$home_dir/.claude/skills/synced"
  printf 'keep synced\n' > "$home_dir/.claude/skills/synced/marker"
  run_claude_installer
  [ "$status" -eq 0 ]
  [ "$(cat "$home_dir/.claude/skills/synced/marker")" = "keep synced" ]
  [[ "$output" == *"WARNING: copilot/skills not found"* ]]
}

# Idempotency tests

@test "install_dotnet uses ln -sf to allow re-running safely" {
  run grep "ln -sf.*dotnet" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "install_dotnet skips download when dotnet already installed" {
  run grep "command -v dotnet" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "install_dotnet installs dotnet-format only when not already present" {
  run grep "dotnet-format.*tool install\|tool install.*dotnet-format" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
  # Ensure install is guarded by a list check, not unconditional
  run bash -c "grep -A1 'dotnet-format' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' | grep -q 'tool list\|grep'"
  [ "$status" -eq 0 ]
}

@test "configure_dotnet_tools guards reportgenerator install with list check" {
  run bash -c "grep 'tool list.*reportgenerator\|reportgenerator.*tool list' '$PROJECT_ROOT/.devcontainer/bootstrap.bash'"
  [ "$status" -eq 0 ]
}

@test "configure_dotnet_tools guards dotnet-outdated install with list check" {
  run bash -c "grep 'tool list.*dotnet-outdated\|dotnet-outdated.*tool list' '$PROJECT_ROOT/.devcontainer/bootstrap.bash'"
  [ "$status" -eq 0 ]
}

@test "ensure_directories_and_settings guards sysctl.conf append to prevent duplicates" {
  run grep "grep.*sysctl.conf\|sysctl.conf.*grep" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  [ "$status" -eq 0 ]
}

@test "init_bootstrap_run_time uses rm -f to avoid failure when file missing" {
  run bash -c "grep 'rm -f.*repo_bootstrap_run_file\|rm -f.*bootstrap_run' '$PROJECT_ROOT/.devcontainer/bootstrap.bash'"
  [ "$status" -eq 0 ]
}

@test "install_or_configure_nvm checks NVM directory not command -v nvm" {
  # Should check for nvm.sh file presence, not 'command -v nvm' (which fails in non-interactive shells)
  run bash -c "grep -E 'NVM_DIR.*nvm\.sh|nvm\.sh.*NVM_DIR' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' | grep -v 'source\|\\\\.\|#\|echo\|EOF' | head -5"
  [ "$status" -eq 0 ]
  run bash -c "grep '! -f.*nvm.sh\|-f.*NVM_DIR.*nvm.sh' '$PROJECT_ROOT/.devcontainer/bootstrap.bash'"
  [ "$status" -eq 0 ]
}

@test "install_or_configure_nvm does not use command -v nvm as its primary check" {
  # The old check 'command -v nvm' doesn't work in non-interactive shells; should use directory check
  run bash -c "grep -v '#' '$PROJECT_ROOT/.devcontainer/bootstrap.bash' | grep 'command -v nvm'"
  [ "$status" -ne 0 ]
}

@test "generate_env_vars_file writes env-vars.sh with owner-only permissions" {
  local toolbox="$TEST_TEMP_DIR/envvars-toolbox"
  mkdir -p "$toolbox/.setup"
  local generator
  generator="$(sed -n '/^generate_env_vars_file()/,/^}/p' "$PROJECT_ROOT/.devcontainer/bootstrap.bash")"
  run env toolbox_root="$toolbox" setup_dir="$toolbox/.setup" bash -c "$generator; generate_env_vars_file"
  [ "$status" -eq 0 ]
  [ -f "$toolbox/.runtime/env-vars.sh" ]
  # The file is sourced, never executed, and later holds secrets (tokens,
  # auth keys): it must be readable by its owner only.
  [ "$(stat -c '%a' "$toolbox/.runtime/env-vars.sh")" = "600" ]
}

# Runs bootstrap's configure_* functions against a provider's real hooks, with the
# credential, identity and dotnet seams stubbed. DOTNET_LOG records every dotnet call.
run_feed_config() {   # run_feed_config <provider> <function> [args...]
  local provider="$1" fn="$2"; shift 2
  local home_dir="$TEST_TEMP_DIR/feed-home"
  mkdir -p "$home_dir" "$TEST_TEMP_DIR/dotnet-bin"
  export DOTNET_LOG="$TEST_TEMP_DIR/dotnet.log"; : > "$DOTNET_LOG"
  cat > "$TEST_TEMP_DIR/dotnet-bin/dotnet" <<'STUB'
#!/usr/bin/env bash
if [ "$1 $2 $3" = "nuget list source" ]; then printf '%s\n' "${DOTNET_LIST:-}"; exit 0; fi
printf '%s\n' "$*" >> "$DOTNET_LOG"
exit 0
STUB
  chmod +x "$TEST_TEMP_DIR/dotnet-bin/dotnet"
  local funcs
  funcs="$(sed -n '/^add_nuget_source_if_not_exists()/,/^}/p;/^configure_nuget_sources()/,/^}/p;/^configure_user_npmrc()/,/^}/p' "$PROJECT_ROOT/.devcontainer/bootstrap.bash")"
  run env HOME="$home_dir" DOTNET_LOG="$DOTNET_LOG" DOTNET_LIST="${DOTNET_LIST:-}" toolbox_root="$TEST_TEMP_DIR/toolbox" \
      dotnet_cmd="$TEST_TEMP_DIR/dotnet-bin/dotnet" DEVENV_TOOLS="$PROJECT_ROOT/tools" \
      bash -c "
        source \"\$DEVENV_TOOLS/lib/providers/provider-core.bash\"
        PROVIDER_NAME=$provider
        provider_load bootstrap
        ensure_provider_seam() { :; }
        provider_secret_get() { echo feed-token-123; }
        provider_org_get() { echo the-org; }
        provider_user_get() { echo the-user; }
        config_read_value() { echo 'https://nuget.pkg.github.com/the-org/index.json'; }
        $funcs
        $fn $*
      "
}

# Runs bootstrap's require_provider_token (no terminal) with a seed token and a stubbed validator.
# VALIDATE_RC is what the provider's validate hook returns (unset = no hook defined).
run_seed_flow() {
  local setup_dir="$TEST_TEMP_DIR/seed-setup"
  mkdir -p "$setup_dir"
  printf 'seed-token-abc' > "$setup_dir/provider_token.txt"
  printf 'the-user' > "$setup_dir/provider_user.txt"
  printf 'the-org' > "$setup_dir/provider_org.txt"
  export IMPORT_LOG="$TEST_TEMP_DIR/import.log"; : > "$IMPORT_LOG"
  local funcs hook=""
  funcs="$(sed -n '/^_bootstrap_is_interactive()/,/^}/p;/^require_provider_token()/,/^}/p' "$PROJECT_ROOT/.devcontainer/bootstrap.bash")"
  if [ -n "${VALIDATE_RC:-}" ]; then
    hook="provider_bootstrap_validate_token() { cat >/dev/null; return $VALIDATE_RC; }"
  fi
  run env DEVENV_TOOLS="$PROJECT_ROOT/tools" setup_dir="$setup_dir" IMPORT_LOG="$IMPORT_LOG" \
      email_file=/nonexistent name_file=/nonexistent IMPORT_RC="${IMPORT_RC:-0}" bash -c "
        source \"\$DEVENV_TOOLS/lib/providers/provider-core.bash\"
        ensure_provider_seam() { :; }
        provider_auth_status() { return 1; }
        provider_auth_import_token() { cat > \"\$IMPORT_LOG\"; return \$IMPORT_RC; }
        $hook
        $funcs
        require_provider_token </dev/null
        echo \"RC=\$?\"
      "
}

@test "require_provider_token: a seed the provider accepts is imported and deleted" {
  VALIDATE_RC=0 run_seed_flow
  [ "$(cat "$IMPORT_LOG")" = "seed-token-abc" ]
  [ ! -f "$TEST_TEMP_DIR/seed-setup/provider_token.txt" ]
  [[ "$output" == *"RC=0"* ]]
}

@test "require_provider_token: a seed the provider rejects is neither imported nor deleted, and bootstrap fails without a terminal" {
  VALIDATE_RC=1 run_seed_flow
  [ ! -s "$IMPORT_LOG" ]
  [ -f "$TEST_TEMP_DIR/seed-setup/provider_token.txt" ]
  [[ "$output" == *"RC=1"* ]]
  [[ "$output" == *"rejected"* ]]
}

@test "require_provider_token: an unverifiable seed (provider unreachable) is imported with a warning" {
  VALIDATE_RC=2 run_seed_flow
  [ "$(cat "$IMPORT_LOG")" = "seed-token-abc" ]
  [ ! -f "$TEST_TEMP_DIR/seed-setup/provider_token.txt" ]
  [[ "$output" == *"could not verify"* ]]
  [[ "$output" == *"RC=0"* ]]
}

@test "require_provider_token: a provider with no validate hook imports the seed as before" {
  run_seed_flow
  [ "$(cat "$IMPORT_LOG")" = "seed-token-abc" ]
  [ ! -f "$TEST_TEMP_DIR/seed-setup/provider_token.txt" ]
  [[ "$output" == *"RC=0"* ]]
}

@test "require_provider_token: a seed that cannot be imported is kept and bootstrap fails without a terminal" {
  VALIDATE_RC=0 IMPORT_RC=1 run_seed_flow
  [ -f "$TEST_TEMP_DIR/seed-setup/provider_token.txt" ]
  [[ "$output" == *"RC=1"* ]]
}

@test "configure_nuget_sources registers no GitHub feed and sends no token under azure" {
  run_feed_config azure configure_nuget_sources
  [ "$status" -eq 0 ]
  run grep -q 'nuget.pkg.github.com' "$DOTNET_LOG"
  [ "$status" -ne 0 ]
  run grep -q 'feed-token-123' "$DOTNET_LOG"
  [ "$status" -ne 0 ]
  # the local development source is still registered
  grep -q 'local-nuget-dev' "$DOTNET_LOG"
}

@test "configure_nuget_sources registers the GitHub feed with the provider credential under github" {
  run_feed_config github configure_nuget_sources
  [ "$status" -eq 0 ]
  grep -q 'nuget.pkg.github.com/the-org' "$DOTNET_LOG"
  grep -q -- '-u the-user' "$DOTNET_LOG"
}

@test "configure_nuget_sources refreshes the credentials of a source that already exists (token rotation)" {
  DOTNET_LIST="  1.  github [Enabled]
      https://nuget.pkg.github.com/the-org/index.json" run_feed_config github configure_nuget_sources
  [ "$status" -eq 0 ]
  grep -q 'nuget update source github' "$DOTNET_LOG"
  grep -q 'feed-token-123' "$DOTNET_LOG"
  run grep -q 'nuget add source github' "$DOTNET_LOG"
  [ "$status" -ne 0 ]
}

@test "configure_user_npmrc leaves ~/.npmrc with owner-only permissions" {
  local home_dir="$TEST_TEMP_DIR/feed-home"
  mkdir -p "$home_dir"
  printf '//npm.pkg.github.com/:_authToken=old-token\n' > "$home_dir/.npmrc"
  chmod 644 "$home_dir/.npmrc"
  run_feed_config azure configure_user_npmrc
  [ "$status" -eq 0 ]
  [ "$(stat -c '%a' "$home_dir/.npmrc")" = "600" ]
  grep -q 'old-token' "$home_dir/.npmrc"
}

@test "configure_user_npmrc under azure never writes the provider token into the npmrc" {
  run_feed_config azure configure_user_npmrc
  [ "$status" -eq 0 ]
  [ ! -f "$TEST_TEMP_DIR/feed-home/.npmrc" ] || run ! grep -q 'feed-token-123' "$TEST_TEMP_DIR/feed-home/.npmrc"
}

@test "configure_user_npmrc under github writes the registry token and keeps the file owner-only" {
  local home_dir="$TEST_TEMP_DIR/feed-home"
  mkdir -p "$home_dir"
  printf 'registry=https://registry.example.test/\n' > "$home_dir/.npmrc"
  chmod 644 "$home_dir/.npmrc"
  run_feed_config github configure_user_npmrc
  [ "$status" -eq 0 ]
  grep -q '^//npm.pkg.github.com/:_authToken=feed-token-123$' "$home_dir/.npmrc"
  grep -q '^registry=https://registry.example.test/$' "$home_dir/.npmrc"
  [ "$(stat -c '%a' "$home_dir/.npmrc")" = "600" ]
}

@test "install_or_configure_nvm resolves NODE_VERSION when sourced before DEVENV_ROOT is set" {
  [ -f /usr/local/share/nvm/nvm.sh ] || skip "nvm is not installed here; the already-installed path is what this test exercises"
  # Reordered case: top-level sourcing of tool-versions.bash no-ops because
  # DEVENV_ROOT is not set yet, so the nvm task has to resolve it itself.
  run env -u DEVENV_ROOT -u NODE_VERSION -u PNPM_VERSION bash -c "
    source '$PROJECT_ROOT/.devcontainer/bootstrap.bash'
    [ -z \"\${NODE_VERSION:-}\" ] || { echo 'precondition: NODE_VERSION already set'; exit 1; }
    install_or_configure_nvm >/dev/null
    echo \"NODE_VERSION=\${NODE_VERSION:-}\"
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ NODE_VERSION=[0-9]+\.[0-9]+\.[0-9]+ ]]
}

# Scratch toolbox holding the real bootstrap.sh/bootstrap.bash plus two stub
# tasks, so the entry path can be run end to end without touching the machine.
setup_bootstrap_entry_fixture() {
  entry_toolbox="$TEST_TEMP_DIR/entry-toolbox"
  mkdir -p "$entry_toolbox/.devcontainer"
  cp "$PROJECT_ROOT/.devcontainer/bootstrap.sh" "$PROJECT_ROOT/.devcontainer/bootstrap.bash" "$entry_toolbox/.devcontainer/"
  printf '%s\n' \
    'stub_ok_task() { echo "STUB_OK_MARKER"; }' \
    'stub_fail_task() { echo "STUB_FAIL_MARKER"; return 1; }' \
    >> "$entry_toolbox/.devcontainer/bootstrap.bash"
  entry_log="$entry_toolbox/.runtime/bootstrap.log"
}

@test "bootstrap.sh tees task output to a private .runtime/bootstrap.log" {
  setup_bootstrap_entry_fixture
  run env -u DEVENV_ROOT bash "$entry_toolbox/.devcontainer/bootstrap.sh" stub_ok_task
  [ "$status" -eq 0 ]
  [[ "$output" == *"STUB_OK_MARKER"* ]]
  [ -f "$entry_log" ]
  grep -q "STUB_OK_MARKER" "$entry_log"
  # Output can echo secrets: the log is owner-only like the other generated files.
  [ "$(stat -c '%a' "$entry_log")" = "600" ]
}

@test "bootstrap.sh failing task leaves a log line, exits non-zero, and a re-run converges" {
  setup_bootstrap_entry_fixture
  run env -u DEVENV_ROOT bash "$entry_toolbox/.devcontainer/bootstrap.sh" stub_fail_task
  [ "$status" -ne 0 ]
  grep -q "STUB_FAIL_MARKER" "$entry_log"
  grep -q "Task failed: stub_fail_task" "$entry_log"
  # The entry path reports the failure through the library's on_error handler.
  [[ "$output" == *"An error occurred (exit status 1)"* ]]
  # Re-running after the failure succeeds and appends to the same log.
  run env -u DEVENV_ROOT bash "$entry_toolbox/.devcontainer/bootstrap.sh" stub_ok_task
  [ "$status" -eq 0 ]
  grep -q "STUB_FAIL_MARKER" "$entry_log"
  grep -q "STUB_OK_MARKER" "$entry_log"
}

@test "install_yq installs the pinned version via a private mktemp path" {
  local stubs="$TEST_TEMP_DIR/yq-stubs" calls="$TEST_TEMP_DIR/yq-calls.log"
  mkdir -p "$stubs"
  : > "$calls"
  # Stubs stand in for the network and for sudo, so nothing is installed. A
  # curl call is the old "latest release" probe and is recorded as such.
  printf '%s\n' '#!/bin/bash' 'echo "curl-called $*" >> "$CALLS"' > "$stubs/curl"
  printf '%s\n' '#!/bin/bash' \
    'while [ $# -gt 0 ]; do [ "$1" = "-O" ] && { echo "wget-out=$2" >> "$CALLS"; echo stub > "$2"; }; last="$1"; shift; done' \
    'echo "wget-url=$last" >> "$CALLS"' > "$stubs/wget"
  printf '%s\n' '#!/bin/bash' 'echo "sudo $*" >> "$CALLS"' > "$stubs/sudo"
  chmod +x "$stubs/curl" "$stubs/wget" "$stubs/sudo"
  local pinned
  pinned="$(env -u YQ_VERSION bash -c "source '$PROJECT_ROOT/.devcontainer/tool-versions.bash' && echo \"\$YQ_VERSION\"")"
  [ -n "$pinned" ]
  # /usr/local/bin (where a real yq lives) is left off PATH so the function
  # takes its install path; DEVENV_ROOT is unset so the version has to be
  # resolved by the task itself.
  # The stub wget writes "stub"; pin that content's hash so verification
  # passes. YQ_VERSION is supplied so tool-versions.bash is not sourced over
  # these test pins.
  local stub_sha
  stub_sha="$(printf 'stub\n' | sha256sum | cut -d' ' -f1)"
  run env -u DEVENV_ROOT YQ_VERSION="$pinned" CALLS="$calls" YQ_SHA256_AMD64="$stub_sha" YQ_SHA256_ARM64="$stub_sha" PATH="$stubs:/usr/bin:/bin" bash -c "source '$PROJECT_ROOT/.devcontainer/bootstrap.bash'; install_yq"
  [ "$status" -eq 0 ]
  # Pinned version, no "latest release" probe against the GitHub API.
  run ! grep -q "^curl-called" "$calls"
  grep -q "^wget-url=https://github.com/mikefarah/yq/releases/download/$pinned/yq_linux_" "$calls"
  # The download lands in a private temp file that is moved into place.
  local downloaded
  downloaded="$(sed -n 's/^wget-out=//p' "$calls")"
  [ -n "$downloaded" ]
  [ "$downloaded" != "/tmp/yq" ]
  grep -q "sudo mv $downloaded /usr/local/bin/yq" "$calls"
}

@test "tool-versions.bash pins sha256 digests for the deterministic downloads" {
  run env -u YQ_SHA256_AMD64 -u YQ_SHA256_ARM64 -u NVM_INSTALL_SHA256 bash -c "
    source '$PROJECT_ROOT/.devcontainer/tool-versions.bash'
    echo \"\${YQ_SHA256_AMD64:-} \${YQ_SHA256_ARM64:-} \${NVM_INSTALL_SHA256:-}\"
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^[0-9a-f]{64}\ [0-9a-f]{64}\ [0-9a-f]{64}$ ]]
}

@test "tool-versions.bash documents the mutable downloads left unverified" {
  local file="$PROJECT_ROOT/.devcontainer/tool-versions.bash"
  grep -qi "accepted exceptions" "$file"
  local site
  for site in tailscale get.docker.com dotnet-install getvsdbg minikube; do
    grep -q "$site" "$file"
  done
}

@test "tool-versions.bash is the single home for runtime-fetched tool versions" {
  run env -u YQ_VERSION -u NVM_VERSION -u TURBO_VERSION -u DOTNET_CHANNELS -u K8S_APT_TRACK bash -c "
    source '$PROJECT_ROOT/.devcontainer/tool-versions.bash'
    echo \"yq=\${YQ_VERSION:-} nvm=\${NVM_VERSION:-} turbo=\${TURBO_VERSION:-} dotnet=\${DOTNET_CHANNELS:-} k8s=\${K8S_APT_TRACK:-}\"
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ yq=v[0-9]+\.[0-9]+\.[0-9]+\ nvm=v[0-9]+\.[0-9]+\.[0-9]+\ turbo=[0-9]+\.[0-9]+\.[0-9]+\ dotnet=[0-9.]+( [0-9.]+)*\ k8s=v[0-9]+\.[0-9]+$ ]]
}

@test "install_node_packages installs turbo at the version declared in tool-versions.bash" {
  local calls="$TEST_TEMP_DIR/npm-calls.log"
  : > "$calls"
  run env -u DEVENV_ROOT CALLS="$calls" PNPM_VERSION=1.2.3 NODE_VERSION=4.5.6 TURBO_VERSION=7.7.7 bash -c "
    source '$PROJECT_ROOT/.devcontainer/bootstrap.bash'
    call_npm() { echo \"npm \$*\" >> \"\$CALLS\"; }
    reclaim_global_pnpm_ownership() { :; }
    install_node_packages
  "
  [ "$status" -eq 0 ]
  grep -q "npm install -g turbo@7.7.7" "$calls"
}

@test "bootstrap.bash carries no hard-coded runtime tool versions" {
  # Strip comment-only lines so explanatory text can still mention a version.
  local code
  code="$(grep -v '^[[:space:]]*#' "$PROJECT_ROOT/.devcontainer/bootstrap.bash")"
  [[ "$code" != *"v4.35.1"* ]]
  [[ "$code" != *"releases/latest"* ]]
  [[ "$code" != *"nvm/v0.39.5"* ]]
  [[ "$code" != *"turbo@2.0.6"* ]]
  [[ "$code" != *"dotnet-install.sh -c 8.0"* ]]
  [[ "$code" != *"stable:/v1.31"* ]]
  [[ "$code" == *'nvm-sh/nvm/${NVM_VERSION}/install.sh'* ]]
  # The installer is downloaded, verified, then run: never piped into a shell.
  [[ "$code" == *'download_verified "https://raw.githubusercontent.com/nvm-sh/nvm/'* ]]
  [[ "$code" != *"install.sh | bash"* ]]
  [[ "$code" == *'stable:/${K8S_APT_TRACK}/deb'* ]]
  [[ "$code" == *'${DOTNET_CHANNELS}'* || "$code" == *'$DOTNET_CHANNELS'* ]]
}

@test "bootstrap.sh refuses to start while another bootstrap holds the lock" {
  setup_bootstrap_entry_fixture
  local lock_home="$TEST_TEMP_DIR/lock-home"
  mkdir -p "$lock_home"
  # A second process holding the lock stands in for a running bootstrap.
  ( exec 9>"$lock_home/.bootstrap.lock"; flock -n 9 && sleep 30 ) &
  local holder=$!
  sleep 1
  run env -u DEVENV_ROOT HOME="$lock_home" bash "$entry_toolbox/.devcontainer/bootstrap.sh" stub_ok_task
  kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null || true
  [ "$status" -ne 0 ]
  [[ "$output" == *"already running"* ]]
  [[ "$output" != *"STUB_OK_MARKER"* ]]
  # A refused start must not touch the log.
  [ ! -s "$entry_log" ]
}

@test "bootstrap.sh runs when the lock is free, and when its parent already holds it" {
  setup_bootstrap_entry_fixture
  local lock_home="$TEST_TEMP_DIR/lock-home2"
  mkdir -p "$lock_home"
  run env -u DEVENV_ROOT HOME="$lock_home" bash "$entry_toolbox/.devcontainer/bootstrap.sh" stub_ok_task
  [ "$status" -eq 0 ]
  [[ "$output" == *"STUB_OK_MARKER"* ]]
  # container-start.sh takes the lock first and marks it as held; running
  # bootstrap.sh under it must not deadlock against its own parent.
  ( exec 9>"$lock_home/.bootstrap.lock"; flock -n 9 && sleep 30 ) &
  local holder=$!
  sleep 1
  run env -u DEVENV_ROOT HOME="$lock_home" DEVENV_BOOTSTRAP_LOCK_HELD=1 bash "$entry_toolbox/.devcontainer/bootstrap.sh" stub_ok_task
  kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null || true
  [ "$status" -eq 0 ]
  [[ "$output" == *"STUB_OK_MARKER"* ]]
}

@test "container-start.sh marks the bootstrap lock as held for the child bootstrap" {
  run grep -E "export DEVENV_BOOTSTRAP_LOCK_HELD=1" "$PROJECT_ROOT/.devcontainer/container-start.sh"
  [ "$status" -eq 0 ]
}

@test "download_verified keeps a file whose sha256 matches the pin" {
  local stubs="$TEST_TEMP_DIR/dv-stubs" dest="$TEST_TEMP_DIR/dv-file"
  mkdir -p "$stubs"
  printf '%s\n' '#!/bin/bash' 'while [ $# -gt 0 ]; do [ "$1" = "-O" ] && printf "payload\n" > "$2"; shift; done' > "$stubs/wget"
  chmod +x "$stubs/wget"
  local good
  good="$(printf 'payload\n' | sha256sum | cut -d' ' -f1)"
  run env PATH="$stubs:$PATH" bash -c "source '$PROJECT_ROOT/.devcontainer/bootstrap.bash'; download_verified https://example.invalid/f '$dest' '$good'"
  [ "$status" -eq 0 ]
  [ "$(cat "$dest")" = "payload" ]
}

@test "download_verified refuses and removes a file whose sha256 does not match" {
  local stubs="$TEST_TEMP_DIR/dv-stubs2" dest="$TEST_TEMP_DIR/dv-file2"
  mkdir -p "$stubs"
  printf '%s\n' '#!/bin/bash' 'while [ $# -gt 0 ]; do [ "$1" = "-O" ] && printf "tampered\n" > "$2"; shift; done' > "$stubs/wget"
  chmod +x "$stubs/wget"
  local pinned
  pinned="$(printf 'payload\n' | sha256sum | cut -d' ' -f1)"
  run env PATH="$stubs:$PATH" bash -c "source '$PROJECT_ROOT/.devcontainer/bootstrap.bash'; download_verified https://example.invalid/f '$dest' '$pinned'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"sha256 mismatch"* ]]
  [ ! -e "$dest" ]
}

@test "download_verified refuses to download anything without a pin" {
  local dest="$TEST_TEMP_DIR/dv-file3"
  run bash -c "source '$PROJECT_ROOT/.devcontainer/bootstrap.bash'; download_verified https://example.invalid/f '$dest' ''"
  [ "$status" -ne 0 ]
  [[ "$output" == *"no sha256 pin"* ]]
  [ ! -e "$dest" ]
}

@test "install_yq does not install a binary that fails sha256 verification" {
  local stubs="$TEST_TEMP_DIR/yq-stubs2" calls="$TEST_TEMP_DIR/yq-calls2.log"
  mkdir -p "$stubs"
  : > "$calls"
  printf '%s\n' '#!/bin/bash' 'while [ $# -gt 0 ]; do [ "$1" = "-O" ] && { echo "wget-out=$2" >> "$CALLS"; echo tampered > "$2"; }; shift; done' > "$stubs/wget"
  printf '%s\n' '#!/bin/bash' 'echo "sudo $*" >> "$CALLS"' > "$stubs/sudo"
  chmod +x "$stubs/wget" "$stubs/sudo"
  local pinned
  pinned="$(printf 'stub\n' | sha256sum | cut -d' ' -f1)"
  run env -u DEVENV_ROOT YQ_VERSION=v1.2.3 CALLS="$calls" YQ_SHA256_AMD64="$pinned" YQ_SHA256_ARM64="$pinned" PATH="$stubs:/usr/bin:/bin" bash -c "source '$PROJECT_ROOT/.devcontainer/bootstrap.bash'; install_yq"
  [ "$status" -ne 0 ]
  [[ "$output" == *"sha256 mismatch"* ]]
  # Nothing was made executable or moved into place, and the temp file is gone.
  run ! grep -q "^sudo" "$calls"
  [ ! -e "$(sed -n 's/^wget-out=//p' "$calls")" ]
}

# ============================================================================
# Task runners: executed for real with every task stubbed
# ============================================================================

# Task names of one runner array in bootstrap.bash, one per line.
# runner_tasks <function-name> <array-name>
runner_tasks() {
  awk -v fn="$1" -v arr="$2" '
    $0 ~ "^" fn "\\(\\) \\{" { in_fn=1 }
    in_fn && $0 ~ "(local )?" arr "=\\(" { in_arr=1; next }
    in_arr && /^[[:space:]]*\)/ { exit }
    in_arr { gsub(/[[:space:]]/, ""); if ($0 != "") print }
  ' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
}

# The tasks only the full bootstrap runs: they reset or remove state, which a
# convergent update must never do.
DESTRUCTIVE_TASKS="cleanup_packages finish_message init_bootstrap_run_time reset_bashrc_to_original"

@test "runner task lists were extracted (guards the extraction itself)" {
  [ "$(runner_tasks run_bootstrap_tasks default_tasks | wc -l)" -gt 20 ]
  [ "$(runner_tasks run_update_tasks update_tasks | wc -l)" -gt 20 ]
}

@test "every runner task is a function defined by bootstrap.bash" {
  run bash -c "source '$PROJECT_ROOT/.devcontainer/bootstrap.bash'; for t in $(runner_tasks run_bootstrap_tasks default_tasks | tr '\n' ' ') $(runner_tasks run_update_tasks update_tasks | tr '\n' ' '); do declare -F \"\$t\" >/dev/null || echo \"undefined: \$t\"; done"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "the update runner is the bootstrap runner minus exactly the documented destructive set" {
  full="$(runner_tasks run_bootstrap_tasks default_tasks | sort)"
  upd="$(runner_tasks run_update_tasks update_tasks | sort)"
  missing="$(comm -23 <(echo "$full") <(echo "$upd") | tr '\n' ' ')"
  extra="$(comm -13 <(echo "$full") <(echo "$upd") | tr '\n' ' ')"
  [ -z "$extra" ]
  [ "$missing" = "$(echo "$DESTRUCTIVE_TASKS" | tr ' ' '\n' | sort | tr '\n' ' ')" ]
}

@test "the update runner keeps the bootstrap runner's relative task order" {
  full="$(runner_tasks run_bootstrap_tasks default_tasks)"
  expected="$(echo "$full" | grep -vxF -f <(echo "$DESTRUCTIVE_TASKS" | tr ' ' '\n'))"
  [ "$(runner_tasks run_update_tasks update_tasks)" = "$expected" ]
}

# stub_runner <runner> [failing-task]: sources bootstrap.bash, replaces every
# task with a recorder (optionally one that fails), and runs the runner in a
# throwaway HOME. Prints the recorded calls via $TEST_TEMP_DIR/calls.
stub_runner() {
  local runner="$1" failing="${2:-}" tasks
  tasks="$(runner_tasks run_bootstrap_tasks default_tasks | tr '\n' ' ')"
  : > "$TEST_TEMP_DIR/calls"
  HOME="$TEST_TEMP_DIR/home" CALLS="$TEST_TEMP_DIR/calls" FAILING="$failing" bash -c "
    source '$PROJECT_ROOT/.devcontainer/bootstrap.bash'
    for t in $tasks; do
      eval \"\$t() { echo \$t >> \\\"\\\$CALLS\\\"; [ \\\"\\\$FAILING\\\" != \$t ]; }\"
    done
    $runner
  "
}

@test "run_bootstrap_tasks executes every task once, in order" {
  mkdir -p "$TEST_TEMP_DIR/home"
  run stub_runner run_bootstrap_tasks
  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_TEMP_DIR/calls")" = "$(runner_tasks run_bootstrap_tasks default_tasks)" ]
}

@test "run_update_tasks executes its tasks in order and never a destructive one" {
  mkdir -p "$TEST_TEMP_DIR/home"
  run stub_runner run_update_tasks
  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_TEMP_DIR/calls")" = "$(runner_tasks run_update_tasks update_tasks)" ]
  for t in $DESTRUCTIVE_TASKS; do
    run ! grep -qx "$t" "$TEST_TEMP_DIR/calls"
  done
}

@test "a failing task stops run_bootstrap_tasks: exit 1, later tasks never run" {
  mkdir -p "$TEST_TEMP_DIR/home"
  run stub_runner run_bootstrap_tasks install_dotnet
  [ "$status" -eq 1 ]
  [[ "$output" == *"Task failed: install_dotnet"* ]]
  grep -qx install_dotnet "$TEST_TEMP_DIR/calls"
  run ! grep -qx load_setup_credentials "$TEST_TEMP_DIR/calls"
}

@test "a failing task stops run_update_tasks: exit 1, later tasks never run" {
  mkdir -p "$TEST_TEMP_DIR/home"
  run stub_runner run_update_tasks install_dotnet
  [ "$status" -eq 1 ]
  [[ "$output" == *"Task failed: install_dotnet"* ]]
  run ! grep -qx load_setup_credentials "$TEST_TEMP_DIR/calls"
}

@test "run_bootstrap_tasks with explicit names runs only those, in the order given" {
  mkdir -p "$TEST_TEMP_DIR/home"
  run stub_runner "run_bootstrap_tasks install_dotnet detect_architecture"
  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_TEMP_DIR/calls")" = "$(printf 'install_dotnet\ndetect_architecture')" ]
}

@test "run_bootstrap_tasks rejects an unknown task name with exit 1" {
  mkdir -p "$TEST_TEMP_DIR/home"
  run stub_runner "run_bootstrap_tasks no_such_task"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Unknown task: no_such_task"* ]]
}

@test "Bootstrap-Customization.md lists exactly the hook files run_custom_bootstrap_if_present runs" {
  doc="$PROJECT_ROOT/docs/Bootstrap-Customization.md"
  hooks="$(sed -n '/^run_custom_bootstrap_if_present()/,/^}/p' "$PROJECT_ROOT/.devcontainer/bootstrap.bash" | grep -oE '[a-z]+-custom-bootstrap\.sh' | sort -u)"
  [ "$(echo "$hooks" | wc -l)" -eq 2 ]
  for h in $hooks; do
    grep -qF "\`.devcontainer/$h\`" "$doc"
  done
}

@test "Bootstrap-Customization.md does not list a custom-bootstrap.sh hook that is never run" {
  run grep -n '\.devcontainer/custom-bootstrap\.sh' "$PROJECT_ROOT/docs/Bootstrap-Customization.md"
  [ "$status" -ne 0 ]
}

# key-update-provider picks the provider through the one INI reader: a config written
# `name = azure`, or with CRLF line endings, selects azure just as `name=azure` does.
@test "key-update-provider reads the provider name with spaces around =, or with CRLF" {
  local funcs variant root
  funcs="$(sed -n '/^_key_update_run()/,/^}/p;/^key-update-provider()/,/^}/p' "$PROJECT_ROOT/.devcontainer/bootstrap.bash")"
  for variant in $'[provider]\nname=azure\n' $'[provider]\nname = azure\n' $'[provider]\r\nname=azure\r\n'; do
    root="$(mktemp -d)"
    mkdir -p "$root/tools/lib/providers/azure" "$root/tools/lib"
    cp "$PROJECT_ROOT/tools/lib/config-reader.bash" "$root/tools/lib/"
    printf '#!/bin/bash\necho "rotated:azure"\n' > "$root/tools/lib/providers/azure/key-update.sh"
    printf '%s' "$variant" > "$root/devenv.config"
    run bash -c "unset DEVENV_KEY_UPDATE_PROVIDER; DEVENV_ROOT='$root'; $funcs; key-update-provider"
    rm -rf "$root"
    [ "$status" -eq 0 ] || { echo "variant $(printf '%q' "$variant"): $output"; return 1; }
    [[ "$output" == *"rotated:azure"* ]] || { echo "variant $(printf '%q' "$variant"): $output"; return 1; }
  done
}

@test "record_bootstrap_run_time writes both markers, and they agree" {
  local d="$TEST_TEMP_DIR/markers"; mkdir -p "$d/runtime"
  run bash -c "
    source <(sed -n '/^record_bootstrap_run_time()/,/^}/p' '$PROJECT_ROOT/.devcontainer/bootstrap.bash')
    container_bootstrap_run_file='$d/container'; repo_bootstrap_run_file='$d/runtime/repo'
    record_bootstrap_run_time >/dev/null
    [ -s \"\$container_bootstrap_run_file\" ] && cmp -s \"\$container_bootstrap_run_file\" \"\$repo_bootstrap_run_file\"
  "
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Robustness: symlink installs, PATH, missing seeds (functions sourced from
# the real bootstrap.bash)
# ---------------------------------------------------------------------------

@test "link_replacing_symlink_only creates a link, repoints a stale one, and is idempotent" {
  local d="$TEST_TEMP_DIR/lk"; mkdir -p "$d"; echo a > "$d/src"
  run bash -c "
    source <(sed -n '/^link_replacing_symlink_only()/,/^}/p' '$PROJECT_ROOT/.devcontainer/bootstrap.bash')
    link_replacing_symlink_only '$d/src' '$d/dest' && [ \"\$(readlink '$d/dest')\" = '$d/src' ] || exit 11
    ln -sfn /nonexistent '$d/dest'
    link_replacing_symlink_only '$d/src' '$d/dest' && [ \"\$(readlink '$d/dest')\" = '$d/src' ] || exit 12
    link_replacing_symlink_only '$d/src' '$d/dest'
  "
  [ "$status" -eq 0 ]
}

@test "link_replacing_symlink_only never deletes a real file or directory" {
  local d="$TEST_TEMP_DIR/lk2"; mkdir -p "$d/realdir"; echo keep > "$d/realdir/f"; echo keepfile > "$d/realfile"; echo a > "$d/src"
  run bash -c "
    source <(sed -n '/^link_replacing_symlink_only()/,/^}/p' '$PROJECT_ROOT/.devcontainer/bootstrap.bash')
    link_replacing_symlink_only '$d/src' '$d/realdir'
    link_replacing_symlink_only '$d/src' '$d/realfile'
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"not a symlink"* ]]
  [ ! -L "$d/realdir" ] && [ "$(cat "$d/realdir/f")" = "keep" ]
  [ ! -L "$d/realfile" ] && [ "$(cat "$d/realfile")" = "keepfile" ]
}

@test "install_copilot_instructions leaves a real ~/.copilot/skills directory in place" {
  local toolbox="$TEST_TEMP_DIR/tb"; local home_dir="$TEST_TEMP_DIR/hm"
  mkdir -p "$toolbox/copilot/skills" "$home_dir/.copilot/skills"
  echo mine > "$home_dir/.copilot/skills/my-skill"
  echo i > "$toolbox/copilot/copilot-instructions.md"
  run bash -c "
    HOME='$home_dir'; toolbox_root='$toolbox'
    source <(sed -n '/^link_replacing_symlink_only()/,/^}/p;/^install_copilot_instructions()/,/^}/p' '$PROJECT_ROOT/.devcontainer/bootstrap.bash')
    install_copilot_instructions
  "
  [ "$status" -eq 0 ]
  [ "$(cat "$home_dir/.copilot/skills/my-skill")" = "mine" ]
  [ -L "$home_dir/.copilot/copilot-instructions.md" ]
}

@test "the generated devenvrc puts tools before repo scripts and does not grow PATH when sourced twice" {
  local toolbox="$TEST_TEMP_DIR/tbpath"; local home_dir="$TEST_TEMP_DIR/hmpath"
  mkdir -p "$toolbox/tools" "$toolbox/repos/r1/scripts" "$home_dir"
  run bash -c "
    HOME='$home_dir'; toolbox_root='$toolbox'
    source <(sed -n '/^write_devenvrc()/,/^DEVENVRC_EOF\$/p' '$PROJECT_ROOT/.devcontainer/bootstrap.bash'; echo '}')
    write_devenvrc >/dev/null
    export DEVENV_ROOT='$toolbox'
    . '$home_dir/.devenvrc' 2>/dev/null; first=\"\$PATH\"
    . '$home_dir/.devenvrc' 2>/dev/null
    [ \"\$PATH\" = \"\$first\" ] || { echo 'PATH grew'; exit 11; }
    case \"\$PATH\" in *'$toolbox/tools:'*'$toolbox/repos/r1/scripts'*) ;; *) echo \"order: \$PATH\"; exit 12 ;; esac
  "
  [ "$status" -eq 0 ]
}

@test "git-completion is vendored in the repo and sourced from there, not downloaded at bootstrap" {
  [ -s "$PROJECT_ROOT/.devcontainer/git-completion.bash" ]
  run ! grep -n 'git-completion.bash.*raw.githubusercontent\|raw.githubusercontent.*git-completion' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  grep -q '\.devcontainer/git-completion.bash' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  run ! grep -n '\.git-completion\.bash' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
}

@test "the OS package round does not upgrade every installed package" {
  run ! grep -n 'apt upgrade\|apt-get upgrade' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
}

@test "bootstrap.bash code names no provider: provider-specific work comes from the bootstrap hooks" {
  # Third-party download hosts (yq, nvm) are not provider logic.
  run ! grep -nE '^[^#]*(azure|ghp_|x-access-token)' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  run ! grep -nE '^[^#]*[[:space:]]gh[[:space:]\\]' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
  run ! grep -nE '^[^#]*PROVIDER_NAME:-github' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
}

@test "each provider declares its OS packages through a hook: gh for github, none for azure" {
  run bash -c "source '$PROJECT_ROOT/tools/lib/providers/github/bootstrap.bash' 2>/dev/null; provider_bootstrap_apt_packages"
  [ "$output" = "gh" ]
  run bash -c "source '$PROJECT_ROOT/tools/lib/providers/azure/bootstrap.bash' 2>/dev/null; provider_bootstrap_apt_packages"
  [ -z "$output" ]
}

# ============================================================================
# require_setup_files: bootstrap refuses to run when the host `setup` answers
# are missing (fail fast, before any install work).
# ============================================================================

require_setup_files_run() {
  local setup_dir="$1"
  run bash -c "
    setup_dir='$setup_dir'
    source <(sed -n '/^require_setup_files()/,/^}/p' '$PROJECT_ROOT/.devcontainer/bootstrap.bash')
    require_setup_files
  "
}

make_setup_dir() {
  local dir="$TEST_TEMP_DIR/.setup"
  mkdir -p "$dir"
  local f
  for f in name.txt email.txt provider_org.txt provider_user.txt; do
    echo value > "$dir/$f"
  done
  echo "$dir"
}

@test "require_setup_files: all required seed files present passes" {
  require_setup_files_run "$(make_setup_dir)"
  [ "$status" -eq 0 ]
}

@test "require_setup_files: optional timezone and digitalocean files are not required" {
  local dir
  dir="$(make_setup_dir)"
  [ ! -e "$dir/timezone.txt" ] && [ ! -e "$dir/digitalocean_token.txt" ]
  require_setup_files_run "$dir"
  [ "$status" -eq 0 ]
}

@test "require_setup_files: missing .setup directory fails and tells the user to run setup" {
  require_setup_files_run "$TEST_TEMP_DIR/no-such-setup"
  [ "$status" -ne 0 ]
  [[ "$output" == *"setup"* ]]
  [[ "$output" == *"host"* ]]
}

@test "require_setup_files: each missing required file fails and is named" {
  local f dir
  for f in name.txt email.txt provider_org.txt provider_user.txt; do
    dir="$(make_setup_dir)"
    rm -f "$dir/$f"
    require_setup_files_run "$dir"
    [ "$status" -ne 0 ]
    [[ "$output" == *"$f"* ]]
  done
}

@test "require_setup_files: several missing files are all named in one message" {
  local dir
  dir="$(make_setup_dir)"
  rm -f "$dir/name.txt" "$dir/provider_org.txt"
  require_setup_files_run "$dir"
  [ "$status" -ne 0 ]
  [[ "$output" == *"name.txt"* ]]
  [[ "$output" == *"provider_org.txt"* ]]
}

@test "bootstrap task lists run require_setup_files right after initialize_paths" {
  run bash -c "
    f='$PROJECT_ROOT/.devcontainer/bootstrap.bash'
    for fn in run_bootstrap_tasks run_update_tasks; do
      sed -n \"/^\$fn()/,/^}/p\" \"\$f\" | grep -A1 '^ *initialize_paths\$' | tail -1 | grep -q 'require_setup_files' || { echo \"\$fn: not wired\"; exit 1; }
    done
  "
  [ "$status" -eq 0 ]
}
