# GitHub smoke suite

`smoke.ts` is the live validation suite for the GitHub provider. It drives the provider facade
(and, for the few verbs the facade does not expose, the GitHub modules) against a real GitHub
organization, so a change to the adapter layer can be checked against the real service instead
of stubs. The Azure counterpart is [../azure/SMOKE.md](../azure/SMOKE.md); the verb inventory the
suite is derived from is [../CONTRACT.md](../CONTRACT.md).

## When to run it

On demand, by hand, when the GitHub adapter layer changes: a verb added, renamed or changed, a
change to the `gh` transport or its argument building, a `gh` upgrade, or a change to how the
facade normalizes a GitHub result. It is never run by CI and never by the regular vitest run:
it lives outside `tools/tests/ts/`, no vitest include pattern matches it, and no regular test
imports it. `tools/tests/ts/provider-smoke-guard.test.ts` pins all of that and also checks that
the suite's scenario registry covers every verb in the contract's GitHub column.

## How to opt in

The suite refuses to run (exit code 2, a message containing "refuses to run", no request made)
unless every required variable is set:

| Variable | Required | Value |
|---|---|---|
| `GITHUB_SMOKE` | yes | exactly `write`; the suite is destructive and has no read-only tier, so any other value (including `1`) is refused |
| `GITHUB_SMOKE_OWNER` | yes | the organization that receives the throwaway items; it must be an organization (not a user account) visible to the `gh` login |
| `GITHUB_SMOKE_CONFIRM` | yes | the same organization name, repeated exactly |
| `GITHUB_SMOKE_ALLOW_REAL_ORG` | only for the real organization | the organization name again; required when `GITHUB_SMOKE_OWNER` equals the organization configured in `devenv.config` (`[organization] org`, or the setup seed file), compared case-insensitively |
| `GITHUB_SMOKE_COLLABORATOR` | no | a GitHub login; enables the collaborator scenario, which invites that account to the throwaway repository |
| `GITHUB_SMOKE_REPORT` | no | a file path; every output line is appended to it |

Credentials come from `gh`'s own store (`gh auth login`); the suite never reads, stores or prints
a token. Run it directly:

```bash
GITHUB_SMOKE=write GITHUB_SMOKE_OWNER=<test-org> GITHUB_SMOKE_CONFIRM=<test-org> \
  node tools/lib/providers/github/smoke.ts
```

`node tools/lib/providers/github/smoke.ts --list-coverage` prints the scenario registry as JSON
and exits before the opt-in gate, without any request.

Use a dedicated test organization. When the suite runs, it points the provider layer at a
temporary `devenv.config` that names the GitHub provider, so the facade targets GitHub whatever
the workspace is configured for; an ambient `DEVENV_REPO` or `GH_REPO` is cleared for the run.

## Scenarios

Every scenario is registered with the contract verbs it exercises. The registry is data, and the
guard test compares it with the contract table: each verb in the GitHub column is exercised or is
listed as excluded with a reason. After each scenario that ran without a skip or failure, the
suite also fails it if a declared verb was never actually called.

Facade verbs are called through `tools/lib/providers/facade/`. The fixtures that no verb covers
(creating a branch and a file, a milestone, a team, a project, closing a pull request, deleting
things at teardown) go through the same `gh` transport, `ghApi` in `github/transport.ts`.

### Repositories

| Scenario | Creates, edits, deletes |
|---|---|
| repository create and inspect | creates the private throwaway repository `<owner>/devenv-smoke-<pid>-<timestamp>` with a README; reads it back (`repos_view`, `repos_exists` for the repository and for a name that was never created, `repos_commits_count`, `repos_tree_count`, `repos_squash_merge_allowed`, `repos_list`) |
| repository settings | edits the description (`repos_edit`), disables the wiki and projects (`repos_patch`, `repos_patch_with_error`), and provokes an API error (a default branch that does not exist) to check the message is surfaced |
| repository from a directory | creates a local temporary directory with `git init` and an `origin` remote, and checks `repos_name_with_owner` resolves it; no remote is contacted by git |
| team access | creates an organization team `devenv-smoke-team-<pid>-<timestamp>`, grants it pull access to the repository (`repos_team_put`), verifies it, and deletes the team at teardown |
| collaborator access | only with `GITHUB_SMOKE_COLLABORATOR`: invites that login with pull access (`repos_collaborator_put`) |

### Issues

| Scenario | Creates, edits, deletes |
|---|---|
| labels | creates two labels (`issues_label_ensure` twice to check idempotence, `issues_label_create`), lists them, renames and recolours one (`issues_label_update`) |
| milestones | creates a milestone through the transport and checks `issues_milestones` lists it |
| create and read | creates issues A, B and C (`issues_create`, A with a label), then reads them (`issues_view`, `issues_list`, `issues_exists` for a present and an absent number, `issue_web_url`) |
| edit and comments | edits A's title, body and labels and B's milestone (`issues_edit`); posts comments on A (`issues_comment`, `issues_comments`, `issues_comment_add`, `issues_comment_get`, `issues_comment_edit`) |
| sub-issue graph | links B under A, reads children and parent, unlinks (`issue_graph_*`) |
| blocked-by | records C as a blocker of A and removes it again (`issue_blocked_by_add`, `issue_blocked_by_remove`); both edit A's body |
| close and reopen | closes B with a comment, reopens it with a comment, closes it as not planned (`issues_close`, `issues_reopen`) |
| native types | lists the organization's issue types (`org_issue_types`); when it defines any, sets the first one on C (`issues_set_type`) |

### Projects (organization-level writes)

| Scenario | Creates, edits, deletes |
|---|---|
| project create and edit | creates an organization project `devenv-smoke-project-<pid>-<timestamp>`, edits its title and description, then checks `projects_list`, `projects_number_by_name` and `projects_id_by_name` find it under the new title |
| project items and fields | adds issue A (`projects_item_add`) and issue B by title (`projects_add_issue`) as project items, finds A's card (`projects_item_id_for_issue`), lists fields (`projects_field_list`), and moves A's Status to `In Progress` and then `Done` (`projects_field_option_ids`, `projects_field_set`), checking `projects_for_issue` after each |
| project close | closes the project and checks it reads closed |

### Pull requests

| Scenario | Creates, edits, deletes |
|---|---|
| open a pull request | creates the branch `smoke-pr1-<pid>` with one commit (`SMOKE1.md`) through the REST API, opens pull request 1 (`prs_create`), reads it (`prs_list`, `prs_view`, `prs_diff` with and without `--name-only`) |
| review threads | creates the branch `smoke-pr2-<pid>` (`SMOKE2.md`), opens pull request 2, posts a plain comment (`prs_comment`), opens an inline and a general thread (`prs_thread_create`), lists threads (`prs_threads_page`), replies and resolves (`prs_thread_reply`, `prs_thread_resolve`) |
| merge and state filters | rebase-merges pull request 1 and deletes its branch (`prs_merge`), waits for `MERGED`, closes pull request 2 unmerged, and checks `prs_list --state merged` and `--state closed` separate them |

### Pipelines

| Scenario | Creates, edits, deletes |
|---|---|
| dispatch and observe a run | pushes `.github/workflows/smoke.yml` (a `workflow_dispatch` job that sleeps 25 seconds and uploads one artifact) to the default branch, waits for the workflow to register, dispatches it (`pipelines_workflow_list`, `pipelines_workflow_run`), finds the run (`pipelines_run_list`), reads and watches it to success (`pipelines_run_view`, `pipelines_run_watch`), lists and downloads the artifact (`pipelines_run_artifacts`, `pipelines_run_download`) |
| rerun and cancel | reruns the run and cancels the new attempt (`pipelines_run_rerun`, `pipelines_run_cancel`) |

### Organization

| Scenario | Creates, edits, deletes |
|---|---|
| rulesets | creates a repository ruleset in disabled enforcement, finds it in the list, reads it, renames it (`org_ruleset_create`, `org_rulesets_list`, `org_ruleset_get`, `org_ruleset_update`) |
| releases and packages | lists releases (`org_releases_list`, expected empty); queries the owner's npm packages and, when one exists, its versions (`org_packages_query`, `org_package_versions_query`); nothing is published |

### URL helpers and authentication

One scenario checks the offline helpers (`web_host`, `web_url`, `pr_web_url`, `extract_url`,
`remote_to_spec`, `remote_to_web`, `git_transport_url`) against the throwaway repository's
address and `auth_status_ok` against the real `gh` login. It creates nothing.

### Excluded verbs

The contract lists four GitHub verbs as known gaps, so there is nothing to exercise:
`provider_repos_default_branch`, `provider_repos_protect_branch`, `provider_org_packages_list`
and `provider_org_package_versions`. The guard test requires the suite's excluded list to equal
the contract's GitHub gaps exactly, so a gap that is closed must gain a scenario.

## Safety model

- **Naming.** The throwaway repository is `devenv-smoke-<pid>-<timestamp>`; the project is
  `devenv-smoke-project-<pid>-<timestamp>`; the team is `devenv-smoke-team-<pid>-<timestamp>`;
  labels, the milestone, branches and the ruleset carry `smoke` and the process id.
- **The suite creates its own repository.** Before creating it, the suite checks the name does
  not exist and refuses to continue if it does. Every repository-scoped call targets that one
  repository; the only other repository name read is the throwaway name with `-absent` appended,
  to prove an absent repository reads as absent. No pre-existing repository or project is used.
- **Recording.** Every resource is recorded by identifier at the moment it is created: the
  repository, branches, labels, milestone, issues, pull requests, ruleset, workflow run, team,
  project, collaborator invitation and the temporary directory. Items that live inside another
  recorded item and cannot be addressed separately (comments, sub-issue links, blocked-by lines,
  project items, the workflow file, commits) end with their parent.
- **Teardown.** Runs in a `finally`, and on SIGINT and SIGTERM (exit code 130). It deletes only
  recorded items, newest first, so the repository goes second to last, ahead only of the temporary
  directory, which was recorded first. Issues are deleted, or closed when deletion is refused; pull requests are closed; labels,
  the milestone, branches, the ruleset, runs, the team, the collaborator and the project are
  deleted. A failing step is reported and the rest continue. The repository delete refuses to run
  unless the name is exactly the one the run created.
  An operation still in flight when the run is interrupted can create one more item after the
  teardown pass; that item is cleaned up immediately when it is recorded, and the run waits for
  those late cleanups before it exits. If the project create call succeeds but its response cannot
  be read, the project's identifier is unknown, so it cannot be deleted automatically: teardown
  reports it as a leftover with the command to find it.
- **Failure handling.** A failing probe never stops the run; a scenario that cannot proceed
  because a prerequisite was not created is reported as a skip. Failure to create the repository
  stops the run (nothing else can work). Teardown failures are printed loudly with a manual
  command per leftover item and the prefix queries below, and make the exit code non-zero.
- **Resource cap.** At most 60 resources are recorded in one run; the run stops before creating
  more.
- **Refusals.** It refuses to run without the full opt-in, when the owner is the configured
  organization without the extra confirmation, when the owner is not an organization visible to
  the login, when `gh` is not authenticated, and when the target repository name already exists.
- **Tokens.** Output is scrubbed of anything shaped like a GitHub token and of the literal
  `GH_TOKEN` and `GITHUB_TOKEN` values before it is printed or written to the report.

## Cautions

### Permissions and token scopes

Use a login that can create and delete repositories, teams and projects in the test organization
(an organization owner is simplest). With a classic token the suite needs `repo`, `delete_repo`,
`workflow`, `project`, `admin:org` (team creation and deletion) and `read:packages`. A
fine-grained token needs the equivalent organization and repository permissions. A missing scope
mostly shows as a skip (project, workflow, packages) or a failed probe; a missing `delete_repo`
shows as a teardown failure and leaves the repository behind.

### Cost and effects

- The throwaway repository is private and is deleted at the end. Organization owners can restore
  a deleted repository for a limited time; the audit log keeps the create and delete events.
- Organization-level items are created and removed: a team and a project. Both appear in the
  organization's audit log permanently.
- The Actions scenario runs one workflow of about half a minute plus a cancelled rerun, which
  counts against the organization's Actions minutes. Without Actions, it skips.
- Creating issues, pull requests, comments and threads can send notifications to anyone watching
  the repository or the new team, and the collaborator scenario sends an invitation email to a
  real account. Use `GITHUB_SMOKE_COLLABORATOR` only with an account that expects it.
- A run makes several hundred `gh` calls, so it uses a noticeable part of the hourly API rate
  limit; do not run it in a loop.

### What is not undone automatically

Audit log entries, Actions minutes already used, notifications and invitation emails already
sent, and the restore window of a deleted repository. A run killed with SIGKILL, a power loss or
a lost network connection runs no teardown at all.

### Scenarios that skip, and why

| Skip | Reason |
|---|---|
| collaborator access | `GITHUB_SMOKE_COLLABORATOR` is not set |
| team access | team creation was refused (missing scope or organization policy) |
| milestones | the milestone fixture was refused |
| native types | the organization defines no issue types; the suite does not create organization-wide types |
| project scenarios | project creation was refused (missing `project` scope or permission) |
| dispatch and observe a run, rerun and cancel | the workflow file push was refused (missing `workflow` scope, Actions disabled), the workflow did not register within 60 seconds, or no run appeared within 90 seconds |
| rulesets | rulesets are unavailable for the plan or repository visibility (private repositories on the free plan) |
| releases and packages | the token lacks `read:packages` (the query probe), or the owner has no npm package to query versions of |
| any dependent scenario | a prerequisite (issue A, a project, a pull request, a run) was not created |

### Manual cleanup if teardown fails

The teardown report prints one command per leftover item. To find leftovers by prefix:

```bash
gh repo list <owner> --limit 200 --json name -q '.[].name' | grep '^devenv-smoke-'
gh project list --owner <owner> --format json | grep devenv-smoke-project-
gh api orgs/<owner>/teams --paginate --jq '.[].slug' | grep '^devenv-smoke-team-'
```

Delete a repository with `gh repo delete <owner>/<name> --yes` (needs `gh auth refresh -s
delete_repo`), a project with `gh project delete <number> --owner <owner>`, and a team with
`gh api -X DELETE orgs/<owner>/teams/<slug>`. Deleting the repository removes the issues, pull
requests, labels, milestone, branches, ruleset and runs inside it.

## Reading the output

Each scenario prints a heading `[family] scenario`, then one line per probe:

- `PASS  name` — the verb call succeeded and its outcome was verified;
- `FAIL  name — reason` — the call threw or the outcome was wrong;
- `SKIP  name — reason` — the scenario or probe could not run and says why;
- `recorded <kind> <id>` — a resource was recorded for teardown;
- `teardown ok:` and `TEARDOWN FAILED:` lines during teardown.

The last line is `summary: N pass, F fail, S skip; R resources recorded, T teardown failures`.

| Exit code | Meaning |
|---|---|
| 0 | no probe failed and teardown succeeded (skips do not fail the run) |
| 1 | a probe failed, teardown failed, or the run aborted (authentication, target checks, repository creation) |
| 2 | the opt-in gate refused to run |
| 130 | interrupted by SIGINT or SIGTERM; teardown ran first |
