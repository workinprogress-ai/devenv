#!/usr/bin/env node
// pr-thread-resolve.ts - Mark a pull request review thread as resolved.
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { parseArgs } from "node:util";
import { basename } from "node:path";

import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { checkTargetRepo } from "../lib/providers/provider-core.ts";
import { prsThreadResolve } from "../lib/providers/github/prs.ts";
import { authStatusOk } from "../lib/providers/github/urls.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "pr-thread-resolve.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} THREAD_ID [OPTIONS]

Mark a pull request review thread as resolved.

The THREAD_ID is the opaque thread reference from \`pr-threads-get PR_NUMBER\`
output (a GraphQL node ID starting with "PRRT_" on GitHub; a
provider-defined composite under other providers). Providers parse their
own scope internally — the invocation shape is identical everywhere.

Arguments:
    THREAD_ID                   Opaque thread reference (from pr-threads-get)

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without resolving

Environment Variables:
    DEVENV_REPO                 Repository in format owner/repo (not needed —
                                thread IDs are globally unique)

Examples:
    ${SCRIPT_NAME} PRRT_kwDOAbc123
    ${SCRIPT_NAME} PRRT_kwDOAbc123 --dry-run
    pr-threads-get 123 | jq -r '.[].id' | xargs -I{} ${SCRIPT_NAME} {}
`);
  process.exit(0);
}

/** The bash check_target_repo contract: the devenv repository is not a
 * normal target. DEVENV_REPO (explicit target) and --devenv (devenv-repo
 * work on purpose) are the two exemptions. */

async function main(argv: string[]): Promise<number> {
  let threadId = "";
  let dryRun = false;
  let devenv = false;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        verbose: { type: "boolean", short: "V", default: false },
        "dry-run": { type: "boolean", short: "n", default: false },
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
    dryRun = values["dry-run"] === true;
    devenv = values["devenv"] === true;
    threadId = positionals[0] ?? "";
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (threadId === "") {
    logError("THREAD_ID is required");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  checkTargetRepo(devenv);

  if (!authStatusOk()) {
    logError("Not authenticated with the active provider");
    process.stderr.write("Run: key-update-provider\n");
    return EXIT_API_FAILURE;
  }

  if (dryRun) {
    logInfo(`[DRY RUN] Would resolve review thread: ${threadId}`);
    return 0;
  }

  let isResolved: string;
  try {
    isResolved = await prsThreadResolve(threadId);
  } catch {
    logError(`Failed to resolve thread: ${threadId}`);
    return EXIT_API_FAILURE;
  }
  if (isResolved === "true") {
    logInfo(`Thread resolved: ${threadId}`);
    return 0;
  }
  logError(`Thread may not have resolved correctly (isResolved=${isResolved})`);
  return EXIT_GENERAL_ERROR;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_API_FAILURE);
  },
);
