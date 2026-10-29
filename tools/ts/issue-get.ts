#!/usr/bin/env node
// issue-get.ts - Retrieve a GitHub issue's details as structured JSON
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { parseArgs } from "node:util";
import { basename } from "node:path";
import {} from "node:fs";

import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesView } from "../lib/providers/github/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-get.ts");

const DEFAULT_FIELDS = "number,title,parent,body,state,labels,assignees,milestone,author,createdAt,updatedAt,closedAt,url,comments";

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} ISSUE_NUMBER [OPTIONS]
Retrieve a GitHub issue's details as structured JSON.
Arguments:
    ISSUE_NUMBER                Issue number to retrieve
Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --pretty                    Pretty-print JSON output (default: compact)
    --format FIELD              Print one field as raw text (title, body, state,
                                url, number, author, labels) — replaces jq -r pipelines
    --devenv                    Safety override to read issues in devenv repo

Examples:
    ${SCRIPT_NAME} 123
    ${SCRIPT_NAME} 123 --pretty
    ${SCRIPT_NAME} 123 --format title
    ${SCRIPT_NAME} 123 --format labels
`);
  process.exit(0);
}

async function main(argv: string[]): Promise<number> {
  let issueNumber = "";
  let pretty = false;
  let formatField = "";
  let devenv = false;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        pretty: { type: "boolean", default: false },
        format: { type: "string" },
        devenv: { type: "boolean", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    pretty = Boolean(values["pretty"]);
    formatField = values["format"] ?? "";
    devenv = Boolean(values["devenv"]);
    for (const p of positionals) {
      if (issueNumber === "") {
        if (!/^[0-9]+$/.test(p)) {
          logError(`Invalid issue number: ${p}`);
          return EXIT_MISUSE;
        }
        issueNumber = p;
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

  if (issueNumber === "") {
    logError("Issue number is required");
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  checkTargetRepo(devenv);

  const repo = requireRepoTarget(providerRepoTarget(""), "issue-get", "issues");

  let json: string;
  try {
    json = await issuesView(repo, Number.parseInt(issueNumber, 10), { json: DEFAULT_FIELDS });
  } catch (err) {
    logError(`Issue #${issueNumber} not found — ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    return EXIT_API_FAILURE;
  }

  if (formatField !== "") {
    const issue = JSON.parse(json) as Record<string, unknown>;
    if (formatField === "labels") {
      const labels = (issue["labels"] as Array<{ name?: unknown }> | undefined) ?? [];
      console.log(labels.map((l) => String(l.name)).join(","));
    } else {
      const v = issue[formatField];
      if (v === undefined || v === null) {
        // `// empty` contract: absent field prints nothing.
        return 0;
      }
      console.log(typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    return 0;
  }

  console.log(pretty ? JSON.stringify(JSON.parse(json), null, 2) : json);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_API_FAILURE);
  },
);
