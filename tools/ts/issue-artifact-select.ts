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
// The candidate list comes from the artifacts domain's listArtifacts, the
// same enumeration issue-artifact-list uses.

import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { basename } from "node:path";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE, EXIT_CONFLICT, EXIT_API_FAILURE, EXIT_AMBIGUITY } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { listArtifacts, type Artifact } from "../lib/domain/artifacts.ts";

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
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

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
    const cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      noDryRun: true,
      allowPositionals: false,
      options: {
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
    });
    if (cli.common.help) showUsage();
    const v = cli.values as Record<string, string | boolean | undefined>;
    return {
      help: cli.common.help,
      version: cli.common.version,
      issue: ((v["issue"] as string | undefined) ?? (v["issue-number"] as string | undefined) ?? (v["issue_number"] as string | undefined) ?? ""),
      artifactType: ((v["artifact-type"] as string | undefined) ?? (v["artifact_type"] as string | undefined) ?? ""),
      docId: ((v["doc-id"] as string | undefined) ?? (v["doc_id"] as string | undefined) ?? ""),
      latest: v["latest"] === true,
      format: ((v["format"] as string | undefined) ?? "json"),
      pretty: v["pretty"] === true,
      repo: ((v["repo"] as string | undefined) ?? ""),
    };
  } catch (err) {
    logError(errorMessage(err));
    console.error("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }
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

  let artifacts: Artifact[];
  try {
    artifacts = await listArtifacts(repo, Number.parseInt(args.issue, 10), args.artifactType);
  } catch (err) {
    logError(`Failed to list artifacts: ${errorMessage(err)}`);
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
    logError(errorMessage(err));
    process.exit(EXIT_API_FAILURE);
  },
);
