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
org=test-org
email_domain=test.example.com

[container]
registry=docker.io

[nuget]
feed_url=https://nuget.pkg.github.com/${PROVIDER_ORG}/index.json

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
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_validate_required organization name org email_domain"
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

@test "config-reader: template variables are expanded in values" {
    create_test_config
    # Expansion is accessor-fed: load the provider core and scope identity
    # to a temp DEVENV_ROOT seed so the real workspace config cannot leak in.
    mkdir -p "$TEST_TEMP_DIR/ident-root/.setup"
    printf 'test-org\n' > "$TEST_TEMP_DIR/ident-root/.setup/provider_org.txt"
    run bash -c "export DEVENV_TOOLS='$PROJECT_ROOT/tools' DEVENV_ROOT='$TEST_TEMP_DIR/ident-root' DEVENV_ROOT_SET=1 && source '$PROJECT_ROOT/tools/lib/providers/provider-core.bash' && source '$PROJECT_ROOT/tools/lib/config-reader.bash' && config_init $TEST_CONFIG_FILE && config_read_value nuget feed_url"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "https://nuget.pkg.github.com/test-org/index.json" ]]
}

@test "config-reader: config_list_section returns all keys in section" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_list_section organization"
    [ "$status" -eq 0 ]
    [[ "$output" =~ name ]]
    [[ "$output" =~ org ]]
    [[ "$output" =~ email_domain ]]
}

@test "config-reader: config_dump outputs all key=value pairs in section" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_dump organization"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "name=Test Organization" ]]
    [[ "$output" =~ "org=test-org" ]]
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
# Expansion behavior locks: ${PROVIDER_ORG}/${PROVIDER_USER} template
# expansion resolves via the provider identity accessors (config -> seed);
# no env var participates.
# ============================================================================

@test "config-reader: GH_USER env has no effect on template expansion" {
    create_test_config
    printf '[organization]\nname=t\nuser=cfg-user\n' > "$TEST_CONFIG_FILE"
    run bash -c "export GH_USER=env-user && source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value organization user"
    [ "$status" -eq 0 ]
    [ "$output" = "cfg-user" ]
}

@test "config-reader: only PROVIDER_ORG/PROVIDER_USER expand; other vars stay literal" {
    cat > "$TEST_CONFIG_FILE" <<'EOT'
[template]
value=prefix-${PROVIDER_USER_DOES_NOT_EXIST}-suffix
EOT
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value template value"
    [ "$status" -eq 0 ]
    [ "$output" = 'prefix-${PROVIDER_USER_DOES_NOT_EXIST}-suffix' ]
}

@test "config-reader: without the provider layer, tokens stay literal" {
    cat > "$TEST_CONFIG_FILE" <<'EOT'
[template]
value=prefix-${PROVIDER_ORG}-mid-${PROVIDER_USER}-suffix
EOT
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value template value"
    [ "$status" -eq 0 ]
    [ "$output" = 'prefix-${PROVIDER_ORG}-mid-${PROVIDER_USER}-suffix' ]
}

@test "config-reader: unresolvable identity expands tokens to empty string" {
    cat > "$TEST_CONFIG_FILE" <<'EOT'
[template]
value=prefix-${PROVIDER_ORG}-mid-${PROVIDER_USER}-suffix
EOT
    local empty_root="$TEST_TEMP_DIR/empty-ident"
    mkdir -p "$empty_root"
    run bash -c "export DEVENV_TOOLS='$PROJECT_ROOT/tools' DEVENV_ROOT='$empty_root' DEVENV_ROOT_SET=1 && source '$PROJECT_ROOT/tools/lib/providers/provider-core.bash' && source '$PROJECT_ROOT/tools/lib/config-reader.bash' && config_init $TEST_CONFIG_FILE && config_read_value template value"
    [ "$status" -eq 0 ]
    [ "$output" = "prefix--mid--suffix" ]
}

@test "config-reader: expansion is single-pass (raw org value holding a token is not re-expanded)" {
    # The accessor reads the org value RAW. When that raw value is itself a
    # template token, the org resolves to the literal text and expansion
    # must not run a second pass over it.
    local tmpl_root="$TEST_TEMP_DIR/tmpl-ident"
    mkdir -p "$tmpl_root"
    printf '[organization]\nname=t\norg=${PROVIDER_USER}\n' > "$tmpl_root/devenv.config"
    cat > "$TEST_CONFIG_FILE" <<'EOT'
[template]
nested=${PROVIDER_ORG}
EOT
    run bash -c "export DEVENV_TOOLS='$PROJECT_ROOT/tools' DEVENV_ROOT='$tmpl_root' DEVENV_ROOT_SET=1 && source '$PROJECT_ROOT/tools/lib/providers/provider-core.bash' && source '$PROJECT_ROOT/tools/lib/config-reader.bash' && config_init $TEST_CONFIG_FILE && config_read_value template nested"
    [ "$status" -eq 0 ]
    [ "$output" = '${PROVIDER_USER}' ]
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

@test "config-reader: PROVIDER_ORG template resolves via provider accessor when loaded" {
    # The accessor chain (config → seed) backs template expansion when the
    # provider layer is present; raw reads prevent re-entry.
    run bash -c "
        export DEVENV_TOOLS='$PROJECT_ROOT/tools'
        export DEVENV_ROOT='$TEST_TEMP_DIR'
        export DEVENV_ROOT_SET=1
        printf '[organization]\nname=t\norg=cfg-org\n' > '$TEST_TEMP_DIR/devenv.config'
        source '$PROJECT_ROOT/tools/lib/providers/provider-core.bash'
        source '$PROJECT_ROOT/tools/lib/config-reader.bash'
        cat > '$TEST_TEMP_DIR/tpl.config' <<'CT'
[t]
v=\${PROVIDER_ORG}-suffix
CT
        config_init '$TEST_TEMP_DIR/tpl.config'
        config_read_value t v
    "
    [ "$status" -eq 0 ]
    [ "$output" = "cfg-org-suffix" ]
}

@test "config-reader: template expansion does not recurse through the accessor" {
    # A config whose org itself contains the template: the accessor
    # reads it RAW, expansion happens once in config-reader, done.
    run bash -c "
        export DEVENV_TOOLS='$PROJECT_ROOT/tools'
        export DEVENV_ROOT='$TEST_TEMP_DIR'
        export DEVENV_ROOT_SET=1
        printf '[organization]\nname=t\norg=\${PROVIDER_ORG}\n' > '$TEST_TEMP_DIR/devenv.config'
        source '$PROJECT_ROOT/tools/lib/providers/provider-core.bash'
        source '$PROJECT_ROOT/tools/lib/config-reader.bash'
        cat > '$TEST_TEMP_DIR/tpl2.config' <<'CT'
[t]
v=\${PROVIDER_ORG}
CT
        config_init '$TEST_TEMP_DIR/tpl2.config'
        config_read_value t v
    "
    [ "$status" -eq 0 ]
    [ "$output" = '${PROVIDER_ORG}' ]
}

@test "raw read: [provider-x] section never satisfies a [provider] read" {
    local cfg="$TEST_TEMP_DIR/anchor.config"
    cat > "$cfg" <<'EOTXT'
[provider-tokens]
name=malicious

[provider]
name=github
EOTXT
    # shellcheck disable=SC1091
    source "$PROJECT_ROOT/tools/lib/config-reader.bash"
    config_init "$cfg"
    run config_read_value_raw provider name
    [ "$status" -eq 0 ]
    [ "$output" = "github" ]
}

# ============================================================================
# Section and key names are matched literally, never as regular expressions
# ============================================================================

read_cfg() {
    # read_cfg 'function args' — runs a config-reader function against TEST_CONFIG_FILE
    run bash -c "source '$PROJECT_ROOT/tools/lib/config-reader.bash'; config_init '$TEST_CONFIG_FILE'; $1"
}

@test "a key containing a dot matches only that key, not any single-character lookalike" {
    printf '[s]\nkey.name=right\nkeyXname=wrong\n' > "$TEST_CONFIG_FILE"
    read_cfg "config_read_value s key.name"
    [ "$status" -eq 0 ]
    [ "$output" = "right" ]
}

@test "a key containing brackets is read as written" {
    printf '[s]\na1=wrong\na[1]=right\n' > "$TEST_CONFIG_FILE"
    read_cfg "config_read_value s 'a[1]'"
    [ "$output" = "right" ]
}

@test "a section name containing a dot does not also match its lookalikes" {
    printf '[a.b]\nk=right\n[aXb]\nk=wrong\n' > "$TEST_CONFIG_FILE"
    read_cfg "config_read_value a.b k"
    [ "$output" = "right" ]
}

@test "listing and dumping a dotted section ignores its lookalike sections" {
    printf '[a.b]\nmine=1\n[aXb]\ntheirs=2\n' > "$TEST_CONFIG_FILE"
    read_cfg "config_list_section a.b"
    [ "$output" = "mine" ]
    read_cfg "config_dump a.b"
    [ "$output" = "mine=1" ]
}

@test "the raw reader returns the value (not the whole line) for a key with regex characters" {
    printf '[s]\na+b=value\n' > "$TEST_CONFIG_FILE"
    read_cfg "config_read_value_raw s 'a+b'"
    [ "$output" = "value" ]
}

@test "text after a section header's closing bracket is still tolerated" {
    printf '[s] # a note\nk=v\n' > "$TEST_CONFIG_FILE"
    read_cfg "config_read_value s k"
    [ "$output" = "v" ]
}

@test "a key that is present but empty reads as the default (documented semantics)" {
    printf '[s]\nk=\n' > "$TEST_CONFIG_FILE"
    read_cfg "config_read_value s k fallback"
    [ "$output" = "fallback" ]
    read_cfg "config_read_value s k"
    [ -z "$output" ]
}

@test "the header documents how an empty value reads" {
    run grep -n -i "empty" "$PROJECT_ROOT/tools/lib/config-reader.bash"
    [ "$status" -eq 0 ]
    [[ "$output" == *"present but empty"* || "$output" == *"present-but-empty"* ]]
}

# ============================================================================
# One reader: every path agrees on the same file
# ============================================================================
# The same text, in shapes people actually write, read through every reader in the
# tooling. They used to disagree (header and key matching, trimming, CR handling),
# so `name = azure` read as empty on one path and `azure` on another.

PROVIDER_VARIANTS=(
    $'[provider]\nname=azure\n'
    $'[provider]\nname = azure\n'
    $'  [provider]  \n  name  =  azure  \n'
    $'[provider]\r\nname=azure\r\n'
    $'# a comment\n; another\n\n[provider]\n# note\nname=azure\n'
    $'[other]\nname=wrong\n[provider]\nname=azure\n'
    $'[provider-extra]\nname=wrong\n[provider]\nname=azure\n'
    $'[provider]\nname=github\nname=azure\n'
)

write_variant() { printf '%s' "$1" > "$TEST_CONFIG_FILE"; }

@test "config_get_raw reads the value from every variant, without a prior config_init" {
    local v
    for v in "${PROVIDER_VARIANTS[@]}"; do
        write_variant "$v"
        run bash -c "source '$PROJECT_ROOT/tools/lib/config-reader.bash'; config_get_raw '$TEST_CONFIG_FILE' provider name"
        [ "$status" -eq 0 ]
        [ "$output" = "azure" ] || { echo "variant: $(printf '%q' "$v") -> [$output]"; return 1; }
    done
}

@test "config_get (the expanding reader) agrees on every variant" {
    local v
    for v in "${PROVIDER_VARIANTS[@]}"; do
        write_variant "$v"
        run bash -c "source '$PROJECT_ROOT/tools/lib/config-reader.bash'; config_get '$TEST_CONFIG_FILE' provider name 2>/dev/null"
        [ "$output" = "azure" ] || { echo "variant: $(printf '%q' "$v") -> [$output]"; return 1; }
    done
}

@test "config_read_value and config_read_value_raw agree on every variant" {
    local v
    for v in "${PROVIDER_VARIANTS[@]}"; do
        write_variant "$v"
        run bash -c "source '$PROJECT_ROOT/tools/lib/config-reader.bash'; config_init '$TEST_CONFIG_FILE'; echo \"\$(config_read_value provider name 2>/dev/null)|\$(config_read_value_raw provider name)\""
        [ "$output" = "azure|azure" ] || { echo "variant: $(printf '%q' "$v") -> [$output]"; return 1; }
    done
}

@test "provider_detect agrees on every variant" {
    local v
    for v in "${PROVIDER_VARIANTS[@]}"; do
        write_variant "$v"
        run bash -c "
            export DEVENV_TOOLS='$PROJECT_ROOT/tools'
            source '$PROJECT_ROOT/tools/lib/error-handling.bash'
            source '$PROJECT_ROOT/tools/lib/providers/provider-core.bash'
            provider_detect '$TEST_CONFIG_FILE'
            echo \"\$PROVIDER_NAME\"
        "
        [ "$output" = "azure" ] || { echo "variant: $(printf '%q' "$v") -> [$output]"; return 1; }
    done
}

@test "the provider identity accessor agrees on every variant" {
    local v
    for v in "${PROVIDER_VARIANTS[@]}"; do
        write_variant "$v"
        run bash -c "
            export DEVENV_TOOLS='$PROJECT_ROOT/tools' PROVIDER_IDENTITY_CONFIG='$TEST_CONFIG_FILE'
            source '$PROJECT_ROOT/tools/lib/error-handling.bash'
            source '$PROJECT_ROOT/tools/lib/providers/provider-core.bash'
            _provider_identity_raw_read provider name
        "
        [ "$output" = "azure" ] || { echo "variant: $(printf '%q' "$v") -> [$output]"; return 1; }
    done
}

@test "policy_resolve agrees on every variant" {
    local v
    for v in "${PROVIDER_VARIANTS[@]}"; do
        write_variant "$v"
        run bash -c "
            source '$PROJECT_ROOT/tools/lib/policy/policy-core.bash'
            policy_core_init '$TEST_CONFIG_FILE'
            policy_resolve NONE provider name fallback 2>/dev/null
        "
        [ "$output" = "azure" ] || { echo "variant: $(printf '%q' "$v") -> [$output]"; return 1; }
    done
}

@test "a value that contains = keeps everything after the first =" {
    printf '[x]\nurl = https://h/p?a=b&c=d\n' > "$TEST_CONFIG_FILE"
    run bash -c "source '$PROJECT_ROOT/tools/lib/config-reader.bash'; config_get_raw '$TEST_CONFIG_FILE' x url"
    [ "$output" = "https://h/p?a=b&c=d" ]
}

@test "an absent key reads as the default, and an absent file is a failure with no output" {
    printf '[x]\nk=v\n' > "$TEST_CONFIG_FILE"
    run bash -c "source '$PROJECT_ROOT/tools/lib/config-reader.bash'; config_get_raw '$TEST_CONFIG_FILE' x missing fallback"
    [ "$output" = "fallback" ]
    run bash -c "source '$PROJECT_ROOT/tools/lib/config-reader.bash'; config_get_raw '$TEST_TEMP_DIR/none.config' x k fallback"
    [ "$status" -ne 0 ]
    [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# Reading another file never re-points the global
# ---------------------------------------------------------------------------

@test "provider_detect on another file leaves the initialised CONFIG_FILE alone" {
    printf '[a]\nk=from-a\n' > "$TEST_TEMP_DIR/a.config"
    printf '[provider]\nname=github\n' > "$TEST_TEMP_DIR/b.config"
    run bash -c "
        export DEVENV_TOOLS='$PROJECT_ROOT/tools'
        source '$PROJECT_ROOT/tools/lib/error-handling.bash'
        source '$PROJECT_ROOT/tools/lib/providers/provider-core.bash'
        config_init '$TEST_TEMP_DIR/a.config'
        provider_detect '$TEST_TEMP_DIR/b.config'
        echo \"\$CONFIG_FILE\"
        config_read_value a k
    "
    [ "${lines[0]}" = "$TEST_TEMP_DIR/a.config" ]
    [ "${lines[1]}" = "from-a" ]
}

@test "policy values keep reading the policy file after another file is initialised" {
    printf '[provider]\nname=azure\n' > "$TEST_TEMP_DIR/policy.config"
    printf '[provider]\nname=other\n' > "$TEST_TEMP_DIR/elsewhere.config"
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/policy/policy-core.bash'
        policy_core_init '$TEST_TEMP_DIR/policy.config'
        source '$PROJECT_ROOT/tools/lib/config-reader.bash'
        config_init '$TEST_TEMP_DIR/elsewhere.config'
        policy_resolve NONE provider name fallback
    "
    [ "$output" = "azure" ]
}

@test "policy_core_init with no argument and no DEVENV_ROOT uses the checkout's own devenv.config" {
    run env -u DEVENV_ROOT bash -c "
        source '$PROJECT_ROOT/tools/lib/policy/policy-core.bash'
        policy_core_init
        echo \"\$POLICY_CONFIG_FILE\"
    "
    [ "$output" = "$(cd "$PROJECT_ROOT" && pwd)/devenv.config" ]
}

@test "loading provider-core with DEVENV_ROOT unset does not point the policy layer at /devenv.config" {
    run env -u DEVENV_ROOT DEVENV_TOOLS="$PROJECT_ROOT/tools" bash -c "
        source '$PROJECT_ROOT/tools/lib/error-handling.bash'
        source '$PROJECT_ROOT/tools/lib/providers/provider-core.bash'
        echo \"\$POLICY_CONFIG_FILE\"
    "
    [ "$output" != "/devenv.config" ]
    [[ "$output" == */devenv.config ]]
}
