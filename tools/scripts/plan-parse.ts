// plan-parse — deterministic plan structure parsing.
// Port of plan-parse.sh: extracts phases, tasks, completion state, and
// file-path anchors from Plan-*.md (or Implementation_plan-*.md) as JSON.
// Five modes: structure (default), anchors, census, summary, lint.
// The parsers are regex ports of the bash awk engines; the 47-test bats
// suite is the oracle (test_plan_parse.bats).

import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { invalidArgs } from "../lib/core/args.ts";
import { headerField } from "../lib/domain/artifacts.ts";

assertNodeFloor();


// One extracted record from the shared phase/AC/task pipeline.
interface PhaseRec { number: string; title: string; startLine: number }
interface TaskRec {
  id: string; done: boolean; text: string; size: string;
  phase: string; line: number; badSuffix: string;
}
interface AcRec { id: string; done: boolean }
interface Parsed { phases: PhaseRec[]; tasks: TaskRec[]; acs: AcRec[] }

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
    -V, --verbose   Enable verbose logs
    -h, --help      Show help and exit
    -v, --version   Show version and exit

Exit Codes:
    0 success (lint: no errors)
    1 lint errors found (--lint mode)
    2 invalid arguments`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Shared extraction pipeline (structure / census / summary / lint)
// ---------------------------------------------------------------------------

export function parsePlan(content: string): Parsed {
  const lines = content.split("\n");
  const phases: PhaseRec[] = [];
  const tasks: TaskRec[] = [];
  const acs: AcRec[] = [];
  let currentPhase = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const nr = i + 1;

    // Phase heading: "### Phase 12 — title"
    const ph = line.match(/^#+\s+Phase\s+(\d+)\s*(.*)$/);
    if (ph) {
      let title = (ph[2] ?? "").replace(/^Phase\s+\d+\s*[—–-]?\s*/, "");
      title = title.replace(/^[^A-Za-z0-9]+/, ""); // em-dash residue
      currentPhase = ph[1] as string;
      phases.push({ number: ph[1] as string, title, startLine: nr });
      continue;
    }

    // AC checklist: "- [ ] <a id="ac-1"></a>**AC-1** ..." (link bullets without
    // a checkbox are excluded by the leading checkbox requirement)
    if (/^-\s+\[[ xX]\]/.test(line) && /AC-\d+/.test(line)) {
      const id = line.match(/AC-\d+/)?.[0] ?? "";
      acs.push({ id, done: /^-\s+\[[xX]\]/.test(line) });
      continue;
    }

    // Task line: "- [x] **1.1 [S] title**" or "- [ ] 1.2 title"
    if (currentPhase !== "" && /^-\s+\[[ xX]\]\s+(\*\*)?\d+\.\d+/.test(line)) {
      const rest = line.replace(/^-\s+\[[ xX]\]\s+/, "").replace(/^\*\*/, "");
      const id = rest.match(/^\d+(\.\d+)+/)?.[0] ?? "";
      const done = /^-\s+\[[xX]\]/.test(line);
      let text = rest.replace(/^\d+(\.\d+)+\s*/, "").replace(/^\*\*/, "")
        .replace(/\*\*\s*$/, "");
      let size = "";
      const sz = text.match(/^\[([SsMmLl])\]/);
      if (sz) {
        size = (sz[1] as string).toUpperCase();
        text = text.replace(/^\[[SsMmLl]\]\s*/, "");
      }
      // Alphabetic suffix (2.1a): id token followed immediately by a letter.
      const badSuffix = rest.match(/^\d+(\.\d+)*[A-Za-z]/)?.[0] ?? "";
      tasks.push({
        id, done, text, size, phase: currentPhase, line: nr,
        badSuffix: badSuffix === "" ? "-" : badSuffix,
      });
    }
  }
  return { phases, tasks, acs };
}

// ---------------------------------------------------------------------------
// Lint mode
// ---------------------------------------------------------------------------

interface LintReport {
  errors: string[]; warnings: string[]; ok: boolean;
  nPhases: number; nTasks: number;
}

function lintPlan(file: string, parsed: Parsed, requireHeader: boolean,
                  content: string): LintReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { phases, tasks } = parsed;

  if (phases.length === 0) {
    errors.push("no Phase headings found — a plan must have at least one phase");
  }

  // Alphabetic task suffixes (2.1a) — hard rule.
  for (const t of tasks) {
    if (t.badSuffix !== "-") {
      errors.push(`task id '${t.id}' at line ${t.line} carries an alphabetic suffix ('${t.badSuffix}') — use numeric ids or hierarchical subtasks (7.1.1)`);
    }
  }

  // Duplicate task ids — hard rule.
  const seen = new Map<string, number>();
  for (const t of tasks) seen.set(t.id, (seen.get(t.id) ?? 0) + 1);
  for (const [id, n] of seen) {
    if (n > 1) errors.push(`duplicate task id '${id}'`);
  }

  // Revision History section — hard rule (plans are current-state only).
  if (/^##\s*Revision History/m.test(content)) {
    errors.push("'## Revision History' section present — plans are current-state artifacts; revision history is never created");
  }

  // Phases with zero tasks — warning.
  const phasesWithTasks = new Set(tasks.map((t) => t.phase));
  for (const p of [...phases].sort((a, b) => Number(a.number) - Number(b.number))) {
    if (!phasesWithTasks.has(p.number)) {
      warnings.push(`phase ${p.number} has no tasks`);
    }
  }

  // Missing size tokens — warning, only when some task carries one.
  const sized = tasks.filter((t) => t.size !== "").length;
  const unsized = tasks.length - sized;
  if (sized > 0 && unsized > 0) {
    warnings.push(`${unsized} of ${tasks.length} tasks carry no [S|M|L] size token (weights default to M)`);
  }

  // Task-numbering gaps — informational warning.
  const byPhase = new Map<string, { max: number; count: number }>();
  for (const t of tasks) {
    const subId = Number(t.id.split(".")[1]);
    const e = byPhase.get(t.phase) ?? { max: 0, count: 0 };
    if (subId > e.max) e.max = subId;
    e.count++;
    byPhase.set(t.phase, e);
  }
  for (const p of [...byPhase.keys()].sort((a, b) => Number(a) - Number(b))) {
    const e = byPhase.get(p) as { max: number; count: number };
    if (e.max !== e.count) {
      warnings.push(`phase ${p} task numbering has gaps (expected after clean deletions — informational)`);
    }
  }

  // Header validation (only under --require-header — the upsert gate).
  const headerFound = content.includes("DEVENV_ARTIFACT_V1");
  if (requireHeader) {
    if (!headerFound) {
      errors.push("DEVENV_ARTIFACT_V1 header missing — required before issue-artifact-upsert");
    } else {
      const docId = headerField(content, "doc_id");
      const artType = headerField(content, "artifact_type");
      const planning = headerField(content, "planning_repo");
      if (docId === "") {
        errors.push("header key doc_id missing — required before issue-artifact-upsert");
      } else if (!/^dv1:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+:(issue-[0-9]+|local):[a-z-]+:[A-Za-z0-9_.-]+$/.test(docId)) {
        errors.push(`doc_id '${docId}' does not match the deterministic format dv1:<owner/repo>:<issue-N|local>:<type>:<slug>`);
      } else if (!content.slice(0, 256).includes("doc_id")) {
        errors.push("doc_id not within the first 256 characters of the file");
      }
      if (artType !== "" && artType !== "plan") {
        errors.push(`artifact_type is '${artType}' — expected 'plan' for a plan artifact; set the header to 'artifact_type: plan' (legacy 'implementation-plan' headers must be corrected, not published)`);
      }
      if (planning !== "" && planning !== "none" &&
          !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(planning)) {
        errors.push(`planning_repo '${planning}' is not in owner/repo form — a malformed value misroutes issue/artifact calls silently`);
      }
    }
  }

  return { errors, warnings, ok: errors.length === 0, nPhases: phases.length, nTasks: tasks.length };
}

// ---------------------------------------------------------------------------
// Modes
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

function emitStructure(parsed: Parsed): never {
  const phases = parsed.phases.map((p) => ({
    number: p.number,
    title: p.title,
    start_line: p.startLine,
    tasks: parsed.tasks
      .filter((t) => t.phase === p.number)
      .map((t) => ({ id: t.id, done: t.done, text: t.text })),
  }));
  console.log(JSON.stringify({ phases, acs: parsed.acs.map((a) => ({ id: a.id, done: a.done })) }, null, 2));
  process.exit(0);
}

function emitCensus(parsed: Parsed): never {
  const order: string[] = [];
  const total = new Map<string, number>();
  const done = new Map<string, number>();
  for (const p of parsed.phases) {
    if (!total.has(p.number)) { total.set(p.number, 0); done.set(p.number, 0); order.push(p.number); }
  }
  for (const t of parsed.tasks) {
    if (!total.has(t.phase)) { total.set(t.phase, 0); done.set(t.phase, 0); order.push(t.phase); }
    total.set(t.phase, (total.get(t.phase) ?? 0) + 1);
    if (t.done) done.set(t.phase, (done.get(t.phase) ?? 0) + 1);
  }
  let gt = 0, gd = 0;
  const census = order.map((p) => {
    const t = total.get(p) ?? 0, d = done.get(p) ?? 0;
    gt += t; gd += d;
    return { phase: p, total: t, done: d, open: t - d };
  });
  console.log(JSON.stringify({ census, totals: { tasks: gt, done: gd, open: gt - gd } }, null, 2));
  process.exit(0);
}

function emitAnchors(file: string, content: string): never {
  const planDir = dirname(resolve(file));
  const paths = new Set<string>();
  const re = /[A-Za-z0-9_./-]+\.(cs|ts|tsx|js|json|csproj|sh|md|sql|yaml|yml|py)/g;
  for (const p of content.match(re) ?? []) {
    if (p.includes("://")) continue;
    paths.add(p);
  }
  const anchors = [...paths].sort().map((p) => ({
    path: p,
    exists: existsSync(`${planDir}/${p}`) || (p.startsWith("/") && existsSync(p)),
  }));
  console.log(JSON.stringify({ anchors }, null, 2));
  process.exit(0);
}

function emitSummary(file: string, parsed: Parsed, content: string): never {
  // Header routing fields (null when absent); planning_repo "none" (the
  // sanctioned ungoverned sentinel) normalizes to null, same as absence.
  const hv = (k: string): string | null => {
    const v = headerField(content, k);
    return v === "" ? null : v;
  };
  const planning = (() => {
    const v = hv("planning_repo");
    return v === "none" ? null : v;
  })();

  // Phase-order metrics (phases counted only when they carry tasks).
  const order = parsed.phases.map((p) => p.number);
  const phaseHasTask = new Set(parsed.tasks.map((t) => t.phase));
  const phaseOpen = new Map<string, number>();
  for (const t of parsed.tasks) {
    if (!t.done) phaseOpen.set(t.phase, (phaseOpen.get(t.phase) ?? 0) + 1);
  }

  const phasesWithTasks = order.filter((p) => phaseHasTask.has(p));
  const phasesComplete = phasesWithTasks.filter((p) => (phaseOpen.get(p) ?? 0) === 0).length;

  let currentPhase = phasesWithTasks.find((p) => (phaseOpen.get(p) ?? 0) > 0) ?? "";
  if (currentPhase === "" && phasesWithTasks.length > 0) {
    currentPhase = phasesWithTasks[phasesWithTasks.length - 1] as string;
  }

  const totalTasks = parsed.tasks.length;
  const doneTasks = parsed.tasks.filter((t) => t.done).length;
  const weight = (s: string): number => (s === "S" ? 1 : s === "L" ? 4 : 2); // unsized = M
  const weightedTotal = parsed.tasks.reduce((a, t) => a + weight(t.size), 0);
  const weightedDone = parsed.tasks.filter((t) => t.done).reduce((a, t) => a + weight(t.size), 0);
  const sizedTasks = parsed.tasks.filter((t) => t.size !== "").length;
  const pct = totalTasks > 0 ? (100 * doneTasks / totalTasks).toFixed(1) : "0.0";
  const wpct = weightedTotal > 0 ? (100 * weightedDone / weightedTotal).toFixed(1) : "0.0";
  const sizedRatio = totalTasks > 0 ? (sizedTasks / totalTasks).toFixed(2) : "0.00";
  const openQuestions = (content.match(/\[QUESTION\]/g) ?? []).length;
  const uncheckedAcs = parsed.acs.filter((a) => !a.done).length;

  const out = {
    plan_file: basename(file),
    doc_id: hv("doc_id"),
    issue_number: hv("issue_number"),
    planning_repo: planning,
    phases_total: phasesWithTasks.length,
    phases_complete: phasesComplete,
    current_phase: currentPhase,
    tasks_done: doneTasks,
    tasks_open: totalTasks - doneTasks,
    tasks_total: totalTasks,
    pct_tasks: Number(pct),
    weighted: { done: weightedDone, total: weightedTotal, pct: Number(wpct) },
    sized_tasks: Number(sizedRatio),
    open_questions: openQuestions,
    unchecked_acs: uncheckedAcs,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Argv
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();
if (argv.includes("-v") || argv.includes("--version")) {
  console.log("1.2.0");
  process.exit(0);
}

let mode = "structure";
let modeSet = 0;
let requireHeader = false;
let file = "";

for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  if (["--structure", "--anchors", "--census", "--summary", "--lint"].includes(a)) {
    modeSet++;
    if (modeSet > 1) {
      console.error(`plan-parse: only one mode flag allowed (already set: --${mode}, got ${a})`);
      process.exit(EXIT_MISUSE);
    }
    mode = a.slice(2);
  } else if (a === "--require-header") {
    requireHeader = true;
  } else if (a === "-V" || a === "--verbose") {
    // accepted for parity; no verbose surface in the port
  } else {
    file = a;
  }
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
if (mode === "anchors") emitAnchors(file, content);
if (mode === "summary") emitSummary(file, parsed, content);
if (mode === "census") emitCensus(parsed);
emitStructure(parsed);
