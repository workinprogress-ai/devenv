// markdown-plan-complete-task — mark AC checkboxes complete/incomplete.
// Port of markdown-plan-complete-task.sh over lib/domain/markdown.ts.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import {
  validateTaskNumber, findTaskLine, setItemCompleteAtLine, countTasks,
} from "../lib/domain/markdown.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";

function usage(): never {
  console.log(`Usage: markdown-plan-complete-task [OPTIONS] TASK_NUMBER... [FILE]

Mark one or more dotted task checkboxes as complete or incomplete.

Task items are identified by their dotted number, e.g. "2.3" or "2.3.1",
as they appear in implementation plan documents.

Positional arguments are classified automatically: any argument matching the
X.Y / X.Y.Z pattern is treated as a task number; anything else is treated as
the file path.  At most one file may be given.  If no file is given, the first
Plan-*.md (or Implementation_plan-*.md) found in .local-artifacts/ and then
the current directory is used.

TODO:DEVENV[Plan-skills-audit-remediation-001]: the Implementation_plan-*.md
filename alias is legacy — see the sunset note in plan-parse.ts and drop all
three carriers together.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
    --uncomplete        Mark the tasks as incomplete ([ ]) instead of complete ([x])

Exit Codes:
    0   All tasks updated successfully
    1   One or more tasks failed (task not found, etc.)
    2   Invalid arguments
    4   Plan file not found`);
  process.exit(0);
}

const tasks: string[] = [];
let planFile = "";
let uncomplete = false;

try {
  const cli = toolCli({
    name: "markdown-plan-complete-task",
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
    if (validateTaskNumber(a)) { tasks.push(a); continue; }
    if (planFile !== "") {
      logError(`Unexpected argument '${a}': file already set to '${planFile}'.`);
      logInfo("Run 'markdown-plan-complete-task --help' for usage.");
      process.exit(EXIT_MISUSE);
    }
    planFile = a;
  }
} catch (err) {
  logError(err instanceof Error ? err.message : String(err));
  logInfo("Run 'markdown-plan-complete-task --help' for usage.");
  process.exit(EXIT_MISUSE);
}

if (tasks.length === 0) {
  logError("At least one TASK_NUMBER is required.");
  logInfo("Run 'markdown-plan-complete-task --help' for usage.");
  process.exit(EXIT_MISUSE);
}

// Resolve the file: explicit arg wins; otherwise auto-detect Plan-*.md in
// .local-artifacts/ then the current directory.
if (planFile !== "") {
  if (!existsSync(planFile)) {
    logError(`File not found: ${planFile}`);
    process.exit(4);
  }
} else {
  let found = "";
  for (const dir of [".local-artifacts", "."]) {
    try {
      const hits = readdirSync(dir)
        .filter((e) => /^Plan-.*\.md$/.test(e) || /^Implementation_plan-.*\.md$/.test(e))
        .sort();
      if (hits.length > 0) { found = `${dir}/${hits[0]}`; break; }
    } catch { /* dir missing */ }
  }
  if (found === "") {
    logError("No Plan-*.md (or Implementation_plan-*.md) file found in .local-artifacts/ or the current directory.");
    logInfo("Specify the file explicitly as one of the arguments.");
    process.exit(4);
  }
  planFile = found;
  logInfo(`Using file: ${planFile}`);
}

const state = uncomplete ? "incomplete" : "complete";
const content = readFileSync(planFile, "utf8");

let failures = 0;
for (const task of tasks) {
  const lineNo = findTaskLine(content, task);
  if (lineNo === null) {
    logError(`${task} not found in ${planFile}`);
    failures++;
    continue;
  }
  setItemCompleteAtLine(planFile, lineNo, state);
  logInfo(`${task} marked as ${state}`);
}

const counts = countTasks(readFileSync(planFile, "utf8"));
logInfo(`Task progress: ${counts.completed}/${counts.total} tasks complete in ${basename(planFile)}`);

process.exit(failures === 0 ? 0 : EXIT_GENERAL_ERROR);
