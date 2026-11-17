// ci-build-local — build the current repo's container image into the local
// Docker cache, mirroring how CI builds it. Generic over any Dockerfile-bearing
// repo: it resolves the version from git (same domain/release/version lib as
// cs-nuget-publish-local), detects a root Dockerfile, and passes GitHub
// Packages NuGet credentials as a BuildKit secret when the repo has no
// committed nuget.config (the service-template Dockerfile registers the source
// from the secret inside the build). Never pushes — local cache only.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { calculateNextVersion, getLatestVersionTag } from "../lib/domain/release/version.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";

function usage(): never {
  console.log(`Usage: ci-build-local [TARGET_DIR [VERSION]]

Build the container image for the repo at TARGET_DIR into the local Docker
cache, tagged <repo-name>:<version> and <repo-name>:local. The build mirrors
CI: BuildKit secret auth for GitHub Packages NuGet restore, no push.

Arguments:
    TARGET_DIR      Directory containing a Dockerfile (default: cwd)
    VERSION         Image version tag (default: calculated next version;
                    0.0.0-dev when the repo has no version tags yet)

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

Exit codes:
    0 success
    1 no Dockerfile found / docker build failed
    2 bad arguments
    3 no GitHub Packages token available (set NUGET_TOKEN or run gh auth)`);
  process.exit(0);
}

function run(cmd: string, args: string[]): string | null {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").trim() : null;
}

function main(): void {
  let argv: string[] = [];
  try {
    const cli = toolCli({
      name: "ci-build-local",
      version: SCRIPT_VERSION,
      argv: process.argv.slice(2),
      noDryRun: true,
    });
    if (cli.common.help) usage();
    argv = cli.positionals;
  } catch (err) {
    console.error(errorMessage(err));
    console.log("Use --help for usage information");
    process.exit(2);
  }

  const target = resolve(argv[0] ?? process.cwd());
  if (!existsSync(`${target}/Dockerfile`)) {
    console.error(`No Dockerfile found in ${target} — nothing to build.`);
    process.exit(1);
  }

  let version: string;
  if (argv[1]) {
    version = argv[1];
  } else {
    // The shared version lib shells out to git in the process cwd — chdir to
    // the target repo so tag listing and the bump walk both read the target's
    // history, never the invoking directory's.
    process.chdir(target);
    const latest = getLatestVersionTag();
    version = latest === "" ? "0.0.0-dev" : calculateNextVersion(latest);
  }

  // Token resolution order: existing NUGET_TOKEN env var, then the gh CLI.
  // Never build a private-package image that silently cannot restore.
  let nugetToken = process.env.NUGET_TOKEN ?? "";
  if (nugetToken === "") {
    nugetToken = run("gh", ["auth", "token"]) ?? "";
  }
  if (nugetToken === "") {
    console.error(
      "No GitHub Packages token available (NUGET_TOKEN unset and `gh auth token` failed). " +
        "Authenticate with gh or export NUGET_TOKEN, then retry."
    );
    process.exit(3);
  }

  const name = basename(target).toLowerCase();
  const buildArgs = [
    "build",
    "--secret", "id=nuget_token,env=CI_BUILD_LOCAL_NUGET_TOKEN",
    "-t", `${name}:${version}`,
    "-t", `${name}:local`,
    target,
  ];

  console.log(`Building ${name}:${version} (+ :local) from ${target}`);
  const build = spawnSync("docker", buildArgs, {
    stdio: "inherit",
    env: { ...process.env, CI_BUILD_LOCAL_NUGET_TOKEN: nugetToken, DOCKER_BUILDKIT: "1" },
  });
  if (build.status !== 0) {
    console.error("docker build failed");
    process.exit(1);
  }
  console.log(`Built ${name}:${version} and ${name}:local`);
}

main();
