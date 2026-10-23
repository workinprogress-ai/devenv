#!/usr/bin/env node
// artifacts-list.ts - List organization packages and their versions
// Version: 1.1.0
// Description: Lists org packages (optionally filtered by type/name/repo) or
//              the versions of one named package (--versions). Owner resolves
//              via the provider org accessor when not provided.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { parseArgs } from "node:util";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { ensureProviderAuth, ghApiSync, providerOrgGet } from "../lib/providers/provider-core.ts";

assertNodeFloor();

ensureProviderAuth();

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
    --sort FIELD                Sort field: name, type, created_at, updated_at
    --versions                  List versions of --type/--name package
    --format FORMAT             table (default) or json

Examples:
    artifacts-list --owner myorg --type npm --name my-package --versions
    artifacts-list --owner myorg --format json`);
  process.exit(0);
}

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", default: false },
    owner: { type: "string" },
    type: { type: "string" },
    name: { type: "string" },
    format: { type: "string" },
    repo: { type: "string" },
    sort: { type: "string" },
    versions: { type: "boolean", default: false },
  },
  strict: false,
});

if (parsed.values.help) usage();
owner = typeof parsed.values.owner === "string" ? parsed.values.owner : "";
type = typeof parsed.values.type === "string" ? parsed.values.type : "";
name = typeof parsed.values.name === "string" ? parsed.values.name : "";
format = typeof parsed.values.format === "string" && parsed.values.format !== "" ? parsed.values.format : "table";
repo = typeof parsed.values.repo === "string" ? parsed.values.repo : "";
sortField = typeof parsed.values.sort === "string" && parsed.values.sort !== "" ? parsed.values.sort : "name";
listVersions = parsed.values.versions === true;

// Resolve owner via the provider org accessor when not provided.
if (owner === "") owner = providerOrgGet();

// Validate required arguments.
if (owner === "") {
  logError("owner is required (set --owner or configure [organization] org in devenv.config)");
  process.exit(EXIT_MISUSE);
}

/** Map a user-facing type alias to the GitHub package_type id. */
function packageTypeId(raw: string): string {
  const t = raw.toLowerCase();
  switch (t) {
    case "npm": case "node": case "javascript": return "npm";
    case "nuget": case "cs": case "csharp": case "dotnet": case ".net": return "nuget";
    case "docker": case "container": case "oci": return "docker";
    case "maven": case "java": return "maven";
    case "rubygems": case "gem": case "ruby": return "rubygems";
    case "composer": case "php": return "composer";
    case "conda": return "conda";
    default: return t;
  }
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

function ghGet(args: string[]): GhResult {
  const r = ghApiSync(["api", ...args], { tolerateFailure: true });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

interface GhResult {
  stdout: string;
  stderr: string;
  status: number;
}

/** Query packages per artifact-operations.bash's query_packages: endpoint is
 * org-wide or repo-scoped; empty results (not errors) read as []. */
function queryPackages(): PackageRecord[] {
  const typeArg = type !== "" ? ["-f", `package_type=${packageTypeId(type)}`] : [];
  const endpoint = repo !== "" ? `/repos/${owner}/${repo}/packages` : `/users/${owner}/packages`;
  const r = ghGet([endpoint, "--method", "GET", ...typeArg]);
  if (r.status !== 0) {
    if (/HTTP|error|Error/i.test(r.stderr + r.stdout)) {
      logError(`GitHub API error: ${(r.stderr + r.stdout).trim()}`);
      process.exit(EXIT_GENERAL_ERROR);
    }
    return [];
  }
  let parsed: PackageRecord[] = [];
  try {
    const asArray: unknown = JSON.parse(r.stdout);
    parsed = Array.isArray(asArray) ? (asArray as PackageRecord[]) : [];
  } catch {
    parsed = [];
  }
  if (name !== "") {
    const needle = name.toLowerCase();
    parsed = parsed.filter((p) => (p.name ?? "").toLowerCase().includes(needle));
  }
  return parsed;
}

/** Query versions of one package (get_package_versions contract). */
function queryPackageVersions(): PackageRecord[] {
  if (type === "" || name === "") {
    logError("--versions requires --type TYPE and --name NAME");
    process.exit(EXIT_MISUSE);
  }
  const typeId = packageTypeId(type);
  const scope = repo !== "" ? `/repos/${owner}/${repo}` : `/users/${owner}`;
  const versionsEndpoint = `${scope}/packages/${typeId}/${name}/versions`;
  const r = ghGet([versionsEndpoint]);
  if (r.status !== 0) {
    logError(`Failed to query package versions: ${(r.stderr + r.stdout).trim()}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  try {
    const parsed: unknown = JSON.parse(r.stdout);
    return Array.isArray(parsed) ? (parsed as PackageRecord[]) : [];
  } catch {
    return [];
  }
}

function renderTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]): string => cells.map((c, i) => (c ?? "").padEnd(widths[i] ?? 0)).join("  ");
  console.log(line(headers));
  for (const r of rows) console.log(line(r));
}

if (listVersions) {
  const versions = queryPackageVersions();
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

const packages = queryPackages();
if (packages.length === 0) {
  logInfo("No packages found matching the criteria");
  process.exit(0);
}

if (format === "json") {
  console.log(JSON.stringify(packages, null, 2));
  process.exit(0);
}
if (format !== "table") {
  logError(`Invalid format: ${format} (must be table or json)`);
  process.exit(EXIT_MISUSE);
}

logInfo(`Found ${packages.length} package(s)`);
console.log("");

const jsonField = sortField === "type" ? "package_type" : sortField;
if (!["name", "package_type", "created_at", "updated_at"].includes(jsonField)) {
  logError(`Invalid sort field: ${sortField}`);
  process.exit(EXIT_GENERAL_ERROR);
}
const sorted = [...packages].sort((a, b) => {
  const av = String((a as Record<string, unknown>)[jsonField] ?? "");
  const bv = String((b as Record<string, unknown>)[jsonField] ?? "");
  return av.localeCompare(bv);
});

renderTable(
  ["NAME", "TYPE", "URL"],
  sorted.map((p) => [p.name ?? "-", p.package_type ?? "-", p.html_url ?? p.url ?? "-"]),
);
