#!/usr/bin/env node
// pr-review-comment.ts - Post an inline PR review comment: a new review
// thread tied to a specific file and line. Use pr-comment for top-level
// conversation comments, pr-thread-reply to reply inside an existing thread.
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { basename } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags, usageEnvBlock } from "../lib/core/cli.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { prsThreadCreate, prsView } from "../lib/providers/facade/prs.ts";
import { authStatusOk } from "../lib/providers/facade/urls.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "pr-review-comment.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} PR_NUMBER --file PATH --line N [OPTIONS] (--body TEXT | --body-file FILE)

Post an inline PR review comment: a new review thread tied to a specific
file and line. Use pr-comment for top-level conversation comments,
pr-thread-reply to reply inside an existing thread.

Arguments:
    PR_NUMBER                   PR number

Options:
    -f, --file PATH             File path the comment is on (required)
    -l, --line N                Line number in the file (on the chosen side)
    -s, --side SIDE             Which side of the diff the line is on:
                                RIGHT (new file content, default) or LEFT
${usageCommonFlags()}

Comment Source (one required):
    -b, --body TEXT             Comment text (inline)
    -F, --body-file FILE        Read comment from file

Environment Variables:
${usageEnvBlock()}

Examples:
    ${SCRIPT_NAME} 123 --file src/Service.cs --line 42 --body "Null check missing"
    ${SCRIPT_NAME} 123 --file src/Service.cs --line 40 --side LEFT --body-file note.md
    ${SCRIPT_NAME} 123 --file src/App.ts --line 7 --body "Typo" --dry-run
`);
  process.exit(0);
}

/** The bash check_target_repo contract: the devenv repository is not a
 * normal target. DEVENV_REPO (explicit target) and --devenv (devenv-repo
 * work on purpose) are the two exemptions. */

async function main(argv: string[]): Promise<number> {
  let prNumber = "";
  let filePath = "";
  let lineNumber = "";
  let side = "RIGHT";
  let bodyText = "";
  let bodyFile = "";
  let dryRun = false;
  let devenv = false;
  try {
    const cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      options: {
        "dry-run": { type: "boolean", short: "n", default: false },
        file: { type: "string", short: "f" },
        line: { type: "string", short: "l" },
        side: { type: "string", short: "s" },
        body: { type: "string", short: "b" },
        "body-file": { type: "string", short: "F" },
      },
    });
    if (cli.common.help) showUsage();
    dryRun = cli.common.dryRun;
    devenv = cli.common.devenv;
    filePath = ((cli.values["file"] as string | undefined) ?? "");
    lineNumber = ((cli.values["line"] as string | undefined) ?? "");
    side = (((cli.values["side"] as string | undefined) ?? "RIGHT")).toUpperCase();
    bodyText = ((cli.values["body"] as string | undefined) ?? "");
    bodyFile = ((cli.values["body-file"] as string | undefined) ?? "");
    if (cli.positionals.length > 0) prNumber = cli.positionals[0] ?? "";
  } catch (err) {
    logError(errorMessage(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (prNumber === "" || !/^[0-9]+$/.test(prNumber)) {
    logError("PR number is required and must be numeric");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }
  if (filePath === "") {
    logError("--file is required (the file path the comment is on)");
    return EXIT_MISUSE;
  }
  if (lineNumber === "" || !/^[0-9]+$/.test(lineNumber)) {
    logError("--line is required and must be numeric");
    return EXIT_MISUSE;
  }
  if (side !== "RIGHT" && side !== "LEFT") {
    logError(`Invalid side: ${side} (must be RIGHT or LEFT)`);
    return EXIT_MISUSE;
  }
  const sources = (bodyText !== "" ? 1 : 0) + (bodyFile !== "" ? 1 : 0);
  if (sources === 0) {
    logError("One comment source is required: --body or --body-file");
    return EXIT_MISUSE;
  }
  if (sources > 1) {
    logError("Only one of --body or --body-file may be specified");
    return EXIT_MISUSE;
  }
  if (bodyFile !== "" && !existsSync(bodyFile)) {
    logError(`File not found: ${bodyFile}`);
    return EXIT_API_FAILURE;
  }

  checkTargetRepo(devenv);

  if (!(await authStatusOk())) {
    logError("Not authenticated with the active provider");
    process.stderr.write("Run: key-update-provider\n");
    return EXIT_API_FAILURE;
  }

  const repo = requireRepoTarget(providerRepoTarget(""), "pr-review-comment", "pr");
  const body = bodyFile !== "" ? readFileSync(bodyFile, "utf8") : bodyText;
  if (body.replace(/\s/g, "") === "") {
    logError("Comment body is empty — aborting");
    return EXIT_GENERAL_ERROR;
  }

  let headSha = "";
  try {
    headSha = (await prsView(repo, Number.parseInt(prNumber, 10), { json: "headRefOid", jq: ".headRefOid" })).stdout.trim();
  } catch {
    logError(`Failed to fetch PR #${prNumber} head SHA`);
    return EXIT_API_FAILURE;
  }

  if (dryRun) {
    logInfo("[DRY RUN] Would post inline review comment:");
    console.log(`  PR:     #${prNumber}`);
    console.log(`  File:   ${filePath}`);
    console.log(`  Line:   ${lineNumber} (${side} side)`);
    console.log("  Body:");
    console.log(body);
    return 0;
  }

  logInfo(`Posting inline comment on PR #${prNumber} (${filePath}:${lineNumber} ${side}, head ${headSha.slice(0, 7)})`);
  let result: string;
  try {
    result = (
      await prsThreadCreate(repo, Number.parseInt(prNumber, 10), {
        body,
        path: filePath,
        line: Number.parseInt(lineNumber, 10),
        side: side === "LEFT" ? "LEFT" : "RIGHT",
      })
    ).stdout;
  } catch (err) {
    logError(`Failed to post inline review comment on PR #${prNumber}`);
    console.error(errorMessage(err));
    return EXIT_API_FAILURE;
  }

  let threadUrl = "";
  let gqlError = "";
  try {
    const parsed = JSON.parse(result) as {
      thread?: { url?: string };
      errors?: Array<{ message?: string }>;
    };
    threadUrl = parsed.thread?.url ?? "";
    gqlError = parsed.errors?.[0]?.message ?? "";
  } catch {
    // non-JSON result: reported below as a missing thread URL
  }
  if (gqlError !== "") {
    logError(`GraphQL error: ${gqlError}`);
    return EXIT_GENERAL_ERROR;
  }
  if (threadUrl === "") {
    logError("Failed to post inline review comment (no thread URL returned)");
    console.error(result);
    return EXIT_API_FAILURE;
  }
  logInfo(`Inline review comment posted: ${threadUrl}`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(errorMessage(err));
    process.exit(EXIT_API_FAILURE);
  },
);
