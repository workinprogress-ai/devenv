#!/usr/bin/env node
// release-list.ts - List GitHub releases for the target repository
// Version: 1.1.0
// Description: Lists releases (tag, name, published date, prerelease/draft
//              flags, URL). Read-only.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { parseArgs } from "node:util";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { ensureProviderAuth, isDevenvRepoGated, providerOrgGet, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { orgReleasesList } from "../lib/providers/github/org.ts";

assertNodeFloor();

ensureProviderAuth();

let outputFormat: "table" | "json" | "simple" = "table";
let limit = "20";

function usage(): never {
  console.log(`Usage: release-list [OPTIONS]

List GitHub releases (tag, name, published date, prerelease/draft flags, URL)
for the target repository. Read-only.

Options:
    -f, --format FORMAT         Output format: table (default), json, simple
    -n, --limit NUMBER          Max releases to show (default: 20)
    --devenv                    Safety override to list releases in devenv repo

Examples:
    release-list
    release-list --format json --limit 5`);
  process.exit(0);
}

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", default: false },
    version: { type: "boolean", default: false },
    format: { type: "string" },
    limit: { type: "string" },
    devenv: { type: "boolean", default: false },
  },
  strict: false,
});

if (parsed.values.help) usage();
if (parsed.values.version) {
  console.log("1.1.0");
  process.exit(0);
}
if (typeof parsed.values.format === "string" && parsed.values.format !== "") {
  outputFormat = parsed.values.format as "table" | "json" | "simple";
}
if (typeof parsed.values.limit === "string" && parsed.values.limit !== "") {
  if (!/^[0-9]+$/.test(parsed.values.limit)) {
    logError(`--limit requires a numeric argument: ${parsed.values.limit}`);
    process.exit(EXIT_MISUSE);
  }
  limit = parsed.values.limit;
}

if (providerOrgGet() === "") {
  logError("Organization identity unresolved. Configure [organization] org in devenv.config or run setup.");
  process.exit(EXIT_MISUSE);
}

const repoSpec = providerRepoTarget();
if (repoSpec === "") {
  logError("Cannot resolve the target repository — pass DEVENV_REPO or run inside a repository.");
  process.exit(EXIT_GENERAL_ERROR);
}

// Devenv-repo safety gate (resolve_target_repo parity): implicit targets only.
if (isDevenvRepoGated() && (process.env["DEVENV_REPO"] === undefined || process.env["DEVENV_REPO"] === "") && parsed.values.devenv !== true) {
  logError("The current repository appears to be the devenv repository itself");
  console.log("Operations should be performed in target project repositories, not in devenv");
  console.log("To target a project repo, prefix the command with DEVENV_REPO=<owner>/<repo>");
  console.log("To override this safety check (devenv-repo work only), pass the --devenv flag");
  process.exit(EXIT_GENERAL_ERROR);
}

interface Release {
  tagName?: string;
  name?: string | null;
  publishedAt?: string | null;
  isPrerelease?: boolean;
  isDraft?: boolean;
}

let releases: Release[] = [];
try {
  const raw = orgReleasesList(repoSpec, [
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
