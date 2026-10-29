#!/usr/bin/env node
// pr-get-review-link.ts - Print the URL of the open "REVIEW:" pull request
// (falling back to any open PR from a review/ head branch).
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
const SCRIPT_NAME = basename(process.argv[1] ?? "pr-get-review-link.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [REPO_DIR]

Get the GitHub URL for an open "REVIEW:" pull request in the repository.
Falls back to any open PR with a head branch under review/.

Arguments:
    REPO_DIR    Repository path (default: current directory)

Options:
    -h, --help  Show this help and exit`);
  process.exit(0);
}

async function main(argv: string[]): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: { help: { type: "boolean", short: "h", default: false }, version: { type: "boolean", short: "v", default: false } },
      allowPositionals: true,
      strict: true,
    });
    if (values["help"]) showUsage();
    if (values["version"]) {
      console.log(SCRIPT_VERSION);
      return 0;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return EXIT_GENERAL_ERROR;
  }

  const positional = argv.find((a) => !a.startsWith("-") && a !== "-h" && a !== "--help");
  const repoDir = positional ?? process.cwd();
  const inWorkTree = spawnSync("git", ["-C", repoDir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (inWorkTree.status !== 0) {
    console.error(`Invalid repository folder: ${repoDir}`);
    return EXIT_GENERAL_ERROR;
  }

  // Repo spec: DEVENV_REPO > cwd resolution (get_repo_spec's chain).
  const repo = requireRepoTarget(providerRepoTarget(""), "pr-get-review-link", "pr");

  // Primary: an open PR titled "REVIEW: ...".
  const primary = await prsList(repo, {
    state: "open",
    search: "REVIEW:",
    json: "title,url",
    jq: '.[] | select(.title | startswith("REVIEW:")) | .url',
  }).catch(() => null);
  const prUrl = (primary?.stdout ?? "").trim().split("\n")[0] ?? "";

  if (prUrl !== "") {
    console.log(prUrl);
    return 0;
  }

  // Fallback: any open PR with a head branch under review/.
  const fallback = await prsList(repo, {
    state: "open",
    search: "head:review/",
    json: "url",
    jq: ".[0].url",
  }).catch(() => null);
  const fallbackUrl = (fallback?.stdout ?? "").trim().split("\n")[0] ?? "";
  if (fallbackUrl !== "") {
    console.log(fallbackUrl);
    return 0;
  }

  console.error("No open review PRs found.");
  return EXIT_API_FAILURE;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_API_FAILURE);
  },
);
