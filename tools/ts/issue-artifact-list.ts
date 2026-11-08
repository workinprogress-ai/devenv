#!/usr/bin/env node
// issue-artifact-list.ts - List issue-comment artifacts with metadata extracted from headers
// Version: 1.0.0
// Description: Lists deterministic artifacts published to issue comments.
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Resolution contract: scan the issue's comments; a comment is an artifact
// when a `doc_id: ` line appears in its first 256 chars. Fields mirror the
// bash tool exactly (title = first `# ` heading line; updatedAt-desc sort).

import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { basename } from "node:path";

import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesComments } from "../lib/providers/facade/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-artifact-list.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [OPTIONS]

List issue-comment artifacts that include DEVENV metadata headers.

Required Inputs:
    --issue, --issue-number N     Issue number

Optional Filters:
    --artifact-type TYPE          Filter by artifact type (for example: plan; implementation-plan also accepted)

Options:
    --full                        Return full body as "body" (default: bodyPreview only)
    --pretty                      Pretty-print JSON output
    --repo OWNER/REPO             Repository override (defaults to DEVENV_REPO)
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

Output:
    [
      {
        "issue_number": 42,
        "comment_id": 123456,
        "doc_id": "dv1:...",
        "artifact_type": "plan",
        "source_file": "repos/foo/Plan-issue-42-001.md",
        "title": "Plan title",
        "updatedAt": "...",
        "url": "...",
        "bodyPreview": "..."
      }
    ]

Exit Codes:
    0 success
    2 invalid arguments
    4 API/tool failure
`);
  process.exit(0);
}

interface Parsed {
  help: boolean;
  version: boolean;
  verbose: boolean;
  full: boolean;
  pretty: boolean;
  issue: string;
  artifactType: string;
  repo: string;
}

function parseCliArgs(argv: string[]): Parsed {
  try {
    const cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      noDryRun: true,
      allowPositionals: false,
      options: {
        full: { type: "boolean", default: false },
        pretty: { type: "boolean", default: false },
        issue: { type: "string" },
        "issue-number": { type: "string" },
        "issue_number": { type: "string" },
        "artifact-type": { type: "string" },
        "artifact_type": { type: "string" },
        repo: { type: "string" },
      },
    });
    if (cli.common.help) showUsage();
    const v = cli.values as Record<string, string | boolean | undefined>;
    return {
      help: cli.common.help,
      version: cli.common.version,
      verbose: cli.common.verbose,
      full: v["full"] === true,
      pretty: v["pretty"] === true,
      issue: ((v["issue"] as string | undefined) ?? (v["issue-number"] as string | undefined) ?? (v["issue_number"] as string | undefined) ?? ""),
      artifactType: ((v["artifact-type"] as string | undefined) ?? (v["artifact_type"] as string | undefined) ?? ""),
      repo: ((v["repo"] as string | undefined) ?? ""),
    };
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_MISUSE);
  }
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

function headerValue(body: string, key: string): string | null {
  const prefix = body.slice(0, 256);
  for (const line of prefix.split("\n")) {
    if (line.startsWith(`${key}: `)) return line.slice(key.length + 2);
  }
  return null;
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

  const repo = requireRepoTarget(providerRepoTarget(args.repo), "issue-artifact-list", "issues");
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
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    comments = parsed as CommentRecord[];
  } catch {
    // Tolerate a newline-delimited JSON stream (one object per comment —
    // the shape some provider emissions produce): concatenate the objects.
    const records: CommentRecord[] = [];
    let streamed = false;
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (t === "" || t === "[" || t === "]" || t === ",") { continue; }
      try {
        const obj = JSON.parse(t) as CommentRecord;
        if (obj !== null && typeof obj === "object") { records.push(obj); streamed = true; }
      } catch { /* not NDJSON either — fall through to the named error */ }
    }
    if (!streamed || records.length === 0) {
      logError("Failed to parse issue comments");
      return 4;
    }
    comments = records;
  }

  const results: Array<Record<string, unknown>> = [];
  for (const c of comments) {
    const body = typeof c.body === "string" ? c.body : "";
    const docId = headerValue(body, "doc_id");
    if (docId === null || docId === "") continue;
    const foundType = headerValue(body, "artifact_type");
    if (args.artifactType !== "" && foundType !== args.artifactType) continue;
    const heading = body.split("\n").find((l) => l.startsWith("# "));
    results.push({
      issue_number: issueNumberFromUrl(c.issue_url),
      comment_id: typeof c.id === "number" ? c.id : null,
      doc_id: docId,
      artifact_type: foundType,
      source_file: headerValue(body, "source_file"),
      title: heading === undefined ? null : heading.slice(2),
      author: typeof c.user?.login === "string" ? c.user.login : null,
      createdAt: c.created_at ?? null,
      updatedAt: c.updated_at ?? null,
      url: c.url ?? null,
      bodyPreview: body.slice(0, 256),
      body,
    });
  }

  // updatedAt-desc (the bash sort_by(.updatedAt) | reverse).
  results.sort((a, b) => String(b["updatedAt"]).localeCompare(String(a["updatedAt"])));

  const shaped = results.map((r) => {
    const out: Record<string, unknown> = { ...r };
    if (args.full) {
      delete out["bodyPreview"];
    } else {
      delete out["body"];
    }
    return out;
  });

  console.log(args.pretty ? JSON.stringify(shaped, null, 2) : JSON.stringify(shaped));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(4);
  },
);
