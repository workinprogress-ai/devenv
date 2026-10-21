#!/usr/bin/env node
// issue-artifact-get.ts - Retrieve a deterministic issue-comment artifact by doc_id
// Version: 1.1.0
// Description: Fetches exactly one issue comment artifact matched by doc_id metadata line.
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Resolution contract: scan the issue's comments, match by the `doc_id: `
// line inside the comment body's first 1024 chars, parse the artifact
// header keys, and enforce the single-match invariant (0 → not-found,
// >1 → conflict report). Output field names are the bash tool's exact set.

import { parseArgs } from "node:util";
import { basename, dirname } from "node:path";
import { writeFileSync, existsSync } from "node:fs";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE, EXIT_CONFLICT } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesComments } from "../lib/providers/github/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-artifact-get.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [OPTIONS]

Retrieve a single issue-comment artifact by deterministic doc_id.

Required Inputs:
    --issue, --issue-number N     Issue number
    --doc-id ID                   Artifact doc_id to resolve

Options:
    --full                        Return full body as "body" (default: bodyPreview only)
    --write-body PATH             Write the raw unescaped markdown body to PATH and
                                  report it as "bodyFile" in the output (works with
                                  or without --full)
    --pretty                      Pretty-print JSON output
    --repo OWNER/REPO             Repository override (defaults to DEVENV_REPO)
    -V, --verbose                 Enable verbose logs
    -h, --help                    Show help and exit
    -v, --version                 Show version and exit

Output:
    { "issue_number": N, "doc_id": "...", "comment_id": N, "artifact_type": "...",
      "header": {...}, "author": "...", "createdAt": "...", "updatedAt": "...",
      "url": "...", "bodyPreview": "..." | "body": "...", "bodyFile": "..." }

    "header" contains the parsed DEVENV_ARTIFACT_V1 metadata block (keys present
    only when found in the artifact; "issue_number" is a string, "none" when unset).

Exit Codes:
    0 success
    1 not found
    2 invalid arguments
    3 duplicate doc_id conflict
    4 API/tool failure
`);
  process.exit(0);
}

interface CommentRecord {
  id?: unknown;
  body?: unknown;
  user?: { login?: unknown };
  created_at?: unknown;
  updated_at?: unknown;
  url?: unknown;
  issue_url?: unknown;
}

interface Parsed {
  help: boolean;
  version: boolean;
  verbose: boolean;
  full: boolean;
  pretty: boolean;
  issue: string;
  docId: string;
  writeBody: string;
  repo: string;
}

function parseCliArgs(argv: string[]): Parsed {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        verbose: { type: "boolean", short: "V", default: false },
        full: { type: "boolean", default: false },
        pretty: { type: "boolean", default: false },
        issue: { type: "string" },
        "issue-number": { type: "string" },
        "issue_number": { type: "string" },
        "doc-id": { type: "string" },
        "doc_id": { type: "string" },
        "write-body": { type: "string" },
        repo: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });
    return {
      help: Boolean(values["help"]),
      version: Boolean(values["version"]),
      verbose: Boolean(values["verbose"]),
      full: Boolean(values["full"]),
      pretty: Boolean(values["pretty"]),
      issue: values["issue"] ?? values["issue-number"] ?? values["issue_number"] ?? "",
      docId: values["doc-id"] ?? values["doc_id"] ?? "",
      writeBody: values["write-body"] ?? "",
      repo: values["repo"] ?? "",
    };
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_MISUSE);
  }
}

/** The doc_id line inside the body's first 1024 chars (the match key). */
function foundDocId(body: string): string {
  const prefix = body.slice(0, 1024);
  for (const line of prefix.split("\n")) {
    if (line.startsWith("doc_id: ")) return line.slice("doc_id: ".length);
  }
  return "";
}

/** The artifact header keys found among the first-1024 lines. */
function parseHeader(body: string): Record<string, string> {
  const prefix = body.slice(0, 1024);
  const header: Record<string, string> = {};
  for (const line of prefix.split("\n")) {
    const m = line.match(/^(doc_id|artifact_type|artifact_scope|issue_number|source_file|updated_at_utc): ?(.*)$/);
    if (m) {
      header[m[1] as string] = m[2] ?? "";
    }
  }
  return header;
}

function issueNumberFromUrl(url: unknown): number | null {
  if (typeof url !== "string") return null;
  const m = url.match(/\/issues\/(\d+)$/);
  return m ? Number.parseInt(m[1] as string, 10) : null;
}

async function main(argv: string[]): Promise<number> {
  const args = parseCliArgs(argv);
  if (args.help) showUsage();
  if (args.version) {
    console.log(SCRIPT_VERSION);
    return 0;
  }

  if (args.issue === "") {
    logError("issue_number is required (--issue or --issue-number)");
    return EXIT_MISUSE;
  }
  if (!/^[0-9]+$/.test(args.issue)) {
    logError(`Invalid issue number: '${args.issue}'`);
    return EXIT_MISUSE;
  }
  if (args.docId === "") {
    logError("doc_id is required (--doc-id)");
    return EXIT_MISUSE;
  }

  const repo = providerRepoTarget(args.repo);
  if (repo === "") {
    logError("Repository is required: pass --repo or set DEVENV_REPO");
    return EXIT_MISUSE;
  }

  let raw: string;
  try {
    raw = await issuesComments(repo, Number.parseInt(args.issue, 10));
  } catch (err) {
    logError(`Failed to fetch comments for issue #${args.issue}: ${err instanceof Error ? err.message : String(err)}`);
    return 4;
  }

  let comments: CommentRecord[];
  try {
    comments = JSON.parse(raw) as CommentRecord[];
  } catch {
    logError("Failed to parse issue comments");
    return 4;
  }

  const matches = [];
  for (const c of comments) {
    const body = typeof c.body === "string" ? c.body : "";
    const found = foundDocId(body);
    if (found !== args.docId) continue;
    const num = issueNumberFromUrl(c.issue_url);
    matches.push({
      issue_number: num,
      doc_id: found,
      comment_id: typeof c.id === "number" ? c.id : null,
      artifact_type: parseHeader(body)["artifact_type"] ?? null,
      header: parseHeader(body),
      author: typeof c.user?.login === "string" ? c.user.login : null,
      createdAt: c.created_at ?? null,
      updatedAt: c.updated_at ?? null,
      url: c.url ?? null,
      bodyPreview: body.slice(0, 256),
      body,
    });
  }

  if (matches.length === 0) {
    logError(`No artifact comment found for doc_id: ${args.docId}`);
    return EXIT_GENERAL_ERROR;
  }
  if (matches.length > 1) {
    const conflict = {
      action: "conflict",
      issue_number: Number.parseInt(args.issue, 10),
      doc_id: args.docId,
      matches: matches.map((m) => m.comment_id),
    };
    console.log(JSON.stringify(conflict));
    return EXIT_CONFLICT;
  }

  if (args.writeBody !== "") {
    const dir = dirname(args.writeBody);
    if (!existsSync(dir)) {
      logError(`Directory does not exist: ${dir}`);
      return EXIT_MISUSE;
    }
    try {
      writeFileSync(args.writeBody, matches[0]?.["body"] as string);
    } catch (err) {
      logError(`Failed to write body to ${args.writeBody}: ${err instanceof Error ? err.message : String(err)}`);
      return 4;
    }
  }

  const first = matches[0] as Record<string, unknown>;
  const result: Record<string, unknown> = { ...first };
  if (args.full) {
    delete result["bodyPreview"];
  } else {
    delete result["body"];
  }
  if (args.writeBody !== "") {
    result["bodyFile"] = args.writeBody;
  }

  console.log(args.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
