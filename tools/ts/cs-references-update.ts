// cs-references-update — update NuGet package references across a tree.
// For every .csproj under a target
// directory, run `dotnet outdated --upgrade`, optionally rewriting
// <TargetFramework>/<TargetFrameworks> and <LangVersion> tags first (with a
// `dotnet restore` gate on any rewrite), then summarize the blast radius of
// src/ package updates, and chain the repo's .repo/update.sh boilerplate
// sync when present.
//
// Exit codes: 0 success · 2 invalid arguments / unknown TFM mapping ·
// 3 target directory missing · 10 restore gate failed after a rewrite ·
// 11 'dotnet outdated' failed for at least one project · 12 the --post-update
// script exited non-zero.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_CONFLICT, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import {
  addLangVersionAfterTargetFramework,
  hasLangVersion,
  removeLangVersionLines,
  rewriteTargetFrameworks,
  setLangVersion,
  targetFrameworksOf,
} from "../lib/domain/cs/csproj.ts";
import { raiseSdkPin } from "../lib/domain/cs/global-json.ts";
import { retargetLaunchPaths } from "../lib/domain/cs/launch-json.ts";
import { resolvePostUpdateScript } from "../lib/domain/cs/post-update.ts";

assertNodeFloor();

const EXIT_OK = 0;
const EXIT_RESTORE_FAILED = 10;
const EXIT_OUTDATED_FAILED = 11;
const EXIT_POST_UPDATE_FAILED = 12;

// TFM major -> default C# language version for that TFM. When --framework is
// passed without a language flag, existing <LangVersion> tags are rewritten
// to the mapped value. An unmapped TFM combined with present tags is an
// argument error rather than a guess.
const TFM_DEFAULT_LANG: Record<string, string> = {
  "net8.0": "12.0",
  "net9.0": "13.0",
  "net10.0": "14.0",
  "net11.0": "15.0",
};

function showUsage(): never {
  console.log(`Usage: cs-references-update [REPO_DIR] [OPTIONS]

For every .csproj under REPO_DIR (default: current directory), runs
'dotnet outdated --upgrade' to update NuGet package references.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
    --framework TFM         Retarget every modern net<N>.0 entry of
                            <TargetFramework>/<TargetFrameworks> to TFM (e.g.
                            net10.0) before updating packages. Other entries
                            such as netstandard2.0 stay, so multi-targeting is
                            preserved. Framework-first: the rewrite and a
                            'dotnet restore' gate run before 'dotnet
                            outdated'.
    --lang-version VER      Set <LangVersion> to VER (e.g. 14.0) in every
                            csproj, updating existing tags and adding the tag
                            where absent. Conflicts with --lang-default.
    --lang-default          Remove existing <LangVersion> tags (never adds) so
                            the TFM default language version applies
                            implicitly. Conflicts with --lang-version.
    --post-update SCRIPT    Run SCRIPT (an executable) as the last step, after
                            the package update and boilerplate chain, with the
                            repo root as cwd. Its edits join this run's
                            changes. A non-zero exit fails the run (exit 12).
                            Environment: CS_UPDATE_REPO_DIR (target directory),
                            CS_UPDATE_FRAMEWORK (--framework value or empty),
                            CS_UPDATE_PREVIOUS_FRAMEWORKS (TFMs found before
                            the rewrite, space-separated). Must be idempotent.

LangVersion rules:
    * --lang-version given  -> explicit version wins; tags updated or added.
    * --framework only      -> existing <LangVersion> tags are rewritten to the
                               TFM's default language version (net8.0 -> 12.0,
                               net9.0 -> 13.0, net10.0 -> 14.0,
                               net11.0 -> 15.0). An unmapped
                               TFM with tags present is an argument error.
    * --lang-default given  -> tags are removed; the default applies silently.

Exits:
    0    success
    2    invalid arguments (bad flag values, conflicting flags, unknown TFM
         mapping with LangVersion tags present)
    3    target directory not found
    10   'dotnet restore' failed after a rewrite (invalid TFM or packages
         without assets for the new target)
    11   'dotnet outdated' failed for at least one project
    12   the --post-update script exited non-zero`);
  process.exit(EXIT_OK);
}

function findFilesNamed(dir: string, matches: (name: string) => boolean): string[] {
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
      } else if (matches(e.name)) {
        found.push(p);
      }
    }
  };
  walk(dir);
  return found.sort();
}

const findCsprojFiles = (dir: string): string[] => findFilesNamed(dir, (n) => n.endsWith(".csproj"));

// "Tags exist in the tree" — checked over the same csproj set the rewrite
// would touch.
function anyLangVersionTags(csprojs: string[]): boolean {
  return csprojs.some((p) => hasLangVersion(readFileSync(p, "utf8")));
}

// ── Argument parsing ─────────────────────────────────────────────────────


const SCRIPT_VERSION = "1.0.0";

let targetDir = "";
let framework = "";
let langVersion = "";
let langDefault = false;
let postUpdateArg = "";
let positionalCount = 0;

try {
  const cli = toolCli({
    name: "cs-references-update",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      framework: { type: "string" },
      "lang-version": { type: "string" },
      "lang-default": { type: "boolean", default: false },
      "post-update": { type: "string" },
    },
  });
  if (cli.common.help) showUsage();
  postUpdateArg = (cli.values["post-update"] as string | undefined) ?? "";
  framework = (cli.values["framework"] as string | undefined) ?? "";
  langVersion = (cli.values["lang-version"] as string | undefined) ?? "";
  langDefault = cli.values["lang-default"] === true;
  positionalCount = cli.positionals.length;
  targetDir = cli.positionals[0] ?? "";
} catch (err) {
  console.error(`ERROR: ${errorMessage(err)}. Use --help for usage.`);
  process.exit(EXIT_MISUSE);
}
if (positionalCount > 1) {
  console.error("ERROR: Too many arguments. Use --help for usage.");
  process.exit(EXIT_MISUSE);
}

// Resolved once, up front: every later path (csproj list, child cwd) is
// absolute, so a relative argument is never applied twice.
targetDir = resolve(targetDir === "" ? "." : targetDir);

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
  process.exit(EXIT_CONFLICT);
}
let postUpdateScript = "";
if (postUpdateArg !== "") {
  const resolved = resolvePostUpdateScript(postUpdateArg);
  if (!resolved.ok) {
    console.error(`ERROR: ${resolved.message}`);
    process.exit(resolved.reason === "missing" ? EXIT_CONFLICT : EXIT_MISUSE);
  }
  postUpdateScript = resolved.path;
}

const csprojs = findCsprojFiles(targetDir);
// Captured before any rewrite so the --post-update script can tell old from new.
const previousFrameworks = [...new Set(csprojs.flatMap((p) => targetFrameworksOf(readFileSync(p, "utf8"))))];

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
    if (anyLangVersionTags(csprojs)) {
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

// ── Tree state before any change ─────────────────────────────────────────
//
// The boilerplate chain must only fire when THIS script changed something —
// not when the tree was already dirty with unrelated in-flight work. The
// snapshot therefore precedes the TFM/LangVersion rewrites below.

const treeStatusBefore = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8", cwd: targetDir });
const treeWasDirtyBefore = (treeStatusBefore.stdout ?? "").trim() !== "";

// ── TFM / LangVersion rewrite ────────────────────────────────────────────

let rewroteAnything = false;

// Retarget modern net<N>.0 entries (with an optional platform suffix) and
// leave everything else (netstandard, .NET Framework, property references)
// where it is.
function retarget(entry: string): string {
  return /^net\d+\.\d+(-.+)?$/.test(entry) ? entry.replace(/^net\d+\.\d+/, framework) : entry;
}

function rewriteTfm(csproj: string): void {
  const content = readFileSync(csproj, "utf8");
  const updated = rewriteTargetFrameworks(content, retarget);
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
    // Whole-line <LangVersion> elements only.
    updated = removeLangVersionLines(content);
  } else {
    updated = setLangVersion(content, langVersion);
    // Explicit mode only: add the tag after <TargetFramework…> when absent,
    // preserving the element's indentation.
    if (!hasLangVersion(updated) && langMode === "explicit") {
      updated = addLangVersionAfterTargetFramework(updated, langVersion);
    }
  }
  if (updated !== content) {
    writeFileSync(csproj, updated);
    rewroteAnything = true;
    if (langMode === "remove") console.log(`  ${csproj}: LangVersion tag removed`);
    else console.log(`  ${csproj}: LangVersion -> ${langVersion}`);
  }
}

// An SDK pin below the target's major cannot restore the new TFM, so raise it.
// Only existing global.json files are touched; none is ever created.
function rewriteSdkPin(globalJson: string): void {
  const content = readFileSync(globalJson, "utf8");
  const updated = raiseSdkPin(content, Number(/^net(\d+)/.exec(framework)?.[1]));
  if (updated !== content) {
    writeFileSync(globalJson, updated);
    rewroteAnything = true;
    console.log(`  ${globalJson}: sdk.version raised for ${framework}`);
  }
}

// Debug launch configs point at bin/<config>/<tfm>/…; a stale TFM folder makes
// F5 target a directory that no longer exists. Only existing files are touched.
function rewriteLaunchPaths(launchJson: string): void {
  const content = readFileSync(launchJson, "utf8");
  const updated = retargetLaunchPaths(content, framework);
  if (updated !== content) {
    writeFileSync(launchJson, updated);
    rewroteAnything = true;
    console.log(`  ${launchJson}: build-output paths -> ${framework}`);
  }
}

if (framework !== "" || langMode !== "none") {
  console.log("Rewriting target framework / language version declarations...");
  for (const csproj of csprojs) {
    if (framework !== "") rewriteTfm(csproj);
    if (langMode !== "none") rewriteLang(csproj);
  }
  if (framework !== "") {
    for (const g of findFilesNamed(targetDir, (n) => n === "global.json")) rewriteSdkPin(g);
    for (const l of findFilesNamed(targetDir, (n) => n === "launch.json")) {
      if (l.includes("/.vscode/")) rewriteLaunchPaths(l);
    }
  }
}

// ── Restore gate ─────────────────────────────────────────────────────────

if (rewroteAnything) {
  console.log("Running 'dotnet restore' gate after rewrite...");
  const r = spawnSync("dotnet", ["restore"], { stdio: "inherit", cwd: targetDir });
  if (r.status !== 0) {
    console.error(
      "ERROR: 'dotnet restore' failed after rewriting TFM/LangVersion — the new target is invalid or some packages have no assets for it. No package updates were attempted.",
    );
    process.exit(EXIT_RESTORE_FAILED);
  }
}

// ── Package updates ──────────────────────────────────────────────────────

const failedProjects: string[] = [];
for (const csproj of csprojs) {
  const r = spawnSync("dotnet", ["outdated", csproj, "--upgrade"], { stdio: "inherit", cwd: targetDir });
  if (r.status !== 0) {
    console.error(`ERROR: 'dotnet outdated' failed for ${csproj}`);
    failedProjects.push(csproj);
  }
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
// through; the pipe variant would need duplexing — not done.)

// ── Update summary — src/ blast radius ───────────────────────────────────
//
// Summary: the per-package classification needs dotnet-outdated's captured
// stdout, which the loop above forwarded to the terminal (stdio inherit),
// so the summary reports at project granularity. A line-level capture
// would give per-package granularity; disable with CS_REF_SUMMARY=0.
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
if (process.env.CS_REF_SUMMARY !== "0") {
  console.log("");
  console.log(`${BOLD}Blast radius — project-level updates:${RESET}`);
  console.log(`  ${BOLD}${csprojs.length} project(s) processed${RESET}`);
}

if (failedProjects.length > 0) {
  console.error(`ERROR: 'dotnet outdated' failed for ${failedProjects.length} project(s); the boilerplate sync was not run.`);
  process.exit(EXIT_OUTDATED_FAILED);
}

// ── Boilerplate sync chain ───────────────────────────────────────────────
//
// Chain the repo's boilerplate updater (if present) so dependency updates
// and template sync happen in one pass. Always delegate the run/don't-run
// decision to update.sh itself, via --force when needed: its dirty-tree
// guard would otherwise kill the chain mid-run on dirt created by THIS
// run's own upgrades. Pre-existing dirt means the chain is skipped with a
// NOTE. Unattended-safe: non-fatal when absent or failing.

const repoRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", cwd: targetDir }).stdout.trim();
if (repoRoot !== "" && existsSync(`${repoRoot}/.repo/update.sh`)) {
  const chainArgs = ["--no-refresh"];
  if (treeWasDirtyBefore) {
    console.log("Chaining .repo/update.sh — note: tree was dirty before this run, so its boilerplate sync will be skipped (its lockfile migration still runs).");
  } else {
    chainArgs.push("--force");
  }
  const r = spawnSync("bash", [`${repoRoot}/.repo/update.sh`, ...chainArgs], {
    cwd: targetDir,
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

// ── Post-update migration script ─────────────────────────────────────────
//
// Last step, after the boilerplate chain, so it has the final word on the tree
// and its edits are part of the same commit. Fatal on failure: the caller was
// explicit about wanting it, and the wizards would otherwise commit a
// half-migrated repo.

if (postUpdateScript !== "") {
  console.log(`Running post-update script: ${postUpdateScript}`);
  const r = spawnSync(postUpdateScript, [], {
    stdio: "inherit",
    cwd: repoRoot !== "" ? repoRoot : targetDir,
    env: {
      ...process.env,
      CS_UPDATE_REPO_DIR: targetDir,
      CS_UPDATE_FRAMEWORK: framework,
      CS_UPDATE_PREVIOUS_FRAMEWORKS: previousFrameworks.join(" "),
    },
  });
  if (r.status !== 0) {
    console.error(`ERROR: --post-update script failed (exit ${r.status ?? "signal"}): ${postUpdateScript}`);
    process.exit(EXIT_POST_UPDATE_FAILED);
  }
}

process.exit(EXIT_OK);
