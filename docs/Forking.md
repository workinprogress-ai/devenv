# Forking Guide

If you've forked this repository for your organization, this guide tells you what you may change safely, what you must override deliberately, and how to adapt the environment to a different git/work-item provider — Azure DevOps first among them. The devenv separates *what a fork decides* (values in config, policy modules, provider modules, protocol references) from *how the tooling works* (everything else), so upstream changes keep merging with minimal conflict.

The essentials live in `devenv.config`; repository-creation standards live in `tools/config/repo-types.yaml`; issue-type vocabulary lives in `tools/config/issues-config.yml`; provider behavior lives in `tools/lib/providers/<provider>/`.

## Quick Checklist

- ✅ Read [The fork-stable surfaces contract](#the-fork-stable-surfaces-contract) below — it defines what you may change without carrying maintenance burden
- ✅ Update `devenv.config` for org identity (`org` key), provider name, container name, workflows, and bootstrap defaults
- ✅ (If you customize the issue workflow) Read [Issue Workflow](./Issue-Workflow.md) first — the `[workflows]` vocabulary carries engine contracts, documented in its Workflow customization section. The contract: config renames the board column names (with `tools/config/skill-events.yml` updated in the same change); redesigning the workflow itself — reordering, adding/removing states, changing phases — is a fork of the skills, and you will need to re-write the skill prose to match.
- ✅ (If you use issue creation tooling) Update `tools/config/issues-config.yml` with your organization's issue types
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
| 2 | Behavior policy (policy values) | `devenv.config` `[workflows]` and `[organization]` keys, `tools/config/*.yml` | Org policy decisions as config values the TypeScript tools read directly (delivery boundary token, status fallback, labels, event statuses) — see the [policy library README](../tools/lib/policy/README.md) for where each decision lives |
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
# token_env_allowlist=  # escape hatch: space-separated env-var names honored
                         # as token sources despite the keychain-first policy
```

- **name**: Which module set under `tools/lib/providers/<name>/` answers the facade calls (`prsMerge`, `issuesEdit`, ...). Default `github`; a name that is not shipped is an error, never a silent fallback. Forks adapting to another backend change this key (see [Adapting to Azure DevOps](#adapting-to-azure-devops)).
- **token_env_allowlist**: Session-scoped token exports are ignored by default — credentials resolve env-if-allowlisted → keychain → error. The allowlist holds env-var **names**, space-separated, each optionally with a reason: `GH_TOKEN` or `GH_TOKEN:ci-feed`. A listed variable is honored; an entry that is not a variable name (for example a token value) never matches. Under `[provider] name=azure` the GitHub token variable `GH_TOKEN` is not a token source at all, listed or not. The allowlist ships empty; add entries only with a documented justification (see the [provider abstraction README](../tools/lib/providers/README.md)).

Tools never call a provider module directly: they import the TypeScript facade (`tools/lib/providers/facade/<family>.ts`), which loads the active provider's modules from a manifest. Adding a provider means adding module files and manifest rows, as listed in [Adding a provider](../tools/lib/providers/README.md#adding-a-provider). Tools and domain code never read token env vars directly; credentials resolve through the provider's auth module, so the credential backing store swaps in behind the seam. Rotation runs through `key-update-provider` (imports through the provider auth layer into the keychain and wires the git credential helper — no token ever lands in env files or remote URLs). The only bash in the provider layer is the container bootstrap surface (auth, setup and bootstrap hooks); the providers README documents it under [Bash bootstrap surface](../tools/lib/providers/README.md#bash-bootstrap-surface).

### Capability flags

Providers differ in what they support. GH-only surfaces — rulesets, project boards, native issue types, releases, CI pipelines — are declared capabilities. Tools gate those code paths with `requireFamilyCapability` (which ends in `providerRequireCapability`), and a provider that lacks the capability fails with a defined "provider does not support this" error instead of failing mid-command. A fork's provider module declares the capabilities it honors with `providerDeclareCapability` (the canonical list is `PROVIDER_CAPABILITY_CANONICAL` in `provider-core.ts`); scripts degrade or substitute accordingly (labels-based typing instead of native types, for example).

## Adapting to Azure DevOps

The full GitHub→Azure translation model — how org/repo/issues/boards/
rulesets map, and the constraints each mapping carries (one Azure project
per org, area path per repo, numbering, releases) — lives in the azure
provider directory: [MAPPING.md](../tools/lib/providers/azure/MAPPING.md)
(durable provider documentation, versioned with the code it describes).

The ADO path follows the fixed minimal mapping from the provider-agnostic effort (epic #29, slice 7):

| Concept | GitHub (as-built) | Azure DevOps mapping |
| ------- | ----------------- | -------------------- |
| Project scope | Organization → repos | **Single project** per devenv instance |
| Work item types | Native issue types (Bug/Feature/Task/Epic) | **Type map**: ADO work item types via `[issues]`/`issues-config.yml` values |
| Repo ↔ area | Org-wide area paths | **area-path = repo** (one area path per repository) |
| Board states | Project Status field | **board columns = `status_workflow`** — the `[workflows]` vocabulary drives column names |
| Auth | PAT in keychain via credential helper | **PAT auth** — same keychain-first seam, the PAT stored by the Azure auth module (`azure/auth.ts`) |

Procedure:

1. **Author the protocol reference** — write `copilot/skills/_shared/references/provider-protocols/<provider>.md` to the fixed three-part structure (credential lifecycle → repo targeting → provider-visible behavior), using `azure.md` as the freshest example and `github.md` for the GitHub entries. The provider-neutral wrapper contract (`protocol-common.md`) already covers invocation conventions, targeting chain, prohibitions, and recipes — cite it, don't duplicate it. Agents resolve the filename from `[provider] name`; skill bodies never change.
2. **Add provider modules** — create `tools/lib/providers/ado/` with one TypeScript module per family it supports (`issues`, `prs`, `repos`, `pipelines`, …) implementing the verbs in [CONTRACT.md](../tools/lib/providers/CONTRACT.md). Start from the GitHub or Azure modules as templates; replace the transport, keep the function signatures. Register the modules in `FAMILY_MANIFEST` and the facades as described in [Adding a provider](../tools/lib/providers/README.md#adding-a-provider), and add the thin bash bootstrap hooks that section lists.
3. **Flip the config key** — set `[provider] name=ado` in `devenv.config`.
4. **Map the capabilities** — decide which GH-only capabilities your ADO setup substitutes: rulesets → ADO branch policies, project boards → board columns over `status_workflow`, native issue types → ADO work item type map. Gate what you don't support; degrade what you substitute.
5. **Replace provider-specific config values** — the nuget feed URL (`[nuget] feed_url`, `nuget.pkg.github.com/...`), and the npm feed URL (`[npm] feed_url`, an Azure Artifacts npm registry when on the Azure provider; the matching `[npm] scope` routes a package scope to it) are provider-specific values a fork replaces.
6. **Rewrite `setup`** — per the contract exception above, credential intake and bootstrap wiring are expected to be fork-replaced for a new provider.

### Azure DevOps: the as-built REST provider

The Azure provider now ships in-tree — no copying GitHub modules required:

- **Modules**: `tools/lib/providers/azure/` — `http.ts` (REST transport:
  Basic-auth PAT header, `api-version=7.1`, ContinuationToken pagination,
  429/5xx retry, token redaction), `auth.ts` (PAT file lifecycle and status),
  `urls`, `repos`, `issues`, `prs`, `pipelines`, `projects` (boards),
  `policies` (branch policies), `org` (org-level bridge), plus `key-update.ts`,
  `smoke.ts`, and `MAPPING.md` (the durable mapping doc). The bootstrap chain
  uses `auth.bash`, `setup.bash` and `bootstrap.bash`.
  List/view verbs follow gh's `--json`/`-q` semantics so the shared
  wrappers behave identically under both providers.
- **No `az` CLI dependency**: the transport is Node's `fetch`. Nothing new to
  install on any fork.
- **Config keys** (in `devenv.config` under `[provider]`):
  - `name=azure` — activates the provider modules.
  - `azure_org` — the **organization name**: the subdomain in
    `https://dev.azure.com/{org}/...`. URL-safe characters only — the value
    interpolates into API URLs raw; a space would need `%20` escaping.
  - `azure_project` — the **project name**, not the project ID: the URL
    segment right after the org (`dev.azure.com/{org}/{project}/_git/...`;
    also visible in Project settings → General → Name). The GUID also works
    API-wise and is the fallback when the name contains spaces/special
    characters. The value must agree with your git remotes (`_git` URLs) and
    drives web links.

  ```ini
  [provider]
  name=azure
  azure_org=your-org-name
  azure_project=your-project-name
  ```

- **PAT setup**: run `key-update-azure` (a shell function that runs
  `tools/lib/providers/azure/key-update.ts`). It prompts (hidden input — the
  token never enters chat, shell history, or argv) and stores the PAT as a
  **0600 file** in the devenv config area; a piped stdin token also works.
  The new token is checked against the organization first: a refused token
  changes nothing, and the file is replaced atomically. Every Azure credential
  reader (REST transport, bash seam, git credential helper) resolves the
  `AZURE_PAT` environment variable first, then that file.
  Scopes needed: Work Items (Read/Write), Code (Read/Write), Build
  (Read/Execute); **Packaging (Read)** additionally for Artifacts feeds
  listing.
- **What differs from GitHub**: work-item states map to the seam's OPEN/CLOSED
  dialect (every stock process template provides those states — no board
  configuration required); labels map to `System.Tags` (semicolon-separated);
  PR rebase-merge is the Azure three-step (mergeStrategy PATCH → GET the PR →
  status=completed + deleteSourceBranch + the echoed
  `lastMergeSourceCommit.commitId`, which is required); pagination is
  ContinuationToken; issue lists are project-scoped (per-repo scoping via
  area paths is a provisioning-only convention — see MAPPING.md); releases
  map to git tags; org rulesets map to per-repo branch policies.
- **Smoke validation** (manual, opt-in, never in CI): each provider ships a live
  smoke suite with its own guide covering opt-in variables, what it creates and
  deletes, safety model, cautions and manual cleanup:
  [`github/SMOKE.md`](../tools/lib/providers/github/SMOKE.md) and
  [`azure/SMOKE.md`](../tools/lib/providers/azure/SMOKE.md). The regular test
  run never reaches a backend.

## Keeping a Soft Fork in Sync and Contributing Back

For a soft fork, `[fork]` in `devenv.config` records the fetch-only upstream URL and branch:

```ini
[fork]
upstream_repo=<upstream-url>
upstream_branch=master
```

Run the one-time setup from inside the fork clone. The dry run reports the remote and push protection without changing `.git/config`:

```bash
fork-setup --dry-run
fork-setup
```

The script adds `upstream` for fetching and sets its push URL to `/dev/null`, so an accidental push through that remote fails. It contacts no host and requires no credentials — it only writes local git config.

Run `fork-sync` to fetch upstream and inspect the divergence report: ahead/behind counts, commit subjects, and the upstream commits that look like your own work coming back (matched by Change-Id trailer, patch-equivalence, or subject). It does not change history or push by default. Use `--replay` when ready to apply upstream's new commits on top of the branch: upstream commits whose Change-Id already exists on the branch are skipped (a rebase merge upstream preserves the trailer), the rest are cherry-picked in order, so the branch's own commits keep their SHAs and `--push-to-origin` stays a normal fast-forward. Where an upstream commit's twin exists locally with a differing patch (a hand edit made at the target), the divergence is named so it can be reviewed rather than silently absorbed; a pick that conflicts stops with guidance naming the commit's classification, and `git cherry-pick --abort` returns the branch to its exact pre-sync state. Applying commits requires confirmation — a TTY prompts with a default-no choice, and scripted runs must pass `--yes`. To update the same-named branch on `origin`, `--push-to-origin` normally permits only a fast-forward. If origin contains commits absent locally, the command refuses unless `--rewrite-origin` is also specified; that path uses `--force-with-lease` pinned to the fetched origin SHA and can replace those origin-only commits. Use `--dry-run` to inspect the planned operations without fetching or changing refs. Use `--drift` for the standing drift inventory: fork-local edits on upstream-stable paths (per the fork-surfaces declaration), the maintenance cost the fork carries by choice.

```bash
fork-sync --dry-run
fork-sync
fork-sync --replay
fork-sync --replay --push-to-origin --yes
```

To contribute commits upstream, use a separate ordinary GitHub clone. `fork-export` exports an upstream-based, linear commit range as a bundle (default), patch series, or both; the base is always the merge-base of the selected end ref (default `HEAD`) and `upstream/<branch>`. A range containing merge commits is refused with guidance — sync the branch (`fork-sync --replay`) first so the range is linear. Files are written under `.local-artifacts/fork-export/<base-short>-<end-short>/`. Without `--apply-to`, the tool applies the export directly into a unique clone under `repos/` whose `origin` matches `[fork] upstream_repo` (if none or several match, it says so); `--apply-to <path>` selects an explicit sibling clone. No GitHub credentials are used by these scripts. Non-interactive selection is available with `--start-ref <commit> <end-ref>`; `--all` exports the complete upstream-to-end range; `--export-only` writes the files without applying; `--dry-run` previews.

```bash
fork-export
fork-export --start-ref <commit> HEAD --format patch
fork-export --format both
fork-export --apply-to /path/to/github/devenv
```

The interactive picker (with a TTY) can mark individual commits (TAB), and `--skip <commit>` permanently excludes commits recorded by Change-Id and SHA — `--list-skipped`, `--unskip`, and `--include-skipped` manage that list, and `--include-untracked` extends the export to matching untracked files. These are the tools for the selective-contribution case: to contribute only some commits from a branch that also carries local-only changes, either mark the wanted commits in the picker, or create a branch at the fetched upstream base, cherry-pick only the commits to contribute in dependency order, and export that branch:

```bash
fork-sync
git switch -c contribute-upstream upstream/master
git cherry-pick <commit-to-contribute-1> <commit-to-contribute-2>
fork-export --format bundle
```

This leaves the original local branch unchanged and exports a new linear series based on upstream. If a selected commit depends on omitted changes, adapt it or resolve the cherry-pick conflict before exporting. A dry run is available for setup, sync, and export before applying any operation.

### The intended loop: export promptly, sync promptly

The failure mode this tooling guards against is a fork that accumulates
exported-but-unmatched copies: commits leave the fork, land upstream under new
SHAs, and a later sync then applies them again as if they were new work. Two
habits prevent it:

1. **Export promptly.** Export a contribution as soon as it is ready, and sync
   right after the upstream merge lands. The shorter the window, the fewer
   edits accumulate on either side, and the more reliably twin matching
   recognizes the pair.
2. **Sync promptly after upstream moves.** `fork-sync --replay --yes` applies
   upstream's new commits on top of the branch: every upstream commit is
   matched against the branch — by Change-Id trailer (a rebase merge upstream
   preserves it), by a recorded adoption link, or by bounded patch-id
   equivalence — and commits the branch already has are skipped while the
   rest are cherry-picked in order. The branch's own SHAs never move, so
   origin pushes stay fast-forwards and consumer clones keep matching. Where
   a skipped commit's twin differs locally (a hand edit made at the target),
   the divergence is named so it can be reviewed rather than silently lost;
   each cleanly applied commit is recorded in the adoption map. Fork-owned
   surface state is snapshotted to `refs/fork-sync/snapshot` before the picks
   and verified after — touched fork-owned paths are surfaced for review,
   never auto-merged.

3. **Consumers update through the normal devenv prompt.** Because the sync no
   longer rewrites the fork's history, `--push-to-origin` is a fast-forward in
   the normal case and consumer clones stay SHA-compatible — most updates are
   ordinary pulls. When a rewrite does happen (a legacy fix, an explicit
   `--rewrite-origin`), the shell-start update check recognizes the diverged
   history and still offers the y/n update: clones with no unique commits are
   reset onto the new master; clones with local commits get them replayed on
   top (a conflicting rebase aborts, leaving the branch untouched). See
   [Updating the dev environment](./Dev-container-environment.md#updating-the-dev-environment).

`fork-sync --dry-run --replay` prints the pick plan (per-commit verdicts,
signals, divergences) without fetching or changing refs:

```bash
fork-sync --dry-run --replay
fork-sync --replay --yes
```

### Pre-Change-Id history: the adoption map

Commits exported before the Change-Id hook existed carry no trailer and cannot
be matched automatically. `fork-sync` records confirmed local↔upstream SHA
pairs in an adoption map (a plain file in the git directory, sibling of the
export skip list) and treats recorded pairs as authoritative twins:

```bash
# Rank candidate pairs by subject, author date, and file set; on a TTY each
# pair is confirmed with y/N. Without a TTY it prints the exact --link commands.
fork-sync --propose-links

# Record one confirmed pair explicitly.
fork-sync --link <local-sha> <upstream-sha>
```

### Exported copies carry their identity

`fork-export` stamps every exported copy with a `Change-Id` (generated when the
fork-side original lacks one) and an `Exported-From: <fork-side-sha>` trailer,
so the upstream copy and the original pair mechanically. A target copy that was
deliberately adapted while applying gets `Fork-Adapted: yes` (the tool declares
it automatically when an apply lands through conflict resolution); a
`Fork-Adapted` copy's Change-Id match is then authoritative even though its
patch differs from the original. Re-running an export detects what the target
already has — by Change-Id, patch-id, and the existing skip/duplicate checks —
and refuses to re-apply it.

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

## Adding and overriding tools (`tools/fork/` and `tools/custom/`)

The tools you call by bare name (`issue-get`, `fork-sync`, ...) are stubs in
`tools/`, each one pointing at a script. Four folders feed them, and a file with the
same name in a higher folder replaces the one below it:

| Folder | Who owns it | Committed? | Precedence |
|---|---|---|---|
| `tools/custom/` | one user, on one machine | no (gitignored) | highest |
| `tools/fork/` | the fork, for everyone on it | yes | middle |
| `tools/ts/` | the provided TypeScript tools (upstream) | yes | lower |

- **Add a tool:** put `my-tool.ts` in `tools/fork/` (for the whole fork) or
  `tools/custom/` (for you only). It gets a `my-tool` stub like any provided tool.
- **Override a tool:** give your file the same name as the provided one
  (`tools/fork/issue-get.ts` replaces `tools/ts/issue-get.ts`). The stub then runs
  yours. Remove the file and the stub points back at the next folder down.
- **Re-run the sync after adding or removing a file.** Each stub is written at sync
  time and names the winning file, so the change shows up after
  `entry-stubs-sync` runs. Bootstrap runs it; run it yourself to see a change at once.
- **Underscore-prefixed scripts cannot be overridden this way.** Scripts such as
  `_on_begin_review.sh` have no stub (they are called by path), so a copy in `tools/fork/`
  or `tools/custom/` is never picked up.
- A tool in `tools/fork/` or `tools/custom/` follows the same conventions as a
  provided tool ([Tooling Standards](./Tooling-Standards.md)): `toolCli` for the
  house flags, the exit-code constants, a working `--help`, and tests for anything
  non-trivial. `tooling-create-script --dir tools/fork my-tool` scaffolds one.

Keep an override small. The provided tool keeps receiving upstream changes that your
copy does not, so prefer a config key or a policy knob (see
[What stays upstream](#what-stays-upstream)) when the surfaces can express the difference.

## Copilot Instructions

The file `copilot/copilot-instructions.md` contains AI coding guidelines that apply to the repository in VS Code (GitHub Copilot reads this file automatically when it exists in the workspace). During bootstrap, `~/.copilot/copilot-instructions.md` is **symlinked** to this file, making the same instructions available as the user-level Copilot instructions file.

When forking, you have two options:

1. **Write your own instructions in-place** — update `copilot/copilot-instructions.md` directly with your organization's conventions, code style, and AI guidance. Bootstrap will symlink it to `~/.copilot/copilot-instructions.md` automatically.

2. **Symlink to a different file** — if you prefer to keep your Copilot instructions elsewhere (e.g. in a shared config repo or a different path), create `~/.copilot/copilot-instructions.md` as a symlink to that file before or after bootstrap runs. The `install_copilot_instructions` task will detect the existing symlink and leave it untouched, regardless of where it points.

## Copilot Skills

This repository ships with a suite of slash-command skills that cover the full development lifecycle — from issue triage through PR review. They live in `copilot/skills/` and are invoked with `/skill-name` in Copilot Chat. The full catalog lives in [docs/Skills.md](./Skills.md); it is the source of truth for what ships, so this guide intentionally does not repeat a count.

See [docs/Skills.md](./Skills.md) for the full catalog and decision tree.

### Adding a custom skill

1. **Read the conventions** — `copilot/skills/_conventions.md` defines the required file layout, frontmatter fields, description rules (lint-skills fails a description over 1024 characters — the Copilot skill loader's limit, so a fork-added skill over it would not load in Copilot either — and frontmatter that does not parse as YAML), section ordering, and confirmation-flow patterns.

2. **Create the skill folder and SKILL.md**:

   ```text
   copilot/skills/<your-skill-name>/
   └── SKILL.md
   ```

   The folder name must match the `name:` field in the YAML frontmatter exactly.

3. **Write the description carefully** — it is the only signal Copilot uses to decide whether to auto-load the skill. Include explicit `USE WHEN` and `DO NOT USE FOR` clauses with the exact phrases users will say. Keep it within 1024 characters, and single-quote the value (doubling any apostrophe) if it contains a colon followed by a space. Verify both:

   ```bash
   lint-skills
   ```

   The YAML check (SK011) approximates the Copilot skill loader; the Copilot log (`~/.copilot/logs/`) is the ground truth.

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

### [container]

```ini
[container]
name=YourOrg Dev Environment
```

- **name**: Display name for the dev container

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
2. **`Implementing` is the load-bearing boundary token.** The engine locates the delivery boundary by looking up `Implementing` in this list — it drives the rollup floor (pre-delivery children of an active parent count as Implementing) and the "workflow states cannot be forced" gate. Keep the token name, or update both lookups in `tools/lib/domain/issues/graph.ts`.
3. **`TBD` and `Ready` are the birth tokens.** New issues are born at `TBD`; a Task created under a parent is born `Ready`. Renaming either requires updating the birth rule in `tools/ts/issue-create.ts`.
4. **`tools/config/skill-events.yml` names statuses too.** Every event's `status:` value must exist in `status_workflow` — rename there in the same change or signals will write statuses no board defines.

Safe rename/reorder procedure:

1. Edit `status_workflow` in `devenv.config`.
2. Update the matching `status:` values in `tools/config/skill-events.yml`.
3. If you renamed `Implementing`, `Ready`, or `TBD`, update the boundary lookups in `tools/lib/domain/issues/graph.ts` and the birth rule in `tools/ts/issue-create.ts`.
4. Migrate live board cards to the new names (project fields hold the old strings — the engine treats foreign values as unreadable).
5. Run the test suite (`bash tools/tests/run-devenv-tests.sh`) — the workflow suites fail loudly on contract breaks.
6. Re-write [Issue Workflow](./Issue-Workflow.md) to reflect the updated status workflow.

Do not duplicate states, and do not interleave the two halves — status derivation (minimum-state rollup) is order-sensitive by design. The semantics each state carries, and what moves a card, are documented in [Issue Workflow](./Issue-Workflow.md); that guide is the model, this section is only the customization contract.

### [copilot]

```ini
[copilot]
knowledge_repo=https://github.com/workinprogress-ai/docs.copilot-knowledge.git   # ← your fork's repo
knowledge_subpath=copilot-knowledge/
engineering_repo=https://github.com/workinprogress-ai/docs.engineering.git       # ← your fork's repo
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

## Repo Creation Standards (repo-create)

> **Provider capability note:** rulesets, templates, merge-button control, Discussions, and most of the toggles below are GitHub-provider capabilities (gated by capability checks in the provider layer). A fork on a provider without them either substitutes (ADO branch policies for rulesets) or leaves them unset — creation degrades with a warning, not a failure.

If you use `tools/repo-create`, configure `tools/config/repo-types.yaml`:

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

## Issue Types Configuration (issue-create)

> **Provider capability note:** native issue types are a GitHub-provider capability (`native-issue-types`). A fork without the capability runs the same type vocabulary as labels via the `[issues] types` policy knob — see the [policy library README](../tools/lib/policy/README.md).

The `issue-create` tool supports native issue types on providers that declare the capability. Issue types are configured in `tools/config/issues-config.yml`, which is the single source of truth for type names, descriptions, and parent rules (`child_of`). Type names are matched case-insensitively, and the built-in aliases (for example `story` for `Feature`) resolve onto the configured names.

Type names are **load-bearing** for the workflow model: Features and Bugs are deliverables, Tasks are work toward someone else's change (the only type that nests, and the only one born `Ready` under a parent — `issue-create` string-matches `Task` for that birth rule), and Epics group deliverables. Keep these four names, or update the birth rule when renaming. See [Issue Workflow](./Issue-Workflow.md) for the roles.

### Configure Issue Types

Edit `tools/config/issues-config.yml` to define your organization's issue types:

```yaml
types:
  - name: Bug
    description: "A bug or defect that needs fixing"
    child_of: [Epic]

  - name: Feature
    description: "A new feature or enhancement"
    child_of: [Epic]

  - name: Task
    description: "A task or work item"
    child_of: [Epic, Feature, Bug, Task]
```

Each entry needs:

- **name**: The issue type name (displayed in the provider UI and used for validation)
- **description**: Human-readable description for users selecting a type
- **child_of** *(optional)*: the parent types this type may be placed under; omit for no restriction

### Inspecting Your Organization's Issue Types (GitHub-native path)

List the types configured in your GitHub organization using the workspace wrapper (one-time setup inspection — day-to-day issue operations always go through the `issue-*` tools):

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

1. List the updated types using the CLI command above
2. Update `tools/config/issues-config.yml` with the new type names

### Example: Custom Issue Types

```yaml
types:
  - name: Bug
    description: "Production bug or critical issue"

  - name: Enhancement
    description: "New feature or improvement"

  - name: Documentation
    description: "Documentation or tutorial"

  - name: Spike
    description: "Research task or investigation"
```

Note: the names must match the issue types configured in your provider.

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

[container]
name=Acme Dev Environment

[workflows]
status_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged
```

### Enterprise Organization

```ini
[organization]
name=Mega Corp
org=mega-corp-dev
email_domain=megacorp.com

[container]
name=Mega Corp Development Environment

[workflows]
status_workflow=TBD,To-Groom,Ready,Implementing,Review,Testing,Merged,Staging,Production
```

## Adding New Tools and Libraries

This section explains the conventions for adding new tools, TypeScript modules, and categories of tooling so that all contributions stay consistent and discoverable. Every new tool is TypeScript; the bash that remains is the container bootstrap layer, which you should not extend (see [The bash that remains](./Tooling-Standards.md#the-bash-that-remains)).

### Adding a new library module

Libraries live in `tools/lib/`, organized by role, never by language, and are imported by tools:

For the module catalog and the dependency direction between layers, see [Tooling Standards](./Tooling-Standards.md#typescript-standards).

1. **Placement**: `lib/core/` for runtime seams (imports nothing internal), `lib/ui/` for interaction, `lib/providers/` for the provider facade, `lib/domain/` for headless logic. A layer imports only from layers to its left.
2. **File name**: `kebab-case.ts`, e.g. `lib/domain/markdown.ts`.
3. **Imports**: use relative `.ts` specifiers (`import { logInfo } from "../core/logging.ts"`); there is no build step.
4. **Function naming**: `camelCase` with a clear verb prefix, per [Function Naming Conventions](./Function-Naming-Conventions.md).
5. **Document every exported function** with a short doc comment stating what it returns and when it throws or exits.
6. **Write tests** in `tools/tests/ts/<name>.test.ts`. Every exported function should have tests covering success paths, failure paths, and edge cases. Run one with `pnpm exec vitest run tools/tests/ts/<name>.test.ts`.

### Adding a new script

Scripts live in `tools/ts/<name>.ts`
(TypeScript). Depth-1 entries at `tools/<name>` are generated — not hand-made: `.devcontainer/entry-stubs-sync.sh` (run by bootstrap and by the test runner) creates a stub for every `tools/ts/` script. Never hand-edit or hand-create a stub. Tests do not go through the stubs: they spawn `tools/ts/<name>.ts` directly (the harness's `runTool`/`toolScript`), so a clean checkout can run the suite.

Scripts that only the devenv or githook machinery invokes (never run by users) belong in `tools/internal/` instead — they get no stub, are not on `PATH`, and are not part of the custom-over-fork-over-provided override chain. See [Additional Tooling — Internal machinery scripts](./Additional-Tooling.md#internal-machinery-scripts-toolsinternal).

1. **Start from the template**: `tooling-create-script <name>` scaffolds the file from `tools/templates/script-template.ts`.
2. **File location**: `tools/ts/<group>-<action>.ts` (TypeScript), following the existing `group-action` naming pattern (e.g. `markdown-plan-complete-task`).
3. **Entry point**: none needed by hand — run `.devcontainer/entry-stubs-sync.sh` (or bootstrap) and the `tools/<name>` stub is generated automatically.

4. **Standard structure** (in order, as the template lays it out):
   - Shebang + header comment (name, version, description)
   - Imports from `lib/core/` (`toolCli`, `logging`, `exit-codes`, `node-floor`)
   - `assertNodeFloor()` before anything else
   - `SCRIPT_VERSION` and tool-name constants
   - `showUsage()` using `usageCommonFlags()` for the house options block
   - `main(argv)` that parses with `toolCli`, handles `--help` first, validates
     every argument before the first mutation or provider call, and returns an
     exit code from `exit-codes.ts`
   - A top-level `main(...).then(...)` that exits with the returned code and
     reports a rejected promise as exit 1
5. **Always implement `--help` and `--version`**: `toolCli` supplies both; the tool renders the usage text.
6. **Tests**: test tools according to their impact, complexity, and criticality. Tool tests go in `tools/tests/ts/` and spawn the tool through the shared harness.

### Adding a new tool category

When adding a group of related tools (e.g. `markdown-*`), follow the
[Tooling Standards](./Tooling-Standards.md#the-bash-that-remains)
— new tools are TypeScript. Steps:

1. Create the TS modules at `tools/lib/` (core/domain/providers per the
   dependency-direction rules) following the conventions above.
2. Create the tool entry at `tools/ts/<category>-<action>.ts` per the TS
   template (`tooling-create-script`).
3. The depth-1 stub at `tools/<name>` is generated (`entry-stubs-sync`) —
   never hand-made.
4. Write vitest suites in `tools/tests/ts/`.
5. If any third-party packages are required (e.g. Python packages via `pip`, Node packages via `pnpm`), install them in `.devcontainer/bootstrap.bash` inside the appropriate `install_*` function so the dependency survives container rebuilds.
6. Document the new tools in `docs/Additional-Tooling.md` under an appropriate section heading, following the existing format (usage, options, examples, features).

### Third-party dependencies

If a tool requires an external program not already present in the environment, install it from a TypeScript install step under `tools/ts/setup-steps/` so it survives container rebuilds (`.devcontainer/bootstrap.bash` only hands off to the setup orchestrator, `tools/ts/setup.ts`):

- **OS packages** (`apt`): add to `STABLE_PACKAGES` in `tools/ts/setup-steps/apt-packages.ts`; packages that only one provider needs go in that file's `PROVIDER_APT_PACKAGES`. Packages from the specialized repositories (terraform, kubectl) are in `apt-packages-extra.ts`.
- **Node global packages**: add alongside the pinned versions in `tools/ts/setup-steps/node-globals.ts`.
- **dotnet tools**: add to `tools/ts/setup-steps/dotnet-tools.ts`.
- **Anything else**: add a step module and register it in `tools/ts/setup.ts`; a fork's own customizations belong in `org-custom-bootstrap.sh` (see [Bootstrap Customization](./Bootstrap-Customization.md)).

Always make the step idempotent: check for the tool's presence before installing, as the existing steps do.

---

## What stays upstream

The [fork-stable surfaces contract](#the-fork-stable-surfaces-contract) at the top of this guide is the authoritative list of what you may change freely. Everything outside it — test infrastructure, the `tools/lib/core/` runtime seams, git configuration helpers, the tool template, the bootstrap framework, and the tooling library structure — is upstream-stable: keep it unmodified and upstream improvements keep flowing to your fork with minimal conflict.

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
