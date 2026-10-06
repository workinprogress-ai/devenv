#!/usr/bin/env bats
# End-to-end behavior of the pod listing/selection chain with -n <ns> before
# the name filter. kubectl is a recording stub; no cluster is involved.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    mkdir -p "$TEST_TEMP_DIR/bin"
    export KUBECTL_LOG="$TEST_TEMP_DIR/kubectl.log"
    : > "$KUBECTL_LOG"
    cat > "$TEST_TEMP_DIR/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
echo "kubectl $*" >> "$KUBECTL_LOG"
case "$1 $2" in
    "get namespaces")
        printf '{"items":[{"metadata":{"name":"prod"}},{"metadata":{"name":"staging"}}]}' ;;
    "get namespace")
        [ "$3" = "prod" ] || [ "$3" = "staging" ] ;;
    "get pods")
        printf '{"items":[{"metadata":{"name":"myapp-1"}},{"metadata":{"name":"other-2"}},{"metadata":{"name":"myapp-3"}}]}' ;;
esac
STUB
    # fzf stand-in for the menu shown when several pods match: first line wins.
    printf '%s\n' '#!/usr/bin/env bash' 'head -n 1' > "$TEST_TEMP_DIR/bin/fzf"
    chmod +x "$TEST_TEMP_DIR/bin/kubectl" "$TEST_TEMP_DIR/bin/fzf"
    # The tools/ entry points are how sibling scripts find each other.
    export PATH="$TEST_TEMP_DIR/bin:$PROJECT_ROOT/tools:$PATH"
    export KUBE_NO_INTERACTIVE=1
    unset NAMESPACE || true
}

@test "kube-list-pods: -n <ns> before the filter filters by the name, not by the flag" {
    run --separate-stderr bash "$PROJECT_ROOT/tools/scripts/kube-list-pods.sh" -n prod myapp
    [ "$status" -eq 0 ]
    [ "$output" = $'myapp-1\nmyapp-3' ]
    grep -q "get pods -n prod" "$KUBECTL_LOG"
}

@test "kube-list-pods: the filter alone still works" {
    run --separate-stderr bash "$PROJECT_ROOT/tools/scripts/kube-list-pods.sh" other
    [ "$status" -eq 0 ]
    [ "$output" = "other-2" ]
}

@test "kube-pod-select: -n <ns> before the filter reaches the listing and selects the match" {
    run --separate-stderr bash "$PROJECT_ROOT/tools/scripts/kube-pod-select.sh" -n prod other
    [ "$status" -eq 0 ]
    [ "$output" = "other-2" ]
    grep -q "get pods -n prod" "$KUBECTL_LOG"
}

@test "kube-pod-select: finds its sibling by the entry-point name and filters correctly" {
    # With -n first the filter used to be read as "-n", and the sibling was
    # invoked as kube-list-pods.sh, a name no PATH entry provides.
    run --separate-stderr bash "$PROJECT_ROOT/tools/scripts/kube-pod-select.sh" -n staging myapp
    [ "$status" -eq 0 ]
    [ "$output" = "myapp-1" ]
    [[ "$stderr" != *"command not found"* ]]
    grep -q "get pods -n staging" "$KUBECTL_LOG"
}
