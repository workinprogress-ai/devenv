#!/usr/bin/env node
// pr-merge.ts - Merge an open pull request from the current branch.
// Merge method defaults to rebase; options are documented in usage() only.
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Port of pr-merge.sh + the git-operations.bash helpers it inlines. The git
// invocation sequences are preserved exactly from the bash tool — no
// "improvements".

import { basename } from "node:path";
import { spawnSync } from "node:child_process";

import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { gitCheck, gitInherit, wipRangeGuard } from "../lib/core/git.ts";
import { toolCli } from "../lib/core/cli.ts";
import { conventionalCommitsOk } from "../lib/core/commit-format.ts";
import { siblingInvocation } from "../lib/core/sibling.ts";
import { checkTargetRepo, providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { prsList, prsMerge, prsView } from "../lib/providers/facade/prs.ts";
import { prWebUrl } from "../lib/providers/facade/urls.ts";
import { signalPrEvents } from "../lib/domain/events.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "pr-merge.ts");

const MERGE_METHODS = ["squash", "merge", "rebase"] as const;

function usage(exitCode: number): never {
  // Help goes to stdout (exit 0); a misuse hint goes to stderr.
  (exitCode === 0 ? process.stdout : process.stderr).write(`Usage: ${SCRIPT_NAME} [commit-message] [options]

Merge an open pull request from the current branch.

Arguments:
  [commit-message]        Message whose first line must follow Conventional
                          Commits for squash merges. If omitted, the PR title
                          is used with no body.

Options:
  --issue <number>        Issue number this PR addresses (optional)
  --no-issue-id           Explicitly indicate this PR has no associated issue
  --method <method>       Merge method (squash, merge, rebase; default: rebase)
  --base <branch>         Target branch (default: repository's default branch)
  --repo-dir <path>       Repository directory (default: current directory)
  --branch <name>         Source branch for PR lookup (default: current branch)
  --force                 Allow merging a draft PR. Branch protection (required
                          reviews and checks) is never bypassed.
  --keep-branch           Keep the source branch after merge (deleted by default)
  --                      End of options: what follows is the commit message
  -h, --help              Show this help message and exit
  -v, --version           Show version information and exit
  -V, --verbose           Enable verbose output (debug logging)
  --devenv                Safety override for devenv-repo operations
`);
  process.exit(exitCode);
}

function git(args: string[], opts: { capture?: boolean } = {}): { ok: boolean; out: string } {
  if (opts.capture) return gitCheck(null, args).ok ? { ok: true, out: gitCheck(null, args).out.trim() } : { ok: false, out: gitCheck(null, args).out.trim() };
  return gitInherit(null, args);
}

function currentBranch(repoDir: string): string {
  return git(["-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD"], { capture: true }).out;
}

function defaultBranch(repoDir: string): string {
  const ref = git(["-C", repoDir, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { capture: true }).out;
  if (ref !== "") return ref.replace(/^origin\//, "");
  if (git(["-C", repoDir, "show-ref", "--quiet", "refs/remotes/origin/main"], { capture: true }).ok) return "main";
  return "master";
}

function workingDirectoryClean(repoDir: string): boolean {
  return git(["-C", repoDir, "status", "--porcelain"], { capture: true }).out === "";
}

function mergeMethodAllowed(method: string): boolean {
  return (MERGE_METHODS as readonly string[]).includes(method);
}

/** Build merge commit message with footer (git-operations' builder). */
function buildMergeCommitMessage(title: string, body: string, prNum: string, issueNum: string): string {
  let trimmedBody = "";
  if (body !== "") {
    trimmedBody =
      body
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "")
        .join("\n") + "\n\n";
    if (trimmedBody.trim() === "") trimmedBody = "";
    else trimmedBody = trimmedBody;
  }
  let refs = `#${prNum}`;
  if (issueNum !== "") refs += ` #${issueNum}`;
  const subject = `${title} (${refs})`;
  return trimmedBody !== "" ? `${subject}\n\n${trimmedBody}\n` : `${subject}\n`;
}

/** Soft warning: breaking markers in the range (! before colon or a
 * BREAKING CHANGE footer). Warning surface only, never a gate. */
function breakingMarkerScan(repoDir: string, range: string): void {
  const log = gitCheck(repoDir, ["log", range, "--format=%h %s"]);
  for (const line of log.out.split("\n")) {
    if (/^[0-9a-f]{7,} [a-z]+(\([^)]*\))?!:/.test(line)) {
      logWarn(`Breaking marker in range: ${line}`);
    }
  }
  const withFooters = gitCheck(repoDir, ["log", range, "--format=C %h %s%n%b"]);
  let cur = "";
  for (const line of withFooters.out.split("\n")) {
    if (line.startsWith("C ") && line.length > 2) cur = line.slice(2);
    if (/^BREAKING CHANGE[ :=]/.test(line) && cur !== "") {
      logWarn(`Breaking marker in range: ${cur} (BREAKING CHANGE footer)`);
      cur = "";
    }
  }
}

async function main(argv: string[]): Promise<number> {
  let commitMessage = "";
  let issueNumber = "";
  let selectIssue = false;
  let noIssueId = false;
  let mergeMethod = "rebase";
  let targetBranch = "";
  let sourceBranch = "";
  let repoDir = process.cwd();
  let force = false;
  let keepBranch = false;
  let help = false;
  let devenvFlag = false;

  // `--` separates options from the message (toolCli handles it).
  try {
    const cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      noDryRun: true,
      options: {
        issue: { type: "string" },
        select: { type: "boolean", default: false },
        "no-issue-id": { type: "boolean", default: false },
        method: { type: "string" },
        base: { type: "string" },
        "repo-dir": { type: "string" },
        branch: { type: "string" },
        force: { type: "boolean", default: false },
        "keep-branch": { type: "boolean", default: false },
      },
    });
    help = cli.common.help;
    if (help) usage(0);
    issueNumber = ((cli.values["issue"] as string | undefined) ?? "");
    selectIssue = cli.values["select"] === true;
    noIssueId = cli.values["no-issue-id"] === true;
    mergeMethod = ((cli.values["method"] as string | undefined) ?? "rebase");
    targetBranch = ((cli.values["base"] as string | undefined) ?? "");
    const repoDirValue = cli.values["repo-dir"];
    if (repoDirValue !== undefined) repoDir = String(repoDirValue);
    sourceBranch = ((cli.values["branch"] as string | undefined) ?? "");
    force = cli.values["force"] === true;
    keepBranch = cli.values["keep-branch"] === true;
    devenvFlag = cli.common.devenv;
    if (cli.positionals.length > 1) {
      logError(`pr-merge takes at most one commit message (got ${cli.positionals.length} arguments); quote a message that contains spaces.`);
      return EXIT_MISUSE;
    }
    commitMessage = cli.positionals[0] ?? "";
  } catch (err) {
    logError(errorMessage(err));
    usage(EXIT_MISUSE);
  }

  if (selectIssue && noIssueId) {
    logError("Cannot specify both --select and --no-issue-id.");
    return EXIT_MISUSE;
  }
  if (issueNumber !== "" && noIssueId) {
    logError("Cannot specify both --issue and --no-issue-id.");
    return EXIT_MISUSE;
  }
  if (issueNumber !== "" && selectIssue) {
    logError("Cannot specify both --issue and --select.");
    return EXIT_MISUSE;
  }

  if (selectIssue) {
    // The interactive picker needs a TTY; refuse with the named error under
    // automation (the picker itself is the interactive polish pass).
    if (!Boolean(process.stdin.isTTY)) {
      logError("--select requires an interactive terminal; pass --issue or --no-issue-id instead");
      return EXIT_MISUSE;
    }
    logInfo("Selecting issue interactively...");
    const pick = siblingInvocation("issue-select", []);
    const sel = spawnSync(pick.command, pick.args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    issueNumber = (sel.stdout ?? "").trim();
    if (issueNumber === "") {
      logError("No issue selected.");
      return EXIT_GENERAL_ERROR;
    }
  }

  if (issueNumber !== "" && !/^[1-9][0-9]*$/.test(issueNumber)) {
    logError("Issue number must be numeric and positive.");
    return EXIT_MISUSE;
  }

  if (!mergeMethodAllowed(mergeMethod)) {
    logError(`Invalid merge method: ${mergeMethod} (must be one of: ${MERGE_METHODS.join(" ")})`);
    return EXIT_MISUSE;
  }

  // Git context (validate_git_context): repo, clean WD, not on the target.
  const inside = gitCheck(repoDir, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) {
    logError("Not in a git repository");
    return EXIT_GENERAL_ERROR;
  }
  if (!workingDirectoryClean(repoDir)) {
    logError("Working directory has uncommitted or staged changes");
    return EXIT_GENERAL_ERROR;
  }
  const preBranch = sourceBranch !== "" ? sourceBranch : currentBranch(repoDir);
  for (const pattern of ["main", "master", "review/*"]) {
    if (pattern.includes("*") ? preBranch.startsWith("review/") : preBranch === pattern) {
      logError(`Cannot run this script on ${preBranch} branch`);
      return EXIT_GENERAL_ERROR;
    }
  }

  const current = sourceBranch !== "" ? sourceBranch : preBranch;
  if (targetBranch === "") targetBranch = defaultBranch(repoDir);
  if (!git(["-C", repoDir, "show-ref", "--quiet", `refs/remotes/origin/${targetBranch}`], { capture: true }).ok) {
    logError(`Target branch origin/${targetBranch} not found.`);
    return EXIT_API_FAILURE;
  }

  // The house --devenv flag gates devenv-repo operations (the safety
  // override has real meaning here: pr-merge can push-adjacent state).
  checkTargetRepo(devenvFlag);

  const repo = requireRepoTarget(providerRepoTarget(""), "pr-merge", "pr");

  logInfo(`Looking for an open PR from '${current}' -> '${targetBranch}'...`);
  let prId = "";
  try {
    const r = await prsList(repo, { head: current, base: targetBranch, state: "open", json: "number", jq: ".[0].number" });
    prId = r.stdout.trim().split("\n")[0] ?? "";
  } catch {
    prId = "";
  }
  if (prId === "" || !/^[0-9]+$/.test(prId)) {
    logError(`No open PR found from '${current}' to '${targetBranch}'.`);
    return EXIT_API_FAILURE;
  }

  // One fail-closed lookup of the PR's details: the draft gate, the issue
  // cross-check and the head-commit pin all read it, so an unreadable PR
  // blocks the merge instead of reading as "not a draft".
  interface PrDetails { title?: string; body?: string; isDraft?: boolean; headRefOid?: string }
  let details: PrDetails;
  try {
    const raw = (
      await prsView(repo, Number.parseInt(prId, 10), {
        json: "title,body,isDraft,state,author,headRefOid",
        jq: ".",
      })
    ).stdout;
    details = JSON.parse(raw) as PrDetails;
  } catch {
    logError(`Failed to fetch PR details for #${prId}; refusing to merge without them.`);
    return EXIT_API_FAILURE;
  }

  if (commitMessage === "") {
    commitMessage = details.title ?? "";
    if (commitMessage === "") {
      logError(`PR #${prId} has no title.`);
      return EXIT_GENERAL_ERROR;
    }
    logInfo(`Using PR title as commit message: ${commitMessage}`);
  }

  const commitTitle = commitMessage.split("\n")[0] ?? "";
  const commitBody = commitMessage.split("\n").slice(1).join("\n");

  // Draft gate.
  const isDraft = details.isDraft === true;
  if (isDraft) {
    if (force) {
      logWarn(`PR #${prId} is a draft. Proceeding due to --force.`);
    } else {
      logError(`PR #${prId} is a draft. Convert it to open before merging, or use --force.`);
      return EXIT_GENERAL_ERROR;
    }
  }

  if (mergeMethod === "squash" && !conventionalCommitsOk(commitTitle)) {
    logError("Squash merge commit message must follow Conventional Commits on the first line.");
    logError(`Got: '${commitTitle}'`);
    return EXIT_GENERAL_ERROR;
  }

  if (issueNumber !== "") {
    // The issue the PR body references (first '#N').
    const descIssue = /#([0-9]+)/.exec(details.body ?? "")?.[1] ?? "";
    if (descIssue !== "" && issueNumber !== descIssue) {
      logError(`PR #${prId} references issue #${descIssue} but --issue ${issueNumber} was provided.`);
      return EXIT_GENERAL_ERROR;
    }
  }

  const mergeCommitMessage = buildMergeCommitMessage(commitTitle, commitBody, prId, issueNumber);

  // WIP hard gate on the merge range. The scan runs on the remote-tracking
  // refs (what the PR actually contains), in the named repository, and fails
  // closed: an unresolvable range or a head ref that differs from the head
  // commit the provider reports blocks the merge.
  const baseRef = `origin/${targetBranch}`;
  const headRef = `origin/${current}`;
  const range = `${baseRef}..${headRef}`;
  const headSha = gitCheck(repoDir, ["rev-parse", "--verify", "--quiet", `refs/remotes/${headRef}^{commit}`]).out.trim();
  if (headSha === "" || headSha !== (details.headRefOid ?? "")) {
    logError(`${headRef} is missing or does not match PR #${prId}'s head commit — fetch origin and retry; merge rejected.`);
    return EXIT_GENERAL_ERROR;
  }
  const wip = wipRangeGuard(repoDir, range);
  if (!wip.ok) {
    if (wip.offenders.length === 0) {
      logError(`Could not scan ${range} for WIP: commits — merge rejected.`);
    } else {
      logError(`WIP: commits present in merge range for PR #${prId} (${range}) — merge rejected.`);
      logError("Offending commits:");
      for (const line of wip.offenders) logError(`  ${line}`);
      logError("Recovery: git-unwip (soft-reset past the WIP) or finish the work into real commits.");
    }
    return EXIT_GENERAL_ERROR;
  }
  breakingMarkerScan(repoDir, range);

  // Merge. merge_pr's sequence: build the full message (title + refs
  // footer + body), then split it — subject is its first line, body the
  // trimmed tail — --delete-branch unless keep, then fire
  // pr-events for the merged PR's linked issues (best-effort).
  const subject = mergeCommitMessage.split("\n")[0] ?? "";
  const body = mergeCommitMessage
    .split("\n")
    .slice(1)
    .join("\n")
    .trim();
  let mergeOut: string;
  try {
    mergeOut = (
      await prsMerge(repo, Number.parseInt(prId, 10), {
        method: mergeMethod as "squash" | "merge" | "rebase",
        subject,
        body,
        deleteBranch: !keepBranch,
        matchHeadCommit: headSha,
      })
    ).stdout;
  } catch {
    logError(`Failed to merge PR #${prId}. Check for merge conflicts or branch protection rules.`);
    return EXIT_API_FAILURE;
  }
  if (mergeOut.trim() !== "") console.log(mergeOut);

  // Post-merge pr-events: fire signals for the merged PR body's linked
  // issues (best-effort — never alters this merge's success).
  try {
    const prBody = (
      JSON.parse((await prsView(repo, Number.parseInt(prId, 10), { json: "body" })).stdout) as { body?: string }
    ).body ?? "";
    const signals = signalPrEvents("merged", prBody);
    for (const w of signals.warnings) logWarn(w);
  } catch {
    // best-effort: body fetch or signal failures never fail the merge
  }

  const prUrl = await prWebUrl(repo, Number.parseInt(prId, 10));
  console.log(`Pull request #${prId} merged successfully (${mergeMethod}).`);
  logInfo(prUrl);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      logError(errorMessage(err));
      process.exit(EXIT_API_FAILURE);
    },
  );
}
