// repo-cache-deepen — fetch-only deepening of a cached repository.
// Port of repo-cache-deepen.sh: extends shallow history and/or fetches
// branches as remote refs. Never checks out. Additive and idempotent.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { repoCacheDir } from "../lib/domain/cs/dependency-graph.ts";

assertNodeFloor();

const DEFAULT_DEPTH = 200;

function usage(): never {
  console.log(`Usage: repo-cache-deepen --repo <name> [--depth N] [--branch <b>]...

Fetch-only deepening of a cached repository. Extends shallow-clone history
and/or fetches additional branches as remote refs. The working copy is never
checked out — it stays on the default branch; branches land as
refs/remotes/origin/<branch>.

Options:
    --repo <name>       Repository name in the cache (required)
    --depth N           Deepen history to N commits per branch (default: ${DEFAULT_DEPTH})
    --branch <b>        Fetch branch <b> as a remote ref (repeatable)
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

Exit Codes:
    0   Success
    1   Error (unknown repo, missing arguments, fetch failure)

Examples:
    # Deepen one repo's history to the default depth
    repo-cache-deepen --repo lib.cs.services.bulk-sync

    # Deepen to 500 commits and fetch two feature branches
    repo-cache-deepen --repo service.reqord.identity --depth 500 \\
        --branch issue-42-query-progress --branch issue-57-audit`);
  process.exit(0);
}

const argv = process.argv.slice(2);
let repo = "";
let depth = String(DEFAULT_DEPTH);
const branches: string[] = [];
try {
  const cli = toolCli({
    name: "repo-cache-deepen",
    version: "1.0.0",
    argv,
    noDryRun: true,
    options: {
      repo: { type: "string" },
      depth: { type: "string" },
      branch: { type: "string", multiple: true },
    },
    allowPositionals: false,
  });
  if (cli.common.help) usage();
  const v = cli.values as Record<string, string | boolean | string[] | undefined>;
  repo = ((v["repo"] as string | undefined) ?? "");
  depth = ((v["depth"] as string | undefined) ?? String(DEFAULT_DEPTH));
  branches.push(...((v["branch"] ?? []) as string[]));
} catch (err) {
  logError(err instanceof Error ? err.message : String(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

if (repo === "") { logError("--repo is required"); process.exit(EXIT_MISUSE); }
if (!/^[0-9]+$/.test(depth)) {
  logError(`--depth must be a positive integer, got: ${depth}`);
  process.exit(EXIT_MISUSE);
}

const cache = repoCacheDir();
const repoDir = join(cache, repo);
if (!existsSync(`${repoDir}/.git`)) {
  logError(`Repository '${repo}' not found in cache (${cache}). Run repo-cache-update first.`);
  process.exit(EXIT_GENERAL_ERROR);
}

// Step 1: deepen history (fetch-only; never checks out).
logInfo(`Deepening ${repo} history to depth ${depth}...`);
const deepen = spawnSync("git", ["-C", repoDir, "fetch", `--deepen=${depth}`, "origin"], { stdio: "ignore" });
if (deepen.status !== 0) {
  logError(`Failed to deepen history for ${repo}`);
  process.exit(EXIT_GENERAL_ERROR);
}

// Step 2: fetch requested branches as remote refs (never checks out).
for (const branch of branches) {
  if (branch === "") continue;
  logInfo(`Fetching branch ${branch} of ${repo} as a remote ref...`);
  const r = spawnSync("git", ["-C", repoDir, "fetch", "origin", `+${branch}:refs/remotes/origin/${branch}`], { stdio: "ignore" });
  if (r.status !== 0) {
    logError(`Failed to fetch branch '${branch}' for ${repo}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
}

logInfo(`Deepened ${repo} in ${repoDir} (working copy untouched)`);
