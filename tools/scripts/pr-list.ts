#!/usr/bin/env node
// pr-list.ts - List GitHub pull requests with filters (JSON by default).
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
import { prsList } from "../lib/providers/github/prs.ts";
import { authStatusOk } from "../lib/providers/github/urls.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "pr-list.ts");

const DEFAULT_FIELDS = "number,title,state,isDraft,headRefName,baseRefName,author,labels,createdAt,updatedAt,url";

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [OPTIONS]

List and filter GitHub pull requests. Output is JSON by default.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --pretty                    Pretty-print JSON output
    --table                     Output as a human-readable table
    --devenv                    Safety override for devenv repo

Filters:
    -s, --state STATE           PR state: open, closed, merged, all (default: open)
    -a, --author USER           Filter by author login (use \`@me\` for self)
    -l, --label LABEL           Filter by label
    --base BRANCH               Filter by target branch
    --head BRANCH               Filter by source branch
    --limit N                   Max number of PRs to return (default: 30)

Environment Variables:
    DEVENV_REPO                 Repository in format owner/repo (default: current repo)

Examples:
    # All open PRs (JSON)
    ${SCRIPT_NAME}

    # My open PRs
    ${SCRIPT_NAME} --author @me

    # Pipe into jq
    ${SCRIPT_NAME} | jq -r '.[] | "\\(.number)\\t\\(.title)"'
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
  let state = "open";
  let author = "";
  let label = "";
  let baseBranch = "";
  let headBranch = "";
  let limit = "30";
  let outputFormat = "json";
  let devenv = false;
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        verbose: { type: "boolean", short: "V", default: false },
        pretty: { type: "boolean", default: false },
        table: { type: "boolean", default: false },
        devenv: { type: "boolean", default: false },
        state: { type: "string", short: "s" },
        author: { type: "string", short: "a" },
        label: { type: "string", short: "l" },
        base: { type: "string" },
        head: { type: "string" },
        limit: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });
    if (values["help"]) showUsage();
    if (values["version"]) {
      console.log(SCRIPT_VERSION);
      return 0;
    }
    if (values["table"]) outputFormat = "table";
    if (values["pretty"]) outputFormat = "pretty";
    devenv = values["devenv"] === true;
    state = values["state"] ?? "open";
    author = values["author"] ?? "";
    label = values["label"] ?? "";
    baseBranch = values["base"] ?? "";
    headBranch = values["head"] ?? "";
    limit = values["limit"] ?? "30";
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (!["open", "closed", "merged", "all"].includes(state)) {
    logError(`Invalid state: ${state} (must be open, closed, merged, or all)`);
    return EXIT_MISUSE;
  }
  if (!/^[0-9]+$/.test(limit)) {
    logError(`Invalid limit: ${limit} (must be numeric)`);
    return EXIT_MISUSE;
  }

  if (!authStatusOk()) {
    logError("Not authenticated with the active provider");
    process.stderr.write("Run: key-update-provider\n");
    return EXIT_API_FAILURE;
  }

  checkTargetRepo(devenv);

  // The repo travels in prsList's own first slot only; repeating it here
  // forwarded a second bare positional, which `gh pr list` rejects.
  const opts = {
    state,
    limit: Number.parseInt(limit, 10),
    ...(author !== "" ? { author } : {}),
    ...(label !== "" ? { label } : {}),
    ...(baseBranch !== "" ? { base: baseBranch } : {}),
    ...(headBranch !== "" ? { head: headBranch } : {}),
  };

  if (outputFormat === "table") {
    try {
      const r = await prsList("", opts);
      process.stdout.write(r.stdout);
      return 0;
    } catch {
      logError("Failed to list PRs");
      return EXIT_API_FAILURE;
    }
  }

  let json: string;
  try {
    json = (await prsList("", { ...opts, json: DEFAULT_FIELDS })).stdout;
  } catch {
    logError("Failed to list PRs");
    return EXIT_API_FAILURE;
  }

  if (outputFormat === "pretty") {
    console.log(JSON.stringify(JSON.parse(json), null, 2));
  } else {
    process.stdout.write(json);
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
