#!/usr/bin/env bats
# azure releases: publishedAt against the REAL response shapes. The Git Refs API
# returns {name, objectId, creator:{displayName,...}} — `creator` is an identity with
# no date. The date lives on the annotated-tag object (taggedBy.date) or, for a
# lightweight tag, on the commit the ref points at (committer.date).

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    export DEVENV_ROOT="$TEST_TEMP_DIR/devenv-root"; mkdir -p "$DEVENV_ROOT"
    export AZURE_PAT="test-pat" AZURE_DEVOPS_ORG=o1 AZURE_DEVOPS_PROJECT=p1
    export AZURE_API_VERSION=7.1 AZURE_HTTP_MAX_RETRIES=1
    export CURL_LOG="$TEST_TEMP_DIR/curl.log"; : > "$CURL_LOG"
    mkdir -p "$TEST_TEMP_DIR/bin"
    # URL-dispatching curl stand-in: status line to -D, body to stdout.
    cat > "$TEST_TEMP_DIR/bin/curl" <<'STUB'
#!/usr/bin/env bash
hdr=""; url=""
while [ $# -gt 0 ]; do
    case "$1" in
        -D) hdr="$2"; shift 2 ;;
        -X|-H|--max-time|-d) shift 2 ;;
        -*) shift ;;
        *) url="$1"; shift ;;
    esac
done
echo "$url" >> "$CURL_LOG"
code=200; body='{}'
case "$url" in
    *"/refs?"*) body="$REFS_JSON" ;;
    *"/annotatedtags/AAA"*) body='{"objectId":"AAA","name":"v1.0.0","taggedBy":{"name":"t","date":"2026-09-01T10:00:00Z"}}' ;;
    *"/annotatedtags/"*) code=404; body='{"message":"not an annotated tag"}' ;;
    *"/commits/BBB"*) body='{"commitId":"BBB","committer":{"name":"c","date":"2026-09-02T11:30:00Z"}}' ;;
esac
printf 'HTTP/1.1 %s X\r\n\r\n' "$code" > "$hdr"
printf '%s' "$body"
STUB
    chmod +x "$TEST_TEMP_DIR/bin/curl"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
}

teardown() {
    test_helper_teardown
}

releases() {   # releases [flags] — runs provider_org_releases_list against the fakes
    bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load auth repos releases
        provider_org_releases_list o1/p1/r1 $*
    "
}

# Real ref shape: identity-only creator, no date anywhere on the ref itself.
refs_annotated='{"value":[{"name":"refs/tags/v1.0.0","objectId":"AAA","creator":{"displayName":"Tagger","id":"u1"}}]}'
refs_lightweight='{"value":[{"name":"refs/tags/v2.0.0-beta.1","objectId":"BBB","creator":{"displayName":"Tagger","id":"u1"}}]}'

@test "publishedAt for an annotated tag comes from the tag object's taggedBy.date" {
    export REFS_JSON="$refs_annotated"
    run releases
    [ "$status" -eq 0 ]
    [ "$(jq -r '.[0].publishedAt' <<<"$output")" = "2026-09-01T10:00:00Z" ]
}

@test "publishedAt for a lightweight tag falls back to the commit's committer date" {
    export REFS_JSON="$refs_lightweight"
    run releases
    [ "$status" -eq 0 ]
    [ "$(jq -r '.[0].publishedAt' <<<"$output")" = "2026-09-02T11:30:00Z" ]
    [ "$(jq -r '.[0].isPrerelease' <<<"$output")" = "true" ]
}

@test "publishedAt is empty (field unavailable), not an error, when neither lookup yields a date" {
    export REFS_JSON='{"value":[{"name":"refs/tags/v3.0.0","objectId":"ZZZ","creator":{"displayName":"T"}}]}'
    run releases
    [ "$status" -eq 0 ]
    [ "$(jq -r '.[0].publishedAt' <<<"$output")" = "" ]
    [ "$(jq -r '.[0].tagName' <<<"$output")" = "v3.0.0" ]
}

@test "a mixed list resolves each tag by its own kind" {
    export REFS_JSON='{"value":[{"name":"refs/tags/v1.0.0","objectId":"AAA","creator":{"displayName":"T"}},{"name":"refs/tags/v2.0.0-beta.1","objectId":"BBB","creator":{"displayName":"T"}}]}'
    run releases
    [ "$(jq -r '[.[].publishedAt] | join(",")' <<<"$output")" = "2026-09-02T11:30:00Z,2026-09-01T10:00:00Z" ]
}

@test "no per-tag date lookups are made when publishedAt is not requested" {
    export REFS_JSON="$refs_annotated"
    run releases --json tagName,name
    [ "$status" -eq 0 ]
    run grep -c 'annotatedtags\|/commits/' "$CURL_LOG"
    [ "$output" = "0" ]
}

@test "--json still projects exactly the requested fields" {
    export REFS_JSON="$refs_annotated"
    run releases --json tagName,publishedAt
    [ "$(jq -c '.[0] | keys' <<<"$output")" = '["publishedAt","tagName"]' ]
}

# ---------------------------------------------------------------------------
# Order and prerelease detection
# ---------------------------------------------------------------------------

tag_refs() {   # tag_refs name... -> a refs response with those tags
    local n out=""
    for n in "$@"; do out="${out:+$out,}{\"name\":\"refs/tags/$n\",\"objectId\":\"X$n\"}"; done
    printf '{"value":[%s]}' "$out"
}

@test "releases come newest first by version, not alphabetically, and a release is above its own prereleases" {
    REFS_JSON="$(tag_refs v1.9.0 v1.10.0 v1.10.0-rc.1 v0.5.0 v2.0.0)" run releases --json tagName
    [ "$status" -eq 0 ]
    [ "$(jq -r '[.[].tagName] | join(",")' <<<"$output")" = "v2.0.0,v1.10.0,v1.10.0-rc.1,v1.9.0,v0.5.0" ]
}

@test "--limit keeps the newest tags, not the alphabetically first" {
    REFS_JSON="$(tag_refs v1.0.0 v1.1.0 v1.2.0 v1.3.0)" run releases --limit 2 --json tagName
    [ "$status" -eq 0 ]
    [ "$(jq -r '[.[].tagName] | join(",")' <<<"$output")" = "v1.3.0,v1.2.0" ]
}

@test "only a semver prerelease suffix marks a prerelease; other hyphenated tags are not" {
    REFS_JSON="$(tag_refs v1.0.0-rc.1 release-2026-09 v1.0.0)" run releases --json tagName,isPrerelease
    [ "$status" -eq 0 ]
    [ "$(jq -c 'map({(.tagName): .isPrerelease}) | add' <<<"$output")" = '{"v1.0.0":false,"v1.0.0-rc.1":true,"release-2026-09":false}' ]
}
