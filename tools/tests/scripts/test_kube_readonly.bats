#!/usr/bin/env bats
# Behavior tests for the read-only kube tools (Plan-002 task 3.3 / AC-5).
#
# Complements the destructive-tool guard suite (test_kube_guards.bats) with
# the read-only families: kube-list-pods, kube-logs, kube-pod-console,
# kube-pod-exec, kube-forward-ports, kube-intercept. Locks argument handling
# and consumption of the shared selection path (first-match / list passthrough
# as implemented); network lifecycle (port-forward/telepresence) is out of
# scope per the plan's non-goals.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

setup() {
    test_helper_setup
    stub_kubectl_json
    # Namespace resolver fixture: kube scripts now resolve a namespace before
    # their main work; non-interactive default is 'default'.
    export STUB_KUBECTL_NAMESPACES="default web"
    export STUB_KUBECTL_DEFAULT_NS="default"
    export KUBE_NO_INTERACTIVE=1
    export DEVENV_TOOLS="$PROJECT_ROOT/tools"

    # Recording stubs for the non-kubectl CLIs the mapping tools invoke.
    BIN="$TEST_TEMP_DIR/bin"
    mkdir -p "$BIN"
    cat > "$BIN/jq" << 'EOF'
#!/usr/bin/env bash
echo "jq $*" >> "${CALL_LOG:?}"
exec /usr/bin/jq "$@"
EOF
    cat > "$BIN/kube-pod-select.sh" << 'EOF'
#!/usr/bin/env bash
echo "kube-pod-select.sh $*" >> "${CALL_LOG:?}"
# Deterministic selection: emit the filter's first stub-pod match.
while IFS= read -r pod; do
    case "$pod" in
        *"${1:-}"*) echo "$pod"; exit 0 ;;
    esac
done < <(printf '%s\n' "${STUB_KUBECTL_PODS:?}")
EOF
    cat > "$BIN/telepresence" << 'EOF'
#!/usr/bin/env bash
echo "telepresence $*" >> "${CALL_LOG:?}"
case "$1" in
    status) echo '{"user_daemon": {"status": "Connected"}}' ;;
    connect) exit 0 ;;
    quit) exit 0 ;;
    helm) exit 0 ;;
    replace) exit 0 ;;
    *) exit 0 ;;
esac
EOF
    chmod +x "$BIN/jq" "$BIN/kube-pod-select.sh" "$BIN/telepresence"
    export PATH="$BIN:$PATH"
    export CALL_LOG="$TEST_TEMP_DIR/calls.log"
    : > "$CALL_LOG"
}

@test "kube-list-pods: prints the pod list from the stub" {
    export STUB_KUBECTL_PODS=$'web-1\nweb-2\ndb-1'
    run bash "$PROJECT_ROOT/tools/scripts/kube-list-pods.sh"
    [ "$status" -eq 0 ]
    [[ "$output" == *"web-1"* ]]
    [[ "$output" == *"web-2"* ]]
    [[ "$output" == *"db-1"* ]]
}

@test "kube-list-pods: filter keeps only matching names" {
    export STUB_KUBECTL_PODS=$'web-1\nweb-2\ndb-1'
    run bash "$PROJECT_ROOT/tools/scripts/kube-list-pods.sh" web
    [ "$status" -eq 0 ]
    [[ "$output" == *"web-1"* ]]
    ! grep -q "^db-1$" <<< "$output"
}

@test "kube-logs: fetches logs for the first-match pod" {
    export STUB_KUBECTL_PODS=$'web-1\nweb-2'
    run bash "$PROJECT_ROOT/tools/scripts/kube-logs.sh" web
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetching logs for pod: web-1"* ]]
    stub_calls_contain "kubectl logs web-1"
}

@test "kube-logs: no match is refused before kubectl logs" {
    export STUB_KUBECTL_PODS=$'web-1'
    run bash "$PROJECT_ROOT/tools/scripts/kube-logs.sh" nomatch < /dev/null
    [ "$status" -ne 0 ]
    ! stub_calls_contain "kubectl logs web-1"
}

@test "kube-pod-exec: executes the command on the first-match pod" {
    export STUB_KUBECTL_PODS=$'web-1\nweb-2'
    run bash "$PROJECT_ROOT/tools/scripts/kube-pod-exec.sh" web -- ls -la
    [ "$status" -eq 0 ]
    [[ "$output" == *"Executing command for pod: web-1"* ]]
    stub_calls_contain "kubectl exec web-1"
}

@test "kube-pod-console: defaults to /bin/bash on the first-match pod" {
    export STUB_KUBECTL_PODS=$'web-1\nweb-2'
    run bash "$PROJECT_ROOT/tools/scripts/kube-pod-console.sh" web
    [ "$status" -eq 0 ]
    [[ "$output" == *"Executing command on console for pod: web-1"* ]]
    stub_calls_contain "kubectl exec -it web-1"
}

@test "kube-forward-ports: usage refusal with no mappings issues no forward" {
    run bash "$PROJECT_ROOT/tools/scripts/kube-forward-ports.sh" < /dev/null
    [ "$status" -eq 1 ]
    [[ "$output" == *"Usage:"* ]]
    ! stub_calls_contain "kubectl port-forward"
}

@test "kube-forward-ports: non-numeric port is refused before selection" {
    run bash "$PROJECT_ROOT/tools/scripts/kube-forward-ports.sh" "web=abc" < /dev/null
    [ "$status" -eq 1 ]
    [[ "$output" == *"Ports must be numeric"* ]]
    ! grep -q "kube-pod-select.sh" "$CALL_LOG"
}

@test "kube-intercept: invalid mapping format is refused before any telepresence call" {
    run bash "$PROJECT_ROOT/tools/scripts/kube-intercept.sh" "nonsense" < /dev/null
    [ "$status" -eq 1 ]
    [[ "$output" == *"Invalid mapping format"* ]]
    ! grep -q "^telepresence " "$CALL_LOG"
}
