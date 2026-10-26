#!/usr/bin/env node
// repo-update-all.ts - Update all repositories in the repos directory
// Version: 1.1.0
// Description: Runs repo-get for every local repository under
//              $DEVENV_ROOT/repos, in parallel (default 2 jobs, max 4).
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodeFloor } from "../lib/core/node-floor.ts";

assertNodeFloor();

const toolsDir = dirname(dirname(fileURLToPath(import.meta.url)));
const MAX_PARALLEL_JOBS = 4;
const DEFAULT_PARALLEL_JOBS = 2;

let parallelJobs = DEFAULT_PARALLEL_JOBS;
const argv = process.argv.slice(2);
while (argv.length > 0) {
  const arg = argv.shift() ?? "";
  if (arg === "-j" || arg === "--jobs") {
    const v = argv.shift() ?? "";
    if (!/^[0-9]+$/.test(v)) {
      console.error("ERROR: --jobs requires a numeric argument");
      process.exit(1);
    }
    parallelJobs = Number(v);
  } else if (arg === "-h" || arg === "--help") {
    console.log("Usage: repo-update-all [--jobs N]\nUpdate all repositories in repos directory in parallel.");
    process.exit(0);
  } else {
    console.error(`ERROR: Unknown option: ${arg}`);
    process.exit(1);
  }
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
    const child = spawn("node", [join(toolsDir, "scripts", "repo-get.ts")], { cwd: repoPath });
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
