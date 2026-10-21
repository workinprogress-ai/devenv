#!/usr/bin/env node
// issue-comment-update.ts - Replace the body of an existing GitHub issue comment
// Version: 1.1.0
// Description: Updates a comment identified by its numeric ID (as returned by issue-comment-list).
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// The comment is validated (GET through the facade's comment_get verb)
// before the update; dry-run skips the existence check (no network).

import { parseArgs } from "node:util";
import {basename} from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE, EXIT_API_FAILURE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { isDevenvRepoGated, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesCommentGet, issuesCommentEdit } from "../lib/providers/github/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-comment-update.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} COMMENT_ID [OPTIONS]

Replace the body of an existing issue comment. COMMENT_ID is the opaque
comment reference returned by issue-comment-list (its shape is
provider-defined; take it verbatim from list output).

The comment is validated (GET) before the update is attempted; if the ID does
not exist the tool exits cleanly with an error.

Arguments:
    COMMENT_ID                  Numeric comment ID to update

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be sent without calling the API
    --devenv                    Safety override to update comments in devenv repo
    --repo OWNER/REPO           Override the target repository

Comment Source (one required):
    -b, --body TEXT             New comment text (inline)
    -f, --body-file FILE        Read new comment body from file (markdown; '-'
                                reads stdin; piped stdin with no flag is auto-read)

Examples:
    ${SCRIPT_NAME} 12345678 --body "Updated content"
    ${SCRIPT_NAME} 12345678 --body-file spike-001-results.md
    ${SCRIPT_NAME} 12345678 --body-file notes.md --dry-run
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

function isWhitespaceOnly(s: string): boolean {
  return s.replace(/\s/g, "") === "";
}

async function main(argv: string[]): Promise<number> {
  let commentId = "";
  let bodyText = "";
  let bodyFile = "";
  let dryRun = false;
  let devenv = false;
  let repoOverride = "";
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        "dry-run": { type: "boolean", short: "n", default: false },
        devenv: { type: "boolean", default: false },
        body: { type: "string", short: "b" },
        "body-file": { type: "string", short: "f" },
        repo: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
    dryRun = Boolean(values["dry-run"]);
    devenv = Boolean(values["devenv"]);
    bodyText = values["body"] ?? "";
    bodyFile = values["body-file"] ?? "";
    repoOverride = values["repo"] ?? "";
    for (const p of positionals) {
      if (commentId === "") {
        // The comment ref is provider-opaque: any non-empty, non-flag token.
        commentId = p;
      } else {
        logError(`Unexpected argument: ${p}`);
        console.log("Use --help for usage information");
        return EXIT_MISUSE;
      }
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

  if (commentId === "") {
    logError("Comment ID is required");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  const sources = (bodyText !== "" ? 1 : 0) + (bodyFile !== "" ? 1 : 0);
  if (sources > 1) {
    logError("Only one of --body or --body-file may be specified");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  let body = "";
  if (sources === 0) {
    if (!process.stdin.isTTY) {
      body = readFileSync(0, "utf8");
      if (isWhitespaceOnly(body)) {
        logError("Refusing empty stdin body");
        console.log("Use --help for usage information");
        return EXIT_MISUSE;
      }
    } else {
      logError("A comment source is required: --body or --body-file");
      console.log("Use --help for usage information");
      return EXIT_MISUSE;
    }
  } else if (bodyFile !== "") {
    if (bodyFile === "-") {
      body = readFileSync(0, "utf8");
    } else if (!existsSync(bodyFile)) {
      logError(`File not found: ${bodyFile}`);
      return EXIT_API_FAILURE;
    } else {
      body = readFileSync(bodyFile, "utf8");
    }
  } else {
    body = bodyText;
  }

  checkTargetRepo(devenv);

  const repo = providerRepoTarget(repoOverride);

  // Existence check rides the facade's comment_get verb (skip on dry-run).
  if (!dryRun) {
    try {
      await issuesCommentGet(repo, commentId);
    } catch {
      logError(`Comment not found: ${commentId}`);
      return EXIT_GENERAL_ERROR;
    }
  }

  if (dryRun) {
    logInfo(`[DRY RUN] Would PATCH comment ${commentId} with body:`);
    console.log(body);
    return 0;
  }

  try {
    await issuesCommentEdit(repo, commentId, { body });
    logInfo(`Comment ${commentId} updated`);
    return 0;
  } catch (err) {
    logError(`Failed to update comment ${commentId}: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_GENERAL_ERROR;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
