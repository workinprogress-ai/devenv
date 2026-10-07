# Provider contract

The seam between the workspace tooling and a git host. Wrappers and libraries call
`provider_<domain>_<verb>`; each provider (`github/`, `azure/`) implements every verb.
This document is the contract: what a verb takes, what it returns, and what a caller may
rely on. The parity test (`tools/tests/lib/test_provider_azure_parity.bats`) derives its
verb list from the block at the end, and the provider tests assert the shapes below.

How a host maps onto the contract (Azure's boards, work items and policies against GitHub's
projects, issues and rulesets) is in [azure/MAPPING.md](azure/MAPPING.md).

## Conventions

**The repository is the first argument.** Every verb that is scoped to a repository takes
its repository spec first. Pass an empty string for "the resolved target": `DEVENV_REPO`,
else the working directory's repository. Callers write
`provider_prs_list "${repo_spec[0]:-}" --state open`, and never repeat the repository
inside an option.

**Repository specs.** The canonical spec is host-shaped:

| Provider | Spec | Notes |
|---|---|---|
| GitHub | `owner/repo` | |
| Azure | `project/repo` | The organization comes from `[provider] azure_org`. `org/project/repo` and a bare repo name are accepted; the configured values fill what the spec leaves out. |

A repository spec is a name for the host, never parsed by callers beyond
`provider_repo_split`. Work items (Azure) and projects (GitHub) belong to a project or owner,
not a repository: a verb over them accepts the repository for the seam's shape and does not
filter by it; where a verb needs the owner it takes `--owner` or an explicit owner argument.

**Options.** A verb accepts exactly the options listed for it. Any other option, and any
option the host cannot honor, is an error: the verb logs
`<verb>: unknown or unsupported option '<option>'` on stderr, returns non-zero, and makes no
request. Nothing is dropped silently. (Two documented no-ops are accepted and say so in
the verb's row.)

**Output and errors.** Results are JSON on stdout, except where a row says otherwise.
Diagnostics go to stderr. A verb never calls `exit`; it returns non-zero on failure, and
on a transport failure it must not return an empty success.

**Projections.** A list or view verb that takes `--json FIELDS` returns only those
fields; `-q JQ` applies a jq program to the whole result, as `gh` does. Both use the field
names below, never the host's own where they differ.

## Fields

Plain names, shared by both providers. Field names the host spells differently are mapped by
the provider; callers see only these.

| Record | Fields |
|---|---|
| Issue | `number`, `title`, `body`, `state` (`OPEN`/`CLOSED`), `labels` `[{name}]`, `assignees` `[{login}]`, `milestone` (`{title}` or `""`), `author` `{login}`, `createdAt`, `updatedAt`, `closedAt`, `url`, `comments` |
| Pull request | `number`, `id`, `title`, `body`, `state` (`OPEN`/`CLOSED`/`MERGED`), `isDraft`, `headRefName`, `baseRefName`, `headRefOid`, `author` `{login}`, `labels` `[{name}]`, `mergeable`, `mergeStateStatus`, `url`, `createdAt`, `updatedAt`, `closedAt`, `mergedAt` |
| Run | `id` (number), `workflowName`, `name`, `event`, `status` (`queued`/`in_progress`/`completed`), `conclusion` (`success`/`failure`/`cancelled`/`null`), `headBranch`, `headSha`, `createdAt`, `updatedAt`, `url` |
| Workflow | `id`, `name`, `path`, `state` (`active`/`disabled`) |
| Repository | `name`, `repoSpec`, `owner` `{login}`, `defaultBranchRef` `{name}`, `isPrivate` |
| Comment | `id`, `url`, `body`, `user` `{login}`, `created_at`, `updated_at` |
| Review thread (page) | `data.repository.pullRequest.reviewThreads` with `pageInfo{hasNextPage,endCursor}` and `nodes[]`: `id` (the thread ref), `isResolved`, `path`, `line`, `comments.nodes[]` of `{id, nodeId, body, author{login}}` |
| Label | `name`, `description`, `color` |
| Release | `tagName`, `name`, `publishedAt`, `isPrerelease`, `isDraft` |
| Ruleset / policy | `id`, `name`, `enforcement` (`active`/`disabled`) |

What the names mean where hosts differ:

- `repoSpec` is the repository's spec in the host's canonical form: `owner/repo` on GitHub,
  `project/repo` on Azure. It is what the repository argument of every other verb takes.
- `owner.login` is the account that owns the repository on GitHub and the project on Azure.
- `url` is the address of the record in a browser. For a comment it is the comment's own
  page, not an API address.
- `id` is the host's identifier for the record, and what a later verb takes to address it. A run
  id is a number. A review comment `id` is what `provider_prs_thread_reply` takes (a number on
  GitHub; `<thread>/<comment>` on Azure). It is opaque: store and pass it, do not parse it.
- `nodeId` is the host's global node id of a review comment, where the host has one (GitHub's
  GraphQL id); `null` elsewhere.
- A review thread `id` is what `provider_prs_thread_resolve` takes: a GraphQL node id on
  GitHub, `<pr>/<thread>` on Azure.
- Issue `state`: on Azure only `Closed`, `Done` and `Removed` read as `CLOSED`; every other
  state, `Resolved` included, is `OPEN`.

## Verbs

`[repo]` is the repository argument, first, possibly `""`. `ORG` is an organization (GitHub)
or `org/project` (Azure). Rows list the options each verb accepts; unlisted options are
errors.

### Repositories

| Verb | Arguments | Options | Result |
|---|---|---|---|
| `provider_repos_view` | `[repo]` | `--json FIELDS`, `-q JQ` | Repository record (fields above). A field the host has no value for (an empty repository's default branch) is an error, not `null`. Without `--json`: the host's own view. |
| `provider_repos_list` | `ORG` | `--limit N`, `--json FIELDS`, `-q JQ` | `[Repository]` |
| `provider_repos_default_branch` | `repo` | | The default branch name, one line. Fails for an unreachable or empty repository. |
| `provider_repos_commits_count` | `repo` | | No output; exit 0 when the repository has at least one commit. |
| `provider_repos_create` | `NAME` | `--description D`, `--template SPEC`, `--public`/`--private`/`--internal` (accepted; Azure repositories are private to the project) | `{name, id, repoSpec}` |
| `provider_repos_edit` | `repo` | `--template` (accepted; Azure warns that a template cannot be switched after create) | none |
| `provider_repos_patch` | `repo` | `-f KEY=VALUE` (repeatable) | none. Keys with no Azure analog are reported and skipped. |
| `provider_repos_protect_branch` | `repo BRANCH PAYLOAD_FILE` | | none. Idempotent: re-running updates the protection. |
| `provider_repos_team_put` | `ORG TEAM repo [PERMISSION]` | | none. Permissions: `pull`, `triage`, `push`, `maintain`, `admin`. |
| `provider_repos_collaborator_put` | `repo USERNAME` | `--permission P` | none |

### Issues

| Verb | Arguments | Options | Result |
|---|---|---|---|
| `provider_issues_list` | `[repo]` | `--state open\|closed\|all`, `--label L`, `--type T`, `--limit N`, `--json FIELDS`, `-q JQ` | `[Issue]`. `--assignee`, `--milestone`, `--author`, `--mention` are errors on Azure. |
| `provider_issues_view` | `[repo] NUMBER` | `--json FIELDS`, `-q JQ` | Issue |
| `provider_issues_exists` | `[repo] NUMBER` | | exit status |
| `provider_issues_create` | `[repo]` | `--title T`, `--body B`, `--body-file F`, `--label L` (repeatable), `--type T` (Azure) | The issue's number or URL, one line. On Azure `--type` selects the work item type (Task and untyped are a User Story); `--assignee` and `--milestone` are errors. |
| `provider_issues_edit` | `[repo] NUMBER` | `--title`, `--body`, `--body-file` (`-` is stdin), `--add-label`, `--remove-label` | none. On Azure `--add-assignee`, `--remove-assignee`, `--milestone` and `--type` are errors. |
| `provider_issues_close` | `[repo] NUMBER` | `--comment TEXT`, `--reason R` (Azure accepts and drops it: there is no close reason) | none |
| `provider_issues_reopen` | `[repo] NUMBER` | `--comment TEXT` | none |
| `provider_issues_comment` | `[repo] NUMBER` | `--body TEXT`, `--body-file F` | The new comment's URL (GitHub) or id (Azure): for display, not for addressing. Use `provider_issues_comment_add` to get a record. |
| `provider_issues_comments` | `repo NUMBER` | | `[Comment]`, oldest first |
| `provider_issues_comment_add` | `[repo] NUMBER` | `--body`, `--body-file` | Comment |
| `provider_issues_comment_get` | `[repo] COMMENT_REF` | | Comment. `COMMENT_REF` is the comment's `id` (`<issue>/<comment>` on Azure). |
| `provider_issues_comment_edit` | `[repo] COMMENT_REF` | `--body`, `--body-file` | Comment |
| `provider_issues_set_type` | `OWNER NAME NUMBER TYPE` | | none. Sets the issue's type; a type that is already set is left alone. |
| `provider_issues_milestones` | `[repo]` | `-q JQ` | The repository's milestones (Azure: an empty list, iterations are not mapped) |
| `provider_issue_web_url` | `SPEC NUMBER` | | The address of an issue (GitHub) or work item (Azure) in a browser |
| `provider_issues_label_list` | `[repo]` | `--limit N`, `--json FIELDS`, `-q JQ` | `[Label]` |
| `provider_issues_label_ensure` | `[repo] NAME [COLOR] [DESCRIPTION]` | | none. Creates the label if absent. |
| `provider_issues_label_create` | `[repo] NAME [COLOR] [DESCRIPTION]` | `--issue N` (Azure: a tag exists only on a work item) | none |
| `provider_issues_label_update` | `[repo] NAME [COLOR] [DESCRIPTION]` | | none |
| `provider_issue_graph_link` | `repo PARENT CHILD` | | none. Makes CHILD a sub-issue of PARENT. |
| `provider_issue_graph_unlink` | `repo PARENT CHILD` | | none |
| `provider_issue_graph_children` | `repo PARENT` | | Child issue numbers, one per line |
| `provider_issue_graph_parent` | `repo ISSUE` | | The parent's number, or nothing |

### Pull requests

| Verb | Arguments | Options | Result |
|---|---|---|---|
| `provider_prs_list` | `[repo]` | `--state open\|closed\|merged\|all`, `--head B`, `--base B`, `--search S`, `--limit N`, `--json FIELDS`, `-q JQ` | `[Pull request]`. `closed` includes abandoned/closed-unmerged pull requests. |
| `provider_prs_view` | `[repo] NUMBER` | `--json FIELDS`, `-q JQ` | Pull request |
| `provider_prs_diff` | `[repo] NUMBER` | `--name-only` | Changed files: paths, one per line, with `--name-only`; otherwise GitHub prints the patch and Azure one `{path, changeType}` object per line. A caller that needs patch text on Azure diffs the two commits locally. |
| `provider_prs_create` | `[repo]` | `--title`, `--body`, `--body-file`, `--head`, `--base`, `--draft`, `--label` (repeatable), `--reviewer` (repeatable), `--assignee` (Azure accepts it and warns: there is no PR assignee) | The pull request's URL |
| `provider_prs_merge` | `[repo] NUMBER` | `--squash\|--merge\|--rebase`, `--delete-branch`, `--subject S`, `--body B`, `--admin` | none. On Azure the verb waits for the asynchronous completion and fails with the host's message if the merge fails. |
| `provider_prs_comment` | `[repo] NUMBER` | `--body`, `--body-file` | The new comment's URL (GitHub) or thread id (Azure): for display. On Azure the printed value is the bare thread id (build `<pr>/<thread>` for `provider_prs_thread_resolve`; `provider_prs_thread_reply` takes the bare id too), and the thread carries no status: not Active (which could block a comments-resolved merge policy), and while it holds a single comment it is not a review thread, so `provider_prs_threads_page` leaves it out (as a GitHub PR comment never appears among review threads); once someone replies, it is listed |
| `provider_prs_threads_page` | `repo NUMBER [CURSOR]` | | Review thread page |
| `provider_prs_thread_create` | `[repo] NUMBER` | `--body`, `--path`, `--line`, `--side LEFT\|RIGHT` | `{thread: {url}}`; Azure also carries `thread.id`, the opaque ref `provider_prs_thread_resolve` takes |
| `provider_prs_thread_reply` | `repo NUMBER COMMENT_ID BODY` | | Comment |
| `provider_prs_thread_resolve` | `[repo] THREAD_REF` | | `true` once the thread is resolved; `false` or `unknown` otherwise |

### Pipelines

| Verb | Arguments | Options | Result |
|---|---|---|---|
| `provider_pipelines_run_list` | `[repo]` | `--branch B`, `--workflow W` (a name or id), `--status S`, `--limit N`, `--json FIELDS`, `-q JQ` | `[Run]`, newest first. `--status` portable words: `queued`, `in_progress`, `completed`, `success`, `failure`, `cancelled`; a word a provider cannot honor is an error naming the option (never an unfiltered list) |
| `provider_pipelines_run_view` | `[repo] RUN_ID` | `--json FIELDS`, `-q JQ` | Run |
| `provider_pipelines_run_watch` | `[repo] RUN_ID` | `--exit-status` | Progress output until the run completes (host-specific text); with `--exit-status`, non-zero unless it succeeded |
| `provider_pipelines_workflow_list` | `[repo]` | `--json FIELDS`, `-q JQ` | `[Workflow]` |
| `provider_pipelines_workflow_run` | `[repo] WORKFLOW` | `--ref REF`, `--field K=V` (repeatable) | Azure: the new run's id. GitHub: `gh`'s confirmation text; it does not return the id. |
| `provider_pipelines_run_rerun` | `[repo] RUN_ID` | | none. Azure retries the build; GitHub also accepts `--failed` and `-d`. |
| `provider_pipelines_run_cancel` | `repo RUN_ID` | | none |
| `provider_pipelines_run_artifacts` | `repo RUN_ID` | | `[{id, name, size_in_bytes, created_at, url}]` |
| `provider_pipelines_run_download` | `[repo] RUN_ID` | `-n NAME`, `-D DIR` | none; writes the artifacts to the directory |

### Projects and boards

Projects (GitHub) and boards (Azure) belong to an owner or project, not a repository.

| Verb | Arguments | Options | Result |
|---|---|---|---|
| `provider_projects_list` | `[repo]` | `--owner O`, `--format json`, `--jq J` | The projects/boards |
| `provider_projects_field_list` | `[repo] PROJECT` | `--owner O` | The Status options |
| `provider_projects_item_add` | `[repo] PROJECT ISSUE_URL` | `--owner O` | none |
| `provider_projects_id_by_name` | `OWNER NAME_OR_NUMBER` | | The project's id |
| `provider_projects_item_id_for_issue` | `PROJECT_ID ISSUE OWNER REPO` | | The issue's item id in the project |
| `provider_projects_field_option_ids` | `PROJECT_ID FIELD OPTION` | | `FIELD<TAB>OPTION_ID` |
| `provider_projects_field_set` | `PROJECT_ID ITEM_ID FIELD_ID OPTION_ID` | | none |
| `provider_projects_for_issue` | `ISSUE_URL OWNER` | | One row per project, tab-separated: `title`, `number`, `status` (`-` when none). A status is one of `[workflows] status_workflow`. |

### Organization

| Verb | Arguments | Options | Result |
|---|---|---|---|
| `provider_org_rulesets_list` | `repo` | `--paginate` | `[Ruleset]` |
| `provider_org_ruleset_get` | `repo ID` | | The ruleset, host-shaped |
| `provider_org_ruleset_create` | `repo PAYLOAD_FILE` | | none. The payload is a GitHub ruleset; Azure translates the pull-request rule to a reviewers policy. |
| `provider_org_ruleset_update` | `repo ID PAYLOAD_FILE` | | none. Writes the payload's protection for every branch it names (Azure: updates in place where a policy exists), then retires only the policy `ID` it was given, when no write reused it, and logs which one; protection on other branches is never touched, and none is removed before the new one exists. A ruleset that names no branch a policy can hold (a wildcard, a tag ref, a bare name) is an error; on Azure `~ALL` protects the default branch only, with a warning. |
| `provider_org_releases_list` | `repo` | `--limit N`, `--json FIELDS`, `-q JQ` | `[Release]`, newest first |
| `provider_org_get` | | | The organization (GitHub) or organization name (Azure) the workspace operates in, from `[organization] org` or the setup seed. Fails if neither is set. |
| `provider_org_issue_types` | `ORG` | | `[{id, name}]` |
| `provider_org_packages_list` | `[ENDPOINT]` | `-f K=V` | The host's package list (GitHub REST, Azure feeds): not a neutral shape |
| `provider_org_package_versions` | `ENDPOINT` | | GitHub only; Azure fails with a message |
| `provider_org_feeds_list` | | | Azure Artifacts feeds (`[{name, id, url}]`) |

## Seam support

| Function | Purpose |
|---|---|
| `provider_load MODULE...` | Load the active provider's modules. Fails, naming the problem, for a provider name that is not shipped. |
| `provider_detect` | Resolve the active provider name from `devenv.config`. |
| `provider_repo_target [SPEC]` | The one repository resolver: argument, `DEVENV_REPO`, the provider's environment, the working directory. |
| `provider_repo_split SPEC HEAD TAIL` | Split a spec on its first separator. |
| `provider_has_capability`, `provider_require_capability`, `provider_declare_capability` | Capabilities a provider declares (`project-boards`, `rulesets`, `native-issue-types`, `pipelines`). |
| `provider_unknown_option VERB OPTION` | The error every verb returns for an option it does not accept. |
| `provider_auth_status`, `provider_auth_import_token`, `provider_auth_setup_git`, `provider_secret_get`, `provider_user_get` | Credentials. |
| `provider_git_transport_url`, `provider_remote_to_spec`, `provider_remote_to_web`, `provider_pr_web_url`, `provider_issue_web_url`, `provider_web_url`, `provider_web_host`, `provider_extract_url` | Addresses. |

Not part of the contract: `provider_api` and `provider_api_paginate` are GitHub's raw REST
and GraphQL access. Call sites use the domain verbs; Azure does not implement them.

## Verb list

The parity test reads this block: every verb below is defined by both providers after
`provider_load`, except where marked. Add a verb here when a provider gains one.

<!-- contract:verbs -->
```
provider_repos_view
provider_repos_list
provider_repos_default_branch
provider_repos_commits_count
provider_repos_create
provider_repos_edit
provider_repos_patch
provider_repos_protect_branch
provider_repos_team_put
provider_repos_collaborator_put
provider_issues_list
provider_issues_view
provider_issues_exists
provider_issues_create
provider_issues_edit
provider_issues_close
provider_issues_reopen
provider_issues_comment
provider_issues_comments
provider_issues_comment_add
provider_issues_comment_get
provider_issues_comment_edit
provider_issues_set_type
provider_issues_milestones
provider_issue_web_url
provider_issues_label_list
provider_issues_label_ensure
provider_issues_label_create
provider_issues_label_update
provider_issue_graph_link
provider_issue_graph_unlink
provider_issue_graph_children
provider_issue_graph_parent
provider_prs_list
provider_prs_view
provider_prs_diff
provider_prs_create
provider_prs_merge
provider_prs_comment
provider_prs_threads_page
provider_prs_thread_create
provider_prs_thread_reply
provider_prs_thread_resolve
provider_pipelines_run_list
provider_pipelines_run_view
provider_pipelines_run_watch
provider_pipelines_workflow_list
provider_pipelines_workflow_run
provider_pipelines_run_rerun
provider_pipelines_run_cancel
provider_pipelines_run_artifacts
provider_pipelines_run_download
provider_projects_list
provider_projects_field_list
provider_projects_item_add
provider_projects_id_by_name
provider_projects_item_id_for_issue
provider_projects_field_option_ids
provider_projects_field_set
provider_projects_for_issue
provider_org_rulesets_list
provider_org_ruleset_get
provider_org_ruleset_create
provider_org_ruleset_update
provider_org_releases_list
provider_org_get
provider_org_issue_types
provider_org_packages_list
provider_org_package_versions
provider_org_feeds_list           # azure-only
provider_issues_add_tag           # azure-only
provider_api                      # github-only
provider_api_paginate             # github-only
```
<!-- /contract:verbs -->
