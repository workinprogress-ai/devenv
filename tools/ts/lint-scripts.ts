// lint-scripts — run shellcheck on all shell scripts in the project.
// Port of lint-scripts.sh. Scope: *.sh/*.bash files plus extensionless files
// with a shell shebang, excluding vendored/scratch trees; repos/ clones are
// skipped but top-level scripts directly under repos/ are included.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { selfRoot } from "../lib/core/self-root.ts";
import { logError } from "../lib/core/logging.ts";

assertNodeFloor();

const projectRoot = process.env["PROJECT_ROOT"] ?? selfRoot(import.meta.url);

let severity = process.env["SHELLCHECK_SEVERITY"] ?? "warning";
let outputFormat = process.env["OUTPUT_FORMAT"] ?? "tty";
let quiet = false;
let noColor = false;
let searchDir = projectRoot;

function usage(): never {
  console.log(`Usage: lint-scripts [OPTIONS]

Run shellcheck on all shell scripts in the project.

Options:
    -h, --help          Show this help message
    -v, --version       Show version information
    -f, --format FMT    Output format: tty, json, gcc, checkstyle (default: tty)
    -s, --severity LVL  Minimum severity: error, warning, info, style (default: warning)
    -q, --quiet         Only show failures
    -d, --dir DIR       Directory to scan (default: project root)
    --fix               Show suggestions for auto-fixable issues
    --no-color          Disable colored output

Exit Codes:
    0   All scripts passed
    1   One or more scripts failed
    2   Invalid arguments or shellcheck not found`);
  process.exit(0);
}

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  switch (a) {
    case "-h":
    case "--help":
      usage();
      break;
    case "-v":
    case "--version":
      console.log("1.0.0");
      process.exit(0);
      break;
    case "-f":
    case "--format":
      outputFormat = argv[++i] ?? "";
      if (!outputFormat) { logError("Missing value for --format"); process.exit(2); }
      break;
    case "-s":
    case "--severity":
      severity = argv[++i] ?? "";
      if (!severity) { logError("Missing value for --severity"); process.exit(2); }
      break;
    case "-q":
    case "--quiet":
      quiet = true;
      break;
    case "-d":
    case "--dir":
      searchDir = argv[++i] ?? "";
      if (!searchDir) { logError("Missing value for --dir"); process.exit(2); }
      break;
    case "--fix":
      // shellcheck has no autofix; the flag is accepted for contract parity.
      break;
    case "--no-color":
      noColor = true;
      break;
    default:
      logError(`Unknown option: ${a}`);
      console.log("Use --help for usage information");
      process.exit(2);
  }
}

const C = (code: string): string => (noColor ? "" : code);
const RED = C("\u001B[0;31m");
const GREEN = C("\u001B[0;32m");
const YELLOW = C("\u001B[0;33m");
const BLUE = C("\u001B[0;34m");
const NC = C("\u001B[0m");

function info(msg: string): void {
  if (!quiet) console.log(`${BLUE}ℹ${NC} ${msg}`);
}

function warn(msg: string): void {
  console.error(`${YELLOW}⚠${NC} ${msg}`);
}

if (!existsSync(searchDir) || !statSync(searchDir).isDirectory()) {
  logError(`Directory not found: ${searchDir}`);
  process.exit(2);
}

if (spawnSync("bash", ["-c", "command -v shellcheck"], { stdio: "ignore" }).status !== 0) {
  logError("shellcheck not found");
  console.log("Install with: sudo apt-get install shellcheck");
  process.exit(2);
}

// Excluded path fragments (substring match on the posix-relative path).
const EXCLUDES = [
  "node_modules/",
  ".pnpm-store/",
  ".git/",
  "/tmp/",
  ".debug/",
  ".husky/_/",
  ".devcontainer/git-completion.bash",
  "playground/",
  "tools/cache/",
];

function excluded(rel: string): boolean {
  if (rel.includes(".local-artifacts/")) return true;
  // repos/ holds clones of other repositories (not ours to lint), but the
  // scripts directly in repos/ are this workspace's own top-level infra.
  if (rel.startsWith(`repos${sep}`) && rel.includes(sep, "repos".length + 1)) return true;
  return EXCLUDES.some((e) => rel.includes(e));
}

function isShellShebang(file: string): boolean {
  try {
    const first = readFileSync(file, "utf8").split("\n", 1)[0] ?? "";
    return /^#!.*sh/.test(first) && !/^#!.*zsh/.test(first);
  } catch {
    return false;
  }
}

function collectScripts(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      const rel = relative(searchDir, full);
      if (e.isDirectory()) {
        if (!excluded(`${rel}${sep}`)) walk(full);
        continue;
      }
      if (!e.isFile()) continue;
      if (excluded(rel)) continue;
      if (e.name.endsWith(".sh") || e.name.endsWith(".bash")) {
        out.push(full);
      } else if (!e.name.includes(".") && isShellShebang(full)) {
        // Extensionless scripts (the git-* tools, the root setup) with a shell
        // shebang are shellchecked; a file with no shell shebang is not.
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

info(`Scanning for shell scripts in: ${searchDir}`);
info(`Severity level: ${severity}`);
info(`Output format: ${outputFormat}`);
console.log("");

const scripts = collectScripts(searchDir);
if (scripts.length === 0) {
  warn("No shell scripts found");
  process.exit(0);
}

let passed = 0;
let failed = 0;
let skipped = 0;

for (const script of scripts) {
  const relPath = relative(projectRoot, script);

  // Skip zsh scripts — shellcheck does not support zsh.
  if (/^#!.*zsh/.test(readFileSync(script, "utf8").split("\n", 1)[0] ?? "")) {
    if (!quiet) warn(`Skipping: ${relPath} (zsh script, not supported by shellcheck)`);
    skipped++;
    continue;
  }

  if (!quiet) process.stdout.write(`Checking: ${relPath} ... `);

  const args = ["-x", "-S", severity, script];
  if (outputFormat !== "tty") args.push("-f", outputFormat);
  const r = spawnSync("shellcheck", args, { encoding: "utf8" });
  const output = (r.stdout ?? "") + (r.stderr ?? "");

  if (r.status === 0) {
    if (!quiet) console.log(`${GREEN}✓${NC}`);
    passed++;
  } else {
    if (!quiet) {
      console.log(`${RED}✗${NC}`);
      process.stdout.write(output);
    } else {
      logError(`Failed: ${relPath}`);
    }
    failed++;
  }
}

if (outputFormat === "tty") {
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Shellcheck Summary");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Total files:   ${scripts.length}`);
  console.log(`${GREEN}Passed:        ${passed}${NC}`);
  if (failed > 0) console.log(`${RED}Failed:        ${failed}${NC}`);
  else console.log(`Failed:        ${failed}`);
  if (skipped > 0) console.log(`${YELLOW}Skipped:       ${skipped}${NC}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

process.exit(failed > 0 ? 1 : 0);
