# Forking Guide

If you've forked this repository for your organization, this guide tells you what you may change safely, what you must override deliberately, and how to adapt the environment to a different git/work-item provider — Azure DevOps first among them. The devenv separates *what a fork decides* (values in config, policy modules, provider modules, protocol references) from *how the tooling works* (everything else), so upstream changes keep merging with minimal conflict.

The essentials live in `devenv.config`; repository-creation standards live in `tools/config/repo-types.yaml`; issue-type vocabulary lives in `tools/config/issues-config.yml`; provider behavior lives in `tools/lib/providers/<provider>/`.

## Quick Checklist

- ✅ Read [The fork-stable surfaces contract](#the-fork-stable-surfaces-contract) below — it defines what you may change without carrying maintenance burden
- ✅ Update `devenv.config` for org identity (the neutral `org` key), provider name, workflows, and bootstrap defaults
- ✅ (If you use the C# dependency tools) Set `[nuget] package_prefix` in `devenv.config` to your organization's package prefix (for example `Acme.`); the tools have no built-in value
- ✅ Edit `package.json` once: `repository.url` is a fork-owned value (it names where your fork lives), and `author` stays as the attribution it is. `devcontainer.json` `name` and `package.json` `description` are neutral wording you may rename
- ✅ (Optional) Put your fork's own or overriding tools in `tools/fork/` — see [Adding and overriding tools](#adding-and-overriding-tools-toolsfork-and-toolscustom)
- ✅ (If you customize the issue workflow) Read [Issue Workflow](./Issue-Workflow.md) first — the `[workflows]` vocabulary carries engine contracts, documented in its section below. You will need to re-write [Issue Workflow](./Issue-Workflow.md) to reflect your workflow.
- ✅ (If you use issue creation tooling) Update `tools/config/issues-config.yml` with your organization's issue types and provider issue-type IDs
- ✅ (If you adapt to a non-GitHub provider) Follow [Adapting to Azure DevOps](#adapting-to-azure-devops) — provider modules, protocol reference, and config keys
- ✅ (If you use repo creation tooling) Update `tools/config/repo-types.yaml` for naming, templates, branch protection, and post-creation scripts
- ✅ (Optional) Update `copilot/copilot-instructions.md` with organization-specific AI coding guidelines
- ✅ (Optional) Add custom Copilot skills to `copilot/skills/` for domain-specific workflows
- ✅ (Optional) Configure shared Copilot knowledge sync in `devenv.config` (`[copilot]` section)
- ✅ (If you use the Copilot knowledge base) Provide the orchestration door in your knowledge repo: `orchestration.md` at the content root with three required sections — Component taxonomy (the component types *your* org builds), Read routing (task → knowledge files), Write placement (candidates flow + fold destinations). Skills enter your knowledge only through this file and classify against your taxonomy, never a devenv-side list. See [Knowledge & Engineering Patterns](./Knowledge-and-Engineering-Patterns.md#the-orchestration-door); the upstream knowledge repo carries the reference implementation.
- ✅ (Optional) Create `org-custom-bootstrap.sh` and `org-custom-startup.sh` for organization-wide customizations
- ✅ Create/adjust template repos per type (recommended) so new repos start with CI, CODEOWNERS, and hooks

## The fork-stable surfaces contract

The devenv keeps a deliberately small set of fork-owned surfaces. **Everything inside these surfaces is yours** — change values, add modules, rewrite content. **Everything outside them is upstream-stable**: upstream changes should merge cleanly, and local edits there are maintained at your own cost.

| # | Surface | Path(s) | What a fork changes here |
| - | ------- | ------- | ------------------------ |
| 1 | Data policy (config values) | `devenv.config`, `tools/config/issues-config.yml` | Org identity, provider name, workflow vocabulary, issue types, staleness thresholds, nuget/npm feeds |
| 2 | Behavior policy (policy overrides) | `tools/lib/policy/*.bash` | Org policy decisions as config-driven knobs (`policy_define` accessors) — see the [policy library README](../tools/lib/policy/README.md) for the full knob catalog |
| 3 | Provider modules | `tools/lib/providers/*` | Add or replace per-provider domain modules; set `[provider] name`; manage the token-env allowlist — see the [provider abstraction README](../tools/lib/providers/README.md) |
| 4 | Provider protocol references | `copilot/skills/_shared/references/provider-protocols/<provider>.md` (transport; `github.md` and `azure.md` ship in-tree) and `copilot/skills/_shared/references/protocol-common.md` (provider-neutral wrapper contract — identical for every fork, do not fork-edit) | A fork **authors** its own `<provider>.md` to the fixed three-part structure (credential lifecycle → repo targeting → provider-visible behavior). Agents resolve the filename from `[provider] name` — no file is ever content-swapped |
| 5 | Shared references a fork may re-skin | `copilot/skills/common/references/*.md` (e.g. `issue-creation.md`) | Provider-coupled phrasing inside shared skill references |
| 6 | Knowledge orchestration door | `orchestration.md` at your knowledge repo's content root (repo itself configured via `devenv.config` `[copilot]`) | The door's *contents* are yours: your component taxonomy, read routing, and write placement. The path and required sections are devenv's contract — a fork authors the content, never relocates the file. Omitting it leaves skills running unclassified (they degrade gracefully) |

**One deliberate exception:** `setup` (and the bootstrap flow it feeds) is git-host-oriented by nature. The working assumption is that any fork **rewrites `setup`** rather than adapting it. It is neither fork-stable nor upstream-stable — treat it as fork-replaced, and expect upstream changes to `setup` to need manual reconciliation.

Everything not listed in the table and not named as an exception follows the upstream-stable rule: prefer expressing a difference through a config key, a policy knob, a provider module, or a protocol reference. If none of those fit, raise it upstream — a new override point benefits every fork.

## Provider configuration

The tools layer talks to the git host and work-item provider through an abstraction, not directly. The active provider is a config value:

```ini
[provider]
name=github
```

- **name**: Which module set under `tools/lib/providers/<name>/` answers the `provider_<domain>_<verb>` facade calls. Default `github`; forks adapting to another backend change this key (see [Adapting to Azure DevOps](#adapting-to-azure-devops)).
- **Credentials**: session-scoped token exports are ignored — credentials resolve from the provider credential store. The `[provider] token_env_allowlist` key is not supported: nothing uses it, and the code matches token values rather than variable names (see the [provider abstraction README](../tools/lib/providers/README.md)).

Dispatch is by naming convention with no registry: adding a provider means adding module files — the core never changes. Domain modules and scripts never read token env vars directly; they call `provider_secret_get`, so the credential backing store swaps in behind the seam. Rotation runs through `key-update-provider` (imports via the provider auth seam into the keychain and wires the git credential helper — no token ever lands in env files or remote URLs).

### Capability flags

Providers differ in what they support. GH-only surfaces — rulesets, project boards, native issue types, releases, CI pipelines — are declared capabilities. Modules gate those code paths with `provider_require_capability`, which fails with a defined "provider does not support this" error instead of failing mid-command. A fork's provider module declares the capabilities it honors; scripts degrade or substitute accordingly (labels-based typing instead of native types, for example).

## Adapting to Azure DevOps

The full GitHub-to-Azure translation model (how org, repo, issues, boards and
rulesets map, and the constraints each mapping carries: one Azure project per
org, area path per repo, numbering, releases) lives in the azure provider
directory: [MAPPING.md](../tools/lib/providers/azure/MAPPING.md), versioned with
the code it describes. The provider-neutral contract every provider implements is
[CONTRACT.md](../tools/lib/providers/CONTRACT.md).

| Concept | GitHub | Azure DevOps |
| ------- | ------ | ------------ |
| Project scope | Organization → repos | **Single project** per devenv instance |
| Work item types | Native issue types (Bug/Feature/Task/Epic) | **Type map**: Azure work item types via `[issues]`/`issues-config.yml` values |
| Repo ↔ area | Org-wide area paths | **area path = repo** (one area path per repository) |
| Board states | Project Status field | **Board columns = `status_workflow`**: the `[workflows]` vocabulary drives column names |
| Auth | PAT in keychain via credential helper | **PAT auth**: the same keychain-first seam, with the Azure token store behind `provider_auth_import_token` |

The Azure provider ships in-tree. To move a fork onto it:

1. **Set the provider** and its target in `devenv.config` (the keys are below).
2. **Set up the credential**: run `key-update-azure`.
3. **Prepare the project**: run `azure-setup.sh` (below) against an Agile project.
4. **Replace provider-specific config values**: native type IDs in `issues-config.yml` (GitHub `IT_kwDO…` IDs) and the nuget feed URL (`nuget.pkg.github.com/...`) are GitHub values a fork replaces.
5. **Keep the protocol reference current**: agents resolve `copilot/skills/_shared/references/provider-protocols/<provider>.md` from `[provider] name` (`azure.md` for this provider). The provider-neutral wrapper contract (`protocol-common.md`) covers invocation conventions, targeting, prohibitions and recipes.
6. **Rewrite `setup`** if your intake differs: provider-specific prompts and checks come from the provider's `setup.bash` hooks, so a provider with its own credential flow adds hooks rather than editing `setup`.

### A provider of your own

A provider is a directory `tools/lib/providers/<name>/` of domain modules that answer the `provider_<domain>_<verb>` calls (`issues`, `prs`, `repos`, `pipelines`, `projects`, `org`, …), plus two hook libraries the bootstrap uses:

- `setup.bash`: host-side prompts and checks, sourced by `setup` (bash 3.2 compatible).
- `bootstrap.bash`: container-side hooks the bootstrap calls through `provider_bootstrap_call` (token validation, package feeds, the git auth header, OS packages).

Start from the GitHub or Azure modules, replace the transport, and keep the verbs and shapes in [CONTRACT.md](../tools/lib/providers/CONTRACT.md); the parity test derives from that contract, so a verb added there is checked on every provider. [The providers README](../tools/lib/providers/README.md) lists the hooks.

### Azure DevOps: the REST provider

- **Modules**: `tools/lib/providers/azure/`: `http.bash` (REST transport:
  Basic-auth PAT header, `api-version=7.1`, ContinuationToken pagination,
  429/5xx retry, token redaction), `auth.bash` (PAT file lifecycle), `urls`
  (URL/spec helpers and the gh list-flags helper), `repos`, `issues`, `prs`,
  `pipelines`, `projects` (boards), `policies` (branch policies),
  `releases` (git-tag mapping and Artifacts feeds), `org` (org-level bridge),
  `setup.bash` and `bootstrap.bash` (the hook libraries), plus
  `key-update.sh`, `azure-setup.sh`, `azure-smoke-test.sh` and `MAPPING.md`.
  List and view verbs follow gh's `--json`/`-q` semantics so the shared
  wrappers behave identically under both providers.
- **No `az` CLI dependency**: the transport is curl + jq (both already hard
  dependencies). Nothing new to install on any fork.
- **Config keys** (in `devenv.config` under `[provider]`):
  - `name=azure`: activates the provider modules.
  - `azure_org`: the **organization name**, the subdomain in
    `https://dev.azure.com/{org}/...`. URL-safe characters only: the value
    interpolates into API URLs raw.
  - `azure_project`: the **project name**, not the project ID: the URL
    segment right after the org (`dev.azure.com/{org}/{project}/_git/...`;
    also visible in Project settings → General → Name). The GUID also works
    API-wise and is the fallback when the name contains spaces or special
    characters. The value must agree with your git remotes (`_git` URLs) and
    drives web links.

  ```ini
  [provider]
  name=azure
  azure_org=your-org-name
  azure_project=your-project-name
  ```

- **PAT setup**: run `key-update-azure` (a shell function; the script lives at
  `tools/lib/providers/azure/key-update.sh`). It prompts (hidden input: the
  token never enters chat, shell history or argv) and stores the PAT as a
  **0600 file** in the devenv config area; a piped stdin token also works.
  Scopes needed: Work Items (Read/Write), Code (Read/Write), Build
  (Read/Execute); **Packaging (Read)** additionally for Artifacts feeds
  listing.
- **What differs from GitHub**: work-item states map to the seam's OPEN/CLOSED
  dialect (every stock process template provides those states); status is the
  work item's Kanban column field; labels map to `System.Tags`
  (semicolon-separated); PR rebase-merge is the Azure three-step
  (mergeStrategy PATCH → GET the PR → status=completed + deleteSourceBranch +
  the echoed `lastMergeSourceCommit.commitId`, which is required); pagination
  is ContinuationToken; issue lists are project-scoped (per-repo scoping via
  area paths is a provisioning-only convention, see MAPPING.md); releases
  map to git tags; org rulesets map to per-repo branch policies.
- **Smoke validation** (manual, opt-in, never in CI):
  - *Tier 1, read-only*: `AZURE_SMOKE=1 bash tools/lib/providers/azure/azure-smoke-test.sh`:
    auth, repo list (pagination probe), WIQL, work-item view, PR list.
  - *Tier 2, destructive*: gated behind `AZURE_SMOKE=write` and a disposable
    test project: create/comment/close work items, create and rebase-merge a
    PR. Tokens never appear in output (the transport redacts).
- **One-time project setup**: `AZURE_SETUP=1 bash
  tools/lib/providers/azure/azure-setup.sh [--dry-run]` configures the
  Azure project per MAPPING.md. Before writing anything it checks that the
  project's process is Agile and that the PAT can read what the setup reads
  (a missing write scope shows up as a warning at the first write that needs
  it). It then creates one area path per repo (the per-repo convention; the
  shipped verbs list project-wide), forces the board columns to the
  `[workflows] status_workflow` names and count even when customized, and
  prints the fork's `[provider]` config block. Extra columns are removed; new
  middle columns reuse supported in-progress mappings. Columns that share a
  process state are still distinct statuses (a work item's status is its
  Kanban column field). Setup also sets the default team's Bugs behavior to
  "requirements", so Bugs sit on the Stories board. Existing area paths are
  retained. Idempotent (re-run converges); manual-only, never in CI. Use
  `--dry-run` before applying layout changes.

## Keeping a Soft Fork in Sync and Contributing Back

For an Azure-hosted soft fork, `[fork]` in `devenv.config` records the
fetch-only upstream URL and branch:

```ini
[fork]
upstream_repo=https://github.com/<upstream-org>/devenv.git   # the repository you forked from
upstream_branch=master
```

Run the one-time setup from inside the fork clone. The dry run reports the
remote and push protection without changing `.git/config`:

```bash
fork-setup --dry-run
fork-setup
```

The script adds `upstream` for fetching and sets its push URL to `/dev/null`,
so an accidental push through that remote fails. It does not contact GitHub
or require GitHub credentials.

Run `fork-sync` to fetch upstream and inspect ahead/behind counts and
commit subjects. It does not rebase or push by default. Use `--rebase` only
when ready to replay the current branch on `upstream/<branch>`; if conflicts
occur, resolve them or run the printed `git rebase --abort` command. To update
the same-named branch on `origin`, `--push-to-origin` normally permits only
a fast-forward. If origin contains commits absent locally, the command
refuses unless `--rewrite-origin` is also specified; that path uses
`--force-with-lease` pinned to the fetched origin SHA and can replace those
origin-only commits. A TTY prompts with a default-no choice; scripted runs
must pass `--yes`. Use `--dry-run` to inspect the planned operations without
fetching or changing refs.

```bash
fork-sync --dry-run
fork-sync
fork-sync --rebase
fork-sync --rebase --push-to-origin --yes
```

Before it rewrites anything, `fork-sync` names the local commits that look as if
upstream already has them: a commit whose patch is already on upstream (a rebase
drops it by itself) or one whose subject also appears on upstream since the merge base
(a contribution upstream may have edited, which can conflict on rebase; drop it by hand
if upstream has it).

### What a rebase and push means for the team

The sync model rebases the fork's branch onto upstream and pushes it with
`--force-with-lease`, so the fork's `master` is rewritten on every sync that brings in
upstream changes. Plan for that:

- **Everyone else's clones diverge.** After a rewrite, a teammate's clone has the old
  history and `origin` has the new one. The start-of-shell update check says so ("the
  remote history of master was rewritten") instead of offering a pull.
- **A clone with no local work to keep** resets to the remote:
  `git fetch origin && git reset --hard origin/master`.
- **A clone with local commits** moves them onto the new history:
  `git rebase origin/master`. Commits that were already contributed upstream and came
  back through the sync are dropped by the rebase or show up as conflicts to skip.
- **Do the rewrite deliberately:** one person syncs, tells the team, and pushes with
  `--rewrite-origin`; the lease refuses the push if someone pushed to `origin` in the
  meantime.

To contribute commits to GitHub, use a separate ordinary GitHub clone. By
default, an interactive terminal uses fzf to select the commits to export from
the local-only commits after the upstream merge-base: TAB marks each commit (they
need not be contiguous), the picker previews each one, and the marked commits are
shown for confirmation. Use `--all` to export the entire range without prompting,
or `--start-ref <start> <end>` to select an inclusive range in scripts. The base is
always the merge-base with `upstream/<branch>`. Files are written under
`.local-artifacts/fork-export/<base-short>-<end-short>/`, or
`<base-short>-sel<hash>-<end-short>/` when the export is a subset of the range. `--apply-to` applies
the export directly into a clean sibling clone that shares the upstream
base; no GitHub credentials are used by these scripts. Without `--apply-to`,
the exporter matches `[fork] upstream_repo` against `origin` URLs in immediate
`repos/` clones, ignoring embedded credentials. One match is applied
automatically; multiple matches fail and list candidates, while no match keeps
the artifact-output behavior. Use `--export-only` to force artifact output even
when a matching clone exists. If applying the bundle
or patch series conflicts in an interactive terminal, the exporter waits for
you to resolve and stage the files, then continues the queued operation. In a
non-interactive run it leaves the Git operation intact and prints the matching
`cherry-pick --continue` or `am --continue` command. Successful runs finalize
the complete sequence before returning.

```bash
fork-export
fork-export HEAD~2 --format patch
fork-export --format both
fork-export --apply-to /path/to/github/devenv
```

A range that contains a merge commit is refused with the commit named (rebase the
branch onto upstream with `fork-sync --rebase` first, or pick a range that excludes it).
In the picker an unselected merge commit between selected commits is fine; a selected
merge commit is refused. Patch series are applied with `git am -3`, so context that has
drifted since the fork diverged falls back to a three-way merge instead of failing.

### Commit identity, Fork-Only commits and the skip list

`fork-export` decides what to offer by commit identity, not by patch content:

- **`Change-Id` trailer.** The `prepare-commit-msg` hook (husky) gives every new commit a
  `Change-Id` of 12 random base62 characters. It survives amend, rebase, cherry-pick and
  `format-patch`/`am`, so a commit keeps its identity across rebases and when it lands
  upstream. An existing ID is never replaced. Any `Change-Id` of 8 to 64 characters from
  `A-Za-z0-9._-` (for example a Gerrit ID) also counts as an identity; the hook warns
  once about one that is unusable. CI warns about commits without an ID but does not
  fail them.
- **Commits without an ID are hidden and counted**, so a commit made without the hook
  never goes upstream by accident. `--include-untracked` shows them.
- **`Fork-Only: yes`** in a commit message keeps that commit out of every export. The
  decision travels with the commit, so use it for changes that belong to the fork alone.
- **The skip list** records a decision made after the fact: `--skip <commit>` skips a
  commit for good (stored by Change-Id and SHA), `--unskip <commit-or-change-id>` reverses
  it, and `--list-skipped` lists the entries and drops stale ones. In the picker, ctrl-x
  skips the marked (or highlighted) commits and reopens the picker, and after an export
  the commits you left unselected can be excluded from future exports. The list lives in
  the git directory (`fork-export-skip`), is shared by worktrees, and is local to the
  clone: it is never committed. `--include-skipped` shows skipped commits again.
- **Commits the target already has are not offered again**: by Change-Id, by patch
  equivalence, or because the same commit is in the target's history. Two commits in the
  range sharing a Change-Id are reported, and the ID is not matched against the target
  for them.

A bundle is a transport container: it carries history from the upstream base up to its
endpoints (the newest exported commit of each independent branch), so commits you
skipped in between travel with it. `--apply-to` and the patch format replay exactly the
selected commits; use `--format patch` when only the selected changes may leave the fork.

To contribute selected commits from a branch that also holds fork-only changes, select
them in the picker (or mark the rest `Fork-Only`). Selected commits are applied in
order; if one depends on an omitted change, resolve the cherry-pick conflict when the
exporter pauses. A dry run is available for setup, sync, and export before applying any
operation.

## Keeping a Soft Fork in Sync and Contributing Back

For an Azure-hosted soft fork, `[fork]` in `devenv.config` records the
fetch-only upstream URL and branch:

```ini
[fork]
upstream_repo=https://github.com/workinprogress-ai/devenv.git
upstream_branch=master
```

Run the one-time setup from inside the fork clone. The dry run reports the
remote and push protection without changing `.git/config`:

```bash
bash tools/lib/providers/azure/fork-setup.sh --dry-run
bash tools/lib/providers/azure/fork-setup.sh
```

The script adds `upstream` for fetching and sets its push URL to `/dev/null`,
so an accidental push through that remote fails. It does not contact GitHub
or require GitHub credentials.

Run `fork-sync.sh` to fetch upstream and inspect ahead/behind counts and
commit subjects. It does not rebase or push by default. Use `--rebase` only
when ready to replay the current branch on `upstream/<branch>`; if conflicts
occur, resolve them or run the printed `git rebase --abort` command. To update
the same-named branch on `origin`, `--push-to-origin` normally permits only
a fast-forward. If origin contains commits absent locally, the command
refuses unless `--rewrite-origin` is also specified; that path uses
`--force-with-lease` pinned to the fetched origin SHA and can replace those
origin-only commits. A TTY prompts with a default-no choice; scripted runs
must pass `--yes`. Use `--dry-run` to inspect the planned operations without
fetching or changing refs.

```bash
bash tools/lib/providers/azure/fork-sync.sh --dry-run
bash tools/lib/providers/azure/fork-sync.sh
bash tools/lib/providers/azure/fork-sync.sh --rebase
bash tools/lib/providers/azure/fork-sync.sh --rebase --push-to-origin --yes
```

To contribute commits to GitHub, use a separate ordinary GitHub clone. Export
the local commits as a bundle (default), patch series, or both; the base is
always the merge-base of the selected end ref (default `HEAD`) and
`upstream/<branch>`. Files are written under
`.local-artifacts/fork-export/<base-short>-<end-short>/`. `--apply-to` applies
the export directly into a clean sibling clone that shares the upstream
base; no GitHub credentials are used by these scripts.

```bash
bash tools/lib/providers/azure/fork-export.sh
bash tools/lib/providers/azure/fork-export.sh HEAD~2 --format patch
bash tools/lib/providers/azure/fork-export.sh --format both
bash tools/lib/providers/azure/fork-export.sh --apply-to /path/to/github/devenv
```

An export is a contiguous commit range. To contribute only selected commits
from a branch that also contains local-only changes, create a separate
branch at the fetched upstream base and cherry-pick only the commits to
contribute, in dependency order, then export that branch:

```bash
bash tools/lib/providers/azure/fork-sync.sh
git switch -c contribute-upstream upstream/master
git cherry-pick <commit-to-contribute-1> <commit-to-contribute-2>
bash tools/lib/providers/azure/fork-export.sh --format bundle
```

This leaves the original local branch unchanged and exports a new contiguous
series based on upstream. If a selected commit depends on omitted changes,
adapt it or resolve the cherry-pick conflict before exporting. A dry run is
available for setup, sync, and export before applying any operation.

## Copilot Instructions

The file `copilot/copilot-instructions.md` contains AI coding guidelines that apply to the repository in VS Code (GitHub Copilot reads this file automatically when it exists in the workspace). During bootstrap, `~/.copilot/copilot-instructions.md` is **symlinked** to this file, making the same instructions available as the user-level Copilot instructions file.

When forking, you have two options:

1. **Write your own instructions in-place** — update `copilot/copilot-instructions.md` directly with your organization's conventions, code style, and AI guidance. Bootstrap will symlink it to `~/.copilot/copilot-instructions.md` automatically.

2. **Symlink to a different file** — if you prefer to keep your Copilot instructions elsewhere (e.g. in a shared config repo or a different path), create `~/.copilot/copilot-instructions.md` as a symlink to that file before or after bootstrap runs. The `install_copilot_instructions` task will detect the existing symlink and leave it untouched, regardless of where it points.

## Copilot Skills

This repository ships with a suite of slash-command skills that cover the full development lifecycle — from issue triage through PR review. They live in `copilot/skills/` and are invoked with `/skill-name` in Copilot Chat. The full catalog lives in [docs/Skills.md](./Skills.md); it is the source of truth for what ships, so this guide intentionally does not repeat a count.

See [docs/Skills.md](./Skills.md) for the full catalog and decision tree.

### Adding a custom skill

1. **Read the conventions** — `copilot/skills/_conventions.md` defines the required file layout, frontmatter fields, description rules (lint-skills warns over 1200 characters and fails over 2000 — keep it well under), section ordering, and confirmation-flow patterns.

2. **Create the skill folder and SKILL.md**:

   ```text
   copilot/skills/<your-skill-name>/
   └── SKILL.md
   ```

   The folder name must match the `name:` field in the YAML frontmatter exactly.

3. **Write the description carefully** — it is the only signal Copilot uses to decide whether to auto-load the skill. Include explicit `USE WHEN` and `DO NOT USE FOR` clauses with the exact phrases users will say. Verify the length:

   ```bash
   awk '/^description:/ {gsub(/^description: */,""); print length}' copilot/skills/<name>/SKILL.md
   ```

4. **Register the skill for `/devenv-help` discoverability** — append a row to the appropriate category table in `copilot/skills/devenv-help/references/skills-registry.md`. This is the single file the `devenv-help` routing skill reads; without an entry here, the skill won't be surfaced when users ask "which skill should I use".

   Each row needs: skill name (with `/`), one-line purpose, 2–4 USE WHEN trigger phrases, and a NOT FOR clause.

5. **Add a "Sibling skills" section** at the bottom of your SKILL.md linking back to [docs/Skills.md](./Skills.md). Then add a row for the new skill to the appropriate table in `docs/Skills.md` so it appears in the human-readable catalog.

6. **Reload VS Code** (or run "Developer: Reload Window") for the new slash command to appear in Copilot Chat.

### Adding optional reference files

If your skill needs reusable artifacts (templates, cheatsheets, phrasing tables), put them in a `references/` subfolder:

```text
copilot/skills/<your-skill-name>/
├── SKILL.md
└── references/
    └── my-template.md
```

The agent loader walks one level deep only — do not nest further. See `_conventions.md` for guidance on what belongs in `references/` vs. inline in `SKILL.md`.

## Organization-Level Custom Scripts

For organization-wide customizations that should apply to all developers, create these scripts in `.devcontainer/`:

### org-custom-bootstrap.sh

Runs during container creation/bootstrap. Use this for:

- Installing organization-specific tools and dependencies
- Configuring company-wide settings
- Setting up organization-specific certificates or credentials
- Initializing shared development services

**Example:**

```bash
#!/bin/bash
set -euo pipefail

# Install organization-specific tools
echo "Installing company tools..."
sudo apt-get install -y custom-company-tool

# Configure organization settings
echo "Configuring company defaults..."
git config --global url."https://github.com/your-org/".insteadOf "https://gh/"
```

### org-custom-startup.sh

Runs each time VS Code starts. Use this for:

- Starting organization-specific services
- Validating required environment setup
- Displaying organization-specific welcome messages
- Connecting to shared development resources

**Example:**

```bash
#!/bin/bash
set -euo pipefail

echo "🏢 Welcome to YourOrg Development Environment"

# Start organization services if needed
if ! docker ps | grep -q company-service; then
    echo "Starting company service..."
    docker-compose -f $DEVENV_ROOT/.devcontainer/company-services.yml up -d
fi
```

**Important:** These scripts should be committed to the repository so all team members benefit from the customizations.

## Adding and overriding tools (`tools/fork/` and `tools/custom/`)

The tools you call by bare name (`issue-get`, `fork-sync`, ...) are stubs in
`tools/`, each one pointing at a script. Three folders feed them, and a file with the
same name in a higher folder replaces the one below it:

| Folder | Who owns it | Committed? | Precedence |
|---|---|---|---|
| `tools/custom/` | one user, on one machine | no (gitignored) | highest |
| `tools/fork/` | the fork, for everyone on it | yes | middle |
| `tools/scripts/` | the provided tools (upstream) | yes | lowest |

- **Add a tool:** put `my-tool.sh` in `tools/fork/` (for the whole fork) or
  `tools/custom/` (for you only). It gets a `my-tool` stub like any provided tool.
- **Override a tool:** give your file the same name as the provided one
  (`tools/fork/issue-get.sh` replaces `tools/scripts/issue-get.sh`). The stub then runs
  yours. Remove the file and the stub points back at the next folder down.
- **Re-run the sync after adding or removing a file.** Each stub is written at sync
  time and names the winning file, so the change shows up after
  `entry-stubs-sync` runs. Bootstrap runs it; run it yourself to see a change at once.
- **Underscore-prefixed scripts cannot be overridden this way.** Scripts such as
  `_on_begin_review.sh` have no stub (they are called by path), so a copy in `tools/fork/`
  or `tools/custom/` is never picked up.
- A script in `tools/fork/` or `tools/custom/` follows the same conventions as a
  provided tool ([Tooling Standards](./Tooling-Standards.md)): the self-root header,
  `--help`, and tests for anything non-trivial.

Keep an override small. The provided tool keeps receiving upstream changes that your
copy does not, so prefer a config key or a policy knob (see
[What stays upstream](#what-stays-upstream)) when the surfaces can express the difference.

## User-Level Customizations

Individual developers can add their own customizations using:

- `user-custom-bootstrap.sh` - Personal bootstrap customizations (not committed)
- `user-custom-startup.sh` - Personal startup customizations (not committed)

Use the helper scripts to add commands:

```bash
devenv-add-custom-bootstrap "your-command"
devenv-add-custom-startup "your-command"
```

## Configuring within the surfaces: devenv.config reference

This section is the reference for the config keys a fork most commonly changes. Surface #1 of the contract — everything here is a data value, not code.

Edit `devenv.config` in the root directory:

### [organization]

```ini
[organization]
name=YourOrg
org=your-org
email_domain=yourorg.com
```

- **name**: Organization name (for docs/branding)
- **org**: Neutral org key — Git host org/user used for cloning and feeds
- **email_domain**: Enforced commit email domain (empty = any valid email)

### [workflows]

```ini
[workflows]
status_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production
# Staleness thresholds (days) for the board skill (/devenv-board) Assess/Recommend passes.
stale_to_groom_days=14
stale_ready_days=21
stale_implementing_days=30
stale_tbd_days=7
```

- **status_workflow**: The issue status vocabulary, ordered. Everything downstream — project boards, the workflow engine, `workflow-signal`, parent status rollup — reads this single key.
- **stale_to_groom_days**: How long an issue may sit in `To-Groom` before `/devenv-board` flags it as stale (Assess findings, grooming-candidate recommendations).
- **stale_ready_days**: Inactivity threshold for `Ready` items (ready but nobody picking them up).
- **stale_implementing_days**: Inactivity threshold for in-flight items (`Implementing`, `Review`-adjacent work that has gone quiet).
- **stale_tbd_days**: How long an untriaged `TBD` issue may wait before it surfaces in hygiene sweeps.

All four are read via `config-read workflows <key>` — never hard-coded in skills. Tune per org; the defaults fit a two-week delivery cadence.

This is **not a free-form list**: the engine derives behavior from the vocabulary's shape. If you customize it, keep the contract:

1. **Two ordered halves.** Workflow states first (planning and implementation states), delivery states after (merge/deploy states). The split is the delivery boundary.
2. **`Implementing` is the load-bearing boundary token.** The engine locates the delivery boundary by looking up `Implementing` in this list — it drives the rollup floor (pre-delivery children of an active parent count as Implementing) and the "workflow states cannot be forced" gate. Keep the token name, or update both lookups in `tools/lib/workflow-core.bash`.
3. **`TBD` and `Ready` are the birth tokens.** New issues are born at `TBD`; a Task created under a parent is born `Ready`. Renaming either requires updating the birth rule in `tools/scripts/issue-create.sh`.
4. **`tools/config/skill-events.yml` names statuses too.** Every event's `status:` value must exist in `status_workflow` — rename there in the same change or signals will write statuses no board defines.

Safe rename/reorder procedure:

1. Edit `status_workflow` in `devenv.config`.
2. Update the matching `status:` values in `tools/config/skill-events.yml`.
3. If you renamed `Implementing`, `Ready`, or `TBD`, update the boundary lookups in `tools/lib/workflow-core.bash` and the birth rule in `tools/scripts/issue-create.sh`.
4. Migrate live board cards to the new names (project fields hold the old strings — the engine treats foreign values as unreadable).
5. Run the test suites (`bats tools/tests/lib tools/tests/scripts`) — the workflow suites fail loudly on contract breaks.
6. Re-write [Issue Workflow](./Issue-Workflow.md) to reflect the updated status workflow.

Do not duplicate states, and do not interleave the two halves — status derivation (minimum-state rollup) is order-sensitive by design. The semantics each state carries, and what moves a card, are documented in [Issue Workflow](./Issue-Workflow.md); that guide is the model, this section is only the customization contract.

### [copilot]

```ini
[copilot]
knowledge_repo=https://github.com/<your-org>/docs.copilot-knowledge.git   # ← your fork's repo
knowledge_subpath=copilot-knowledge/
engineering_repo=https://github.com/<your-org>/docs.engineering.git       # ← your fork's repo
engineering_repo_name=docs.engineering
```

- **knowledge_repo**: Git repository URL for shared Copilot knowledge assets.
- **knowledge_subpath**: Folder inside that repository that should be linked to `~/.copilot/knowledge`.
- **engineering_repo**: Git repository URL for the engineering standards repo — imported with the same bootstrap/container-start machinery as knowledge, canonical copy at `copilot/engineering/`, linked to `~/.copilot/engineering`. Skills read it through the link; modifications happen in `repos/docs.engineering/` via branches/PRs. Forks may point it at their own standards repo without editing any skill. See [Knowledge & Engineering Patterns](./Knowledge-and-Engineering-Patterns.md).
- **engineering_subpath**: Folder inside the engineering repo to link as `~/.copilot/engineering` (empty = repo root).
- **engineering_repo_name**: Short repo name for the engineering clone (must stay in sync with `engineering_repo`; the URL is passed straight to `git clone`).

Behavior:

- During bootstrap, devenv clones or pulls `knowledge_repo` into `copilot/knowledge` using credentials resolved through the provider secret seam (keychain-first; no token is exported into the environment).
- It then symlinks `~/.copilot/knowledge` to `copilot/knowledge/<knowledge_subpath>`.
- During `devenv-update`, devenv refreshes that repo and updates the symlink target automatically.
- On container start, devenv runs a non-blocking pull for `copilot/knowledge` (when it is a git repo) via `pull_copilot_knowledge_on_container_start` in `tools/lib/copilot-knowledge.bash`.

These three keys wire the whole repo constellation — the machine-managed knowledge clone, its `repos/` modification workspace, and the engineering-standards clone. For the full relationship map (who manages which copy, what refreshes when, where edits go), see [How devenv relates to the sub-repos](./Knowledge-and-Engineering-Patterns.md#how-devenv-relates-to-the-sub-repos).

## Repo Creation Standards (repo-create.sh)

> **Provider capability note:** rulesets, templates, merge-button control, Discussions, and most of the toggles below are GitHub-provider capabilities (gated by `provider_require_capability` in the modules). A fork on a provider without them either substitutes (Azure branch policies for rulesets) or leaves them unset — creation degrades with a warning, not a failure.

If you use `tools/scripts/repo-create.sh`, configure `tools/config/repo-types.yaml`:

### Configuration per type

- **Naming**: `naming_pattern` and `naming_example` per type (e.g., `service.<category>.<descriptor>`, `gateway.<category>.<descriptor>`, `app.web.<descriptor>`, `lib.<language>.<category>.<descriptor>`)
- **Templates**: `template` per type (or null) to pre-bake CI, CODEOWNERS, and .repo scripts
- **Template marking**: `isTemplate` (boolean, default: false) marks the repository as a template, making it available for use with the provider's "use as template" flow
- **Post-creation**: `post_creation_script`, `delete_post_creation_script`, and `post_creation_commit_handling` (`none|amend|new`)
- **Merge types**: `allowedMergeTypes` - Controls which merge buttons appear in the provider's PR UI (merge|squash|rebase)
  - This is a repository-level setting that applies globally
  - Should match the ruleset's `allowed_merge_methods` for consistency
  - Both settings work together: this controls UI, ruleset enforces on protected branches
  - Org policy: rebase-only ([Commit Conventions](./Commit-Conventions.md)) — every type's `allowedMergeTypes` is `[rebase]`
- **PR branch deletion**: `deletePRBranchOnMerge` (boolean, default: true) - Automatically delete PR branches after merge
- **Wiki**: `hasWiki` (boolean, default: false) - Enable/disable the Wiki feature
  - Set to `true` for documentation repositories where you want a wiki
  - Most code repositories should keep this disabled to avoid confusion with repository documentation
- **Issues**: `hasIssues` (boolean, default: true) - Enable/disable the Issues tab
  - Set to `false` for template repositories since they shouldn't track issues
  - Keep enabled for active development repositories
- **Discussions**: `hasDiscussions` (boolean, default: false) - Enable provider-hosted Discussions
  - Useful for community-driven projects or public repositories
  - Provides a forum-like space separate from issues
- **Projects**: `hasProjects` (boolean, default: false) - Enable the Projects tab visibility
  - Controls whether the "Projects" tab appears in the repository navigation
  - Note: This only affects visibility/convenience - issues can be added to provider Projects regardless of this setting
  - Disable if using external project management tools (Jira, Azure DevOps, etc.) or want to reduce tab clutter
  - Enable only if your team actively uses provider Projects and wants easy access from the repo interface
- **Auto-merge**: `allowAutoMerge` (boolean, default: true) - Allow auto-merge on pull requests
  - Enables automation workflows to merge PRs after checks pass
  - Useful for Dependabot and other automated updates
- **Update branch**: `allowUpdateBranch` (boolean, default: true) - Show "Update branch" button on PRs
  - Allows contributors to easily update their PR branch with latest changes from base branch
  - Recommended for most repositories to keep PRs current
- **Forking**: `allowForking` (boolean, default: false for code, true for templates) - Allow others to fork the repository
  - Enable for template repositories so others can use them
  - Keep disabled for private/internal code repositories
- **Squash commit title**: `squashMergeCommitTitle` (string, default: PR_TITLE) - Format for squash merge commit titles
  - `PR_TITLE` - Use the pull request title as the commit title
  - `COMMIT_OR_PR_TITLE` - Use the first commit message title or PR title (the provider's original default)
- **Squash commit message**: `squashMergeCommitMessage` (string, default: COMMIT_MESSAGES) - Format for squash merge commit message body
  - `PR_BODY` - Use the pull request description
  - `COMMIT_MESSAGES` - Use all commit messages from the PR (preserves commit history in message)
  - `BLANK` - No commit message body (clean single-line commits)
- **Provider UI mapping** for squash merge settings:
  - "Use PR title": `title=PR_TITLE, message=BLANK`
  - "Use PR title and commit details": `title=PR_TITLE, message=COMMIT_MESSAGES` (default)
  - "Use PR title and description": `title=PR_TITLE, message=PR_BODY`
  - "Default message": `title=COMMIT_OR_PR_TITLE, message=COMMIT_MESSAGES`
- **Rulesets** (GitHub capability: Pro/public repos only; see the capability note above):
  - `rulesetConfigFile`: Path to JSON ruleset file in `tools/config/` (e.g., `ruleset-default.json`)
  - Set to `null` or blank to disable rulesets for a type
  - JSON file is a provider ruleset export (GitHub ruleset export today) with token placeholders: `{{repo_name}}`, `{{owner}}`, `{{type_name}}`, `{{type_description}}`
  - Ruleset can also specify `allowed_merge_methods` for protected branches (more restrictive than repo-level setting)
- **Access**: `access` - List of teams or users with their permission levels (optional)
  - If not specified, no default permissions are applied (repository uses organization defaults)
  - Each entry contains:
    - `name`: Team or user name (provider team slug or username)
    - `type`: `team` or `user` (default: team)
    - `permission`: Provider repository permission level:
      - `pull` (Read) - Can pull/clone, open issues, and comment
      - `triage` (Triage) - Can manage issues/PRs without write access
      - `push` (Write) - Can push, create branches, and manage issues/PRs
      - `maintain` (Maintain) - Push + manage releases and some settings
      - `admin` (Admin) - Full access including settings, webhooks, and team management
  - Applied automatically during repository creation and when running `repo-update-config`

#### Ruleset JSON tokens

Your ruleset JSON file can use these tokens, which are replaced during application:

- `{{repo_name}}` - Full repository name (e.g., `service.platform.identity`)
- `{{owner}}` - Organization/owner name
- `{{type_name}}` - Repository type (e.g., `service`, `documentation`)
- `{{type_description}}` - Type description from config

## Issue Types Configuration (issue-create.sh)

> **Provider capability note:** native issue types are a GitHub-provider capability (`native-issue-types`). A fork without the capability runs the same type vocabulary as labels via the `[issues] types` policy knob — see the [policy library README](../tools/lib/policy/README.md). The `IT_kwDO…` IDs and the GraphQL discovery recipe in `issues-config.yml`'s header are GitHub-specific values.

The `issue-create.sh` tool supports native issue types on providers that declare the capability. Issue types are configured in `tools/config/issues-config.yml`, which is the single source of truth for type names, descriptions, and provider API IDs.

Type names are **load-bearing** for the workflow model: Features and Bugs are deliverables, Tasks are work toward someone else's change (the only type that nests, and the only one born `Ready` under a parent — `issue-create.sh` string-matches `Task` for that birth rule), and Epics group deliverables. Keep these four names, or update the birth rule and the `planning.type_mapping` consumers when renaming. See [Issue Workflow](./Issue-Workflow.md) for the roles.

### Configure Issue Types

Edit `tools/config/issues-config.yml` to define your organization's issue types:

```yaml
types:
  - name: Bug
    description: "A bug or defect that needs fixing"
    id: "IT_kwDOCk-E0c4BWVJJ"
  
  - name: Feature
    description: "A new feature or enhancement"
    id: "IT_kwDOCk-E0c4BWVJK"
  
  - name: Task
    description: "A task or work item"
    id: "IT_kwDOCk-E0c4BWVJI"
```

Each entry needs:

- **name**: The issue type name (displayed in the provider UI and used for validation)
- **description**: Human-readable description for users selecting a type
- **id**: Provider organization-level issue type ID (required for setting types via API; GitHub `IT_kwDO…` IDs today)

### Getting Your Organization's Issue Type IDs (GitHub-native path)

Get the IDs from your GitHub organization using the workspace wrapper (one-time setup inspection — day-to-day issue operations always go through the `issue-*` tools):

```bash
issue-types --format json
```

### Syncing with GitHub Organization Settings (GitHub-native path)

To add or modify issue types in GitHub:

1. Go to your **GitHub Organization Settings**
2. Navigate to **Planning** section
3. Click on **Issue types**
4. From there, you can:
   - **Create** new issue types
   - **Edit** existing ones (name, icon, description)
   - **Disable/Delete** issue types you no longer need

After making changes in GitHub:

1. Get the updated IDs using the CLI command above
2. Update `tools/config/issues-config.yml` with the new types and IDs

### Example: Custom Issue Types

```yaml
types:
  - name: Bug
    description: "Production bug or critical issue"
    id: "IT_kwDOXXXXXXXXXXXXX1"
  
  - name: Enhancement
    description: "New feature or improvement"
    id: "IT_kwDOXXXXXXXXXXXXX2"
  
  - name: Documentation
    description: "Documentation or tutorial"
    id: "IT_kwDOXXXXXXXXXXXXX3"
  
  - name: Spike
    description: "Research task or investigation"
    id: "IT_kwDOXXXXXXXXXXXXX4"
```

Note: Replace the `id` values with your actual organization's issue type IDs from the provider.

### Planning Type Mapping

The `planning` section in `issues-config.yml` maps concepts from a specifications document to issue types (GitHub native types on the GitHub-native path). This is used when creating issues from a specifications document to determine which issue type to assign for each level of the document hierarchy.

```yaml
planning:
  type_mapping:
    phases: Epic
    features: Feature
    tasks: Task
```

Each key under `type_mapping` corresponds to a concept in a specifications document:

- **phases**: High-level project phases, mapped to an issue type (default: `Epic`). Note the workspace convention: Epic means a long-lived orchestration issue coordinating multiple repos/efforts — for single-repo deliverable phases, map `phases` to `Feature` instead.
- **features**: Feature-level items, mapped to an issue type (default: `Feature`)
- **tasks**: Individual work items, mapped to an issue type (default: `Task`)

### Example configuration

```yaml
service:
  description: Backend microservices
  template: template.service
  naming_pattern: '^service\.[a-z0-9-]+\.[a-z0-9-]+$'
  naming_example: "service.platform.identity"
  mainBranch: master
  allowedMergeTypes:
    - rebase
  rulesetConfigFile: ruleset-default.json
  post_creation_script: ".repo/post-create.sh"
  access:
    - name: Engineering
      type: team
      permission: push
    - name: DevOps
      type: team
      permission: admin
```

### Example ruleset JSON (ruleset-default.json)

```json
{
  "name": "{{repo_name}} Protection Ruleset",
  "target": "branch",
  "source": "{{owner}}/{{repo_name}}",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "require_code_owner_review": true
      }
    },
    {
      "type": "required_linear_history"
    }
  ]
}
```

**To create a ruleset JSON:**

1. Configure a ruleset manually in the provider UI (GitHub UI today)
2. Export it via the workspace wrapper: `policy-export <RULESET_ID> --output <file>` (list IDs first with `policy-export`)
3. Save to `tools/config/your-ruleset.json`
4. Replace hardcoded values with tokens (`{{repo_name}}`, `{{owner}}`, etc.)
5. Reference the filename in `rulesetConfigFile` property

### Tip

Keep a lightweight template repo for each type so new repos start with pipelines, CODEOWNERS, and `.repo/` hooks already in place.

## devenv.config Examples

### Small Startup

```ini
[organization]
name=Acme Corp
org=acme-corp
email_domain=acme.com

[workflows]
status_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged
```

### Enterprise Organization

```ini
[organization]
name=Mega Corp
org=mega-corp-dev
email_domain=megacorp.com

[workflows]
status_workflow=TBD,To-Groom,Ready,Implementing,Review,Testing,Merged,Staging,Production
```

## Adding New Tools and Libraries

This section explains the conventions for adding new scripts, bash libraries, and categories of tooling so that all contributions stay consistent and discoverable.

### Adding a new bash library

Libraries live in `tools/lib/` and are sourced by scripts at runtime via `$DEVENV_TOOLS/lib/<name>.bash`. Follow these conventions:

For the current shared-library catalog, see [Additional Tooling](./Additional-Tooling.md#shared-bash-libraries).

1. **File name**: `tools/lib/<category>.bash` using lowercase hyphenated names, e.g. `markdown.bash`.
2. **Guard against double-sourcing** at the top:

   ```bash
   if [ -n "${_MARKDOWN_LOADED:-}" ]; then return 0; fi
   _MARKDOWN_LOADED=1
   ```

   Use `_<NAME_UPPERCASED>_LOADED` as the guard variable name.
3. **Source dependencies explicitly** using the same guard pattern, loading from `$DEVENV_TOOLS/lib/`:

   ```bash
   if [ -z "${_ERROR_HANDLING_LOADED:-}" ] && [ -f "${DEVENV_TOOLS}/lib/error-handling.bash" ]; then
       source "${DEVENV_TOOLS}/lib/error-handling.bash"
   fi
   ```

4. **Function naming**: follow `snake_case` with clear verb prefixes (`get_`, `validate_`, `set_`, `find_`, etc.). For library functions, add a namespace prefix that matches the library name, e.g. `validate_plan_task_number`, `set_plan_task_complete`.
5. **Document every public function** with a Usage/Arguments/Returns block comment.
6. **Write tests** in `tools/tests/lib/test_<name>.bats`. Libraries are fully tested — every public function should have tests covering success paths, failure paths, and edge cases. Run with `bats tools/tests/lib/test_<name>.bats`.

### Adding a new script

Scripts live in `tools/scripts/<name>.sh`. Depth-1 entries at `tools/<name>` (without the `.sh` extension) are generated — not hand-made: `.devcontainer/entry-stubs-sync.sh` (run by bootstrap and by the test runner) creates a stub for every `tools/scripts/` script except underscore-prefixed internal scripts (`_*.sh` get no depth-1 entry — call them via their `tools/scripts/` path). Never hand-edit or hand-create a stub.

1. **Start from the template**: `tooling-create-script <name>` scaffolds the file from `tools/templates/script-template.sh`.
2. **File location**: `tools/scripts/<group>-<action>.sh`, following the existing `group-action` naming pattern (e.g. `markdown-plan-complete-task.sh`).
3. **Entry point**: none needed by hand — run `.devcontainer/entry-stubs-sync.sh` (or bootstrap) and the `tools/<name>` stub is generated automatically. A fork's own tool goes in `tools/fork/` instead, and a machine-local one in `tools/custom/` (see [Adding and overriding tools](#adding-and-overriding-tools-toolsfork-and-toolscustom)).

4. **Standard structure** (in order):
   - Shebang + header comment (name, version, description, specifications)
   - `source "$DEVENV_TOOLS/lib/error-handling.bash"` and `source "$DEVENV_TOOLS/lib/versioning.bash"`
   - `enable_strict_mode`
   - `SCRIPT_VERSION` and `SCRIPT_NAME` constants
   - Additional library sources
   - Global variables
   - `show_usage()` function with `--help` support
   - `parse_args()` function
   - Helper functions
   - `main()` function called at the end
5. **Always implement `--help` and `--version`**: define `show_usage` and `SCRIPT_VERSION`, and call `handle_global_flag "${1:-}"` first in `main()` (before any validation or authentication) so both flags answer without a provider session. Keep the `# Version:` header equal to `SCRIPT_VERSION` — a test checks it.
6. **Tests**: test scripts according to their impact, complexity, and criticality. Script tests go in `tools/tests/scripts/`.

### Adding a new tool category

When adding a group of related tools (e.g. `markdown-*`), follow these steps:

1. Create the bash library at `tools/lib/<category>.bash` following the conventions above.
2. Create scripts in `tools/scripts/<category>-<action>.sh`.
3. Create symlinks in `tools/` for each script.
4. Write library tests in `tools/tests/lib/test_<category>.bats`.
5. If any third-party packages are required (e.g. Python packages via `pip`, Node packages via `pnpm`), install them in `.devcontainer/bootstrap.bash` inside the appropriate `install_*` function so the dependency survives container rebuilds.
6. Document the new tools in `docs/Additional-Tooling.md` under an appropriate section heading, following the existing format (usage, options, examples, features).

### Third-party dependencies

If a script requires an external tool not already present in the environment:

- **OS packages** (`apt`): add to `install_os_packages_round1` or `install_os_packages_round2` in `.devcontainer/bootstrap.bash`.
- **Node packages** (`npm`/`pnpm`): add to `install_node_packages` in `.devcontainer/bootstrap.bash`.
- **Python packages** (`pip`): add an `install_python_packages` function (or extend an existing one) in `.devcontainer/bootstrap.bash` and call it from `main`.
- **dotnet tools**: add alongside the existing `dotnet tool install` calls in `.devcontainer/bootstrap.bash`.

Always check for the tool's presence before installing (see the `yq` install pattern for an example of idempotent install logic).

---

## What stays upstream

The [fork-stable surfaces contract](#the-fork-stable-surfaces-contract) at the top of this guide is the authoritative list of what you may change freely. Everything outside it — test infrastructure, error-handling libraries, git configuration helpers, version comparison logic, core script templates, the bootstrap framework, and the tooling library structure — is upstream-stable: keep it unmodified and upstream improvements keep flowing to your fork with minimal conflict.

When you need a difference the surfaces can't express, add an override point (a policy knob, a config key, a capability gate) and contribute it upstream — a new override point benefits every fork.

## Advanced Customization

For deeper bootstrap tweaks, see [Bootstrap-Customization.md](./Bootstrap-Customization.md) (modular tasks, overrides, env-based flows).

## Contributing Improvements Back

1. Fork the main devenv repository
2. Create a feature branch
3. Make your improvements
4. Ensure all tests pass (`bash tools/tests/run-devenv-tests.sh`)
5. Submit a pull request

See the [Tooling Standards](./Tooling-Standards.md) guide for the testing and linting bar your changes must meet.

## Getting Help

- Check the `docs/` folder for feature-specific topics
- Review test files in `tools/tests/` for usage examples
