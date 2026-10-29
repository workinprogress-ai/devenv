#!/usr/bin/env node
// issue-types.ts - List the GitHub organization's issue types
// Version: 1.0.0
// Description: Queries the organization's configured issue types (ID + name) via GraphQL.
// Requirements: Node >= 23.6 (native type-stripping execution)
//
// Run via the depth-1 bash stub: `exec node "<resolved-src>.ts" "$@"`
//
// Read-only: used when setting up or verifying the native issue-type
// vocabulary (tools/config/issues-config.yml: Bug, Feature, Task, Epic).

import { parseArgs } from "node:util";
import { basename } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { orgIssueTypes } from "../lib/providers/github/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-types.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [OPTIONS]

List the GitHub organization's configured issue types (ID + name) via GraphQL.
Read-only — used when setting up or verifying the native issue-type vocabulary
(mirrors tools/config/issues-config.yml: Bug, Feature, Task, Epic).

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -f, --format FORMAT         Output format: table (default), json, simple

Environment Variables:
    DEVENV_REPO                 Repository override in owner/repo form (the
                                single repo-targeting env var)

Examples:
    ${SCRIPT_NAME}
    ${SCRIPT_NAME} --format json
`);
  process.exit(0);
}

/** Org resolution: config [organization] org first, then DEVENV_REPO's
 * owner segment (the bash verb's policy_org → DEVENV_REPO chain). */
function resolveOrg(): string {
  const root = process.env["DEVENV_ROOT"] ?? process.cwd();
  const cfg = `${root}/devenv.config`;
  if (existsSync(cfg)) {
    const m = readFileSync(cfg, "utf8").match(/^\s*org\s*=\s*(\S+)/m);
    if (m?.[1]) return m[1];
  }
  const repo = requireRepoTarget(providerRepoTarget(""), "issue-types", "issues");
  if (repo !== "") return repo.split("/")[0] ?? "";
  logError("Cannot resolve organization — configure [organization] org in devenv.config or set DEVENV_REPO");
  return "";
}

async function main(argv: string[]): Promise<number> {
  let format = "table";
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        format: { type: "string", short: "f", default: "table" },
      },
      strict: true,
    });
    if (values["help"]) showUsage();
    if (values["version"]) {
      console.log(SCRIPT_VERSION);
      return 0;
    }
    format = values["format"] ?? "table";
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.log("Use --help for usage information");
    return 1;
  }

  const org = resolveOrg();
  if (org === "") return 1;

  let types;
  try {
    types = await orgIssueTypes(org);
  } catch (err) {
    logError(`Failed to query issue types for org ${org}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (types.length === 0) {
    logError("No issue types returned — is the org configured with issue types? (GitHub org setting: Organization settings → Features → Issue types)");
    return 1;
  }

  switch (format) {
    case "json":
      console.log(JSON.stringify(types, null, 2));
      break;
    case "simple":
      for (const t of types) console.log(t.name);
      break;
    case "table": {
      const nameW = Math.max(...types.map((t) => t.name.length), "NAME".length);
      console.log(`NAME`.padEnd(nameW + 2) + "ID");
      for (const t of types) console.log(t.name.padEnd(nameW + 2) + t.id);
      break;
    }
    default:
      logError(`Invalid format: ${format} (must be table, json, or simple)`);
      return 1;
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
