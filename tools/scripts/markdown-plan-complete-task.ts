// markdown-plan-complete-task — mark AC checkboxes complete/incomplete.
// Port of markdown-plan-complete-task.sh over lib/domain/markdown.ts.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import {
  validateTaskNumber, findTaskLine, setItemCompleteAtLine, countTasks,
} from "../lib/domain/markdown.ts";

assertNodeFloor();

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

Options:
    -h, --help          Show this help message and exit
    -v, --version       Show version information and exit
    -V, --verbose       Enable verbose output
    --uncomplete        Mark the tasks as incomplete ([ ]) instead of complete ([x])

Exit Codes:
    0   All tasks updated successfully
    1   One or more tasks failed (task not found, etc.)
    2   Invalid arguments
    4   Plan file not found`);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();
if (argv.includes("-v") || argv.includes("--version")) {
  console.log("1.0.0");
  process.exit(0);
}

const acs: string[] = [];
let planFile = "";
let uncomplete = false;

for (const a of argv) {
  if (a === "--uncomplete") { uncomplete = true; continue; }
  if (a === "-V" || a === "--verbose") continue;
  if (a.startsWith("-")) {
    logError(`Unknown option: ${a}`);
    logInfo("Run 'markdown-plan-complete-task --help' for usage.");
    process.exit(EXIT_MISUSE);
  }
  if (validateTaskNumber(a)) { acs.push(a); continue; }
  if (planFile !== "") {
    logError(`Unexpected argument '${a}': file already set to '${planFile}'.`);
    logInfo("Run 'markdown-plan-complete-task --help' for usage.");
    process.exit(EXIT_MISUSE);
  }
  planFile = a;
}

if (acs.length === 0) {
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
for (const ac of acs) {
  const lineNo = findTaskLine(content, ac);
  if (lineNo === null) {
    logError(`${ac} not found in ${planFile}`);
    failures++;
    continue;
  }
  setItemCompleteAtLine(planFile, lineNo, state);
  logInfo(`${ac} marked as ${state}`);
}

const counts = countTasks(readFileSync(planFile, "utf8"));
logInfo(`Task progress: ${counts.completed}/${counts.total} tasks complete in ${basename(planFile)}`);

process.exit(failures === 0 ? 0 : EXIT_GENERAL_ERROR);
