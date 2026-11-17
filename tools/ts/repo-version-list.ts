#!/usr/bin/env node
// repo-version-list.ts - List the repository's version tags with change type
// Version: 1.1.0
// Description: Prints one line per vX.Y.Z tag — change-type marker, commit
//              date, short hash, tag, subject. Must run inside a git repo.
//              Takes no arguments.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { gitCapture } from "../lib/core/git.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { getVersionChangeType } from "../lib/domain/release/version.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";

function usage(): never {
  console.log(`Usage: repo-version-list

List the repository's version tags with change type. Prints one line per
vX.Y.Z tag — change-type marker, commit date, short hash, tag, subject.
Takes no arguments; must run inside a git repository.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
  process.exit(0);
}

try {
  const cli = toolCli({
    name: "repo-version-list",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    allowPositionals: false,
  });
  if (cli.common.help) usage();
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

const GRAY = "\x1b[1;30m";
const LIGHT_BLUE = "\x1b[1;36m";
const RED = "\x1b[1;31m";
const YELLOW = "\x1b[1;33m";
const GREEN = "\x1b[1;32m";
const BLUE = "\x1b[1;34m";
const RESET = "\x1b[0m";

function git(args: string[]): { status: number; out: string } {
  return gitCapture(null, args);
}

if (git(["rev-parse", "--is-inside-work-tree"]).status !== 0) {
  console.error("This script must be run inside a Git repository.");
  process.exit(1);
}

// Two git processes in total, whatever the tag count: one lists the tags in
// version order with the commit each points at (peeled through annotated
// tags), one prints the facts of all those commits.
const US = "\x1f";
const tagRows = git([
  "for-each-ref",
  "--sort=version:refname",
  `--format=%(refname:short)${US}%(if)%(*objectname)%(then)%(*objectname)%(else)%(objectname)%(end)`,
  "refs/tags/v*",
]).out
  .split("\n")
  .filter((l) => l !== "")
  .map((l) => l.split(US) as [string, string]);
if (tagRows.length === 0) {
  console.error("No version tags found in the repository.");
  process.exit(0);
}
const uniqueHashes = [...new Set(tagRows.map(([, hash]) => hash))];
const facts = new Map<string, { date: string; short: string; title: string }>();
for (const line of git(["show", "-s", "--format=%H" + US + "%ci" + US + "%h" + US + "%s", ...uniqueHashes]).out.split("\n")) {
  const [hash, ci, short, ...title] = line.split(US);
  if (hash !== undefined && ci !== undefined && short !== undefined) {
    facts.set(hash, { date: ci, short, title: title.join(US) });
  }
}

let firstCommit = true;
for (const [tag, commitHash] of tagRows) {
  const fact = facts.get(commitHash);
  // "YYYY-MM-DD HH:MM:SS +ZZZZ" → "YYYY-MM-DD HH:MM"
  const dateTime = (fact?.date ?? "").split(" ").slice(0, 2).join(" ");
  const commitDate = dateTime.split(":").slice(0, 2).join(":");
  const shortHash = fact?.short ?? "";
  const title = fact?.title ?? "";
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
