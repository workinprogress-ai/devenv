#!/usr/bin/env node
// pipelines-run.ts - Trigger a GitHub Actions workflow_dispatch event
// Version: 1.0.0
// Description: After queuing, prints the queued run's URL. 'gh workflow run'
//              does not return a run ID, so the run is found in the run list:
//              it must be absent from a snapshot taken before the trigger, be
//              created at or after the trigger time, and match the workflow
//              and event. More than one match, or none within the bound, is
//              reported instead of guessed.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { basename } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { ensureProviderAuth } from "../lib/providers/provider-core.ts";
import { requireFamilyCapability } from "../lib/providers/facade/provider-loader.ts";
import {
  pipelinesQueuedRunStrategy,
  pipelinesWorkflowRun,
  pipelinesRunList,
  pipelinesRunView,
  pipelinesWorkflowList,
} from "../lib/providers/facade/pipelines.ts";
import { findQueuedRun } from "../lib/domain/pipelines/queued-run.ts";

assertNodeFloor();

const RUN_LIST_LIMIT = 30;
const RUN_LIST_FIELDS = "id,workflowName,event,createdAt,url";

let workflow = "";
let repo = "";
let ref = "";
const inputs: string[] = [];

function usage(): never {
  console.log(`Usage: pipelines-run WORKFLOW --repo OWNER/REPO [OPTIONS]

Trigger a GitHub Actions workflow_dispatch event. After queuing, finds the
queued run and prints its URL.

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

const queuedRunStrategy = await pipelinesQueuedRunStrategy();
const snapshotIds = new Set<string>();
if (queuedRunStrategy.kind === "search") {
  // A provider without a response id needs a pre-trigger snapshot to identify
  // which later run belongs to this invocation.
  try {
    const before = JSON.parse(await pipelinesRunList(repo, { limit: RUN_LIST_LIMIT, json: RUN_LIST_FIELDS })) as unknown;
    if (Array.isArray(before)) {
      for (const run of before as Array<{ id?: unknown }>) snapshotIds.add(String(run.id));
    }
  } catch {
    // An unreadable snapshot leaves the trigger-time check to do the work.
  }
}

const triggerTime = Date.now();
const queued = await pipelinesWorkflowRun(repo, workflow, triggerFlags);
if (queued.status !== 0) {
  logError(`Failed to trigger workflow: ${workflow}`);
  process.exit(EXIT_GENERAL_ERROR);
}

logInfo("Workflow queued. Fetching run URL...");

// A provider that hands back the queued run's id (a bare positive integer on
// stdout) is asked for that run's URL directly. Otherwise the queued run is
// found in the run list by snapshot and trigger time.
let runUrl = "";
let ambiguousCount = 0;
const queuedId = queued.stdout.trim();
const hasQueuedId = /^[1-9][0-9]*$/.test(queuedId);
if (queuedRunStrategy.kind === "response-id" && !hasQueuedId) {
  throw new Error("pipeline trigger response did not contain a run id");
}
if (hasQueuedId) {
  try {
    runUrl = (await pipelinesRunView(repo, queuedId, { json: "url", jq: ".url" })).trim();
  } catch {
    runUrl = "";
  }
} else if (queuedRunStrategy.kind === "search") {
  const found = await findQueuedRun(
    {
      listRuns: () => pipelinesRunList(repo, { limit: RUN_LIST_LIMIT, json: RUN_LIST_FIELDS }),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
    },
    {
      triggerTime,
      snapshotIds,
      workflowName: queuedRunStrategy.workflowMatch === "required"
        ? await resolveWorkflowName()
        : undefined,
      requireDispatchEvent: queuedRunStrategy.dispatchEvent === "required",
    },
  );
  if (found.kind === "found") runUrl = found.url;
  else if (found.kind === "ambiguous") ambiguousCount = found.count;
}

if (runUrl !== "" && runUrl !== "null") {
  logInfo(`Run URL: ${runUrl}`);
} else if (ambiguousCount > 0) {
  logWarn(`Run queued, but ${ambiguousCount} new runs appeared and none can be attributed to this trigger.`);
  logWarn(`Check: pipelines-status --repo ${repo} --workflow ${workflow}`);
} else {
  logWarn("Run queued but URL not yet available.");
  logWarn(`Check: pipelines-status --repo ${repo} --workflow ${workflow}`);
}

// Resolves the WORKFLOW argument (display name, file name or id) to the
// workflow's display name, which is what a run record carries. Undefined when
// it cannot be resolved: the lookup then proceeds without workflow narrowing.
async function resolveWorkflowName(): Promise<string | undefined> {
  try {
    const list = JSON.parse(await pipelinesWorkflowList(repo, ["--json", "id,name,path,state"])) as unknown;
    if (!Array.isArray(list)) return undefined;
    for (const entry of list as Array<{ id?: unknown; name?: unknown; path?: unknown }>) {
      if (typeof entry.name !== "string") continue;
      const file = typeof entry.path === "string" ? basename(entry.path) : "";
      if (entry.name === workflow || file === workflow || String(entry.id) === workflow) return entry.name;
    }
  } catch {
    // Fall through: no workflow narrowing.
  }
  return undefined;
}
