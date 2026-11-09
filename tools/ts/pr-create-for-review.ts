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
import { errorMessage } from "../lib/core/logging.ts";
import { gitCheck, gitInherit } from "../lib/core/git.ts";
import { toolCli } from "../lib/core/cli.ts";
import { providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { prsCreate } from "../lib/providers/facade/prs.ts";
import { extractUrl } from "../lib/providers/facade/urls.ts";

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

function git(args: string[], opts: { capture?: boolean; quiet?: boolean } = {}): { ok: boolean; out: string } {
  // quiet: output captured and dropped — callers read only .ok (the old
  // all-ignore stdio shape's contract for these call sites).
  const r = gitCheck(null, args);
  if (opts.capture || opts.quiet) {
    return { ok: r.ok, out: opts.capture ? r.out.trim() : "" };
  }
  return gitInherit(null, args);
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
  try {
    const cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      noDryRun: true,
      noVersionExit: true,
    });
    if (cli.common.help) showUsage();
    if (cli.values["version"] === true) {
      console.log(SCRIPT_VERSION);
      return 0;
    }
    if (cli.positionals.length > 4) {
      console.error(`Error: unexpected argument: ${cli.positionals[4] ?? ""}`);
      return EXIT_MISUSE;
    }
    description = cli.positionals[0] ?? "";
    repoDirArg = cli.positionals[1] ?? "";
    firstCommit = cli.positionals[2] ?? "";
    finalCommit = cli.positionals[3] ?? "";
  } catch (err) {
    console.error(`Error: ${errorMessage(err)}`);
    return EXIT_MISUSE;
  }

  if (description === "") {
    console.error(`Usage: ${SCRIPT_NAME} <PR_DESCRIPTION> [REPO_DIR] [FROM_COMMIT] [TO_COMMIT]`);
    return EXIT_MISUSE;
  }
  const repoDir = repoDirArg !== "" ? repoDirArg : process.cwd();

  // Git context: repo + clean working tree; never on a review branch.
  const inside = gitCheck(repoDir, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) {
    console.error(`Error: Invalid git context. Check that: 1) ${repoDir} is a git repo, 2) working directory is clean`);
    return EXIT_GENERAL_ERROR;
  }
  const status = gitCheck(repoDir, ["status", "--porcelain"]);
  if (status.out.trim() !== "") {
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
    const ancestor = gitCheck(repoDir, ["merge-base", "--is-ancestor", finalCommit, firstCommit]);
    if (ancestor.ok) {
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
    prUrl = (await extractUrl(out)) ?? "";
  } catch (err) {
    console.error(errorMessage(err));
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
    console.error(errorMessage(err));
    process.exit(EXIT_API_FAILURE);
  },
);
