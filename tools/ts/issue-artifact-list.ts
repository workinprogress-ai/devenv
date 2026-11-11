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

import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { listArtifacts, type Artifact } from "../lib/domain/artifacts.ts";

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
    logError(errorMessage(err));
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

  const repo = requireRepoTarget(providerRepoTarget(args.repo), "issue-artifact-list", "issues");
  if (repo === "") {
    logError("Repository is required: pass --repo or set DEVENV_REPO");
    return EXIT_MISUSE;
  }

  let results: Artifact[];
  try {
    results = await listArtifacts(repo, Number.parseInt(args.issue, 10), args.artifactType);
  } catch (err) {
    logError(errorMessage(err));
    return EXIT_API_FAILURE;
  }

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
    logError(errorMessage(err));
    process.exit(EXIT_API_FAILURE);
  },
);
