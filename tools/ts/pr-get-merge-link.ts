#!/usr/bin/env node
// pr-get-merge-link.ts - Print the URL of the open PR for the current branch.
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { parseArgs } from "node:util";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";

import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { prsList } from "../lib/providers/github/prs.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "pr-get-merge-link.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [REPO_DIR]

Get the GitHub URL for the open pull request whose head branch is the
current branch.

Arguments:
    REPO_DIR    Repository path (default: current directory)

Options:
    -h, --help  Show this help and exit
    -v, --version  Show version information and exit`);
  process.exit(0);
}

async function main(argv: string[]): Promise<number> {
  let help = false;
  let version = false;
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    help = values["help"] === true;
    version = values["version"] === true;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return EXIT_GENERAL_ERROR;
  }
  if (help) showUsage();
  if (version) {
    console.log(SCRIPT_VERSION);
    return 0;
  }

  const positional = argv.find((a) => !a.startsWith("-"));
  const repoDir = positional ?? process.cwd();
  const inWorkTree = spawnSync("git", ["-C", repoDir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (inWorkTree.status !== 0) {
    console.error(`Invalid repository folder: ${repoDir}`);
    return EXIT_GENERAL_ERROR;
  }

  const branch = spawnSync("git", ["-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
  const currentBranch = (branch.stdout ?? "").trim();
  if (currentBranch === "") {
    console.error("Cannot resolve the current branch.");
    return EXIT_GENERAL_ERROR;
  }

  const repo = requireRepoTarget(providerRepoTarget(""), "pr-get-merge-link", "pr");
  let prUrl = "";
  try {
    const r = await prsList(repo, { state: "open", head: currentBranch, json: "url", jq: ".[0].url" });
    prUrl = r.stdout.trim().split("\n")[0] ?? "";
  } catch {
    prUrl = "";
  }
  if (prUrl === "") {
    console.error(`No open PR found for branch '${currentBranch}'.`);
    return EXIT_API_FAILURE;
  }
  console.log(prUrl);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_API_FAILURE);
  },
);
