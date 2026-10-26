#!/usr/bin/env node
// setup-first-run.ts — the provisioning half of the bootstrap chain, as a
// non-interactive TypeScript tool.
//
// Handoff contract (from the slim bash bootstrap): every step is idempotent,
// individually callable, and strictly non-interactive; `--all` runs them in
// the historical bootstrap order. Fork bootstraps and CI run this unattended.
// Steps source tools/lib/provision.bash (the provisioning library) and
// invoke its functions — this tool orchestrates, it does not re-implement.
// Function-by-function the library retires as steps port to TS in the
// migration's cleanup phase.
//
// Degraded path: when node itself is absent the slim bootstrap prints the
// manual recovery instructions — this tool never runs in that world.

import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logInfo, logError } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";

assertNodeFloor();

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = dirname(HERE);
const ROOT = dirname(TOOLS);
const PROVISION_LIB = join(TOOLS, "lib", "provision.bash");

/** The toolbox root the steps operate on. Defaults to this checkout (the
 * bootstrap resolves toolbox_root from its own location the same way).
 * DEVENV_TOOLBOX_ROOT overrides it for tests and cross-checkout runs; the
 * bootstrap never sets it. */
const toolboxRoot = process.env.DEVENV_TOOLBOX_ROOT || ROOT;

interface Step {
  name: string;
  description: string;
  /** The bash function invoked via the bridge library (single source of truth). */
  fn: string;
}

// The provisioning steps, in the historical bootstrap order (the slim chain's
// task list after the TS-side minimum). Each is idempotent in the bridge lib.
const STEPS: Step[] = [
  { name: "credentials", description: "load .setup credentials into the provider credential store", fn: "load_setup_credentials" },
  { name: "bash-functions", description: "write the shared bash functions file (shell aliases + helpers)", fn: "write_bash_functions_file" },
  { name: "env-vars", description: "generate env-vars.sh from .setup configuration", fn: "generate_env_vars_file" },
  { name: "tool-symlinks", description: "create depth-1 tool entry symlinks", fn: "create_tool_symlinks" },
  { name: "devenvrc", description: "write the shared ~/.devenvrc", fn: "write_devenvrc" },
  { name: "bashrc", description: "append devenv sourcing to ~/.bashrc", fn: "append_bashrc" },
  { name: "git-config", description: "configure git identity and hooks", fn: "configure_git" },
  { name: "copilot-instructions", description: "install copilot instructions into ~/.copilot", fn: "install_copilot_instructions" },
  { name: "claude-integration", description: "install Claude Code integration into ~/.claude", fn: "install_claude_code_integration" },
  { name: "knowledge-sync", description: "sync the copilot knowledge side-repo", fn: "sync_copilot_knowledge" },
  { name: "engineering-sync", description: "sync the engineering standards side-repo", fn: "sync_copilot_engineering" },
  { name: "directories", description: "ensure runtime directories and settings exist", fn: "ensure_directories_and_settings" },
  { name: "nuget-sources", description: "configure NuGet package sources", fn: "configure_nuget_sources" },
  { name: "npmrc", description: "configure the user npmrc with provider credentials", fn: "configure_user_npmrc" },
  { name: "custom-bootstrap", description: "run fork/user custom bootstrap hooks if present", fn: "run_custom_bootstrap_if_present" },
  { name: "cleanup", description: "clean up package caches from the install", fn: "cleanup_packages" },
];

function showUsage(): never {
  console.log(`Usage: ${basename("setup-first-run")} [STEP...] | --all | --list

First-time provisioning for a devenv checkout. Non-interactive by contract:
every step is idempotent, skippable when already satisfied, and safe to run
unattended (fork bootstraps, CI).

Steps:
${STEPS.map((s) => `    ${s.name.padEnd(20)} ${s.description}`).join("\n")}

Options:
    -h, --help      Show this help message
    --all           Run every step in bootstrap order
    --list          List steps and exit
    --json          Emit step results as JSON (for tooling)

Exit codes:
    0 all requested steps succeeded
    1 a step failed (its output names the cause)
    2 invalid arguments
`);
  process.exit(0);
}

/** Bootstrap-owned globals the step functions consume. The bootstrap's
 * initialize_paths sets these as plain shell globals (never exported), so
 * this tool reproduces them explicitly — without them, steps like
 * credentials silently no-op (`cat: ''`) while reporting success. */
function stepPrelude(toolboxRoot: string): string {
  return [
    `toolbox_root='${toolboxRoot}'`,
    `devenv='${toolboxRoot}'`,
    `setup_dir='${toolboxRoot}/.setup'`,
    `name_file='${toolboxRoot}/.setup/name.txt'`,
    `email_file='${toolboxRoot}/.setup/email.txt'`,
    `config_file='${toolboxRoot}/devenv.config'`,
    "dotnet_cmd=\"$(command -v dotnet || echo /usr/bin/dotnet)\"",
    `export DEVENV_ROOT='${toolboxRoot}'`,
    `export DEVENV_TOOLS='${toolboxRoot}/tools'`,
  ].join("\n");
}

/** One bash session runs the whole invocation's steps, in order: the bridge
 * library's step functions exchange state through shell globals
 * (credentials sets HUMAN_NAME/USER_EMAIL; git-config consumes them), which
 * only survives if they share a shell — the historical bootstrap behavior. */
function runStepsInSession(steps: Step[], toolboxRoot: string, quiet: boolean): void {
  const body = steps
    .map((s) => `echo "[step] ${s.fn}"; ${s.fn}`)
    .join("\n");
  const script = [
    "set -e",
    `source '${PROVISION_LIB}'`,
    stepPrelude(toolboxRoot),
    body,
  ].join("\n");
  execFileSync("bash", ["-c", script], {
    cwd: toolboxRoot,
    stdio: quiet ? "pipe" : "inherit",
    env: { ...process.env, toolbox_root: toolboxRoot },
  });
}

async function main(argv: string[]): Promise<number> {
  let all = false;
  let list = false;
  let json = false;
  const requested: string[] = [];

  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h", default: false },
        all: { type: "boolean", default: false },
        list: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
      },
      strict: true,
    });
    all = Boolean(values["all"]);
    list = Boolean(values["list"]);
    json = Boolean(values["json"]);
    requested.push(...positionals);
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    return EXIT_MISUSE;
  }

  if (valuesHelp(argv)) showUsage();

  if (list) {
    for (const s of STEPS) console.log(`${s.name.padEnd(20)} ${s.description}`);
    return 0;
  }

  let selected: Step[];
  if (all) {
    selected = STEPS;
  } else if (requested.length > 0) {
    const unknown = requested.filter((r) => !STEPS.some((s) => s.name === r));
    if (unknown.length > 0) {
      logError(`unknown step(s): ${unknown.join(", ")} — see --list`);
      return EXIT_MISUSE;
    }
    selected = STEPS.filter((s) => requested.includes(s.name));
  } else {
    logError("nothing to do: pass --all or one or more step names (see --list)");
    return EXIT_MISUSE;
  }

  const results: { step: string; status: string }[] = [];
  let failed = false;
  try {
    runStepsInSession(selected, toolboxRoot, json);
    for (const step of selected) {
      logInfo(`[setup] ${step.name}: ${step.description}`);
      results.push({ step: step.name, status: "ok" });
    }
  } catch (err) {
    // Attribute the failure to the first step that has not yet been reported
    // ok. bash -e stops at the failing function, so completed prefixes are
    // recovered from stderr's "[step] <fn>" markers.
    const markerRe = /^\[step\] (\S+)$/gm;
    let lastFn = "";
    {
      const eo = err as { stdout?: unknown };
      const outText = typeof eo.stdout === "string"
        ? eo.stdout
        : eo.stdout instanceof Buffer ? eo.stdout.toString() : "";
      let m: RegExpExecArray | null;
      while ((m = markerRe.exec(outText)) !== null) lastFn = m[1] ?? "";
    }
    const failedIdx = Math.max(
      0,
      selected.findIndex((s) => s.fn === lastFn),
    );
    for (let i = 0; i < selected.length; i++) {
      const step: Step = selected[i] as Step;
      if (i < failedIdx) {
        results.push({ step: step.name, status: "ok" });
      } else if (i === failedIdx) {
        logInfo(`[setup] ${step.name}: ${step.description}`);
        // Surface the step's own output, not the spawn-failure boilerplate:
        // the execFileSync message is generic; the diagnostic lives in the
        // captured stdout/stderr of the failed session.
        const eo = err as { stdout?: unknown; stderr?: unknown };
        const detail = [eo.stdout, eo.stderr]
          .map((v) => (typeof v === "string" ? v : v instanceof Buffer ? v.toString() : ""))
          .join("")
          .trim();
        logError(`[setup] ${step.name} failed${detail ? `:\n${detail}` : `: ${err instanceof Error ? err.message : String(err)}`}`);
        results.push({ step: step.name, status: "failed" });
        failed = true;
      } else {
        results.push({ step: step.name, status: "skipped" });
      }
    }
    failed = true; // bootstrap order is sequence-meaningful: stop at first failure
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2));
  }

  if (failed) {
    logError("provisioning incomplete — fix the failing step and re-run (steps are idempotent)");
    return EXIT_GENERAL_ERROR;
  }
  logInfo(`[setup] ${results.length} step(s) completed`);
  return 0;
}

function valuesHelp(argv: string[]): boolean {
  return argv.includes("-h") || argv.includes("--help");
}

function basename(s: string): string {
  return s.split("/").pop() ?? s;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_GENERAL_ERROR);
  },
);
