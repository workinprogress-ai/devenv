#!/usr/bin/env node
// pipelines-list.ts - List workflow definitions across the org
// Version: 1.0.0
// Description: Lists GitHub Actions workflow definitions (name, file, state)
//              across org repositories. Shows what workflows exist, not their
//              run history. Use pipelines-status for that.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { parseArgs } from "node:util";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logWarn } from "../lib/core/logging.ts";
import { ensureProviderAuth, providerOrgGet, providerRequireCapability } from "../lib/providers/provider-core.ts";
import { reposList } from "../lib/providers/github/repos.ts";
import { pipelinesWorkflowList } from "../lib/providers/github/pipelines.ts";

assertNodeFloor();

ensureProviderAuth();

providerRequireCapability("pipelines");

interface WorkflowRow {
  repo: string;
  id: number;
  name: string;
  path: string;
  state: string;
}

let repoRegex = "";
let stateFilter = "active";
let outputFormat: "table" | "json" | "pretty" = "table";

function usage(): never {
  console.log(`Usage: pipelines-list [OPTIONS]

List GitHub Actions workflow definitions across org repositories.
Shows what workflows exist, not their run history. Use pipelines-status for that.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    --json                      Output as compact JSON
    --pretty                    Output as pretty-printed JSON

Filters:
    -r, --repo REGEX            Filter repos by name (extended regex)
    --state STATE               Workflow state filter: active, disabled_manually,
                                disabled_inactivity, all (default: active)

Examples:
    pipelines-list
    pipelines-list --repo 'lib\\.cs\\.services\\.'
    pipelines-list --state all
    pipelines-list --json | jq '.[] | select(.state != "active")'`);
  process.exit(0);
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", default: false },
    version: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    pretty: { type: "boolean", default: false },
    repo: { type: "string" },
    state: { type: "string" },
  },
  strict: false,
});

if (values.help) usage();
if (values.version) {
  console.log("1.0.0");
  process.exit(0);
}
if (values.json) outputFormat = "json";
if (values.pretty) outputFormat = "pretty";
repoRegex = typeof values.repo === "string" ? values.repo : "";
if (typeof values.state === "string" && values.state !== "") stateFilter = values.state;

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

const workflows: WorkflowRow[] = [];
for (const repo of repoNames) {
  let raw = "[]";
  try {
    raw = await pipelinesWorkflowList(`${org}/${repo}`, ["--json", "id,name,path,state"]);
  } catch {
    raw = "[]";
  }
  let parsed: Array<{ id?: number; name?: string; path?: string; state?: string }> = [];
  try {
    parsed = JSON.parse(raw);
  } catch {
    continue;
  }
  if (stateFilter !== "all") {
    parsed = parsed.filter((w) => w.state === stateFilter);
  }
  for (const w of parsed) {
    workflows.push({
      repo,
      id: w.id ?? 0,
      name: w.name ?? "",
      path: w.path ?? "",
      state: w.state ?? "",
    });
  }
}

if (outputFormat === "json") {
  console.log(JSON.stringify(workflows));
} else if (outputFormat === "pretty") {
  console.log(JSON.stringify(workflows, null, 2));
} else {
  const headers = ["REPO", "WORKFLOW NAME", "FILE", "STATE"];
  const rows = workflows.map((w) => [w.repo, w.name, w.path.split("/").pop() ?? "", w.state]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]): string => cells.map((c, i) => (c ?? "").padEnd(widths[i] ?? 0)).join("  ");
  console.log(line(headers));
  for (const r of rows) console.log(line(r));
}
