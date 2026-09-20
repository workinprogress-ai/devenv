#!/usr/bin/env bats
# Unit tests for resolve_namespace in kube-selection.bash.
# All cluster/fzf interaction is mocked.

bats_require_minimum_version 1.5.0

load ../test_helper

# Minimal mocks: kubectl + fzf driven by env switches.
setup() {
    test_helper_setup
    export DEVENV_TOOLS="$PROJECT_ROOT/tools"

    mkdir -p "$TEST_TEMP_DIR/bin"

    cat > "$TEST_TEMP_DIR/bin/kubectl" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
    "get namespaces")
        if [ -n "${MOCK_KUBECTL_FAIL:-}" ]; then
            echo "mock: cluster unreachable" >&2
            exit 1
        fi
        # list_namespaces pipes through `jq -r '.items[].metadata.name'`,
        # so the mock must emit real JSON.
        printf '%s' "$MOCK_NAMESPACES" | jq -R -s -c \
            'split("\n") | map(select(length > 0)) | {items: [.[] | {metadata: {name: .}}]}'
        exit 0
        ;;
    "get namespace")
        # namespace_exists <ns>: exit 0 only when the ns is in the list.
        ns="$3"
        printf '%s\n' "$MOCK_NAMESPACES" | grep -qx "$ns" && exit 0
        exit 1
        ;;
    "config view")
        echo "${MOCK_DEFAULT_NS:-}"
        exit 0
        ;;
    *)
        exit 0
        ;;
esac
EOF

    cat > "$TEST_TEMP_DIR/bin/fzf" <<'EOF'
#!/usr/bin/env bash
# Mock fzf: echoes the first input line by default; MOCK_FZF_PICK=none simulates cancel.
if [ "${MOCK_FZF_PICK:-}" = "none" ]; then
    exit 130
fi
head -1
exit 0
EOF

    chmod +x "$TEST_TEMP_DIR/bin/kubectl" "$TEST_TEMP_DIR/bin/fzf"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"

    export MOCK_NAMESPACES=$'default\nkube-system\ndevelopment\ndevelopment-eu\nproduction'
    export KUBE_NO_INTERACTIVE=1
    unset NAMESPACE || true
    unset MOCK_KUBECTL_FAIL MOCK_FZF_PICK
}

source_namespace_lib() {
    source "$PROJECT_ROOT/tools/lib/kube-selection.bash"
}

@test "exact namespace name resolves verbatim" {
    source_namespace_lib
    exec < /dev/null
    run --separate-stderr resolve_namespace "production"
    [ "$status" -eq 0 ]
    [ "$output" = "production" ]
}

@test "exact namespace beats NAMESPACE env var when both given" {
    source_namespace_lib
    NAMESPACE=production run resolve_namespace "default"
    [ "$status" -eq 0 ]
    [ "$output" = "default" ]
}

@test "NAMESPACE env var used when no arg given" {
    source_namespace_lib
    NAMESPACE=production run resolve_namespace
    [ "$status" -eq 0 ]
    [ "$output" = "production" ]
}

@test "partial match auto-selects when unique (case-insensitive)" {
    source_namespace_lib
    exec < /dev/null
    run --separate-stderr resolve_namespace "prod"
    [ "$status" -eq 0 ]
    [ "$output" = "production" ]
}

@test "partial match is case-insensitive ('PROD' resolves to production)" {
    source_namespace_lib
    exec < /dev/null
    run --separate-stderr resolve_namespace "PROD"
    [ "$status" -eq 0 ]
    [ "$output" = "production" ]
}

@test "ambiguous partial match errors and lists candidates when non-TTY" {
    source_namespace_lib
    exec < /dev/null
    run --separate-stderr resolve_namespace "develop"   # matches development AND development-eu; exact-matches neither
    [ "$status" -eq 1 ]
    [[ "$stderr" == *"development"* ]]
    [[ "$stderr" == *"development-eu"* ]]
}

@test "no match errors and lists available namespaces" {
    source_namespace_lib
    exec < /dev/null
    run --separate-stderr resolve_namespace "staging"
    [ "$status" -eq 1 ]
    [[ "$stderr" == *"staging"* ]]
    [[ "$stderr" == *"kube-system"* ]]
}

@test "non-TTY without namespace falls back to current-context default with hint" {
    source_namespace_lib
    MOCK_DEFAULT_NS=production run --separate-stderr resolve_namespace
    [ "$status" -eq 0 ]
    [ "$output" = "production" ]
}

@test "non-TTY fallback defaults to 'default' when context has none" {
    source_namespace_lib
    MOCK_DEFAULT_NS= run --separate-stderr resolve_namespace
    [ "$status" -eq 0 ]
    [ "$output" = "default" ]
}

@test "unreachable cluster (empty namespace list) is a hard error" {
    source_namespace_lib
    MOCK_KUBECTL_FAIL=1 run --separate-stderr resolve_namespace "prod"
    [ "$status" -eq 1 ]
    [[ "$stderr" == *"No namespaces returned"* ]]
}
