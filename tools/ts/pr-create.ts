#!/usr/bin/env node
// pr-create.ts - Create a GitHub pull request from the current branch.
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Port of pr-create.sh: the git invocation sequences (branch inspection, the
// --at merge-branch dance, push) are preserved exactly — no "improvements".
// Scratchpad guard retained.

import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";

import { EXIT_API_FAILURE, EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { gitCheck, gitInherit, wipRangeGuard } from "../lib/core/git.ts";
import { toolCli } from "../lib/core/cli.ts";
import { conventionalCommitsOk } from "../lib/core/commit-format.ts";
import { checkTargetRepo, providerRepoTarget, requireRepoTarget, ghApi } from "../lib/providers/provider-core.ts";
import { prsCreate, prsList } from "../lib/providers/facade/prs.ts";
import { issuesView, issuesLabelEnsure } from "../lib/providers/facade/issues.ts";
import { extractUrl, remoteToSpec } from "../lib/providers/facade/urls.ts";
import { signalPrEventsForPr } from "../lib/domain/events.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "pr-create.ts");

function usage(): never {
  // Help is requested output: stdout, exit 0.
  console.log(`Usage: ${SCRIPT_NAME} [<title>] [options]`);
  console.log("");
  console.log("Options:");
  console.log("  --issue <number>     Issue number this PR addresses. Omitted: inferred from the branch name ([<type>/]<issue>-<slug>); if not inferable, an error asks for --issue or --no-issue");
  console.log("  --no-issue           Explicitly indicate this PR has no associated issue");
  console.log("  <title>              PR title. Optional for non-squash repos without a message (the issue title is used); required for squash-merge repos, where it must follow Conventional Commits");
  console.log("  --base <branch>      Target branch for PR (default: repository's default branch)");
  console.log("  --repo-dir <path>    Repository directory (default: current)");
  console.log("  --branch <name>      Source branch for PR (default: current branch)");
  console.log("  --body <text>        PR body text");
  console.log("  --body-file <file>   Read PR body from a file");
  console.log("  --draft              Create as draft");
  console.log("  --reviewer <handle>  Add a reviewer (can be repeated)");
  console.log("  --assignee <handle>  Add an assignee (default: @me)");
  console.log("  --label <name>       Add a label (can be repeated)");
  console.log("  --at <hash-or-title> Partial-branch mode: open the PR from a merge branch created at the chosen commit");
  console.log("  -h, --help           Show this help message and exit");
  console.log("  -v, --version        Show version information and exit");
  console.log("  -V, --verbose        Enable verbose output (debug logging)");
  console.log("  --devenv             Safety override for devenv-repo operations");
  process.exit(0);
}

function git(args: string[], opts: { capture?: boolean; quiet?: boolean } = {}): { ok: boolean; out: string } {
  // quiet: output captured and dropped — callers read only .ok (the old
  // all-ignore stdio shape's contract for these call sites).
  const r = gitCheck(null, args);
  if (opts.capture || opts.quiet) {
    return { ok: r.ok, out: opts.capture ? r.out.trim() : "" };
  }
  return gitInherit(null, args);
}

/**
 * The ref whose commits a PR from BRANCH carries: the remote-tracking ref when
 * the branch is already on origin (what the provider will show), else the
 * local branch (about to be pushed).
 */
function prHeadRef(repoDir: string, branch: string): string {
  const remote = `origin/${branch}`;
  return gitCheck(repoDir, ["show-ref", "--verify", "--quiet", `refs/remotes/${remote}`]).ok ? remote : branch;
}

/**
 * Refresh origin/<branch> so the WIP scan sees what the remote holds now (a WIP
 * pushed from another clone is invisible while the tracking ref is stale).
 * A branch that is not on the remote yet is fine (ls-remote exits 2 for "no
 * matching refs"); any other failure to ask or to fetch blocks, because the
 * scan would otherwise run against stale data.
 */
function refreshRemoteBranch(repoDir: string, branch: string): boolean {
  const remote = spawnSync("git", ["-C", repoDir, "ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`], { encoding: "utf8" });
  if (remote.status === 2) return true;
  if (remote.status !== 0) {
    logError(`Could not refresh origin/${branch} (git ls-remote failed): ${(remote.stderr ?? "").trim()}`);
    logError("PR creation rejected — the WIP scan needs the remote's current state.");
    return false;
  }
  const fetched = gitCheck(repoDir, ["fetch", "--quiet", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  if (!fetched.ok) {
    logError(`Could not refresh origin/${branch} (git fetch failed): ${fetched.err.trim()}`);
    logError("PR creation rejected — the WIP scan needs the remote's current state.");
    return false;
  }
  return true;
}

/**
 * Fail-closed WIP gate over BASE..HEAD_REF: returns false (after printing why)
 * when the range holds a WIP: commit or cannot be scanned at all.
 */
function wipGuard(repoDir: string, baseRef: string, headRef: string, context: string): boolean {
  const range = `${baseRef}..${headRef}`;
  const guard = wipRangeGuard(repoDir, range);
  if (guard.ok) return true;
  if (guard.offenders.length === 0) {
    logError(`Could not scan ${context} (${range}) for WIP: commits — PR creation rejected.`);
    return false;
  }
  logError(`WIP: commits present in ${context} (${range}) — merge rejected.`);
  logError("Offending commits:");
  for (const line of guard.offenders) logError(`  ${line}`);
  logError("Recovery: git-unwip (soft-reset past the WIP) or finish the work into real commits.");
  return false;
}

async function main(argv: string[]): Promise<number> {
  let prTitle = "";
  let issueNumber = "";
  let noIssue = false;
  let repoDir = process.cwd();
  let targetBranch = "";
  let sourceBranch = "";
  let draft = false;
  let bodyFile = "";
  let prBody = "";
  let atCommit = "";
  const reviewers: string[] = [];
  const assignees: string[] = ["@me"];
  const labels: string[] = [];
  let devenvFlag = false;

  try {
    const cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      noDryRun: true,
      options: {
        issue: { type: "string" },
        "no-issue": { type: "boolean", default: false },
        "repo-dir": { type: "string" },
        branch: { type: "string" },
        base: { type: "string" },
        body: { type: "string" },
        "body-file": { type: "string" },
        draft: { type: "boolean", default: false },
        reviewer: { type: "string", multiple: true },
        assignee: { type: "string", multiple: true },
        label: { type: "string", multiple: true },
        at: { type: "string" },
      },
    });
    if (cli.common.help) usage();
    const values = cli.values as Record<string, string | boolean | string[] | undefined>;
    issueNumber = ((values["issue"] as string | undefined) ?? "");
    noIssue = values["no-issue"] === true;
    const repoDirValue = values["repo-dir"];
    if (repoDirValue !== undefined) repoDir = String(repoDirValue);
    sourceBranch = ((values["branch"] as string | undefined) ?? "");
    targetBranch = ((values["base"] as string | undefined) ?? "");
    prBody = ((values["body"] as string | undefined) ?? "");
    bodyFile = ((values["body-file"] as string | undefined) ?? "");
    draft = values["draft"] === true;
    reviewers.push(...((values["reviewer"] ?? []) as string[]));
    // Bash parity: --assignee APPENDS to the @me default (ASSIGNEES+=("$2")),
    // so an extra assignee never drops the author from the assignment.
    assignees.push(...((values["assignee"] ?? []) as string[]));
    labels.push(...((values["label"] ?? []) as string[]));
    atCommit = ((values["at"] as string | undefined) ?? "");
    if (cli.positionals.length > 1) {
      logError(`Unexpected extra arguments: ${cli.positionals.join(" ")}`);
      return EXIT_MISUSE;
    }
    prTitle = cli.positionals[0] ?? "";
    devenvFlag = cli.common.devenv;
  } catch (err) {
    logError(errorMessage(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  // Scratchpad refusal (two layers, scratchpad.bash's contract): PR creation
  // is a push-path operation — blocked while a scratchpad is active in this
  // repo, and blocked on any scratchpad/* branch (defense-in-depth: scratch
  // commits bypass hooks and carry no Devenv-Action/Change-Id trailers; they
  // must never reach shared history).
  const scratchBranch = gitCheck(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branchName = scratchBranch.out.trim();
  const stateRef = gitCheck(repoDir, ["show-ref", "--verify", "--quiet", "refs/scratchpad/state"]);
  const onScratchBranch = /^scratchpad\//.test(branchName);
  if (stateRef.ok || onScratchBranch) {
    console.error(
      "Error: pr-create push is blocked on a scratchpad branch — scratch commits bypass hooks and carry no Devenv-Action/Change-Id trailers; they must never reach shared history.",
    );
    console.error("Salvage to the base branch: repo-scratchpad promote <sha> · or leave the mode: repo-scratchpad exit");
    return EXIT_CONFLICT;
  }

  // Issue inference: leading `<number>-` of the branch leaf, accepted only
  // after the issue is confirmed to exist (below).
  let issueInferred = false;
  if (issueNumber === "" && !noIssue) {
    const leaf = branchName.includes("/") ? (branchName.split("/").pop() ?? "") : branchName;
    const m = /^([0-9]+)-/.exec(leaf);
    if (m?.[1] === undefined) {
      console.error(`Error: No issue passed (--issue) and none inferable from branch name '${branchName || "<none>"}' — pass --issue <number> or --no-issue.`);
      return EXIT_MISUSE;
    }
    issueNumber = m[1];
    issueInferred = true;
    console.error(`Inferred issue #${issueNumber} from branch '${branchName}'.`);
  }

  if (bodyFile !== "") {
    if (!existsSync(bodyFile)) {
      console.error(`Error: body file not found: ${bodyFile}`);
      return EXIT_MISUSE;
    }
    prBody = readFileSync(bodyFile, "utf8");
  }

  if (issueNumber !== "" && noIssue) {
    console.error("Error: Cannot specify both --issue and --no-issue.");
    return EXIT_MISUSE;
  }
  if (issueNumber !== "" && !/^[1-9][0-9]*$/.test(issueNumber)) {
    console.error("Error: Issue number must be numeric and positive.");
    return EXIT_MISUSE;
  }

  // Repo spec: origin remote through the provider URL seam, else the
  // provider resolver. The house --devenv flag gates devenv-repo operations
  // (pr-create pushes branches; the safety override must have real meaning).
  checkTargetRepo(devenvFlag);
  const originUrl = gitCheck(repoDir, ["remote", "get-url", "origin"]);
  let repoSpec = originUrl.ok ? ((await remoteToSpec(originUrl.out.trim())) ?? "") : "";
  if (repoSpec === "") repoSpec = requireRepoTarget(providerRepoTarget(""), "pr-create", "pr");

  // allowSquashMerge rides the provider repos seam (jq kept in argv: the
  // field decision uses gh's own projection, matching the bash-era shape).
  const squashEnabled = async (): Promise<boolean> => {
    if (repoSpec === "") return false;
    const r = await ghApi(["repo", "view", repoSpec, "--json", "allowSquashMerge", "-q", ".allowSquashMerge"], { tolerateFailure: true });
    return r.status === 0 && r.stdout.trim() === "true";
  };

  // Issue title (used when no PR title was given).
  let issueTitle = "";
  let issueLookupOk = false;
  if (issueNumber !== "" && repoSpec !== "") {
    try {
      issueTitle = (await issuesView(repoSpec, Number.parseInt(issueNumber, 10), { json: "title", jq: ".title" })).trim();
      issueLookupOk = true;
    } catch {
      issueTitle = "";
    }
  }
  if (issueInferred && !issueLookupOk) {
    console.error(`Error: branch '${branchName}' suggests issue #${issueNumber}, but that issue could not be found — pass --issue <number> or --no-issue.`);
    return EXIT_GENERAL_ERROR;
  }

  if (prTitle === "") {
    if (await squashEnabled()) {
      console.error("Error: A PR title is required when the repository uses squash merges (the title becomes the commit subject).");
      return EXIT_GENERAL_ERROR;
    }
    if (issueTitle === "") {
      console.error("Error: No PR title given and the issue title could not be fetched — pass a title explicitly.");
      return EXIT_GENERAL_ERROR;
    }
    prTitle = issueTitle;
  }

  if (await squashEnabled()) {
    if (!conventionalCommitsOk(prTitle)) {
      console.error("Error: PR title must follow Conventional Commits (e.g., feat(api): add feature) — this repository uses squash merges, so the title becomes the commit subject.");
      return EXIT_GENERAL_ERROR;
    }
  }

  const inside = gitCheck(repoDir, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) {
    console.error(`Directory ${repoDir} is not a git repository.`);
    return EXIT_GENERAL_ERROR;
  }

  // Plan-files warning (working copies shouldn't silently become PR bodies).
  const artifactsDir = `${repoDir}/.local-artifacts`;
  if (existsSync(artifactsDir)) {
    const planFiles = readdirSync(artifactsDir)
      .filter((f) => /^Plan-.*\.md$/.test(f) || /^Implementation_plan-.*\.md$/.test(f))
      .sort();
    if (planFiles.length > 0) {
      console.error("Warning: Implementation plan file(s) found in .local-artifacts/:");
      for (const f of planFiles) console.error(`  ${f}`);
      console.error("Plan files are working copies; consider syncing their content to the associated issue and removing them when convenient.");
    }
  }

  // Clean-tree gate (git diff-index --quiet HEAD --).
  const dirty = gitCheck(repoDir, ["diff-index", "--quiet", "HEAD", "--"]);
  if (!dirty.ok) {
    console.error("There are uncommitted or staged changes.");
    return EXIT_GENERAL_ERROR;
  }

  const current = sourceBranch !== "" ? sourceBranch : branchName;
  if (current.startsWith("review/")) {
    console.error("This script cannot be run on a review/* branch.");
    return EXIT_GENERAL_ERROR;
  }

  if (targetBranch === "") {
    const ref = gitCheck(repoDir, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    const refName = ref.out.trim().replace(/^origin\//, "");
    targetBranch = refName !== "" ? refName : git(["-C", repoDir, "show-ref", "--quiet", "refs/remotes/origin/main"], { capture: true }).ok ? "main" : "master";
  }

  if (atCommit === "") {
    if (!refreshRemoteBranch(repoDir, current)) return EXIT_GENERAL_ERROR;
    if (!wipGuard(repoDir, `origin/${targetBranch}`, prHeadRef(repoDir, current), "PR creation range")) {
      return EXIT_GENERAL_ERROR;
    }
  }

  if (atCommit !== "") {
    if (atCommit === "pick") {
      const commits = gitCheck(repoDir, ["log", `${targetBranch}..${current}`, "--format=%h%x09%s"]);
      const lines = commits.out.split("\n").filter((l) => l.trim() !== "");
      if (lines.length === 0) {
        console.error(`No commits found in ${targetBranch}..${current} to pick from.`);
        return EXIT_GENERAL_ERROR;
      }
      console.error("Non-interactive mode — pick a commit:");
      lines.forEach((l, i) => console.error(`  ${i + 1}. ${l}`));
      console.error("Re-run with --at <hash> (non-interactive pick is not supported).");
      return EXIT_GENERAL_ERROR;
    }
    const resolved = gitCheck(repoDir, ["rev-parse", "--verify", "--quiet", `${atCommit}^{commit}`]);
    let resolvedHash = resolved.out.trim();
    if (resolvedHash === "") {
      const log = gitCheck(repoDir, ["log", `${targetBranch}..${current}`, "--format=%H %s"]);
      for (const line of log.out.split("\n")) {
        if (line.includes(atCommit)) {
          resolvedHash = line.split(" ")[0] ?? "";
          break;
        }
      }
    }
    if (resolvedHash === "") {
      console.error(`Error: --at '${atCommit}' does not resolve to a commit in ${targetBranch}..${current}.`);
      return EXIT_GENERAL_ERROR;
    }
    const shortHash = gitCheck(repoDir, ["rev-parse", "--short", resolvedHash]);
    const short = shortHash.out.trim();
    const mergeBranch = `merge/${short}-${current}`;
    if (gitCheck(repoDir, ["show-ref", "--verify", "--quiet", `refs/heads/${mergeBranch}`]).ok) {
      const tip = gitCheck(repoDir, ["rev-parse", "--verify", `refs/heads/${mergeBranch}^{commit}`]).out.trim();
      if (tip !== resolvedHash) {
        console.error(`Error: merge branch ${mergeBranch} already exists but does not point at ${resolvedHash} (it points at ${tip || "an unresolvable commit"}) — delete or rename it, then retry.`);
        return EXIT_GENERAL_ERROR;
      }
      console.error(`Merge branch ${mergeBranch} already exists at the requested commit — reusing it.`);
      git(["-C", repoDir, "checkout", "-q", mergeBranch], { quiet: true });
    } else {
      git(["-C", repoDir, "checkout", "-q", "-b", mergeBranch, resolvedHash], { quiet: true });
    }
    currentBranchVar = mergeBranch;
    if (!wipGuard(repoDir, `origin/${targetBranch}`, mergeBranch, "merge-branch range")) {
      restoreBranch(repoDir, current);
      return EXIT_GENERAL_ERROR; // the restore matches the bash tool's EXIT trap
    }
    const push = gitInherit(repoDir, ["push", "-q", "-u", "origin", mergeBranch]);
    if (!push.ok) {
      console.error(`Error: could not push ${mergeBranch} to origin — no PR was created.`);
      restoreBranch(repoDir, current);
      return EXIT_API_FAILURE;
    }
    // Success path returns the user to the feature branch after the PR
    // opens: the merge branch is a PR vehicle, not a place to keep working.
    restoreBranch(repoDir, current);
  }

  const workBranch = currentBranchVar !== "" ? currentBranchVar : current;

  // Duplicate-PR check.
  let existingUrl = "";
  try {
    existingUrl = (await prsList(repoSpec, { state: "open", head: workBranch, json: "url", jq: ".[0].url" })).stdout.trim().split("\n")[0] ?? "";
  } catch {
    existingUrl = "";
  }
  if (existingUrl !== "") {
    console.error(`An open PR already exists for ${workBranch}: ${existingUrl}`);
    console.log(existingUrl);
    return 0;
  }

  if (issueNumber !== "") {
    prBody = prBody !== "" ? `Closes #${issueNumber}\n${prBody}` : `Closes #${issueNumber}`;
  }

  // Bash parity (pr-create.sh): ensure each label exists (best-effort — a
  // failure there never blocked the create), then pass every label on the
  // create argv itself.
  const createLabels: string[] = [];
  for (const label of labels) {
    if (label === "") continue;
    await issuesLabelEnsure(repoSpec, label).catch(() => undefined);
    createLabels.push(label);
  }

  console.error(`Creating PR from ${workBranch} -> ${targetBranch}...`);
  let createOut = "";
  try {
    createOut = (
      await prsCreate(repoSpec, {
        title: prTitle,
        body: prBody,
        head: workBranch,
        base: targetBranch,
        draft,
        ...(reviewers.length > 0 ? { reviewer: reviewers } : {}),
        ...(assignees.length > 0 ? { assignee: assignees } : {}),
        ...(createLabels.length > 0 ? { label: createLabels } : {}),
      })
    ).stdout;
  } catch (err) {
    console.error(errorMessage(err));
    console.error("Failed to create PR.");
    return EXIT_API_FAILURE;
  }

  const prUrl = await extractUrl(createOut);
  if (prUrl === null) {
    console.error("The provider reported success but printed no PR URL.");
    return EXIT_API_FAILURE;
  }
  console.log(prUrl);

  // Post-create workflow birth signals (best-effort).
  const prNum = prUrl.split("/").pop() ?? "";
  if (prNum !== "") {
    try {
      signalPrEventsForPr("created", prNum);
    } catch {
      // best-effort
    }
  }
  return 0;
}

let currentBranchVar = "";

/** The bash tool's restore_original_branch EXIT trap: switch back to the
 * original branch when we are not already on it. */
function restoreBranch(repoDir: string, original: string): void {
  const now = gitCheck(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const nowName = now.out.trim();
  if (nowName !== "" && nowName !== original) {
    gitCheck(repoDir, ["checkout", "-q", original]);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(errorMessage(err));
    process.exit(EXIT_API_FAILURE);
  },
);

