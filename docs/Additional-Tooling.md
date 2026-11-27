# Additional Tooling

This document provides comprehensive documentation for all additional tooling available in the development environment. These tools live in the `tools/ts/` (TypeScript) folder, are surfaced through generated depth-1 `tools/` PATH stubs, and are automatically added to the `PATH` when the development environment is set up.

## Bootstrap Bash Libraries

The bash under `tools/lib/` is the container bootstrap surface: the minimal layer that must run before node exists. These files are sourced by `.devcontainer/` bootstrap and startup scripts and by the host-side `setup`; tools never source them. The complete allowlist, who sources each file and what each keeps is in the providers README under [Bash bootstrap surface](../tools/lib/providers/README.md#bash-bootstrap-surface); the rules for the layer are in [Tooling Standards](./Tooling-Standards.md#the-bash-that-remains). Reusable tool logic lives in the TypeScript libraries described under [Shared Libraries](#shared-libraries).

### `copilot-knowledge.bash`

Provides shared Copilot knowledge sync helpers.

Public functions:

- `build_provider_git_auth_header <token>`
  - Prints the active provider's `http.extraheader` value for git HTTPS operations, from the provider's `git_auth_header` bootstrap hook.
- `pull_copilot_knowledge_on_container_start <toolbox_root>`
  - Runs a non-blocking background `git fetch/pull` for `<toolbox_root>/copilot/knowledge`.
  - No-op when `copilot/knowledge` is not an initialized git repository.
  - Used by `.devcontainer/startup.sh` so each container start refreshes Copilot knowledge when available.
- `pull_copilot_engineering_on_container_start <toolbox_root>`
  - The same non-blocking refresh for `<toolbox_root>/copilot/engineering`.
- `pull_copilot_side_repo_on_container_start <repo-dir>`
  - The shared implementation behind both: a background `--ff-only` pull that is a no-op when the directory is not a git repository.

### `rewrite-detect` (TS)

Shared classifier for the devenv self-update flow, now in
`lib/core/git.ts` (`rewriteDetectState`): given the current branch, decides
whether its divergence from `origin/<branch>` is a rewritten remote (a fork
sync force-push) and, if so, whether the clone can be safely reset (`clean`
— local HEAD is a past remote tip from the reflog) or needs a rebase
(`diverged` — unique local work). Returns the pre-rewrite tip so the
`Devenv-Action` trailer scan can be bounded to genuinely new upstream
commits. Consumers: `git-update`, `check-update-devenv-repo.sh`,
`devenv-update` (the historical `rewrite-detect.bash` retired with the bash
verb layer).

### `lib/domain/issues/graph.ts` (workflow state engine)

Policy and orchestration for issue status: the vocabulary model, rollup
computation, and the write/propagation path. Zero direct I/O in the pure
model — reads go through the issue-hierarchy helpers, writes fan out through
the `project-update-issue` wrapper (`--status --all-projects --safe`, with
`--devenv` added only when `DEVENV_REPO` is unset).

Public surface:

- `workflowOrder(devenvRoot?)` — the status vocabulary from
  `devenv.config [workflows] status_workflow` (or a `WORKFLOW_ORDER_OVERRIDE`).
- `statusOrder(token)` — a token's position in the vocabulary (-1 unknown).
- `computeRollup(statuses)` — pure min-rollup: all pre-delivery → undefined
  (parent keeps own state); otherwise the minimum with pre-delivery children
  floored at the configured delivery anchor.
- `workflowPolicy(devenvRoot?)` — the delivery anchor + status fallback knobs
  (`[workflows] delivery_segment_anchor` / `status_fallback`).
- `onEvent(event, issue)` — resolves an event via
  `tools/config/skill-events.yml` and writes the mapped status (the
  `_on_*` dispatcher's entire job).
- `applyStatus(issue, status, ctx, direction)` — forced/statused writes.
  `child` (default) rolls the parent up; `parent` cascades to children once
  and rejects gated (pre-delivery) statuses.
- `recomputeParent(issue)` — re-derives and writes a parent's status from
  its children (fired on sub-issue linking).
- `writeStatus(issue, status, ctx, mode)` — the single guarded write choke
  point (suppress mode = no upward propagation), change-gated recursive
  climb via `rollupParentOf`.

Tests: `tools/tests/ts/workflow-model.test.ts`,
`tools/tests/ts/workflow-orchestration.test.ts` (vitest, over this module);
the dispatcher contract lives in
`tools/tests/ts/on-event-dispatch.test.ts`.

### `lib/domain/issues/graph.ts` (issue hierarchy) + `issue-graph-link`

Issue-hierarchy I/O lives in the TS domain module `tools/lib/domain/issues/graph.ts`, consumed through the provider facade: native sub-issue graph with body-text parent fallback. Key exports: `parent(spec, issue)` (native `Issue.parent` first, `Part of #N` body-text fallback for pre-native issues) and `readStatus(...)` (first vocabulary-valid Status across the issue's projects; foreign-board values count as unreadable).

The user-facing verb is the `issue-graph-link` wrapper:

```bash
issue-graph-link PARENT CHILD [--unlink]
```

Both IDs accept `N` or `owner/repo#N` (cross-repo parenting works — the sub-issue API takes global node IDs); idempotent add; removing an absent link is a no-op.

Tests: `tools/tests/ts/url-seams.test.ts`, `tools/tests/ts/workflow-model.test.ts`.

## Diagnostics

### `devenv-memory-watch`

Samples container memory over time, persists the history in the repository, and writes a compact `current-culprits.tsv` summary for the latest analysis.

**Usage:**

```bash
devenv-memory-watch [OPTIONS]
```

**Options:**

- `--interval-minutes N`: Sample every `N` minutes (default `10`, maximum `35791`). A larger value is rejected with exit code 2 before anything is written, because the wait between samples must fit Node's timer limit (2^31-1 ms)
- `--top N`: Show the top `N` culprits in the report. Default: `10`
- `--state-dir PATH`: Persist samples in `PATH`. Default: `<repo>/.debug/devenv-memory-watch`
- `--max-processes N`: Cap the number of processes captured per sample. Default: `250`
- `--retain-days N`: Keep only samples from the last `N` days in both history files (a positive integer). Default: `7`
- `--reset`: Clear previous history before starting
- `--once`: Capture one sample, print the report, and exit

**Notes:**

- The script is restartable because it appends samples to disk instead of keeping state only in memory.
- It is intended for long-running OOM investigations where you want to compare usage over hours, not minutes.
- The report prints a short console summary and writes a `current-culprits.tsv` file with the current ranking, memory growth, and timestamps.
- Console output stays brief by default; the persisted TSV files still retain the full process signatures.
- Only one instance runs per state directory. The lock records the owner's pid and is refreshed every loop, so a second instance refuses (exit 2) while the first is alive, whatever the lock's age, and a dead instance's lock is reclaimed. SIGINT and SIGTERM release the lock, and a refused instance never touches the owner's lock or history (not even with `--reset`).
- The lock is a pid file created atomically (a temporary file published with a hard link), so the lock never exists empty or partial. On filesystems without hard links (EPERM, ENOTSUP, EXDEV, ENOSYS) it falls back to a plain exclusive create of the lock file; a lock created that way can exist empty for a moment while another instance reads it, which is why an empty or unparsable lock is reclaimed only through the remove-if-unchanged check. If the write fails after the lock file was created, the lock it created is removed before the error is reported. If the lock file cannot be created at all, the tool prints `cannot create the lock file in <dir>: <reason>` and exits 2.
- Retention: after each capture the sample and process files are trimmed together to the retention window (7 days by default). The newest sample is always kept, sample numbers are never reused, and the report covers the retained window only.

## Repository Management

Tools for managing repositories, cloning, updating, and working with multiple repositories.

### `repo-get`

Clones a repository from the git host into the `repos/` folder. Also accepts a full URL to clone a **foreign** repository (outside the organization) into the same flat `repos/` folder.

**Usage:**

```bash
repo-get [--select] [<repository-name>|<repository-url>]
```

**Options:**

- `--select`: Show an interactive selection menu of repositories in the organization (excludes already cloned repos)
- `<repository-name>`: Name of the repository to clone/update
- `<repository-url>`: Full URL (`https://`, `git@`, or `ssh://`) to a foreign repository — cloned/updated by its basename, no org credential wiring (auth is your own git config; public repos need none). Refuses when the derived folder already exists as a clone of a different repository.
- `--run-scripts`: Run the repository's `.repo/init.sh` and `.repo/update.sh` even when its origin is not owned by the organization. They always run for org-owned origins; a foreign repository's scripts are arbitrary code, so they are skipped (with a notice) unless this flag is given.
- No arguments: Update the current repository (based on git context)

**Examples:**

```bash
# Interactive selection from available repos
repo-get --select

# Clone or update a specific repository
repo-get devops

# Clone a foreign (outside-org) repository into repos/<basename>
repo-get https://github.com/octocat/Hello-World.git

# Update current repository
repo-get
```

**Notes:**

- Automatically configures git settings from `git-config.sh`
- Supports SSH-first cloning with HTTPS fallback; HTTPS credentials resolve through the provider credential helper (keychain — no token env var)
- Automatically detects default branch (main/master)
- Runs `.repo/init.sh` and `.repo/update.sh` hooks if present
- Supports partial repo names for convenience
- Prevents cloning into reserved directories
- Interactive selection requires `fzf` (pre-installed in dev container)

### `repo-create`

Creates a new repository on the git host using standardized org rules, then clones it locally and optionally runs a post-creation script.

**Usage:**

```bash
repo-create <repo-name> --type <type> [options]
repo-create --interactive                  # prompts for type and name
```

**Key options:**

- `--type <type>`: Required (planning|documentation|devops|gitops|tool|template|service|gateway|app-web|cs-library|ts-package|none)
- `--interactive` / `-i`: fzf-driven type picker + name prompt
- `--public` | `--private`: Visibility (default: private)
- `--description <text>`: Repository description
- `--no-template`: Skip the type’s template repo
- `--no-branch-protection`: Skip ruleset setup
- `--no-clone`: Do not clone after creation
- `--no-post-creation`: Skip running the post-creation script (if defined)

**What it enforces:**

- Naming patterns per type (see `tools/config/repo-types.yaml`)
- GitHub repository rulesets on `master` (requires GitHub Pro or public repo)
- Template repos per type (optional, can be skipped)
- Template repository marking (via `isTemplate` config property)
- Local clone via `repo-get` after creation
- Post-creation script execution (per type) with configurable commit handling

**Architecture:**
The script uses the repo-types domain module (`tools/lib/domain/repos/types.ts`) to manage repository configuration, validation, and ruleset application. The module provides common functions for:

- Loading and validating `repo-types.yaml`
- Validating repository names against type-specific patterns
- Applying GitHub rulesets via the GitHub API

**Post-creation behavior (from repo-types.yaml):**

- `post_creation_script`: Path in the repo (e.g., `.repo/post-create.sh`). If present, it runs after clone.
- `delete_post_creation_script`: If true, script is deleted after it runs (default: true).
- `post_creation_commit_handling`: `none` | `amend` | `new`
  - `amend`: Amend the initial commit and force-push if the script made changes
  - `new`: Create a new commit and push if there are changes

**Ruleset configuration (`rulesetConfigFile`):**
Each type can specify a GitHub repository ruleset JSON file:

- `rulesetConfigFile`: Filename in `tools/config/` (e.g., `ruleset-default.json`)
- Set to `null` or blank to skip ruleset application
- JSON file is a GitHub ruleset export (from `policy-export <ID> --output <file>`)
- Supports token replacement:
  - `{{repo_name}}` - Repository name
  - `{{owner}}` - Organization/owner
  - `{{type_name}}` - Repository type key
  - `{{type_description}}` - Type description from config
- Rulesets require GitHub Pro or a public repository; failures gracefully degrade with a warning

**Creating custom ruleset JSON:**

1. Configure ruleset in GitHub UI for a test repo
2. Export: `policy-export <RULESET_ID> --output <file>`
3. Save to `tools/config/my-ruleset.json`
4. Replace hardcoded values with tokens
5. Reference in type config: `rulesetConfigFile: my-ruleset.json`

**Commit message patterns:**
Commit message patterns use Conventional Commits format and support optional breaking-change marker (`!`):

```text
^(feat|fix|docs|chore|refactor|test|major|minor|patch)!?:\s.+
```

Examples:

- `feat: add new feature`
- `fix!: breaking change in fix`
- `docs: update README`

**Examples:**

```bash
# Create a service with description and custom visibility
repo-create service.platform.auth --type service --description "Authentication service" --public

# Create a web app with custom description
repo-create app.web.dashboard --type app-web --description "User dashboard application"

# Interactive mode
repo-create --interactive
```

**Interactive mode:**

- Uses `fzf` to pick a type and shows an example name
- Prompts for repository name
- Prompts for optional description
- Applies all rules above after selection

**Config file:** `tools/config/repo-types.yaml` controls types, templates, naming patterns, rulesets, post-creation scripts, and commit handling.

**Note on rulesets:**
If repository rulesets cannot be applied during creation (e.g., your organization is not on GitHub Pro or the repo is private), use `repo-update-config.sh` later to apply the rulesets to an already-created repository. See the [repo-update-config](#repo-update-configsh) section for details.

### `repo-update-all`

Updates all repositories in the `repos/` folder in parallel.

**Usage:**

```bash
repo-update-all [--jobs N]
```

**Options:**

- `--jobs N`: Set the number of parallel jobs (default: 4)

### `repo-get-web-url`

Outputs the web URL for the current repository on the git host.

**Usage:**

```bash
repo-get-web-url
```

## Issues (batch creation)

### `issue-create-batch`

Creates multiple issues from a YAML/JSON manifest using deterministic, non-interactive issue creation.

**Usage:**

```bash
issue-create-batch --file MANIFEST [--parent ISSUE_NUM] [--dry-run] [--continue-on-error]
```

**Options:**

- `--file FILE`: Manifest path (required), with top-level `issues` array
- `--parent ISSUE_NUM`: Default parent issue for rows that omit `parent`
- `--dry-run`: Print create commands without creating issues
- `--continue-on-error`: Keep processing rows after failures

**Manifest row fields:**

- Required: `title`, `type`
- Optional: `body` or `body_file`, `labels[]`, `assignees[]`, `milestone`, `project`, `parent`, `blocked_by[]`

**Examples:**

```bash
issue-create-batch --file child-issues.yaml
issue-create-batch --file child-issues.yaml --parent 1
issue-create-batch --file child-issues.yaml --dry-run
```

## Git Extensions

Enhanced Git commands that extend basic Git functionality with additional features.

### `git graph`

Provides a graphical display of the commit history for the current branch.

```bash
git graph
```

### `git graph-all`

Provides a graphical display of the commit history for all branches.

```bash
git graph-all
```

### `git prune-branches`

Prunes local branches that are no longer needed (merged or deleted on remote).

```bash
git prune-branches
```

### `git repo`

The same as the `repo-get` command, but can be used as a Git subcommand.

```bash
git repo <repository-name>
```

### `repo-commit`

The single sanctioned commit wrapper (source: `tools/ts/repo-commit.ts`; invoke via the `tools/repo-commit` entry on `PATH`). The suggested message arrives on argv or via `--file <path>` (preferred for anything longer than a one-line subject — immune to shell mangling). On terminal and native VS Code paths, the configured editor opens with the message and only a non-empty human save commits. The tool refuses options (`-m`, `--yes`), non-interactive editors, and an empty index.

No-TTY AI sessions use an approval broker. The invoking `/devenv-commit` skill starts the lane with `--approval-session <opaque-token>`; `repo-commit` writes a one-use owner-only request below the Git common dir and exits without committing. The request is bound to the session token, repository, HEAD, staged diff, proposed message, lane, target, and a 10-minute expiry. The skill presents those facts through the host's structured prompt and writes a typed approve/edit/cancel response. The resume invocation supplies `--approval-request <path>` and `--approval-response <path>`; the tool atomically consumes the request, rechecks every identity field and digest, then runs the exact normal/amend/reword Git path with normal hooks. The approved message keeps the `Change-Id` trailer that `prepare-commit-msg` adds (a `Change-Id` already in the approved message is kept instead), and `--approval-request` may be given as a relative path. Replay, cancellation, timeout, malformed data, cross-session/repository mismatch, staged drift, and message drift cannot create a commit.

The existing no-terminal VS Code-tab exception remains available only when `core.editor` is exactly `code --wait`, a VS Code IPC hook is attached, and the real remote CLI exists below `~/.vscode-server/bin`. It is never discovered from an arbitrary `PATH` command. TTY paths and the VS Code-tab path use a generated launcher that records editor status; AI broker paths use the host prompt as the human-attribution boundary instead. Environment-supplied editors (`GIT_EDITOR`, `VISUAL`, `EDITOR`) never prove human approval on their own. Never stages (except via `--wip`), never bypasses hooks on gated lanes, never runs tests. A staged-stat echo (`staged: N files, +A −B`) keeps commit size visible before approval.

On a normal/editor failure, the tool classifies the result from the editor launch marker and saved message rather than stderr. On a broker failure, it reports the typed verification failure and leaves the index untouched. Git output is unredirected during the normal commit path: hook output streams live, and hook rejection means no commit exists.

The `--amend` lane folds staged content into HEAD whose fold window is still open under the same editor gate, preloading HEAD's existing message under a leading `# EDIT of a previous commit` banner (stripped by `--cleanup=strip`); with a clean index the amend is a **message-only rewrite** of HEAD (git replaces the message, the tree is untouched) — the sanctioned route for editing HEAD's message when nothing is staged (the staged-stat echo and dry-run output state which case applies); the normal lane's editor file carries an analogous `# NEW commit on top of: <sha> <subject>` banner; refuses fail-closed when master has already landed HEAD — the boundary is master-reachability (`origin/master`, or local `master` in repos without one), or a tag naming the commit — not remote-ref presence, so a pushed-but-unlanded PR-branch HEAD stays foldable (remediation named: `--fix` or a plain fix commit).

The `--fix <ref>` lane folds staged content into an earlier local commit as one editorless operation: preflight (staged required; target an ancestor of HEAD; not HEAD; not the root commit; fold window open — not landed in master, not tagged; HEAD redirects to `--amend`) → no other pending `fixup!`/`squash!`/`amend!` commit in the rewritten range (refused before any mutation: `--autosquash` would fold them too) → backup branch `backup/pre-fixup-<head>` → fixup commit (hooks run; this repo's commitlint config ignores `fixup!`/`squash!` subjects — a target repo without that ignores entry fails closed at the fixup commit, with the backup-branch recovery printed) → `GIT_SEQUENCE_EDITOR=: git rebase --autosquash --autostash -i <target>~1` (run with `rebase.updateRefs=false`, so a user-level `updateRefs=true` cannot move the backup branch) → verify against the saved old HEAD sha → report (folded target, backup ref, `--force-with-lease` reminder; never pushes). A conflict auto-aborts the rebase — the fixup commit survives at HEAD, nothing lost, state fully `git status`-describable. Bare `--fix` on a TTY opens an eligible-target picker (local-only ancestors, HEAD excluded); without a TTY it refuses with "pass a ref". `--dry-run` resolves and prints the target, staged stat, and rehash range without touching anything.

The `--reword <ref>` lane changes an earlier commit's message only: preflight (target an ancestor of HEAD; HEAD is valid on a clean index — a message-only rewrite, with staged content refused in favor of `--amend`; not the root commit; fold window open, same boundary as `--amend`/`--fix`) → backup branch `backup/pre-reword-<head>` → a rebase whose sequence-editor script marks the target `reword` and opens the user's editor on its message (the save is the permission gate; emptying the message aborts) → verify (the target's full message, `%B`, at its ancestry depth in the rewritten stack is compared against its message saved before the rebase, and the tree is compared against the saved old HEAD sha — a reword never touches content) → report with the recovery recipe. A reword whose message is saved unchanged is a clean no-op: exit 0 with a plain message, the branch is restored to its old HEAD if the rebase re-stamped it, and the backup branch this run created is removed — nothing is left changed. Staged content is not required and is left untouched; hooks run on the rebase; `--dry-run` prints the plan and mutates nothing. `--reword` runs with `rebase.updateRefs=false` and `rebase.autoSquash=false` (a user-level `rebase.autoSquash=true` can never reorder or fold commits during a reword), and refuses a range that holds a `fixup!`/`squash!`/`amend!` commit before any mutation. It refuses a range that contains merge commits (an interactive rebase would flatten them; reword by hand with `git rebase --rebase-merges`). A body-only or trailer-only reword is accepted — the subject need not change. Mutually exclusive with the other lanes; the ref must immediately follow `--reword`. After `--fix` and `--reword` the report ends with a remote-tracking note that says `diverged` only when the branch is both ahead of and behind its upstream (push with `--force-with-lease`), and otherwise reports ahead-only (a plain push suffices), behind-only, in sync, or no remote tracking.

The `--fold-window` lane is a read-only report: the branch's foldable commits (not landed in master, per the fold-window boundary above) newest-first, each with the files it touched, plus a cross-check naming fold candidates among them that the staged/working changes overlap. No staging requirement, no mutation; mutually exclusive with the other lanes.

Scratchpad refusal: blocked (exit 3) while a scratchpad is active in the repo — sandbox commits belong on the scratch branch via `repo-scratchpad commit`; salvage via `repo-scratchpad promote`.

The `--wip` lane delegates to `git-wip`: stages everything (unless `--staged-only`), bypasses hooks (the documented WIP exception), prefixes `WIP:`, pushes, and records `refs/wip/last`. WIP commit shape lives in `git-wip` alone; there is no editor step — invoking `--wip` is the confirmation.

```bash
repo-commit "feat(sync): add retry with backoff"
repo-commit --file /tmp/msg.txt          # long messages: write to a temp file first
repo-commit --wip "checkpoint before refactor"   # WIP lane (delegates to git-wip)
```

Governance: only the `/devenv-commit` skill invokes this tool (see `copilot-instructions.md` §7). All other skills hand off to that skill when the user says "commit this".

### `repo-stage`

The sanitized staging surface (source: `tools/ts/repo-stage.ts`): stages or unstages exactly the named literal repo-root-relative paths — the content-selection half of the commit-batching family (`repo-stage` fills the index, `repo-commit` commits it). Modes: bare paths (stage), `--unstage <paths>`, `--patch <file>` (stage exactly the patch's hunks — a single-file modification patch, applied to the index via `git apply --cached` with a check preflight), `--batch <manifest>` (validate + summary), `--batch <manifest> --group N` (validate, stage group N, echo stat), `--dry-run` on any mutating mode. Never prompts.

A commit-batch manifest is a strict markdown artifact (`.local-artifacts/` or outside the worktree — an in-tree manifest is itself untracked and coverage demands it be claimed): `# Commit batch: <title>`, `## group N — <subject>` sections (sequential from 1), `- <path>` whole-file entries, `- <path> @ <hunk-spec>` selector entries (partial claims: comma-separated 1-based hunk numbers / `a-b` ranges over the file's live unstaged diff, default U3 context — e.g. `- src/b.ts @ 1-2,4`), optional trailing `## excluded`. Subjects are informational echoes; `repo-commit` owns messages and never reads the manifest.

Batch validation runs on every invocation, before any mutation, refusing rather than warning: strict parse (any construct outside the grammar names its line), literal paths only (no globs, directories, absolute, or traversal — selector claims too), deletion-aware existence (a deleted file is stageable as a whole-file claim), duplicate membership (names both sections — at hunk grain too: the same hunk in two groups refuses; a path claimed whole AND by selectors, or excluded AND by selectors, refuses), coverage (every changed/untracked/deleted file must be claimed by a group or `## excluded` — computed against the live tree each run, so it self-heals as groups commit; every hunk of a partially-claimed file must belong to some group), and index purity (nothing staged outside the manifest union; no staged hunk content a group did not claim). Rename pairs count both paths. Mid-batch, every group's selectors are re-validated per invocation — after a partial commit the remaining groups' selectors have renumbered and refuse with drift until the manifest is renumbered.

Partial staging rides the engine in `tools/lib/domain/hunk-stage.ts`: selectors resolve against the live diff at staging time (regenerate + echo — after an earlier group stages or commits, the live hunks renumber, and stale selectors refuse with a drift diagnostic naming the live hunk count), the built patch is preflight-checked (`git apply --cached --check`) and applied to the index, then a line-multiset invariant is verified: staged +/- lines = prior staged ∪ selected hunks exactly, remaining unstaged lines = exactly the unselected hunks, working-tree bytes unchanged. A verification failure reports a `git restore --staged <path>` recipe — the tool never auto-restores. Refused classes in v1 (doctrine, not mechanics): binary files, rename pairs, new files, deletions — the diagnostics say so and suggest claiming the whole file.

`--patch` v1 limits (all fail-safe refusals — the lane never silently stages wrong content): marker scans classify from the patch preamble, so content lines quoting marker text can false-refuse with the wrong class; single-file is inferred from git headers, so a git+traditional mixed patch stages both files and then refuses (the restore recipe names the git-header path — check `git diff --cached --name-only` after any patch-lane refusal); and the monotone verification model refuses patches that cancel or amend already-staged content (net-correct applies) — unstage first, then re-patch.

```bash
repo-stage tools/ts/repo-stage.ts          # stage exactly this file
repo-stage --unstage tools/ts/repo-stage.ts
repo-stage --patch /tmp/h2.patch             # stage exactly the patch's hunks
repo-stage --batch .local-artifacts/batch-1.md            # validate + summary
repo-stage --batch .local-artifacts/batch-1.md --group 2  # stage group 2
repo-stage --batch .local-artifacts/batch-1.md --group 2 --dry-run
```

Exit 0 success/no-op, 1 validation failure, 2 usage error.

### `repo-batch-draft`

The commit-batch manifest generator (source: `tools/ts/repo-batch-draft.ts`): plan claims × live changed set → a draft manifest under `.local-artifacts/`. Read-only outside that folder; zero content decisions — unassigned and conflict parking lots are resolved by hand in the reviewed artifact. `Files:` bullets may carry hunk-selector claims (`` `path @ spec` ``) — rendered as selector entries verbatim; different hunks of one file may thus land in different groups (same-hunk duplication refuses at stage time; a whole-file claim plus a selector claim on the same path parks as a conflict).

```bash
repo-batch-draft --plan .local-artifacts/Plan-issue-42-001.md
repo-batch-draft                              # no plan: everything unassigned
```

Groups follow plan task order (subjects from `commit:` bullets when present); readiness annotations mark held groups (their own task open, or open-task overlap — which parks as a conflict first). Summary line reports groups / assigned / unassigned / conflicts.

### `git wip` / `git unwip` / `git wip-recover`

Work-in-progress commit management:

- `git-wip`: Stages all changes, creates a `WIP: <message>` commit (message optional — via positional words or `--file <path>`; with none the subject is a bare `WIP:`), pushes it with `git push origin HEAD:refs/heads/<current-branch>`, and records the commit in `refs/wip/last` for later recovery. Flags are parsed strictly (an unknown flag exits 2 before anything is staged); a message word that looks like a flag, such as `-n`, needs `--` first: `git-wip -- -n flag notes`.
  - Push-path scratchpad refusal: blocked (exit 3) while a scratchpad is active in the repo, or on any `scratchpad/*` branch — scratch commits bypass hooks and carry no `Devenv-Action`/`Change-Id` trailers; they must never reach shared history.
  - Protected-branch refusal: blocked (exit 3) on a protected branch — the remote's default branch, `master`, `main`, `develop`, `trunk`, `release/*` — and on a branch whose configured upstream or push target is protected. Nothing is staged, committed or pushed; there is no override. The advice follows why the target is protected: the branch name itself (switch to a feature branch); its upstream, `branch.<b>.merge` (`git branch --unset-upstream`); or its push target resolved through `@{push}` (adjust `remote.<r>.push`, `push.default` or `branch.<b>.pushRemote` so it pushes to its own name). It never advises `git branch -u origin/<b>`, since that remote branch may not exist.
  - Detached or unborn `HEAD`: blocked (exit 3) before anything is staged — a snapshot needs a branch name to be pushed under (the branch comes from `git symbolic-ref --quiet --short HEAD`; nothing is ever pushed to `refs/heads/HEAD`).
  - Commit and push require an interactive terminal: without a TTY it exits 2 unless `--allow-non-tty` is given. `--dry-run` is the safe probe.
  - `--staged-only`: Skip `git add -A` and commit only what is already staged.
- `git-unwip`: Soft-resets to the last non-WIP commit (restaging your changes) and safely force-pushes to clear the WIP commit from the remote. Does **not** delete `refs/wip/last`, so the WIP commit remains recoverable.
- `git-wip-recover`: Inspect or restore the most recently saved WIP commit from `refs/wip/last`.

```bash
git wip "saving progress"
git wip --staged-only "partial save"
git unwip

# After unwipping, recover if needed:
git wip-recover            # interactive: show summary, prompt to restore
git wip-recover --show     # print commit summary and diff stat
git wip-recover --branch   # check out a new branch 'wip-recovered' at the WIP commit
git wip-recover --branch my-branch  # check out as 'my-branch'
```

**Safety guards in `git-unwip`:**

1. **Protected branches** — refuses to run (exit 1) on the same protected list as `git-wip`: the remote's default branch, `master`, `main`, `develop`, `trunk`, `release/*` — and when the branch's upstream or push target is protected (the force-push would land there). It also refuses on a detached `HEAD`.
2. **Anchored WIP matching** — the reset target is the last commit whose
   subject does not start with `WIP:` (a subject merely containing "wip:"
   elsewhere is never skipped); full hashes are used, and a history with no
   non-WIP commit is refused.
3. **Ancestry check** — the chosen reset target must be an ancestor of `HEAD`
   or the run aborts.
4. **Remote WIP check** — only force-pushes if the remote tip is itself a `WIP:`
   commit; skips the push otherwise (a branch with no upstream is skipped too).
5. **`--force-with-lease`** — aborts if the remote has new commits that weren't
   present when you last fetched, preventing accidental overwrites.

**Recovery with `refs/wip/last`:**

Every `git-wip` call updates the `refs/wip/last` ref to point at the new WIP commit. Because this is a named ref (outside `refs/heads/`), git's garbage collector will not collect the commit — the WIP state is preserved indefinitely until the ref is next overwritten by another `git-wip`. `git-unwip` deliberately leaves the ref intact so you can always recover.

**Global pre-commit hook:**

A global `pre-commit` hook (applied via `core.hooksPath` during bootstrap) prevents committing on top of a WIP commit. If `HEAD` or any unpushed commit on the branch is a `WIP:` commit, the commit is blocked with an error message directing you to run `git-unwip` first. The gate fails closed: when the commit history cannot be read (`git log` fails) the commit is blocked too. A repository with no commit yet (unborn `HEAD`) passes. On a branch with no upstream (never pushed) the gate scans every commit not reachable from any remote ref, so historic `WIP:` subjects in a never-pushed repository block new commits until they are rewritten (`git-unwip`, or an interactive rebase that rewords them) or pushed (a commit reachable from any remote ref is no longer scanned); a single commit can bypass the gate with `git commit --no-verify`.

*NOTE*: `git-wip` bypasses hooks (`-n` flag) intentionally — WIP commits are scratch saves, not production-quality commits.

#### The WIP-commit convention

WIP commits are an **escape hatch, not a storage format**. Use them to save unfinished work when you must switch context or protect in-flight changes — never as a place where work lives. The intent is that WIP state is **short-lived**: as soon as you can, run `git-unwip` and make a real, well-formed commit. The full lifecycle — stacking saves, un-wipping, and where WIP fits in the rebase-merge policy — is in the [Rebase Commit Guide](Rebase-Commit-Guide.md#the-escape-hatch-wip-commits).

**The rule: only a WIP commit may follow a WIP commit.** A normal commit on top of a WIP commit is blocked — by design — so in-progress work can't silently become permanent history disguised as a finished commit. The block fires when `HEAD` is a `WIP:` commit or a `WIP:` commit is buried in the branch's unpushed history.

**How the block is delivered.** The gate logic lives in `tools/git-hooks/wip-gate.sh` in the devenv repo, and reaches repositories primarily through the **template boilerplate sync** — the same mechanism that distributes any shared boilerplate:

1. **Template sync (primary).** The template repos (`template.service`, `template.cs-library`) carry the gate block in their `.husky/pre-commit`, and their `.repo/update-manifest.json` lists that file for sync. Derived repos receive the block by running their `.repo/update.sh` boilerplate update and committing `chore: update boilerplate` — a visible, reviewable, test-gated commit in the repo itself. `repos/repo-cache-sync-boilerplate.sh` automates that sweep across `<your-library-glob>`, `service.*`, `devops.*`, `gitops.*`, and `tool.*` repos (master-only, clean-tree, tests-gated, per-repo commit + push); run it manually when rolling out boilerplate changes. Repos acquire `.repo/update.sh` on first sync (the script seeds the infrastructure from the template).
2. **Global hooks dir (fallback).** Bootstrap points `core.hooksPath` at `tools/git-hooks/` globally, so repos that don't manage their own hooks get the gate without any per-repo file.
**What a well-formed commit looks like.** A real commit names what changed and why: a conventional type prefix (`feat:`, `fix:`, `docs:`, …) and, in the devenv repo itself, a `Devenv-Action` trailer telling consumers what to do after pulling. If a change can't pass those bars yet, it isn't ready to be a real commit — WIP it, finish the work, then `git-unwip` and commit properly.

**Visibility.** The shell prompt shows a `⚡WIP` marker whenever the current repo's `HEAD` is a WIP commit — if you can see the marker, the branch is one commit away from needing `git-unwip` before anything permanent lands on it.

#### `repo-cache-sync-boilerplate`

Sweeps the `<your-library-glob>` / `service.*` / `devops.*` / `gitops.*` / `tool.*` repos in the repo cache: seeds each repo's `.repo/` update infrastructure from its template, runs the template update (which syncs `.husky/pre-commit` and all other manifest boilerplate), runs the repo's `./run-tests` when present, then commits `chore: update boilerplate` and pushes — per repo, on `master` only, and only with a clean working tree:

```bash
./repos/repo-cache-sync-boilerplate.sh --dry-run        # print the plan, touch nothing
./repos/repo-cache-sync-boilerplate.sh                  # full sweep (commits + pushes)
./repos/repo-cache-sync-boilerplate.sh --repo <your-library>   # single repo
```

A test failure or update error stops the sweep at that repo; nothing is committed for repos the guards skip.

### `git update`

Updates the current repository with interactive options for handling uncommitted changes.

```bash
git update
```

**Features:**

- Interactive prompts for stashing or discarding uncommitted changes
- Automatically switches to default branch
- Pulls latest changes
- Returns to original branch if applicable

## Pull Request Management

Tools for creating, managing, and working with pull requests. The wrappers are the workspace abstraction over the backing provider CLI.

### `pr-create-for-review`

Creates a draft pull request for reviewing changes. Useful for code review before final merge.

```bash
pr-create-for-review
```

**Features:**

- Creates draft PRs
- Supports commit range specification
- Automatically formats title and body
- Can add reviewers and assignees

### `pr-create`

Creates a pull request for merging code into a target branch (defaults to the repository's default branch).

Scratchpad refusal (push-path): blocked (exit 3) while a scratchpad is active in the repo, or on any `scratchpad/*` branch — scratch commits carry no `Devenv-Action`/`Change-Id` trailers and must never reach shared history. Salvage via `repo-scratchpad promote`.

WIP scan: before scanning for `WIP:` commits, `pr-create` refreshes `origin/<branch>` so a WIP pushed from another clone is visible. When the branch exists on origin this needs remote access, and a failed refresh blocks PR creation; a branch not yet on origin needs no refresh. `pr-create --at` skips that refresh: it scans the local merge branch it creates, so a WIP pushed from another clone is not seen on that path.

```bash
pr-create <title> --issue <number> [--base <branch>]
```

**Required Options:**

- `<title>`: PR title (must follow Conventional Commits format; keep issue refs in the body, not the title)
- `--issue <number>`: Issue number this PR addresses, OR use `--no-issue` if not associated with an issue

**Optional Options:**

- `--base <branch>`: Target branch for the PR (default: repository's default branch). Examples: `master`, `main`, `develop`, `release/v1.0`
- `--body <text>`: PR body text
- `--draft`: Create as a draft PR
- `--reviewer <handle>`: Add a reviewer (can be repeated)
- `--assignee <handle>`: Add an assignee (default: @me)
- `--repo-dir <path>`: Repository directory (default: current)

**Examples:**

```bash
# Create PR for merging to default branch
pr-create "feat: add new feature" --issue 123

# Create PR targeting a different branch
pr-create "fix: critical bug" --issue 456 --base develop

# Create draft PR with reviewer
pr-create "docs: update README" --issue 789 --draft --reviewer @john
```

**Features:**

- Validates Conventional Commits format for title
- Requires issue references in the body instead of the title
- Supports targeting any branch via `--base` option
- Can add reviewers, assignees, and labels
- Generates PR description from commits

### `repo-scratchpad`

Governed experiment sandbox Cuts a `scratchpad/<slug>` branch from the current HEAD; hook-bypassing, `scratch:`-branded commits are permitted on it; `reset` returns to base AI-safe; `promote` salvages one scratch commit onto the base branch staged-uncommitted (trailers re-acquire on the normal commit flow) and requires an empty index — a second promote, or other staged work, is refused with nothing changed; `exit` tears the branch down. State lives in git refs (`refs/scratchpad/{base,state,origin-branch}`) — no loose files, detached-HEAD-safe.

**Safety invariants:** entry is fail-closed on ANY dirty tree (tracked or untracked) — save work first with `git wip` (recommended; it pushes) or a normal commit; `--carry` overrides with a loud warning + best-effort snapshot into `.local-artifacts/tmp/scratchpad/` (carried work is DESTROYED by `reset`). The destructive surface only ever touches scratch-created content. Scratch commits carry no `Devenv-Action`/`Change-Id` trailers and must never reach shared history — push-path tools refuse on scratchpad branches. While a scratchpad is active, `repo-commit`, `git-wip`, and `pr-create` refuse (exit 3).

```bash
repo-scratchpad enter [slug] [--carry]
repo-scratchpad status
repo-scratchpad commit "<title>"
repo-scratchpad reset
repo-scratchpad promote <sha>
repo-scratchpad exit
repo-scratchpad resume        # return HEAD to the scratch branch after a promote pause
```

**Exit codes:** 0 success · 1 safety refusal / general error · 2 invalid arguments · 3 already-active/conflict · 4 promote target not on the scratch branch.

### `repo-bisect`

First-bad-commit identification over a commit range (the hunt skill's time-travel mode). Walks `git bisect` with a probe command (exit 0 = good, non-zero = bad) and delivers the culprit with evidence. Works on **any branch** — no scratchpad requirement in the tool (bisect is non-destructive: read-only detached-HEAD visits); outside a scratchpad it prints a soft notice pointing AI hunts at `repo-scratchpad enter`. `status` and `reset` act only on a real bisect session (they detect one in flight) and otherwise report that none exists. Refuses on a dirty tree, and (exit 3) when a bisect session is already in flight — end it with `repo-bisect reset` first, since `git bisect start` would discard it. The probe must resolve to an executable command (a name on `PATH`, or a path with the execute bit) or the run is refused before the walk starts; the probe is also run once on the good ref before the walk, and a probe that fails there (anything but exit 0, or 125 = skip) is refused, since it would otherwise mark every step bad. The verdict is read only from git's own result lines (the last matching line), never from the probe's output. An all-skip walk (probe exiting 125 everywhere) answers **AMBIGUOUS** rather than fabricating a culprit from the candidate set.

```bash
repo-bisect <bad-ref> <good-ref> -- <probe command...>
repo-bisect status
repo-bisect reset
```

**Exit codes:** 0 first-bad identified · 1 dirty refusal / probe never discriminated / probe not found or not executable / walk aborted by git · 2 invalid arguments or degenerate range (bad == good) · 3 bisect session already in flight · 4 unresolvable ref.

### `repo-bump-version`

Forces an empty, hook-bypassing commit on each named repository's default branch to trigger a version bump, then pushes it to origin.

```bash
repo-bump-version <patch|minor|major> [--yes] [repository-names...]
```

Each repository's plan (the commit, the base `origin/<default>` tip and the push destination) is printed first and the push must be confirmed: a terminal prompt, or `--yes` (required when there is no terminal). After a failed push the empty commit exists locally only, and the tool prints the exact undo (`git reset --keep HEAD~1` in that repository — the failed-push commit is exactly one commit, and `--keep` never discards other changes); the next run refuses while the default branch has an unpushed commit.

### `pr-get-merge-link`

Gets the web URL for an open pull request on the current branch.

```bash
pr-get-merge-link
```

### `pr-get-review-link`

Gets the web URL for a review pull request.

```bash
pr-get-review-link
```

### `pr-cleanup-review-branches`

Cleans up old review branches that are no longer needed.

```bash
pr-cleanup-review-branches [--days N]
```

**Options:**

- `--days N`: Delete review branches older than N days (default: 7)

### `pr-get`

Retrieves a pull request's details as structured JSON. Useful for scripting,
automation, and feeding PR context to AI agents.

```bash
pr-get PR# [--pretty]
```

**Examples:**

```bash
pr-get 123                              # Structured JSON
pr-get 123 --pretty                     # Pretty-printed
pr-get 123 | jq -r '.title'             # Extract title
pr-get 123 | jq -r '.headRefName'       # Source branch
pr-get 123 | jq -r '.labels[].name'     # Extract labels
```

### `pr-comment`

Adds a top-level conversation comment to a pull request. For inline review comments tied to specific lines, use `pr-review-comment` (creates a new thread) and `pr-thread-reply` (replies in an existing thread).

```bash
pr-comment PR# (--body TEXT | --body-file FILE | --edit) [--dry-run]
```

**Comment sources** (exactly one required):

- `--body TEXT`: Inline comment text
- `--body-file FILE`: Read comment from a markdown file (`-` reads stdin; piped stdin with no flag is auto-read)
- `--edit`: Open `$EDITOR` to compose

### `pr-diff`

Outputs a unified diff for a PR (via the provider seam) or for a local diff between two
refs. Useful for code review and pre-commit workflows.

```bash
pr-diff PR# [--name-only]
pr-diff --base BASE_REF --head HEAD_REF [--name-only]
```

**Examples:**

```bash
pr-diff 123                                       # Full PR diff
pr-diff 123 --name-only                           # Just changed files
pr-diff --base master --head my-feature           # Local ref-to-ref diff
```

### `pr-list`

Lists pull requests with filters. JSON output by default for scripting.

```bash
pr-list [--state open|closed|merged|all] [--author USER] [--label LABEL] \
        [--base BRANCH] [--head BRANCH] [--limit N] [--pretty | --table]
```

**Examples:**

```bash
pr-list                                  # All open PRs (JSON)
pr-list --table                          # Pretty table
pr-list --author @me                     # My open PRs
pr-list --state closed --label bug       # Closed bug PRs
pr-list --base master                    # PRs targeting master
```

### `pr-threads-get`

Fetches inline review threads for a PR via GraphQL, preserving thread structure and parent/reply relationships. The REST API loses this context; this tool is the foundation for the `address-pr-comments` skill.

By default returns only unresolved threads, sorted by file path then line number.

```bash
pr-threads-get PR# [--all] [--pretty]
```

**Output:** JSON array of thread objects, each containing:

- `id` — GraphQL node ID (used by `pr-thread-resolve`)
- `isResolved` — boolean
- `path`, `line`, `startLine`, `diffSide` — comment location
- `comments[]` — each with `id` (numeric, used by `pr-thread-reply`), `author.login`, `body`, `createdAt`, `url`

**Examples:**

```bash
pr-threads-get 123                       # Unresolved threads (JSON)
pr-threads-get 123 --all                 # Include resolved threads
pr-threads-get 123 --pretty              # Pretty-print
pr-threads-get 123 | jq length          # Count unresolved threads
pr-threads-get 123 | jq -r '.[].path' | sort -u   # Files with open comments
pr-threads-get 123 | jq -r '.[0].comments[0].body' # First comment body
```

### `pr-thread-reply`

Posts a reply to an existing inline review comment. This is distinct from `pr-comment` (top-level PR conversation). Requires the comment ID from `pr-threads-get`; on GitHub it must be numeric (anything else is refused), on Azure it is the `<thread>/<comment>` form. An empty reply body is refused.

```bash
pr-thread-reply PR# --comment-id COMMENT_ID (--body TEXT | --body-file FILE | --edit) [--dry-run]
```

**Examples:**

```bash
pr-thread-reply 123 --comment-id 456 --body "Done — refactored in the latest commit."
pr-thread-reply 123 --comment-id 456 --body-file reply.md
pr-thread-reply 123 --comment-id 456 --edit          # Opens $EDITOR
pr-thread-reply 123 --comment-id 456 --body "LGTM" --dry-run
```

### `pr-thread-resolve`

Marks a PR review thread as resolved using the provider's review-thread resolution (GitHub GraphQL `resolveReviewThread` today). Takes the thread ID returned by `pr-threads-get` (GitHub: the GraphQL node ID starting with `PRRT_`; Azure: the fully prefixed thread reference, which is accepted as printed).

```bash
pr-thread-resolve THREAD_ID [--dry-run]
```

**Examples:**

```bash
pr-thread-resolve PRRT_kwDOAbc123
pr-thread-resolve PRRT_kwDOAbc123 --dry-run

# Resolve all unresolved threads on PR 123 (use with care)
pr-threads-get 123 | jq -r '.[].id' | xargs -I{} pr-thread-resolve {}
```

## Artifact Management

Tools for listing, filtering, and managing artifacts in GitHub Packages.

### `artifacts-list`

Lists and filters artifacts (packages) from the provider package registry (GitHub Packages today) with support for multiple package types and filtering by name.

**Usage:**

```bash
artifacts-list --owner <org> [--type <type>] [--name <pattern>] [--format <format>]
```

**Required Options:**

- `--owner <org>`: Repository owner or organization name (resolved from devenv.config `[organization] org` when omitted)

**Optional Filters:**

- `--type <type>`: Filter by package type. Supported types:
  - `npm` (JavaScript/Node.js packages)
  - `nuget` (C#/.NET packages)
  - `docker` (Container images)
  - `maven` (Java packages)
  - `rubygems` (Ruby packages)
  - `gradle` (Gradle packages)
  - `cargo` (Rust packages)
- `--name <pattern>`: Filter packages by name pattern (partial match, case-insensitive)
- `--repo <repo>`: Query a specific repository (optional)

**Output Options:**

- `--format <format>`: Output format: `table` (default) or `json`
- `--sort <field>`: Sort by field: `name` (default), `type`, `created_at`, or `updated_at`

**Version Listing:**

- `--versions`: List versions for a specific package. Requires `--type` and `--name`

**Examples:**

```bash
# List all npm packages in an organization
artifacts-list --owner myorg --type npm

# List all nuget packages with "service" in the name
artifacts-list --owner myorg --type nuget --name "service"

# List versions for a specific npm package
artifacts-list --owner myorg --type npm --name my-package --versions

# Output as JSON for scripting
artifacts-list --owner myorg --format json | jq '.[] | .name'

# List docker images sorted by creation date
artifacts-list --owner myorg --type docker --sort created_at
```

**Features:**

- Supports multiple package types from GitHub Packages
- Flexible filtering by type and name patterns
- Outputs formatted table with package information (name, type, URL)
- Can list versions for a specific package with publish dates
- JSON output for scripting and automation
- Case-insensitive name filtering for ease of use

**Output Format:**

The table format shows:

- **NAME**: Package name
- **TYPE**: Package type (npm, nuget, docker, etc.)
- **URL**: GitHub Packages URL for the artifact

When listing versions (`--versions`), the table shows:

- **VERSION**: Package version number
- **PUBLISHED**: Publication date and time
- **UPDATED**: Last update date and time

**Library Functions:**

The `artifacts-list` script is built on the TS packages facade, which provides reusable functions for querying packages (the historical `artifact-operations.bash` retired with the bash verb layer):

- `query_packages`: Query packages with filtering by type and name
- `get_package_versions`: Get versions for a specific package
- `get_package_type_id`: Normalize package type names
- `is_supported_package_type`: Validate package type support
- `get_supported_package_types`: Get list of supported types

These core functions can be sourced and used in other scripts for artifact-related operations. Output formatting functions are part of the `artifacts-list` script itself since they are specific to that script's display specifications.

### `artifact-header`

Reads or patches the `DEVENV_ARTIFACT_V1` metadata header of a local issue-backed
artifact (plan, grooming doc, roadmap, specifications working copy).

**Usage:**

```bash
artifact-header <FILE> --field <doc_id|issue_number|planning_repo>
artifact-header <FILE> --set issue_number=42 --set doc_id=Plan-issue-42-001
```

**Options:**

- `--field <name>`: Print one header field's value
- `--set key=value`: Set one or more header fields (patches in place)

Never hand-parse the header — use this tool so format changes stay encapsulated.

### `artifact-clean`

Clean up `.local-artifacts/` folders by artifact family (ephemeral `tmpN.md`,
session memory, issue-artifact working copies, tour ledgers, other). Interactive by default;
`--tmp` deletes scratch files without confirmation while every other family
requires `-y` or an interactive confirm. Retained deliverables (`research-*.md`,
`bug-hunt-*.md`, `TECH_DEBT_AUDIT*`) are never swept — not by `--all`, not by
`-y`, not offered interactively — unless `--include-deliverables` is passed;
sweeps report them as "kept". `-l` lists per family and deletes
nothing. See the [local artifacts convention](../copilot/skills/_conventions.md)
for the family definitions.

**Usage:**

```bash
artifact-clean [PATH...] [--tmp | --session | --working | --tour | --all] [--include-deliverables] [-y] [-l]
```

## CI Pipelines

Tools for inspecting, triggering, monitoring, and downloading outputs of CI pipeline workflow runs (GitHub Actions today, via the provider `actions` domain).

### `pipelines-status`

Reports the latest CI pipeline workflow run status across all repos in the org, with optional filtering by repo name and run conclusion.

**Usage:**

```bash
pipelines-status [OPTIONS]
```

**Options:**

- `-r, --repo REGEX`: Filter repos by name (extended regex, e.g. `'lib\.cs\.'`)
- `-s, --status STATUS`: Filter by conclusion: `success`, `failure`, `cancelled`, `skipped`
- `-w, --workflow NAME`: Filter by exact workflow name
- `--limit N`: Runs per repo to fetch (default: 1 — latest only)
- `--json`: Output as compact JSON
- `--pretty`: Output as pretty-printed JSON

**Examples:**

```bash
# Show latest run status for all repos
pipelines-status

# Only repos matching a name pattern
pipelines-status --repo 'lib\.cs\.'

# Only failed runs
pipelines-status --status failure

# Filter by repo and workflow
pipelines-status --repo 'services' --workflow CI

# Pipe into jq for further processing
pipelines-status --json | jq '.[] | select(.conclusion == "failure") | .url'
```

**Notes:**

- Enumerates repos for the configured org (up to 1000). Org resolves via devenv.config; `DEVENV_REPO` narrows to one repo.
- Runs per-repo enumeration rather than the `/orgs/{org}/actions/runs` API to avoid requiring the `workflow` token scope.
- A repository whose run list cannot be read (the provider call fails, or its output is not valid JSON or not a list) does not stop the report: the results of the other repositories are printed, each failed repository is named on stderr with a short reason, and the tool then exits with the API-failure code (4). It exits 0 only when every repository succeeded.
- With many repos this is sequential; for very large orgs it may be slow.

---

### `pipelines-list`

Lists CI workflow definitions (name, file, state) across org repositories. Shows what workflows *exist*, not their run history.

**Usage:**

```bash
pipelines-list [OPTIONS]
```

**Options:**

- `-r, --repo REGEX`: Filter repos by name (extended regex)
- `--state STATE`: Workflow state: `active`, `disabled_manually`, `disabled_inactivity`, `all` (default: `active`)
- `--json`: Output as compact JSON
- `--pretty`: Output as pretty-printed JSON

**Examples:**

```bash
# List all active workflows
pipelines-list

# Workflows for repos matching a pattern
pipelines-list --repo 'lib\.cs\.services\.'

# Include disabled workflows
pipelines-list --state all

# JSON output piped to jq
pipelines-list --json | jq '.[] | select(.state != "active")'
```

---

### `pipelines-run`

Triggers a `workflow_dispatch` event on a repository and reports the resulting run URL.

**Usage:**

```bash
pipelines-run WORKFLOW --repo OWNER/REPO [OPTIONS]
```

**Arguments:**

- `WORKFLOW`: Workflow file name (e.g. `ci.yml`) or display name

**Options:**

- `--repo OWNER/REPO`: Repository to run the workflow in (required)
- `--ref REF`: Branch or tag to run on (default: repo default branch)
- `--input KEY=VALUE`: Workflow dispatch input (repeatable)

**Examples:**

```bash
# Trigger CI on the default branch
pipelines-run ci.yml --repo <org>/my-service

# Run on a specific branch
pipelines-run ci.yml --repo <org>/my-service --ref feature/my-branch

# Pass workflow_dispatch inputs
pipelines-run deploy.yml --repo <org>/my-service \
    --input environment=staging \
    --input version=1.2.3
```

**Notes:**

- `gh workflow run` does not return a run ID, so the tool identifies the run it queued itself. Before triggering it snapshots the repository's 30 most recent run ids; afterwards it polls the run list immediately and then every 2 s for up to 30 s. A run counts as the queued one only when its id was not in the snapshot, it was created no earlier than the trigger time (with 5 s of clock allowance), it is a `workflow_dispatch` run (GitHub), and it belongs to the triggered workflow (resolved from the WORKFLOW argument by display name, file name or id; when it cannot be resolved the workflow is not used to narrow). A provider that returns the queued run's id directly (Azure) skips the polling and asks for that run's URL.
- The outcomes are: exactly one matching run prints `Run URL: <url>`; more than one new run prints a warning that none can be attributed, with a `pipelines-status` hint; no matching run within 30 s prints "Run queued but URL not yet available." with the same hint. The exit status stays 0 in all three, because the queue itself succeeded; only a failed trigger exits non-zero.
- The workflow must be configured with a `workflow_dispatch` trigger.
- Unknown flags and a malformed `-f` input are rejected by name before anything is triggered.
- On Azure the reported run URL is the build's browser page, not the REST address.

---

### `pipelines-rerun`

Re-runs a CI pipeline workflow run, with options to re-run only failed jobs or enable debug logging.

**Usage:**

```bash
pipelines-rerun RUN_ID --repo OWNER/REPO [OPTIONS]
```

**Arguments:**

- `RUN_ID`: The workflow run ID to re-run

**Options:**

- `--repo OWNER/REPO`: Repository containing the run (required)
- `--failed`: Re-run only failed jobs (not the whole workflow)
- `--debug`: Enable debug logging for the re-run

Azure retries the whole build in place and accepts neither `--failed` nor `--debug`: any flag is refused by name. On Azure the printed run URL is the build's browser page.

**Examples:**

```bash
# Re-run the full workflow
pipelines-rerun 12345678 --repo <org>/my-service

# Re-run only failed jobs
pipelines-rerun 12345678 --repo <org>/my-service --failed

# Re-run with debug output enabled
pipelines-rerun 12345678 --repo <org>/my-service --debug
```

---

### `pipelines-watch`

Streams live output from a running CI pipeline workflow run. If no `RUN_ID` is given, auto-detects the latest in-progress run in the repo.

**Usage:**

```bash
pipelines-watch [RUN_ID] --repo OWNER/REPO [OPTIONS]
```

**Arguments:**

- `RUN_ID`: Workflow run ID to watch (optional — auto-detects if omitted)

**Options:**

- `--repo OWNER/REPO`: Repository containing the run (required)
- `--exit-status`: Exit non-zero if the watched run fails (useful in CI pipelines); on Azure it is the only accepted flag, and any other is refused by name

**Examples:**

```bash
# Watch the latest in-progress run
pipelines-watch --repo <org>/my-service

# Watch a specific run
pipelines-watch 12345678 --repo <org>/my-service

# Exit with the run's exit code (for CI use)
pipelines-watch 12345678 --repo <org>/my-service --exit-status
```

---

### `pipelines-artifacts`

Lists or downloads artifacts from a completed CI pipeline workflow run. Default mode is list (no files are downloaded).

**Usage:**

```bash
pipelines-artifacts RUN_ID --repo OWNER/REPO [OPTIONS]
```

**Arguments:**

- `RUN_ID`: Workflow run ID

**Options:**

- `--repo OWNER/REPO`: Repository containing the run (required)
- `--json`: Output artifact list as compact JSON
- `--pretty`: Output artifact list as pretty-printed JSON
- `--download`: Download artifacts instead of just listing
- `--name NAME`: Specific artifact name to download (use with `--download`)
- `--dir DIR`: Download destination directory (default: `.`)

**Examples:**

```bash
# List artifacts for a run
pipelines-artifacts 12345678 --repo <org>/my-service

# List as JSON and pipe to jq
pipelines-artifacts 12345678 --repo <org>/my-service --json | jq '.[].name'

# Download all artifacts
pipelines-artifacts 12345678 --repo <org>/my-service --download

# Download a specific artifact to a directory
pipelines-artifacts 12345678 --repo <org>/my-service \
    --download --name coverage-report --dir .local-artifacts
```

**Notes:**

- List mode uses the provider REST API (`/actions/runs/{id}/artifacts` on GitHub) to show metadata without downloading.
- When downloading all artifacts (no `--name`), warns if total size exceeds 100 MiB.

---

## Issues and Project Management

Tools for managing issues, projects, and sprint/milestone workflows (GitHub today, via the provider issues/projects domains).

### `issue-create`

Creates a new issue with labels, assignees, and project assignment. Supports interactive template selection and editing.

```bash
issue-create --title "Issue title" [OPTIONS]
```

**Options:**

- `--title TITLE`: Issue title (required)
- `--body TEXT`: Issue body/description
- `--body-file FILE`: Read body from markdown file (`-` reads stdin)
- `--type TYPE`: Native issue type (Bug, Feature, Task, Epic) - sets the GitHub-native type field
- `--label LABEL`: Add additional labels (repeatable)
- `--assignee USER`: Assign to user (repeatable)
- `--milestone NAME`: Assign to milestone/sprint
- `--project NAME`: Add to project
- `--parent ISSUE_NUM`: Link to parent issue (for epics)
- `--template FILE`: Use specific template file (opens in editor)
- `--no-template`: Skip template selection (don't use any template)
- `--no-interactive`: Use template without opening editor (for scripting)
- `--devenv`: Safety override to allow creating issues in devenv repo itself
**Template Workflow:**

By default, `issue-create` discovers templates in `.github/ISSUE_TEMPLATE/` and lets you select one with fzf:

1. Script shows interactive template selection with preview
2. Selected template is copied to a temporary file
3. Template opens in your `$EDITOR` (defaults to `nano`)
4. You can customize the template content
5. When you save and close the editor, the edited content becomes the issue body

**Examples:**

```bash
# Interactive mode (select template with fzf, edit in $EDITOR)
issue-create --title "Login button not working" --type Bug

# Use specific template without interactive selection
issue-create --title "User Authentication" --type Feature \
    --template .github/ISSUE_TEMPLATE/feature_request.md

# Use template without opening editor (for automation)
issue-create --title "OAuth2 Integration" --type Task \
    --template .github/ISSUE_TEMPLATE/Blank.md --no-interactive

# Create without any template
issue-create --title "Quick bug" --type Bug --no-template \
    --body "Something is broken"

# Create task under an epic with template
issue-create --title "OAuth2 Integration" --type Task \
    --parent 123 --project "Q1 2026" --milestone "Sprint 5"
```

**Safety Features:**

By default, `issue-create` prevents accidental creation of issues in the devenv repository itself. Issues should be created in your target project repositories.

If you need to create an issue in devenv, pass the `--devenv` flag:

```bash
issue-create --devenv --title "Internal issue" --type Bug
```

### `issue-list`

Lists and filters issues.

```bash
issue-list [OPTIONS]
```

**Options:**

- `--state STATE`: Filter by state (open, closed, all) - default: open
- `--type TYPE`: Filter by native issue type (Bug, Feature, Task, Epic)
- `--label LABEL`: Filter by label (repeatable)
- `--assignee USER`: Filter by assignee (use "none" for unassigned)
- `--milestone NAME`: Filter by milestone
- `--format FORMAT`: Output format (table, json, simple)
- `--limit N`: Limit results (default: 30)
- `--web`: Open in browser

**Examples:**

```bash
# List all open bugs
issue-list --type Bug

# List issues in current sprint
issue-list --milestone "Sprint 5"

# List unassigned high-priority items
issue-list --assignee none --label "priority/P1"

# Get JSON for scripting
issue-list --format json --limit 100
```

### `issue-search`

Keyword search across issue titles and bodies. Any-keyword, case-insensitive substring matching; results ranked by distinct-term hit count with matched terms annotated. Complements `issue-list` (structured filtering) — use it for duplicate detection and queue scavenging.

```bash
issue-search [OPTIONS] TERM [TERM...]
```

**Options:**

- `--state STATE`: Search scope (all, open, closed) - default: all
- `--type TYPE` / `--label LABEL` / `--assignee USER` / `--milestone NAME`: scope filters applied before search
- `--format FORMAT`: Output format (table, json, simple)
- `--limit N`: Results shown (default: 30)
- `--fetch-limit N`: Issues fetched for searching (default: 200; raise for large repos)

**Examples:**

```bash
# Duplicate check before filing a bug
issue-search --state all --type Bug login failed

# Find issues mentioning a concept
issue-search reservation TTL

# JSON output with matched terms per issue
issue-search --format json identity
```

### `issue-get`

Retrieves a GitHub issue's details as structured JSON.

```bash
issue-get ISSUE_NUMBER [OPTIONS]
```

**Options:**

- `--repo OWNER/REPO`: Override target repository
- `--field FIELD`: Print a single field's raw value instead of the full JSON
- `--web`: Open the issue in a web browser

**Examples:**

```bash
# Full JSON payload
issue-get 123

# One field
issue-get 123 --field title
```

### `issue-update`

Updates issue fields (title, body, labels, assignees, milestone, state).

```bash
issue-update ISSUE_NUMBER [OPTIONS]
```

**Options:**

- `--title TITLE`: Update title
- `--body TEXT`: Update body
- `--body-file FILE`: Read new body from file (`-` reads stdin; piped stdin with no other update is auto-read)
- `--add-label LABEL`: Add label (repeatable)
- `--remove-label LABEL`: Remove label (repeatable)
- `--add-assignee USER`: Add assignee (repeatable)
- `--remove-assignee USER`: Remove assignee (repeatable)
- `--milestone NAME`: Set milestone
- `--state STATE`: Set state (open or closed)

On Azure, an update whose work item changed since it was read fails with a "modified concurrently" error instead of overwriting the other change; repeat the change. Azure tags match case-insensitively (adding a tag already present in any case is a no-op), and a label containing `;` means several tags. Empty comments are refused on both providers.

**Examples:**

```bash
# Update title
issue-update 123 --title "New title"

# Add labels and assignee
issue-update 123 --add-label "priority/P1" --add-assignee "john"

# Change milestone
issue-update 123 --milestone "Sprint 6"
```

### `issue-close`

Closes or reopens issues with optional comment and reason.

```bash
issue-close [ACTION] ISSUE_NUMBER... [OPTIONS]
```

**Actions:**

- `close` - Close issue(s) (default)
- `reopen` - Reopen issue(s)

**Options:**

- `--comment TEXT`: Add comment when closing/reopening
- `--reason REASON`: Close reason (completed or "not planned")

**Examples:**

```bash
# Close single issue
issue-close 123

# Close multiple issues
issue-close 123 124 125

# Close with comment
issue-close 123 --comment "Fixed in PR #456"

# Close as not planned
issue-close 123 --reason "not planned"

# Reopen issue
issue-close reopen 123
```

### `issue-select`

Interactive issue selection using a terminal picker (clack). It needs an interactive terminal; without one it exits 2.

```bash
issue-select [OPTIONS]
```

**Options:**

- `--state STATE`: Filter by state
- `--type TYPE`: Filter by type
- `--milestone NAME`: Filter by milestone
- `--label LABEL`: Filter by label
- `--limit NUMBER` (`-n`): Maximum number of issues offered in the picker (default: 200). Must be a positive integer; anything else exits 2 before any provider call or terminal check. When the provider returns exactly that many issues, a one-line note on stderr says the list may be truncated and suggests raising `--limit`.
- `--multi`: Enable multi-select (space toggles, Enter confirms)
- `--format FORMAT`: Output format (number, url, json)

**Examples:**

```bash
# Select an issue interactively
issue_num=$(issue-select --type Task)

# Multi-select to bulk assign
for issue in $(issue-select --multi); do
    issue-update "$issue" --add-assignee "@me"
done
```

### `issue-comment`

Adds a comment to a GitHub issue. Body comes from `--body`, `--body-file` (`-` reads stdin), or piped stdin with no other arguments.

```bash
issue-comment ISSUE_NUMBER [OPTIONS] [BODY]
```

**Options:**

- `--body TEXT`: Comment body inline
- `--body-file FILE`: Read body from file (`-` = stdin)
- `-e, --edit`: Edit mode (update an existing comment with `--comment-id`)
- `--comment-id ID`: Target comment for `--edit`
- `--repo OWNER/REPO`: Override target repository

**Examples:**

```bash
issue-comment 123 --body "Investigating — will report back"
cat notes.md | issue-comment 123
```

### `issue-comment-list`

Lists comments on an issue and returns comment IDs for scripting and follow-up updates.

```bash
issue-comment-list ISSUE_NUMBER [--pretty] [--full]
```

**Options:**

- `--pretty`: Pretty-print JSON output
- `--full`: Return complete comment bodies instead of previews

**Examples:**

```bash
issue-comment-list 42 --pretty
issue-comment-list 42 --full | jq -r '.[0].id'
```

### `issue-comment-update`

Replaces an existing issue comment by numeric comment ID.

```bash
issue-comment-update COMMENT_ID (--body TEXT | --body-file FILE) [--dry-run]
```

**Examples:**

```bash
issue-comment-update 123456789 --body-file updated-artifact.md
```

### `issue-artifact-upsert`

Deterministically creates or updates an issue comment artifact by stable `doc_id` metadata.

```bash
issue-artifact-upsert [--issue ISSUE_NUMBER] [--body TEXT | --body-file FILE | piped stdin | interactive] [OPTIONS]
```

**Issue Target:**

- `--issue ISSUE_NUMBER`: Optional issue number override

**Comment Source (exactly one required unless stdin is piped or a TTY):**

- `--body TEXT`: Inline comment body
- `--body-file FILE`: Read comment body from file (`-` reads stdin)
- Piped stdin with no source flag: body read from stdin automatically
- No source flag with a TTY: interactive fzf picker over `.local-artifacts/*.md` (requires fzf; `--all` includes `tmp*.md`)

`doc_id` is extracted from the exact metadata line `doc_id: <doc_id>` inside the `DEVENV_ARTIFACT_V1` header block of the provided body (the marker must open within the first 1024 characters).

Issue number is resolved in this order:

1. `--issue ISSUE_NUMBER` when provided
2. `issue_number: <N>` metadata line inside the body's `DEVENV_ARTIFACT_V1` header block

If neither source provides an issue number, the command fails with invalid arguments. If both sources are present but differ, the command also fails.

**Options:**

- `--repo OWNER/REPO`: Override target repository (defaults to `DEVENV_REPO`)
- `--dry-run`: Resolve intended action without writing
- `--verbose`: Enable verbose logs

**Matching Rules:**

- Matches exact metadata line only: `doc_id: <doc_id>`
- Match is evaluated only against the header block of each existing comment body
- No heading/title matching and no fuzzy matching

**Behavior:**

- 0 matches: creates a new comment
- 1 match: updates that comment
- 2+ matches: returns conflict and exits non-zero

**Output JSON:**

- Success: `{"action":"created|updated","issue_number":N,"comment_id":ID,"comment_url":"..."}`
- Conflict: `{"action":"conflict","issue_number":N,"matches":[ID,...]}`

**Exit Codes:**

- `0`: success (created or updated)
- `2`: invalid arguments
- `3`: duplicate `doc_id` conflict
- `4`: API/tool failure

**Examples:**

```bash
# Create or update a research findings comment by doc_id
issue-artifact-upsert \
  --body-file research-001-retry-strategy.md

# Preview action without writing
issue-artifact-upsert \
  --issue 123 \
  --body-file research-001-retry-strategy.md \
  --dry-run
```

### `issue-artifact-doc-id`

Generates a deterministic artifact `doc_id` string for issue comment metadata.

```bash
issue-artifact-doc-id --issue ISSUE_NUMBER --artifact-type TYPE [--slug TEXT | --source-file FILE] [--repo OWNER/REPO]
```

**Required Arguments:**

- `--issue ISSUE_NUMBER`: Target issue number
- `--artifact-type TYPE`: One of `research`, `redesign`, `design`, `blueprint`, `specifications`, `roadmap`, `plan` (`implementation-plan` is accepted as a read-side alias; generated doc_ids always carry `plan`, never the alias)

**Slug Source (exactly one required):**

- `--slug TEXT`: Source text normalized to kebab-case
- `--source-file FILE`: Uses file basename (without extension), then normalizes

**Output Format:**

- `dv1:<owner>/<repo>:issue-<number>:<artifact_type>:<slug>`

**Examples:**

```bash
# From a free-text slug
issue-artifact-doc-id \
  --issue 123 \
  --artifact-type research \
  --slug "Retry Strategy" \
  --repo example-org/devenv

# From a source file name
issue-artifact-doc-id \
  --issue 77 \
  --artifact-type redesign \
  --source-file Redesign--003-Auth-Flow.md \
  --repo example-org/devenv

# For a plan artifact comment
issue-artifact-doc-id \
  --issue 42 \
  --artifact-type plan \
  --source-file Plan-issue-42-001.md \
  --repo example-org/devenv
```

### `issue-artifact-get`

Retrieves a single issue comment artifact by deterministic `doc_id`.

```bash
issue-artifact-get --issue ISSUE_NUMBER --doc-id DOC_ID [--full] [--pretty] [OPTIONS]
```

**Required Arguments:**

- `--issue ISSUE_NUMBER`: Target issue number
- `--doc-id DOC_ID`: Exact artifact document ID to resolve

**Options:**

- `--full`: Return the complete comment body in `body`
- `--pretty`: Pretty-print JSON output
- `--repo OWNER/REPO`: Override target repository
- `--verbose`: Enable verbose logs

**Behavior:**

- 1 match: returns the artifact metadata and body
- 0 matches: exits non-zero
- 2+ matches: returns conflict payload and exits non-zero

**Examples:**

```bash
issue-artifact-get \
  --issue 42 \
  --doc-id "dv1:example-org/devenv:issue-42:plan:plan-issue-42-001" \
  --full --pretty
```

### `issue-artifact-list`

Lists deterministic artifacts discovered in issue comments from their metadata headers.

```bash
issue-artifact-list --issue ISSUE_NUMBER [--artifact-type TYPE] [--full] [--pretty] [OPTIONS]
```

**Options:**

- `--artifact-type TYPE`: Filter results by artifact type
- `--full`: Return complete comment bodies instead of previews
- `--pretty`: Pretty-print JSON array output
- `--repo OWNER/REPO`: Override target repository

**Examples:**

```bash
# List all plan artifacts on an issue
issue-artifact-list --issue 42 --artifact-type plan --pretty
```

### `issue-artifact-select`

Resolves exactly one issue artifact for downstream workflows.

```bash
issue-artifact-select --issue ISSUE_NUMBER [--artifact-type TYPE] [--doc-id DOC_ID] [--latest] [--format FORMAT] [OPTIONS]
```

**Selection Rules:**

- If `--doc-id` is supplied, that exact artifact is selected
- If exactly one artifact matches, it is selected automatically
- If multiple artifacts match and `--latest` is supplied, the most recently updated artifact is selected
- Otherwise the command returns an ambiguity payload and exits non-zero

**Formats:**

- `json` (default)
- `doc-id`
- `comment-id`
- `url`

**Examples:**

```bash
# Select the latest plan for an issue
issue-artifact-select --issue 42 --artifact-type plan --latest --format doc-id

# Select one exact artifact by doc_id
issue-artifact-select --issue 42 \
  --doc-id "dv1:example-org/devenv:issue-42:plan:plan-issue-42-001" \
  --format url
```

### `issue-label-create`

Creates a GitHub issue label. Idempotent: an existing label is skipped (exit 0) unless `--update` is given, in which case color and description are updated.

```bash
issue-label-create NAME [--color HEX] [--description TEXT] [OPTIONS]
issue-label-create --seed [OPTIONS]
```

**Options:**

- `--color HEX`: 6-digit hex color (no `#`)
- `--description TEXT`: Label description
- `--seed`: Seed the standard vocabulary from `tools/config/labels-config.yml`
- `--update`: Update color/description if the label already exists

**Examples:**

```bash
issue-label-create "priority/P1" --color d93f0b --description "High"
issue-label-create --seed   # bootstrap the standard label set
```

### `issue-label-list`

Lists a repository's available issue labels (name, description, color). Read-only — use before suggesting labels in triage so only existing labels are proposed.

```bash
issue-label-list [OPTIONS]
```

**Options:**

- `-f, --format FORMAT`: `table` (default), `json`, `simple`
- `-s, --search TERM`: Filter labels by substring (case-insensitive)

### `issue-types`

Lists the GitHub organization's configured issue types (ID + name) via GraphQL. Read-only — used when setting up or verifying the native issue-type vocabulary (mirrors `tools/config/issues-config.yml`: Bug, Feature, Task, Epic).

```bash
issue-types [OPTIONS]
```

**Options:**

- `-f, --format FORMAT`: `table` (default), `json`, `simple`

### `issue-triage`

Issue triage for backlog management: an interactive wizard for humans, plus a fully scriptable CLI apply mode for skills and automation. (Triage is the name for metadata-level backlog work, distinct from the `/devenv-groom` design skill.)

**Interactive wizard:**

```bash
issue-triage [OPTIONS]
```

Options: `--project NAME`, `--milestone NAME` (filters). The wizard walks issues through review, type/label/milestone/assignee edits, and readiness.

**CLI apply mode** (non-interactive; all requested edits must succeed for exit 0):

```bash
issue-triage ISSUE... [--title TEXT] [--body-file FILE] [--milestone NAME] \
    [--assignee USER] [--label NAME]... [--triage-complete]
```

- Pass one issue for a single bundle, multiple issues for a bulk sweep
- `--triage-complete` fires the triage-complete event; the Status transition comes from `tools/config/skill-events.yml` (config-sourced, never hardcoded)
- Example: `issue-triage 44 45 46 --label needs-triage --triage-complete`

**Workflow States** (sourced from `devenv.config [workflows]`; hyphenated single tokens):

TBD → To-Groom → Ready → Implementing → Review → Merged → Staging → Production

### `workflow-signal`

Manually signal workflow events for one or many issues — the ergonomic front door to the `_on_*` event system. Primary use: deploy-sourced events (`staging-deploy`, `production-deploy`) that have no automatic observer; secondary: any manual correction. Signals pass through the standard dispatch path, so parent rollup, cascade, and loop-guard rules apply automatically. See [Issue Workflow](./Issue-Workflow.md) for the model.

```bash
workflow-signal                      # interactive: pick "what happened?"
workflow-signal staging-deploy 101 102   # batch: one event, many issues
workflow-signal production-deploy 101 102 begin-review 105   # mixed batches: repeat event/issue groups
workflow-signal --list               # available events
```

Event names accept bare, underscore, hyphen, or full forms (`staging-deploy` = `staging_deploy` = `_on_staging_deploy`).

---

### Skill Event Signals (`_on_*`)

Deterministic lifecycle-event scripts that keep provider project-board status in sync as work moves through the workflow. Both local tooling and skills fire them; nobody has to think about project status unless they choose to.

```bash
tools/internal/_on_begin_grooming.sh 43 # one entry point per lifecycle event
tools/internal/_on_merge.sh 43          # fired by merge tooling after a successful merge
```

These are internal scripts (underscore prefix): they have no depth-1 `tools/` entry and are invoked via their `tools/internal/` path. Interactive/batch firing goes through `workflow-signal` instead.

**Events**: `_on_triage_complete` (backlog triage done → candidate for design grooming), then begin/end pairs per phase: `_on_begin_grooming`, `_on_end_grooming`, `_on_begin_planning`, `_on_end_planning`, `_on_begin_implementation`, `_on_end_implementation`, `_on_begin_review`, `_on_end_review`, `_on_merge`, plus deploy-sourced `_on_staging_deploy` and `_on_production_deploy` (no automatic observer — fire via `workflow-signal`).

**Trigger points:**

- Skills fire them at lifecycle boundaries (grooming completion, plan approval, implementation kickoff, PR open, review completion)
- Local PR tooling fires `_on_begin_review` when a PR is created via `pr-create` and `_on_merge` when a merge completes via `pr-merge`
- Issues are linked via closing keywords in the PR body (`Closes #N`, `Fixes #N`, `Resolves #N`, in any case and tense), deduplicated, capped at 10 per PR. A keyword counts at the start of the text or after whitespace, `(` or `[`; it may be followed by a colon; and it may name a list (`Fixes #1, #2 and #3`). References to other repositories (`org/repo#N`, issue URLs) are ignored. This linkage is broader than GitHub's own auto-close: GitHub closes only the first issue of `Closes #1, #2` (each issue needs its own keyword), while this tool signals every number in the list, and prose such as `Resolves #3 and #4 are unrelated` also links #4
- Everything is local: signals run under your own provider authentication (keychain). Web-UI merges fire nothing — status changes you make outside local tooling are your own

**Guarantees:** best-effort (signals exit 0 and never block work), idempotent (re-signaling repairs drift), config-driven (Status values live in `tools/config/skill-events.yml` + `devenv.config [workflows]` — callers never name statuses or projects).

**Which project/PR tools participate:** `pr-create` (open), `pr-merge` (merge, via the shared `merge_pr` path). `pr-create-for-review` does **not** fire signals — its PRs are non-mergeable review artifacts, not a review-lifecycle boundary.

### `project-add-issue`

Adds issues to the provider project board (GitHub Projects v2 today).

```bash
project-add-issue PROJECT_NAME ISSUE_NUMBER... [OPTIONS]
```

**Options:**

- `--field NAME=VALUE`: Set project field (repeatable)

**Examples:**

```bash
# Add issue to project
project-add-issue "Q1 2026" 123

# Add multiple issues
project-add-issue "Sprint 5" 123 124 125

# Add with field values
project-add-issue "Q1 2026" 123 --field "Status=Ready" --field "Priority=High"
```

**Note:** The issue must exist before adding to a project.

### `project-update-issue`

Updates issue field values on the provider project board (GitHub Projects v2 today).

```bash
project-update-issue PROJECT_NAME ISSUE_NUMBER [OPTIONS]
```

**Options:**

- `--status STATUS`: Set Status field (TBD, To-Groom, Ready, Implementing, Review, Merged, Staging, Production)
- `--field NAME=VALUE`: Set custom field (repeatable)
- `--list-fields`: List available fields in project

**Status Workflow:**

1. **TBD** - Not ready for grooming
2. **To-Groom** - Can be groomed
3. **Ready** - Groomed, ready to implement
4. **Implementing** - Active development
5. **Review** - In pull request
6. **Merged** - Merged to main, awaiting deployment
7. **Staging** - Deployed to staging
8. **Production** - Deployed to production (closing stays explicit — `issue-close` or the closing PR)

**Examples:**

```bash
# Workflow states (TBD..Review) advance by their own signals, not by direct writes
workflow-signal end-planning 123           # → Ready
workflow-signal begin-implementation 123   # → Implementing
workflow-signal begin-review 123           # → Review (pr-create also fires this)

# Delivery states (Merged, Staging, Production) may be written directly
project-update-issue "Sprint 5" 123 --status "Merged"

# Set custom fields
project-update-issue "Q1 2026" 123 --field "Priority=High"
```

**Note:** Project field updates currently provide instructions for manual updates or require GraphQL API implementation.

## Releases & Policy Inspection

### `release-list`

Lists GitHub releases for the target repository (tag, name, published date, prerelease/draft flags, URL). Read-only.

```bash
release-list [OPTIONS]
```

**Options:**

- `-f, --format FORMAT`: Output format: `table` (default), `json`, `simple`
- `-V, --verbose`: Verbose output
- `--repo OWNER/REPO`: Override target repository

### `policy-export`

Exports a GitHub repository ruleset as JSON — used to snapshot repo policy or to author ruleset fixtures for `repo-create` templates.

```bash
policy-export <RULESET_ID> [--output FILE]
```

**Options:**

- `--output FILE`: Write the JSON export to a file (default: stdout)

## Container Management

Tools for managing Docker containers and services.

### `dependencies-up`

Starts up dependency services (databases, message queues, etc.) using Docker Compose.

```bash
dependencies-up
```

### `dependencies-down`

Stops dependency services and cleans up resources.

```bash
dependencies-down
```

### `docker-restart`

Restarts the Docker daemon by killing it and reloading it. Useful when Docker becomes unresponsive or needs to be refreshed.

```bash
docker-restart
```

**What it does:**

1. Kills the Docker daemon using `sudo pkill docker`
2. Reloads Docker using `.devcontainer/load-docker.sh`

### `container-enable-dotnet-debugger`

Injects and runs the .NET debugger into a locally running container for debugging purposes.

```bash
container-enable-dotnet-debugger <container-name>
```

### `server-run-sql`

Starts a SQL Server container for local development (uses Azure SQL Edge for ARM compatibility).

```bash
server-run-sql
```

The port is published on `127.0.0.1` only.

**Credentials:**

- Username: `SA`
- Password: from the `SQL_SA_PASSWORD` environment variable, or prompted (hidden) at a terminal; the tool refuses to create a container without one
- Default database: `test` (auto-created once the server accepts connections)

### `server-run-smb`

Starts an SMB/Samba server container for file sharing during development.

```bash
server-run-smb
```

The port is published on `127.0.0.1` only.

**Credentials:**

- Username: `SMB_USER` (default `devenv`)
- Password: from the `SMB_PASSWORD` environment variable, or prompted (hidden) at a terminal; the tool refuses to create a container without one
- Share: `Data`

## Database Management

Tools for managing databases, backups, and data operations.

### `mongo-backup-server`

Creates a backup of MongoDB server data.

```bash
mongo-backup-server <connection-string> <backup-directory>
```

**Features:**

- Backs up each non-built-in database individually
- Creates timestamped backup directories
- Skips admin, local, and config databases
- Passes the connection string to `mongodump` through a private config file, not the command line

### `mongo-restore-server`

Restores MongoDB server data from a backup.

```bash
mongo-restore-server <connection-string> <backup-directory> [--yes --confirm-target <target>]
```

**Features:**

- Restores the latest backup in the directory, chosen by the timestamp in each directory name. Two name forms count: the form `mongo-backup-server` writes (`YYYYMMDD_HHMMSS`) and the legacy `backup-YYYYMMDD`, optionally followed by a time (`backup-YYYYMMDD_HHMMSS`). Other directories are ignored. If none match, the tool refuses (exit 4) and lists the ignored directory names
- Drops existing collections before restore, after the operator retypes the target (hosts and database) at a terminal; without a terminal, `--yes` must come with `--confirm-target` naming that exact target (`YES=1` is not consent)
- Validates backup directory exists
- Passes the connection string to `mongorestore` through a private config file, not the command line

## Build and Development Tools

Tools for building, versioning, and managing development workflows.

### `editor`

Opens a file in VS Code (blocking with `--wait`) with automatic fallback to a preferred editor when VS Code is unavailable.

```bash
editor <file> [file ...]
```

**Features:**

- Primary: Opens files in VS Code and **waits** until the file/tab is closed before returning
- Fallback chain: Uses `$PREF_EDITOR`, then `$FALLBACK_EDITOR` (default: `nano`) if VS Code fails or is unavailable
- Supports multiple files (each blocks until closed)
- Used as system `$EDITOR` and `$VISUAL` for git, gh, and other CLI tools

**Configuration:**

- `FALLBACK_EDITOR` - Fallback editor when VS Code is unavailable (default: `nano`)
- `PREF_EDITOR` - Preferred editor over fallback (defaults to `FALLBACK_EDITOR`)
- `EDITOR` - Usually set to `$DEVENV_TOOLS/editor` by bootstrap
- `VISUAL` - Usually set to `$DEVENV_TOOLS/editor` by bootstrap

**Examples:**

```bash
# Open file directly
editor .local-artifacts/notes.txt

# Used automatically by git
git commit --allow-empty  # Opens in VS Code, waits until tab closes

# Editor-fallback mechanism demonstrated via the issue wrapper (inside this
# workspace, issue operations go through `issue-create` — never the raw provider
# CLI)
issue-create --title '' --body ''  # Opens the editor, waits until it closes

# Configure fallback
export FALLBACK_EDITOR=vim
editor somefile.sh  # Uses vim if VS Code fails
```

### `tooling-create-script`

Creates a new TypeScript script from the standard template: born on the shared
CLI scaffold (`toolCli` + house flags) with core-lib imports carrying the
correct relative prefix for the output directory. The bash template lane is
gone — every new tool is TypeScript.

```bash
tooling-create-script <script-name>
```

**Options:**

- `--dir DIR`: Output directory (default: `scripts/`)
- `--force`: Overwrite an existing file

**Features:**

- Uses `tools/templates/script-template.ts` as base (toolCli + house flags)
- Rewrites the template's `REL_LIB` import prefix to the computed relative
  path, so generated imports resolve wherever the tool is created
- Automatically makes script executable
- Includes the floor check, usage block, and the house error contract

### `lint-scripts`

Validates the remaining shell scripts using shellcheck.

```bash
lint-scripts [--format <format>] [--fix]
```

**Options:**

- `--format`: Output format (tty, json, checkstyle, diff, gcc, quiet)
- `--fix`: Attempt to automatically fix issues (experimental)

**Features:**

- Scans `*.sh` and `*.bash` files, plus extensionless files with a shell shebang, anywhere under the project root (skipping `node_modules/`, `.git/`, `playground/`, `tools/cache/`, `.local-artifacts/` and the contents of `repos/` clones)
- Provides statistics and summary
- Integrates with CI/CD pipelines

### `repo-version-list`

Lists all version tags in the current repository with colorized output.

```bash
repo-version-list
```

### `metrics-count-code-lines`

Counts lines of code in files or directories, with filtering options.

```bash
metrics-count-code-lines [file-or-directory]
```

### `cs-nuget-clear-local`

Clears local NuGet package cache for packages in the local debug feed.

```bash
cs-nuget-clear-local
```

**Features:**

- Clears `~/.nuget/packages` cache for local packages
- Removes all packages from `.debug/local-nuget-dev`
- Provides warnings if cleanup fails

### `cs-nuget-publish-local`

Publishes a NuGet package to local feed.

```bash
cs-nuget-publish-local [target-directory] [version] [configuration]
```

**Arguments:**

- `target-directory`: Directory containing .csproj files (default: current directory)
- `version`: Package version (default: calculated from git)
- `configuration`: Build configuration (default: Debug)

**Features:**

- Builds all .csproj files except test projects
- Includes symbols and source
- Clears cache after publishing
- Uses temporary directory for build artifacts

### `ci-build-local`

Builds a repository's container image into the local Docker cache, mirroring
how CI builds it. Generic over any Dockerfile-bearing repo (not .NET-coupled).

```bash
ci-build-local [target-directory] [version]
```

**Arguments:**

- `target-directory`: Directory containing a Dockerfile (default: current directory)
- `version`: Image version tag (default: calculated from git; `0.0.0-dev` when no tags)

**Features:**

- Tags the image `<repo-name>:<version>` and `<repo-name>:local`
- Passes GitHub Packages NuGet credentials as a BuildKit secret (`NUGET_TOKEN` env var, or `gh auth token` fallback)
- Version resolves from the target repo's tags, not the invoking directory
- Never pushes — local cache only

### `cs-open-coverage`

Open coverage reports in a browser (auto-detects chromium or firefox).

```bash
cs-open-coverage
```

## C# Dependency Management

Tools for tracing, updating, and propagating NuGet package changes across C# repositories.

### `repo-cache-update`

Refreshes the local repository cache (shallow-clones or updates all organization repositories) and rebuilds the dependency index. Prints the cache directory path on stdout.

**Usage:**

```bash
repo-cache-update [OPTIONS]
```

**Options:**

- `--no-refresh`: Skip refreshing the repository cache (rebuild index only)
- `-h, --help`: Show help and exit
- `-v, --version`: Show version and exit

**Output:** The absolute path to the cache directory (e.g. `$DEVENV_TOOLS/cache/repo_cache`).

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0`  | Success — cache directory path printed on stdout |
| `1`  | General error (missing credentials, clone failed, index build failed) |
| `4`  | Partial failure — some repos failed to cache; the index is still built and the cache path is still printed |

**Examples:**

```bash
# Refresh everything and print the cache path
repo-cache-update

# Capture the path for use in another script
CACHE=$(repo-cache-update)

# Rebuild the index without re-cloning (cache already fresh)
repo-cache-update --no-refresh
```

**Related:** `cs-dependencies-trace`, `cs-dependencies-update-wizard` (both use this cache internally via `--no-refresh`), `repo-cache-deepen`

### `repo-cache-deepen`

Fetch-only deepening of one cached repository: extends the shallow-clone depth and/or fetches additional branches as remote refs (`refs/remotes/origin/<branch>`). Never checks out — the cache working copy stays on the default branch. Used for branch-level git progress signals (see [Progress Reporting](./Progress-Reporting.md)).

**Usage:**

```bash
repo-cache-deepen --repo <name> [--depth N] [--branch <b>]...
```

**Options:**

- `--repo <name>`: Repository name in the cache (required)
- `--depth N`: Deepen history by N commits via `git fetch --deepen=<N>`. Default: `200`
- `--branch <b>`: Fetch branch `<b>` into `refs/remotes/origin/<b>` (repeatable)
- `-h, --help`: Show help and exit
- `-v, --version`: Show version and exit

**Notes:**

- Idempotent and additive: safe to re-run; deepening accumulates.
- Re-running `repo-cache-update` does not undo deepening (`git fetch`/`--deepen` never truncate history the repo already has), though its `gc --prune=all` pass may drop unreachable objects — deepened branches remain reachable via their remote refs and survive.

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0`  | Success |
| `1`  | Error (unknown repo, fetch failure) |
| `3`  | Invalid arguments |

**Examples:**

```bash
# Deepen one repo's history to the default depth
repo-cache-deepen --repo <your-service>

# Deepen to 500 commits and fetch two feature branches
repo-cache-deepen --repo service.reqord.identity --depth 500 \
    --branch issue-42-query-progress --branch issue-57-audit
```

### `cs-extract-snupkgs`

Extracts `.snupkg` symbol packages into a target directory for inspection (source-linked PDBs and symbols from published packages).

```bash
cs-extract-snupkgs <package.snupkg> [more.snupkg ...] [--output DIR]
```

### `cs-dependencies-trace`

Traces the reverse dependency tree for a C# repository — shows all repositories that depend on it, directly or transitively.

**Usage:**

```bash
cs-dependencies-trace [OPTIONS] [TARGET_DIR]
```

**Arguments:**

- `TARGET_DIR`: Path to a directory containing `.sln` or `.csproj` files. Defaults to the current directory.

**Options:**

- `--by-repo`: Collapse output to one line per dependent repo (omitting package detail)
- `--no-refresh`: Skip refreshing the repository cache
- `-h, --help`: Show help and exit
- `-v, --version`: Show version and exit

**Output format (default):**

```text
DEPTH:REPO:PACKAGE
```

For example: `0:<chassis-repo>:Acme.Lib.Services.Chassis.Common`

**Output format (--by-repo):**

```text
DEPTH:REPO
```

**Examples:**

```bash
# Show all dependents of the essentials library
cd repos/<your-library>
cs-dependencies-trace

# Show only direct dependents, collapsed by repo
cs-dependencies-trace --by-repo | grep '^0:'
```

### `cs-references-update`

Updates NuGet package references for every `.csproj` under a directory using `dotnet outdated --upgrade`. Also retargets the .NET framework and C# language version on request — the framework/language rewrite runs first, gates on `dotnet restore`, and only then are packages upgraded against the new target.

**Usage:**

```bash
cs-references-update [REPO_DIR] [OPTIONS]
```

**Arguments:**

- `REPO_DIR`: Directory tree to update. Defaults to the current directory.

**Options:**

- `--framework TFM`: Rewrite `<TargetFramework>` (and every entry of `<TargetFrameworks>` lists) to `TFM` (e.g. `net10.0`) in all non-`obj/`/`bin/` csproj files before updating packages. A `dotnet restore` gate runs between the rewrite and the package upgrade — if restore fails (invalid TFM, or packages with no assets for the new target), the script exits `10` without touching package versions. Any existing `global.json` whose `sdk.version` pin has a lower major than `TFM` is raised to `<N>.0.100` (other fields untouched; never created, never lowered). Existing `.vscode/launch.json` files get their `bin/<config>/net<N>.<M>/` build-output paths retargeted to `TFM` so debugging keeps finding the output folder.
- `--lang-version VER`: Set `<LangVersion>` to `VER` (e.g. `14.0`) in every csproj — updates existing tags and adds the tag where absent. Mutually exclusive with `--lang-default`.
- `--lang-default`: Remove existing `<LangVersion>` tags (never adds) so the TFM's default language version applies implicitly. Mutually exclusive with `--lang-version`.
- `--post-update SCRIPT`: Run `SCRIPT` (an executable file) as the **last** step — after the package update and the `.repo/update.sh` boilerplate chain — with the repo root as the working directory. Whatever it edits joins the run's changes (and the wizards' update commit). Use it for repo-specific migrations the tool cannot do generically, such as Dockerfile image tags. A non-zero exit fails the run (exit `12`); it does not run if `dotnet outdated` failed. The script receives:
  - `CS_UPDATE_REPO_DIR`: the target directory.
  - `CS_UPDATE_FRAMEWORK`: the `--framework` value, empty when not passed.
  - `CS_UPDATE_PREVIOUS_FRAMEWORKS`: the TFMs found in the tree before the rewrite, space-separated (e.g. `net8.0`).

  The script must be **idempotent**, because the wizards can re-run a repo. A relative path is resolved against the invocation directory.
- `--pre-restore SCRIPT`: Run `SCRIPT` (an executable file) after the `--framework`/LangVersion rewrite and **before** the `dotnet restore` gate, with the same working directory, environment and idempotency requirement as `--post-update`. Use it for edits the restore gate depends on — for example removing package references the new target framework prunes (`NU1510`, an error under warnings-as-errors). The restore gate always runs after it, even without `--framework`. A non-zero exit fails the run (exit `13`) before any package update. A missing script exits `3`; a non-executable one exits `2`.

  Both scripts run from the repository root. When the target directory is not itself a git repository, that is the **enclosing** repository's root, so a script must act on `CS_UPDATE_REPO_DIR`, never on its working directory.
- `-h, --help`: Show help and exit

**LangVersion rules:**

- `--lang-version` given: the explicit version wins; tags are updated or added.
- `--framework` alone: existing `<LangVersion>` tags are rewritten to the TFM's default language version (`net8.0` → `12.0`, `net9.0` → `13.0`, `net10.0` → `14.0`, `net11.0` → `15.0`). An unmapped TFM combined with tags present in the tree is an argument error naming the supported TFMs — pass `--lang-version` or `--lang-default` explicitly instead.
- `--lang-default` given: tags are removed; the default applies silently.

**Boilerplate chain:**

If the target repo has an executable `.repo/update.sh`, it is chained after the package update (`--no-refresh`). When the tree was clean before the run, the chain passes `--force` — the only dirt at that point is this script's own upgrades, so the boilerplate sync proceeds instead of refusing. When the tree was already dirty before the run, the chain runs without `--force`; `update.sh` defers its sync (its lockfile migration still runs) and this script surfaces a NOTE to re-run it after committing.

**Exit codes:**

| Code | Meaning |
|------|--------------------|
| `0` | Success |
| `2` | Invalid arguments (bad flag values, conflicting flags, unmapped TFM with LangVersion tags present) |
| `3` | Target directory not found, or a `--pre-restore`/`--post-update` script not found |
| `10` | `dotnet restore` failed after a rewrite |
| `11` | `dotnet outdated` failed for at least one project |
| `12` | The `--post-update` script exited non-zero |
| `13` | The `--pre-restore` script exited non-zero |

**Examples:**

```bash
# Plain package update (default behavior)
cs-references-update ~/repos/<your-library>

# Retarget the whole repo to .NET 10, bumping pinned LangVersion tags to 14.0
cs-references-update ~/repos/<your-library> --framework net10.0

# Retarget with an explicit language version
cs-references-update ~/repos/<your-library> --framework net10.0 --lang-version 13.0

# Drop LangVersion pins so the TFM default applies
cs-references-update ~/repos/<your-library> --lang-default
```

### `cs-references-update-wizard`

Runs the full NuGet dependency-update workflow for a **single** repository interactively. Useful for updating one repository without walking the entire dependency tree.

**Usage:**

```bash
cs-references-update-wizard [OPTIONS] [REPO_DIR]
```

**Arguments:**

- `REPO_DIR`: Path to the repository to update. Defaults to the current directory.

**Options:**

- `--branch NAME`: Branch to create for the update (default: `auto-update-references`)
- `--dry-run`: Show what would happen without making any changes
- `--continue`: Resume a previously started update. Expects the update branch to exist with staged or unstaged changes. Skips branch creation and dependency update steps. Framework/language flags are ignored in this mode (the update already happened).
- `--framework TFM`: Retarget every csproj to `TFM` (e.g. `net10.0`) before updating packages. Passed through to `cs-references-update` (see its section above for LangVersion interaction). A framework change is always treated as a breaking update: the commit and PR are titled `feat!: update references and target framework`, the commit carries a `BREAKING CHANGE:` footer, and the bump report includes the framework change (e.g. `net8.0 → net10.0 (FRAMEWORK)`).
- `--lang-version VER`: Set `<LangVersion>` to `VER` (e.g. `14.0`) in every csproj.
- `--lang-default`: Remove `<LangVersion>` tags so the TFM default applies.
- `--pre-restore SCRIPT`: Forwarded to `cs-references-update` (see its section for the contract), resolved and validated up front like `--post-update`. A failing script fails the update step (exit `21`).
- `--post-update SCRIPT`: Forwarded to `cs-references-update` (see its section for the contract). The path is resolved to absolute and validated up front. If the script fails, the update step fails (exit `21`) and the update branch is discarded, so a half-migrated repo is never committed.
- `-h, --help`: Show help and exit
- `-v, --version`: Show version and exit

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0`  | Repository was updated (PR created and merged) |
| `10` | No-op — nothing changed after running `cs-references-update` |
| `20` | git operation failed (branch creation, commit, or push) |
| `21` | `cs-references-update` failed |
| `30` | Tests still failing after user had a chance to fix |
| `40` | PR could not be created |
| `41` | PR could not be merged |
| `1`–`5` | Argument / environment error (the suite exit-code contract in `tools/lib/core/exit-codes.ts`) |

**Workflow:**

1. Create branch (`auto-update-references` by default)
2. Run `cs-references-update` to update all NuGet packages
3. Detect major version bumps in non-test `.csproj` files
4. If nothing changed, clean up and exit with code `10`
5. Commit and push the branch. The commit message carries no CI-skip token, so the merged commit triggers the repository's CI pipeline — `cs-dependencies-update-wizard` waits for that run before the next generation
6. Run `./run-tests` if present — pause for the user to fix failures
7. If major bumps or test failures are detected, prompt the user to confirm the change level (`patch` or `major`)
8. Create a PR titled with the commit's conventional subject: `fix: update references` (patch release), or `feat!: update references` / `feat!: update references and target framework` with a `BREAKING CHANGE:` footer on the commit (major release) when non-test packages moved to a new major version or the target framework changed. When the only changed `.csproj` files are under `test/`/`tests/` trees, the PR and commit are `chore(tests): update references` instead — semantic-release emits no version bump for test-only dependency updates. These are conventional types, so repositories enforcing conventional commits in a `commit-msg` hook accept them and their release configs release them
9. Merge the PR
10. Return to the default branch and clean up the local branch

**Examples:**

```bash
# Update a specific repository
cs-references-update-wizard ~/repos/<chassis-repo>

# Dry run to see what would change
cs-references-update-wizard --dry-run

# Use a custom branch name
cs-references-update-wizard --branch deps/update-q2-2026
```

### `cs-dependencies-update-wizard`

Interactive wizard that updates C# NuGet dependencies across repositories. Supports two modes:

- **Single-target mode** (default): walks the reverse dependency tree of a specific library and updates every dependent repo in BFS order.
- **Global mode** (`--global`): computes a full topological ordering of *all* C# repos in the cache and updates them generation by generation — from foundational libraries up through services. Every repo gets `cs-references-update` run against it, including external package updates.

**Usage:**

```bash
# Single-target mode
cs-dependencies-update-wizard [OPTIONS] TARGET_DIR

# Global mode
cs-dependencies-update-wizard [OPTIONS] --global [N]
```

**Arguments:**

- `TARGET_DIR` *(single-target)*: Path to the released library. Must contain `.sln` or `.csproj` files. Defaults to the current directory.
- `N` *(global)*: Optional starting generation number (default: `0`). Use this to resume a run that was interrupted — pass the generation number shown in the output.

**Options:**

- `--global [N]`: Global mode — update all C# repos in topological order, optionally starting from generation `N`
- `--include GLOB` / `--exclude GLOB` *(global, repeatable)*: Process only repos matching an include glob (all repos when none is given), never repos matching an exclude glob — exclude wins. Globs use `*` and `?` against the repo name (e.g. `--include 'lib.cs.*'`). Filtering happens after the generation order is computed, so a filtered wave keeps the full dependency order and generation numbers stay the same across waves (`--global 1 --include 'lib.cs.*'` resumes a library wave at generation 1). Using either flag without `--global` is an argument error.
- `--no-refresh`: Skip refreshing the repository cache
- `--dry-run`: Show what would be updated without making any changes
- `--framework TFM`: Retarget every csproj to `TFM` (e.g. `net10.0`) before updating packages. Forwarded to `cs-references-update-wizard` (and through it to `cs-references-update`) for every processed repo. A framework change produces a `major:` PR per repo.
- `--lang-version VER`: Set `<LangVersion>` to `VER` (e.g. `14.0`) in every csproj.
- `--lang-default`: Remove `<LangVersion>` tags so the TFM default applies.
- `--pre-restore SCRIPT`: Forwarded to `cs-references-update-wizard` (and through it to `cs-references-update`) for every processed repo, resolved and validated once up front like `--post-update`.
- `--post-update SCRIPT`: Forwarded to `cs-references-update-wizard` (and through it to `cs-references-update`; see that section for the contract) for every processed repo. The path is resolved to absolute and validated once, before any repo is touched. A failing script makes that repo's single-repo wizard exit `21` with its update branch discarded, which triggers this wizard's failure prompt.
- `-h, --help`: Show help and exit
- `-v, --version`: Show version and exit

**Workflow (single-target):**

For each depth level (0 = direct dependents, 1 = transitive dependents, …):

1. Check whether each dependent repo already uses the latest published version — skip if so
2. Call `cs-references-update-wizard` for each repo that needs updating
3. If a repo fails, pause and prompt the user to fix it before continuing
4. After the level is complete, wait for CI pipelines to finish, refresh the cache, and advance

**Workflow (--global):**

Generation 0 contains repos with no org-internal dependencies. Generation N contains repos whose org-internal dependencies are all in generations < N.

For each generation:

1. Run `cs-references-update-wizard` for every repo (exit 10 = no changes → skipped silently)
2. If a repo fails, pause and prompt the user to fix it before continuing with the generation
3. After the generation is complete, wait for CI pipelines to finish, refresh the cache, and advance

**The pipeline wait (both modes):** after every level — the last one included — the wizard waits (up to 10 minutes per repo, polling every 15 s) for each repo it merged in that level. The merged commit is read from the remote default branch after a fetch, not from the local clone. A pipeline run counts when it built that commit or a later commit on the default branch that contains it (batched CI may build only the newest push); every pipeline of the repo that built it must succeed — for each, its newest such run. A failed or cancelled run fails the wait; no such run before the timeout also fails it, with a message pointing at a possibly missing CI trigger, and so does a merged commit that cannot be fetched. Any failed wait pauses the wizard so the runs can be checked by hand before going on.

Repos whose update changed nothing (exit 10) are not waited on — except after the single-repo wizard handed the merge to the user (PR creation or merge failed, exit `40`/`41`): the failure prompt then also offers **[m]erged by hand**, which awaits the merged commit without re-running the update, and a retry that finds nothing left to change is awaited the same way.

**Resuming an interrupted global run:**

The generation number is printed in the output header. To resume from where you left off:

```bash
cs-dependencies-update-wizard --global 3   # restart from generation 3
```

**Examples:**

```bash
# Single-target: run after releasing <your-library>
cd repos/<your-library>
cs-dependencies-update-wizard

# Global: update every C# repo from scratch
cs-dependencies-update-wizard --global

# Global: resume from generation 4 after a previous run was interrupted
cs-dependencies-update-wizard --global 4

# Dry run — show which repos would be updated at each generation
cs-dependencies-update-wizard --global --dry-run

# A library-only wave, then the services (same generation order, different repo sets)
cs-dependencies-update-wizard --global --include 'lib.cs.*'
cs-dependencies-update-wizard --global --include 'service.*' --include template.service --exclude monorepo.services-backend

# Skip initial cache refresh (useful when cache is already fresh)
cs-dependencies-update-wizard --no-refresh
```

**Related:** `cs-references-update-wizard` (single-repo workflow), `cs-dependencies-trace` (view the dependency tree without making changes)

## Desktop Environment

Tools for managing the Fluxbox desktop application menu inside the dev container's graphical environment. The desktop is accessible via VNC — see [Dev-container-environment.md](./Dev-container-environment.md) for connection details.

### `devenv-desktop-menu-add-shortcut`

Adds a shortcut (exec entry) to the Fluxbox desktop application menu. If a shortcut with the same label already exists the command exits silently (idempotent).

**Usage:**

```bash
devenv-desktop-menu-add-shortcut <label> <command> [folder]
```

**Arguments:**

- `<label>`: Display label shown in the menu
- `<command>`: Shell command to run when the item is selected
- `[folder]`: Optional — name of an existing folder to add the shortcut into. Create the folder first with `devenv-desktop-menu-add-folder`.

**Examples:**

```bash
# Add a top-level shortcut
devenv-desktop-menu-add-shortcut "MongoDB Compass" "mongodb-compass"

# Add a shortcut inside an existing folder
devenv-desktop-menu-add-shortcut "Compass" "mongodb-compass" "Databases"
```

**Notes:**

- New shortcuts are placed immediately before the `[config]` or `[workspaces]` block (or the closing `[end]`) so Fluxbox built-in items remain at the bottom.
- The `FLUXBOX_MENU` environment variable can override the menu file path (default: `~/.fluxbox/menu`).

### `devenv-desktop-menu-add-folder`

Adds a folder (submenu block) to the Fluxbox desktop application menu. If a folder with the same name already exists the command exits silently (idempotent).

**Usage:**

```bash
devenv-desktop-menu-add-folder <folder-name> [parent-folder]
```

**Arguments:**

- `<folder-name>`: Display name for the new folder
- `[parent-folder]`: Optional — name of an existing folder to nest this one inside.

**Examples:**

```bash
# Create a top-level folder
devenv-desktop-menu-add-folder "Databases"

# Create a nested folder
devenv-desktop-menu-add-folder "MongoDB" "Databases"
```

**Notes:**

- Like shortcuts, new folders are placed before `[config]`/`[workspaces]`/root `[end]`.
- The folder must exist before shortcuts can be added into it.

**Typical workflow:**

```bash
# 1. Create the folder
devenv-desktop-menu-add-folder "Databases"

# 2. Add shortcuts into it
devenv-desktop-menu-add-shortcut "MongoDB Compass" "mongodb-compass" "Databases"
devenv-desktop-menu-add-shortcut "pgAdmin" "pgadmin4" "Databases"
```

## Networking and Utilities

Tools for managing network connections and performing utility functions.

### `get-public-ip`

Gets the current public IP address of the machine.

```bash
get-public-ip
```

## Configuration Management

### `install-extras`

Interactive menu to install optional tools from `.devcontainer/install-extras/`.

```bash
install-extras [OPTIONS] [FILTER]
```

**Options:**

- `-m, --multi` - Multi-select mode (install several extras at once)
- `--dir PATH` - Override the extras directory (default: `.devcontainer/install-extras/`)
- `FILTER` - Filter extras by name; auto-runs if only one match

**Features:**

- Interactive fzf menu with preview (using `bat` if available)
- Single or multi-select installation
- Filter by name for quick access
- Executes scripts in order with error handling

**Examples:**

```bash
# Interactive menu (single selection)
install-extras

# Multi-select mode
install-extras -m

# Auto-install by filter (runs immediately if unique match)
install-extras helm
install-extras tailscale

# Filter list (shows interactive menu if multiple matches)
install-extras mongo
```

**Available Extras:**

- `dns-hijack.sh` - DNS split horizon setup with dnsmasq
- `helm.sh` - Helm package manager for Kubernetes
- `minikube.sh` - Minikube for local Kubernetes
- `mongo-tools.sh` - MongoDB CLI tools
- `mongo-compass.sh` - MongoDB Compass GUI
- `chromium.sh`, `firefox.sh` - Web browsers
- `flatpak.sh` - Flatpak package manager
- `zsh.sh` - zsh with devenv bash configuration
- `tailscale.sh` - Tailscale VPN with SOCKS5 proxy
- `doctl.sh` - DigitalOcean CLI tool

#### DNS Hijack Setup

The `dns-hijack.sh` script configures split-horizon DNS using dnsmasq, allowing you to route specific domains to different DNS servers (useful for routing internal domains to VPN or local servers).

**Configuration File:** `.devcontainer/install-extras/config/dns-mapping.cfg`

The script requires a configuration file containing domain-to-server mappings. Each line should follow the dnsmasq server directive format:

```bash
server=/domain.name/IP_ADDRESS
```

**Example Configuration:**

```bash
# Route internal domains to corporate DNS
server=/company.local/192.168.1.201
server=/company.net/192.168.1.201

# Route Azure resources to Azure DNS
server=/company.azure/10.210.2.5
```

**Installation:**

```bash
install-extras dns-hijack
```

**Setup Steps:**

1. Ensure the config file exists at `.devcontainer/install-extras/config/dns-mapping.cfg`
2. Run `install-extras dns-hijack` to install and configure dnsmasq
3. The script will fail with a helpful error if the config file is missing

**Files and paths:**

The installer writes `devenv-split.conf` into the dnsmasq configuration directory (`/etc/dnsmasq.d` by default). The mapping file is copied in as data, so `$` and backticks in it are kept literally, and re-running the installer rewrites identical content. dnsmasq loads every `*.conf` file in that directory, so after writing `devenv-split.conf` the installer retires every other `*-split.conf` by renaming it to `<name>.dpkg-old` (or `<name>.dpkg-old.1`, `.dpkg-old.2`, … when that name is taken, so nothing is overwritten) and prints a message naming both paths. The old file is never deleted. dnsmasq reads either only `*.conf` files or, with Debian's `CONFIG_DIR` exclusion list, every file except those ending in `.dpkg-dist`, `.dpkg-old` or `.dpkg-new`, so a `.dpkg-old` file is skipped under both forms. If the rename fails, the installer prints an error to stderr naming the source and destination, says the old configuration is still live next to `devenv-split.conf`, and exits 1. `split-dns.conf` and other files are left alone.

At container start, `addon-scripts/dns-startup.sh` looks for the configuration file in this order: `devenv-split.conf`, `split-dns.conf`, then the first other `*-split.conf` (sorted, following the shell locale); a renamed `.dpkg-old` file is never matched. One rule decides what a resolver line means, for both the resolv.conf check and the upstream-file check: a trailing carriage return and everything from the first `#` or `;` (even with no space before it) are stripped and whitespace is trimmed; a line is then a usable nameserver only when its key is `nameserver` (any letter case), its value is non-empty, and the value is not dnsmasq itself. A bare `nameserver` line is never usable. "Dnsmasq itself" means `127.0.0.1`, `127.1`, `127.0.1`, `0.0.0.0`, `::1` (also as `0:0:0:0:0:0:0:1` and the zero-padded 8-group form) and `::`, compared case-insensitively, with an optional `%zone` suffix on the IPv6 forms. Every other nameserver is a real upstream, including Docker's embedded resolver (`127.0.0.11`) and a systemd-resolved stub (`127.0.0.53`). When `/etc/resolv.conf` has at least one usable nameserver, the script writes the dnsmasq upstream file (`/etc/resolv.dnsmasq`) from the filtered content: the usable `nameserver` lines plus the `search`, `domain` and `options` lines, in their original order, without carriage returns or comments (other lines are dropped), so the upstream file never contains dnsmasq's own address. Otherwise it keeps the existing upstream file, but only if that file itself has a usable nameserver. If neither has one (the file is missing, empty, comments only, only bare `nameserver` lines, or names only dnsmasq itself), it prints a warning, leaves DNS unchanged (resolv.conf is not rewritten and dnsmasq is not restarted) and exits 0, so dnsmasq never forwards to itself and the container start never fails. A resolv.conf with a usable nameserver always rewrites the upstream file, which also heals a file that an earlier run left pointing at localhost. Otherwise it restarts dnsmasq and points resolv.conf at `127.0.0.1`, so running it repeatedly is safe.

Both scripts take their paths from environment variables, defaulting to the system paths:

| Variable | Default | Meaning |
|----------|---------|---------|
| `DEVENV_DNS_CONF_DIR` | `/etc/dnsmasq.d` | dnsmasq configuration directory |
| `DEVENV_DNS_RESOLV_CONF` | `/etc/resolv.conf` | system resolver file |
| `DEVENV_DNS_UPSTREAM_FILE` | `/etc/resolv.dnsmasq` | upstream resolver file named by `resolv-file=` |

**Features:**

- Automatic dnsmasq installation and configuration
- Split-horizon DNS routing (specific domains to specific servers)
- Strict ordering to prioritize mapped domains
- Upstream DNS fallback for unmapped domains (idempotent across container restarts)
- Configuration validation before installation

### `devenv-update`

Updates the devenv repository to the latest version from the git host. Uses
`git-update` internally, so a rewritten fork master (a maintainer fork sync) is
handled the same way as the shell-start update check: reset when the clone has
nothing unique, replay via rebase when it does.

```bash
devenv-update
```

### `devenv-add-env-vars`

Adds or updates environment variables in `.runtime/env-vars.user.sh`, the file that `env-vars.sh` sources last. Variables added here survive `devenv-update` (which regenerates `env-vars.sh`) and win over generated values.

```bash
devenv-add-env-vars "VAR1=value1" "VAR2=value2" ...
```

**Features:**

- Validates environment variable format (uppercase with underscores)
- Updates existing variables (removes old values to prevent duplicates)
- Appends new variables to the file (created owner-only on first use)
- Quotes values so nothing in a value is ever executed
- Provides clear logging of added/updated variables

**Example:**

```bash
devenv-add-env-vars "MY_API_KEY=abc123" "DEBUG_MODE=true"
```

**Note:** Restart your container or source the `env-vars.sh` file to apply changes.

### `devenv-add-custom-bootstrap`

Adds custom commands to `.devcontainer/user-custom-bootstrap.sh` that run whenever the devcontainer is created or the bootstrap sequence executes. These are user-level customizations that are not committed to the repository.

```bash
devenv-add-custom-bootstrap "command1" "command2" ...
```

**Features:**

- Validates bash syntax before adding commands
- Creates `user-custom-bootstrap.sh` if it doesn't exist
- Sets executable permissions automatically
- Adds documentation comments for each command

**Example:**

```bash
devenv-add-custom-bootstrap "echo 'Personal bootstrap step'" "apt-get update"
```

**Note:** For organization-wide bootstrap customizations, create `.devcontainer/org-custom-bootstrap.sh` and commit it to the repository.

### `devenv-add-custom-startup`

Adds custom commands to `.devcontainer/user-custom-startup.sh` that will run each time VS Code starts. These are user-level customizations that are not committed to the repository.

```bash
devenv-add-custom-startup "command1" "command2" ...
```

**Features:**

- Validates bash syntax before adding commands
- Creates `user-custom-startup.sh` if it doesn't exist
- Sets executable permissions automatically
- Adds documentation comments for each command

**Example:**

```bash
devenv-add-custom-startup "echo 'Container started'" "export MY_VAR=value"
```

**Note:** For organization-wide startup customizations, create `.devcontainer/org-custom-startup.sh` and commit it to the repository.

### Function-backed commands (function vs script)

`key-update-provider`, `key-update-do`, and `key-update-tailscale` are **bash functions** defined by bootstrap (`tools/ts/setup-steps/bash-functions.ts` emits the shell functions): `key-update-do` and `key-update-tailscale` wrap `tools/ts/_key-update-*.ts`, `key-update-provider` dispatches to the active provider's `tools/lib/providers/<name>/key-update.ts` (bootstrap also generates one `key-update-<provider>` command per provider that ships a script, for example `key-update-azure`, to rotate that provider's credential regardless of which is active), and all of them re-source `.runtime/env-vars.sh` afterward, so the current shell sees refreshed values. The underscore-prefixed scripts have no depth-1 `tools/` entry by design — always invoke the bare function name. (`repo-get` is the deliberate counter-example: its depth-1 stub has real value for non-interactive use, so it is a plain script plus stub.)

### `key-update-provider`

Rotates the git provider credential: imports the new token through the provider auth seam into the keychain (the single source of truth) and re-wires the git credential helper. No token is written to env files, remote URLs, or `.setup/` — the seed file `.setup/provider_token.txt` is a bootstrap-input one-shot, not the store.

```bash
key-update-provider              # prompts for the token (hidden input)
key-update-provider < token-file # or pipe it on stdin
```

The token is never accepted as an argument: it would appear in the process list and in shell history.

### `key-update-tailscale`

Updates the Tailscale auth key and re-authenticates the daemon without requiring a container restart.

```bash
key-update-tailscale
# Or use the bash function:
key-update-tailscale
```

**Features:**

- Prompts for new reusable auth key (input is hidden)
- Validates key format (must start with `tskey-`)
- Updates `TS_AUTHKEY` in `.runtime/env-vars.user.sh`
- Re-authenticates the Tailscale daemon immediately
- Sources the updated environment variables in the current shell

**When to use:**

- Your reusable auth key has expired (typically after 90 days)
- You need to switch to a different Tailscale network or organization
- Admin has rotated the team's auth key

**Note:** This script preserves your container's hostname and route settings during re-authentication.

### `key-update-do`

Updates the Digital Ocean API token and reloads the environment.

```bash
key-update-do [new-token]
```

**Interactive mode:** If no token is provided, prompts for input (hidden).

**Features:**

- Accepts token as command-line argument or interactive prompt
- Warns when a token looks shorter than the typical format (proceeds anyway)
- Stores token persistently in `.setup/digitalocean_token.txt` with secure permissions
- Updates the `DIGITALOCEAN_API_TOKEN` environment variable (persisted in `.runtime/env-vars.user.sh`)
- Reloads environment variables in the current shell

**When to use:**

- Your Digital Ocean API token has been rotated
- You need to switch to a different Digital Ocean account or organization
- Updating token after regeneration for security reasons

**Note:** No container restart required after updating the token.

Or manually update the token file:

```bash
echo "your_new_token_here" > .setup/digitalocean_token.txt
```

The token is loaded into the `DIGITALOCEAN_API_TOKEN` environment variable in the dev container (generated into `env-vars.sh` from the seed file), making it available to infrastructure and deployment scripts like `terraform-plan` and `doctl` commands.

### `get-services-config`

Pulls service configuration from its repository into the local development environment.

```bash
get-services-config
```

Clones the configuration repository into a staging folder and swaps it in for the config folder (`CONFIG_FOLDER`, default `$DEVENV_ROOT/.debug/config`), keeping the existing folder if the clone or checkout fails. The repository URL is passed to `git clone` after `--`, so a value that begins with `-` is read as a URL and never as an option.

`CONFIG_FOLDER` is validated before anything is created, moved or deleted, because the folder is replaced wholesale. It must be an absolute path and must not be a symbolic link (point it at the real directory), `/`, the home directory, `DEVENV_ROOT`, the current working directory (run the tool from another directory), or an ancestor of any of them. If it exists it must be an empty directory, the output of an earlier run (a directory whose `info.txt` was written by this tool, which strips `.git` from what it extracts so that a refresh keeps working), or a git working tree (a `.git` directory or file) with nothing local-only: `git status --porcelain --ignored --untracked-files=all` prints nothing (no uncommitted changes, untracked files or ignored files), no commit exists only locally (`git rev-list --branches --not --remotes` prints nothing, so a repository with no remote and any commit is refused), and `git stash list` prints nothing. A matching `origin` remote does not excuse any of this. A working tree that fails a check, or whose state git cannot report, is refused with exit 2, naming the folder and the kind of local content found; anything else that is not empty or a previous extraction is refused the same way. A folder that does not exist yet is created.

## Kubernetes Tools

The `kube-*` script family wraps common kubectl workflows (pod listing, logs,
exec, console, delete, restart, scale, port-forwarding, traffic interception,
context/deployment selection).

### Namespace selection (all scripts)

Every script that targets namespaced resources resolves its namespace the same
way, in priority order:

1. **Flag:** `-n <ns>` or `--namespace <ns>` (also `--namespace=<ns>`)
2. **Environment:** `KUBE_NAMESPACE=<ns>`
3. **Partial match:** a non-exact flag/env value is matched case-insensitively
   against the cluster's namespaces — a unique match auto-selects, multiple
   matches offer a filtered picker (interactive) or an error listing
   candidates (non-interactive)
4. **Interactive picker:** with no namespace given on a TTY, an `fzf` list of
   all namespaces appears
5. **Non-interactive default:** the current context's default namespace is
   used, with a one-line hint that `-n` / `KUBE_NAMESPACE` / the picker exist

Examples:

```bash
kube-logs api -n prod              # exact namespace via flag
kube-logs api -n prod-eu           # partial: resolves if unique
KUBE_NAMESPACE=prod kube-logs api       # env form
kube-pod-delete api -n prod        # destructive scripts honor the flag
KUBE_NO_INTERACTIVE=1 kube-logs api  # force non-interactive (scripts/CI)
```

For the pod-addressed forwarders (`kube-logs`, `kube-pod-exec`, `kube-pod-console`) the namespace option is accepted directly after the pod word and before the command, as `-n NS`, `-nNS`, `--namespace NS` or `--namespace=NS`: `kube-pod-exec api -n prod ls -n`. Once the command starts, everything is forwarded unread, so the command's own `-n` stays the command's.

Set `KUBE_NO_INTERACTIVE=1` to disable the interactive picker entirely
(assumed by scripts and CI; interactive pickers require a TTY). Picking under
that env is recorded/CI-only: a single match is taken; several matches are a
`kube-forward-ports`/`kube-intercept` conflict — pin the exact pod name there,
since blind-picking a port-forward or intercept target is a wrong-target
action.

Destructive scripts (`kube-pod-delete`, `kube-pod-restart`, `kube-pod-scale`)
keep their consent gates regardless of how the namespace was supplied.

---

## Configuration Files

### `docker-compose-dependencies.yml`

Per-repo Compose file (when a repo ships one at its root) for running development dependencies — databases, message queues, and similar services alongside the dev container. Not a devenv-managed file: each repo owns its own. `container-*` tools target the devenv container itself, not these dependency stacks.

## Internal machinery scripts (`tools/internal/`)

`tools/internal/` holds **machinery scripts** — scripts invoked by the devenv
machinery itself (lifecycle event dispatch, git hooks) rather than by a person
at a shell. The folder is the workspace's convention for "the user would
generally not run this"; it answers the placement question that
`tools/ts/`, `tools/fork/`, and `tools/custom/` do not:
those three are the override chain for user-facing tools, while `tools/internal/` sits outside
it entirely.

**What belongs here:** scripts whose only caller is other tooling —
githook backing scripts, CI-only checkers, lifecycle event entry points.
**What does not:** anything a user might legitimately invoke (that belongs in
`tools/ts/` and gets a `PATH` stub), and user-extensible machinery
(githooks themselves live in `.husky/` and delegate here).

**Contract:**

- No depth-1 `tools/<name>` stub is generated for scripts in this folder
  (`.devcontainer/entry-stubs-sync.sh` skips it).
- Not on `PATH`; invoke by explicit path (`tools/internal/<name>.sh`).
- Excluded from the `tools/*` gitignore whitelist via the `!tools/internal/`
  entry in `.gitignore`, so the folder is tracked by git.
- Not overridden by `tools/fork/` or `tools/custom/` — machinery behavior is
  not user-replaceable through the override chain.
- Tests live in `tools/tests/ts/` like any other tool.

**Current contents:**

- **`prepare-commit-msg`** — hook shim (TS body `prepare-commit-msg.ts`) backing the `.husky/prepare-commit-msg`
  githook; generates `Change-Id` trailers used by fork export/sync twin detection.
- **`commit-action-check`** — commit-message trailer linter (TS body) run by the
  `commit-messages` CI job (`.github/workflows/test.yml`) and the
  `.husky/commit-msg` hook.
- **`_on_*.sh`** — lifecycle event entry points (one-line exec shims) firing
  `_on_event_dispatch.ts`, which resolves the event via
  `tools/config/skill-events.yml` and writes the mapped Status through
  `lib/domain/issues/graph.ts` (begin/end planning, implementation, review,
  grooming; merge; triage-complete; staging and production deploy). Manual
  firing goes through `workflow-signal`. Events are configured in
  `tools/config/skill-events.yml`.
- **`csharp-debug`** — drives the bootstrap-installed vsdbg .NET debugger
  (`.debug/remote_debugger/`): `launch <app.dll>` / `attach <pid>` enter DAP
  mode (`--interpreter=vscode`) for breakpoints, stepping, watch, and
  expression evaluation; `version` prints the debugger version. Invoked by
  path from the hunt and pair skills' Rung-3 debugging lanes — not a
  user-facing CLI (the DAP session is driven by the AI or a DAP client, not
  by hand). Scratchpad-safe: observes and controls execution, never mutates
  the working tree.

**When to add here vs `tools/ts/`:** ask "who is the caller?" If the
caller is always machinery (a hook, CI, the event dispatcher), use
`tools/internal/`. If a human might ever run it — even rarely — use
`tools/ts/` (TypeScript) so it gets a `PATH` stub
and enters the override chain.

### `repo-update-config.sh`

Off-`PATH` but user-runnable maintenance script (unlike the machinery scripts
above): applies repository configuration after the fact.

Applies or updates GitHub repository configuration to an existing cloned repository. This is useful when configuration could not be applied during initial repository creation due to account limitations (e.g., GitHub Pro specification item for private repos) or if the configuration has changed and needs to be reapplied.

**Usage:**

```bash
repo-update-config <repo-path> [--type <type>]
```

On Azure the template-repository setting is skipped with a warning (the provider has no repository template flag, so the repository is left unchanged); the other steps still run.

**Arguments:**

- `<repo-path>`: Path to the cloned repository directory

**Options:**

- `--type <type>`: Repository type (optional; will be auto-detected from GitHub if not specified)

**Description:**
This script reads the repository type from either the command-line argument or by querying the provider for repository topics. It then applies the standardized configuration for that type, including:

- **GitHub rulesets** - Branch protection rules (requires GitHub Pro or public repository)
- **Merge types** - Allowed merge strategies (merge, squash, rebase) per type. Org policy configures rebase-only ([Commit Conventions](./Commit-Conventions.md))
- **Template setting** - Marks template repositories for "Use this template" button
- **PR branch deletion** - Automatic deletion of PR branches after merge
- **Repository features** - Wiki, Issues, Discussions, Projects, Auto-merge, Update branch, Forking, and squash PR title settings
- **Repository permissions** - Team and user access with specific permission levels

**Use cases:**

- Applying configuration after upgrading to GitHub Pro
- Configuring repositories created before configuration support was available
- Manually updating repository settings without recreating the repository
- Bulk applying settings to multiple repositories via scripting

**Examples:**

```bash
# Auto-detect type from GitHub repository topics
repo-update-config ~/repos/my-service

# Explicitly specify repository type
repo-update-config ~/repos/my-docs --type documentation
```

**Configuration per type:**
Each repository type defines its configuration in `tools/config/repo-types.yaml`:

- `allowedMergeTypes` - Which merge strategies are permitted
- `rulesetConfigFile` - Path to GitHub ruleset JSON (null = skip)
- `isTemplate` - Whether to mark as a template repository
- `docs_first` - Content-is-the-product repository: commits use the explicit bump types `major`/`minor`/`patch` to drive releases there (plain `docs:` triggers no release). Read via `get_type_docs_first` (default: false); classification guidelines in [Commit Conventions](Commit-Conventions.md#docs-first-repos)
- `deletePRBranchOnMerge` - Whether to delete PR branches after merge (true/false)
- `hasWiki` - Enable/disable Wiki feature (default: false, true for documentation)
- `hasIssues` - Enable/disable Issues tab (default: true, false for templates)
- `hasDiscussions` - Enable GitHub Discussions (default: false)
- `hasProjects` - Enable Projects tab visibility (default: false) — Controls tab in repo; issues can be added to projects regardless
- `allowAutoMerge` - Allow auto-merge on PRs for automation (default: true)
- `allowUpdateBranch` - Show "Update branch" button on PRs (default: true)
- `allowForking` - Allow others to fork the repository (default: true for templates, false otherwise)
- `squashMergeCommitTitle` - Squash commit title format: PR_TITLE or COMMIT_OR_PR_TITLE (default: PR_TITLE)
- `squashMergeCommitMessage` - Squash commit message body: PR_BODY, COMMIT_MESSAGES, or BLANK (default: COMMIT_MESSAGES)
- `access` - List of teams or users with their permission levels (optional, no default)
  - Each entry contains:
    - `name`: Team or user name (GitHub team slug or username)
    - `type`: `team` or `user` (default: team)
    - `permission`: GitHub repository permission level:
      - `pull` (Read) - Can pull/clone, open issues, and comment
      - `triage` (Triage) - Can manage issues/PRs without write access
      - `push` (Write) - Can push, create branches, and manage issues/PRs
      - `maintain` (Maintain) - Push + manage releases and some settings
      - `admin` (Admin) - Full access including settings, webhooks, and team management

**Example access configuration in repo-types.yaml:**

```yaml
service:
  # ... other settings ...
  access:
    - name: Engineering
      type: team
      permission: push
    - name: DevOps
      type: team
      permission: admin
    - name: john-doe
      type: user
      permission: pull
```

**Dependencies:**

- `tools/lib/domain/repos/types.ts` (shared TS module)

**Related:** See [repo-create](#repo-create) for initial repository creation details, and [Repo Creation Standards (repo-create.ts)](./Forking.md#repo-creation-standards-repo-create) in the Forking Guide for configuration options.

## Fork Tooling

Three tools keep a soft fork connected to its upstream (see [Keeping a Soft Fork in Sync and Contributing Back](./Forking.md#keeping-a-soft-fork-in-sync-and-contributing-back)). They are ordinary tools on `PATH`, and manual-only: none runs on its own.

- **`fork-setup`**: one-time, local setup of the fetch-only `upstream` remote from `[fork]` config; `--dry-run` previews the remote and the push guard.
- **`fork-sync`**: fetches upstream, reports divergence (upstream commits that look like your own work coming back — adoption link, Change-Id, patch-id, or subject), and with `--replay` applies upstream's new commits on top of the branch (`--dry-run --replay` prints the pick plan): upstream commits whose Change-Id already exists on the branch are skipped, the rest are cherry-picked in order, so branch SHAs never move and origin pushes stay fast-forwards. Divergent twins are named, not silently absorbed; cleanly applied commits are auto-recorded in the adoption map; fork-owned surface state is snapshotted to `refs/fork-sync/snapshot` before the picks and verified after (touched paths are surfaced for review — never auto-merged). `--link <local> <upstream>` (or `--link=<local> <upstream>`) records a confirmed pre-Change-Id twin pair, and `--unlink <sha>` / `--unlink=<sha>` removes the pairs naming a commit; `--rebase` is refused with a message that it was renamed `--replay`; `--version` and `--help` need no configured workspace; `--propose-links` ranks candidates and asks for confirmation. Applying requires confirmation (TTY prompt or `--yes`; non-TTY fails closed). `--drift` prints the standing drift inventory — fork-local edits on upstream-stable paths (per `tools/config/fork-surfaces.yml`), the maintenance cost the fork carries. Origin rewrites require `--rewrite-origin` and confirmation. See [Forking.md](Forking.md#the-intended-loop-export-promptly-sync-promptly).
- **`fork-export`**: exports an upstream-based, linear commit range as a bundle, patch series, or both (a range with a merge commit is refused with guidance); optionally applies it to a sibling clone of the upstream repository without upstream credentials. Exported copies are stamped with `Change-Id` (generated when absent) and `Exported-From: <fork-side-sha>`; a conflict-resolved copy is declared `Fork-Adapted: yes`. Re-runs detect what the target already has and refuse to re-apply it. `--dry-run` previews the operation. See [Forking.md](Forking.md#the-intended-loop-export-promptly-sync-promptly).
- **`lint-documentation`**: runs markdownlint over `README.md` and `docs/**/*.md` (`--fix` applies autofixes) and checks that relative `.md` links resolve — including in-page anchors (GitHub-style heading fragments). Run before committing docs changes; CI runs it on changed docs.

## Manual-Only Validation

These are run by hand and are intentionally **not on `PATH`**; invoke by explicit path.

- **`tools/lib/providers/azure/smoke.ts`** — Azure provider live validation, two opt-in tiers:
  `AZURE_SMOKE=1` (read-only: auth, repo list, WIQL, work-item view, PR list)
  and `AZURE_SMOKE=write` (destructive: create/comment/close work items,
  create and rebase-merge a PR — disposable test project only). Manual-only;
  never in tests or CI; output is token-redacted by design. See
  [azure/SMOKE.md](../tools/lib/providers/azure/SMOKE.md).
- **`tools/lib/providers/github/smoke.ts`** — GitHub provider live validation: creates a throwaway
  repository, project and team in a test organisation, exercises every contract verb family
  (issues, pull requests, projects, pipelines, organisation rulesets, repositories) and deletes
  what it created. Opt-in with `GITHUB_SMOKE=write`, `GITHUB_SMOKE_OWNER` and
  `GITHUB_SMOKE_CONFIRM`; manual-only, never in tests or CI. See
  [github/SMOKE.md](../tools/lib/providers/github/SMOKE.md) (and
  [azure/SMOKE.md](../tools/lib/providers/azure/SMOKE.md) for the Azure suite).

## Shared Libraries

Reusable TypeScript modules in `tools/lib/` that provide common functionality for tools. They are imported (never executed), organized by role: `core/` (runtime seams), `ui/` (prompts and panels), `providers/` (the provider facade) and `domain/` (headless logic). The full module catalog and the dependency direction between layers are in [Tooling Standards](./Tooling-Standards.md#typescript-standards). The sections below document the libraries behind the repo-cache, desktop-menu and C# dependency tools.

### `lib/domain/cs/dependency-graph.ts` (repo cache and dependency index)

Maintains shallow clones of all organization repositories in a local cache directory, and builds and queries a reverse dependency graph across the cached C# repositories. Used by `repo-cache-update`, `cs-dependencies-trace` and `cs-dependencies-update-wizard`.

**Configuration:**

- `[organization] org` in `devenv.config`: the organization whose repositories are cached (identity resolves through `providerOrgGet`; authentication resolves through the provider keychain, with no token env var).
- `CS_DEP_ORG_PREFIX` (default: `[nuget] package_prefix` in `devenv.config`; no built-in value): only packages matching this prefix are considered org-internal. The index is not built until one of them is set.
- `REPO_CACHE_DIR`: the cache root (default `tools/cache/repo_cache`).
- The index lives in `.index/` inside the cache root.

**Public functions:**

- `refreshRepoCache()`: clones or updates every organization repository into the cache as a shallow single-branch clone, then writes the `.cache_timestamp` staleness file. Resolves to `0` when all repositories were cached, `2` for a partial failure (some repositories failed), `1` for a complete failure (no repositories found, missing credentials, or every clone failed). A cached clone with uncommitted changes is left untouched and counted as failed, so refreshing never discards work.
- `isIndexStale()`: whether `.cache_timestamp` is newer than `.index_timestamp` (a rebuild is needed).
- `buildDependencyIndex()`: scans the cached repositories' `src/**/*.csproj` files (skipping `test/` and `tests/` directories) and writes three TSV index files: `package_to_repo.tsv` (package to producing repo), `repo_packages.tsv` (packages each repo publishes) and `repo_dependencies.tsv` (org-internal package references per repo, excluding self-references and third-party packages).
- `ensureDependencyIndex()`: builds the index only when `isIndexStale()` says it is outdated.
- `listRepoPackages(repoName)` and `listRepoDependencies(repoName)`: the packages a repository produces, and the org-internal packages it consumes.
- `getReverseDependencyTree(repoNameOrPath)`: a breadth-first traversal returning every repository that depends on the given one, directly or transitively. Each row carries the depth (0 = direct dependent), the dependent repo, the package reference, the version and the full dependency chain.
- `getTopologicalGenerations()`: repositories grouped into dependency generations (Kahn's algorithm).

**Example:**

```ts
import { ensureDependencyIndex, getReverseDependencyTree, refreshRepoCache } from "../lib/domain/cs/dependency-graph.ts";

await refreshRepoCache();
ensureDependencyIndex();

// Direct dependents only
const direct = getReverseDependencyTree("<your-library>").filter((row) => row.depth === 0);
```

### `lib/domain/desktop-menu.ts`

Idempotent functions for managing the Fluxbox desktop application menu. Used by `devenv-desktop-menu-add-shortcut` and `devenv-desktop-menu-add-folder`; an install-extras step that needs a menu entry calls those two tools.

**Public functions:**

- `menuFile()`: the path to the Fluxbox menu file. Respects the `FLUXBOX_MENU` environment variable; defaults to `~/.fluxbox/menu`.
- `shortcutExists(menu, label)` and `folderExists(menu, name)`: whether an `[exec]` entry or a `[submenu]` entry with that label or name exists.
- `addShortcut(menu, label, command, folder = "")`: adds an `[exec]` entry. Silently skips if a shortcut with the same label already exists. Throws if the menu file or a named folder does not exist.
- `addFolder(menu, name, parent = "")`: adds a `[submenu]` / `[end]` block. Silently skips if a folder with the same name already exists. Throws if the menu file or a named parent does not exist.
- `escapeMenuText(text)`: escapes the menu syntax delimiters (backslash, parentheses, braces) in user text, and rejects text containing a line break. Labels, names and commands pass through it before they are written.

**Example, from an install step:**

```bash
devenv-desktop-menu-add-folder "Databases"
devenv-desktop-menu-add-shortcut "MongoDB Compass" "mongodb-compass" "Databases"
```

**Menu format reference:**

```text
[begin] (  Application Menu  )
    [exec] (Label) { command } <>
    [submenu] (Folder Name) {}
        [exec] (Label) { command } <>
    [end]
    [config]     (Configuration)
    [workspaces] (Workspaces)
[end]
```

**Environment variables:**

- `FLUXBOX_MENU`: Override the default menu file path (`~/.fluxbox/menu`)

## Bash Functions and Aliases

The following convenience aliases are available in the dev container:

**Navigation:**

- `devenv` - Navigate to devenv root
- `playground` - Navigate to playground directory
- `repos` - Navigate to repos directory

**Repository Management:**

- `repo-get` - Clone/navigate to repository
- `repo-update-all` - Update all repositories in parallel
- `repo-get-web-url` - Get the web URL for the current repository

**Pull Request Management:**

- `pr-create` - Create PR for merging
- `pr-create-for-review` - Create draft review PR
- `pr-get-merge-link` - Get PR link for current branch
- `pr-get-review-link` - Get review PR link
- `pr-cleanup-review-branches` - Cleanup old review branches

**Issue Management:**

- `issue-create` - Create new issue
- `issue-list` - List/filter issues
- `issue-search` - Keyword search across titles and bodies
- `issue-update` - Update issue fields
- `issue-close` - Close or reopen issues
- `issue-select` - Interactive issue selection with a terminal picker
- `issue-triage` - Interactive backlog metadata wizard

**Project Management:**

- `project-add-issue` - Add issues to projects
- `project-update-issue` - Update issue fields in projects

**Development Tools:**

- `editor` - Open files in VS Code (blocking) with fallback editor support
- `tooling-create-script` - Create new script from template
- `lint-scripts` - Validate shell scripts with shellcheck
- `repo-version-list` - List version tags

**Containers & Services:**

- `dependencies-up` / `dependencies-down` - Start/stop dependencies
- `server-run-sql` / `server-run-smb` - Start development servers
- `ci-build-local` - Build a repo's container image into local Docker cache

**Database:**

- `mongo-backup-server` / `mongo-restore-server` - MongoDB backup/restore

**NuGet:**

- `cs-nuget-clear-local` / `cs-nuget-publish-local` - Local NuGet development

**Desktop Environment:**

- `devenv-desktop-menu-add-shortcut` - Add a shortcut to the Fluxbox desktop menu
- `devenv-desktop-menu-add-folder` - Add a folder to the Fluxbox desktop menu

**Utilities:**

- `get-public-ip` - Get current public IP
- `key-update-provider` - Rotate the git provider credential (keychain import + credential helper)
- `key-update-tailscale` - Update Tailscale auth key
- `key-update-do` - Update Digital Ocean API token
- `devenv-vscode-fix-sockets` - Fix stale VS Code IPC sockets (see [Troubleshooting](./Dev-container-environment.md#troubleshooting))

## Markdown and Plan Tools

Tools for working with markdown documents, specifically plans
produced through the planning workflow (for example via
`devenv-plan`).

### `markdown-plan-complete-task`

Marks one or more task checkboxes in a plan as complete (`[x]`)
or incomplete (`[ ]`). Tasks are identified by their dotted number as they
appear in the plan (e.g. `2.3` or `1.4.2`).

**Usage:**

```bash
markdown-plan-complete-task [OPTIONS] TASK_NUMBER... [PLAN_FILE]
```

**Arguments:**

- `TASK_NUMBER...`: One or more dotted task numbers to update (`X.Y` or `X.Y.Z`).
  Multiple task numbers can be supplied in a single invocation.
- `PLAN_FILE`: Path to the markdown plan file. Defaults to the `Plan-*.md`
  file found in `.local-artifacts/`, then in the current directory. When that
  directory holds several plans the tool refuses (exit 2) and lists them;
  name the file explicitly.
  Positional arguments are classified automatically: anything matching the
  `X.Y` / `X.Y.Z` pattern is treated as a task number; everything else is
  treated as the plan file. The plan file may appear anywhere in the argument
  list — before, after, or mixed in with task numbers.

**Options:**

- `--uncomplete`: Mark the tasks as incomplete (`[ ]`) instead of complete (`[x]`)
- `-V, --verbose`: Enable verbose output

**Examples:**

```bash
# Mark task 2.3 complete in the auto-detected plan file
markdown-plan-complete-task 2.3

# Mark several tasks complete at once
markdown-plan-complete-task 1.1 1.2 1.3

# Mark tasks complete in a specific plan file (file can appear anywhere)
markdown-plan-complete-task 1.1 1.2 /path/to/Plan-001.md

# Undo — mark tasks as incomplete
markdown-plan-complete-task --uncomplete 2.3 2.4
```

**Notes:**

- After updating all checkboxes, the tool prints overall plan progress
  (completed / total tasks) once.
- If any individual task fails (e.g. task number not found), the tool reports
  it and continues with the remaining tasks, then exits non-zero.
- The operation is idempotent: marking an already-complete task as complete
  (or incomplete as incomplete) produces no error and no file change.
- Relies on `tools/lib/domain/markdown.ts` for all checkbox manipulation logic.

---

### `markdown-plan-complete-ac`

Marks one or more acceptance-criteria checkboxes as complete (`[x]`) or
incomplete (`[ ]`). AC items are identified by their number, e.g. `AC-3` or
`AC-1.2`, as they appear in specifications or plan documents.

**Usage:**

```bash
markdown-plan-complete-ac [OPTIONS] AC_NUMBER... [FILE]
```

**Arguments:**

- `AC_NUMBER...`: One or more AC numbers to update (`AC-N`, `AC-N.N`, `AC-N.N.N`).
- `FILE`: Path to the markdown file. Defaults to the `Plan-*.md`
  (or `Implementation_plan-*.md`) found in `.local-artifacts/`, then in
  the current directory; several plans in that directory is an error (exit 2) —
  plans are the only artifact with checkable ACs.
  Other files (e.g. `Specifications-*.md`) are updated only when named
  explicitly. As with `markdown-plan-complete-task`,
  the file may appear anywhere among the arguments.

**Options:**

- `--uncomplete`: Mark the criteria as incomplete (`[ ]`) instead of complete (`[x]`)
- `-V, --verbose`: Enable verbose output

**Examples:**

```bash
# Mark AC-3 complete in the auto-detected specifications file
markdown-plan-complete-ac AC-3

# Mark several criteria complete at once
markdown-plan-complete-ac AC-1 AC-2 AC-3

# Mark criteria complete in a specific file
markdown-plan-complete-ac AC-1 AC-2 /path/to/Specifications-001.md

# Undo — mark criteria as incomplete
markdown-plan-complete-ac --uncomplete AC-3 AC-4
```

**AC item format:**

```markdown
- [ ] **AC-3** Criterion text *(inferred)* — *revised: brief note*
- [x] **AC-1.2** Sub-criterion already verified
```

**Notes:**

- After updating all checkboxes, the tool prints overall AC progress
  (completed / total criteria) once.
- Partial failures are reported individually; the tool exits non-zero if any
  criterion could not be updated.
- Relies on `tools/lib/domain/markdown.ts` for all checkbox manipulation logic.

### `plan-parse`

Parse and validate plan files (JSON output). Modes: `--summary` (task counts,
weighted progress percentage, AC/question tallies), `--census` (per-phase task
counts), `--anchors` (forward-comment anchor file list), `--lint` (structural
validation), and `--require-header` (artifact header must be present and
well-formed).

**Usage:**

```bash
plan-parse <PLAN_FILE> --summary | --census | --anchors | --lint [--require-header]
```

**Notes:**

- `--summary` output includes `tasks_done/open/total`, `pct_tasks`, and
  `weighted` progress; the `Progress:` snapshot line uses these values.
- `--lint` errors block issue-artifact upserts until fixed.
- Progress values are computed from the file, never hand-counted.

**Plan grammar** (shared by `plan-parse`, `markdown-plan-complete-task`,
`markdown-plan-complete-ac`, `roadmap-parse` and `tools/lib/domain/markdown.ts`):

- A checkbox item is `- [ ]`, `- [x]` or `- [X]`; completion is read from the
  checkbox position only, never from a `[x]` inside the item text.
- Task: the item text starts with a dotted numeric id (`2.1`, `2.1.1`), bold or
  not. Tasks are classified before ACs, so a task that mentions an AC stays a
  task. `plan-parse` counts tasks only under a `Phase N` heading.
- AC: the item text starts with `AC-N[.N...]`, optionally after an
  `<a id="ac-N"></a>` anchor and bold. `AC-1.2` is an AC of its own, never
  `AC-1`; an AC mentioned mid-line does not make the item an AC.
- Only top-level items (no indentation) are counted by `plan-parse` and the
  progress lines; nested bullets are detail.
- `--anchors` keeps the full extension (`.json`, `.csproj`, `.yaml`).

### `roadmap-parse`

Emits per-step JSON (`step`, `phase`, `title`, `status`, `issues`, `progress`, `dependencies`, `plan_file`) for a roadmap markdown file. `status` is passed through as written.

```bash
roadmap-parse ROADMAP_FILE [--plan-dir DIR] [--plan-file FILE]... [--org ORG] [--repo REPO]
```

**Notes:**

- A roadmap with CRLF line endings is read exactly like its LF twin.
- Issue references are `org/repo#N` (used as written), `repo#N` (gets the organisation) and bare `#N` (gets `--repo` and the organisation when `--repo` is given, otherwise it is reported as `UNRESOLVED:#N`).
- The organisation comes from `--org`, then the configured organisation (`[organization] org` in `devenv.config`), then the first `org/repo#N` reference in the roadmap.
- Only a `repo#N` reference or a `--repo` reference needs an organisation. If one exists and none resolves, the tool exits 2 and names `--org`; a roadmap that needs no organisation parses without one.

---

### `spec-dependency-check`

Validates the `SPEC-NNN` dependency graph of `Specifications-*.md`. Reads
`Dependencies:` and `Depends on:` lines (bold or plain; `None`, markdown links
and a cross-doc `(File.md)` suffix are understood), compares `Group:` values
numerically (`P2` before `P10`), and reports `unknown`, `duplicate`, `cycle`
and `group-order` errors as JSON.

### `devenv-marker-check`

Deterministic DEVENV-marker and AC-comment scanning for cleanup gates and
discovery sweeps. Gate mode fails when plan-bounded FIXME markers remain;
cross-plan TODO markers are sanctioned to ship;
`--todo-report` lists scoped TODOs and warns about missing discharge
conditions; `--all` audits every marker form.

**Usage:**

```bash
devenv-marker-check [PATH...] [--all] [--ac] [--todo-report] [--marker REGEX] [--require]
```

See the DEVENV marker spec in `copilot/copilot-instructions.md` for the marker
taxonomy.

### `next-id`

Resolve the next free numeric identifier for filenames (`Plan-issue-42-{N}.md`
suffixes) and in-document ID sequences (`SPEC-NNN` tokens).

**Usage:**

```bash
next-id --pattern 'Plan-issue-42-{N}.md' [--dir DIR] [--width W] [--filename]
next-id --file DOC.md --prefix 'SPEC-' [--full]
```

### `config-read`

Read one value from `devenv.config` by section and key (env-expanded, with an
optional default). Gives skills and scripts a deterministic way to read
org-configurable settings.

**Usage:**

```bash
config-read SECTION KEY [DEFAULT] [--config FILE]
```

Missing arguments and other parse errors exit 2; a config file that cannot be found exits 1.

**Examples:**

```bash
config-read copilot engineering_repo      # full clone URL used by the bootstrap import
config-read copilot knowledge_repo
config-read workflows status_workflow
```

See [Knowledge & Engineering Patterns](./Knowledge-and-Engineering-Patterns.md)
for the `engineering_repo` setting. The knowledge repo also carries a
`candidates/` area — emerging general practices and patterns captured via the
[knowledge extraction protocol](../copilot/skills/common/references/knowledge-extraction-protocol.md);
they are read with skepticism and graduate to the engineering repo only via
issue/PR.

---

## Usage Notes

- Most tools require no identity exports: org/user resolve via the provider accessors from devenv.config `[organization]` (credentials resolve keychain-first — no token env var)
- Git authentication flows through the provider's credential helper over HTTPS; no embedded tokens
- Tools automatically handle error conditions and provide helpful error messages
- Scripts follow consistent naming conventions (prefix-based: `repo-`, `pr-`, `git-`, `issue-`, `artifact-`, `pipelines-`)
- Many tools are designed to work within the development container environment

## Environment Variables

The following environment variables should be configured for full functionality:

- `GH_TOKEN`: not required day-to-day — tokens live in the keychain, imported via `key-update-provider` or the provider auth seam. When you mint a token (bootstrap provisioning or rotation), give it these scopes:
  - `repo` (full control of private repositories)
  - `workflow` (update CI pipeline workflows)
  - `read:packages` (download packages from the provider package registry)
  - `read:org` (read org and team membership, read org projects)
  - `project` (full control of projects)
- `DEVENV_ROOT`: Path to devenv root directory (auto-set)
- `DEVENV_TOOLS`: Path to the `tools/` directory (auto-set; TS tools under `tools/ts/`, libs under `tools/lib/`)
- `DEVENV_REPO`: Canonical (and only) repo target for repo-scoped wrappers,
  `owner/repo` form. Skill sessions env-prefix every call with it (see the
  wrapper protocol reference); cwd fallback serves interactive human use. See
  [Tooling Standards](./Tooling-Standards.md) for the full resolution order.
- `devenv`: Lowercase alias for DEVENV_ROOT (auto-set)
- `SSH_AUTH_SOCK`: SSH agent socket (auto-configured with host forwarding)

For more information about setting up the development environment, see [Dev-container-environment.md](./Dev-container-environment.md).

## See Also

- [Tooling Standards](./Tooling-Standards.md) - Code style and conventions for the tools suite
- [Workflow Guide](./Workflow.md) - Delivery methodology and working agreements
- [Function Naming Conventions](./Function-Naming-Conventions.md) - Naming standards
