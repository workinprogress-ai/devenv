#!/usr/bin/env node
// pr-cleanup-review-branches.ts - Delete remote review branches
// (origin/review/*) older than DAYS_OLD days.
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Only branches named exactly as pr-create-for-review creates them are
// considered: review/<8-hex-id>-YYYY-MM-DD-target or -source; the age comes
// from that date. Any other name under review/ is left untouched, reported,
// and makes the run exit non-zero. A branch that is the head or base of an
// open PR is never deleted, whatever its age; if that cannot be determined the
// branch is left alone and the run exits non-zero.

import { basename } from "node:path";
import { spawnSync } from "node:child_process";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { providerRepoTarget } from "../lib/providers/provider-core.ts";
import { prsList } from "../lib/providers/facade/prs.ts";
import { remoteToSpec } from "../lib/providers/facade/urls.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "pr-cleanup-review-branches.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [--dry-run] [REPO_DIR] [DAYS_OLD]

Delete remote review branches (origin/review/*) older than DAYS_OLD days.
Remote branches that no longer exist are pruned from the local tracking refs
first. A branch that is the head or base of an open PR is skipped. A branch
that cannot be deleted (or whose open-PR status cannot be determined) is
reported and the rest are still processed; the run then exits non-zero.

Arguments:
    REPO_DIR    Repository path (default: current directory)
    DAYS_OLD    Age threshold in days (default: 30)

Options:
${usageCommonFlags({ noDevenv: true })}`);
  process.exit(0);
}

async function main(argv: string[]): Promise<number> {
  let dryRun = false;
  let positionals: string[] = [];
  try {
    const cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
    });
    dryRun = cli.common.dryRun;
    positionals = cli.positionals;
    if (cli.common.help) showUsage();
  } catch (err) {
    console.error(`Error: ${errorMessage(err)}`);
    return EXIT_MISUSE;
  }

  // toolCli's positionals (a `-`-leading REPO_DIR stays a positional;
  // a hand-rolled startsWith("-") filter would misread it as a flag).
  if (positionals.length > 2) {
    console.error("Error: Too many arguments (expected [REPO_DIR] [DAYS_OLD])");
    return EXIT_MISUSE;
  }
  const repoDir = positionals[0] ?? process.cwd();
  const days = positionals[1] ?? "30";
  if (!/^[0-9]+$/.test(days)) {
    console.error(`Error: DAYS_OLD must be a non-negative integer, got '${days}'`);
    return EXIT_MISUSE;
  }

  const inside = spawnSync("git", ["-C", repoDir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (inside.status !== 0) {
    console.error(`Error: Invalid git context: ${repoDir} is not a valid git repository`);
    return EXIT_GENERAL_ERROR;
  }

  const fetch = spawnSync("git", ["-C", repoDir, "fetch", "--prune", "origin"], { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] });
  if (fetch.status !== 0) {
    console.error("Error: Failed to fetch branches from the remote.");
    return EXIT_GENERAL_ERROR;
  }

  const branchList = spawnSync("git", ["-C", repoDir, "branch", "-r", "--list", "origin/review/*"], { encoding: "utf8" });
  const branches = { ok: branchList.status === 0, out: (branchList.stdout ?? "").trim() };
  if (branches.out === "") {
    console.log("No review branches found.");
    return 0;
  }
  console.log("Found review branches:");
  console.log(branches.out);

  const originUrl = spawnSync("git", ["-C", repoDir, "remote", "get-url", "origin"], { encoding: "utf8" });
  let repoSpec = originUrl.status === 0 ? ((await remoteToSpec((originUrl.stdout ?? "").trim())) ?? "") : "";
  if (repoSpec === "") {
    try {
      repoSpec = providerRepoTarget("");
    } catch {
      repoSpec = "";
    }
  }

  /** true/false, or null when the provider could not answer (fail closed). */
  const hasOpenPr = async (branch: string): Promise<boolean | null> => {
    if (repoSpec === "") return null;
    try {
      for (const side of [{ head: branch }, { base: branch }]) {
        const r = await prsList(repoSpec, { state: "open", ...side, json: "number", jq: ".[0].number" });
        if (r.stdout.trim() !== "") return true;
      }
      return false;
    } catch {
      return null;
    }
  };

  const nowSec = Math.floor(Date.now() / 1000);
  const branchRe = /^review\/[0-9a-f]{8}-([0-9]{4})-([0-9]{2})-([0-9]{2})-(target|source)$/;
  let unrecognized = 0;
  let deleteFailed = 0;
  let unverified = 0;
  for (const rawLine of branches.out.split("\n")) {
    const branch = rawLine.trim().replace(/^origin\//, "");
    if (branch === "") continue;
    const m = branchRe.exec(branch);
    if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) {
      console.error(`ERROR: ${branch} is not a recognized review branch name (expected review/<id>-YYYY-MM-DD-target|source); left untouched.`);
      unrecognized++;
      continue;
    }
    const dateFull = `${m[1]}-${m[2]}-${m[3]}`;
    const dateEpoch = Date.parse(`${dateFull}T00:00:00Z`) / 1000;
    if (Number.isNaN(dateEpoch)) {
      console.error(`ERROR: ${branch} carries an invalid date (${dateFull}); left untouched.`);
      unrecognized++;
      continue;
    }
    const diffDays = Math.floor((nowSec - dateEpoch) / 86400);
    if (diffDays >= Number.parseInt(days, 10)) {
      const open = await hasOpenPr(branch);
      if (open === null) {
        console.error(`ERROR: could not determine whether ${branch} has an open PR; left untouched.`);
        unverified++;
        continue;
      }
      if (open) {
        console.log(`Skipping branch ${branch}: it has an open PR.`);
        continue;
      }
      if (dryRun) {
        console.log(`Would delete remote branch ${branch} (last updated ${diffDays} days ago)`);
      } else {
        const del = spawnSync("git", ["-C", repoDir, "push", "origin", "--delete", branch], {
          encoding: "utf8",
          stdio: ["ignore", "inherit", "inherit"],
        });
        if (del.status === 0) {
          console.log(`Deleted remote branch ${branch}`);
        } else {
          console.error(`ERROR: Failed to delete remote branch ${branch}`);
          deleteFailed++;
        }
      }
    } else {
      console.log(`Skipping branch ${branch}, last updated ${diffDays} days ago.`);
    }
  }

  if (unrecognized > 0) {
    console.error(`Review branch cleanup finished with ${unrecognized} branch(es) left untouched (see errors above).`);
    return EXIT_GENERAL_ERROR;
  }
  if (unverified > 0) {
    console.error(`Review branch cleanup finished with ${unverified} branch(es) whose open-PR status could not be checked (see errors above).`);
    return EXIT_GENERAL_ERROR;
  }
  if (deleteFailed > 0) {
    console.error(`Review branch cleanup finished with ${deleteFailed} branch(es) that could not be deleted (see errors above).`);
    return EXIT_GENERAL_ERROR;
  }
  console.log(dryRun ? "Dry run complete; nothing was deleted." : "Review branch cleanup completed.");
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`Error: ${errorMessage(err)}`);
    process.exit(EXIT_GENERAL_ERROR);
  },
);
