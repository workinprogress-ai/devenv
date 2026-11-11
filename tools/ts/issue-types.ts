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

import { basename } from "node:path";

import { configGetRaw } from "../lib/core/config.ts";
import { logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { selfRoot } from "../lib/core/self-root.ts";
import { toolCli, usageCommonFlags, usageEnvBlock } from "../lib/core/cli.ts";
import { providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { orgIssueTypes } from "../lib/providers/facade/issues.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_NAME = basename(process.argv[1] ?? "issue-types.ts");

function showUsage(): never {
  console.log(`Usage: ${SCRIPT_NAME} [OPTIONS]

List the GitHub organization's configured issue types (ID + name) via GraphQL.
Read-only — used when setting up or verifying the native issue-type vocabulary
(mirrors tools/config/issues-config.yml: Bug, Feature, Task, Epic).

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
    -f, --format FORMAT         Output format: table (default), json, simple

${usageEnvBlock()}

Examples:
    ${SCRIPT_NAME}
    ${SCRIPT_NAME} --format json
`);
  process.exit(0);
}

/** Org resolution: config [organization] org first, then DEVENV_REPO's
 * owner segment (the bash verb's policy_org → DEVENV_REPO chain). */
function resolveOrg(): string {
  const root = process.env["DEVENV_ROOT"] ?? selfRoot(import.meta.url);
  const cfg = `${root}/devenv.config`;
  const configured = configGetRaw(cfg, "organization", "org");
  if (configured !== undefined && configured !== "") return configured;
  const repo = requireRepoTarget(providerRepoTarget(""), "issue-types", "issues");
  if (repo !== "") return repo.split("/")[0] ?? "";
  logError("Cannot resolve organization — configure [organization] org in devenv.config or set DEVENV_REPO");
  return "";
}

async function main(argv: string[]): Promise<number> {
  let format = "table";
  try {
    const cli = toolCli({
      name: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      argv,
      noDryRun: true,
      allowPositionals: false,
      options: {
        format: { type: "string", short: "f", default: "table" },
      },
    });
    if (cli.common.help) showUsage();
    format = ((cli.values["format"] as string | undefined) ?? "table");
    if (format !== "table" && format !== "json" && format !== "simple") {
      throw new Error(`Invalid format: ${format} (must be table, json, or simple)`);
    }
  } catch (err) {
    logError(errorMessage(err));
    console.error("Use --help for usage information");
    return EXIT_MISUSE;
  }

  const org = resolveOrg();
  if (org === "") return 1;

  let types;
  try {
    types = await orgIssueTypes(org);
  } catch (err) {
    logError(`Failed to query issue types for org ${org}: ${errorMessage(err)}`);
    return EXIT_API_FAILURE;
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
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(errorMessage(err));
    process.exit(1);
  },
);
