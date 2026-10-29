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

import { parseArgs } from "node:util";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";

import { EXIT_API_FAILURE, EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { providerRepoTarget, requireRepoTarget, ghApi } from "../lib/providers/provider-core.ts";
import { prsCreate, prsList } from "../lib/providers/github/prs.ts";
import { issuesView, issuesLabelEnsure } from "../lib/providers/github/issues.ts";
import { extractUrl, remoteToSpec } from "../lib/providers/github/urls.ts";
import { signalPrEventsForPr } from "../lib/domain/events.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "pr-create.ts");

const COMMIT_TYPES = ["feat", "fix", "chore", "docs", "style", "refactor", "perf", "test", "build", "ci", "revert", "patch", "minor", "major"];

function usage(): never {
  console.error(`Usage: ${SCRIPT_NAME} [<title>] [options]`);
  console.error("");
  console.error("Options:");
  console.error("  --issue <number>     Issue number this PR addresses. Omitted: inferred from the branch name ([<type>/]<issue>-<slug>); if not inferable, an error asks for --issue or --no-issue");
  console.error("  --no-issue           Explicitly indicate this PR has no associated issue");
  console.error("  <title>              PR title. Optional for non-squash repos without a message (the issue title is used); required for squash-merge repos, where it must follow Conventional Commits");
  console.error("  --base <branch>      Target branch for PR (default: repository's default branch)");
  console.error("  --repo-dir <path>    Repository directory (default: current)");
  console.error("  --branch <name>      Source branch for PR (default: current branch)");
  console.error("  --body <text>        PR body text");
  console.error("  --body-file <file>   Read PR body from a file");
  console.error("  --draft              Create as draft");
  console.error("  --reviewer <handle>  Add a reviewer (can be repeated)");
  console.error("  --assignee <handle>  Add an assignee (default: @me)");
  console.error("  --label <name>       Add a label (can be repeated)");
  console.error("  --at <hash-or-title> Partial-branch mode: open the PR from a merge branch created at the chosen commit");
  process.exit(EXIT_GENERAL_ERROR);
}

function git(args: string[], opts: { capture?: boolean; quiet?: boolean } = {}): { ok: boolean; out: string } {
  const r = spawnSync("git", args, {
    encoding: "utf8",
    ...(opts.capture ? {} : opts.quiet ? { stdio: ["ignore", "ignore", "ignore"] } : { stdio: ["ignore", "inherit", "inherit"] }),
  });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

function conventionalCommitsOk(title: string): boolean {
  return new RegExp(`^(${COMMIT_TYPES.join("|")})(\\([^)]+\\))?!?: .+`).test(title);
}

/** WIP scan (git-operations'): anchored ` WIP:` subject prefix in the range. */
function wipScan(repoDir: string, range: string): { clean: boolean; offenders: string } {
  const r = spawnSync("git", ["-C", repoDir, "log", range, "--format=%h %s"], { encoding: "utf8" });
  const offenders = (r.stdout ?? "").split("\n").filter((l) => l.includes(" WIP:")).join("\n");
  return { clean: offenders === "", offenders };
}

function wipGuard(repoDir: string, range: string, context: string): boolean {
  const wip = wipScan(repoDir, range);
  if (!wip.clean) {
    logError(`WIP: commits present in ${context} (${range}) — merge rejected.`);
    logError("Offending commits:");
    for (const line of wip.offenders.split("\n")) logError(`  ${line}`);
    logError("Recovery: git-unwip (soft-reset past the WIP) or finish the work into real commits.");
    return false;
  }
  return true;
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

  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
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
      allowPositionals: true,
      strict: true,
    });
    issueNumber = values["issue"] ?? "";
    noIssue = values["no-issue"] === true;
    if (values["repo-dir"] !== undefined) repoDir = values["repo-dir"];
    sourceBranch = values["branch"] ?? "";
    targetBranch = values["base"] ?? "";
    prBody = values["body"] ?? "";
    bodyFile = values["body-file"] ?? "";
    draft = values["draft"] === true;
    reviewers.push(...(values["reviewer"] ?? []));
    // Bash parity: --assignee APPENDS to the @me default (ASSIGNEES+=("$2")),
    // so an extra assignee never drops the author from the assignment.
    assignees.push(...(values["assignee"] ?? []));
    labels.push(...(values["label"] ?? []));
    atCommit = values["at"] ?? "";
    if (positionals.length > 1) {
      logError(`Unexpected extra arguments: ${positionals.join(" ")}`);
      return EXIT_MISUSE;
    }
    prTitle = positionals[0] ?? "";
    if (values["help"] === true) {
      usage();
    }
    if (values["version"] === true) {
      console.log(SCRIPT_VERSION);
      process.exit(0);
    }
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  // Scratchpad refusal (two layers, scratchpad.bash's contract): PR creation
  // is a push-path operation — blocked while a scratchpad is active in this
  // repo, and blocked on any scratchpad/* branch (defense-in-depth: scratch
  // commits bypass hooks and carry no Devenv-Action/Change-Id trailers; they
  // must never reach shared history).
  const scratchBranch = spawnSync("git", ["-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
  const branchName = (scratchBranch.stdout ?? "").trim();
  const stateRef = spawnSync("git", ["-C", repoDir, "show-ref", "--verify", "--quiet", "refs/scratchpad/state"]);
  const onScratchBranch = /^scratchpad\//.test(branchName);
  if (stateRef.status === 0 || onScratchBranch) {
    console.error(
      "Error: pr-create push is blocked on a scratchpad branch — scratch commits bypass hooks and carry no Devenv-Action/Change-Id trailers; they must never reach shared history.",
    );
    console.error("Salvage to the base branch: repo-scratchpad promote <sha> · or leave the mode: repo-scratchpad exit");
    return EXIT_CONFLICT;
  }

  // Issue inference: leading number of the branch leaf.
  if (issueNumber === "" && !noIssue) {
    const leaf = branchName.includes("/") ? (branchName.split("/").pop() ?? "") : branchName;
    const m = /^([0-9]+)/.exec(leaf);
    if (m?.[1] === undefined) {
      console.error(`Error: No issue passed (--issue) and none inferable from branch name '${branchName || "<none>"}' — pass --issue <number> or --no-issue.`);
      return EXIT_MISUSE;
    }
    issueNumber = m[1];
    console.error(`Inferred issue #${issueNumber} from branch '${branchName}'.`);
  }

  if (bodyFile !== "") {
    if (!existsSync(bodyFile)) {
      console.error(`Error: body file not found: ${bodyFile}`);
      return EXIT_GENERAL_ERROR;
    }
    prBody = readFileSync(bodyFile, "utf8");
  }

  if (issueNumber !== "" && noIssue) {
    console.error("Error: Cannot specify both --issue and --no-issue.");
    return EXIT_GENERAL_ERROR;
  }
  if (issueNumber !== "" && !/^[1-9][0-9]*$/.test(issueNumber)) {
    console.error("Error: Issue number must be numeric and positive.");
    return EXIT_MISUSE;
  }

  // Repo spec: origin remote through the provider URL seam, else the
  // provider resolver.
  const originUrl = spawnSync("git", ["-C", repoDir, "remote", "get-url", "origin"], { encoding: "utf8" });
  let repoSpec = originUrl.status === 0 ? (remoteToSpec((originUrl.stdout ?? "").trim()) ?? "") : "";
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
  if (issueNumber !== "" && repoSpec !== "") {
    try {
      issueTitle = (await issuesView(repoSpec, Number.parseInt(issueNumber, 10), { json: "title", jq: ".title" })).trim();
    } catch {
      issueTitle = "";
    }
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

  const inside = spawnSync("git", ["-C", repoDir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (inside.status !== 0) {
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
  const dirty = spawnSync("git", ["-C", repoDir, "diff-index", "--quiet", "HEAD", "--"], { encoding: "utf8" });
  if (dirty.status !== 0) {
    console.error("There are uncommitted or staged changes.");
    return EXIT_GENERAL_ERROR;
  }

  const current = sourceBranch !== "" ? sourceBranch : branchName;
  if (current.startsWith("review/")) {
    console.error("This script cannot be run on a review/* branch.");
    return EXIT_GENERAL_ERROR;
  }

  if (targetBranch === "") {
    const ref = spawnSync("git", ["-C", repoDir, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { encoding: "utf8" });
    const refName = (ref.stdout ?? "").trim().replace(/^origin\//, "");
    targetBranch = refName !== "" ? refName : git(["-C", repoDir, "show-ref", "--quiet", "refs/remotes/origin/main"], { capture: true }).ok ? "main" : "master";
  }

  if (atCommit === "") {
    const guardRange = current.startsWith("merge/") ? `${targetBranch}..${current}` : `${targetBranch}..HEAD`;
    if (!wipGuard(repoDir, guardRange, "PR creation range")) {
      return EXIT_GENERAL_ERROR;
    }
  }

  if (atCommit !== "") {
    if (atCommit === "pick") {
      const commits = spawnSync("git", ["-C", repoDir, "log", `${targetBranch}..${current}`, "--format=%h%x09%s"], { encoding: "utf8" });
      const lines = (commits.stdout ?? "").split("\n").filter((l) => l.trim() !== "");
      if (lines.length === 0) {
        console.error(`No commits found in ${targetBranch}..${current} to pick from.`);
        return EXIT_GENERAL_ERROR;
      }
      console.error("Non-interactive mode — pick a commit:");
      lines.forEach((l, i) => console.error(`  ${i + 1}. ${l}`));
      console.error("Re-run with --at <hash> (non-interactive pick is not supported).");
      return EXIT_GENERAL_ERROR;
    }
    const resolved = spawnSync("git", ["-C", repoDir, "rev-parse", "--verify", "--quiet", `${atCommit}^{commit}`], { encoding: "utf8" });
    let resolvedHash = (resolved.stdout ?? "").trim();
    if (resolvedHash === "") {
      const log = spawnSync("git", ["-C", repoDir, "log", `${targetBranch}..${current}`, "--format=%H %s"], { encoding: "utf8" });
      for (const line of (log.stdout ?? "").split("\n")) {
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
    const shortHash = spawnSync("git", ["-C", repoDir, "rev-parse", "--short", resolvedHash], { encoding: "utf8" });
    const short = (shortHash.stdout ?? "").trim();
    const mergeBranch = `merge/${short}-${current}`;
    if (spawnSync("git", ["-C", repoDir, "show-ref", "--verify", "--quiet", `refs/heads/${mergeBranch}`], { encoding: "utf8" }).status === 0) {
      console.error(`Merge branch ${mergeBranch} already exists — reusing it.`);
      git(["-C", repoDir, "checkout", "-q", mergeBranch], { quiet: true });
    } else {
      git(["-C", repoDir, "checkout", "-q", "-b", mergeBranch, resolvedHash], { quiet: true });
    }
    currentBranchVar = mergeBranch;
    if (!wipGuard(repoDir, `${targetBranch}..${currentBranchVar}`, "merge-branch range")) {
      restoreBranch(repoDir, current);
      return EXIT_API_FAILURE; // the restore matches the bash tool's EXIT trap
    }
    const push = spawnSync("git", ["-C", repoDir, "push", "-q", "-u", "origin", mergeBranch], { encoding: "utf8", stdio: ["ignore", "ignore", "inherit"] });
    if (push.status !== 0) {
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
    console.error(err instanceof Error ? err.message : String(err));
    console.error("Failed to create PR.");
    return EXIT_API_FAILURE;
  }

  const prUrl = extractUrl(createOut);
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
  const now = spawnSync("git", ["-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
  const nowName = (now.stdout ?? "").trim();
  if (nowName !== "" && nowName !== original) {
    spawnSync("git", ["-C", repoDir, "checkout", "-q", original], { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_API_FAILURE);
  },
);

