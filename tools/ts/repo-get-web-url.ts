#!/usr/bin/env node
// repo-get-web-url.ts - Get the web URL for a repository
// Version: 1.1.0
// Description: Outputs the web URL of the repository (normalizes SSH to
//              HTTPS) via the provider URL seam.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { toolCli } from "../lib/core/cli.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { remoteToWeb } from "../lib/providers/facade/urls.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";

function showUsage(): never {
  console.log(`Usage: repo-get-web-url [REPO_DIR]

Outputs the web URL of the repository (normalizes SSH to HTTPS) via the
provider URL seam.

Arguments:
    REPO_DIR    Repository path (default: current directory)

Options:
    -h, --help  Show this help message and exit
    -v, --version  Show version information and exit`);
  process.exit(0);
}

let cli: ReturnType<typeof toolCli>;
try {
  cli = toolCli({
    name: "repo-get-web-url",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
  });
} catch (err) {
  console.error(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}
if (cli.common.help) showUsage();
const repoDirArg = cli.positionals[0];

function gitOut(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync("git", args, { encoding: "utf8", cwd });
  return { status: r.status ?? 1, out: (r.stdout ?? "").trim() };
}

const repoDir = repoDirArg === undefined
  ? process.cwd()
  : isAbsolute(repoDirArg)
    ? repoDirArg
    : resolve(process.cwd(), repoDirArg);

if (!existsSync(repoDir)) {
  console.error(`Invalid repository folder: ${repoDir}`);
  process.exit(1);
}
if (gitOut(["rev-parse", "--is-inside-work-tree"], repoDir).status !== 0) {
  console.error(`Directory ${repoDir} is not a git repository.`);
  process.exit(1);
}

const remoteGet = gitOut(["config", "--get", "remote.origin.url"], repoDir);
if (remoteGet.status !== 0) {
  console.error(`No 'origin' remote configured in ${repoDir}.`);
  process.exit(1);
}
const remoteUrl = remoteGet.out;

// Host detection + normalization via the provider URL seam (async seam —
// awaited; the un-awaited call printed a pending Promise).
const repoUrl = await remoteToWeb(remoteUrl);
if (repoUrl !== null) {
  console.log(repoUrl);
} else {
  console.error("Not a GitHub repository.");
  process.exit(1);
}
