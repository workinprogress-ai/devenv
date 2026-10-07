# Provider Abstraction Library

Provider-agnostic facade for the devenv tools layer. Wrapper scripts call
`provider_<domain>_<verb>` functions; the active provider's module answers.
Two providers ship: `github/` and `azure/`. [CONTRACT.md](CONTRACT.md) is the
contract every provider implements: the verbs, their arguments, options and result
fields. Forks add other backends without touching provider-core or any existing
module.

## Layout

```
tools/lib/providers/
├── CONTRACT.md             # the verb/shape inventory both providers implement
├── provider-core.bash      # detection, loader, missing-verb handler, auth +
│                           # secret seams, capability flags, repo-target
│                           # normalizer, error contract
├── github/                 # the GitHub provider
│   ├── issues.bash         # issues, labels, milestones, native types
│   ├── prs.bash            # prs, review threads, merge lookups
│   ├── repos.bash          # repos, protection, perms
│   ├── pipelines.bash      # runs, workflows, artifacts, polling
│   │                       # (the tools are named "pipelines-*")
│   ├── projects.bash       # project boards (GH-only capability)
│   ├── org.bash            # rulesets, releases, org issue-types
│   ├── urls.bash           # host/transport/web-URL seam
│   ├── auth.bash           # credential lifecycle (login, status, token)
│   ├── setup.bash          # host-side hooks, sourced by `setup`
│   └── bootstrap.bash      # container-side hooks, called by bootstrap
└── azure/                  # the Azure DevOps provider: the same domain modules
    │                       # over a REST transport (http.bash), plus policies.bash,
    │                       # releases.bash, setup.bash and bootstrap.bash;
    └── MAPPING.md          # how GitHub concepts map onto Azure DevOps
```

## Usage

```bash
source "${DEVENV_TOOLS}/lib/providers/provider-core.bash"
provider_load issues prs      # detects [provider] name, then sources those modules

provider_issues_list org/repo --state open
provider_issues_set_type org repo 42 Bug   # gated: native-issue-types
```

## Contracts

- **Dispatch is naming-convention**: callers use `provider_<domain>_<verb>`;
  the active provider's module defines those functions. Adding a provider =
  adding files under `lib/providers/<name>/` — core never changes. A verb the
  provider does not define is not a crash: core's `command_not_found_handle`
  answers any missing `provider_*` name with "provider X does not implement Y"
  and status 1.
- **Detection is config-driven**: `[provider] name` in `devenv.config`. A name
  that is not shipped fails `provider_load` (and `provider_detect`) with the
  shipped names listed; there is no silent fallback to another provider. With no
  `[provider] name` the default is `POLICY_DEFAULT_PROVIDER` or `github`.
- **Options are exact**: a verb accepts the options the contract lists and
  returns an error naming any other (`provider_unknown_option`); nothing is
  dropped silently.
- **Auth seam**: credentials resolve only via `provider_secret_get` and the
  `provider_auth_*` lifecycle verbs. Modules never read `GH_TOKEN` directly. Resolution
  order: **env-if-allowlisted → keychain (`gh auth token`) → error**. See
  [Token resolution & the escape-hatch allowlist](#token-resolution--the-escape-hatch-allowlist).
- **Capability flags**: GH-only surfaces (rulesets, project-boards,
  native-issue-types) are declared capabilities. Gated verbs call
  `provider_require_capability`, which fails with the defined
  "provider does not support this" error — never a mid-command crash. A verb a
  provider lacks entirely fails the same way, through the missing-verb handler.
- **Error contract**: library functions return non-zero and log via
  `log_error`; provider libraries never `exit`.

## Bootstrap and setup hooks

Work that differs per provider during `setup` (on the user's own machine) and
during bootstrap (in the container) lives in the provider, never in the main
scripts. Each provider ships two files:

- `<provider>/setup.bash` — **host side**, sourced by `setup` before the container
  exists. It must stay **bash 3.2 compatible** (macOS hosts): no associative
  arrays, no `${var,,}`, no `mapfile`. A bats test enforces this.
- `<provider>/bootstrap.bash` — **container side**, loaded with
  `provider_load bootstrap`. It sources its own `setup.bash` so the validators are
  written once.

The main bootstrap calls hooks with `provider_bootstrap_call HOOK [ARGS...]`; a hook
the provider does not define is a no-op success, and no main script branches on the
provider name.

| Hook | Side | Contract |
|---|---|---|
| `provider_setup_validate_token ORG < token` | host (`setup.bash`) | `0` accepted, `1` rejected or empty, `2` service unreachable. The credential header rides curl's stdin, never argv. |
| `provider_bootstrap_validate_token < token` | container | Same contract; delegates to the validator above, resolving the organization itself (Azure: `[provider] azure_org`). Used to check a setup seed before it is imported and deleted. |
| `provider_bootstrap_apt_packages` | container | Print the space-separated OS packages the provider's tooling needs (GitHub: `gh`); print nothing when it needs none (Azure DevOps). |
| `provider_bootstrap_git_auth_header TOKEN` | container | Print the `http.extraheader` value (`AUTHORIZATION: ...`) git needs for HTTPS fetch, pull and clone of this provider's remotes. |
| `provider_bootstrap_configure_nuget` | container | Register the provider's NuGet feed with its own credential. A provider with no feed registers nothing and says so. |
| `provider_bootstrap_configure_npmrc FILE` | container | Authenticate the provider's npm registry in `FILE`. |

The hooks run in the bootstrap shell, so they may use the provider seam
(`provider_secret_get`, `provider_org_get`, `provider_user_get`), `config_read_value`,
and, for NuGet, the `add_nuget_source_if_not_exists` helper.

## Token resolution & the escape-hatch allowlist

`provider_secret_get token` resolves credentials in a fixed order:

1. **env-if-allowlisted** — a session-scoped `GH_TOKEN` export is honored only
   when its value is on the allowlist.
2. **keychain** — `gh auth token` (gh's own credential store; the normal,
   preferred state after `gh auth login`).
3. **error** — neither available: defined failure, never a fallback prompt.

A non-allowlisted `GH_TOKEN` in the environment must not outrank the keychain (gh
prefers the environment): the GitHub provider strips it when it asks gh for status
or a token. Code that needs the token resolves it with `provider_secret_get`, not by
reading the variable.

### Escape-hatch allowlist

> **Not supported.** No consumer uses the allowlist, and holding raw token values in
> the tracked `devenv.config` is not a pattern to adopt. The mechanism exists in
> `provider-core.bash`, ships empty, and is documented below only so its behavior is
> known; do not add entries. Credentials resolve from the provider credential store.

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
  resolves via the keychain instead; the env token is never used.

## Repo targeting

`provider_repo_target` (provider-core.bash) is the canonical normalizer.
Resolution order: explicit arg → `DEVENV_REPO` env → the provider's env hook
(GitHub reads a full-form `GH_REPO`; no other variable participates) → the
provider's cwd hook (org identity + the git root's basename) → empty (caller
decides the error).

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

- Slice 2 (#35): keychain-first auth behind the auth seam (env tokens only
  via the explicit allowlist; no file-based token store shipped).
- Slice 3 (#36): route existing wrappers through this facade (also retires
  
- Slice 7 (#40): Azure DevOps provider.
- Slice 9 (#41): full documentation overhaul — this README is a stub.

## The docs half of the fork contract

A fork that swaps providers edits this directory plus one skill-side file it
authors: [`copilot/skills/_shared/references/provider-protocols/<provider>.md`](../../../copilot/skills/_shared/references/provider-protocols/azure.md)
— the transport reference skill bodies resolve by provider name (`<provider>`
= `[provider] name` in `devenv.config`), written to the fixed three-part
structure (credential lifecycle → repo targeting → provider-visible
behavior). The neutral wrapper contract they both cite is
[`protocol-common.md`](../../../copilot/skills/_shared/references/protocol-common.md)
— identical for every fork, never fork-edited. Provider code and skill docs
are two halves of one contract: swap the provider modules here, author the
transport reference there, and the skill suite (including the decoupling gate
in `tools/tests/skills/test_provider_protocol_decoupling.bats`) enforces that
no skill body drifted back toward a hard-coded backend.

Org-policy decisions (issue types, triage labels, workflow status semantics,
provider default, org identity) are the other fork surface: they live in
[`tools/lib/policy/`](../policy/README.md) with config-driven values and
`POLICY_*` overrides — a fork edits config, not code.
