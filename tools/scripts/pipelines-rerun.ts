#!/usr/bin/env node
// pipelines-rerun.ts - Re-run a GitHub Actions workflow run
// Version: 1.0.0
// Description: Re-runs a whole workflow run, or only its failed jobs
//              (--failed), optionally with debug logging (--debug).
// Requirements: Node >= 23.6 (native type-stripping execution)

import { parseArgs } from "node:util";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { ensureProviderAuth, providerRequireCapability } from "../lib/providers/provider-core.ts";
import { pipelinesRunRerun, pipelinesRunView } from "../lib/providers/github/pipelines.ts";

assertNodeFloor();

ensureProviderAuth();

providerRequireCapability("pipelines");

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
    --repo OWNER/REPO           Repository containing the run (required)
    --failed                    Re-run only failed jobs (not the whole workflow)
    --debug                     Enable debug logging for the re-run

Examples:
    pipelines-rerun 12345678 --repo <org>/my-service
    pipelines-rerun 12345678 --repo <org>/my-service --failed --debug`);
  process.exit(0);
}

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", default: false },
    version: { type: "boolean", default: false },
    repo: { type: "string" },
    failed: { type: "boolean", default: false },
    debug: { type: "boolean", default: false },
  },
  allowPositionals: true,
  strict: false,
});

if (parsed.values.help) usage();
if (parsed.values.version) {
  console.log("1.0.0");
  process.exit(0);
}
repo = typeof parsed.values.repo === "string" ? parsed.values.repo : "";
failedOnly = parsed.values.failed === true;
debugMode = parsed.values.debug === true;

const positionals = parsed.positionals.filter((p) => !p.startsWith("-"));
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
if (repo === "" || !repo.includes("/")) {
  logError("--repo OWNER/REPO is required");
  process.exit(EXIT_MISUSE);
}

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
