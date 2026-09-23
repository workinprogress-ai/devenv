#!/usr/bin/env bats
# Tests for config-reader.bash library
# Tests reading INI-style devenv.config files

bats_require_minimum_version 1.5.0

setup() {
    # Handle both test locations (tests/ and tests/lib/ or tests/scripts/ or tests/devenv/)
    if [[ "$BATS_TEST_DIRNAME" =~ /tests/(lib|scripts|devenv)$ ]]; then
        export PROJECT_ROOT="${BATS_TEST_DIRNAME}/../../.."
    else
        export PROJECT_ROOT="${BATS_TEST_DIRNAME}/../.."
    fi
    export TEST_TEMP_DIR="$(mktemp -d)"
    export TEST_CONFIG_FILE="$TEST_TEMP_DIR/test.config"
}

teardown() {
    if [ -d "$TEST_TEMP_DIR" ]; then
        rm -rf "$TEST_TEMP_DIR"
    fi
}

# Helper to create a test config file
create_test_config() {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
# Test configuration file

[organization]
name=Test Organization
github_org=test-org
email_domain=test.example.com

[container]
registry=docker.io

[nuget]
feed_url=https://nuget.pkg.github.com/${GH_ORG}/index.json

[workflows]
status_workflow=TBD,Ready,In Progress,Done
issue_types=story,bug,enhancement
EOF
}

@test "config-reader: library can be sourced" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && echo loaded"
    [ "$status" -eq 0 ]
    [[ "$output" =~ loaded ]]
}

@test "config-reader: config_init fails with missing file" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init /nonexistent/file.config"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "not found" ]]
}

@test "config-reader: config_init succeeds with valid file" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && echo success"
    [ "$status" -eq 0 ]
    [[ "$output" =~ success ]]
}

@test "config-reader: config_read_value retrieves simple value" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value organization name"
    [ "$status" -eq 0 ]
    [ "$output" = "Test Organization" ]
}

@test "config-reader: config_read_value returns default when key missing" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value organization missing_key fallback_value"
    [ "$status" -eq 0 ]
    [ "$output" = "fallback_value" ]
}

@test "config-reader: config_read_value returns empty string when key missing and no default" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value organization missing_key"
    [ "$status" -eq 0 ]
    [ "$output" = "" ]
}

@test "config-reader: config_read_array parses comma-separated values" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_array workflows issue_types"
    [ "$status" -eq 0 ]
    [[ "$output" =~ story ]]
    [[ "$output" =~ bug ]]
    [[ "$output" =~ enhancement ]]
}

@test "config-reader: config_read_array trims whitespace from elements" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[test]
items=one, two , three  , four
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_array test items"
    [ "$status" -eq 0 ]
    # Verify all items are present without extra whitespace
    [[ "$output" =~ ^one ]]
    [[ "$output" =~ two ]]
    [[ "$output" =~ three ]]
    [[ "$output" =~ four$ ]]
}

@test "config-reader: config_read_array fails when key missing" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_array workflows missing_key"
    [ "$status" -ne 0 ]
}

@test "config-reader: config_validate_required succeeds when keys exist" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_validate_required organization name github_org email_domain"
    [ "$status" -eq 0 ]
}

@test "config-reader: config_validate_required fails when key missing" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_validate_required organization name missing_key"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "Required configuration missing" ]]
}

@test "config-reader: config_validate_required reports all missing keys" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_validate_required organization missing1 missing2 missing3 2>&1"
    [ "$status" -ne 0 ]
    [[ "$output" =~ missing1 ]]
    [[ "$output" =~ missing2 ]]
    [[ "$output" =~ missing3 ]]
}

@test "config-reader: environment variables are expanded in values" {
    create_test_config
    run bash -c "export GH_ORG=myorg && source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value nuget feed_url"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "https://nuget.pkg.github.com/myorg/index.json" ]]
}

@test "config-reader: config_list_section returns all keys in section" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_list_section organization"
    [ "$status" -eq 0 ]
    [[ "$output" =~ name ]]
    [[ "$output" =~ github_org ]]
    [[ "$output" =~ email_domain ]]
}

@test "config-reader: config_dump outputs all key=value pairs in section" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_dump organization"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "name=Test Organization" ]]
    [[ "$output" =~ "github_org=test-org" ]]
    [[ "$output" =~ "email_domain=test.example.com" ]]
}

@test "config-reader: config_get_status_workflow fails when status_workflow missing" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[workflows]
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_get_status_workflow"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "not configured" ]]
}

@test "config-reader: config_get_status_workflow succeeds and returns workflow" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_get_status_workflow"
    [ "$status" -eq 0 ]
    [[ "$output" =~ TBD ]]
    [[ "$output" =~ Ready ]]
    [[ "$output" =~ Done ]]
}

@test "config-reader: handles comments correctly" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[test]
# This is a comment
key1=value1
# Another comment
key2=value2
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value test key1"
    [ "$status" -eq 0 ]
    [ "$output" = "value1" ]
}

@test "config-reader: handles empty values" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[test]
empty_key=
nonempty_key=value
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value test empty_key default"
    [ "$status" -eq 0 ]
    [ "$output" = "default" ]
}

@test "config-reader: handles values with spaces" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[test]
key=value with spaces in it
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value test key"
    [ "$status" -eq 0 ]
    [ "$output" = "value with spaces in it" ]
}

# ============================================================================
# Expansion behavior locks: ${GH_ORG}/${GH_USER} template expansion
# semantics are stable whether the values come from env or the provider
# accessors.
# ============================================================================

@test "config-reader: GH_USER template is expanded in values" {
    create_test_config
    run bash -c "export GH_USER=test-user && source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value organization email_domain"
    [ "$status" -eq 0 ]
}

@test "config-reader: only GH_ORG/GH_USER expand; other vars stay literal" {
    cat > "$TEST_CONFIG_FILE" <<'EOT'
[template]
value=prefix-${GH_USER_DOES_NOT_EXIST}-suffix
EOT
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value template value"
    [ "$status" -eq 0 ]
    [ "$output" = 'prefix-${GH_USER_DOES_NOT_EXIST}-suffix' ]
}

@test "config-reader: unset GH_ORG/GH_USER expand to empty string" {
    cat > "$TEST_CONFIG_FILE" <<'EOT'
[template]
value=prefix-${GH_ORG}-mid-${GH_USER}-suffix
EOT
    run bash -c "unset GH_ORG GH_USER && source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value template value"
    [ "$status" -eq 0 ]
    [ "$output" = "prefix--mid--suffix" ]
}

@test "config-reader: expansion is single-pass (file template replaced once with env value)" {
    cat > "$TEST_CONFIG_FILE" <<'EOT'
[template]
nested=${GH_USER}
EOT
    # A value that itself looks like a template must not recurse: the
    # substitution pass runs once over the raw file value, so the result
    # keeps its ${...} text literal.
    run bash -c "export GH_USER=TH_ORG_PLACEHOLDER && source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value template nested"
    [ "$status" -eq 0 ]
    [ "$output" = 'TH_ORG_PLACEHOLDER' ]
}

@test "config-reader: GH_TOKEN is never interpolated" {
    cat > "$TEST_CONFIG_FILE" <<'EOT'
[template]
value=token=${GH_TOKEN}
EOT
    run bash -c "export GH_TOKEN='ghp_secret' && source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value template value"
    [ "$status" -eq 0 ]
    [[ "$output" != *'ghp_secret'* ]]
}

@test "config-reader: GH_ORG template resolves via provider accessor when loaded" {
    # The accessor chain (env → config → seed) backs template expansion when
    # the provider layer is present; raw reads prevent re-entry.
    run bash -c "
        export DEVENV_TOOLS='$PROJECT_ROOT/tools'
        export DEVENV_ROOT='$TEST_TEMP_DIR'
        export DEVENV_ROOT_SET=1
        unset GH_ORG
        printf '[organization]\nname=t\ngithub_org=cfg-org\n' > '$TEST_TEMP_DIR/devenv.config'
        source '$PROJECT_ROOT/tools/lib/providers/provider-core.bash'
        source '$PROJECT_ROOT/tools/lib/config-reader.bash'
        cat > '$TEST_TEMP_DIR/tpl.config' <<'CT'
[t]
v=\${GH_ORG}-suffix
CT
        config_init '$TEST_TEMP_DIR/tpl.config'
        config_read_value t v
    "
    [ "$status" -eq 0 ]
    [ "$output" = "cfg-org-suffix" ]
}

@test "config-reader: template expansion does not recurse through the accessor" {
    # A config whose github_org itself contains the template: the accessor
    # reads it RAW, expansion happens once in config-reader, done.
    run bash -c "
        export DEVENV_TOOLS='$PROJECT_ROOT/tools'
        export DEVENV_ROOT='$TEST_TEMP_DIR'
        export DEVENV_ROOT_SET=1
        unset GH_ORG
        printf '[organization]\nname=t\ngithub_org=\${GH_ORG}\n' > '$TEST_TEMP_DIR/devenv.config'
        source '$PROJECT_ROOT/tools/lib/providers/provider-core.bash'
        source '$PROJECT_ROOT/tools/lib/config-reader.bash'
        cat > '$TEST_TEMP_DIR/tpl2.config' <<'CT'
[t]
v=\${GH_ORG}
CT
        config_init '$TEST_TEMP_DIR/tpl2.config'
        config_read_value t v
    "
    [ "$status" -eq 0 ]
    [ "$output" = '${GH_ORG}' ]
}
