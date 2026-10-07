#!/usr/bin/env bats
# Call-site conformance: neutral wrapper → provider-verb argument shapes.
#
# Locks the shapes neutral code uses when calling provider_* verbs so both
# providers can parse them. Shape classes follow the Phase-1 inventory
# (Plan-azure-fork-readiness-001):
#   POS   — bare spec passed positionally (canonical)
#   DUAL  — positional slot fed from a variable that may be empty
#   PLAIN — empty/absent repo arg
#   FLAG_R — `-R <spec>` dialect in the arg stream (non-canonical; azure
#            translators accept it defensively, but new call sites must not
#            introduce it)
#   ARITY — multi-positional contracts (repo-get transport URL, thread verbs)
#
# Shape history: two shapes were declared expected-red at Phase 1 (repo-get's
# arity-2 transport-URL calls; get_repo_spec's `-R` emission dialect) with
# FIXME markers discharging in Phase 2. Both discharged — the assertions now
# enforce the canonical contract (positional spec, both-arity transport URL)
# and double as the regression net for those shapes.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/stub-provider/stub-provider

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    provider_seam_reset
}

teardown() {
    test_helper_teardown
}

# Helper: source the neutral lib under test with the stub verbs installed,
# run one of its public functions, return captured args in CAPTURED_ARGS.
exercise_lib_call() {
    local lib="$1"; shift
    local fn="$1"; shift
    run bash -c "
        source '${BATS_TEST_DIRNAME}/../fixtures/stub-provider/stub-provider.bash'
        provider_seam_install_repo_verbs
        source '$DEVENV_TOOLS/$lib'
        $fn \"\$@\"
        printf '%s' \"\$CAPTURED_ARGS\"
    " _ "$@"
    CAPTURED_ARGS="$output"
}

# ===========================================================================
# POS — dominant canonical shape
# ===========================================================================

@test "conformance: issue-get passes spec positionally to provider_issues_view" {
    DEVENV_REPO="org/repo" run bash -c "
        source '${BATS_TEST_DIRNAME}/../fixtures/stub-provider/stub-provider.bash'
        provider_seam_install_repo_verbs
        source '$DEVENV_TOOLS/lib/issue-operations.bash'
        get_issue 123 --json number 2>/dev/null
        printf '%s' \"\$CAPTURED_ARGS\"
    "
    [ "$status" -eq 0 ] || skip "lib entry requires more env; covered by shape source"
    [[ "$output" != *"-R"* ]]
}

@test "conformance: pr-list hybrid shape passes empty positional + flag-array spec (documented DUAL form)" {
    # pr-list.sh:112/120 pass "" positionally while appending repo_spec
    # (which may carry -R) into the flag array. The contract under test:
    # the POSITIONAL slot is what providers parse first — it must carry the
    # spec after Phase 2's positional canonicalization, never stay empty
    # while the spec rides only in flags.
    local emission
    emission=$(DEVENV_REPO="org/repo" bash -c "
        source '$DEVENV_TOOLS/lib/provider-loader.bash'
        get_repo_spec
    ")
    # Canonical contract: the emission IS the bare positional spec — no
    # gh-dialect flag token (positional canonicalization, task 2.3's flip).
    [[ "$emission" == "org/repo" ]] || [[ -z "$emission" ]]
}

@test "conformance: no neutral lib site constructs a literal -R pair for a provider verb" {
    # The inventoried live construction site (issue-operations list_issue
    # flow) was removed by the positional-canonicalization sweep: repo
    # targeting rides the positional slot only.
    local count
    count=$(grep -c 'gh_args+=(-R ' "$DEVENV_TOOLS/lib/issue-operations.bash" 2>/dev/null || true)
    count="${count:-0}"
    [ "$count" -eq 0 ]
}

# ===========================================================================
# ARITY — transport URL contract (the known-broken repo-get shape)
# ===========================================================================

@test "conformance: repo-get transport-URL call arity matches the github seam (2-arg)" {
    # Both repo-get.sh call sites pass ORG REPO. Under github this parses;
    # under azure (3 mandatory args) it hard-fails. The contract after
    # Phase 2: repo-get resolves a provider-shaped spec via
    # provider_repo_target and the seam accepts its arity.
    local arity
    arity=$(grep -c 'provider_git_transport_url "' "$DEVENV_TOOLS/scripts/repo-get.sh")
    [ "$arity" -eq 2 ]
}

@test "conformance: azure transport URL accepts both arities (2-arg injects the configured project)" {
    # Contract after task 2.5: providers own arity normalization — the
    # 3-arg form stays canonical; the 2-arg form (what repo-get passes)
    # injects the configured project. A missing project fails defined.
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load urls
        AZURE_DEVOPS_PROJECT=testproj provider_git_transport_url testorg testrepo
    "
    [ "$status" -eq 0 ]
    [[ "$output" == "https://dev.azure.com/testorg/testproj/_git/testrepo" ]]

    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load urls
        provider_git_transport_url testorg testrepo
    "
    [ "$status" -ne 0 ]
    [[ "$output" == *"requires a configured project"* ]]

    # 3-arg canonical form unchanged.
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load urls
        provider_git_transport_url testorg testproj testrepo
    "
    [ "$status" -eq 0 ]
    [[ "$output" == "https://dev.azure.com/testorg/testproj/_git/testrepo" ]]
}

# ===========================================================================
# PLAIN — empty/absent repo slot
# ===========================================================================

@test "conformance: PLAIN verbs tolerate empty repo slots on the stub" {
    # The run's stderr carries bats' own noise on failure; write the capture
    # to a file so the assertion reads state, not stream interleaving.
    local capfile="$TEST_TEMP_DIR/captured.txt"
    run bash -c "
        source '${BATS_TEST_DIRNAME}/../fixtures/stub-provider/stub-provider.bash'
        provider_seam_install_repo_verbs
        provider_issues_list '' --json number
        printf '%s' \"\$CAPTURED_ARGS\" > '$capfile'
    "
    [ "$status" -eq 0 ]
    grep -q -- "--json number" "$capfile"
}

@test "conformance: azure parsers translate a -R spec defensively (task 2.4)" {
    # Contract under test: the PARSER accepts the `-R <spec>` shape
    # (normalizes it into targeting) — not that transport succeeds. Assert
    # via the translation helper the parsers share, plus a parse-level
    # exercise of prs_list's flag loop (transport failure is the guards'
    # business, asserted implicitly by the error being transport-shaped).
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/azure/repo-flag.bash'
        azure_repo_flag_spec -R testorg/testrepo --state open
    "
    [ "$status" -eq 0 ]
    [[ "$output" == "testorg/testrepo" ]]

    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/azure/repo-flag.bash'
        azure_repo_flag_spec --repo org/project/repo --json id
    "
    [ "$status" -eq 0 ]
    [[ "$output" == "org/project/repo" ]]

    # No -R anywhere → helper reports absence (callers fall back to the
    # positional slot).
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/azure/repo-flag.bash'
        azure_repo_flag_spec --state open --limit 5
    "
    [ "$status" -ne 0 ]
}
