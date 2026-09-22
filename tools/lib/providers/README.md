# Provider Abstraction Library

Provider-agnostic facade for the devenv tools layer (epic #29). Wrapper
scripts call `provider_<domain>_<verb>` functions; the active provider's
module answers. Today: GitHub. Forks add other backends (e.g. Azure DevOps,
slice 7) without touching provider-core or any existing module.

## Layout

```
tools/lib/providers/
├── provider-core.bash      # detection, dispatch guard, auth + secret seams,
│                           # capability flags, error contract
├── github/                 # the GitHub provider's domain modules
│   ├── issues.bash         # issues, labels, milestones, native types
│   ├── prs.bash            # prs, review threads, merge lookups
│   ├── repos.bash          # repos, protection, perms, repo_target normalizer
│   ├── actions.bash        # runs, workflows, artifacts, polling
│   ├── projects.bash       # project boards (GH-only capability)
│   └── org.bash            # rulesets, releases, org issue-types
└── INVENTORY.md            # gh-call inventory this facade was derived from
                            # (point-in-time snapshot; retires with slice 3/#36)
```

## Usage

```bash
source "${DEVENV_TOOLS}/lib/providers/provider-core.bash"
provider_detect                      # reads [provider] name from devenv.config
# shellcheck disable=SC1091
source "$(provider_module_dir)/issues.bash"

provider_issues_list org/repo --state open
provider_issues_set_type org repo 42 Bug   # gated: native-issue-types
```

## Contracts

- **Dispatch is naming-convention**: core calls `provider_<domain>_<verb>`;
  the active provider's module defines those functions. Adding a provider =
  adding files under `lib/providers/<name>/` — core never changes.
- **Detection is config-driven**: `[provider] name` in `devenv.config`
  (default `github`).
- **Auth seam**: credentials resolve only via `provider_auth_env` /
  `provider_secret_get`. Modules never read `GH_TOKEN` directly. Resolution
  order: **env-if-allowlisted → keychain (`gh auth token`) → error**. See
  [Token resolution & the escape-hatch allowlist](#token-resolution--the-escape-hatch-allowlist).
- **Capability flags**: GH-only surfaces (rulesets, project-boards,
  native-issue-types) are declared capabilities. Gated verbs call
  `provider_require_capability`, which fails with the defined
  "provider does not support this" error — never a mid-command crash.
- **Error contract**: library functions return non-zero and log via
  `log_error`; provider libraries never `exit`.

## Token resolution & the escape-hatch allowlist

`provider_auth_env` and `provider_secret_get token` resolve credentials in a
fixed order:

1. **env-if-allowlisted** — a session-scoped `GH_TOKEN` export is honored only
   when its value is on the allowlist.
2. **keychain** — `gh auth token` (gh's own credential store; the normal,
   preferred state after `gh auth login`).
3. **error** — neither available: defined failure, never a fallback prompt.

`PROVIDER_AUTH_KIND` reports which branch was taken: `env` or `keychain`.

Note: the keychain branch of `eval "$(provider_auth_env)"` emits `unset
GH_TOKEN` — a non-allowlisted env token must not outrank the keychain in
caller shells (gh prefers env). Code that reads `GH_TOKEN` for non-auth
purposes must resolve it via `provider_secret_get` instead of the variable.

### Escape-hatch allowlist

The allowlist exists for the rare case where a tool genuinely needs a
session-scoped token export (e.g. a subprocess that cannot use gh's keychain).
It ships **empty**.

- **Where:** `devenv.config`, key `[provider] token_env_allowlist` — a
  space-separated list of exact token values. (Config, not a separate file, to
  keep a single source of truth for workspace configuration; the key ships
  commented-out/absent.)
- **Entry protocol:** every entry requires (a) a written justification naming
  the consumer that cannot use the keychain, (b) a review before merge, and
  (c) removal when the consumer is fixed. Entries are token *values*, so an
  entry is naturally invalidated by rotation — treat that as the reminder to
  re-justify. Reasons are embedded as a colon suffix (`<value>:<reason>`) and
  must be space-free (use dashes or underscores), since entries are
  space-separated.
- **Behavior without an entry:** the seam warns at consumer time (stderr) and
  resolves via the keychain instead; the env token is never used and never
  emitted by `provider_auth_env`.

## Repo targeting

`provider_repo_target` (repos.bash) is the canonical normalizer. Resolution
order: explicit arg → `GITHUB_REPO` → full-form `GH_REPO` → empty (caller
resolves from the cwd git remote). Slice 3 routing (#36) builds on this.

## Provider tests — who runs what

The default suite (`run-tests-local.sh`) runs only the **guaranteed GitHub
tests** (`test_provider_github_*.bats` / the current `test_provider_*.bats`
suites). A developer is not assumed to have every provider's backend installed.

- Provider X's **author** owns X's tests.
- A developer **modifying or adding provider X** runs X's suites explicitly:
  `bats tools/tests/lib/test_provider_x_*.bats`.
- Provider-neutral core tests (detection, dispatch, capabilities, seams) run
  always and pass for any conforming provider.

Suite naming is fixed now so a per-provider directory layout later is a pure
`git mv`: `test_provider_<provider>_<domain>.bats`.

## Related slices

- Slice 2 (#35): file-based PAT store behind the auth seam.
- Slice 3 (#36): route existing wrappers through this facade (also retires
  `INVENTORY.md`).
- Slice 7 (#40): Azure DevOps provider.
- Slice 9 (#41): full documentation overhaul — this README is a stub.

## The docs half of the fork contract

A fork that swaps providers edits this directory plus one skill-side file:
[`copilot/skills/_shared/references/provider-protocols/github.md`](../../../copilot/skills/_shared/references/provider-protocols/github.md)
— the protocol reference every skill body cites instead of inlining GitHub
transport detail. Provider code and skill docs are two halves of one contract:
swap the provider modules here, replace the protocol reference there, and the
skill suite (including the decoupling gate in
`tools/tests/skills/test_provider_protocol_decoupling.bats`) enforces that no
skill body drifted back toward a hard-coded backend.
