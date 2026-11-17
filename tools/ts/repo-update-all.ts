#!/usr/bin/env node
// repo-update-all.ts - Update all repositories in the repos directory
// Version: 1.1.0
// Description: Runs repo-get for every local repository under
//              $DEVENV_ROOT/repos, in parallel (default 2 jobs, max 4).
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { siblingInvocation } from "../lib/core/sibling.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

const MAX_PARALLEL_JOBS = 4;
const DEFAULT_PARALLEL_JOBS = 2;
const SCRIPT_VERSION = "1.1.0";

let parallelJobs = DEFAULT_PARALLEL_JOBS;
try {
  const cli = toolCli({
    name: "repo-update-all",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    allowPositionals: false,
    options: {
      jobs: { type: "string", short: "j", default: String(DEFAULT_PARALLEL_JOBS) },
    },
  });
  if (cli.common.help) {
    console.log(`Usage: repo-update-all [-j, --jobs N]
Update all repositories in repos directory in parallel (default ${DEFAULT_PARALLEL_JOBS} jobs, max ${MAX_PARALLEL_JOBS}).

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
  -j, --jobs N             Parallel repo-get jobs (default: ${DEFAULT_PARALLEL_JOBS})`);
    process.exit(0);
  }
  const jobsRaw = typeof cli.values.jobs === "string" ? cli.values.jobs : String(DEFAULT_PARALLEL_JOBS);
  if (!/^[0-9]+$/.test(jobsRaw)) {
    logError("--jobs requires a numeric argument");
    process.exit(1);
  }
  parallelJobs = Number(jobsRaw);
  // A zero pool never launches a job and never fires the completion tail:
  // the await hangs forever with no output (bash xargs -P 0 meant
  // UNLIMITED — not honored here; the TS pool floors at 1 implicitly by
  // refusing 0).
  if (parallelJobs === 0) {
    logError("--jobs 0 would deadlock the spawn pool (use 1 or more)");
    process.exit(1);
  }
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

if (parallelJobs > MAX_PARALLEL_JOBS) {
  console.error(`WARNING: Requested ${parallelJobs} jobs, limiting to ${MAX_PARALLEL_JOBS}.`);
  parallelJobs = MAX_PARALLEL_JOBS;
}

// Get repos directory (DEVENV_ROOT is self-derived by the bootstrap chain).
const devenvRoot = process.env.DEVENV_ROOT ?? "";
if (devenvRoot === "") {
  console.error("ERROR: DEVENV_ROOT is not established");
  process.exit(1);
}
const reposDir = join(devenvRoot, "repos");
if (!existsSync(reposDir)) {
  try {
    mkdirSync(reposDir, { recursive: true });
  } catch {
    console.error(`ERROR: Failed to create repositories directory: ${reposDir}`);
    process.exit(1);
  }
}
if (!statSync(reposDir).isDirectory()) {
  console.error("ERROR: Could not access repos directory");
  process.exit(1);
}

// List local repositories (directories only).
const repoList = readdirSync(reposDir)
  .filter((name) => {
    try {
      return statSync(join(reposDir, name)).isDirectory();
    } catch {
      return false; // entry vanished mid-scan (concurrent repo-get) — skip it
    }
  })
  .sort();

if (repoList.length === 0) {
  console.error(`No git repositories found in ${reposDir}`);
  process.exit(0);
}

console.error(`Updating ${repoList.length} repositories with ${parallelJobs} parallel jobs...`);
const startTime = Date.now();

let cursor = 0;
let exitCode = 0;
let active = 0;

function updateSingleRepo(repoName: string): Promise<number> {
  return new Promise((resolveOne) => {
    const repoPath = join(reposDir, repoName);
    console.error(`[${repoName}] Starting update...`);
    // pipefail analogue: repo-get's exit status decides, never the sed pipe.
    const get = siblingInvocation("repo-get", []);
    const child = spawn(get.command, get.args, { cwd: repoPath });
    // Both streams stream live through the [repo] prefixer (clone progress
    // visible; bash's sed-pipe equivalent).
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("data", (d: Buffer) => {
        for (const line of d.toString().split("\n")) {
          if (line !== "") console.error(`[${repoName}] ${line}`);
        }
      });
    }
    child.on("error", () => {
      console.error(`[${repoName}] ✗ Update failed`);
      resolveOne(1);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        console.error(`[${repoName}] ✗ Update failed`);
        resolveOne(1);
        return;
      }
      console.error(`[${repoName}] ✓ Update completed`);
      resolveOne(0);
    });
  });
}

await new Promise<void>((resolveAll) => {
  const launchNext = (): void => {
    while (active < parallelJobs && cursor < repoList.length) {
      const name = repoList[cursor] ?? "";
      cursor++;
      active++;
      void updateSingleRepo(name).then((code: number) => {
        if (code !== 0) exitCode = code;
        active--;
        if (cursor >= repoList.length && active === 0) resolveAll();
        else launchNext();
      });
    }
    if (cursor >= repoList.length && active === 0) resolveAll();
  };
  launchNext();
});

console.error("");
console.error(`All repositories processed in ${Math.round((Date.now() - startTime) / 1000)}s using ${parallelJobs} parallel jobs.`);

process.exit(exitCode);
