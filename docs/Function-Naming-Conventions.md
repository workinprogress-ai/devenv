# Function Naming Conventions

This document defines the naming standards for bash functions in the Devenv project.

## Standard: snake_case

All bash functions MUST use **snake_case** naming convention for consistency and readability.

### Format Rules

1. **Use lowercase letters only**: `my_function`, not `MyFunction` or `myFunction`
2. **Separate words with underscores**: `add_nuget_source`, not `addnugetsource`
3. **Use descriptive names**: `add_npm_registry_if_not_exists`, not `add_npm`
4. **Prefix with verb**: `get_version`, `check_requirements`, `validate_input`
5. **Use full words**: `get_configuration`, not `get_config` (unless acronym is standard)

### Common Verb Prefixes

| Prefix | Purpose | Example |
|--------|---------|---------|
| `get_` | Retrieve a value | `get_bash_version()` |
| `set_` | Assign a value | `config_set()` |
| `check_` | Verify condition (returns 0/1) | `check_bash_version()` |
| `validate_` | Check input validity | `validate_positive_integer()` |
| `require_` | Assert requirement or fail | `require_command()` |
| `is_` | Boolean check | `is_strict_mode_enabled()` |
| `has_` | Check for existence | `config_has()` |
| `add_` | Add an item | `add_git_safe_directory()` |
| `create_` | Create something new | `create_temp_dir()` |
| `remove_` | Remove something | `safe_remove()` |
| `enable_` | Turn on a feature | `enable_strict_mode()` |
| `configure_` | Set up configuration | `configure_git_repo()` |
| `log_` | Logging functions | `log_info()`, `log_error()` |
| `parse_` | Parse/extract data | `parse_version()` |
| `compare_` | Compare values | `compare_versions()` |
| `on_` | Event handlers | `on_error()`, `on_script_error()` |

### Namespace Prefixes

For library functions, use a consistent namespace prefix:

- `config_*` - Configuration management (lib/config.bash)
- `log_*` - Logging functions (lib/error-handling.bash)
- `version_*` - Version utilities (lib/versioning.bash)

### Examples

#### ✅ Good Names

```bash
# Clear action and subject
get_bash_version() { ... }
check_environment_requirements() { ... }
add_npm_registry_if_not_exists() { ... }
validate_positive_integer() { ... }
require_script_version() { ... }
is_strict_mode_enabled() { ... }
configure_git_global() { ... }
on_script_error() { ... }
```

#### ❌ Bad Names

```bash
# Inconsistent casing
getBashVersion() { ... }        # camelCase - use snake_case
GetBashVersion() { ... }        # PascalCase - use snake_case

# Unclear purpose
do_stuff() { ... }              # Too vague
process() { ... }               # What does it process?
handle() { ... }                # Handle what?

# Abbreviated
chk_ver() { ... }               # Use check_version
cfg_git() { ... }               # Use configure_git
rm_tmp() { ... }                # Use remove_temp
```

### Special Cases

#### Utility Wrappers

When wrapping external commands for specific purposes, use descriptive names:

```bash
# ✅ Good - describes purpose
invoke_npm_with_filtered_output() { ... }
run_dotnet_with_retry() { ... }

# ❌ Bad - too generic
call_npm() { ... }    # Rename to invoke_npm_quietly or similar
run() { ... }         # Too generic
```

#### Short Helper Functions

Even short helpers should be descriptive:

```bash
# ✅ Good
use_colors() { ... }
get_timestamp() { ... }
die() { ... }          # Acceptable - well-known convention

# ❌ Bad
c() { ... }            # Too cryptic
ts() { ... }           # Use get_timestamp
```

#### Command Aliases

Simple aliases for navigation can be short:

```bash
# ✅ Acceptable for user convenience
devenv() { cd "$DEVENV"; }
repos() { cd "$DEVENV_ROOT/repos"; }
playground() { cd "$DEVENV_ROOT/playground"; }
```

These are user-facing convenience functions, not library functions.

## Implementation Guidelines

### When Creating New Functions

1. Choose a clear verb prefix from the table above
2. Use full words, not abbreviations
3. Describe what the function does, not how
4. Keep names under 40 characters when possible
5. Use underscores to separate logical parts

### When Refactoring Existing Functions

1. Check if the name follows snake_case
2. Verify the verb prefix matches the function's purpose
3. Ensure the name is descriptive enough
4. Update all call sites when renaming
5. Add tests to verify the refactored function

### Testing Function Names

Function names should be tested in unit tests:

```bash
@test "lib function names use snake_case" {
  # Extract function names from library files
  run bash -c "grep -hE '^[a-z_][a-z0-9_]*\(\)' tools/lib/*.bash | sed 's/().*//' | grep -E '[A-Z]'"
  [ "$status" -ne 0 ]  # Should find no uppercase letters
}
```

## Migration Path

For existing code with non-compliant names:

1. Create new function with correct name
2. Mark old function as deprecated with comment
3. Have old function call new function
4. Update documentation
5. Create issue to remove deprecated function
6. Update all call sites in separate commit
7. Remove deprecated function

Example:

```bash
# New standard name
invoke_npm_quietly() {
    npm "$@" 2>&1 | grep -v 'NODE_TLS_REJECT_UNAUTHORIZED is set to 0'
}

# Deprecated - remove in v2.0.0
# Use invoke_npm_quietly() instead
call_npm() {
    invoke_npm_quietly "$@"
}
```

## Enforcement

1. **Code Reviews**: Reviewers must check function naming
2. **Automated Tests**: Run naming convention tests in CI
3. **Linting**: Use shellcheck and custom linters
4. **Documentation**: Keep this guide updated

## See Also

- [Coding Standards](Coding-standards.md) - General code quality standards
- [Contributing Guide](Contributing.md) - How to contribute code
- [Error Handling](../lib/error-handling.bash) - Standard error handling functions
- [Configuration](../lib/config.bash) - Configuration management functions
