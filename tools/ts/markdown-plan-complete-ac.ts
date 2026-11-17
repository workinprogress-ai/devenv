// markdown-plan-complete-ac — mark AC checkboxes complete/incomplete.
// Port of markdown-plan-complete-ac.sh over lib/domain/markdown.ts.

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import {
  validateAcNumber, findAcLine, setItemCompleteAtLine, countAcs, findPlanFiles,
} from "../lib/domain/markdown.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";

function usage(): never {
  console.log(`Usage: markdown-plan-complete-ac [OPTIONS] AC_NUMBER... [FILE]

Mark one or more acceptance-criteria checkboxes as complete or incomplete.

AC items are identified by their number, e.g. "AC-3" or "AC-1.2", as they
appear in specifications or plan documents.

Positional arguments are classified automatically: any argument matching the
AC-N / AC-N.N / AC-N.N.N pattern is treated as an AC number; anything else is
treated as the file path.  At most one file may be given.  If no file is given,
the first Plan-*.md (or Implementation_plan-*.md) found in .local-artifacts/
and then the current directory is used.  Several plans in that directory is an
error.  Other files (e.g. Specifications) can
be updated only by naming them explicitly.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
    --uncomplete        Mark the criteria as incomplete ([ ]) instead of complete ([x])

Exit Codes:
    0   All criteria updated successfully
    1   One or more criteria failed (not found, etc.)
    2   Invalid arguments (including several plans matching without a FILE)
    4   File not found`);
  process.exit(0);
}

const acs: string[] = [];
let planFile = "";
let uncomplete = false;

try {
  const cli = toolCli({
    name: "markdown-plan-complete-ac",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      uncomplete: { type: "boolean", default: false },
    },
  });
  if (cli.common.help) usage();
  uncomplete = cli.values["uncomplete"] === true;
  for (const a of cli.positionals) {
    if (validateAcNumber(a)) { acs.push(a); continue; }
    if (planFile !== "") {
      logError(`Unexpected argument '${a}': file already set to '${planFile}'.`);
      logInfo("Run 'markdown-plan-complete-ac --help' for usage.");
      process.exit(EXIT_MISUSE);
    }
    planFile = a;
  }
} catch (err) {
  logError(errorMessage(err));
  logInfo("Run 'markdown-plan-complete-ac --help' for usage.");
  process.exit(EXIT_MISUSE);
}

if (acs.length === 0) {
  logError("At least one AC_NUMBER is required.");
  logInfo("Run 'markdown-plan-complete-ac --help' for usage.");
  process.exit(EXIT_MISUSE);
}

// Resolve the file: explicit arg wins; otherwise auto-detect Plan-*.md in
// .local-artifacts/ then the current directory.
if (planFile !== "") {
  if (!existsSync(planFile)) {
    logError(`File not found: ${planFile}`);
    process.exit(EXIT_API_FAILURE);
  }
} else {
  const { dir, files } = findPlanFiles([".local-artifacts", "."]);
  if (files.length === 0) {
    logError("No Plan-*.md (or Implementation_plan-*.md) file found in .local-artifacts/ or the current directory.");
    logInfo("Specify the file explicitly as one of the arguments.");
    process.exit(EXIT_API_FAILURE);
  }
  if (files.length > 1) {
    logError(`Several plans match in ${dir}/: ${files.join(", ")}`);
    logInfo("Specify the file explicitly as one of the arguments.");
    process.exit(EXIT_MISUSE);
  }
  planFile = `${dir}/${files[0] as string}`;
  logInfo(`Using file: ${planFile}`);
}

const state = uncomplete ? "incomplete" : "complete";
const content = readFileSync(planFile, "utf8");

let failures = 0;
for (const ac of acs) {
  const lineNo = findAcLine(content, ac);
  if (lineNo === null) {
    logError(`${ac} not found in ${planFile}`);
    failures++;
    continue;
  }
  setItemCompleteAtLine(planFile, lineNo, state);
  logInfo(`${ac} marked as ${state}`);
}

const counts = countAcs(readFileSync(planFile, "utf8"));
logInfo(`AC progress: ${counts.completed}/${counts.total} criteria complete in ${basename(planFile)}`);

process.exit(failures === 0 ? 0 : EXIT_GENERAL_ERROR);
