#!/usr/bin/env node
// pipelines-watch.ts - Stream live output from a GitHub Actions workflow run
// Version: 1.0.0
// Description: Streams gh run watch output; if RUN_ID is omitted,
//              auto-detects the latest in-progress run in the repo.
//              --exit-status exits non-zero when the watched run fails.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { ensureProviderAuth, } from "../lib/providers/provider-core.ts";
import { requireFamilyCapability } from "../lib/providers/facade/provider-loader.ts";
import { pipelinesRunList, pipelinesRunWatch } from "../lib/providers/facade/pipelines.ts";

assertNodeFloor();

await requireFamilyCapability("pipelines", "pipelines");

let runId = "";
let repo = "";
let exitStatus = false;

function usage(): never {
  console.log(`Usage: pipelines-watch [RUN_ID] --repo OWNER/REPO [OPTIONS]

Stream live output from a GitHub Actions workflow run.
If RUN_ID is omitted, auto-detects the latest in-progress run in the repo.

Arguments:
    RUN_ID                      Workflow run ID to watch (optional)

Options:
${usageCommonFlags({ noDryRun: true })}
    --repo OWNER/REPO           Repository containing the run (required)
    --exit-status               Exit non-zero if the watched run fails

Examples:
    pipelines-watch --repo <org>/my-service
    pipelines-watch 12345678 --repo <org>/my-service
    pipelines-watch 12345678 --repo <org>/my-service --exit-status`);
  process.exit(0);
}

try {
  const cli = toolCli({
    name: "pipelines-watch",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      repo: { type: "string" },
      "exit-status": { type: "boolean", default: false },
    },
  });
  if (cli.common.help) usage();
  repo = typeof cli.values.repo === "string" ? cli.values.repo : "";
  exitStatus = cli.values["exit-status"] === true;
  const positionals = cli.positionals.filter((p) => !p.startsWith("-"));
  if (positionals.length > 1) {
    logError("At most one RUN_ID positional is allowed");
    process.exit(EXIT_MISUSE);
  }
  runId = positionals[0] ?? "";
} catch (err) {
  logError(err instanceof Error ? err.message : String(err));
  usage();
}

if (repo === "" || !repo.includes("/")) {
  logError("--repo OWNER/REPO is required");
  process.exit(EXIT_MISUSE);
}

// Auth after argv validation: a usage error must exit 2 without touching gh
// (no network probe on the misuse path).
ensureProviderAuth();

if (runId === "") {
  logInfo(`No RUN_ID provided — detecting latest in-progress run for ${repo}...`);
  try {
    const raw = await pipelinesRunList(repo, { json: "id", jq: ".[0].id // empty", status: "in_progress" });
    runId = raw.trim().split("\n")[0] ?? "";
  } catch {
    runId = "";
  }
  if (runId === "" || runId === "null") {
    logError(`No in-progress runs found for ${repo}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  logInfo(`Found in-progress run: ${runId}`);
}

const flags: string[] = [];
if (exitStatus) flags.push("--exit-status");

const watched = await pipelinesRunWatch(repo, runId, flags);
process.exit(watched.status);
