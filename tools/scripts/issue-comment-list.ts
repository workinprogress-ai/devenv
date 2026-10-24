#!/usr/bin/env node
// issue-comment-list.ts - List all comments on a GitHub issue with their IDs
// Version: 1.0.0
// Description: Returns each comment's numeric ID, author, timestamps, URL, and a body preview.
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Output contract: one JSON object per line (default) or a pretty JSON array
// (--pretty). bodyPreview truncates at 256 chars with an ellipsis; --full
// swaps it for the complete body.

import { parseArgs } from "node:util";
import {basename} from "node:path";
import {} from "node:fs";

import { EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { checkTargetRepo, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesComments } from "../lib/providers/github/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-comment-list.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} ISSUE_NUMBER [OPTIONS]

List all comments on a GitHub issue, including each comment's numeric ID and a
body preview. The numeric IDs can be passed to issue-comment-update to replace
a comment's body.

Arguments:
    ISSUE_NUMBER                Issue number to list comments for

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --pretty                    Pretty-print as a JSON array (default: one object per line)
    --full                      Return complete body as "body" field instead of the
                                256-character "bodyPreview" truncation
    --devenv                    Safety override to read issues in devenv repo
    --repo OWNER/REPO           Override the target repository

Output Fields (per comment):
    id           Numeric comment ID (use with issue-comment-update)
    author       Login of the comment author
    createdAt    ISO 8601 creation timestamp
    updatedAt    ISO 8601 last-updated timestamp
    bodyPreview  First 256 characters of the comment body (omitted when --full is set)
    body         Complete comment body (only present when --full is set)
    url          Direct link to the comment

Examples:
    ${SCRIPT_NAME} 42
    ${SCRIPT_NAME} 42 --pretty
`);
  process.exit(0);
}

async function main(argv: string[]): Promise<number> {
  let issueNumber = "";
  let pretty = false;
  let full = false;
  let devenv = false;
  let repoOverride = "";
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        pretty: { type: "boolean", default: false },
        full: { type: "boolean", default: false },
        devenv: { type: "boolean", default: false },
        repo: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
    pretty = Boolean(values["pretty"]);
    full = Boolean(values["full"]);
    devenv = Boolean(values["devenv"]);
    repoOverride = values["repo"] ?? "";
    for (const p of positionals) {
      if (issueNumber === "") {
        if (!/^[0-9]+$/.test(p)) {
          logError(`Invalid issue number: ${p}`);
          return EXIT_GENERAL_ERROR;
        }
        issueNumber = p;
      } else {
        logError(`Unexpected argument: ${p}`);
        console.log("Use --help for usage information");
        return EXIT_GENERAL_ERROR;
      }
    }
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_GENERAL_ERROR;
  }

  if (valuesHelp(argv)) showUsage();
  if (versionFlag(argv)) {
    console.log(SCRIPT_VERSION);
    return 0;
  }

  if (issueNumber === "") {
    logError("Issue number is required");
    console.log("Use --help for usage information");
    return EXIT_GENERAL_ERROR;
  }

  checkTargetRepo(devenv);

  const repo = providerRepoTarget(repoOverride);

  let raw: string;
  try {
    raw = await issuesComments(repo, Number.parseInt(issueNumber, 10));
  } catch (err) {
    logError(`Failed to fetch comments for issue #${issueNumber}: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_GENERAL_ERROR;
  }

  type CommentRecord = {
    id?: unknown;
    body?: unknown;
    user?: { login?: unknown };
    created_at?: unknown;
    updated_at?: unknown;
    url?: unknown;
  };
  let comments: CommentRecord[];
  try {
    comments = JSON.parse(raw) as CommentRecord[];
  } catch {
    logError("Failed to parse issue comments");
    return EXIT_GENERAL_ERROR;
  }

  const shaped = comments.map((c) => {
    const body = typeof c.body === "string" ? c.body : "";
    const base: Record<string, unknown> = {
      id: typeof c.id === "number" ? c.id : null,
      author: typeof c.user?.login === "string" ? c.user.login : null,
      createdAt: c.created_at ?? null,
      updatedAt: c.updated_at ?? null,
    };
    if (full) {
      base["body"] = body;
    } else {
      base["bodyPreview"] = body.length > 256 ? body.slice(0, 256) + "…" : body;
    }
    base["url"] = c.url ?? null;
    return base;
  });

  if (pretty) {
    console.log(JSON.stringify(shaped, null, 2));
  } else {
    for (const item of shaped) console.log(JSON.stringify(item));
  }
  return 0;
}

function valuesHelp(argv: string[]): boolean {
  return argv.includes("-h") || argv.includes("--help");
}
function versionFlag(argv: string[]): boolean {
  return argv.includes("-v") || argv.includes("--version");
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
