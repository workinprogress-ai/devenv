#!/usr/bin/env node
// project-list-for-issue.ts - List the projects containing an issue
// Version: 1.1.0
// Description: Prints "<project-title>\t<project-number>\t<status-or-dash>"
//              per project. Empty output when the issue is in no projects.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { parseArgs } from "node:util";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { ensureProviderAuth, isDevenvRepoGated, providerOrgGet, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issueWebUrl } from "../lib/providers/github/issues.ts";
import { projectsForIssue } from "../lib/providers/github/projects.ts";

assertNodeFloor();

ensureProviderAuth();

let issueNumber = "";

function usage(): never {
  console.log(`Usage: project-list-for-issue ISSUE_NUMBER [OPTIONS]

List the projects containing an issue, with the issue's Status in each.

Options:
    --devenv                 Safety override to read from the devenv repo itself

Output (one line per project):
    <project-title>\\t<project-number>\\t<status-or-dash>

Examples:
    project-list-for-issue 42
    DEVENV_REPO=myorg/myrepo project-list-for-issue 42`);
  process.exit(0);
}

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", default: false },
    version: { type: "boolean", default: false },
    devenv: { type: "boolean", default: false },
  },
  allowPositionals: true,
  strict: false,
});

if (parsed.values.help) usage();
if (parsed.values.version) {
  console.log("1.1.0");
  process.exit(0);
}

const positionals = parsed.positionals.filter((p) => !p.startsWith("-"));
if (positionals.length > 0) issueNumber = positionals[0] ?? "";

if (issueNumber === "" || !/^[0-9]+$/.test(issueNumber)) {
  logError("A numeric ISSUE_NUMBER is required");
  console.error("Use --help for usage information");
  process.exit(EXIT_GENERAL_ERROR);
}

if (providerOrgGet() === "") {
  logError("Organization identity unresolved. Configure [organization] org in devenv.config or run setup.");
  process.exit(EXIT_GENERAL_ERROR);
}

// resolve_target_repo applies the devenv-repo gate to an implicit target.
const repoSpec = providerRepoTarget();
if (repoSpec === "") {
  logError("Cannot resolve the target repository — pass DEVENV_REPO or run inside a repository.");
  process.exit(EXIT_GENERAL_ERROR);
}
if (isDevenvRepoGated() && (process.env["DEVENV_REPO"] === undefined || process.env["DEVENV_REPO"] === "") && parsed.values.devenv !== true) {
  logError("The current repository appears to be the devenv repository itself");
  console.log("Operations should be performed in target project repositories, not in devenv");
  console.log("To target a project repo, prefix the command with DEVENV_REPO=<owner>/<repo>");
  console.log("To override this safety check (devenv-repo work only), pass the --devenv flag");
  process.exit(EXIT_GENERAL_ERROR);
}
const owner = repoSpec.split("/")[0] ?? "";
const issueUrl = issueWebUrl(repoSpec, Number(issueNumber));

const rows = projectsForIssue(issueUrl, owner);
for (const row of rows) {
  console.log(`${row.title}\t${row.number}\t${row.status}`);
}
