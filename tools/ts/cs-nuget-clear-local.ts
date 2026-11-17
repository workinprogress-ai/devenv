// cs-nuget-clear-local — clear the local NuGet feed + package caches.
// For every package in the local feed
// ($DEVENV_ROOT/.debug/local-nuget-dev), remove its ~/.nuget/packages cache
// entry (version suffix stripped), then empty the feed folder. Cache-removal
// failures are warnings; the tool never hard-fails on them (bash parity).

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { selfRoot } from "../lib/core/self-root.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { packageIdFromNupkgName } from "../lib/domain/cs/csproj.ts";

assertNodeFloor();

try {
  const cli = toolCli({
    name: "cs-nuget-clear-local",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    allowPositionals: false,
  });
  if (cli.common.help) {
    console.log(`Usage: cs-nuget-clear-local

Clear the local NuGet feed (.debug/local-nuget-dev) and each package's
~/.nuget/packages cache entry. Cache-removal failures are warnings. Takes
no arguments.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
    process.exit(0);
  }
} catch (err) {
  console.error(errorMessage(err));
  process.exit(EXIT_MISUSE);
}

const devenvRoot = process.env.DEVENV_ROOT ?? selfRoot(import.meta.url);
const localFeedDir = join(devenvRoot, ".debug", "local-nuget-dev");

if (!existsSync(localFeedDir)) {
  console.log(`Local NuGet feed directory does not exist: ${localFeedDir}`);
  process.exit(1);
}

// Package names: *.nupkg basenames with the version (including any
// prerelease or build suffix) stripped, lowercased, unique.
const packages = new Set<string>();
for (const e of readdirSync(localFeedDir, { withFileTypes: true })) {
  if (e.isFile() && e.name.endsWith(".nupkg")) {
    const id = packageIdFromNupkgName(e.name);
    if (id === null) console.error(`WARNING: cannot read a package id from ${e.name}; its cache entry is not cleared`);
    else packages.add(id.toLowerCase());
  }
}

let hadError = false;

// Clear the NuGet cache for each package.
const home = process.env.HOME ?? "";
for (const pkg of packages) {
  const cacheDir = join(home, ".nuget", "packages", pkg);
  if (existsSync(cacheDir)) {
    console.log(`Removing cache for package: ${pkg}`);
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {
      console.error(`WARNING:  Failed to remove cache for package: ${pkg}`);
      hadError = true;
    }
  } else {
    console.log(`No cache found for package: ${pkg}`);
  }
}

// Clear the local NuGet feed folder.
console.log(`Clearing local NuGet feed folder: ${localFeedDir}`);
try {
  for (const e of readdirSync(localFeedDir)) {
    rmSync(join(localFeedDir, e), { recursive: true, force: true });
  }
} catch {
  console.error(`WARNING: Failed to clear local NuGet feed folder: ${localFeedDir}`);
  console.error("Please try again or manually delete the contents of the folder.");
}

if (hadError) {
  console.error("WARNING: Some packages may not have been removed from the cache.");
  console.error("Suggest running: dotnet nuget locals all --clear");
}
