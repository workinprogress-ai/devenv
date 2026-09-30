# Provider Protocol — GitHub

> **Fork note:** this file is the **GitHub transport reference** — one of
> the per-provider transport files. Skills cite transport as
> `provider-protocols/<provider>.md`, resolving `<provider>` from
> `devenv.config [provider] name`; the provider-specific repo env var and
> credential mechanics below are the GitHub entries of that contract. A
> fork adding a provider authors its own `<provider>.md` to the same
> three-part structure (credential lifecycle → repo targeting →
> provider-visible behavior); this file is never content-swapped.
>
> The provider-neutral half — wrapper invocation contract, repo targeting
> chain, prohibitions, canonical recipes — lives in
> [`../protocol-common.md`](../protocol-common.md) and is identical for
> every fork.
>
> **Provider-visible behavior (GitHub):** issues are numbered per repo
> (`#N`) — `#N` cross-references, portal URLs, and inter-repo ordering
> cues are repo-local. Providers with org-global ids (Azure DevOps) state
> their own caveat in their transport file.

## Credential lifecycle

Tokens live in the gh credential store (keychain) — never in env vars, never
in remote URLs. Resolution order: keychain (`gh auth token`), with a
session-scoped env token honored only via the allowlist
(`devenv.config` `[provider] token_env_allowlist`).

Credential verbs (provider seam — wrappers call these; do not call gh directly):

- `provider_auth_import_token TOKEN` — store a credential and wire the git
  credential helper. Used by `key-update-git` (bash function dispatching to `tools/lib/providers/github/key-update.sh`) and the bootstrap seed-file
  import.
- `provider_auth_status` — authenticated check (exit code only). Used by
  `repo-get.sh` gates.
- `provider_secret_get token` — print the resolved token. Used by bootstrap
  (nuget/npmrc/copilot syncs).

Rotation: `key-update-git <token>` (or `gh auth login` manually).

## Repository targeting (GitHub entries)

The neutral targeting chain lives in
[`../protocol-common.md`](../protocol-common.md#repository-targeting).
GitHub's provider-specific entry: `GH_REPO` (gh's own full-form variable)
is honored as provider-internal transport state — scripts never read or
write it.
