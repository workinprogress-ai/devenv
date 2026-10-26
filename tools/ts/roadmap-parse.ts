// roadmap-parse — parse a roadmap artifact into per-step truth JSON.
// Port of roadmap-parse.sh: emits per-STEP objects (step, phase, title,
// status, issues, progress, dependencies, plan_file). Status is passed
// through as written — reconciling it with issue/PR state is the
// update-roadmap skill's job, not this tool's.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { invalidArgs } from "../lib/core/args.ts";
import { providerOrgGet } from "../lib/providers/provider-core.ts";
import { selfRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: roadmap-parse ROADMAP_FILE [--plan-dir DIR] [--plan-file FILE]...

Emit per-STEP JSON for a roadmap markdown file. Each step object contains:
  step, phase, title, status, issues[], progress {done,total,pct}|null,
  dependencies[], plan_file (when plan data matched)

status is the step's **Status** line as written in the roadmap, passed through
unchanged; this tool does not compute or recompute status (reconciling it with
issue and PR state is the update-roadmap skill's job).

Options:
    --plan-dir DIR    Directory of plan files (.local-artifacts) scanned for
                      STEP-NN backlinks in their headers
    --plan-file FILE  Specific plan file to match (repeatable)
    --org ORG         Default org for bare/repo-relative issue refs
    --repo REPO       Default repo for bare #N refs
    -h, --help        Show this help message
    -v, --version     Show version and exit

Exit codes:
    0 parsed OK
    2 invalid arguments / unreadable roadmap`);
  process.exit(0);
}

interface StepRec {
  step: string; phase: string; title: string; status: string;
  issues: string[];
  progress: { done: number; total: number; pct: string } | null;
  dependencies: string[]; plan_file: string | null;
}

// --- argv ---

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();
if (argv.includes("-v") || argv.includes("--version")) {
  console.log("1.0.0");
  process.exit(0);
}

let roadmap = "";
let defaultOrg = "";
let defaultRepo = "";
const planFiles: string[] = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  if (a === "--plan-dir" || a === "--plan-file" || a === "--org" || a === "--repo") {
    const v = argv[i + 1];
    if (v === undefined) invalidArgs(`Missing value for ${a}`);
    if (a === "--plan-dir") {
      if (existsSync(v as string)) {
        for (const e of readdirSync(v as string)) {
          if (e.endsWith(".md")) planFiles.push(join(v as string, e));
        }
      }
    } else if (a === "--plan-file") {
      planFiles.push(v as string);
    } else if (a === "--org") {
      defaultOrg = v as string;
    } else {
      defaultRepo = v as string;
    }
    i++;
  } else if (a.startsWith("--")) {
    invalidArgs(`Unknown option: ${a}`);
  } else {
    if (roadmap !== "") invalidArgs("Multiple roadmap files given");
    roadmap = a;
  }
}

if (roadmap === "") invalidArgs("ROADMAP_FILE is required");
if (!existsSync(roadmap)) invalidArgs(`Roadmap file not found: ${roadmap}`);

// --- extraction (ports of the awk helpers) ---

const content = readFileSync(roadmap, "utf8");
const lines = content.split("\n");

interface RawStep { step: string; phase: string; title: string; body: string[] }
const rawSteps: RawStep[] = [];
let phase = "";
let collecting = false;

for (const line of lines) {
  if (line.startsWith("### PHASE-")) {
    phase = line.slice(4).replace(/:.*$/, "");
    collecting = false;
  } else if (line.startsWith("### STEP-")) {
    const step = line.slice(4).replace(/:.*/, "");
    const title = line.replace(/^### STEP-[0-9]+: */, "");
    rawSteps.push({ step, phase, title, body: [] });
    collecting = true;
  } else if (collecting && rawSteps.length > 0) {
    if (line.startsWith("### ") || line === "---") {
      collecting = false;
      continue;
    }
    rawSteps[rawSteps.length - 1]?.body.push(line);
  }
}

function stepStatus(body: string[]): string {
  for (const line of body) {
    if (line.startsWith("**Status**")) {
      return line.replace(/^\*\*Status\*\*: */, "");
    }
  }
  return "";
}

// Issue refs in **Issues** lines: org/repo#N canonical; repo#N gets the org
// prepended; bare #N resolves via --repo or is flagged UNRESOLVED.
function stepIssues(body: string[], org: string, repo: string): string[] {
  const out: string[] = [];
  let inIssues = false;
  for (const line of body) {
    if (line.startsWith("**") && !line.startsWith("**Issues**")) inIssues = false;
    if (line.startsWith("**Issues**")) inIssues = true;
    if (!inIssues) continue;
    const re = /([A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+#[0-9]+|#[0-9]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const ref = m[0];
      if (ref.includes("/")) {
        out.push(ref);
      } else if (/^[A-Za-z0-9_.-]+#/.test(ref)) {
        out.push(`${org}/${ref}`);
      } else if (repo !== "") {
        out.push(`${org}/${repo}${ref}`);
      } else {
        out.push(`UNRESOLVED:${ref}`);
      }
    }
  }
  return out;
}

function stepDependencies(body: string[]): string[] {
  for (const line of body) {
    if (line.startsWith("**Depends on**")) {
      return line.match(/STEP-[0-9]+/g) ?? [];
    }
  }
  return [];
}

// The plan file (from candidates) whose text contains the STEP-NN backlink.
function findPlanForStep(step: string, candidates: string[]): string {
  const re = new RegExp(`(^|[^A-Za-z0-9-])${step}([^A-Za-z0-9-]|$)`);
  for (const pf of candidates) {
    if (!existsSync(pf)) continue;
    if (re.test(readFileSync(pf, "utf8"))) return pf;
  }
  return "";
}

// Progress fragment via the plan-parse tool (stub-dispatched in tests, so
// shelling out preserves the seam the same way bash did).
function planProgress(plan: string): { done: number; total: number; pct: string } | null {
  const planParse = process.env.DEVENV_TOOLS
    ? join(process.env.DEVENV_TOOLS, "plan-parse")
    : join(selfRoot(process.cwd()), "tools", "plan-parse");
  const r = spawnSync("bash", [planParse, plan, "--summary"], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return null;
  try {
    const j = JSON.parse(r.stdout) as Record<string, unknown>;
    const total = Number(j.tasks_total ?? 0);
    if (!(total > 0)) return null;
    return {
      done: Number(j.tasks_done ?? 0),
      total,
      pct: String(j.pct_tasks ?? "0"),
    };
  } catch {
    return null;
  }
}

// --- default org resolution ---

if (defaultOrg === "") defaultOrg = providerOrgGet();
if (defaultOrg === "") {
  defaultOrg = content.match(/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[0-9]+/)?.[0].split("/")[0] ?? "";
}
if (defaultOrg === "") defaultOrg = "org";

// --- assemble ---

const steps: StepRec[] = rawSteps.map((raw) => {
  const issues = stepIssues(raw.body, defaultOrg, defaultRepo);
  const deps = stepDependencies(raw.body);
  const planFile = planFiles.length > 0 ? findPlanForStep(raw.step, planFiles) : "";
  const progress = planFile !== "" ? planProgress(planFile) : null;
  return {
    step: raw.step,
    phase: raw.phase,
    title: raw.title,
    status: stepStatus(raw.body),
    issues,
    progress,
    dependencies: deps,
    plan_file: planFile === "" ? null : planFile,
  };
});

console.log(JSON.stringify({ roadmap_file: roadmap, steps }, null, 2));
