#!/usr/bin/env node
// pr-review-comment.ts - Post an inline PR review comment: a new review
// thread tied to a specific file and line. Use pr-comment for top-level
// conversation comments, pr-thread-reply to reply inside an existing thread.
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { isDevenvRepoGated, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { prsThreadCreate, prsView } from "../lib/providers/github/prs.ts";
import { authStatusOk } from "../lib/providers/github/urls.ts";

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
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -f, --file PATH             File path the comment is on (required)
    -l, --line N                Line number in the file (on the chosen side)
    -s, --side SIDE             Which side of the diff the line is on:
                                RIGHT (new file content, default) or LEFT
    -n, --dry-run               Show what would be posted without posting
    --devenv                    Safety override for devenv repo PRs

Comment Source (one required):
    -b, --body TEXT             Comment text (inline)
    -F, --body-file FILE        Read comment from file

Environment Variables:
    DEVENV_REPO                 Repository in format owner/repo (default: current repo)

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
  let filePath = "";
  let lineNumber = "";
  let side = "RIGHT";
  let bodyText = "";
  let bodyFile = "";
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
        file: { type: "string", short: "f" },
        line: { type: "string", short: "l" },
        side: { type: "string", short: "s" },
        body: { type: "string", short: "b" },
        "body-file": { type: "string", short: "F" },
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
    filePath = values["file"] ?? "";
    lineNumber = values["line"] ?? "";
    side = (values["side"] ?? "RIGHT").toUpperCase();
    bodyText = values["body"] ?? "";
    bodyFile = values["body-file"] ?? "";
    if (positionals.length > 0) prNumber = positionals[0] ?? "";
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
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

  if (!authStatusOk()) {
    logError("Not authenticated with the active provider");
    process.stderr.write("Run: key-update-provider\n");
    return EXIT_API_FAILURE;
  }

  const repo = providerRepoTarget("");
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
    console.error(err instanceof Error ? err.message : String(err));
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
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_API_FAILURE);
  },
);
