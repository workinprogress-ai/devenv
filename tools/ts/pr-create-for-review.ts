#!/usr/bin/env node
// pr-create-for-review.ts - Create a draft "REVIEW:" pull request using
// temporary source/target branches built from two commits. If FROM_COMMIT
// and TO_COMMIT are omitted, an interactive picker is launched against the
// repo's version tags (TTY required — D4: refused under automation).
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { basename } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";

import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { prsCreate } from "../lib/providers/github/prs.ts";
import { extractUrl } from "../lib/providers/github/urls.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "pr-create-for-review.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} <PR_DESCRIPTION> [REPO_DIR] [FROM_COMMIT] [TO_COMMIT]

Create a draft "REVIEW:" pull request using temporary source/target branches
built from two commits. If FROM_COMMIT and TO_COMMIT are omitted, an
interactive picker is launched against the repo's version tags.

Arguments:
    PR_DESCRIPTION    Required. Used as the PR title (prefixed with "REVIEW: ")
    REPO_DIR          Repository path (default: current directory)
    FROM_COMMIT       First (older) commit to compare
    TO_COMMIT         Last (newer) commit to compare

Options:
    -h, --help        Show this help and exit
    -v, --version     Show version information and exit`);
  process.exit(0);
}

function git(args: string[], opts: { quiet?: boolean; capture?: boolean } = {}): { ok: boolean; out: string } {
  const r = spawnSync("git", args, {
    encoding: "utf8",
    ...(opts.capture ? {} : opts.quiet ? { stdio: ["ignore", "ignore", "ignore"] } : { stdio: ["ignore", "inherit", "inherit"] }),
  });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

function randomName(): string {
  return execFileSync("od", ["-An", "-N4", "-tx1", "/dev/urandom"], { encoding: "utf8" }).replace(/[ \n]/g, "");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main(argv: string[]): Promise<number> {
  let description = "";
  let repoDirArg = "";
  let firstCommit = "";
  let finalCommit = "";
  let help = false;
  let version = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "-h" || a === "--help") {
      help = true;
    } else if (a === "-v" || a === "--version") {
      version = true;
    } else if (description === "") description = a;
    else if (repoDirArg === "") repoDirArg = a;
    else if (firstCommit === "") firstCommit = a;
    else if (finalCommit === "") finalCommit = a;
    else {
      console.error(`Error: unexpected argument: ${a}`);
      return EXIT_MISUSE;
    }
  }
  if (help) showUsage();
  if (version) {
    console.log(SCRIPT_VERSION);
    return 0;
  }

  if (description === "") {
    console.error(`Usage: ${SCRIPT_NAME} <PR_DESCRIPTION> [REPO_DIR] [FROM_COMMIT] [TO_COMMIT]`);
    return EXIT_MISUSE;
  }
  const repoDir = repoDirArg !== "" ? repoDirArg : process.cwd();

  // Git context: repo + clean working tree; never on a review branch.
  const inside = spawnSync("git", ["-C", repoDir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (inside.status !== 0) {
    console.error(`Error: Invalid git context. Check that: 1) ${repoDir} is a git repo, 2) working directory is clean`);
    return EXIT_GENERAL_ERROR;
  }
  const status = spawnSync("git", ["-C", repoDir, "status", "--porcelain"], { encoding: "utf8" });
  if ((status.stdout ?? "").trim() !== "") {
    console.error(`Error: Invalid git context. Check that: 1) ${repoDir} is a git repo, 2) working directory is clean`);
    return EXIT_GENERAL_ERROR;
  }
  const currentBranch = git(["-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD"], { capture: true }).out;
  if (currentBranch.startsWith("review/")) {
    console.error("Error: This script cannot be run on a review branch.");
    return EXIT_GENERAL_ERROR;
  }

  // Commit selection. With both commits given this is fully deterministic;
  // the interactive tag picker needs a TTY and is refused under automation
  // (D4) — the bash tool's fzf flow is the interactive polish pass.
  if (firstCommit === "" || finalCommit === "") {
    if (!Boolean(process.stdin.isTTY)) {
      logError("Interactive commit selection requires a terminal — pass FROM_COMMIT and TO_COMMIT explicitly");
      return EXIT_MISUSE;
    }
    logError("Interactive tag selection is not available in this build; pass FROM_COMMIT and TO_COMMIT explicitly");
    return EXIT_MISUSE;
  }

  // Out-of-order check: TO must not be an ancestor of FROM.
  if (firstCommit !== finalCommit) {
    const ancestor = spawnSync("git", ["-C", repoDir, "merge-base", "--is-ancestor", finalCommit, firstCommit], { encoding: "utf8" });
    if (ancestor.status === 0) {
      console.error("Error: The FROM and TO commits appear out of order.");
      return EXIT_GENERAL_ERROR;
    }
  }

  const parent = git(["-C", repoDir, "rev-parse", `${firstCommit}^`], { capture: true });
  if (!parent.ok || parent.out === "") {
    console.error(`Error: Failed to get the parent commit ${firstCommit}`);
    return EXIT_GENERAL_ERROR;
  }

  const baseName = `review/${randomName()}-${today()}`;
  const targetBranch = `${baseName}-target`;
  const sourceBranch = `${baseName}-source`;

  // Rollback: the review branches must never linger after a failed run —
  // delete them from the remote and drop the local scaffolding, then return
  // to the original branch.
  const cleanup = (): void => {
    git(["-C", repoDir, "checkout", currentBranch], { quiet: true });
    for (const b of [targetBranch, sourceBranch]) {
      git(["-C", repoDir, "push", "origin", "--delete", b], { quiet: true });
      git(["-C", repoDir, "branch", "-D", b], { quiet: true });
    }
  };

  if (!git(["-C", repoDir, "checkout", "-b", targetBranch, parent.out], { quiet: true }).ok) {
    console.error(`Error: Failed to create new branch ${targetBranch}`);
    return EXIT_GENERAL_ERROR;
  }
  if (!git(["-C", repoDir, "push", "origin", targetBranch], { quiet: true }).ok) {
    console.error(`Error: Failed to push new branch ${targetBranch}`);
    cleanup();
    return EXIT_GENERAL_ERROR;
  }
  if (!git(["-C", repoDir, "checkout", "-b", sourceBranch, finalCommit], { quiet: true }).ok) {
    console.error(`Error: Failed to create new branch ${sourceBranch}`);
    cleanup();
    return EXIT_GENERAL_ERROR;
  }
  if (!git(["-C", repoDir, "push", "origin", sourceBranch], { quiet: true }).ok) {
    console.error(`Error: Failed to push new branch ${sourceBranch}`);
    cleanup();
    return EXIT_GENERAL_ERROR;
  }

  const repo = requireRepoTarget(providerRepoTarget(""), "pr-create-for-review", "pr");
  console.error("Creating draft PR for review comparison...");
  let prUrl: string | null = null;
  try {
    const out = (
      await prsCreate(repo, {
        title: `REVIEW: ${description}`,
        body: description,
        head: sourceBranch,
        base: targetBranch,
        draft: true,
      })
    ).stdout;
    prUrl = extractUrl(out);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
  }
  if (prUrl === null || prUrl === "") {
    console.error("Error: Failed to create pull request");
    cleanup();
    return EXIT_GENERAL_ERROR;
  }

  if (!git(["-C", repoDir, "checkout", currentBranch], { quiet: true }).ok) {
    console.error("Error: Failed to switch back to the current branch");
    return EXIT_GENERAL_ERROR;
  }
  if (!git(["-C", repoDir, "branch", "-D", targetBranch], { quiet: true }).ok) {
    console.error(`Failed to delete the local review branch ${targetBranch}`);
  }
  if (!git(["-C", repoDir, "branch", "-D", sourceBranch], { quiet: true }).ok) {
    console.error(`Failed to delete the local review branch ${sourceBranch}`);
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
