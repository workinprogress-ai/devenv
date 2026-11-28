#!/usr/bin/env node
// pipelines-logs.ts - Read the logs of a pipeline run
// Version: 1.0.0
// Description: Prints the step logs of a run (finished or in progress) as
//              plain text, each headed by its step name. --step NAME prints
//              only that step's log.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { ensureProviderAuth } from "../lib/providers/provider-core.ts";
import { requireFamilyCapability } from "../lib/providers/facade/provider-loader.ts";
import { pipelinesRunLogs } from "../lib/providers/facade/pipelines.ts";

assertNodeFloor();

let runId = "";
let repo = "";
let step = "";

function usage(): never {
  console.log(`Usage: pipelines-logs RUN_ID --repo OWNER/REPO [OPTIONS]

Read the logs of a pipeline run as plain text (finished or in progress).
Each step's log is headed by the step's name.

Arguments:
    RUN_ID                      Run ID

Options:
    --repo OWNER/REPO           Repository containing the run (required)
    --step NAME                 Print only the log of the step with this name
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

Examples:
    pipelines-logs 12345678 --repo <org>/my-service
    pipelines-logs 12345678 --repo <org>/my-service --step "Install .NET SDK"`);
  process.exit(0);
}

try {
  const cli = toolCli({
    name: "pipelines-logs",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      repo: { type: "string" },
      step: { type: "string" },
    },
  });
  if (cli.common.help) usage();
  repo = (cli.values["repo"] as string | undefined) ?? "";
  step = (cli.values["step"] as string | undefined) ?? "";
  if (cli.positionals.length !== 1) {
    logError("RUN_ID (exactly one positional) is required");
    console.error("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }
  runId = cli.positionals[0] ?? "";
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}
if (!/^[0-9]+$/.test(runId)) {
  logError(`RUN_ID must be numeric: ${runId}`);
  process.exit(EXIT_MISUSE);
}
if (repo === "" || !/^[^/]+\/[^/]+$/.test(repo)) {
  logError(`Invalid --repo format: '${repo}' (expected OWNER/REPO)`);
  process.exit(EXIT_MISUSE);
}

// Provider resolution and authentication happen only after the arguments
// parsed: help and misuse need neither config nor network.
await requireFamilyCapability("pipelines", "pipelines");
ensureProviderAuth();

try {
  process.stdout.write(await pipelinesRunLogs(repo, runId, step !== "" ? { step } : {}));
} catch (err) {
  logError(`Failed to read logs for run ${runId} in ${repo}`);
  if (err instanceof Error && err.message !== "") logError(err.message);
  process.exit(EXIT_API_FAILURE);
}
