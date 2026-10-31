#!/usr/bin/env node
// issue-artifact-select.ts - Resolve a single issue artifact from issue comments
// Version: 1.0.0
// Description: Selects exactly one artifact by doc_id, latest update, or single-match rule.
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Selection rules (contract):
//   1) --doc-id selects that exact artifact (0 → not-found, >1 → conflict).
//   2) Else exactly one filtered match is selected.
//   3) Else --latest picks the most recently updated (issue-artifact-list's
//      updatedAt-desc order makes that the first entry).
//   4) Else an ambiguity report (exit 5) with the candidates.
//
// The candidate list comes from issue-artifact-list's enumeration logic,
// invoked in-process (same tree, no shell-out).

import { parseArgs } from "node:util";
import { basename } from "node:path";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE, EXIT_CONFLICT, EXIT_API_FAILURE, EXIT_AMBIGUITY } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesComments } from "../lib/providers/github/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-artifact-select.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [OPTIONS]

Resolve exactly one issue artifact comment for downstream workflows.

Required Inputs:
    --issue, --issue-number N     Issue number

Optional Filters:
    --artifact-type TYPE          Filter by artifact type (for example: plan; implementation-plan also accepted)
    --doc-id ID                   Select a specific artifact by doc_id
    --latest                      If multiple matches, select the most recently updated

Options:
    -f, --format FORMAT           Output format: json, doc-id, comment-id, url (default: json)
    --pretty                      Pretty-print JSON output
    --repo OWNER/REPO             Repository override (defaults to DEVENV_REPO)
    -V, --verbose                 Enable verbose logs
    -h, --help                    Show help and exit
    -v, --version                 Show version and exit

Selection rules:
    1) If --doc-id is provided, select that exact artifact.
    2) Else if exactly one artifact matches filters, select it.
    3) Else if --latest is set, pick the most recently updated artifact.
    4) Else return an ambiguity error with candidate artifacts.

Examples:
    ${SCRIPT_NAME} --issue 42 --artifact-type plan --latest --format doc-id
    ${SCRIPT_NAME} --issue 42 --doc-id "dv1:org/repo:issue-42:plan:x" --format url
`);
  process.exit(0);
}

interface Parsed {
  help: boolean;
  version: boolean;
  issue: string;
  artifactType: string;
  docId: string;
  latest: boolean;
  format: string;
  pretty: boolean;
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
        issue: { type: "string" },
        "issue-number": { type: "string" },
        "issue_number": { type: "string" },
        "artifact-type": { type: "string" },
        "artifact_type": { type: "string" },
        "doc-id": { type: "string" },
        "doc_id": { type: "string" },
        latest: { type: "boolean", default: false },
        format: { type: "string", short: "f", default: "json" },
        pretty: { type: "boolean", default: false },
        repo: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });
    return {
      help: Boolean(values["help"]),
      version: Boolean(values["version"]),
      issue: values["issue"] ?? values["issue-number"] ?? values["issue_number"] ?? "",
      artifactType: values["artifact-type"] ?? values["artifact_type"] ?? "",
      docId: values["doc-id"] ?? values["doc_id"] ?? "",
      latest: Boolean(values["latest"]),
      format: values["format"] ?? "json",
      pretty: Boolean(values["pretty"]),
      repo: values["repo"] ?? "",
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

interface Artifact {
  issue_number: number | null;
  comment_id: number | null;
  doc_id: string;
  artifact_type: string | null;
  source_file: string | null;
  title: string | null;
  author: string | null;
  createdAt: unknown;
  updatedAt: unknown;
  url: unknown;
  bodyPreview: string;
  body: string;
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

/** Enumeration logic shared with issue-artifact-list (same field set, same
 * updatedAt-desc order). */
export async function listArtifacts(
  repo: string,
  issue: number,
  artifactTypeFilter: string,
): Promise<Artifact[] | null> {
  let raw: string;
  try {
    raw = await issuesComments(repo, issue);
  } catch {
    return null;
  }
  let comments: CommentRecord[];
  try {
    comments = JSON.parse(raw) as CommentRecord[];
  } catch {
    return null;
  }
  const results: Artifact[] = [];
  for (const c of comments) {
    const body = typeof c.body === "string" ? c.body : "";
    const docId = headerValue(body, "doc_id");
    if (docId === null || docId === "") continue;
    const foundType = headerValue(body, "artifact_type");
    if (artifactTypeFilter !== "" && foundType !== artifactTypeFilter) continue;
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
  results.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return results;
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
  if (!["json", "doc-id", "comment-id", "url"].includes(args.format)) {
    logError(`Invalid format: ${args.format} (use json|doc-id|comment-id|url)`);
    return EXIT_MISUSE;
  }

  const repo = requireRepoTarget(providerRepoTarget(args.repo), "issue-artifact-select", "issues");
  if (repo === "") {
    logError("Repository is required: pass --repo or set DEVENV_REPO");
    return EXIT_MISUSE;
  }

  const artifacts = await listArtifacts(repo, Number.parseInt(args.issue, 10), args.artifactType);
  if (artifacts === null) {
    logError("Failed to list artifacts");
    return EXIT_API_FAILURE;
  }

  let selected: Artifact;
  if (args.docId !== "") {
    const docMatches = artifacts.filter((a) => a.doc_id === args.docId);
    if (docMatches.length === 0) {
      logError(`No artifact found for doc_id: ${args.docId}`);
      return EXIT_GENERAL_ERROR;
    }
    if (docMatches.length > 1) {
      console.log(JSON.stringify({
        action: "conflict",
        issue_number: Number.parseInt(args.issue, 10),
        doc_id: args.docId,
        matches: docMatches.map((m) => m.comment_id),
      }));
      return EXIT_CONFLICT;
    }
    selected = docMatches[0] as Artifact;
  } else {
    if (artifacts.length === 0) {
      logError("No artifacts matched the requested filters");
      return EXIT_GENERAL_ERROR;
    }
    if (artifacts.length === 1 || args.latest) {
      selected = artifacts[0] as Artifact;
    } else {
      console.log(JSON.stringify({
        action: "ambiguous",
        issue_number: Number.parseInt(args.issue, 10),
        ...(args.artifactType !== "" ? { artifact_type: args.artifactType } : {}),
        matches: artifacts.map((a) => ({
          comment_id: a.comment_id,
          doc_id: a.doc_id,
          artifact_type: a.artifact_type,
          title: a.title,
          updatedAt: a.updatedAt,
          url: a.url,
        })),
      }));
      return EXIT_AMBIGUITY;
    }
  }

  const out: Record<string, unknown> = { ...selected };
  delete out["body"];
  delete out["bodyPreview"];

  switch (args.format) {
    case "doc-id":
      console.log(String(selected.doc_id));
      break;
    case "comment-id":
      console.log(String(selected.comment_id));
      break;
    case "url":
      console.log(String(selected.url));
      break;
    default:
      console.log(args.pretty ? JSON.stringify(out, null, 2) : JSON.stringify(out));
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(5);
  },
);
