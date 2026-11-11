#!/usr/bin/env node
// issue-get.ts - Retrieve a GitHub issue's details as structured JSON
// Version: 1.0.0
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { basename } from "node:path";
import {} from "node:fs";

import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { checkTargetRepo, requireRepoTarget, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesView } from "../lib/providers/facade/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-get.ts");

const DEFAULT_FIELDS = "number,title,parent,issueType,body,state,labels,assignees,milestone,author,createdAt,updatedAt,closedAt,url,comments";

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} ISSUE_NUMBER [OPTIONS]
Retrieve a GitHub issue's details as structured JSON.
Arguments:
    ISSUE_NUMBER                Issue number to retrieve
Options:
${usageCommonFlags({ noDryRun: true })}
    --pretty                    Pretty-print JSON output (default: compact)
    --format FIELD              Print one field as raw text (title, body, state,
                                url, number, author, labels) — replaces jq -r pipelines

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
    const cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      noDryRun: true,
      options: {
        pretty: { type: "boolean", default: false },
        format: { type: "string" },
      },
    });
    if (cli.common.help) showUsage();
    pretty = Boolean(cli.values["pretty"]);
    formatField = (cli.values["format"] as string | undefined) ?? "";
    devenv = cli.common.devenv;
    for (const p of cli.positionals) {
      if (issueNumber === "") {
        if (!/^[0-9]+$/.test(p)) {
          logError(`Invalid issue number: ${p}`);
          return EXIT_MISUSE;
        }
        issueNumber = p;
      } else {
        logError(`Unexpected argument: ${p}`);
        console.error("Use --help for usage information");
        return EXIT_MISUSE;
      }
    }
  } catch (err) {
    logError(errorMessage(err));
    console.error("Use --help for usage information");
    return EXIT_MISUSE;
  }

  if (issueNumber === "") {
    logError("Issue number is required");
    console.error("Use --help for usage information");
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

  const issue = JSON.parse(json) as Record<string, unknown>;
  // Provider-neutral `type`: GitHub's view projects `issueType` as {name}
  // (null when the issue has no native type); Azure's mapped record carries
  // `type` as a string (with `issueType: null` from the facade's `?? null`
  // projection). Flatten only a real object — a null `issueType` must never
  // wipe a real `type` string — and always drop the projection key: the
  // github output shape never carried `issueType` after this point.
  const it = issue["issueType"];
  if (it !== null && it !== undefined && typeof it === "object") {
    issue["type"] = (it as { name?: string }).name ?? "";
  } else if (typeof issue["type"] !== "string") {
    issue["type"] = "";
  }
  delete issue["issueType"];

  if (formatField !== "") {
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

  console.log(pretty ? JSON.stringify(issue, null, 2) : JSON.stringify(issue));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(errorMessage(err));
    process.exit(EXIT_API_FAILURE);
  },
);
