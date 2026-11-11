#!/usr/bin/env node
// policy-export.ts - Export a GitHub repository ruleset as JSON
// Version: 1.1.0
// Description: With no RULESET_ID, lists the repository's rulesets
//              (id, name, enforcement) instead. Read-only.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { writeFileSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { ensureProviderAuth, checkTargetRepo, providerOrgGet, providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { orgRulesetsList, orgRulesetGet } from "../lib/providers/facade/org.ts";

assertNodeFloor();

let rulesetId = "";
let outputFile = "";

function usage(): never {
  console.log(`Usage: policy-export [RULESET_ID] [OPTIONS]

Export a GitHub repository ruleset as JSON. With no RULESET_ID, lists the
repository's rulesets (id, name, enforcement) instead. Read-only.

Options:
    -o, --output FILE           Write JSON to FILE instead of stdout
${usageCommonFlags({ noDryRun: true })}

Examples:
    policy-export
    policy-export 8612
    policy-export 8612 --output ruleset-backup.json`);
  process.exit(0);
}

const SCRIPT_VERSION = "1.1.0";

let devenvOverride = false;
try {
  const cli = toolCli({
    name: "policy-export",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      output: { type: "string", short: "o" },
    },
  });
  if (cli.common.help) usage();
  devenvOverride = cli.common.devenv;
  outputFile = (cli.values["output"] as string | undefined) ?? "";
  const positionals = cli.positionals;
  if (positionals.length > 1) {
    throw new Error("At most one RULESET_ID positional is allowed");
  }
  rulesetId = positionals[0] ?? "";
  if (rulesetId !== "" && !/^[0-9]+$/.test(rulesetId)) {
    throw new Error(`Invalid ruleset ID: ${rulesetId} (must be numeric)`);
  }
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

// Authenticate only after the arguments parsed: help and misuse need no provider.
ensureProviderAuth();

if (providerOrgGet() === "") {
  logError("Organization identity unresolved. Configure [organization] org in devenv.config or run setup.");
  process.exit(EXIT_MISUSE);
}

const ownerRepo = requireRepoTarget(providerRepoTarget(), "policy-export", "pipelines");
if (ownerRepo === "") {
  logError("Cannot resolve target repository — set DEVENV_REPO");
  process.exit(EXIT_GENERAL_ERROR);
}

// Devenv-repo safety gate: implicit targets only.
checkTargetRepo(devenvOverride);

if (rulesetId === "") {
  let raw: string;
  try {
    raw = await orgRulesetsList(ownerRepo);
  } catch {
    logError("Failed to list rulesets");
    process.exit(EXIT_GENERAL_ERROR);
  }
  let parsed: Array<{ id?: unknown; name?: unknown; enforcement?: unknown }> = [];
  try {
    parsed = JSON.parse(raw);
  } catch {
    logError("Failed to parse the ruleset list");
    process.exit(EXIT_GENERAL_ERROR);
  }
  for (const r of parsed) {
    console.log(`${r.id ?? ""}  ${r.name ?? ""}  ${r.enforcement ?? ""}`);
  }
  process.exit(0);
}

let raw: string;
try {
  raw = await orgRulesetGet(ownerRepo, rulesetId);
} catch {
  logError(`Failed to fetch ruleset ${rulesetId}`);
  process.exit(EXIT_GENERAL_ERROR);
}

let pretty: string;
try {
  pretty = JSON.stringify(JSON.parse(raw), null, 2);
} catch {
  pretty = raw;
}

if (outputFile !== "") {
  writeFileSync(outputFile, `${pretty}\n`);
  logInfo(`Ruleset ${rulesetId} written to ${outputFile}`);
} else {
  console.log(pretty);
}
