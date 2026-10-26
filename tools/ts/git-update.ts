#!/usr/bin/env node
// git-update.ts - Fetch tags and pull the current branch when it is strictly
//                 behind its upstream. When the remote history was rewritten
//                 (a fork sync), reset to it when the clone has nothing
//                 unique, or replay local commits with rebase when it has.
//                 Takes no arguments.
// Version: 1.1.0
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { readSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { rewriteDetectState } from "../lib/core/git.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

interface Run {
  status: number;
  out: string;
}

function git(args: string[], input?: string): Run {
  const r = spawnSync("git", args, { encoding: "utf8", input });
  return { status: r.status ?? 1, out: r.stdout ?? "" };
}

function fail(...lines: string[]): never {
  for (const l of lines) console.error(l);
  process.exit(1);
}

function usage(): never {
  console.log(`Usage: git-update
Fetch tags and pull the current branch when it is strictly behind its upstream.
When the remote history was rewritten (a fork sync), reset to it when the clone
has nothing unique, or replay local commits with rebase when it has.
Takes no arguments.`);
  process.exit(0);
}

const arg = process.argv[2] ?? "";
if (arg === "-h" || arg === "--help") usage();
if (arg !== "") {
  console.error(`git-update: unknown argument: ${arg}`);
  console.error(`Usage: git-update
Fetch tags and pull the current branch when it is strictly behind its upstream.
When the remote history was rewritten (a fork sync), reset to it when the clone
has nothing unique, or replay local commits with rebase when it has.
Takes no arguments.`);
  process.exit(EXIT_MISUSE);
}

if (git(["rev-parse", "--is-inside-work-tree"]).status !== 0) {
  fail("Error: This is not a Git repository. Please navigate to a valid Git repo and try again.");
}

if (git(["fetch", "--tags"]).status !== 0) {
  fail("Error: git fetch failed; cannot safely classify a rewritten remote.");
}

// Determine the current branch
const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]).out.trim();
console.log(`On branch '${currentBranch}'.`);

// Check if the current branch has an upstream branch set
if (git(["rev-parse", "--abbrev-ref", "@{u}"]).status !== 0) {
  fail(
    `Error: No upstream branch is set for '${currentBranch}'.`,
    `Please set the upstream branch (e.g., 'git branch --set-upstream-to=origin/${currentBranch}') or switch branches.`,
  );
}

// Determine the commit differences between local and upstream
const localSha = git(["rev-parse", "@"]).out.trim();
const remoteSha = git(["rev-parse", "@{u}"]).out.trim();
const baseSha = git(["merge-base", "@", "@{u}"]).out.trim();
// Every action below targets the same ref the classification used.
const upstreamRef = remoteSha;

if (localSha === remoteSha) {
  console.log("Your branch is up to date with the remote.");
  process.exit(0);
} else if (localSha === baseSha) {
  console.log("Your branch is behind the remote. Ready to pull.");
} else if (remoteSha === baseSha) {
  console.log("Your branch is ahead of the remote.");
  console.log("Please push your local commits before pulling new changes.");
  process.exit(1);
} else {
  // Diverged. A rewritten remote (fork sync) makes this the normal case;
  // classify it before asking for manual intervention.
  const state = rewriteDetectState(".", currentBranch);
  if (state.verdict === "none") {
    console.log("Warning: Your branch and the remote have diverged.");
    console.log("Manual intervention is required.");
    console.log("Suggestion: run 'git pull --rebase' or manually merge your changes.");
    process.exit(1);
  }
  const pastTip = state.pastTip;
  // Uncommitted changes first: a reset would destroy them, and a rebase
  // refuses them anyway. Same refusal the update check makes.
  if (git(["status", "--porcelain"]).out.trim() !== "") {
    console.log(`The remote history of branch '${currentBranch}' was rewritten.`);
    console.log("Uncommitted changes detected. Commit or discard them first, then re-run git-update.");
    process.exit(1);
  }
  if (state.verdict === "clean") {
    console.log(`The remote history of branch '${currentBranch}' was rewritten; this clone has no unique commits.`);
    console.log(`Resetting to the rewritten origin/${currentBranch}...`);
    const reset = git(["reset", "--hard", upstreamRef]);
    if (reset.status !== 0) {
      fail(
        "Error: reset failed. Recovery: re-run git-update,",
        `or 'git reset --hard origin/${currentBranch}' manually.`,
      );
    }
    process.env.GIT_UPDATE_SCAN_BASE = pastTip;
    console.log(`Reset to origin/${currentBranch} complete.`);
    process.exit(0);
  }
  // diverged: unique local commits exist. A rebase replays them on the
  // rewritten history; refuse when the local side has merge commits
  // (a plain rebase would linearize that structure).
  const merges = git(["log", "--merges", "--format=%H", `${pastTip}..HEAD`]).out.trim();
  if (merges !== "") {
    console.log(`The remote history of branch '${currentBranch}' was rewritten, and local history`);
    console.log("contains merge commit(s), which a rebase would not preserve.");
    console.log("Manual intervention is required: rebase onto origin/" + currentBranch + " yourself");
    console.log("(consider --rebase-merges) or reset if the local work is disposable.");
    process.exit(1);
  }
  console.log(`The remote history of branch '${currentBranch}' was rewritten; replaying local commits on it...`);
  // --onto transplants exactly PAST_TIP..HEAD (the local work): a plain
  // rebase against the upstream would replay merge-base..HEAD, which on a
  // second rewrite resurrects upstream commits the rewrite discarded.
  const rebase = git(["rebase", "--onto", upstreamRef, pastTip]);
  if (rebase.status !== 0) {
    // Only abort when a rebase is actually in progress (a pre-rebase
    // failure would otherwise print "No rebase in progress" noise).
    const inMerge = spawnSync("git", ["rev-parse", "--git-path", "rebase-merge"], { encoding: "utf8" });
    const inApply = spawnSync("git", ["rev-parse", "--git-path", "rebase-apply"], { encoding: "utf8" });
    const mergePath = inMerge.stdout?.trim() ?? "";
    const applyPath = inApply.stdout?.trim() ?? "";
    const inProgress =
      (mergePath !== "" && existsGitPath(mergePath)) || (applyPath !== "" && existsGitPath(applyPath));
    if (inProgress) {
      git(["rebase", "--abort"]);
      console.log(`Rebase onto the rewritten origin/${currentBranch} conflicted; the rebase was aborted.`);
      console.log("Your branch is unchanged. Resolve manually:");
      console.log(`  git rebase --onto origin/${currentBranch} ${pastTip}   (resolve conflicts as they appear)`);
      console.log(`  or discard local commits: git reset --hard origin/${currentBranch}`);
    } else {
      console.error(`Rebase onto the rewritten origin/${currentBranch} failed to start; nothing changed.`);
    }
    process.exit(1);
  }
  process.env.GIT_UPDATE_SCAN_BASE = pastTip;
  console.log(`Replayed local commits on the rewritten origin/${currentBranch}.`);
  process.exit(0);
}

function existsGitPath(p: string): boolean {
  const r = spawnSync("test", ["-d", p]);
  return r.status === 0;
}

// Check for uncommitted changes
if (git(["status", "--porcelain"]).out.trim() !== "") {
  console.log("Uncommitted changes detected.");
  console.log("Please choose an option:");
  console.log("  1) Stash changes, pull updates, then reapply the stash");
  console.log("  2) Discard all local changes and pull updates (WARNING: This cannot be undone)");
  console.log("  3) Abort the update");
  console.error("Enter your choice (1/2/3): ");
  const choice = readLineStdin();

  if (choice === "1") {
    console.log("Stashing changes...");
    const stash = git(["stash", "push", "-u"]);
    if (stash.status !== 0) {
      console.error(stash.out);
      process.exit(stash.status);
    }
    // Pull failure does not skip the reapply: bash flagged the failure and
    // still restored the stash before exiting 1.
    console.log("Pulling updates...");
    const pull = git(["pull"]);
    let pullFailed = false;
    if (pull.status !== 0) {
      console.error("Error: 'git pull' failed. Please check the error messages above.");
      pullFailed = true;
    }
    console.log("Reapplying stashed changes...");
    const pop = git(["stash", "pop"]);
    if (pop.status !== 0) {
      console.error("Warning: Failed to automatically reapply stashed changes.");
      console.error("You may need to resolve conflicts manually.");
      process.exit(1);
    }
    if (pullFailed) {
      console.error("Update failed. Please resolve the issues and try again.");
      process.exit(1);
    }
  } else if (choice === "2") {
    console.log("Discarding local changes...");
    const discard = git(["reset", "--hard"]);
    if (discard.status !== 0) {
      console.error(discard.out);
      process.exit(discard.status);
    }
    console.log("Pulling updates...");
    const pull = git(["pull"]);
    if (pull.status !== 0) {
      console.error("Error: 'git pull' failed. Please check the error messages above.");
      console.error("Update failed. Please resolve the issues and try again.");
      process.exit(1);
    }
  } else if (choice === "3") {
    console.log("Aborting update.");
    process.exit(0);
  } else {
    console.log("Invalid option. Aborting update.");
    process.exit(1);
  }
} else {
  // Perform the pull operation
  console.log("Pulling updates...");
  const pull = git(["pull"]);
  if (pull.status !== 0) {
    console.error("Error: 'git pull' failed. Please check the error messages above.");
    console.error("Update failed. Please resolve the issues and try again.");
    process.exit(1);
  }
}

console.log("Repository update complete.");

function readLineStdin(): string {
  let buf = Buffer.alloc(0);
  const chunk = Buffer.alloc(1);
  while (true) {
    const idx = buf.indexOf(0x0a);
    if (idx !== -1) return buf.subarray(0, idx).toString("utf8").trim();
    let n = 0;
    try {
      n = readSync0(chunk);
    } catch {
      return "";
    }
    if (n <= 0) return buf.toString("utf8").trim();
    buf = Buffer.concat([buf, chunk.subarray(0, n)]);
  }
}

function readSync0(chunk: Buffer): number {
  return readSync(0, chunk, 0, 1, null);
}
