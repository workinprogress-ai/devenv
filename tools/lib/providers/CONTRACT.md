# Provider contract

The seam between the workspace tooling and a git host. Tools and domain code call the
TypeScript facade in [`facade/`](facade/README.md); the facade dispatches to the active
provider (`github/` or `azure/`). This document is the contract: which verbs exist, what
each provider implements, what a verb takes and returns, and what a caller may rely on.

How a host maps onto the contract (Azure's boards, work items and policies against GitHub's
projects, issues and rulesets) is in [azure/MAPPING.md](azure/MAPPING.md).

The coverage table below is enforced. `tools/tests/ts/provider-azure-parity.test.ts` imports the
real facade, GitHub and Azure modules and compares their exports with the table, so a verb
that is added, renamed or removed in code without a matching table change fails the suite.

## Vocabulary and naming

A **verb** is one operation of the seam. Its contract name is `provider_<family>_<verb>`
(for example `provider_prs_thread_reply`). The name is a vocabulary term, not a function:
the TypeScript export is the camel-cased remainder after `provider_`
(`prsThreadReply`). Three modules can export it:

- the **facade** module `facade/<family>.ts`, the only surface tools and domain code import;
- the **GitHub** module `github/<module>.ts`;
- the **Azure** module `azure/<module>.ts`.

The two provider modules need not share a file layout (Azure's ruleset verbs live in
`azure/policies.ts`, its issue web URL in `azure/urls.ts`), so every row of the coverage table
names the module as well as the export.

## Coverage table

The block between the markers is the machine-readable source. One row per verb, five
`|`-separated columns:

```text
verb | facade | github | azure | notes
```

A facade, GitHub or Azure cell is one of:

| Cell | Meaning |
|---|---|
| `module.export` | The module exports a function of that name. |
| `ops:key` | Facade only: the verb is the `key` member of the object `projectsOps()` returns. |
| `-` | The provider or facade deliberately has no such verb; `notes` says why. |
| `via-facade` | Provider cell only: the provider has no export and the facade composes the verb from other provider verbs; the export must be absent. |
| `gap: reason` | A known, named gap: the verb is part of the contract but this provider has not implemented it yet. The test asserts the export is still absent, so a closed gap must be removed from the table. |

Rules the test applies to the table:

- a cell that names an export requires that module to export it, for that provider;
- the export name follows the naming convention, except the two blocked-by rows whose
  provider-side names differ (`issueBlockedByLink`/`issueDependencyLink` and their unlink
  twins; the facade names them `blockedByAdd`/`blockedByRemove`);
- every function the facade exports has a row, so a facade verb cannot ship undocumented;
- every verb-shaped function a provider exports from a family module has a row (helpers whose
  names do not start with a family word are not verbs);
- every `gap:` is listed again in the test's known-gap list: adding a gap is a deliberate,
  two-place edit.

<!-- contract:verbs -->
```text
provider_repos_view | repos.reposView | repos.reposView | repos.reposView |
provider_repos_list | repos.reposList | repos.reposList | repos.reposList |
provider_repos_default_branch | - | gap: not yet ported to the TypeScript GitHub module | repos.reposDefaultBranch | no facade export: no tool consumes it
provider_repos_commits_count | repos.reposCommitsCount | repos.reposCommitsCount | repos.reposCommitsCount | the facade answers a boolean on both providers
provider_repos_create | repos.reposCreate | repos.reposCreate | repos.reposCreate |
provider_repos_edit | repos.reposEdit | repos.reposEdit | repos.reposEdit | the facade refuses it on Azure with a named error
provider_repos_patch | repos.reposPatch | repos.reposPatch | repos.reposPatch | the facade refuses it on Azure with a named error
provider_repos_patch_with_error | repos.reposPatchWithError | repos.reposPatchWithError | - | GitHub-only: the facade refuses it on Azure with a named error
provider_repos_protect_branch | - | gap: not yet ported to the TypeScript GitHub module | repos.reposProtectBranch | no facade export: no tool consumes it
provider_repos_team_put | repos.reposTeamPut | repos.reposTeamPut | repos.reposTeamPut |
provider_repos_collaborator_put | repos.reposCollaboratorPut | repos.reposCollaboratorPut | repos.reposCollaboratorPut |
provider_repos_tree_count | repos.reposTreeCount | repos.reposTreeCount | - | GitHub-native: template instantiation reads gh's tree API
provider_issues_list | issues.issuesList | issues.issuesList | issues.issuesList |
provider_issues_view | issues.issuesView | issues.issuesView | issues.issuesView |
provider_issues_exists | issues.issuesExists | issues.issuesExists | issues.issuesExists |
provider_issues_create | issues.issuesCreate | issues.issuesCreate | issues.issuesCreate |
provider_issues_edit | issues.issuesEdit | issues.issuesEdit | issues.issuesEdit |
provider_issues_close | issues.issuesClose | issues.issuesClose | issues.issuesClose |
provider_issues_reopen | issues.issuesReopen | issues.issuesReopen | issues.issuesReopen |
provider_issues_comment | issues.issuesComment | issues.issuesComment | issues.issuesComment |
provider_issues_comments | issues.issuesComments | issues.issuesComments | issues.issuesComments |
provider_issues_comment_add | issues.issuesCommentAdd | issues.issuesCommentAdd | via-facade | the facade posts with issuesComment, then reads the record back with issuesCommentGet
provider_issues_comment_get | issues.issuesCommentGet | issues.issuesCommentGet | issues.issuesCommentGet |
provider_issues_comment_edit | issues.issuesCommentEdit | issues.issuesCommentEdit | gap: Azure has no comment-edit primitive wired; the facade throws a named error | the one verb listed for both providers that Azure lacks
provider_issues_set_type | issues.issuesSetType | issues.issuesSetType | issues.issuesSetType |
provider_issues_milestones | issues.issuesMilestones | issues.issuesMilestones | issues.issuesMilestones |
provider_issue_web_url | issues.issueWebUrl | issues.issueWebUrl | urls.issueWebUrl | Azure hosts it in its urls module
provider_issues_label_list | issues.issuesLabelList | issues.issuesLabelList | issues.issuesLabelList |
provider_issues_label_ensure | issues.issuesLabelEnsure | issues.issuesLabelEnsure | issues.issuesLabelEnsure |
provider_issues_label_create | issues.issuesLabelCreate | issues.issuesLabelCreate | issues.issuesLabelCreate |
provider_issues_label_update | issues.issuesLabelUpdate | issues.issuesLabelUpdate | issues.issuesLabelUpdate | a documented no-op on Azure
provider_issues_add_tag | - | - | issues.issuesAddTag | Azure-only: a tag is added to a work item directly
provider_issues_remove_tag | - | - | issues.issuesRemoveTag | Azure-only: a tag is removed from a work item directly
provider_issue_graph_link | issues.issueGraphLink | issues.issueGraphLink | issues.issueGraphLink |
provider_issue_graph_unlink | issues.issueGraphUnlink | issues.issueGraphUnlink | issues.issueGraphUnlink |
provider_issue_graph_children | issues.issueGraphChildren | issues.issueGraphChildren | issues.issueGraphChildren |
provider_issue_graph_parent | issues.issueGraphParent | issues.issueGraphParent | issues.issueGraphParent |
provider_issue_blocked_by_add | issues.blockedByAdd | issues.issueBlockedByLink | issues.issueDependencyLink | facade-level name; takes the whole blocker list
provider_issue_blocked_by_remove | issues.blockedByRemove | issues.issueBlockedByUnlink | issues.issueDependencyUnlink | facade-level name; takes the whole blocker list
provider_org_issue_types | issues.orgIssueTypes | issues.orgIssueTypes | - | GitHub-only: Azure's type vocabulary is project configuration
provider_prs_list | prs.prsList | prs.prsList | prs.prsList |
provider_prs_view | prs.prsView | prs.prsView | prs.prsView |
provider_prs_diff | prs.prsDiff | prs.prsDiff | prs.prsDiff |
provider_prs_create | prs.prsCreate | prs.prsCreate | prs.prsCreate |
provider_prs_merge | prs.prsMerge | prs.prsMerge | prs.prsMerge |
provider_prs_comment | prs.prsComment | prs.prsComment | prs.prsComment |
provider_prs_threads_page | prs.prsThreadsPage | prs.prsThreadsPage | prs.prsThreadsPage |
provider_prs_thread_create | prs.prsThreadCreate | prs.prsThreadCreate | prs.prsThreadCreate |
provider_prs_thread_reply | prs.prsThreadReply | prs.prsThreadReply | prs.prsThreadReply |
provider_prs_thread_resolve | prs.prsThreadResolve | prs.prsThreadResolve | prs.prsThreadResolve |
provider_pipelines_run_list | pipelines.pipelinesRunList | pipelines.pipelinesRunList | pipelines.pipelinesRunList |
provider_pipelines_run_view | pipelines.pipelinesRunView | pipelines.pipelinesRunView | pipelines.pipelinesRunView |
provider_pipelines_run_watch | pipelines.pipelinesRunWatch | pipelines.pipelinesRunWatch | pipelines.pipelinesRunWatch |
provider_pipelines_workflow_list | pipelines.pipelinesWorkflowList | pipelines.pipelinesWorkflowList | pipelines.pipelinesWorkflowList |
provider_pipelines_workflow_run | pipelines.pipelinesWorkflowRun | pipelines.pipelinesWorkflowRun | pipelines.pipelinesWorkflowRun |
provider_pipelines_run_rerun | pipelines.pipelinesRunRerun | pipelines.pipelinesRunRerun | pipelines.pipelinesRunRerun |
provider_pipelines_run_cancel | - | pipelines.pipelinesRunCancel | pipelines.pipelinesRunCancel | provider-level only: no tool cancels runs through the facade
provider_pipelines_run_artifacts | pipelines.pipelinesRunArtifacts | pipelines.pipelinesRunArtifacts | pipelines.pipelinesRunArtifacts |
provider_pipelines_run_download | pipelines.pipelinesRunDownload | pipelines.pipelinesRunDownload | pipelines.pipelinesRunDownload |
provider_projects_list | - | projects.projectsList | projects.projectsList | provider-level only: no tool lists boards through the facade
provider_projects_field_list | ops:fieldList | projects.projectsFieldList | projects.projectsFieldList |
provider_projects_item_add | ops:itemAdd | projects.projectsItemAdd | projects.projectsItemAdd |
provider_projects_id_by_name | ops:idByName | projects.projectsIdByName | projects.projectsIdByName |
provider_projects_item_id_for_issue | ops:itemIdForIssue | projects.projectsItemIdForIssue | projects.projectsItemIdForIssue |
provider_projects_field_option_ids | ops:fieldOptionIds | projects.projectsFieldOptionIds | projects.projectsFieldOptionIds |
provider_projects_field_set | ops:fieldSet | projects.projectsFieldSet | projects.projectsFieldSet |
provider_projects_for_issue | ops:forIssue | projects.projectsForIssue | projects.projectsForIssue |
provider_projects_number_by_name | projects.projectsNumberByName | projects.projectsNumberByName | - | GitHub-native: gh item-add keys on the project number; Azure boards have no number namespace
provider_org_rulesets_list | org.orgRulesetsList | org.orgRulesetsList | policies.orgRulesetsList |
provider_org_ruleset_get | org.orgRulesetGet | org.orgRulesetGet | policies.orgRulesetGet |
provider_org_ruleset_create | org.orgRulesetCreate | org.orgRulesetCreate | policies.orgRulesetCreate |
provider_org_ruleset_update | org.orgRulesetUpdate | org.orgRulesetUpdate | policies.orgRulesetUpdate |
provider_org_releases_list | org.orgReleasesList | org.orgReleasesList | org.orgReleasesList |
provider_org_packages_list | - | gap: not yet ported to the TypeScript GitHub module | org.orgPackagesList | no facade export: no tool consumes it
provider_org_package_versions | - | gap: not yet ported to the TypeScript GitHub module | org.orgPackageVersions | no facade export; the Azure verb always throws (feed-scoped versions have no analog)
provider_org_feeds_list | - | - | org.orgFeedsList | Azure-only: Azure Artifacts feeds
provider_web_host | - | urls.webHost | urls.webHost | provider-level only
provider_web_url | - | urls.webUrl | urls.webUrl | provider-level only
provider_pr_web_url | urls.prWebUrl | urls.prWebUrl | urls.prWebUrl |
provider_extract_url | urls.extractUrl | urls.extractUrl | urls.extractUrl |
provider_remote_to_web | urls.remoteToWeb | urls.remoteToWeb | urls.remoteToWeb |
provider_remote_to_spec | urls.remoteToSpec | urls.remoteToSpec | urls.remoteToSpec |
provider_git_transport_url | urls.gitTransportUrl | urls.gitTransportUrl | urls.gitTransportUrl |
provider_auth_status_ok | urls.authStatusOk | urls.authStatusOk | auth.authStatusOk | Azure hosts it in its auth module
```
<!-- /contract:verbs -->

Not part of the contract: GitHub's raw REST and GraphQL access (`ghApi`, `ghApiSync`,
`ghApiPaginate` in `github/transport.ts`). Call sites use the domain verbs; Azure has no
counterpart.

## Conventions

**The repository is the first argument.** Every verb scoped to a repository takes its
repository spec first, usually as `spec: string | undefined`. `undefined` or `""` means "the
resolved target": `DEVENV_REPO`, else the working directory's repository (the facade and the
Azure verbs resolve it through `providerRepoTarget` in `provider-core.ts`). Callers never
repeat the repository inside an option.

**Repository specs.** The canonical spec is host-shaped:

| Provider | Spec | Notes |
|---|---|---|
| GitHub | `owner/repo` | |
| Azure | `project/repo` | The organization comes from `[provider] azure_org`. `org/project/repo` and a bare repo name are accepted; the configured values fill what the spec leaves out. |

A repository spec is a name for the host, never parsed by callers beyond `providerRepoSplit`.
Work items (Azure) and projects (GitHub) belong to a project or owner, not a repository: a
verb over them accepts the repository for the seam's shape and does not filter by it; where a
verb needs the owner it takes an explicit owner argument.

**Typed options.** Options are typed objects (`{ state, limit, json, jq, ... }`), not flag
strings, so an unknown option cannot be expressed: the compiler refuses it, and the command
line parser of each tool (`toolCli`) rejects an unknown flag by name before any request is
made. A value a verb cannot honor (a non-numeric `--limit`, a `--status` word with no Azure
analog, a merge method outside `squash|merge|rebase`) is a named error, never an unfiltered
result. An option the host cannot represent is refused by the facade with a named
`ProviderError` ("not implemented for provider 'azure' yet"), never dropped.

**Verbs that still take raw flag arrays.** A few verbs forward the caller's `gh` flag list
unchanged because the surface they wrap is `gh`'s own: `pipelinesRunWatch`,
`pipelinesWorkflowList`, `pipelinesWorkflowRun`, `pipelinesRunRerun`, `pipelinesRunDownload`,
`orgReleasesList` and `reposEdit`. On GitHub the list goes to `gh` verbatim. On Azure the
facade maps the flags it knows into a typed options object:

| Verb | Azure flags mapped | Any other flag |
|---|---|---|
| `pipelinesWorkflowList` | `--json F`, `--jq P` / `-q P` | Rejected by name (`unknownOption`); a flag missing its value is rejected (`needValue`) |
| `pipelinesRunDownload` | `-n`/`--name`, `-D`/`--dir` | Rejected by name (`unknownOption`); a flag missing its value is rejected (`needValue`) |
| `pipelinesRunWatch` | `--exit-status` | Rejected by name (`unknownOption`) |
| `pipelinesWorkflowRun` | `--ref REF`, `-f`/`--field K=V` | Rejected by name (`unknownOption`); a flag missing its value is rejected (`needValue`); a `-f`/`--field` value without `KEY=` is a named error |
| `pipelinesRunRerun` | none (Azure retries the whole build) | Rejected by name (`unknownOption`): `--failed` and `--debug` are GitHub-only |
| `orgReleasesList` | none | Any flag is an error (Azure lists all releases) |
| `reposEdit` | none | The verb itself is refused on Azure with a named error (a repository has no post-create settings flags); `configureTemplateSettingForType` logs the skip instead of claiming the flip |

`unknownOption(verb, option)` and `needValue(verb, option)` live in `provider-core.ts` and
throw the named `ProviderError`s; they are what the rejecting rows above call.

**Output and errors.** A verb never exits the process. Failure is a thrown `ProviderError`
(or, for the verbs documented below, a `false`/`{ ok: false }` result), and a transport
failure is never an empty success. Diagnostics go to stderr.

**Facade return shapes.** The facade normalizes what the providers return:

| Verb family | Facade returns |
|---|---|
| Issues, repos list/view, pipelines list/view/artifacts/workflow list, org rulesets and releases | JSON text (or the jq result as text) |
| Pull requests; pipelines watch, workflow run, rerun, download; repo create | `{ stdout, stderr, status }`, with `status` 0 on success |
| Repo-settings verbs (`reposEdit`, `reposPatch`, `reposTeamPut`, `reposCollaboratorPut`) | `boolean` (`reposPatchWithError`: `{ ok, error }`) |
| Ruleset create and update | `{ ok, stderr }` |
| Graph, blocked-by, close/reopen and similar writes | nothing (`void`) or the host's stdout |

**Projections.** A list or view verb that takes `json` returns only those fields; `jq` applies
a program to the result. Both use the field names below, never the host's own where they
differ. GitHub forwards both to `gh`; on Azure the facade and provider apply a small jq subset
(`.field`, dotted paths, `// empty`; for run lists `.[].field` and `.[N].field`, each optionally followed by `// empty` or `// "default"`) and refuse any other program by name. The same program therefore works on both providers.

## Fields

Plain names, shared by both providers. Field names the host spells differently are mapped by
the provider; callers see only these.

| Record | Fields |
|---|---|
| Issue | `number`, `parent` (`{number, title}` or null; Azure surfaces the number with `title: null`), `title`, `body`, `state` (`OPEN`/`CLOSED`), `labels` `[{name}]`, `assignees` `[{login}]`, `milestone` (`{title}` or `""`), `author` `{login}`, `createdAt`, `updatedAt`, `closedAt`, `url`, `comments` |
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
- `id` is the host's identifier for the record, and what a later verb takes to address it. A
  run id is a number. A review comment `id` is what `prsThreadReply` takes (a number on
  GitHub; `<thread>/<comment>` on Azure). It is opaque: store and pass it, do not parse it.
- `nodeId` is the host's global node id of a review comment, where the host has one (GitHub's
  GraphQL id); `null` elsewhere.
- A review thread `id` is what `prsThreadResolve` takes: a GraphQL node id on GitHub,
  `<pr>/<thread>` on Azure.
- Issue `state`: on Azure only `Closed`, `Done` and `Removed` read as `CLOSED`; every other
  state, `Resolved` included, is `OPEN`.

## Verbs

`[repo]` is the repository argument, first, possibly `""`. `ORG` is an organization (GitHub)
or `org/project` (Azure). The Options column lists the typed option fields (or flags, for the
raw flag-array verbs); anything not listed is not accepted.

### Repositories

| Verb | TS export | Arguments and options | Result and rules |
|---|---|---|---|
| `provider_repos_view` | `reposView` | `[repo]`; `json`, `jq` | Repository record (fields above), as JSON text. A field the host has no value for (an empty repository's default branch) is an error, not `null`. |
| `provider_repos_list` | `reposList` | `ORG`; `limit`, `json`, `jq` | `[Repository]` as JSON text |
| `provider_repos_default_branch` | `reposDefaultBranch` (Azure only) | `repo` | The default branch name. Fails for an unreachable or empty repository. Not yet ported to GitHub; not exposed by the facade. |
| `provider_repos_commits_count` | `reposCommitsCount` | `repo` | Facade: `true` when the repository has at least one commit. The Azure provider verb returns the commit count. |
| `provider_repos_create` | `reposCreate` | `NAME`; `description`, `template`, `visibility` (Azure accepts and ignores it: repositories are private to the project) | Facade: `{ stdout, stderr, status }`. Azure's stdout is the JSON record `{name, id, repoSpec}`. |
| `provider_repos_edit` | `reposEdit` | `repo`, `flags` (gh-repo-edit flags) | `true` on success. On Azure a named error (`repos_edit is not supported on provider 'azure'`): a repository has no post-create settings flags. |
| `provider_repos_patch` | `reposPatch` | `repo`, `flags` (`-f`/`-F key=value`, gh-api dialect) | `true` on success. On Azure the facade throws `repos_patch is not supported on provider 'azure'`: the flags name GitHub repository settings (wiki, discussions, merge buttons, forking), which Azure models as project policies or does not model at all, and `-f`/`-F` pairs do not map onto them. Whether and how to map them is an open design question. The Azure provider module keeps a `reposPatch` that PATCHes a key/value record onto the repository; it is reachable only below the facade. |
| `provider_repos_patch_with_error` | `reposPatchWithError` | `repo`, `flags` | `{ ok, error }`; `error` carries the API's own message on failure. GitHub only; on Azure the facade throws `repos_patch_with_error is not supported on provider 'azure'`. |
| `provider_repos_protect_branch` | `reposProtectBranch` (Azure only) | `repo BRANCH PAYLOAD` | Idempotent: re-running updates the protection. Not yet ported to GitHub; not exposed by the facade. |
| `provider_repos_team_put` | `reposTeamPut` | `ORG TEAM repo [PERMISSION]` | `true` on success. Permissions: `pull`, `triage`, `push`, `maintain`, `admin`. On Azure a thrown provider error reads as `false`. |
| `provider_repos_collaborator_put` | `reposCollaboratorPut` | `repo USER [PERMISSION]` | `true` on success; on Azure a thrown provider error reads as `false`. |
| `provider_repos_tree_count` | `reposTreeCount` | `repo` | Number of entries in the repository tree, or `null`. GitHub only; on Azure the facade throws a named GitHub-native error. |

### Issues

| Verb | TS export | Arguments and options | Result and rules |
|---|---|---|---|
| `provider_issues_list` | `issuesList` | `[repo]`; `state` (`open`/`closed`/`all`), `label[]`, `assignee[]`, `milestone`, `author`, `mention`, `type`, `limit`, `search`, `web`, `lock`, `json`, `jq` | `[Issue]` as JSON text. GitHub forwards every field to `gh issue list`. Azure honors `state`, one `label`, `type`, `limit`, `json`, `jq`; a second label, `assignee`, `milestone`, `author`, `mention`, `search`, `web` and `lock` are named errors. |
| `provider_issues_view` | `issuesView` | `[repo] NUMBER`; `json`, `jq` | Issue as JSON text. On Azure the facade projects the requested fields (a missing one is `null`) and supports the jq forms `.field` and `.a.b // empty`. |
| `provider_issues_exists` | `issuesExists` | `[repo] NUMBER` | `boolean`. Only the item's own absence is `false`: on Azure HTTP 404 or TF401232 (a 404 that says the project or organization does not exist is an error), on GitHub `Could not resolve to an Issue` (or an HTTP 404 that does not say a repository could not be resolved). A wrong-scope, credential, network or server failure throws, never reads as "absent". |
| `provider_issues_create` | `issuesCreate` | `[repo]`; `title`, `body`, `bodyFile`, `label[]`, `assignee[]`, `type`, `milestone`, `project[]`, `web`, `dryRun` | The issue's URL (GitHub) or number (Azure), one line. On Azure `type` selects the work item type (Task and untyped become a User Story); `assignee`, `milestone`, `project`, `web` and `dryRun` are named errors. `body` and `bodyFile` together are an error. If Azure creates the work item but cannot read the write back, the number is still returned, with a warning, so a retry does not duplicate it. |
| `provider_issues_edit` | `issuesEdit` | `[repo] NUMBER`; `title`, `body`, `bodyFile` (`-` is stdin), `addLabel[]`, `removeLabel[]`, `addAssignee[]`, `removeAssignee[]`, `milestone`, `type` | Nothing. On Azure `addAssignee`, `removeAssignee` and `milestone` are named errors; at most one add and one remove label is accepted; With a body, `type` only selects which body field the body is written to (the edit never changes the type); without a body, `type` is a type change, applied after the rest of the edit through the set-type verb. Title, body and tag changes go in one JSON-patch led by a `test` op on the revision the item was read at: a concurrent change fails the edit with a named "modified concurrently" error (never retried), so a failure leaves the item unchanged. Azure tags (also through `issuesAddTag`/`issuesRemoveTag`) compare case-insensitively (add skips a tag present in any case; remove drops the stored tag whatever the case of the request) and a label holding `;` is the several tags Azure makes of it; a label that spells no tag is a named error. |
| `provider_issues_close` | `issuesClose` | `[repo] NUMBER`; `comment`, `reason` | Nothing meaningful. Azure accepts `reason` and drops it: there is no close reason. |
| `provider_issues_reopen` | `issuesReopen` | `[repo] NUMBER`; `comment` | Nothing meaningful. |
| `provider_issues_comment` | `issuesComment` | `[repo] NUMBER`; `body`, `bodyFile` (exactly one; both or neither is an error on both providers; an empty or whitespace-only text is a named error on both) | Display value: the new comment's URL (GitHub) or its `<issue>/<comment>` ref (Azure). Use `issuesCommentAdd` to get a record. |
| `provider_issues_comments` | `issuesComments` | `[repo] NUMBER` | `[Comment]` as JSON text, oldest first |
| `provider_issues_comment_add` | `issuesCommentAdd` | `[repo] NUMBER`; `body`, `bodyFile` | Comment record as JSON text. On Azure the facade posts with `issuesComment` and reads the record back with `issuesCommentGet`. |
| `provider_issues_comment_get` | `issuesCommentGet` | `[repo] COMMENT_REF` | Comment record. `COMMENT_REF` is the comment's `id` (`<issue>/<comment>` on Azure; digits only on GitHub, anything else is refused before a request). |
| `provider_issues_comment_edit` | `issuesCommentEdit` | `[repo] COMMENT_REF`; `body`, `bodyFile` | Comment record. Known gap: Azure has no comment-edit primitive wired, and the facade throws a named error. |
| `provider_issues_set_type` | `issuesSetType` | `SPEC NUMBER TYPE` | Nothing. Sets the issue's native type (Azure: replaces `System.WorkItemType`). The facade takes the repository spec on both providers. |
| `provider_issues_milestones` | `issuesMilestones` | `[repo]`; `jq` (Azure only) | The repository's milestones as JSON text. Azure returns an empty list (iterations are not mapped). On GitHub a `jq` request is a named error (raw REST JSON passes through). |
| `provider_issue_web_url` | `issueWebUrl` | `SPEC NUMBER` | The address of an issue (GitHub) or work item (Azure) in a browser. Async in the facade. |
| `provider_issues_label_list` | `issuesLabelList` | `[repo]`; `limit`, `json`, `jq` | `[Label]` as JSON text |
| `provider_issues_label_ensure` | `issuesLabelEnsure` | `[repo] NAME [COLOR] [DESCRIPTION]` | Nothing. Creates the label if absent; on Azure a no-op (a tag exists only on a work item). |
| `provider_issues_label_create` | `issuesLabelCreate` | `[repo] NAME`; `color`, `description`, `issue` (Azure: the work item to tag) | Nothing meaningful. |
| `provider_issues_label_update` | `issuesLabelUpdate` | `[repo] NAME`; `newName`, `color`, `description` | Nothing meaningful. A documented no-op on Azure: tags are immutable flat strings. |
| `provider_issues_add_tag` | `issuesAddTag` (Azure only) | work item id, tag | Adds the tag to the work item. |
| `provider_issues_remove_tag` | `issuesRemoveTag` (Azure only) | work item id, tag | Removes the tag from the work item. |
| `provider_issue_graph_link` | `issueGraphLink` | `[repo] PARENT CHILD [PARENT_SPEC]` | Nothing. Makes CHILD a sub-issue of PARENT. `PARENT_SPEC` allows a cross-repository parent on GitHub; Azure's hierarchy is project-scoped and ignores it. Idempotent. |
| `provider_issue_graph_unlink` | `issueGraphUnlink` | `[repo] PARENT CHILD [PARENT_SPEC]` | Nothing. |
| `provider_issue_graph_children` | `issueGraphChildren` | `[repo] PARENT` | Child issue numbers (`number[]`). GitHub follows every page of sub-issues. |
| `provider_issue_graph_parent` | `issueGraphParent` | `[repo] ISSUE` | The parent's number, or `null` |
| `provider_issue_blocked_by_add` | `blockedByAdd` | `[repo] ISSUE BLOCKERS[]` | Nothing. Records ISSUE as blocked by every blocker. GitHub makes one idempotent body-section write; Azure adds one dependency link per blocker, sequentially (parallel relation writes on one work item would race its revision). Idempotent on both. The Azure link type is `Dependency-Forward`; that choice is pending confirmation against a live organization (see [azure/MAPPING.md](azure/MAPPING.md)). |
| `provider_issue_blocked_by_remove` | `blockedByRemove` | `[repo] ISSUE BLOCKERS[]` | Nothing. Removing an absent blocker is a no-op success. |
| `provider_org_issue_types` | `orgIssueTypes` | `ORG` | `[{id, name}]`. GitHub only; on Azure the facade throws a named error (the type vocabulary is project configuration, not an organization setting). |

### Pull requests

| Verb | TS export | Arguments and options | Result and rules |
|---|---|---|---|
| `provider_prs_list` | `prsList` | `[repo]`; `state` (`open`/`closed`/`merged`/`all`), `head`, `base`, `search`, `author`, `label`, `limit`, `json`, `jq` | `[Pull request]` in `stdout`. `closed` includes abandoned (closed-unmerged) pull requests. `author` and `label` are named errors on Azure. |
| `provider_prs_view` | `prsView` | `[repo] NUMBER`; `json`, `jq` | Pull request in `stdout` |
| `provider_prs_diff` | `prsDiff` | `[repo] NUMBER`; `nameOnly` | Changed files: paths, one per line, with `nameOnly`; otherwise GitHub prints the patch and Azure one `{path, changeType}` object per line. A caller that needs patch text on Azure diffs the two commits locally. |
| `provider_prs_create` | `prsCreate` | `[repo]`; `title`, `body`, `bodyFile`, `head`, `base`, `draft`, `label[]`, `reviewer[]`, `assignee[]` | The pull request's URL (GitHub) or id (Azure) in `stdout`. Azure accepts `assignee` and warns: there is no PR assignee. |
| `provider_prs_merge` | `prsMerge` | `[repo] NUMBER`; `method` (`squash`/`merge`/`rebase`, default `rebase`), `deleteBranch`, `admin`, `subject`, `body`, `matchHeadCommit` | Success is `status` 0. The source branch is deleted only when `deleteBranch` is `true` (opt-in on both providers). A method outside the three words is a named error before any request. `merge` is Azure's `noFastForward` strategy; `admin` is Azure's `bypassPolicy`. `matchHeadCommit` refuses the merge unless the PR head is still that SHA (GitHub passes `--match-head-commit` to `gh pr merge`; Azure compares it with `lastMergeSourceCommit` before sending anything). On Azure the verb waits for the asynchronous completion (30 checks, 2 seconds apart by default) and fails with the host's message if the merge fails or the PR is abandoned. |
| `provider_prs_comment` | `prsComment` | `[repo] NUMBER`; `body`, `bodyFile` (`-` is stdin) | Display value in `stdout`: the comment's URL (GitHub) or the bare thread id (Azure). Both providers post the file's content, not its path. On Azure the thread carries no status: not Active (which could block a comments-resolved merge policy), and while it holds a single comment it is not a review thread, so `prsThreadsPage` leaves it out; once someone replies it is listed. |
| `provider_prs_threads_page` | `prsThreadsPage` | `[repo] NUMBER [CURSOR]` | Review thread page (shape above) in `stdout` |
| `provider_prs_thread_create` | `prsThreadCreate` | `[repo] NUMBER`; `body`, `path`, `line`, `side` (`LEFT`/`RIGHT`) | `{thread: {url}}` JSON in `stdout`. With `path` and `line` the thread is inline. |
| `provider_prs_thread_reply` | `prsThreadReply` | `[repo] NUMBER COMMENT_ID BODY` | Comment record in `stdout`. `COMMENT_ID` is the opaque ref `prsThreadsPage` prints. On Azure it is `<thread>/<comment>` (nests under that comment) or a bare thread id (nests under the thread's first comment). On GitHub it is the whole numeric REST id: `12abc` or an Azure-shaped `5/9` is a named error. |
| `provider_prs_thread_resolve` | `prsThreadResolve` | `[repo] THREAD_REF` | `true` in `stdout` once the thread is resolved; `unknown` when Azure answers without a status. The ref is a GraphQL node id on GitHub (global: the repository is ignored) and `<pr>/<thread>` on Azure; Azure thread routes are repository-qualified, so the facade passes the spec, else `DEVENV_REPO`, beside an unprefixed ref, while a fully prefixed `<repo>/<pr>/<thread>` ref (two or more slashes) is passed through alone and carries its own repository whatever the resolved one. |

### Pipelines

| Verb | TS export | Arguments and options | Result and rules |
|---|---|---|---|
| `provider_pipelines_run_list` | `pipelinesRunList` | `[repo]`; `branch`, `status`, `limit`, `json`, `jq` | `[Run]` as JSON text, newest first. `status` portable words: `queued`, `in_progress`, `completed`, `success`, `failure`, `cancelled`; a word a provider cannot honor is an error naming the option (never an unfiltered list). On Azure `success` also matches partially succeeded builds, as the run record reports both as success. |
| `provider_pipelines_run_view` | `pipelinesRunView` | `[repo] RUN_ID`; `json`, `jq` | Run as JSON text. On Azure `url` is the build's browser page (`_build/results?buildId=N`), not the REST address, and `jq` supports `.field` only (an absent value is the empty string). GitHub forwards `json`/`jq` to `gh run view`. |
| `provider_pipelines_run_watch` | `pipelinesRunWatch` | `[repo] RUN_ID`; flags (`--exit-status`) | `{ stdout, stderr, status }`. Progress output until the run completes (GitHub: `gh`'s text; Azure: one run record per 10-second poll, at most 120 polls, then a timeout error). With `--exit-status`, non-zero `status` unless the run succeeded: on Azure the provider throws and the facade turns that into `status` 1 with the reason in `stderr`. |
| `provider_pipelines_workflow_list` | `pipelinesWorkflowList` | `[repo]`; flags (`--json F`, `--jq P`/`-q P`) | `[Workflow]` as JSON text. Azure rejects any other flag by name. |
| `provider_pipelines_workflow_run` | `pipelinesWorkflowRun` | `[repo] WORKFLOW`; flags (`--ref REF`, `-f`/`--field K=V`, repeatable) | `{ stdout, stderr, status }`. Azure: the new run's id in `stdout`. GitHub: `gh`'s confirmation text; it does not return the id. Azure's default ref is the repository's default branch. Azure rejects any other flag by name. |
| `provider_pipelines_run_rerun` | `pipelinesRunRerun` | `[repo] RUN_ID`; flags | `{ stdout, stderr, status }`. Azure retries the whole build and rejects any flag by name; GitHub also accepts `--failed` and `--debug`. |
| `provider_pipelines_run_cancel` | none in the facade | `repo RUN_ID` | Provider-level only. |
| `provider_pipelines_run_artifacts` | `pipelinesRunArtifacts` | `repo RUN_ID` | `[{id, name, size_in_bytes, created_at, url}]` as JSON text |
| `provider_pipelines_run_download` | `pipelinesRunDownload` | `[repo] RUN_ID`; flags (`-n`/`--name NAME`, `-D`/`--dir DIR`) | `{ stdout, stderr, status }`. Writes the artifacts to the directory (created when missing; Azure writes `<name>.zip`); only the named artifact with `-n`, and a name that matches nothing is an error. Azure refuses an artifact name containing `/`, `\` or `..`. Azure rejects any other flag by name. |

### Projects and boards

Projects (GitHub) and boards (Azure) belong to an owner or project, not a repository. The
facade exposes the verbs as the members of the object `projectsOps()` returns, every one async
so call sites await uniformly.

| Verb | `projectsOps` member | Arguments | Result and rules |
|---|---|---|---|
| `provider_projects_list` | none | `[repo]`; `--owner`, `--format json`, `--jq` | The projects or boards. Provider-level only. |
| `provider_projects_field_list` | `fieldList` | `PROJECT_NAME OWNER` | The Status options (text) |
| `provider_projects_item_add` | `itemAdd` | `PROJECT_NUMBER ISSUE_URL OWNER` | Nothing. On Azure a no-op success: work items are born on the board. |
| `provider_projects_id_by_name` | `idByName` | `OWNER NAME_OR_NUMBER` | The project's id |
| `provider_projects_item_id_for_issue` | `itemIdForIssue` | `PROJECT_ID ISSUE OWNER REPO` | The issue's item id in the project |
| `provider_projects_field_option_ids` | `fieldOptionIds` | `PROJECT_ID FIELD OPTION` | `{ fieldId, optionId }` |
| `provider_projects_field_set` | `fieldSet` | `PROJECT_ID ITEM_ID FIELD_ID OPTION_ID` | `boolean`: `false` means the host reported the item not updated. Azure's verb throws on failure, so the facade reports `true` on return. |
| `provider_projects_for_issue` | `forIssue` | `ISSUE_URL OWNER` | One `{title, number, status}` row per project (`status` is `-` when none). A status is one of `[workflows] status_workflow`. Azure's tab-separated lines are parsed by the facade. |
| `provider_projects_number_by_name` | none (`projectsNumberByName` is a separate facade export) | `OWNER NAME_OR_NUMBER` | The project number `gh project item-add` keys on. GitHub only; the facade throws a named error on Azure. |

### Organization

| Verb | TS export | Arguments and options | Result and rules |
|---|---|---|---|
| `provider_org_rulesets_list` | `orgRulesetsList` | `repo` | `[Ruleset]` as JSON text |
| `provider_org_ruleset_get` | `orgRulesetGet` | `repo ID` | The ruleset, host-shaped, as JSON text |
| `provider_org_ruleset_create` | `orgRulesetCreate` | `repo PAYLOAD_FILE` | `{ ok, stderr }`. A rejected write is `{ ok: false, stderr }` on both providers (the facade converts Azure's thrown provider error), so callers classify failures the same way; any other error is a defect and propagates. The payload is a GitHub ruleset; Azure translates the pull-request rule to a reviewers policy. |
| `provider_org_ruleset_update` | `orgRulesetUpdate` | `repo ID PAYLOAD_FILE` | `{ ok, stderr }` as for create. Azure writes the payload's protection for every branch it names (updating in place where a policy exists), then retires only the policy `ID` it was given, when no write reused it, and logs which one; protection on other branches is never touched, and none is removed before the new one exists. A ruleset that names no branch a policy can hold (a wildcard, a tag ref, a bare name) is an error; on Azure `~ALL` protects the default branch only, with a warning. |
| `provider_org_releases_list` | `orgReleasesList` | `repo`; flags (`--limit N`, `--json F`, `-q P`) | `[Release]` as JSON text, newest first. Azure reads git tags and takes no flags: any flag is an error. |
| `provider_org_packages_list` | none in the facade | `[ENDPOINT]` | Azure only for now: the Artifacts feeds list. Not yet ported to the TypeScript GitHub module. |
| `provider_org_package_versions` | none in the facade | `ENDPOINT` | The Azure verb always throws (feed-scoped versions have no GitHub-shaped analog). Not yet ported to the TypeScript GitHub module. |
| `provider_org_feeds_list` | none in the facade | | Azure Artifacts feeds (`[{name, id, url}]`). Azure only. |

### Addresses and credentials

| Verb | TS export | Result |
|---|---|---|
| `provider_web_host` | `webHost` | The host's web hostname (provider-level) |
| `provider_web_url` | `webUrl` | The browser address of a repository path, from a repository spec and a path (provider-level) |
| `provider_pr_web_url` | `prWebUrl` | The browser address of a pull request, from a repository spec and a number |
| `provider_extract_url` | `extractUrl` | The first host URL in a command's output, optionally filtered to a path prefix; `null` when none |
| `provider_remote_to_web` | `remoteToWeb` | A git remote URL as a clean https web address; `null` when the remote is not this provider's host |
| `provider_remote_to_spec` | `remoteToSpec` | A git remote URL as a repository spec; `null` when the remote is not this provider's host |
| `provider_git_transport_url` | `gitTransportUrl` | The clean HTTPS URL git fetches a repository from, with no embedded credential |
| `provider_auth_status_ok` | `authStatusOk` | `true` when the provider's credential is usable |

## Seam support

The shared seam lives in `provider-core.ts`, not in a provider. These exports are not
per-provider verbs; the test confirms each still exists.

<!-- contract:seam -->
```text
providerDetect | the active provider's name, from [provider] name in devenv.config
providerRepoTarget | the one repository resolver: argument, DEVENV_REPO, the provider's environment, the working directory
providerRepoSplit | split a repository spec into owner and name
requireRepoTarget | resolve the target or fail with the standard message
providerOrgGet | the organization the workspace operates in, from [organization] org or the setup seed
providerUserGet | the authenticated user's login
providerDeclareCapability | a provider module declares a capability as a load side effect
providerHasCapability | whether the active provider declared a capability
providerRequireCapability | fail with the standard "does not support" error unless declared
unknownOption | the named error for an option a flag-list verb does not accept
needValue | the named error for a valued flag at the end of a flag list
ensureProviderAuth | check the provider's credential once, or stop with guidance
providerAuthToken | resolve the provider's credential
ProviderError | the error class every verb throws for its own failures
```
<!-- /contract:seam -->

Capabilities a provider declares (`project-boards`, `rulesets`, `native-issue-types`,
`pipelines`) gate the tools that depend on them; `facade/provider-loader.ts` loads a family
first, because loading is what declares them, then runs the gate.
