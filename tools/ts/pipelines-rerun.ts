#!/usr/bin/env node
// pipelines-rerun.ts - Re-run a GitHub Actions workflow run
// Version: 1.0.0
// Description: Re-runs a whole workflow run, or only its failed jobs
//              (--failed), optionally with debug logging (--debug).
// Requirements: Node >= 23.6 (native type-stripping execution)

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { ensureProviderAuth, } from "../lib/providers/provider-core.ts";
import { requireFamilyCapability } from "../lib/providers/facade/provider-loader.ts";
import { pipelinesRunRerun, pipelinesRunView } from "../lib/providers/facade/pipelines.ts";

assertNodeFloor();

await requireFamilyCapability("pipelines", "pipelines");

let runId = "";
let repo = "";
let failedOnly = false;
let debugMode = false;

function usage(): never {
  console.log(`Usage: pipelines-rerun RUN_ID --repo OWNER/REPO [OPTIONS]

Re-run a GitHub Actions workflow run.

Arguments:
    RUN_ID                      The workflow run ID to re-run

Options:
${usageCommonFlags({ noDryRun: true })}
    --repo OWNER/REPO           Repository containing the run (required)
    --failed                    Re-run only failed jobs (not the whole workflow)
    --debug                     Enable debug logging for the re-run

Examples:
    pipelines-rerun 12345678 --repo <org>/my-service
    pipelines-rerun 12345678 --repo <org>/my-service --failed --debug`);
  process.exit(0);
}

try {
  const cli = toolCli({
    name: "pipelines-rerun",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      repo: { type: "string" },
      failed: { type: "boolean", default: false },
      debug: { type: "boolean", default: false },
    },
  });
  if (cli.common.help) usage();
  repo = typeof cli.values.repo === "string" ? cli.values.repo : "";
  failedOnly = cli.values.failed === true;
  debugMode = cli.values.debug === true;
  const positionals = cli.positionals.filter((p) => !p.startsWith("-"));
  if (positionals.length !== 1) {
    logError("RUN_ID (exactly one positional) is required");
    console.error("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }
  runId = positionals[0] ?? "";
  if (!/^[0-9]+$/.test(runId)) {
    logError(`RUN_ID must be numeric: ${runId}`);
    process.exit(EXIT_MISUSE);
  }
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

const flags: string[] = [];
if (failedOnly) flags.push("--failed");
if (debugMode) flags.push("-d");

const rerun = await pipelinesRunRerun(repo, runId, flags);
if (rerun.status !== 0) {
  logError(`Failed to re-run workflow run: ${runId}`);
  process.exit(EXIT_API_FAILURE);
}

let runUrl = "";
try {
  runUrl = (await pipelinesRunView(repo, runId, {})).trim();
  try {
    const parsedUrl: unknown = JSON.parse(runUrl);
    if (parsedUrl !== null && typeof parsedUrl === "object") {
      runUrl = String((parsedUrl as { url?: unknown }).url ?? "");
    } else {
      runUrl = runUrl.split("\n")[0] ?? "";
    }
  } catch {
    // raw text output — take the first line
    runUrl = runUrl.split("\n")[0] ?? "";
  }
} catch {
  runUrl = "";
}

if (runUrl !== "") {
  logInfo(`Re-run queued: ${runUrl}`);
} else {
  logInfo(`Re-run queued for run ${runId} in ${repo}`);
}
