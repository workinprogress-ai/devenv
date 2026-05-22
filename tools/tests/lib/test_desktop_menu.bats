#!/usr/bin/env bats

setup() {
  load ../test_helper
  test_helper_setup
  # Create the .fluxbox directory in the test HOME ($TEST_TEMP_DIR)
  mkdir -p "$TEST_TEMP_DIR/.fluxbox"
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_minimal_menu() {
  local menu_file="$1"
  cat > "$menu_file" << 'EOF'
[begin] (Test Menu)
    [exec] (Terminal) { xterm } <>
    [config] (Configuration)
[end]
EOF
}

_menu_with_folder() {
  local menu_file="$1"
  local folder="$2"
  cat > "$menu_file" << EOF
[begin] (Test Menu)
    [exec] (Terminal) { xterm } <>
    [submenu] (${folder}) {}
        [exec] (Editor) { gedit } <>
    [end]
    [config] (Configuration)
[end]
EOF
}

# ---------------------------------------------------------------------------
# desktop_menu_get_file
# ---------------------------------------------------------------------------

@test "desktop_menu_get_file returns default path under HOME" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  result="$(desktop_menu_get_file)"
  [[ "$result" == "${HOME}/.fluxbox/menu" ]]
}

@test "desktop_menu_get_file respects FLUXBOX_MENU override" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  export FLUXBOX_MENU="/tmp/custom-menu"
  result="$(desktop_menu_get_file)"
  [[ "$result" == "/tmp/custom-menu" ]]
}

# ---------------------------------------------------------------------------
# desktop_menu_shortcut_exists
# ---------------------------------------------------------------------------

@test "desktop_menu_shortcut_exists returns true when shortcut is present" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  menu_file="${TEST_TEMP_DIR}/.fluxbox/menu"
  _minimal_menu "$menu_file"
  desktop_menu_shortcut_exists "$menu_file" "Terminal"
}

@test "desktop_menu_shortcut_exists returns false when shortcut is absent" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  menu_file="${TEST_TEMP_DIR}/.fluxbox/menu"
  _minimal_menu "$menu_file"
  ! desktop_menu_shortcut_exists "$menu_file" "NonExistent"
}

# ---------------------------------------------------------------------------
# desktop_menu_folder_exists
# ---------------------------------------------------------------------------

@test "desktop_menu_folder_exists returns true when folder is present" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  menu_file="${TEST_TEMP_DIR}/.fluxbox/menu"
  _menu_with_folder "$menu_file" "Tools"
  desktop_menu_folder_exists "$menu_file" "Tools"
}

@test "desktop_menu_folder_exists returns false when folder is absent" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  menu_file="${TEST_TEMP_DIR}/.fluxbox/menu"
  _minimal_menu "$menu_file"
  ! desktop_menu_folder_exists "$menu_file" "Tools"
}

# ---------------------------------------------------------------------------
# desktop_menu_add_shortcut
# ---------------------------------------------------------------------------

@test "desktop_menu_add_shortcut adds entry at root level" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  menu_file="${TEST_TEMP_DIR}/.fluxbox/menu"
  _minimal_menu "$menu_file"
  desktop_menu_add_shortcut "$menu_file" "My App" "myapp"
  grep -qF "[exec] (My App) { myapp } <>" "$menu_file"
}

@test "desktop_menu_add_shortcut places entry before [config]" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  menu_file="${TEST_TEMP_DIR}/.fluxbox/menu"
  _minimal_menu "$menu_file"
  desktop_menu_add_shortcut "$menu_file" "My App" "myapp"
  # The new entry line must appear before the [config] line
  app_line=$(grep -n "\[exec\] (My App)" "$menu_file" | cut -d: -f1)
  config_line=$(grep -n "\[config\]" "$menu_file" | cut -d: -f1)
  [[ "$app_line" -lt "$config_line" ]]
}

@test "desktop_menu_add_shortcut is idempotent for the same label" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  menu_file="${TEST_TEMP_DIR}/.fluxbox/menu"
  _minimal_menu "$menu_file"
  desktop_menu_add_shortcut "$menu_file" "My App" "myapp"
  desktop_menu_add_shortcut "$menu_file" "My App" "myapp"
  count=$(grep -cF "[exec] (My App)" "$menu_file")
  [[ "$count" -eq 1 ]]
}

@test "desktop_menu_add_shortcut adds entry inside a named folder" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  menu_file="${TEST_TEMP_DIR}/.fluxbox/menu"
  _menu_with_folder "$menu_file" "Tools"
  desktop_menu_add_shortcut "$menu_file" "New Tool" "newtool" "Tools"
  grep -qF "[exec] (New Tool) { newtool } <>" "$menu_file"
  # Verify the entry is inside the Tools submenu (appears before its [end])
  tools_line=$(grep -n "\[submenu\] (Tools)" "$menu_file" | cut -d: -f1)
  entry_line=$(grep -n "\[exec\] (New Tool)" "$menu_file" | cut -d: -f1)
  [[ "$entry_line" -gt "$tools_line" ]]
}

@test "desktop_menu_add_shortcut fails when specified folder does not exist" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  menu_file="${TEST_TEMP_DIR}/.fluxbox/menu"
  _minimal_menu "$menu_file"
  run desktop_menu_add_shortcut "$menu_file" "My App" "myapp" "NoSuchFolder"
  [[ "$status" -ne 0 ]]
}

@test "desktop_menu_add_shortcut fails when menu file does not exist" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  run desktop_menu_add_shortcut "/nonexistent/menu" "My App" "myapp"
  [[ "$status" -ne 0 ]]
}

# ---------------------------------------------------------------------------
# desktop_menu_add_folder
# ---------------------------------------------------------------------------

@test "desktop_menu_add_folder adds folder at root level" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  menu_file="${TEST_TEMP_DIR}/.fluxbox/menu"
  _minimal_menu "$menu_file"
  desktop_menu_add_folder "$menu_file" "Databases"
  grep -qF "[submenu] (Databases)" "$menu_file"
  grep -qF "[end]" "$menu_file"
}

@test "desktop_menu_add_folder places folder before [config]" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  menu_file="${TEST_TEMP_DIR}/.fluxbox/menu"
  _minimal_menu "$menu_file"
  desktop_menu_add_folder "$menu_file" "Databases"
  folder_line=$(grep -n "\[submenu\] (Databases)" "$menu_file" | cut -d: -f1)
  config_line=$(grep -n "\[config\]" "$menu_file" | cut -d: -f1)
  [[ "$folder_line" -lt "$config_line" ]]
}

@test "desktop_menu_add_folder is idempotent for the same name" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  menu_file="${TEST_TEMP_DIR}/.fluxbox/menu"
  _minimal_menu "$menu_file"
  desktop_menu_add_folder "$menu_file" "Databases"
  desktop_menu_add_folder "$menu_file" "Databases"
  count=$(grep -cF "[submenu] (Databases)" "$menu_file")
  [[ "$count" -eq 1 ]]
}

@test "desktop_menu_add_folder adds nested folder inside a parent" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  menu_file="${TEST_TEMP_DIR}/.fluxbox/menu"
  _menu_with_folder "$menu_file" "Tools"
  desktop_menu_add_folder "$menu_file" "Databases" "Tools"
  grep -qF "[submenu] (Databases)" "$menu_file"
  # The nested folder must appear after the Tools submenu opening line
  tools_line=$(grep -n "\[submenu\] (Tools)" "$menu_file" | cut -d: -f1)
  db_line=$(grep -n "\[submenu\] (Databases)" "$menu_file" | cut -d: -f1)
  [[ "$db_line" -gt "$tools_line" ]]
}

@test "desktop_menu_add_folder fails when parent folder does not exist" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  menu_file="${TEST_TEMP_DIR}/.fluxbox/menu"
  _minimal_menu "$menu_file"
  run desktop_menu_add_folder "$menu_file" "Databases" "NoSuchParent"
  [[ "$status" -ne 0 ]]
}

@test "desktop_menu_add_folder fails when menu file does not exist" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  run desktop_menu_add_folder "/nonexistent/menu" "Databases"
  [[ "$status" -ne 0 ]]
}

@test "adding a shortcut into a newly added folder works" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  menu_file="${TEST_TEMP_DIR}/.fluxbox/menu"
  _minimal_menu "$menu_file"
  desktop_menu_add_folder "$menu_file" "Databases"
  desktop_menu_add_shortcut "$menu_file" "Compass" "mongodb-compass" "Databases"
  grep -qF "[submenu] (Databases)" "$menu_file"
  grep -qF "[exec] (Compass) { mongodb-compass } <>" "$menu_file"
}

# ---------------------------------------------------------------------------
# Library integrity
# ---------------------------------------------------------------------------

@test "desktop-menu library loads without errors" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  [[ "${_DESKTOP_MENU_LOADED}" == "true" ]]
}

@test "all desktop-menu functions are exported" {
  source "${DEVENV_ROOT}/tools/lib/desktop-menu.bash"
  declare -f desktop_menu_get_file       >/dev/null
  declare -f desktop_menu_shortcut_exists >/dev/null
  declare -f desktop_menu_folder_exists   >/dev/null
  declare -f desktop_menu_add_shortcut    >/dev/null
  declare -f desktop_menu_add_folder      >/dev/null
}
