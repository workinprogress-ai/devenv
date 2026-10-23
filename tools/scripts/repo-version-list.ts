#!/usr/bin/env node
// repo-version-list.ts - List the repository's version tags with change type
// Version: 1.1.0
// Description: Prints one line per vX.Y.Z tag — change-type marker, commit
//              date, short hash, tag, subject. Must run inside a git repo.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { getVersionChangeType } from "../lib/domain/release/version.ts";

assertNodeFloor();

const GRAY = "\x1b[1;30m";
const LIGHT_BLUE = "\x1b[1;36m";
const RED = "\x1b[1;31m";
const YELLOW = "\x1b[1;33m";
const GREEN = "\x1b[1;32m";
const BLUE = "\x1b[1;34m";
const RESET = "\x1b[0m";

function git(args: string[]): { status: number; out: string } {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { status: r.status ?? 1, out: r.stdout ?? "" };
}

if (git(["rev-parse", "--is-inside-work-tree"]).status !== 0) {
  console.error("This script must be run inside a Git repository.");
  process.exit(1);
}

const tags = git(["tag", "-l", "v*"]).out.trim();
if (tags === "") {
  console.error("No version tags found in the repository.");
  process.exit(0);
}

let firstCommit = true;
for (const tag of tags.split("\n")) {
  if (tag === "") continue;
  const commitHash = git(["rev-list", "-n", "1", tag]).out.trim();
  // cut -d' ' -f1,2 then cut -d':' -f1,2 → "YYYY-MM-DD HH:MM"
  const dateRaw = git(["show", "-s", "--format=%ci", commitHash]).out.trim();
  const dateTime = dateRaw.split(" ").slice(0, 2).join(" ");
  const commitDate = dateTime.split(":").slice(0, 2).join(":");
  const shortHash = git(["show", "-s", "--format=%h", commitHash]).out.trim();
  const title = git(["show", "-s", "--format=%s", commitHash]).out.trim();
  const version = tag.replace(/^v/, "");

  let changeType: string;
  let tagColor: string;
  if (firstCommit) {
    changeType = "🔷";
    tagColor = LIGHT_BLUE;
    firstCommit = false;
  } else {
    changeType = getVersionChangeType(version);
    tagColor = RED;
    if (changeType === "🟡") tagColor = YELLOW;
    if (changeType === "🟢") tagColor = GREEN;
  }

  console.log(`${changeType} ${GRAY}${commitDate}${RESET} | ${LIGHT_BLUE}${shortHash}${RESET} | ${tagColor}${tag}${RESET} | ${BLUE}${title}${RESET}`);
}
