#!/usr/bin/env node
// pr-get.ts - Retrieve a GitHub pull request's details as structured JSON.
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { parseArgs } from "node:util";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";

import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { isDevenvRepoGated } from "../lib/providers/provider-core.ts";
import { prsView } from "../lib/providers/github/prs.ts";
import { authStatusOk } from "../lib/providers/github/urls.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "pr-get.ts");

const DEFAULT_FIELDS =
  "number,title,body,state,isDraft,headRefName,baseRefName,author,labels,assignees,reviewRequests,milestone,mergeable,mergeStateStatus,url,createdAt,updatedAt,closedAt,mergedAt,comments,reviews";

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} PR_NUMBER [OPTIONS]

Retrieve a GitHub pull request's details as structured JSON.

Arguments:
    PR_NUMBER                   PR number to retrieve

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --pretty                    Pretty-print JSON output (default: compact)
    --devenv                    Safety override to read PRs in devenv repo

Environment Variables:
    DEVENV_REPO                 Repository in format owner/repo (default: current repo)

Examples:
    ${SCRIPT_NAME} 123
    ${SCRIPT_NAME} 123 --pretty
    ${SCRIPT_NAME} 123 | jq -r '.title'
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
  let prNumber = "";
  let pretty = false;
  let devenv = false;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        verbose: { type: "boolean", short: "V", default: false },
        pretty: { type: "boolean", default: false },
        devenv: { type: "boolean", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values["help"]) showUsage();
    if (values["version"]) {
      console.log(SCRIPT_VERSION);
      return 0;
    }
    pretty = values["pretty"] === true;
    devenv = values["devenv"] === true;
    if (positionals.length === 0) {
      logError("PR number is required");
      console.log("Use --help for usage information");
      return EXIT_MISUSE;
    }
    prNumber = positionals[0] ?? "";
    if (!/^[0-9]+$/.test(prNumber)) {
      logError(`Invalid PR number: ${prNumber} (must be numeric)`);
      return EXIT_MISUSE;
    }
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (!authStatusOk()) {
    logError("Not authenticated with the active provider");
    logInfo("Run: key-update-provider");
    return EXIT_API_FAILURE;
  }

  checkTargetRepo(devenv);

  let json: string;
  try {
    json = (await prsView("", Number.parseInt(prNumber, 10), { json: DEFAULT_FIELDS })).stdout;
  } catch {
    logError(`PR #${prNumber} not found`);
    return EXIT_API_FAILURE;
  }

  if (pretty) {
    console.log(JSON.stringify(JSON.parse(json), null, 2));
  } else {
    console.log(json.trim());
  }
  return 0;
}

function logInfo(msg: string): void {
  process.stderr.write(`[INFO] ${msg}\n`);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_API_FAILURE);
  },
);
