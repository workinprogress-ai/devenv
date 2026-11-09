#!/usr/bin/env node
// project-list-for-issue.ts - List the projects containing an issue
// Version: 1.1.0
// Description: Prints "<project-title>\t<project-number>\t<status-or-dash>"
//              per project. Empty output when the issue is in no projects.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { ensureProviderAuth, isDevenvRepoGated, providerOrgGet, providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { issueWebUrl } from "../lib/providers/facade/issues.ts";
import { projectsOps } from "../lib/providers/facade/projects.ts";

assertNodeFloor();

ensureProviderAuth();

let issueNumber = "";
let devenvOverride = false;

function usage(): never {
  console.log(`Usage: project-list-for-issue ISSUE_NUMBER [OPTIONS]

List the projects containing an issue, with the issue's Status in each.

Options:
${usageCommonFlags({ noDryRun: true })}

Output (one line per project):
    <project-title>\\t<project-number>\\t<status-or-dash>

Examples:
    project-list-for-issue 42
    DEVENV_REPO=myorg/myrepo project-list-for-issue 42`);
  process.exit(0);
}

try {
  const cli = toolCli({
    name: "project-list-for-issue",
    version: "1.1.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      devenv: { type: "boolean", default: false },
    },
  });
  if (cli.common.help) usage();
  devenvOverride = cli.values.devenv === true;
  const positionals = cli.positionals.filter((p) => !p.startsWith("-"));
  if (positionals.length > 0) issueNumber = positionals[0] ?? "";
} catch (err) {
  logError(errorMessage(err));
  usage();
}

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
const repoSpec = requireRepoTarget(providerRepoTarget(), "project-list-for-issue", "project");
if (repoSpec === "") {
  logError("Cannot resolve the target repository — pass DEVENV_REPO or run inside a repository.");
  process.exit(EXIT_GENERAL_ERROR);
}
if (isDevenvRepoGated() && (process.env["DEVENV_REPO"] === undefined || process.env["DEVENV_REPO"] === "") && !devenvOverride) {
  logError("The current repository appears to be the devenv repository itself");
  console.log("Operations should be performed in target project repositories, not in devenv");
  console.log("To target a project repo, prefix the command with DEVENV_REPO=<owner>/<repo>");
  console.log("To override this safety check (devenv-repo work only), pass the --devenv flag");
  process.exit(EXIT_GENERAL_ERROR);
}
const owner = repoSpec.split("/")[0] ?? "";
const issueUrl = await issueWebUrl(repoSpec, Number(issueNumber));

const rows = await projectsOps().then((ops) => ops.forIssue(issueUrl, owner));
for (const row of rows) {
  console.log(`${row.title}\t${row.number}\t${row.status}`);
}
