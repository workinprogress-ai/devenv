#!/usr/bin/env bats
# The Azure smoke harness can record live responses as committed fixtures. These
# tests cover the redaction and capture helpers in smoke-capture.bash: a recorded
# response must never carry a credential, a real identity, or a real GUID, and it
# must stay valid JSON so the fixture-driven provider tests can parse it.

bats_require_minimum_version 1.5.0

load ../test_helper

LIB="$BATS_TEST_DIRNAME/../../lib/providers/azure/smoke-capture.bash"

setup() {
    test_helper_setup
    export TMPDIR="$TEST_TEMP_DIR/tmpdir"; mkdir -p "$TMPDIR"
    export AZURE_PAT="s3cr3t-pat-value-1234567890"
    export AZURE_DEVOPS_ORG="Real-Org"
    export AZURE_SMOKE_TEST_PROJECT="Real-Project"
    unset AZURE_SMOKE_CAPTURE_DIR SMOKE_REDACT_MAP
    # shellcheck disable=SC1090
    source "$LIB"
}

teardown() {
    test_helper_teardown
}

GUID_A="3f2a9c1e-7b44-4d0a-9a51-0c8e5d2b7f10"
GUID_B="a1b2c3d4-0000-4abc-8def-1234567890ab"

@test "redact: a GUID is replaced by a stable placeholder of GUID shape" {
    out="$(printf '{"id":"%s"}' "$GUID_A" | smoke_redact)"
    [[ "$out" != *"$GUID_A"* ]]
    [[ "$out" =~ [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} ]]
}

@test "redact: the same GUID maps to the same placeholder across calls, different GUIDs differ" {
    smoke_redact_map_init >/dev/null
    first="$(printf '%s' "$GUID_A" | smoke_redact)"
    again="$(printf 'x %s y' "$GUID_A" | smoke_redact)"
    other="$(printf '%s' "$GUID_B" | smoke_redact)"
    [[ "$again" == "x $first y" ]]
    [ "$first" != "$other" ]
}

@test "redact: GUID matching is case-insensitive and maps upper and lower case to one placeholder" {
    smoke_redact_map_init >/dev/null
    lower="$(printf '%s' "$GUID_A" | smoke_redact)"
    upper="$(printf '%s' "${GUID_A^^}" | smoke_redact)"
    [ "$lower" = "$upper" ]
}

@test "redact: org and project names are replaced everywhere, including the visualstudio.com host" {
    out="$(printf 'https://dev.azure.com/%s/%s/_git/r https://%s.visualstudio.com/%s/_apis' \
        "$AZURE_DEVOPS_ORG" "$AZURE_SMOKE_TEST_PROJECT" "${AZURE_DEVOPS_ORG,,}" "${AZURE_SMOKE_TEST_PROJECT,,}" | smoke_redact)"
    [[ "${out,,}" != *"real-org"* ]]
    [[ "${out,,}" != *"real-project"* ]]
    [[ "$out" == *"example-org"* ]]
    [[ "$out" == *"Example-Project"* ]]
}

@test "redact: email addresses are replaced" {
    out="$(printf 'by jane.doe@contoso.com and bob@example.org' | smoke_redact)"
    [[ "$out" != *"jane.doe"* ]]
    [[ "$out" != *"contoso"* ]]
    [[ "$out" == *"user@example.test"* ]]
}

@test "redact: the PAT and its Basic-auth base64 form are replaced" {
    b64="$(printf ':%s' "$AZURE_PAT" | base64 -w0)"
    out="$(printf 'tok=%s hdr=Basic %s' "$AZURE_PAT" "$b64" | smoke_redact)"
    [[ "$out" != *"$AZURE_PAT"* ]]
    [[ "$out" != *"$b64"* ]]
}

@test "redact: identity fields in JSON are scrubbed at any depth" {
    json='{"createdBy":{"displayName":"Jane Doe","uniqueName":"jane@contoso.com","descriptor":"aad.ABCDEF","imageUrl":"https://x/avatar/1","directoryAlias":"jane"},"reviewers":[{"displayName":"Bob","principalName":"[Real-Project]\\Team","mailAddress":"bob@contoso.com"}]}'
    out="$(printf '%s' "$json" | smoke_redact)"
    [[ "$out" != *"Jane"* ]]
    [[ "$out" != *"Bob"* ]]
    [[ "$out" != *"contoso"* ]]
    [[ "$out" != *"ABCDEF"* ]]
    [[ "$out" != *"avatar/1"* ]]
    printf '%s' "$out" | jq -e '.createdBy.displayName and (.reviewers | length == 1)' >/dev/null
}

@test "redact: identity tokens embedded in URLs (aad., msa., vssgp. descriptors) are replaced" {
    out="$(printf 'https://x/_apis/GraphProfile/MemberAvatars/aad.NWRlOWU4NjctMDcwZi03ZGMw and msa.abcdef123456 and vssgp.Uy0xLTktMTU1MTM3' | smoke_redact)"
    [[ "$out" != *"NWRlOWU4"* ]]
    [[ "$out" != *"abcdef123456"* ]]
    [[ "$out" != *"Uy0xLTktMTU1"* ]]
    [[ "$out" == *"aad.EXAMPLE"* ]]
}

@test "redact: valid JSON stays valid JSON and non-identity values are untouched" {
    out="$(printf '{"status":"active","count":3,"name":"x"}' | smoke_redact)"
    printf '%s' "$out" | jq -e '.status == "active" and .count == 3 and .name == "x"' >/dev/null
}

@test "redact: non-JSON text is still redacted by substitution" {
    out="$(printf 'plain text for %s with %s' "$AZURE_DEVOPS_ORG" "$GUID_A" | smoke_redact)"
    [[ "$out" != *"$AZURE_DEVOPS_ORG"* ]]
    [[ "$out" != *"$GUID_A"* ]]
}

@test "redact: the redaction map is created outside any capture directory and holds real GUIDs only there" {
    export AZURE_SMOKE_CAPTURE_DIR="$TEST_TEMP_DIR/captures"
    mkdir -p "$AZURE_SMOKE_CAPTURE_DIR"
    smoke_redact_map_init >/dev/null
    path="$SMOKE_REDACT_MAP"
    [ -f "$path" ]
    [[ "$path" != "$AZURE_SMOKE_CAPTURE_DIR"* ]]
    printf '%s' "$GUID_A" | smoke_redact >/dev/null
    grep -qi "$GUID_A" "$path"
}

@test "capture: with no capture directory set nothing is written" {
    printf '{"a":1}' | smoke_capture "pr.list"
    # no capture file and no redaction map was created
    [ -z "$(find "$TMPDIR" -type f)" ]
}

@test "capture: JSON is written redacted and pretty-printed as NAME.json" {
    export AZURE_SMOKE_CAPTURE_DIR="$TEST_TEMP_DIR/captures"
    printf '{"id":"%s","org":"%s"}' "$GUID_A" "$AZURE_DEVOPS_ORG" | smoke_capture "pr.list"
    f="$AZURE_SMOKE_CAPTURE_DIR/pr.list.json"
    [ -f "$f" ]
    jq -e . "$f" >/dev/null
    run ! grep -qi -e "$GUID_A" -e "$AZURE_DEVOPS_ORG" "$f"
    [ "$(wc -l < "$f")" -gt 1 ]
}

@test "capture: non-JSON output is written as NAME.txt" {
    export AZURE_SMOKE_CAPTURE_DIR="$TEST_TEMP_DIR/captures"
    printf '<html>sign in %s</html>' "$AZURE_DEVOPS_ORG" | smoke_capture "auth.html"
    [ -f "$AZURE_SMOKE_CAPTURE_DIR/auth.html.txt" ]
    ! grep -qi "$AZURE_DEVOPS_ORG" "$AZURE_SMOKE_CAPTURE_DIR/auth.html.txt"
}

@test "capture: a name with path separators or odd characters cannot escape the capture directory" {
    export AZURE_SMOKE_CAPTURE_DIR="$TEST_TEMP_DIR/captures"
    printf '{"a":1}' | smoke_capture "../../evil/name with spaces"
    [ ! -e "$TEST_TEMP_DIR/evil" ]
    [ "$(find "$AZURE_SMOKE_CAPTURE_DIR" -type f | wc -l)" -eq 1 ]
    case "$(find "$AZURE_SMOKE_CAPTURE_DIR" -type f)" in "$AZURE_SMOKE_CAPTURE_DIR"/*) ;; *) false ;; esac
}

@test "capture: no map file or real value is ever written into the capture directory" {
    export AZURE_SMOKE_CAPTURE_DIR="$TEST_TEMP_DIR/captures"
    printf '{"id":"%s"}' "$GUID_A" | smoke_capture "a"
    printf '{"id":"%s"}' "$GUID_B" | smoke_capture "b"
    [ "$(find "$AZURE_SMOKE_CAPTURE_DIR" -type f | wc -l)" -eq 2 ]
    ! grep -rqiE "$GUID_A|$GUID_B" "$AZURE_SMOKE_CAPTURE_DIR"
}

@test "jq_ok: true filter returns 0, false filter returns 1, invalid JSON returns 1" {
    smoke_jq_ok '{"status":"completed"}' '.status == "completed"'
    run smoke_jq_ok '{"status":"active"}' '.status == "completed"'
    [ "$status" -eq 1 ]
    run smoke_jq_ok 'not json' '.status == "completed"'
    [ "$status" -eq 1 ]
}
