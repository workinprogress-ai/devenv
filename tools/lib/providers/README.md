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
  `provider_secret_get`. Modules never read `GH_TOKEN` directly, so the
  file-based store (slice 2/#35) swaps in behind the seam.
- **Capability flags**: GH-only surfaces (rulesets, project-boards,
  native-issue-types) are declared capabilities. Gated verbs call
  `provider_require_capability`, which fails with the defined
  "provider does not support this" error — never a mid-command crash.
- **Error contract**: library functions return non-zero and log via
  `log_error`; provider libraries never `exit`.

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
