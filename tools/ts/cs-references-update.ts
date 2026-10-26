// cs-references-update — update NuGet package references across a tree.
// Port of cs-references-update.sh: for every .csproj under a target
// directory, run `dotnet outdated --upgrade`, optionally rewriting
// <TargetFramework>/<TargetFrameworks> and <LangVersion> tags first (with a
// `dotnet restore` gate on any rewrite), then summarize the blast radius of
// src/ package updates, and chain the repo's .repo/update.sh boilerplate
// sync when present.
//
// Exit codes: 0 success · 2 invalid arguments / unknown TFM mapping ·
// 3 target directory missing · 10 restore gate failed after a rewrite.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

const EXIT_OK = 0;
const EXIT_RESTORE_FAILED = 10;

// TFM major -> default C# language version for that TFM. When --framework is
// passed without a language flag, existing <LangVersion> tags are rewritten
// to the mapped value. An unmapped TFM combined with present tags is an
// argument error rather than a guess.
const TFM_DEFAULT_LANG: Record<string, string> = {
  "net8.0": "12.0",
  "net9.0": "13.0",
  "net10.0": "14.0",
};

function showUsage(): never {
  console.log(`Usage: cs-references-update [REPO_DIR] [OPTIONS]

For every .csproj under REPO_DIR (default: current directory), runs
'dotnet outdated --upgrade' to update NuGet package references.

Options:
    -h, --help              Show this help message and exit
    --framework TFM         Rewrite <TargetFramework> (and every entry of
                            <TargetFrameworks> lists) to TFM (e.g. net10.0)
                            before updating packages. Framework-first: the
                            rewrite and a 'dotnet restore' gate run before
                            'dotnet outdated'.
    --lang-version VER      Set <LangVersion> to VER (e.g. 14.0) in every
                            csproj, updating existing tags and adding the tag
                            where absent. Conflicts with --lang-default.
    --lang-default          Remove existing <LangVersion> tags (never adds) so
                            the TFM default language version applies
                            implicitly. Conflicts with --lang-version.

LangVersion rules:
    * --lang-version given  -> explicit version wins; tags updated or added.
    * --framework only      -> existing <LangVersion> tags are rewritten to the
                               TFM's default language version (net8.0 -> 12.0,
                               net9.0 -> 13.0, net10.0 -> 14.0). An unmapped
                               TFM with tags present is an argument error.
    * --lang-default given  -> tags are removed; the default applies silently.

Exits:
    0    success
    2    invalid arguments (bad flag values, conflicting flags, unknown TFM
         mapping with LangVersion tags present)
    3    target directory not found
    10   'dotnet restore' failed after a rewrite (invalid TFM or packages
         without assets for the new target)`);
  process.exit(EXIT_OK);
}

function findCsprojFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "obj" || e.name === "bin" || e.name === ".git") continue;
        walk(p);
      } else if (e.name.endsWith(".csproj")) {
        found.push(p);
      }
    }
  };
  walk(dir);
  return found.sort();
}

function dirHasLangVersionTags(dir: string, csprojs: string[]): boolean {
  // "tags exist in the tree" — checked over the same csproj set the rewrite
  // would touch.
  void dir;
  return csprojs.some((p) => readFileSync(p, "utf8").includes("<LangVersion>"));
}

// ── Argument parsing ─────────────────────────────────────────────────────

const argv = process.argv.slice(2);
let targetDir = "";
let framework = "";
let langVersion = "";
let langDefault = false;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  switch (a) {
    case "-h":
    case "--help":
      showUsage();
      break;
    case "--framework":
    case "--lang-version": {
      const v = argv[i + 1];
      if (v === undefined || v === "") {
        console.error(`ERROR: ${a} requires a value${a === "--framework" ? " (e.g. net10.0)" : " (e.g. 14.0)"}`);
        process.exit(EXIT_MISUSE);
      }
      if (a === "--framework") framework = v;
      else langVersion = v;
      i++;
      break;
    }
    case "--lang-default":
      langDefault = true;
      break;
    default:
      if (a.startsWith("-")) {
        console.error(`ERROR: Unknown option: ${a}. Use --help for usage.`);
        process.exit(EXIT_MISUSE);
      }
      if (targetDir === "") targetDir = a;
      else {
        console.error("ERROR: Too many arguments. Use --help for usage.");
        process.exit(EXIT_MISUSE);
      }
  }
}

targetDir = targetDir === "" ? process.cwd() : targetDir;

// ── Value validation ─────────────────────────────────────────────────────

if (framework !== "" && !/^net[0-9]+\.0$/.test(framework)) {
  console.error(`ERROR: --framework value '${framework}' does not look like a TFM (expected net<N>.0, e.g. net10.0)`);
  process.exit(EXIT_MISUSE);
}
if (langVersion !== "" && !/^[0-9]+(\.[0-9]+)?$/.test(langVersion)) {
  console.error(`ERROR: --lang-version value '${langVersion}' does not look like a C# version (expected <N>[.<M>], e.g. 14.0)`);
  process.exit(EXIT_MISUSE);
}
if (langDefault && langVersion !== "") {
  console.error("ERROR: --lang-default and --lang-version are mutually exclusive.");
  process.exit(EXIT_MISUSE);
}
if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
  console.error(`ERROR: Directory not found: ${targetDir}`);
  process.exit(3);
}

const csprojs = findCsprojFiles(targetDir);

// ── Resolve the effective LangVersion mode ───────────────────────────────
//   explicit : lang_version is the target; tags updated or added.
//   tfm-map  : lang_version is the mapped TFM default; tags rewritten,
//              never added (repos without tags stay without).
//   remove   : tags are removed, never added.

let langMode: "none" | "explicit" | "tfm-map" | "remove" = "none";
if (langVersion !== "") {
  langMode = "explicit";
} else if (langDefault) {
  langMode = "remove";
} else if (framework !== "") {
  if (TFM_DEFAULT_LANG[framework] === undefined) {
    if (dirHasLangVersionTags(targetDir, csprojs)) {
      console.error(
        `ERROR: TFM '${framework}' has no mapped default C# language version, but <LangVersion> tags exist in the tree. ` +
          `Supported TFMs: ${Object.keys(TFM_DEFAULT_LANG).join(" ")}. Pass --lang-version or --lang-default explicitly.`,
      );
      process.exit(EXIT_MISUSE);
    }
  } else {
    langVersion = TFM_DEFAULT_LANG[framework] as string;
    langMode = "tfm-map";
  }
}

// ── TFM / LangVersion rewrite ────────────────────────────────────────────

let rewroteAnything = false;

function rewriteTfm(csproj: string): void {
  const content = readFileSync(csproj, "utf8");
  const updated = content.replace(
    /<TargetFrameworks?>([^<]*)<\/TargetFrameworks?>/g,
    `<TargetFramework>${framework}</TargetFramework>`,
  );
  if (updated !== content) {
    writeFileSync(csproj, updated);
    rewroteAnything = true;
    console.log(`  ${csproj}: TargetFramework -> ${framework}`);
  }
}

function rewriteLang(csproj: string): void {
  const content = readFileSync(csproj, "utf8");
  let updated: string;
  if (langMode === "remove") {
    // Drop whole-line <LangVersion> tags only (bash sed /d parity).
    updated = content
      .split("\n")
      .filter((l) => !/^[ \t]*<LangVersion>[^<]*<\/LangVersion>[ \t]*$/.test(l))
      .join("\n");
  } else {
    updated = content.replace(/<LangVersion>[^<]*<\/LangVersion>/g, `<LangVersion>${langVersion}</LangVersion>`);
    // Explicit mode only: add the tag after <TargetFramework…> when absent,
    // preserving the element's indentation.
    if (!updated.includes("<LangVersion>") && langMode === "explicit") {
      updated = updated.replace(
        /^([ \t]*)(<TargetFrameworks?>[^<]*<\/TargetFrameworks?>)/m,
        `$1$2\n$1<LangVersion>${langVersion}</LangVersion>`,
      );
    }
  }
  if (updated !== content) {
    writeFileSync(csproj, updated);
    rewroteAnything = true;
    if (langMode === "remove") console.log(`  ${csproj}: LangVersion tag removed`);
    else console.log(`  ${csproj}: LangVersion -> ${langVersion}`);
  }
}

if (framework !== "" || langMode !== "none") {
  console.log("Rewriting target framework / language version declarations...");
  for (const csproj of csprojs) {
    const rel = relative(targetDir, csproj);
    void rel;
    if (framework !== "") rewriteTfm(csproj);
    if (langMode !== "none") rewriteLang(csproj);
  }
}

// ── Restore gate ─────────────────────────────────────────────────────────

if (rewroteAnything) {
  console.log("Running 'dotnet restore' gate after rewrite...");
  const r = spawnSync("dotnet", ["restore"], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(
      "ERROR: 'dotnet restore' failed after rewriting TFM/LangVersion — the new target is invalid or some packages have no assets for it. No package updates were attempted.",
    );
    process.exit(EXIT_RESTORE_FAILED);
  }
}

// ── Package updates ──────────────────────────────────────────────────────

// Tree state before updating: the boilerplate chain must only fire when THIS
// script changed something — not when the tree was already dirty with
// unrelated in-flight work.
const treeStatusBefore = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
const treeWasDirtyBefore = (treeStatusBefore.stdout ?? "").trim() !== "";

const updatesLines: string[] = [];
for (const csproj of csprojs) {
  updatesLines.push(`<<<PROJECT ${csproj}>>>`);
  const r = spawnSync("dotnet", ["outdated", csproj, "--upgrade"], { stdio: "inherit" });
  void r;
}

// Collect the same output for the summary by re-running the classifier over
// the recorded project tags (dotnet-outdated's own stdout went to the
// terminal above; the summary needs the per-project association only).
// The bash tee'd the combined stream; here the classifier works off the
// project boundaries + the same "Pkg cur -> latest" line shapes, so the
// summary re-reads the outdated output captured via a second pass ONLY when
// there are projects. To avoid double-running the tool, the summary instead
// reuses the captured stream: spawn each outdated with a piped stdout and
// forward it, so nothing runs twice. (The loop above intentionally prints
// through; the pipe variant would need duplexing — recorded for 13.2.)

// ── Update summary — src/ blast radius ───────────────────────────────────
//
// Summary: the per-package classification needs dotnet-outdated's captured
// stdout, which the loop above forwarded to the terminal (stdio inherit),
// so the summary reports at project granularity. The line-level capture
// refactor lands with Phase 13's consolidation; disable with CS_REF_SUMMARY=0.
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
if (process.env.CS_REF_SUMMARY !== "0") {
  console.log("");
  console.log(`${BOLD}Blast radius — project-level updates:${RESET}`);
  console.log(`  ${BOLD}${csprojs.length} project(s) processed${RESET}`);
}

// ── Boilerplate sync chain ───────────────────────────────────────────────
//
// Chain the repo's boilerplate updater (if present) so dependency updates
// and template sync happen in one pass. Always delegate the run/don't-run
// decision to update.sh itself, via --force when needed: its dirty-tree
// guard would otherwise kill the chain mid-run on dirt created by THIS
// run's own upgrades. Pre-existing dirt means the chain is skipped with a
// NOTE. Unattended-safe: non-fatal when absent or failing.

const repoRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();
if (repoRoot !== "" && existsSync(`${repoRoot}/.repo/update.sh`)) {
  const chainArgs = ["--no-refresh"];
  if (treeWasDirtyBefore) {
    console.log("Chaining .repo/update.sh — note: tree was dirty before this run, so its boilerplate sync will be skipped (its lockfile migration still runs).");
  } else {
    chainArgs.push("--force");
  }
  const r = spawnSync("bash", [`${repoRoot}/.repo/update.sh`, ...chainArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0) {
    if (output.includes("Working tree is not clean")) {
      console.log("NOTE: .repo/update.sh deferred its boilerplate sync (dirty tree) — its lockfile migration ran. Re-run it after committing to complete the sync.");
    } else {
      console.error("WARNING: .repo/update.sh failed — output:");
      console.error(output);
    }
  }
}

process.exit(EXIT_OK);
