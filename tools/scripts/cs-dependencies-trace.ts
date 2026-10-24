// cs-dependencies-trace — trace reverse dependencies of a repo's packages.
// Port of cs-dependencies-trace.sh: optionally refresh the repo cache,
// ensure the dependency index is current, then output the reverse
// dependency tree — deduplicated and sorted — either grouped by repository
// or annotated with the consuming packages.

import { parseArgs } from "node:util";
import { existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { getReverseDependencyTree, refreshRepoCache } from "../lib/domain/cs/dependency-graph.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";

function showUsage(): never {
  console.log(`Usage: cs-dependencies-trace [TARGET_DIR] [OPTIONS]

Trace which cached repositories depend on the C# project(s) in TARGET_DIR
(default: current directory), via the org-package dependency index.

Options:
    -h, --help      Show this help message and exit
    -v, --version   Show version information and exit
    --by-repo       Group output by repository name instead of package
    --no-refresh    Skip refreshing the repository cache (use existing cache)

Examples:
    cs-dependencies-trace --no-refresh repos/lib.cs.services.chassis
    cs-dependencies-trace --no-refresh repos/lib.cs.common.essentials | grep '^0:'
    cs-dependencies-trace --by-repo --no-refresh repos/lib.cs.common.essentials
    cs-dependencies-trace --by-repo --no-refresh repos/lib.cs.common.essentials | cut -d: -f2 | sort -u

Exit Codes:
    0   Success
    1   General error
    3   Invalid arguments (no .sln or .csproj found)`);
  process.exit(0);
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", default: false },
    version: { type: "boolean", default: false },
    "by-repo": { type: "boolean", default: false },
    "no-refresh": { type: "boolean", default: false },
  },
  allowPositionals: true,
  strict: false,
});

// --help / --version are answered before any validation.
if (values.help) showUsage();
if (values.version) {
  console.log(SCRIPT_VERSION);
  process.exit(0);
}

const byRepo = values["by-repo"] === true;
const skipRefresh = values["no-refresh"] === true;

let targetDir = "";
for (const a of positionals) {
  if (targetDir === "") targetDir = a;
  else {
    logError("Too many arguments. Use --help for usage information.");
    process.exit(EXIT_MISUSE);
  }
}
targetDir = targetDir === "" ? "." : targetDir;

if (!existsSync(targetDir)) {
  logError(`Directory not found: ${targetDir}`);
  process.exit(EXIT_API_FAILURE);
}

// Validate: must have .sln or .csproj (non-test csproj counts, bash parity).
const hasSln = hasSlnFile(targetDir);
function hasSlnFile(dir: string): boolean {
  try {
    for (const e of readdirSync(dir)) if (e.endsWith(".sln")) return true;
    return false;
  } catch {
    return false;
  }
}
const csprojCount = countCsproj(targetDir);
if (csprojCount === 0 && !hasSln) {
  logError(`No .sln or .csproj files found in: ${targetDir}`);
  process.exit(EXIT_MISUSE);
}

const repoName = basename(targetDir);

// Step 1: refresh repo cache (unless --no-refresh).
if (!skipRefresh) {
  logInfo("Refreshing repository cache...");
  const rc = refreshRepoCache();
  if (rc === 2) logWarn("Some repositories failed to cache (continuing with partial cache)");
  else if (rc !== 0) {
    logError("Failed to refresh repository cache");
    process.exit(EXIT_GENERAL_ERROR);
  }
}

// Steps 2+3: the index is ensured inside getReverseDependencyIndex; output
// the tree deduplicated and sorted by depth.
try {
  const rows = getReverseDependencyTree(repoName);
  if (byRepo) {
    const lines = rows.map((r) => `${r.depth}:${r.repo}`);
    lines.sort((a, b) => {
      const [d1, r1] = [Number(a.split(":")[0]), a.split(":")[1] ?? ""];
      const [d2, r2] = [Number(b.split(":")[0]), b.split(":")[1] ?? ""];
      return d1 - d2 || r1.localeCompare(r2);
    });
    for (const line of new Set(lines)) console.log(line);
  } else {
    // depth:repo:packages — package names that consume the repo grouped per
    // (depth, repo) pair, then sorted (bash awk/sort pipeline parity).
    const byPair = new Map<string, Set<string>>();
    for (const r of rows) {
      const key = `${r.depth}:${r.repo}`;
      const set = byPair.get(key) ?? new Set<string>();
      set.add(r.packageRef);
      byPair.set(key, set);
    }
    const lines: string[] = [];
    for (const [key, pkgs] of byPair) for (const pkg of pkgs) lines.push(`${key}:${pkg}`);
    lines.sort((a, b) => a.localeCompare(b));
    for (const line of new Set(lines)) console.log(line);
  }
} catch (err) {
  logError(err instanceof Error ? err.message : String(err));
  process.exit(EXIT_GENERAL_ERROR);
}

function countCsproj(dir: string): number {
  let count = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "test" || e.name === "tests" || e.name === "obj" || e.name === "bin") continue;
      count += countCsproj(p);
    } else if (e.name.endsWith(".csproj")) count += 1;
  }
  return count;
}
