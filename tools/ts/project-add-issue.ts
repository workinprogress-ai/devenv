#!/usr/bin/env node
// project-add-issue.ts - Add issues to a GitHub Project (v2)
// Version: 1.1.0
// Description: Adds one or more issues to a named organization project,
//              optionally setting single-select field values on the new
//              cards (--field NAME=VALUE, repeatable). All-or-nothing per
//              issue: the first unresolvable field aborts that issue's setup.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { parseArgs } from "node:util";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { ensureProviderAuth, isDevenvRepoGated, providerOrgGet, providerRepoTarget } from "../lib/providers/provider-core.ts";
import { issuesView } from "../lib/providers/github/issues.ts";
import {
  projectsItemAdd,
  projectsIdByName,
  projectsNumberByName,
  projectsItemIdForIssue,
  projectsFieldOptionIds,
  projectsFieldSet,
} from "../lib/providers/github/projects.ts";

assertNodeFloor();

ensureProviderAuth();

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
  -n, --dry-run           Show what would be done without making changes
  --devenv                Allow operating on the devenv repository itself
  -h, --help              Show this help
  -v, --version           Show version
  -V, --verbose           Verbose output

Examples:
  project-add-issue "Team Board" 123 124
  project-add-issue "Team Board" 125 --field Status=In Progress --dry-run`);
  process.exit(0);
}

// Parse arguments
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", default: false },
    version: { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    field: { type: "string", multiple: true },
    devenv: { type: "boolean", default: false },
  },
  allowPositionals: true,
  strict: false,
});

if (values.help) usage();
if (values.version) {
  console.log("1.1.0");
  process.exit(0);
}
dryRun = values["dry-run"] === true;

const args = [...positionals];
if (args.length === 0) {
  logError("Project name and at least one issue number are required");
  console.error("Use --help for usage information");
  process.exit(EXIT_GENERAL_ERROR);
}
projectName = args.shift() ?? "";
for (const a of args) {
  if (a.startsWith("-")) {
    logError(`Unknown option or invalid issue number: ${a}`);
    console.error("Use --help for usage information");
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (!/^[0-9]+$/.test(a)) {
    logError(`Unknown option or invalid issue number: ${a}`);
    console.error("Use --help for usage information");
    process.exit(EXIT_GENERAL_ERROR);
  }
  issueNumbers.push(a);
}
if (issueNumbers.length === 0) {
  logError("At least one issue number is required");
  console.error("Use --help for usage information");
  process.exit(EXIT_GENERAL_ERROR);
}
for (const fv of values.field ?? []) {
  if (typeof fv === "string") fieldValues.push(fv);
}

// Org identity gate (fail fast, bash parity).
if (providerOrgGet() === "") {
  logError("Organization identity unresolved. Configure [organization] org in devenv.config or run setup.");
  process.exit(EXIT_MISUSE);
}

const repoSpec = providerRepoTarget();

// Devenv-repo safety gate (resolve_target_repo parity): applies to implicit
// (cwd-inferred) targets only — an explicit DEVENV_REPO or --devenv bypasses.
if (!isDevenvRepoGated()) {
  // not a devenv checkout: gate is a no-op
} else if (process.env["DEVENV_REPO"] !== undefined && process.env["DEVENV_REPO"] !== "") {
  // explicit target: allowed
} else if (values["devenv"] === true) {
  // explicit override: allowed
} else {
  logError("The current repository appears to be the devenv repository itself");
  console.log("Operations should be performed in target project repositories, not in devenv");
  console.log("To target a project repo, prefix the command with DEVENV_REPO=<owner>/<repo>");
  console.log("To override this safety check (devenv-repo work only), pass the --devenv flag");
  process.exit(EXIT_GENERAL_ERROR);
}

async function getIssueUrl(issueNum: string): Promise<string> {
  const raw = await issuesView(repoSpec, Number(issueNum), { json: "url", jq: ".url" });
  return raw.trim();
}

async function setFieldValues(issueNum: string): Promise<void> {
  const specParts = repoSpec.split("/");
  const owner = specParts[0] ?? "";
  const repo = specParts[1] ?? "";

  const projectId = projectsIdByName(owner, projectName);
  const itemId = projectsItemIdForIssue(projectId, issueNum, owner, repo);

  for (const fieldValue of fieldValues) {
    const eq = fieldValue.indexOf("=");
    const fieldName = eq === -1 ? fieldValue : fieldValue.slice(0, eq);
    const fieldVal = eq === -1 ? "" : fieldValue.slice(eq + 1);

    if (eq === -1 || fieldName === "" || fieldVal === "") {
      throw new Error(`Invalid field format: ${fieldValue} (expected NAME=VALUE)`);
    }

    const { fieldId, optionId } = projectsFieldOptionIds(projectId, fieldName, fieldVal);
    if (!projectsFieldSet(projectId, itemId, fieldId, optionId)) {
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
    projectNumber = projectsNumberByName(owner, projectName);
  } catch (err) {
    logError(`Could not resolve project '${projectName}' to a number`);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== "") logError(`provider: ${msg}`);
    logInfo("Pass the project by number, or check the title and org");
    throw err;
  }

  logWarn(`Adding issue #${issueNum} to project '${projectName}'`);
  try {
    projectsItemAdd(undefined, projectNumber, issueUrl, ["--owner", owner]);
  } catch (err) {
    logError(`Failed to add issue #${issueNum} to project '${projectName}'`);
    const msg = err instanceof Error ? err.message : String(err);
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
