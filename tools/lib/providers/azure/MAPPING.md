# Azure DevOps mapping — how GitHub shapes translate

> Status: working model, validated against live API behavior on 2026-09-27
> (Tier-1/Tier-2 smoke, org `OMS-FORT` / project `Devenv-fork-test`); the
> setup script ran live (area paths created, idempotency verified) on
> 2026-09-28. Companion docs: [Forking.md](../../../../docs/Forking.md)
> (fork mechanics)
>
> This is the azure provider's durable mapping document: it lives with the
> code it describes, versions with it, and is the reference for the
> provider implementation (`tools/lib/providers/azure/`), the one-time
> setup script (`azure-setup.sh`), and full-parity planning.
> Live API facts recorded here (merge three-step, preview api-versions)
> are empirically verified, not aspirational. Rows marked **as-built**
> were reconciled against the shipped code at plan close (2026-09-30).

## Transport facts

Facts the implementation depends on; recorded here so planning sessions
don't re-derive them:

- **Git transport credentials**: `provider_auth_setup_git` registers a
  host-scoped git credential helper for `https://dev.azure.com` and the
  configured organization's `https://<org>.visualstudio.com` legacy host
  (both scoped entries use
  `tools/lib/providers/azure/credential-helper.sh get`) backed by the 0600
  PAT file. Organization identity comes from the provider accessor, normalized
  to lowercase; missing or invalid identity skips only the legacy entry with a
  warning. `key-update-azure` invokes the wiring after every successful
  import. `store`/`erase` are refusals-by-no-op — the PAT file is the only
  durable copy, so git never writes a second one. Unrelated hosts never consult
  the helper (host-scoped config).
- **npm credentials remain provider-specific**: bootstrap configures the GitHub
  npm registry token only for the GitHub provider. Azure PATs are never queried
  for that registry. npm setup preserves unrelated settings and authentication
  entries, removes the exact legacy invalid skip-message line, and writes skip
  status to the console rather than the configuration file. This does not add
  Azure npm feed configuration.
- **Two api-version regimes**: most endpoints take `api-version=7.1`;
  work-item **comments** are a preview resource requiring a
  `-preview` version pinned on the URL (plain 7.1 → 400; the code pins
  `7.2-preview.4` — the version that carries the `format` attribute).
  The transport (`http.bash`) passes a URL-pinned api-version through
  untouched.
- **Two body regimes**: work-item create/edit endpoints require
  `application/json-patch+json` (plain JSON → 400); **PR endpoints
  reject JSON-Patch (415)** and take plain JSON documents.
- **Long text is stored HTML-ish — except comments written via the markdown
  route**: comment create/edit at `api-version=7.2-preview.4` accept
  `?format=markdown` as a QUERY parameter (a body `format` field is
  silently ignored — verified live), storing real markdown:
  `format: "markdown"` metadata + portal rendering via `renderedText`.
  Without it the portal shows raw markdown as unrendered text. Even on
  the markdown route, comment `.text` and `System.Description` come back
  entity-encoded (`"` → `&quot;`), and a trailing newline in the input
  is doubled while a missing one is not added. The provider boundary
  restores markdown: reads un-escape entities; shell command-substitution
  capture strips the trailing newline on read and writes drop one
  trailing newline first — the pairing keeps round trips
  trailing-newline-insensitive.
- **PR completion is a three-step**: PATCH `{"mergeStrategy":"rebase"}`
  → GET the PR → PATCH `{"status":"completed","deleteSourceBranch":true,
  "lastMergeSourceCommit":{"commitId":...}}`. The echoed commitId is
  REQUIRED — without it Azure accepts the PATCH but the PR stays active.
- **PR create/merge are repo-scoped**: the org-wide pullrequests endpoint
  is a list endpoint only; create/update verbs must target
  `_apis/git/repositories/{repo}/pullrequests`.
- **Pagination**: ContinuationToken (header on some endpoints, body on
  others — `azure_http_paginate` handles the header form; a body-based
  fallback may be needed if counts ever look small vs the portal).
- **Board columns update is PUT with the BARE array** — a `{value:...}`
  wrapper is rejected 400 "boardColumns cannot be null"; columns carry
  `id`/`stateMappings` that must be preserved on rename (1:1 rename
  keeps them valid). Board routes are team-scoped:
  `/{project}/{teamId}/_apis/work/boards/{boardId}/columns`; the team
  id resolves via the project-GUID teams route
  (`/_apis/projects/{guid}/teams` — the project-NAME route 404s).
- **Work-item ids are org-global** (see [Numbering](#numbering)); WIQL is
  the query language (`POST _apis/wit/wiql` with a `{"query": ...}`
  body); relations (parent/child) are link types on the work item, not a
  graphql graph.
- **Boards are native** — no separate board API family to emulate;
  board position/column is work-item state + team board configuration.

## Why this mapping exists

GitHub and Azure DevOps organize work differently. The devenv tooling
(`issue-*`, `pr-*`, `project-*`, `pipelines-*`, board workflow) speaks the
GitHub shape: org / repo / per-repo issues `#N` / GH Projects boards /
org rulesets. An Azure-oriented fork must still run that tooling — the
provider seam (`tools/lib/providers/`) translates. This document defines
the translation and, critically, the **constraints** under which it holds.
Where the shapes genuinely differ, the constraint is the price of parity.

## The one big constraint

**One Azure project = one GitHub org.**

Everything else follows from this. The provider config already assumes it
(`[provider] azure_org` + `azure_project` — a single project per fork).
All org-scoped GitHub concepts become project-scoped Azure concepts:

| GitHub shape | Azure shape | Constraint / note |
|---|---|---|
| Org | Project | The project holds every repo of the forked org |
| Repo | Repo (inside the project) | Name-identical |
| `owner/repo` addressing | `project/repo` (org implied by config) | Addressing stays 2-part; `azure_org_project` resolution handles it |
| Org issues numbering (per-repo `#N`) | Org-global work-item ids | **Unfixable natively** — see [Numbering](#numbering) |

If a fork needs multiple Azure projects, the mapping breaks: work-item
queries, boards, and pipelines are project-scoped; cross-project assembly
would need a different provider shape entirely. Constraint, not bug.

## Issues ↔ Work items

View projection (as-built): `provider_issues_view` / list emit every field
in issue-get's DEFAULT_FIELDS non-null. Mapping: milestone derives from
`System.IterationLevel2` (iteration path's leaf — typed "" when unset);
closedAt from `Microsoft.VSTS.Common.ClosedDate`; comments are typed `[]`
(the count lives on the threads resource — supplementary fetch deferred).


| GitHub shape | Azure shape | Constraint / note |
|---|---|---|
| Issue | Work item (type from the config type map) | Type per issue decided at creation; the seam maps Bug/Feature/Task/Epic |
| Open/closed | New/Active vs Closed/Done/Removed | Mapped inline in the list/view projections |
| Labels | `System.Tags` (semicolon-separated) | No colors/descriptions — flat strings only |
| Issue types (Bug/Feature/Task/Epic) | Work-item types (native) | Richer than GH types; the config type map decides the default |
| Per-repo issue list | Project-wide WIQL | **As-built constraint**: lists are project-scoped (`TeamProject = @project`), not per-repo — see [Area-path convention](#area-path-convention-as-built-provisioning-only) |
| Milestones | Iterations | Config-mapped (existing `[azure] iteration` keys); no API parity claimed |
| Sub-issue graph (parent/child) | Work-item links (parent/child, relates-to) | Replaces the GH sub-issue graphql; `issue-graph.bash` maps onto relation queries |
| Reactions | — | No native equivalent; not mapped |

### Area-path convention (as-built: provisioning only)

GitHub issues live inside a repo; Azure work items live inside a project.
To preserve "list the issues of repo X", the setup script creates **one
area path per repo** (`<project>\<repo-name>`). However, the shipped
issue verbs do **not** tag or filter by `[System.AreaPath]`: `create`
assigns no area path (work items land in the project root area) and
`list`/`view` scope by `[System.TeamProject] = @project` — issue lists
are **project-wide**, not per-repo. Per-repo issue scoping via area
paths is a documented, unimplemented convention: the setup script
prepares the paths, a future change may adopt them.

Constraint (if adopted): repo names must be valid area-path node names
(no `/`, no leading/trailing spaces). Violation → work items land in the
project root area; lists silently miss them.

## Projects (boards) ↔ Azure Boards

### Board status vocabulary (single source)

The board vocabulary is defined once here and consumed by three
surfaces: the `provider_projects_*` verbs, the board workflow docs, and
the setup script's column provisioning.

- **Settable surface**: `System.State` only — `System.BoardColumn` is
  ReadOnly (TF401326, verified live even with split columns). The board
  column follows the state mapping automatically.
- **Vocabulary mapping**: the fork's `status_workflow` words alias onto
  process states via config aliases — `[azure_status_aliases]`
  `<word>=<state>` (e.g. `TBD=New`, `Ready=Active`, `Merged=Closed`).
  A word that already names a state passes through; an unmappable word
  fails defined (`field_option_ids` reports the drift, never guesses).
- **Setup constraint**: setup forces board column names and count to the
  configured workflow, retaining existing mappings and reusing a supported
  in-progress mapping for new middle columns. Shared-state columns are a
  layout choice, not distinct settable states; cards can land in the first
  same-state column. Forks wanting the full 8-word vocabulary as
  settable states must adopt an inherited process with custom states
  (org-level admin, outside project-scope API).

GitHub Projects (the `project-*` wrapper surface) map onto Azure Boards —
natively and, under the one-project constraint, arguably better than GH
Projects fits:

| GitHub shape | Azure shape | Constraint / note |
|---|---|---|
| Project (board) | Board (per team, per work-item type) | Boards are native, project-level, cross-repo |
| Status field (column) | Board column (Kanban) / state | The board workflow's status-column vocabulary maps directly |
| Project item | Work item | Already on the board by existing — no "add to project" step |
| Field (single-select) | Board column or field | Field-option ids → column names |
| Views | Board / backlog / query views | — |

The GH `projects_*` verb surface (8 verbs, as-built) translates to
Boards reads/updates: `projects_list` → boards list; `field_set` (Status) →
state/column move; `item_add` → no-op-success (work items are born on the
board); `item_id_for_issue` → work-item id (identity). Constraint: the
fork standardizes **one board per work-item type** with the board
workflow's column vocabulary (the setup script provisions them).

## Pull requests ↔ Pull requests

View projection (as-built): `provider_prs_view` emits every field in
pr-get's DEFAULT_FIELDS non-null. Mapping: mergeable/mergeStateStatus
derive from Azure's `mergeStatus` (conflicts → CONFLICTING/DIRTY,
succeeded → MERGEABLE/CLEAN, else UNKNOWN); labels ride reviewers
(PR objects carry no tag surface); `reviewRequests`, `milestone`,
`comments`, `reviews` are typed empties — supplementary fetches (threads,
iterations) are deferred until a consumer needs real values. `isDraft`
falls back to false.

Direct mapping; already implemented and live-verified (Tier-2 smoke):
create, comment (threads), rebase-merge two-step with
`lastMergeSourceCommit` echo, source-branch deletion. Note: PR completion
requires echoing `lastMergeSourceCommit.commitId` (fetch-then-PATCH);
review-thread ids are opaque refs emitted by pr-threads-get
(`<pr>/<thread>` composite under azure); resolve takes the ref verbatim.

## Pipelines ↔ Pipelines (as-built)

Direct mapping; implemented live (runs list/view with gh
--json/-q semantics, trigger with `--field` dispatch inputs → queue
`parameters` as stringified JSON, artifacts incl. numeric sizes,
watch with `--exit-status` conclusion mapping, workflow list/run with
default-branch ref resolution, cancel, rerun, download with `-n`/`-D`).

## Org rulesets ↔ Branch policies

| GitHub shape | Azure shape | Constraint / note |
|---|---|---|
| Org ruleset | Repo branch policy **configuration set** | Azure policies are repo-scoped, not org-scoped |
| Ruleset conditions (target branches) | Policy `matchKind`/`pattern` on ref | — |
| Require PR / reviews / status checks | Minimum reviewers, build validation policies | Policy ids differ per repo — the setup script names a default set |

Constraint: there is no org-level ruleset API surface; parity means the
**setup script + repo-create flow apply the standard policy set per repo**.
`repo-types.bash`/`policy-export.sh` consumers map onto policy-configuration
reads/writes per repo.

## Releases ↔ git tags (as-built: decision made)

GH Releases have no Azure equivalent. The implemented mapping (Option 1):
releases are git tags; `provider_org_releases_list` reads
`refs?filter=tags/` and projects the gh release shape (tagName, name,
publishedAt ← tagger date, isPrerelease ← semver-heuristic,
isDraft ← false — azure has no draft tags). `--json`/`-q` follow gh list
semantics. semantic-release's publish step becomes exec-plugin tag+push
(fork-side concern, outside this provider). Live-verified end-to-end
(tag create → list → cleanup).

## Packaging ↔ Azure Artifacts (as-built: decision made)

`artifact-operations.bash`'s packages reads ride the domain verbs
(`provider_org_packages_list` / `provider_org_package_versions`) —
never raw `provider_api` pagination. Azure implements the list verb
against org-level Artifacts feeds (`feeds.dev.azure.com/_apis/packaging/feeds`,
PAT needs packaging scopes — an environment prerequisite), same source as
`provider_org_feeds_list`. GH Packages is per-user; azure feeds are
org-scoped — the shapes differ accordingly (live-verified: real feeds
listed). The versions verb fails defined: azure package versioning is
feed-scoped and the GitHub-shaped endpoint has no analog — a documented
gap until demand justifies a feed-scoped verb.

## Numbering

GitHub numbers issues per repo (`#40`); Azure work-item ids are org-global
and monotonically increasing across all work items ever created. Nothing
to implement — but the constraint must be documented for fork users:

- Artifact doc-ids embed issue numbers (`dv1:...:issue:40`) — they stay
  valid; the numbers are just larger and not per-repo.
- `#N` cross-references in chat/docs will not match Azure portal URLs
  (`dev.azure.com/{org}/{project}/workitems/{id}`).
- Ordering cues ("#100 is newer than #99 in this repo") hold within a
  project but not across repos.

## The setup script (as-built, azure-setup.sh)

One-time, idempotent, points at the configured Azure project and applies
this document: one area path per repo found in the project; board columns
forced to the `[workflows] status_workflow` vocabulary and count even when
previously customized. Incoming/outgoing column identities and mappings are
retained; existing middle columns are reused in order, extras removed, and new
middle columns inherit a supported in-progress mapping without inventing states.
An already-converged board is not rewritten. The script emits the
fork's `[provider]` config block. `--dry-run` prints the plan;
`AZURE_SETUP=1` gates execution (manual-only). Constraint discovered
live: creating NEW work-item states is a process-template change the
script deliberately does not attempt. Shared-state columns do not make each
workflow word independently settable; that requires process-admin customization.
If no existing in-progress mapping supports added columns, setup reports the
unsupported board rather than guessing a work-item state.

## Change discipline

This document describes the mapping the CODE implements. When the provider
implementation changes a mapped behavior, update the matching table row in
the same change; when a new constraint is discovered live, record it here
with the date and evidence. Transport-level facts (api-versions, body
regimes, merge steps) are verified against
`https://dev.azure.com` REST api-version 7.1 unless noted otherwise.

## Live smoke suite

`azure-smoke-test.sh` validates every HTTP-touching verb in this provider
against a LIVE org in one combined flow. Manual invocation only — never
wired into tests or CI.

How to run:

```
cd tools/lib/providers/azure
AZURE_PAT=<token> AZURE_DEVOPS_ORG=<org> AZURE_SMOKE_TEST_PROJECT=<project> \
    [AZURE_SMOKE_REPORT=<path>] ./azure-smoke-test.sh
```

Interactive mode prompts for the same three values (PAT input hidden).
The PAT needs Code, PullRequest, WorkItems, Boards, Build, Packaging and
Policy management (read+write) rights; the suite never persists it.

Contract:

- **User-provided test project only.** The suite never provisions or
  deletes projects; every destructive case runs inside the named project
  and the org outside it is never touched.
- **Single combined flow:** fixtures first (work item + disposable repo
  via provider verbs), then every verb, then mandatory reverse-order
  teardown via an EXIT trap (fires even on a mid-suite death).
- **Teardown matrix (live-verified):** work items delete with
  `?destroy=true`; repo DELETE may need the fallback chain
  name+destroy → GUID+destroy → plain soft-delete; policy DELETEs
  302-redirect (the transport follows redirects).
- **Report:** `AZURE_SMOKE_REPORT=<path>` appends per-verb pass/fail
  lines; the transport redacts the token on every path, so reports are
  safe to keep in `.local-artifacts/`.
- **Idempotence note:** `protect_branch` and the ruleset case both create
  a minimum-reviewers policy on `main`; a duplicate is rejected 403
  "rejected by policy" — the ruleset case reads a verified equivalent
  configuration as idempotent success (anything else stays a FAIL).

Live-verified transport facts added by this suite (2026-10-01):

- PR thread routes are repositories-qualified:
  `/_apis/git/repositories/{repo}/pullrequests/{id}/threads/{id}`. The
  status PATCH takes the thread object `{"status":2}` under plain
  `application/json` (json-patch+json → 415; a JSON-Patch array →
  "Parameter name: commentThread").
- ACL security tokens are dataspace-rooted:
  `repoV2/{project-id}/{repo-guid}` — a bare repo guid fails with
  "Could not find dataspace with category Git".
- `builds?&$top=…` (empty first query param) is rejected 400; the first
  parameter owns the separator.
- `description` is not PATCHable on repositories ("The repository change
  is not supported") — create-time only.
- A `builds?&` style empty-param URL, a literal `\t` in a grep pattern,
  and Basic-auth PAT handling are all covered by regression tests in
  `tools/tests/lib/test_provider_azure_*.bats`.
