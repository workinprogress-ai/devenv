#!/usr/bin/env node
// issue-close.ts - Close or reopen GitHub issues
// Version: 1.0.0
// Description: Close or reopen one or more issues, with optional reason/comment and dry-run.
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Contract: the optional leading action (close|reopen) selects the mode
// (default close). Each issue is verified to exist first (issuesExists);
// failures accumulate and the tool exits non-zero when any issue failed.
// --reason is close-only. The interactive --select flow needs a TTY picker
// (ui/prompts per D4); it is deferred to the interactive-polish pass and
// refuses cleanly when no TTY is present.

import { parseArgs } from "node:util";
import {basename} from "node:path";
import {} from "node:fs";
import { spawnSync } from "node:child_process";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { isDevenvRepoGated, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesClose, issuesReopen, issuesExists } from "../lib/providers/github/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-close.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [close|reopen] ISSUE_NUMBER... [OPTIONS]

Close or reopen one or more GitHub issues. The action defaults to close.

Arguments:
    close|reopen                Action (optional leading word; default close)
    ISSUE_NUMBER...             One or more issue numbers

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without closing
    -c, --comment TEXT          Add a comment when closing/reopening
    -r, --reason REASON         Close reason (completed|not planned); close only
    --select                    Interactively select issues (requires a TTY)
    --devenv                    Safety override to close issues in devenv repo

Examples:
    ${SCRIPT_NAME} 123
    ${SCRIPT_NAME} 123 124 --reason "completed"
    ${SCRIPT_NAME} reopen 123 --comment "Need to revisit this"
    ${SCRIPT_NAME} 123 --dry-run
`);
  process.exit(0);
}

function checkTargetRepo(allowDevenv: boolean): void {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (r.status !== 0) {
    logError("Not in a git repository");
    process.exit(1);
  }
  if (!isDevenvRepoGated()) return;
  if (process.env["DEVENV_REPO"] !== undefined && process.env["DEVENV_REPO"] !== "") return;
  if (allowDevenv) return;
  logError("The current repository appears to be the devenv repository itself");
  console.log("Operations should be performed in target project repositories, not in devenv");
  console.log("To target a project repo, prefix the command with DEVENV_REPO=<owner>/<repo>");
  console.log("To override this safety check (devenv-repo work only), pass the --devenv flag");
  process.exit(1);
}

async function main(argv: string[]): Promise<number> {
  let action = "close";
  let dryRun = false;
  let devenv = false;
  let comment = "";
  let reason = "";
  const issueNumbers: string[] = [];

  // Optional leading action word.
  const rest = argv.length > 0 && (argv[0] === "close" || argv[0] === "reopen") ? argv.slice(1) : argv;
  if (rest.length !== argv.length) action = argv[0] ?? "close";

  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        "dry-run": { type: "boolean", short: "n", default: false },
        comment: { type: "string", short: "c" },
        reason: { type: "string", short: "r" },
        select: { type: "boolean", default: false },
        devenv: { type: "boolean", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    dryRun = Boolean(values["dry-run"]);
    devenv = Boolean(values["devenv"]);
    comment = values["comment"] ?? "";
    reason = values["reason"] ?? "";
    if (values["select"]) {
      logError("--select requires an interactive terminal (issue selection); pass issue numbers explicitly");
      return EXIT_MISUSE;
    }
    for (const p of positionals) {
      if (!/^[0-9]+$/.test(p)) {
        logError(`Unknown option or invalid issue number: ${p}`);
        console.log("Use --help for usage information");
        return EXIT_MISUSE;
      }
      issueNumbers.push(p);
    }
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (argv.includes("-h") || argv.includes("--help")) showUsage();
  if (argv.includes("-v") || argv.includes("--version")) {
    console.log(SCRIPT_VERSION);
    return 0;
  }

  if (issueNumbers.length === 0) {
    logError("At least one issue number is required");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }
  if (reason !== "" && action !== "close") {
    logError("--reason can only be used with close action");
    return EXIT_GENERAL_ERROR;
  }

  checkTargetRepo(devenv);

  const repo = providerRepoTarget("");

  let failed = 0;
  for (const issueNum of issueNumbers) {
    const n = Number.parseInt(issueNum, 10);
    if (!(await issuesExists(repo, n))) {
      logError(`Issue #${issueNum} not found`);
      failed += 1;
      continue;
    }
    if (dryRun) {
      let msg = `[DRY RUN] Would ${action} issue #${issueNum}`;
      if (reason !== "") msg += ` (reason: ${reason})`;
      if (comment !== "") msg += ` (comment: ${comment})`;
      logInfo(msg);
      continue;
    }
    try {
      if (action === "close") {
        await issuesClose(repo, n, {
          ...(reason !== "" ? { reason } : {}),
          ...(comment !== "" ? { comment } : {}),
        });
      } else {
        await issuesReopen(repo, n, { ...(comment !== "" ? { comment } : {}) });
      }
    } catch (err) {
      logError(`Failed to ${action} issue #${issueNum}: ${err instanceof Error ? err.message : String(err)}`);
      failed += 1;
    }
  }

  if (failed > 0) return EXIT_GENERAL_ERROR;
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
