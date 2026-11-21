# Azure smoke suite

`smoke.ts` is the live validation suite for the Azure DevOps provider. It drives the provider's
TypeScript modules and transport (`azureHttp`) against a real Azure DevOps organisation, inside
one disposable test project, in one combined flow. The GitHub counterpart is
[../github/SMOKE.md](../github/SMOKE.md); how Azure concepts map onto the contract is in
[MAPPING.md](MAPPING.md).

## When to run it

On demand, by hand, when the Azure adapter layer changes: a verb added or changed, a change to
the REST transport, api-versions or pagination, a change to how work items, pull requests or
policies are mapped. It is never run by CI and never by the regular vitest run: it lives outside
`tools/tests/ts/`, no vitest include pattern matches it, and no regular test imports it
(`tools/tests/ts/provider-smoke-guard.test.ts` pins that, and that the suite refuses to run
without an opt-in and without contacting a backend).

## How to opt in

| Variable | Required | Value |
|---|---|---|
| `AZURE_SMOKE` | yes | `1` for the read-only tier, `write` for the destructive tier; anything else makes the suite refuse (exit code 2, a message containing "refuses to run") |
| `AZURE_DEVOPS_ORG` | yes | the live organisation |
| `AZURE_SMOKE_TEST_PROJECT` | yes | a blank, disposable project that already exists; the suite never creates or deletes projects |
| `AZURE_PAT` | yes | a personal access token, read from the invocation environment and never persisted |
| `AZURE_SMOKE_CONFIRM` | for `write` | the exact test project name; a mismatch refuses with exit code 2 |
| `AZURE_SMOKE_REPORT` | no | a file path; every probe line is appended to it |
| `AZURE_SMOKE_STATUS_WORKFLOW` | no | a comma-separated list of Kanban column names; enables the status round-trip probes, which are skipped when unset |
| `AZURE_SMOKE_TEST_REPO` | no | overrides the throwaway repository name; a repository that already exists under that name is refused before anything is created |

```bash
AZURE_SMOKE=write AZURE_SMOKE_CONFIRM=<project> AZURE_PAT=<token> \
  AZURE_DEVOPS_ORG=<org> AZURE_SMOKE_TEST_PROJECT=<project> \
  node tools/lib/providers/azure/smoke.ts
```

The suite sets `AZURE_DEVOPS_PROJECT` to the test project for the whole run, so every verb call
resolves its targeting from the test project.

## Scenarios

The suite has no scenario registry: it is one script of probes in a fixed order. Each probe
prints one PASS or FAIL line.

### Read-only tier (`AZURE_SMOKE=1`)

Pre-flight: the test project must exist in the organisation (fail fast otherwise). Then:

| Family | Probes |
|---|---|
| auth and transport | authenticated project list; repositories list through pagination (`repos_list`); a WIQL query |
| boards | boards list for the project's default team; the `Issue` and `User Story` work item types each have an in-progress and a completed state |

Without fixtures the read tier cannot read a work item or a repository it made, so it uses the
first repository the list returns for the repository reads (`prs_list`, `repos_view`,
`repos_default_branch`, `repos_commits_count`, `org_releases_list`, `org_rulesets_list`) and
`org_feeds_list`. Nothing is created or changed.

### Destructive tier (`AZURE_SMOKE=write`)

| Family | What it creates, edits, deletes |
|---|---|
| fixtures | creates a work item `[SMOKE-DELETEME] fixture item` and a repository `smoke-repo-<pid>-<timestamp>` (the fixture reads then run: `issues_view`, `issues_exists`, `issues_comments`, `prs_list`, default branch and commit count of the empty repository, `org_releases_list`, `org_rulesets_list`, `org_feeds_list`) |
| issues | creates a work item `smoke destructive item`, comments on it, closes it, then edits its title, adds, reads and edits a comment, reopens it, changes its type to Task, adds and lists tags, and checks the tag-edit sequence (two adds leave two tags, add keeps existing tags, remove drops only the named tag); creates `smoke child item` and links, reads children and parent, unlinks, and deletes it; creates `[SMOKE-DELETEME] board story` (a User Story), `[SMOKE-DELETEME] board bug` (a Bug through `issues_create --type Bug`) and `[SMOKE-DELETEME] retyped` (an untyped create, checked to be the untyped mapping — `User Story` unless `[azure_issue_types]` sets `untyped` — then set to Bug) |
| projects | sets a Status through `projects_field_set` on the work item, reads `projects_for_issue`, and, when `AZURE_SMOKE_STATUS_WORKFLOW` is set, writes and reads back every listed Kanban column for the Issue, User Story and Bug items |
| repos | seeds `main` with a README by pushing from a temporary clone, creates a branch, patches the repository description (`repos_patch`), applies a minimum-reviewers branch policy (`repos_protect_branch`), and grants the project's team pull access (`repos_team_put`) |
| pull requests | pushes `smoke-<pid>` and opens a pull request, rebase-merges it with branch deletion and checks it completed with the rebase strategy, the source branch is gone and history is linear; pushes `smoke2-<pid>` and opens a second pull request for the thread verbs (`prs_thread_create` twice, `prs_thread_reply`, `prs_thread_resolve`, plain `prs_comment`, `prs_view`, `prs_diff`), then abandons it with a raw PATCH; checks the `merged` and `closed` list filters |
| pipelines | lists pipeline definitions (expected empty); dispatch, cancel and download are not exercised because the disposable repository has no pipeline definition |
| org | creates a ruleset (a minimum-reviewers policy), updates it, and lists rulesets; a rejected duplicate counts as success only when an equivalent policy is verifiably present |

The regular test suite covers provider-explain output/routing, provider feed
host rejection, URL helpers, and provider facade contracts with offline
fixtures. These are not duplicated as live smoke mutations because they do
not require an Azure write to establish their mapped behavior.

## Safety model

- **Test project only.** Every destructive probe runs inside the named project; the organisation
  outside it is not touched. The suite refuses to start unless the project exists.
- **Naming.** Work items created as fixtures carry `[SMOKE-DELETEME]` in the title; some
  work items made by probes are titled `smoke destructive item` and `smoke child item` instead.
  The repository is `smoke-repo-<pid>-<timestamp>`, branches are `smoke-<pid>` and `smoke2-<pid>`.
- **Recording.** Each item that needs teardown is recorded, through the module shared with the
  GitHub suite (`../smoke-teardown.ts`): work items by id at the moment they exist, a policy
  sweep for the repository, and the temporary directory holding the clone and the credential
  helper. The fixture repository is recorded before its create call when its name is the generated
  one (`smoke-repo-<pid>-<timestamp>`, unique to the run), and the record counts as confirmed once
  the create succeeds. With an `AZURE_SMOKE_TEST_REPO` override the name cannot be proven unique,
  so the repository is recorded only after its create call succeeds.
- **Teardown.** There is exactly one teardown run, in reverse order of recording. It runs after
  the last probe, on SIGINT or SIGTERM (exit code 130) and on an uncaught exception or
  unhandled rejection (exit code 1; the run is marked interrupted so no further probe starts).
  The final pass, a second signal and the error handler all wait for that same run: a repeated
  Ctrl-C prints `teardown in progress` and neither exits nor starts a second pass, and exit code
  130 happens only after the run and any late cleanups have settled. If a cleanup hangs, the
  repeated signal also prints how to leave: stop the process with a signal the suite does not
  catch (`kill -9 <pid>`, or Ctrl-\ for SIGQUIT in a terminal), then remove what is left by hand
  with the manual commands it prints (the same ones as under "Manual cleanup if teardown fails").
  After an interrupt the next probe stops the script, so no further verb is exercised. The
  fixture repository's create call is tracked as in flight: teardown first waits for it (for at
  most 120 seconds; after that it prints `create still in flight after <N>s; it may exist:`
  with the manual command and carries on), so a signal during the create cannot leak the
  repository when the generated name was recorded. An item that an in-flight call records after
  teardown began is cleaned up immediately and the run waits for it. Work items are destroyed
  (`?destroy=true`); the repository is deleted by trying name plus destroy, then id plus destroy,
  then a plain soft delete, and its cleanup succeeds when any variant succeeded or answered not
  found; every policy configuration scoped to the repository is deleted. Only an HTTP 404
  counts as already removed; any other failing delete (a surviving repository, work item or
  policy) is reported with `TEARDOWN FAILED` and a manual command, the rest continue, and the exit
  code is non-zero. A cleanup that fails for a repository whose create never succeeded is
  printed as a `notice:` instead and does not change the exit code. A repository whose create
  call fails stops the destructive tier before any write probe, after teardown of what was
  created so far.
- **Refusals.** Without `AZURE_SMOKE` it refuses (exit 2); the destructive tier refuses without a
  matching `AZURE_SMOKE_CONFIRM` (exit 2); a missing organisation, project or token, an
  authentication failure, or a missing test project aborts with exit 1.
- **Tokens.** The transport redacts the token on every path, so output and reports are safe to
  keep.
- **Limits.** The shared module enforces a cap of 100 recorded items per run (a run records
  about twenty); an item recorded over the cap is still torn down, and the probe that hit the cap
  fails. A hard abort (SIGKILL, power loss) ends the process without teardown. Work items
  and the policy sweep are recorded after their create call, so a work item whose create the
  server finished but the client never saw return is not torn down; the same holds for an
  override-named repository.

## Cautions

### Permissions and token scopes

The token needs Code, Pull Request, Work Items, Boards, Build and Packaging access, plus Policy
management read and write, and the identity must be able to create repositories in the test
project. A token without Code write fails the seed push, and every pull request probe then fails.
The seed and branch pushes use `git` over HTTPS with `GIT_ASKPASS` pointing at a small script
in a temporary directory; the script only prints `AZURE_PAT` from the environment, so the token
itself is not written to disk, and the directory is removed at teardown.

### Cost and effects

- The suite writes only inside the test project, but a destroyed repository is soft deleted when
  the destroy forms are refused, and then stays in the project's deleted-repository list until
  someone purges it.
- `AZURE_SMOKE_TEST_REPO` replaces the throwaway repository name. The suite reads that name
  before creating anything and refuses (exit code 1) when a repository already exists under it.
  The read treats any failed response as absent, so if the read itself fails the creation then
  decides: it fails for an existing repository, and the suite stops before any write probe. Use
  a name that no repository has.
- Pull requests and work items can notify project members and subscribers.
- Azure DevOps applies rate limiting per identity; the suite makes a few hundred requests.

### What is not undone automatically

A repository that fell back to a soft delete (still listed as deleted), notifications already
sent, the audit trail, and anything created after a run was killed without a signal handler
running (SIGKILL, power loss), a work item or override-named repository whose create call the
server finished but the client never saw return, and an override-named repository whose create
was still in flight when a signal arrived.

### Probes that skip, and why

| Skip | Reason |
|---|---|
| fixture provisioning | the read-only tier creates no fixtures |
| commit count before the push | the empty repository has no commits yet |
| issue reads | the fixture work item could not be created |
| pull request cases | the head branch was not pushed, so the PR probes fail rather than skip |
| status round-trip | `AZURE_SMOKE_STATUS_WORKFLOW` is not set |
| PR list state filters | the repository has no pull requests |
| pipeline write cases | the disposable repository has no pipeline definition |

### Manual cleanup if teardown fails

Leftovers are found by name. Repositories start with `smoke-repo-`; work items are titled with
`[SMOKE-DELETEME]` or start with `smoke`. In the portal, open Project settings, then
Repositories, and delete the matching repository (and purge it from the deleted list); in
Boards, query work items whose title contains `smoke` and delete them permanently; in Project
settings, Repositories, Policies, remove policies on the deleted repository. With the Azure CLI,
`az repos list --project <project>` and `az boards query` can list candidates, and
`az repos delete --id <id> --project <project> --yes` and
`az boards work-item delete --id <id> --destroy --yes` remove them.

## Reading the output

One line per probe: `PASS  name — detail`, `FAIL  name — detail` or `SKIP  reason`, with a
heading block naming the target (`org`, test project, tier) and a final line
`summary: N pass, F fail` (skips are not counted). Teardown failures print as
`TEARDOWN FAILED: <kind> <id> — reason`, followed by a leftover list with one manual command each. With `AZURE_SMOKE_REPORT` set, the PASS, FAIL
and summary lines are also appended to that file.

| Exit code | Meaning |
|---|---|
| 0 | every probe passed and teardown succeeded |
| 1 | a probe failed, teardown failed, or the run aborted (missing input, authentication, missing test project, a pre-existing throwaway repository, an uncaught error after teardown) |
| 2 | the opt-in gate refused to run (no or wrong `AZURE_SMOKE`, unconfirmed destructive tier) |
| 130 | interrupted by SIGINT or SIGTERM; exits only after the single teardown run and any late cleanups have settled |
