#!/usr/bin/env node
// pr-get.ts - Retrieve a GitHub pull request's details as structured JSON.
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { basename } from "node:path";

import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { toolCli, usageCommonFlags, usageEnvBlock } from "../lib/core/cli.ts";
import { checkTargetRepo } from "../lib/providers/provider-core.ts";
import { prsView } from "../lib/providers/facade/prs.ts";
import { authStatusOk } from "../lib/providers/facade/urls.ts";

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
${usageCommonFlags({ noDryRun: true })}
    --pretty                    Pretty-print JSON output (default: compact)

Environment Variables:
${usageEnvBlock()}

Examples:
    ${SCRIPT_NAME} 123
    ${SCRIPT_NAME} 123 --pretty
    ${SCRIPT_NAME} 123 | jq -r '.title'
`);
  process.exit(0);
}

async function main(argv: string[]): Promise<number> {
  let prNumber = "";
  let pretty = false;
  let devenv = false;
  try {
    const cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      noDryRun: true,
      options: {
        pretty: { type: "boolean", default: false },
      },
    });
    if (cli.common.help) showUsage();
    pretty = cli.values["pretty"] === true;
    devenv = cli.common.devenv;
    if (cli.positionals.length === 0) {
      logError("PR number is required");
      console.log("Use --help for usage information");
      return EXIT_MISUSE;
    }
    prNumber = cli.positionals[0] ?? "";
    if (!/^[0-9]+$/.test(prNumber)) {
      logError(`Invalid PR number: ${prNumber} (must be numeric)`);
      return EXIT_MISUSE;
    }
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (!(await authStatusOk())) {
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

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_API_FAILURE);
  },
);
