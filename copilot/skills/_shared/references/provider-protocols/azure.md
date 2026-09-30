# Provider Protocol — Azure DevOps

> **Fork note:** this file is the **Azure DevOps transport reference** — one of
> the per-provider transport files. Skills cite transport as
> `provider-protocols/<provider>.md`, resolving `<provider>` from
> `devenv.config [provider] name`; the entries below are the Azure entries
> of that contract. A fork adding a provider authors its own
> `<provider>.md` to the same three-part structure (credential lifecycle →
> repo targeting → provider-visible behavior); no file is ever
> content-swapped.
>
> The provider-neutral half — wrapper invocation contract, repo targeting
> chain, prohibitions, canonical recipes — lives in
> [`../protocol-common.md`](../protocol-common.md) and is identical for
> every fork.
>
> **Activation:** `[provider] name=azure` in `devenv.config`. Modules:
> `tools/lib/providers/azure/` (curl + jq REST transport; no `az` CLI).

## Credential lifecycle

The token is a **0600 PAT file** outside every repo tree
(`~/.keys/azure-devops-pat` by default; `AZURE_PAT_FILE` overrides the
path) — never in env files, never in remote URLs. Resolution order:
allowlisted session env token (the neutral seam's `[provider]
token_env_allowlist`) → the PAT file (mode verified before every read).

Credential verbs (provider seam — wrappers call these; do not call the
provider CLI directly; Azure has none):

- `provider_auth_import_token` (stdin) — write the PAT file at 0600. Used
  by `key-update-azure` (prompt with hidden input, or piped stdin; argv
  form is deprecated and warns).
- `provider_auth_status` — authenticated check (exit code only).
- `provider_secret_get token` — print the resolved token (env-if-allowlisted
  → PAT file). Used by bootstrap syncs; the azure transport also
  self-heals through it when `AZURE_PAT` is not pre-set.

Rotation: `key-update-azure` (token over stdin/prompt — never argv).

PAT scopes: Work Items (Read/Write), Code (Read/Write), Build
(Read/Execute); **Packaging (Read)** additionally for Artifacts feeds
listing.

## Repository targeting (Azure entries)

The neutral targeting chain lives in
[`../protocol-common.md`](../protocol-common.md#repository-targeting).
Azure-specific entries:

- Canonical spec form is `project/repo` — the org is implied by config
  (`[provider] azure_org` + `azure_project`; one project per devenv
  instance). Full `org/project/repo` specs are accepted and split
  positionally.
- There is no provider repo env var; the chain's cwd leg composes
  `azure_org/azure_project/<repo-basename>`.
- Repo names are name-identical between the git host and Azure
  (`_git` remote URLs must agree with `azure_project`).

## Provider-visible behavior (Azure)

What skills and wrappers must know when the active provider is azure:

- **Work-item ids are org-global** (monotonically increasing across the
  project), not per-repo: `#N` cross-references will not match portal
  URLs, and ordering cues hold within the project only. Doc-ids that
  embed issue numbers stay valid.
- **Issue lists are project-scoped** — lists return the project's work
  items, not a repo's. Per-repo scoping via area paths is a provisioning
  convention (the setup script creates the paths) that the verbs do not
  yet apply.
- **Labels are `System.Tags`** (semicolon-separated flat strings); read
  projections emit gh-shaped `[{name}]` objects.
- **PR merge is a three-step** (mergeStrategy PATCH → GET the PR →
  status=completed echoing `lastMergeSourceCommit.commitId`, which is
  required). Merge, threads list, and thread create are repo-scoped
  (`repositories/{repo}/pullrequests/{pr}/…`); thread resolve works from
  the PR number alone.
- **Comment text and descriptions come back entity-encoded** with a
  trailing-newline quirk — the boundary restores markdown; write→read
  round trips are newline-insensitive.
- **Capability degrades:** org rulesets → per-repo branch policies;
  releases → git tags (prerelease heuristic, no drafts); package-version
  reads are unmapped (org-level Artifacts **feeds listing** works;
  the PAT needs Packaging (Read)); reactions unmapped; per-repo
  milestones → config-mapped iterations (empty lists).
- **Boards are native:** the `project-*` surface maps to board columns /
  work-item state; the board workflow's `status_workflow` vocabulary
  aliases onto process states via `[azure_status_aliases]`.
