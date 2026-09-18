# GitHub CLI Call Inventory

Complete catalog of every `gh` invocation across devenv tooling, classified by
domain, repo-targeting idiom, output shape, and read-vs-mutation. This is the
source of truth for the provider facade surface:
domain APIs are derived from what callers actually do, not designed top-down.

Counts below are call sites, not lines. `gh api graphql` is listed as `api
graphql`. Files are relative to `tools/`.

## Summary

| Domain | Lib call sites | Script call sites | Notes |
|---|---|---|---|
| issues | 22 | 43 | largest domain; includes type mapping + label policy |
| prs | 25 | 21 | list/view/create/merge/diff/comment + threads |
| repos | 8 | 15 | view/list/create/edit + branch protection |
| actions | 20 | 14 | runs/workflows incl. polling + artifacts |
| projects | 0 | 8 | GraphQL surfaces; GH-only capability |
| rulesets | 9 | 3 | REST rulesets; GH-only capability |
| releases | 0 | 1 | list only |
| org issue-types | 1 | 1 | GraphQL; GH-only capability |
| artifacts | 2 | 3 | run artifacts (actions domain) |
| milestones | 0 | 1 | issue-groom; issues domain |
| auth | 2 | 2 | auth seam territory |
| **total** | **~89** | **~112** | |

## Library call sites (`tools/lib/*.bash`)

### github-helpers.bash (18)

| Line | Call | Domain | Target idiom | Output | R/M |
|---|---|---|---|---|---|
| 82 | `gh repo view --json owner` | repos | none (cwd) | json field | R |
| 128 | `gh repo view --json nameWithOwner` | repos | none (cwd) | json field | R |
| 181 | `gh auth status` | auth | — | status | R |
| 187 | `gh auth login --with-token` | auth | — | — | M |
| 220 | `gh auth status` | auth | — | status | R |
| 266 | `gh run list -R $repo --branch --limit 10` | actions | `-R` | text | R |
| 272 | `gh run list -R $repo --branch --limit 1` | actions | `-R` | text | R |
| 350 | `gh run list -R $repo --branch --limit 10` | actions | `-R` | text | R |
| 356 | `gh run cancel -R $repo $id` | actions | `-R` | — | M |
| 374 | `gh label list $repo_spec --json name` | issues | repo_spec array | json | R |
| 375 | `gh label create $label $repo_spec` | issues | repo_spec array | — | M |
| 30, 65, 80, 108, 192, 222, 239 | comments/examples only | — | — | — | — |

Notes: `ensure_gh_login` (line 179) is the auth-seam absorption point; its
`exit 1` (line 192) is the recorded anti-precedent — provider libs never exit.
`get_full_repo_name` resolves repos from the cwd — the facade must support
"no explicit target" resolution, not just `-R`/`GH_REPO=`.

### issue-operations.bash (19)

| Line | Call | Domain | Target idiom | Output | R/M |
|---|---|---|---|---|---|
| 188, 193, 198 | `gh issue list $gh_args` | issues | args-built | text/json | R |
| 271 | `gh issue list \| jq` | issues | args-built | json | R |
| 318, 362 | `gh pr list $gh_args` | prs | args-built | text/json | R |
| 425 | `gh pr create $gh_args` | prs | args-built | — | M |
| 480 | `gh issue close $n $args` | issues | args-built | — | M |
| 525 | `gh issue reopen $n $args` | issues | args-built | — | M |
| 586 | `gh issue view $issue $args` | issues | args-built | presence | R |
| 713, 722 | `GH_REPO=… gh issue edit $n --type $t` | issues | `GH_REPO=` env | — | M |
| 753 | `GH_REPO=… gh api` (issue types lookup) | org issue-types | `GH_REPO=` env | json | R |
| 813, 828 | `GH_REPO=… gh api` (issue type normalize) | org issue-types | `GH_REPO=` env | json | R |

Notes: the args-built idiom (`"${gh_args[@]}"`) frequently embeds `GH_REPO=`
or `-R` upstream in the call chain; the facade's `provider_repo_target`
normalization must cover all three: explicit `-R`, env prefix, and args-array
pass-through.

### repo-types.bash (9)

| Line | Call | Domain | Target idiom | Output | R/M |
|---|---|---|---|---|---|
| 425 | `gh api repos/$f/rulesets` | rulesets | interpolated URL | jq field | R |
| 435 | `gh api --input … -X PUT repos/$f/rulesets/$id` | rulesets | interpolated URL | — | M |
| 449 | `gh api --input … -X POST repos/$f/rulesets` | rulesets | interpolated URL | — | M |
| 553, 626 | `gh api -X PATCH repos/$f` | repos | interpolated URL | — | M |
| 588 | `gh repo edit $f --template` | repos | interpolated name | — | M |
| 672 | `gh api $api_flags` | repos (generic) | prebuilt flags | — | R/M |
| 748 | `gh api -X PUT orgs/$o/teams/$t/repos/$f` | repos (perms) | interpolated URL | — | M |
| 759 | `gh api -X PUT repos/$f/collaborators/$n` | repos (perms) | interpolated URL | — | M |

Notes: rulesets CRUD is the flagship GH-only capability surface (AC-3).
Full-name interpolation (`repos/${full_name}/...`) is a third targeting shape —
URL-embedded — that the facade absorbs rather than normalizes away.

### git-operations.bash (6)

| Line | Call | Domain | Target idiom | Output | R/M |
|---|---|---|---|---|---|
| 158 | `gh pr list $repo_args --head --base` | prs | repo_args array | text | R |
| 177 | `gh pr view $repo_args $n` | prs | repo_args array | text | R |
| 331 | `gh pr merge $repo_args $n --squash --delete-branch` | prs | repo_args array | — | M |
| 373 | `gh pr merge $merge_args` | prs | prebuilt args | — | M |
| 580 | `gh api -X PUT repos/$f/branches/$b/protection` | repos | interpolated URL | — | M |
| 629 | `gh api -X PATCH repos/$f -f k=v` | repos | interpolated URL | — | M |

### artifact-operations.bash (2)

| Line | Call | Domain | Target idiom | Output | R/M |
|---|---|---|---|---|---|
| 161 | `gh api $endpoint $params --paginate` | artifacts (issue art.) | prebuilt endpoint | raw | R |
| 261 | `gh api $endpoint --paginate` | artifacts (packages) | prebuilt endpoint | raw | R |

Notes: issue artifacts and package versions, both paginated REST reads via
prebuilt endpoints. Pagination is exercised here in production code — the
stub factory's `STUB_GH_PAGES` queue exists to test exactly this shape.

### issues-config.bash (1)

| Line | Call | Domain | Target idiom | Output | R/M |
|---|---|---|---|---|---|
| 171 | `gh api graphql -f query=$q` | org issue-types | org from context | json | R |

### repo-operations.bash (1)

| Line | Call | Domain | Target idiom | Output | R/M |
|---|---|---|---|---|---|
| 66 | `gh repo list $org --limit --json name` | repos | positional org | jq | R |

## Script call sites (`tools/scripts/*.sh`)

Subcommand frequency across the 40 gh-calling scripts:

```
 38 gh issue*      20 gh api*       13 gh pr*        12 gh repo*
  9 gh run*         6 gh project*    5 gh workflow*   4 gh label*
  2 gh auth*        1 gh release*    (+ graphql variants inside api)
```

Per-script verb map (unique verbs per script):

| Script | Verbs | Domain |
|---|---|---|
| actions-artifacts.sh | api (actions artifacts), run download | actions |
| actions-list.sh | repo list, workflow list | actions, repos |
| actions-rerun.sh | run rerun, run view | actions |
| actions-run.sh | run list, workflow run | actions |
| actions-status.sh | repo list, run list | actions, repos |
| actions-watch.sh | run list, run watch | actions |
| cs-dependencies-update-wizard.sh | api (default branch) | repos |
| issue-artifact-get.sh | api (issue comments, paginated) | issues |
| issue-artifact-list.sh | api (issue comments, paginated) | issues |
| issue-artifact-upsert.sh | api (issue comments CRUD) | issues |
| issue-comment.sh | issue comment | issues |
| issue-create.sh | auth status/login, issue create, project item-add, project list, repo view | issues, auth, projects |
| issue-get.sh | issue view | issues |
| issue-groom.sh | api (milestones), issue edit, issue view | issues |
| issue-label-create.sh | label create, label edit, label list | issues |
| issue-label-list.sh | label list | issues |
| issue-list.sh | issue list | issues |
| issue-search.sh | issue list | issues |
| issue-select.sh | issue edit, issue view | issues |
| issue-update.sh | issue close, issue edit, issue reopen, issue view | issues |
| org-issue-types.sh | api graphql (org issueTypes) | org issue-types |
| pr-comment.sh | pr comment | prs |
| pr-complete-merge.sh | repo view | prs, repos |
| pr-create-for-merge.sh | pr list | prs |
| pr-create-for-review.sh | pr create | prs |
| pr-diff.sh | pr diff | prs |
| pr-get-merge-link.sh | pr list | prs |
| pr-get-review-link.sh | pr list | prs |
| pr-get.sh | pr view | prs |
| pr-list.sh | pr list | prs |
| pr-merge-pull-request.sh | repo view | prs, repos |
| pr-review-comment.sh | api graphql (repo id + review thread ops), pr view | prs |
| pr-thread-reply.sh | api (POST pull comment reply) | prs |
| pr-thread-resolve.sh | api graphql (thread resolve) | prs |
| project-add-issue.sh | issue view, project item-add, project list, repo view | projects, issues |
| project-update-issue.sh | project field-list, repo view, workflow stages | projects |
| release-list.sh | release list | releases |
| repo-create-new-service.sh | repo create | repos |
| repo-create.sh | api (commits probe), repo create, repo view | repos |
| ruleset-export.sh | api (rulesets list/get, paginated) | rulesets |

## Targeting idioms (normalization scope for `provider_repo_target`)

1. **`-R owner/repo` flag** — github-helpers run/label calls, most scripts
2. **`GH_REPO=` env prefix** — issue-operations type mapping and api calls
3. **Args-array pass-through** — issue-operations `${gh_args[@]}` (embeds one
   of the above upstream)
4. **Prebuilt args/endpoint interpolation** — repo-types, artifact-operations
   (URL-embedded `repos/${full_name}/...`)
5. **Implicit cwd resolution** — github-helpers `gh repo view` without `-R`
   (via `get_full_repo_name`)

The facade must accept (1)–(3) explicitly and preserve (4)/(5) semantics at
the GitHub layer.

## Facade surface implications (feeds Phase 2)

- **issues** is the highest-traffic domain and must cover: list / view /
  create / close / reopen / edit (incl. `--type` native mapping) / comment /
  label list-create-edit / milestone list / artifact comments (paginated api).
- **prs** covers: list / view / create / merge / diff / comment / review
  threads (GraphQL reply/resolve) / merge-link lookups.
- **actions** covers: run list / view / watch / rerun / cancel / download,
  workflow list / run, polling (stay-at-domain rule), artifacts.
- **repos** covers: view / list / create / edit / template, branch protection,
  team/collaborator perms, default-branch probe.
- **GH-only capability surfaces** (flag + defined degradation): rulesets,
  projects (GraphQL boards), org issue-types, native issue `--type` editing.
- **auth**: `auth status` checks and token-login — absorbed by the auth seam
  (`ensure_gh_login`), never called directly by domain modules.
