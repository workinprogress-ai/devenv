#!/usr/bin/env node
// pipelines-status.ts - Report GitHub Actions workflow run status across the org
// Version: 1.0.0
// Description: Defaults to the latest run per repo; enumerates repositories
//              for the configured org (devenv.config [organization] org).
// Requirements: Node >= 23.6 (native type-stripping execution)

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { requireString } from "../lib/core/args.ts";
import { formatTable } from "../lib/ui/panels.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logWarn } from "../lib/core/logging.ts";
import { ensureProviderAuth, providerOrgGet, } from "../lib/providers/provider-core.ts";
import { requireFamilyCapability } from "../lib/providers/facade/provider-loader.ts";
import { reposList } from "../lib/providers/facade/repos.ts";
import { pipelinesRunList } from "../lib/providers/facade/pipelines.ts";

assertNodeFloor();

await requireFamilyCapability("pipelines", "pipelines");

interface RunRow {
  repo: string;
  workflowName: string;
  status: string;
  conclusion: string | null;
  headBranch: string;
  updatedAt: string;
  url: string;
  id: number;
}

let repoRegex = "";
let statusFilter = "";
let workflowFilter = "";
let limit = "1";
let outputFormat: "table" | "json" | "pretty" = "table";

const RUN_FIELDS = "workflowName,status,conclusion,headBranch,updatedAt,url,id";

function usage(): never {
  console.log(`Usage: pipelines-status [OPTIONS]

Report GitHub Actions workflow run status across the org.
Defaults to the latest run per repo.

Options:
${usageCommonFlags()}
    --json                      Output as compact JSON
    --pretty                    Output as pretty-printed JSON

Filters:
    -r, --repo REGEX            Filter repos by name (extended regex)
    -s, --status STATUS         Filter by conclusion: success, failure, cancelled
    -w, --workflow NAME         Filter by workflow name (exact match)
    --limit N                   Runs per repo to fetch (default: 1)

Examples:
    pipelines-status
    pipelines-status --repo 'lib\\.cs\\.'
    pipelines-status --status failure
    pipelines-status --repo 'services' --workflow CI --json`);
  process.exit(0);
}

const SCRIPT_VERSION = "1.0.0";

try {
  const cli = toolCli({
    name: "pipelines-status",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    strict: false,
    options: {
      json: { type: "boolean", default: false },
      pretty: { type: "boolean", default: false },
      repo: { type: "string" },
      status: { type: "string" },
      workflow: { type: "string" },
      limit: { type: "string" },
    },
  });
  if (cli.common.help) usage();
  if (cli.values["json"]) outputFormat = "json";
  if (cli.values["pretty"]) outputFormat = "pretty";
  repoRegex = cli.values["repo"] === undefined ? "" : requireString(cli.values["repo"], "--repo");
  statusFilter = cli.values["status"] === undefined ? "" : requireString(cli.values["status"], "--status");
  workflowFilter = cli.values["workflow"] === undefined ? "" : requireString(cli.values["workflow"], "--workflow");
  const limitRaw = cli.values["limit"] === undefined ? "" : requireString(cli.values["limit"], "--limit");
  if (limitRaw !== "" && !/^[0-9]+$/.test(limitRaw)) {
    logError(`--limit requires a numeric argument: ${limitRaw}`);
    process.exit(EXIT_MISUSE);
  }
  if (limitRaw !== "") limit = limitRaw;
} catch (err) {
  logError(err instanceof Error ? err.message : String(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

// Auth after argv validation: a usage error must exit 2 without touching gh
// (no network probe on the misuse path).
ensureProviderAuth();

if (providerOrgGet() === "") {
  logError("Organization identity unresolved. Configure [organization] org in devenv.config or run setup.");
  process.exit(EXIT_MISUSE);
}
const org = providerOrgGet();

let repoNames: string[];
try {
  const raw = await reposList(org, { limit: 1000, json: "name", jq: ".[].name" });
  repoNames = raw.split("\n").map((l) => l.trim()).filter((l) => l !== "");
} catch {
  logError(`Failed to list repositories for org: ${org}`);
  process.exit(EXIT_API_FAILURE);
}

if (repoNames.length === 0) {
  logWarn("No repositories found for org: " + org);
  process.exit(0);
}

if (repoRegex !== "") {
  let regex: RegExp;
  try {
    regex = new RegExp(repoRegex);
  } catch {
    logError(`Invalid --repo regex: ${repoRegex}`);
    process.exit(EXIT_MISUSE);
  }
  repoNames = repoNames.filter((r) => regex.test(r));
}

if (repoNames.length === 0) {
  logWarn(`No repositories matched filter: ${repoRegex}`);
  process.exit(0);
}

const runs: RunRow[] = [];
for (const repo of repoNames) {
  let raw = "[]";
  try {
    raw = await pipelinesRunList(`${org}/${repo}`, { limit: Number(limit), json: RUN_FIELDS });
  } catch {
    raw = "[]";
  }
  let parsed: Array<Record<string, unknown>> = [];
  try {
    parsed = JSON.parse(raw);
  } catch {
    continue;
  }
  if (workflowFilter !== "") {
    parsed = parsed.filter((r) => r.workflowName === workflowFilter);
  }
  if (statusFilter !== "") {
    parsed = parsed.filter((r) => r.conclusion === statusFilter || r.status === statusFilter);
  }
  for (const r of parsed) {
    runs.push({
      repo,
      workflowName: String(r.workflowName ?? ""),
      status: String(r.status ?? ""),
      conclusion: (r.conclusion as string | null) ?? null,
      headBranch: String(r.headBranch ?? ""),
      updatedAt: String(r.updatedAt ?? ""),
      url: String(r.url ?? ""),
      id: Number(r.id ?? 0),
    });
  }
}

if (outputFormat === "json") {
  console.log(JSON.stringify(runs));
} else if (outputFormat === "pretty") {
  console.log(JSON.stringify(runs, null, 2));
} else {
  const headers = ["REPO", "WORKFLOW", "BRANCH", "STATUS", "CONCLUSION", "UPDATED", "URL"];
  const rows = runs.map((r) => [
    r.repo,
    r.workflowName,
    r.headBranch,
    r.status,
    r.conclusion ?? "-",
    r.updatedAt.split("T")[0] ?? "",
    r.url,
  ]);
  console.log(formatTable(headers, rows.map((cells) => ({ cells }))));
}
