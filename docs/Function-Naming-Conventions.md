# Function Naming Conventions

This document defines the naming standards for functions and modules in the
Devenv project's TypeScript tooling. The small bash bootstrap layer has its own
short section at the end.

## Standard: camelCase functions, kebab-case files

| Thing | Convention | Example |
|-------|------------|---------|
| Function, variable, parameter | `camelCase` | `resolveBodySource`, `providerOrgGet` |
| Type, interface, class | `PascalCase` | `ToolCliOptions`, `SpawnError` |
| Constant (module-level, fixed value) | `UPPER_SNAKE_CASE` | `EXIT_MISUSE`, `NODE_FLOOR`, `SCRIPT_VERSION` |
| Module under `tools/lib/` | `kebab-case.ts` | `exit-codes.ts`, `body-source.ts` |
| Tool under `tools/ts/` | `group-action.ts` | `issue-create.ts`, `markdown-plan-complete-task.ts` |
| Test | `<subject>.test.ts` under `tools/tests/ts/` | `config-reader.test.ts` |

Tool names are the command names, so they stay `kebab-case` and follow the
existing `group-action` pattern (the group names the family, the action names
what the tool does). A file whose name starts with `_` is machinery that is
called by path, not a user-facing command.

### Format rules

1. **Start lowercase, capitalize each following word**: `addShortcut`, not
   `AddShortcut` or `add_shortcut`.
2. **Use descriptive names**: `buildDependencyIndex`, not `buildIndex`.
3. **Prefix with a verb** (see the table below): `getReverseDependencyTree`, `checkTargetRepo`,
   `requireCommand`.
4. **Use full words**: `getConfiguration`, not `getCfg` (unless the acronym is
   standard: `url`, `id`, `pr`).
5. **Treat an acronym as a word**: `parseUrl`, not `parseURL`.

### Common verb prefixes

| Prefix | Purpose | Example |
|--------|---------|---------|
| `get` | Retrieve a value | `getReverseDependencyTree()` |
| `check` | Verify a condition, return a boolean or result | `checkTargetRepo()` |
| `require` | Assert a precondition or fail | `requireCommand()`, `requireOptionValue()` |
| `is` | Boolean check | `isInteractive()`, `isIndexStale()` |
| `has` | Check for existence | `skipListHas()` (family word first, verb last) |
| `add` | Add an item | `addShortcut()`, `addFolder()` (`lib/domain/desktop-menu.ts`) |
| `set` | Change a setting or state | `setLogLevel()` |
| `parse` | Parse or extract data | `parsePlan()` (`lib/domain/plan.ts`) |
| `resolve` | Work out a value from several sources | `resolveBodySource()` |
| `build` | Assemble a derived structure | `buildDependencyIndex()` |
| `log` | Logging functions | `logInfo()`, `logError()` |

### Namespace prefixes

Where several functions form one family, share a leading word so they sort and
search together:

- `provider*` — provider detection, identity and capability gates
  (`lib/providers/provider-core.ts`): `providerDetect`, `providerOrgGet`,
  `providerRepoTarget`.
- Facade verbs lead with the family: `issues*`, `prs*`, `repos*`, `org*`,
  `pipelines*`, `projects*`, `urls*` (`lib/providers/facade/<family>.ts`):
  `prsMerge`, `issuesEdit`, `reposList`.
- `config*` — `devenv.config` access (`lib/core/config.ts`): `configGetRaw`.
- `log*` — logging (`lib/core/logging.ts`).

### Examples

#### Good names

```ts
// Clear action and subject
export function getReverseDependencyTree(rootInput: string): ReverseTreeRow[] { /* ... */ }
export function requireOptionValue(optionName: string, value: string | undefined): string { /* ... */ }
export function isInteractive(): boolean { /* ... */ }
export const EXIT_API_FAILURE = 4;
```

#### Bad names

```ts
// Inconsistent casing
function get_version() {}         // snake_case - use getVersion
function GetVersion() {}          // PascalCase is for types

// Unclear purpose
function doStuff() {}             // too vague
function process() {}             // what does it process?
function handle() {}              // handle what?

// Abbreviated
function chkVer() {}              // use checkVersion
function cfgGit() {}              // use configureGit
function rmTmp() {}               // use removeTempDirectory
```

### Special cases

#### Wrappers around external commands

When wrapping an external command for a specific purpose, name the purpose, and
spawn through `tools/lib/core/spawn.ts` (`run`, `mustRun`) with a typed argv
rather than a shell string:

```ts
// Good - describes purpose
function runDotnetRestoreWithRetry(args: string[]): Promise<SpawnResult> { /* ... */ }

// Bad - too generic
function callNpm() {}             // say what the call is for
```

#### Short helpers

Even short helpers are descriptive. A short name is acceptable only when it is
the widely known one for the job (`run` in `core/spawn.ts`, `text` and
`select` in `ui/prompts.ts`, where the module name supplies the context).

#### Export surface

A module exports the functions other modules need and nothing else. Keep
helpers module-private (unexported); a private helper needs no namespace prefix.

## Implementation guidelines

### When creating new functions

1. Choose a clear verb prefix from the table above.
2. Use full words, not abbreviations.
3. Describe what the function does, not how.
4. Keep names under 40 characters when possible.
5. Put a short doc comment on every exported function stating what it returns
   and when it throws or exits.

### When renaming existing functions

1. Check the name follows camelCase.
2. Verify the verb prefix matches the function's purpose.
3. Update all call sites in the same commit; the type gate (`tsc --noEmit`)
   finds any that were missed.
4. Add or adjust tests for the renamed function.

## Enforcement

1. **Type gate**: `tsc --noEmit` (`pnpm typecheck`) catches a call site left on
   an old name.
2. **Lint**: `eslint tools` (`pnpm lint:ts`) runs in the pre-commit hook and CI.
3. **Code review**: reviewers check function and file naming against this guide.

## Bash bootstrap layer

The bash that remains is the container bootstrap surface
(`tools/lib/config-reader.bash`, `tools/lib/error-handling.bash`,
`tools/lib/providers/provider-core.bash` and the provider
`auth`/`setup`/`bootstrap` hooks; see
[Bash bootstrap surface](../tools/lib/providers/README.md#bash-bootstrap-surface)).
Its functions use `snake_case` with a namespace prefix that matches the file:
`config_*` (`config-reader.bash`), `log_*` (`error-handling.bash`),
`provider_*` (`provider-core.bash` and the provider hook files, for example
`provider_setup_label`). Do not add new functions there unless the bootstrap
chain itself needs them.

## See Also

- [Tooling Standards](Tooling-Standards.md) - General code quality standards and the library catalog
- [Workflow Guide](Workflow.md) - Delivery methodology and working agreements
