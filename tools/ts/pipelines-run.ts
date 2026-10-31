#!/usr/bin/env node
// pipelines-run.ts - Trigger a GitHub Actions workflow_dispatch event
// Version: 1.0.0
// Description: After queuing, polls briefly to print the run URL.
//              'gh workflow run' does not return a run ID directly — the URL
//              is retrieved by polling 'gh run list' after a short delay; it
//              may occasionally miss a run if the system is busy (known gh CLI
//              limitation).
// Requirements: Node >= 23.6 (native type-stripping execution)

import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { ensureProviderAuth, providerRequireCapability } from "../lib/providers/provider-core.ts";
import { pipelinesWorkflowRun, pipelinesRunList } from "../lib/providers/github/pipelines.ts";

assertNodeFloor();

ensureProviderAuth();

providerRequireCapability("pipelines");

let workflow = "";
let repo = "";
let ref = "";
const inputs: string[] = [];

function usage(): never {
  console.log(`Usage: pipelines-run WORKFLOW --repo OWNER/REPO [OPTIONS]

Trigger a GitHub Actions workflow_dispatch event. After queuing, polls briefly
to print the run URL.

Arguments:
    WORKFLOW                    Workflow file name (e.g. ci.yml) or display name

Options:
    --repo OWNER/REPO           Repository to run workflow in (required)
    --ref REF                   Branch or tag to run on (default: repo default branch)
    --input KEY=VALUE           Workflow dispatch input (repeatable)

Examples:
    pipelines-run ci.yml --repo <org>/my-service
    pipelines-run deploy.yml --repo <org>/my-service --input environment=staging`);
  process.exit(0);
}

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", default: false },
    version: { type: "boolean", default: false },
    repo: { type: "string" },
    ref: { type: "string" },
    input: { type: "string", multiple: true },
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
ref = typeof parsed.values.ref === "string" ? parsed.values.ref : "";
for (const i of parsed.values.input ?? []) {
  if (typeof i === "string") inputs.push(i);
}

const positionals = parsed.positionals.filter((p) => !p.startsWith("-"));
if (positionals.length !== 1) {
  logError("WORKFLOW (exactly one positional) is required");
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}
workflow = positionals[0] ?? "";

if (repo === "" || !repo.includes("/")) {
  logError("--repo OWNER/REPO is required");
  process.exit(EXIT_MISUSE);
}

const triggerFlags: string[] = [];
if (ref !== "") triggerFlags.push("--ref", ref);
for (const input of inputs) {
  triggerFlags.push("--field", input);
}

const queued = await pipelinesWorkflowRun(repo, workflow, triggerFlags);
if (queued.status !== 0) {
  logError(`Failed to trigger workflow: ${workflow}`);
  process.exit(EXIT_GENERAL_ERROR);
}

logInfo("Workflow queued. Fetching run URL...");

// gh workflow run does not return a run ID or URL. Poll after a short delay.
spawnSleep(2);

let runUrl = "";
try {
  const raw = await pipelinesRunList(repo, { json: "url", jq: ".[0].url // empty" });
  runUrl = raw.trim();
} catch {
  runUrl = "";
}

if (runUrl !== "" && runUrl !== "null") {
  logInfo(`Run URL: ${runUrl}`);
} else {
  logWarn("Run queued but URL not yet available.");
  logWarn(`Check: pipelines-status --repo ${repo} --workflow ${workflow}`);
}

function spawnSleep(seconds: number): void {
  spawnSync("sleep", [String(seconds)], { stdio: "ignore" });
}
