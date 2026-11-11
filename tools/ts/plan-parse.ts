// plan-parse — deterministic plan structure parsing.
// Port of plan-parse.sh: extracts phases, tasks, completion state, and
// file-path anchors from Plan-*.md (or Implementation_plan-*.md) as JSON.
// TODO:DEVENV[Plan-skills-audit-remediation-001]: the Implementation_plan-*.md filename alias is legacy — drop it across plan-parse, markdown-plan-complete-task, and lint-documentation when no live .local-artifacts plan file carries that prefix (verify across workspace repos before removing).
// Five modes: structure (default), anchors, census, summary, lint.
// The parsers are regex ports of the bash awk engines; the 47-test bats
// suite is the oracle (test_plan_parse.bats).

import { readFileSync, existsSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { invalidArgs } from "../lib/core/args.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { lintPlan, parsePlan, planAnchors, planCensus, planStructure, planSummary, type LintReport } from "../lib/domain/plan.ts";

assertNodeFloor();


function usage(): never {
  console.log(`Usage: plan-parse FILE [OPTIONS]

Parse a Plan-*.md (or Implementation_plan-*.md) deterministically.

Modes:
    --structure  (default) Phases with tasks and completion state:
                 {phases:[{number,title,start_line,tasks:[{id,text,done}]}],
                 acs:[{id,text,done}]}
    --anchors    File paths mentioned in the plan with existence check
                 relative to the plan's directory: {anchors:[{path,exists}]}
    --census     One-line completion summary per phase:
                 {census:[{phase,total,done,open}], totals:{tasks,done,open}}
    --summary    Single-object progress summary with the artifact header
                 routing fields (null when absent): plan_file, doc_id,
                 issue_number, planning_repo, phases_total, phases_complete,
                 current_phase, tasks_done/open/total, pct_tasks,
                 weighted{done,total,pct} (S=1 M=2 L=4, missing size counts
                 as M), sized_tasks ratio, open_questions, unchecked_acs
    --lint       Structural lint as JSON {errors, warnings, checks, ok};
                 exit 1 on any error

Options:
    --require-header  With --lint only: make the DEVENV_ARTIFACT_V1 header
                 mandatory and validated (the issue-artifact-upsert gate)
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

Exit Codes:
    0 success (lint: no errors)
    1 lint errors found (--lint mode)
    2 invalid arguments`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Output (the document builders live in lib/domain/plan.ts)
// ---------------------------------------------------------------------------

function emitLint(r: LintReport, requireHeader: boolean, headerFound: boolean): never {
  const out = {
    errors: r.errors,
    warnings: r.warnings,
    checks: { phases: r.nPhases, tasks: r.nTasks, header: headerFound, header_required: requireHeader },
    ok: r.ok,
  };
  console.log(JSON.stringify(out));
  process.exit(r.ok ? 0 : 1);
}

function emit(doc: object): never {
  console.log(JSON.stringify(doc, null, 2));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Argv
// ---------------------------------------------------------------------------

const SCRIPT_VERSION = "1.2.0";

let mode = "structure";
let requireHeader = false;
let file = "";

try {
  const cli = toolCli({
    name: "plan-parse",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      structure: { type: "boolean", default: false },
      anchors: { type: "boolean", default: false },
      census: { type: "boolean", default: false },
      summary: { type: "boolean", default: false },
      lint: { type: "boolean", default: false },
      "require-header": { type: "boolean", default: false },
    },
  });
  if (cli.common.help) usage();
  for (const a of cli.positionals) {
    if (file !== "") invalidArgs(`Unexpected argument: ${a}`);
    file = a;
  }
  // Report flags in command-line order (the original loop's contract):
  // "already set" names the flag that appeared FIRST on the line.
  const seen: string[] = [];
  const modeFlags = ["structure", "anchors", "census", "summary", "lint"] as const;
  const order: string[] = [];
  for (const a of process.argv.slice(2)) {
    const long = a.startsWith("--") ? a.slice(2) : "";
    if ((modeFlags as readonly string[]).includes(long)) order.push(long);
  }
  for (const m of modeFlags) {
    if (cli.values[m] === true) seen.push(m);
  }
  // Use command-line order for the duplicate report when available.
  const first = order.length > 0 ? order[0] : (seen[0] ?? mode);
  if (seen.length > 1) {
    const second = order.length > 1 ? order[1] : (seen[1] ?? "");
    console.error(`plan-parse: only one mode flag allowed (already set: --${first}, got --${second})`);
    process.exit(EXIT_MISUSE);
  }
  if (seen.length === 1) mode = seen[0] as string;
  requireHeader = cli.values["require-header"] === true;
} catch (err) {
  if (err instanceof Error && err.message.startsWith("Unexpected argument")) throw err;
  logError(errorMessage(err));
  console.log("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

if (file === "") invalidArgs("FILE is required");
if (!existsSync(file)) invalidArgs(`File not found: ${file}`);
if (requireHeader && mode !== "lint") {
  invalidArgs("--require-header is only valid together with --lint");
}

const content = readFileSync(file, "utf8");
const parsed = parsePlan(content);

if (mode === "lint") {
  const r = lintPlan(file, parsed, requireHeader, content);
  emitLint(r, requireHeader, content.includes("DEVENV_ARTIFACT_V1"));
}
if (mode === "anchors") emit(planAnchors(file, content));
if (mode === "summary") emit(planSummary(file, parsed, content));
if (mode === "census") emit(planCensus(parsed));
emit(planStructure(parsed));
