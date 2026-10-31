// repo-cache-update — refresh the C# repository cache and dependency index.
// Port of repo-cache-update.sh over lib/domain/cs/dependency-graph.ts.
// Prints the cache directory path on stdout.

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import {
  repoCacheDir, csDepOrgPrefix, ensureDependencyIndex, refreshRepoCache,
} from "../lib/domain/cs/dependency-graph.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: repo-cache-update [OPTIONS]

Refresh the C# repository cache and dependency index, then print the cache
directory path on stdout.

All organization repositories are cloned (or updated) as shallow single-branch
clones. The dependency index is rebuilt whenever the cache has changed.

Options:
    -h, --help          Show this help message and exit
    -v, --version       Show version information and exit
    --no-refresh        Skip refreshing the repository cache (rebuild index only)

Exit Codes:
    0   Success — cache directory path printed on stdout
    1   General error
    2   Partial cache failure (some repos failed, index still built)`);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();
if (argv.includes("-v") || argv.includes("--version")) {
  console.log("1.0.0");
  process.exit(0);
}

let skipRefresh = false;
for (const a of argv) {
  if (a === "--no-refresh") skipRefresh = true;
  else {
    logError(`Unknown option: ${a}. Use --help for usage information.`);
    process.exit(EXIT_MISUSE);
  }
}

// Step 1: refresh the repo cache (clone / update all org repos).
// 0 ok · 2 partial (some repos failed; the index still builds) · 1 failure.
if (!skipRefresh) {
  logInfo("Refreshing repository cache...");
  const rc = await refreshRepoCache();
  if (rc === 2) {
    logWarn("Some repositories failed to cache (continuing with partial cache)");
  } else if (rc !== 0) {
    process.exit(1);
  }
}

// Step 2: ensure the dependency index is current. A fork with no C# packages
// sets no prefix: the cache refresh is complete without an index — say so.
if (csDepOrgPrefix() === "") {
  logWarn("Skipping the dependency index: no organization package prefix (set [nuget] package_prefix in devenv.config to build it); an index built earlier is left as it is");
} else {
  logInfo("Building dependency index...");
  try {
    ensureDependencyIndex();
  } catch (err) {
    logError(`Failed to build dependency index: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

// Step 3: print the cache directory path.
console.log(repoCacheDir());
