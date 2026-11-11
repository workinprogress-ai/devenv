#!/usr/bin/env node
// release-list.ts - List GitHub releases for the target repository
// Version: 1.1.0
// Description: Lists releases (tag, name, published date, prerelease/draft
//              flags, URL). Read-only.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { ensureProviderAuth, checkTargetRepo, providerOrgGet, providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { orgReleasesList } from "../lib/providers/facade/org.ts";

assertNodeFloor();

let outputFormat: "table" | "json" | "simple" = "table";
let limit = "20";
let devenvOverride = false;

function usage(): never {
  console.log(`Usage: release-list [OPTIONS]

List GitHub releases (tag, name, published date, prerelease/draft flags, URL)
for the target repository. Read-only.

Options:
${usageCommonFlags({ noDryRun: true })}
    -f, --format FORMAT         Output format: table (default), json, simple
    -n, --limit NUMBER          Max releases to show (default: 20)

Examples:
    release-list
    release-list --format json --limit 5`);
  process.exit(0);
}

try {
  const cli = toolCli({
    name: "release-list",
    version: "1.1.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      format: { type: "string", short: "f" },
      limit: { type: "string", short: "n" },
      devenv: { type: "boolean", default: false },
    },
  });
  if (cli.common.help) usage();
  devenvOverride = cli.values.devenv === true;
  if (typeof cli.values.format === "string" && cli.values.format !== "") {
    if (cli.values.format !== "table" && cli.values.format !== "json" && cli.values.format !== "simple") {
      throw new Error(`Invalid format: ${cli.values.format} (must be table, json or simple)`);
    }
    outputFormat = cli.values.format;
  }
  if (typeof cli.values.limit === "string" && cli.values.limit !== "") {
    if (!/^[0-9]+$/.test(cli.values.limit)) {
      throw new Error(`--limit requires a numeric argument: ${cli.values.limit}`);
    }
    limit = cli.values.limit;
  }
  if (cli.positionals.length > 0) throw new Error(`Unexpected argument: ${cli.positionals[0]}`);
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

// Authenticate only after the arguments parsed: help and misuse need no provider.
ensureProviderAuth();

if (providerOrgGet() === "") {
  logError("Organization identity unresolved. Configure [organization] org in devenv.config or run setup.");
  process.exit(EXIT_MISUSE);
}

const repoSpec = requireRepoTarget(providerRepoTarget(), "release-list", "repos");
if (repoSpec === "") {
  logError("Cannot resolve the target repository — pass DEVENV_REPO or run inside a repository.");
  process.exit(EXIT_GENERAL_ERROR);
}

// Devenv-repo safety gate: implicit targets only.
checkTargetRepo(devenvOverride);

interface Release {
  tagName?: string;
  name?: string | null;
  publishedAt?: string | null;
  isPrerelease?: boolean;
  isDraft?: boolean;
}

let releases: Release[] = [];
try {
  const raw = await orgReleasesList(repoSpec, [
    "--limit", limit,
    "--json", "tagName,name,publishedAt,isPrerelease,isDraft",
  ]);
  releases = JSON.parse(raw) as Release[];
} catch (err) {
  logError(`Failed to list releases${err instanceof Error && err.message !== "" ? `: ${err.message}` : ""}`);
  process.exit(EXIT_GENERAL_ERROR);
}

if (outputFormat === "json") {
  console.log(JSON.stringify(releases, null, 2));
} else if (outputFormat === "simple") {
  for (const r of releases) {
    console.log(`${r.tagName ?? ""} — ${r.name ?? "(untitled)"} [${r.publishedAt ?? "unpublished"}]`);
  }
} else {
  for (const r of releases) {
    const kind = r.isDraft === true ? "DRAFT" : r.isPrerelease === true ? "PRE" : "REL";
    const date = (r.publishedAt ?? "unpublished").split("T")[0] ?? "";
    console.log(`${kind}  ${r.tagName ?? ""}  ${date}  ${r.name ?? "(untitled)"}`);
  }
}
