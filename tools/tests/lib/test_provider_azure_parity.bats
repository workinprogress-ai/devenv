#!/usr/bin/env bats
# Provider parity, derived from the contract.
#
# tools/lib/providers/CONTRACT.md lists every verb in its `contract:verbs` block. This test
# reads that list and checks both providers against it:
#   - every listed verb is defined by each provider after provider_load (a verb marked
#     github-only or azure-only is checked on that provider alone);
#   - neither provider defines a domain verb the contract does not list, so a verb
#     cannot ship undocumented;
#   - every listed verb has a row in the contract's tables;
#   - a verb that parses options rejects one it does not know, instead of dropping it.
# Nothing here is a hand-kept ledger: add a verb to the contract and it is covered.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

CONTRACT="${BATS_TEST_DIRNAME}/../../lib/providers/CONTRACT.md"
DOMAIN_VERB_RE='^provider_(repos|issues|issue|prs|pipelines|projects|org)_'

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    export DEVENV_ROOT="$TEST_TEMP_DIR/devenv-root"
    mkdir -p "$DEVENV_ROOT"
    printf '[provider]\nname=azure\nazure_org=org\nazure_project=proj\n' > "$DEVENV_ROOT/devenv.config"
    export AZURE_PAT="test-pat"
    unset _PROVIDER_CORE_LOADED || true
    unset PROVIDER_NAME || true
}

teardown() {
    unset DEVENV_ROOT
    test_helper_teardown
}

# contract_verbs [all|github|azure]: the verbs the contract lists for a provider
contract_verbs() {
    local which="${1:-all}"
    awk '/<!-- contract:verbs -->/{f=1;next} /<!-- \/contract:verbs -->/{f=0} f' "$CONTRACT" \
        | grep -E '^provider_' \
        | while read -r verb rest; do
            case "$which" in
                all) echo "$verb" ;;
                github) [[ "$rest" == *"azure-only"* ]] || echo "$verb" ;;
                azure) [[ "$rest" == *"github-only"* ]] || echo "$verb" ;;
            esac
        done
}

# provider_defined <provider>: every provider_* function the provider's modules define
provider_defined() {
    local prov="$1" modules="http urls auth repos issues prs pipelines projects org policies releases"
    stub_gh
    stub_curl
    export PATH="$STUB_BIN_DIR:$PATH"
    bash -c "
        source '$DEVENV_TOOLS/lib/error-handling.bash'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=$prov
        provider_load $modules 2>/dev/null
        declare -F | awk '{print \$3}' | grep -E '^provider_' | sort
    "
}

@test "the contract lists verbs, and the block is parsed" {
    [ "$(contract_verbs all | wc -l)" -ge 60 ]
}

@test "every contract verb is defined by the github provider" {
    local defined missing=""
    defined="$(provider_defined github)"
    while read -r verb; do
        grep -qx "$verb" <<< "$defined" || missing="$missing $verb"
    done < <(contract_verbs github)
    [ -z "$missing" ] || { echo "github is missing:$missing"; false; }
}

@test "every contract verb is defined by the azure provider" {
    local defined missing=""
    defined="$(provider_defined azure)"
    while read -r verb; do
        grep -qx "$verb" <<< "$defined" || missing="$missing $verb"
    done < <(contract_verbs azure)
    [ -z "$missing" ] || { echo "azure is missing:$missing"; false; }
}

@test "neither provider defines a domain verb the contract does not list" {
    local prov extra=""
    for prov in github azure; do
        while read -r verb; do
            contract_verbs all | grep -qx "$verb" || extra="$extra $prov:$verb"
        done < <(provider_defined "$prov" | grep -E "$DOMAIN_VERB_RE")
    done
    [ -z "$extra" ] || { echo "undocumented verbs:$extra"; false; }
}

@test "every contract verb has a row in the contract's tables" {
    local missing=""
    while read -r verb; do
        grep -q "^| \`$verb\`" "$CONTRACT" || missing="$missing $verb"
    done < <(contract_verbs all | grep -vE '^provider_(api|api_paginate|issues_add_tag)$')
    [ -z "$missing" ] || { echo "no table row for:$missing"; false; }
}

@test "the github-only and azure-only marks name verbs that really exist on one side only" {
    local gh az
    gh="$(provider_defined github)"; az="$(provider_defined azure)"
    while read -r verb rest; do
        case "$rest" in
            *github-only*) grep -qx "$verb" <<< "$gh"; ! grep -qx "$verb" <<< "$az" ;;
            *azure-only*) grep -qx "$verb" <<< "$az"; ! grep -qx "$verb" <<< "$gh" ;;
        esac
    done < <(awk '/<!-- contract:verbs -->/{f=1;next} /<!-- \/contract:verbs -->/{f=0} f' "$CONTRACT" | grep -E '^provider_.*(github|azure)-only')
}

# ---------------------------------------------------------------------------
# An option a verb does not know is an error
# ---------------------------------------------------------------------------

# verb|first positional (the repo slot; "-" for a verb with no positional)|remaining
# positionals that make the call otherwise valid
OPTION_TAKING_VERBS='
provider_repos_view|p/r|
provider_repos_list|org/proj|
provider_repos_create|name|
provider_repos_edit|p/r|
provider_repos_patch|p/r|
provider_repos_collaborator_put|p/r user|
provider_issues_list|p/r|
provider_issues_view|p/r|1
provider_issues_create|p/r|
provider_issues_edit|p/r|1
provider_issues_close|p/r|1
provider_issues_reopen|p/r|1
provider_issues_comment|p/r|1
provider_issues_comment_add|p/r|1
provider_issues_comment_get|p/r|1/2
provider_issues_comment_edit|p/r|1/2
provider_issues_label_list|p/r|
provider_issues_label_create|p/r|name
provider_issues_milestones|p/r|
provider_prs_list|p/r|
provider_prs_view|p/r|1
provider_prs_diff|p/r|1
provider_prs_create|p/r|
provider_prs_merge|p/r|1
provider_prs_comment|p/r|1
provider_prs_thread_create|p/r|1
provider_pipelines_run_list|p/r|
provider_pipelines_run_view|p/r|1
provider_pipelines_run_watch|p/r|1
provider_pipelines_workflow_list|p/r|
provider_pipelines_workflow_run|p/r|wf
provider_pipelines_run_rerun|p/r|1
provider_pipelines_run_download|p/r|1
provider_projects_list|p/r|
provider_projects_field_list|p/r|1
provider_projects_item_add|p/r|1 https://x/i/1
provider_org_releases_list|p/r|
provider_org_feeds_list|-|
'

# bogus_probe <provider> <verb> <fixed args...>: call the verb with an unknown option
bogus_probe() {
    local prov="$1" verb="$2"; shift 2
    stub_gh; stub_curl
    export PATH="$STUB_BIN_DIR:$PATH"
    run bash -c "
        source '$DEVENV_TOOLS/lib/error-handling.bash'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=$prov
        provider_load http urls auth repos issues prs pipelines projects org policies releases 2>/dev/null
        '$verb' \"\$@\" --no-such-option-xyz
    " _ "$@"
}

@test "azure: every option-taking verb rejects an unknown option by name" {
    local failures="" verb repo rest
    while IFS='|' read -r verb repo rest; do
        [ -n "$verb" ] || continue
        # args: the repo slot ("" when empty), then the remaining positionals
        local -a argv=()
        if [ "$repo" = "-" ]; then :   # a verb that takes no positional
        elif [ -n "$repo" ]; then argv+=("$repo"); else argv+=(""); fi
        # shellcheck disable=SC2206
        [ -n "$rest" ] && argv+=($rest)
        bogus_probe azure "$verb" "${argv[@]}"
        if [ "$status" -eq 0 ] || [[ "$output" != *"no-such-option-xyz"* ]]; then
            failures="$failures $verb"
        fi
    done <<< "$OPTION_TAKING_VERBS"
    [ -z "$failures" ] || { echo "azure verbs that did not reject an unknown option:$failures"; false; }
}

@test "github: the verbs that parse their own options reject an unknown option by name" {
    local verb
    for verb in provider_issues_comment_add provider_issues_comment_edit provider_prs_thread_create; do
        case "$verb" in
            provider_issues_comment_edit) bogus_probe github "$verb" p/r 1 --body x ;;
            provider_issues_comment_add) bogus_probe github "$verb" p/r 1 --body x ;;
            provider_prs_thread_create) bogus_probe github "$verb" p/r 1 --body x ;;
        esac
        [ "$status" -ne 0 ] || { echo "$verb accepted an unknown option"; false; }
        [[ "$output" == *"no-such-option-xyz"* ]] || { echo "$verb: $output"; false; }
    done
}

@test "an unknown option makes no request" {
    stub_curl
    export PATH="$STUB_BIN_DIR:$PATH"
    : > "$STUB_CALL_LOG"
    run bash -c "
        source '$DEVENV_TOOLS/lib/error-handling.bash'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load http urls auth repos issues 2>/dev/null
        provider_issues_create '' --title t --no-such-option-xyz
    "
    [ "$status" -ne 0 ]
    [ "$(grep -c '^curl ' "$STUB_CALL_LOG" 2>/dev/null || true)" -eq 0 ]
}

# ---------------------------------------------------------------------------
# A value-taking option with no value is an error, never a hang
# ---------------------------------------------------------------------------

# verb | first positional | option that takes a value
VALUE_OPTION_VERBS='
provider_issues_list|p/r|--state
provider_issues_edit|p/r 1|--title
provider_prs_list|p/r|--state
provider_prs_create|p/r|--title
provider_pipelines_run_list|p/r|--status
provider_repos_view|p/r|--json
'

@test "a trailing value-taking option is rejected by name on both providers, within seconds" {
    local failures="" verb pos opt prov
    for prov in azure github; do
        while IFS='|' read -r verb pos opt; do
            [ -n "$verb" ] || continue
            # GitHub forwards most verbs' options to gh, which reports a missing value itself;
            # only the verbs that parse their own options are checked there.
            if [ "$prov" = github ]; then
                case "$verb" in provider_issues_list|provider_repos_view) ;; *) continue ;; esac
            fi
            stub_gh; stub_curl
            export PATH="$STUB_BIN_DIR:$PATH"
            # shellcheck disable=SC2086
            run timeout 20 bash -c "
                source '$DEVENV_TOOLS/lib/error-handling.bash'
                source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
                PROVIDER_NAME=$prov
                provider_load http urls auth repos issues prs pipelines projects org policies releases 2>/dev/null
                $verb $pos $opt
            "
            if [ "$status" -eq 0 ] || [ "$status" -eq 124 ] || [[ "$output" != *"$opt"* ]]; then
                failures="$failures $prov:$verb($opt,rc=$status)"
            fi
        done <<< "$VALUE_OPTION_VERBS"
    done
    [ -z "$failures" ] || { echo "no named error for a missing value:$failures"; false; }
}

@test "every option arm that takes a value goes through provider_need_value" {
    local bad
    bad="$(grep -rn 'shift 2 ;;' "$BATS_TEST_DIRNAME/../../lib/providers" --include=*.bash | grep -v provider_need_value | grep -vE ':[0-9]+:\s+(have_body=true; )?shift 2 ;;$' || true)"
    [ -z "$bad" ] || { echo "$bad"; false; }
}

@test "azure filters reject values they cannot honor instead of returning everything" {
    local failures="" case_ verb args needle
    while IFS='|' read -r verb args needle; do
        [ -n "$verb" ] || continue
        stub_gh; stub_curl
        export PATH="$STUB_BIN_DIR:$PATH"
        # shellcheck disable=SC2086
        run timeout 20 bash -c "
            source '$DEVENV_TOOLS/lib/error-handling.bash'
            source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
            PROVIDER_NAME=azure
            provider_load http urls auth repos issues prs pipelines projects org policies releases 2>/dev/null
            $verb $args
        "
        if [ "$status" -eq 0 ] || [[ "$output" != *"$needle"* ]]; then
            failures="$failures $verb($args,rc=$status)"
        fi
    done <<'CASES'
provider_issues_list|p/r --state bogus|--state
provider_issues_list|p/r --limit abc|--limit
provider_prs_list|p/r --limit abc|--limit
provider_prs_list|p/r --limit 0|--limit
provider_pipelines_run_list|p/r --status banana|--status
provider_pipelines_run_list|p/r --limit x|--limit
CASES
    [ -z "$failures" ] || { echo "filters accepted an unusable value:$failures"; false; }
}

@test "the contract defines the --status words, and the Azure provider accepts every one of them" {
    local word
    for word in queued in_progress completed success failure cancelled; do
        grep -q "\`$word\`" "$CONTRACT"
        stub_gh; stub_curl
        export PATH="$STUB_BIN_DIR:$PATH"
        printf '{"value":[]}' > "$TEST_TEMP_DIR/empty-builds.json"
        STUB_CURL_RESPONSE="$TEST_TEMP_DIR/empty-builds.json" run timeout 20 bash -c "
            source '$DEVENV_TOOLS/lib/error-handling.bash'
            source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
            PROVIDER_NAME=azure
            provider_load http urls auth repos issues prs pipelines projects org policies releases 2>/dev/null
            provider_pipelines_run_list --status $word
        "
        [ "$status" -eq 0 ] || { echo "azure rejected the contract word '$word': $output"; false; }
    done
}
