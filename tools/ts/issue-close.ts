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

import { basename } from "node:path";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesClose, issuesReopen, issuesExists } from "../lib/providers/facade/issues.ts";

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
${usageCommonFlags()}
    -c, --comment TEXT          Add a comment when closing/reopening
    -r, --reason REASON         Close reason (completed|not planned); close only
    --select                    Interactively select issues (requires a TTY)

Examples:
    ${SCRIPT_NAME} 123
    ${SCRIPT_NAME} 123 124 --reason "completed"
    ${SCRIPT_NAME} reopen 123 --comment "Need to revisit this"
    ${SCRIPT_NAME} 123 --dry-run
`);
  process.exit(0);
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
    const cli = toolCli({
      rejectEmptyValues: true,
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv: rest,
      options: {
        "dry-run": { type: "boolean", short: "n", default: false },
        comment: { type: "string", short: "c" },
        reason: { type: "string", short: "r" },
        select: { type: "boolean", default: false },
      },
    });
    if (cli.common.help) showUsage();
    dryRun = cli.common.dryRun;
    devenv = cli.common.devenv;
    comment = ((cli.values["comment"] as string | undefined) ?? "");
    reason = ((cli.values["reason"] as string | undefined) ?? "");
    if (cli.values["select"] === true) {
      logError("--select requires an interactive terminal (issue selection); pass issue numbers explicitly");
      return EXIT_MISUSE;
    }
    for (const p of cli.positionals) {
      if (!/^[0-9]+$/.test(p)) {
        logError(`Unknown option or invalid issue number: ${p}`);
        console.error("Use --help for usage information");
        return EXIT_MISUSE;
      }
      issueNumbers.push(p);
    }
  } catch (err) {
    logError(errorMessage(err));
    console.error("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (issueNumbers.length === 0) {
    logError("At least one issue number is required");
    console.error("Use --help for usage information");
    return EXIT_MISUSE;
  }
  if (reason !== "" && action !== "close") {
    logError("--reason can only be used with close action");
    return EXIT_GENERAL_ERROR;
  }

  checkTargetRepo(devenv);

  const repo = requireRepoTarget(providerRepoTarget(""), "issue-close", "issues");

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
      logError(`Failed to ${action} issue #${issueNum}: ${errorMessage(err)}`);
      failed += 1;
    }
  }

  if (failed > 0) return EXIT_GENERAL_ERROR;
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(errorMessage(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
