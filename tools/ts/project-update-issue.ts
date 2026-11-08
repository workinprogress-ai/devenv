#!/usr/bin/env node
// project-update-issue.ts - Update a GitHub Project (v2) card's fields
// Version: 1.1.0
// Description: Sets the Status field (validated against devenv.config's
//              [workflows] status_workflow) or arbitrary single-select fields
//              on the card of an issue already in the project. --all-projects
//              updates every project holding the issue (idempotent skips);
//              --safe tolerates "in no projects" as success.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { configGetArray } from "../lib/core/config.ts";
import { ensureProviderAuth, isDevenvRepoGated, providerConfigPath, providerOrgGet, providerRepoTarget, requireRepoTarget } from "../lib/providers/provider-core.ts";
import { issueWebUrl } from "../lib/providers/facade/issues.ts";
import { projectsOps } from "../lib/providers/facade/projects.ts";

assertNodeFloor();

ensureProviderAuth();

let projectName = "";
let issueNumber = "";
let dryRun = false;
let allProjects = false;
let safeMode = false;
let listFields = false;
let statusValue = "";
const fieldUpdates: string[] = [];

function usage(): never {
  console.log(`Usage: project-update-issue PROJECT_NAME ISSUE_NUMBER [OPTIONS]
       project-update-issue --all-projects ISSUE_NUMBER --status STATUS

Update fields on a GitHub Project (v2) card for an issue already in the project.

Options:
    --status STATUS           Set the Status field (validated against the
                              configured workflow vocabulary, e.g. To-Groom)
    --all-projects            Update the issue's card in every project holding it
    --safe                    With --all-projects: tolerate "in no projects" as success
    --field NAME=VALUE        Set a single-select field (repeatable)
    --list-fields             List the project's fields
${usageCommonFlags({ noDryRunShort: true })}

Note: the issue must already be in the project; field names and values must
match exactly (case-sensitive).`);
  process.exit(0);
}

let statusWorkflow: string[] = [];
function loadStatusWorkflow(): void {
  // The canonical config path (providerConfigPath encodes the
  // DEVENV_ROOT-else-self-root chain — never the bare cwd).
  statusWorkflow = configGetArray(providerConfigPath(), "workflows", "status_workflow");
  if (statusWorkflow.length === 0) {
    logError("status_workflow not configured in devenv.config [workflows] section");
    process.exit(EXIT_GENERAL_ERROR);
  }
}

function validateStatus(status: string): boolean {
  if (statusWorkflow.includes(status)) return true;
  logError(`Invalid status: ${status}`);
  logInfo(`Valid statuses: ${statusWorkflow.join(" ")}`);
  return false;
}

interface ParsedArgs {
  values: {
    help?: boolean;
    version?: boolean;
    "dry-run"?: boolean;
    status?: string;
    "all-projects"?: boolean;
    safe?: boolean;
    field?: string | string[];
    "list-fields"?: boolean;
    devenv?: boolean;
    [key: string]: string | boolean | (string | boolean)[] | undefined;
  };
  positionals: string[];
}
let parsed: ParsedArgs;
try {
  const cli = toolCli({
    name: "project-update-issue",
    version: "1.1.0",
    argv: process.argv.slice(2),
    options: {
      status: { type: "string" },
      "all-projects": { type: "boolean", default: false },
      safe: { type: "boolean", default: false },
      field: { type: "string", multiple: true },
      "list-fields": { type: "boolean", default: false },
    },
  });
  if (cli.common.help) usage();
  parsed = {
    values: {
      status: (cli.values["status"] as string | undefined) ?? "",
      "all-projects": cli.values["all-projects"] === true,
      safe: cli.values["safe"] === true,
      field: (cli.values["field"] as string[] | undefined) ?? [],
      "list-fields": cli.values["list-fields"] === true,
      "dry-run": cli.common.dryRun,
      devenv: cli.common.devenv,
    },
    positionals: cli.positionals,
  };
} catch (err) {
  // strict:true throws on an unknown flag — a named one-liner instead of a
  // raw Node stack trace (the suite's stated unknown-flag contract).
  logError(err instanceof Error ? err.message : String(err));
  console.log("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

dryRun = parsed.values["dry-run"] === true;
allProjects = parsed.values["all-projects"] === true;
safeMode = parsed.values.safe === true;
listFields = parsed.values["list-fields"] === true;
statusValue = typeof parsed.values.status === "string" ? parsed.values.status : "";
for (const fv of (parsed.values.field as string[] | undefined) ?? []) {
  fieldUpdates.push(fv);
}

const positionals = parsed.positionals.filter((p) => !p.startsWith("-"));
if (allProjects && positionals.length === 1 && /^[0-9]+$/.test(positionals[0] ?? "")) {
  issueNumber = positionals[0] ?? "";
} else if (positionals.length > 0) {
  projectName = positionals[0] ?? "";
  if (positionals.length > 1 && /^[0-9]+$/.test(positionals[1] ?? "")) {
    issueNumber = positionals[1] ?? "";
  }
}

if (!allProjects && projectName === "") {
  logError("Project name is required");
  process.exit(EXIT_GENERAL_ERROR);
}

loadStatusWorkflow();

if (providerOrgGet() === "") {
  logError("Organization identity unresolved. Configure [organization] org in devenv.config or run setup.");
  process.exit(EXIT_MISUSE);
}

const repoSpec = requireRepoTarget(providerRepoTarget(), "project-update-issue", "project");
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
const owner = repoSpec.split("/")[0] ?? "";
const repo = repoSpec.split("/")[1] ?? "";

// Provider dispatch for the projects family lives in the facade (the
// hoisted 15.14 ops-object): one async-neutral verb set, resolved lazily
// on first use. The `isAzure` probe and both per-provider op tables are
// gone — the tool no longer knows providers exist.
const ops = await projectsOps();

if (listFields) {
  logInfo(`Listing fields for project: ${projectName}`);
  logInfo(`Owner: ${owner}`);
  logInfo("");
  try {
    const out = await ops.fieldList(projectName, owner);
    process.stdout.write(out);
  } catch {
    logWarn("Could not list fields automatically");
    logInfo("Visit project in web UI to see available fields");
  }
  process.exit(0);
}

if (issueNumber === "") {
  logError("Issue number is required");
  process.exit(EXIT_GENERAL_ERROR);
}

const issueUrl = await issueWebUrl(repoSpec, Number(issueNumber));

async function updateStatus(status: string): Promise<boolean> {
  if (!validateStatus(status)) return false;

  if (dryRun) {
    logInfo(`[DRY RUN] Would set Status='${status}' for issue #${issueNumber} in project '${projectName}'`);
    return true;
  }

  let projectId: string;
  try {
    projectId = await ops.idByName(owner, projectName);
  } catch {
    logError(`Project '${projectName}' not found for owner '${owner}'`);
    return false;
  }
  let itemId: string;
  try {
    itemId = await ops.itemIdForIssue(projectId, issueNumber, owner, repo);
  } catch {
    logError(`Issue #${issueNumber} (${owner}/${repo}) is not (uniquely) in project '${projectName}'`);
    return false;
  }
  let fieldId = "";
  let optionId = "";
  try {
    ({ fieldId, optionId } = await ops.fieldOptionIds(projectId, "Status", status));
  } catch (err) {
    logError(err instanceof Error ? err.message : `Status option '${status}' not found in project '${projectName}'`);
    return false;
  }
  if (!(await ops.fieldSet(projectId, itemId, fieldId, optionId))) {
    logError(`Failed to set Status='${status}' for issue #${issueNumber} in '${projectName}'`);
    return false;
  }
  logInfo(`Set Status='${status}' for issue #${issueNumber} in project '${projectName}'`);
  return true;
}

async function updateStatusAllProjects(status: string): Promise<boolean> {
  let rows: Array<{ title: string; number: string; status: string }>;
  try {
    rows = await ops.forIssue(issueUrl, owner);
  } catch {
    if (safeMode) {
      logWarn(`project lookup failed for issue #${issueNumber} - skipping status update (--safe reports, never lies)`);
    } else {
      logError(`project lookup failed for issue #${issueNumber}`);
    }
    return false;
  }

  if (rows.length === 0) {
    if (safeMode) {
      logInfo(`Issue #${issueNumber} is in no projects - nothing to update (--safe)`);
      return true;
    }
    logError(`Issue #${issueNumber} is in no projects (use --safe to tolerate this)`);
    return false;
  }

  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.status === status) {
      logInfo(`Project '${row.title}' (${row.number}): already Status='${status}' (idempotent skip)`);
      updated += 1;
      continue;
    }
    projectName = row.number;
    if (await updateStatus(status)) updated += 1;
    else failed += 1;
  }

  if (updated === 0) {
    logError(`No project updated for issue #${issueNumber} (updated=${updated} failed=${failed})`);
    return false;
  }
  if (failed > 0) logWarn(`Partial: updated=${updated} failed=${failed} for issue #${issueNumber}`);
  return true;
}

async function updateField(fieldName: string, fieldValue: string): Promise<boolean> {
  if (dryRun) {
    logInfo(`[DRY RUN] Would set ${fieldName}='${fieldValue}' for issue #${issueNumber} in project '${projectName}'`);
    return true;
  }
  let projectId: string;
  let itemId: string;
  let fieldId: string;
  let optionId: string;
  try {
    projectId = await ops.idByName(owner, projectName);
    itemId = await ops.itemIdForIssue(projectId, issueNumber, owner, repo);
    ({ fieldId, optionId } = await ops.fieldOptionIds(projectId, fieldName, fieldValue));
  } catch (err) {
    // Lib throws route through the established script-level wording — never
    // a raw stack trace, and later --field entries still get attempted.
    logError(err instanceof Error ? err.message : `Failed to resolve ${fieldName}='${fieldValue}' in '${projectName}'`);
    return false;
  }
  if (!(await ops.fieldSet(projectId, itemId, fieldId, optionId))) {
    logError(`Failed to set ${fieldName}='${fieldValue}' for issue #${issueNumber} in '${projectName}'`);
    return false;
  }
  logInfo(`Set ${fieldName}='${fieldValue}' for issue #${issueNumber} in project '${projectName}'`);
  return true;
}

let ok = true;

if (statusValue !== "") {
  ok = allProjects ? await updateStatusAllProjects(statusValue) : await updateStatus(statusValue);
}

// Update custom fields (single-project only: fan-out is Status-only).
let fieldsFailed = false;
if (fieldUpdates.length > 0) {
  if (allProjects) {
    logError("--field cannot be combined with --all-projects (fan-out is Status-only)");
    process.exit(EXIT_GENERAL_ERROR);
  }
  for (const fu of fieldUpdates) {
    const eq = fu.indexOf("=");
    const fieldName = eq === -1 ? fu : fu.slice(0, eq);
    const fieldValue = eq === -1 ? "" : fu.slice(eq + 1);
    if (eq === -1 || fieldName === "" || fieldValue === "") {
      logError(`Invalid field format: ${fu} (expected NAME=VALUE)`);
      fieldsFailed = true;
      continue;
    }
    if (!(await updateField(fieldName, fieldValue))) fieldsFailed = true;
  }
}

// Zero-action runs are a mistake (a typo'd flag would otherwise silently do
// nothing): refuse before the exit-code check.
if (statusValue === "" && fieldUpdates.length === 0) {
  logError("Nothing to do: pass --status and/or --field");
  process.exit(EXIT_MISUSE);
}

// A failed update must never exit 0, even when other updates succeeded.
if (!ok || fieldsFailed) process.exit(EXIT_GENERAL_ERROR);
