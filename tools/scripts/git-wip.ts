#!/usr/bin/env node
// git-wip.ts - stage everything and push a WIP snapshot commit.
// Version: 1.1.0
// Description: WIP snapshots are throwaway checkpoints by design — the commit
//              is created with `git commit -n`, bypassing pre-commit/commit-msg
//              hooks (intentional, like the bash original: requiring WIP
//              snapshots to pass commitlint would defeat their purpose; normal
//              commits must always go through hooks).
//
//              Message input: positional args (joined with spaces) or
//              --file <path> for a pre-written message (used verbatim after
//              the WIP: prefix). --file and positional args are mutually
//              exclusive.
//
//              Failure is loud: a failed commit or push exits non-zero, and
//              refs/wip/last moves only after the push succeeded.
//
//              Scratchpad refusal (two layers, scratchpad.bash's contract):
//              Layer 1 — state: blocked while a scratchpad is active in this
//              repo (the WIP commit would land on the scratch branch and be
//              pushed). Layer 2 — branch: blocked on any scratchpad/* branch
//              even without state refs (defense-in-depth; scratch commits
//              carry no trailers). Each layer emits its own ratified message.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

const SCRATCHPAD_BRANCH_PREFIX = "scratchpad/";
const SCRATCHPAD_STATE_REF = "refs/scratchpad/state";

function git(args: string[]): { status: number; out: string } {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function usage(): never {
  console.log(`Usage: git-wip [--staged-only] [--file <path>] ["<message words...>"]

Stage everything (or --staged-only to skip staging) and push a WIP snapshot
commit prefixed with "WIP: ".

  --staged-only   Do not run \`git add -A\`; commit the existing index.
  --file <path>   Read the message from a file (used verbatim after the
                  WIP: prefix). Mutually exclusive with positional words.`);
  process.exit(0);
}

// --- scratchpad refusal (mirror of scratchpad.bash's two-layer contract) ---

function scratchpadRefuse(tool: string, slug: string): never {
  console.error(
    `Error: ${tool} is blocked while a scratchpad is active (${slug || "scratchpad branch"}).\n` +
      "Salvage: repo-scratchpad promote <sha> · or leave the mode: repo-scratchpad exit",
  );
  process.exit(EXIT_CONFLICT);
}

function scratchpadRefusePush(tool: string): never {
  console.error(
    `Error: ${tool} push is blocked on a scratchpad branch — scratch commits bypass hooks and carry no Devenv-Action/Change-Id trailers; they must never reach shared history.\n` +
      "Salvage to the base branch: repo-scratchpad promote <sha> · or leave the mode: repo-scratchpad exit",
  );
  process.exit(EXIT_CONFLICT);
}

function checkScratchpadRefusals(tool: string): void {
  if (git(["rev-parse", "--is-inside-work-tree"]).status !== 0) return; // outside a repo: fail later on its own git calls
  if (git(["show-ref", "--verify", "--quiet", SCRATCHPAD_STATE_REF]).status === 0) {
    // Active: name the branch — state-ref tip match first, unique prefix
    // match as the seed/self-heal fallback (scratchpad_active_branch's routes).
    const stateTip = git(["rev-parse", "--verify", SCRATCHPAD_STATE_REF]).out.trim();
    const refs = git(["for-each-ref", "--format=%(refname:short) %(objectname)", `refs/heads/${SCRATCHPAD_BRANCH_PREFIX}`]).out;
    const lines = refs.split("\n").filter((l) => l !== "");
    const byTip = lines.find((l) => l.split(" ")[1] === stateTip);
    const byPrefix = lines.length === 1 ? (lines[0]?.split(" ")[0] ?? "") : "";
    const slug = (byTip ?? byPrefix)?.split(" ")[0] ?? "";
    scratchpadRefuse(tool, slug);
  }
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).out.trim();
  if (branch.startsWith(SCRATCHPAD_BRANCH_PREFIX)) scratchpadRefusePush(tool);
}

// --- argument parsing (positional words + --file, mutually exclusive) ---

let stagedOnly = false;
let msgFile = "";
const words: string[] = [];

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "staged-only": { type: "boolean", default: false },
    file: { type: "string" },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
  // bash refused unknown flags with exit 1 + a named message; parseArgs'
  // throw would leak a stack trace instead.
  strict: false,
});
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--") && a !== "--staged-only" && a !== "--file" && a !== "--help" && a !== "-h" && a !== "--") {
    console.error(`Error: unknown flag '${a}'`);
    process.exit(EXIT_GENERAL_ERROR);
  }
}
// --file requires a value (bash's arity guard, lost under parseArgs strict:false —
// a lone trailing --file parses as boolean and would push an empty-message snapshot).
const rawArgs = process.argv.slice(2);
const fileFlagIdx = rawArgs.indexOf("--file");
if (fileFlagIdx !== -1) {
  const next = rawArgs[fileFlagIdx + 1];
  if (next === undefined || next.startsWith("--")) {
    console.error("Error: --file requires a path");
    process.exit(EXIT_GENERAL_ERROR);
  }
}

if (values.help) usage();
stagedOnly = values["staged-only"] === true;
msgFile = typeof values.file === "string" ? values.file : "";
words.push(...positionals);

if (msgFile !== "" && words.length > 0) {
  console.error("Error: --file and a positional message are mutually exclusive");
  process.exit(EXIT_MISUSE);
}

let msg: string;
if (msgFile !== "") {
  if (!existsSync(msgFile)) {
    console.error(`Error: message file not found: ${msgFile}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  msg = readFileSync(msgFile, "utf8");
} else {
  msg = words.join(" ");
}

// --- refusals before any mutation ---

checkScratchpadRefusals("git-wip");

// --- stage, commit (hook-bypass by design), push, then move the ref ---

if (!stagedOnly) {
  const add = git(["add", "-A"]);
  if (add.status !== 0) {
    console.error(add.out);
    process.exit(add.status);
  }
}

const commit = spawnSync("git", ["commit", "-m", `WIP: ${msg}`, "-n"], { stdio: "inherit" });
if (commit.status !== 0) {
  console.error("git-wip: commit failed (nothing to commit?) — no WIP snapshot was saved.");
  process.exit(EXIT_GENERAL_ERROR);
}
const push = spawnSync("git", ["push"], { stdio: "inherit" });
if (push.status !== 0) {
  console.error("git-wip: push failed — the WIP commit exists locally but was NOT saved to the remote; refs/wip/last is unchanged.");
  process.exit(EXIT_GENERAL_ERROR);
}
git(["update-ref", "refs/wip/last", "HEAD"]);
