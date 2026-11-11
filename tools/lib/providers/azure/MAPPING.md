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
  configured organization's `<org>.visualstudio.com` host
  (both scoped entries use
  `tools/lib/providers/azure/credential-helper.sh get`) backed by the 0600
  PAT file. Organization identity comes from the provider accessor, normalized
  to lowercase; missing or invalid identity skips only the `<org>.visualstudio.com` entry with a
  warning. `key-update-azure` invokes the wiring after every successful
  import. `store`/`erase` are refusals-by-no-op — the PAT file is the only
  durable copy, so git never writes a second one. Unrelated hosts never consult
  the helper (host-scoped config).
- **npm credentials follow the same seam**: with `[npm] feed_url` set to an Azure
  Artifacts npm registry, bootstrap writes the user-level `~/.npmrc` credential
  triple (`username` / `_password` (base64 PAT) / `email`) for the feed's registry
  prefixes, plus the `[npm] scope` mapping when one is set; `key-update-azure`
  re-runs the wiring after every successful import. npm setup preserves unrelated
  settings and authentication entries, removes the exact `Skipping npmrc auth token (gh not authenticated)` line, and writes skip
  status to the console rather than the configuration file. Only
  `pkgs.dev.azure.com` and `*.pkgs.visualstudio.com` hosts ever receive the PAT.
- **Two api-version regimes**: most endpoints take `api-version=7.1`;
  work-item **comments** are a preview resource requiring a
  `-preview` version pinned on the URL (plain 7.1 → 400; the code pins
  `7.2-preview.4` — the version that carries the `format` attribute).
  The transport (`http.ts`) passes a URL-pinned api-version through
  untouched.
- **Two body regimes**: work-item create/edit endpoints require
  `application/json-patch+json` (plain JSON → 400); **PR endpoints
  reject JSON-Patch (415)** and take plain JSON documents.
- **Long text is stored HTML-ish — except comments written via the markdown
  route**: comment create/edit at `api-version=7.2-preview.4` accept
  `?format=markdown` as a QUERY parameter (a body `format` field is
  silently ignored — observed against the live API), storing real markdown:
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
closedAt from `Microsoft.VSTS.Common.ClosedDate`. `comments` is the comment
count: `view` reads it from the comments resource, `list` from the
`System.CommentCount` field (`0` when the field is absent), so
`--json comments` works on both. Every `url` is the work item's browser address
(`_workitems/edit/N`), never the `_apis/wit/workItems/N` API address.

| GitHub shape | Azure shape | Constraint / note |
|---|---|---|
| Issue | Work item, on a board-backed type | Born as the Azure type mapped for its devenv type (see [Work item types](#work-item-types)) |
| Open/closed | A state is closed when its category is Completed or Removed (read from the project's work item types) | `Resolved` is open; `close` moves the item to its type's Completed-category state, `reopen` to its first Proposed (else InProgress) state, both read from the type |
| Close reason | — | Azure has no close reason; `--reason` is accepted and dropped |
| Labels | `System.Tags` (`a; b`, trimmed on read) | No colors/descriptions — flat strings only; `edit` reads the current tags and writes the surviving set; label list reads the tags endpoint, else the project's work items |
| Issue types (Bug/Feature/Task/Epic) | Work-item types | Richer than GH types; a type change is a `System.WorkItemType` replace through `provider_issues_set_type`, never through `edit` |
| Edit flags | `--title`, `--body`, `--add-label`, `--remove-label` | Any other flag (`--milestone`, `--add-assignee`) has no Azure write path and fails rather than being dropped. `--type` is accepted only together with `--body`, where it selects the body field; without a body it fails. Without `--type`, the item's current type (one read) selects the body field, so the edit lands in the field `view` reads (a Bug's `ReproSteps`, not a shadowed `Description`). Title, body and tag changes go in **one** JSON-patch, so a failure leaves the item unchanged. |
| Existence | `GET workitems/N` | Only a not-found answer (HTTP 404, TF401232) is "absent"; auth, network and server failures are errors |
| Create verification | Read-back of `System.Rev` after the POST | A failed read-back after a successful create returns the new id with a warning, so a retry never duplicates the item |
| Descriptions | `System.Description` with the markdown multiline format | Items last edited in the portal hold HTML; the read path un-escapes entities for them |
| Comments | Work-item comments, paged by continuation token | Posted with `?format=markdown` |
| Per-repo issue list | Project-wide WIQL | **As-built constraint**: lists are project-scoped (`TeamProject = @project`), not per-repo — see [Area-path convention](#area-path-convention-as-built-provisioning-only) |
| Milestones | Iterations | Config-mapped (existing `[azure] iteration` keys); no API parity claimed |
| Sub-issue graph (parent/child) | Work-item links (parent/child, relates-to) | Replaces the GH sub-issue graphql; the issue-graph verbs map onto relation queries. A failed link reports the real error unless the parent already lists the child; an unlink is guarded by a `test` op on `/rev`, so a concurrent relation change fails the write instead of removing a different relation |
| Blocked-by | `Dependency-Forward` work-item link from the blocked item to each blocker | Distinct from the parent/child hierarchy. The link type is pinned as `Dependency-Forward` (the item carries the link, pointing at the blocker as predecessor) **pending a live check** of the direction against a real organization. The facade applies a blocker list sequentially, because parallel relation writes on one work item race its revision; adding an existing link and removing an absent one are no-op successes |
| Comment edit | — | No comment-edit primitive is wired: the facade's `issuesCommentEdit` throws a named error (a known gap in [CONTRACT.md](../CONTRACT.md)) |
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

### Work item types

A devenv issue type maps onto the Azure work item type that sits on a board:
`Epic` → `Epic`, `Feature` → `Feature`, `Bug` → `Bug`, and `Task` (and an
untyped issue) → `User Story`; the provider creates no plain `Issue` items.
An `[azure_issue_types]` block in `devenv.config` overrides or extends the map
(`<devenv type, lower-case>=<Azure type>`); a type with no mapping fails and
names the key to add. The Agile process's `User Story`, `Bug`, `Feature` and
`Epic` carry the states New, Active, Resolved, Closed (and Removed); an `Issue`
has only Active and Closed and sits on no board. Whether `Bug` sits on the
Stories board is a team setting, which the Tier 2 smoke confirms.

## Repository settings

GitHub repository settings (wiki, discussions, merge buttons, forking, template flag) are
changed through `gh repo edit` flags and `gh api` `-f`/`-F` pairs. Azure has no equivalent
surface:

| Facade verb | Azure behavior | Why |
|---|---|---|
| `reposEdit` | Refused with a named error (`repos_edit is not supported on provider 'azure'`) | A repository has no post-create settings flags; the template link is create-time only |
| `reposPatch`, `reposPatchWithError` | Throw `… is not supported on provider 'azure'` | The `-f`/`-F` flags name GitHub settings. Azure models merge strategies as project-level branch policies and does not model the rest; mapping the flag dialect onto policies is an open design question, so the facade refuses rather than guessing. The provider module's own `reposPatch` (a key/value PATCH of the repository record) is reachable only below the facade |
| `reposTeamPut`, `reposCollaboratorPut` | Grant access through the security-namespace ACLs; a provider failure reads as `false` | Permissions map onto Azure's repository permission bits |

## Projects (boards) ↔ Azure Boards

### Board status vocabulary (single source)

The board vocabulary is defined once here and consumed by three
surfaces: the `provider_projects_*` verbs, the board workflow docs, and
the setup script's column provisioning.

- **Status storage**: a work item's status is its board column, stored in the
  Kanban column field `WEF_<guid>_Kanban.Column` (the guid is the board's, so
  the field is found on the item itself; `System.BoardColumn` mirrors it and is
  read-only). Writing the column moves `System.State` by the board's
  column-to-state mapping, so each of the 8 `status_workflow` words is distinct
  even though the process has four states (`Merged` and `Staging` sit on
  `Resolved`, `Production` on `Closed`). Reading returns the column, so every
  word reads back as itself. An item whose type has no board (an `Issue`) has no
  column: its status is its `System.State`.
- **Boards by type**: `User Story` and `Bug` share the Stories board, `Feature`
  the Features board, `Epic` the Epics board.
- **Vocabulary mapping**: the `status_workflow` words are the board's column
  names. A fork-local column name that differs maps through the
  `[azure_status_aliases]` block (`<word>=<column>`). `field_option_ids` passes a
  word through (or its alias); Azure rejects a value the board does not carry
  when it is written.
- **Setup constraint**: setup forces board column names and count to the
  configured workflow on each board, retaining existing mappings and reusing a
  supported in-progress mapping for new middle columns.

GitHub Projects (the `project-*` wrapper surface) map onto Azure Boards —
natively and, under the one-project constraint, arguably better than GH
Projects fits:

| GitHub shape | Azure shape | Constraint / note |
|---|---|---|
| Project (board) | Board (per team, per work-item type) | Boards are native, project-level, cross-repo |
| Status field (column) | Board column (the Kanban column field) | The board workflow's status-column vocabulary maps directly; the column field is the status |
| Project item | Work item | Already on the board by existing — no "add to project" step |
| Field (single-select) | Board column or field | Field-option ids → column names |
| Views | Board / backlog / query views | — |

The GH `projects_*` verb surface (8 verbs, as-built) translates to
Boards reads/updates: `projects_list` → boards list; `field_set` (Status) →
Kanban column write; `field_list` → the boards' column names; `item_add` → no-op-success (work items are born on the
board); `item_id_for_issue` → work-item id (identity). Constraint: the
fork standardizes **one board per work-item type** with the board
workflow's column vocabulary (the setup script provisions them).

## Pull requests ↔ Pull requests

View projection: `provider_prs_view` emits every field in pr-get's
DEFAULT_FIELDS non-null. Mapping: mergeable/mergeStateStatus derive from
Azure's `mergeStatus` (conflicts → CONFLICTING/DIRTY, succeeded →
MERGEABLE/CLEAN, else UNKNOWN); `labels` are the PR's own labels (removed
ones are inactive and left out); `reviewRequests`, `milestone`,
`comments`, `reviews` are typed empties — supplementary fetches (threads,
iterations) wait until a consumer needs real values. `isDraft` falls back
to false.

**List.** `--state open` is `status=active`, `merged` is `completed`, and
`closed` fetches `all` and drops the active PRs, so it covers abandoned PRs
as well. The list pages with `$top`/`$skip` (the API has no continuation
token) until a short page, and `--limit` stops the paging early.

**Merge.** One completion PATCH carries `lastMergeSourceCommit` (fetched
first; without it Azure leaves the PR active) and `completionOptions`:
`mergeStrategy`, `deleteSourceBranch`, `mergeCommitMessage` (subject and
body) and, for `--admin`, `bypassPolicy`. Completion is asynchronous — right
after the PATCH the PR is `active` with `mergeStatus: queued` — so the verb
polls (`AZURE_PR_MERGE_POLL_ATTEMPTS`, default 30, every
`AZURE_PR_MERGE_POLL_INTERVAL` seconds, default 2) until the PR is
`completed`, and reports `mergeFailureMessage` when the merge fails or the PR
is abandoned.

**Create.** `--label` becomes PR labels. `--reviewer` takes an identity
GUID as is; an email, account or display name is looked up through the
identities API on the `vssps` host and must match exactly one identity, else
the reviewer is reported and skipped while the PR stands. Azure pull requests
have no assignee, so `--assignee` is reported as ignored. A description past
Azure's 4000-character limit is cut and the full text is posted as the PR's
first comment.

**Diff.** Azure has no endpoint that returns patch text. `provider_prs_diff`
lists the changed files of the latest iteration: one path per line with
`--name-only`, otherwise one `{"path","changeType"}` object per line. A
caller that needs patch text diffs the two commits in a local clone.

**Review threads.** `pr-threads-get` emits thread ids as `<pr>/<thread>` and
comment ids as `<thread>/<comment>`; system threads (Azure's own notes) and
deleted threads are left out, and a thread is resolved when its status is
anything but `active` or `pending`. `pr-thread-resolve` takes the thread id
verbatim and routes it to the resolved repository (`DEVENV_REPO`, else the
working directory's repository); a `<repo>/<pr>/<thread>` form names the repo
explicitly. `pr-thread-reply` takes the comment id verbatim: the reply nests
under that comment (`parentCommentId`), and a bare thread id nests it under
the thread's first comment. Resolving sets the thread status to `fixed`.

The Tier 2 smoke exercises create, comment, merge and the thread verbs against a disposable repository and records their responses under `tools/tests/fixtures/azure/`; the outcome tests in `tools/tests/ts/` assert against those recordings.

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
the repository-type and policy-export consumers map onto policy-configuration
reads/writes per repo.

Error contract: the Azure policy writes throw a provider error on failure,
GitHub's report `{ok:false, stderr}`. The TypeScript facade converts the Azure
error into `{ok:false, stderr:<message>}`, so callers classify a failure (name
conflict, forbidden) the same way on both providers.

## Releases ↔ git tags (as-built: decision made)

GH Releases have no Azure equivalent. The implemented mapping (Option 1):
releases are git tags; `provider_org_releases_list` reads
`refs?filter=tags/` and projects the gh release shape (tagName, name,
publishedAt ← tagger date, isPrerelease ← semver-heuristic,
isDraft ← false — azure has no draft tags). `--json`/`-q` follow gh list
semantics. semantic-release's publish step becomes exec-plugin tag+push
(fork-side concern, outside this provider). The smoke lists releases of a
real repository; ordering, prerelease detection and dates are asserted by the Azure
provider suites in `tools/tests/ts/`.

## Packaging ↔ Azure Artifacts (as-built: decision made)

The packages reads of the artifact tools ride the domain verbs
(`provider_org_packages_list` / `provider_org_package_versions`) —
never raw `provider_api` pagination. Azure implements the list verb
against org-level Artifacts feeds (`feeds.dev.azure.com/_apis/packaging/feeds`,
PAT needs packaging scopes — an environment prerequisite), same source as
`provider_org_feeds_list`. GH Packages is per-user; azure feeds are
org-scoped — the shapes differ accordingly (the smoke lists the org's
feeds). The versions verb fails defined: azure package versioning is
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
script deliberately does not attempt. Several columns may share one process state:
each column is still a distinct status, because a work item's status is its
Kanban column field and `System.State` follows the board's column-to-state
mapping. The script also sets the default team's `bugsBehavior` to
`asRequirements`, so a Bug sits on the Stories board and carries a column.
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

`smoke.ts` validates every HTTP-touching verb in this provider
against a LIVE org in one combined flow. Manual invocation only — never
wired into tests or CI.

How to run:

```text
AZURE_SMOKE=1 AZURE_PAT=<token> AZURE_DEVOPS_ORG=<org> AZURE_SMOKE_TEST_PROJECT=<project> \
    [AZURE_SMOKE_REPORT=<path>] node tools/lib/providers/azure/smoke.ts
```

`AZURE_SMOKE=1` runs the read-only tier; `AZURE_SMOKE=write` runs the destructive tier and
also needs `AZURE_SMOKE_CONFIRM=<test project>` (the exact project name).
The PAT needs Code, PullRequest, WorkItems, Boards, Build, Packaging and
Policy management (read+write) rights; the suite never persists it.

Contract:

- **User-provided test project only.** The suite never provisions or
  deletes projects; every destructive case runs inside the named project
  and the org outside it is never touched.
- **Single combined flow:** fixtures first (work item + disposable repo
  via provider verbs), then every verb, then mandatory reverse-order
  teardown via an EXIT trap (fires even on a mid-suite death).
- **Teardown matrix (as implemented in the smoke's teardown):** work items delete with
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

Transport facts the smoke established (the regression tests in
`tools/tests/ts/provider-azure-*.test.ts` cover them):

- PR thread routes are repositories-qualified:
  `/_apis/git/repositories/{repo}/pullrequests/{id}/threads/{id}`. The
  status PATCH takes the thread object `{"status":"fixed"}` under plain
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
  `tools/tests/ts/provider-azure-*.test.ts`.
