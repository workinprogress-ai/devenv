#!/usr/bin/env node
// repo-bump-version.ts - Bump version in one or more repositories
// Version: 1.1.0
// Description: Forces an empty commit in multiple repositories to trigger a
//              version update (created with -n, bypassing hooks — version-
//              trigger empty commits are intentional hook-free commits, same
//              exception as git-wip's WIP snapshots). Ensures each repo is
//              up to date, switches to the default branch, checks custom
//              commit-type support in the release config, creates the empty
//              commit, pushes. Nothing is committed or pushed unless the
//              working tree is clean, the default branch has no unpushed
//              commits, and the push is confirmed (terminal prompt, or --yes).
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { getDefaultBranch } from "../lib/core/git.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { siblingCommand } from "../lib/core/sibling.ts";
import { checkReleaseConfigSupportsCustomTypes, getConventionalCommitType } from "../lib/domain/release/version.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";

function usage(): void {
  console.log(`Usage: repo-bump-version <change-type> [repository-names...]

Forces an empty commit in multiple repositories to trigger version updates.

Arguments:
  change-type       Type of version change: 'patch', 'minor', or 'major'
  repository-names  List of repository names (can be provided via heredoc)

Options:
    -y, --yes                   Confirm the push without prompting (required
                                when there is no terminal)
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

Examples:
  repo-bump-version patch repo1 repo2 repo3

  repo-bump-version minor <<HEREDOC
  service-auth0
  service-user
  service-payment
HEREDOC

Process:
  Ensures each repo is up-to-date, switches to its default branch, checks for
  custom commit type support in release config, creates empty commit, and
  pushes. A repo with uncommitted changes, or with local commits on the default
  branch that origin does not have, is refused before anything is changed (the
  push would publish those commits unreviewed). Each push is confirmed first,
  showing the remote and the exact commit that would be pushed.`);
}

interface Run {
  status: number;
}

function run(args: string[], opts: { cwd?: string; input?: string } = {}): Run {
  const r = spawnSync(args[0] ?? "", args.slice(1), {
    encoding: "utf8",
    input: opts.input,
    cwd: opts.cwd,
    stdio: ["pipe", "inherit", "inherit"],
  });
  return { status: r.status ?? 1 };
}

// Ask on the controlling terminal (stdin may carry the repository list, so the
// answer is read from /dev/tty). Without a terminal the answer is "no".
function confirmOnTerminal(): boolean {
  if (process.stderr.isTTY !== true || !existsSync("/dev/tty")) return false;
  const r = spawnSync("bash", ["-c", 'read -r answer < /dev/tty; printf "%s" "$answer"'], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return /^y(es)?$/i.test((r.stdout ?? "").trim());
}

let positionals: string[] = [];
let assumeYes = false;
try {
  const cli = toolCli({
    name: "repo-bump-version",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: { yes: { type: "boolean", short: "y", default: false } },
  });
  if (cli.common.help) {
    usage();
    process.exit(0);
  }
  positionals = cli.positionals;
  assumeYes = cli.values["yes"] === true;
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

// Validate change type parameter
const changeType = positionals[0] ?? "";
if (changeType === "") {
  logError("Missing required argument: change-type");
  usage();
  process.exit(EXIT_MISUSE);
}
if (!/^(patch|minor|major)$/.test(changeType)) {
  logError(`Invalid change-type: '${changeType}'. Must be 'patch', 'minor', or 'major'.`);
  usage();
  process.exit(EXIT_MISUSE);
}

// Collect repository names from arguments or stdin (heredoc)
const repos: string[] = [];
if (positionals.length > 1) {
  repos.push(...positionals.slice(1));
} else if (process.stdin.isTTY !== true) {
  let stdinData = "";
  try {
    stdinData = readFileSync(0, "utf8");
  } catch (err) {
    // A non-blocking or closed stdin is an empty list, not a crash.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EAGAIN" && code !== "EOF") throw err;
  }
  for (const rawLine of stdinData.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line !== "") repos.push(line);
  }
}

if (repos.length === 0) {
  logError("No repositories provided");
  usage();
  process.exit(EXIT_MISUSE);
}

// A name is a single path segment under repos/ and never reads as a flag.
for (const repo of repos) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repo) || repo.includes("..")) {
    logError(`Invalid repository name: '${repo}' (letters, digits, '.', '_' and '-'; no leading dash, no '..')`);
    process.exit(EXIT_MISUSE);
  }
}

const devenvRoot = process.env.DEVENV_ROOT ?? "";
if (devenvRoot === "") {
  logError("DEVENV_ROOT is not set — cannot locate the repos directory.");
  process.exit(EXIT_GENERAL_ERROR);
}
const reposDir = join(devenvRoot, "repos");

logInfo(`Processing ${repos.length} repository/repositories with change type: ${changeType}`);
console.log();

const successRepos: string[] = [];
const failedRepos: string[] = [];
// cwd is never changed: every git operation is cwd-anchored via options.cwd.

for (const repo of repos) {
  logInfo("----------------------------------------");
  logInfo(`Processing: ${repo}`);

  const repoPath = join(reposDir, repo);

  // Step 1: Ensure repo is up to date using the sibling repo-get tool.
  logInfo("Ensuring repository is up to date...");
  const get = run(siblingCommand("repo-get").concat(repo));
  if (get.status !== 0) {
    logError(`Failed to update repository: ${repo}`);
    failedRepos.push(`${repo} (update failed)`);
    continue;
  }

  // Change to repo directory
  if (!existsSync(repoPath)) {
    logError(`Failed to change directory to: ${repoPath}`);
    failedRepos.push(`${repo} (cd failed)`);
    continue;
  }

  // Step 2: Preconditions — checked before anything is mutated. repo-get
  // exits 0 when it skips a dirty tree or a default branch with unpushed
  // commits, so its status proves neither.
  const defaultBranch = getDefaultBranch(repoPath);
  if (defaultBranch === null) {
    logError(`Cannot determine the default branch of ${repo} (origin/HEAD is not set)`);
    failedRepos.push(`${repo} (default branch unknown)`);
    continue;
  }
  const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8", cwd: repoPath });
  if (dirty.status !== 0) {
    logError(`Failed to read the working tree status (is this a git repository?): ${repoPath}`);
    failedRepos.push(`${repo} (not a git repository)`);
    continue;
  }
  if ((dirty.stdout ?? "").trim() !== "") {
    logError(`${repo} has uncommitted changes; the working tree must be clean before a version bump`);
    failedRepos.push(`${repo} (uncommitted changes)`);
    continue;
  }
  const unpushed = spawnSync("git", ["rev-list", "--count", `origin/${defaultBranch}..${defaultBranch}`], {
    encoding: "utf8",
    cwd: repoPath,
  });
  if (unpushed.status !== 0) {
    logError(`Cannot compare '${defaultBranch}' with 'origin/${defaultBranch}' in ${repo}`);
    failedRepos.push(`${repo} (cannot compare with origin)`);
    continue;
  }
  if ((unpushed.stdout ?? "").trim() !== "0") {
    logError(`${repo} has unpushed commits on '${defaultBranch}' (origin/${defaultBranch}..${defaultBranch}); pushing would publish them unreviewed`);
    failedRepos.push(`${repo} (unpushed commits on ${defaultBranch})`);
    continue;
  }

  // Step 2b: Ensure we're on the default branch
  const branchR = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", cwd: repoPath });
  const currentBranch = (branchR.stdout ?? "").trim();
  if (currentBranch !== defaultBranch) {
    logInfo(`Switching from '${currentBranch}' to '${defaultBranch}' branch...`);
    if (run(["git", "checkout", defaultBranch], { cwd: repoPath }).status !== 0) {
      logError(`Failed to checkout ${defaultBranch} branch`);
      failedRepos.push(`${repo} (checkout failed)`);
      continue;
    }
  }

  // Step 3: Check if repo supports custom commit types
  const supportsCustom = checkReleaseConfigSupportsCustomTypes(repoPath);
  if (supportsCustom) {
    logInfo("Repository supports custom commit types (patch/minor/major)");
  } else {
    logWarn("Repository does not support custom commit types, falling back to conventional commits");
  }

  // Step 4: Determine commit type
  const commitType = getConventionalCommitType(changeType, supportsCustom);
  const commitMessage = `${commitType}: force version update`;

  logInfo(`Using commit message: '${commitMessage}'`);

  // Confirm gate: say exactly what will be pushed.
  const originUrl = (spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", cwd: repoPath }).stdout ?? "").trim();
  const tip = (spawnSync("git", ["rev-parse", "--short", `origin/${defaultBranch}`], { encoding: "utf8", cwd: repoPath }).stdout ?? "").trim();
  const plan =
    `Will create an empty commit '${commitMessage}' on '${defaultBranch}' (on top of origin/${defaultBranch} ${tip}) ` +
    `and push it to origin ${originUrl} as ${defaultBranch}. No other commits are pushed.`;
  logInfo(plan);
  if (!assumeYes) {
    if (process.stderr.isTTY === true && existsSync("/dev/tty")) process.stderr.write(`Push to ${repo}? [y/N] `);
    if (!confirmOnTerminal()) {
      logError(`${repo}: not confirmed — re-run with --yes to push without a terminal prompt`);
      failedRepos.push(`${repo} (not confirmed)`);
      continue;
    }
  }

  // Step 5: Create empty commit (hook-bypass by design)
  if (run(["git", "commit", "--allow-empty", "-m", commitMessage, "-n"], { cwd: repoPath }).status !== 0) {
    logError("Failed to create empty commit");
    failedRepos.push(`${repo} (commit failed)`);
    continue;
  }

  // Step 6: Push to origin
  logInfo(`Pushing to origin/${defaultBranch}...`);
  if (run(["git", "push", "origin", defaultBranch], { cwd: repoPath }).status !== 0) {
    logError("Failed to push commit to origin");
    logWarn(`The empty commit exists locally only (exactly one commit — HEAD). Undo it (in ${repoPath}) with: git reset --keep HEAD~1`);
    logWarn("(the next run refuses while the default branch has an unpushed commit)");
    failedRepos.push(`${repo} (push failed)`);
    continue;
  }

  logInfo(`✓ Successfully forced commit in: ${repo}`);
  successRepos.push(repo);
}

// Print summary
console.log();
logInfo("========================================");
logInfo("SUMMARY");
logInfo("========================================");
logInfo(`Total repositories: ${repos.length}`);
logInfo(`✓ Successful: ${successRepos.length}`);
if (failedRepos.length > 0) {
  logError(`Failed: ${failedRepos.length}`);
  logError("Failed repositories:");
  for (const failed of failedRepos) {
    console.log(`  - ${failed}`);
  }
}
logInfo("========================================");

process.exit(failedRepos.length > 0 ? EXIT_GENERAL_ERROR : 0);
