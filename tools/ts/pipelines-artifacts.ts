#!/usr/bin/env node
// pipelines-artifacts.ts - List or download artifacts from a workflow run
// Version: 1.0.0
// Description: Default mode is list (no files downloaded). --download fetches
//              all artifacts (with a size warning + TTY confirmation over
//              100 MiB) or a single named artifact into --dir.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { parseArgs } from "node:util";
import { readSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { ensureProviderAuth, providerRequireCapability } from "../lib/providers/provider-core.ts";
import { formatTable } from "../lib/ui/panels.ts";
import {
  pipelinesRunArtifacts,
  pipelinesRunDownload,
} from "../lib/providers/github/pipelines.ts";

assertNodeFloor();

ensureProviderAuth();

providerRequireCapability("pipelines");

const DOWNLOAD_SIZE_WARN_BYTES = 104857600;

let runId = "";
let repo = "";
let outputFormat: "table" | "json" | "pretty" = "table";
let download = false;
let artifactName = "";
let destDir = ".";

function usage(): never {
  console.log(`Usage: pipelines-artifacts RUN_ID --repo OWNER/REPO [OPTIONS]

List or download artifacts from a GitHub Actions workflow run.
Default mode is list (no files are downloaded).

Arguments:
    RUN_ID                      Workflow run ID

Options:
    --repo OWNER/REPO           Repository containing the run (required)
    --json                      Output artifact list as compact JSON
    --pretty                    Output artifact list as pretty-printed JSON
    --download                  Download artifacts instead of just listing
    --name NAME                 Artifact name to download (use with --download)
    --dir DIR                   Download destination directory (default: .)

Examples:
    pipelines-artifacts 12345678 --repo <org>/my-service
    pipelines-artifacts 12345678 --repo <org>/my-service --json | jq '.[].name'
    pipelines-artifacts 12345678 --repo <org>/my-service --download --name coverage-report --dir /tmp/artifacts`);
  process.exit(0);
}

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", default: false },
    version: { type: "boolean", default: false },
    repo: { type: "string" },
    json: { type: "boolean", default: false },
    pretty: { type: "boolean", default: false },
    download: { type: "boolean", default: false },
    name: { type: "string" },
    dir: { type: "string" },
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
if (parsed.values.json) outputFormat = "json";
if (parsed.values.pretty) outputFormat = "pretty";
download = parsed.values.download === true;
artifactName = typeof parsed.values.name === "string" ? parsed.values.name : "";
destDir = typeof parsed.values.dir === "string" && parsed.values.dir !== "" ? parsed.values.dir : ".";

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
if (repo === "" || !/^[^/]+\/[^/]+$/.test(repo)) {
  logError(`Invalid --repo format: '${repo}' (expected OWNER/REPO)`);
  process.exit(EXIT_API_FAILURE);
}

interface Artifact {
  name?: string;
  size_in_bytes?: number;
  id?: number;
  created_at?: string;
}

function fetchArtifacts(): Artifact[] {
  try {
    return JSON.parse(pipelinesRunArtifacts(repo, runId)) as Artifact[];
  } catch (err) {
    logError(`Failed to fetch artifacts for run ${runId} in ${repo}`);
    if (err instanceof Error && err.message !== "") logError(err.message);
    process.exit(EXIT_API_FAILURE);
  }
}

if (!download) {
  const artifacts = fetchArtifacts();
  if (artifacts.length === 0) {
    logInfo(`No artifacts found for run ${runId}`);
    process.exit(0);
  }
  if (outputFormat === "json") {
    console.log(JSON.stringify(artifacts));
  } else if (outputFormat === "pretty") {
    console.log(JSON.stringify(artifacts, null, 2));
  } else {
    const headers = ["NAME", "SIZE", "ID", "CREATED"];
    const rows = artifacts.map((a) => [
      a.name ?? "",
      `${a.size_in_bytes ?? 0}B`,
      String(a.id ?? ""),
      (a.created_at ?? "").split("T")[0] ?? "",
    ]);
      console.log(formatTable(headers, rows.map((cells) => ({ cells }))));
  }
  process.exit(0);
}

// Download mode.
if (artifactName === "") {
  // Warn on large bulk downloads; confirm on a TTY (bash read from /dev/tty).
  let totalBytes = 0;
  try {
    const artifacts = fetchArtifacts();
    totalBytes = artifacts.reduce((sum, a) => sum + (a.size_in_bytes ?? 0), 0);
  } catch {
    totalBytes = 0;
  }
  if (totalBytes > DOWNLOAD_SIZE_WARN_BYTES) {
    const sizeMiB = Math.floor(totalBytes / 1048576);
    logWarn(`Total artifact size is approximately ${sizeMiB} MiB.`);
    logWarn("Use --name to download a specific artifact, or proceed carefully.");
    if (!process.stdin.isTTY) {
      console.error("Non-interactive session: refusing bulk download (use --name).");
      process.exit(EXIT_MISUSE);
    }
    process.stdout.write("Continue downloading all artifacts? [y/N] ");
    const answer = readLineStdin();
    if (!/^[Yy]$/.test(answer)) process.exit(0);
  }
}

const ghArgs: string[] = [];
if (artifactName !== "") ghArgs.push("-n", artifactName);
ghArgs.push("-D", destDir);

const downloaded = await pipelinesRunDownload(repo, runId, ghArgs);
if (downloaded.status !== 0) {
  logError(`Failed to download artifacts for run ${runId}`);
  process.exit(EXIT_API_FAILURE);
}

logInfo(`Artifacts downloaded to: ${destDir}`);

function readLineStdin(): string {
  let buf = Buffer.alloc(0);
  const chunk = Buffer.alloc(1);
  while (true) {
    const idx = buf.indexOf(0x0a);
    if (idx !== -1) return buf.subarray(0, idx).toString("utf8").trim();
    let n = 0;
    try {
      n = readSync(0, chunk, 0, 1, null);
    } catch {
      return "";
    }
    if (n <= 0) return buf.toString("utf8").trim();
    buf = Buffer.concat([buf, chunk.subarray(0, n)]);
  }
}
