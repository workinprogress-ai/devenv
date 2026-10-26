// cs-nuget-publish-local — restore/build/pack every csproj and push to the
// local NuGet feed. Port of cs-nuget-publish-local.sh: walk <target> for
// .csproj (skipping /test/ projects), restore + build + pack each with the
// computed version, copy packages into $DEVENV_ROOT/.debug/local-nuget-dev,
// then clear the caches of the pushed packages (so the next restore sees the
// new bits). Default version comes from the repo's calculated next version
// (domain/release/version — the repo-calc-version lib, not the tool).

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { calculateNextVersion, getLatestVersionTag } from "../lib/domain/release/version.ts";
import { selfRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

const devenvRoot = process.env.DEVENV_ROOT ?? selfRoot(process.cwd());

function findCsprojFiles(dir: string, depth: number): string[] {
  if (depth > 8) return [];
  const found: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "bin" || e.name === "obj") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) found.push(...findCsprojFiles(p, depth + 1));
    else if (e.name.endsWith(".csproj")) found.push(p);
  }
  return found;
}

function run(cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  return r.status === 0;
}

function main(): void {
  const argv = process.argv.slice(2);
  const target = argv[0] ?? process.cwd();
  const version = argv[1] ?? calculateNextVersion(getLatestVersionTag());
  const releaseConfig = argv[2] ?? "Debug";

  const csprojFiles = findCsprojFiles(target, 0);
  if (csprojFiles.length === 0) {
    console.log(`Ooops! No csproj found in the specified directory (${target})!`);
    process.exit(1);
  }

  const publishDir = mktempDir();
  console.log(`Publishing to ${publishDir}`);
  console.log(`Publishing version ${version}`);

  for (const csproj of csprojFiles) {
    if (csproj.includes("/test/")) {
      console.log(`Skipping ${csproj}`);
      console.log("");
      continue;
    }

    console.log("");
    console.log("-------------------------------------");
    console.log(`Restoring ${csproj}`);
    console.log("");
    if (!run("dotnet", ["restore", csproj, "--no-cache"])) process.exit(1);

    console.log("");
    console.log("-------------------------------------");
    console.log(`Building ${csproj}`);
    console.log("");
    if (
      !run("dotnet", [
        "build", csproj,
        "-c", releaseConfig,
        "--no-restore",
        `-p:Version=${version}`,
        `-p:AssemblyVersion=${version}`,
        `-p:FileVersion=${version}`,
        "-p:DebugType=portable",
        "-p:DebugSymbols=true",
      ])
    ) {
      process.exit(1);
    }

    console.log("");
    console.log("-------------------------------------");
    console.log(`Packing ${csproj}`);
    console.log("");
    if (
      !run("dotnet", [
        "pack", csproj,
        "--include-symbols", "--include-source", "--no-build",
        "-c", releaseConfig,
        "-o", publishDir,
        `-p:Version=${version}`,
        `-p:AssemblyVersion=${version}`,
      ])
    ) {
      process.exit(1);
    }
  }

  console.log("");
  console.log("-------------------------------------");
  console.log("Pushing packages");
  const localFeedDir = join(devenvRoot, ".debug", "local-nuget-dev");
  try {
    mkdirSync(localFeedDir, { recursive: true });
    for (const pattern of [".nupkg", ".snupkg"]) {
      for (const f of readdirSync(publishDir)) {
        if (f.endsWith(pattern)) cpSync(join(publishDir, f), join(localFeedDir, f));
      }
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Clear the caches of the pushed packages so the next restore picks up the
  // new bits (same rule as cs-nuget-clear-local).
  const packages = new Set<string>();
  for (const f of readdirSync(localFeedDir)) {
    let m = /^(.+)\.\d+\.\d+\.\d+\.nupkg$/.exec(f);
    if (m === null) {
      // Fallback (bash parity): strip a trailing 2-part or prerelease
      // version (name.1.2 or name.1.2.3-beta) when the strict 3-part form
      // does not match.
      const base = f.replace(/\.nupkg$/, "");
      m = [f, base.replace(/\.\d+(\.\d+)*$/, "")] as unknown as RegExpExecArray;
    }
    if (m !== null && m[1] !== undefined) packages.add(m[1].toLowerCase());
  }
  const home = process.env.HOME ?? "";
  let hadError = false;
  for (const pkg of packages) {
    const cacheDir = join(home, ".nuget", "packages", pkg);
    if (existsSync(cacheDir)) {
      console.log(`Removing previous cache for package: ${pkg}`);
      try {
        rmSync(cacheDir, { recursive: true, force: true });
      } catch {
        console.error(`WARNING: Failed to remove cache for package: ${pkg}`);
        hadError = true;
      }
    }
  }

  // Cleanup: remove the temporary publish directory (bash EXIT trap).
  console.error(`Cleaning up temporary publish directory: ${publishDir}`);
  rmSync(publishDir, { recursive: true, force: true });

  if (hadError) {
    console.error("WARNING: Some packages may not have been removed from the cache.");
    console.error("Suggest running: dotnet nuget locals all --clear");
  }
}

function mktempDir(): string {
  const base = join(process.env.TMPDIR ?? "/tmp", "cs-publish-");
  for (let i = 0; i < 1000; i++) {
    const candidate = `${base}${Date.now()}-${i}`;
    if (!existsSync(candidate)) {
      mkdirSync(candidate, { recursive: true });
      return candidate;
    }
  }
  throw new Error("could not create a temp publish dir");
}

main();
