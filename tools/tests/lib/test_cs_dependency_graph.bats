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

# ============================================================================
# Package lookups are exact matches, not substring/regex matches
# ============================================================================

# Fixture: "producer" only makes the long-named Org.Lib.Core.Common; nothing
# makes Org.Lib.Core. "consumer" references both, plus Org.Unrelated, which is
# made by a repo whose *name* happens to contain "Org.Lib.Core".
create_prefix_sibling_fixture() {
    local cache_dir="$TEST_TEMP_DIR/cache/repo_cache"
    _make_csproj "$cache_dir/producer/src/Org.Lib.Core.Common/Org.Lib.Core.Common.csproj" ""
    _make_csproj "$cache_dir/holds-Org.Lib.Core-name/src/Org.Unrelated/Org.Unrelated.csproj" ""
    _make_csproj "$cache_dir/consumer/src/Org.App.Consumer/Org.App.Consumer.csproj" \
        '<PackageReference Include="Org.Lib.Core" Version="1.0.0" />
    <PackageReference Include="Org.Lib.Core.Common" Version="2.0.0" />'
    printf '%s\n%s\n' "2026-03-29T00:00:00Z" "abc123" > "$cache_dir/.cache_timestamp"
}

run_dep_lib() {
    bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS' REPO_CACHE_DIR='$REPO_CACHE_DIR'
        export CS_DEP_ORG_PREFIX='Org.' CS_DEP_INDEX_DIR='$CS_DEP_INDEX_DIR'
        source '$DEVENV_TOOLS/lib/cs-dependency-graph.bash'
        $1
    "
}

@test "cs-dep-graph: a reference to an absent package is not attributed to a longer-named sibling" {
    create_prefix_sibling_fixture
    run run_dep_lib "build_dependency_index"
    [ "$status" -eq 0 ]
    local deps="$CS_DEP_INDEX_DIR/repo_dependencies.tsv"
    # Org.Lib.Core is made by no cached repo: it must produce no edge at all,
    # not one pointing at whichever repo made Org.Lib.Core.Common.
    run ! grep -qP '\tOrg\.Lib\.Core\t' "$deps"
}

@test "cs-dep-graph: a reference is not matched through a repo name that contains it" {
    # Only a repo whose NAME contains "Org.Lib.Core" exists (it makes an
    # unrelated package); nothing makes Org.Lib.Core, so no edge may appear.
    local cache_dir="$TEST_TEMP_DIR/cache/repo_cache"
    _make_csproj "$cache_dir/holds-Org.Lib.Core-name/src/Org.Unrelated/Org.Unrelated.csproj" ""
    _make_csproj "$cache_dir/consumer/src/Org.App.Consumer/Org.App.Consumer.csproj" \
        '<PackageReference Include="Org.Lib.Core" Version="1.0.0" />'
    printf '%s\n%s\n' "2026-03-29T00:00:00Z" "abc123" > "$cache_dir/.cache_timestamp"
    run run_dep_lib "build_dependency_index"
    [ "$status" -eq 0 ]
    [ ! -s "$CS_DEP_INDEX_DIR/repo_dependencies.tsv" ]
}

@test "cs-dep-graph: an exact package reference still produces its edge" {
    create_prefix_sibling_fixture
    run run_dep_lib "build_dependency_index"
    [ "$status" -eq 0 ]
    grep -qP '^consumer\tOrg\.Lib\.Core\.Common\t2\.0\.0$' "$CS_DEP_INDEX_DIR/repo_dependencies.tsv"
}

@test "cs-dep-graph: the root repo is matched literally, not as a regex" {
    # "producer" exists; "pr.ducer" would match it if '.' were a wildcard.
    create_prefix_sibling_fixture
    run --separate-stderr run_dep_lib "build_dependency_index >/dev/null 2>&1; get_reverse_dependency_tree 'pr.ducer'"
    [ "$status" -eq 1 ]
    [[ "$stderr" == *"not found in package index"* ]]
}

@test "cs-dep-graph: a real root repo with regex characters in its name is still found" {
    local cache_dir="$TEST_TEMP_DIR/cache/repo_cache"
    _make_csproj "$cache_dir/lib.core+x/src/Org.Dotted/Org.Dotted.csproj" ""
    _make_csproj "$cache_dir/user/src/Org.User/Org.User.csproj" \
        '<PackageReference Include="Org.Dotted" Version="1.0.0" />'
    printf '%s\n%s\n' "2026-03-29T00:00:00Z" "abc123" > "$cache_dir/.cache_timestamp"
    run --separate-stderr run_dep_lib "build_dependency_index >/dev/null 2>&1; get_reverse_dependency_tree 'lib.core+x'"
    [ "$status" -eq 0 ]
    [[ "$output" == *"user"* ]]
}

# ============================================================================
# get_topological_generations (merged from the former scripts/ suite; these run
# in-process against a fresh empty index, built by topo_init)
# ============================================================================

# Create a minimal fake repo dir containing one .csproj so it appears as a
# C# repo to get_topological_generations
create_repo() {
    local name="$1"
    mkdir -p "$REPO_CACHE_DIR/$name/src"
    touch "$REPO_CACHE_DIR/$name/src/${name}.csproj"
}

# Index helpers — append rows to the relevant TSV files
add_pkg()      { printf '%s\t%s\n'     "$1" "$2"      >> "$REPO_CACHE_DIR/.index/package_to_repo.tsv"; }
add_repo_pkg() { printf '%s\t%s\n'     "$1" "$2"      >> "$REPO_CACHE_DIR/.index/repo_packages.tsv"; }
add_dep()      { printf '%s\t%s\t%s\n' "$1" "$2" "${3:-1.0.0}" >> "$REPO_CACHE_DIR/.index/repo_dependencies.tsv"; }

topo_init() {
    # The shared setup() points these at the other tests' cache; this section
    # needs the library defaults derived from its own REPO_CACHE_DIR.
    unset CS_DEP_INDEX_DIR CS_DEP_ORG_PREFIX
    export REPO_CACHE_DIR="$TEST_TEMP_DIR/cache"
    mkdir -p "$REPO_CACHE_DIR/.index"

    # Initialise empty index files
    : > "$REPO_CACHE_DIR/.index/package_to_repo.tsv"
    : > "$REPO_CACHE_DIR/.index/repo_packages.tsv"
    : > "$REPO_CACHE_DIR/.index/repo_dependencies.tsv"

    # Write matching timestamps so ensure_dependency_index treats index as fresh
    echo "test-ts" > "$REPO_CACHE_DIR/.cache_timestamp"
    echo "test-ts" > "$REPO_CACHE_DIR/.index/.index_timestamp"

    # Source the libraries — CS_DEP_INDEX_DIR is derived from REPO_CACHE_DIR at
    # source time, so REPO_CACHE_DIR must be set first.
    # shellcheck source=../../lib/error-handling.bash
    source "$PROJECT_ROOT/tools/lib/error-handling.bash"
    # shellcheck source=../../lib/repo-cache.bash
    source "$PROJECT_ROOT/tools/lib/repo-cache.bash"
    # shellcheck source=../../lib/cs-dependency-graph.bash
    source "$PROJECT_ROOT/tools/lib/cs-dependency-graph.bash"
}

# ---------------------------------------------------------------------------
# Syntax check
# ---------------------------------------------------------------------------

@test "cs-dependency-graph.bash has valid bash syntax" {
    topo_init
    run bash -n "$PROJECT_ROOT/tools/lib/cs-dependency-graph.bash"
    [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# get_topological_generations — basic cases
# ---------------------------------------------------------------------------

@test "get_topological_generations - empty cache returns nothing" {
    topo_init
    run get_topological_generations
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "get_topological_generations - single repo with no org deps is generation 0" {
    topo_init
    create_repo "repo-a"

    run get_topological_generations
    [ "$status" -eq 0 ]
    [[ "$output" == "0"$'\t'"repo-a" ]]
}

@test "get_topological_generations - repo with no csproj is excluded" {
    topo_init
    # This dir has no csproj files so should not appear in output
    mkdir -p "$REPO_CACHE_DIR/not-a-cs-repo"
    create_repo "repo-a"

    run get_topological_generations
    [ "$status" -eq 0 ]
    [[ "$output" == "0"$'\t'"repo-a" ]]
    [[ "$output" != *"not-a-cs-repo"* ]]
}

# ---------------------------------------------------------------------------
# Linear chain
# ---------------------------------------------------------------------------

@test "get_topological_generations - linear chain A->B->C produces three generations" {
    topo_init
    create_repo "repo-a"   # gen 0: produces WorkInProgress.A, no org deps
    create_repo "repo-b"   # gen 1: produces WorkInProgress.B, depends on WorkInProgress.A
    create_repo "repo-c"   # gen 2: no org packages, depends on WorkInProgress.B

    add_pkg      "WorkInProgress.A" "repo-a"
    add_repo_pkg "repo-a"           "WorkInProgress.A"
    add_pkg      "WorkInProgress.B" "repo-b"
    add_repo_pkg "repo-b"           "WorkInProgress.B"
    add_dep      "repo-b"           "WorkInProgress.A"
    add_dep      "repo-c"           "WorkInProgress.B"

    run get_topological_generations
    [ "$status" -eq 0 ]
    [[ "$output" =~ "0"$'\t'"repo-a" ]]
    [[ "$output" =~ "1"$'\t'"repo-b" ]]
    [[ "$output" =~ "2"$'\t'"repo-c" ]]
}

@test "get_topological_generations - linear chain preserves order across lines" {
    topo_init
    create_repo "repo-a"
    create_repo "repo-b"
    create_repo "repo-c"

    add_pkg      "WorkInProgress.A" "repo-a"
    add_repo_pkg "repo-a"           "WorkInProgress.A"
    add_pkg      "WorkInProgress.B" "repo-b"
    add_repo_pkg "repo-b"           "WorkInProgress.B"
    add_dep      "repo-b"           "WorkInProgress.A"
    add_dep      "repo-c"           "WorkInProgress.B"

    run get_topological_generations
    [ "$status" -eq 0 ]

    # Extract generations for each repo from output
    gen_a=$(echo "$output" | awk -F'\t' '$2=="repo-a"{print $1}')
    gen_b=$(echo "$output" | awk -F'\t' '$2=="repo-b"{print $1}')
    gen_c=$(echo "$output" | awk -F'\t' '$2=="repo-c"{print $1}')

    [ "$gen_a" -lt "$gen_b" ]
    [ "$gen_b" -lt "$gen_c" ]
}

# ---------------------------------------------------------------------------
# Diamond graph
# ---------------------------------------------------------------------------

@test "get_topological_generations - diamond A->(B,C)->D places B and C in same generation" {
    topo_init
    create_repo "repo-a"
    create_repo "repo-b"
    create_repo "repo-c"
    create_repo "repo-d"

    add_pkg      "WorkInProgress.A" "repo-a"
    add_repo_pkg "repo-a"           "WorkInProgress.A"
    add_pkg      "WorkInProgress.B" "repo-b"
    add_repo_pkg "repo-b"           "WorkInProgress.B"
    add_pkg      "WorkInProgress.C" "repo-c"
    add_repo_pkg "repo-c"           "WorkInProgress.C"

    add_dep "repo-b" "WorkInProgress.A"
    add_dep "repo-c" "WorkInProgress.A"
    add_dep "repo-d" "WorkInProgress.B"
    add_dep "repo-d" "WorkInProgress.C"

    run get_topological_generations
    [ "$status" -eq 0 ]

    gen_a=$(echo "$output" | awk -F'\t' '$2=="repo-a"{print $1}')
    gen_b=$(echo "$output" | awk -F'\t' '$2=="repo-b"{print $1}')
    gen_c=$(echo "$output" | awk -F'\t' '$2=="repo-c"{print $1}')
    gen_d=$(echo "$output" | awk -F'\t' '$2=="repo-d"{print $1}')

    [ "$gen_a" -eq 0 ]
    [ "$gen_b" -eq "$gen_c" ]    # same generation — both depend only on repo-a
    [ "$gen_d" -gt "$gen_b" ]
}

# ---------------------------------------------------------------------------
# Repos with no org packages (only external deps)
# ---------------------------------------------------------------------------

@test "get_topological_generations - repo with only external deps is generation 0" {
    topo_init
    create_repo "repo-lib"      # produces WorkInProgress.Lib
    create_repo "repo-service"  # has csproj but only Microsoft.* deps — no org packages

    add_pkg      "WorkInProgress.Lib" "repo-lib"
    add_repo_pkg "repo-lib"           "WorkInProgress.Lib"
    # repo-service has no entries in any index file

    run get_topological_generations
    [ "$status" -eq 0 ]

    gen_lib=$(echo "$output" | awk -F'\t' '$2=="repo-lib"{print $1}')
    gen_svc=$(echo "$output" | awk -F'\t' '$2=="repo-service"{print $1}')

    [ "$gen_lib" -eq 0 ]
    [ "$gen_svc" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Alphabetical ordering within a generation
# ---------------------------------------------------------------------------

@test "get_topological_generations - repos within a generation are sorted alphabetically" {
    topo_init
    create_repo "repo-z"
    create_repo "repo-a"
    create_repo "repo-m"
    # No org-internal deps → all land in generation 0

    run get_topological_generations
    [ "$status" -eq 0 ]

    gen0_repos=$(echo "$output" | awk -F'\t' '$1==0{print $2}')
    expected=$'repo-a\nrepo-m\nrepo-z'
    [ "$gen0_repos" = "$expected" ]
}

# ---------------------------------------------------------------------------
# Cycle detection
# ---------------------------------------------------------------------------

@test "get_topological_generations - cycle emits warning and exits 0" {
    topo_init
    create_repo "repo-x"
    create_repo "repo-y"

    add_pkg      "WorkInProgress.X" "repo-x"
    add_repo_pkg "repo-x"           "WorkInProgress.X"
    add_pkg      "WorkInProgress.Y" "repo-y"
    add_repo_pkg "repo-y"           "WorkInProgress.Y"

    # Create a cycle: x depends on y, y depends on x
    add_dep "repo-x" "WorkInProgress.Y"
    add_dep "repo-y" "WorkInProgress.X"

    run get_topological_generations
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Cycle detected" ]]
}

@test "get_topological_generations - cycle does not hang or loop forever" {
    topo_init
    create_repo "repo-x"
    create_repo "repo-y"

    add_pkg      "WorkInProgress.X" "repo-x"
    add_repo_pkg "repo-x"           "WorkInProgress.X"
    add_pkg      "WorkInProgress.Y" "repo-y"
    add_repo_pkg "repo-y"           "WorkInProgress.Y"

    add_dep "repo-x" "WorkInProgress.Y"
    add_dep "repo-y" "WorkInProgress.X"

    # Should complete within 5 seconds
    run timeout 5 bash -c "
        export REPO_CACHE_DIR=\"$REPO_CACHE_DIR\"
        export DEVENV_TOOLS=\"$DEVENV_TOOLS\"
        source \"\$DEVENV_TOOLS/lib/error-handling.bash\"
        source \"\$DEVENV_TOOLS/lib/repo-cache.bash\"
        source \"\$DEVENV_TOOLS/lib/cs-dependency-graph.bash\"
        get_topological_generations
    "
    [ "$status" -ne 124 ]  # 124 = timeout
}
