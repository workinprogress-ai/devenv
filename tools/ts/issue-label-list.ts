#!/usr/bin/env node
// issue-label-list.ts - List a repository's available issue labels
// Version: 1.0.0
// Description: Lists issue labels (name, description, color) with optional substring search.
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`

import { parseArgs } from "node:util";
import {basename} from "node:path";
import {} from "node:fs";

import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { checkTargetRepo, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesLabelList } from "../lib/providers/github/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-label-list.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [OPTIONS]

List a repository's available issue labels (name, description, color).
Read-only — use before suggesting labels in triage so only existing labels
are proposed. Create missing labels with issue-label-create.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -f, --format FORMAT         Output format: table (default), json, simple
    -s, --search TERM           Filter labels by substring (case-insensitive)
    --devenv                    Safety override to list labels in devenv repo

Examples:
    ${SCRIPT_NAME}
    ${SCRIPT_NAME} --search priority
    ${SCRIPT_NAME} --format json
`);
  process.exit(0);
}

interface Label {
  name?: unknown;
  description?: unknown;
  color?: unknown;
}

async function main(argv: string[]): Promise<number> {
  let format = "table";
  let search = "";
  let devenv = false;
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        format: { type: "string", short: "f", default: "table" },
        search: { type: "string", short: "s" },
        devenv: { type: "boolean", default: false },
      },
      strict: true,
    });
    if (values["help"]) showUsage();
    if (values["version"]) {
      console.log(SCRIPT_VERSION);
      return 0;
    }
    format = values["format"] ?? "table";
    search = values["search"] ?? "";
    devenv = Boolean(values["devenv"]);
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return EXIT_MISUSE;
  }

  checkTargetRepo(devenv);

  const repo = providerRepoTarget("");

  let raw: string;
  try {
    raw = await issuesLabelList(repo, { limit: 200, json: "name,description,color" });
  } catch (err) {
    logError(`Failed to list labels: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_API_FAILURE;
  }

  let labels: Label[];
  try {
    labels = JSON.parse(raw) as Label[];
  } catch {
    logError("Failed to parse label list");
    return EXIT_API_FAILURE;
  }

  if (search !== "") {
    const needle = search.toLowerCase();
    labels = labels.filter((l) => typeof l.name === "string" && (l.name as string).toLowerCase().includes(needle));
  }

  switch (format) {
    case "json":
      console.log(JSON.stringify(labels, null, 2));
      break;
    case "simple":
      for (const l of labels) console.log(String(l.name));
      break;
    case "table": {
      const nameW = Math.max(...labels.map((l) => String(l.name).length), 4);
      const colorW = Math.max(...labels.map((l) => String(l.color ?? "").length), 5);
      console.log("NAME".padEnd(nameW + 2) + "COLOR".padEnd(colorW + 2) + "DESCRIPTION");
      for (const l of labels) {
        console.log(
          String(l.name).padEnd(nameW + 2) +
            String(l.color ?? "").padEnd(colorW + 2) +
            String(l.description ?? ""),
        );
      }
      break;
    }
    default:
      logError(`Invalid format: ${format} (must be table, json, or simple)`);
      return EXIT_MISUSE;
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
