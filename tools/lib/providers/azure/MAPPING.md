# Azure DevOps mapping — how GitHub shapes translate

> Status: working model, validated against live API behavior on 2026-09-27
> (Tier-1/Tier-2 smoke, org `OMS-FORT` / project `Devenv-fork-test`).
> Companion docs: [Forking.md](../../../../docs/Forking.md)
> (fork mechanics)
>
> The `provider_*` names used here are contract keys (vocabulary terms), not bash functions.
>
> This is the azure provider's durable mapping document: it lives with the
> code it describes, versions with it, and is the reference for the
> provider implementation (`tools/lib/providers/azure/`) and full-parity
> planning.
> Live API facts recorded here (merge completion PATCH, preview api-versions)
> are empirically verified, not aspirational. Rows marked **as-built**
> were reconciled against the shipped code at plan close (2026-09-30).

## Transport facts

Facts the implementation depends on; recorded here so planning sessions
don't re-derive them:

- **Git transport credentials**: `azureSetupGit` (`azure/auth.ts`) registers a
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
- **Package-feed configuration is provider-owned**: setup resolves npm and
  NuGet into an explicit configured record or a named skip. Unknown providers
  fail closed; a configured host is validated before any credential is
  written. GitHub defaults npm only to `npm.pkg.github.com`, while Azure requires
  an Azure Artifacts URL and supplies the fixed `azure` username.
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
  entity-encoded for `"` (`&quot;`) and `&` (`&amp;`); `<`, `>` and `'` are
  returned unchanged. A trailing newline is stored exactly as written (one
  stays one, none is not added; verified live). The provider boundary
  restores markdown: every long-text read un-escapes the entity set, and
  writes and reads pass newlines through untouched, so a round trip is exact
  at any number of trailing newlines. Known limit: the decode is lossy for
  look-alike input, since a typed `&quot;`, `&amp;` or `&lt;` reads back the
  same as the encoded form and is decoded, so markdown that legitimately
  contains those sequences changes on a read-then-write cycle.
- **HTML comments are stripped, so an artifact's header is stored as bare
  lines**: a comment published with a `<!-- DEVENV_ARTIFACT_V1 … -->` header
  loses the block in storage. The write path (`azureMarkerTransform`) keeps
  every key of the first marker block as `key: value` lines at the top of the
  body; the read path (`azureMarkerRestore`, applied in the comment mapping
  behind both comment reads) returns a body that opens with such a run, when
  it holds a `doc_id` key, in marker form again. Every other comment is
  returned unchanged, and the artifact readers above the provider only ever
  see the marker form. A comment stored before every key was kept returns
  the keys it holds.
- **PR completion is one PATCH, after a GET**: GET the PR for its
  `lastMergeSourceCommit`, then PATCH `{"status":"completed",
  "lastMergeSourceCommit":{"commitId":...},"completionOptions":{
  "mergeStrategy":"rebase","deleteSourceBranch":true}}`. The echoed commitId
  is REQUIRED — without it Azure accepts the PATCH but the PR stays active.
  (`rebase` is the default; `squash` and `noFastForward` are the other
  requestable values.) The strategy MUST be inside `completionOptions` on the completing PATCH:
  a top-level `mergeStrategy` (for example in a separate earlier PATCH) is
  silently ignored and Azure then applies its default, `noFastForward`, a
  two-parent merge commit. `prsMerge` therefore compares the completed PR's
  `completionOptions.mergeStrategy` with the requested one and reports a
  mismatch as an error. This is a detection, not a prevention: the PR is
  already completed by then, so the error says so.
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
- **Issue templates are target-repository content**: `[issues] template_dir`
  is interpreted from the target clone whose origin matches `DEVENV_REPO`.
  Azure forks can select a directory other than `.github/ISSUE_TEMPLATE`
  without changing `issue-create`.
- **Provider explanation is loader-owned**: the `explain` family is loaded
  from the provider manifest. Adding behavior to the provider explanation does
  not require a second registry in the tool.

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
in issue-get's DEFAULT_FIELDS non-null. Batch reads send `$expand: "relations"` and no `fields` list: Azure answers 400 for `$expand` combined with `fields`, and returns no relations for `"fields,relations"`. Mapping: milestone derives from
`System.IterationPath` (its leaf; "" for an item at the project root);
assignee and author logins are the identity's `uniqueName` (the display name
only when there is none); a list returns items in the query's id order;
closedAt from `Microsoft.VSTS.Common.ClosedDate`. `comments` is the comment
count: `view` reads it from the comments resource, `list` from the
`System.CommentCount` field (`0` when the field is absent), so
`--json comments` works on both. Every `url` is the work item's browser address
(`_workitems/edit/N`), never the `_apis/wit/workItems/N` API address.

| GitHub shape | Azure shape | Constraint / note |
|---|---|---|
| Issue | Work item, on a board-backed type | Born as the Azure type mapped for its devenv type (see [Work item types](#work-item-types)) |
| Open/closed | A state is closed when its category is Completed or Removed in the item's own work item type (read from the project's work item types) | `Resolved` is open; `close` moves the item to its type's Completed-category state, `reopen` to its first Proposed (else InProgress) state, both read from the type. The state change is conditional on the revision it was read at (a concurrent change is a named error); a `--comment` that fails to post after the state change is a warning on stderr and the exit stays 0 |
| Close reason | — | Azure has no close reason; `--reason` is accepted and dropped |
| Labels | `System.Tags` (`a; b`, trimmed on read) | No colors/descriptions — flat strings only; `edit` reads the current tags and writes the surviving set; label list reads the tags endpoint, else the project's work items |
| Issue types (Bug/Feature/Task/Epic) | Work-item types | Richer than GH types; a type change is a `System.WorkItemType` replace through `provider_issues_set_type`, never through `edit`. Known limit: the replace does not touch `System.State`, so a state the new type lacks fails the PATCH, and `--type` with `--body` runs the type change before the edit, so an edit failure leaves the type changed (not yet verified live) |
| Edit flags | `--title`, `--body`, `--add-label`, `--remove-label` | Any other flag (`--milestone`, `--add-assignee`) has no Azure write path and fails rather than being dropped. `--type` is accepted only together with `--body`, where it selects the body field; without a body it fails. Without `--type`, the item's current type (one read) selects the body field, so the edit lands in the field `view` reads (a Bug's `ReproSteps`, not a shadowed `Description`). Title, body and tag changes go in **one** JSON-patch, so a failure leaves the item unchanged. An edit that sets fields to the values they already hold is accepted: Azure answers 200 and creates no revision, so the verb re-reads the edited fields and treats a stored match as success. |
| Existence | `GET workitems/N` | Only a not-found answer (HTTP 404, TF401232) is "absent"; auth, network and server failures are errors |
| Create verification | Read-back of `System.Rev` after the POST | A failed read-back after a successful create returns the new id with a warning, so a retry never duplicates the item |
| Descriptions | `System.Description` with the markdown multiline format | Items last edited in the portal hold HTML; the read path un-escapes entities for them |
| Comments | Work-item comments, paged by continuation token | Posted with `?format=markdown` |
| Per-repo issue list | Project-wide WIQL | **As-built constraint**: lists are project-scoped (`TeamProject = @project`), not per-repo — see [Area-path convention](#area-path-convention-as-built-provisioning-only) |
| Milestones | Iterations | Config-mapped (existing `[azure] iteration` keys); no API parity claimed |
| Sub-issue graph (parent/child) | Work-item links (parent/child, relates-to) | Replaces the GH sub-issue graphql; the issue-graph verbs map onto relation queries. A failed link reports the real error unless the parent already lists the child; an unlink is guarded by a `test` op on `/rev`, so a concurrent relation change fails the write instead of removing a different relation |
| Blocked-by | `Dependency-Forward` work-item link from the blocked item to each blocker | Distinct from the parent/child hierarchy. The link type is pinned as `Dependency-Forward` (the item carries the link, pointing at the blocker as predecessor) **pending a live check** of the direction against a real organization. The facade applies a blocker list sequentially, because parallel relation writes on one work item race its revision; adding an existing link and removing an absent one are no-op successes |
| Comment edit | Work-item comment update | `PATCH …/workitems/{id}/comments/{commentId}?format=markdown` with `{ "text": … }`: `format` is a query parameter (a body field is ignored), and the body takes the same artifact marker transform as a comment add. The facade reads the comment back to return the record. The request shape comes from the smoke probe and the stubbed tests pin it, **pending a live check** |
| Reactions | — | No native equivalent; not mapped |

### Area-path convention (as-built: provisioning only)

GitHub issues live inside a repo; Azure work items live inside a project.
To preserve "list the issues of repo X", a project could carry **one
area path per repo** (`<project>\<repo-name>`). However, nothing in the
provider creates them, and the shipped
issue verbs do **not** tag or filter by `[System.AreaPath]`: `create`
assigns no area path (work items land in the project root area) and
`list`/`view` scope by `[System.TeamProject] = @project` — issue lists
are **project-wide**, not per-repo. Per-repo issue scoping via area
paths is a documented, unimplemented convention: a future change may adopt
it.

Constraint (if adopted): repo names must be valid area-path node names
(no `/`, no leading/trailing spaces). Violation → work items land in the
project root area; lists silently miss them.

### Work item types

A devenv issue type maps onto the Azure work item type that sits on a board:
`Epic` → `Epic`, `Feature` → `Feature`, `Bug` → `Bug`, and `Task` (and an
untyped issue) → `User Story`; the provider creates no plain `Issue` items.
An `[azure_issue_types]` block in `devenv.config` overrides or extends the map
(`<devenv type, lower-case>=<Azure type>`; the `untyped` key maps an issue
created without a type); a type with no mapping fails and names the key to add.
A create is made directly as its mapped type — the type is part of the create
URL — and the mapped type is probed first: one the project does not offer,
whether absent or disabled, fails before the create and names the key to set. The Agile process's `User Story`, `Bug`, `Feature` and
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
surfaces: the `projects` provider verbs, the board workflow docs, and the
board columns an admin configures in the Azure project.

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
workflow's column vocabulary, configured in the Azure project by an admin.

## Pull requests ↔ Pull requests

View projection: `provider_prs_view` emits every field in pr-get's
DEFAULT_FIELDS non-null. Mapping: mergeable/mergeStateStatus derive from
Azure's `mergeStatus` (conflicts → CONFLICTING/DIRTY, succeeded →
MERGEABLE/CLEAN, rejectedByPolicy → UNKNOWN/BLOCKED, failure →
UNKNOWN/DIRTY, else UNKNOWN); `labels` are the PR's own labels (removed
ones are inactive and left out); `reviewRequests`, `milestone`,
`comments`, `reviews` are typed empties — supplementary fetches (threads,
iterations) wait until a consumer needs real values. `isDraft` falls back
to false.

**List.** `--state open` is `status=active`, `merged` is `completed`, and
`closed` fetches `all` and drops the active PRs, so it covers abandoned PRs
as well. The list pages with `$top`/`$skip` (the API has no continuation
token) until a short page, and `--limit` stops the paging early.

**Merge.** The verb first reads the PR and waits while `mergeStatus` is
`queued` or `notSet` (the same poll limits as below), because
`lastMergeSourceCommit` is the commit of the last merge simulation and is
stale right after a push. It then resolves the source branch's real tip
(`refs?filter=heads/<branch>`) and refuses unless the tip equals that
commit (and `matchHeadCommit`, when given); a fork PR skips the tip check
(its branch is in another repository) and a completed or abandoned PR is
named as such. One completion PATCH carries
`lastMergeSourceCommit` (without it Azure leaves the PR active) and
`completionOptions`: `mergeStrategy`, `deleteSourceBranch`,
`mergeCommitMessage` (subject and body) and, for `--admin`, `bypassPolicy`
with a `bypassReason`. Completion is asynchronous — right
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
first comment; if that comment fails the PR number is still returned and a
warning is printed.

**Diff.** Azure has no endpoint that returns patch text. `provider_prs_diff`
lists the changed files of the latest iteration: one path per line with
`--name-only`, otherwise one `{"path","changeType"}` object per line (a renamed file also
carries `originalPath`). A
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

Direct mapping (runs list/view with gh `--json`/`-q` semantics, artifacts,
watch with `--exit-status` conclusion mapping, workflow list/run with
default-branch ref resolution, cancel, rerun, download with `-n`/`-D`). The
behaviors below were verified against live Azure DevOps (research R3):

- **`--field k=v` inputs** are sent as `templateParameters` (strings) and reach
  the pipeline's declared YAML parameters. They are not sent as `parameters`:
  that field is for queue-time variables, and Azure rejects a queue whose
  `parameters` name a declared pipeline parameter (HTTP 400). A name the
  pipeline does not declare is Azure's own 400 (`Unexpected parameter 'k'`),
  passed through unchanged. A pipeline name shared by several definitions is
  refused with the ids; pass the numeric id.
- **Rerun** is `PATCH builds/{id}?retry=true`: a new attempt of the same
  build id (the id and URL do not change; the response is already
  `notStarted`). Retrying a build whose previous attempt did not fail is a 500
  from Azure, reported as "run N did not fail; there is nothing to rerun".
- **Watch** polls every 10 s up to 120 times (`AZURE_PIPELINE_WATCH_INTERVAL`
  and `AZURE_PIPELINE_WATCH_ATTEMPTS` tune them; whole seconds and counts
  only, anything else falls back to the default), tries a transiently failed
  poll again (a lost connection, a timeout, a 429 or a 5xx; up to five in a
  row, while a missing or rejected credential or a missing run stops at once),
  and writes progress to stderr and the final run record to stdout.
- **Artifacts**: the size is `resource.properties.artifactsize` (a string);
  Azure gives no creation date, so `created_at` is empty. A `PipelineArtifact`
  (the `publish:` step) downloads from its own `artifacts.visualstudio.com`
  host, whose URL is used exactly as returned (no api-version is added). A
  download is written to a temporary file and renamed, so a failure never
  removes an earlier file, and a run without artifacts is an error.
- **Filters** (not verified live): `in_progress` also asks for builds being
  cancelled (`statusFilter=inProgress,cancelling`); a run's update time is its
  finish time, else its start time; with a repository given, the workflow list
  asks for that repository's definitions (`repositoryId`) and pages through
  them; a ref that already starts with `refs/` (a tag) is passed through.

## Org rulesets ↔ Branch policies

| GitHub shape | Azure shape | Constraint / note |
|---|---|---|
| Org ruleset | Repo branch policy **configuration set** | Azure policies are repo-scoped, not org-scoped |
| Ruleset conditions (target branches) | Policy `matchKind`/`pattern` on ref | — |
| Require PR / reviews / status checks | Minimum reviewers, build validation policies | Policy ids differ per repo — the policy tools name a default set |

Translation: only the `pull_request` rule becomes a policy (minimum
reviewers, with `dismiss_stale_reviews_on_push` as `resetOnSourcePush`). Every
other rule type, and every `pull_request` parameter without an Azure setting,
is named in one warning, once per name. The payload's `enforcement` maps to
the policy's flags: `active` is enabled and blocking, `evaluate` enabled and
non-blocking, `disabled` disabled. Configuration reads page through every
result; the repository and policy-type filters are sent and applied again on
our side. An existing policy is found through any of its scope entries, but a
policy that covers several scopes is never rewritten or retired (the portal is
the place to edit it), and neither is one that names no branch.

Constraint: there is no org-level ruleset API surface; parity means the
**the repo-create flow and the policy tools apply the standard policy set per repo**.
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
semantics. Tags are ordered by semantic-version precedence (a release above
its prereleases, prerelease identifiers compared left to right with numeric
ones numerically, so `rc.10` is above `rc.2`, build metadata ignored). A
refused credential while reading a tag date fails the listing; a missing date
is blank. semantic-release's publish step becomes exec-plugin tag+push
(fork-side concern, outside this provider). The smoke lists releases of a
real repository; ordering, prerelease detection and dates are asserted by the Azure
provider suites in `tools/tests/ts/`.

## Packaging ↔ Azure Artifacts (as-built: decision made)

The packages reads of the artifact tools ride the domain verbs
(`provider_org_packages_list` / `provider_org_package_versions`) —
never raw `provider_api` pagination. Azure implements the list verb
against the organization's and the project's Artifacts feeds, each once
(`feeds.dev.azure.com/{org}/[{project}/]_apis/packaging/feeds`,
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

## Project provisioning (manual)

No script provisions the Azure project. An admin prepares it once, by hand,
so that it matches this document:

- Board columns on each board (Stories, Features, Epics) carry the
  `[workflows] status_workflow` vocabulary and count. Several columns may
  share one process state: each column is still a distinct status, because a
  work item's status is its Kanban column field and `System.State` follows the
  board's column-to-state mapping. Added columns need an in-progress mapping
  that supports them; creating NEW work-item states is a process-template
  change.
- The default team's `bugsBehavior` is `asRequirements`, so a Bug sits on the
  Stories board and carries a column.
- Optionally, one area path per repo (see the area-path convention above).

What the provider does automate on the host side is credential handling: the
`setup.bash` and `bootstrap.bash` hooks validate and store the PAT and detect
the organization, and `azureSetupGit` (`azure/auth.ts`) wires the git
credential helper (see Transport facts).

## Change discipline

This document describes the mapping the CODE implements. When the provider
implementation changes a mapped behavior, update the matching table row in
the same change; when a new constraint is discovered live, record it here
with the date and evidence. Transport-level facts (api-versions, body
regimes, merge steps) are verified against
`https://dev.azure.com` REST api-version 7.1 unless noted otherwise.

## Live smoke suite

`smoke.ts` validates the HTTP-touching verbs of this provider against a LIVE organisation, by
hand only. How to opt in, what each probe creates and deletes, the safety model, the cautions and
the manual cleanup are in [SMOKE.md](SMOKE.md).

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
