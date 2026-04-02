#!/usr/bin/env bats
# Tests for cs-dependency-graph.bash library
# Uses filesystem fixtures to simulate cached repos with .csproj files

load ../test_helper

# ============================================================================
# Fixture Setup
# ============================================================================

# Build a realistic multi-repo test fixture in $TEST_TEMP_DIR/cache/repo_cache
# Simulates:
#   lib-core         → produces: Org.Lib.Core, Org.Lib.Core.Common
#   lib-middleware    → produces: Org.Lib.Middleware (depends on Org.Lib.Core)
#   lib-utils        → produces: Org.Lib.Utils (depends on Org.Lib.Core.Common)
#   service-alpha    → produces: Org.Services.Alpha (depends on Org.Lib.Middleware, Org.Lib.Utils)
#   service-beta     → produces: Org.Services.Beta (depends on Org.Lib.Middleware)
#   app-web          → produces: Org.App.Web (depends on Org.Services.Alpha)
#
# Dependency graph (forward):
#   lib-core ← lib-middleware ← service-alpha ← app-web
#                              ↗
#   lib-core ← lib-utils ←──┘
#   lib-core ← lib-middleware ← service-beta
#
create_test_fixture() {
    local cache_dir="$TEST_TEMP_DIR/cache/repo_cache"

    # lib-core: two packages, no org dependencies
    _make_csproj "$cache_dir/lib-core/src/Org.Lib.Core/Org.Lib.Core.csproj" ""
    _make_csproj "$cache_dir/lib-core/src/Org.Lib.Core.Common/Org.Lib.Core.Common.csproj" ""
    # test project (should be ignored)
    _make_csproj "$cache_dir/lib-core/test/Tests.csproj" \
        '<PackageReference Include="Org.Lib.Core" Version="1.0.0" />'

    # lib-middleware: depends on Org.Lib.Core
    _make_csproj "$cache_dir/lib-middleware/src/Org.Lib.Middleware/Org.Lib.Middleware.csproj" \
        '<PackageReference Include="Org.Lib.Core" Version="1.0.0" />'

    # lib-utils: depends on Org.Lib.Core.Common
    _make_csproj "$cache_dir/lib-utils/src/Org.Lib.Utils/Org.Lib.Utils.csproj" \
        '<PackageReference Include="Org.Lib.Core.Common" Version="1.0.0" />
    <PackageReference Include="Newtonsoft.Json" Version="13.0.0" />'

    # service-alpha: depends on Org.Lib.Middleware and Org.Lib.Utils
    _make_csproj "$cache_dir/service-alpha/src/Org.Services.Alpha/Org.Services.Alpha.csproj" \
        '<PackageReference Include="Org.Lib.Middleware" Version="1.0.0" />
    <PackageReference Include="Org.Lib.Utils" Version="1.0.0" />'

    # service-beta: depends on Org.Lib.Middleware
    _make_csproj "$cache_dir/service-beta/src/Org.Services.Beta/Org.Services.Beta.csproj" \
        '<PackageReference Include="Org.Lib.Middleware" Version="1.0.0" />'

    # app-web: depends on Org.Services.Alpha
    _make_csproj "$cache_dir/app-web/src/Org.App.Web/Org.App.Web.csproj" \
        '<PackageReference Include="Org.Services.Alpha" Version="1.0.0" />'

    # Write cache timestamp
    printf '%s\n%s\n' "2026-03-29T00:00:00Z" "abc123" > "$cache_dir/.cache_timestamp"
}

# Helper: create a minimal .csproj file
_make_csproj() {
    local path="$1"
    local refs="${2:-}"
    mkdir -p "$(dirname "$path")"
    cat > "$path" <<CSPROJ
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <GeneratePackageOnBuild>true</GeneratePackageOnBuild>
  </PropertyGroup>
  <ItemGroup>
    ${refs}
  </ItemGroup>
</Project>
CSPROJ
}

setup() {
    test_helper_setup
    export DEVENV_TOOLS="$PROJECT_ROOT/tools"
    export REPO_CACHE_DIR="$TEST_TEMP_DIR/cache/repo_cache"
    export CS_DEP_ORG_PREFIX="Org."
    export CS_DEP_INDEX_DIR="$REPO_CACHE_DIR/.index"
}

teardown() {
    test_helper_teardown
}

# ============================================================================
# Library Loading Tests
# ============================================================================

@test "cs-dep-graph: library can be sourced" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash' && echo 'loaded'
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"loaded"* ]]
}

@test "cs-dep-graph: prevents multiple sourcing" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        _CS_DEPENDENCY_GRAPH_LOADED=1
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        echo 'success'
    "
    [ "$status" -eq 0 ]
}

@test "cs-dep-graph: has valid bash syntax" {
    run bash -n "$DEVENV_TOOLS/lib/cs-dependency-graph.bash"
    [ "$status" -eq 0 ]
}

# ============================================================================
# is_index_stale Tests
# ============================================================================

@test "cs-dep-graph: is_index_stale returns 0 when no cache timestamp" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        is_index_stale
    "
    [ "$status" -eq 0 ]
}

@test "cs-dep-graph: is_index_stale returns 0 when no index timestamp" {
    mkdir -p "$REPO_CACHE_DIR"
    echo "2026-03-29" > "$REPO_CACHE_DIR/.cache_timestamp"

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        is_index_stale
    "
    [ "$status" -eq 0 ]
}

@test "cs-dep-graph: is_index_stale returns 1 when timestamps match" {
    mkdir -p "$REPO_CACHE_DIR" "$CS_DEP_INDEX_DIR"
    printf '2026-03-29T00:00:00Z\nabc123\n' > "$REPO_CACHE_DIR/.cache_timestamp"
    printf '2026-03-29T00:00:00Z\nabc123\n' > "$CS_DEP_INDEX_DIR/.index_timestamp"

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        is_index_stale
    "
    [ "$status" -eq 1 ]
}

@test "cs-dep-graph: is_index_stale returns 0 when timestamps differ" {
    mkdir -p "$REPO_CACHE_DIR" "$CS_DEP_INDEX_DIR"
    printf '2026-03-29T01:00:00Z\ndef456\n' > "$REPO_CACHE_DIR/.cache_timestamp"
    printf '2026-03-29T00:00:00Z\nabc123\n' > "$CS_DEP_INDEX_DIR/.index_timestamp"

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        is_index_stale
    "
    [ "$status" -eq 0 ]
}

# ============================================================================
# build_dependency_index Tests
# ============================================================================

@test "cs-dep-graph: build_dependency_index fails when cache dir missing" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$TEST_TEMP_DIR/nonexistent'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$TEST_TEMP_DIR/nonexistent/.index'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        build_dependency_index 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"does not exist"* ]]
}

@test "cs-dep-graph: build_dependency_index creates index files" {
    create_test_fixture

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        build_dependency_index 2>/dev/null
    "
    [ "$status" -eq 0 ]
    [ -f "$CS_DEP_INDEX_DIR/package_to_repo.tsv" ]
    [ -f "$CS_DEP_INDEX_DIR/repo_packages.tsv" ]
    [ -f "$CS_DEP_INDEX_DIR/repo_dependencies.tsv" ]
}

@test "cs-dep-graph: build_dependency_index maps packages to repos" {
    create_test_fixture

    bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        build_dependency_index
    " 2>/dev/null

    run cat "$CS_DEP_INDEX_DIR/package_to_repo.tsv"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Org.Lib.Core"*"lib-core"* ]]
    [[ "$output" == *"Org.Lib.Core.Common"*"lib-core"* ]]
    [[ "$output" == *"Org.Lib.Middleware"*"lib-middleware"* ]]
    [[ "$output" == *"Org.Lib.Utils"*"lib-utils"* ]]
    [[ "$output" == *"Org.Services.Alpha"*"service-alpha"* ]]
    [[ "$output" == *"Org.Services.Beta"*"service-beta"* ]]
    [[ "$output" == *"Org.App.Web"*"app-web"* ]]
}

@test "cs-dep-graph: build_dependency_index records dependency edges" {
    create_test_fixture

    bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        build_dependency_index
    " 2>/dev/null

    run cat "$CS_DEP_INDEX_DIR/repo_dependencies.tsv"
    [ "$status" -eq 0 ]
    # lib-middleware depends on Org.Lib.Core
    [[ "$output" == *"lib-middleware"*"Org.Lib.Core"* ]]
    # lib-utils depends on Org.Lib.Core.Common
    [[ "$output" == *"lib-utils"*"Org.Lib.Core.Common"* ]]
    # service-alpha depends on Org.Lib.Middleware and Org.Lib.Utils
    [[ "$output" == *"service-alpha"*"Org.Lib.Middleware"* ]]
    [[ "$output" == *"service-alpha"*"Org.Lib.Utils"* ]]
}

@test "cs-dep-graph: build_dependency_index skips test/ directories" {
    create_test_fixture

    bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        build_dependency_index
    " 2>/dev/null

    # Tests.csproj from test/ should not appear in package index
    run grep "Tests" "$CS_DEP_INDEX_DIR/package_to_repo.tsv"
    [ "$status" -ne 0 ]
}

@test "cs-dep-graph: build_dependency_index keeps Testing packages from src/" {
    local cache_dir="$REPO_CACHE_DIR"
    mkdir -p "$cache_dir"

    _make_csproj "$cache_dir/lib-foo/src/Org.Lib.Foo/Org.Lib.Foo.csproj" ""
    _make_csproj "$cache_dir/lib-foo/src/Org.Lib.Foo.Testing/Org.Lib.Foo.Testing.csproj" \
        '<PackageReference Include="Org.Lib.Foo" Version="1.0.0" />'
    printf '%s\n%s\n' "2026-03-29T00:00:00Z" "abc123" > "$cache_dir/.cache_timestamp"

    bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        build_dependency_index
    " 2>/dev/null

    run grep "Org.Lib.Foo.Testing" "$CS_DEP_INDEX_DIR/package_to_repo.tsv"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Org.Lib.Foo.Testing"*"lib-foo"* ]]
}

@test "cs-dep-graph: build_dependency_index excludes third-party packages" {
    create_test_fixture

    bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        build_dependency_index
    " 2>/dev/null

    # Newtonsoft.Json is referenced by lib-utils but should not appear in deps
    run grep "Newtonsoft" "$CS_DEP_INDEX_DIR/repo_dependencies.tsv"
    [ "$status" -ne 0 ]
}

@test "cs-dep-graph: build_dependency_index excludes self-references" {
    create_test_fixture

    bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        build_dependency_index
    " 2>/dev/null

    # lib-core test/ refs to Org.Lib.Core are skipped (test/ excluded),
    # but even if they leaked, self-references should be excluded
    # Verify no self-referencing edge for any repo
    run bash -c "
        awk -F'\t' '{ print \$1, \$2 }' '$CS_DEP_INDEX_DIR/repo_dependencies.tsv' | while read repo pkg; do
            pkg_repo=\$(awk -F'\t' -v p=\"\$pkg\" '\$1 == p { print \$2 }' '$CS_DEP_INDEX_DIR/package_to_repo.tsv' | head -1)
            if [ \"\$repo\" = \"\$pkg_repo\" ]; then
                echo \"SELF_REF: \$repo -> \$pkg\"
            fi
        done
    "
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "cs-dep-graph: build_dependency_index writes index timestamp" {
    create_test_fixture

    bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        build_dependency_index
    " 2>/dev/null

    [ -f "$CS_DEP_INDEX_DIR/.index_timestamp" ]
    local cache_ts index_ts
    cache_ts=$(cat "$REPO_CACHE_DIR/.cache_timestamp")
    index_ts=$(cat "$CS_DEP_INDEX_DIR/.index_timestamp")
    [ "$cache_ts" = "$index_ts" ]
}

# ============================================================================
# ensure_dependency_index Tests
# ============================================================================

@test "cs-dep-graph: ensure_dependency_index builds when stale" {
    create_test_fixture

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        ensure_dependency_index 2>&1
    "
    [ "$status" -eq 0 ]
    [ -f "$CS_DEP_INDEX_DIR/package_to_repo.tsv" ]
}

@test "cs-dep-graph: ensure_dependency_index skips build when fresh" {
    create_test_fixture

    # Build index first
    bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        build_dependency_index
    " 2>/dev/null

    # Record mtime of index file
    local mtime_before
    mtime_before=$(stat -c %Y "$CS_DEP_INDEX_DIR/package_to_repo.tsv")
    sleep 1

    # ensure should not rebuild
    bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        ensure_dependency_index
    " 2>/dev/null

    local mtime_after
    mtime_after=$(stat -c %Y "$CS_DEP_INDEX_DIR/package_to_repo.tsv")
    [ "$mtime_before" -eq "$mtime_after" ]
}

# ============================================================================
# list_repo_packages Tests
# ============================================================================

@test "cs-dep-graph: list_repo_packages requires repo name" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        list_repo_packages 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"required"* ]]
}

@test "cs-dep-graph: list_repo_packages returns packages for a repo" {
    create_test_fixture

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        list_repo_packages 'lib-core' 2>/dev/null | sort
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"Org.Lib.Core"* ]]
    [[ "$output" == *"Org.Lib.Core.Common"* ]]
}

@test "cs-dep-graph: list_repo_packages returns nothing for unknown repo" {
    create_test_fixture

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        list_repo_packages 'no-such-repo' 2>/dev/null
    "
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

# ============================================================================
# list_repo_dependencies Tests
# ============================================================================

@test "cs-dep-graph: list_repo_dependencies requires repo name" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        list_repo_dependencies 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"required"* ]]
}

@test "cs-dep-graph: list_repo_dependencies returns consumed packages" {
    create_test_fixture

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        list_repo_dependencies 'service-alpha' 2>/dev/null | sort
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"Org.Lib.Middleware"* ]]
    [[ "$output" == *"Org.Lib.Utils"* ]]
}

@test "cs-dep-graph: list_repo_dependencies returns empty for root lib" {
    create_test_fixture

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        list_repo_dependencies 'lib-core' 2>/dev/null
    "
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

# ============================================================================
# get_reverse_dependency_tree Tests
# ============================================================================

@test "cs-dep-graph: get_reverse_dependency_tree requires repo argument" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        get_reverse_dependency_tree 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"required"* ]]
}

@test "cs-dep-graph: get_reverse_dependency_tree fails for unknown repo" {
    create_test_fixture

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        get_reverse_dependency_tree 'nonexistent-repo' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"not found"* ]]
}

@test "cs-dep-graph: get_reverse_dependency_tree finds direct dependents" {
    create_test_fixture

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        get_reverse_dependency_tree 'lib-core' 2>/dev/null
    "
    [ "$status" -eq 0 ]
    # Direct dependents at depth 0
    [[ "$output" == *"0"*"lib-middleware"*"Org.Lib.Core"* ]]
    [[ "$output" == *"0"*"lib-utils"*"Org.Lib.Core.Common"* ]]
}

@test "cs-dep-graph: get_reverse_dependency_tree includes transitive dependents" {
    create_test_fixture

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        get_reverse_dependency_tree 'lib-core' 2>/dev/null
    "
    [ "$status" -eq 0 ]
    # service-alpha depends on lib-middleware and lib-utils (depth 1)
    [[ "$output" == *"1"*"service-alpha"* ]]
    # service-beta depends on lib-middleware (depth 1)
    [[ "$output" == *"1"*"service-beta"* ]]
    # app-web depends on service-alpha (depth 2)
    [[ "$output" == *"2"*"app-web"* ]]
}

@test "cs-dep-graph: get_reverse_dependency_tree includes correct paths" {
    create_test_fixture

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        get_reverse_dependency_tree 'lib-core' 2>/dev/null
    "
    [ "$status" -eq 0 ]
    # Path for lib-middleware should be lib-core>lib-middleware
    [[ "$output" == *"lib-core>lib-middleware"* ]]
    # Path for service-alpha via middleware should include the chain
    [[ "$output" == *"lib-core>lib-middleware>service-alpha"* ]]
    # Path for app-web should include full chain through service-alpha
    [[ "$output" == *">service-alpha>app-web"* ]]
}

@test "cs-dep-graph: get_reverse_dependency_tree outputs valid TSV with 5 columns" {
    create_test_fixture

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        get_reverse_dependency_tree 'lib-core' 2>/dev/null | head -1
    "
    [ "$status" -eq 0 ]
    # Should have exactly 5 tab-separated columns (DEPTH, REPO, PACKAGE_REF, VERSION, PATH)
    local col_count
    col_count=$(echo "$output" | awk -F'\t' '{ print NF }')
    [ "$col_count" -eq 5 ]
}

@test "cs-dep-graph: get_reverse_dependency_tree returns empty for leaf repo" {
    create_test_fixture

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        get_reverse_dependency_tree 'app-web' 2>/dev/null
    "
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "cs-dep-graph: get_reverse_dependency_tree accepts directory path" {
    create_test_fixture
    # Create a fake repo directory to pass as path
    mkdir -p "$TEST_TEMP_DIR/somepath/lib-core"

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        get_reverse_dependency_tree '$TEST_TEMP_DIR/somepath/lib-core' 2>/dev/null
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"lib-middleware"* ]]
}

# ============================================================================
# Cycle Detection Tests
# ============================================================================

@test "cs-dep-graph: get_reverse_dependency_tree handles diamond dependencies" {
    create_test_fixture

    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        get_reverse_dependency_tree 'lib-core' 2>/dev/null
    "
    [ "$status" -eq 0 ]
    # service-alpha should appear via both paths (middleware and utils)
    local alpha_count
    alpha_count=$(echo "$output" | grep -c "service-alpha" || true)
    [ "$alpha_count" -ge 2 ]
}

@test "cs-dep-graph: get_reverse_dependency_tree does not loop on cycles" {
    local cache_dir="$REPO_CACHE_DIR"

    # Create a cycle: A -> B -> A
    _make_csproj "$cache_dir/cycle-a/src/Org.Cycle.A/Org.Cycle.A.csproj" \
        '<PackageReference Include="Org.Cycle.B" Version="1.0.0" />'
    _make_csproj "$cache_dir/cycle-b/src/Org.Cycle.B/Org.Cycle.B.csproj" \
        '<PackageReference Include="Org.Cycle.A" Version="1.0.0" />'
    printf '%s\n%s\n' "2026-03-29T00:00:00Z" "cycle123" > "$cache_dir/.cache_timestamp"

    # Should terminate without hanging
    run timeout 10 bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        export REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.'
        export CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        get_reverse_dependency_tree 'cycle-a' 2>/dev/null
    "
    [ "$status" -eq 0 ]
    # cycle-b should appear once (direct dependent)
    [[ "$output" == *"cycle-b"* ]]
    # But cycle-a should NOT reappear in the REPO column (cycle broken)
    local a_count
    a_count=$(echo "$output" | awk -F'\t' '$2 == "cycle-a"' | wc -l)
    [ "$a_count" -eq 0 ]
}
