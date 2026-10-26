// cs-nuget-clear-local — clear the local NuGet feed + package caches.
// Port of cs-nuget-clear-local.sh: for every package in the local feed
// ($DEVENV_ROOT/.debug/local-nuget-dev), remove its ~/.nuget/packages cache
// entry (version suffix stripped), then empty the feed folder. Cache-removal
// failures are warnings; the tool never hard-fails on them (bash parity).

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { selfRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

const devenvRoot = process.env.DEVENV_ROOT ?? selfRoot(process.cwd());
const localFeedDir = join(devenvRoot, ".debug", "local-nuget-dev");

if (!existsSync(localFeedDir)) {
  console.log(`Local NuGet feed directory does not exist: ${localFeedDir}`);
  process.exit(1);
}

// Package names: *.nupkg basenames with the version suffix stripped
// (name.version.revision.patch.nupkg → name), lowercased, unique.
const packages = new Set<string>();
for (const e of readdirSync(localFeedDir, { withFileTypes: true })) {
  if (e.isFile() && e.name.endsWith(".nupkg")) {
    let m = /^(.+)\.\d+\.\d+\.\d+\.nupkg$/.exec(e.name);
    if (m === null) {
      // Fallback (bash parity): strip a trailing 2-part or prerelease
      // version when the strict 3-part form does not match.
      const base = e.name.replace(/\.nupkg$/, "");
      m = [e.name, base.replace(/\.\d+(\.\d+)*$/, "")] as unknown as RegExpExecArray;
    }
    if (m !== null && m[1] !== undefined) packages.add(m[1].toLowerCase());
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
