#!/usr/bin/env node
// project-add-issue.ts - Add issues to a GitHub Project (v2)
// Version: 1.1.0
// Description: Adds one or more issues to a named organization project,
//              optionally setting single-select field values on the new
//              cards (--field NAME=VALUE, repeatable). All-or-nothing per
//              issue: the first unresolvable field aborts that issue's setup.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { ensureProviderAuth, checkTargetRepo, providerOrgGet, providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesView } from "../lib/providers/facade/issues.ts";
import { projectsOps, projectsNumberByName } from "../lib/providers/facade/projects.ts";

assertNodeFloor();

let projectName = "";
const issueNumbers: string[] = [];
const fieldValues: string[] = [];
let dryRun = false;

function usage(): never {
  console.log(`Usage: project-add-issue PROJECT_NAME ISSUE_NUMBER... [OPTIONS]

Add issues to a GitHub Project (v2).

Arguments:
  PROJECT_NAME            Project name (title) or number
  ISSUE_NUMBER...         One or more issue numbers

Options:
  --field NAME=VALUE      Set a single-select field on the card (repeatable)
${usageCommonFlags()}

Examples:
  project-add-issue "Team Board" 123 124
  project-add-issue "Team Board" 125 --field Status=In Progress --dry-run`);
  process.exit(0);
}

// Parse arguments
const SCRIPT_VERSION = "1.1.0";
let devenvOverride = false;
let fieldEntries: string[] = [];
let rawPositionals: string[] = [];
try {
  const cli = toolCli({
    name: "project-add-issue",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    options: {
      field: { type: "string", multiple: true },
    },
  });
  if (cli.common.help) usage();
  dryRun = cli.common.dryRun;
  devenvOverride = cli.common.devenv;
  fieldEntries = (cli.values["field"] as string[] | undefined) ?? [];
  rawPositionals = [...cli.positionals];
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

const args = [...rawPositionals];
if (args.length === 0) {
  logError("Project name and at least one issue number are required");
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}
projectName = args.shift() ?? "";
for (const a of args) {
  if (!/^[0-9]+$/.test(a)) {
    logError(`Unknown option or invalid issue number: ${a}`);
    console.error("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }
  issueNumbers.push(a);
}
if (issueNumbers.length === 0) {
  logError("At least one issue number is required");
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}
// Field specs are validated before any mutation: a malformed one would
// otherwise abort only after the card was added.
for (const fv of fieldEntries) {
  const eq = fv.indexOf("=");
  if (eq <= 0 || eq === fv.length - 1) {
    logError(`Invalid field format: ${fv} (expected NAME=VALUE)`);
    console.error("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }
  fieldValues.push(fv);
}

// Authenticate only after the arguments parsed: help and misuse need no provider.
ensureProviderAuth();

// Org identity gate (fail fast, bash parity).
if (providerOrgGet() === "") {
  logError("Organization identity unresolved. Configure [organization] org in devenv.config or run setup.");
  process.exit(EXIT_MISUSE);
}

const repoSpec = requireRepoTarget(providerRepoTarget(), "project-add-issue", "project");

// Devenv-repo safety gate: applies to implicit (cwd-inferred) targets only —
// an explicit DEVENV_REPO or --devenv bypasses.
checkTargetRepo(devenvOverride);

async function getIssueUrl(issueNum: string): Promise<string> {
  const raw = await issuesView(repoSpec, Number(issueNum), { json: "url", jq: ".url" });
  return raw.trim();
}

async function setFieldValues(issueNum: string): Promise<void> {
  const specParts = repoSpec.split("/");
  const owner = specParts[0] ?? "";
  const repo = specParts[1] ?? "";

  const ops = await projectsOps();
  const projectId = await ops.idByName(owner, projectName);
  const itemId = await ops.itemIdForIssue(projectId, issueNum, owner, repo);

  for (const fieldValue of fieldValues) {
    const eq = fieldValue.indexOf("=");
    const fieldName = eq === -1 ? fieldValue : fieldValue.slice(0, eq);
    const fieldVal = eq === -1 ? "" : fieldValue.slice(eq + 1);

    if (eq === -1 || fieldName === "" || fieldVal === "") {
      throw new Error(`Invalid field format: ${fieldValue} (expected NAME=VALUE)`);
    }

    const { fieldId, optionId } = await ops.fieldOptionIds(projectId, fieldName, fieldVal);
    if (!(await ops.fieldSet(projectId, itemId, fieldId, optionId))) {
      throw new Error(`Failed to set ${fieldName}='${fieldVal}' for issue #${issueNum} in '${projectName}'`);
    }
    logInfo(`Set ${fieldName}='${fieldVal}' for issue #${issueNum} in project '${projectName}'`);
  }
}

async function addIssueToProject(issueNum: string): Promise<void> {
  const specParts = repoSpec.split("/");
  const owner = specParts[0] ?? "";

  let issueUrl = "";
  try {
    issueUrl = await getIssueUrl(issueNum);
  } catch {
    issueUrl = "";
  }
  if (issueUrl === "") {
    throw new Error(`Could not get URL for issue #${issueNum}`);
  }

  if (dryRun) {
    logInfo(`[DRY RUN] Would add issue #${issueNum} to project '${projectName}'`);
    return;
  }

  // `gh project item-add` takes the project NUMBER, not its title —
  // resolve once here so both <title> and <number> inputs behave the same.
  let projectNumber = "";
  try {
    projectNumber = await projectsNumberByName(owner, projectName);
  } catch (err) {
    logError(`Could not resolve project '${projectName}' to a number`);
    const msg = errorMessage(err);
    if (msg !== "") logError(`provider: ${msg}`);
    logInfo("Pass the project by number, or check the title and org");
    throw err;
  }

  logWarn(`Adding issue #${issueNum} to project '${projectName}'`);
  try {
    const ops = await projectsOps();
    await ops.itemAdd(projectNumber, issueUrl, owner);
  } catch (err) {
    logError(`Failed to add issue #${issueNum} to project '${projectName}'`);
    const msg = errorMessage(err);
    if (msg !== "") logError(`provider: ${msg}`);
    logInfo("Check that the project exists, you have permissions, and DEVENV_REPO points at the issue's repository");
    throw err;
  }
  logInfo(`Added issue #${issueNum} to project '${projectName}'`);

  if (fieldValues.length > 0) {
    await setFieldValues(issueNum);
  }
}

let failed = 0;
for (const issueNum of issueNumbers) {
  try {
    await addIssueToProject(issueNum);
  } catch {
    failed += 1;
  }
}

if (failed > 0) {
  logError(`Failed to add ${failed} issue(s)`);
  process.exit(EXIT_GENERAL_ERROR);
}
