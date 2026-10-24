#!/usr/bin/env node
// repo-bump-version.ts - Bump version in one or more repositories
// Version: 1.1.0
// Description: Forces an empty commit in multiple repositories to trigger a
//              version update (created with -n, bypassing hooks — version-
//              trigger empty commits are intentional hook-free commits, same
//              exception as git-wip's WIP snapshots). Ensures each repo is
//              up to date, switches to master, checks custom commit-type
//              support in the release config, creates the empty commit, pushes.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { checkReleaseConfigSupportsCustomTypes, getConventionalCommitType } from "../lib/domain/release/version.ts";

assertNodeFloor();

const toolsDir = dirname(dirname(fileURLToPath(import.meta.url)));

function usage(): void {
  console.log(`Usage: repo-bump-version <change-type> [repository-names...]

Forces an empty commit in multiple repositories to trigger version updates.

Arguments:
  change-type       Type of version change: 'patch', 'minor', or 'major'
  repository-names  List of repository names (can be provided via heredoc)

Examples:
  repo-bump-version patch repo1 repo2 repo3

  repo-bump-version minor <<HEREDOC
  service-auth0
  service-user
  service-payment
HEREDOC

Process:
  Ensures each repo is up-to-date, switches to master, checks for custom
  commit type support in release config, creates empty commit, and pushes.`);
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

// Validate change type parameter
const changeType = process.argv[2] ?? "";
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
const positional = process.argv.slice(3);
if (positional.length > 0) {
  repos.push(...positional);
} else {
  const stdinData = readFileSync(0, "utf8");
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

  // Step 1: Ensure repo is up to date using repo-get (same-layer source).
  logInfo("Ensuring repository is up to date...");
  const get = run(["node", join(toolsDir, "scripts", "repo-get.ts"), repo]);
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

  // Step 2: Ensure we're on master branch
  const branchR = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", cwd: repoPath });
  if (branchR.status !== 0) {
    logError(`Failed to read the current branch (is this a git repository?): ${repoPath}`);
    failedRepos.push(`${repo} (not a git repository)`);
    continue;
  }
  const currentBranch = (branchR.stdout ?? "").trim();
  if (currentBranch !== "master") {
    logInfo(`Switching from '${currentBranch}' to 'master' branch...`);
    if (run(["git", "checkout", "master"], { cwd: repoPath }).status !== 0) {
      logError("Failed to checkout master branch");
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

  // Step 5: Create empty commit (hook-bypass by design)
  if (run(["git", "commit", "--allow-empty", "-m", commitMessage, "-n"], { cwd: repoPath }).status !== 0) {
    logError("Failed to create empty commit");
    failedRepos.push(`${repo} (commit failed)`);
    continue;
  }

  // Step 6: Push to origin
  logInfo("Pushing to origin/master...");
  if (run(["git", "push", "origin", "master"], { cwd: repoPath }).status !== 0) {
    logError("Failed to push commit to origin");
    logWarn("You may need to manually push or the commit was created locally");
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
