#!/usr/bin/env node
// pipelines-run.ts - Trigger a GitHub Actions workflow_dispatch event
// Version: 1.0.0
// Description: After queuing, polls briefly to print the run URL.
//              'gh workflow run' does not return a run ID directly — the URL
//              is retrieved by polling 'gh run list' after a short delay; it
//              may occasionally miss a run if the system is busy (known gh CLI
//              limitation).
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { ensureProviderAuth, } from "../lib/providers/provider-core.ts";
import { requireFamilyCapability } from "../lib/providers/facade/provider-loader.ts";
import { pipelinesWorkflowRun, pipelinesRunList, pipelinesRunView } from "../lib/providers/facade/pipelines.ts";

assertNodeFloor();

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
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
    --repo OWNER/REPO           Repository to run workflow in (required)
    --ref REF                   Branch or tag to run on (default: repo default branch)
    --input KEY=VALUE           Workflow dispatch input (repeatable)

Examples:
    pipelines-run ci.yml --repo <org>/my-service
    pipelines-run deploy.yml --repo <org>/my-service --input environment=staging`);
  process.exit(0);
}

try {
  const cli = toolCli({
    name: "pipelines-run",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      repo: { type: "string" },
      ref: { type: "string" },
      input: { type: "string", multiple: true },
    },
  });
  if (cli.common.help) usage();
  repo = typeof cli.values.repo === "string" ? cli.values.repo : "";
  ref = typeof cli.values.ref === "string" ? cli.values.ref : "";
  for (const i of (cli.values.input as string[] | undefined) ?? []) {
    if (typeof i === "string") inputs.push(i);
  }
  const positionals = cli.positionals;
  if (positionals.length !== 1) {
    logError("WORKFLOW (exactly one positional) is required");
    console.error("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }
  workflow = positionals[0] ?? "";
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

if (repo === "" || !repo.includes("/")) {
  logError("--repo OWNER/REPO is required");
  process.exit(EXIT_MISUSE);
}
for (const input of inputs) {
  if (!input.includes("=") || input.startsWith("=")) {
    logError(`Invalid --input: ${input} (expected KEY=VALUE)`);
    process.exit(EXIT_MISUSE);
  }
}

// Provider resolution and authentication happen only after the arguments
// parsed: help and misuse need neither config nor network.
await requireFamilyCapability("pipelines", "pipelines");
ensureProviderAuth();

const triggerFlags: string[] = [];
if (ref !== "") triggerFlags.push("--ref", ref);
for (const input of inputs) {
  // -f is gh's --raw-field: the value is always a literal string. -F would read
  // "@file" from the local disk into the workflow input.
  triggerFlags.push("-f", input);
}

const queued = await pipelinesWorkflowRun(repo, workflow, triggerFlags);
if (queued.status !== 0) {
  logError(`Failed to trigger workflow: ${workflow}`);
  process.exit(EXIT_GENERAL_ERROR);
}

logInfo("Workflow queued. Fetching run URL...");

// gh workflow run does not return a run ID or URL: poll for the latest run
// after a short delay. A provider that does hand back the queued run's id (a
// bare positive integer on stdout) is asked for that run's URL instead, so the
// URL is never another run's.
let runUrl = "";
const queuedId = queued.stdout.trim();
if (/^[1-9][0-9]*$/.test(queuedId)) {
  try {
    runUrl = (await pipelinesRunView(repo, queuedId, { json: "url", jq: ".url" })).trim();
  } catch {
    runUrl = "";
  }
}
if (runUrl === "") {
  spawnSleep(2);
  try {
    const raw = await pipelinesRunList(repo, { json: "url", jq: ".[0].url // empty" });
    runUrl = raw.trim();
  } catch {
    runUrl = "";
  }
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
