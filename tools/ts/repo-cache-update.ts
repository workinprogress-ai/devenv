// repo-cache-update — refresh the C# repository cache and dependency index.
// Port of repo-cache-update.sh over lib/domain/cs/dependency-graph.ts.
// Prints the cache directory path on stdout.

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
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
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
    --no-refresh        Skip refreshing the repository cache (rebuild index only)

Exit Codes:
    0   Success — cache directory path printed on stdout
    1   General error
    2   Invalid arguments
    4   Partial cache failure (some repos failed; the index is still built and
        the cache directory path is still printed on stdout)`);
  process.exit(0);
}

const SCRIPT_VERSION = "1.0.0";

let skipRefresh = false;
try {
  const cli = toolCli({
    name: "repo-cache-update",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      "no-refresh": { type: "boolean", default: false },
    },
  });
  if (cli.common.help) usage();
  skipRefresh = cli.values["no-refresh"] === true;
} catch (err) {
  logError(err instanceof Error ? err.message : String(err));
  console.log("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

// Step 1: refresh the repo cache (clone / update all org repos).
// refreshRepoCache returns 0 ok · 2 partial (some repos failed; the index
// still builds, and the run ends with the API-failure code) · other failure.
let partialCache = false;
if (!skipRefresh) {
  logInfo("Refreshing repository cache...");
  const rc = await refreshRepoCache();
  if (rc === 2) {
    logWarn("Some repositories failed to cache (continuing with partial cache)");
    partialCache = true;
  } else if (rc !== 0) {
    process.exit(EXIT_GENERAL_ERROR);
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
    process.exit(EXIT_GENERAL_ERROR);
  }
}

// Step 3: print the cache directory path.
console.log(repoCacheDir());
if (partialCache) process.exit(EXIT_API_FAILURE);
