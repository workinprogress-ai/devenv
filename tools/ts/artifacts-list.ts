#!/usr/bin/env node
// artifacts-list.ts - List organization packages and their versions
// Version: 1.1.0
// Description: Lists org packages (optionally filtered by type/name/repo) or
//              the versions of one named package (--versions). Owner resolves
//              via the provider org accessor when not provided.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { ensureProviderAuth, providerOrgGet } from "../lib/providers/provider-core.ts";
import { queryPackages, packageVersions } from "../lib/domain/artifacts.ts";
import { formatTable } from "../lib/ui/panels.ts";

assertNodeFloor();

let owner = "";
let type = "";
let name = "";
let format = "table";
let repo = "";
let sortField = "name";
let listVersions = false;

function usage(): never {
  console.log(`Usage: artifacts-list [OPTIONS]

List organization packages, or versions of one package (--versions).

Options:
    --owner OWNER               Package owner (default: configured org)
    --type TYPE                 Package type: npm, nuget, docker, maven, ...
    --name NAME                 Filter by package name (case-insensitive contains)
    --repo REPO                 Filter to one repository (name or path)
    --sort FIELD                Sort field: name, type, package_type, created_at, updated_at
    --versions                  List versions of --type/--name package
    --format FORMAT             table (default) or json
${usageCommonFlags({ noDryRun: true })}

Examples:
    artifacts-list --owner myorg --type npm --name my-package --versions
    artifacts-list --owner myorg --format json`);
  process.exit(0);
}

const SCRIPT_VERSION = "1.1.0";

try {
  const cli = toolCli({
    name: "artifacts-list",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      owner: { type: "string" },
      type: { type: "string" },
      name: { type: "string" },
      format: { type: "string", default: "table" },
      repo: { type: "string" },
      sort: { type: "string", default: "name" },
      versions: { type: "boolean", default: false },
    },
  });
  if (cli.common.help) usage();
  owner = (cli.values["owner"] as string | undefined) ?? "";
  type = (cli.values["type"] as string | undefined) ?? "";
  name = (cli.values["name"] as string | undefined) ?? "";
  format = (cli.values["format"] as string | undefined) ?? "table";
  repo = (cli.values["repo"] as string | undefined) ?? "";
  sortField = (cli.values["sort"] as string | undefined) ?? "name";
  listVersions = cli.values["versions"] === true;
  if (!["name", "type", "package_type", "created_at", "updated_at"].includes(sortField)) {
    throw new Error(`Invalid sort field: ${sortField} (must be name, type, package_type, created_at or updated_at)`);
  }
  if (format !== "table" && format !== "json") {
    throw new Error(`Invalid format: ${format} (must be table or json)`);
  }
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

// Authenticate only after the arguments parsed: help and misuse need no provider.
ensureProviderAuth();

// Resolve owner via the provider org accessor when not provided.
if (owner === "") owner = providerOrgGet();

// Validate required arguments.
if (owner === "") {
  logError("owner is required (set --owner or configure [organization] org in devenv.config)");
  process.exit(EXIT_MISUSE);
}

interface PackageRecord {
  name?: string;
  package_type?: string;
  html_url?: string;
  url?: string;
  version?: string;
  created_at?: string;
  updated_at?: string;
}

/** Run a domain listing; any failure is an API failure, never an empty list. */
async function listing(run: () => Promise<string>): Promise<PackageRecord[]> {
  try {
    return JSON.parse(await run()) as PackageRecord[];
  } catch (err) {
    logError(errorMessage(err));
    process.exit(EXIT_API_FAILURE);
  }
}

async function queryPackageList(): Promise<PackageRecord[]> {
  return listing(() => queryPackages({ owner, ...(type !== "" ? { type } : {}), ...(name !== "" ? { name } : {}), ...(repo !== "" ? { repo } : {}) }));
}

async function queryPackageVersions(): Promise<PackageRecord[]> {
  if (type === "" || name === "") {
    logError("--versions requires --type TYPE and --name NAME");
    process.exit(EXIT_MISUSE);
  }
  return listing(() => packageVersions({ owner, type, name, ...(repo !== "" ? { repo } : {}) }));
}

function renderTable(headers: string[], rows: string[][]): void {
  console.log(formatTable(headers, rows.map((cells) => ({ cells }))));
}

if (listVersions) {
  const versions = await queryPackageVersions();
  const sorted = [...versions].reverse();
  if (format === "json") {
    console.log(JSON.stringify(sorted, null, 2));
  } else {
    renderTable(
      ["VERSION", "PUBLISHED", "UPDATED"],
      sorted.map((v) => [
        v.version ?? v.name ?? "-",
        (v.created_at ?? "").replaceAll("T", " ").replaceAll("Z", ""),
        (v.updated_at ?? "").replaceAll("T", " ").replaceAll("Z", ""),
      ]),
    );
  }
  process.exit(0);
}

logInfo(`Fetching packages${type !== "" ? ` of type: ${type}` : ""}${name !== "" ? ` matching: ${name}` : ""}...`);

const packages = await queryPackageList();
if (packages.length === 0) {
  logInfo("No packages found matching the criteria");
  process.exit(0);
}

if (format === "json") {
  console.log(JSON.stringify(packages, null, 2));
  process.exit(0);
}

logInfo(`Found ${packages.length} package(s)`);
console.log("");

const jsonField = sortField === "type" ? "package_type" : sortField;
const sorted = [...packages].sort((a, b) => {
  const av = String((a as Record<string, unknown>)[jsonField] ?? "");
  const bv = String((b as Record<string, unknown>)[jsonField] ?? "");
  return av.localeCompare(bv);
});

renderTable(
  ["NAME", "TYPE", "URL"],
  sorted.map((p) => [p.name ?? "-", p.package_type ?? "-", p.html_url ?? p.url ?? "-"]),
);
