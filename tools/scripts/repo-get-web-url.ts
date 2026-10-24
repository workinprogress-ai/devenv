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
import { remoteToWeb } from "../lib/providers/github/urls.ts";

assertNodeFloor();

function gitOut(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync("git", args, { encoding: "utf8", cwd });
  return { status: r.status ?? 1, out: (r.stdout ?? "").trim() };
}

function gitOut2(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync("git", args, { encoding: "utf8", cwd });
  return { status: r.status ?? 1, out: (r.stdout ?? "").trim() };
}

const repoDirArg = process.argv[2];
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

const remoteGet = gitOut2(["config", "--get", "remote.origin.url"], repoDir);
if (remoteGet.status !== 0) {
  console.error(`No 'origin' remote configured in ${repoDir}.`);
  process.exit(1);
}
const remoteUrl = remoteGet.out;

// Host detection + normalization via the provider URL seam.
const repoUrl = remoteToWeb(remoteUrl);
if (repoUrl !== null) {
  console.log(repoUrl);
} else {
  console.error("Not a GitHub repository.");
  process.exit(1);
}
