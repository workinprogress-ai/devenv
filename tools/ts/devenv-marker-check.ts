// devenv-marker-check — deterministic DEVENV-marker and AC-comment scanning.
// Port of devenv-marker-check.sh: gate mode (plan-bounded FIXME markers),
// --all audit, --ac / --todo-report finders, --marker REGEX custom scan,
// --require, --no-exclude, --include-copilot.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";
import { invalidArgs } from "../lib/core/args.ts";
import { logError, logWarn } from "../lib/core/logging.ts";

assertNodeFloor();

const EXCLUDE_DIRS = new Set(["cache", "node_modules", ".git", "repos"]);

function usage(): never {
  console.log(`Usage: devenv-marker-check [PATH...] [OPTIONS]

Deterministic marker scanning for DEVENV workflows.

Default (gate mode): fail (exit 1) when any plan-bounded FIXME:DEVENV[ (or paren-form FIXME(DEVENV[
marker remains under the scanned paths — cross-plan TODO:DEVENV[ markers
are sanctioned to ship and do not block. Print each hit as
file:line:match.

Options:
    --all                        Audit mode: report ALL DEVENV markers
                                 (FIXME, TODO, and bare/malformed
                                 forms) instead of FIXME-only; same exit
                                 semantics as the gate.
    --ac                         Finder mode: list [AC-N] DEVENV comments with
                                 file:line:match; exit 0 regardless (the AC
                                 comment remains until the referenced plan
                                 phase completes).
    --todo-report                Finder mode: list scoped TODO:DEVENV[ markers
                                 with file:line:match; exit 0 regardless.
    --marker REGEX               Custom scan: fail when any line matches
                                 REGEX (with --require: fail when none does)
    --require                    Invert --marker: at least one match required
    --no-exclude                 Scan excluded dirs too (cache, node_modules,
                                 .git, repos) — for exhaustive audits
    --include-copilot            Gate/audit modes: also scan copilot/ (devenv's own
                                 example markers live there; copilot/ is always
                                 scanned by --todo-report and --ac)
    -V, --verbose                Verbose logs
    -h, --help                   Show help and exit
    -v, --version                Show version and exit

Exit Codes:
    0 gate passed (no markers) / finder mode done / --require satisfied
    1 gate failed (markers found) or --require not satisfied
    2 invalid arguments`);
  process.exit(0);
}

// Walk a path, honoring the exclusion set unless --no-exclude. copilot/ is
// excluded in gate/audit modes unless --include-copilot (the bash grep
// --exclude-dir contract).
function walk(root: string, noExclude: boolean, skipCopilot: boolean, out: string[]): void {
  const st = statSync(root, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isFile()) { out.push(root); return; }
  const base = root.split("/").pop() ?? "";
  if (!noExclude && EXCLUDE_DIRS.has(base)) return;
  if (!noExclude && skipCopilot && base === "copilot") return;
  for (const entry of readdirSync(root)) {
    walk(join(root, entry), noExclude, skipCopilot, out);
  }
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();
if (argv.includes("-v") || argv.includes("--version")) {
  console.log("1.0.0");
  process.exit(0);
}

let acMode = false, todoReport = false, allMarkers = false, require = false;
let noExclude = false, includeCopilot = false;
let marker = "";
let customMarker = false;
const paths: string[] = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  if (a === "--ac") acMode = true;
  else if (a === "--todo-report") todoReport = true;
  else if (a === "--all") allMarkers = true;
  else if (a === "--marker") {
    const v = argv[i + 1];
    if (v === undefined) invalidArgs("Missing value for --marker");
    marker = v as string;
    customMarker = true;
    i++;
  } else if (a === "--require") require = true;
  else if (a === "--no-exclude") noExclude = true;
  else if (a === "--include-copilot") includeCopilot = true;
  else if (a === "-V" || a === "--verbose") { /* verbose logs */ }
  else if (a.startsWith("--")) invalidArgs(`Unknown option: ${a}`);
  else paths.push(a);
}

if (paths.length === 0) paths.push(".");
for (const p of paths) {
  if (!existsSync(p)) invalidArgs(`Path not found: ${p}`);
}
if (acMode && todoReport) invalidArgs("--ac and --todo-report are mutually exclusive");
if (allMarkers && (acMode || todoReport)) {
  invalidArgs("--all is a gate-mode option; it cannot be combined with --ac or --todo-report");
}

let regex: string;
if (acMode) regex = "\\[AC-[0-9]+";
else if (todoReport) {
  // surface scoped TODOs in the canonical colon form AND paren-form
  // entries so off-spec forms cannot hide from the discovery rule
  regex = "TODO:?(\\(DEVENV|:DEVENV\\[)";
} else if (allMarkers) {
  regex = "((FIXME|TODO):?(\\(DEVENV|:DEVENV\\[)|DEVENV\\[)";
} else if (customMarker) {
  regex = marker;
} else {
  // PR-blocking gate: plan-bounded FIXME markers only (colon form canonical,
  // paren form detected) — cross-plan TODOs must not block.
  regex = "FIXME:?(\\(DEVENV|:DEVENV\\[)";
}

const files: string[] = [];
for (const p of paths) {
  // copilot/ carries example markers by design: excluded from the gate and
  // audit modes unless --include-copilot; --todo-report and --ac always scan it.
  const skipCopilot = !includeCopilot && !todoReport && !acMode;
  walk(p, noExclude, skipCopilot, files);
}

const re = new RegExp(regex);
type Hit = { file: string; line: number; text: string };
const hits: Hit[] = [];
for (const f of files) {
  try {
    const lines = readFileSync(f, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i] as string)) {
        hits.push({ file: f, line: i + 1, text: lines[i] as string });
      }
    }
  } catch { /* unreadable (binary etc.) — grep also skipped them */ }
}

for (const h of hits) console.log(`${h.file}:${h.line}:${h.text}`);

if (acMode) {
  if (hits.length === 0) console.log(`No AC comments found under: ${paths.join(" ")}`);
  process.exit(0);
}

if (todoReport) {
  if (hits.length === 0) {
    console.log(`No scoped TODO(DEVENV markers found under: ${paths.join(" ")}`);
    process.exit(0);
  }
  const missing = hits.filter((h) => !/remove when .{1,}/.test(h.text)).length;
  const malformed = hits.filter((h) => !/TODO:?\(DEVENV\[|TODO:DEVENV\[/.test(h.text)).length;
  if (malformed > 0) {
    logWarn(`${malformed} malformed TODO entry(ies) without a plan key found (paren form or no key) — plan keys are mandatory; fix or convert to TODO:DEVENV[key]: ...`);
  }
  if (missing > 0) {
    logWarn(`${missing} of ${hits.length} scoped TODO(s) missing a discharge condition ('remove when ...') — condition-less TODOs are defects per the marker spec; resolve with the user`);
  }
  process.exit(0);
}

if (require) {
  if (hits.length === 0) {
    logError(`Required marker '${marker}' not found under: ${paths.join(" ")}`);
    process.exit(1);
  }
  process.exit(0);
}

if (hits.length > 0) {
  if (customMarker) {
    logError(`${hits.length} marker(s) matching '${marker}' found — remove them before completion`);
  } else {
    logError(`${hits.length} plan-bounded FIXME marker(s) found — remove or convert to TODO:DEVENV[key]: with a discharge condition before completing the phase`);
  }
  process.exit(EXIT_GENERAL_ERROR);
}

const relPaths = paths.map((p) => relative(process.cwd(), p) || p);
if (allMarkers) {
  console.log(`Clean: no DEVENV markers of any form under: ${relPaths.join(" ")}`);
} else {
  console.log(`Clean: no FIXME(DEVENV markers under: ${relPaths.join(" ")} (use --all to audit TODO/bare forms)`);
}
process.exit(0);
